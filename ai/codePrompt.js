// ai/codePrompt.js
// Prompt for on-demand, FULL code generation for a single accepted suggestion.
// Unlike buildSuggestionsPrompt (which spreads a token budget across 20-25
// items, keeping each patch short), this focuses the whole budget on one
// finding to produce a complete, copy-paste-ready implementation.

// themeCode, when present, is the result of shopify-pp's theme extractor:
// { themeName, template, templateSuffix, files: [{ key, bytes, content }], truncated }
function buildCodePrompt(item, themeCode) {
  const existing = item.codePatch ? JSON.stringify(item.codePatch, null, 2) : "none";

  const findingBlock = `=== FINDING ===
title:            ${item.title}
category:         ${item.category}
affected page:    ${item.affectedPage}
issue:            ${item.issue || item.problem}
recommendation:   ${item.recommendation || item.suggestion}
impact:           ${item.impactEstimate || "n/a"}

Existing short patch (expand and complete it, keep its intent):
${existing}`;

  if (themeCode && Array.isArray(themeCode.files) && themeCode.files.length > 0) {
    const filesBlock = themeCode.files
      .map((f) => `--- ${f.key} ---\n${f.content}`)
      .join("\n\n");

    return `You are a senior Shopify theme developer implementing a fix in the
"${themeCode.themeName}" theme actually installed on this store (template:
${themeCode.template}${themeCode.templateSuffix ? ` / ${themeCode.templateSuffix}` : ""}).

${findingBlock}

NOTE: the existing short patch's "file" value (if any) was guessed BEFORE
real theme code was available and is very likely wrong — do not reuse it.
Only reuse its technical intent (what the fix should do); the actual file
you target MUST come from ACTUAL THEME FILES FOR THIS PAGE below.

=== ACTUAL THEME FILES FOR THIS PAGE ===
${filesBlock}
${themeCode.truncated ? "\n(Note: some file content was truncated by the extractor.)" : ""}

=== HOW TO WRITE THE PATCH ===
Do NOT reproduce the whole file. Files like layout/theme.liquid are hundreds
of lines long, and past attempts at echoing the full file back have silently
dropped unrelated lines (e.g. font-face declarations, unrelated CSS rules),
which is worse than a small, surgical patch.

Instead:
- "code" is ONLY the new or changed lines — a small, complete, self-contained
  block. It must be fully valid on its own (no truncation, no "..." ellipses,
  no partial rules/statements, no dangling braces).
- "instructions" MUST pinpoint the exact location using an anchor: quote one
  or more EXISTING lines VERBATIM, copied exactly from the file content shown
  above, and state precisely "insert after this line: ...", "insert before
  this line: ...", or "replace this exact block: ... with the new code above".
  The anchor text must be an exact substring of the file as shown so a
  developer (or a script) can locate it with a plain string search — do not
  paraphrase or reformat it.
- If the fix requires edits in more than one place, describe each as its own
  numbered step in "instructions", each with its own verbatim anchor line(s).
- The patch MUST target one of the exact files listed above — set "file" to
  that file's path verbatim (e.g. "${themeCode.files[0].key}"). Do not invent
  a filename or assume a different theme (e.g. Dawn) if it isn't the one shown.
- Write real, syntactically valid Liquid / CSS / JS consistent with the
  existing file's structure and conventions.
- If the change is genuinely non-code (strategy/content), return type "manual"
  with code null and thorough instructions.

Return ONLY a single valid JSON object — NOT an array, NOT wrapped in a
list, no markdown fences, no prose outside the JSON:
{
  "type": "liquid|css|js|manual",
  "file": "the exact file key from the list above",
  "code": "ONLY the new/changed lines, complete and self-contained — a JSON-escaped string, or null for manual",
  "instructions": "numbered steps, each quoting a verbatim anchor line from the file and where the code above goes relative to it",
  "notes": "edge cases, how to test, and how to roll back",
  "pageImpact": "1-2 plain-English sentences: what a visitor to ${item.affectedPage} will experience differently once this patch is live. No code, no file names — this is for a PM/developer glancing at the page, not implementing it."
}`;
  }

  return `You are a senior Shopify theme developer. The store's real theme code
was not available (extractor unreachable or shop not installed), so assume a
Dawn theme as a best-effort baseline.
Produce a COMPLETE, production-ready code patch for the single finding below —
not a fragment. Include the full section/snippet block or the complete CSS/JS
needed, sensible comments, and any settings_schema additions. It must be
copy-paste ready for a developer.

${findingBlock}

=== RULES ===
- Write real, syntactically valid Dawn-theme Liquid / CSS / JS.
- Prefer a complete block over a snippet; show enough surrounding context that a
  developer knows exactly what to paste and where.
- If the change is genuinely non-code (strategy/content), return type "manual"
  with code null and thorough instructions.
- Because this is a best-effort guess (no real theme code was available), the
  "notes" field MUST flag that the file/theme assumption should be verified
  against the store's actual theme before merging.

Return ONLY a single valid JSON object — NOT an array, NOT wrapped in a
list, no markdown fences, no prose outside the JSON:
{
  "type": "liquid|css|js|manual",
  "file": "path within a Dawn theme (e.g. sections/main-product.liquid)",
  "code": "the full code as a JSON-escaped string, or null for manual",
  "instructions": "exact placement/replacement steps and any schema changes",
  "notes": "edge cases, how to test, how to roll back, and the best-effort caveat above",
  "pageImpact": "1-2 plain-English sentences: what a visitor to ${item.affectedPage} will experience differently once this patch is live. No code, no file names — this is for a PM/developer glancing at the page, not implementing it."
}`;
}

// Prompt for the (separate, best-effort) vision call that describes what a
// viewer would see change in the page's current live screenshot once
// codePatch is applied. Kept independent of buildCodePrompt so a failure or
// slow response here never blocks or alters the actual code patch.
function buildVisualChangeNotePrompt(item, codePatch) {
  return `You are shown the CURRENT live screenshot(s) of a Shopify storefront
page (desktop, and mobile if a second image is provided).

A code change is about to be applied:
finding:      ${item.title}
file:         ${codePatch.file || "n/a"}
how to apply: ${codePatch.instructions || "n/a"}
new/changed code:
${codePatch.code || "(manual change, no code)"}

In 1-2 sentences, describe specifically what a viewer would see CHANGE in
THIS screenshot once the patch is applied. Reference the actual visible
element (its position on the page, current color/text/size) so a
non-technical reviewer can picture the before/after without reading code.
If you cannot tell from the screenshot(s) where this element is, say so
plainly instead of guessing.

Return ONLY a single valid JSON object — NOT an array, NOT wrapped in a
list, no markdown fences, no prose outside the JSON:
{ "visualChangeNote": "1-2 sentences describing the visible before/after" }`;
}

module.exports = { buildCodePrompt, buildVisualChangeNotePrompt };
