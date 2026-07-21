// ai/forecastImpact.js
// Deterministic, conservative revenue forecast for a suggestion — computed from
// the store's OWN normalized analytics, never from the LLM. This is the same
// philosophy as validateItems' grounding: numbers come from measured data, not
// model guesses.
//
// Returns null whenever the data needed to ground a figure isn't there (no
// AOV, no sessions, an un-modelable category like traffic). Callers then fall
// back to the qualitative impactEstimate string rather than show a fabricated
// number — an honest "no forecast" beats a made-up one.
//
// Shape returned:
//   {
//     metric: "checkout completion" | "conversion" | "speed-driven conversion",
//     revenueMonthly: { low, high },   // integers, $/month
//     ordersMonthly:  { low, high },   // integers, orders/month
//     headline:  "+$2.4K–$3.6K/mo",    // compact string for the card face
//     deltaLabel:"+28–42 orders/mo",
//     basis:     "…one-line data basis…",
//     assumptions: ["…", "…"],         // shown in the details / tooltip
//     modeled: true
//   }

// Conservative relative bands. Deliberately low so real results tend to BEAT
// the forecast rather than miss it. Tune here if the product wants a different
// posture (see the "moderate" option discussed in the UX pass).
const BANDS = {
  funnel: [0.05, 0.12], // share of the checkout drop-off recovered
  conversion: [0.03, 0.08], // relative lift in converting sessions
  trust: [0.03, 0.08],
  content: [0.03, 0.08],
  mobile: [0.02, 0.06], // no per-device CR data exists → smaller band
  performance: [0.02, 0.05], // CWV → conversion is indirect → smallest band
  // "traffic" intentionally omitted: per-source revenue can't be grounded
  // reliably from the data we carry, so those findings get no forecast.
};

function periodToDays(period) {
  if (!period) return 30;
  const s = String(period).toLowerCase();
  const m = s.match(/(\d+)\s*d/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  if (s.includes("30")) return 30;
  if (s.includes("14")) return 14;
  if (s.includes("7")) return 7;
  return 30;
}

function money(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function pctBand(lo, hi) {
  return `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
}

function normPath(p) {
  return String(p || "").toLowerCase().replace(/\/+$/, "");
}

function pageByPath(normalized, path) {
  if (!path || !path.startsWith("/")) return null;
  return (normalized.pages || []).find((p) => normPath(p.path) === normPath(path)) || null;
}

function build({ metric, ordersLo, ordersHi, aov, basis, assumptions }) {
  const revLo = ordersLo * aov;
  const revHi = ordersHi * aov;
  // A forecast that rounds to +$0/mo is noise — don't surface it.
  if (Math.round(revHi) <= 0) return null;
  return {
    metric,
    revenueMonthly: { low: Math.round(revLo), high: Math.round(revHi) },
    ordersMonthly: { low: Math.round(ordersLo), high: Math.round(ordersHi) },
    headline: `+${money(revLo)}–${money(revHi)}/mo`,
    deltaLabel: `+${Math.round(ordersLo)}–${Math.round(ordersHi)} orders/mo`,
    basis,
    assumptions,
    modeled: true,
  };
}

// item: a validated suggestion (has category, affectedPage).
// normalized: the store's normalized analytics (overview, funnel, pages, period).
function forecastImpact(item, normalized) {
  if (!item || !normalized) return null;
  const ov = normalized.overview || {};
  const aov = ov.avgOrderValue;
  if (!aov || aov <= 0) return null; // no basis to turn orders into revenue

  const days = periodToDays(normalized.period);
  const toMonthly = 30 / days;
  const cat = item.category;

  // ── Funnel: recover a conservative slice of the checkout drop-off ──────────
  if (cat === "funnel") {
    const f = normalized.funnel || {};
    const reached = f.sessionsThatReachedCheckout || 0;
    const completed = f.sessionsThatCompletedCheckout || 0;
    const dropoff = Math.max(0, reached - completed);
    if (dropoff < 1) return null;
    const [lo, hi] = BANDS.funnel;
    return build({
      metric: "checkout completion",
      ordersLo: dropoff * lo * toMonthly,
      ordersHi: dropoff * hi * toMonthly,
      aov,
      basis: `${Math.round(dropoff).toLocaleString()} sessions/${days}d reach checkout but don't complete`,
      assumptions: [
        `Recovering ${pctBand(lo, hi)} of the ${Math.round(dropoff).toLocaleString()}-session checkout drop-off`,
        `At your average order value of ${money(aov)}`,
        `Scaled to 30 days from a ${days}-day window`,
      ],
    });
  }

  // ── Conversion-style: a conservative relative lift in converting sessions ──
  const band = BANDS[cat];
  if (!band) return null; // e.g. "traffic" — not modeled

  const page = pageByPath(normalized, item.affectedPage);
  const sessions = page ? page.sessions : ov.totalSessions;
  const cr = page && page.conversionRate != null ? page.conversionRate : ov.conversionRate;
  if (!sessions || sessions <= 0 || !cr || cr <= 0) return null;

  const baseOrders = sessions * cr; // orders attributable to this scope, in-period
  const [lo, hi] = band;
  const scopeLabel = page ? page.path : "site-wide";
  const scopePhrase = page ? `on ${page.path}` : "site-wide";
  return build({
    metric: cat === "performance" ? "speed-driven conversion" : "conversion",
    ordersLo: baseOrders * lo * toMonthly,
    ordersHi: baseOrders * hi * toMonthly,
    aov,
    basis: `${Math.round(sessions).toLocaleString()} sessions/${days}d ${scopePhrase} at ${(cr * 100).toFixed(2)}% conversion`,
    assumptions: [
      `A conservative ${pctBand(lo, hi)} relative lift in ${scopeLabel} conversion`,
      `At your average order value of ${money(aov)}`,
      `Scaled to 30 days from a ${days}-day window`,
    ],
  });
}

module.exports = { forecastImpact };
