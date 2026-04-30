/**
 * search-bank-engine.js — MARU Search Bank Engine (Core v10.6 global power automation)
 * ----------------------------------------------------------
 * Netlify Function (CommonJS)
 * Expand-only: keeps API compatible with v1:
 *  - exports.runEngine
 *  - exports.handler (GET)
 *
 * v10.6 practical upgrades:
 *  - Query intent / geo / sector / entity resolution
 *  - Adapter routing layer with snapshot/live/planetary/collector safe hooks
 *  - Canonical normalization expansion for geo/sector/entity/market/producer
 *  - Validation policy + composite ranking + contract-safe merge
 *  - Front page slot automation policy for media/donation/distribution/tour/social/network/home
 *  - Region/IP policy engine, country-channel blocking, region quota, operational scoring
 *  - External country policy DB, source health/timeout fallback, slot deficiency auto-fill
 *  - Locale query expansion, aging/dead-link demotion, supply/trust scoring
 *  - Central Asia region support and extension pipeline queryIndex bridge
 *  - Snapshot remote fallback timeout and response filter metadata correction
 *  - Strict external=off/noExternal adapter suppression
 *  - IP geo is policy/ranking by default; explicit/query geo is hard filter
 *  - Distribution/commerce channel alias compatibility
 *  - Target country is explicit/query only; audience country remains IP based
 *  - Explicit external suppression overrides environment defaults
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

let SearchBankSync = null;
try { SearchBankSync = require("./maru-searchbank-sync"); } catch (e) { SearchBankSync = null; }

let CommerceEngine = null;
try { CommerceEngine = require("./maru-commerce-engine"); } catch (e) { CommerceEngine = null; }


function applyCommerceEngineToItems(items, ctx){
  if(!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : [];
  if(!CommerceEngine) return items;
  try{
    if(typeof CommerceEngine.normalizeItems === "function"){
      return CommerceEngine.normalizeItems(items, { source:"search-bank", ctx });
    }
    if(typeof CommerceEngine.normalizeCommerceItem === "function"){
      return items.map(item => CommerceEngine.normalizeCommerceItem(item, { source:"search-bank", ctx }));
    }
    return items;
  }catch(e){
    try{ console.error("SearchBank Commerce Bridge Error:", e && e.message); }catch(_){}
    return items;
  }
}

let PlanetaryConnector = null;
try { PlanetaryConnector = require("./planetary-data-connector"); } catch (e) { PlanetaryConnector = null; }

let CentralCollector = null;
try { CentralCollector = require("./collector"); } catch (e) { CentralCollector = null; }

let MaruSearch = null;
try { MaruSearch = require("./maru-search"); } catch (e) { MaruSearch = null; }

// ---------- small utils ----------
function nowIso(){ return (Core && Core.nowIso) ? Core.nowIso() : new Date().toISOString(); }
function requestId(){ return (Core && Core.requestId) ? Core.requestId() : crypto.randomBytes(12).toString("hex"); }
function safeInt(n,d,min,max){ return (Core && Core.safeInt) ? Core.safeInt(n,d,min,max) : Math.min(max, Math.max(min, Math.trunc(Number.isFinite(Number(n))?Number(n):d))); }
function s(x){ return x==null? "" : String(x); }
function low(x){ return s(x).trim().toLowerCase(); }
function truthy(x){
  if(x === true) return true;
  if(x === false || x == null) return false;
  const v = low(x);
  return !!v && !["0","false","no","off","disable","disabled","null","undefined"].includes(v);
}
function stableHash(v){ return crypto.createHash("sha1").update(String(v||"")).digest("hex").slice(0,16); }
function domainOf(url){ try{ return new URL(url).hostname.replace(/^www\./,""); }catch(e){ return ""; } }

function tryReadJsonFile(p){
  try{ return JSON.parse(fs.readFileSync(p,"utf8")); }catch(e){ return null; }
}

function snapshotCandidates(){
  const cwd = process.cwd();
  return [
    path.join(cwd,"data","search-bank.snapshot.json"),
    path.join(cwd,"netlify","functions","data","search-bank.snapshot.json"),
    path.join(cwd,"functions","data","search-bank.snapshot.json"),
    path.join(__dirname,"data","search-bank.snapshot.json"),
    path.join(__dirname,"search-bank.snapshot.json"),
  ];
}

function fetchJsonNode(url){
  return new Promise((resolve) => {
    try{
      const u = new URL(url);
      const lib = (u.protocol === "http:") ? http : https;

      const req = lib.request(
        u,
        { method: "GET", headers: { "cache-control": "no-store" } },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return resolve(null);
          }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try { resolve(JSON.parse(data)); }
            catch(e){ resolve(null); }
          });
        }
      );
      req.setTimeout(6500, () => { try { req.destroy(new Error("timeout:snapshot_fetch")); } catch(e){} resolve(null); });
      req.on("error", () => resolve(null));
      req.end();
    }catch(e){
      resolve(null);
    }
  });
}
async function fetchJson(url){
  try{
    const normalizePayload = (data) => {
      if(!data) return { items: [], results: [] };
      if(Array.isArray(data)) return { items: data, results: data };
      if(Array.isArray(data.items)) return { ...data, items: data.items, results: data.items };
      if(Array.isArray(data.results)) return { ...data, items: data.results, results: data.results };
      return { ...data, items: [], results: [] };
    };

    if (typeof fetch === "function") {
      const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 6500) : null;
      const r = await fetch(url, {
        method: "GET",
        headers: { "cache-control":"no-store" },
        signal: controller ? controller.signal : undefined
      }).catch(() => null);
      if(timer) clearTimeout(timer);

      if(!r || !r.ok) return { items: [], results: [] };

      const data = await r.json().catch(()=>null);
      return normalizePayload(data);
    }

    const data = await fetchJsonNode(url);
    return normalizePayload(data);

  }catch(e){
    return { items: [], results: [] };
  }
}

function eventBaseUrl(event){
  const host = (event?.headers && (event.headers["x-forwarded-host"] || event.headers["host"])) || "";
  const proto = (event?.headers && event.headers["x-forwarded-proto"]) || "https";
  if(!host) return "";
  return `${proto}://${host}`;
}

async function snapshotProvider(event){
  for(const p of snapshotCandidates()){
    const j = tryReadJsonFile(p);
    if(j && Array.isArray(j.items)) return j;
  }
  const base = eventBaseUrl(event);
  if(base){
    const j = await fetchJson(`${base}/data/search-bank.snapshot.json`);
    if(j && Array.isArray(j.items)) return j;
  }
  return { meta:{ generated_at: nowIso(), source:"search-bank.engine" }, items:[] };
}

// optional live hook (disabled unless env set)
async function liveProvider(event, q, limit){
  if(!truthy(process.env.MARU_BANK_LIVE)) return null;
  const base = eventBaseUrl(event);
  if(!base) return null;
  const j = await fetchJson(`${base}/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}&from=search-bank&skipSearchBank=1`);
  if(!j) return null;
  if(Array.isArray(j.items)) return { meta:{ source:"maru-search" }, items:j.items };
  if(j.data && Array.isArray(j.data.items)) return { meta:{ source:"maru-search" }, items:j.data.items };
  if(j.baseResult && Array.isArray(j.baseResult.items)) return { meta:{ source:"maru-search" }, items:j.baseResult.items };
  if(j.baseResult?.data && Array.isArray(j.baseResult.data.items)) return { meta:{ source:"maru-search" }, items:j.baseResult.data.items };
  return null;
}


// ---------- query / geo / sector intelligence ----------
const REGION_DEFS = {
  northAmerica: ["US","USA","United States","Canada","Mexico"],
  latinAmerica: ["Brazil","Argentina","Chile","Peru","Colombia","Venezuela","Uruguay","Paraguay"],
  westEurope: ["Germany","France","UK","United Kingdom","Italy","Spain","Netherlands","Belgium","Switzerland","Austria","Ireland"],
  eastEurope: ["Poland","Ukraine","Romania","Russia","Czech Republic","Hungary","Bulgaria","Slovakia"],
  middleEast: ["Turkey","Saudi Arabia","Saudi","UAE","United Arab Emirates","Israel","Iran","Qatar","Kuwait","Jordan","Oman"],
  southAsia: ["India","Pakistan","Bangladesh","Sri Lanka","Nepal","Bhutan","Maldives"],
  centralAsia: ["Kazakhstan","Uzbekistan","Kyrgyzstan","Tajikistan","Turkmenistan"],
  southeastAsia: ["Thailand","Vietnam","Indonesia","Malaysia","Philippines","Singapore","Cambodia","Laos","Myanmar","Brunei","Timor-Leste"],
  northeastAsia: ["Korea","South Korea","KR","Japan","China","Taiwan","Mongolia","Hong Kong"],
  africa: ["Nigeria","Egypt","Kenya","Ethiopia","South Africa","SouthAfrica","Ghana","Tanzania","Uganda","Rwanda"],
  oceania: ["Australia","New Zealand","NewZealand","Papua New Guinea","Fiji"]
};

const COUNTRY_ALIASES = {
  "한국": { country:"KR", name:"South Korea", region:"northeastAsia", locale:"ko-KR" },
  "대한민국": { country:"KR", name:"South Korea", region:"northeastAsia", locale:"ko-KR" },
  "korea": { country:"KR", name:"South Korea", region:"northeastAsia", locale:"ko-KR" },
  "south korea": { country:"KR", name:"South Korea", region:"northeastAsia", locale:"ko-KR" },
  "일본": { country:"JP", name:"Japan", region:"northeastAsia", locale:"ja-JP" },
  "japan": { country:"JP", name:"Japan", region:"northeastAsia", locale:"ja-JP" },
  "중국": { country:"CN", name:"China", region:"northeastAsia", locale:"zh-CN" },
  "china": { country:"CN", name:"China", region:"northeastAsia", locale:"zh-CN" },
  "대만": { country:"TW", name:"Taiwan", region:"northeastAsia", locale:"zh-TW" },
  "taiwan": { country:"TW", name:"Taiwan", region:"northeastAsia", locale:"zh-TW" },
  "인도네시아": { country:"ID", name:"Indonesia", region:"southeastAsia", locale:"id-ID" },
  "indonesia": { country:"ID", name:"Indonesia", region:"southeastAsia", locale:"id-ID" },
  "베트남": { country:"VN", name:"Vietnam", region:"southeastAsia", locale:"vi-VN" },
  "vietnam": { country:"VN", name:"Vietnam", region:"southeastAsia", locale:"vi-VN" },
  "태국": { country:"TH", name:"Thailand", region:"southeastAsia", locale:"th-TH" },
  "thailand": { country:"TH", name:"Thailand", region:"southeastAsia", locale:"th-TH" },
  "프랑스": { country:"FR", name:"France", region:"westEurope", locale:"fr-FR" },
  "france": { country:"FR", name:"France", region:"westEurope", locale:"fr-FR" },
  "독일": { country:"DE", name:"Germany", region:"westEurope", locale:"de-DE" },
  "germany": { country:"DE", name:"Germany", region:"westEurope", locale:"de-DE" },
  "영국": { country:"GB", name:"United Kingdom", region:"westEurope", locale:"en-GB" },
  "uk": { country:"GB", name:"United Kingdom", region:"westEurope", locale:"en-GB" },
  "미국": { country:"US", name:"United States", region:"northAmerica", locale:"en-US" },
  "usa": { country:"US", name:"United States", region:"northAmerica", locale:"en-US" },
  "united states": { country:"US", name:"United States", region:"northAmerica", locale:"en-US" },
  "캐나다": { country:"CA", name:"Canada", region:"northAmerica", locale:"en-CA" },
  "canada": { country:"CA", name:"Canada", region:"northAmerica", locale:"en-CA" },
  "브라질": { country:"BR", name:"Brazil", region:"latinAmerica", locale:"pt-BR" },
  "brazil": { country:"BR", name:"Brazil", region:"latinAmerica", locale:"pt-BR" },
  "케냐": { country:"KE", name:"Kenya", region:"africa", locale:"en-KE" },
  "kenya": { country:"KE", name:"Kenya", region:"africa", locale:"en-KE" },
  "카자흐스탄": { country:"KZ", name:"Kazakhstan", region:"centralAsia", locale:"kk-KZ" },
  "kazakhstan": { country:"KZ", name:"Kazakhstan", region:"centralAsia", locale:"kk-KZ" },
  "우즈베키스탄": { country:"UZ", name:"Uzbekistan", region:"centralAsia", locale:"uz-UZ" },
  "uzbekistan": { country:"UZ", name:"Uzbekistan", region:"centralAsia", locale:"uz-UZ" },
  "키르기스스탄": { country:"KG", name:"Kyrgyzstan", region:"centralAsia", locale:"ky-KG" },
  "kyrgyzstan": { country:"KG", name:"Kyrgyzstan", region:"centralAsia", locale:"ky-KG" },
  "타지키스탄": { country:"TJ", name:"Tajikistan", region:"centralAsia", locale:"tg-TJ" },
  "tajikistan": { country:"TJ", name:"Tajikistan", region:"centralAsia", locale:"tg-TJ" },
  "투르크메니스탄": { country:"TM", name:"Turkmenistan", region:"centralAsia", locale:"tk-TM" },
  "turkmenistan": { country:"TM", name:"Turkmenistan", region:"centralAsia", locale:"tk-TM" },
  "중앙아시아": { country:null, name:"Central Asia", region:"centralAsia", locale:null },
  "central asia": { country:null, name:"Central Asia", region:"centralAsia", locale:null },
  "중동": { country:null, name:"Middle East", region:"middleEast", locale:null },
  "동남아": { country:null, name:"Southeast Asia", region:"southeastAsia", locale:null },
  "북미": { country:null, name:"North America", region:"northAmerica", locale:null }
};

const REGION_ALIASES = {
  "north america":"northAmerica", "북미":"northAmerica", "latin america":"latinAmerica", "남미":"latinAmerica",
  "west europe":"westEurope", "서유럽":"westEurope", "east europe":"eastEurope", "동유럽":"eastEurope",
  "middle east":"middleEast", "중동":"middleEast", "south asia":"southAsia", "남아시아":"southAsia", "central asia":"centralAsia", "중앙아시아":"centralAsia",
  "southeast asia":"southeastAsia", "동남아":"southeastAsia", "northeast asia":"northeastAsia", "동북아":"northeastAsia", "극동":"northeastAsia", "far east":"northeastAsia",
  "africa":"africa", "아프리카":"africa", "oceania":"oceania", "오세아니아":"oceania"
};

const REGION_CANONICAL_ALIASES = {
  farEastAsia: "northeastAsia",
  eastAsia: "northeastAsia",
  westAsia: "middleEast",
  southAmerica: "latinAmerica",
  northamerica: "northAmerica",
  latinamerica: "latinAmerica",
  westeurope: "westEurope",
  easteurope: "eastEurope",
  middleeast: "middleEast",
  southasia: "southAsia",
  centralasia: "centralAsia",
  southeastasia: "southeastAsia",
  northeastasia: "northeastAsia"
};

function canonicalRegionName(region){
  const r = s(region).trim();
  if(!r) return null;
  if(REGION_DEFS[r]) return r;
  const mapped = REGION_ALIASES[low(r)] || REGION_CANONICAL_ALIASES[low(r)] || REGION_CANONICAL_ALIASES[r];
  if(mapped) return mapped;
  for(const key of Object.keys(REGION_DEFS)){
    if(low(key) === low(r)) return key;
  }
  return r;
}

function isRegionOnlyAlias(hit){
  return !!(hit && hit.value && typeof hit.value === "object" && !hit.value.country && hit.value.region);
}

function externalSuppressed(ctx){
  const p = ctx?.params || {};
  return truthy(p.disableExternal || p.noExternal || p.external === "off" || p.external === "0" || p.external === "false" || p.live === "off" || p.useLive === "off");
}

function externalCollectionEnabled(ctx, adapterName){
  if(externalSuppressed(ctx)) return false;
  const p = ctx?.params || {};
  const manual = truthy(p.useExternalSources || p.external || p.useLive || p.live || p[adapterName] || p[`use_${adapterName}`]) || truthy(process.env.MARU_BANK_EXTERNAL);
  return manual || slotExternalEnabled(ctx, adapterName);
}
function maruSearchReentrySuppressed(ctx){
  const p = ctx?.params || {};
  return low(p.from) === "maru-search"
    || truthy(p.skipSearchBank)
    || truthy(p.noSearchBank)
    || truthy(p.skipMaruSearch)
    || truthy(p.noMaruSearch);
}

function compactTokens(parts){
  return parts.map(x => s(x).trim()).filter(Boolean).join(" ").replace(/\s+/g," ").trim();
}

// ---------- front page slot automation policy ----------
const FRONT_SLOT_POLICIES = {
  media: { acceptTypes:["video"], acceptEntities:["video","feed_item","article"], preferredAdapters:["media","live","collector","planetary"], queryTerms:["video","news video","media clip"], minItems:12, persist:true },
  donation: { acceptTypes:["organization","institution","article"], acceptEntities:["organization","institution","campaign","article"], preferredAdapters:["donation","regional","collector","planetary","live"], queryTerms:["NGO","charity","relief organization","official homepage"], minItems:12, persist:true, special:"donation" },
  tour: { acceptTypes:["destination","article","image","video"], acceptEntities:["destination","article","video"], preferredAdapters:["tourism","regional","live","planetary"], queryTerms:["tourism","destination","travel"], minItems:12, persist:true },
  tourism: { acceptTypes:["destination","article","image","video"], acceptEntities:["destination","article","video"], preferredAdapters:["tourism","regional","live","planetary"], queryTerms:["tourism","destination","travel"], minItems:12, persist:true },
  social: { acceptTypes:["feed_item","video","article"], acceptEntities:["feed_item","video","article"], preferredAdapters:["social","media","live"], queryTerms:["social","creator","feed"], minItems:20, persist:true },
  distribution: { acceptTypes:["product","merchant","organization","article"], acceptEntities:["product","merchant","organization"], preferredAdapters:["commerce","regional","collector","planetary","live"], queryTerms:["supplier","distribution","manufacturer","product"], minItems:20, persist:true },
  network: { acceptTypes:["organization","merchant","article"], acceptEntities:["organization","merchant","article"], preferredAdapters:["regional","collector","planetary","live"], queryTerms:["network","organization","partner"], minItems:12, persist:true },
  home: { acceptTypes:["product","article","video","organization","destination"], acceptEntities:["product","article","video","organization","destination"], preferredAdapters:["regional","commerce","media","tourism","live"], queryTerms:["featured","recommended"], minItems:20, persist:true }
};

function inferChannelFromParams(params={}){
  return low(params.channel || params.page || params.route || params.section || params.psom_key || "");
}

function resolveSlotPolicy(params={}, queryIntent={}){
  const rawChannel = inferChannelFromParams(params);
  const section = low(params.section || params.bind_section || params.psom_key || "");
  const page = low(params.page || params.channel || "");
  const route = low(params.route || "");
  const joined = [rawChannel, section, page, route].filter(Boolean).join(" ");
  let channel = rawChannel;
  if(!channel || channel === "any"){
    if(joined.includes("media")) channel = "media";
    else if(joined.includes("donation") || queryIntent?.sectorHint?.major === "donation" || queryIntent?.sectorHint?.major === "ngo") channel = "donation";
    else if(joined.includes("tour")) channel = "tour";
    else if(joined.includes("social")) channel = "social";
    else if(joined.includes("distribution") || joined.includes("commerce")) channel = "distribution";
    else if(joined.includes("network")) channel = "network";
    else if(joined.includes("home")) channel = "home";
  }
  if(channel === "tourism") channel = "tour";
  if(channel === "commerce") channel = "distribution";
  const policy = FRONT_SLOT_POLICIES[channel] || null;
  const isGlobalNews = channel === "donation" && /global.*news|news.*global|global-news|글로벌.*뉴스|뉴스/.test(joined);
  const autoFill = truthy(params.autoFill || params.autofill || params.slotFill || params.frontFill || params.pageFill || params.snapshotFill) || !!policy;
  return { channel:channel||null, page:params.page||params.channel||null, section:params.section||params.bind_section||params.psom_key||null, psom_key:params.psom_key||params.section||null, route:params.route||null, policy, isGlobalNews, autoFill, minItems:safeInt(params.minItems||params.slot_min||policy?.minItems, policy?.minItems||10, 1, 200) };
}

function slotExternalEnabled(ctx, adapterName){
  const slot = ctx?.slotContext;
  if(externalSuppressed(ctx)) return false;
  if(adapterName === "snapshot") return true;
  if(ctx?.operationalPolicy && channelBlockedForPolicy(adapterName, ctx.operationalPolicy)) return false;
  if(slot?.autoFill && slot.policy){
    return slot.policy.preferredAdapters.includes(adapterName) || ["live","regional"].includes(adapterName);
  }
  if(needsExternalForCoverage(ctx)) return ["live","regional","collector","planetary"].includes(adapterName);
  return false;
}

function buildSlotQuery(ctx, adapterName){
  const slot = ctx?.slotContext || {};
  const policy = slot.policy || {};
  const base = ctx.queryIntent?.raw || ctx.q || "";
  const geo = ctx.geoContext?.country || ctx.geoContext?.region || "";
  const sector = ctx.queryIntent?.sectorHint?.minor || ctx.queryIntent?.sectorHint?.major || ctx.params?.sector || "";
  const entity = ctx.queryIntent?.entityHint?.type || ctx.params?.entity || "";
  const term = (policy.queryTerms || [])[0] || adapterName || "";
  let q;
  if(slot.channel === "media") q = compactTokens([base, geo, sector, "video"]);
  else if(slot.channel === "donation" && !slot.isGlobalNews) q = compactTokens([base, geo, "NGO charity official homepage organization"]);
  else if(slot.channel === "donation" && slot.isGlobalNews) q = compactTokens([base, geo, "global charity news relief"]);
  else if(slot.channel === "distribution") q = compactTokens([base, geo, sector, "supplier manufacturer product distribution"]);
  else if(slot.channel === "tour") q = compactTokens([base, geo, "tourism destination travel"]);
  else if(slot.channel === "social") q = compactTokens([base, geo, "social video creator feed"]);
  else q = compactTokens([base, geo, sector, entity, term]);
  return expandQueryForLocale(ctx, q);
}
function applySlotContract(item, ctx){
  if(!item || typeof item !== "object") return item;
  const slot = ctx?.slotContext || {};
  if(!slot.autoFill) return item;
  const channel = slot.channel || item.channel;
  if(channel && !item.channel) item.channel = channel;
  if(slot.page && !item.page) item.page = slot.page;
  if(slot.section && !item.section) item.section = slot.section;
  if(slot.psom_key && !item.psom_key) item.psom_key = slot.psom_key;
  if(slot.route && !item.route) item.route = slot.route;
  const bind = item.bind && typeof item.bind === "object" ? cloneJsonish(item.bind) : {};
  if(slot.page && !bind.page) bind.page = slot.page;
  if(slot.section && !bind.section) bind.section = slot.section;
  if(slot.psom_key && !bind.psom_key) bind.psom_key = slot.psom_key;
  if(slot.route && !bind.route) bind.route = slot.route;
  if(Object.keys(bind).length) item.bind = bind;
  if(slot.channel === "media"){
    if(!item.media) item.media = { type:item.type === "video" ? "video" : "article", url:item.url || item.link?.url || undefined, thumb:item.thumbnail || item.thumb || item.image || undefined };
    if(item.type !== "video" && /youtube|youtu\.be|vimeo|video|mp4|webm/i.test([item.url,item.source,item.title,item.summary].filter(Boolean).join(" "))) item.type = "video";
    if(!item.entity) item.entity = { type:item.type === "video" ? "video" : "article", subtype:"media" };
  }
  if(slot.channel === "donation"){
    if(slot.isGlobalNews){
      if(!item.entity) item.entity = { type:"article", subtype:"global_news" };
    }else{
      if(!item.entity) item.entity = { type:"organization", subtype:item.sector?.major === "religious_org" ? "religious_org" : "ngo" };
      if(!item.org) item.org = { name:item.title || item.name || undefined, home:item.url || item.link?.url || undefined, country:item.geo?.country || undefined };
      if(!item.donation) item.donation = { enabled:true, kind:"organization_profile", target:item.org?.name || item.title || undefined };
    }
  }
  if(slot.channel === "distribution" && !item.entity) item.entity = { type:item.price || item.commerce || item.directSale ? "product" : "organization", subtype:item.sector?.minor || item.sector?.major || "supplier" };
  if((slot.channel === "tour" || slot.channel === "tourism") && !item.entity) item.entity = { type:"destination", subtype:item.sector?.major || "tourism" };
  return item;
}

function slotAcceptsItem(item, ctx){
  const slot = ctx?.slotContext;
  if(!slot?.autoFill || !slot.policy) return true;
  const policy = slot.policy;
  const type = low(item.type || item.mediaType || "");
  const entityType = low(item.entity?.type || "");
  const sector = low(item.sector?.major || "");
  const text = low([item.title,item.summary,item.description,item.url,item.source,Array.isArray(item.tags)?item.tags.join(" "):""].filter(Boolean).join(" "));
  if(slot.channel === "media") return type === "video" || entityType === "video" || /youtube|youtu\.be|vimeo|video|mp4|webm/.test(text);
  if(slot.channel === "donation" && !slot.isGlobalNews) return ["organization","institution","campaign"].includes(entityType) || ["ngo","religious_org","donation","public_institution"].includes(sector) || /ngo|charity|relief|foundation|mission|church|organization|official/.test(text);
  if(slot.channel === "donation" && slot.isGlobalNews) return type === "article" || entityType === "article" || /news|article|relief|humanitarian/.test(text);
  const allowed = new Set([...(policy.acceptTypes||[]), ...(policy.acceptEntities||[])].map(low));
  if(!allowed.size) return true;
  return allowed.has(type) || allowed.has(entityType) || allowed.has(sector);
}

function shouldPersistForSlot(item, ctx){
  const slot = ctx?.slotContext;
  if(!slot?.autoFill) return true;
  if(!slot.policy?.persist) return false;
  if(item.source_adapter === "snapshot") return false;
  return slotAcceptsItem(item, ctx);
}

// ---------- v9 region / IP / channel policy engine ----------
const DEFAULT_REGION_QUOTA = {
  northeastAsia: 0.14, southeastAsia: 0.13, southAsia: 0.10, centralAsia: 0.06, middleEast: 0.10,
  africa: 0.12, westEurope: 0.10, eastEurope: 0.08, northAmerica: 0.10,
  latinAmerica: 0.09, oceania: 0.04
};
const HIGH_RISK_TLDS = new Set(["zip","mov","click","top","xyz","gq","tk","ml"]);
function parseCsvList(v){ if(Array.isArray(v)) return v.map(s).map(x=>x.trim()).filter(Boolean); return s(v).split(/[|,\s]+/).map(x=>x.trim()).filter(Boolean); }
function countryCodeOf(v){ const x=s(v).trim(); if(!x) return ""; const a=COUNTRY_ALIASES[low(x)]; if(a?.country) return low(a.country); if(/^[A-Za-z]{2}$/.test(x)) return low(x); return low(x); }
function itemCountryCode(item){ return countryCodeOf(item?.geo?.country || item?.entity?.country || item?.org?.country || item?.country || ""); }
function effectiveCountryCode(ctx){ return countryCodeOf(ctx?.geoContext?.country || ctx?.params?.country || ctx?.params?.geo_country || ""); }
function effectiveTargetCountryCode(ctx){ return countryCodeOf(ctx?.params?.country || ctx?.params?.geo_country || ctx?.queryIntent?.countryHint || ""); }
function effectiveTargetRegion(ctx){ return canonicalRegionName(ctx?.params?.region || ctx?.params?.geo_region || ctx?.queryIntent?.regionHint || countryToRegion(effectiveTargetCountryCode(ctx)) || ""); }
function effectiveAudienceCountryCode(ctx){ return countryCodeOf(ctx?.params?.audienceCountry || ctx?.params?.viewerCountry || ctx?.params?.userCountry || ctx?.params?.ipCountry || ctx?.ipGeo?.country || ""); }
function parsePolicyJson(raw){ if(!raw) return null; if(typeof raw === "object") return raw; try{return JSON.parse(String(raw));}catch(e){return null;} }
function readPolicyJsonFileCandidates(){
  const cwd = process.cwd();
  const candidates = [
    process.env.MARU_BANK_COUNTRY_POLICY_FILE,
    path.join(cwd,"data","country-policy.json"),
    path.join(cwd,"data","search-bank.country-policy.json"),
    path.join(cwd,"netlify","functions","data","country-policy.json"),
    path.join(__dirname,"data","country-policy.json"),
    path.join(__dirname,"country-policy.json")
  ].filter(Boolean);
  for(const file of candidates){
    const j = tryReadJsonFile(file);
    if(j && typeof j === "object") return j;
  }
  return null;
}
function resolveCountryPolicyTable(params={}){
  return parsePolicyJson(params.countryPolicy || process.env.MARU_BANK_COUNTRY_POLICY || null) || readPolicyJsonFileCandidates() || {};
}
function getCountryPolicyFor(table, country){
  if(!table || !country) return null;
  const c = String(country);
  return table[c] || table[c.toUpperCase()] || table[c.toLowerCase()] || null;
}
function resolveBlockedChannels(params={}, country=""){
  const out=new Set();
  for(const c of parseCsvList(params.blockChannels || params.blockedChannels || process.env.MARU_BANK_BLOCK_CHANNELS || "")) out.add(low(c));
  const donationBlocked=parseCsvList(params.donationBlockedCountries || params.noDonationCountries || process.env.MARU_DONATION_BLOCK_COUNTRIES || "").map(countryCodeOf);
  if(country && donationBlocked.includes(countryCodeOf(country))) out.add("donation");
  const policy=resolveCountryPolicyTable(params);
  const cp=getCountryPolicyFor(policy, country);
  if(cp){ for(const c of parseCsvList(cp.blockChannels || cp.blockedChannels || "")) out.add(low(c)); if(cp.donation===false || cp.noDonation===true) out.add("donation"); }
  return Array.from(out);
}
function resolveAllowedChannels(params={}, country=""){
  const explicit=parseCsvList(params.allowChannels || params.allowedChannels || process.env.MARU_BANK_ALLOW_CHANNELS || "").map(low);
  const policy=resolveCountryPolicyTable(params);
  const cp=getCountryPolicyFor(policy, country);
  const byCountry=cp ? parseCsvList(cp.allowChannels || cp.allowedChannels || "").map(low) : [];
  return byCountry.length ? byCountry : explicit;
}
function summarizeRegionCoverage(items=[]){
  const counts={}; let total=0;
  for(const item of Array.isArray(items)?items:[]){ const r=canonicalRegionName(item?.geo?.region || item?.region || countryToRegion(item?.geo?.country || item?.country || "") || ""); if(!r) continue; counts[r]=(counts[r]||0)+1; total++; }
  return {total, counts};
}
function resolveOperationalPolicy(ctx={}, existingItems=[]){
  const params=ctx.params || {};
  const targetCountry=effectiveTargetCountryCode(ctx);
  const audienceCountry=effectiveAudienceCountryCode(ctx) || targetCountry;
  const targetRegion=effectiveTargetRegion(ctx);
  const region=canonicalRegionName(targetRegion || ctx.geoContext?.region || countryToRegion(audienceCountry) || "") || null;
  const coverage=summarizeRegionCoverage(existingItems);
  const quota={...DEFAULT_REGION_QUOTA, ...(parsePolicyJson(params.regionQuota || process.env.MARU_BANK_REGION_QUOTA || null) || {})};
  const underfilled=[];
  for(const [r,target] of Object.entries(quota)){
    const share=coverage.total ? ((coverage.counts[r]||0)/coverage.total) : 0;
    if(share < Number(target)*0.65) underfilled.push(r);
  }
  const blockedChannels=resolveBlockedChannels(params, audienceCountry);
  const allowedChannels=resolveAllowedChannels(params, audienceCountry);
  const priorityRegions=[];
  if(region) priorityRegions.push(region);
  for(const r of parseCsvList(params.priorityRegions || process.env.MARU_BANK_PRIORITY_REGIONS || "")){
    const cr=canonicalRegionName(r);
    if(cr && !priorityRegions.includes(cr)) priorityRegions.push(cr);
  }
  if(!priorityRegions.length) priorityRegions.push(...underfilled.slice(0,3));
  return {
    country: targetCountry || null,
    targetCountry: targetCountry || null,
    audienceCountry: audienceCountry || null,
    region,
    locale: ctx.geoContext?.locale || params.locale || null,
    slotChannel: low(ctx.slotContext?.channel || params.channel || params.page || "") || null,
    blockedChannels,
    allowedChannels,
    priorityRegions,
    underfilledRegions: underfilled,
    regionQuota: quota,
    coverage,
    autoExternalReason: ctx.slotContext?.autoFill ? "slot" : (underfilled.length ? "underfilled_region" : null),
    generated_at: nowIso(),
    commerce_bridge: CommerceEngine ? "active" : "not_loaded"
  };
}
function channelBlockedForPolicy(channel, policy){ const ch=low(channel||""); if(!ch || !policy) return false; if(policy.blockedChannels?.includes(ch)) return true; if(policy.allowedChannels?.length && !policy.allowedChannels.includes(ch)) return true; return false; }
function channelAliases(channel){
  const ch = low(channel || "");
  if(!ch) return [];
  if(ch === "distribution") return ["distribution", "commerce"];
  if(ch === "commerce") return ["commerce", "distribution"];
  if(ch === "tour") return ["tour", "tourism"];
  if(ch === "tourism") return ["tourism", "tour"];
  return [ch];
}
function channelMatches(itemChannel, filterChannel){
  const allowed = channelAliases(filterChannel);
  if(!allowed.length) return true;
  return allowed.includes(low(itemChannel || ""));
}
function explicitGeoFilters(params={}, queryIntent={}){
  return {
    region: low(canonicalRegionName(params.region || params.geo_region || queryIntent.regionHint || "") || ""),
    country: low(params.country || params.geo_country || queryIntent.countryHint || ""),
    state: low(params.state || params.province || params.geo_state || queryIntent.stateHint || ""),
    city: low(params.city || params.geo_city || queryIntent.cityHint || "")
  };
}
function riskDomainIssues(item){ const issues=[]; const url=item?.url || item?.link?.url || item?.link?.href || ""; const host=domainOf(url); if(host){ const parts=host.split("."); const tld=low(parts[parts.length-1]||""); if(HIGH_RISK_TLDS.has(tld)) issues.push("high_risk_tld"); if(/(^|\.)(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(host)) issues.push("local_host_url"); } return issues; }
function policyIssuesForItem(item, ctx){
  const issues=[];
  const policy=ctx?.operationalPolicy || null;
  const channel=low(item?.channel || ctx?.slotContext?.channel || ctx?.params?.channel || "");
  if(channelBlockedForPolicy(channel, policy)) issues.push(`channel_blocked:${channel}`);
  const itemCountry=itemCountryCode(item);
  const targetCountry=policy?.targetCountry || policy?.country || null;
  if(targetCountry && itemCountry && itemCountry !== targetCountry){
    const itemRegion=canonicalRegionName(item?.geo?.region || countryToRegion(itemCountry));
    if(policy.region && itemRegion && itemRegion !== policy.region) issues.push("geo_country_region_mismatch");
  }
  if(channel === "donation" && policy?.blockedChannels?.includes("donation")) issues.push("donation_blocked_for_country");
  issues.push(...riskDomainIssues(item));
  issues.push(...agingIssues(item));
  return issues;
}
function policyAcceptsItem(item, ctx){ return policyIssuesForItem(item, ctx).filter(x => !["high_risk_tld","stale_item"].includes(x)).length === 0; }
function applyOperationalPolicy(item, ctx){ if(!item || typeof item !== "object") return item; const policy=ctx?.operationalPolicy || null; if(!policy) return item; const issues=policyIssuesForItem(item, ctx); if(issues.length){ item.policy={...(item.policy||{}), issues, ok:!issues.some(x=>x.startsWith("channel_blocked") || x==="donation_blocked_for_country" || x==="geo_country_region_mismatch")}; } if(policy.region || policy.country){ item.routing={...(item.routing||{}), priority_region:policy.region||undefined, priority_country:policy.country||undefined, source_policy:"region_ip_slot_v9"}; } return item; }
function computeOperationalScore(ctx, item){ const policy=ctx?.operationalPolicy || {}; let score=0.5; const ir=canonicalRegionName(item?.geo?.region || item?.region || countryToRegion(item?.geo?.country || "") || ""); const ic=itemCountryCode(item); if(policy.country && ic && ic===policy.country) score+=0.25; if(policy.region && ir && ir===policy.region) score+=0.20; if(policy.priorityRegions?.includes(ir)) score+=0.12; if(policy.underfilledRegions?.includes(ir)) score+=0.08; if(policyIssuesForItem(item, ctx).some(x => !["stale_item","high_risk_tld"].includes(x))) score-=0.25; score = (score * 0.7) + (computeSupplyScore(ctx, item) * 0.3); return Math.max(0, Math.min(1, score)); }
function needsExternalForCoverage(ctx){ const p=ctx?.params || {}; if(externalSuppressed(ctx)) return false; if(ctx?.slotContext?.autoFill) return true; if(truthy(p.autoExternal || p.autoFillRegion || process.env.MARU_BANK_AUTO_EXTERNAL)) return true; if(ctx?.slotDeficiency?.deficient) return true; return !!(ctx?.operationalPolicy?.underfilledRegions?.length && (ctx?.geoContext?.region || ctx?.geoContext?.country)); }

// ---------- v10 source power / slot fill / locale query / aging ----------
const DEFAULT_SOURCE_TIMEOUT_MS = 6500;
const SOURCE_HEALTH = {};
const LOCALE_QUERY_TERMS = {
  KR:{cooperative:["농협","협동조합"],fisheries:["수협","수산물"],manufacturing:["제조업","공산품"],tourism:["관광","여행"],ngo:["NGO","비영리단체"],donation:["후원","NGO"],media:["영상","뉴스"]},
  JP:{cooperative:["農協","協同組合"],fisheries:["漁協","水産物"],manufacturing:["製造業","工業製品"],tourism:["観光","旅行"],ngo:["NGO","非営利団体"],donation:["寄付","NGO"],media:["動画","ニュース"]},
  CN:{cooperative:["合作社","农业合作社"],fisheries:["渔业","水产品"],manufacturing:["制造业","工业品"],tourism:["旅游","景点"],ngo:["公益组织","非政府组织"],donation:["慈善","公益"],media:["视频","新闻"]},
  ID:{cooperative:["koperasi","pertanian"],fisheries:["perikanan","hasil laut"],manufacturing:["manufaktur","barang industri"],tourism:["pariwisata","destinasi"],ngo:["LSM","organisasi nirlaba"],donation:["amal","donasi"],media:["video","berita"]},
  VN:{cooperative:["hợp tác xã","nông nghiệp"],fisheries:["thủy sản","hải sản"],manufacturing:["sản xuất","hàng công nghiệp"],tourism:["du lịch","điểm đến"],ngo:["tổ chức phi lợi nhuận","NGO"],donation:["từ thiện","quyên góp"],media:["video","tin tức"]},
  TH:{cooperative:["สหกรณ์","เกษตร"],fisheries:["ประมง","อาหารทะเล"],manufacturing:["การผลิต","สินค้าอุตสาหกรรม"],tourism:["ท่องเที่ยว","แหล่งท่องเที่ยว"],ngo:["องค์กรไม่แสวงหากำไร","NGO"],donation:["บริจาค","การกุศล"],media:["วิดีโอ","ข่าว"]},
  FR:{cooperative:["coopérative","agriculture"],fisheries:["pêche","produits de la mer"],manufacturing:["industrie","fabrication"],tourism:["tourisme","destination"],ngo:["ONG","association"],donation:["don","charité"],media:["vidéo","actualité"]},
  DE:{cooperative:["Genossenschaft","Landwirtschaft"],fisheries:["Fischerei","Meeresfrüchte"],manufacturing:["Hersteller","Industriegüter"],tourism:["Tourismus","Reiseziel"],ngo:["NGO","Hilfsorganisation"],donation:["Spende","Wohltätigkeit"],media:["Video","Nachrichten"]},
  BR:{cooperative:["cooperativa","agricultura"],fisheries:["pesca","frutos do mar"],manufacturing:["manufatura","bens industriais"],tourism:["turismo","destino"],ngo:["ONG","organização sem fins lucrativos"],donation:["doação","caridade"],media:["vídeo","notícias"]},
  KE:{cooperative:["cooperative","agriculture"],fisheries:["fisheries","seafood"],manufacturing:["manufacturing","industrial goods"],tourism:["tourism","destination"],ngo:["NGO","charity organization"],donation:["donation","charity"],media:["video","news"]},
  KZ:{cooperative:["кооператив","ауыл шаруашылығы"],fisheries:["балық шаруашылығы","теңіз өнімдері"],manufacturing:["өндіріс","өнеркәсіп тауарлары"],tourism:["туризм","саяхат"],ngo:["ҮЕҰ","коммерциялық емес ұйым"],donation:["қайырымдылық","көмек"],media:["бейне","жаңалықтар"]},
  UZ:{cooperative:["kooperativ","qishloq xoʻjaligi"],fisheries:["baliqchilik","dengiz mahsulotlari"],manufacturing:["ishlab chiqarish","sanoat tovarlari"],tourism:["turizm","sayohat"],ngo:["NNT","notijorat tashkilot"],donation:["xayriya","ehson"],media:["video","yangiliklar"]}
};
function sourceTimeoutMs(ctx, name){ return safeInt(ctx?.params?.sourceTimeoutMs || ctx?.params?.timeoutMs || process.env.MARU_BANK_SOURCE_TIMEOUT_MS, DEFAULT_SOURCE_TIMEOUT_MS, 1000, 20000); }
function withTimeout(promise, ms, label){
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(()=>clearTimeout(timer)),
    new Promise((_, reject)=>{ timer=setTimeout(()=>reject(new Error(`timeout:${label}`)), ms); })
  ]);
}
function recordSourceHealth(name, ok, count, error){
  const h = SOURCE_HEALTH[name] || {name, ok:0, fail:0, timeout:0, last_count:0, last_error:null, last_at:null};
  if(ok) h.ok += 1; else h.fail += 1;
  if(String(error||"").includes("timeout")) h.timeout += 1;
  h.last_count = count || 0;
  h.last_error = error || null;
  h.last_at = nowIso();
  SOURCE_HEALTH[name] = h;
  return cloneJsonish(h);
}
function getSourceHealth(){ return cloneJsonish(SOURCE_HEALTH); }
function desiredSlotMin(ctx){ return safeInt(ctx?.params?.minItems || ctx?.params?.slot_min || ctx?.slotContext?.minItems, ctx?.slotContext?.minItems || 10, 1, 500); }
function countSlotItems(items, ctx){ return (Array.isArray(items)?items:[]).filter(it => slotAcceptsItem(it, ctx) && policyAcceptsItem(it, ctx)).length; }
function resolveSlotDeficiency(ctx, existingItems=[]){
  const min = desiredSlotMin(ctx);
  const count = countSlotItems(existingItems, ctx);
  return { min, count, lacking: Math.max(0, min-count), deficient: count < min, channel: ctx?.slotContext?.channel || null };
}
function localQueryTermsFor(ctx){
  const country = String((ctx?.geoContext?.country || ctx?.queryIntent?.countryHint || ctx?.operationalPolicy?.targetCountry || "")).toUpperCase();
  const major = ctx?.queryIntent?.sectorHint?.major || ctx?.params?.sector || ctx?.slotContext?.channel || "";
  const minor = ctx?.queryIntent?.sectorHint?.minor || "";
  const table = LOCALE_QUERY_TERMS[country] || {};
  const key = minor && /fishery/.test(minor) ? "fisheries" : (major === "tour" ? "tourism" : major);
  return table[key] || table[major] || [];
}
function expandQueryForLocale(ctx, base){
  const terms = localQueryTermsFor(ctx);
  const extra = parseCsvList(ctx?.params?.localTerms || ctx?.params?.localeTerms || "");
  return compactTokens([base, ...terms.slice(0,3), ...extra.slice(0,3)]);
}
function itemAgeDays(item){ const t=Date.parse(item?.published_at || item?.ingested_at || item?.createdAt || item?.updatedAt || ""); return Number.isNaN(t) ? null : Math.max(0,(Date.now()-t)/(1000*60*60*24)); }
function agingIssues(item){
  const issues=[];
  const age=itemAgeDays(item);
  if(age != null && age > safeInt(process.env.MARU_BANK_STALE_DAYS, 730, 30, 3650)) issues.push("stale_item");
  const verify = low(item?.verify?.status || item?.link_status || item?.status || "");
  if(["dead","broken","404","gone","invalid"].includes(verify)) issues.push("dead_link_flag");
  return issues;
}
function computeSupplyScore(ctx, item){
  let score=0.5;
  const ent=low(item?.entity?.type || item?.type || "");
  const ch=low(ctx?.slotContext?.channel || item?.channel || "");
  if(ch==="distribution" && ["product","merchant","organization"].includes(ent)) score+=0.25;
  if(ch==="media" && (ent==="video" || item?.type==="video" || item?.media)) score+=0.25;
  if(ch==="donation" && (item?.org || item?.donation || ["organization","institution","campaign"].includes(ent))) score+=0.25;
  if(item?.producer?.name || item?.producer?.id) score+=0.1;
  if(item?.market?.exportable) score+=0.1;
  if(agingIssues(item).includes("dead_link_flag")) score-=0.5;
  if(agingIssues(item).includes("stale_item")) score-=0.15;
  return Math.max(0, Math.min(1, score));
}

const SECTOR_KEYWORDS = [
  { terms:["농협","농산물","농업협동조합","nh coop","agricultural cooperative"], major:"cooperative", minor:"nh_coop", product_type:"agriculture", labels:["농협","농산물","co-op"] },
  { terms:["수협","수산물","수산업협동조합","fishery coop","fisheries cooperative"], major:"cooperative", minor:"fishery_coop", product_type:"fisheries", labels:["수협","수산물","co-op"] },
  { terms:["축산","축협","livestock"], major:"livestock", minor:"producer_union", product_type:"livestock", labels:["축산","livestock"] },
  { terms:["협동조합","cooperative","coop","co-op"], major:"cooperative", minor:"local_union", product_type:null, labels:["cooperative"] },
  { terms:["공산품","제조","제조업","industrial goods","manufacturing","factory"], major:"manufacturing", minor:"industrial_goods", product_type:"industrial_goods", labels:["공산품","manufacturing"] },
  { terms:["소비재","consumer goods"], major:"consumer_goods", minor:null, product_type:"consumer_goods", labels:["consumer_goods"] },
  { terms:["식품","food","groceries"], major:"food", minor:null, product_type:"food", labels:["food"] },
  { terms:["관광","여행","tourism","travel","destination"], major:"tourism", minor:null, product_type:"destination", labels:["관광","tourism"] },
  { terms:["교육","학교","대학","education","university","school"], major:"education", minor:null, product_type:"institution", labels:["education"] },
  { terms:["언론","미디어","뉴스","media","news"], major:"media", minor:null, product_type:"article", labels:["media"] },
  { terms:["소셜","social","sns","youtube","tiktok","facebook","instagram"], major:"social", minor:null, product_type:"feed_item", labels:["social"] },
  { terms:["기부","후원","donation","charity"], major:"donation", minor:null, product_type:"campaign", labels:["donation"] },
  { terms:["유통","물류","distribution","retail","commerce"], major:"distribution", minor:null, product_type:"commerce", labels:["distribution"] },
  { terms:["네트워크","network"], major:"network", minor:null, product_type:"network", labels:["network"] },
  { terms:["공공기관","정부","기관","public institution","government"], major:"public_institution", minor:null, product_type:"institution", labels:["public_institution"] },
  { terms:["ngo","비정부기구","구호단체","relief organization"], major:"ngo", minor:null, product_type:"organization", labels:["ngo"] },
  { terms:["선교단체","mission","religious org","church"], major:"religious_org", minor:"mission", product_type:"organization", labels:["mission","religious_org"] },
  { terms:["병원","의료","health","hospital"], major:"health", minor:"service", product_type:"service", labels:["health"] }
];

const ENTITY_KEYWORDS = [
  { terms:["상품","제품","product","goods"], type:"product", subtype:null },
  { terms:["기관","단체","조직","organization","org"], type:"organization", subtype:null },
  { terms:["공공기관","government","institution"], type:"institution", subtype:"public_institution" },
  { terms:["기사","뉴스","article","post"], type:"article", subtype:null },
  { terms:["영상","비디오","video","youtube"], type:"video", subtype:null },
  { terms:["상점","판매자","merchant","seller"], type:"merchant", subtype:null },
  { terms:["관광지","destination","tour"], type:"destination", subtype:null },
  { terms:["캠페인","campaign","donation"], type:"campaign", subtype:null },
  { terms:["피드","feed","social"], type:"feed_item", subtype:null }
];

function firstMatchDict(text, dict){
  const t = low(text);
  for(const key of Object.keys(dict)){
    if(t.includes(low(key))) return { key, value: dict[key] };
  }
  return null;
}

function detectLanguageHint(q, explicit){
  if(explicit) return low(explicit);
  const text = s(q);
  if(/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) return "ko";
  if(/[ぁ-ゟ゠-ヿ]/.test(text)) return "ja";
  if(/[一-龥]/.test(text)) return "zh";
  if(/[А-Яа-яЁё]/.test(text)) return "ru";
  return null;
}

function parseQueryIntent(q, params={}){
  const raw = s(q || params.q || params.query || "").trim();
  const aliasHit = firstMatchDict(raw, COUNTRY_ALIASES);
  const countryHit = aliasHit && aliasHit.value && aliasHit.value.country ? aliasHit : null;
  const explicitRegionHit = firstMatchDict(raw, REGION_ALIASES);
  const regionHit = explicitRegionHit || (isRegionOnlyAlias(aliasHit) ? { key: aliasHit.key, value: aliasHit.value.region } : null);

  let sectorHint = null;
  for(const def of SECTOR_KEYWORDS){
    if(def.terms.some(term => low(raw).includes(low(term)))){
      sectorHint = {
        major:def.major,
        minor:def.minor || null,
        product_type:def.product_type || null,
        labels:def.labels || [],
        confidence:0.92
      };
      break;
    }
  }

  let entityHint = null;
  for(const def of ENTITY_KEYWORDS){
    if(def.terms.some(term => low(raw).includes(low(term)))){
      entityHint = { type:def.type, subtype:def.subtype || null, confidence:0.86 };
      break;
    }
  }

  return {
    raw,
    regionHint: canonicalRegionName(params.region || params.geo_region || countryHit?.value?.region || regionHit?.value || null),
    countryHint: params.country || params.geo_country || countryHit?.value?.country || null,
    countryName: countryHit?.value?.name || null,
    cityHint: params.city || params.geo_city || null,
    stateHint: params.state || params.province || params.geo_state || null,
    sectorHint,
    entityHint,
    channelHint: params.channel || params.route || null,
    languageHint: detectLanguageHint(raw, params.lang || params.language),
    confidence: (countryHit || regionHit || sectorHint || entityHint) ? 0.82 : 0.35
  };
}

function countryToRegion(country){
  const c = s(country).trim();
  if(!c) return null;
  const alias = COUNTRY_ALIASES[low(c)];
  if(alias?.region) return canonicalRegionName(alias.region);
  for(const [region, countries] of Object.entries(REGION_DEFS)){
    if(countries.some(x => low(x) === low(c))) return canonicalRegionName(region);
  }
  return null;
}

function resolveGeoContext(params={}, queryIntent={}, ipGeo={}){
  const explicitCountry = params.country || params.geo_country || null;
  const explicitRegion = params.region || params.geo_region || null;
  const queryCountry = queryIntent.countryHint || null;
  const queryRegion = canonicalRegionName(queryIntent.regionHint || null);

  // If the user explicitly names only a region (e.g. 동남아/중동), do not inject IP country.
  // IP is a weak fallback only when neither explicit nor query-level geo exists.
  const allowIpCountry = !(explicitRegion || queryRegion) && !(explicitCountry || queryCountry);
  const country = explicitCountry || queryCountry || (allowIpCountry ? ipGeo.country : null) || null;
  const region = canonicalRegionName(explicitRegion || queryRegion || countryToRegion(country) || ipGeo.region || null);
  const state = params.state || params.province || params.geo_state || queryIntent.stateHint || (allowIpCountry ? ipGeo.state : null) || null;
  const city = params.city || params.geo_city || queryIntent.cityHint || (allowIpCountry ? ipGeo.city : null) || null;
  const locale = params.locale || COUNTRY_ALIASES[low(country)]?.locale || null;

  let confidence = 0;
  if(explicitCountry || explicitRegion || state || city) confidence += 0.45;
  if(queryCountry || queryRegion) confidence += 0.35;
  if(allowIpCountry && (ipGeo.country || ipGeo.region)) confidence += 0.15;
  if(queryIntent.languageHint && !confidence) confidence += 0.1;

  return {
    region: region || null,
    country: country || null,
    state: state || null,
    city: city || null,
    market: params.market || null,
    locale,
    confidence: Math.min(1, confidence || 0.2)
  };
}

function resolveSectorContext(item={}, queryIntent={}){
  const src = item || {};
  const direct = src.sector && typeof src.sector === "object" ? src.sector : null;
  if(direct && (direct.major || direct.minor || direct.product_type)){
    return {
      major: direct.major || null,
      minor: direct.minor || null,
      product_type: direct.product_type || null,
      labels: Array.isArray(direct.labels) ? direct.labels : [],
      confidence: typeof direct.confidence === "number" ? direct.confidence : 0.95
    };
  }
  if(queryIntent?.sectorHint) return cloneJsonish(queryIntent.sectorHint);

  const text = low([src.title, src.name, src.summary, src.description, src.category, src.semantic_category, src.section, Array.isArray(src.tags) ? src.tags.join(" ") : ""].filter(Boolean).join(" "));
  for(const def of SECTOR_KEYWORDS){
    if(def.terms.some(term => text.includes(low(term)))){
      return { major:def.major, minor:def.minor || null, product_type:def.product_type || null, labels:def.labels || [], confidence:0.78 };
    }
  }
  return { major:null, minor:null, product_type:null, labels:[], confidence:0 };
}

function resolveEntityContext(item={}, queryIntent={}){
  const src = item || {};
  const direct = src.entity && typeof src.entity === "object" ? src.entity : null;
  if(direct && (direct.type || direct.subtype || direct.name)){
    return {
      type: direct.type || null,
      subtype: direct.subtype || null,
      name: direct.name || src.title || src.name || null,
      country: direct.country || src.geo?.country || null,
      confidence: typeof direct.confidence === "number" ? direct.confidence : 0.95
    };
  }
  if(queryIntent?.entityHint){
    return {
      ...cloneJsonish(queryIntent.entityHint),
      name: src.title || src.name || null,
      country: src.geo?.country || null
    };
  }
  const type = src.type === "org-slot" ? "organization" : (src.type || null);
  return {
    type: type || null,
    subtype: src.category || src.semantic_category || null,
    name: src.title || src.name || null,
    country: src.geo?.country || null,
    confidence: type ? 0.55 : 0
  };
}

function mergeGeo(base, extra){
  const b = base && typeof base === "object" ? cloneJsonish(base) : {};
  const e = extra && typeof extra === "object" ? extra : {};
  const out = { ...b };
  for(const k of ["region","country","state","city","market","locale"]){
    if((out[k] == null || out[k] === "") && e[k]) out[k] = e[k];
  }
  if(typeof e.confidence === "number" && typeof out.confidence !== "number") out.confidence = e.confidence;
  return Object.keys(out).length ? out : null;
}

function buildMarket(src, geo){
  const m = src.market && typeof src.market === "object" ? cloneJsonish(src.market) : {};
  if(!m.target_region && geo?.region) m.target_region = geo.region;
  if(!m.source_region && (geo?.country || geo?.region)) m.source_region = geo.country || geo.region;
  if(typeof m.exportable !== "boolean") m.exportable = !!(src.commerce || src.directSale || src.price || src.currency);
  return Object.keys(m).length ? m : undefined;
}

function ipGeoFromEvent(event){
  const h = event?.headers || {};
  const country = h["x-country"] || h["cf-ipcountry"] || h["x-vercel-ip-country"] || null;
  const region = country ? countryToRegion(country) : null;
  return {
    country: country || null,
    region,
    state: h["x-region"] || h["x-vercel-ip-country-region"] || null,
    city: h["x-city"] || h["x-vercel-ip-city"] || null
  };
}

function pickGeo(raw){
  const g = raw.geo || (raw.extension && raw.extension.geo) || null;
  if(!g || typeof g !== "object") return null;
  const region = s(g.region||"").trim();
  const country = s(g.country||"").trim();
  const state = s(g.state||g.province||"").trim();
  const city = s(g.city||"").trim();
  const market = s(g.market||"").trim();
  const locale = s(g.locale||"").trim();
  if(!region && !country && !state && !city && !market && !locale) return null;
  return {
    region: canonicalRegionName(region || countryToRegion(country)) || undefined,
    country: country||undefined,
    state: state||undefined,
    city: city||undefined,
    market: market||undefined,
    locale: locale||undefined,
    confidence: typeof g.confidence === "number" ? g.confidence : undefined
  };
}

function pickProducer(raw){
  const p = raw.producer || (raw.extension && raw.extension.producer) || null;
  if(!p || typeof p !== "object") return null;
  const id = s(p.id||"").trim();
  const name = s(p.name||"").trim();
  const home = s(p.home||p.url||"").trim();
  const contact = (p.contact && typeof p.contact==="object") ? p.contact : undefined;
  if(!id && !name && !home) return null;
  return { id: id||undefined, name: name||undefined, home: home||undefined, contact };
}

function cloneJsonish(v){
  if(v == null) return v;
  try{ return JSON.parse(JSON.stringify(v)); }catch(e){ return v; }
}

function pickLinkUrl(raw){
  return s(
    raw.url ||
    raw.link?.url ||
    raw.link?.href ||
    raw.link ||
    raw.href ||
    ""
  ).trim();
}

function normalizeBind(raw, fallback){
  const bind = (raw.bind && typeof raw.bind === "object") ? cloneJsonish(raw.bind) : {};
  const page = s(bind.page || raw.page || raw.channel || fallback.channel || "").trim();
  const section = s(bind.section || raw.section || fallback.section || "").trim();
  const psom_key = s(bind.psom_key || raw.psom_key || fallback.psom_key || section || "").trim();
  const route = s(bind.route || fallback.route || "").trim();
  const original_section = bind.original_section ?? raw.original_section ?? null;

  if(!page && !section && !psom_key && !route && original_section == null) return undefined;

  return {
    ...bind,
    page: page || undefined,
    section: section || undefined,
    psom_key: psom_key || undefined,
    route: route || undefined,
    original_section
  };
}

function normalizeItem(raw, ctx={}){
  if(!raw || typeof raw !== "object") return null;

  const src = cloneJsonish(raw) || {};
  const sourceAdapter = src.__adapter || null;
  delete src.__adapter;
  const queryIntent = ctx.queryIntent || parseQueryIntent(ctx.q || "", ctx.params || {});
  const geoContext = ctx.geoContext || resolveGeoContext(ctx.params || {}, queryIntent, ctx.ipGeo || {});

  const url = pickLinkUrl(src);
  const id  = s(src.id || "") || (url ? stableHash(url) : stableHash(src.title || src.name || JSON.stringify(src).slice(0,200)));
  const title = s(src.title || src.name || "").trim();
  const summary = s(src.summary || src.description || src.about || src.snippet || "").trim();
  const section = s(src.section || src.bind?.section || src.psom_key || "").trim();
  const psom_key = s(src.psom_key || src.bind?.psom_key || section || "").trim();
  const category = s(src.category || src.type_category || "").trim();
  const semantic_category = s(src.semantic_category || src.taxonomy?.category || category || "").trim();
  const channel = low(src.channel || src.page || src.bind?.page || queryIntent.channelHint || "");
  const lang = low(src.lang || src.language || src.i18n?.lang || queryIntent.languageHint || "");
  const source = (typeof src.source === "string") ? src.source : s(src.source?.name || src.provider || domainOf(url) || "").trim();

  const thumbnail = s(src.thumbnail || src.thumb || src.image || src.media?.thumb || src.payload?.thumb || src.payload?.thumbnail || "").trim();
  const thumb = s(src.thumb || src.thumbnail || src.image || src.media?.thumb || src.payload?.thumb || "").trim();
  const image = s(src.image || src.thumbnail || src.thumb || src.media?.src || src.media?.thumb || src.payload?.image || src.payload?.thumb || "").trim();
  const media = (src.media && typeof src.media === "object") ? cloneJsonish(src.media) : null;
  const imageSet = Array.isArray(src.imageSet) ? src.imageSet.filter(Boolean) : null;

  let type = low(src.type || src.mediaType || "");
  if(!type){
    const mk = low(media?.kind || media?.type || src.payload?.mediaType || "");
    if(mk === "video") type = "video";
    else if(mk === "audio") type = "audio";
    else if(imageSet && imageSet.length) type = "image";
    else if(thumbnail && !/favicon|\.ico$/i.test(thumbnail)) type = "image";
    else type = "article";
  }

  const tags = Array.isArray(src.tags) ? src.tags.slice(0,50).map(String) : [];
  const geo = mergeGeo(pickGeo(src), geoContext);
  const producer = pickProducer(src);
  const sector = resolveSectorContext({ ...src, geo }, queryIntent);
  const entity = resolveEntityContext({ ...src, geo, sector }, queryIntent);
  const market = buildMarket(src, geo);

  const quality = (src.quality && typeof src.quality === "object") ? cloneJsonish(src.quality) : undefined;
  const dispute_profile = (src.dispute_profile && typeof src.dispute_profile==="object")
    ? cloneJsonish(src.dispute_profile)
    : (src.extension && src.extension.dispute_profile)
      ? cloneJsonish(src.extension.dispute_profile)
      : undefined;

  const bind = normalizeBind(src, {
    channel,
    section,
    psom_key,
    route: src.route || (channel && psom_key ? `${channel}.${psom_key}` : "")
  });

  const normalized = {
    ...src,
    id,
    uid: s(src.uid || id),
    type,
    channel: channel || undefined,
    section: section || undefined,
    page: s(src.page || bind?.page || channel || "").trim() || undefined,
    psom_key: psom_key || undefined,
    category: category || undefined,
    semantic_category: semantic_category || undefined,
    type_category: s(src.type_category || category || "").trim() || undefined,
    lang: lang || undefined,
    language: s(src.language || src.lang || lang || "").trim() || undefined,
    title,
    name: s(src.name || title || "").trim() || undefined,
    summary,
    description: s(src.description || src.summary || summary || "").trim() || undefined,
    url: url || undefined,
    link: (src.link && typeof src.link === "object")
      ? cloneJsonish(src.link)
      : (url ? { mode: src.link_mode || "link", url, target: src.target || "_blank" } : undefined),
    route: s(src.route || bind?.route || "").trim() || undefined,
    source: source || undefined,
    provider: s(src.provider || source || "").trim() || undefined,
    thumbnail: thumbnail || undefined,
    thumb: thumb || undefined,
    image: image || undefined,
    imageSet: (imageSet && imageSet.length) ? imageSet.slice(0,20) : undefined,
    media: media || undefined,
    tags: tags.length ? tags : undefined,
    priority: Number.isFinite(Number(src.priority)) ? Number(src.priority) : undefined,
    score: Number.isFinite(Number(src.score)) ? Number(src.score) : undefined,
    price: src.price ?? undefined,
    currency: src.currency ?? undefined,
    cta: src.cta ?? undefined,
    bind,
    bank_ref: src.bank_ref ? cloneJsonish(src.bank_ref) : undefined,
    rank: src.rank ? cloneJsonish(src.rank) : undefined,
    verify: src.verify ? cloneJsonish(src.verify) : undefined,
    track: src.track ? cloneJsonish(src.track) : undefined,
    engagement: src.engagement ? cloneJsonish(src.engagement) : undefined,
    analytics: src.analytics ? cloneJsonish(src.analytics) : undefined,
    org: src.org ? cloneJsonish(src.org) : undefined,
    donation: src.donation ? cloneJsonish(src.donation) : undefined,
    collector: src.collector ? cloneJsonish(src.collector) : undefined,
    replace_policy: src.replace_policy ? cloneJsonish(src.replace_policy) : undefined,
    provenance: src.provenance ? cloneJsonish(src.provenance) : undefined,
    evidence: src.evidence ? cloneJsonish(src.evidence) : undefined,
    compliance: src.compliance ? cloneJsonish(src.compliance) : undefined,
    i18n: src.i18n ? cloneJsonish(src.i18n) : undefined,
    extension: src.extension ? cloneJsonish(src.extension) : undefined,
    travel: src.travel ? cloneJsonish(src.travel) : undefined,
    location: src.location ?? undefined,
    region: src.region ?? geo?.region ?? undefined,
    views: src.views ?? undefined,
    likes: src.likes ?? undefined,
    recommend: src.recommend ?? src.recommends ?? undefined,
    watchTime: src.watchTime ?? undefined,
    createdAt: src.createdAt || src.timestamp || undefined,
    published_at: src.published_at || src.publishedAt || src.date || undefined,
    ingested_at: src.ingested_at || src.ingestedAt || undefined,
    geo: geo || undefined,
    sector: (sector && (sector.major || sector.minor || sector.product_type)) ? sector : undefined,
    entity: (entity && (entity.type || entity.subtype || entity.name)) ? entity : undefined,
    market,
    producer: producer || undefined,
    quality,
    dispute_profile,
    source_adapter: sourceAdapter || src.source_adapter || undefined
  };

  applySlotContract(normalized, ctx);
  preserveBankContract(normalized, src);
  return normalized;
}


const CONTRACT_FIELDS = [
  "channel","section","page","psom_key","category","semantic_category","bind","bank_ref","rank","verify","link","org","donation","media","thumbnail","thumb","image","tags","route"
];

function preserveBankContract(item, original){
  if(!item || !original) return item;
  for(const key of CONTRACT_FIELDS){
    if(item[key] === undefined && original[key] !== undefined) item[key] = cloneJsonish(original[key]);
  }
  if(item.bind && item.section && !item.bind.section) item.bind.section = item.section;
  if(item.bind && item.psom_key && !item.bind.psom_key) item.bind.psom_key = item.psom_key;
  if(item.bind && item.page && !item.bind.page) item.bind.page = item.page;
  if(item.channel === undefined && item.bind?.page) item.channel = item.bind.page;
  return item;
}

function validateBankItem(item){
  const issues = [];
  if(!item || typeof item !== "object") issues.push("not_object");
  if(item && !item.id) issues.push("missing_id");
  if(item && !item.title) issues.push("missing_title");
  if(item && !item.url && !item.link?.url && !item.link?.href && item.link !== "#") issues.push("missing_url");

  const url = item ? (item.url || item.link?.url || item.link?.href || (typeof item.link === "string" ? item.link : "")) : "";
  if(url && !["#","/"].includes(url)){
    try{ new URL(url); }catch(e){ issues.push("invalid_url"); }
  }

  if(item?.bind){
    if(item.section && item.bind.section && item.section !== item.bind.section) issues.push("section_bind_mismatch");
    if(item.psom_key && item.bind.psom_key && item.psom_key !== item.bind.psom_key) issues.push("psom_bind_mismatch");
  }
  if(item?.channel === "donation" && !item.donation) issues.push("missing_donation_payload");
  if(item?.channel === "media" && !item.media) issues.push("missing_media_payload");

  return { ok: issues.length === 0, issues };
}

function isPersistableNewItem(item){
  const v = validateBankItem(item);
  if(v.ok) return true;
  const nonFatal = new Set(["missing_url", "invalid_url", "missing_media_payload"]);
  return v.issues.every(x => nonFatal.has(x));
}

function computeTextScore(ctx, item){
  const q = low(ctx.queryIntent?.raw || ctx.q || "");
  if(!q) return 0.5;
  const text = low([item.title, item.summary, item.description, item.url, Array.isArray(item.tags) ? item.tags.join(" ") : ""].filter(Boolean).join(" "));
  if(!text) return 0;
  if(text.includes(q)) return 1;
  const toks = q.split(/\s+/).filter(Boolean);
  if(!toks.length) return 0.5;
  const hits = toks.filter(t => text.includes(t)).length;
  return hits / toks.length;
}

function computeGeoScore(ctx, item){
  const g = ctx.geoContext || {};
  const ig = item.geo || {};
  let score = 0.4;
  if(g.region && ig.region && low(g.region) === low(ig.region)) score += 0.25;
  if(g.country && ig.country && low(g.country) === low(ig.country)) score += 0.3;
  if(g.state && ig.state && low(g.state) === low(ig.state)) score += 0.15;
  if(g.city && ig.city && low(g.city) === low(ig.city)) score += 0.15;
  if(!g.region && !g.country && !g.city) score = 0.5;
  return Math.max(0, Math.min(1, score));
}

function computeSectorScore(ctx, item){
  const wanted = ctx.queryIntent?.sectorHint || null;
  const sector = item.sector || {};
  if(!wanted) return sector.major ? 0.6 : 0.5;
  let score = 0;
  if(wanted.major && sector.major && wanted.major === sector.major) score += 0.55;
  if(wanted.minor && sector.minor && wanted.minor === sector.minor) score += 0.3;
  if(wanted.product_type && sector.product_type && wanted.product_type === sector.product_type) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeTrustScore(item){
  let score = 0.5;
  const src = typeof item.source === "string" ? item.source : (item.source?.name || item.provider || "");
  const url = item.url || item.link?.url || "";
  const text = low(src + " " + url);
  if(/\.(gov|go|edu|ac)\b/.test(text) || /government|official|ministry|university/.test(text)) score += 0.25;
  if(/wikipedia|reuters|apnews|bbc|nytimes|wsj|ft/.test(text)) score += 0.15;
  if(item.verify?.status === "verified" || item.org?.verified === true) score += 0.2;
  if(item.quality?.trust != null) score = Math.max(score, Math.min(1, Number(item.quality.trust)));
  return Math.max(0, Math.min(1, score));
}

function computeFreshnessScore(item){
  const dt = item.published_at || item.ingested_at || item.createdAt;
  const t = dt ? Date.parse(dt) : NaN;
  if(Number.isNaN(t)) return 0.4;
  const ageDays = Math.max(0, (Date.now()-t)/(1000*60*60*24));
  return Math.max(0, Math.min(1, 1 - ageDays/3650));
}

function computeRichnessScore(item){
  let score = 0;
  if(item.title) score += 0.15;
  if(item.summary || item.description) score += 0.15;
  if(item.thumbnail || item.thumb || item.image) score += 0.15;
  if(item.media) score += 0.15;
  if(item.geo) score += 0.1;
  if(item.sector) score += 0.1;
  if(item.entity) score += 0.1;
  if(item.org || item.donation || item.producer) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeCompositeScore(ctx, item){
  const score =
    computeTextScore(ctx, item) * 0.35 +
    computeGeoScore(ctx, item) * 0.20 +
    computeSectorScore(ctx, item) * 0.20 +
    computeTrustScore(item) * 0.10 +
    computeFreshnessScore(item) * 0.10 +
    computeRichnessScore(item) * 0.05;
  return Math.max(0, Math.min(1, score));
}

class BaseSourceAdapter {
  constructor(name){ this.name = name; }
  async collect(){ return []; }
}

class SnapshotAdapter extends BaseSourceAdapter {
  constructor(){ super("snapshot"); }
  async collect(ctx){
    const bank = await snapshotProvider(ctx.event);
    return Array.isArray(bank?.items) ? bank.items : [];
  }
}

class LiveSearchAdapter extends BaseSourceAdapter {
  constructor(){ super("live"); }
  async collect(ctx){
    if(externalSuppressed(ctx)) return [];
    if(maruSearchReentrySuppressed(ctx)) return [];
    if(!(truthy(process.env.MARU_BANK_LIVE) || externalCollectionEnabled(ctx, "live"))) return [];

    if(MaruSearch && typeof MaruSearch.runEngine === "function"){
      const res = await MaruSearch.runEngine(ctx.event, {
        q: ctx.queryIntent.raw || ctx.q || "",
        query: ctx.queryIntent.raw || ctx.q || "",
        limit: Math.min(ctx.limit || 100, 300),
        lang: ctx.params.lang || ctx.queryIntent?.languageHint || undefined,
        mode: ctx.params.mode || "search",
        from: "search-bank",
        skipSearchBank: true
      });
      if(Array.isArray(res?.items)) return res.items;
      if(Array.isArray(res?.results)) return res.results;
    }

    const live = await liveProvider(ctx.event, ctx.queryIntent.raw || "", ctx.limit || 100);
    return Array.isArray(live?.items) ? live.items : [];
  }
}

class MaruSearchSourceAdapter extends BaseSourceAdapter {
  constructor(name="maru-search", options={}){
    super(name);
    this.options = options || {};
  }
  buildQuery(ctx){
    if(ctx.slotContext?.autoFill) return buildSlotQuery(ctx, this.name);
    return expandQueryForLocale(ctx, compactTokens([
      ctx.queryIntent?.raw,
      this.options.regionAware ? (ctx.geoContext?.country || ctx.geoContext?.region) : "",
      this.options.sectorAware ? (ctx.queryIntent?.sectorHint?.minor || ctx.queryIntent?.sectorHint?.major || ctx.params?.sector || "") : "",
      this.options.entityAware ? (ctx.queryIntent?.entityHint?.type || ctx.params?.entity || "") : ""
    ]));
  }
  async collect(ctx){
    if(maruSearchReentrySuppressed(ctx)) return [];
    if(!MaruSearch || typeof MaruSearch.runEngine !== "function") return [];
    if(!externalCollectionEnabled(ctx, this.name)) return [];
    const q = this.buildQuery(ctx) || ctx.queryIntent?.raw || ctx.q || "";
    if(!q) return [];
    const res = await MaruSearch.runEngine(ctx.event, {
      q,
      query: q,
      limit: Math.min(ctx.limit || 50, 200),
      lang: ctx.params.lang || ctx.queryIntent?.languageHint || undefined,
      mode: ctx.params.mode || "search",
      from: "search-bank",
      skipSearchBank: true
    });
    if(Array.isArray(res?.items)) return res.items;
    if(Array.isArray(res?.results)) return res.results;
    if(Array.isArray(res?.data?.items)) return res.data.items;
    return [];
  }
}

class SectorExternalAdapter extends MaruSearchSourceAdapter {
  constructor(name, sectorTerms, options={}){
    super(name, { regionAware:true, sectorAware:true, entityAware:true, ...(options || {}) });
    this.sectorTerms = Array.isArray(sectorTerms) ? sectorTerms : [];
  }
  buildQuery(ctx){
    if(ctx.slotContext?.autoFill) return buildSlotQuery(ctx, this.name);
    const q = ctx.queryIntent?.raw || ctx.q || "";
    const geo = ctx.geoContext?.country || ctx.geoContext?.region || "";
    const sector = this.sectorTerms[0] || ctx.queryIntent?.sectorHint?.major || "";
    return expandQueryForLocale(ctx, compactTokens([q, geo, sector]));
  }
}

class PlanetarySourceAdapter extends BaseSourceAdapter {
  constructor(){ super("planetary"); }
  async collect(ctx){
    if(!PlanetaryConnector || typeof PlanetaryConnector.connect !== "function") return [];
    if(!externalCollectionEnabled(ctx, "planetary")) return [];
    const res = await PlanetaryConnector.connect(ctx.event, {
      q: ctx.queryIntent.raw,
      query: ctx.queryIntent.raw,
      limit: Math.min(ctx.limit || 50, 200),
      region: ctx.geoContext.region,
      country: ctx.geoContext.country,
      route: ctx.params.channel || ctx.params.route || undefined,
      sector: ctx.queryIntent?.sectorHint?.major || ctx.params.sector || undefined,
      type: ctx.params.type || ctx.queryIntent?.entityHint?.type || undefined,
      usePlanetary: true,
      federation: ctx.params.federation,
      from: "search-bank",
      useMaruSearchFallback: false,
      skipMaruSearch: true
    });
    if(Array.isArray(res?.items)) return res.items;
    if(Array.isArray(res?.results)) return res.results.flatMap(r => Array.isArray(r?.items) ? r.items : []);
    return [];
  }
}

class CollectorSourceAdapter extends BaseSourceAdapter {
  constructor(){ super("collector"); }
  async collect(ctx){
    if(!CentralCollector || typeof CentralCollector.runEngine !== "function") return [];
    if(!externalCollectionEnabled(ctx, "collector")) return [];
    const res = await CentralCollector.runEngine(ctx.event, {
      q: ctx.queryIntent.raw,
      query: ctx.queryIntent.raw,
      limit: Math.min(ctx.limit || 50, 200),
      region: ctx.geoContext.region,
      country: ctx.geoContext.country,
      sector: ctx.queryIntent?.sectorHint?.major || ctx.params.sector || undefined,
      engine: ctx.params.engine || "search",
      from: "search-bank",
      skipMaruSearch: true
    });
    if(Array.isArray(res?.items)) return res.items;
    if(Array.isArray(res?.results)) return res.results;
    if(Array.isArray(res?.data?.items)) return res.data.items;
    return [];
  }
}

function selectAdapters(ctx){
  const names = new Set(["snapshot"]);
  if(!externalSuppressed(ctx) && (truthy(process.env.MARU_BANK_LIVE) || externalCollectionEnabled(ctx, "live"))) names.add("live");
  if(externalCollectionEnabled(ctx, "planetary")) names.add("planetary");
  if(externalCollectionEnabled(ctx, "collector")) names.add("collector");

  const major = ctx.queryIntent?.sectorHint?.major || ctx.params.sector || ctx.params.sector_major || "";
  const channel = low(ctx.params.channel || ctx.params.route || ctx.queryIntent?.channelHint || "");
  if(ctx.slotContext?.autoFill && ctx.slotContext?.policy){
    for(const n of ctx.slotContext.policy.preferredAdapters || []) {
      if(externalCollectionEnabled(ctx, n)) names.add(n);
    }
  }
  if((ctx.geoContext?.region || ctx.geoContext?.country) && externalCollectionEnabled(ctx, "regional")) names.add("regional");
  if(major === "cooperative" && externalCollectionEnabled(ctx, "cooperative")) names.add("cooperative");
  if(["agriculture","fisheries","livestock","manufacturing","industrial_goods","consumer_goods","food","distribution"].includes(major) && externalCollectionEnabled(ctx, "commerce")) names.add("commerce");
  if((major === "donation" || major === "ngo" || channel === "donation") && externalCollectionEnabled(ctx, "donation")) names.add("donation");
  if((major === "media" || channel === "media") && externalCollectionEnabled(ctx, "media")) names.add("media");
  if((major === "tourism" || channel === "tour" || channel === "tourism") && externalCollectionEnabled(ctx, "tourism")) names.add("tourism");
  if((major === "social" || channel === "social") && externalCollectionEnabled(ctx, "social")) names.add("social");
  return Array.from(names).filter(name => !channelBlockedForPolicy(name, ctx.operationalPolicy));
}

function adapterRegistry(){
  return {
    snapshot: new SnapshotAdapter(),
    live: new LiveSearchAdapter(),
    planetary: new PlanetarySourceAdapter(),
    collector: new CollectorSourceAdapter(),
    regional: new MaruSearchSourceAdapter("regional", { regionAware:true, sectorAware:true, entityAware:true }),
    cooperative: new SectorExternalAdapter("cooperative", ["cooperative", "agricultural cooperative", "fishery cooperative"]),
    commerce: new SectorExternalAdapter("commerce", ["manufacturer", "supplier", "distribution", "commerce"]),
    donation: new SectorExternalAdapter("donation", ["NGO", "charity", "relief organization"]),
    media: new SectorExternalAdapter("media", ["news", "media", "article"]),
    tourism: new SectorExternalAdapter("tourism", ["tourism", "destination", "travel"]),
    social: new SectorExternalAdapter("social", ["social", "feed", "creator"])
  };
}
async function collectFromAdapters(ctx){
  const registry = adapterRegistry();
  const selected = selectAdapters(ctx);
  const out = [];
  const meta = [];
  for(const name of selected){
    const adapter = registry[name];
    if(!adapter) continue;
    try{
      const items = await withTimeout(adapter.collect(ctx), sourceTimeoutMs(ctx, name), name);
      const arr = Array.isArray(items) ? items : [];
      for(const raw of arr){
        if(raw && typeof raw === "object"){
          out.push({ ...raw, __adapter: name });
        }else{
          out.push(raw);
        }
      }
      const health = recordSourceHealth(name, true, arr.length, null);
      meta.push({ name, count: arr.length, ok: true, health });
    }catch(e){
      const err = s(e?.message || e);
      const health = recordSourceHealth(name, false, 0, err);
      meta.push({ name, count: 0, ok: false, error: err, health });
    }
  }
  return { items: out, adapters: meta, health: getSourceHealth() };
}
function computeQualityScore(q, item){
  const base = (Core && Core.scoreItem) ? Core.scoreItem(q, item) : 0;
  let s0 = base;

  // type boosts (legacy)
  if(item.type === "video") s0 += 0.8;
  if(item.type === "image") s0 += 0.6;
  if(item.thumbnail && !/favicon|\.ico$/i.test(item.thumbnail)) s0 += 0.3;
  if(item.media?.preview && (item.media.preview.poster || item.media.preview.mp4 || item.media.preview.webm)) s0 += 0.4;
  if(item.imageSet?.length) s0 += 0.4;

  // source boosts (light)
  const src = low(item.source || "");
  if(src){
    if(/\.(gov|edu|ac)\b/.test(src)) s0 += 0.25;
    if(/(wikipedia|reuters|apnews|bbc|nytimes|wsj|ft)\b/.test(src)) s0 += 0.15;
  }

  // freshness
  const dt = item.published_at ? Date.parse(item.published_at) : NaN;
  if(!Number.isNaN(dt)){
    const ageDays = Math.max(0, (Date.now()-dt)/(1000*60*60*24));
    s0 += Math.max(0, 0.15 - Math.min(0.15, ageDays/3650));
  }

  // explicit quality (optional 0..1)
  const q0 = item.quality;
  if(q0 && typeof q0.trust === "number") s0 += Math.max(-0.4, Math.min(0.8, q0.trust)) * 0.6;
  if(q0 && typeof q0.rank === "number") s0 += Math.max(0, Math.min(0.8, q0.rank)) * 0.5;
  if(q0 && typeof q0.freshness === "number") s0 += Math.max(0, Math.min(0.8, q0.freshness)) * 0.4;

  // dispute penalty
  const dp = item.dispute_profile;
  if(dp && typeof dp.refund_rate === "number") s0 -= Math.min(1, Math.max(0, dp.refund_rate)) * 1.2;
  if(dp && typeof dp.complaint_ratio === "number") s0 -= Math.min(1, Math.max(0, dp.complaint_ratio)) * 1.4;

  return s0;
}

function applyFilters(items, f){
  const q = f.qLower;
  return items.filter(it=>{
    if(!it) return false;

    if(f.type && f.type !== "any" && low(it.type) !== f.type) return false;
    if(f.channel && !channelMatches(it.channel, f.channel)) return false;
    if(f.lang && low(it.lang||"") !== f.lang) return false;

    // geo filters (optional)
    if(f.region && low(it.geo?.region || it.region || "") !== f.region) return false;
    if(f.country && low(it.geo?.country||"") !== f.country) return false;
    if(f.state && low(it.geo?.state||"") !== f.state) return false;
    if(f.city && low(it.geo?.city||"") !== f.city) return false;

    if(f.sector && low(it.sector?.major || "") !== f.sector) {
      if(!(f.relaxedQuery && f.channel && channelMatches(it.channel, f.channel))) return false;
    }
    if(f.sectorMinor && low(it.sector?.minor || "") !== f.sectorMinor) {
      if(!(f.relaxedQuery && f.channel && channelMatches(it.channel, f.channel))) return false;
    }
    if(f.entity && low(it.entity?.type || it.type || "") !== f.entity) {
      if(!(f.relaxedQuery && f.channel && channelMatches(it.channel, f.channel))) return false;
    }

    // producer filters (optional)
    if(f.producer){
      const pid = low(it.producer?.id||"");
      const pn = low(it.producer?.name||"");
      if(!(pid===f.producer || pn.includes(f.producer))) return false;
    }

    if(q){
      const t = low(it.title||"");
      const d = low(it.summary||"");
      const tg = Array.isArray(it.tags) ? it.tags.join(" ").toLowerCase() : "";
      const u = low(it.url||"");
      const g = low([it.geo?.region, it.geo?.country, it.geo?.state, it.geo?.city].filter(Boolean).join(" "));
      const p = low([it.producer?.id, it.producer?.name].filter(Boolean).join(" "));
      const sec = low([it.sector?.major, it.sector?.minor, it.sector?.product_type, ...(Array.isArray(it.sector?.labels)?it.sector.labels:[])].filter(Boolean).join(" "));
      const ent = low([it.entity?.type, it.entity?.subtype, it.entity?.name].filter(Boolean).join(" "));
      const haystack = [t,d,tg,u,g,p,sec,ent].join(" ");
      const tokens = q.split(/\s+/).filter(Boolean);
      const tokenHit = tokens.length ? tokens.some(tok => haystack.includes(tok)) : false;
      if(!(haystack.includes(q) || tokenHit)) {
        const structuredHit = !!(
          f.relaxedQuery &&
          (
            (f.region && low(it.geo?.region || it.region || "") === f.region) ||
            (f.country && low(it.geo?.country || "") === f.country) ||
            (f.sector && low(it.sector?.major || "") === f.sector) ||
            (f.entity && low(it.entity?.type || it.type || "") === f.entity) ||
            (f.channel && channelMatches(it.channel, f.channel))
          )
        );
        if(!structuredHit) return false;
      }
    }
    return true;
  });
}

function dedup(items){
  const seen = new Set();
  const out = [];
  for(const it of items){
    const key = (it.url && low(it.url)) || (it.id && low(it.id)) || "";
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function writeSearchBankSnapshots(bank){
  const cwd = process.cwd();

  const targets = [
    path.join(cwd,"data","search-bank.snapshot.json"),
    path.join(cwd,"netlify","functions","data","search-bank.snapshot.json")
  ];

  for(const p of targets){
    try{
      fs.mkdirSync(path.dirname(p), { recursive:true });
      fs.writeFileSync(p, JSON.stringify(bank, null, 2), "utf8");
    }catch(e){}
  }
}

function isPlainObject(v){
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergePreferExisting(existingValue, incomingValue){
  if(incomingValue === undefined) return cloneJsonish(existingValue);
  if(existingValue === undefined) return cloneJsonish(incomingValue);

  if(Array.isArray(existingValue) || Array.isArray(incomingValue)){
    return Array.isArray(existingValue) && existingValue.length
      ? cloneJsonish(existingValue)
      : cloneJsonish(incomingValue);
  }

  if(isPlainObject(existingValue) && isPlainObject(incomingValue)){
    const out = {};
    const keys = new Set([...Object.keys(incomingValue), ...Object.keys(existingValue)]);
    for(const key of keys){
      out[key] = mergePreferExisting(existingValue[key], incomingValue[key]);
    }
    return out;
  }

  if(existingValue === null || existingValue === "") return cloneJsonish(incomingValue);
  return cloneJsonish(existingValue);
}

function mergeBankItem(existingItem, incomingItem){
  if(!existingItem) return cloneJsonish(incomingItem);
  if(!incomingItem) return cloneJsonish(existingItem);
  return mergePreferExisting(existingItem, incomingItem);
}

function mergeBankItems(existingItems, incomingItems){
  const byId = new Map();

  for(const it of Array.isArray(existingItems) ? existingItems : []){
    if(!it || !it.id) continue;
    byId.set(it.id, cloneJsonish(it));
  }

  for(const it of Array.isArray(incomingItems) ? incomingItems : []){
    if(!it || !it.id) continue;

    if(byId.has(it.id)){
      byId.set(it.id, mergeBankItem(byId.get(it.id), it));
      continue;
    }

    byId.set(it.id, cloneJsonish(it));
  }

  return Array.from(byId.values());
}

async function runEngine(event, params={}){
  const ip =
  event?.headers?.["x-forwarded-for"] ||
  event?.headers?.["client-ip"] ||
  "unknown";

if(global.SearchBankExtensionCore?.security){
  if(!global.SearchBankExtensionCore.security.check(ip)){
    return {status:"fail",engine:"search-bank",message:"rate_limit"};
  }
}
  const rid = requestId();
  const ts = Date.now();

  const qRaw = s(params.q || params.query || "");
  const qCheck = (Core && Core.validateQuery) ? Core.validateQuery(qRaw) : { ok: !!qRaw.trim(), value: qRaw.trim(), code:"BAD_QUERY" };
  const q = qCheck.ok ? qCheck.value : "";

  const type = low(params.type || "") || "any";
  const channel = low(params.channel || "");
  const lang = low(params.lang || "");

  // v2 geo filters (optional)
  const country = low(params.country || params.geo_country || "");
  const state = low(params.state || params.province || params.geo_state || "");
  const city = low(params.city || params.geo_city || "");
  const producer = low(params.producer || params.producer_id || params.producer_name || "");
  const queryIntent = parseQueryIntent(qRaw, params);
  const ipGeo = ipGeoFromEvent(event);
  const geoContext = resolveGeoContext(params, queryIntent, ipGeo);
  const slotContext = resolveSlotPolicy(params, queryIntent);

let limit = safeInt(params.limit, 100, 1, 1000);
const offset = safeInt(params.offset, 0, 0, 100000);

// ===== SOCIAL LIMIT OVERRIDE =====
const isSocial =
  (params.channel && params.channel === "social") ||
  (params.type && params.type === "social") ||
  (params.category && params.category === "social");

if (isSocial) {
  limit = Math.min(limit, 300);
}

  const allowListMode = truthy(params.list) || slotContext.autoFill || (!q && (type!=="any" || channel || lang || country || state || city || producer || queryIntent.regionHint || queryIntent.countryHint || queryIntent.sectorHint));
  if(!q && !allowListMode){
    return { status:"fail", engine:"search-bank", request_id: rid, timestamp: ts, message: qCheck.code || "EMPTY_QUERY" };
  }

  const persistedBank = await snapshotProvider(event);
  const operationalPolicy = resolveOperationalPolicy({ event, params, limit, q, queryIntent, geoContext, ipGeo, slotContext, channel, type, lang }, Array.isArray(persistedBank?.items) ? persistedBank.items : []);
  const slotDeficiency = resolveSlotDeficiency({ event, params, limit, q, queryIntent, geoContext, ipGeo, slotContext, operationalPolicy, channel, type, lang }, Array.isArray(persistedBank?.items) ? persistedBank.items : []);
  const adapterCtx = {
    event, params, limit, q, queryIntent, geoContext, ipGeo, slotContext, operationalPolicy, slotDeficiency,
    channel, type, lang
  };

  const collected = await collectFromAdapters(adapterCtx);
  const rawItems = collected.items;
  const served = {
    served_from: collected.adapters.map(a => a.name).join("+") || "snapshot",
    data: { items: rawItems },
    adapters: collected.adapters,
    source_health: collected.health
  };

  const normalized = [];
  const snapshotCorpus = [];
  const persistCandidates = [];
  const rejected = [];
  for(const r of rawItems){
    const adapterName = r && typeof r === "object" ? r.__adapter : null;

    // Snapshot rows are already contract-shaped. Keep them as corpus and avoid full-bank deep normalization per request.
    if(adapterName === "snapshot"){
      const rawSnapshot = { ...r };
      delete rawSnapshot.__adapter;
      snapshotCorpus.push(rawSnapshot);
      continue;
    }

    const it = normalizeItem(r, adapterCtx);
    if(it){
      const validation = validateBankItem(it);
      it.validation = validation.ok ? undefined : { issues: validation.issues };
      applyOperationalPolicy(it, adapterCtx);
      if(isPersistableNewItem(it) && slotAcceptsItem(it, adapterCtx) && policyAcceptsItem(it, adapterCtx)){
        normalized.push(it);
        if(shouldPersistForSlot(it, adapterCtx) && policyAcceptsItem(it, adapterCtx)) persistCandidates.push(it);

        if(global.SearchBankExtensionCore?.pipeline){
          try{
            global.SearchBankExtensionCore.pipeline(it);
          }catch(e){}
        }
      }else{
        rejected.push({ id: it.id || null, title: it.title || null, issues: validation.issues });
      }
    }
  }

const existing = Array.isArray(persistedBank?.items) ? persistedBank.items : [];
const existingIds = new Set(existing.map(i => i.id).filter(Boolean));

// 👉 신규 데이터만 추출: snapshot 자체는 제외하고 외부/라이브 수집분만 적재 후보로 본다.
const newItems = [];
for (const it of persistCandidates) {
  if (!it || !it.id) continue;
  if (!existingIds.has(it.id)) {
    newItems.push(it);
  }
}

// 👉 기존 + 신규/보강 병합: snapshot 재병합으로 인한 대용량 성능 저하 방지
let combined = persistCandidates.length ? mergeBankItems(existing, persistCandidates) : existing.slice();

// 👉 랭킹 기준 정렬 (위치만 변경, 데이터는 그대로)
combined.sort((a, b) => {
const qa = computeCompositeScore(adapterCtx, a) + computeOperationalScore(adapterCtx, a) + computeSupplyScore(adapterCtx, a);
const qb = computeCompositeScore(adapterCtx, b) + computeOperationalScore(adapterCtx, b) + computeSupplyScore(adapterCtx, b);

  if (qb !== qa) return qb - qa;

  const da = a.published_at ? Date.parse(a.published_at) : 0;
  const db = b.published_at ? Date.parse(b.published_at) : 0;

  return db - da;
});

// Existing snapshot rows must not be deleted or truncated here.
// Capacity pruning, if ever needed, must be handled by a separate audited maintenance job.

const bank = {
  ...(persistedBank && typeof persistedBank === "object" ? persistedBank : {}),
  items: combined,
  meta: {
    ...((persistedBank && persistedBank.meta) || {}),
    generated_at: nowIso(),
    source: "search-bank-engine",
    served_from: served.served_from || "snapshot"
  }
};

if(persistCandidates.length || truthy(params.forceSnapshotWrite)){
  writeSearchBankSnapshots(bank);
}

  const explicitGeo = explicitGeoFilters(params, queryIntent);
  const filters = {
    qLower: low(q),
    type, channel: channel || low(slotContext.channel || ""), lang,
    // IP geo is intentionally not a hard result filter. It drives policy/ranking via audienceCountry/operationalScore.
    // Hard geo filtering is applied only when country/region/city is explicit in params or query.
    region: explicitGeo.region,
    country: explicitGeo.country,
    state: explicitGeo.state,
    city: explicitGeo.city,
    producer: producer || "",
    sector: low(params.sector || params.sector_major || queryIntent.sectorHint?.major || ""),
    sectorMinor: low(params.sector_minor || queryIntent.sectorHint?.minor || ""),
    entity: low(params.entity || params.entity_type || queryIntent.entityHint?.type || ""),
    relaxedQuery: !!(slotContext.autoFill || queryIntent.regionHint || queryIntent.countryHint || queryIntent.sectorHint || queryIntent.entityHint)
  };

  const searchCorpus = snapshotCorpus.concat(normalized.length ? normalized : []);
  let filtered = dedup(applyFilters(searchCorpus.length ? searchCorpus : (bank.items || []), filters)).filter(it => policyAcceptsItem(it, adapterCtx));

  const qForScore = q || "";
  const scored = filtered.map(it=> ({...it, qualityScore: computeQualityScore(qForScore, it), compositeScore: computeCompositeScore(adapterCtx, it), operationalScore: computeOperationalScore(adapterCtx, it), supplyScore: computeSupplyScore(adapterCtx, it)}));
  scored.sort((a,b)=>{
    if(b.operationalScore !== a.operationalScore) return b.operationalScore - a.operationalScore;
    if(b.supplyScore !== a.supplyScore) return b.supplyScore - a.supplyScore;
    if(b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if(b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    const da = a.published_at ? Date.parse(a.published_at) : NaN;
    const db = b.published_at ? Date.parse(b.published_at) : NaN;
    if(!Number.isNaN(db) && !Number.isNaN(da) && db !== da) return db - da;
    return low(a.title).localeCompare(low(b.title));
  });

  const total = scored.length;
  const pageRaw = scored.slice(offset, offset+limit);
  const page = pageRaw.map(item => {
    const enriched = normalizeItem(item, adapterCtx) || item;
    enriched.qualityScore = item.qualityScore;
    enriched.compositeScore = item.compositeScore;
    enriched.operationalScore = item.operationalScore;
    enriched.supplyScore = item.supplyScore;
    return applyOperationalPolicy(enriched, adapterCtx);
  });

  const commercePage = applyCommerceEngineToItems(page, adapterCtx);

	
/* ===== SNAPSHOT AUTO PIPELINE ===== */
try{
  if(SearchBankSync && typeof SearchBankSync.run === "function"){
    const syncItems = (newItems && newItems.length) ? newItems : persistCandidates;
    const commerceSyncItems = applyCommerceEngineToItems(syncItems || [], adapterCtx);
    if(commerceSyncItems && commerceSyncItems.length){
      await SearchBankSync.run({
        source: "search-bank",
        items: commerceSyncItems,
        query: q
      });
    }
  }
}catch(e){
  console.error("Snapshot Sync Error:", e.message);
}

return {
  status:"ok",
  engine:"search-bank",
  served_from: served.served_from || "snapshot",
  request_id: rid,
  timestamp: ts,
  query: q,
  filters: {
    type: (type!=="any")?type:undefined,
    channel: channel||undefined,
    lang: lang||undefined,
    country: filters.country||undefined,
    state: filters.state||undefined,
    city: filters.city||undefined,
    region: filters.region||undefined,
    sector: filters.sector||undefined,
    sector_minor: filters.sectorMinor||undefined,
    entity: filters.entity||undefined,
    producer: producer||undefined,
    audience_country: operationalPolicy.audienceCountry||undefined,
    target_country: operationalPolicy.targetCountry||undefined,
    limit,
    offset
  },
  total,
  items: commercePage,
  meta: {
    bank_meta: bank.meta || undefined,
    query_intent: queryIntent,
    geo_context: geoContext,
    slot_context: slotContext,
    operational_policy: operationalPolicy,
    slot_deficiency: slotDeficiency,
    source_health: served.source_health || undefined,
    sector_context: queryIntent.sectorHint || undefined,
    entity_context: queryIntent.entityHint || undefined,
    adapters: served.adapters || undefined,
    rejected_count: rejected.length,
    generated_at: nowIso()
  }
};
}

exports.runEngine = runEngine;
exports.parseQueryIntent = parseQueryIntent;
exports.resolveGeoContext = resolveGeoContext;
exports.resolveSectorContext = resolveSectorContext;
exports.resolveEntityContext = resolveEntityContext;
exports.normalizeItem = normalizeItem;
exports.mergeBankItems = mergeBankItems;
exports.validateBankItem = validateBankItem;
exports.computeCompositeScore = computeCompositeScore;
exports.selectAdapters = selectAdapters;
exports.canonicalRegionName = canonicalRegionName;
exports.externalCollectionEnabled = externalCollectionEnabled;
exports.externalSuppressed = externalSuppressed;
exports.maruSearchReentrySuppressed = maruSearchReentrySuppressed;
exports.resolveSlotPolicy = resolveSlotPolicy;
exports.applySlotContract = applySlotContract;
exports.slotAcceptsItem = slotAcceptsItem;
exports.resolveOperationalPolicy = resolveOperationalPolicy;
exports.policyAcceptsItem = policyAcceptsItem;
exports.computeOperationalScore = computeOperationalScore;
exports.resolveCountryPolicyTable = resolveCountryPolicyTable;
exports.resolveSlotDeficiency = resolveSlotDeficiency;
exports.expandQueryForLocale = expandQueryForLocale;
exports.getSourceHealth = getSourceHealth;
exports.computeSupplyScore = computeSupplyScore;

exports.handler = async function(event){
  try{
    const method = (event.httpMethod || "GET").toUpperCase();
    if(method === "GET"){
      const params = event.queryStringParameters || {};
      const res = await runEngine(event, params);
      return { statusCode: 200, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify(res) };
    }
    if(method === "POST"){
      return { statusCode: 501, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify({ status:"fail", engine:"search-bank", message:"INGEST_NOT_ENABLED" }) };
    }
    return { statusCode: 405, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify({ status:"fail", message:"METHOD_NOT_ALLOWED" }) };
  }catch(e){
    return { statusCode: 500, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify({ status:"fail", message: e?.message || "ENGINE_ERROR" }) };
  }
};

/* ===============================
SEARCH BANK EXTENSION PART 1
Region / Sector / Entity Graph
================================ */

class SBRegionManager {

  constructor(){
    this.regions = new Map();
  }

  register(id,data){
    if(!id) return;
    this.regions.set(id,{id,...data});
  }

  get(id){
    return this.regions.get(id);
  }

  list(){
    return Array.from(this.regions.values());
  }

}

class SBSectorManager {

  constructor(){
    this.sectors = new Map();
  }

  register(id,data){
    if(!id) return;
    this.sectors.set(id,{id,...data});
  }

  get(id){
    return this.sectors.get(id);
  }

  list(){
    return Array.from(this.sectors.values());
  }

}

class SBEntityManager {

  constructor(){
    this.entities = new Map();
  }

  create(entity){
    const uuid = this.uuid();
    entity.uuid = uuid;
    this.entities.set(uuid,entity);
    return entity;
  }

  get(id){
    return this.entities.get(id);
  }

  list(){
    return Array.from(this.entities.values());
  }

  uuid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
      const r=Math.random()*16|0;
      const v=c==='x'?r:(r&0x3|0x8);
      return v.toString(16);
    });
  }

}

class SBKnowledgeGraph {

  constructor(){
    this.links = new Map();
  }

  link(a,b,type){
    const id = a+"_"+type+"_"+b;
    this.links.set(id,{a,b,type,t:Date.now()});
  }

  get(id){
    const r = [];
    for(const e of this.links.values()){
      if(e.a===id || e.b===id) r.push(e);
    }
    return r;
  }

}

global.SearchBankExtensionCore = {
  regions:new SBRegionManager(),
  sectors:new SBSectorManager(),
  entities:new SBEntityManager(),
  graph:new SBKnowledgeGraph()
};

/* ===============================
SEARCH BANK EXTENSION PART 2
Global Region System
================================ */

global.SearchBankExtensionCore.worldRegions = {

  northAmerica:["USA","Canada","Mexico"],
  latinAmerica:["Brazil","Argentina","Chile","Peru"],

  westEurope:["Germany","France","UK","Italy","Spain"],
  eastEurope:["Poland","Ukraine","Romania","Russia"],

  middleEast:["Turkey","Saudi","UAE","Israel","Iran"],

  southAsia:["India","Pakistan","Bangladesh","SriLanka"],

  southeastAsia:["Thailand","Vietnam","Indonesia","Malaysia","Philippines"],

  northeastAsia:["Korea","Japan","China","Taiwan","Mongolia"],

  africa:["Nigeria","Egypt","Kenya","Ethiopia","SouthAfrica"],

  oceania:["Australia","NewZealand","PapuaNewGuinea","Fiji"]

};

global.SearchBankExtensionCore.getRegionByCountry = function(country){

  const c = String(country || "").trim();
  for(const r in this.worldRegions){
    if(this.worldRegions[r].some(x => String(x).toLowerCase() === c.toLowerCase())){
      return r;
    }
  }

  return canonicalRegionName(countryToRegion(c)) || null;

};

/* ===============================
SEARCH BANK EXTENSION PART 3
AI Query Router
================================ */

global.SearchBankExtensionCore.aiQuery = function(q){

  q = (q || "").toLowerCase();
  const res = [];

  for(const e of this.entities.list()){
    const t = JSON.stringify(e).toLowerCase();
    if(t.includes(q)) res.push(e);
  }

  return res;

};

/* ===============================
SEARCH BANK EXTENSION PART 4
Security Layer
================================ */

global.SearchBankExtensionCore.security = {

  req:new Map(),

  check(ip){

    const now = Date.now();
    const t = this.req.get(ip) || [];

    t.push(now);

    const filtered = t.filter(v=>now-v<60000);

    this.req.set(ip,filtered);

    if(filtered.length>200) return false;

    return true;

  }

};

/* ===============================
SEARCH BANK EXTENSION PART 5
Self Healing Layer
================================ */

global.SearchBankExtensionCore.recovery = {

  sources:[],

  register(fn){
    this.sources.push(fn);
  },

  async tryRecover(){

    for(const f of this.sources){

      try{
        await f();
      }catch(e){}

    }

  }

};

/* ===============================
SEARCH BANK EXTENSION PART 6
Global Entity Index Engine
================================ */

global.SearchBankExtensionCore.globalIndex = {

  entities:new Map(),

  generateID(region,sector,name){

    const r=(region||"global").toLowerCase().replace(/\s/g,"");
    const s=(sector||"general").toLowerCase().replace(/\s/g,"");
    const n=(name||"entity").toLowerCase().replace(/\s/g,"");

    const uid=Math.random().toString(36).substring(2,8);

    return r+"_"+s+"_"+n+"_"+uid;

  },

  register(entity){

    if(!entity) return null;

    const key = (entity.url || entity.name || JSON.stringify(entity)).toLowerCase();
    const id = crypto.createHash("sha1").update(key).digest("hex").slice(0,16);

    entity.globalId = id;

    this.entities.set(id,entity);

    return entity;

  },

  get(id){
    return this.entities.get(id);
  },

  search(q){

    q = (q||"").toLowerCase();
    const res=[];

    for(const e of this.entities.values()){

      const t=JSON.stringify(e).toLowerCase();

      if(t.includes(q)) res.push(e);

    }

    return res;

  },

  list(){
    return Array.from(this.entities.values());
  }

};

/* ===============================
SEARCH BANK EXTENSION PART 7-9
Router + Graph Bridge + Semantic Search
================================ */

(function(){

  const root = typeof global!=="undefined"?global:window;
  const core = root.SearchBankExtensionCore;

  if(!core) return;

  /* PART 7 */

  core.regionRouter = {

    route(entity){

      if(!entity) return null;

      const region = entity.region || "global";
      const sector = entity.sector || "general";

      if(!core.regions.get(region)){
        core.regions.register(region,{name:region});
      }

      if(!core.sectors.get(sector)){
        core.sectors.register(sector,{name:sector});
      }

      return {region,sector};

    },

    mapCountry(country){

      if(!core.worldRegions) return null;

      const c = String(country || "").trim();
      for(const r in core.worldRegions){
        if(core.worldRegions[r].some(x => String(x).toLowerCase() === c.toLowerCase())){
          return r;
        }
      }

      return canonicalRegionName(countryToRegion(c)) || null;

    }

  };

  /* PART 8 */

  core.graphBridge = {

    linkEntity(entity){

      if(!entity) return;

      const id = entity.globalId || entity.uuid;

      if(!id) return;

      if(entity.region){
        core.graph.link(id,entity.region,"region");
      }

      if(entity.sector){
        core.graph.link(id,entity.sector,"sector");
      }

      if(entity.country){

        const region = core.regionRouter.mapCountry(entity.country);

        if(region){
          core.graph.link(id,region,"region");
        }

      }

    },

    queryRelations(id){
      return core.graph.get(id);
    }

  };

  /* PART 9 */

  core.semanticSearch = function(query){

    query = (query || "").toLowerCase();
    const results = [];

    for(const e of core.globalIndex.list()){

      const text = JSON.stringify(e).toLowerCase();

      if(text.includes(query)){
        results.push(e);
        continue;
      }

      const links = core.graph.get(e.globalId || e.uuid);

      if(links){
        for(const l of links){
          if(JSON.stringify(l).toLowerCase().includes(query)){
            results.push(e);
            break;
          }
        }
      }
    }

    return results;

  };

})();

/* ===============================
SEARCH BANK EXTENSION PART 10-12
Planetary Router + Snapshot Sync + AI Learning Index
================================ */

(function(){

const root=typeof global!=="undefined"?global:window;
const core=root.SearchBankExtensionCore;
if(!core) return;

/* ===============================
PART 10
Planetary Data Router
================================ */

core.planetaryRouter={
  route(entity){
    if(!entity) return null;
    let region=entity.region;
    const sector=entity.sector||"general";
    if(!region && entity.country) region=core.regionRouter.mapCountry(entity.country);
    if(!region) region="global";
    if(!core.regions.get(region)) core.regions.register(region,{name:region});
    if(!core.sectors.get(sector)) core.sectors.register(sector,{name:sector});
    return{region,sector,key:region+"."+sector};
  }
};

/* ===============================
PART 11
Snapshot Sync Layer
================================ */

core.snapshotSync={
  snapshots:new Map(),

  push(entity){
    if(!entity) return null;
    const route=core.planetaryRouter.route(entity);
    if(!route) return null;
    const key=route.key;
    if(!this.snapshots.has(key)){
      this.snapshots.set(key,{region:route.region,sector:route.sector,items:[]});
    }
    const bucket=this.snapshots.get(key);
    bucket.items.push({...entity,t:Date.now()});

    const limit=Date.now()-(1000*60*60*24*60);
    bucket.items=bucket.items.filter(x=>x.t>limit);

    return bucket;
  },

  get(region,sector){
    const key=region+"."+sector;
    return this.snapshots.get(key);
  },

  list(){
    return Array.from(this.snapshots.values());
  }
};

/* ===============================
PART 12
AI Learning Index
================================ */

core.aiLearning={
  relations:new Map(),

  learn(entity){
    if(!entity) return;
    const id=entity.globalId||entity.uuid;
    if(!id) return;
    const tokens=[];
    if(entity.name) tokens.push(entity.name);
    if(entity.sector) tokens.push(entity.sector);
    if(entity.region) tokens.push(entity.region);
    if(entity.country) tokens.push(entity.country);
    for(const t of tokens){
      const k=t.toLowerCase();
      if(!this.relations.has(k)) this.relations.set(k,new Set());
      this.relations.get(k).add(id);
    }
  },

  query(q){
    q=(q||"").toLowerCase();
    const set=this.relations.get(q);
    if(!set) return[];
    const res=[];
    for(const id of set){
      const e=core.globalIndex.get(id);
      if(e) res.push(e);
    }
    return res;
  }
};

global.SearchBankExtensionCore.queryIndex = {

  map:new Map(),

  add(item){

    const tokens = [];

    if(item.title) tokens.push(item.title);
    if(item.summary) tokens.push(item.summary);
    if(item.tags) tokens.push(...item.tags);

    for(const t of tokens){
      const k = String(t).toLowerCase();
      if(!this.map.has(k)) this.map.set(k,[]);
      this.map.get(k).push(item);
    }
  },

  search(q){

    q = (q||"").toLowerCase();

    const res = [];
    for(const [k,v] of this.map){
      if(k.includes(q)) res.push(...v);
    }

    return res;
  }

};

// v10.1 bridge: keep extension pipeline using the same query index instance.
core.queryIndex = global.SearchBankExtensionCore.queryIndex;

/* ===============================
AUTO PIPELINE
================================ */

core.pipeline=function(entity){
  if(!entity) return;
  const e=core.globalIndex.register(entity);
  if(!e) return;
  core.graphBridge.linkEntity(e);
  core.aiLearning.learn(e);
  core.snapshotSync.push(e);
  core.queryIndex.add(e);
  return e;
};

})();
