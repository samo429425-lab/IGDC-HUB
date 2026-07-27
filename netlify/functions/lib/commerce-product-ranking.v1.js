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

const VERSION = "commerce-product-ranking-v1.8.0-private-review-section-auto-and-front-gate";

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

const SECTION_CAPACITY = 100;
const SECTION_ORDER = Object.freeze([
  "home|home_1", "home|home_2", "home|home_3", "home|home_4", "home|home_5",
  "home|home_right_top", "home|home_right_middle", "home|home_right_bottom",
  "distribution|distribution-recommend", "distribution|distribution-sponsor",
  "distribution|distribution-trending", "distribution|distribution-new",
  "distribution|distribution-special", "distribution|distribution-others",
  "distribution|distribution-right", "network|network-right", "social|rightPanel", "tour|tour"
]);

// Derived from data/commerce-candidate-policy.v1.json.  The additional
// audience-demand, transaction-frequency and unit-revenue dimensions implement
// the administrator requirement that neither raw commission nor raw popularity
// alone may dominate the portfolio.
const VALUE_WEIGHTS = Object.freeze({
  sourcePriority: 50,
  audienceDemand: 20,
  essentiality: 24,
  affordability: 10,
  repeatPurchase: 8,
  sellerTrust: 18,
  marketReadiness: 22,
  revenueCertainty: 24,
  transactionFrequency: 16,
  unitRevenue: 10,
  expectedNetRevenue: 12,
  searchExposure: 6,
  conversionQuality: 8,
  trafficValue: 4,
  operatorCostPenalty: 14,
  riskPenalty: 30
});

const CATEGORY_VALUE_PRIORS = Object.freeze({
  local_products: Object.freeze({ essentiality: 62, broadAppeal: 60, repeatPurchase: 58, operationalFriction: 28 }),
  manufacturer_brands: Object.freeze({ essentiality: 48, broadAppeal: 54, repeatPurchase: 32, operationalFriction: 34 }),
  food_household_essentials: Object.freeze({ essentiality: 96, broadAppeal: 90, repeatPurchase: 92, operationalFriction: 20 }),
  beauty_personal_care: Object.freeze({ essentiality: 78, broadAppeal: 76, repeatPurchase: 84, operationalFriction: 22 }),
  fashion: Object.freeze({ essentiality: 54, broadAppeal: 66, repeatPurchase: 44, operationalFriction: 38 }),
  electronics_accessories: Object.freeze({ essentiality: 72, broadAppeal: 78, repeatPurchase: 30, operationalFriction: 32 }),
  home_appliances_living: Object.freeze({ essentiality: 70, broadAppeal: 72, repeatPurchase: 24, operationalFriction: 48 }),
  baby_family_education: Object.freeze({ essentiality: 76, broadAppeal: 62, repeatPurchase: 64, operationalFriction: 30 }),
  agriculture_fishery_forestry: Object.freeze({ essentiality: 88, broadAppeal: 78, repeatPurchase: 82, operationalFriction: 28 }),
  travel_local_services: Object.freeze({ essentiality: 44, broadAppeal: 58, repeatPurchase: 26, operationalFriction: 42 })
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
  sectionCapacity: SECTION_CAPACITY,
  primaryPlacementPolicy: "audience_and_revenue_value_first_then_category_fit_then_capacity_ceiling",
  fillPolicy: "never_fill_sections_for_count; leave_unqualified_or_full_items_unassigned",
  valueRankingRule: "trust_gate_then_audience_need_then_transaction_frequency_and_total_expected_value; verified_revenue_right_outranks_unverified_opportunity",
  valueWeights: VALUE_WEIGHTS,
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
function bool(value) { return value === true || ["1","true","yes","on","approved","verified","active","enabled","ready"].includes(lower(value)); }
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function finiteNumber(value, fallback) {
  const raw = String(value == null ? "" : value).replace(/[^0-9.\-]/g, "");
  if (!raw || raw === "-" || raw === "." || raw === "-.") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function ratio01(value, fallback) {
  const n = finiteNumber(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n > 1 ? n / 100 : n, 0, 1, fallback);
}
function logScore(value, scale) {
  const n = Math.max(0, finiteNumber(value, 0));
  const base = Math.max(1, finiteNumber(scale, 1));
  return Math.round(clamp(Math.log1p(n) / Math.log1p(base) * 100, 0, 100, 0));
}
function median(valuesInput) {
  const values = array(valuesInput).map((value) => finiteNumber(value, NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
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
  if (/(?:[?&](?:goodsno|goods_no|productno|product_no|productid|product_id|itemno|item_no|itemid|item_id|prdno|prd_no|sku|skuid|code|idx|no)=)(?:$|[&#])/i.test(raw)) return true;
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
  if (raw.length > 220) return true;
  if (/(?:\br\.push\s*\(|\b(?:item|product|goods)\.[a-z_$][\w$]*|document\.|window\.|function\s*\(|=>|<\/?script\b|getCurrency\s*\()/i.test(raw)) return true;
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
  const productHay = lower([
    row.productName, row.title, row.priorityLabel, row.description, row.summary, row.productUrl
  ].map(text).join(" "));
  const supplierHay = lower([
    row.supplierName, row.supplierOfficialName, row.supplierDescription, row.officialDirectoryName
  ].map(text).join(" "));
  const combinedHay = productHay + " " + supplierHay;
  const scores = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0]));
  const addProduct = (key, score, pattern) => { if (pattern.test(productHay)) scores[key] += score; };
  const addSupplier = (key, score, pattern) => { if (pattern.test(supplierHay)) scores[key] += score; };
  const addCombined = (key, score, pattern) => { if (pattern.test(combinedHay)) scores[key] += score; };

  addProduct("food_household_essentials", 80, /(화장지|두루마리|휴지|티슈|물티슈|키친타올|생리대|위생|세제|세정제|주방용품|생활용품|생필품|식료품|건강식품|가공식품|즉석식품|냉동식품|신선식품|수입식품|유기농식품|(?:^|[^가-힣])식품(?:[^가-힣]|$)|김치|장류|반찬|떡|한과|household|tissue|detergent|grocery|food)/i);
  addProduct("food_household_essentials", 35, /(미용티슈|각티슈|롤화장지|배변패드|발티슈|키친타월|키친타올|생리대|오버나이트)/i);
  addProduct("beauty_personal_care", 85, /(화장품|뷰티|스킨케어|세럼|크림|로션(?!\s*\d*겹)|선크림|샴푸|린스|클렌징|마스크팩|메이크업|향수|미스트|그루밍|이어클리너|이어클렌저|personal care|beauty|cosmetic|skincare|grooming)/i);
  addProduct("fashion", 75, /(패션|의류|옷|신발|가방|주얼리|보석|반지|목걸이|귀걸이|시계|안경|fashion|apparel|jewelry|ring|watch|shoes|bag)/i);
  addProduct("electronics_accessories", 80, /(전자|스마트폰|휴대폰|태블릿|컴퓨터|노트북|모니터|이어폰|헤드폰|충전기|케이블|카메라|어댑터|아답터|커넥터|리모컨|전원부|센서|컨트롤러|electronics|smartphone|tablet|computer|laptop|charger|camera|adapter|connector|remote control)/i);
  addProduct("home_appliances_living", 75, /(가전|냉장고|세탁기|청소기|에어컨|공기청정기|가구|침구|조명|인테리어|온수매트|전기요|전기장판|카본매트|냉온수|난방|써큘레이터|선풍기|펫하우스|메밀베개|베개|매트커버|클린필터|에어펌프|home appliance|furniture|living|vacuum|refrigerator|heated mat|electric blanket|circulator|fan)/i);
  addProduct("baby_family_education", 75, /(유아|아기|어린이|키즈|학생|교육|학습|도서|문구|장난감|아기물티슈|유아용|보솜이|baby|kids|child|education|book|toy)/i);
  addProduct("agriculture_fishery_forestry", 85, /(버섯|표고|느타리|목이|송이|고사리|산채|임산물|밤|대추|호두|잣|꿀|약초|쌀|잡곡|콩|참깨|들깨|고춧가루|마늘|양파|과일|채소|농산물|한우|돼지고기|닭고기|계란|우유|축산물|수산물|건어물|김|미역|젓갈|전복|굴|새우|agriculture|fishery|forestry|farm|seafood)/i);
  addProduct("travel_local_services", 90, /(여행(?!용)|관광|숙박|호텔|리조트|체험|투어|입장권|여행티켓|렌터카|지역서비스|travel(?!\s*size)|tour|hotel|resort|experience|admission|rental car)/i);
  addCombined("local_products", 55, /(로컬푸드|지역특산|특산품|향토|산지직송|농장|어촌|산촌|local product|regional specialty|farm direct)/i);
  addSupplier("manufacturer_brands", 50, /(공식몰|본사|제조사|제조업체|생산자|manufacturer|official store|producer|brand)/i);
  addProduct("manufacturer_brands", 75, /(공구|산업용품|기계|부품|금속|철강|플라스틱|고무|목재|포장재|전기자재|전자부품|자동차부품|건축자재|설비|안전용품|industrial|machinery|machine|tool|component|parts|metal|steel|plastic|rubber|packaging|electrical|hardware)/i);

  if (!Object.values(scores).some((score) => score > 0)) scores.manufacturer_brands = 15;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    primary: ranked[0][0],
    scores,
    tags: ranked.filter(([, score]) => score > 0).map(([key]) => key).slice(0, 5)
  };
}

function metricContainers(rowInput) {
  const row = plain(rowInput);
  return [
    row,
    plain(row.revenue),
    plain(row.affiliate),
    plain(row.affiliateSettlement),
    plain(row.outboundReferral),
    plain(row.sponsor),
    plain(row.analytics),
    plain(row.marketMetrics),
    plain(row.performance),
    plain(row.signals),
    plain(row.evidence),
    plain(plain(row.commerceCandidate).revenue),
    plain(plain(row.candidateSelection).revenue)
  ];
}

function firstMetric(rowInput, namesInput, fallback) {
  const names = array(namesInput);
  for (const container of metricContainers(rowInput)) {
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(container, name)) continue;
      const value = finiteNumber(container[name], NaN);
      if (Number.isFinite(value)) return value;
    }
  }
  return fallback;
}

function anyEvidenceFlag(rowInput, namesInput) {
  const names = array(namesInput);
  for (const container of metricContainers(rowInput)) {
    for (const name of names) {
      if (bool(container[name])) return true;
    }
  }
  return false;
}

function explicitRevenue(rowInput) {
  const row = plain(rowInput), affiliate = plain(row.affiliate), outbound = plain(row.outboundReferral), sponsor = plain(row.sponsor), revenue = plain(row.revenue), settlement = plain(row.affiliateSettlement), settlementStage = lower(settlement.stage);
  const nestedCandidateRevenue = plain(plain(row.commerceCandidate).revenue), nestedSelectionRevenue = plain(plain(row.candidateSelection).revenue);
  const route = Object.assign({}, nestedCandidateRevenue, nestedSelectionRevenue, revenue);
  const revenueTypeRaw = lower(first(route.type, route.revenueType, affiliate.type, outbound.type, sponsor.type));
  const allowedRevenueTypes = new Set(["advertising","affiliate","brokerage","external_referral","lead","manual_affiliate","referral","sponsor"]);
  const payoutBasisVerified = anyEvidenceFlag(row, ["payoutBasisVerified","payout_basis_verified","settlementVerified","settlementModeVerified"]);
  const disclosureReady = anyEvidenceFlag(row, ["disclosureReady","disclosureApproved","sponsorDisclosure","sponsorDisclosureApproved"]);
  const counterparty = first(settlement.counterparty, settlement.providerName, route.counterparty, route.providerName, affiliate.providerName, outbound.providerName, sponsor.counterparty);
  const contractId = first(settlement.contractId, settlement.programId, route.contractId, route.programId, affiliate.contractId, affiliate.programId, outbound.contractId, sponsor.contractId);
  const settlementMode = lower(first(settlement.settlementMode, route.settlementMode, route.payoutBasis, route.payoutType, affiliate.settlementMode, outbound.settlementMode, sponsor.settlementMode));
  const settlementTrackingUrl = safeHttpsUrl(first(settlement.trackingUrl, settlement.destinationUrl));
  const settlementBaseReady = settlement.settlementReady === true && settlement.payoutBasisVerified === true && settlement.trackingVerified === true && settlement.officialDestination === true && !!settlementTrackingUrl && !!counterparty && !!settlementMode;
  const affiliateReady = (affiliate.approved === true && lower(affiliate.status) === "approved" && !!safeHttpsUrl(first(affiliate.trackingUrl, row.affiliateOutboundUrl))) || (["online_affiliate_active","formal_partner"].includes(settlementStage) && settlementBaseReady && !!contractId);
  const referralReady = (outbound.approved === true && outbound.operatorApproved === true && outbound.officialDestination === true && !!safeHttpsUrl(first(outbound.destinationUrl, row.externalOutboundUrl))) || (settlementStage === "referral_verified" && settlementBaseReady);
  const sponsorReady = sponsor.approved === true && sponsor.contractVerified === true && !!first(sponsor.contractId, route.contractId);
  const directPayable = (settlementStage === "formal_partner" && settlementBaseReady && settlement.contractVerified === true && !!contractId) || route.payable === true || (
    allowedRevenueTypes.has(revenueTypeRaw) && revenueTypeRaw !== "external_referral" &&
    lower(first(route.status, route.approvalState)) === "approved" && !!contractId && !!counterparty &&
    disclosureReady && payoutBasisVerified
  );
  const contractReady = affiliateReady || referralReady || sponsorReady || directPayable;
  const trafficOnly = route.monetizationState === "traffic_value_only_review" || (revenueTypeRaw === "external_referral" && !directPayable);
  const revenueType = sponsorReady ? "sponsor" : affiliateReady ? "affiliate" : referralReady ? "external_referral" : (allowedRevenueTypes.has(revenueTypeRaw) ? revenueTypeRaw : "commercial_candidate");

  const metricsVerified = anyEvidenceFlag(row, ["serverVerified","metricsVerified","revenueMetricsVerified","marketMetricsVerified","verifiedByServer"]);
  const commissionRate = ratio01(firstMetric(row, ["commissionRate","commission_rate","commissionPercent","commissionPct"], NaN), NaN);
  const payoutPerTransaction = firstMetric(row, ["payoutPerTransaction","payout_per_transaction","commissionAmount","commission_amount","feePerOrder","fee_per_order","leadFee","cpaAmount"], NaN);
  const expectedTransactions = firstMetric(row, ["verifiedExpectedTransactions","expectedTransactions","expected_transactions","expectedOrders","expected_orders","monthlyOrders","monthly_orders"], NaN);
  const expectedConversionRate = ratio01(firstMetric(row, ["verifiedExpectedConversionRate","expectedConversionRate","expected_conversion_rate","conversionRate","conversion_rate"], NaN), NaN);
  const expectedNetRevenue = firstMetric(row, ["verifiedExpectedNetRevenue","expectedNetRevenue","expected_net_revenue","monthlyExpectedNetRevenue","monthly_expected_net_revenue"], NaN);
  const verifiedImpressions = firstMetric(row, ["verifiedImpressions","serverVerifiedImpressions"], NaN);
  const verifiedClicks = firstMetric(row, ["verifiedOutboundClicks","serverVerifiedOutboundClicks","verifiedClicks"], NaN);
  const verifiedConversions = firstMetric(row, ["verifiedConversions","serverVerifiedConversions","verifiedOrders"], NaN);

  return {
    contractReady,
    directPayable,
    sponsorReady,
    affiliateReady,
    referralReady,
    trafficOnly,
    affiliateSettlementStage: settlementStage || "connection_required",
    affiliateSettlementReady: settlementBaseReady,
    revenueType,
    contractId: contractId || null,
    counterparty: counterparty || null,
    settlementMode: settlementMode || null,
    payoutBasisVerified,
    disclosureReady,
    metricsVerified,
    commissionRate: Number.isFinite(commissionRate) ? commissionRate : null,
    payoutPerTransaction: Number.isFinite(payoutPerTransaction) && payoutPerTransaction >= 0 ? payoutPerTransaction : null,
    expectedTransactions: Number.isFinite(expectedTransactions) && expectedTransactions >= 0 ? expectedTransactions : null,
    expectedConversionRate: Number.isFinite(expectedConversionRate) ? expectedConversionRate : null,
    expectedNetRevenue: Number.isFinite(expectedNetRevenue) && expectedNetRevenue >= 0 ? expectedNetRevenue : null,
    verifiedImpressions: Number.isFinite(verifiedImpressions) && verifiedImpressions >= 0 ? verifiedImpressions : null,
    verifiedClicks: Number.isFinite(verifiedClicks) && verifiedClicks >= 0 ? verifiedClicks : null,
    verifiedConversions: Number.isFinite(verifiedConversions) && verifiedConversions >= 0 ? verifiedConversions : null,
    monetizationState: settlementStage === "formal_partner" && contractReady ? "formal_partner_active" : settlementStage === "online_affiliate_active" && contractReady ? "online_affiliate_active" : settlementStage === "referral_verified" && contractReady ? "referral_revenue_verified" : contractReady ? "approved_contract" : (trafficOnly ? "traffic_value_only_review" : "affiliate_connection_required")
  };
}

function portfolioContext(rowsInput, contextInput) {
  const context = Object.assign({}, plain(contextInput));
  const buckets = {};
  for (const row of array(rowsInput)) {
    const price = finiteNumber(row && row.price, NaN), currency = upper(first(row && row.priceCurrency, "UNKNOWN"));
    if (!Number.isFinite(price) || price <= 0) continue;
    const category = classifyCategory(row).primary, key = category + "|" + currency;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(price);
  }
  context.priceBenchmarks = Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, median(values)]));
  context.valueWeights = VALUE_WEIGHTS;
  return context;
}

function upper(value) { return text(value).toUpperCase(); }

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
  const name = lower(first(row.productName, row.title)), availability = lower(row.availability), price = finiteNumber(row.price, NaN);
  const promotional = /(한정|특가|할인|세트|증정|신제품|신상|season|limited|sale|bundle|gift|new)/i.test(name);
  const visual = !!safeProductImageUrl(first(row.imageUrl, row.imageOriginalUrl)) && (!!safeHttpsUrl(first(row.videoUrl, row.videoContentUrl, row.videoEmbedUrl)) || category.primary === "fashion" || category.primary === "beauty_personal_care");
  const inStock = /instock|in stock|available/.test(availability);
  const marketReadinessScore = Math.round(clamp(
    (row.offerPresent === true ? 25 : 0) + (Number.isFinite(price) && price > 0 ? 18 : 0) +
    (inStock ? 24 : 0) + (safeProductImageUrl(first(row.imageUrl, row.imageOriginalUrl)) ? 12 : 0) +
    (row.productPageLive !== false ? 10 : 0) + (row.inspectionComplete === true ? 11 : 0),
    0, 100, 0
  ));
  const sourcePotential = revenue.contractReady ? 90 : (revenue.trafficOnly ? 36 : 24);
  let score = Math.round(clamp(
    risk.qualityScore * 0.34 + marketReadinessScore * 0.28 + sourcePotential * 0.18 +
    (promotional ? 4 : 0) + (visual ? 4 : 0) + weight * 0.6 +
    (row.supplierEvidenceReady === true ? 4 : 0) + (row.supplierApprovalReady === true ? 8 : 0),
    0, 100, 0
  ));
  if (!risk.gatePassed) score = Math.min(score, 39);
  return {
    potentialScore: score,
    marketSignalWeight: weight,
    marketReadinessScore,
    monetizationState: revenue.monetizationState,
    revenueType: revenue.revenueType,
    contractReady: revenue.contractReady,
    sponsorReady: revenue.sponsorReady,
    revenueEvidence: revenue,
    promotional,
    visual,
    inStock,
    rankingEligible: risk.gatePassed,
    revenueRule: "commercial_potential_only_after_risk_gate; public_release_requires_verified_payable_right"
  };
}

function audienceValueAssessment(rowInput, category, risk, commercial, contextInput) {
  const row = plain(rowInput), context = plain(contextInput), priors = plain(CATEGORY_VALUE_PRIORS[category.primary]);
  const hay = lower([row.productName, row.title, row.description, row.summary, row.priorityLabel, row.badge, row.badges].map(text).join(" "));
  const revenue = plain(commercial.revenueEvidence);
  let essentiality = Number(priors.essentiality || 45), broadAppeal = Number(priors.broadAppeal || 50), repeatPurchase = Number(priors.repeatPurchase || 35);

  if (/(화장지|휴지|티슈|물티슈|세제|비누|치약|샴푸|식품|쌀|잡곡|채소|과일|고기|생리대|위생|기저귀|cleaner|detergent|grocery|food|hygiene)/i.test(hay)) {
    essentiality = Math.max(essentiality, 90); broadAppeal = Math.max(broadAppeal, 82); repeatPurchase = Math.max(repeatPurchase, 86);
  }
  if (/(충전기|케이블|보조배터리|이어폰|전구|조명|청소기|소형가전|charger|cable|power bank|earphone|lamp|vacuum)/i.test(hay)) {
    essentiality = Math.max(essentiality, 72); broadAppeal = Math.max(broadAppeal, 76);
  }
  if (/(가구|침대|소파|냉장고|세탁기|에어컨|대형가전|furniture|sofa|refrigerator|washer|air conditioner)/i.test(hay)) repeatPurchase = Math.min(repeatPurchase, 18);

  let narrowDemandPenalty = 0;
  if (/(as\s*전용|a\/s\s*전용|전용\s*부품|교체용\s*부품|수리용|어댑터만|커넥터만|리모컨만|필터만|부속품|replacement\s*part|spare\s*part|service\s*part)/i.test(hay)) narrowDemandPenalty += 34;
  if (/(한정판|수집용|컬렉터|명품|초고가|limited edition|collector|luxury)/i.test(hay)) narrowDemandPenalty += 12;
  if (/(품절|판매중지|단종|sold out|discontinued)/i.test(hay)) narrowDemandPenalty += 45;

  const verifiedDemandEvidence = anyEvidenceFlag(row, ["trendEvidence","marketDemandEvidence","verifiedDemandEvidence","serverVerifiedDemand","demandVerified"]);
  const officialDemandWording = row.productPageLive !== false && /(베스트(?:셀러)?|인기상품|판매\s*상위|재구매|best\s*seller|most\s*popular|repeat\s*purchase)/i.test(hay);
  let demandEvidenceScore = verifiedDemandEvidence ? 86 : (officialDemandWording ? 58 : 22);
  if (Number(revenue.verifiedImpressions || 0) >= 100) demandEvidenceScore = Math.max(demandEvidenceScore, Math.min(100, 55 + logScore(revenue.verifiedImpressions, 1000000) * 0.45));
  if (Number(revenue.verifiedClicks || 0) >= 10) demandEvidenceScore = Math.max(demandEvidenceScore, Math.min(100, 60 + logScore(revenue.verifiedClicks, 100000) * 0.4));

  const currency = upper(first(row.priceCurrency, "UNKNOWN")), benchmarkKey = category.primary + "|" + currency;
  const benchmark = finiteNumber(plain(context.priceBenchmarks)[benchmarkKey], 0), price = finiteNumber(row.price, NaN);
  let affordabilityScore = Number.isFinite(price) && price > 0 ? 50 : 15;
  if (benchmark > 0 && Number.isFinite(price) && price > 0) {
    const ratio = price / benchmark;
    affordabilityScore = ratio <= 1 ? 62 + Math.min(28, (1 - ratio) * 28) : 62 - Math.min(42, Math.log2(ratio) * 18);
  }
  if (anyEvidenceFlag(row, ["affordabilityEvidence","priceCompetitivenessVerified","valueForMoneyEvidence"])) affordabilityScore = Math.max(affordabilityScore, 78);
  affordabilityScore = Math.round(clamp(affordabilityScore, 0, 100, 0));

  const marketReadiness = Number(commercial.marketReadinessScore || 0);
  const audienceDemandScore = Math.round(clamp(
    broadAppeal * 0.26 + essentiality * 0.20 + repeatPurchase * 0.16 + demandEvidenceScore * 0.22 + marketReadiness * 0.16 - narrowDemandPenalty,
    0, 100, 0
  ));
  const audienceQualified = risk.gatePassed === true && marketReadiness >= 30 && audienceDemandScore >= 45 && (narrowDemandPenalty < 40 || verifiedDemandEvidence);
  return {
    audienceDemandScore,
    essentialityScore: Math.round(clamp(essentiality, 0, 100, 0)),
    broadAppealScore: Math.round(clamp(broadAppeal, 0, 100, 0)),
    repeatPurchaseScore: Math.round(clamp(repeatPurchase, 0, 100, 0)),
    affordabilityScore,
    demandEvidenceScore: Math.round(clamp(demandEvidenceScore, 0, 100, 0)),
    marketReadinessScore: marketReadiness,
    narrowDemandPenalty,
    audienceQualified,
    demandEvidenceState: verifiedDemandEvidence ? "verified" : (officialDemandWording ? "official_wording_proxy" : "category_proxy_only"),
    necessityClass: essentiality >= 85 ? "essential" : (essentiality >= 65 ? "high_utility" : (essentiality >= 45 ? "general_utility" : "discretionary"))
  };
}

function revenueValueAssessment(rowInput, audience, commercial) {
  const row = plain(rowInput), revenue = plain(commercial.revenueEvidence), price = finiteNumber(row.price, NaN);
  const sourceTier = lower(first(row.sourceTier, row.supplyLane, row.candidateSourceTier));
  let sourcePriorityScore = 24;
  if (revenue.affiliateSettlementStage === "formal_partner" && revenue.contractReady) sourcePriorityScore = 100;
  else if (/approved_commerce_member|direct_member/.test(sourceTier)) sourcePriorityScore = 96;
  else if (revenue.affiliateSettlementStage === "online_affiliate_active" && revenue.contractReady) sourcePriorityScore = 88;
  else if (revenue.sponsorReady) sourcePriorityScore = 82;
  else if (revenue.affiliateSettlementStage === "referral_verified" && revenue.contractReady) sourcePriorityScore = 76;
  else if (revenue.contractReady && ["brokerage","affiliate","manual_affiliate","lead","referral"].includes(revenue.revenueType)) sourcePriorityScore = 74;
  else if (revenue.referralReady || revenue.trafficOnly) sourcePriorityScore = 46;

  let revenueCertaintyScore = revenue.contractReady ? 76 : (revenue.trafficOnly ? 28 : 12);
  if (revenue.contractReady && revenue.payoutBasisVerified) revenueCertaintyScore += 12;
  if (revenue.contractReady && revenue.disclosureReady) revenueCertaintyScore += 6;
  if (revenue.contractReady && revenue.contractId && revenue.counterparty) revenueCertaintyScore += 6;
  revenueCertaintyScore = Math.round(clamp(revenueCertaintyScore, 0, 100, 0));

  const explicitTransactions = finiteNumber(revenue.expectedTransactions, NaN);
  const transactionFrequencyScore = Number.isFinite(explicitTransactions) && explicitTransactions >= 0 && revenue.metricsVerified
    ? logScore(explicitTransactions, 1000)
    : Math.round(clamp(audience.repeatPurchaseScore * 0.58 + audience.audienceDemandScore * 0.22, 0, 70, 0));
  const frequencyEvidenceState = Number.isFinite(explicitTransactions) && revenue.metricsVerified ? "verified_forecast" : "audience_proxy";

  const commissionRate = finiteNumber(revenue.commissionRate, NaN), payout = finiteNumber(revenue.payoutPerTransaction, NaN);
  let unitRevenueScore = revenue.contractReady ? 34 : 12;
  if (Number.isFinite(commissionRate)) unitRevenueScore = Math.max(unitRevenueScore, Math.round(clamp(commissionRate * 500, 0, 100, 0)));
  if (Number.isFinite(payout) && payout >= 0 && Number.isFinite(price) && price > 0) unitRevenueScore = Math.max(unitRevenueScore, Math.round(clamp((payout / price) * 500, 0, 100, 0)));
  else if (Number.isFinite(payout) && payout >= 0) unitRevenueScore = Math.max(unitRevenueScore, logScore(payout, 1000));

  let expectedNetRevenueValue = finiteNumber(revenue.expectedNetRevenue, NaN), expectedNetRevenueState = "not_verified";
  if (Number.isFinite(expectedNetRevenueValue) && revenue.metricsVerified) expectedNetRevenueState = "verified_forecast";
  else if (revenue.contractReady && Number.isFinite(payout) && Number.isFinite(explicitTransactions)) {
    expectedNetRevenueValue = Math.max(0, payout * explicitTransactions);
    expectedNetRevenueState = revenue.metricsVerified ? "derived_from_verified_inputs" : "derived_unverified_inputs";
  } else expectedNetRevenueValue = NaN;
  let expectedNetRevenueScore = 0;
  if (Number.isFinite(expectedNetRevenueValue) && expectedNetRevenueValue >= 0) {
    expectedNetRevenueScore = Number.isFinite(price) && price > 0
      ? logScore(expectedNetRevenueValue / price, 100)
      : logScore(expectedNetRevenueValue, 1000);
    if (!revenue.metricsVerified) expectedNetRevenueScore = Math.min(expectedNetRevenueScore, 55);
  }

  let conversionQualityScore = 20;
  if (Number.isFinite(revenue.expectedConversionRate)) conversionQualityScore = Math.round(clamp(revenue.expectedConversionRate * 500, 0, 100, 0));
  if (Number(revenue.verifiedClicks || 0) > 0 && Number(revenue.verifiedConversions || 0) >= 0) conversionQualityScore = Math.max(conversionQualityScore, Math.round(clamp(Number(revenue.verifiedConversions) / Number(revenue.verifiedClicks) * 500, 0, 100, 0)));
  const searchExposureScore = Math.round(clamp(
    (Number(revenue.verifiedImpressions || 0) >= 100 ? logScore(revenue.verifiedImpressions, 1000000) * 0.55 : 0) +
    (Number(revenue.verifiedClicks || 0) >= 10 ? logScore(revenue.verifiedClicks, 100000) * 0.45 : 0),
    0, 100, 0
  ));
  const trafficValueScore = revenue.trafficOnly || Number(revenue.verifiedClicks || 0) >= 10 ? Math.min(100, searchExposureScore + 20) : 0;
  const revenueOpportunityScore = Math.round(clamp(
    revenueCertaintyScore * 0.28 + transactionFrequencyScore * 0.24 + unitRevenueScore * 0.18 + expectedNetRevenueScore * 0.20 + conversionQualityScore * 0.10,
    0, 100, 0
  ));
  const revenueQualifiedForPrivatePlacement = revenue.contractReady || (commercial.marketReadinessScore >= 30 && revenueOpportunityScore >= 10 && row.productPageLive !== false);
  return {
    sourcePriorityScore,
    revenueCertaintyScore,
    transactionFrequencyScore,
    frequencyEvidenceState,
    unitRevenueScore,
    expectedNetRevenueScore,
    expectedNetRevenueValue: Number.isFinite(expectedNetRevenueValue) ? expectedNetRevenueValue : null,
    expectedNetRevenueState,
    conversionQualityScore,
    searchExposureScore,
    trafficValueScore,
    revenueOpportunityScore,
    revenueQualifiedForPrivatePlacement,
    contractReady: revenue.contractReady === true,
    payableRevenueRightVerified: revenue.directPayable === true || revenue.affiliateReady === true || revenue.referralReady === true || revenue.sponsorReady === true,
    revenuePriorityState: revenue.contractReady ? "verified_or_approved_revenue_route" : (revenue.trafficOnly ? "traffic_value_only_review" : "contract_required")
  };
}

function portfolioValueAssessment(rowInput, category, risk, supplier, audience, revenueValue, commercial) {
  const row = plain(rowInput), priors = plain(CATEGORY_VALUE_PRIORS[category.primary]);
  const hay = lower([row.productName, row.title, row.description, row.summary].map(text).join(" "));
  let operatorCostPenalty = Number(priors.operationalFriction || 35);
  if (/(대형|설치|맞춤제작|주문제작|냉장|냉동|신선배송|파손주의|가구|소파|침대|대형가전|bulky|installation|custom made|refrigerated|frozen|fragile)/i.test(hay)) operatorCostPenalty += 18;
  if (/(디지털|이메일|온라인\s*티켓|소형|경량|digital|email delivery|small|lightweight)/i.test(hay)) operatorCostPenalty -= 10;
  operatorCostPenalty = Math.round(clamp(firstMetric(row, ["operatorCostPenalty","operator_cost_penalty"], operatorCostPenalty), 0, 100, operatorCostPenalty));
  const riskPenalty = Math.round(clamp(100 - Number(risk.qualityScore || 0) + array(risk.concerns).length * 4, 0, 100, 100));
  const sellerTrustScore = supplier.approvalReady === true
    ? Math.max(50, Number(supplier.trustScore || 0))
    : (supplier.evidenceReady === true ? Math.max(30, Number(supplier.trustScore || 0)) : Number(supplier.trustScore || 0));
  const components = {
    sourcePriority: revenueValue.sourcePriorityScore,
    audienceDemand: audience.audienceDemandScore,
    essentiality: audience.essentialityScore,
    affordability: audience.affordabilityScore,
    repeatPurchase: audience.repeatPurchaseScore,
    sellerTrust: Math.round(clamp(sellerTrustScore, 0, 100, 0)),
    marketReadiness: audience.marketReadinessScore,
    revenueCertainty: revenueValue.revenueCertaintyScore,
    transactionFrequency: revenueValue.transactionFrequencyScore,
    unitRevenue: revenueValue.unitRevenueScore,
    expectedNetRevenue: revenueValue.expectedNetRevenueScore,
    searchExposure: revenueValue.searchExposureScore,
    conversionQuality: revenueValue.conversionQualityScore,
    trafficValue: revenueValue.trafficValueScore,
    operatorCostPenalty,
    riskPenalty
  };
  let numerator = 0, denominator = 0;
  for (const [name, weight] of Object.entries(VALUE_WEIGHTS)) {
    const score = name === "operatorCostPenalty" || name === "riskPenalty" ? 100 - Number(components[name] || 0) : Number(components[name] || 0);
    numerator += clamp(score, 0, 100, 0) * weight;
    denominator += weight;
  }
  let portfolioPriorityScore = Math.round(clamp(denominator ? numerator / denominator : 0, 0, 100, 0));
  if (!risk.gatePassed) portfolioPriorityScore = Math.min(portfolioPriorityScore, 34);
  if (!revenueValue.contractReady) portfolioPriorityScore = Math.max(0, portfolioPriorityScore - 5);
  if (audience.narrowDemandPenalty >= 34 && audience.demandEvidenceState === "category_proxy_only") portfolioPriorityScore = Math.max(0, portfolioPriorityScore - 8);
  const privatePlacementEligible = risk.gatePassed === true && audience.audienceQualified === true && revenueValue.revenueQualifiedForPrivatePlacement === true && portfolioPriorityScore >= 34;
  return {
    portfolioPriorityScore,
    privatePlacementEligible,
    reviewPriority: !risk.gatePassed ? "risk_hold" : (portfolioPriorityScore >= 72 ? "highest" : (portfolioPriorityScore >= 58 ? "high" : (portfolioPriorityScore >= 45 ? "standard" : "low"))),
    audience,
    revenue: revenueValue,
    components,
    operatorCostPenalty,
    riskPenalty,
    rankingPrinciple: "trust_gate_then_audience_need_then_frequency_and_total_expected_value; no_count_filling"
  };
}

function proposedSections(rowInput, category, risk, commercial, supplierInput, valueInput) {
  const row = plain(rowInput), out = [], evidence = plain(row.evidence), supplier = plain(supplierInput), value = plain(valueInput);
  const audience = plain(value.audience), revenueValue = plain(value.revenue);
  const baseScore = Number(value.portfolioPriorityScore || commercial.potentialScore || 0);
  const hay = lower([row.productName, row.title, row.supplierName, row.supplierType, row.description, row.summary, category.tags.join(" ")].join(" "));
  const has = function(names){
    return array(names).some(function(name){
      const direct = row[name], nested = evidence[name];
      if (bool(direct) || bool(nested)) return true;
      if (text(direct) || text(nested)) return true;
      return false;
    });
  };
  const evidenceGaps = function(required){ return array(required).filter(function(name){ return !has([name]); }); };
  const add = function(page, sectionKey, score, reason, role, required){
    if (!FRONT_SECTION_KEYS[page] || !FRONT_SECTION_KEYS[page].includes(sectionKey)) return;
    if (out.some(function(item){ return item.key === page + "|" + sectionKey; })) return;
    const requiredEvidence = array(required), gaps = evidenceGaps(requiredEvidence);
    const valueQualified = value.privatePlacementEligible === true;
    out.push({
      key: page + "|" + sectionKey,
      page,
      sectionKey,
      score: Math.round(clamp(score, 0, 100, 0)),
      reason,
      policyRole: role,
      requiredEvidence,
      evidenceGaps: gaps,
      valueQualified,
      reviewEligible: risk.gatePassed === true,
      audienceDemandScore: Number(audience.audienceDemandScore || 0),
      revenueOpportunityScore: Number(revenueValue.revenueOpportunityScore || 0),
      portfolioPriorityScore: baseScore,
      approvalEligible: risk.gatePassed === true && valueQualified && gaps.length === 0,
      proposalOnly: true,
      publicPublication: false
    });
  };

  const supplierIdentityHay = lower([row.supplierName, row.supplierOfficialName, row.officialDirectoryName, row.supplierDescription].map(text).join(" "));
  const cooperative = /(농협|축협|수협|산림조합|협동조합|영농조합|농업회사법인|생산자조합|producer\s*cooperative|co-?operative)/i.test(supplierIdentityHay);
  const manufacturer = /(제조사|제조업체|공식몰|본사|manufacturer|official store|brand)/i.test(hay) || category.tags.includes("manufacturer_brands");
  const marketplace = /(마켓|시장|유통|도매|총판|marketplace|market|distributor|wholesale)/i.test(hay);
  const localOrigin = cooperative || category.tags.includes("local_products") || category.tags.includes("agriculture_fishery_forestry");
  const recurringEssential = ["food_household_essentials","beauty_personal_care","baby_family_education","agriculture_fishery_forestry"].includes(category.primary) && Number(audience.repeatPurchaseScore || 0) >= 60;
  const travel = category.primary === "travel_local_services" || /(관광|숙박|호텔|리조트|체험|투어|여행|ticket|tour|travel|hotel|resort|experience)/i.test(hay);
  const localService = travel || /(지역서비스|방문서비스|예약|상담|local service)/i.test(hay);
  const highTrust = risk.gatePassed === true && supplier.approvalReady === true && Number(supplier.trustScore || 0) >= 82;
  const highestValue = highTrust && baseScore >= 72 && revenueValue.contractReady === true;
  const recentDiscovery = !!row.inspectedAt && Number.isFinite(Date.parse(row.inspectedAt)) && Date.now() - Date.parse(row.inspectedAt) <= 45 * 86400000;
  const officialProductText = row.productPageLive !== false && isSpecificProductUrl(first(row.productUrl, row.url)) && (row.sameSupplierSite === true || sameSite(first(row.productUrl, row.url), first(row.supplierSiteUrl, row.supplierOfficialUrl)));
  const titleHay = lower([row.productName, row.title, row.priorityLabel, row.badge, row.badges, row.labels].map(text).join(" "));
  const sponsorEvidence = commercial.sponsorReady === true || has(["sponsorDisclosure","sponsorContractVerified","sponsorEvidence"]);
  const trendEvidence = has(["trendEvidence","marketDemandEvidence","verifiedDemandEvidence","serverVerifiedDemand"]);
  const newnessEvidence = has(["newnessEvidence","newListingEvidence","verifiedNewness"]);
  const specialEvidence = has(["specialEvidence","certificationEvidence","producerSpecialEvidence"]);
  const titleNewnessEvidence = officialProductText && /(신제품|신상품|새상품|신규출시|신규\s*출시|new\s*(?:arrival|product|release)|newly\s*launched)/i.test(titleHay);
  const titleTrendEvidence = officialProductText && /(베스트(?:셀러)?|인기상품|인기\s*상품|판매\s*상위|best\s*seller|most\s*popular)/i.test(titleHay);
  const titleSpecialEvidence = officialProductText && /(특산품|지역특산|한정판|리미티드|에디션|수상|인증|유기농|무농약|명품|special\s*edition|limited\s*edition|certified)/i.test(titleHay);
  const verifiedTrend = trendEvidence || titleTrendEvidence || audience.demandEvidenceState === "verified";
  const verifiedNewness = newnessEvidence || titleNewnessEvidence;
  const verifiedSpecial = specialEvidence || titleSpecialEvidence;
  const travelOperatorEvidence = has(["travelOperatorEvidence","operatorLicenseEvidence","tourOperatorVerified"]);
  const responsibilityEvidence = has(["marketResponsibilityEvidence","sellerResponsibilityEvidence","localResponsibilityEvidence"]) || (row.supplierEvidenceReady === true && supplier.reviewEligible === true);
  const socialMarketEvidence = has(["marketEvidenceReady","sameMarketEvidence","socialMarketEvidence"]);
  const manufacturerBrand = manufacturer && !cooperative;

  // HOME 8.  These are relevance/value proposals, never quota targets.
  if (highestValue) add("home", "home_right_top", baseScore + 4, "검증된 수익권·높은 신뢰·대중 가치가 함께 확인된 상품", "highest_verified_total_value", []);
  if (localOrigin && responsibilityEvidence && Number(audience.audienceDemandScore || 0) >= 50) add("home", "home_right_middle", baseScore + 1, "지역 가치와 판매자 책임, 실제 수요가 함께 확인된 상품", "local_value_responsibility_and_demand", []);
  if (verifiedNewness && value.privatePlacementEligible === true) add("home", "home_right_bottom", baseScore, "공식 신규성 및 기본 가치 기준을 통과한 상품", "new_verified_value_discovery", []);

  if (recurringEssential && Number(audience.audienceDemandScore || 0) >= 55 && (baseScore >= 48 || verifiedTrend || revenueValue.contractReady === true)) {
    add("home", "home_2", baseScore + 5, "생활 필요성과 반복 구매 가능성이 높은 대표 상품", "essential_repeat_demand", []);
  }
  if (localOrigin && Number(audience.audienceDemandScore || 0) >= 50 && (baseScore >= 45 || revenueValue.contractReady === true)) {
    add("home", "home_3", baseScore + 3, "생산자·조합·지역 원산지 대표 가치 상품", "producer_cooperative_or_local_origin", responsibilityEvidence ? [] : ["sellerResponsibilityEvidence"]);
  }
  if ((localService || travel || marketplace) && Number(audience.audienceDemandScore || 0) >= 48 && (baseScore >= 45 || verifiedTrend || revenueValue.contractReady === true)) {
    add("home", "home_4", baseScore + 2, "현지 서비스·관광·검증 마켓 대표 수요 상품", "local_service_or_market", []);
  }
  if ((manufacturerBrand || ["electronics_accessories","home_appliances_living"].includes(category.primary)) && Number(audience.broadAppealScore || 0) >= 65 && (baseScore >= 50 || verifiedTrend || revenueValue.contractReady === true)) {
    add("home", "home_1", baseScore + 3, "공식 제조사·브랜드의 대표 대중 효용 상품", "featured_manufacturer_utility", []);
  } else if (["beauty_personal_care","fashion","baby_family_education"].includes(category.primary) && Number(audience.audienceDemandScore || 0) >= 55 && (baseScore >= 50 || verifiedTrend || revenueValue.contractReady === true)) {
    add("home", "home_1", baseScore + 1, "대중 수요가 확인된 대표 생활·패션·가족 상품", "featured_lifestyle_demand", []);
  }
  if ((verifiedNewness || recentDiscovery) && Number(audience.audienceDemandScore || 0) >= 42) {
    add("home", "home_5", baseScore - 1, "새로 발견됐지만 수요·가치 기준도 통과한 상품", "qualified_discovery", []);
  }

  // DISTRIBUTION 7.  Revenue and evidence improve priority, but no section is
  // filled merely because it is empty.
  if (sponsorEvidence && revenueValue.contractReady === true) add("distribution", "distribution-sponsor", baseScore + 6, "승인된 스폰서 계약 및 공개 근거 상품", "disclosed_sponsored_offer", []);
  if (verifiedTrend && Number(audience.audienceDemandScore || 0) >= 55) add("distribution", "distribution-trending", baseScore + 5, "검증된 수요·인기 신호가 높은 상품", "verified_market_demand", []);
  if (verifiedNewness && value.privatePlacementEligible === true) add("distribution", "distribution-new", baseScore + 2, "공식 신규성과 기본 가치 기준을 통과한 상품", "recently_verified_listing", []);
  if (verifiedSpecial && Number(audience.audienceDemandScore || 0) >= 45) add("distribution", "distribution-special", baseScore + 3, "공식 인증·특산·한정 근거와 수요가 확인된 상품", "certified_or_producer_special", []);
  if (highTrust && baseScore >= 62) add("distribution", "distribution-right", baseScore + 2, "고신뢰·고가치 큐레이션 상품", "curated_high_total_value", []);
  if (value.privatePlacementEligible === true && baseScore >= 58) add("distribution", "distribution-recommend", baseScore + 4, "대중 가치·거래 가능성·수익 기회를 종합한 추천 상품", "verified_total_value_recommendation", []);
  if (value.privatePlacementEligible === true) add("distribution", "distribution-others", baseScore + 1, "기본 수요와 수익 기회 기준을 통과한 일반·롱테일 상품", "qualified_long_tail_offer", []);

  if ((manufacturerBrand || cooperative || marketplace) && value.privatePlacementEligible === true) {
    const networkScore = ["electronics_accessories","home_appliances_living","manufacturer_brands"].includes(category.primary) ? baseScore + 3 : baseScore - 1;
    add("network", "network-right", networkScore, "제조·생산·조합·마켓 공급망 연결 가치 상품", "market_hub_verified_offer", []);
  }
  if ((travel || (localOrigin && /(특산품|기념품|체험)/i.test(hay))) && Number(audience.audienceDemandScore || 0) >= 42) {
    add("tour", "tour", baseScore - 4, "여행·관광·지역 체험 수요 상품", "local_travel_or_tourism_offer", travelOperatorEvidence ? [] : ["travelOperatorEvidence"]);
  }
  if ((commercial.visual || commercial.promotional || localOrigin) && Number(audience.audienceDemandScore || 0) >= 52) {
    add("social", "rightPanel", baseScore - 3, "소셜 반응 가능성과 실제 수요가 함께 확인된 상품", "social_context_market_offer", socialMarketEvidence ? [] : ["socialMarketEvidence"]);
  }

  // Private management fallback: products that passed the hard product/risk
  // gate still receive a category-fit section proposal even when demand or
  // revenue evidence is not yet strong enough for front publication.  This
  // lets the administrator's full-AI button organise the review queue without
  // weakening the separate public release gate.
  if (risk.gatePassed === true && !out.length) {
    if (travel) add("tour", "tour", baseScore, "검증 완료 여행·지역 서비스의 비공개 검토 배치", "private_review_travel_fit", []);
    else if (["electronics_accessories", "home_appliances_living", "manufacturer_brands"].includes(category.primary) || manufacturerBrand) add("network", "network-right", baseScore + 1, "검증 완료 제조·전자·가전 상품의 비공개 공급망 검토 배치", "private_review_supply_network_fit", []);
    else if (["food_household_essentials", "beauty_personal_care", "fashion", "baby_family_education", "agriculture_fishery_forestry", "local_products"].includes(category.primary) || localOrigin) add("distribution", "distribution-others", baseScore, "검증 완료 생활·소비재 상품의 비공개 일반 유통 검토 배치", "private_review_general_distribution_fit", []);
    else add("distribution", "distribution-others", baseScore - 1, "검증 완료 상품의 비공개 일반 유통 검토 배치", "private_review_fallback_distribution_fit", []);
  }

  const pageOrder = { home: 0, distribution: 1, network: 2, tour: 3, social: 4 };
  return out.sort(function(a, b){ return pageOrder[a.page] - pageOrder[b.page] || b.score - a.score || a.sectionKey.localeCompare(b.sectionKey); });
}

function releaseReadiness(rowInput, risk, commercial, supplier, valueInput) {
  const blockers = [], value = plain(valueInput), revenueValue = plain(value.revenue);
  if (!risk.gatePassed) blockers.push("risk_gate_not_passed");
  if (!supplier.approvalReady) blockers.push("supplier_approval_not_complete");
  if (supplier.trustScore < supplier.publicTrustThreshold) blockers.push("supplier_trust_below_public_threshold");
  if (!commercial.contractReady) blockers.push("revenue_or_referral_contract_not_approved");
  if (commercial.contractReady && revenueValue.payableRevenueRightVerified !== true) blockers.push("payable_revenue_right_not_verified");
  if (value.privatePlacementEligible !== true) blockers.push("audience_or_total_value_threshold_not_met");
  return {
    releaseEligible: blockers.length === 0,
    blockers,
    administratorApprovalRequired: true,
    payableRevenueRightRequired: true,
    trafficOnlyReferralIsNotConfirmedRevenue: true,
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
  const audience = audienceValueAssessment(row, category, risk, commercial, contextInput);
  const revenueValue = revenueValueAssessment(row, audience, commercial);
  const value = portfolioValueAssessment(row, category, risk, supplier, audience, revenueValue, commercial);
  commercial.rankingEligible = risk.gatePassed;
  commercial.potentialScore = value.portfolioPriorityScore;
  commercial.audienceDemandScore = audience.audienceDemandScore;
  commercial.revenueOpportunityScore = revenueValue.revenueOpportunityScore;
  commercial.privatePlacementEligible = value.privatePlacementEligible;
  if (!risk.gatePassed) commercial.potentialScore = Math.min(Number(commercial.potentialScore) || 0, 34);
  const identity = productIdentity(row), family = productFamilyKey(row), displayFamily = displayFamilyKey(row);
  const sections = proposedSections(row, category, risk, commercial, supplier, value), release = releaseReadiness(row, risk, commercial, supplier, value);
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
    valueAssessment: value,
    releaseReadiness: release,
    rankingEligible: risk.gatePassed,
    rankingScore: value.portfolioPriorityScore,
    recommendedDecision: !risk.gatePassed
      ? (risk.blockers.some((reason) => /api_or_static|list_or_campaign|template_or_placeholder|supplier_rejected_or_excluded/.test(reason)) ? "reject" : "hold")
      : (value.privatePlacementEligible ? "review_for_slot" : "hold_for_demand_revenue_or_value_review"),
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

function assignmentKey(rowInput) {
  const row = plain(rowInput), page = lower(first(row.page, row.site, row.hub, row.hubKey)), section = first(row.sectionKey, row.section, row.slotKey, row.slot);
  return page && section ? page + "|" + section : "";
}

function deterministicFraction(seed) {
  const hex = sha256(seed).slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

function allocatePrimaryPlacements(rowsInput) {
  const rows = array(rowsInput), counts = Object.fromEntries(SECTION_ORDER.map((key) => [key, 0]));
  const resultByRow = new Map();
  const ordered = rows.slice().sort((a, b) => {
    const aManual = assignmentKey(a && (a.approvedPlacement || a.selectedPlacement)) ? 1 : 0;
    const bManual = assignmentKey(b && (b.approvedPlacement || b.selectedPlacement)) ? 1 : 0;
    const aValue = plain(a && a.valueAssessment).privatePlacementEligible === true ? 1 : 0;
    const bValue = plain(b && b.valueAssessment).privatePlacementEligible === true ? 1 : 0;
    return bManual - aManual || bValue - aValue ||
      Number(b && b.rankingEligible === true) - Number(a && a.rankingEligible === true) ||
      Number(b && b.familyRepresentative !== false) - Number(a && a.familyRepresentative !== false) ||
      Number(b && b.rankingScore || 0) - Number(a && a.rankingScore || 0) ||
      first(a && a.productName, a && a.title).localeCompare(first(b && b.productName, b && b.title));
  });

  function place(row) {
    const decision = lower(row && row.slotDecision);
    if (["hold", "reject", "purge"].includes(decision)) {
      return Object.assign({}, row, { primaryPlacement: null, placementCapacityState: "excluded_from_active_section_capacity" });
    }
    const manual = plain(row.approvedPlacement || row.selectedPlacement), manualKey = assignmentKey(manual);
    const proposals = array(row.sectionAssignments).filter((item) => SECTION_ORDER.includes(assignmentKey(item)));
    const eligible = proposals.filter((item) => item.approvalEligible === true);
    let candidates = eligible;
    if (manualKey && SECTION_ORDER.includes(manualKey)) {
      const matched = proposals.find((item) => assignmentKey(item) === manualKey) || Object.assign({}, manual, {
        key: manualKey,
        page: manualKey.split("|")[0],
        sectionKey: manualKey.split("|")[1],
        administratorSelected: true,
        approvalEligible: true,
        valueQualified: true,
        proposalOnly: false,
        publicPublication: false
      });
      candidates = [matched].concat(eligible.filter((item) => assignmentKey(item) !== manualKey));
    } else if (plain(row.valueAssessment).privatePlacementEligible !== true) {
      candidates = [];
    }
    if (!candidates.length) {
      return Object.assign({}, row, {
        primaryPlacement: null,
        placementCapacityState: proposals.length ? "unassigned_value_or_evidence_threshold" : "unassigned_no_compatible_section"
      });
    }
    const available = candidates.filter((item) => counts[assignmentKey(item)] < SECTION_CAPACITY);
    if (!available.length) {
      return Object.assign({}, row, { primaryPlacement: null, placementCapacityState: "all_compatible_sections_full" });
    }
    const bestRawScore = Math.max(...available.map((item) => Number(item.score || 0)));
    const closeFit = available.filter((item) => assignmentKey(item) === manualKey || Number(item.score || 0) >= bestRawScore - 8);
    const pool = closeFit.length ? closeFit : available;
    const picked = pool.slice().sort((a, b) => {
      const aKey = assignmentKey(a), bKey = assignmentKey(b);
      const aManual = aKey === manualKey ? 10000 : 0, bManual = bKey === manualKey ? 10000 : 0;
      const aLoadPenalty = (counts[aKey] / SECTION_CAPACITY) * 5;
      const bLoadPenalty = (counts[bKey] / SECTION_CAPACITY) * 5;
      const aScore = aManual + Number(a.score || 0) - aLoadPenalty + deterministicFraction(text(row.productIdentity) + "|" + aKey) * 0.01;
      const bScore = bManual + Number(b.score || 0) - bLoadPenalty + deterministicFraction(text(row.productIdentity) + "|" + bKey) * 0.01;
      return bScore - aScore || SECTION_ORDER.indexOf(aKey) - SECTION_ORDER.indexOf(bKey);
    })[0];
    const key = assignmentKey(picked);
    counts[key] += 1;
    const placement = Object.assign({}, picked, {
      capacity: SECTION_CAPACITY,
      occupiedAfterProposal: counts[key],
      allocationPolicy: manualKey === key ? "administrator_selected_preserved" : "audience_revenue_value_and_section_fit_with_capacity_ceiling",
      proposalOnly: manualKey === key ? false : true,
      publicPublication: false
    });
    return Object.assign({}, row, {
      primaryPlacement: placement,
      sectionAssignments: [placement].concat(proposals.filter((item) => assignmentKey(item) !== key)),
      placementCapacityState: "within_capacity"
    });
  }

  ordered.forEach((row) => resultByRow.set(row, place(row)));
  return {
    products: rows.map((row) => resultByRow.get(row) || row),
    counts,
    capacity: SECTION_CAPACITY,
    unassigned: Array.from(resultByRow.values()).filter((row) => !["hold","reject","purge"].includes(lower(row && row.slotDecision)) && !row.primaryPlacement).length,
    overflow: Object.fromEntries(Object.entries(counts).filter(([, count]) => count > SECTION_CAPACITY))
  };
}

function buildSectionQueues(rankedInput) {
  const queues = Object.fromEntries(SECTION_ORDER.map((key) => [key.replace("|", ":"), []]));
  for (const product of array(rankedInput).filter((row) => row.rankingEligible === true && row.familyRepresentative !== false)) {
    const assignment = plain(product.primaryPlacement);
    if (assignment.approvalEligible !== true) continue;
    const assignmentId = assignmentKey(assignment);
    if (!assignmentId) continue;
    const key = assignment.page + ":" + assignment.sectionKey;
    if (!queues[key]) queues[key] = [];
    if (queues[key].length >= SECTION_CAPACITY) continue;
    queues[key].push(Object.assign({}, product, { targetAssignment: assignment }));
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
      audienceDemandScore: Number(plain(row.valueAssessment).audience && plain(row.valueAssessment).audience.audienceDemandScore || 0),
      revenueOpportunityScore: Number(plain(row.valueAssessment).revenue && plain(row.valueAssessment).revenue.revenueOpportunityScore || 0),
      revenuePriorityState: text(plain(row.valueAssessment).revenue && plain(row.valueAssessment).revenue.revenuePriorityState),
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
      familyVariantReason: representative ? null : "same_supplier_product_family_variant"
    });
  });
}

function buildPortfolio(rowsInput, contextInput) {
  const inputRows = array(rowsInput), merged = mergeProductRows([], inputRows, { limit: Math.max(300, inputRows.length) });
  const effectiveContext = portfolioContext(merged, contextInput);
  const evaluatedBase = merged.map((row) => evaluateProduct(row, effectiveContext)).sort((a, b) =>
    Number(b.rankingEligible === true) - Number(a.rankingEligible === true) ||
    Number(b.rankingScore || 0) - Number(a.rankingScore || 0) ||
    Number(b.riskAssessment && b.riskAssessment.qualityScore || 0) - Number(a.riskAssessment && a.riskAssessment.qualityScore || 0) ||
    first(a.productName, a.title).localeCompare(first(b.productName, b.title))
  );
  const evaluated = markFamilyRepresentatives(evaluatedBase);
  const allocation = allocatePrimaryPlacements(evaluated);
  const allocated = allocation.products;
  const eligible = arrangeDiverse(allocated.filter((row) => row.rankingEligible === true && row.familyRepresentative !== false));
  const variants = allocated.filter((row) => row.familyVariant === true);
  const held = allocated.filter((row) => row.familyVariant !== true && row.rankingEligible !== true);
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
      payableRevenueRightVerified: ranked.filter((row) => plain(row.valueAssessment).revenue && plain(row.valueAssessment).revenue.payableRevenueRightVerified === true).length,
      audienceQualified: ranked.filter((row) => plain(row.valueAssessment).audience && plain(row.valueAssessment).audience.audienceQualified === true).length,
      privatePlacementValueEligible: ranked.filter((row) => plain(row.valueAssessment).privatePlacementEligible === true).length,
      revenueReviewRequired: ranked.filter((row) => plain(row.valueAssessment).privatePlacementEligible === true && !(row.commercialAssessment && row.commercialAssessment.contractReady === true)).length,
      highValuePriority: ranked.filter((row) => Number(row.rankingScore || 0) >= 58).length,
      releaseReady: ranked.filter((row) => row.releaseReadiness && row.releaseReadiness.releaseEligible === true).length,
      proposedPlacementProducts: eligible.filter((row) => array(row.sectionAssignments).length > 0).length,
      assignedPlacementProducts: eligible.filter((row) => !!row.primaryPlacement).length,
      sectionCounts: sectionPortfolio.counts,
      primaryPlacementCounts: allocation.counts,
      sectionCapacity: allocation.capacity,
      sectionCapacityUnassigned: allocation.unassigned,
      sectionCapacityOverflow: allocation.overflow
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
  VALUE_WEIGHTS,
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
  audienceValueAssessment,
  revenueValueAssessment,
  portfolioValueAssessment,
  portfolioContext,
  evaluateProduct,
  mergeProductRows,
  arrangeDiverse,
  allocatePrimaryPlacements,
  buildSectionQueues,
  markFamilyRepresentatives,
  buildPortfolio
};
