const express = require("express");
const router = express.Router();
const { getCaller } = require("../ai/llm");
const { buildCodePrompt, buildVisualChangeNotePrompt } = require("../ai/codePrompt");
const { callGeminiVision } = require("../ai/geminiClient");
const { unwrapSingleObject } = require("../ai/parseJson");

// Full-code generation uses its own model (Gemini by default — strong at code),
// independent of AI_PROVIDER which drives suggestion generation.
const CODE_PROVIDER = process.env.CODE_PROVIDER || "gemini";

const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "http://localhost:3000";
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || "http://localhost:4000";

// A real Shopify route always starts with "/". Suggestions about a
// site-wide metric (e.g. "Overall conversion rate below benchmarks") often
// carry a description instead — "All pages", "site-wide", "All product
// pages". Sending those to the extractor as a "page" isn't a real request
// it can resolve, and it was observed to fall back to dumping every
// template it has (33 files / ~250K chars, vs. ~19 for a real page) —
// nearly tripling prompt size and contributing to an OOM crash. Skip the
// extractor entirely for these; the Dawn-fallback prompt already handles
// "no real theme code available" cleanly.
function looksLikeRealPage(page) {
  return typeof page === "string" && page.startsWith("/");
}

// Hard cap on total theme file content sent into the prompt, independent of
// why a response might be oversized — defense in depth beyond the
// looksLikeRealPage check above, in case the extractor ever returns an
// unexpectedly large file set for a legitimate single page.
const MAX_THEME_CHARS = 150000;

// Best-effort: pull the real theme files that render `page` for `shop` from
// shopify-pp's extractor. Returns null (never throws) if the shop isn't
// installed, `page` isn't a real path, the extractor is unreachable, or it
// errors — callers should fall back to a generic prompt rather than fail
// the whole request.
async function fetchThemeCode(shop, page) {
  if (!shop || !looksLikeRealPage(page)) return null;
  try {
    const qs = new URLSearchParams({ shop, page });
    const res = await fetch(`${SHOPIFY_APP_URL}/api/debug/theme-code?${qs.toString()}`);
    if (!res.ok) return null;
    const themeCode = await res.json(); // { themeName, template, templateSuffix, files[], truncated }

    let total = 0;
    const capped = [];
    for (const f of themeCode.files || []) {
      total += (f.content || "").length;
      if (total > MAX_THEME_CHARS) break;
      capped.push(f);
    }
    if (capped.length < (themeCode.files || []).length) {
      console.warn(`[code/generate] theme file set for "${page}" exceeded ${MAX_THEME_CHARS} chars — capped ${themeCode.files.length} files down to ${capped.length}`);
    }
    return { ...themeCode, files: capped };
  } catch {
    return null;
  }
}

// Best-effort: find the crawler's screenshot(s) of the affected page, so a
// developer can see the live "before" alongside the generated patch. Returns
// null if the page wasn't crawled or has no screenshot.
async function fetchPageScreenshot(shop, affectedPage) {
  if (!shop || !affectedPage) return null;
  try {
    const qs = new URLSearchParams({ storeId: shop });
    const res = await fetch(`${ANALYTICS_SERVICE_URL}/api/analytics/pages?${qs.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const page = (data.pages || []).find((p) => p.path === affectedPage);
    if (!page || !page.crawlerEnriched) return null;
    if (!page.screenshotUrl && !page.mobileScreenshotUrl) return null;
    return { url: page.screenshotUrl || null, mobileUrl: page.mobileScreenshotUrl || null };
  } catch {
    return null;
  }
}

// Best-effort: ask Gemini Vision what will visibly change in the live
// screenshot once codePatch is applied. Independent of the code-generation
// call itself — a failure here never blocks or alters the actual patch.
async function fetchVisualChangeNote(item, codePatch, screenshot) {
  if (!screenshot || codePatch.type === "manual" || !codePatch.code) return null;
  const imageUrls = [screenshot.url, screenshot.mobileUrl].filter(Boolean);
  if (imageUrls.length === 0) return null;
  try {
    const { content } = await callGeminiVision(
      buildVisualChangeNotePrompt(item, codePatch),
      imageUrls,
      400,
      "code" // demo: draws from the code-generation key pool, not suggestions'
    );
    return unwrapSingleObject(content).visualChangeNote || null;
  } catch (err) {
    console.error(`[code/generate] visual change note failed:`, err.message);
    return null;
  }
}

// POST /code/generate — full, focused code patch for a single suggestion.
// Body: { item: { title, category, affectedPage, issue, recommendation, codePatch, ... }, storeId }
router.post("/code/generate", async (req, res) => {
  const item = req.body && req.body.item;
  const storeId = req.body && req.body.storeId;
  if (!item || !item.title) {
    return res.status(400).json({ error: "item (with at least a title) is required" });
  }

  try {
    const [themeCode, screenshot] = await Promise.all([
      fetchThemeCode(storeId, item.affectedPage),
      fetchPageScreenshot(storeId, item.affectedPage),
    ]);
    console.log(
      `[code/generate] provider=${CODE_PROVIDER} item="${item.title}" themeCode=${themeCode ? "yes" : "no"} screenshot=${screenshot ? "yes" : "no"}`
    );
    // 3rd arg ("code") is only meaningful to callGemini's key-pool rotation —
    // other providers' call functions simply ignore an extra argument.
    const { content, meta } = await getCaller(CODE_PROVIDER)(buildCodePrompt(item, themeCode), 8000, "code");
    const patchContent = unwrapSingleObject(content);
    const codePatch = {
      type: patchContent.type || "manual",
      file: patchContent.file || item.affectedPage || null,
      code: patchContent.code || null,
      instructions: patchContent.instructions || null,
      notes: patchContent.notes || null,
      pageImpact: patchContent.pageImpact || null,
    };
    const visualChangeNote = await fetchVisualChangeNote(item, codePatch, screenshot);
    res.json({ codePatch, affectedPage: item.affectedPage || null, screenshot, visualChangeNote, meta });
  } catch (err) {
    res.status(500).json({ error: `Code generation failed: ${err.message}` });
  }
});

module.exports = router;
