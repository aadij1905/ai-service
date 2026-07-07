// ai/groqClient.js
const OpenAI = require("openai");
const { parseJsonLoose } = require("./parseJson");

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  }
  return client;
}

async function callGroq(prompt, maxTokens = 6000) {
  const groqClient = getClient();
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const start = Date.now();

  const response = await groqClient.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - start;
  const usage = response.usage;
  console.log(`[Groq] model=${model} responseTimeMs=${elapsed} tokens=${usage.total_tokens}`);

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

module.exports = { callGroq };
