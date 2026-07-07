// ai/cerebrasClient.js
// Cerebras is OpenAI-compatible (very fast inference). Reuses the openai SDK
// with Cerebras's base URL. Mirrors groqClient.js — same { content, meta } shape.
const OpenAI = require("openai");
const { parseJsonLoose } = require("./parseJson");

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) throw new Error("CEREBRAS_API_KEY is not set");
    client = new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1" });
  }
  return client;
}

async function callCerebras(prompt, maxTokens = 6000) {
  const cerebras = getClient();
  const model = process.env.CEREBRAS_MODEL || "llama-3.3-70b";
  const start = Date.now();

  const response = await cerebras.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - start;
  const usage = response.usage || {};
  console.log(
    `[Cerebras] model=${model} responseTimeMs=${elapsed} tokens=${usage.total_tokens || "?"}`
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

module.exports = { callCerebras };

// Standalone smoke test:  node ai/cerebrasClient.js
if (require.main === module) {
  require("dotenv").config();
  callCerebras(`Return ONLY valid JSON matching: { "status": "ok" }`, 100)
    .then(({ content, meta }) => {
      console.log("Parsed content:", content);
      console.log("Meta:", meta);
    })
    .catch((err) => {
      console.error("callCerebras test failed:", err.message);
      process.exitCode = 1;
    });
}
