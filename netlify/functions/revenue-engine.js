/**
 * revenue-engine.js
 * ------------------------------------------------------------
 * IGDC / MARU Revenue Engine
 *
 * Role:
 * - Actual revenue core used by maru-search require("./revenue-engine")
 * - Computes search/ad/click/commerce/media/donation/affiliate revenue lines
 * - Generates Admin/Health compatible report structures
 * - Does not require external packages or secrets
 *
 * CommonJS / Netlify Functions compatible.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "revenue-engine-v1.1.0-nonpg-final";

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function n(v, d = 0){
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function bool(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const x = low(v);
  return !!x && !["0","false","no","off","disabled","null","undefined"].includes(x);
}
function hash(v){
  return crypto.createHash("sha1").update(String(v || "")).digest("hex").slice(0,16);
}
function stableId(v){ return "rev-" + hash(v); }
function nowIso(){ return new Date().toISOString(); }
function exists(file){ try { return fs.existsSync(file); } catch(e){ return false; } }
function readJson(file){ try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch(e){ return null; } }
function candidatePaths(name){
  return [
    path.join(process.cwd(), name),
    path.join(process.cwd(), "data", name),
    path.join(process.cwd(), "secure", name),
    path.join(process.cwd(), "netlify", "functions", "data", name),
    path.join(process.cwd(), "netlify", "functions", "secure", name),
    path.join(process.cwd(), "functions", "data", name),
    path.join(process.cwd(), "functions", "secure", name),
    path.join(__dirname, name),
    path.join(__dirname, "data", name),
    path.join(__dirname, "secure", name)
  ];
}
function readFirstJson(name){
  for(const p of candidatePaths(name)){
    if(exists(p)) return { path:p, data:readJson(p) };
  }
  return { path:null, data:null };
}
function requireFirst(name){
  for(const p of candidatePaths(name)){
    if(exists(p)){
      try { return { path:p, data:require(p) }; } catch(e){}
    }
  }
  return { path:null, data:null };
}
function safeArray(x){ return Array.isArray(x) ? x : []; }
function validUrl(url){
  const v = s(url).trim();
  return !!v && v !== "#" && v !== "/" && !low(v).startsWith("javascript:");
}
function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./,""); }
  catch(e){ return ""; }
}
function fxKrwPerUsd(){
  return n(process.env.IGDC_FX_KRW_PER_USD, 1300);
}
function toUsd(amount, currency){
  const c = low(currency || "USD");
  const a = n(amount);
  if(c === "usd") return a;
  if(c === "krw") return a / fxKrwPerUsd();
  return a;
}
function fromUsd(usd, currency){
  const c = low(currency || "USD");
  if(c === "krw") return n(usd) * fxKrwPerUsd();
  return n(usd);
}

const DEFAULT_POLICY = {
  marketplace: {
    general: 0.10,
    fashion_beauty: 0.18,
    digital_goods: 0.20,
    electronics_furniture: 0.07,
    food_living: 0.09
  },
  advertising: {
    banner_cpm_usd: 2.5,
    video_cpm_usd: 5.0,
    cpc_usd: 0.25
  },
  media: {
    ad_revenue_share: 0.50,
    subscription_fee_ratio: 0.25,
    pay_per_view_ratio: 0.30
  },
  click_search: {
    general_click_usd: 0.02,
    search_cpc_usd: 0.40,
    recommend_conversion_rate: 0.05
  },
  affiliate: {
    shopping: 0.05,
    travel: 0.04,
    finance: 0.07
  },
  tour_travel: {
    flight: 0.02,
    hotel: 0.15,
    package: 0.10
  },
  subscription: {
    platform_fee_ratio: 0.25,
    premium_monthly_usd: 7.0
  },
  academic_data: {
    paper_access_usd: 2.0,
    download_usd: 3.0,
    institution_monthly_usd: 200.0,
    api_call_usd: 0.03
  },
  license: {
    royalty_ratio: 0.12
  }
};

function policy(){
  const pack = readFirstJson("revenue-policy.v1.json");
  return Object.assign({}, DEFAULT_POLICY, pack.data || {});
}
function payConfig(){
  const cfg = requireFirst("pay-config.js");
  if(cfg.data) return cfg.data;
  const json = readFirstJson("pay-config.json");
  return json.data || {};
}
function platformProfile(){
  const pack = readFirstJson("igdc.platform.profile.json");
  return pack.data && pack.data.platform_profile ? pack.data.platform_profile : null;
}
function payoutVault(){
  const pack = readFirstJson("payout.vault.json");
  return pack.data || null;
}

function trustLists(){
  const allow = readFirstJson("trust.allowlist.json").data || {};
  const block = readFirstJson("trust.blocklist.json").data || {};
  const allowDomains = Array.isArray(allow.domains) ? allow.domains : (Array.isArray(allow.allowlist) ? allow.allowlist : []);
  const blockDomains = Array.isArray(block.domains) ? block.domains : (Array.isArray(block.blocklist) ? block.blocklist : []);
  return {
    allowDomains: allowDomains.map(x => low(x)),
    blockDomains: blockDomains.map(x => low(x))
  };
}
function domainRisk(item){
  const url = item.url || item.link || "";
  const domain = low(domainOf(url));
  const lists = trustLists();

  if(!domain) return { level:"placeholder", status:"warn", reason:"no_domain_or_placeholder" };
  if(lists.blockDomains.includes(domain)) return { level:"blocked", status:"error", reason:"domain_blocklisted", domain };
  if(lists.allowDomains.includes(domain)) return { level:"trusted", status:"ok", reason:"domain_allowlisted", domain };
  if(/^http:\/\//i.test(url)) return { level:"danger", status:"error", reason:"insecure_http", domain };
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return { level:"danger", status:"error", reason:"ip_direct_endpoint", domain };
  return { level:"unverified", status:"warn", reason:"unverified_domain", domain };
}
function makeLedgerRecord(item, component, estimate){
  return {
    id: stableId([item.id, component.type, estimate && estimate.generatedAt || nowIso(), component.amountUsd].join("|")),
    ts: nowIso(),
    source: "revenue-engine",
    itemId: item.id,
    page: item.page || item.channel || item._snapshotPage || "unknown",
    section: item.section || item.psom_key || item._snapshotSection || "unknown",
    type: component.type,
    amountUsd: component.amountUsd,
    amountKrw: component.amountKrw,
    currency: "USD",
    status: "estimated_non_pg",
    provider: item.provider || item.seller || (item.commerce && item.commerce.provider) || "unknown",
    url: item.url || item.link || "#"
  };
}

function extractItemsFromSnapshot(snapshot){
  const out = [];
  function push(item, meta){
    if(!item || typeof item !== "object") return;
    out.push(Object.assign({}, item, {
      _snapshotPage: item._snapshotPage || meta.page,
      _snapshotSection: item._snapshotSection || meta.section
    }));
  }
  if(Array.isArray(snapshot)) snapshot.forEach(x => push(x, {}));
  if(snapshot && Array.isArray(snapshot.items)) snapshot.items.forEach(x => push(x, {}));
  if(snapshot && Array.isArray(snapshot.results)) snapshot.results.forEach(x => push(x, {}));
  if(snapshot && snapshot.pages && typeof snapshot.pages === "object"){
    Object.keys(snapshot.pages).forEach(page => {
      const sections = snapshot.pages[page] && snapshot.pages[page].sections || {};
      Object.keys(sections).forEach(section => {
        const sec = sections[section];
        if(Array.isArray(sec)) sec.forEach(x => push(x, { page, section }));
        else if(sec && Array.isArray(sec.slots)) sec.slots.forEach(x => push(x, { page, section }));
      });
    });
  }
  if(snapshot && snapshot.sections && typeof snapshot.sections === "object"){
    Object.keys(snapshot.sections).forEach(section => {
      const sec = snapshot.sections[section];
      if(Array.isArray(sec)) sec.forEach(x => push(x, { section }));
      else if(sec && Array.isArray(sec.slots)) sec.slots.forEach(x => push(x, { section }));
    });
  }
  return out;
}
function loadDefaultItems(){
  const names = [
    "search-bank.snapshot.json",
    "front.snapshot.json",
    "distribution.snapshot.json",
    "media.snapshot.json",
    "social.snapshot.json",
    "donation.snapshot.json",
    "tour-snapshot.json",
    "networkhub-snapshot.json"
  ];
  const items = [];
  const sources = [];
  names.forEach(name => {
    const pack = readFirstJson(name);
    if(pack.data){
      const extracted = extractItemsFromSnapshot(pack.data);
      extracted.forEach(x => items.push(x));
      sources.push({ name, path:pack.path, count:extracted.length });
    }
  });
  return { items, sources };
}

function getCommerceEngine(){
  try { return require("./maru-commerce-engine"); } catch(e){ return null; }
}
function normalizeCommerce(raw){
  const engine = getCommerceEngine();
  if(engine && typeof engine.normalizeCommerceItem === "function"){
    try { return engine.normalizeCommerceItem(raw || {}); } catch(e){}
  }
  raw = raw || {};
  return Object.assign({}, raw, {
    id: raw.id || raw.contentId || raw.productId || stableId(JSON.stringify(raw)),
    title: raw.title || raw.name || "Untitled",
    url: raw.url || raw.link || "#",
    thumb: raw.thumbnail || raw.thumb || raw.image || raw.poster || "/assets/img/placeholder.png",
    page: raw.page || raw._snapshotPage || "unknown",
    section: raw.section || raw._snapshotSection || raw.psom_key || "unknown",
    price: n(raw.price || raw.amount),
    currency: raw.currency || raw.ccy || "KRW",
    metrics: raw.metrics || {}
  });
}
function metricsOf(item){
  const m = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
  return {
    view: n(item.views ?? item.view ?? m.views ?? m.view),
    click: n(item.clicks ?? item.click ?? m.clicks ?? m.click),
    like: n(item.likes ?? item.like ?? m.likes ?? m.like),
    recommend: n(item.recommend ?? item.recommends ?? m.recommend ?? m.recommends),
    watchTimeSec: n(item.watchTimeSec ?? item.watch_time_sec ?? item.watchTime ?? m.watchTimeSec ?? m.watch_time_sec ?? m.watchTime),
    adImpression: n(item.adImpressions ?? item.impressions ?? m.adImpressions ?? m.adImpression ?? m.impressions),
    adClick: n(item.adClicks ?? m.adClicks ?? m.adClick),
    searchClick: n(item.searchClicks ?? item.searchClick ?? m.searchClicks ?? m.searchClick)
  };
}
function inferKind(item){
  const commerce = item.commerce || {};
  if(commerce.kind) return commerce.kind;
  const txt = low([
    item.kind, item.type, item.mediaType, item.category, item.page, item.section, item.title, item.summary, item.url
  ].join(" "));
  if(txt.includes("donation") || txt.includes("donate") || txt.includes("후원") || txt.includes("기부")) return "donation";
  if(txt.includes("tour") || txt.includes("travel") || txt.includes("hotel") || txt.includes("관광")) return "tour";
  if(txt.includes("video") || txt.includes("movie") || txt.includes("drama") || txt.includes("shorts") || txt.includes("youtube") || txt.includes("media")) return "media";
  if(txt.includes("ad") || txt.includes("sponsor") || txt.includes("banner")) return "ad";
  if(txt.includes("search")) return "search";
  if(txt.includes("product") || txt.includes("commerce") || txt.includes("distribution") || txt.includes("shop") || n(item.price) > 0) return "product";
  return "content";
}
function rateForMarketplace(item, pol){
  const cat = low(item.category || item.section || (item.commerce && item.commerce.category));
  if(cat.includes("fashion") || cat.includes("beauty")) return pol.marketplace.fashion_beauty;
  if(cat.includes("digital") || cat.includes("software") || cat.includes("download")) return pol.marketplace.digital_goods;
  if(cat.includes("electronics") || cat.includes("furniture")) return pol.marketplace.electronics_furniture;
  if(cat.includes("food") || cat.includes("living")) return pol.marketplace.food_living;
  return pol.marketplace.general;
}
function affiliateRate(item, pol){
  const txt = low([item.category, item.section, item.page, item.title].join(" "));
  if(txt.includes("travel") || txt.includes("tour") || txt.includes("hotel")) return pol.affiliate.travel || 0.04;
  if(txt.includes("finance")) return pol.affiliate.finance || 0.07;
  return pol.affiliate.shopping || 0.05;
}
function tourRate(item, pol){
  const txt = low([item.category, item.section, item.title].join(" "));
  if(txt.includes("hotel")) return pol.tour_travel.hotel || 0.15;
  if(txt.includes("flight")) return pol.tour_travel.flight || 0.02;
  return pol.tour_travel.package || 0.10;
}

function lineHealth(item){
  const kind = inferKind(item);
  const lines = [];

  function add(line, ok, warn, msg){
    lines.push({
      line,
      status: ok ? "ok" : (warn ? "warn" : "error"),
      message: msg || ""
    });
  }

  const isPlaceholder = !validUrl(item.url || item.link) ||
    low(item.url || item.link).includes("sample") ||
    low(item.thumb || item.thumbnail).includes("placeholder");

  const hasRevenue = !!(
    item.monetization ||
    item.linkRevenue ||
    item.directSale ||
    item.revenue ||
    item.revenueDestination ||
    item.blockchainPayment ||
    item.donation ||
    item.mediaRevenue
  );

  if(item.monetization && item.monetization.impression && item.monetization.impression.enabled){
    add("ad/impression", !!item.monetization.impression.trackId, isPlaceholder, "trackId");
  }
  if(item.monetization && item.monetization.searchClick && item.monetization.searchClick.enabled){
    add("search/click", !!item.monetization.searchClick.trackId, isPlaceholder, "trackId");
  }
  if(item.linkRevenue && item.linkRevenue.enabled){
    add("affiliate/link", !!item.linkRevenue.trackId, isPlaceholder || !validUrl(item.url), "trackId/url");
  }
  if(item.directSale && item.directSale.enabled){
    add("directSale", !!(item.directSale.productSku && item.directSale.pgProvider), isPlaceholder, "sku/pgProvider");
  }
  if(item.blockchainPayment && item.blockchainPayment.enabled){
    add("blockchainPayment", !!(item.blockchainPayment.walletAddress && safeArray(item.blockchainPayment.supportedChains).length), false, "wallet/chains");
  }
  if(item.revenueDestination){
    add("settlementDestination", !!(item.revenueDestination.settlement && item.revenueDestination.settlement.ledger), false, "ledger");
  }

  const risk = domainRisk(item);
  if(risk.status === "error") add("domain/trust", false, false, risk.reason);
  else if(risk.status === "warn") add("domain/trust", false, true, risk.reason);
  else add("domain/trust", true, false, risk.reason);

  if(!lines.length){
    if(isPlaceholder) add("none", false, true, "샘플/placeholder 수익 라인 준비중");
    else add("none", false, kind === "content", hasRevenue ? "미분류 수익 구조" : "실제 상품/콘텐츠 수익 구조 필드 없음");
  }

  const error = lines.filter(x => x.status === "error").length;
  const warn = lines.filter(x => x.status === "warn").length;
  return {
    status: error ? "error" : (warn ? "warn" : "ok"),
    ok: lines.filter(x => x.status === "ok").length,
    warn,
    error,
    risk,
    lines
  };
}

function revenueComponents(item, options = {}){
  const pol = policy();
  const kind = inferKind(item);
  const metrics = metricsOf(item);
  const price = n(item.price || (item.directSale && item.directSale.price) || (item.transaction && item.transaction.price));
  const currency = item.currency || (item.directSale && item.directSale.currency) || (item.transaction && item.transaction.currency) || "KRW";
  const priceUsd = toUsd(price, currency);

  const components = [];

  function push(type, usd, detail){
    const amountUsd = Math.max(0, n(usd));
    if(amountUsd <= 0) return;
    components.push(Object.assign({
      type,
      amountUsd,
      amountKrw: fromUsd(amountUsd, "KRW")
    }, detail || {}));
  }

  const saleRate = kind === "tour" ? tourRate(item, pol) : rateForMarketplace(item, pol);
  if((kind === "product" || kind === "tour") && priceUsd > 0){
    push("marketplace_fee", priceUsd * saleRate, { grossUsd: priceUsd, rate: saleRate });
  }

  if(item.directSale && item.directSale.enabled && priceUsd > 0){
    const directRate = saleRate || pol.marketplace.general;
    push("direct_sale_fee", priceUsd * directRate, { grossUsd: priceUsd, rate: directRate });
  }

  if(kind === "donation"){
    const gross = priceUsd || toUsd(n(item.amount || (item.donation && item.donation.amount)), currency);
    if(gross > 0) push("donation_inflow", gross, { grossUsd: gross, platformFeeRate: 0 });
  }

  const impressions = metrics.adImpression || metrics.view;
  if(impressions > 0){
    const cpm = kind === "media" ? pol.advertising.video_cpm_usd : pol.advertising.banner_cpm_usd;
    push("ad_impression", (impressions / 1000) * cpm, { impressions, cpm });
  }

  if(metrics.adClick > 0){
    push("ad_click", metrics.adClick * pol.advertising.cpc_usd, { clicks: metrics.adClick, cpc: pol.advertising.cpc_usd });
  }

  if(metrics.searchClick > 0 || kind === "search"){
    const clicks = metrics.searchClick || metrics.click;
    if(clicks > 0) push("search_click", clicks * pol.click_search.search_cpc_usd, { clicks, cpc: pol.click_search.search_cpc_usd });
  }

  if(metrics.click > 0){
    push("general_click", metrics.click * pol.click_search.general_click_usd, { clicks: metrics.click, cpc: pol.click_search.general_click_usd });
  }

  if(item.linkRevenue && item.linkRevenue.enabled){
    const rate = n(item.linkRevenue.commission, affiliateRate(item, pol));
    const conversion = n(item.linkRevenue.conversionRate, pol.click_search.recommend_conversion_rate || 0.05);
    const clickBase = metrics.click || metrics.searchClick || 1;
    const baseGross = priceUsd > 0 ? priceUsd : 20;
    push("affiliate_expected", clickBase * conversion * baseGross * rate, { clicks: clickBase, conversionRate: conversion, rate });
  }

  if(kind === "media"){
    const watchUnits = Math.floor(metrics.watchTimeSec / 30);
    if(watchUnits > 0){
      const cpm = pol.advertising.video_cpm_usd || 5.0;
      push("media_watch_time", (watchUnits / 1000) * cpm, { watchTimeSec: metrics.watchTimeSec, units30s: watchUnits, cpm });
    }

    if(metrics.like > 0){
      push("media_like_signal", metrics.like * 0.005, { likes: metrics.like });
    }

    if(metrics.recommend > 0){
      push("media_recommend_signal", metrics.recommend * 0.01, { recommends: metrics.recommend });
    }
  }

  if(kind === "academic" || low(item.category).includes("academic")){
    push("academic_access", pol.academic_data.paper_access_usd || 2.0, {});
  }

  return components;
}

function settlementSplit(item, components){
  const kind = inferKind(item);
  const totalUsd = components.reduce((a,c) => a + n(c.amountUsd), 0);
  const provider = item.provider || item.seller || (item.commerce && item.commerce.provider) || item.producerId || "provider";
  const platformProfileData = platformProfile();
  const platform = (platformProfileData && platformProfileData.org_name_en) || "IGDC";

  let platformShare = 0.20;
  let providerShare = 0.80;
  let creatorShare = 0;
  let affiliateShare = 0;

  if(kind === "media"){
    platformShare = 0.50;
    providerShare = 0.35;
    creatorShare = 0.15;
  }else if(kind === "donation"){
    platformShare = 0.00;
    providerShare = 1.00;
  }else if(kind === "ad" || kind === "search"){
    platformShare = 0.70;
    providerShare = 0.30;
  }else if(item.linkRevenue && item.linkRevenue.enabled){
    platformShare = 0.50;
    affiliateShare = 0.20;
    providerShare = 0.30;
  }

  return {
    totalUsd,
    totalKrw: fromUsd(totalUsd, "KRW"),
    currency: "USD",
    parties: [
      { party: platform, role: "platform", amountUsd: totalUsd * platformShare, amountKrw: fromUsd(totalUsd * platformShare, "KRW") },
      { party: provider, role: kind === "donation" ? "donation_target" : "provider", amountUsd: totalUsd * providerShare, amountKrw: fromUsd(totalUsd * providerShare, "KRW") },
      { party: item.creatorId || "creator_pool", role: "creator", amountUsd: totalUsd * creatorShare, amountKrw: fromUsd(totalUsd * creatorShare, "KRW") },
      { party: item.affiliateId || "affiliate_pool", role: "affiliate", amountUsd: totalUsd * affiliateShare, amountKrw: fromUsd(totalUsd * affiliateShare, "KRW") }
    ].filter(x => x.amountUsd > 0),
    cycle: "weekly_batch"
  };
}

function estimateItemRevenue(raw, options = {}){
  const item = normalizeCommerce(raw || {});
  const components = revenueComponents(item, options);
  const health = lineHealth(item);
  const settlement = settlementSplit(item, components);
  const totalUsd = components.reduce((a,c) => a + c.amountUsd, 0);

  const generatedAt = nowIso();
  const ledgerRows = components.map(c => makeLedgerRecord(item, c, { generatedAt }));
  return Object.assign({}, item, {
    revenueEngine: "revenue-engine",
    revenueVersion: VERSION,
    revenueEstimate: {
      generatedAt,
      totalUsd,
      totalKrw: fromUsd(totalUsd, "KRW"),
      currency: "USD",
      components,
      settlement,
      health,
      ledgerRows,
      pgExecution: false,
      pgStatus: "pending_pg_approval"
    }
  });
}

function estimateItemsRevenue(items, options = {}){
  return safeArray(items).map(x => estimateItemRevenue(x, options));
}

function buildSummary(items){
  const summary = {
    count: items.length,
    totalUsd: 0,
    totalKrw: 0,
    ok: 0,
    warn: 0,
    error: 0,
    byPage: {},
    bySection: {},
    byType: {},
    byComponent: {}
  };

  items.forEach(item => {
    const est = item.revenueEstimate || {};
    const total = n(est.totalUsd);
    summary.totalUsd += total;
    summary.totalKrw += n(est.totalKrw);

    const health = est.health || {};
    if(health.status === "error") summary.error++;
    else if(health.status === "warn") summary.warn++;
    else summary.ok++;

    const page = item.page || item.channel || item._snapshotPage || "unknown";
    const section = item.section || item.psom_key || item._snapshotSection || "unknown";
    const type = inferKind(item);

    summary.byPage[page] = (summary.byPage[page] || 0) + total;
    summary.bySection[section] = (summary.bySection[section] || 0) + total;
    summary.byType[type] = (summary.byType[type] || 0) + total;

    safeArray(est.components).forEach(c => {
      summary.byComponent[c.type] = (summary.byComponent[c.type] || 0) + n(c.amountUsd);
    });
  });

  summary.totalUsd = Number(summary.totalUsd.toFixed(6));
  summary.totalKrw = Math.round(summary.totalKrw);

  Object.keys(summary.byPage).forEach(k => summary.byPage[k] = Number(summary.byPage[k].toFixed(6)));
  Object.keys(summary.bySection).forEach(k => summary.bySection[k] = Number(summary.bySection[k].toFixed(6)));
  Object.keys(summary.byType).forEach(k => summary.byType[k] = Number(summary.byType[k].toFixed(6)));
  Object.keys(summary.byComponent).forEach(k => summary.byComponent[k] = Number(summary.byComponent[k].toFixed(6)));

  return summary;
}

function buildIncomeRows(summary){
  const rows = [];
  const groups = [
    ["advertising", (summary.byComponent.ad_impression || 0) + (summary.byComponent.ad_click || 0)],
    ["search_click", summary.byComponent.search_click || 0],
    ["commerce", (summary.byComponent.marketplace_fee || 0) + (summary.byComponent.direct_sale_fee || 0)],
    ["affiliate", summary.byComponent.affiliate_expected || 0],
    ["media", (summary.byComponent.media_watch_time || 0) + (summary.byComponent.media_like_signal || 0) + (summary.byComponent.media_recommend_signal || 0)],
    ["donation", summary.byComponent.donation_inflow || 0]
  ];

  groups.forEach(([name, usd]) => {
    rows.push({
      key: name,
      name,
      day: fromUsd(usd / 30, "KRW"),
      week: fromUsd(usd / 4, "KRW"),
      month: fromUsd(usd, "KRW"),
      year: fromUsd(usd * 12, "KRW"),
      total: fromUsd(usd, "KRW"),
      currency: "KRW"
    });
  });

  return rows;
}

function buildReport(inputItems, options = {}){
  let items = safeArray(inputItems);
  let sources = [];

  if(!items.length){
    const pack = loadDefaultItems();
    items = pack.items;
    sources = pack.sources;
  }

  const enriched = estimateItemsRevenue(items, options);
  const summary = buildSummary(enriched);
  const incomeRows = buildIncomeRows(summary);

  const ledgerRows = [];
  enriched.forEach(item => {
    const rows = item.revenueEstimate && Array.isArray(item.revenueEstimate.ledgerRows) ? item.revenueEstimate.ledgerRows : [];
    rows.forEach(r => ledgerRows.push(r));
  });

  return {
    ok: true,
    status: "ok",
    engine: "revenue-engine",
    version: VERSION,
    generatedAt: nowIso(),
    mode: "non_pg_operational_report",
    pgExecution: false,
    pgStatus: "pending_pg_approval",
    fx: { KRW_PER_USD: fxKrwPerUsd() },
    sources,
    summary,
    // Legacy/Admin compatibility fields
    totalRevenue: summary.totalKrw,
    totalRevenueUsd: summary.totalUsd,
    breakdown: Object.assign({}, summary.byComponent),
    breakdownKrw: Object.fromEntries(Object.entries(summary.byComponent || {}).map(([k,v]) => [k, fromUsd(v, "KRW")])),
    ledgerRows: ledgerRows.slice(0, n(options.ledgerLimit, 500)),
    income: {
      currency: "KRW",
      rows: incomeRows,
      items: incomeRows,
      summary: {
        day: incomeRows.reduce((a,r) => a + n(r.day), 0),
        week: incomeRows.reduce((a,r) => a + n(r.week), 0),
        month: incomeRows.reduce((a,r) => a + n(r.month), 0),
        year: incomeRows.reduce((a,r) => a + n(r.year), 0),
        total: incomeRows.reduce((a,r) => a + n(r.total), 0)
      }
    },
    lineHealth: {
      ok: summary.ok,
      warn: summary.warn,
      error: summary.error
    },
    items: enriched.slice(0, n(options.limit, 100, 1)),
    sample: enriched.slice(0, 20)
  };
}

function normalizeEvent(event){
  event = event || {};
  return {
    event_id: event.event_id || event.id || stableId(JSON.stringify(event) + Date.now()),
    timestamp: event.timestamp || nowIso(),
    type: event.type || event.action || "track",
    source: event.source || {},
    user: event.user || {},
    content: event.content || {},
    transaction: event.transaction || {},
    metrics: event.metrics || {}
  };
}

function trackEvent(payload){
  const event = normalizeEvent(payload.event || payload);
  const item = {
    id: event.content.item_id || event.event_id,
    type: event.type,
    page: event.source.page || event.source.service || "unknown",
    category: event.content.category,
    provider: event.content.provider_id,
    price: event.transaction.price || event.transaction.gross_amount || 0,
    currency: event.transaction.currency || "USD",
    metrics: event.metrics
  };

  const enriched = estimateItemRevenue(item);

  return {
    ok: true,
    status: "ok",
    engine: "revenue-engine",
    version: VERSION,
    action: "track",
    event,
    item: enriched,
    ledger: {
      id: event.event_id,
      ts: event.timestamp,
      type: event.type,
      amountUsd: enriched.revenueEstimate.totalUsd,
      amountKrw: enriched.revenueEstimate.totalKrw,
      status: "accepted_estimated"
    }
  };
}

function distribute(payload){
  const producerId = payload.producerId || payload.providerId || "global";
  const amount = n(payload.amount, 0);
  const currency = payload.currency || "USD";
  const grossUsd = toUsd(amount, currency);
  const item = normalizeCommerce({
    id: payload.itemId || stableId(JSON.stringify(payload)),
    provider: producerId,
    type: payload.type || "product",
    price: amount,
    currency,
    title: payload.title || "Revenue Distribution Event"
  });
  const settlement = settlementSplit(item, [{ type:"manual_distribution", amountUsd:grossUsd, amountKrw:fromUsd(grossUsd,"KRW") }]);

  return {
    ok: true,
    status: "ok",
    engine: "revenue-engine",
    version: VERSION,
    action: "distribute",
    producerId,
    grossUsd,
    grossKrw: fromUsd(grossUsd, "KRW"),
    settlement,
    ledger: {
      id: stableId(JSON.stringify(payload) + Date.now()),
      ts: nowIso(),
      producerId,
      amountUsd: grossUsd,
      amountKrw: fromUsd(grossUsd, "KRW"),
      status: "queued_weekly_batch"
    }
  };
}

async function runEngine(payload = {}){
  const action = low(payload.action || payload.mode || payload.fn || "report");

  if(action === "track") return trackEvent(payload);
  if(action === "distribute" || action === "settle" || action === "share") return distribute(payload);

  if(action === "enrich" || action === "estimate"){
    const items = estimateItemsRevenue(payload.items || payload.results || [], payload);
    return {
      ok: true,
      status: "ok",
      engine: "revenue-engine",
      version: VERSION,
      action,
      items,
      results: items,
      summary: buildSummary(items)
    };
  }

  if(action === "health"){
    return {
      ok: true,
      status: "ok",
      engine: "revenue-engine",
      version: VERSION,
      config: {
        policy: readFirstJson("revenue-policy.v1.json").path || null,
        payConfig: requireFirst("pay-config.js").path || readFirstJson("pay-config.json").path || null,
        profile: readFirstJson("igdc.platform.profile.json").path || null,
        payoutVault: readFirstJson("payout.vault.json").path || null
      },
      features: {
        searchClick: true,
        adRevenue: true,
        commerce: true,
        directSaleMetadata: true,
        pgExecution: false,
        pgStatus: "pending_pg_approval",
        affiliate: true,
        donation: true,
        mediaWatchTime: true,
        engagementSignals: true,
        ledgerRowsEstimated: true,
        trustAllowBlockCheck: true,
        weeklyBatchSettlement: true
      }
    };
  }

  return buildReport(payload.items || payload.results || [], payload);
}

const dispatch = runEngine;
const handle = runEngine;

function parseEventBody(event){
  if(!event) return {};
  if(event.httpMethod === "GET"){
    return event.queryStringParameters || {};
  }
  try{
    const raw = event.body || "";
    const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    return text ? JSON.parse(text) : (event.queryStringParameters || {});
  }catch(e){
    return event.queryStringParameters || {};
  }
}
function json(statusCode, body){
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
async function handler(event){
  try{
    const payload = parseEventBody(event || {});
    const result = await runEngine(payload);
    return json(200, result);
  }catch(e){
    return json(500, { ok:false, status:"error", engine:"revenue-engine", version:VERSION, error:String(e && e.message || e) });
  }
}

module.exports = {
  VERSION,
  handler,
  runEngine,
  dispatch,
  handle,
  estimateItemRevenue,
  estimateItemsRevenue,
  buildReport,
  trackEvent,
  distribute,
  lineHealth,
  revenueComponents,
  settlementSplit
};

if(require.main === module){
  runEngine({ action:"health" }).then(r => console.log(JSON.stringify(r,null,2))).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
