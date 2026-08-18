// ai/openAICompatClient.js
// Shared implementation for OpenAI-compatible providers (Groq, Cerebras,
// Mistral): identical request/response shape, only base URL, API key env
// var, and default model differ.
const OpenAI = require("openai");
const { parseJsonLoose } = require("./parseJson");

function makeOpenAICompatClient({ label, apiKeyEnv, baseURL, modelEnv, defaultModel }) {
  let client = null;
  function getClient() {
    if (!client) {
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) throw new Error(`${apiKeyEnv} is not set`);
      client = new OpenAI({ apiKey, baseURL });
    }
    return client;
  }

  return async function call(prompt, maxTokens = 6000) {
    const openai = getClient();
    const model = process.env[modelEnv] || defaultModel;
    const start = Date.now();

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    });

    const elapsed = Date.now() - start;
    const usage = response.usage || {};
    console.log(`[${label}] model=${model} responseTimeMs=${elapsed} tokens=${usage.total_tokens || "?"}`);

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
  };
}

module.exports = { makeOpenAICompatClient };
