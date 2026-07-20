"use strict";

/**
 * IGDC real-product go-live audit.
 *
 * Read-only diagnostic for actual product supply readiness. It never writes a
 * snapshot, calls a seller URL, creates a click, records a revenue event, or
 * starts checkout. Its job is to distinguish seed/sample cards from actual
 * candidate products and to show whether a real candidate satisfies the
 * existing trust/front-supply/referral contracts.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const Trust = require("./lib/trustFilter.core.v1");
const NonPgRevenue = require("./lib/nonpg-revenue-contract.core.v1");
const LedgerStore = require("./lib/revenue-ledger-supabase.v1");
const MarketSaleScope = require("./lib/market-sale-scope.v1");

const VERSION = "product-go-live-audit-v1.1.0-country-region-scoped-readonly";
const MAX_ROWS = 120;

const SNAPSHOT_SPECS = [
  { key:"searchBank", file:"search-bank.snapshot.json", page:"searchbank", publicPath:"/data/search-bank.snapshot.json" },
  { key:"front", file:"front.snapshot.json", page:"front", publicPath:"/data/front.snapshot.json" },
  { key:"distribution", file:"distribution.snapshot.json", page:"distribution", publicPath:"/data/distribution.snapshot.json" },
  { key:"network", file:"networkhub-snapshot.json", page:"networkhub", publicPath:"/data/networkhub-snapshot.json" },
  { key:"media", file:"media.snapshot.json", page:"media", publicPath:"/data/media.snapshot.json" },
  { key:"social", file:"social.snapshot.json", page:"social", publicPath:"/data/social.snapshot.json" },
  { key:"tour", file:"tour-snapshot.json", page:"tour", publicPath:"/data/tour-snapshot.json" },
  { key:"donation", file:"donation.snapshot.json", page:"donation", publicPath:"/data/donation.snapshot.json" }
];

function text(v){ return v == null ? "" : String(v).trim(); }
function low(v){ return text(v).toLowerCase(); }
function bool(v){ return v === true || (v !== false && v != null && !["", "0", "false", "no", "off", "disabled", "null", "undefined"].includes(low(v))); }
function isObject(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function asArray(v){ return Array.isArray(v) ? v : []; }
function first(){ for(const v of arguments){ const s = text(v); if(s) return s; } return ""; }
function num(v, fallback){ const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function sha256(value){ return crypto.createHash("sha256").update(value).digest("hex"); }
function noStoreHeaders(){
  return {
    "content-type":"application/json; charset=utf-8",
    "cache-control":"private, no-store, max-age=0",
    "x-content-type-options":"nosniff"
  };
}
function json(statusCode, body){ return { statusCode, headers:noStoreHeaders(), body:JSON.stringify(body) }; }
function cleanMode(v){ return low(v) === "production" ? "production" : "pre-product"; }
function safeLimit(v){ return Math.max(1, Math.min(MAX_ROWS, Math.floor(num(v, 60)) || 60)); }
function getParam(event, name){ return event && event.queryStringParameters ? event.queryStringParameters[name] : undefined; }
function headerMap(event){
  const out = {};
  for(const [key, value] of Object.entries(event && event.headers || {})) out[String(key).toLowerCase()] = value;
  return out;
}
function readGeoObject(value){
  const raw = text(value);
  if(!raw) return {};
  for(const candidate of [raw, (() => { try { return decodeURIComponent(raw); } catch(_error) { return ""; } })()]){
    try { const parsed = JSON.parse(candidate); if(isObject(parsed)) return parsed; } catch(_error){}
  }
  return {};
}
let COUNTRY_CODE_CACHE = null;
function supportedCountryCodes(){
  if(COUNTRY_CODE_CACHE) return COUNTRY_CODE_CACHE;
  const files = [
    path.join(process.cwd(), "data", "country-region-registry.v1.json"),
    path.join(__dirname, "..", "..", "data", "country-region-registry.v1.json"),
    path.join(__dirname, "data", "country-region-registry.v1.json")
  ];
  let rows = [];
  for(const file of files){
    try { if(fs.existsSync(file)){ const doc=JSON.parse(fs.readFileSync(file,"utf8")); rows=asArray(doc&&doc.countries); break; } } catch(_error){}
  }
  COUNTRY_CODE_CACHE = new Set(rows.map((row)=>MarketSaleScope.normalizeCountry(row&&row.code)).filter((code)=>code&&code!=="KP"));
  return COUNTRY_CODE_CACHE;
}
function geoScope(event){
  const headers = headerMap(event);
  const geo = Object.assign({}, isObject(event&&event.geo) ? event.geo : {}, readGeoObject(headers["x-nf-geo"]));
  const countryObject = isObject(geo.country) ? geo.country : {};
  const subdivision = isObject(geo.subdivision) ? geo.subdivision : {};
  const rawDetected = text(first(
    countryObject.code, countryObject.alpha2, typeof geo.country === "string" ? geo.country : "", geo.countryCode, geo.country_code,
    headers["cf-ipcountry"], headers["x-country"], headers["x-vercel-ip-country"], headers["x-nf-country"]
  )).toUpperCase();
  const detected = MarketSaleScope.normalizeCountry(rawDetected);
  if(!detected || detected === "KP" || !supportedCountryCodes().has(detected)) return { country:null, region:null, resolved:false, excluded:detected === "KP", detectedCountry:detected || rawDetected || null };
  const region = MarketSaleScope.normalizeRegion(first(
    subdivision.code, subdivision.iso_code, typeof geo.subdivision === "string" ? geo.subdivision : "", geo.subdivisionCode, geo.regionCode,
    geo.stateCode, geo.provinceCode, geo.region, geo.state, headers["x-region"], headers["x-nf-subdivision"], headers["x-nf-region"], headers["x-vercel-ip-country-region"]
  ), detected);
  return { country:detected, region:region || "NATIONWIDE", resolved:true, excluded:false, detectedCountry:detected };
}
function nested(obj, parts){
  let current = obj;
  for(const part of parts){
    if(!isObject(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}
function itemId(item){ return first(item && item.id, item && item.uid, item && item.productId, item && item.product_id, item && item.contentId, item && item.content_id); }
function itemTitle(item){ return first(item && item.title, item && item.name, item && item.label); }
function itemUrl(item){ return first(item && item.url, item && item.link, item && item.href, item && item.targetUrl, nested(item, ["outbound", "url"])); }
function itemImage(item){ return first(item && item.image, item && item.thumb, item && item.thumbnail, item && item.imageUrl, item && item.poster, item && item.coverImage); }
function itemSection(item, fallback){ return first(item && item.section, item && item.psom_key, item && item.slot, item && item.pageSection, fallback); }
function itemPage(item, fallback){ return first(item && item.page, item && item.channel, item && item.bind && item.bind.page, fallback); }
function hostOf(url){ try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch(_e){ return ""; } }
function isHttps(url){ try { return new URL(url).protocol === "https:"; } catch(_e){ return false; } }
function isFragmentOrEmpty(url){ const s = low(url); return !s || s === "#" || s === "about:blank" || s === "javascript:void(0)" || s.startsWith("#"); }
function isPlaceholder(item){
  const url = low(itemUrl(item));
  const all = low([
    itemTitle(item), item && item.summary, item && item.description, item && item.category,
    item && item.type, item && item.section, asArray(item && item.tags).join(" "), url,
    item && item.placeholder, item && item.isPlaceholder, item && item.replaceableSlot, item && item.isLayerPointer
  ].filter(Boolean).join(" "));
  return !!(
    item && (item.placeholder === true || item.isPlaceholder === true || item.replaceableSlot === true || item.isLayerPointer === true) ||
    isFragmentOrEmpty(url) ||
    /(^|\W)(sample|placeholder|dummy|seed\s*slot|replaceable-front-slot|lorem)(\W|$)/i.test(all) ||
    /example\.com|example\.edu/.test(url) ||
    /\/assets\/sample\//.test(url) ||
    /\/assets\/sample\//.test(low(itemImage(item)))
  );
}
function isProductSignal(item){
  const direct = isObject(item && item.directSale) ? item.directSale : {};
  const seller = isObject(item && item.seller) ? item.seller : {};
  const supply = isObject(item && item.supplyChain) ? item.supplyChain : {};
  const affiliate = isObject(item && item.affiliate) ? item.affiliate : {};
  const txt = low([
    item && item.category, item && item.type, item && item.section, item && item.page,
    asArray(item && item.tags).join(" "), item && item.productType, item && item.supplyCategory,
    direct.enabled, seller.name, supply.supplierId, affiliate.providerId
  ].filter(Boolean).join(" "));
  return /product|commerce|distribution|market|shop|seller|merchant|retail|supplier|\bsku\b|상품|유통|판매|구매|제조|공급/.test(txt) ||
    !!(item && (item.productId || item.product_id || item.productSku || item.product_sku));
}
function hasCountryOrRegion(item){
  const shipping = isObject(item && item.shipping) ? item.shipping : {};
  const delivery = isObject(item && item.delivery) ? item.delivery : {};
  const seller = isObject(item && item.seller) ? item.seller : {};
  return !!first(
    item && item.country, item && item.region, item && item.market, item && item.marketCountry,
    item && item.availableCountries && asArray(item.availableCountries).join(","),
    shipping.country, delivery.country, seller.country
  );
}
function normalizeCountry(value){ return MarketSaleScope.normalizeCountry(value); }
function normalizeRegion(value, country){ return MarketSaleScope.normalizeRegion(value, country); }
function itemMarketScopes(item){
  const scopes = [];
  const seen = new Set();
  function add(countryInput, regionInput){
    const country = normalizeCountry(countryInput);
    if(!country || country === "KP") return;
    const region = normalizeRegion(regionInput || "NATIONWIDE", country) || "NATIONWIDE";
    const key = country + "|" + region;
    if(seen.has(key)) return;
    seen.add(key);
    scopes.push({ country, region });
  }
  try {
    for(const record of MarketSaleScope.recordsFor(item)){
      const country = normalizeCountry(record && record.country);
      if(!country) continue;
      for(const region of asArray(record && record.regions)) add(country, region);
      if(record && record.nationwide === true) add(country, "NATIONWIDE");
    }
  } catch(_error){}
  const marketScope = isObject(item && item.marketScope) ? item.marketScope : {};
  add(marketScope.marketCountry, marketScope.marketRegion);
  const supply = isObject(item && item.countrySupply) ? item.countrySupply : {};
  const shipping = isObject(item && item.shipping) ? item.shipping : {};
  const delivery = isObject(item && item.delivery) ? item.delivery : {};
  const seller = isObject(item && item.seller) ? item.seller : {};
  const directCountry = first(
    item && item.targetCountry, item && item.countryCode, item && item.country,
    item && item.marketCountry, item && item.distributionMarketCountry,
    supply.targetMarket, supply.countryCode, supply.country,
    shipping.country, delivery.country, seller.country
  );
  const directRegion = first(
    item && item.targetRegion, item && item.regionCode, item && item.region,
    item && item.distributionMarketRegion, supply.targetRegion, supply.regionCode, supply.region
  );
  add(directCountry, directRegion || "NATIONWIDE");
  const countries = [];
  for(const value of [
    item && item.availabilityCountries,
    item && item.availableCountries,
    item && item.countryCodes,
    supply.availabilityCountries,
    supply.countryCodes,
    shipping.countries,
    delivery.countries
  ]){
    if(Array.isArray(value)) countries.push(...value);
    else if(text(value)) countries.push(value);
  }
  const regions = [];
  for(const value of [
    item && item.availabilityRegions,
    item && item.regionCodes,
    supply.availabilityRegions,
    supply.regionCodes,
    shipping.regions,
    delivery.regions
  ]){
    if(Array.isArray(value)) regions.push(...value);
    else if(text(value)) regions.push(value);
  }
  for(const country of countries){
    if(regions.length) for(const region of regions) add(country, region);
    else add(country, "NATIONWIDE");
  }
  return scopes;
}
function selectedScope(countryInput, regionInput){
  const rawCountry = text(countryInput).toUpperCase();
  if(!rawCountry) return { country:null, region:"ALL", active:false, source:"explicit-global-default", fallback:"global-read", crossCountry:false };
  if(rawCountry === "UNSCOPED") return { country:"UNSCOPED", region:"ALL", active:true, source:"administrator-unscoped", fallback:"unscoped-only", crossCountry:false };
  const country = normalizeCountry(rawCountry);
  if(!country || country === "KP" || !supportedCountryCodes().has(country)) return { country:null, region:null, active:true, unresolved:true, excluded:country === "KP", detectedCountry:country || rawCountry, source:country === "KP" ? "excluded-selection" : "invalid-selection", fallback:"empty", crossCountry:false };
  const rawRegion = text(regionInput).toUpperCase();
  const region = rawRegion === "ALL" ? "ALL" : (normalizeRegion(rawRegion || "NATIONWIDE", country) || "NATIONWIDE");
  return { country, region, active:true, source:"administrator-selected", fallback:"exact-region-then-nationwide-within-same-country", crossCountry:false };
}
function scopeMatch(item, scope){
  const scopes = itemMarketScopes(item);
  if(scope && scope.unresolved === true) return { matched:false, mode:"unresolved_geo", country:null, region:null, itemScopes:scopes };
  if(!scope || !scope.active) return { matched:true, mode:"global", country:null, region:"ALL", itemScopes:scopes };
  if(scope.country === "UNSCOPED") return { matched:scopes.length === 0, mode:"unscoped", country:"UNSCOPED", region:"ALL", itemScopes:scopes };
  const sameCountry = scopes.filter((row) => row.country === scope.country);
  if(!sameCountry.length) return { matched:false, mode:"none", country:scope.country, region:scope.region, itemScopes:scopes };
  if(scope.region === "ALL") return { matched:true, mode:"country", country:scope.country, region:"ALL", itemScopes:sameCountry };
  if(scope.region === "NATIONWIDE") return { matched:sameCountry.some((row) => row.region === "NATIONWIDE"), mode:"nationwide", country:scope.country, region:"NATIONWIDE", itemScopes:sameCountry };
  if(sameCountry.some((row) => row.region === scope.region)) return { matched:true, mode:"exact_region", country:scope.country, region:scope.region, itemScopes:sameCountry };
  if(sameCountry.some((row) => row.region === "NATIONWIDE")) return { matched:true, mode:"nationwide_fallback", country:scope.country, region:scope.region, itemScopes:sameCountry };
  return { matched:false, mode:"none", country:scope.country, region:scope.region, itemScopes:sameCountry };
}
function hasDeliverySignal(item){
  const shipping = isObject(item && item.shipping) ? item.shipping : {};
  const delivery = isObject(item && item.delivery) ? item.delivery : {};
  const contract = isObject(item && item.searchBankContract) ? item.searchBankContract : {};
  return bool(item && item.deliveryReady) || bool(item && item.policyReady) || bool(item && item.orderReady) ||
    bool(item && item.inquiryReady) || bool(shipping && (shipping.available || shipping.country || shipping.countries)) ||
    bool(delivery && (delivery.available || delivery.country || delivery.countries)) ||
    bool(contract && (contract.deliveryReady || contract.policyReady || contract.orderReady));
}
function explicitFrontFlags(item){
  const contract = isObject(item && item.searchBankContract) ? item.searchBankContract : {};
  return {
    frontSupplyAllowed: first(item && item.frontSupplyAllowed, contract.frontSupplyAllowed),
    snapshotEligible: first(item && item.snapshotEligible, contract.snapshotEligible),
    searchBankEligible: first(item && item.searchBankEligible, contract.searchBankEligible)
  };
}
function candidateKey(item, source){
  const id = itemId(item);
  const url = itemUrl(item);
  return id ? `id:${id}` : (url ? `url:${url}` : `src:${source}:${itemTitle(item)}`);
}
function revenueQualification(item){
  const candidateRevenue = isObject(item && item.commerceCandidate && item.commerceCandidate.revenue) ? item.commerceCandidate.revenue : {};
  const selectionRevenue = isObject(item && item.candidateSelection && item.candidateSelection.revenue) ? item.candidateSelection.revenue : {};
  const revenue = Object.assign({}, candidateRevenue, selectionRevenue);
  const contract = isObject(item && item.brokerageContract) ? item.brokerageContract : {};
  const listing = isObject(item && item.directCommerceListing) ? item.directCommerceListing : {};
  const type = low(first(revenue.type, contract.type, listing.revenueType));
  const directPayable = revenue.payable === true || (
    ["advertising","brokerage","lead","referral","sponsor"].includes(type) &&
    bool(first(contract.approved, listing.contractApproved)) &&
    !!first(revenue.contractId, contract.id, listing.contractId) &&
    !!first(revenue.counterparty, contract.counterparty, contract.providerName, listing.counterparty, listing.providerName) &&
    bool(first(revenue.disclosureReady, contract.disclosureReady, listing.disclosureReady)) &&
    bool(first(revenue.payoutBasisVerified, contract.payoutBasisVerified, listing.payoutBasisVerified))
  );
  const trafficOnly = revenue.monetizationState === "traffic_value_only_review" || type === "external_referral";
  return {
    type:type || null,
    payable:directPayable,
    potential:revenue.potential === true || trafficOnly || directPayable,
    trafficOnly,
    monetizationState:first(revenue.monetizationState, trafficOnly ? "traffic_value_only_review" : "not_verified"),
    contractId:first(revenue.contractId,contract.id,listing.contractId)||null,
    verificationReasons:asArray(revenue.verificationReasons).slice(0,12)
  };
}
function publicItemRow(item, source, page, section, match){
  const sellerUrl = itemUrl(item);
  const trust = Trust.evaluateFrontEligibility(item, { frontSupply:true, commerce:true, strictFront:true, surface:"distribution" });
  const affiliate = NonPgRevenue.affiliateForItem(item);
  const revenue = revenueQualification(item);
  const flags = explicitFrontFlags(item);
  const issues = [];
  const info = [];
  const id = itemId(item);
  const title = itemTitle(item);
  const image = itemImage(item);
  const marketScopes = itemMarketScopes(item);
  const regional = marketScopes.length > 0 || hasCountryOrRegion(item);
  const delivery = hasDeliverySignal(item);

  if(!id) issues.push("missing-product-id");
  if(!title) issues.push("missing-title");
  if(!image) issues.push("missing-image");
  if(isFragmentOrEmpty(sellerUrl)) issues.push("missing-seller-url");
  else if(!isHttps(sellerUrl)) issues.push("seller-url-not-https");
  if(flags.frontSupplyAllowed === "false") issues.push("front-supply-disabled");
  if(flags.snapshotEligible === "false") issues.push("snapshot-ineligible");
  if(flags.searchBankEligible === "false") issues.push("searchbank-ineligible");
  if(!regional) issues.push("country-or-region-missing");
  if(!delivery) issues.push("delivery-or-policy-evidence-missing");
  if(!trust.frontEligible){
    (trust.reasons || []).slice(0,5).forEach(reason => issues.push(`trust:${reason}`));
  }
  if(!affiliate.present) info.push("no-affiliate-contract");
  else if(!affiliate.eligible) info.push("affiliate-contract-not-approved");
  else info.push("approved-affiliate-contract");
  if(revenue.payable) info.push("verified-payable-revenue-right");
  else if(revenue.trafficOnly) info.push("traffic-only-not-payable");
  else info.push("payable-revenue-right-not-verified");

  let status = "hold";
  if(issues.some(x => /missing-product-id|missing-title|missing-image|missing-seller-url|seller-url-not-https|front-supply-disabled|snapshot-ineligible|searchbank-ineligible/.test(x))) status = "block";
  else if(!trust.frontEligible || !regional || !delivery) status = "hold";
  else if(affiliate.eligible) status = "ready_affiliate";
  else if(revenue.payable) status = "ready_direct_revenue";
  else if(revenue.potential) status = "revenue_review_required";
  else status = "hold";

  return {
    id: id || null,
    title: title || null,
    source,
    page: itemPage(item, page) || null,
    section: itemSection(item, section) || null,
    sellerHost: hostOf(sellerUrl) || null,
    sellerUrlState: isHttps(sellerUrl) ? "https" : (isFragmentOrEmpty(sellerUrl) ? "empty" : "invalid"),
    imageReady: !!image,
    countryOrRegion: regional,
    selectedScopeMatch: match || null,
    marketScopes,
    deliveryEvidence: delivery,
    frontEligibility: {
      eligible: !!trust.frontEligible,
      classification: trust.classification || null,
      trustScore: Number.isFinite(Number(trust.score)) ? Number(trust.score) : null,
      reasons: asArray(trust.reasons).slice(0,6),
      evidence: asArray(trust.evidence).slice(0,6)
    },
    affiliate: {
      present: !!affiliate.present,
      eligible: !!affiliate.eligible,
      status: affiliate.status || null,
      providerId: affiliate.providerId || null,
      programId: affiliate.programId || null,
      trackingHost: affiliate.trackingHost || null,
      conversionMode: affiliate.conversionMode || null
    },
    revenueQualification: revenue,
    status,
    issues: Array.from(new Set(issues)).slice(0,16),
    info
  };
}
function extractSectionItems(v){
  if(Array.isArray(v)) return v;
  if(!isObject(v)) return [];
  if(Array.isArray(v.items)) return v.items;
  if(Array.isArray(v.slots)) return v.slots;
  if(Array.isArray(v.data)) return v.data;
  const out = [];
  Object.keys(v).forEach(key => { if(Array.isArray(v[key])) out.push(...v[key]); });
  return out;
}
function flattenSnapshot(json, spec){
  const rows = [];
  const seen = new Set();
  function push(item, page, section){
    if(!isObject(item)) return;
    const key = `${spec.key}:${candidateKey(item, spec.key)}:${page || ""}:${section || ""}`;
    if(seen.has(key)) return;
    seen.add(key);
    rows.push({ item, page:page || spec.page, section:section || itemSection(item, "unknown") });
  }
  asArray(json && json.items).forEach(item => push(item, spec.page, itemSection(item, "items")));
  if(isObject(json && json.pages)){
    Object.keys(json.pages).forEach(pageKey => {
      const page = json.pages[pageKey];
      if(isObject(page && page.sections)) Object.keys(page.sections).forEach(sectionKey => {
        extractSectionItems(page.sections[sectionKey]).forEach(item => push(item, pageKey, sectionKey));
      });
      asArray(page && page.items).forEach(item => push(item, pageKey, itemSection(item, "items")));
    });
  }
  if(isObject(json && json.sections)) Object.keys(json.sections).forEach(sectionKey => {
    extractSectionItems(json.sections[sectionKey]).forEach(item => push(item, spec.page, sectionKey));
  });
  return rows;
}
function snapshotPaths(file){
  const cwd = process.cwd();
  return {
    publicFile: path.join(cwd, "data", file),
    functionFile: path.join(__dirname, "data", file),
    functionDirectFile: path.join(__dirname, file)
  };
}
function readFileInfo(file){
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { exists:true, file, raw, hash:sha256(raw), size:Buffer.byteLength(raw), json:JSON.parse(raw) };
  } catch(error){ return { exists:false, file, error:String(error && error.message || error), json:null }; }
}
function loadSnapshot(spec){
  const paths = snapshotPaths(spec.file);
  const publicInfo = readFileInfo(paths.publicFile);
  const functionInfo = readFileInfo(paths.functionFile);
  const directInfo = readFileInfo(paths.functionDirectFile);
  const chosen = publicInfo.exists ? publicInfo : (functionInfo.exists ? functionInfo : directInfo);
  const functionComparable = functionInfo.exists ? functionInfo : directInfo;
  return {
    spec,
    source: chosen,
    copies: {
      public: { exists:publicInfo.exists, hash:publicInfo.hash || null, size:publicInfo.size || 0 },
      function: { exists:functionComparable.exists, hash:functionComparable.hash || null, size:functionComparable.size || 0 },
      synchronized: !!(publicInfo.exists && functionComparable.exists && publicInfo.hash === functionComparable.hash)
    }
  };
}
function envReady(){
  let partnerCount = 0;
  let partnerConfigValid = false;
  try {
    const partners = JSON.parse(process.env.IGDC_AFFILIATE_PARTNERS_JSON || "[]");
    partnerCount = Array.isArray(partners) ? partners.length : 0;
    partnerConfigValid = Array.isArray(partners);
  } catch(_e){}
  const ledgerConfig = LedgerStore.resolveConfig();
  const ledgerState = LedgerStore.describeConfig(ledgerConfig);
  const hasLedger = ledgerConfig.configured === true && ledgerConfig.valid === true;
  const hasClickSecret = !!process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET;
  const hasSettlementToken = !!process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN;
  return {
    providerSettlement: {
      ledgerStorageConfigured: hasLedger,
      ledgerStorageConfig: ledgerState,
      affiliateClickSigningConfigured: hasClickSecret,
      affiliatePartnerConfigConfigured: !!(partnerConfigValid && partnerCount > 0),
      affiliatePartnerConfigSyntaxValid: partnerConfigValid,
      affiliatePartnerCount: partnerCount,
      affiliateConversionWebhookReady: !!(hasLedger && hasClickSecret && partnerCount > 0),
      nonPgSettlementIngestReady: !!(hasLedger && hasSettlementToken)
    },
    supplySwitches: {
      productSupplyOn: low(process.env.PRODUCT_SUPPLY_ON || "") || "not-configured",
      dataUploadOn: low(process.env.DATA_UPLOAD_ON || "") || "not-configured",
      frontSlotAutoFill: low(process.env.FRONT_SLOT_AUTO_FILL || "") || "not-configured",
      paymentLive: low(process.env.PAYMENT_LIVE || "") || "not-configured"
    }
  };
}
function summarize(mode, limit, scopeInput){
  const loaded = SNAPSHOT_SPECS.map(loadSnapshot);
  const snapshotReports = [];
  const uniqueReal = new Map();
  const scope = scopeInput && scopeInput.active !== undefined ? scopeInput : selectedScope(scopeInput && scopeInput.country, scopeInput && scopeInput.region);
  const counts = { sourceAllItems:0, allItems:0, seedOrSample:0, productSignals:0, realProductCandidates:0, readyAffiliate:0, readyDirectRevenue:0, revenueReviewRequired:0, readyExternalReferral:0, hold:0, block:0 };

  loaded.forEach(record => {
    const sourceRows = record.source && record.source.exists && record.source.json ? flattenSnapshot(record.source.json, record.spec) : [];
    const scopedRows = sourceRows.map((row) => ({ row, match:scopeMatch(row.item, scope) })).filter((entry) => entry.match.matched);
    const rows = scopedRows.map((entry) => Object.assign({}, entry.row, { scopeMatch:entry.match }));
    counts.sourceAllItems += sourceRows.length;
    const one = {
      key:record.spec.key,
      publicPath:record.spec.publicPath,
      available:!!(record.source && record.source.exists),
      parseError: record.source && record.source.error ? record.source.error : null,
      copies:record.copies,
      sourceTotalItems:sourceRows.length,
      totalItems:rows.length,
      selectedScope:scope,
      seedOrSample:0,
      productSignals:0,
      realProductCandidates:0,
      readyAffiliate:0,
      readyDirectRevenue:0,
      revenueReviewRequired:0,
      readyExternalReferral:0,
      hold:0,
      block:0
    };
    rows.forEach(row => {
      counts.allItems += 1;
      if(isPlaceholder(row.item)) { one.seedOrSample += 1; counts.seedOrSample += 1; return; }
      if(!isProductSignal(row.item)) return;
      one.productSignals += 1; counts.productSignals += 1;
      const result = publicItemRow(row.item, record.spec.key, row.page, row.section, row.scopeMatch);
      const dedupe = candidateKey(row.item, record.spec.key);
      if(!uniqueReal.has(dedupe)) uniqueReal.set(dedupe, result);
      one.realProductCandidates += 1;
      if(result.status === "ready_affiliate") one.readyAffiliate += 1;
      else if(result.status === "ready_direct_revenue") one.readyDirectRevenue += 1;
      else if(result.status === "revenue_review_required") one.revenueReviewRequired += 1;
      else if(result.status === "ready_external_referral") one.readyExternalReferral += 1;
      else if(result.status === "hold") one.hold += 1;
      else one.block += 1;
    });
    snapshotReports.push(one);
  });

  const realRows = Array.from(uniqueReal.values());
  counts.realProductCandidates = realRows.length;
  realRows.forEach(row => {
    if(row.status === "ready_affiliate") counts.readyAffiliate += 1;
    else if(row.status === "ready_direct_revenue") counts.readyDirectRevenue += 1;
    else if(row.status === "revenue_review_required") counts.revenueReviewRequired += 1;
    else if(row.status === "ready_external_referral") counts.readyExternalReferral += 1;
    else if(row.status === "hold") counts.hold += 1;
    else counts.block += 1;
  });

  const runtime = envReady();
  const copiesOk = snapshotReports.every(x => x.available && x.copies.synchronized);
  const realReady = counts.readyAffiliate + counts.readyDirectRevenue;
  let gate = "not_ready";
  let gateReason = "no-real-product-candidate";
  if(counts.realProductCandidates > 0 && realReady === 0) { gate = "hold"; gateReason = "real-products-require-front-readiness"; }
  if(realReady > 0 && !copiesOk) { gate = "hold"; gateReason = "snapshot-copies-not-synchronized"; }
  if(realReady > 0 && copiesOk) { gate = "ready_for_canary"; gateReason = "use-one-approved-candidate-manual-review"; }

  const statusCounts = { readyAffiliate:counts.readyAffiliate, readyDirectRevenue:counts.readyDirectRevenue, revenueReviewRequired:counts.revenueReviewRequired, readyExternalReferral:counts.readyExternalReferral, hold:counts.hold, block:counts.block };
  return {
    ok:true,
    status: gate === "ready_for_canary" ? "ok" : (gate === "hold" ? "warn" : "info"),
    version:VERSION,
    mode,
    selectedScope:scope,
    scopePolicy:{ exactRegionFirst:true, nationwideFallbackWithinSameCountry:true, crossCountryFallback:false, unresolvedScope:"empty" },
    noWrite:true,
    externalNavigation:false,
    providerCalls:false,
    generatedAt:new Date().toISOString(),
    gate:{ state:gate, reason:gateReason, note:"This audit never opens seller links or enables supply. It only identifies candidates that are safe for one manual canary review." },
    summary:counts,
    statusCounts,
    runtime,
    snapshots:snapshotReports,
    candidateRows:realRows.slice(0, limit),
    candidateRowsTruncated:Math.max(0, realRows.length - limit)
  };
}

exports.handler = async function(event){
  const method = String((event && event.httpMethod) || "GET").toUpperCase();
  if(method === "OPTIONS") return { statusCode:204, headers:Object.assign(noStoreHeaders(), { allow:"GET, HEAD, OPTIONS" }), body:"" };
  if(method !== "GET" && method !== "HEAD") return json(405, { ok:false, error:"method_not_allowed", allowed:["GET", "HEAD"] });
  try {
    const mode = cleanMode(getParam(event, "mode"));
    const limit = safeLimit(getParam(event, "limit"));
    const requestedCountry = text(getParam(event, "country")).toUpperCase();
    const geo = geoScope(event);
    let scope;
    if(requestedCountry === "GLOBAL") scope = { country:null, region:"ALL", active:false, source:"administrator-global", fallback:"global-read", crossCountry:false };
    else if(requestedCountry) scope = selectedScope(requestedCountry, getParam(event, "region"));
    else if(geo.resolved) scope = Object.assign(selectedScope(geo.country, geo.region), { source:"request-ip" });
    else scope = { country:null, region:null, active:true, unresolved:true, source:geo.excluded?"excluded-ip":"unresolved-ip", fallback:"empty", crossCountry:false, excluded:geo.excluded, detectedCountry:geo.detectedCountry };
    const report = summarize(mode, limit, scope);
    if(method === "HEAD") return { statusCode:200, headers:noStoreHeaders(), body:"" };
    return json(200, report);
  } catch(error){
    return json(500, { ok:false, status:"error", version:VERSION, error:String(error && error.message || error) });
  }
};

module.exports = { handler:exports.handler, VERSION, summarize, selectedScope, scopeMatch, itemMarketScopes, geoScope };
