// ai/prompts.js

function buildSuggestionsPrompt(reportData, flags, crawlerRan, mode, { imagesAttached = false, pages = [] } = {}) {
  const crawlerContext = crawlerRan
    ? "The Playwright crawler has run. CTA position, social proof, and scroll depth are available in the pages data where crawlerEnriched is true. You may use confidence: 'high' for layout and CTA findings where crawler data confirms them."
    : "The Playwright crawler has NOT run. CTA position, social proof, and scroll depth are null for all pages. Do not infer or fabricate these. For suggestions about layout or CTA placement, cap confidence at 'medium' and phrase as inferred patterns, not confirmed facts.";

  const screenshotSection = imagesAttached
    ? `- SCREENSHOTS (attached directly below this prompt, in this order):
${pages.map((p, i) => `  Image ${i + 1}: ${p.path} (${p.sessions} sessions)`).join("\n")}
  Look at these yourself for visual issues — low contrast, broken or blank
  pages, cluttered/competing layout, CTA not visible without scrolling,
  missing trust signals near the CTA — the same way a human reviewer would.
  When a finding comes from a screenshot, set "affectedPage" to that exact
  image's page path and mention the screenshot in "dataSource". Set
  confidence "high" for anything directly visible. Do not describe
  anything you cannot actually see in the image — no invented details.`
    : `- VISUAL: no screenshots are available for this run (crawler didn't run,
  or no pages were successfully captured). Do not invent visual/layout
  findings — base everything on the numeric data below.`;

  const modeInstructions = mode === "quick"
    ? `MODE: QUICK — Return exactly 3 items.
Pick the 3 highest-severity, highest-confidence issues only (severity: 3 flags
with dataQuality: "real" first). Each must include a ready-to-paste Liquid or
CSS code patch. Do not pad with medium- or low-confidence findings.`
    : `MODE: COMPREHENSIVE — Return between 20 and 25 items.
Cover all severity-3 flags first, then severity-2, then broader CRO patterns
across traffic, funnel, device, and performance. Every item needs a code patch
or an explicit "manual" codePatch where code does not apply.`;

  return `You are a senior Shopify CRO and theme development consultant.
Each finding you produce serves two audiences simultaneously:
  1. A business owner / PM (non-technical) — they read "problem" and "suggestion"
  2. A Shopify developer — they read "issue", "recommendation", and "codePatch"

You must populate ALL fields for both audiences in every item.

${modeInstructions}

=== DATA AVAILABILITY — READ BEFORE WRITING SUGGESTIONS ===

REAL (measured, use freely, confidence can be "high"):
- overview.conversionRate, bounceRate, cartAbandonmentRate
- funnel.detailedStages — real multi-stage funnel
  (sessions → cart additions → reached checkout → completed checkout)
- traffic[].conversionRate and bounceRate — real per referrer source
- pages[].conversionRate, bounceRate — real per landing page
- pages[].lcp_p75_ms, p75_cls, inp_p75_ms — real Core Web Vitals per page
  (LCP good ≤2500ms, needs_improvement ≤4000ms, poor >4000ms)
  (CLS good ≤0.1, needs_improvement ≤0.25, poor >0.25)
  (INP good ≤200ms, needs_improvement ≤500ms, poor >500ms)
- layout[] — crawler-visited pages ONLY. Each entry has:
  ctaText, ctaAboveFoldDesktop (bool), ctaAboveFoldMobile (bool),
  hasSocialProof (bool), scrollDepth (0-1 estimate).
  Present only when the crawler ran; absent when it did not.
${screenshotSection}

NOT AVAILABLE (null, do not cite or infer):
- devices[].conversionRate — NOT in ShopifyQL device grouping
- devices[].bounceRate — NOT in ShopifyQL device grouping
- overview.avgPageLoadTime — no single field; use per-page CWV instead

For device suggestions, you may observe that a high session percentage is
mobile (devices.mobile.percentage) but you cannot state mobile converts
worse than desktop — that data does not exist. Frame device suggestions as
exposure risk, not confirmed gap.

${crawlerContext}

=== REPORT DATA ===
${JSON.stringify(reportData, null, 2)}

=== DETECTED FLAGS (dataQuality: "real" = directly measured from ShopifyQL) ===
${JSON.stringify(flags, null, 2)}

=== INSTRUCTIONS ===

1. Start with flags that have dataQuality: "real" and severity: 3 —
   these are your highest-confidence, highest-priority starting points.
2. For each suggestion, write actual syntactically valid Liquid/CSS for
   the Shopify Dawn theme where code can address the issue. For strategy/
   content/traffic suggestions, use codePatch.type: "manual", code: null.
3. Do not force a code patch where none naturally applies.
4. Every issue field must cite actual numbers from the input data.
5. Confidence rules:
   - "high": directly supported by real ShopifyQL numbers
             (conversion, bounce, funnel stages, CWV values), OR by
             something directly visible in an attached screenshot
   - "medium": inferred from patterns, layout/CTA without crawler,
               mobile risk without per-device conversion data
   - "low": speculative recommendations
6. "affectedPage" MUST be one real page path taken from pages[]/layout[]
   above (e.g. "/", "/collections/all", "/products/foo") — NEVER a
   description like "All pages", "site-wide", or "All product pages", even
   for a genuinely site-wide finding. Pick the single highest-traffic real
   page it's most visible on. Downstream tooling uses this value to fetch
   that exact page's real theme code — a non-path value breaks that lookup.
7. Do not emit two items with essentially the same recommendation — if a
   finding would repeat, fold it into one item and cite both data points.

Return ONLY valid JSON, no markdown fences, no prose outside the JSON:
{
  "items": [
    {
      "id": "string",
      "rank": 1,
      "category": "conversion|traffic|mobile|performance|content|trust|funnel",
      "title": "string",

      "problem": "1-2 sentences in plain English for a non-technical business owner. Cite real numbers. No code, no jargon.",
      "suggestion": "1 sentence plain-English action the owner can request. No code or technical terms. Example: 'Add a sticky Add to Cart button so shoppers can buy without scrolling back up.'",

      "issue": "Technical version of the problem for a developer. Cite actual numbers from the data.",
      "recommendation": "Specific technical action for a developer to implement.",
      "affectedPage": "string",
      "impactEstimate": "string",
      "effort": "low|medium|high",
      "confidence": "high|medium|low",
      "dataSource": "string — which fields",
      "codePatch": {
        "type": "liquid|css|manual",
        "code": "string or null",
        "file": "string or null",
        "instructions": "string or null"
      }
    }
  ]
}`;
}

module.exports = { buildSuggestionsPrompt };
