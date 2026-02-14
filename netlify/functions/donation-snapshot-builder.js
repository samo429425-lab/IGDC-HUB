"use strict";

/**
 * donation-snapshot-builder.enterprise.v8.js
 *
 * Goal: Long-term, enterprise-grade donation snapshot builder.
 * - Inputs: SearchBank / Insight / other engines (when present) + Seed snapshot fallback
 * - Output: donation.snapshot.enterprise.v7+ compatible snapshot (bank-first, seed fallback)
 * - PSOM-aligned: emits psom_key values that match donation.html data-psom-key slots
 *
 * Notes:
 * - This builder does NOT crawl the web. It normalizes and validates upstream data.
 * - If upstream data is missing/insufficient, it fills remaining slots from seed snapshot.
 */

const fs = require("fs");
const path = require("path");

/* =========================
   Response Helper
========================= */
function ok(body){
  return {
    statusCode: 200,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*"
    },
    body: JSON.stringify(body,null,2)
  };
}

/* =========================
   Utils
========================= */
function readJSON(p){
  try{
    return JSON.parse(fs.readFileSync(p,"utf-8"));
  }catch(_e){
    return null;
  }
}

function nowIso(){
  return new Date().toISOString();
}

function sha1(s){
  try{
    return require("crypto").createHash("sha1").update(String(s||"")).digest("hex");
  }catch(_e){
    // fallback (weak but stable)
    let h=0; const str=String(s||"");
    for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; }
    return "h"+Math.abs(h);
  }
}

function toStr(x){
  return (x===null || x===undefined) ? "" : String(x);
}

function arr(x){
  return Array.isArray(x) ? x : (x ? [x] : []);
}

function cleanName(s){
  return toStr(s).trim().replace(/\s+/g," ");
}

function normalizeKey(s){
  return cleanName(s).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

function pickFirst(...vals){
  for(const v of vals){
    const s = toStr(v).trim();
    if(s) return s;
  }
  return "";
}

function safeUrl(u){
  const s = toStr(u).trim();
  if(!s) return "";
  // basic sanitization
  if(/^javascript:/i.test(s)) return "";
  return s;
}

function hostOf(u){
  try{
    const url = new URL(u);
    return url.hostname.toLowerCase();
  }catch(_e){
    return "";
  }
}

function isHttps(u){
  try{
    const url = new URL(u);
    return url.protocol === "https:";
  }catch(_e){
    return false;
  }
}

/* =========================
   Paths
========================= */
function candidatePaths(rel){
  return [
    path.join(process.cwd(), "data", rel),
    path.join(__dirname, "data", rel),
    path.join(__dirname, "..", "..", "data", rel),
    path.join(__dirname, rel)
  ];
}

/* =========================
   Load Seed Snapshot (v7+)
========================= */
function loadSeedSnapshot(){

  const paths = candidatePaths("donation.snapshot.json");

  for(const p of paths){
    const j = readJSON(p);
    if(j && j.items && j.sections) return j;
  }

  // fallback minimal
  return {
    meta:{ schema:"donation.snapshot.enterprise.seed" },
    policy:{},
    taxonomy:{},
    sections:[],
    items:[]
  };
}

/* =========================
   Load PSOM (optional)
========================= */
function loadPSOM(){

  const paths = candidatePaths("psom.json");

  for(const p of paths){
    const j = readJSON(p);
    if(j && Array.isArray(j)) return j;
  }

  return [];
}

/* =========================
   Load Sources (SearchBank + optional Insight)
========================= */
function loadSearchBank(){

  const paths = candidatePaths("search-bank.snapshot.json");

  for(const p of paths){
    const j = readJSON(p);
    if(j && Array.isArray(j.items)) return j;
  }

  return null;
}

function loadOptional(name){
  const paths = candidatePaths(name);
  for(const p of paths){
    const j = readJSON(p);
    if(j) return j;
  }
  return null;
}

/* =========================
   HTML 기준 PSOM Keys
========================= */
const SECTION_KEYS = [
  "donation-global",
  "donation-ngo",
  "donation-mission",
  "donation-service",
  "donation-relief",
  "donation-education",
  "donation-environment",
  "donation-others"
];

/* =========================
   Section Classification
   (PSOM-aligned keywords, long-term stable)
========================= */
function classifySection(rec){

  const explicit = pickFirst(rec.psom_key, rec.section, rec.category);
  if(SECTION_KEYS.includes(explicit)) return explicit;

  const name = cleanName(pickFirst(rec.org_name, rec.name, rec.title));
  const summary = cleanName(pickFirst(rec.summary, rec.description, rec.about));
  const tags = arr(rec.tags).map(t=>normalizeKey(t)).join(" ");

  const blob = normalizeKey([name, summary, tags].join(" "));

  // Global / international
  if(/\bun\b|\bunhcr\b|\bunicef\b|\bworld\b|\binternational\b|\bglobal\b|\bifrc\b|\bred cross\b|\bred crescent\b/.test(blob)){
    return "donation-global";
  }

  // Relief / disaster
  if(/\brelief\b|\bdisaster\b|\bemergency\b|\brescue\b|\bhumanitarian\b|\bfamine\b|\breadiness\b|\bearthquake\b|\bflood\b|\bconflict\b/.test(blob)){
    return "donation-relief";
  }

  // Mission / faith-based
  if(/\bmission\b|\bchurch\b|\bgospel\b|\bevangel\b|\bfaith\b|\bchristian\b|\bcatholic\b|\bprotestant\b|\bmosque\b|\btemple\b|\bministry\b/.test(blob)){
    return "donation-mission";
  }

  // Education
  if(/\beducation\b|\bschool\b|\bstudent\b|\byouth\b|\bchild\b|\bscholar\b|\buniversity\b|\btraining\b|\bliteracy\b/.test(blob)){
    return "donation-education";
  }

  // Environment
  if(/\benvironment\b|\bclimate\b|\bforest\b|\bocean\b|\bwildlife\b|\bconservation\b|\bcarbon\b|\brenewable\b|\bplastic\b/.test(blob)){
    return "donation-environment";
  }

  // Service / welfare / medical
  if(/\bservice\b|\bwelfare\b|\bmedical\b|\bhealth\b|\bhospital\b|\bcare\b|\bsupport\b|\bcommunity\b|\bfood bank\b|\bshelter\b|\bhousing\b/.test(blob)){
    return "donation-service";
  }

  // Default NGO bucket
  return "donation-ngo";
}

/* =========================
   Verification Heuristics (offline)
   - Not "truth"; produces a stable, explainable confidence scaffold.
========================= */
function verifyHeuristic(rec){

  const homepage = safeUrl(pickFirst(rec.homepage, rec.website, rec.url, rec.link, rec.href));

  const host = hostOf(homepage);

  let score = 0;
  const flags = [];

  if(homepage){
    score += 20;
    if(isHttps(homepage)) score += 10;
    if(host.endsWith(".org")) score += 10;
    if(host.endsWith(".int")) score += 10;
    if(/\b(unicef|unhcr|ifrc|icrc|redcross|worldvision|savethechildren|care\b|oxfam)\b/i.test(host)) score += 10;
    if(/\bblogspot\b|\bwordpress\b|\bwixsite\b|\bweebly\b/i.test(host)){
      flags.push("site_platform_low_trust");
      score -= 10;
    }
  }else{
    flags.push("missing_homepage");
    score -= 10;
  }

  const name = cleanName(pickFirst(rec.org_name, rec.name, rec.title));
  if(name){
    score += 10;
    if(name.length < 3) score -= 10;
    if(/\bfree money\b|\bquick\b|\bguarantee\b/i.test(name)){
      flags.push("suspicious_name");
      score -= 20;
    }
  }else{
    flags.push("missing_name");
    score -= 15;
  }

  // clamp
  if(score < 0) score = 0;
  if(score > 100) score = 100;

  let status = "pending";
  if(score >= 70 && homepage) status = "verified";
  if(score < 25) status = "needs-review";

  return { status, score, flags, homepage, host };
}

/* =========================
   Normalize incoming records into v7+ items
========================= */
function normalizeRecord(rec, sectionKey, idx, psomInfo){

  // Collect raw fields from heterogeneous inputs
  const org_name = cleanName(pickFirst(rec.org?.name, rec.org_name, rec.name, rec.title, rec.organization));
  const legal_name = cleanName(pickFirst(rec.org?.legal_name, rec.legal_name, rec.legalName));
  const summary = cleanName(pickFirst(rec.summary, rec.description, rec.about, rec.snippet));
  const homepage = safeUrl(pickFirst(
    rec.org?.homepage,
    rec.homepage,
    rec.website,
    rec.url,
    rec.link?.url,
    rec.link,
    rec.href
  ));

  const thumb = safeUrl(pickFirst(
    rec.media?.thumb,
    rec.thumbnail,
    rec.thumb,
    rec.image,
    rec.og_image,
    rec.logo,
    rec.logo_url
  )) || "/assets/img/placeholder.png";

  const bankId = pickFirst(rec.bank_ref?.record_id, rec.record_id, rec.id);
  const sourceName = pickFirst(rec.source?.name, rec.source, rec.collector?.engine, rec.engine, "bank");

  const tags = Array.isArray(rec.tags) ? rec.tags : (Array.isArray(rec.keywords) ? rec.keywords : []);

  const vh = verifyHeuristic({ ...rec, org_name, homepage });

  const uidBase = `${sectionKey}|${vh.host||""}|${normalizeKey(org_name)||""}|${bankId||""}`;
  const uid = `donation:${sectionKey}:${sha1(uidBase).slice(0,12)}`;

  // Ranking scaffold
  const rankScore =
    (vh.score * 10) +
    (bankId ? 500 : 0) +
    (rec.rank?.score ? Number(rec.rank.score) : 0);

  // i18n scaffold (PSOM provides supported languages list; content can be filled upstream)
  const i18n = {
    lang: rec.i18n?.lang || rec.lang || rec.language || null,
    title: rec.i18n?.title || {},
    summary: rec.i18n?.summary || {}
  };

  // Compose v7+ item (enterprise stable)
  return {
    uid,
    id: uid,

    psom_key: sectionKey,
    category: sectionKey,
    type: "org-slot",

    title: pickFirst(rec.title, org_name) || org_name || `Donation Partner ${idx+1}`,
    summary,

    org:{
      id: rec.org?.id || rec.org_id || null,
      name: org_name || null,
      legal_name: legal_name || null,
      homepage: homepage || null,
      country: rec.org?.country || rec.country || null,
      verified: (vh.status==="verified"),

      registration: rec.org?.registration || {
        country: rec.reg_country || null,
        authority: rec.reg_authority || null,
        id: rec.reg_id || null
      },

      contact: rec.org?.contact || {
        email: rec.email || null,
        phone: rec.phone || null
      },

      social: rec.org?.social || {
        x: rec.x || null,
        youtube: rec.youtube || null,
        instagram: rec.instagram || null,
        facebook: rec.facebook || null,
        linkedin: rec.linkedin || null
      },

      locales: rec.org?.locales || {
        name: {},
        summary: {}
      }
    },

    donation:{
      enabled: Boolean(rec.donation?.enabled),
      external: rec.donation?.external !== false,
      checkout_url: safeUrl(pickFirst(rec.donation?.checkout_url, rec.checkout_url)) || null,
      currency: rec.donation?.currency || rec.currency || null,
      min_amount: rec.donation?.min_amount || rec.min_amount || null,
      methods: Array.isArray(rec.donation?.methods) ? rec.donation.methods : [],
      campaign_id: rec.donation?.campaign_id || rec.campaign_id || null,
      receipt_supported: rec.donation?.receipt_supported ?? rec.receipt_supported ?? null
    },

    bank_ref:{
      source: "search-bank",
      channel: "donation",
      record_id: bankId || null
    },

    rank:{
      global: Number(rec.rank?.global || 0),
      section: Number(rec.rank?.section || 0),
      score: Number(rankScore || 0)
    },

    track:{
      track_id: uid,
      pointable: true
    },

    engagement:{
      click: Number(rec.engagement?.click || 0),
      like: Number(rec.engagement?.like || 0),
      share: Number(rec.engagement?.share || 0),
      point: Number(rec.engagement?.point || 0)
    },

    analytics:{
      impression: Number(rec.analytics?.impression || 0),
      click_through_rate: Number(rec.analytics?.click_through_rate || 0)
    },

    media:{
      kind: "image",
      thumb: thumb,
      src: null,
      ratio: rec.media?.ratio || "1:1"
    },

    // Backward compatibility
    image: thumb,
    og_image: rec.og_image || null,

    link:{
      mode: "org-homepage",
      url: homepage || null,
      target: "_blank"
    },

    collector:{
      engine: pickFirst(rec.collector?.engine, rec.engine, sourceName) || null,
      query: rec.collector?.query || rec.query || null,
      fetched_at: rec.collector?.fetched_at || rec.fetched_at || null
    },

    provenance: rec.provenance || {
      fetched_from: sourceName || null,
      source_urls: arr(homepage ? [homepage] : []),
      captured_at: rec.captured_at || null
    },

    evidence: rec.evidence || {
      homepage_snapshot: null,
      logo_url: thumb || null,
      documents: []
    },

    compliance: rec.compliance || {
      sanctions_screened: false,
      restricted_country_screened: false,
      flags: vh.flags || []
    },

    i18n,

    verify:{
      status: rec.verify?.status || vh.status,
      score: rec.verify?.score || vh.score,
      engine: rec.verify?.engine || "offline-heuristic",
      checked_at: rec.verify?.checked_at || nowIso()
    },

    replace_policy:{
      mode: "bank-first",
      fallback: "seed",
      locked: Boolean(rec.replace_policy?.locked)
    },

    psom_mapping:{
      // Optional: populated by upstream engines later; we keep a stable scaffold
      page: "donation",
      section: sectionKey,
      category: pickFirst(psomInfo?.category, null),
      type: pickFirst(psomInfo?.type, null),
      keywords: psomInfo?.keywords || []
    },

    tags: Array.isArray(tags) ? tags : [],

    meta:{
      schema_version: 8,
      source: sourceName || "bank",
      replaceable: true,
      created_at: nowIso(),
      updated_at: nowIso()
    }
  };
}

/* =========================
   Deduplication
   - Prefer bank/verified records
========================= */
function dedupe(items){

  const best = new Map();

  for(const it of items){

    const keyHost = hostOf(it?.org?.homepage || it?.link?.url || "");
    const keyName = normalizeKey(it?.org?.name || it?.title || "");

    const k = keyHost ? `h:${keyHost}` : `n:${keyName}`;
    if(!k || k==="n:") continue;

    const prev = best.get(k);
    if(!prev){
      best.set(k, it);
      continue;
    }

    const a = prev;
    const b = it;

    const aBank = Boolean(a.bank_ref && a.bank_ref.record_id);
    const bBank = Boolean(b.bank_ref && b.bank_ref.record_id);

    const aScore = Number(a?.rank?.score || 0) + (a.verify?.status==="verified" ? 1000 : 0) + (aBank ? 500 : 0);
    const bScore = Number(b?.rank?.score || 0) + (b.verify?.status==="verified" ? 1000 : 0) + (bBank ? 500 : 0);

    if(bScore > aScore){
      best.set(k, b);
    }
  }

  return Array.from(best.values());
}

/* =========================
   Build Snapshot (Enterprise v8)
========================= */
function buildSnapshot({ seed, psomList, bank, optional }){

  const generatedAt = nowIso();

  // Section limits from seed (preferred), else defaults
  const limits = {};
  const seedSections = Array.isArray(seed.sections) ? seed.sections : [];
  seedSections.forEach(s=>{
    if(s && s.psom_key && SECTION_KEYS.includes(s.psom_key)){
      limits[s.psom_key] = Number(s.slot_limit || s.slotLimit || 40);
    }
  });
  // defaults if seed missing
  SECTION_KEYS.forEach(k=>{
    if(!limits[k]) limits[k] = (k==="donation-global" ? 100 : 80);
  });

  // PSOM (optional) -> info map
  const psomInfoMap = {};
  (Array.isArray(psomList) ? psomList : []).forEach(p=>{
    if(!p || typeof p !== "object") return;
    if(String(p.page||"").toLowerCase() !== "donation") return;
    psomInfoMap["donation"] = p;
  });

  // Collect source records
  const candidates = [];

  // SearchBank donation channel items
  const src = bank && Array.isArray(bank.items) ? bank.items : [];
  const donationList = src.filter(x => String(x.channel||"").toLowerCase() === "donation");

  donationList.forEach((rec, i)=>{
    const sectionKey = classifySection(rec);
    candidates.push(normalizeRecord(rec, sectionKey, i, psomInfoMap["donation"]));
  });

  // Optional sources (future-proof):
  // - optional.insight.items, optional.maru_search.items, etc. if present.
  // We only accept arrays; caller may pass any object.
  const optItems = [];
  if(optional && typeof optional === "object"){
    for(const k of Object.keys(optional)){
      const v = optional[k];
      if(v && Array.isArray(v.items)){
        v.items.forEach(x=>optItems.push({ ...x, source: k }));
      }
    }
  }
  optItems.forEach((rec, i)=>{
    const sectionKey = classifySection(rec);
    candidates.push(normalizeRecord(rec, sectionKey, i, psomInfoMap["donation"]));
  });

  // Deduplicate across sources
  const unique = dedupe(candidates);

  // Group by section
  const grouped = {};
  SECTION_KEYS.forEach(k=>grouped[k]=[]);
  unique.forEach(it=>{
    const k = it.psom_key;
    if(!grouped[k]) grouped[k] = [];
    grouped[k].push(it);
  });

  // Sort per section (bank-first via rank.score which already boosts bank_ref)
  function sortSection(list){
    return list.sort((a,b)=>{
      const sa = Number(a?.rank?.score || 0);
      const sb = Number(b?.rank?.score || 0);
      if(sb !== sa) return sb - sa;

      const va = a?.verify?.status === "verified" ? 1 : 0;
      const vb = b?.verify?.status === "verified" ? 1 : 0;
      if(vb !== va) return vb - va;

      const ta = toStr(a?.meta?.updated_at);
      const tb = toStr(b?.meta?.updated_at);
      return tb.localeCompare(ta);
    });
  }

  // Seed fallback items (must match keys)
  const seedItems = Array.isArray(seed.items) ? seed.items : [];
  const seedByKey = {};
  SECTION_KEYS.forEach(k=>seedByKey[k]=[]);
  seedItems.forEach(it=>{
    const k = pickFirst(it.psom_key, it.category);
    if(SECTION_KEYS.includes(k)){
      seedByKey[k].push(it);
    }
  });

  // Fill slots per section
  const outItems = [];
  SECTION_KEYS.forEach(k=>{
    const limit = limits[k];
    const list = sortSection(grouped[k] || []);

    // take top real items
    const chosen = list.slice(0, limit);

    // if 부족하면 seed로 채움
    if(chosen.length < limit){
      const need = limit - chosen.length;
      const filler = (seedByKey[k] || []).slice(0, need).map((s, idx)=>{
        // preserve seed but enforce keys, and mark seed source
        const copy = JSON.parse(JSON.stringify(s));
        copy.psom_key = k;
        copy.category = k;
        copy.meta = copy.meta || {};
        copy.meta.source = copy.meta.source || "seed";
        copy.meta.replaceable = true;
        copy.meta.updated_at = generatedAt;
        // ensure v7 compatible fields exist minimally for automap ordering
        if(!copy.bank_ref) copy.bank_ref = { source:"search-bank", channel:"donation", record_id:null };
        if(!copy.rank) copy.rank = { global:0, section:0, score:0 };
        if(!copy.verify) copy.verify = { status:"pending", score:0, engine:"seed", checked_at: generatedAt };
        if(!copy.org) copy.org = { id:null, name: copy.title || null, legal_name:null, homepage: copy.link?.url || null, country:null, verified:false };
        if(!copy.replace_policy) copy.replace_policy = { mode:"bank-first", fallback:"seed", locked:false };
        return copy;
      });
      outItems.push(...chosen, ...filler);
    }else{
      outItems.push(...chosen);
    }
  });

  // Build sections output: prefer seed sections, but normalize required fields
  const outSections = SECTION_KEYS.map(k=>{
    const seedS = seedSections.find(s=>s && s.psom_key===k) || {};
    return {
      psom_key: k,
      slot_limit: limits[k],
      replaceable: true,
      source: seedS.source || "seed",
      bank_channel: "donation",
      rank_policy: seedS.rank_policy || "auto",
      priority: Number(seedS.priority || 0)
    };
  });

  // Compose snapshot meta/policy/taxonomy
  const out = {
    meta:{
      schema:"donation.snapshot.enterprise.v7",
      generated_at: generatedAt,
      producer:"donation-snapshot-builder.enterprise.v8",
      mode:"bank-first-seed-fallback",
      version: 7,
      builder_version: 8,
      input_sources:{
        search_bank: Boolean(bank),
        optional: Object.keys(optional||{})
      }
    },
    policy: seed.policy || {},
    taxonomy: seed.taxonomy || {},
    sections: outSections,
    items: outItems
  };

  // Ensure long-term policy scaffolds exist (do not overwrite if seed already has them)
  out.policy = out.policy && typeof out.policy==="object" ? out.policy : {};
  if(!out.policy.replace){
    out.policy.replace = { priority:["bank","insight","seed"], fallback:"seed", merge:"rank-first" };
  }
  if(!out.policy.compliance){
    out.policy.compliance = { sanctions_screening:true, restricted_countries_screening:true, fraud_checks:true };
  }
  if(!out.policy.localization){
    out.policy.localization = {
      default_language:"en",
      supported_languages:["en","ko","ja","zh","es","fr","de","pt","ru","ar","hi","id","vi","th","tr"]
    };
  }

  return out;
}

/* =========================
   Netlify Handler
========================= */
exports.handler = async function(){

  const seed = loadSeedSnapshot();
  const psomList = loadPSOM();

  const bank = loadSearchBank();

  // Optional future sources (safe if missing)
  const optional = {
    // these are only loaded if present as JSON files in /data
    "maru-global-insight.snapshot.json": loadOptional("maru-global-insight.snapshot.json"),
    "maru-search.snapshot.json": loadOptional("maru-search.snapshot.json")
  };

  // If no bank and no optional items, return seed 그대로
  const hasOptionalItems = Object.values(optional).some(v => v && Array.isArray(v.items) && v.items.length);
  if(!bank && !hasOptionalItems){
    return ok(seed);
  }

  const snap = buildSnapshot({ seed, psomList, bank, optional });

  return ok(snap);
};
