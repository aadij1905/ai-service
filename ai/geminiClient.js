// ai/geminiClient.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { parseJsonLoose } = require("./parseJson");

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

async function callGemini(prompt, maxTokens = 6000) {
  const genAI = getClient();
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const start = Date.now();

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json", // forces JSON output, Gemini's equivalent of json_object
      // gemini-2.5-flash spends part of maxOutputTokens on internal "thinking"
      // tokens by default, which can truncate the visible JSON before it
      // completes. Disabling it keeps the full budget for actual output.
      // Not in the SDK's TS types but forwarded as-is to the REST API.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  const elapsed = Date.now() - start;
  const usage = result.response.usageMetadata;
  console.log(`[Gemini] model=${modelName} responseTimeMs=${elapsed} tokens=${usage.totalTokenCount}`);

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

module.exports = { callGemini };

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
