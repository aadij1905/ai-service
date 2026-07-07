// ai/parseJson.js
// Tolerant JSON parsing for LLM output. Handles markdown code fences, stray
// prose around the object, and trailing commas — things models occasionally
// emit even in JSON mode. Truncated output (hit the token cap) still can't be
// recovered; that needs a larger max_tokens.

function parseJsonLoose(text) {
  if (text == null) throw new Error("empty LLM response");
  if (typeof text !== "string") return text;

  let s = text.trim();

  // strip ```json ... ``` fences
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }

  try {
    return JSON.parse(s);
  } catch (e) {
    // fall back to the outermost {...} and drop trailing commas
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first !== -1 && last > first) {
      const sub = s.slice(first, last + 1).replace(/,(\s*[}\]])/g, "$1");
      return JSON.parse(sub);
    }
    throw e;
  }
}

module.exports = { parseJsonLoose };
