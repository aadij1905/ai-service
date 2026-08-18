// ai/geminiClient.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { parseJsonLoose } = require("./parseJson");
const { smokeTest } = require("./smokeTest");

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

// How many times to walk the whole key pool before giving up, and the base
// backoff between passes. Gemini's free tier returns transient 503 "high
// demand" spikes that clear in a second or two — retrying the pool (not just
// rotating keys once) is what turns those into a brief delay instead of a
// failed report.
const MAX_PASSES = Number(process.env.GEMINI_MAX_RETRIES || 3);
const BASE_BACKOFF_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The @google/generative-ai SDK embeds the HTTP status in the error message
// (e.g. "[503 Service Unavailable] …"); err.status is not always set.
function statusOf(err) {
  if (typeof err?.status === "number") return err.status;
  const m = String(err?.message || "").match(/\[(\d{3})\b/);
  return m ? Number(m[1]) : 0;
}

// 400 (bad request / prompt too large / safety block) and 403 (invalid key,
// permission) won't be fixed by another key or a wait — fail fast rather than
// burning the backoff budget. Everything else (429 quota, 500/503 overload,
// network blips) is worth the next key and, if the whole pool is down, a
// backed-off retry.
function isFatal(err) {
  const s = statusOf(err);
  return s === 400 || s === 403;
}

// Walk the pool's keys in round-robin order; on a transient failure fall back
// to the next key. If an entire pass fails, back off (exponential + jitter)
// and retry the pool, up to MAX_PASSES. `attempt(key)` resolves the result or
// throws. Shared by callGemini and callGeminiVision so both get the same
// resilience.
async function withKeyPool(pool, label, attempt) {
  const keys = rotatedKeys(pool);
  let lastErr;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (const key of keys) {
      try {
        return await attempt(key);
      } catch (err) {
        lastErr = err;
        if (isFatal(err)) throw err;
        console.warn(`[${label}] key failed in pool "${pool}" (pass ${pass + 1}/${MAX_PASSES}): ${err.message}`);
      }
    }
    if (pass < MAX_PASSES - 1) {
      const delay = BASE_BACKOFF_MS * 2 ** pass + Math.floor(Math.random() * 250);
      console.warn(`[${label}] whole pool "${pool}" failed pass ${pass + 1} — backing off ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// pool: "code" | "suggestions" — picks which key rotation to draw from.
async function callGemini(prompt, maxTokens = 6000, pool = "suggestions") {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  return withKeyPool(pool, "Gemini", async (key) => {
    const start = Date.now();
    const model = buildModel(clientFor(key), modelName, maxTokens, 0.3);
    const result = await model.generateContent(prompt);
    return toResult(result.response.text(), result.response.usageMetadata, modelName, Date.now() - start, "Gemini");
  });
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
  const imageParts = await Promise.all(imageUrls.map(fetchImageAsInlineData));
  return withKeyPool(pool, "Gemini Vision", async (key) => {
    const start = Date.now();
    const model = buildModel(clientFor(key), modelName, maxTokens, 0.2);
    const result = await model.generateContent([prompt, ...imageParts]);
    return toResult(result.response.text(), result.response.usageMetadata, modelName, Date.now() - start, "Gemini Vision");
  });
}

module.exports = { callGemini, callGeminiVision };

// Standalone smoke test:  node ai/geminiClient.js
if (require.main === module) {
  smokeTest(callGemini, "callGemini");
}
