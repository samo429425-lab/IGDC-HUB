// trustFilter.v1.js
// 목적: "실결제"라도 사기/낚시/가짜/미검증 결제라인을 최대한 차단하기 위한 공통 필터
// 사용처: 모든 snapshot 생성기 / feed 컴파일러(선택) / 수집 파이프라인 공통
//
// 입력: candidate = { url, title?, image?, price?, currency?, country? }
// 출력: { ok, score, reasons[], signals{} }

const { URL } = require("url");
const crypto = require("crypto");

// ---- Config (조정 가능) ----
const DEFAULTS = {
  minScore: 70,
  // 리다이렉트 과다/이상 패턴 차단
  maxRedirects: 3,
  // 의심 키워드 (다국어 확장 가능)
  scamKeywords: [
    "limited time", "act now", "only today", "urgent", "congratulations",
    "you won", "free gift", "claim", "verify account", "risk free",
    "100% guaranteed", "miracle", "lose weight", "get rich",
    "총판", "최저가", "당첨", "무료", "사은품", "인증", "긴급", "지금만", "대박"
  ],
  // 결제/상거래 신호
  commerceSignals: {
    // 결제/장바구니/구매 버튼 흔적
    buyTokens: ["add to cart", "checkout", "buy now", "place order", "장바구니", "결제", "구매", "주문"],
    // 가격/통화 흔적
    currencyTokens: ["USD","KRW","JPY","EUR","GBP","THB","VND","IDR","GHS","NGN","ZAR","₹","₩","¥","€","£","฿","₫","₵"],
    // 환불/배송/약관 흔적
    policyTokens: ["refund", "returns", "shipping", "terms", "privacy", "환불", "반품", "배송", "이용약관", "개인정보"]
  },
  // 알려진 결제 제공자/SDK 흔적(핵심 신뢰 점수)
  paymentProviders: [
    { name: "Stripe", tokens: ["stripe.com", "stripe-js", "checkout.stripe.com"] },
    { name: "PayPal", tokens: ["paypal.com", "www.paypal.com", "paypalobjects.com"] },
    { name: "Adyen", tokens: ["adyen.com", "checkoutshopper"] },
    { name: "Braintree", tokens: ["braintreegateway.com"] },
    { name: "Checkout.com", tokens: ["checkout.com"] },
    { name: "KCP", tokens: ["kcp", "pay.kcp.co.kr"] },
    { name: "KG Inicis", tokens: ["inicis", "inipay"] },
    { name: "TossPayments", tokens: ["toss", "toss.im", "tossPayments"] },
    { name: "KakaoPay", tokens: ["kakaopay", "kakaopay.com"] },
    { name: "NaverPay", tokens: ["naverpay", "pay.naver.com"] },
    { name: "Paystack", tokens: ["paystack"] },
    { name: "Flutterwave", tokens: ["flutterwave", "ravepay"] },
    { name: "Mollie", tokens: ["mollie"] },
    { name: "Shopify", tokens: ["myshopify.com", "cdn.shopify.com", "shopify-pay", "shopify"] },
    { name: "WooCommerce", tokens: ["woocommerce", "wc-ajax"] }
  ],
  // URL/도메인 위험 패턴
  domainRisk: {
    suspiciousTlds: ["zip","mov","click","top","xyz","work","gq","tk"],
    // punycode(동형이의) 위험
    blockPunycode: true
  }
};

// ---- Helpers ----
function safeUrl(u) {
  try { return new URL(u); } catch { return null; }
}
function lc(s){ return String(s||"").toLowerCase(); }
function hasAnyToken(hay, tokens){
  const H = lc(hay);
  return tokens.some(t => H.includes(lc(t)));
}
function sha1(s){
  return crypto.createHash("sha1").update(String(s||""), "utf8").digest("hex");
}

// ---- Core Checks ----
function checkUrlBasics(u, cfg){
  const reasons = [];
  let score = 0;

  if (!u) return { score: 0, reasons: ["URL_INVALID"] };

  // HTTPS 강제 (실결제 기반)
  if (u.protocol !== "https:") {
    reasons.push("URL_NOT_HTTPS");
    score -= 40;
  } else score += 10;

  // punycode 차단(동형이의 도메인)
  if (cfg.domainRisk.blockPunycode && u.hostname.startsWith("xn--")) {
    reasons.push("DOMAIN_PUNYCODE_BLOCK");
    score -= 60;
  }

  // 의심 TLD
  const tld = u.hostname.split(".").pop() || "";
  if (cfg.domainRisk.suspiciousTlds.includes(lc(tld))) {
    reasons.push("DOMAIN_SUSPICIOUS_TLD");
    score -= 25;
  }

  // URL 과다 쿼리/추적 파라미터(피싱 패턴)
  const sp = u.searchParams;
  const paramCount = Array.from(sp.keys()).length;
  if (paramCount >= 12) { reasons.push("URL_TOO_MANY_PARAMS"); score -= 15; }

  // 흔한 피싱 파라미터
  const phishingParams = ["token","verify","claim","gift","winner","reset","login","auth","session"];
  if (Array.from(sp.keys()).some(k => phishingParams.includes(lc(k)))) {
    reasons.push("URL_PHISHING_PARAMS");
    score -= 15;
  }

  return { score, reasons };
}

// HTML/응답 기반 검사(선택): fetch 결과 텍스트를 넣으면 더 강해짐
function checkHtmlSignals(html, cfg){
  const reasons = [];
  let score = 0;
  const H = lc(html || "");

  // 결제 제공자 흔적
  const providers = [];
  for (const p of cfg.paymentProviders) {
    if (hasAnyToken(H, p.tokens)) providers.push(p.name);
  }
  if (providers.length) { score += 25; reasons.push("PAYMENT_PROVIDER_OK"); }

  // 구매/장바구니 신호
  if (hasAnyToken(H, cfg.commerceSignals.buyTokens)) { score += 15; reasons.push("BUY_SIGNAL_OK"); }
  // 통화/가격 신호(기본)
  if (hasAnyToken(H, cfg.commerceSignals.currencyTokens)) { score += 10; reasons.push("CURRENCY_SIGNAL_OK"); }
  // 배송/환불/약관 신호
  if (hasAnyToken(H, cfg.commerceSignals.policyTokens)) { score += 10; reasons.push("POLICY_SIGNAL_OK"); }

  // 사기성 문구 과다
  if (hasAnyToken(H, cfg.scamKeywords)) { score -= 20; reasons.push("SCAM_KEYWORDS_FOUND"); }

  // schema.org Product/Offer (실상품 신호)
  if (H.includes("schema.org/product") || H.includes("\"@type\":\"product\"") || H.includes("\"@type\": \"product\"")) {
    score += 15; reasons.push("SCHEMA_PRODUCT_OK");
  }
  if (H.includes("schema.org/offer") || H.includes("\"@type\":\"offer\"") || H.includes("\"@type\": \"offer\"")) {
    score += 10; reasons.push("SCHEMA_OFFER_OK");
  }

  // iframe 결제 유도/외부 결제창 과다(피싱 패턴)
  const iframeCount = (H.match(/<iframe\b/g) || []).length;
  if (iframeCount >= 6) { score -= 15; reasons.push("IFRAME_EXCESS"); }

  return { score, reasons, providers };
}

// 도메인 allow/block 적용(운영자가 계속 보강)
function applyLists(u, allowlist, blocklist){
  const reasons = [];
  let score = 0;

  const host = lc(u.hostname || "");
  const hitBlock = (blocklist.domains || []).some(d => host === lc(d) || host.endsWith("." + lc(d)));
  if (hitBlock) { reasons.push("BLOCKLIST_DOMAIN"); score -= 100; }

  const hitAllow = (allowlist.domains || []).some(d => host === lc(d) || host.endsWith("." + lc(d)));
  if (hitAllow) { reasons.push("ALLOWLIST_DOMAIN"); score += 20; }

  return { score, reasons };
}

// 후보 단위 최종 평가 (htmlText는 선택: 있으면 강력)
function evaluateCandidate(candidate, opts = {}){
  const cfg = Object.assign({}, DEFAULTS, opts || {});
  const u = safeUrl(candidate && candidate.url);
  const reasons = [];
  const signals = {};
  let score = 0;

  // 1) URL 기본 방어
  const a = checkUrlBasics(u, cfg);
  score += a.score; reasons.push(...a.reasons);

  // 2) allow/block
  const allowlist = opts.allowlist || { domains: [] };
  const blocklist = opts.blocklist || { domains: [] };
  const b = applyLists(u || { hostname:"" }, allowlist, blocklist);
  score += b.score; reasons.push(...b.reasons);

  // 3) HTML 신호(있으면 적용)
  if (opts.htmlText) {
    const c = checkHtmlSignals(opts.htmlText, cfg);
    score += c.score; reasons.push(...c.reasons);
    signals.providers = c.providers;
  } else {
    // html이 없을 경우, “결제 제공자 확인 못함” 패널티
    reasons.push("HTML_NOT_CHECKED");
    score -= 5;
  }

  // 4) 최소 상거래 요건(메타 기준)
  // (수집기에서 title/image/price/currency 확보하면 점수 가산)
  if (candidate && candidate.title) score += 3;
  if (candidate && candidate.image) score += 3;
  if (candidate && candidate.price) score += 3;
  if (candidate && candidate.currency) score += 2;

  // 5) 안정화: 점수 상한/하한
  score = Math.max(-100, Math.min(100, score));

  // 6) 결과
  const ok = score >= cfg.minScore && !reasons.includes("BLOCKLIST_DOMAIN") && !reasons.includes("DOMAIN_PUNYCODE_BLOCK");
  signals.host = u ? u.hostname : "";
  signals.urlHash = sha1(candidate && candidate.url);

  return { ok, score, reasons, signals };
}

module.exports = {
  evaluateCandidate,
  DEFAULTS
};
