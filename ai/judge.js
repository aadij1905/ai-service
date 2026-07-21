// ai/judge.js
// The "judge" refinement step, extracted so both the multi-generator
// orchestrator AND the single-generator vision path can reuse it: an LLM reads
// the candidate findings against the ground-truth data and merges near-
// duplicates (including semantic ones a fingerprint dedup misses), drops weak/
// unsupported items, and re-ranks. Text-only — the judge reasons over the
// candidate JSON + report numbers, so it never needs the screenshots even when
// the candidates came from a vision model.
//
// Best-effort by contract: returns { items: [], meta: { error } } on failure so
// callers can fall back to the pre-judge candidates instead of failing the run.

const { getCaller } = require("./llm");
const { buildJudgePrompt } = require("./judgePrompt");

async function judgeCandidates({ report, candidates, mode, maxTokens, judge }) {
  const provider = (judge || process.env.ORCH_JUDGE || "cerebras").trim();
  try {
    const prompt = buildJudgePrompt(report, candidates, mode);
    const jr = await getCaller(provider)(prompt, maxTokens);
    const items = (jr.content && jr.content.items) || [];
    console.log(`[judge] ${provider}: ${candidates.length} candidates → ${items.length} refined`);
    return { items, meta: { provider, count: items.length, ...jr.meta } };
  } catch (err) {
    console.warn(`[judge] ${provider} failed: ${err.message}`);
    return { items: [], meta: { provider, error: err.message } };
  }
}

module.exports = { judgeCandidates };
