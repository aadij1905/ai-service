// ai/llm.js
// Single entry point for suggestion generation. Picks the provider from
// AI_PROVIDER (groq | gemini | mistral) so the rest of the pipeline stays
// provider-agnostic. All clients share the { content, meta } return shape.
//
// Providers are required lazily so that a missing optional SDK (e.g.
// @google/generative-ai for gemini) never breaks the service unless that
// provider is actually selected.

const LOADERS = {
  groq: () => require("./groqClient").callGroq,
  gemini: () => require("./geminiClient").callGemini,
  mistral: () => require("./mistralClient").callMistral,
  cerebras: () => require("./cerebrasClient").callCerebras,
};

function resolveProvider() {
  const name = (process.env.AI_PROVIDER || "groq").toLowerCase();
  const load = LOADERS[name];
  if (!load) {
    throw new Error(
      `Unknown AI_PROVIDER "${name}". Use one of: ${Object.keys(LOADERS).join(", ")}`
    );
  }
  return { name, call: load() };
}

// Get a specific provider's call function by name (used by the orchestrator).
function getCaller(name) {
  const load = LOADERS[(name || "").toLowerCase()];
  if (!load) {
    throw new Error(
      `Unknown provider "${name}". Use one of: ${Object.keys(LOADERS).join(", ")}`
    );
  }
  return load();
}

async function callLLM(prompt, maxTokens) {
  const { name, call } = resolveProvider();
  console.log(`[LLM] provider=${name}`);
  return call(prompt, maxTokens);
}

module.exports = { callLLM, getCaller, PROVIDERS: Object.keys(LOADERS) };
