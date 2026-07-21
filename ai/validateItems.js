// ai/validateItems.js
// Post-generation guardrail. Every live path (single-call, orchestrate, vision)
// runs its raw LLM items through this before they reach the caller, so the
// model's output is repaired/filtered deterministically instead of trusted:
//
//   1. SCHEMA   — drop items missing either audience's core fields; coerce
//                 invalid enums (category/effort/confidence/codePatch.type) to
//                 safe defaults instead of leaking bad values downstream.
//   2. PAGE     — coerce affectedPage to a REAL page path. The prompt forbids
//                 "site-wide"/"All pages" because routes/code.js can only fetch
//                 theme code for a real "/..." path; here we enforce it by
//                 snapping non-paths to the highest-traffic real page.
//   3. GROUNDING— extract numbers cited in problem/issue and check they exist
//                 in the report data (± tolerance) or are known benchmarks.
//                 Ungrounded numbers downgrade a "high" confidence to "medium"
//                 and are recorded; with GROUNDING_STRICT=true the item is
//                 dropped outright.
//   4. DEDUP    — same category+page folds into one (the single-call and vision
//                 paths never dedupe on their own; orchestrate already does but
//                 re-running is idempotent).
//
// Returns { items, stats } where stats is surfaced in meta.validation so the
// hallucination/repair rate is observable per run.

const VALID_CATEGORIES = new Set([
  "conversion", "traffic", "mobile", "performance", "content", "trust", "funnel",
]);
const VALID_EFFORT = new Set(["low", "medium", "high"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_PATCH_TYPE = new Set(["liquid", "css", "manual"]);

// Legitimate industry thresholds a model may cite that are NOT in the store's
// own data — CWV cutoffs, Shopify CR benchmark band. Never flag these.
const BENCHMARKS = [1.5, 2, 2.5, 3, 0.1, 0.25, 200, 500, 2500, 4000];

const CONF_RANK = { high: 3, medium: 2, low: 1 };
const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

// ── grounding helpers ──────────────────────────────────────────────────────

function collectNumbers(node, out) {
  if (node == null) return;
  if (typeof node === "number" && Number.isFinite(node)) {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectNumbers(v, out);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node)) collectNumbers(v, out);
  }
}

// Every value in the report, plus the forms a model commonly renders it in:
// a rate 0.0234 shows up as "2.34%" (×100) and rounded ("2.3"). Building the
// allowed set generously keeps grounding from flagging correctly-reformatted
// numbers as fabricated.
function buildAllowedNumbers(report) {
  const raw = [];
  collectNumbers(report, raw);
  const allowed = [];
  for (const n of raw) {
    allowed.push(n, Math.round(n), Math.round(n * 100) / 100);
    allowed.push(n * 100, Math.round(n * 100), Math.round(n * 10000) / 100);
  }
  for (const b of BENCHMARKS) allowed.push(b);
  return allowed;
}

function isGrounded(value, allowed) {
  for (const a of allowed) {
    const tol = Math.max(0.01, Math.abs(a) * 0.02); // 2% relative or 0.01 abs
    if (Math.abs(value - a) <= tol) return true;
  }
  return false;
}

// Numbers a human would read as data claims. Skip 4-digit years and bare
// single digits inside ranked lists to cut false positives.
function citedNumbers(text) {
  if (!isNonEmpty(text)) return [];
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return matches
    .map((m) => parseFloat(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

function ungroundedNumbers(item, allowed) {
  const cited = [
    ...citedNumbers(item.problem),
    ...citedNumbers(item.issue),
  ];
  return cited.filter((n) => !isGrounded(n, allowed));
}

// ── page coercion ──────────────────────────────────────────────────────────

function buildPageContext(normalized, report) {
  const pages = (normalized && normalized.pages) || [];
  const valid = new Set();
  for (const p of pages) if (isNonEmpty(p.path) && p.path.startsWith("/")) valid.add(p.path);
  // report.performance/layout paths are derived from the same pages, but add
  // them too in case normalized was reshaped upstream.
  for (const p of (report && report.performance) || []) if (isNonEmpty(p.path)) valid.add(p.path);
  for (const p of (report && report.layout) || []) if (isNonEmpty(p.path)) valid.add(p.path);

  // Repair target: the highest-traffic real page (what the prompt tells the
  // model to pick for a site-wide finding anyway).
  let fallback = "/";
  let best = -1;
  for (const p of pages) {
    if (isNonEmpty(p.path) && p.path.startsWith("/") && (p.sessions || 0) > best) {
      best = p.sessions || 0;
      fallback = p.path;
    }
  }
  if (valid.size === 0) valid.add("/");
  return { valid, fallback };
}

// ── main ───────────────────────────────────────────────────────────────────

function validateItems(rawItems, { report, normalized, mode, strict } = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const allowed = buildAllowedNumbers(report || {});
  const { valid: validPaths, fallback: fallbackPage } = buildPageContext(normalized, report);
  const strictGrounding = strict != null ? strict : process.env.GROUNDING_STRICT === "true";

  const stats = {
    received: items.length,
    droppedMissingFields: 0,
    droppedUngrounded: 0,
    coercedEnums: 0,
    coercedPages: 0,
    confidenceDowngrades: 0,
    duplicatesFolded: 0,
  };

  const cleaned = [];
  for (const raw of items) {
    const item = { ...raw };

    // 1. schema — both audiences must be fully served, else the item is useless
    if (
      !isNonEmpty(item.title) ||
      !isNonEmpty(item.problem) ||
      !isNonEmpty(item.suggestion) ||
      !isNonEmpty(item.issue) ||
      !isNonEmpty(item.recommendation)
    ) {
      stats.droppedMissingFields += 1;
      continue;
    }

    // enum coercion (repair, don't drop)
    if (!VALID_CATEGORIES.has(item.category)) { item.category = "conversion"; stats.coercedEnums += 1; }
    if (!VALID_EFFORT.has(item.effort)) { item.effort = "medium"; stats.coercedEnums += 1; }
    if (!VALID_CONFIDENCE.has(item.confidence)) { item.confidence = "medium"; stats.coercedEnums += 1; }
    if (!item.codePatch || typeof item.codePatch !== "object") {
      item.codePatch = { type: "manual", code: null, file: null, instructions: null };
      stats.coercedEnums += 1;
    } else if (!VALID_PATCH_TYPE.has(item.codePatch.type)) {
      item.codePatch = { ...item.codePatch, type: "manual" };
      stats.coercedEnums += 1;
    }

    // 2. affectedPage must be a real path so routes/code.js can resolve theme code
    if (!isNonEmpty(item.affectedPage) || !item.affectedPage.startsWith("/") || !validPaths.has(item.affectedPage)) {
      item.affectedPage = fallbackPage;
      stats.coercedPages += 1;
    }

    // 3. grounding
    const ungrounded = ungroundedNumbers(item, allowed);
    if (ungrounded.length > 0) {
      if (strictGrounding) {
        stats.droppedUngrounded += 1;
        continue;
      }
      item._ungroundedNumbers = ungrounded;
      if (item.confidence === "high") {
        item.confidence = "medium";
        stats.confidenceDowngrades += 1;
      }
    }

    cleaned.push(item);
  }

  // 4. dedupe by category+page, keeping the higher-confidence representative
  const groups = new Map();
  for (const item of cleaned) {
    const page = (item.affectedPage || "/").toLowerCase().replace(/\/+$/, "");
    const fp = `${item.category}::${page}`;
    const existing = groups.get(fp);
    if (!existing) {
      groups.set(fp, item);
    } else {
      stats.duplicatesFolded += 1;
      if ((CONF_RANK[item.confidence] || 0) > (CONF_RANK[existing.confidence] || 0)) {
        groups.set(fp, item);
      }
    }
  }

  // stable ordering: confidence desc, then original order; renumber rank 1..N
  const ordered = [...groups.values()].sort(
    (a, b) => (CONF_RANK[b.confidence] || 0) - (CONF_RANK[a.confidence] || 0)
  );
  const final = ordered.map((item, i) => {
    const { _ungroundedNumbers, ...clean } = item;
    return { ...clean, id: isNonEmpty(clean.id) ? clean.id : `sugg-${i + 1}`, rank: i + 1 };
  });

  stats.kept = final.length;
  return { items: final, stats };
}

module.exports = { validateItems };
