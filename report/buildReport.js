// report/buildReport.js

function buildOverview(normalized) {
  return {
    totalSessions: normalized.overview.totalSessions,
    totalRevenue: normalized.overview.totalRevenue,
    totalOrders: normalized.overview.totalOrders,
    avgOrderValue: normalized.overview.avgOrderValue,
    conversionRate: normalized.overview.conversionRate,
    bounceRate: normalized.overview.bounceRate,
    cartAbandonmentRate: normalized.overview.cartAbandonmentRate,
    avgPageLoadTime: normalized.overview.avgPageLoadTime,
    dataAvailability: {
      conversionRate: "real",
      bounceRate: "real",
      cartAbandonmentRate: "real",
      perDeviceConversionRate: "not_available",
      perDeviceBounceRate: "not_available",
      avgPageLoadTime: "not_available_as_single_field",
      coreWebVitals: "real_per_page",
    },
  };
}

function buildFunnel(normalized) {
  const f = normalized.funnel;
  if (!f || !f.sessions) {
    return { detailedStages: null, note: "Funnel data not available." };
  }
  return {
    sessions: f.sessions,
    sessionsWithCartAdditions: f.sessionsWithCartAdditions,
    sessionsThatReachedCheckout: f.sessionsThatReachedCheckout,
    sessionsThatCompletedCheckout: f.sessionsThatCompletedCheckout,
    conversionRate: f.conversionRate,
    cartAdditionRate: f.cartAdditionRate,
    checkoutReachRate: f.checkoutReachRate,
    checkoutCompletionRate: f.checkoutCompletionRate,
    detailedStages: [
      { stage: "Landing", count: f.sessions, dropOffToNext: null },
      {
        stage: "Added to Cart",
        count: f.sessionsWithCartAdditions,
        rate: f.cartAdditionRate,
        dropOffToNext: f.sessions - f.sessionsWithCartAdditions,
      },
      {
        stage: "Reached Checkout",
        count: f.sessionsThatReachedCheckout,
        rate: f.checkoutReachRate,
        dropOffToNext: f.sessionsWithCartAdditions - f.sessionsThatReachedCheckout,
      },
      {
        stage: "Completed Purchase",
        count: f.sessionsThatCompletedCheckout,
        rate: f.checkoutCompletionRate,
        dropOffToNext: null,
      },
    ],
    dataQuality: "real",
  };
}

function buildTrafficReport(normalized) {
  const total = normalized.traffic.reduce((s, t) => s + t.sessions, 0);
  return normalized.traffic.map((t) => ({
    source: t.source,
    sessions: t.sessions,
    share: total ? Math.round((t.sessions / total) * 10000) / 100 : 0,
    conversionRate: t.conversionRate,
    bounceRate: t.bounceRate,
  }));
}

function buildDeviceReport(normalized) {
  return {
    breakdown: Object.entries(normalized.devices).map(([type, data]) => ({
      type,
      sessions: data.sessions,
      onlineStoreVisitors: data.onlineStoreVisitors,
      percentage: data.percentage,
      conversionRate: data.conversionRate,
      bounceRate: data.bounceRate,
    })),
    note: "Per-device conversion rate and bounce rate are not available from ShopifyQL's device grouping. Session volume by device type is real.",
  };
}

function buildPerformanceReport(normalized) {
  return (normalized.pages || [])
    .filter((p) => p.lcp_p75_ms !== null || p.p75_cls !== null || p.inp_p75_ms !== null)
    .map((p) => ({
      path: p.path,
      sessions: p.sessions,
      lcp_p75_ms: p.lcp_p75_ms,
      lcpStatus: p.lcpStatus,
      p75_cls: p.p75_cls,
      clsStatus: p.clsStatus,
      inp_p75_ms: p.inp_p75_ms,
      inpStatus: p.inpStatus,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

// Crawler-derived signals per page. Only emitted for pages the crawler
// actually visited (crawlerEnriched === true) — otherwise the LLM must not
// see values that were never measured. Screenshots are intentionally left on
// disk in the analytics service and NOT sent to the model (they'd cost real
// tokens and most of our providers are text-only).
function buildLayoutReport(normalized) {
  return (normalized.pages || [])
    .filter((p) => p.crawlerEnriched)
    .map((p) => ({
      path: p.path,
      sessions: p.sessions,
      ctaText: p.ctaText,
      ctaAboveFoldDesktop: p.ctaAboveFoldDesktop,
      ctaAboveFoldMobile: p.ctaAboveFoldMobile,
      hasSocialProof: p.hasSocialProof,
      scrollDepth: p.scrollDepth,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

function buildReport(normalized) {
  return {
    overview: buildOverview(normalized),
    funnel: buildFunnel(normalized),
    traffic: buildTrafficReport(normalized),
    devices: buildDeviceReport(normalized),
    performance: buildPerformanceReport(normalized),
    layout: buildLayoutReport(normalized),
  };
}

module.exports = { buildReport };
