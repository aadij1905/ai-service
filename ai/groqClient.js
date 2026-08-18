// ai/groqClient.js
const { makeOpenAICompatClient } = require("./openAICompatClient");

const callGroq = makeOpenAICompatClient({
  label: "Groq",
  apiKeyEnv: "GROQ_API_KEY",
  baseURL: "https://api.groq.com/openai/v1",
  modelEnv: "GROQ_MODEL",
  defaultModel: "llama-3.3-70b-versatile",
});

module.exports = { callGroq };
