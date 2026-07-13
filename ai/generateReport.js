// ai/generateReport.js
const { buildReport } = require("../report/buildReport");
const { callLLM } = require("./llm");
const { orchestrateSuggestions } = require("./orchestrate");
const { buildSuggestionsPrompt } = require("./prompts");
const { generateMockSuggestions } = require("./mockSuggestions");
const { detectVisualFlaws } = require("./visualDetectors");

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

  // Ground flaw detection in real screenshots where the crawler ran. This is
  // best-effort (empty array on any failure) so it never blocks a report.
  const visualFlags = crawlerRan ? await detectVisualFlaws(normalized) : [];
  const allFlags = [...flags, ...visualFlags];
  console.log(`[generateReport] ${flags.length} rule-based flags + ${visualFlags.length} visual flags`);

  const maxTokens = mode === "quick" ? 4000 : 7000;

  let content, meta;
  if ((process.env.AI_PROVIDER || "").toLowerCase() === "orchestrate") {
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

  const items = content.items || [];
  const { problems, analysis } = splitItems(items);

  return {
    report: { ...report, problems },
    analysis,
    meta: { ...meta, mode },
  };
}

module.exports = { generateReport };
