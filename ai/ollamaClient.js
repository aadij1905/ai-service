// ai/ollamaClient.js
// Talks to an Ollama server (local or on another machine) via its
// OpenAI-compatible endpoint. The model files live wherever Ollama runs, so
// this machine needs no disk for them.
//
// Env:
//   OLLAMA_BASE_URL  e.g. http://192.168.1.42:11434/v1  (LAN)
//                    or   https://your-tunnel.trycloudflare.com/v1
//                    default: http://localhost:11434/v1
//   OLLAMA_MODEL     e.g. qwen2.5-coder:7b  (default)
const OpenAI = require("openai");
const { parseJsonLoose } = require("./parseJson");

let client = null;
function getClient() {
  if (!client) {
    const baseURL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    // Ollama ignores the key, but the SDK requires a non-empty string.
    client = new OpenAI({ apiKey: "ollama", baseURL });
  }
  return client;
}

async function callOllama(prompt, maxTokens = 6000) {
  const ollama = getClient();
  const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  const start = Date.now();

  const response = await ollama.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" }, // honored by recent Ollama builds
  });

  const elapsed = Date.now() - start;
  const usage = response.usage || {};
  console.log(
    `[Ollama] model=${model} responseTimeMs=${elapsed} tokens=${usage.total_tokens || "?"}`
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

module.exports = { callOllama };

// Smoke test:  OLLAMA_BASE_URL=http://<pc-ip>:11434/v1 node ai/ollamaClient.js
if (require.main === module) {
  require("dotenv").config();
  callOllama(`Return ONLY valid JSON matching: { "status": "ok" }`, 100)
    .then(({ content, meta }) => {
      console.log("Parsed content:", content);
      console.log("Meta:", meta);
    })
    .catch((err) => {
      console.error("callOllama test failed:", err.message);
      process.exitCode = 1;
    });
}
