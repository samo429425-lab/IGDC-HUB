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
const CommerceIntake = require("./lib/commerce-candidate-intake.v1");
const AdminSession = require("./lib/global-slot-console-auth");
const SlotStore = require("./lib/global-slot-console-supabase");
const CandidateReview = require("./commerce-candidate-review");
const ReleaseDispatch = require("./lib/commerce-release-dispatch.v1");

const VERSION = "product-go-live-audit-v1.7.0-publication-persistence-readback";
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
    "x-content-type-options":"nosniff",
    "access-control-allow-headers":"Content-Type, Authorization",
    "access-control-allow-methods":"GET,HEAD,POST,OPTIONS"
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
function privateStageScopeMatch(row, scope){
  if(!scope || scope.active === false) return {matched:true,mode:"global"};
  if(scope.unresolved || !scope.country) return {matched:false,mode:"unresolved"};
  const scopes=[];
  const seen=new Set();
  function add(countryInput,regionInput){
    const country=normalizeCountry(countryInput);if(!country)return;
    const region=normalizeRegion(regionInput||"NATIONWIDE",country)||"NATIONWIDE";
    const key=country+"|"+region;if(seen.has(key))return;seen.add(key);scopes.push({country,region});
  }
  for(const key of asArray(row&&row.marketKeys)){
    const match=text(key).toUpperCase().match(/^([A-Z]{2})-(.+)$/);if(match)add(match[1],match[2]);
  }
  const placement=isObject(row&&row.placement)?row.placement:{};add(placement.country,placement.region);
  const marketScope=isObject(row&&row.marketScope)?row.marketScope:{};add(marketScope.marketCountry,marketScope.marketRegion);
  const supply=isObject(row&&row.countrySupply)?row.countrySupply:{};add(first(supply.country,supply.countryCode),first(supply.region,supply.regionCode));
  const assignment=isObject(row&&row.lifecycle&&row.lifecycle.assignment)?row.lifecycle.assignment:{};add(assignment.countryCode,assignment.regionCode);
  const sameCountry=scopes.filter((entry)=>entry.country===scope.country);
  if(!sameCountry.length)return {matched:false,mode:"none"};
  const requested=normalizeRegion(scope.region||"NATIONWIDE",scope.country)||"NATIONWIDE";
  if(scope.region==="ALL")return {matched:true,mode:"country"};
  if(requested==="NATIONWIDE")return {matched:sameCountry.some((entry)=>entry.region==="NATIONWIDE"),mode:"nationwide"};
  if(sameCountry.some((entry)=>entry.region===requested))return {matched:true,mode:"exact_region"};
  if(sameCountry.some((entry)=>entry.region==="NATIONWIDE"))return {matched:true,mode:"nationwide_fallback"};
  return {matched:false,mode:"none"};
}
function countStage(rows){
  const out={};for(const row of asArray(rows)){const key=text(row&&row.stageStatus)||"unknown";out[key]=(out[key]||0)+1;}return out;
}
function stageName(row){ return text(row&&row.stageStatus)||text(row&&row.lifecycle&&row.lifecycle.stage); }
function stageAssignment(row){ return isObject(row&&row.lifecycle&&row.lifecycle.assignment)?row.lifecycle.assignment:{}; }
function isGoLiveAuditCandidate(row){
  return row&&(
    row.releaseEligible===true ||
    stageName(row)==="registry_sync_ready" ||
    ["audit_ready","publish_requested"].includes(low(stageAssignment(row).publicationStatus))
  );
}
function privateCandidatePreview(row){
  const card=isObject(row&&row.productCard)?row.productCard:{};
  const assignment=stageAssignment(row);
  const lifecycle=isObject(row&&row.lifecycle)?row.lifecycle:{};
  const review=isObject(row&&row.review)?row.review:{};
  return {
    candidateId:text(row&&row.candidateId)||null,
    digest:text(row&&row.digest)||null,
    title:first(card.title,row&&row.title)||null,
    image:first(card.image,row&&row.image)||null,
    priceDisplay:first(card.priceDisplay,card.price)||"판매처에서 현재 가격 확인",
    supplierName:first(card.supplierName,row&&row.supplier&&row.supplier.name)||null,
    supplierUrl:first(card.supplierUrl,row&&row.supplier&&row.supplier.officialUrl)||null,
    checkoutUrl:first(card.checkoutUrl)||null,
    checkoutMode:first(card.checkoutMode,"external_seller_checkout"),
    stageStatus:stageName(row)||null,
    nextGate:first(review.nextGate,lifecycle.nextGate)||null,
    releaseEligible:row&&row.releaseEligible===true,
    auditReady:isGoLiveAuditCandidate(row),
    assignment:{
      id:text(assignment.id)||null,
      hubKey:text(assignment.hubKey)||null,
      slotKey:text(assignment.slotKey)||null,
      countryCode:text(assignment.countryCode)||null,
      regionCode:text(assignment.regionCode)||null,
      state:text(assignment.state)||null,
      publicationStatus:text(assignment.publicationStatus)||null,
      priority:num(assignment.priority,0)
    },
    placement:isObject(row&&row.placement)?row.placement:{},
    marketKeys:asArray(row&&row.marketKeys).slice(0,30),
    revenue:isObject(row&&row.revenue)?{type:text(row.revenue.type)||null,monetizationState:text(row.revenue.monetizationState)||null,contractId:text(row.revenue.contractId)||null}:{},
    reasons:asArray(row&&row.reasons).slice(0,30),
    proposedPlacements:asArray(row&&row.proposedPlacements).slice(0,20)
  };
}
function privateStageStatus(root, scope, suppliedDoc, limitInput){
  let doc=suppliedDoc||null;
  if(!doc){try{doc=CommerceIntake.readStage(root);}catch(_error){doc=null;}}
  const all=asArray(doc&&doc.candidates);
  const rows=all.filter((row)=>privateStageScopeMatch(row,scope).matched);
  const eligible=rows.filter((row)=>row&&row.releaseEligible===true).length;
  const registrySyncReady=rows.filter((row)=>stageName(row)==="registry_sync_ready").length;
  const auditReady=rows.filter((row)=>["audit_ready","ready"].includes(low(stageAssignment(row).publicationStatus))).length;
  const publicationRequested=rows.filter((row)=>low(stageAssignment(row).publicationStatus)==="publish_requested").length;
  const publicationRows=rows.filter(isGoLiveAuditCandidate);
  const held=rows.length-publicationRows.length;
  let nextGate="product_research_and_private_queue";
  if(rows.length&&publicationRows.length===0)nextGate="complete_evidence_revenue_and_psom_approval";
  if(publicationRows.length>0)nextGate="go_live_audit_and_explicit_publication_request";
  const limit=safeLimit(limitInput||MAX_ROWS);
  return {
    available:!!doc,
    schema:text(doc&&doc.schema)||null,
    version:text(doc&&doc.version)||null,
    generatedAt:text(doc&&doc.generatedAt)||null,
    totalAll:all.length,
    selectedScope:scope,
    totalCandidates:rows.length,
    eligibleForRelease:eligible,
    registrySyncReady,
    auditReady,
    publicationRequested,
    goLiveAuditCandidates:publicationRows.length,
    held,
    byStageStatus:countStage(rows),
    releaseGate:isObject(doc&&doc.releaseGate)?doc.releaseGate:{},
    nextGate,
    rows:rows.slice(0,limit).map(privateCandidatePreview),
    publicationCandidateIds:publicationRows.map((row)=>text(row&&row.candidateId)).filter(Boolean),
    automaticPublication:false,
    paymentExecution:false
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
function releaseControl(input){
  const explicitAdminAuthorization=!!(input&&input.explicitAdminAuthorization===true);
  const release=ReleaseDispatch.releaseArmed({explicitAdminAuthorization});
  const hook=ReleaseDispatch.validHook(process.env[ReleaseDispatch.HOOK_ENV]);
  return {
    version:ReleaseDispatch.VERSION,
    armed:release.armed===true,
    environmentArmed:release.environmentArmed===true,
    explicitAdminAuthorization:release.explicitAdminAuthorization===true,
    mode:release.mode||"",
    keyPresent:release.keyPresent===true,
    hookConfigured:!!hook,
    actionAvailable:release.armed===true&&!!hook,
    explicitAdminConfirmationAvailable:!!hook,
    action:"request_publication",
    targetMode:"selected-product-assignment",
    automaticPublication:false,
    confirmationRequired:true,
    secretsExcluded:true
  };
}
function summarize(mode, limit, scopeInput, privateDoc){
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
      key:record.spec.key, publicPath:record.spec.publicPath, available:!!(record.source && record.source.exists),
      parseError:record.source && record.source.error ? record.source.error : null, copies:record.copies,
      sourceTotalItems:sourceRows.length,totalItems:rows.length,selectedScope:scope,seedOrSample:0,productSignals:0,realProductCandidates:0,
      readyAffiliate:0,readyDirectRevenue:0,revenueReviewRequired:0,readyExternalReferral:0,hold:0,block:0
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
  const privateStage = privateStageStatus(process.cwd(), scope, privateDoc, limit);
  const release = releaseControl({explicitAdminAuthorization:true});
  counts.privateStageCandidates = privateStage.totalCandidates;
  counts.privateStageReleaseEligible = privateStage.eligibleForRelease;
  counts.privateStageHeld = privateStage.held;
  counts.goLiveAuditCandidates = privateStage.goLiveAuditCandidates;
  counts.auditReady = privateStage.auditReady;
  counts.publicationRequested = privateStage.publicationRequested;
  const copiesOk = snapshotReports.every(x => x.available && x.copies.synchronized);
  const realReady = counts.readyAffiliate + counts.readyDirectRevenue + counts.readyExternalReferral;
  let gate = "not_ready";
  let gateReason = "no-real-product-candidate";

  if(privateStage.goLiveAuditCandidates>0){
    if(mode!=="production"){ gate="hold"; gateReason="select-production-mode-for-final-publication-request"; }
    else if(!release.hookConfigured){ gate="hold"; gateReason="publication-build-hook-not-configured-request-will-persist"; }
    else { gate="ready_for_publication_request"; gateReason="select-one-audited-candidate-and-confirm-publication"; }
  }else if(counts.realProductCandidates > 0 && realReady === 0){ gate = "hold"; gateReason = "real-products-require-front-readiness"; }
  else if(realReady > 0 && !copiesOk){ gate = "hold"; gateReason = "snapshot-copies-not-synchronized"; }
  else if(realReady > 0 && copiesOk){ gate = "ready_for_canary"; gateReason = "published-products-ready-for-manual-canary"; }
  else if(privateStage.totalCandidates > 0){ gate = "hold"; gateReason = "private-candidates-awaiting-evidence-revenue-or-psom-approval"; }

  const statusCounts = { readyAffiliate:counts.readyAffiliate, readyDirectRevenue:counts.readyDirectRevenue, revenueReviewRequired:counts.revenueReviewRequired, readyExternalReferral:counts.readyExternalReferral, hold:counts.hold, block:counts.block };
  return {
    ok:true,
    status:["ready_for_publication_request","ready_for_canary"].includes(gate)?"ok":(gate==="hold"?"warn":"info"),
    version:VERSION, mode, selectedScope:scope,
    scopePolicy:{ exactRegionFirst:true, nationwideFallbackWithinSameCountry:true, crossCountryFallback:false, unresolvedScope:"empty" },
    auditReadOnly:true,
    explicitPublicationRequest:true,
    externalNavigation:false,
    providerCalls:false,
    generatedAt:new Date().toISOString(),
    gate:{ state:gate, reason:gateReason, note:"GET audit is read-only. Only an authenticated, explicit final publication request for one audited assignment can arm that assignment and queue the existing build pipeline. The build still re-runs registry, market, revenue, Canonical and snapshot gates." },
    releaseControl:release,
    summary:counts,
    statusCounts,
    runtime,
    pipeline:{
      researchQueue:"authenticated-live-db",
      privateCandidateStage:privateStage,
      promotionOrder:["product_research","administrator_selection","market_evidence","verified_evidence","approved_revenue_route","psom_assignment","go_live_audit","explicit_publication_request","registry_sync","private_candidate_intake","canonical_canary","front_snapshot"],
      automaticPublication:false,
      targetedProductPublication:true,
      igdcCheckout:false,
      externalSellerCheckout:true
    },
    snapshots:snapshotReports,
    candidateRows:realRows.slice(0, limit),
    candidateRowsTruncated:Math.max(0, realRows.length - limit)
  };
}

const READ_ROLES=new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager"]);
const PUBLISH_ROLES=new Set(["owner","admin","site_manager","site_manager_director","director"]);
function normalizedRoles(actor){return Array.from(new Set(asArray(actor&&actor.roles).map((role)=>low(role).replace(/\s+/g,"_")).filter(Boolean)));}
function requireActorRole(actor, publish){
  const allowed=publish?PUBLISH_ROLES:READ_ROLES;
  if(!normalizedRoles(actor).some((role)=>allowed.has(role))){const error=new Error(publish?"최종 사이트 게재 요청 권한이 없습니다.":"실상품 공급 개방 점검 권한이 없습니다.");error.statusCode=403;error.code="admin_capability_required";throw error;}
}
function parseBody(event){
  if(!event||!event.body)return {};
  try{return JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body);}catch(_error){const error=new Error("요청 JSON 형식이 올바르지 않습니다.");error.statusCode=400;error.code="invalid_json";throw error;}
}
function resolveScope(event, body){
  const requestedCountry=text(first(body&&body.country,getParam(event,"country"))).toUpperCase();
  const requestedRegion=first(body&&body.region,getParam(event,"region"));
  const geo=geoScope(event);
  if(requestedCountry==="GLOBAL")return { country:null, region:"ALL", active:false, source:"administrator-global", fallback:"global-read", crossCountry:false };
  if(requestedCountry)return selectedScope(requestedCountry,requestedRegion);
  if(geo.resolved)return Object.assign(selectedScope(geo.country,geo.region),{source:"request-ip"});
  return { country:null, region:null, active:true, unresolved:true, source:geo.excluded?"excluded-ip":"unresolved-ip", fallback:"empty", crossCountry:false, excluded:geo.excluded, detectedCountry:geo.detectedCountry };
}
function findPrivateCandidate(doc, scope, candidateId){
  return asArray(doc&&doc.candidates).find((row)=>text(row&&row.candidateId)===text(candidateId)&&privateStageScopeMatch(row,scope).matched&&isGoLiveAuditCandidate(row))||null;
}
async function assignmentForPublication(candidateId, scope){
  const rows=await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,updated_at&candidate_id=eq."+encodeURIComponent(candidateId)+"&order=updated_at.desc&limit=100");
  return asArray(rows).find((row)=>{
    if(!["approved","pinned"].includes(low(row&&row.state)))return false;
    if(!["audit_ready","publish_requested","ready"].includes(low(row&&row.publication_status)))return false;
    if(!scope||!scope.active||scope.country==="UNSCOPED")return true;
    const country=normalizeCountry(row&&row.country_code);if(country!==scope.country)return false;
    if(scope.region==="ALL")return true;
    const region=normalizeRegion(row&&row.region_code||"NATIONWIDE",country)||"NATIONWIDE";
    return region===scope.region||region==="NATIONWIDE";
  })||null;
}
async function requestPublication(event, actor, body, scope, liveDoc){
  requireActorRole(actor,true);
  if(cleanMode(body&&body.mode)!=="production"){const error=new Error("최종 사이트 게재 요청은 실상품 운영 모드에서만 가능합니다.");error.statusCode=409;error.code="production_mode_required";throw error;}
  if(text(body&&body.confirmation)!=="SITE_PUBLISH"){const error=new Error("최종 사이트 게재 확인 문구가 일치하지 않습니다.");error.statusCode=409;error.code="publication_confirmation_required";throw error;}
  const candidateId=text(body&&body.candidateId);if(!candidateId){const error=new Error("게재할 상품 후보를 한 건 선택해야 합니다.");error.statusCode=400;error.code="candidate_required";throw error;}
  const candidate=findPrivateCandidate(liveDoc,scope,candidateId);
  if(!candidate){const error=new Error("현재 범위에서 실상품 공급 개방 점검을 통과한 후보가 아닙니다.");error.statusCode=409;error.code="candidate_not_audit_ready";throw error;}
  const expectedDigest=text(body&&body.expectedDigest);
  if(expectedDigest&&text(candidate&&candidate.digest)!==expectedDigest){const error=new Error("후보 정보가 변경됐습니다. 개방 점검을 다시 실행해 주세요.");error.statusCode=409;error.code="candidate_changed";throw error;}
  // The authenticated administrator confirmation is the publication authority.
  // Persist the assignment first; build-hook availability controls only whether
  // the static SearchBank/Snapshot rebuild starts immediately.
  const assignment=await assignmentForPublication(candidateId,scope);
  if(!assignment){const error=new Error("최종 승인된 PSOM 배정을 찾지 못했습니다.");error.statusCode=409;error.code="audit_ready_assignment_missing";throw error;}
  const originalStatus=low(assignment.publication_status)||"audit_ready";
  const now=new Date().toISOString();
  let persistence={updated:[],failed:[],trace:{schema:"igdc-assignment-publication-persistence.v1",requested:1,status:"publish_requested",attempted:0,updateReturned:0,readBack:1,confirmed:1,failed:0,ok:true,alreadyPersisted:true}};
  if(originalStatus!=="publish_requested"){
    persistence=await bulkAssignmentStatus([{candidateId,candidate,assignment,originalStatus}],"publish_requested",actor&&actor.sub);
    if(!persistence.updated.length){const failure=persistence.failed[0];const error=new Error("관리자 게재 요청을 배정 원장에 저장하지 못했습니다.");error.statusCode=409;error.code=text(failure&&failure.error&&failure.error.code)||"publication_persistence_unverified";error.lifecycleTrace={stage:"publish_requested_readback",persistence:persistence.trace};throw error;}
  }
  const dispatch=await ReleaseDispatch.dispatch({candidateId,assignmentId:assignment.id,actorId:text(actor&&actor.sub),operation:"publish",candidateCount:1,explicitAdminAuthorization:true});
  const queued=dispatch.queued===true;
  return {
    ok:true,status:queued?"queued":"pending_build",version:VERSION,action:"request_publication",
    candidate:{candidateId,title:first(candidate&&candidate.productCard&&candidate.productCard.title,candidate&&candidate.title)||null,digest:text(candidate&&candidate.digest)||null},
    assignment:{id:assignment.id,hubKey:assignment.hub_key,slotKey:assignment.slot_key,countryCode:assignment.country_code,regionCode:assignment.region_code||null,publicationStatus:"publish_requested"},
    release:{queued,reason:dispatch.reason,status:dispatch.status||null,hookConfigured:dispatch.hookConfigured===true},
    persisted:true,persistenceVerified:true,persistence:persistence.trace,pendingBuild:!queued,
    note:queued?"선택한 상품의 관리자 게재 요청을 원장에 저장하고 빌드 대기열에 등록했습니다. 빌드에서 원장 동기화·Canonical·국가/IP·프론트 스냅샷 검증을 다시 통과해야 실제 사이트에 반영됩니다.":"선택한 상품의 관리자 게재 요청은 원장에 저장했습니다. 자동 빌드 훅이 없거나 실패하여 즉시 스냅샷 빌드는 시작되지 않았지만, 다음 정상 배포가 이 publish_requested 원장을 소비합니다."
  };
}


function uniqueCandidateIds(body){
  const seen=new Set(),out=[];
  for(const value of asArray(body&&body.candidateIds)){
    const id=text(value);
    if(!id||seen.has(id))continue;
    seen.add(id);out.push(id);
  }
  return out.slice(0,1800);
}
function assignmentScopeMatch(row,scope){
  if(!row||!["approved","pinned"].includes(low(row.state)))return false;
  if(!scope||!scope.active||scope.country==="UNSCOPED")return true;
  const country=normalizeCountry(row.country_code);if(country!==scope.country)return false;
  if(scope.region==="ALL")return true;
  const region=normalizeRegion(row.region_code||"NATIONWIDE",country)||"NATIONWIDE";
  return region===scope.region||region==="NATIONWIDE";
}
function chunkRows(rows,size){
  const out=[];for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out;
}
function inFilter(values){return encodeURIComponent("("+values.map((value)=>text(value)).filter(Boolean).join(",")+")");}
async function assignmentRowsForCandidates(candidateIds){
  const rows=[];
  for(const ids of chunkRows(candidateIds,80)){
    if(!ids.length)continue;
    const found=await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,updated_at&candidate_id=in."+inFilter(ids)+"&order=updated_at.desc&limit=5000");
    rows.push(...asArray(found));
  }
  return rows;
}
async function assignmentRowsForIds(assignmentIds){
  const rows=[];
  for(const ids of chunkRows(assignmentIds,80)){
    if(!ids.length)continue;
    const found=await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,updated_at&id=in."+inFilter(ids)+"&order=updated_at.desc&limit=5000");
    rows.push(...asArray(found));
  }
  return rows;
}
function assignmentStatusConfirmed(actualInput,expectedInput){
  const actual=low(actualInput),expected=low(expectedInput);
  if(expected==="publish_requested")return ["publish_requested","published"].includes(actual);
  if(expected==="audit_ready")return ["audit_ready","ready","not_ready"].includes(actual);
  if(expected==="unpublish_requested")return ["unpublish_requested","not_ready"].includes(actual);
  return actual===expected;
}
function selectAssignment(rows,candidateId,scope){
  return asArray(rows).find((row)=>text(row&&row.candidate_id)===candidateId&&assignmentScopeMatch(row,scope))||null;
}
function batchErrorItem(candidateId,error,status){
  return {candidateId,status:status||"blocked",queued:false,reason:text(error&&error.code)||text(error&&error.message)||"batch_item_blocked",assignmentId:null};
}
async function bulkAssignmentStatus(items,status,actorId){
  const updated=[],failed=[],trace={schema:"igdc-assignment-publication-persistence.v1",requested:asArray(items).length,status,attempted:0,updateReturned:0,readBack:0,confirmed:0,failed:0};
  for(const group of chunkRows(items,80)){
    const ids=group.map((item)=>text(item&&item.assignment&&item.assignment.id)).filter(Boolean);
    if(!ids.length)continue;
    trace.attempted+=ids.length;
    try{
      const rows=await SlotStore.update("gslot_slot_assignments","id=in."+inFilter(ids),{publication_status:status,updated_at:new Date().toISOString(),updated_by:text(actorId)});
      trace.updateReturned+=asArray(rows).length;
      const readBack=await assignmentRowsForIds(ids);
      trace.readBack+=readBack.length;
      const confirmed=new Map(asArray(readBack).map((row)=>[text(row&&row.id),row]));
      for(const item of group){
        const id=text(item&&item.assignment&&item.assignment.id);
        const persisted=confirmed.get(id);
        if(!persisted)failed.push({item,error:Object.assign(new Error("배정 상태 저장 후 원장 재조회에서 행을 찾지 못했습니다."),{code:"assignment_update_missing"})});
        else if(!assignmentStatusConfirmed(persisted.publication_status,status))failed.push({item,error:Object.assign(new Error("배정 상태 저장값이 요청 상태와 일치하지 않습니다."),{code:"assignment_status_readback_mismatch",actualStatus:low(persisted.publication_status),expectedStatus:low(status)})});
        else updated.push(Object.assign({},item,{assignment:Object.assign({},item.assignment,{publication_status:persisted.publication_status,updated_at:persisted.updated_at||item.assignment.updated_at})}));
      }
    }catch(error){for(const item of group)failed.push({item,error});}
  }
  trace.confirmed=updated.length;trace.failed=failed.length;trace.ok=failed.length===0&&updated.length===trace.requested;
  return {updated,failed,trace};
}
async function rollbackAssignmentStatuses(items,actorId){
  const groups=new Map();
  for(const item of items){
    const status=low(item&&item.originalStatus)||"audit_ready";
    if(!groups.has(status))groups.set(status,[]);
    groups.get(status).push(item);
  }
  for(const [status,rows] of groups){
    try{await bulkAssignmentStatus(rows,status,actorId);}catch(_error){}
  }
}
function batchSummary(action,candidateIds,items,release,lifecycleTrace){
  const queued=items.filter((item)=>item.queued===true).length;
  const persisted=items.filter((item)=>item.persisted===true).length;
  const pendingBuild=items.filter((item)=>item.pendingBuild===true).length;
  const blocked=items.filter((item)=>item.status==="blocked"||item.status==="unpublish_failed").length;
  const skipped=items.filter((item)=>item.status==="unmatched"||item.status==="already_unmatched").length;
  return {
    ok:true,
    status:queued?(blocked?"partial":"queued"):(pendingBuild?(blocked?"partial":"pending_build"):(blocked?"blocked":"empty")),
    version:VERSION,
    action,
    requested:candidateIds.length,
    queued,
    persisted,
    pendingBuild,
    blocked,
    skipped,
    items,
    release:release||{queued:false,reason:candidateIds.length?"no_eligible_products":"no_selected_products"},
    lifecycleTrace:lifecycleTrace||null,
    automaticPublication:false,
    publicSnapshotConfirmed:false,
    buildVerificationRequired:true
  };
}
async function requestPublicationBatch(event,actor,body,scope,liveDoc){
  requireActorRole(actor,true);
  if(cleanMode(body&&body.mode)!=="production"){const error=new Error("최종 사이트 게재 요청은 실상품 운영 모드에서만 가능합니다.");error.statusCode=409;error.code="production_mode_required";throw error;}
  if(text(body&&body.confirmation)!=="SITE_PUBLISH"){const error=new Error("최종 사이트 게재 확인 값이 일치하지 않습니다.");error.statusCode=409;error.code="publication_confirmation_required";throw error;}
  const candidateIds=uniqueCandidateIds(body);
  if(!candidateIds.length)return batchSummary("request_publication_batch",candidateIds,[],{queued:false,reason:"no_selected_products"});
  // Do not discard an authenticated manual match because an environment gate
  // or build hook is absent. The durable assignment is authoritative and the
  // next successful build consumes it.
  const lifecyclePrepared=body&&body.preparedByFrontLifecycle===true;
  const liveRows=asArray(liveDoc&&liveDoc.candidates).filter((row)=>privateStageScopeMatch(row,scope).matched&&isGoLiveAuditCandidate(row));
  const liveById=new Map(liveRows.map((row)=>[text(row&&row.candidateId),row]));
  let assignmentRows=[];
  try{assignmentRows=await assignmentRowsForCandidates(candidateIds);}catch(error){
    return batchSummary("request_publication_batch",candidateIds,candidateIds.map((id)=>batchErrorItem(id,error)),{queued:false,reason:text(error&&error.code)||"assignment_lookup_failed"});
  }
  const items=[],eligible=[],lifecycleTrace={schema:"igdc-product-publication-lifecycle-trace.v1",selected:candidateIds.length,assignmentLookup:{rows:assignmentRows.length,eligible:0,blocked:0},persistence:null,dispatch:null};
  for(const candidateId of candidateIds){
    const candidate=liveById.get(candidateId)||null;
    if(!candidate&&!lifecyclePrepared){items.push({candidateId,status:"blocked",queued:false,persisted:false,pendingBuild:false,reason:"candidate_not_audit_ready",assignmentId:null});continue;}
    const assignment=selectAssignment(assignmentRows,candidateId,scope);
    if(!assignment||!["audit_ready","publish_requested","ready"].includes(low(assignment.publication_status))){items.push({candidateId,status:"blocked",queued:false,reason:"audit_ready_assignment_missing",assignmentId:assignment&&assignment.id||null});continue;}
    eligible.push({candidateId,candidate,assignment,originalStatus:low(assignment.publication_status)||"audit_ready"});
  }
  lifecycleTrace.assignmentLookup.eligible=eligible.length;lifecycleTrace.assignmentLookup.blocked=items.length;
  const already=eligible.filter((item)=>item.originalStatus==="publish_requested"),toUpdate=eligible.filter((item)=>item.originalStatus!=="publish_requested");
  let updated=[];
  if(toUpdate.length){
    const updateResult=await bulkAssignmentStatus(toUpdate,"publish_requested",actor&&actor.sub);
    updated=updateResult.updated;
    lifecycleTrace.persistence=updateResult.trace;
    for(const failure of updateResult.failed)items.push({candidateId:failure.item.candidateId,status:"blocked",queued:false,persisted:false,persistenceVerified:false,pendingBuild:false,reason:text(failure.error&&failure.error.code)||"assignment_update_failed",assignmentId:failure.item.assignment.id});
  }else{
    lifecycleTrace.persistence={schema:"igdc-assignment-publication-persistence.v1",requested:already.length,status:"publish_requested",attempted:0,updateReturned:0,readBack:already.length,confirmed:already.length,failed:0,ok:true,alreadyPersisted:true};
  }
  const active=already.concat(updated);
  if(!active.length)return batchSummary("request_publication_batch",candidateIds,items,{queued:false,reason:"no_eligible_products"},lifecycleTrace);
  const firstItem=active[0];
  const dispatch=await ReleaseDispatch.dispatch({candidateId:firstItem.candidateId,assignmentId:firstItem.assignment.id,actorId:text(actor&&actor.sub),operation:"publish",candidateCount:active.length,explicitAdminAuthorization:true});
  lifecycleTrace.dispatch={queued:dispatch.queued===true,reason:text(dispatch.reason)||null,status:text(dispatch.status)||null,hookConfigured:dispatch.hookConfigured===true,candidateCount:active.length};
  if(!dispatch.queued){
    for(const item of active)items.push({candidateId:item.candidateId,status:"publish_requested",queued:false,persisted:true,persistenceVerified:true,pendingBuild:true,reason:text(dispatch.reason)||"publication_build_pending",assignmentId:item.assignment.id});
    return batchSummary("request_publication_batch",candidateIds,items,dispatch,lifecycleTrace);
  }
  for(const item of active)items.push({candidateId:item.candidateId,status:"publish_requested",queued:true,persisted:true,persistenceVerified:true,pendingBuild:false,reason:text(dispatch.reason)||"build_hook_queued",assignmentId:item.assignment.id});
  return batchSummary("request_publication_batch",candidateIds,items,dispatch,lifecycleTrace);
}
async function requestUnpublicationBatch(event,actor,body,scope){
  requireActorRole(actor,true);
  if(cleanMode(body&&body.mode)!=="production"){const error=new Error("전체 매칭 해제는 실상품 운영 모드에서만 가능합니다.");error.statusCode=409;error.code="production_mode_required";throw error;}
  if(text(body&&body.confirmation)!=="SITE_UNPUBLISH"){const error=new Error("전체 매칭 해제 확인 값이 일치하지 않습니다.");error.statusCode=409;error.code="unpublication_confirmation_required";throw error;}
  const candidateIds=uniqueCandidateIds(body);
  if(!candidateIds.length)return batchSummary("request_unpublication_batch",candidateIds,[],{queued:false,reason:"no_selected_products"});
  // Unpublication is also durable first. A missing hook delays the rebuild but
  // must not restore the old published state in the management ledger.
  let assignmentRows=[];
  try{assignmentRows=await assignmentRowsForCandidates(candidateIds);}catch(error){
    return batchSummary("request_unpublication_batch",candidateIds,candidateIds.map((id)=>({candidateId:id,status:"unpublish_failed",queued:false,reason:text(error&&error.code)||"assignment_lookup_failed",assignmentId:null})),{queued:false,reason:text(error&&error.code)||"assignment_lookup_failed"});
  }
  const items=[],toUpdate=[];
  for(const candidateId of candidateIds){
    const assignment=selectAssignment(assignmentRows,candidateId,scope);
    if(!assignment){items.push({candidateId,status:"unpublish_failed",queued:false,reason:"assignment_missing",assignmentId:null});continue;}
    const originalStatus=low(assignment.publication_status)||"audit_ready";
    if(["audit_ready","ready","not_ready"].includes(originalStatus)){items.push({candidateId,status:"unmatched",queued:false,reason:"already_not_published",assignmentId:assignment.id});continue;}
    if(!["publish_requested","published","matched","active"].includes(originalStatus)){items.push({candidateId,status:"unpublish_failed",queued:false,reason:"unsupported_publication_status",assignmentId:assignment.id});continue;}
    toUpdate.push({candidateId,assignment,originalStatus});
  }
  if(!toUpdate.length)return batchSummary("request_unpublication_batch",candidateIds,items,{queued:false,reason:"no_published_products"});
  const updateResult=await bulkAssignmentStatus(toUpdate,"audit_ready",actor&&actor.sub);
  for(const failure of updateResult.failed)items.push({candidateId:failure.item.candidateId,status:"unpublish_failed",queued:false,reason:text(failure.error&&failure.error.code)||"assignment_update_failed",assignmentId:failure.item.assignment.id});
  const active=updateResult.updated;
  if(!active.length)return batchSummary("request_unpublication_batch",candidateIds,items,{queued:false,reason:"no_updated_products"});
  const firstItem=active[0];
  const dispatch=await ReleaseDispatch.dispatch({candidateId:firstItem.candidateId,assignmentId:firstItem.assignment.id,actorId:text(actor&&actor.sub),operation:"unpublish",candidateCount:active.length,explicitAdminAuthorization:true});
  if(!dispatch.queued){
    for(const item of active)items.push({candidateId:item.candidateId,status:"unpublish_requested",queued:false,persisted:true,pendingBuild:true,reason:text(dispatch.reason)||"unpublication_build_pending",assignmentId:item.assignment.id});
    return batchSummary("request_unpublication_batch",candidateIds,items,dispatch);
  }
  for(const item of active)items.push({candidateId:item.candidateId,status:"unpublish_requested",queued:true,persisted:true,pendingBuild:false,reason:text(dispatch.reason)||"build_hook_queued",assignmentId:item.assignment.id});
  return batchSummary("request_unpublication_batch",candidateIds,items,dispatch);
}

exports.handler = async function(event){
  const method=String(event&&event.httpMethod||"GET").toUpperCase();
  if(method==="OPTIONS")return {statusCode:204,headers:Object.assign(noStoreHeaders(),{allow:"GET, HEAD, POST, OPTIONS"}),body:""};
  if(!["GET","HEAD","POST"].includes(method))return json(405,{ok:false,error:"method_not_allowed",allowed:["GET","HEAD","POST"]});
  try{
    const actor=await AdminSession.resolveUser(event);
    requireActorRole(actor,method==="POST");
    const body=method==="POST"?parseBody(event):{};
    const action=low(first(body.action,getParam(event,"action"),method==="POST"?"request_publication":"audit"));
    const scope=resolveScope(event,body);
    const liveDoc=await CandidateReview.stage(process.cwd());
    if(method==="POST"){
      if(action!=="request_publication")return json(404,{ok:false,error:"unsupported_action"});
      const result=await requestPublication(event,actor,body,scope,liveDoc);
      return json(202,result);
    }
    const mode=cleanMode(getParam(event,"mode"));
    const limit=safeLimit(getParam(event,"limit"));
    const report=summarize(mode,limit,scope,liveDoc);
    report.session={roles:normalizedRoles(actor),publicationAuthorized:normalizedRoles(actor).some((role)=>PUBLISH_ROLES.has(role))};
    if(method==="HEAD")return {statusCode:200,headers:noStoreHeaders(),body:""};
    return json(200,report);
  }catch(error){
    return json(error&&error.statusCode||500,{ok:false,status:"error",version:VERSION,error:String(error&&error.message||error),code:error&&error.code||null});
  }
};

module.exports={handler:exports.handler,VERSION,summarize,selectedScope,scopeMatch,itemMarketScopes,geoScope,privateStageStatus,privateStageScopeMatch,releaseControl,isGoLiveAuditCandidate,requestPublication,requestPublicationBatch,requestUnpublicationBatch};
