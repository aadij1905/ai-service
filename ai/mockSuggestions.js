// ai/mockSuggestions.js
// Returns 5 unified items. Each has both owner-facing fields (problem, suggestion)
// and dev-facing fields (issue, recommendation, codePatch).
// The route splits them via splitItems().

function generateMockSuggestions(normalized, flags) {
  const cr = normalized.overview.conversionRate;
  const bounce = normalized.overview.bounceRate;
  const sessions = normalized.overview.totalSessions;
  const funnel = normalized.funnel;
  const mobilePct = normalized.devices?.mobile?.percentage;

  const worstBouncePage = [...(normalized.pages || [])]
    .filter((p) => p.bounceRate !== null)
    .sort((a, b) => b.bounceRate - a.bounceRate)[0];

  const worstLCPPage = [...(normalized.pages || [])]
    .filter((p) => p.lcp_p75_ms !== null)
    .sort((a, b) => b.lcp_p75_ms - a.lcp_p75_ms)[0];

  return [
    {
      id: "mock-1", rank: 1, category: "conversion",
      title: "Overall conversion rate below e-commerce benchmarks",
      problem: `The store is converting ${(cr * 100).toFixed(2)}% of ${sessions.toLocaleString()} visitors into buyers — below the typical 1.5–3% range for Shopify stores. The overall bounce rate is ${bounce != null ? (bounce * 100).toFixed(1) + "%" : "not available"}.`,
      suggestion: "Review the homepage and top product pages to make sure the value proposition and buy buttons are immediately visible to new visitors.",
      issue: `Site converts at ${(cr * 100).toFixed(2)}% across ${sessions.toLocaleString()} sessions. Industry benchmark for Shopify stores is 1.5–3%. Bounce rate is ${bounce != null ? (bounce * 100).toFixed(1) + "%" : "not available"}.`,
      recommendation: "Audit the top 5 pages by traffic for CTA clarity and value proposition strength.",
      affectedPage: "site-wide",
      impactEstimate: "+0.3% to +0.8% conversion rate",
      effort: "medium", confidence: "high",
      dataSource: "overview.conversionRate, overview.totalSessions, overview.bounceRate",
      codePatch: { type: "manual", code: null, file: null, instructions: "Requires UX review before a specific code fix." },
    },
    {
      id: "mock-2", rank: 2, category: "funnel",
      title: "Shoppers adding to cart are not reaching checkout",
      problem: funnel?.sessionsWithCartAdditions
        ? `${funnel.sessionsWithCartAdditions.toLocaleString()} shoppers added something to their cart, but only ${funnel.sessionsThatReachedCheckout?.toLocaleString()} made it to checkout — just ${((funnel.checkoutReachRate || 0) * 100).toFixed(1)}% of those who showed buying intent.`
        : "Funnel data not available in mock.",
      suggestion: "Add a persistent cart drawer and a checkout progress bar so shoppers always know how close they are to completing their purchase.",
      issue: funnel?.sessionsWithCartAdditions
        ? `${funnel.sessionsWithCartAdditions.toLocaleString()} sessions added to cart but only ${funnel.sessionsThatReachedCheckout?.toLocaleString()} reached checkout (${((funnel.checkoutReachRate || 0) * 100).toFixed(1)}% reach rate).`
        : "Funnel data not available in mock.",
      recommendation: "Add a persistent cart drawer and reduce checkout friction. Consider a progress indicator.",
      affectedPage: "/cart",
      impactEstimate: "+0.5% to +1.2% checkout reach rate",
      effort: "medium", confidence: "high",
      dataSource: "funnel.sessionsWithCartAdditions, funnel.sessionsThatReachedCheckout, funnel.checkoutReachRate",
      codePatch: {
        type: "liquid",
        code: `{%- if cart.item_count > 0 -%}
  <div class="cart-progress">
    <span class="cart-progress__step cart-progress__step--active">Cart</span>
    <span class="cart-progress__step">Checkout</span>
    <span class="cart-progress__step">Confirmation</span>
  </div>
{%- endif -%}`,
        file: "sections/cart-drawer.liquid",
        instructions: "Add above the cart items list in the cart drawer section.",
      },
    },
    {
      id: "mock-3", rank: 3, category: "performance",
      title: worstLCPPage ? `Page loads too slowly on ${worstLCPPage.path}` : "LCP performance opportunity",
      problem: worstLCPPage
        ? `The ${worstLCPPage.path} page takes ${worstLCPPage.lcp_p75_ms}ms to show its main content — Google considers anything over 2500ms slow. This page receives ${worstLCPPage.sessions.toLocaleString()} visits. Slow pages cause shoppers to leave before they even see the product.`
        : "Page speed data not available in this mock.",
      suggestion: "Speed up the main product image on this page so shoppers see it immediately without waiting.",
      issue: worstLCPPage
        ? `Page ${worstLCPPage.path} has LCP of ${worstLCPPage.lcp_p75_ms}ms (status: ${worstLCPPage.lcpStatus}). Google threshold for good is ≤2500ms. This page receives ${worstLCPPage.sessions.toLocaleString()} sessions.`
        : "LCP data not available in this mock.",
      recommendation: "Preload the hero image, serve WebP format, and add lazy loading to below-fold images.",
      affectedPage: worstLCPPage?.path || "site-wide",
      impactEstimate: "100-800ms LCP improvement; correlates with 0.5–1% bounce rate reduction",
      effort: "low", confidence: "high",
      dataSource: "pages[].lcp_p75_ms, pages[].lcpStatus",
      codePatch: {
        type: "liquid",
        code: `{%- assign hero = section.settings.image -%}
{%- if hero -%}
  {{ hero | image_url: width: 1500 | image_tag:
    loading: 'eager',
    fetchpriority: 'high',
    widths: '375, 750, 1100, 1500',
    sizes: '100vw'
  }}
{%- endif -%}`,
        file: "sections/image-banner.liquid",
        instructions: "Replace the hero image tag to add fetchpriority and eager loading for LCP.",
      },
    },
    {
      id: "mock-4", rank: 4, category: "conversion",
      title: worstBouncePage ? `Most visitors immediately leave ${worstBouncePage.path}` : "High bounce page opportunity",
      problem: worstBouncePage
        ? `${(worstBouncePage.bounceRate * 100).toFixed(1)}% of the ${worstBouncePage.sessions.toLocaleString()} visitors to ${worstBouncePage.path} leave without clicking anything — well above the site average of ${(normalized.overview.bounceRate * 100).toFixed(1)}%. This page is losing potential buyers.`
        : "Bounce rate data not available in this mock.",
      suggestion: "Make the page's main offer and buy button visible the moment visitors land — they should not have to scroll to know what action to take.",
      issue: worstBouncePage
        ? `${worstBouncePage.path} has a ${(worstBouncePage.bounceRate * 100).toFixed(1)}% bounce rate with ${worstBouncePage.sessions.toLocaleString()} sessions. Site average is ${(normalized.overview.bounceRate * 100).toFixed(1)}%.`
        : "Bounce rate data not available in this mock.",
      recommendation: "Add a clear value proposition above the fold and ensure the primary CTA is visible without scrolling.",
      affectedPage: worstBouncePage?.path || "site-wide",
      impactEstimate: "5-15% bounce rate reduction on this page",
      effort: "medium", confidence: "high",
      dataSource: "pages[].bounceRate, overview.bounceRate",
      codePatch: { type: "manual", code: null, file: null, instructions: "Requires visual review of the specific page before code changes." },
    },
    {
      id: "mock-5", rank: 5, category: "mobile",
      title: "Most traffic is on mobile — any friction has outsized impact",
      problem: mobilePct
        ? `${(mobilePct * 100).toFixed(0)}% of all visits come from mobile devices. Even small friction points on mobile — hard-to-tap buttons, slow pages, a confusing checkout — affect the majority of shoppers.`
        : "Mobile session share not available in this mock.",
      suggestion: "Test the full buying journey on a real mobile phone and make sure buttons are easy to tap and the checkout is simple to complete.",
      issue: mobilePct
        ? `Mobile accounts for ${(mobilePct * 100).toFixed(0)}% of sessions. Per-device conversion data is not available from Shopify's analytics, but any mobile UX friction has outsized revenue impact at this traffic share.`
        : "Mobile session share not available in this mock.",
      recommendation: "Run a mobile UX audit on the top 3 pages by traffic. Prioritize tap target sizes and checkout form UX.",
      affectedPage: "site-wide",
      impactEstimate: "Risk mitigation — direct impact depends on audit findings",
      effort: "medium", confidence: "medium",
      dataSource: "devices.mobile.percentage",
      codePatch: {
        type: "css",
        code: `@media (max-width: 749px) {
  .product-form__submit {
    min-height: 48px;
    font-size: 1rem;
    width: 100%;
  }
  .cart__checkout-button {
    min-height: 48px;
    font-size: 1rem;
  }
}`,
        file: "assets/theme.css",
        instructions: "Add to the end of theme.css to ensure primary action buttons meet the 48px minimum touch target size on mobile.",
      },
    },
  ];
}

module.exports = { generateMockSuggestions };
