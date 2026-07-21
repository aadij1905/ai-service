// ai/generateReport.js
const { buildReport } = require("../report/buildReport");
const { callLLM } = require("./llm");
const { orchestrateSuggestions } = require("./orchestrate");
const { buildSuggestionsPrompt } = require("./prompts");
const { generateMockSuggestions } = require("./mockSuggestions");
const { callGeminiVision } = require("./geminiClient");
const { unwrapSingleObject } = require("./parseJson");
const { validateItems } = require("./validateItems");
const { forecastImpact } = require("./forecastImpact");
const { detectVisualFlaws } = require("./visualDetectors");
const { judgeCandidates } = require("./judge");
const { PROVIDERS } = require("./llm");

// Which provider judges the vision path's output. Prefer an explicit override,
// then the active single suggestion provider (so an "all-gemini" setup judges
// with gemini too, not whatever ORCH_JUDGE happens to be), then ORCH_JUDGE,
// then a sane default. AI_PROVIDER="orchestrate" isn't a real caller, so it
// falls through to ORCH_JUDGE.
function resolveVisionJudge() {
  const explicit = (process.env.VISION_JUDGE_PROVIDER || "").trim();
  if (explicit) return explicit;
  const active = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (PROVIDERS.includes(active)) return active;
  return (process.env.ORCH_JUDGE || "cerebras").trim();
}

// Cap on how many crawled screenshots get attached to one suggestion-
// generation call — bounds cost/latency on stores with many crawled pages.
const IMAGE_CAP = 6;

function splitItems(items) {
  const problems = items.map((item) => ({
    id: item.id,
    rank: item.rank,
    category: item.category,
    title: item.title,
    problem: item.problem,
    suggestion: item.suggestion,
    affectedPage: item.affectedPage,
    impactEstimate: item.impactEstimate,
    // Deterministic, data-grounded revenue forecast (null when un-modelable).
    impactForecast: item.impactForecast || null,
    confidence: item.confidence,
  }));

  const analysis = items.map((item) => ({
    id: item.id,
    rank: item.rank,
    category: item.category,
    title: item.title,
    issue: item.issue,
    recommendation: item.recommendation,
    affectedPage: item.affectedPage,
    impactEstimate: item.impactEstimate,
    impactForecast: item.impactForecast || null,
    effort: item.effort,
    confidence: item.confidence,
    dataSource: item.dataSource,
    codePatch: item.codePatch,
  }));

  return { problems, analysis };
}

async function generateReport({ normalized, flags = [], crawlerRan = false, mode = "comprehensive", mockMode = false }) {
  const report = buildReport(normalized);

  if (mockMode) {
    const rawItems = generateMockSuggestions(normalized, flags);
    const items = rawItems.map((it) => {
      const impactForecast = forecastImpact(it, normalized);
      return impactForecast ? { ...it, impactForecast } : it;
    });
    const { problems, analysis } = splitItems(items);
    return {
      report: { ...report, problems },
      analysis,
      meta: {
        model: "mock",
        tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        processingTimeMs: 0,
        mode: "mock",
      },
    };
  }

  // When the crawler produced real screenshots, the suggestion-writing model
  // looks at them directly (Gemini Vision) instead of reasoning over a
  // separate text summary of what's in them — one integrated pass instead of
  // a vision pre-pass feeding a text-only model.
  const crawledPages = crawlerRan
    ? (normalized.pages || []).filter((p) => p.crawlerEnriched && p.screenshotUrl).slice(0, IMAGE_CAP)
    : [];
  const imageUrls = crawledPages.map((p) => p.screenshotUrl);

  const maxTokens = mode === "quick" ? 4000 : 7000;

  // Visual-flaw pre-pass: a vision model audits each crawled screenshot and
  // returns structured flaws tagged dataQuality: "visual", which we merge into
  // the flags the suggestion prompt already knows how to consume. This makes
  // what a page *looks like* a first-class input alongside the ShopifyQL
  // numbers, instead of leaving UI problems to be inferred from metrics alone.
  // Best-effort and env-gated (VISUAL_DETECTORS=off to skip); a failure here
  // never blocks suggestion generation.
  let allFlags = flags;
  if (imageUrls.length > 0 && process.env.VISUAL_DETECTORS !== "off") {
    const visualFlags = await detectVisualFlaws(normalized, { cap: IMAGE_CAP });
    if (visualFlags.length) {
      allFlags = [...flags, ...visualFlags];
      console.log(`[generateReport] visual detectors: +${visualFlags.length} visual flag(s) merged (${flags.length} numeric)`);
    }
  }

  let content, meta;
  if (imageUrls.length > 0) {
    console.log(`[generateReport] vision-integrated: ${imageUrls.length} screenshot(s) attached to suggestion generation`);
    const prompt = buildSuggestionsPrompt(report, allFlags, crawlerRan, mode, {
      imagesAttached: true,
      pages: crawledPages,
    });
    const result = await callGeminiVision(prompt, imageUrls, maxTokens, "suggestions");
    content = unwrapSingleObject(result.content);
    meta = result.meta;

    // Give the single vision generation the same judge refinement the
    // orchestrate path gets: merge semantic duplicates, drop weak/unsupported
    // items, re-rank. Text-only judge (no images needed). Falls back to the
    // raw vision items if the judge fails or returns nothing.
    if (process.env.VISION_JUDGE !== "off" && (content.items || []).length) {
      const judged = await judgeCandidates({ report, candidates: content.items, mode, maxTokens, judge: resolveVisionJudge() });
      if (judged.items.length) {
        content = { items: judged.items };
        meta = { ...meta, model: `${meta.model}→judge(${judged.meta.provider})`, judge: judged.meta };
      }
    }
  } else if ((process.env.AI_PROVIDER || "").toLowerCase() === "orchestrate") {
    ({ content, meta } = await orchestrateSuggestions({
      report,
      flags: allFlags,
      crawlerRan,
      mode,
      maxTokens,
    }));
  } else {
    const prompt = buildSuggestionsPrompt(report, allFlags, crawlerRan, mode);
    ({ content, meta } = await callLLM(prompt, maxTokens));
  }

  // Deterministic guardrail over the raw LLM output (all live paths): repairs
  // enums/pages, grounds cited numbers, and dedupes before it reaches callers.
  const { items: validated, stats } = validateItems(content.items || [], { report, normalized, mode });
  // Ground each item's revenue impact in the store's own numbers (deterministic,
  // never the LLM). Un-modelable items keep their qualitative impactEstimate.
  const items = validated.map((it) => {
    const impactForecast = forecastImpact(it, normalized);
    return impactForecast ? { ...it, impactForecast } : it;
  });
  console.log(
    `[generateReport] validation: ${stats.received} → ${stats.kept} kept ` +
    `(dropped ${stats.droppedMissingFields} no-fields / ${stats.droppedUngrounded} ungrounded, ` +
    `coerced ${stats.coercedPages} pages / ${stats.coercedEnums} enums, ` +
    `folded ${stats.duplicatesFolded} dupes, downgraded ${stats.confidenceDowngrades})`
  );
  const { problems, analysis } = splitItems(items);

  return {
    report: { ...report, problems },
    analysis,
    meta: { ...meta, mode, validation: stats },
  };
}

module.exports = { generateReport };
