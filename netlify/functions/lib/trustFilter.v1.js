/**
 * trustFilter.v1.js
 * ------------------------------------------------------------------
 * MARU commerce and payment-facing trust evaluation.
 * It preserves broad candidate discovery while exposing a stricter front
 * eligibility verdict for products, ordering, inquiry, and payment paths.
 * ------------------------------------------------------------------
 */
"use strict";

const crypto = require("crypto");
const { URL } = require("url");
let Core = null;
try { Core = require("./trustFilter.core.v1"); } catch (_e) { Core = null; }

const VERSION = "trust-filter-commerce-v2.0-tiered-front-contract";
const DEFAULTS = Object.freeze({
  minScore: 35,
  frontMinScore: 70,
  maxRedirects: 3,
  suspiciousTlds: ["zip", "mov", "click", "top", "xyz", "work", "gq", "tk", "ml", "cf"],
  scamKeywords: [
    "limited time", "act now", "only today", "urgent", "congratulations", "you won", "free gift", "claim", "verify account",
    "risk free", "100% guaranteed", "get rich", "당첨", "무료 사은품", "긴급 결제", "계정 인증", "보이스피싱", "피싱사이트"
  ],
  buyTokens: ["add to cart", "checkout", "buy now", "place order", "장바구니", "결제", "구매", "주문", "문의", "견적"],
  currencyTokens: ["USD", "KRW", "JPY", "EUR", "GBP", "THB", "VND", "IDR", "GHS", "NGN", "ZAR", "₹", "₩", "¥", "€", "£", "฿", "₫", "₵"],
  policyTokens: ["refund", "returns", "shipping", "delivery", "terms", "privacy", "contact", "customer service", "환불", "반품", "배송", "이용약관", "개인정보", "고객센터", "문의"],
  paymentProviders: [
    { name: "Stripe", tokens: ["stripe.com", "stripe-js", "checkout.stripe.com"] },
    { name: "PayPal", tokens: ["paypal.com", "paypalobjects.com"] },
    { name: "Adyen", tokens: ["adyen.com", "checkoutshopper"] },
    { name: "Braintree", tokens: ["braintreegateway.com"] },
    { name: "Checkout.com", tokens: ["checkout.com"] },
    { name: "KCP", tokens: ["pay.kcp.co.kr", "kcp"] },
    { name: "KG Inicis", tokens: ["inicis", "inipay"] },
    { name: "TossPayments", tokens: ["toss.im", "tosspayments"] },
    { name: "KakaoPay", tokens: ["kakaopay"] },
    { name: "NaverPay", tokens: ["naverpay", "pay.naver.com"] },
    { name: "Shopify", tokens: ["myshopify.com", "cdn.shopify.com", "shopify-pay"] },
    { name: "WooCommerce", tokens: ["woocommerce", "wc-ajax"] }
  ]
});

function str(value) { return String(value == null ? "" : value); }
function low(value) { return str(value).trim().toLowerCase(); }
function truthy(value) { return value === true || (value !== false && value != null && !["", "0", "false", "no", "off", "disabled"].includes(low(value))); }
function safeUrl(value) { try { return new URL(str(value)); } catch (_e) { return null; } }
function hostOf(value) { const url = safeUrl(value); return url ? low(url.hostname).replace(/^www\./, "") : ""; }
function sha1(value) { return crypto.createHash("sha1").update(str(value), "utf8").digest("hex"); }
function hasAnyToken(text, tokens) { const haystack = low(text); return (Array.isArray(tokens) ? tokens : []).some(token => haystack.includes(low(token))); }
function firstNonEmpty() { for (const value of arguments) { const out = str(value).trim(); if (out) return out; } return ""; }
function contextFront(options) {
  options = options || {};
  return ["frontSupply", "frontExposure", "paymentFacing", "commerce", "slotSupply", "snapshot", "requireTrusted", "strictFront"].some(key => truthy(options[key])) || /front|payment|commerce|snapshot|slot/.test(low(options.mode));
}
function listOf(options, name) {
  const local = options && options[name];
  if (local && typeof local === "object") return local;
  if (Core && Core[name === "allowlist" ? "ALLOW_LIST" : "BLOCK_LIST"]) return Core[name === "allowlist" ? "ALLOW_LIST" : "BLOCK_LIST"];
  return {};
}
function domainMatch(host, domains) {
  return !!host && (Array.isArray(domains) ? domains : []).some(domain => {
    const value = low(domain).replace(/^www\./, "");
    return value && (host === value || host.endsWith("." + value));
  });
}
function patternMatch(text, patterns) {
  const body = str(text);
  return (Array.isArray(patterns) ? patterns : []).some(pattern => {
    try { return new RegExp(str(pattern), "i").test(body); }
    catch (_e) { return low(body).includes(low(pattern)); }
  });
}
function metadataText(candidate) {
  candidate = candidate || {};
  return [candidate.title, candidate.name, candidate.summary, candidate.description, candidate.category, candidate.type, candidate.source, candidate.provider, candidate.url, candidate.country, Array.isArray(candidate.tags) ? candidate.tags.join(" ") : ""].filter(Boolean).join(" ");
}
function htmlSignals(htmlText, cfg) {
  const text = low(htmlText || "");
  const providers = [];
  for (const provider of cfg.paymentProviders) if (hasAnyToken(text, provider.tokens)) providers.push(provider.name);
  const out = { score: 0, reasons: [], providers };
  if (providers.length) { out.score += 14; out.reasons.push("PAYMENT_PROVIDER_INFRASTRUCTURE"); }
  if (hasAnyToken(text, cfg.buyTokens)) { out.score += 10; out.reasons.push("BUY_OR_INQUIRY_SIGNAL"); }
  if (hasAnyToken(text, cfg.currencyTokens)) { out.score += 5; out.reasons.push("CURRENCY_SIGNAL"); }
  if (hasAnyToken(text, cfg.policyTokens)) { out.score += 10; out.reasons.push("POLICY_OR_CONTACT_SIGNAL"); }
  if (text.includes("schema.org/product") || /"@type"\s*:\s*"product"/.test(text)) { out.score += 10; out.reasons.push("SCHEMA_PRODUCT_SIGNAL"); }
  if (text.includes("schema.org/offer") || /"@type"\s*:\s*"offer"/.test(text)) { out.score += 6; out.reasons.push("SCHEMA_OFFER_SIGNAL"); }
  if (hasAnyToken(text, cfg.scamKeywords)) { out.score -= 25; out.reasons.push("SCAM_KEYWORDS_FOUND"); }
  const iframeCount = (text.match(/<iframe\b/g) || []).length;
  if (iframeCount >= 6) { out.score -= 15; out.reasons.push("IFRAME_EXCESS"); }
  return out;
}
function evaluateCandidate(candidate, options = {}) {
  const cfg = Object.assign({}, DEFAULTS, options || {});
  candidate = candidate || {};
  const frontMode = contextFront(options);
  const allowlist = listOf(options, "allowlist");
  const blocklist = listOf(options, "blocklist");
  const url = safeUrl(firstNonEmpty(candidate.url, candidate.link, candidate.href));
  const reasons = [];
  const signals = {};
  let score = 0;
  if (!url) return { ok: false, frontEligible: false, score: 0, reasons: ["URL_INVALID"], signals, version: VERSION };
  const host = hostOf(url.toString());
  const tld = host.split(".").pop() || "";
  const text = metadataText(candidate);

  if (url.protocol === "https:") score += 10; else { score -= 15; reasons.push("URL_NOT_HTTPS"); }
  if (/^xn--/.test(host)) { score -= 60; reasons.push("DOMAIN_PUNYCODE_BLOCK"); }
  const hardBlock = domainMatch(host, blocklist.domains) || patternMatch(text, blocklist.patterns) || (Array.isArray(blocklist.keywords) && blocklist.keywords.some(keyword => low(text).includes(low(keyword))));
  if (hardBlock) { score -= 100; reasons.push("BLOCKLIST_HARD_REJECT"); }
  const frontDenied = domainMatch(host, blocklist.frontDeniedDomains) || (Array.isArray(blocklist.frontDeniedTlds) && blocklist.frontDeniedTlds.map(low).includes(tld)) || patternMatch(text, blocklist.frontDeniedPatterns);
  if (frontDenied) { score -= 22; reasons.push("FRONT_RISK_SIGNAL"); }
  const frontDomain = domainMatch(host, allowlist.frontEligibleDomains || allowlist.domains);
  const marketplaceDomain = domainMatch(host, allowlist.verifiedMarketplaceDomains);
  const paymentProviderDomain = domainMatch(host, allowlist.paymentProviderDomains);
  const technologyPlatformDomain = domainMatch(host, allowlist.technologyPlatformDomains);
  if (frontDomain) { score += 20; reasons.push("FRONT_TRUSTED_DOMAIN"); }
  else if (marketplaceDomain) { score += 4; reasons.push("MARKETPLACE_PLATFORM_KNOWN"); }
  else if (paymentProviderDomain || technologyPlatformDomain) { score += 1; reasons.push("PLATFORM_INFRASTRUCTURE_KNOWN"); }

  const core = Core && typeof Core.evaluateTrust === "function" ? Core.evaluateTrust(candidate, Object.assign({}, options, { frontSupply: frontMode })) : null;
  if (core) {
    score += Math.max(-20, Math.min(26, Math.round(Number(core.score || 0) / 4)));
    if (core.frontEligible) reasons.push("CORE_FRONT_VERIFIED");
    if (core.trusted) reasons.push("CORE_SOURCE_TRUSTED");
    if (core.ok === false && core.reasons && core.reasons.some(reason => /BLOCKLIST|PUNYCODE|ITEM_FAKE|ITEM_SCAM|URL_INVALID/.test(str(reason)))) reasons.push("CORE_HARD_REJECT");
  }

  if (options.htmlText) {
    const html = htmlSignals(options.htmlText, cfg);
    score += html.score;
    reasons.push(...html.reasons);
    signals.providers = html.providers;
  } else reasons.push("HTML_NOT_CHECKED");
  if (candidate.title || candidate.name) score += 3;
  if (candidate.image || candidate.thumbnail || candidate.thumb) score += 3;
  if (candidate.price != null && candidate.price !== "") score += 3;
  if (candidate.currency) score += 2;
  if (truthy(candidate.orderReady) || truthy(candidate.contactReady) || truthy(candidate.inquiryReady)) score += 7;
  if (truthy(candidate.deliveryReady) || truthy(candidate.policyReady)) score += 5;

  const sellerVerified = !!(candidate.sellerVerified || candidate.marketplaceSellerVerified || (candidate.seller && candidate.seller.verified));
  const marketplaceOnly = marketplaceDomain && !(sellerVerified || (core && core.frontEligible));
  if (marketplaceOnly) { score -= 10; reasons.push("MARKETPLACE_SELLER_VERIFICATION_REQUIRED"); }
  const platformOnly = (paymentProviderDomain || technologyPlatformDomain) && !(core && core.frontEligible);
  if (platformOnly) { score -= 10; reasons.push("PLATFORM_NOT_SELLER_EVIDENCE"); }
  score = Math.max(-100, Math.min(100, score));

  const hardRejected = reasons.some(reason => /HARD_REJECT|PUNYCODE|BLOCKLIST/.test(reason));
  const frontEligible = !!(!hardRejected && !frontDenied && !marketplaceOnly && !platformOnly && core && core.frontEligible && score >= cfg.frontMinScore);
  const discoveryOk = !hardRejected && score >= cfg.minScore;
  const ok = frontMode ? frontEligible : discoveryOk;
  signals.host = host;
  signals.frontMode = frontMode;
  signals.frontDomain = frontDomain;
  signals.marketplaceDomain = marketplaceDomain;
  signals.paymentProviderDomain = paymentProviderDomain;
  signals.technologyPlatformDomain = technologyPlatformDomain;
  signals.urlHash = sha1(url.toString());
  return {
    ok, frontEligible, score, reasons: Array.from(new Set(reasons)), signals, version: VERSION,
    trustTier: score >= 86 ? "A+" : score >= 70 ? "A" : score >= 52 ? "B" : score >= 35 ? "C" : "D",
    frontVerificationStatus: frontEligible ? "verified-front-commerce" : "hold-for-front-verification",
    sourceEvidence: core ? core.evidence || [] : [],
    classification: frontEligible ? "verified-commerce-front" : (marketplaceOnly ? "marketplace-seller-verification-required" : (platformOnly ? "platform-not-seller" : "discovery-or-review"))
  };
}
function evaluateFrontCommerce(candidate, options = {}) { return evaluateCandidate(candidate, Object.assign({}, options, { frontSupply: true, commerce: true })); }

module.exports = { version: VERSION, evaluateCandidate, evaluateFrontCommerce, DEFAULTS };
