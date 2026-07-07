// ai/codePrompt.js
// Prompt for on-demand, FULL code generation for a single accepted suggestion.
// Unlike buildSuggestionsPrompt (which spreads a token budget across 20-25
// items, keeping each patch short), this focuses the whole budget on one
// finding to produce a complete, copy-paste-ready implementation.

function buildCodePrompt(item) {
  const existing = item.codePatch ? JSON.stringify(item.codePatch, null, 2) : "none";

  return `You are a senior Shopify theme developer implementing a fix in the Dawn theme.
Produce a COMPLETE, production-ready code patch for the single finding below —
not a fragment. Include the full section/snippet block or the complete CSS/JS
needed, sensible comments, and any settings_schema additions. It must be
copy-paste ready for a developer.

=== FINDING ===
title:            ${item.title}
category:         ${item.category}
affected page:    ${item.affectedPage}
issue:            ${item.issue || item.problem}
recommendation:   ${item.recommendation || item.suggestion}
impact:           ${item.impactEstimate || "n/a"}

Existing short patch (expand and complete it, keep its intent):
${existing}

=== RULES ===
- Write real, syntactically valid Dawn-theme Liquid / CSS / JS.
- Prefer a complete block over a snippet; show enough surrounding context that a
  developer knows exactly what to paste and where.
- If the change is genuinely non-code (strategy/content), return type "manual"
  with code null and thorough instructions.

Return ONLY valid JSON, no markdown fences, no prose outside the JSON:
{
  "type": "liquid|css|js|manual",
  "file": "path within a Dawn theme (e.g. sections/main-product.liquid)",
  "code": "the full code as a JSON-escaped string, or null for manual",
  "instructions": "exact placement/replacement steps and any schema changes",
  "notes": "edge cases, how to test, and how to roll back"
}`;
}

module.exports = { buildCodePrompt };
