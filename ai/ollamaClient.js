// ai/ollamaClient.js
// Local model via Ollama (no API key, no network): `ollama pull llama3.2:3b`.
// Ollama's default context is small; start it with OLLAMA_CONTEXT_LENGTH=16384
// so the ~5K-token suggestions prompt isn't silently truncated.
const { makeOpenAICompatClient } = require("./openAICompatClient");

process.env.OLLAMA_API_KEY ||= "ollama"; // the OpenAI SDK requires some key; Ollama ignores it

const callOllama = makeOpenAICompatClient({
  label: "Ollama",
  apiKeyEnv: "OLLAMA_API_KEY",
  baseURL: process.env.OLLAMA_URL || "http://localhost:11434/v1",
  modelEnv: "OLLAMA_MODEL",
  defaultModel: "llama3.2:3b",
});

module.exports = { callOllama };
