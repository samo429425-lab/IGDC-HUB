/**
 * maru-commerce-engine.js
 * ------------------------------------------------------------
 * IGDC / MARU Commerce Engine
 *
 * Role:
 * - Normalize products, content, media, donation, tour, and search/ad items
 * - Attach commerce/revenue-ready fields for Search Bank, Snapshot, Front slots
 * - Keep compatibility with Search Bank Engine requiring "./maru-commerce-engine"
 *
 * CommonJS / Netlify Functions compatible.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "maru-commerce-engine-v1.1.0-nonpg-final";

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function n(v, d = 0){
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function bool(v){
  if (v === true) return true;
  if (v === false || v == null) return false;
  const x = low(v);
  return !!x && !["0","false","no","off","disabled","null","undefined"].includes(x);
}
function hash(v){
  return crypto.createHash("sha1").update(String(v || "")).digest("hex").slice(0,16);
}
function idOf(raw){
  return s(raw && (raw.id || raw.item_id || raw.contentId || raw.productId || raw.sku)) ||
    ("cm-" + hash(JSON.stringify(raw || {})));
}
function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./,""); }
  catch(e){ return ""; }
}
function isExternalUrl(url){
  try{
    const u = new URL(url);
    return /^https?:$/.test(u.protocol);
  }catch(e){
    return false;
  }
}
function validUrl(url){
  const v = s(url).trim();
  if(!v || v === "#" || v === "/" || low(v).startsWith("javascript:")) return false;
  return true;
}
function currencyOf(raw){
  return s(raw && (raw.currency || raw.ccy || raw.priceCurrency)) || "KRW";
}
function priceOf(raw){
  if(!raw) return 0;
  if(raw.price != null) return n(raw.price);
  if(raw.amount != null) return n(raw.amount);
  if(raw.value != null) return n(raw.value);
  if(raw.transaction && raw.transaction.price != null) return n(raw.transaction.price);
  if(raw.commerce && raw.commerce.price != null) return n(raw.commerce.price);
  if(raw.directSale && raw.directSale.price != null) return n(raw.directSale.price);
  return 0;
}
function readJson(file){
  try { return JSON.parse(fs.readFileSync(file,"utf8")); }
  catch(e){ return null; }
}
function exists(file){
  try { return fs.existsSync(file); }
  catch(e){ return false; }
}
function candidatePaths(name){
  return [
    path.join(process.cwd(), name),
    path.join(process.cwd(), "data", name),
    path.join(process.cwd(), "netlify", "functions", "data", name),
    path.join(process.cwd(), "functions", "data", name),
    path.join(__dirname, name),
    path.join(__dirname, "data", name)
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
      try { return { path:p, data:require(p) }; }
      catch(e){}
    }
  }
  return { path:null, data:null };
}
function loadPayConfig(){
  const direct = requireFirst("pay-config.js");
  if(direct.data) return direct;
  const json = readFirstJson("pay-config.json");
  return json;
}
function platformProfile(){
  const pack = readFirstJson("igdc.platform.profile.json");
  return pack.data && pack.data.platform_profile ? pack.data.platform_profile : null;
}
function payoutVault(){
  const pack = readFirstJson("payout.vault.json");
  return pack.data || null;
}
function safeArray(x){
  return Array.isArray(x) ? x : [];
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
      const p = snapshot.pages[page] || {};
      const sections = p.sections || {};
      Object.keys(sections).forEach(section => {
        const sec = sections[section];
        if(Array.isArray(sec)){
          sec.forEach(x => push(x, { page, section }));
        }else if(sec && Array.isArray(sec.slots)){
          sec.slots.forEach(x => push(x, { page, section }));
        }
      });
    });
  }

  if(snapshot && snapshot.sections && typeof snapshot.sections === "object"){
    Object.keys(snapshot.sections).forEach(section => {
      const sec = snapshot.sections[section];
      if(Array.isArray(sec)){
        sec.forEach(x => push(x, { section }));
      }else if(sec && Array.isArray(sec.slots)){
        sec.slots.forEach(x => push(x, { section }));
      }
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

function inferPage(raw){
  const bind = raw && raw.bind && typeof raw.bind === "object" ? raw.bind : {};
  const txt = low([
    raw && raw.page,
    raw && raw.channel,
    raw && raw.section,
    raw && raw.route,
    raw && raw.category,
    raw && raw.type,
    bind.page,
    bind.section,
    raw && raw._snapshotPage,
    raw && raw._snapshotSection,
    raw && raw.title,
    raw && raw.url
  ].join(" "));

  if(txt.includes("donation") || txt.includes("donate") || txt.includes("후원") || txt.includes("기부")) return "donation";
  if(txt.includes("social") || txt.includes("sns") || txt.includes("youtube") || txt.includes("tiktok") || txt.includes("instagram")) return "social";
  if(txt.includes("media") || txt.includes("movie") || txt.includes("drama") || txt.includes("video") || txt.includes("shorts")) return "media";
  if(txt.includes("tour") || txt.includes("travel") || txt.includes("hotel") || txt.includes("관광") || txt.includes("여행")) return "tour";
  if(txt.includes("network")) return "network";
  if(txt.includes("distribution") || txt.includes("commerce") || txt.includes("shop") || txt.includes("product") || txt.includes("상품")) return "distribution";
  if(txt.includes("home") || txt.includes("front")) return "home";
  return s(raw && (raw._snapshotPage || raw.page || bind.page)) || "unknown";
}
function inferSection(raw){
  const bind = raw && raw.bind && typeof raw.bind === "object" ? raw.bind : {};
  return s(
    bind.section ||
    bind.psom_key ||
    raw.psom_key ||
    raw.section ||
    raw.category ||
    raw._snapshotSection ||
    raw.route ||
    "unknown"
  );
}
function inferKind(raw){
  const txt = low([
    raw && raw.kind,
    raw && raw.type,
    raw && raw.mediaType,
    raw && raw.category,
    raw && raw.title,
    raw && raw.summary,
    raw && raw.description,
    raw && raw.url,
    raw && raw.link
  ].join(" "));

  if(txt.includes("donation") || txt.includes("donate") || txt.includes("후원") || txt.includes("기부")) return "donation";
  if(txt.includes("tour") || txt.includes("travel") || txt.includes("hotel") || txt.includes("관광") || txt.includes("여행")) return "tour";
  if(txt.includes("video") || txt.includes("movie") || txt.includes("drama") || txt.includes("shorts") || txt.includes("youtube") || txt.includes("vimeo") || txt.includes("tiktok")) return "media";
  if(txt.includes("ad") || txt.includes("sponsor") || txt.includes("banner")) return "ad";
  if(txt.includes("search")) return "search";
  if(txt.includes("product") || txt.includes("commerce") || txt.includes("shop") || txt.includes("buy") || txt.includes("상품") || txt.includes("구매") || priceOf(raw) > 0) return "product";
  return "content";
}
function defaultCommission(kind, raw){
  if(raw && raw.commission != null) return n(raw.commission);
  if(raw && raw.revenue && raw.revenue.commission != null) return n(raw.revenue.commission);
  if(kind === "product") return 0.10;
  if(kind === "media") return 0.50;
  if(kind === "tour") return 0.08;
  if(kind === "ad") return 1.00;
  if(kind === "donation") return 0.00;
  return 0.05;
}
function providerOf(raw){
  const src = raw && raw.source && typeof raw.source === "object" ? raw.source : {};
  return s(
    raw.provider ||
    raw.provider_id ||
    raw.seller ||
    raw.merchant ||
    raw.producerId ||
    raw.creatorId ||
    src.name ||
    src.platform ||
    raw.source ||
    "igdc"
  );
}
function skuOf(raw){
  return s(raw && (raw.productSku || raw.sku || raw.productId || raw.contentId || raw.id)) || ("sku-" + idOf(raw));
}
function thumbOf(raw){
  return s(raw && (
    raw.thumbnail ||
    raw.thumb ||
    raw.image ||
    raw.poster ||
    raw.og_image ||
    (raw.media && raw.media.preview && raw.media.preview.poster)
  )) || "/assets/img/placeholder.png";
}
function urlOf(raw){
  return s(raw && (raw.url || raw.link || raw.href || raw.videoUrl || raw.checkoutUrl)) || "#";
}
function titleOf(raw){
  return s(raw && (raw.title || raw.name || raw.label)) || "Untitled";
}
function summaryOf(raw){
  return s(raw && (raw.summary || raw.description || raw.preview || raw.caption));
}
function metricsOf(raw){
  const m = raw && raw.metrics && typeof raw.metrics === "object" ? raw.metrics : {};
  return {
    view: n(raw.views ?? raw.view ?? m.view ?? m.views),
    click: n(raw.clicks ?? raw.click ?? m.click ?? m.clicks),
    like: n(raw.likes ?? raw.like ?? m.like ?? m.likes),
    recommend: n(raw.recommend ?? raw.recommends ?? m.recommend ?? m.recommends),
    watchTimeSec: n(raw.watchTimeSec ?? raw.watch_time_sec ?? raw.watchTime ?? m.watchTimeSec ?? m.watch_time_sec ?? m.watchTime),
    adImpression: n(raw.adImpressions ?? raw.impressions ?? m.adImpression ?? m.ad_impression ?? m.impressions),
    adClick: n(raw.adClicks ?? m.adClick ?? m.ad_click),
    searchClick: n(raw.searchClicks ?? raw.searchClick ?? m.searchClick ?? m.search_click)
  };
}
function buildTrackId(raw, kind){
  return s(raw && raw.trackId) || ["igdc", kind, idOf(raw)].join("-");
}
function revenueDestination(raw, cfg){
  if(raw && raw.revenueDestination) return raw.revenueDestination;
  const profile = platformProfile();
  const vault = payoutVault();
  const org = profile || {};
  return {
    entity: {
      id: "igtc_main",
      nameKo: org.org_name_kr || "국제종합상사",
      nameEn: org.org_name_en || "International General Trading Company"
    },
    bank: {
      status: "private",
      source: "admin_or_secure_storage",
      currency: (org.settlement && org.settlement.base_currency) || "KRW"
    },
    wallet: {
      primary: (org.settlement && org.settlement.primary_wallet) || "igdc_main_wallet"
    },
    settlement: {
      cycle: (org.settlement && org.settlement.cycle) || "monthly",
      ledger: true,
      audit: true,
      vault: !!vault
    }
  };
}

function normalizeCommerceItem(raw, options = {}){
  raw = raw || {};
  const cfgPack = loadPayConfig();
  const cfg = cfgPack.data || {};
  const kind = inferKind(raw);
  const page = inferPage(raw);
  const section = inferSection(raw);
  const id = idOf(raw);
  const url = urlOf(raw);
  const price = priceOf(raw);
  const currency = currencyOf(raw);
  const provider = providerOf(raw);
  const sku = skuOf(raw);
  const metrics = metricsOf(raw);
  const trackId = buildTrackId(raw, kind);
  const ext = isExternalUrl(url);
  const commission = defaultCommission(kind, raw);
  const directEnabled = bool(raw.directSale && raw.directSale.enabled) ||
    bool(raw.commerce && raw.commerce.directSale) ||
    (kind === "product" && price > 0 && bool(cfg.features && cfg.features.commerce));

  const affiliateEnabled = bool(raw.linkRevenue && raw.linkRevenue.enabled) ||
    bool(raw.affiliate) ||
    (ext && ["product","tour","content","media"].includes(kind) && bool(cfg.features ? cfg.features.affiliate : true));

  const donationEnabled = kind === "donation" && bool(cfg.features ? cfg.features.donation : true);
  const mediaMonetized = kind === "media";
  const adMonetized = kind === "ad" || metrics.adImpression > 0 || metrics.adClick > 0;

  const item = Object.assign({}, raw, {
    id,
    engine: "maru-commerce",
    commerceVersion: VERSION,
    title: titleOf(raw),
    summary: summaryOf(raw),
    url,
    link: url,
    thumb: thumbOf(raw),
    thumbnail: raw.thumbnail || thumbOf(raw),
    page,
    channel: raw.channel || page,
    section,
    psom_key: raw.psom_key || section,
    route: raw.route || [page, section].filter(Boolean).join("."),
    type: kind === "product" ? "product" : (raw.type || kind),
    mediaType: raw.mediaType || (kind === "media" ? "video" : kind),
    provider,
    seller: raw.seller || provider,
    productSku: sku,
    price,
    currency,
    metrics,
    commerce: {
      enabled: ["product","media","tour","donation","ad","content","search"].includes(kind),
      kind,
      sku,
      provider,
      seller: raw.seller || provider,
      category: raw.category || section || kind,
      price,
      currency,
      availability: raw.availability || (validUrl(url) ? "available" : "placeholder"),
      landingType: ext ? "external" : "internal",
      domain: domainOf(url),
      tags: Array.isArray(raw.tags) ? raw.tags : []
    },
    monetization: {
      enabled: true,
      impression: {
        enabled: adMonetized || ["media","content","product","tour"].includes(kind),
        provider: raw.adProvider || "igdc-ad",
        trackId: trackId + "-imp",
        cpmKey: kind === "media" ? "video_cpm_usd" : "banner_cpm_usd"
      },
      click: {
        enabled: true,
        trackId: trackId + "-click"
      },
      searchClick: {
        enabled: page === "home" || kind === "search",
        trackId: trackId + "-search"
      },
      engagement: {
        enabled: mediaMonetized || metrics.like > 0 || metrics.recommend > 0 || metrics.watchTimeSec > 0,
        minSeconds: 15,
        rewardType: kind === "media" ? "watch_time" : "engagement"
      },
      referral: {
        enabled: affiliateEnabled,
        partner: provider,
        trackCode: trackId + "-ref",
        commission
      }
    },
    linkRevenue: {
      enabled: affiliateEnabled,
      trackId: trackId + "-link",
      providers: provider ? [provider] : [],
      commission,
      conversionTrack: true,
      url
    },
    directSale: {
      // PG approval/execution is intentionally not performed here.
      // This engine only prepares checkout-ready commerce metadata.
      enabled: !!directEnabled,
      pgExecution: false,
      status: directEnabled ? "ready_without_pg" : "not_required",
      productSku: sku,
      price,
      currency,
      pgProvider: raw.pgProvider || (cfg.commerce && cfg.commerce.pgProvider) || "pending_pg_approval",
      checkoutEndpoint: "/.netlify/functions/checkout",
      checkoutPayload: {
        purpose: kind === "donation" ? "donation" : "commerce",
        itemId: id,
        sku,
        amount: price,
        currency,
        title: titleOf(raw),
        pgMode: "pending_approval"
      }
    },
    donation: donationEnabled ? {
      enabled: true,
      target: raw.target || (cfg.donation && cfg.donation.defaultTarget) || "mission",
      amount: price || n(raw.amount),
      currency
    } : undefined,
    mediaRevenue: mediaMonetized ? {
      enabled: true,
      watchTimeSec: metrics.watchTimeSec,
      view: metrics.view,
      like: metrics.like,
      recommend: metrics.recommend,
      model: "ads_affiliate_ppv_subscription"
    } : undefined,
    blockchainPayment: raw.blockchainPayment || {
      enabled: bool(cfg.features && cfg.features.crypto),
      walletAddress: raw.walletAddress || null,
      supportedChains: raw.supportedChains || []
    },
    revenueDestination: revenueDestination(raw, cfg),
    _commerceLineStatus: {
      url: validUrl(url) ? "ok" : "placeholder",
      price: price > 0 ? "ok" : (kind === "product" || directEnabled ? "warn" : "optional"),
      tracking: trackId ? "ok" : "warn",
      settlement: "ok"
    }
  });

  return item;
}

function normalizeItems(items, options = {}){
  return safeArray(items).map(x => normalizeCommerceItem(x, options));
}

function summarize(items){
  const summary = {
    total: items.length,
    product: 0,
    media: 0,
    donation: 0,
    tour: 0,
    ad: 0,
    content: 0,
    directSale: 0,
    affiliate: 0,
    withPrice: 0,
    withThumb: 0,
    placeholderUrl: 0,
    byPage: {},
    bySection: {}
  };
  items.forEach(item => {
    const kind = item.commerce && item.commerce.kind || inferKind(item);
    if(Object.prototype.hasOwnProperty.call(summary, kind)) summary[kind]++;
    else summary.content++;
    if(item.directSale && item.directSale.enabled) summary.directSale++;
    if(item.linkRevenue && item.linkRevenue.enabled) summary.affiliate++;
    if(n(item.price) > 0) summary.withPrice++;
    if(item.thumb && !item.thumb.includes("placeholder")) summary.withThumb++;
    if(!validUrl(item.url)) summary.placeholderUrl++;
    summary.byPage[item.page || "unknown"] = (summary.byPage[item.page || "unknown"] || 0) + 1;
    summary.bySection[item.section || "unknown"] = (summary.bySection[item.section || "unknown"] || 0) + 1;
  });
  return summary;
}

async function runEngine(payload = {}){
  const action = low(payload.action || payload.mode || payload.fn || "normalize");
  let items = safeArray(payload.items || payload.results);

  let sources = [];
  if(!items.length && (action === "report" || action === "health" || action === "items" || action === "normalize")){
    const pack = loadDefaultItems();
    items = pack.items;
    sources = pack.sources;
  }

  const normalized = normalizeItems(items, payload);

  if(action === "health"){
    return {
      ok: true,
      status: "ok",
      engine: "maru-commerce-engine",
      version: VERSION,
      config: {
        payConfig: loadPayConfig().path || null,
        platformProfile: readFirstJson("igdc.platform.profile.json").path || null
      },
      summary: summarize(normalized),
      sources
    };
  }

  if(action === "report"){
    return {
      ok: true,
      status: "ok",
      engine: "maru-commerce-engine",
      version: VERSION,
      summary: summarize(normalized),
      sources,
      sample: normalized.slice(0, 20)
    };
  }

  return {
    ok: true,
    status: "ok",
    engine: "maru-commerce-engine",
    version: VERSION,
    action,
    items: normalized,
    results: normalized,
    summary: summarize(normalized),
    sources
  };
}

function parseEventBody(event){
  if(!event) return {};
  if(event.httpMethod === "GET"){
    return event.queryStringParameters || {};
  }
  try{
    const raw = event.body || "";
    const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    return text ? JSON.parse(text) : {};
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
    return json(500, { ok:false, status:"error", engine:"maru-commerce-engine", version:VERSION, error:String(e && e.message || e) });
  }
}

module.exports = {
  VERSION,
  handler,
  runEngine,
  normalizeCommerceItem,
  normalizeItems,
  extractItemsFromSnapshot,
  summarize,
  loadDefaultItems
};

if(require.main === module){
  runEngine({ action:"report" }).then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
