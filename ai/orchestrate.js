// ai/orchestrate.js
// Generate → Judge orchestration:
//   1. Several generator models draft candidates in PARALLEL (same prompt).
//   2. Candidates are deduped by fingerprint (agreement is tracked).
//   3. A judge model merges/filters/re-ranks into the final set.
//
// Config (env):
//   ORCH_GENERATORS = comma list, e.g. "cerebras,mistral,groq"
//   ORCH_JUDGE      = single provider, e.g. "cerebras"
// Any generator that errors or is rate-limited is skipped (allSettled); if the
// judge fails, we fall back to the deduped candidates so a report still returns.

const { getCaller } = require("./llm");
const { buildSuggestionsPrompt } = require("./prompts");
const { buildJudgePrompt } = require("./judgePrompt");

function parseList(v, fallback) {
  const list = (v || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

// Stable identity for dedup: same category + same page ≈ same finding.
function fingerprint(item) {
  const page = (item.affectedPage || "site-wide").toLowerCase().replace(/\/+$/, "");
  return `${(item.category || "other").toLowerCase()}::${page}`;
}

const CONF_RANK = { high: 3, medium: 2, low: 1 };

function dedupe(candidates) {
  const groups = new Map();
  for (const item of candidates) {
    const fp = fingerprint(item);
    const g = groups.get(fp);
    if (!g) {
      groups.set(fp, { item, agreement: 1, sources: [item._source] });
    } else {
      g.agreement += 1;
      if (item._source && !g.sources.includes(item._source)) g.sources.push(item._source);
      // keep the higher-confidence variant as the representative
      if ((CONF_RANK[item.confidence] || 0) > (CONF_RANK[g.item.confidence] || 0)) {
        g.item = item;
      }
    }
  }
  return [...groups.values()].map((g) => ({
    ...g.item,
    _agreement: g.agreement,
    _sources: g.sources,
  }));
}

function sumTokens(metas) {
  return metas.reduce(
    (acc, m) => {
      const t = (m && m.tokensUsed) || {};
      acc.promptTokens += t.promptTokens || 0;
      acc.completionTokens += t.completionTokens || 0;
      acc.totalTokens += t.totalTokens || 0;
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  );
}

async function orchestrateSuggestions({ report, flags, crawlerRan, mode, maxTokens }) {
  const generators = parseList(process.env.ORCH_GENERATORS, ["cerebras", "mistral"]);
  const judge = (process.env.ORCH_JUDGE || generators[0]).trim();
  const start = Date.now();

  // ── 1. Generate in parallel ────────────────────────────────────────────────
  const genPrompt = buildSuggestionsPrompt(report, flags, crawlerRan, mode);
  const settled = await Promise.allSettled(
    generators.map((name) => getCaller(name)(genPrompt, maxTokens))
  );

  const candidates = [];
  const genMeta = [];
  settled.forEach((res, i) => {
    const name = generators[i];
    if (res.status === "fulfilled") {
      const items = (res.value.content && res.value.content.items) || [];
      for (const it of items) candidates.push({ ...it, _source: name });
      genMeta.push({ provider: name, count: items.length, ...res.value.meta });
      console.log(`[orchestrate] generator ${name}: ${items.length} items`);
    } else {
      genMeta.push({ provider: name, error: res.reason.message });
      console.warn(`[orchestrate] generator ${name} failed: ${res.reason.message}`);
    }
  });

  if (!candidates.length) {
    throw new Error(`All generators failed: ${genMeta.map((m) => m.error).join("; ")}`);
  }

  // ── 2. Dedupe ──────────────────────────────────────────────────────────────
  const deduped = dedupe(candidates);
  console.log(`[orchestrate] ${candidates.length} candidates → ${deduped.length} deduped`);

  // ── 3. Judge (merge / filter / re-rank) ────────────────────────────────────
  let finalItems = deduped;
  let judgeMeta = { provider: judge };
  try {
    const judgePrompt = buildJudgePrompt(report, deduped, mode);
    const jr = await getCaller(judge)(judgePrompt, maxTokens);
    const judged = (jr.content && jr.content.items) || [];
    if (judged.length) finalItems = judged;
    judgeMeta = { provider: judge, count: judged.length, ...jr.meta };
    console.log(`[orchestrate] judge ${judge}: ${judged.length} final items`);
  } catch (err) {
    judgeMeta = { provider: judge, error: err.message, fellBackToCandidates: true };
    console.warn(`[orchestrate] judge ${judge} failed, using deduped candidates: ${err.message}`);
  }

  // strip internal fields before returning
  const items = finalItems.map(({ _source, _agreement, _sources, ...clean }) => clean);

  return {
    content: { items },
    meta: {
      model: `orchestrate(${generators.join("+")}→${judge})`,
      orchestration: {
        generators: genMeta,
        judge: judgeMeta,
        candidateCount: candidates.length,
        dedupedCount: deduped.length,
        finalCount: items.length,
      },
      tokensUsed: sumTokens([...genMeta, judgeMeta]),
      processingTimeMs: Date.now() - start,
    },
  };
}

module.exports = { orchestrateSuggestions };
