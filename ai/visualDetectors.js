// ai/visualDetectors.js
// Phase 3: ground flaw detection in what a page actually looks like, instead
// of inferring UI problems purely from ShopifyQL numbers. Runs a vision model
// against each crawler-visited page's screenshot(s) and returns flags in the
// same shape detectors.js's rule-based flags use, tagged dataQuality:
// "visual" so the suggestions prompt (and the UI) can tell them apart from
// numeric-only findings.
const { callGeminiVision } = require("./geminiClient");

function buildVisualPrompt(page) {
  return `You are a conversion-rate-optimization and accessibility auditor
reviewing real screenshot(s) of a live Shopify storefront page.

Page: ${page.path}
Sessions (last period): ${page.sessions}
CTA text detected by crawler: ${page.ctaText || "none detected"}
Has social proof (crawler-detected): ${page.hasSocialProof}

You are given one or two images: the first is the desktop viewport, the
second (if present) is the mobile viewport. Identify concrete VISUAL flaws
you can actually SEE in the image(s) — e.g. low-contrast buttons or text,
a CTA that isn't visible without scrolling, cluttered or competing elements,
broken or missing images, a layout that looks broken, missing trust signals
near the CTA. Only report what is visibly present in the screenshot(s) — do
not invent anything you cannot see, and do not restate numeric data you were
not shown an image of.

If nothing visually stands out, return an empty "flaws" array — do not
manufacture a finding to fill space.

Return ONLY valid JSON, no markdown fences, no prose outside the JSON:
{
  "flaws": [
    {
      "description": "specific, visual, 1-2 sentences — cite what you see",
      "severity": 1|2|3,
      "element": "short label for the flagged element, e.g. 'Add to Cart button'"
    }
  ]
}`;
}

async function detectPageVisualFlaws(page) {
  const imageUrls = [page.screenshotUrl, page.mobileScreenshotUrl].filter(Boolean);
  if (imageUrls.length === 0) return [];

  try {
    const { content } = await callGeminiVision(buildVisualPrompt(page), imageUrls, 1500);
    const flaws = Array.isArray(content.flaws) ? content.flaws : [];
    return flaws.map((f) => ({
      type: "visual_flaw",
      path: page.path,
      description: f.description,
      severity: [1, 2, 3].includes(f.severity) ? f.severity : 2,
      dataQuality: "visual",
      source: "screenshot_analysis",
    }));
  } catch (err) {
    console.error(`[visualDetectors] failed for ${page.path}:`, err.message);
    return []; // best-effort — one page's failure doesn't kill the report
  }
}

// Runs vision analysis across every crawler-visited page with a screenshot,
// in parallel. Best-effort: returns [] rather than throwing if nothing
// qualifies, so callers never need to special-case "no crawler data".
async function detectVisualFlaws(normalized, { cap = Infinity } = {}) {
  const pages = (normalized.pages || [])
    .filter((p) => p.crawlerEnriched && (p.screenshotUrl || p.mobileScreenshotUrl))
    .sort((a, b) => (b.sessions || 0) - (a.sessions || 0)) // highest-traffic first
    .slice(0, cap);
  if (pages.length === 0) return [];

  const results = await Promise.all(pages.map(detectPageVisualFlaws));
  return results.flat();
}

module.exports = { detectVisualFlaws };
