"use strict";

/**
 * IGDC/MARU private product-ranking policy.
 *
 * This module is deliberately non-publishing. It normalizes and de-duplicates
 * official seller product references, applies a deterministic risk gate, ranks
 * only the products that passed that gate, and proposes PSOM/front section keys
 * for later administrator approval. It never creates a public snapshot, opens a
 * payment route, or treats commercial potential as proof of trust.
 */

const crypto = require("crypto");

const VERSION = "commerce-product-ranking-v1.3.0-family-representative-portfolio";

const CATEGORY_KEYS = Object.freeze([
  "local_products",
  "manufacturer_brands",
  "food_household_essentials",
  "beauty_personal_care",
  "fashion",
  "electronics_accessories",
  "home_appliances_living",
  "baby_family_education",
  "agriculture_fishery_forestry",
  "travel_local_services"
]);

const FRONT_SECTION_KEYS = Object.freeze({
  home: Object.freeze(["home_1", "home_2", "home_3", "home_4", "home_5", "home_right_top", "home_right_middle", "home_right_bottom"]),
  distribution: Object.freeze(["distribution-recommend", "distribution-new", "distribution-trending", "distribution-special", "distribution-sponsor", "distribution-others", "distribution-right"]),
  network: Object.freeze(["network-right"]),
  tour: Object.freeze(["tour"]),
  social: Object.freeze(["rightPanel"])
});

const POLICY = Object.freeze({
  schema: "igdc-private-product-ranking-policy.v1",
  principle: "risk_gate_before_revenue_ranking",
  hardDuplicateRule: "same_supplier_and_same_product_id_or_canonical_url_or_title_image_fingerprint",
  sameTitleDifferentSupplierRule: "preserve_as_competing_offer",
  titleOnlyRule: "never_hard_merge",
  sponsorRule: "explicit_approved_sponsor_contract_only",
  sectionAssignmentRule: "proposal_only_until_administrator_approval",
  publication: false,
  automaticImport: false,
  checkout: false,
  payment: false,
  maxSupplierRun: 2,
  maxCategoryRun: 2,
  allowedSections: FRONT_SECTION_KEYS
});

const TRACKING_QUERY_KEYS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_name", "fbclid", "gclid", "dclid", "yclid", "ref", "referrer",
  "source", "src", "campaign", "campaignid", "affiliate", "aff", "affid", "session",
  "sid", "timestamp", "ts"
]);

const PRODUCT_ID_QUERY_KEYS = new Set([
  "goodsno", "goods_no", "goodsid", "goods_id", "goodscd", "goods_cd",
  "product_no", "productno", "productid", "product_id", "productseq", "product_seq",
  "prdno", "prd_no", "itemid", "item_id", "itemno", "item_no", "sku", "branduid",
  "uid", "pid", "productcode", "product_code", "itemcode", "item_code"
]);

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase(); }
function plain(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function sha256(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }
function first() {
  for (const value of arguments) {
    const out = text(value);
    if (out) return out;
  }
  return "";
}
function safeHttpsUrl(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return "";
    return url.toString();
  } catch (_error) { return ""; }
}
function hostKey(value) {
  try { return new URL(text(value)).hostname.toLowerCase().replace(/^www\./, ""); }
  catch (_error) { return ""; }
}
function sameSite(left, right) {
  const a = hostKey(left), b = hostKey(right);
  return !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
}

function safeProductImageUrl(value) {
  const safe = safeHttpsUrl(value);
  if (!safe) return "";
  try {
    const parsed = new URL(safe), low = lower(parsed.pathname + parsed.search);
    if (/\.(?:css|js|mjs|json|xml|map|txt|pdf|zip|svg)(?:$|[?#])/i.test(low)) return "";
    if (/(?:^|[\/_\-.])(?:logo|favicon|icon|sprite|avatar|profile|banner|header|footer|brandmark|placeholder|no[-_]?image)(?:[\/_\-.]|$)/i.test(low)) return "";
    return safe;
  } catch (_error) { return ""; }
}

function canonicalProductUrl(value) {
  const safe = safeHttpsUrl(value);
  if (!safe) return "";
  try {
    const url = new URL(safe);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    if (url.port === "443") url.port = "";
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    const params = [];
    for (const [rawKey, rawValue] of url.searchParams.entries()) {
      const key = lower(rawKey);
      if (!key || TRACKING_QUERY_KEYS.has(key) || key.startsWith("utm_")) continue;
      const valuePart = text(rawValue);
      if (!valuePart && !PRODUCT_ID_QUERY_KEYS.has(key)) continue;
      params.push([key, valuePart]);
    }
    params.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    url.search = "";
    for (const [key, valuePart] of params) url.searchParams.append(key, valuePart);
    return url.toString();
  } catch (_error) { return ""; }
}

function productIdFromUrl(value) {
  const url = canonicalProductUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    for (const [rawKey, rawValue] of parsed.searchParams.entries()) {
      const key = lower(rawKey);
      if (PRODUCT_ID_QUERY_KEYS.has(key) && text(rawValue)) return key + ":" + lower(rawValue);
    }
    const path = decodeURIComponent(parsed.pathname || "");
    const patterns = [
      /\/(?:dp\/prod|i\/item|product\/detail|products?|items?|detail|prd)\/([^/?#]{1,})/i,
      /\/(?:product|item|goods|prd)[_-](?:view|detail)[._/-]?([^/?#]{1,})/i,
      /\/goods\/(?:view|detail)\/([^/?#]{1,})/i,
      /\/goods\/([^/?#]{1,})/i
    ];
    for (const pattern of patterns) {
      const match = path.match(pattern);
      if (!match || !match[1]) continue;
      const segment = lower(match[1]);
      if (/\.(?:php|html?|aspx?|jsp)$/i.test(segment)) continue;
      if (/^(?:view|detail|list|best|today|brand|event|sale|search|category|first[_-]?time)$/i.test(segment)) continue;
      return "path:" + segment;
    }
    return "";
  } catch (_error) { return ""; }
}

function isTemplateOrPlaceholderUrl(value) {
  let raw = text(value);
  try { raw = decodeURIComponent(raw); } catch (_error) {}
  return /(?:`|\$\{|item\.itemno|brand\.autocomp|targeturl|\+\s*\+\s*|%60|__product__|placeholder)/i.test(raw);
}

function isStaticOrApiUrl(value) {
  const url = canonicalProductUrl(value);
  if (!url) return true;
  try {
    const parsed = new URL(url), path = lower(parsed.pathname), query = lower(parsed.search);
    if (/\.(?:css|js|json|xml|map|txt|pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip|rar|7z)(?:$|[?#])/i.test(path + query)) return true;
    if (/(?:^|\/)(?:api|graphql|ajax|rest)(?:\/|$)/i.test(path)) return true;
    if (/\/(?:v\d+\/)?(?:item|product|goods|auto|recentseen|ship|exhibition)\/[^/?#]*api\/?$/i.test(path)) return true;
    return false;
  } catch (_error) { return true; }
}

function isListOrCampaignUrl(value) {
  const url = canonicalProductUrl(value);
  if (!url) return true;
  try {
    const parsed = new URL(url), path = lower(parsed.pathname), query = lower(parsed.search);
    const queryProductId = Array.from(parsed.searchParams.entries()).some(([rawKey, rawValue]) => PRODUCT_ID_QUERY_KEYS.has(lower(rawKey)) && !!text(rawValue));
    const obviousListPath = /(?:goods_list|product_list|products_list|item_list|goods_brand_list|brand_list|goods_best_list|goods_search|goods_today|first_time|event_sale|planshop|exhibition|category|categories|catalog|collection|collections|search|best|event)(?:[._/\-]|$)/i.test(path);
    if (obviousListPath && !queryProductId) return true;
    if (/(?:^|[?&])(?:category|cate|search|keyword|exhibitionno|sno)=/i.test(query) && !queryProductId) return true;
    return false;
  } catch (_error) { return true; }
}

function isSpecificProductUrl(value) {
  const url = canonicalProductUrl(value);
  if (!url || isTemplateOrPlaceholderUrl(url) || isStaticOrApiUrl(url) || isListOrCampaignUrl(url)) return false;
  if (productIdFromUrl(url)) return true;
  try {
    const path = lower(new URL(url).pathname);
    if (/\.(?:php|html?|aspx?|jsp)$/i.test(path) && !/(?:goods_view|product_view|item_view|product_detail|goods_detail|shopdetail)/i.test(path)) return false;
    return /\/(?:dp\/prod|i\/item|goods\/view|product\/detail|products?\/[^/?#]{1,}|items?\/[^/?#]{1,}|detail\/[^/?#]{1,}|goods\/(?:view|detail)\/[^/?#]{1,}|prd\/[^/?#]{1,})/i.test(path);
  } catch (_error) { return false; }
}

function normalizeTitle(value) {
  return lower(value)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/\[[^\]]{0,80}\]/g, " ")
    .replace(/\([^)]{0,80}\)/g, " ")
    .replace(/(?:lucky\s*\d+|주차\s*특가|온라인\s*단독|사은품\s*증정|포차코|본사\s*운영|한정\s*특가|특가|할인|이벤트)/gi, " ")
    .replace(/[^0-9a-z가-힣]+/g, "")
    .slice(0, 260);
}

function isGenericProductName(value) {
  const raw = text(value), normalized = normalizeTitle(raw);
  if (!raw || raw.length < 2 || !normalized) return true;
  if (/^(?:상품명\s*확인\s*중|상품|제품|상품목록|제품목록|제품별|브랜드별|카테고리|전체상품|전체보기|보기|상세|더보기|구매|결과|검색|검색결과|로그인|로그아웃|회원가입|마이페이지|장바구니|주문조회|상품\s*삭제|최근\s*검색어\s*전체삭제|전체삭제|품절|다른\s*기획전\s*보기|브랜드\s*사이트\s*목록\s*열기|사이트\s*목록\s*열기|업체\s*사이트\s*열기|공식\s*사이트\s*열기|원본\s*링크|shop|store|view|detail|list|result|results|login|logout|cart|search)$/i.test(raw)) return true;
  if (/^(?:new|best|sale|event|lucky\s*\d+|기획전|이벤트|추천상품)$/i.test(raw)) return true;
  if (/(?:사이트|브랜드|업체|공식몰).*(?:목록|열기|바로가기)$/i.test(raw)) return true;
  if (/(?:공식몰|브랜드몰|쇼핑몰|몰)\s*\|?.*(?:일상|행복|새로운|더\s*빛나게)|(?:일상|행복|새로운|더\s*빛나게).*(?:공식몰|브랜드몰|쇼핑몰)/i.test(raw)) return true;
  return false;
}


function normalizeFamilyTitle(value) {
  return normalizeTitle(value)
    .replace(/(?:\d+(?:[.,]\d+)?(?:ml|l|g|kg|mg|cm|mm|m|개|매|팩|입|병|봉|포|캔|세트|롤|겹|호|인치|oz|lb|pack|pcs|piece|set|roll)s?)/gi, "")
    .replace(/(?:\d+\s*[x×]\s*\d+)/gi, "")
    .replace(/(?:대용량|소용량|묶음|멀티팩|리필|본품|증정|선물세트|옵션|색상|컬러|사이즈|size|color|option|refill|bundle|multipack)/gi, "")
    .replace(/\d+/g, "")
    .slice(0, 220);
}

function imageFingerprint(value) {
  const url = canonicalProductUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const base = decodeURIComponent((parsed.pathname.split("/").pop() || "").toLowerCase())
      .replace(/(?:_main|_thumb|thumbnail|large|small|resize|\b\d{2,4}x\d{2,4}\b)/g, "")
      .replace(/[^0-9a-z가-힣]+/g, "");
    return hostKey(url) + "|" + base.slice(0, 180);
  } catch (_error) { return ""; }
}

function supplierKey(rowInput) {
  const row = plain(rowInput);
  return hostKey(first(row.supplierSiteUrl, row.supplierOfficialUrl, row.productUrl, row.url)) || lower(first(row.supplierId, row.supplierName)).replace(/[^0-9a-z가-힣]+/g, "_").slice(0, 160);
}

function productIdentity(rowInput) {
  const row = plain(rowInput), url = canonicalProductUrl(first(row.productUrl, row.url));
  const supplier = supplierKey(row), explicit = first(row.productSku, row.productSKU, row.sku, row.productId, row.product_id), urlId = productIdFromUrl(url);
  const title = normalizeTitle(first(row.productName, row.title)), image = imageFingerprint(first(row.imageUrl, row.imageOriginalUrl));
  if (supplier && explicit) return supplier + "|id:explicit:" + lower(explicit);
  if (supplier && urlId) return supplier + "|id:" + urlId;
  if (supplier && title && image) return supplier + "|fingerprint:" + sha256(title + "|" + image).slice(0, 28);
  if (supplier && url) return supplier + "|url:" + url;
  return supplier + "|unresolved:" + sha256(JSON.stringify([title, image, url])).slice(0, 28);
}

function productFamilyKey(rowInput) {
  const row = plain(rowInput), supplier = supplierKey(row), title = normalizeFamilyTitle(first(row.productName, row.title));
  return supplier + "|family:" + (title || productIdFromUrl(first(row.productUrl, row.url)) || sha256(first(row.productUrl, row.url)).slice(0, 18));
}

function displayFamilyKey(rowInput) {
  const row = plain(rowInput), title = normalizeFamilyTitle(first(row.productName, row.title));
  return "display-family:" + (title || productIdFromUrl(first(row.productUrl, row.url)) || sha256(first(row.productUrl, row.url)).slice(0, 18));
}

function classifyCategory(rowInput) {
  const row = plain(rowInput);
  const hay = lower([
    row.productName, row.title, row.priorityLabel, row.supplierName, row.supplierType,
    row.description, row.summary, row.productUrl
  ].map(text).join(" "));
  const scores = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0]));
  const add = (key, score, pattern) => { if (pattern.test(hay)) scores[key] += score; };

  add("food_household_essentials", 80, /(화장지|두루마리|휴지|티슈|물티슈|키친타올|생리대|위생|세제|세정제|주방용품|생활용품|생필품|식품|식료품|김치|장류|반찬|떡|한과|household|tissue|detergent|grocery|food)/i);
  add("food_household_essentials", 35, /(미용티슈|각티슈|롤화장지|배변패드|발티슈|키친타월|키친타올|생리대|오버나이트)/i);
  add("beauty_personal_care", 70, /(화장품|뷰티|스킨케어|세럼|크림|로션(?!\s*\d*겹)|선크림|샴푸|린스|클렌징|마스크팩|메이크업|향수|personal care|beauty|cosmetic|skincare)/i);
  add("fashion", 70, /(패션|의류|옷|신발|가방|주얼리|보석|반지|목걸이|귀걸이|시계|안경|fashion|apparel|jewelry|ring|watch|shoes|bag)/i);
  add("electronics_accessories", 70, /(전자|스마트폰|휴대폰|태블릿|컴퓨터|노트북|모니터|이어폰|헤드폰|충전기|케이블|카메라|electronics|smartphone|tablet|computer|laptop|charger|camera)/i);
  add("home_appliances_living", 65, /(가전|냉장고|세탁기|청소기|에어컨|공기청정기|가구|침구|조명|인테리어|home appliance|furniture|living|vacuum|refrigerator)/i);
  add("baby_family_education", 65, /(유아|아기|어린이|키즈|학생|교육|학습|도서|문구|장난감|baby|kids|child|education|book|toy)/i);
  add("agriculture_fishery_forestry", 80, /(버섯|표고|느타리|목이|송이|고사리|산채|임산물|밤|대추|호두|잣|꿀|약초|쌀|잡곡|콩|참깨|들깨|고춧가루|마늘|양파|과일|채소|농산물|한우|돼지고기|닭고기|계란|우유|축산물|수산물|건어물|김|미역|젓갈|전복|굴|새우|agriculture|fishery|forestry|farm|seafood)/i);
  add("travel_local_services", 80, /(여행|관광|숙박|호텔|리조트|체험|투어|티켓|렌터카|지역서비스|travel|tour|hotel|resort|experience|ticket|rental)/i);
  add("local_products", 55, /(로컬푸드|지역특산|특산품|향토|산지직송|농장|어촌|산촌|local product|regional specialty|farm direct)/i);
  add("manufacturer_brands", 50, /(공식몰|본사|제조사|제조업체|생산자|농협|축협|수협|산림조합|협동조합|영농조합|농업회사법인|manufacturer|official store|producer|cooperative)/i);
  add("manufacturer_brands", 75, /(공구|산업용품|기계|부품|금속|철강|플라스틱|고무|목재|포장재|전기자재|전자부품|자동차부품|건축자재|설비|안전용품|industrial|machinery|machine|tool|component|parts|metal|steel|plastic|rubber|packaging|electrical|hardware)/i);

  if (!Object.values(scores).some((score) => score > 0)) scores.manufacturer_brands = 15;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    primary: ranked[0][0],
    scores,
    tags: ranked.filter(([, score]) => score > 0).map(([key]) => key).slice(0, 5)
  };
}

function explicitRevenue(rowInput) {
  const row = plain(rowInput), affiliate = plain(row.affiliate), outbound = plain(row.outboundReferral), sponsor = plain(row.sponsor), revenue = plain(row.revenue);
  const affiliateReady = affiliate.approved === true && affiliate.status === "approved" && !!safeHttpsUrl(first(affiliate.trackingUrl, row.affiliateOutboundUrl));
  const referralReady = outbound.approved === true && outbound.operatorApproved === true && outbound.officialDestination === true && !!safeHttpsUrl(first(outbound.destinationUrl, row.externalOutboundUrl));
  const sponsorReady = sponsor.approved === true && sponsor.contractVerified === true && !!first(sponsor.contractId, revenue.contractId);
  const revenueType = sponsorReady ? "sponsor" : affiliateReady ? "affiliate" : referralReady ? "external_referral" : "commercial_candidate";
  return {
    contractReady: affiliateReady || referralReady || sponsorReady,
    sponsorReady,
    affiliateReady,
    referralReady,
    revenueType,
    monetizationState: affiliateReady || referralReady || sponsorReady ? "approved_contract" : "contract_required"
  };
}

function supplierAssessment(rowInput) {
  const row = plain(rowInput), decision = lower(first(row.supplierDecision, row.supplierStatus));
  const evidenceReady = row.supplierEvidenceReady === true;
  const approvalReady = row.supplierApprovalReady === true;
  const trustScore = Math.round(clamp(first(row.supplierTrustScore, row.trustScore), 0, 100, 0));
  const blockers = [], concerns = [];
  if (!evidenceReady) blockers.push("supplier_evidence_not_ready");
  if (["reject", "exclude", "suppressed"].includes(decision)) blockers.push("supplier_rejected_or_excluded");
  if (!approvalReady) concerns.push("supplier_approval_pending");
  if (trustScore < 82) concerns.push("supplier_trust_below_public_threshold");
  return {
    reviewEligible: blockers.length === 0,
    evidenceReady,
    approvalReady,
    trustScore,
    decision: decision || "unresolved",
    blockers,
    concerns,
    publicTrustThreshold: 82
  };
}

function riskAssessment(rowInput) {
  const row = plain(rowInput), url = canonicalProductUrl(first(row.productUrl, row.url)), image = safeProductImageUrl(first(row.imageUrl, row.imageOriginalUrl));
  const name = first(row.productName, row.title), blockers = [], concerns = [];
  const specificUrl = isSpecificProductUrl(url), genericName = isGenericProductName(name), sameSupplier = row.sameSupplierSite !== false && (!row.supplierSiteUrl || sameSite(row.supplierSiteUrl, url));
  const inspected = row.inspectionComplete === true, live = row.productPageLive !== false, ready = text(row.researchStatus) === "ready_for_admin_review";
  const productEvidence = row.jsonLdProduct === true || row.offerPresent === true || !!productIdFromUrl(url);
  const availability = lower(row.availability), explicitlyUnavailable = /outofstock|soldout|discontinued|preorderended/.test(availability);

  if (!url) blockers.push("missing_https_product_url");
  else if (!specificUrl) blockers.push("not_specific_product_page");
  if (!image) blockers.push("missing_https_product_image");
  if (genericName) blockers.push("generic_or_unresolved_product_name");
  if (!inspected) blockers.push("inspection_incomplete");
  if (!live) blockers.push("product_page_unavailable");
  if (!sameSupplier) blockers.push("supplier_site_mismatch");
  if (!ready) blockers.push("not_ready_for_admin_review");
  if (!productEvidence) blockers.push("product_evidence_insufficient");
  if (isTemplateOrPlaceholderUrl(url)) blockers.push("template_or_placeholder_url");
  if (isStaticOrApiUrl(url)) blockers.push("api_or_static_resource");
  if (isListOrCampaignUrl(url)) blockers.push("list_or_campaign_page");
  if (explicitlyUnavailable) blockers.push("explicitly_unavailable");
  if (!row.offerPresent) concerns.push("offer_not_confirmed");
  if (!text(row.price)) concerns.push("price_not_confirmed");
  if (!availability) concerns.push("availability_not_confirmed");

  const quality = Math.round(clamp(
    (specificUrl ? 18 : 0) + (image ? 14 : 0) + (!genericName ? 12 : 0) + (inspected ? 14 : 0) +
    (live ? 10 : 0) + (sameSupplier ? 10 : 0) + (row.jsonLdProduct === true ? 10 : 0) +
    (row.offerPresent === true ? 7 : 0) + (text(row.price) ? 3 : 0) + (availability ? 2 : 0),
    0, 100, 0
  ));
  const gatePassed = blockers.length === 0;
  return {
    gatePassed,
    qualityScore: quality,
    riskLevel: gatePassed ? (concerns.length <= 1 ? "low" : "controlled") : "hold",
    blockers: Array.from(new Set(blockers)),
    concerns: Array.from(new Set(concerns)),
    specificProductUrl: specificUrl,
    supplierSiteMatched: sameSupplier,
    explicitUnavailable: explicitlyUnavailable
  };
}

function commercialAssessment(rowInput, category, risk, contextInput) {
  const row = plain(rowInput), context = plain(contextInput), weights = plain(context.categoryWeights), revenue = explicitRevenue(row);
  const weight = Math.round(clamp(weights[category.primary], -20, 20, 0));
  const name = lower(first(row.productName, row.title)), availability = lower(row.availability), price = Number(String(row.price || "").replace(/[^0-9.\-]/g, ""));
  const promotional = /(한정|특가|할인|세트|증정|신제품|신상|season|limited|sale|bundle|gift|new)/i.test(name);
  const visual = !!safeProductImageUrl(first(row.imageUrl, row.imageOriginalUrl)) && (!!safeHttpsUrl(first(row.videoUrl, row.videoContentUrl, row.videoEmbedUrl)) || category.primary === "fashion" || category.primary === "beauty_personal_care");
  const inStock = /instock|in stock|available/.test(availability);
  let score = 18;
  score += risk.qualityScore * 0.42;
  score += row.offerPresent === true ? 9 : 0;
  score += Number.isFinite(price) && price > 0 ? 7 : 0;
  score += inStock ? 8 : 0;
  score += promotional ? 4 : 0;
  score += visual ? 4 : 0;
  score += row.supplierEvidenceReady === true ? 4 : 0;
  score += row.supplierApprovalReady === true ? 8 : 0;
  score += Math.min(8, Math.max(0, Number(row.supplierTrustScore) || 0) / 12.5);
  score += revenue.contractReady ? 10 : 0;
  score += weight * 0.6;
  score = Math.round(clamp(score, 0, 100, 0));
  if (!risk.gatePassed) score = Math.min(score, 39);
  return {
    potentialScore: score,
    marketSignalWeight: weight,
    monetizationState: revenue.monetizationState,
    revenueType: revenue.revenueType,
    contractReady: revenue.contractReady,
    sponsorReady: revenue.sponsorReady,
    promotional,
    visual,
    inStock,
    rankingEligible: risk.gatePassed,
    revenueRule: "commercial_potential_only_after_risk_gate"
  };
}

function proposedSections(rowInput, category, risk, commercial) {
  if (!risk.gatePassed) return [];
  const row = plain(rowInput), out = [];
  const add = (page, sectionKey, score, reason) => {
    if (!FRONT_SECTION_KEYS[page] || !FRONT_SECTION_KEYS[page].includes(sectionKey)) return;
    if (out.some((item) => item.page === page)) return;
    out.push({ key: page + "|" + sectionKey, page, sectionKey, score: Math.round(clamp(score, 0, 100, 0)), reason, proposalOnly: true });
  };

  const inspectedRecently = !!row.inspectedAt && Number.isFinite(Date.parse(row.inspectedAt)) && Date.now() - Date.parse(row.inspectedAt) <= 14 * 86400000;
  let distributionSection = "distribution-others";
  if (commercial.sponsorReady) distributionSection = "distribution-sponsor";
  else if (commercial.promotional && commercial.potentialScore >= 70) distributionSection = "distribution-special";
  else if (commercial.potentialScore >= 84) distributionSection = "distribution-recommend";
  else if (commercial.marketSignalWeight >= 5 && commercial.potentialScore >= 68) distributionSection = "distribution-trending";
  else if (inspectedRecently) distributionSection = "distribution-new";
  else if (commercial.visual && commercial.potentialScore >= 70) distributionSection = "distribution-right";
  add("distribution", distributionSection, commercial.potentialScore, "위험 게이트 통과 후 수익 가능성·시장 신호·상품 특성에 따른 단일 유통 섹션 제안");

  const homeMainMap = {
    food_household_essentials: "home_1",
    agriculture_fishery_forestry: "home_1",
    beauty_personal_care: "home_2",
    fashion: "home_2",
    electronics_accessories: "home_3",
    home_appliances_living: "home_3",
    baby_family_education: "home_4",
    travel_local_services: "home_4",
    local_products: "home_5",
    manufacturer_brands: "home_5"
  };
  let homeSection = homeMainMap[category.primary] || "home_5";
  if (commercial.visual && commercial.potentialScore >= 84) homeSection = "home_right_top";
  else if ((category.tags.includes("local_products") || category.tags.includes("agriculture_fishery_forestry")) && commercial.potentialScore >= 72) homeSection = "home_right_middle";
  else if (category.tags.includes("manufacturer_brands") && commercial.potentialScore >= 78) homeSection = "home_right_bottom";
  add("home", homeSection, commercial.potentialScore - 2, "홈 8개 실제 렌더러 중 상품당 단일 섹션 제안");

  const hay = lower([row.productName, row.supplierName, row.supplierType, category.tags.join(" ")].join(" "));
  if (/(manufacturer|producer|cooperative|제조|생산자|협동조합|농협|수협|산림조합|영농조합)/i.test(hay)) add("network", "network-right", commercial.potentialScore - 5, "제조·생산·조합형 공급 네트워크 적합");
  const localTourLink = (category.tags.includes("local_products") || category.tags.includes("agriculture_fishery_forestry")) && /(지역특산|특산품|기념품|체험|관광|숙박|tour|travel|experience)/i.test(hay);
  if (category.primary === "travel_local_services" || localTourLink) add("tour", "tour", commercial.potentialScore - 8, "관광·지역 체험·특산 연계 적합");
  if (commercial.visual || commercial.promotional) add("social", "rightPanel", commercial.potentialScore - 6, "시각·화제성이 높은 소셜 우측 후보");

  const pageOrder = { distribution: 0, home: 1, network: 2, tour: 3, social: 4 };
  const orderOf = (page) => Object.prototype.hasOwnProperty.call(pageOrder, page) ? pageOrder[page] : 99;
  return out.sort((a, b) => orderOf(a.page) - orderOf(b.page) || b.score - a.score || a.sectionKey.localeCompare(b.sectionKey));
}

function releaseReadiness(rowInput, risk, commercial, supplier) {
  const blockers = [];
  if (!risk.gatePassed) blockers.push("risk_gate_not_passed");
  if (!supplier.approvalReady) blockers.push("supplier_approval_not_complete");
  if (supplier.trustScore < supplier.publicTrustThreshold) blockers.push("supplier_trust_below_public_threshold");
  if (!commercial.contractReady) blockers.push("revenue_or_referral_contract_not_approved");
  return {
    releaseEligible: blockers.length === 0,
    blockers,
    administratorApprovalRequired: true,
    publicSnapshotWrite: false,
    paymentExecution: false
  };
}

function evaluateProduct(rowInput, contextInput) {
  const row = plain(rowInput), category = classifyCategory(row), productRisk = riskAssessment(row), supplier = supplierAssessment(row);
  const risk = Object.assign({}, productRisk, {
    productGatePassed: productRisk.gatePassed,
    supplierGatePassed: supplier.reviewEligible,
    gatePassed: productRisk.gatePassed && supplier.reviewEligible,
    blockers: Array.from(new Set(array(productRisk.blockers).concat(array(supplier.blockers)))),
    concerns: Array.from(new Set(array(productRisk.concerns).concat(array(supplier.concerns))))
  });
  const commercial = commercialAssessment(row, category, risk, contextInput);
  commercial.rankingEligible = risk.gatePassed;
  if (!risk.gatePassed) commercial.potentialScore = Math.min(Number(commercial.potentialScore) || 0, 39);
  const identity = productIdentity(row), family = productFamilyKey(row), displayFamily = displayFamilyKey(row), sections = proposedSections(row, category, risk, commercial), release = releaseReadiness(row, risk, commercial, supplier);
  return Object.assign({}, row, {
    productUrl: canonicalProductUrl(first(row.productUrl, row.url)) || first(row.productUrl, row.url),
    url: canonicalProductUrl(first(row.productUrl, row.url)) || first(row.productUrl, row.url),
    productIdentity: identity,
    duplicateGroupKey: identity,
    productFamilyKey: family,
    displayFamilyKey: displayFamily,
    supplierKey: supplierKey(row),
    supplierAssessment: supplier,
    productCategory: category.primary,
    productCategoryTags: category.tags,
    categoryScores: category.scores,
    riskAssessment: risk,
    commercialAssessment: commercial,
    releaseReadiness: release,
    rankingEligible: risk.gatePassed,
    rankingScore: commercial.potentialScore,
    recommendedDecision: risk.gatePassed ? "review_for_slot" : (risk.blockers.some((reason) => /api_or_static|list_or_campaign|generic_or_unresolved|supplier_rejected_or_excluded/.test(reason)) ? "reject" : "hold"),
    sectionAssignments: sections,
    primaryPlacement: sections[0] || null,
    publicPublication: false,
    automaticImport: false
  });
}

function rowQuality(rowInput) {
  const row = plain(rowInput);
  return (text(row.researchStatus) === "ready_for_admin_review" ? 1000 : 0) +
    (row.inspectionComplete === true ? 300 : 0) +
    (row.jsonLdProduct === true ? 120 : 0) +
    (row.offerPresent === true ? 90 : 0) +
    (safeProductImageUrl(first(row.imageUrl, row.imageOriginalUrl)) ? 80 : 0) +
    (text(row.price) ? 40 : 0) +
    (text(row.availability) ? 30 : 0) +
    (isSpecificProductUrl(first(row.productUrl, row.url)) ? 60 : 0);
}

function mergePair(leftInput, rightInput, reason) {
  const left = plain(leftInput), right = plain(rightInput);
  const primary = rowQuality(right) > rowQuality(left) ? right : left;
  const secondary = primary === right ? left : right;
  const merged = Object.assign({}, secondary, primary);
  const pickField = (name) => first(primary[name], secondary[name]);
  for (const name of ["productName", "title", "productUrl", "url", "imageUrl", "imageOriginalUrl", "videoUrl", "videoContentUrl", "videoEmbedUrl", "videoThumbnailUrl", "supplierId", "supplierName", "supplierSiteUrl", "supplierType", "price", "priceCurrency", "availability", "researchStatus"]) merged[name] = pickField(name);
  merged.inspectionComplete = left.inspectionComplete === true || right.inspectionComplete === true;
  merged.productPageLive = left.productPageLive !== false && right.productPageLive !== false;
  merged.sameSupplierSite = left.sameSupplierSite !== false && right.sameSupplierSite !== false;
  merged.jsonLdProduct = left.jsonLdProduct === true || right.jsonLdProduct === true;
  merged.offerPresent = left.offerPresent === true || right.offerPresent === true;
  merged.supplierEvidenceReady = left.supplierEvidenceReady === true || right.supplierEvidenceReady === true;
  merged.supplierApprovalReady = left.supplierApprovalReady === true || right.supplierApprovalReady === true;
  merged.supplierTrustScore = Math.max(Number(left.supplierTrustScore) || 0, Number(right.supplierTrustScore) || 0);
  merged.slotDecision = [left.slotDecision, right.slotDecision].find((value) => text(value) && text(value) !== "undecided") || "undecided";
  merged.decisionAt = first(left.decisionAt, right.decisionAt) || null;
  merged.decisionBy = first(left.decisionBy, right.decisionBy) || null;
  merged.duplicateCount = Math.max(1, Number(left.duplicateCount) || 1) + Math.max(1, Number(right.duplicateCount) || 1);
  merged.duplicateReason = reason || "exact_product_identity";
  merged.duplicateUrls = Array.from(new Set(array(left.duplicateUrls).concat(array(right.duplicateUrls), [first(left.productUrl, left.url), first(right.productUrl, right.url)].filter(Boolean)).map(canonicalProductUrl).filter(Boolean))).slice(0, 20);
  return merged;
}

function mergeProductRows(existingInput, incomingInput, optionsInput) {
  const options = plain(optionsInput), limit = Math.max(1, Math.min(2000, Number(options.limit) || 300));
  const out = [], index = new Map();
  for (const raw of array(existingInput).concat(array(incomingInput))) {
    const row = plain(raw), url = canonicalProductUrl(first(row.productUrl, row.url));
    if (!url) continue;
    const normalized = Object.assign({}, row, {
      id: text(row.id) || "product_ref_" + sha256(url + "|" + first(row.productName, row.title)).slice(0, 22),
      productUrl: url,
      url,
      imageUrl: safeProductImageUrl(first(row.imageUrl, row.imageOriginalUrl)),
      imageOriginalUrl: safeProductImageUrl(first(row.imageOriginalUrl, row.imageUrl)),
      slotDecision: text(row.slotDecision) || "undecided",
      publicPublication: false,
      automaticImport: false,
      duplicateCount: Math.max(1, Number(row.duplicateCount) || 1)
    });
    const identity = productIdentity(normalized);
    if (index.has(identity)) {
      const at = index.get(identity);
      const priorUrl = canonicalProductUrl(first(out[at].productUrl, out[at].url));
      const reason = productIdFromUrl(url) ? "same_supplier_product_id" : (priorUrl === url ? "same_supplier_canonical_url" : "same_supplier_title_image_fingerprint");
      out[at] = mergePair(out[at], normalized, reason);
    } else {
      index.set(identity, out.length);
      out.push(normalized);
    }
    if (out.length >= limit) break;
  }
  return out;
}

function arrangeDiverse(rowsInput) {
  const pending = array(rowsInput).slice(), out = [];
  let supplierRun = 0, categoryRun = 0, lastSupplier = "", lastCategory = "", lastDisplayFamily = "";
  while (pending.length) {
    const eligibleIndexes = [];
    for (let i = 0; i < pending.length; i += 1) {
      const row = pending[i], supplier = text(row.supplierKey), category = text(row.productCategory), family = text(row.displayFamilyKey);
      const noAdjacentFamily = !lastDisplayFamily || family !== lastDisplayFamily;
      const supplierOk = supplier !== lastSupplier || supplierRun < POLICY.maxSupplierRun;
      const categoryOk = category !== lastCategory || categoryRun < POLICY.maxCategoryRun;
      if (noAdjacentFamily && supplierOk && categoryOk) eligibleIndexes.push(i);
    }
    let pick = eligibleIndexes[0];
    if (pick == null) pick = pending.findIndex((row) => !lastDisplayFamily || text(row.displayFamilyKey) !== lastDisplayFamily);
    if (pick < 0) pick = pending.findIndex((row) => text(row.supplierKey) !== lastSupplier || supplierRun < POLICY.maxSupplierRun);
    if (pick < 0) pick = 0;
    const row = pending.splice(pick, 1)[0], supplier = text(row.supplierKey), category = text(row.productCategory), family = text(row.displayFamilyKey);
    supplierRun = supplier === lastSupplier ? supplierRun + 1 : 1;
    categoryRun = category === lastCategory ? categoryRun + 1 : 1;
    lastSupplier = supplier; lastCategory = category; lastDisplayFamily = family;
    out.push(row);
  }
  return out;
}

function buildSectionQueues(rankedInput) {
  const queues = {};
  for (const product of array(rankedInput).filter((row) => row.rankingEligible === true)) {
    for (const assignment of array(product.sectionAssignments)) {
      const key = assignment.page + ":" + assignment.sectionKey;
      if (!queues[key]) queues[key] = [];
      queues[key].push(Object.assign({}, product, { targetAssignment: assignment }));
    }
  }
  const output = {}, counts = {};
  for (const [key, rows] of Object.entries(queues)) {
    const ordered = arrangeDiverse(rows.sort((a, b) =>
      Number(b.targetAssignment && b.targetAssignment.score || 0) - Number(a.targetAssignment && a.targetAssignment.score || 0) ||
      Number(b.rankingScore || 0) - Number(a.rankingScore || 0) ||
      first(a.productName, a.title).localeCompare(first(b.productName, b.title))
    ));
    output[key] = ordered.map((row, index) => ({
      position: index + 1,
      id: text(row.id),
      productIdentity: text(row.productIdentity),
      displayFamilyKey: text(row.displayFamilyKey),
      supplierKey: text(row.supplierKey),
      supplierName: text(row.supplierName),
      productName: first(row.productName, row.title),
      productUrl: first(row.productUrl, row.url),
      imageUrl: first(row.imageUrl, row.imageOriginalUrl),
      category: text(row.productCategory),
      rankingScore: Number(row.rankingScore) || 0,
      assignment: row.targetAssignment,
      proposalOnly: true,
      publicPublication: false
    }));
    counts[key] = output[key].length;
  }
  return { queues: output, counts };
}

function markFamilyRepresentatives(evaluatedInput) {
  const rows = array(evaluatedInput), representativeByFamily = new Map(), familySizes = new Map();
  for (const row of rows) {
    const key = text(row.productFamilyKey) || text(row.productIdentity);
    familySizes.set(key, (familySizes.get(key) || 0) + 1);
    if (!representativeByFamily.has(key)) representativeByFamily.set(key, text(row.id));
  }
  return rows.map((row) => {
    const key = text(row.productFamilyKey) || text(row.productIdentity), representativeId = representativeByFamily.get(key) || text(row.id);
    const representative = text(row.id) === representativeId;
    return Object.assign({}, row, {
      familyRepresentative: representative,
      familyRepresentativeId: representativeId || null,
      familyVariant: !representative,
      familyVariantCount: Math.max(0, Number(familySizes.get(key) || 1) - 1),
      familyVariantReason: representative ? null : "same_supplier_product_family_variant",
      rankingEligible: representative ? row.rankingEligible === true : false,
      recommendedDecision: representative ? row.recommendedDecision : "hold_family_variant",
      sectionAssignments: representative ? array(row.sectionAssignments) : [],
      primaryPlacement: representative ? row.primaryPlacement : null
    });
  });
}

function buildPortfolio(rowsInput, contextInput) {
  const inputRows = array(rowsInput), merged = mergeProductRows([], inputRows, { limit: Math.max(300, inputRows.length) });
  const evaluatedBase = merged.map((row) => evaluateProduct(row, contextInput)).sort((a, b) =>
    Number(b.rankingEligible === true) - Number(a.rankingEligible === true) ||
    Number(b.rankingScore || 0) - Number(a.rankingScore || 0) ||
    Number(b.riskAssessment && b.riskAssessment.qualityScore || 0) - Number(a.riskAssessment && a.riskAssessment.qualityScore || 0) ||
    first(a.productName, a.title).localeCompare(first(b.productName, b.title))
  );
  const evaluated = markFamilyRepresentatives(evaluatedBase);
  const eligible = arrangeDiverse(evaluated.filter((row) => row.rankingEligible === true && row.familyRepresentative !== false));
  const variants = evaluated.filter((row) => row.familyVariant === true);
  const held = evaluated.filter((row) => row.familyVariant !== true && row.rankingEligible !== true);
  const ranked = eligible.concat(variants, held).map((row, index) => Object.assign({}, row, {
    rank: row.rankingEligible === true ? index + 1 : null,
    reviewOrder: index + 1
  }));
  const sectionPortfolio = buildSectionQueues(eligible);
  return {
    version: VERSION,
    policy: POLICY,
    products: ranked,
    sectionQueues: sectionPortfolio.queues,
    summary: {
      input: inputRows.length,
      exactDuplicatesRemoved: Math.max(0, inputRows.length - merged.length),
      uniqueProducts: merged.length,
      familyRepresentatives: evaluated.filter((row) => row.familyRepresentative === true).length,
      familyVariantsSuppressed: variants.length,
      rankingEligible: eligible.length,
      riskHeld: held.length,
      supplierEvidenceReady: ranked.filter((row) => row.supplierAssessment && row.supplierAssessment.evidenceReady === true).length,
      contractReady: ranked.filter((row) => row.commercialAssessment && row.commercialAssessment.contractReady === true).length,
      releaseReady: ranked.filter((row) => row.releaseReadiness && row.releaseReadiness.releaseEligible === true).length,
      proposedPlacementProducts: eligible.filter((row) => array(row.sectionAssignments).length > 0).length,
      sectionCounts: sectionPortfolio.counts
    }
  };
}

function isReviewableProduct(rowInput) {
  const row = plain(rowInput), url = first(row.productUrl, row.url), name = first(row.productName, row.title);
  if (!safeHttpsUrl(url) || isStaticOrApiUrl(url) || isListOrCampaignUrl(url) || isGenericProductName(name)) return false;
  return row.jsonLdProduct === true || isSpecificProductUrl(url);
}

module.exports = {
  VERSION,
  POLICY,
  CATEGORY_KEYS,
  FRONT_SECTION_KEYS,
  canonicalProductUrl,
  safeProductImageUrl,
  isTemplateOrPlaceholderUrl,
  productIdFromUrl,
  productIdentity,
  productFamilyKey,
  displayFamilyKey,
  supplierKey,
  isSpecificProductUrl,
  isReviewableProduct,
  isGenericProductName,
  normalizeFamilyTitle,
  classifyCategory,
  supplierAssessment,
  riskAssessment,
  commercialAssessment,
  evaluateProduct,
  mergeProductRows,
  arrangeDiverse,
  buildSectionQueues,
  markFamilyRepresentatives,
  buildPortfolio
};
