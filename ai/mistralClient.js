// ai/mistralClient.js
// Mistral is OpenAI-compatible, so we reuse the openai SDK with Mistral's
// base URL. Mirrors groqClient.js — same { content, meta } return shape.
const OpenAI = require("openai");
const { parseJsonLoose } = require("./parseJson");

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY is not set");
    client = new OpenAI({ apiKey, baseURL: "https://api.mistral.ai/v1" });
  }
  return client;
}

async function callMistral(prompt, maxTokens = 6000) {
  const mistral = getClient();
  const model = process.env.MISTRAL_MODEL || "mistral-small-latest";
  const start = Date.now();

  const response = await mistral.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - start;
  const usage = response.usage || {};
  console.log(
    `[Mistral] model=${model} responseTimeMs=${elapsed} tokens=${usage.total_tokens || "?"}`
  );

  return {
    content: parseJsonLoose(response.choices[0].message.content),
    meta: {
      model,
      tokensUsed: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
      processingTimeMs: elapsed,
    },
  };
}

module.exports = { callMistral };

// Standalone smoke test:  node ai/mistralClient.js
if (require.main === module) {
  require("dotenv").config();
  callMistral(`Return ONLY valid JSON matching: { "status": "ok" }`, 100)
    .then(({ content, meta }) => {
      console.log("Parsed content:", content);
      console.log("Meta:", meta);
    })
    .catch((err) => {
      console.error("callMistral test failed:", err.message);
      process.exitCode = 1;
    });
}
