// ai/mistralClient.js
// Mistral is OpenAI-compatible, so we reuse the openai SDK with Mistral's
// base URL via openAICompatClient.js.
const { makeOpenAICompatClient } = require("./openAICompatClient");
const { smokeTest } = require("./smokeTest");

const callMistral = makeOpenAICompatClient({
  label: "Mistral",
  apiKeyEnv: "MISTRAL_API_KEY",
  baseURL: "https://api.mistral.ai/v1",
  modelEnv: "MISTRAL_MODEL",
  defaultModel: "mistral-small-latest",
});

module.exports = { callMistral };

// Standalone smoke test:  node ai/mistralClient.js
if (require.main === module) {
  smokeTest(callMistral, "callMistral");
}
