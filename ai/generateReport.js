// ai/generateReport.js
const { buildReport } = require("../report/buildReport");
const { callLLM } = require("./llm");
const { orchestrateSuggestions } = require("./orchestrate");
const { buildSuggestionsPrompt } = require("./prompts");
const { generateMockSuggestions } = require("./mockSuggestions");
const { callGeminiVision } = require("./geminiClient");
const { unwrapSingleObject } = require("./parseJson");

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
    const items = generateMockSuggestions(normalized, flags);
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

  let content, meta;
  if (imageUrls.length > 0) {
    console.log(`[generateReport] vision-integrated: ${imageUrls.length} screenshot(s) attached to suggestion generation`);
    const prompt = buildSuggestionsPrompt(report, flags, crawlerRan, mode, {
      imagesAttached: true,
      pages: crawledPages,
    });
    const result = await callGeminiVision(prompt, imageUrls, maxTokens, "suggestions");
    content = unwrapSingleObject(result.content);
    meta = result.meta;
  } else if ((process.env.AI_PROVIDER || "").toLowerCase() === "orchestrate") {
    ({ content, meta } = await orchestrateSuggestions({
      report,
      flags,
      crawlerRan,
      mode,
      maxTokens,
    }));
  } else {
    const prompt = buildSuggestionsPrompt(report, flags, crawlerRan, mode);
    ({ content, meta } = await callLLM(prompt, maxTokens));
  }

  const items = content.items || [];
  const { problems, analysis } = splitItems(items);

  return {
    report: { ...report, problems },
    analysis,
    meta: { ...meta, mode },
  };
}

module.exports = { generateReport };
