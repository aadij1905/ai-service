// ai/geminiClient.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { parseJsonLoose } = require("./parseJson");

// DEMO ONLY: rotates across multiple Gemini API keys per "pool" so
// code-generation and suggestion-generation each draw from their own
// separate free-tier quota instead of sharing one. This works because each
// key here belongs to a different Google account/project — Google's ToS
// prohibits using multiple accounts to get around a single project's rate
// limit, so this is a stopgap for demoing the pipeline, not something to
// leave running in production (use a paid tier there instead).
const KEY_POOLS = {
  // Heavier calls (~30-40K tokens): full theme code + patch generation,
  // and the screenshot-grounded "what changes" note.
  code: [process.env.GEMINI_API_KEY_CODE_1, process.env.GEMINI_API_KEY_CODE_2].filter(Boolean),
  // Suggestion generation (buildSuggestionsPrompt, incl. as an orchestrate
  // generator/judge) and visual flaw detection off crawler screenshots.
  suggestions: [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_SUGGESTIONS_2].filter(Boolean),
};

const clientsByKey = {};
const counters = { code: 0, suggestions: 0 };

function clientFor(apiKey) {
  if (!clientsByKey[apiKey]) clientsByKey[apiKey] = new GoogleGenerativeAI(apiKey);
  return clientsByKey[apiKey];
}

// Returns the pool's keys starting from the next round-robin position, so a
// caller can walk through them in order and fall back on failure.
function rotatedKeys(pool) {
  const keys = KEY_POOLS[pool];
  if (!keys || keys.length === 0) {
    const fallback = process.env.GEMINI_API_KEY;
    if (!fallback) throw new Error(`No Gemini API key configured for pool "${pool}"`);
    return [fallback];
  }
  const start = counters[pool] % keys.length;
  counters[pool] += 1;
  return [...keys.slice(start), ...keys.slice(0, start)];
}

function buildModel(genAI, modelName, maxTokens, temperature) {
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json", // forces JSON output, Gemini's equivalent of json_object
      // gemini-2.5-flash spends part of maxOutputTokens on internal "thinking"
      // tokens by default, which can truncate the visible JSON before it
      // completes. Disabling it keeps the full budget for actual output.
      // Not in the SDK's TS types but forwarded as-is to the REST API.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
}

function toResult(responseText, usage, modelName, elapsed, label) {
  console.log(`[${label}] model=${modelName} responseTimeMs=${elapsed} tokens=${usage.totalTokenCount}`);
  return {
    content: parseJsonLoose(responseText),
    meta: {
      model: modelName,
      tokensUsed: {
        promptTokens: usage.promptTokenCount,
        completionTokens: usage.candidatesTokenCount,
        totalTokens: usage.totalTokenCount,
      },
      processingTimeMs: elapsed,
    },
  };
}

// pool: "code" | "suggestions" — picks which key rotation to draw from.
// Tries each key in the pool in round-robin order, falling back to the next
// on failure (e.g. a 429) before giving up.
async function callGemini(prompt, maxTokens = 6000, pool = "suggestions") {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = rotatedKeys(pool);

  let lastErr;
  for (const key of keys) {
    const start = Date.now();
    try {
      const model = buildModel(clientFor(key), modelName, maxTokens, 0.3);
      const result = await model.generateContent(prompt);
      return toResult(result.response.text(), result.response.usageMetadata, modelName, Date.now() - start, "Gemini");
    } catch (err) {
      lastErr = err;
      console.warn(`[Gemini] key failed in pool "${pool}", trying next: ${err.message}`);
    }
  }
  throw lastErr;
}

// Fetches a screenshot URL and returns it as a Gemini inlineData image part.
async function fetchImageAsInlineData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  return { inlineData: { data: buf.toString("base64"), mimeType } };
}

// Vision variant of callGemini — same JSON-forced contract and pool/fallback
// behavior, but the prompt is grounded in one or more real screenshots
// (e.g. desktop + mobile of a page) instead of text alone.
async function callGeminiVision(prompt, imageUrls, maxTokens = 2000, pool = "suggestions") {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = rotatedKeys(pool);
  const imageParts = await Promise.all(imageUrls.map(fetchImageAsInlineData));

  let lastErr;
  for (const key of keys) {
    const start = Date.now();
    try {
      const model = buildModel(clientFor(key), modelName, maxTokens, 0.2);
      const result = await model.generateContent([prompt, ...imageParts]);
      return toResult(result.response.text(), result.response.usageMetadata, modelName, Date.now() - start, "Gemini Vision");
    } catch (err) {
      lastErr = err;
      console.warn(`[Gemini Vision] key failed in pool "${pool}", trying next: ${err.message}`);
    }
  }
  throw lastErr;
}

module.exports = { callGemini, callGeminiVision };

// ---------------------------------------------------------------------------
// TEMPORARY TEST BLOCK -- isolated smoke test, remove once wired into
// routes/analyze.js. Run with: node ai/geminiClient.js
// ---------------------------------------------------------------------------
if (require.main === module) {
  require("dotenv").config();

  const testPrompt = `Return ONLY valid JSON, no markdown fences, no prose, matching this exact schema:
{ "status": "ok" }`;

  callGemini(testPrompt, 100)
    .then(({ content, meta }) => {
      console.log("Parsed content:", content);
      console.log("Meta:", meta);
    })
    .catch((err) => {
      console.error("callGemini test failed:", err.message);
      process.exitCode = 1;
    });
}
