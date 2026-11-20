"""LoRA fine-tune a small open LLM to write CRO suggestions from store metrics.

Course mapping: Fine-tuning on custom datasets (Lab 2), autoregressive decoding
and its limits (Lab 3), conditional text generation (Lab 4), CO3.

Data (built from the running system, see README.md here):
  gold   data/decisions.jsonl     PO-approved suggestions (action == "accept")
  silver eval/results/samples.jsonl  generated items the LLM judge scored >= 4/5
Each example: prompt = trimmed store metrics + target category/page,
              target  = the suggestion as JSON.

  pip install -r finetune/requirements.txt
  python finetune/train_lora.py                # defaults: Qwen2.5-0.5B-Instruct, 3 epochs
  python finetune/train_lora.py --epochs 1 --base Qwen/Qwen2.5-1.5B-Instruct

Writes finetune/out/adapter/ (LoRA weights) and finetune/out/metrics.json:
held-out perplexity and ROUGE-L of sampled generations, base vs fine-tuned.
Runs on CUDA, Apple MPS or CPU (Colab T4 is plenty).
"""
import argparse, json, math, random, re
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "finetune" / "out"
FIELDS = ["category", "title", "problem", "suggestion", "recommendation", "affectedPage", "codePatch"]


def read_jsonl(p):
    p = ROOT / p
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def trim_report(r):
    """Keep the prompt short: overview, funnel and the 5 highest-traffic pages."""
    if not r:
        return {}
    pages = sorted(r.get("pages") or [], key=lambda p: -(p.get("sessions") or 0))[:5]
    keep = ("path", "sessions", "conversionRate", "bounceRate", "lcp_p75_ms", "p75_cls", "inp_p75_ms")
    return {
        "overview": r.get("overview"),
        "funnel": r.get("funnel"),
        "pages": [{k: p.get(k) for k in keep} for p in pages],
    }


def to_example(report, item):
    prompt = (
        "You are a Shopify CRO consultant. Using ONLY these store metrics, write one "
        f"suggestion about '{item.get('category')}' for page {item.get('affectedPage')}. "
        "Cite real numbers. Answer as JSON.\n"
        f"METRICS: {json.dumps(trim_report(report), separators=(',', ':'))}"
    )
    target = json.dumps({k: item.get(k) for k in FIELDS}, separators=(",", ":"))
    return {"prompt": prompt, "target": target}


def load_examples(min_judge):
    gold = [d for d in read_jsonl("data/decisions.jsonl") if d.get("action") == "accept" and (d.get("item") or {}).get("problem")]
    silver = [s for s in read_jsonl("eval/results/samples.jsonl") if (s.get("judge") or 0) >= min_judge]
    # Decisions don't carry the report; reuse the latest eval report for that store if present.
    last_report = silver[-1]["report"] if silver else {}
    ex = [to_example(d.get("report") or last_report, d["item"]) for d in gold]
    ex += [to_example(s["report"], s["item"]) for s in silver]
    # dedupe identical targets (same item generated twice)
    seen, out = set(), []
    for e in ex:
        if e["target"] not in seen:
            seen.add(e["target"])
            out.append(e)
    return out, len(gold), len(silver)


def rouge_l(a, b):
    a, b = re.findall(r"[a-z0-9.%]+", a.lower()), re.findall(r"[a-z0-9.%]+", b.lower())
    dp = [0] * (len(b) + 1)
    for x in a:
        prev = 0
        for j, y in enumerate(b, 1):
            prev, dp[j] = dp[j], prev + 1 if x == y else max(dp[j], dp[j - 1])
    l = dp[-1]
    if not l:
        return 0.0
    p, r = l / len(a), l / len(b)
    return 2 * p * r / (p + r)


def encode(tok, ex, max_len):
    """Chat-format the prompt; loss only on the target tokens (prompt masked with -100)."""
    p = tok.apply_chat_template([{"role": "user", "content": ex["prompt"]}], tokenize=False, add_generation_prompt=True)
    p_ids = tok(p, add_special_tokens=False)["input_ids"]
    t_ids = tok(ex["target"] + tok.eos_token, add_special_tokens=False)["input_ids"]
    ids = (p_ids + t_ids)[:max_len]
    labels = ([-100] * len(p_ids) + t_ids)[:max_len]
    return torch.tensor([ids]), torch.tensor([labels])


@torch.no_grad()
def perplexity(model, tok, data, max_len, device):
    model.eval()
    nll, n = 0.0, 0
    for ex in data:
        ids, labels = encode(tok, ex, max_len)
        out = model(input_ids=ids.to(device), labels=labels.to(device))
        k = int((labels != -100).sum()) - 1
        nll += out.loss.item() * k
        n += k
    return math.exp(nll / max(n, 1))


@torch.no_grad()
def sample_rouge(model, tok, data, device, temperature, top_p, max_new):
    """Autoregressive decoding with temperature/top-p sampling; ROUGE-L vs the reference."""
    model.eval()
    scores, outs = [], []
    for ex in data:
        p = tok.apply_chat_template([{"role": "user", "content": ex["prompt"]}], tokenize=False, add_generation_prompt=True)
        ids = tok(p, return_tensors="pt").to(device)
        gen = model.generate(**ids, max_new_tokens=max_new, do_sample=temperature > 0, temperature=temperature or None,
                             top_p=top_p, pad_token_id=tok.eos_token_id)
        text = tok.decode(gen[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
        outs.append(text)
        scores.append(rouge_l(text, ex["target"]))
    return sum(scores) / max(len(scores), 1), outs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=8)
    ap.add_argument("--max-len", type=int, default=1024)
    ap.add_argument("--min-judge", type=float, default=4.0)
    ap.add_argument("--max-new", type=int, default=300)
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--top-p", type=float, default=0.9)
    a = ap.parse_args()

    random.seed(0)
    torch.manual_seed(0)
    data, n_gold, n_silver = load_examples(a.min_judge)
    if len(data) < 4:
        raise SystemExit(f"Only {len(data)} examples. Run `node eval/runEval.js` (silver) and/or approve suggestions in Review Hub (gold) first.")
    random.shuffle(data)
    n_test = max(2, len(data) // 5)
    test, train = data[:n_test], data[n_test:]
    print(f"examples: {len(data)} (gold {n_gold}, silver {n_silver}) -> train {len(train)} / test {len(test)}")

    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(a.base)
    model = AutoModelForCausalLM.from_pretrained(a.base, torch_dtype=torch.float32).to(device)

    base_ppl = perplexity(model, tok, test, a.max_len, device)
    base_rouge, base_out = sample_rouge(model, tok, test, device, a.temperature, a.top_p, a.max_new)
    print(f"base: ppl={base_ppl:.2f} rougeL={base_rouge:.3f}")

    # LoRA: freeze the base, train low-rank adapters on the attention projections.
    model = get_peft_model(model, LoraConfig(r=a.rank, lora_alpha=2 * a.rank, lora_dropout=0.05,
                                             target_modules=["q_proj", "k_proj", "v_proj", "o_proj"], task_type="CAUSAL_LM"))
    model.print_trainable_parameters()
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr)
    losses = []
    for ep in range(a.epochs):
        model.train()
        random.shuffle(train)
        tot = 0.0
        for ex in train:  # ponytail: batch size 1, fine for a few hundred examples; add padding+batching if the dataset grows
            ids, labels = encode(tok, ex, a.max_len)
            loss = model(input_ids=ids.to(device), labels=labels.to(device)).loss
            loss.backward()
            opt.step()
            opt.zero_grad()
            tot += loss.item()
        losses.append(tot / len(train))
        print(f"epoch {ep + 1}: train loss {losses[-1]:.4f}")

    ft_ppl = perplexity(model, tok, test, a.max_len, device)
    ft_rouge, ft_out = sample_rouge(model, tok, test, device, a.temperature, a.top_p, a.max_new)
    print(f"fine-tuned: ppl={ft_ppl:.2f} rougeL={ft_rouge:.3f}")

    OUT.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(OUT / "adapter")
    metrics = {
        "base_model": a.base, "device": device, "examples": len(data), "gold": n_gold, "silver": n_silver,
        "train": len(train), "test": len(test), "epochs": a.epochs, "lora_rank": a.rank, "lr": a.lr,
        "train_loss": losses, "sampling": {"temperature": a.temperature, "top_p": a.top_p},
        "base": {"perplexity": base_ppl, "rougeL": base_rouge},
        "finetuned": {"perplexity": ft_ppl, "rougeL": ft_rouge},
        "examples_out": [{"reference": t["target"], "base": b, "finetuned": f} for t, b, f in zip(test, base_out, ft_out)][:3],
    }
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"wrote {OUT / 'metrics.json'}")


if __name__ == "__main__":
    main()
