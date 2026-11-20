// eval/runEval.js
// Offline evaluation of the suggestion generator (course: Evaluation metrics for
// text generation, Prompt engineering, Sampling strategies).
//
//   node eval/runEval.js [--provider ollama] [--judge ollama] [--judge-model qwen2.5:3b] [--mode quick] [--fixture path]
//
// Sweeps prompt strategy (plain | cot | tot) × sampling config on one fixture
// store and reports, per run:
//   valid      JSON parsed and had an items[] array
//   grounded   share of items that survive validateItems (cites real numbers, valid fields)
//   distinct2  unique bigrams / total bigrams across items (diversity)
//   rougeL     mean best ROUGE-L F1 vs PO-approved items in data/decisions.jsonl (null if none)
//   judge      mean LLM-as-judge score 1-5 (groundedness, actionability, specificity)
// Also prints the real PO approval rate from data/decisions.jsonl.
// Writes eval/results/<ts>.json, eval/results/latest.md and eval/results/samples.jsonl
// (every generated item + its judge score; finetune/ uses it as silver-labelled data).
try { process.loadEnvFile(); } catch {}
const fs = require("fs");
const path = require("path");
const { getCaller } = require("../ai/llm");
const { buildSuggestionsPrompt, STRATEGIES } = require("../ai/prompts");
const { validateItems } = require("../ai/validateItems");
const { buildReport } = require("../report/buildReport");

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((a) => { const [k, v = true] = a.trim().split(/\s+/); return [k, v]; }));
const provider = args.provider || process.env.EVAL_PROVIDER || "groq";
const judgeProvider = args.judge || process.env.EVAL_JUDGE || provider;
// Optional different model for the judge on the same provider, e.g.
// --provider ollama --judge ollama --judge-model qwen2.5:3b (avoids self-grading).
const judgeModel = args["judge-model"] || null;
const judgeModelEnv = `${judgeProvider.toUpperCase()}_MODEL`;
const mode = args.mode || "quick";
const fixturePath = args.fixture || path.join(__dirname, "..", "fixtures", "my-test-store-voezprx7-report.json");
const SAMPLING = [
  { name: "greedy-ish", temperature: 0.1, top_p: 1 },
  { name: "balanced", temperature: 0.7, top_p: 0.9 },
  { name: "creative", temperature: 1.1, top_p: 0.95 },
];
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "results");

// ── metrics ──────────────────────────────────────────────────────────────────
const tokens = (s) => String(s || "").toLowerCase().match(/[a-z0-9.%]+/g) || [];
const itemText = (it) => [it.title, it.problem, it.suggestion, it.recommendation].join(" ");

function lcs(a, b) {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
function rougeL(cand, ref) {
  const a = tokens(cand), b = tokens(ref);
  const l = lcs(a, b);
  if (!l) return 0;
  const p = l / a.length, r = l / b.length;
  return (2 * p * r) / (p + r);
}
function distinct2(items) {
  const grams = items.flatMap((it) => { const t = tokens(itemText(it)); return t.slice(1).map((w, i) => t[i] + " " + w); });
  return grams.length ? new Set(grams).size / grams.length : 0;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function judgePrompt(report, items) {
  return `You are grading AI-written CRO suggestions for a Shopify store. Score each item 1-5 on:
- grounded: every number it cites appears in DATA (5) vs invented numbers (1)
- actionable: a developer knows exactly what to change (5) vs vague (1)
- specific: tied to a concrete page/metric of THIS store (5) vs generic advice (1)
DATA:
${JSON.stringify(report)}
ITEMS:
${JSON.stringify(items.map((it, i) => ({ i, title: it.title, problem: it.problem, recommendation: it.recommendation, affectedPage: it.affectedPage, code: it.codePatch && it.codePatch.code })))}
Return ONLY JSON: {"scores":[{"i":0,"grounded":1-5,"actionable":1-5,"specific":1-5}]}`;
}

// ── data ─────────────────────────────────────────────────────────────────────
function loadDecisions() {
  const f = path.join(ROOT, "data", "decisions.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const normalized = fixture.normalized;
  const report = buildReport(normalized);
  const decisions = loadDecisions();
  const refs = decisions.filter((d) => d.action === "accept" && d.item && d.item.problem).map((d) => itemText(d.item));
  const call = getCaller(provider);
  const judge = getCaller(judgeProvider);
  const maxTokens = mode === "quick" ? 4000 : 7000;

  fs.mkdirSync(OUT, { recursive: true });
  const samples = fs.createWriteStream(path.join(OUT, "samples.jsonl"), { flags: "a" });
  const runs = [];

  for (const strategy of STRATEGIES) {
    for (const s of SAMPLING) {
      process.env.LLM_TEMPERATURE = String(s.temperature);
      process.env.LLM_TOP_P = String(s.top_p);
      const label = `${strategy}/${s.name}`;
      const row = { strategy, sampling: s.name, temperature: s.temperature, top_p: s.top_p };
      try {
        const prompt = buildSuggestionsPrompt(report, fixture.flags || [], fixture.crawlerRan, mode, { strategy });
        const { content, meta } = await call(prompt, maxTokens);
        const raw = (content && content.items) || [];
        const { items, stats } = validateItems(raw, { report, normalized, mode });
        row.valid = Array.isArray(content && content.items);
        row.received = stats.received;
        row.grounded = stats.received ? stats.kept / stats.received : 0;
        row.distinct2 = distinct2(items);
        row.rougeL = refs.length ? mean(items.map((it) => Math.max(...refs.map((r) => rougeL(itemText(it), r))))) : null;
        row.latencyMs = meta.processingTimeMs;
        row.tokens = meta.tokensUsed && meta.tokensUsed.totalTokens;

        process.env.LLM_TEMPERATURE = "0"; // judge deterministically
        let scores = [];
        for (let attempt = 0; items.length && attempt < 3; attempt++) {
          try {
            const genModel = process.env[judgeModelEnv];
            if (judgeModel) process.env[judgeModelEnv] = judgeModel; // clients read the model per call
            let jr;
            try { jr = await judge(judgePrompt(report, items), 3000); }
            finally { if (judgeModel) { if (genModel === undefined) delete process.env[judgeModelEnv]; else process.env[judgeModelEnv] = genModel; } }
            scores = (jr.content && jr.content.scores) || [];
            break;
          } catch (err) {
            row.judgeError = err.message; // judge failure must not mark the generation invalid
            await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))); // free tiers rate-limit (429)
          }
        }
        if (scores.length) delete row.judgeError;
        const per = scores.map((x) => (x.grounded + x.actionable + x.specific) / 3);
        row.judge = mean(per);
        items.forEach((it, i) => {
          const sc = scores.find((x) => x.i === i);
          samples.write(JSON.stringify({ strategy, sampling: s.name, judge: sc ? (sc.grounded + sc.actionable + sc.specific) / 3 : null, report, item: it }) + "\n");
        });
        console.log(`[eval] ${label}: grounded=${row.grounded.toFixed(2)} judge=${row.judge?.toFixed(2)} distinct2=${row.distinct2.toFixed(2)}`);
      } catch (err) {
        row.valid = false;
        row.error = err.message;
        console.warn(`[eval] ${label} failed: ${err.message}`);
      }
      runs.push(row);
    }
  }
  samples.end();

  const approval = {
    total: decisions.length,
    accepted: decisions.filter((d) => d.action === "accept").length,
  };
  approval.rate = approval.total ? approval.accepted / approval.total : null;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const result = { ts, provider, judgeProvider, judgeModel, mode, fixture: path.basename(fixturePath), approval, runs };
  fs.writeFileSync(path.join(OUT, `${ts}.json`), JSON.stringify(result, null, 2));

  const f = (x, d = 2) => (x == null ? "–" : Number(x).toFixed(d));
  const md = [
    `# Eval ${ts}`,
    `provider=${provider} judge=${judgeProvider}${judgeModel ? `(${judgeModel})` : ""} mode=${mode} fixture=${result.fixture}`,
    `PO approval rate: ${approval.total ? `${approval.accepted}/${approval.total} = ${f(approval.rate)}` : "no decisions logged yet"}`,
    "",
    "| strategy | sampling | T | top-p | valid | grounded | distinct-2 | ROUGE-L | judge (1-5) | tokens | latency ms |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...runs.map((r) => `| ${r.strategy} | ${r.sampling} | ${r.temperature} | ${r.top_p} | ${r.valid ? "yes" : "no"} | ${f(r.grounded)} | ${f(r.distinct2)} | ${f(r.rougeL)} | ${f(r.judge)} | ${r.tokens ?? "–"} | ${r.latencyMs ?? "–"} |`),
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "latest.md"), md + "\n");
  console.log("\n" + md);
}

// Self-check for the metric code (no API calls): node eval/runEval.js --selftest
if (args.selftest) {
  const assert = require("assert");
  assert.strictEqual(rougeL("a b c d", "a b c d"), 1);
  assert.strictEqual(rougeL("x y", "a b"), 0);
  assert.ok(Math.abs(rougeL("a b c", "a c") - 0.8) < 1e-9); // lcs=2, p=2/3, r=1
  assert.strictEqual(distinct2([{ title: "a b a b" }]), 2 / 3); // ab, ba, ab
  console.log("metrics self-test ok");
} else {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
