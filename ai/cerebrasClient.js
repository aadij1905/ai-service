// ai/cerebrasClient.js
// Cerebras is OpenAI-compatible (very fast inference). Reuses the openai SDK
// with Cerebras's base URL via openAICompatClient.js.
const { makeOpenAICompatClient } = require("./openAICompatClient");
const { smokeTest } = require("./smokeTest");

const callCerebras = makeOpenAICompatClient({
  label: "Cerebras",
  apiKeyEnv: "CEREBRAS_API_KEY",
  baseURL: "https://api.cerebras.ai/v1",
  modelEnv: "CEREBRAS_MODEL",
  defaultModel: "llama-3.3-70b",
});

module.exports = { callCerebras };

// Standalone smoke test:  node ai/cerebrasClient.js
if (require.main === module) {
  smokeTest(callCerebras, "callCerebras");
}
