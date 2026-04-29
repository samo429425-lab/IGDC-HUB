/**
 * maru-global-insight-engine.js
 * ------------------------------------------------------------
 * MARU Global Insight Engine — Aggregator Core (v2)
 * ------------------------------------------------------------
 * Goals:
 * - Multi-engine router (maru-search + search-bank + future)
 * - Canonical unified payload for Addon / Donation / Front pages
 * - Always guarantees: status, engine, version, items[], summary, meta.trace
 * - Partial failure tolerant
 */

"use strict";

const VERSION = "v2.1-safe-bridge-quality-gate";

let Core = null;
try { Core = require("./core"); } catch (_) {
  try { Core = require("../maru/core"); } catch (_) { Core = null; }
}

let MaruSearch = null;
try { MaruSearch = require("./maru-search"); } catch (_) { MaruSearch = null; }

let BankEngine = null;
try { BankEngine = require("./search-bank-engine"); } catch (_) { BankEngine = null; }

// ---------- UTIL ----------
function s(x){ return String(x == null ? "" : x); }
function low(x){ return s(x).toLowerCase(); }
function nowISO(){ return new Date().toISOString(); }

function clampInt(n, d, min, max){
  const v = parseInt(n, 10);
  const x = Number.isFinite(v) ? v : d;
  return Math.max(min, Math.min(max, x));
}

function normalizeQuery(q){
  return s(q).trim();
}

function normalizeContext(params){
  params = params || {};
  const scope = s(params.scope || params.level || "global").trim() || "global";
  const target = (params.target == null) ? null : s(params.target).trim();
  const intent = s(params.intent || "summary").trim() || "summary";
  return {
    scope,
    target,
    intent,
    uiLang: params.uiLang || params.locale || params.lang || null,
    targetLang: params.targetLang || params.contentLang || params.filterLang || params.searchLang || null,
    region: params.region || params.geo_region || null,
    country: params.country || params.geo_country || null,
    state: params.state || params.geo_state || null,
    city: params.city || params.geo_city || null,
    channel: params.channel || null,
    section: params.section || params.bind_section || null,
    page: params.page || null,
    route: params.route || null,
    external: params.external == null ? null : params.external,
    noExternal: params.noExternal == null ? null : params.noExternal,
    disableExternal: params.disableExternal == null ? null : params.disableExternal
  };
}

function safeUrl(u){
  const v = s(u).trim();
  return v;
}

function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./,''); }
  catch(_){ return ""; }
}

function canonicalizeItem(raw, query){
  if(!raw || typeof raw !== 'object') return null;

  const url = safeUrl(raw.url || raw.link || raw.href || "");
  const title = s(raw.title || raw.name || "").trim();
  const summary = s(raw.summary || raw.snippet || raw.description || "").trim();

  // prefer existing canonical keys; preserve routing/slot metadata for insight quality gate
  const basePayload = (raw.payload && typeof raw.payload === 'object') ? raw.payload : {};
  const rawSource = (raw.source && typeof raw.source === 'object')
    ? (raw.source.name || raw.source.platform || raw.source.id || "")
    : raw.source;
  const payload = {
    ...basePayload,
    source: basePayload.source || rawSource || null,
    tags: Array.isArray(basePayload.tags) ? basePayload.tags : (Array.isArray(raw.tags) ? raw.tags : []),
    channel: basePayload.channel || raw.channel || raw.bind?.channel || null,
    section: basePayload.section || raw.section || raw.bind?.section || null,
    page: basePayload.page || raw.page || raw.bind?.page || null,
    route: basePayload.route || raw.route || raw.bind?.route || null,
    geo: basePayload.geo || raw.geo || null,
    bind: basePayload.bind || raw.bind || null,
    extension: basePayload.extension || raw.extension || null,
    monetization: basePayload.monetization || raw.monetization || null,
    revenue: basePayload.revenue || raw.revenue || null,
    revenueDestination: basePayload.revenueDestination || raw.revenueDestination || null,
    directSale: basePayload.directSale || raw.directSale || null,
    media: basePayload.media || raw.media || null
  };

  const id = s(raw.id || url || title || "").trim() || ("item-" + Math.random().toString(16).slice(2));

  const type = s(raw.type || payload.type || "web").trim() || "web";
  const mediaType = s(raw.mediaType || payload.mediaType || (type === 'video' ? 'video' : (type === 'image' ? 'image' : 'article'))).trim();

  const source = s(rawSource || payload.source || domainOf(url) || "").trim() || null;
  const thumbnail = s(raw.thumbnail || raw.thumb || payload.thumb || payload.thumbnail || payload.image || payload.image_url || payload.og_image || "").trim() || "";

  // keep existing scoring signals if present
  const score =
    (typeof raw.qualityScore === 'number') ? raw.qualityScore :
    (typeof raw._coreScore === 'number') ? raw._coreScore :
    (typeof raw.score === 'number') ? raw.score :
    (payload && typeof payload.score === 'number') ? payload.score :
    0;

  // basic query relevance bump (non-destructive)
  let qBoost = 0;
  if(query){
    const q = low(query);
    const t = low(title);
    const d = low(summary);
    if(t.includes(q)) qBoost += 0.15;
    if(d.includes(q)) qBoost += 0.08;
  }

  return {
    id,
    type,
    mediaType,
    title,
    summary,
    url,
    source,
    thumbnail,
    score: score + qBoost,
    payload
  };
}

function dedup(items){
  const out = [];
  const seen = new Set();
  for(const it of items){
    if(!it) continue;
    const k = s(it.url || it.id || "").trim();
    const key = k ? low(k) : low(s(it.title || "") + "|" + s(it.source || ""));
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function payloadOf(it){
  return (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
}

function flatText(v){
  try{
    if(Array.isArray(v)) return v.map(flatText).join(' ');
    if(v && typeof v === 'object') return Object.keys(v).map(k => flatText(v[k])).join(' ');
    return s(v);
  }catch(_){ return ''; }
}

function hasRealUrl(it){
  const u = s(it && it.url).trim();
  if(!u || u === '#') return false;
  if(/^javascript:/i.test(u)) return false;
  if(/^void\(/i.test(u)) return false;
  return true;
}

function isGenericPlaceholderTitle(title){
  const raw = s(title).trim();
  const t = low(raw);
  if(!t) return true;
  return (
    /^network item\s*\d+$/i.test(raw) ||
    /^item\s*\d+$/i.test(raw) ||
    /^sample\s+item\s*\d*$/i.test(raw) ||
    t.includes('placeholder') ||
    t.includes('sample') ||
    t.includes('demo') ||
    t.includes('dummy') ||
    t.includes('seed placeholder')
  );
}

function isPreparedExpansionSlot(it, context){
  const p = payloadOf(it);
  const hay = low([
    it && it.title,
    it && it.summary,
    it && it.source,
    it && it.type,
    it && it.mediaType,
    it && it.url,
    p.channel,
    p.section,
    p.page,
    p.route,
    p.source,
    flatText(p.tags),
    flatText(p.bind),
    flatText(p.extension),
    context && context.intent,
    context && context.channel,
    context && context.section,
    context && context.page,
    context && context.route
  ].join(' '));

  const allowHints = [
    'social', 'networkhub', 'network', 'broadcaster', 'broadcast',
    'academic', 'literature', 'scholar', 'research', 'journal', 'book',
    'media', 'video', 'webtoon', 'commerce', 'shopping', 'distribution',
    'donation', 'tour', 'culture', 'arts', 'education', 'platform'
  ];

  return allowHints.some(k => hay.includes(k));
}

function placeholderSignalScore(it){
  let score = 0;
  const p = payloadOf(it);
  const title = s(it && it.title).trim();
  const summary = s(it && it.summary).trim();
  const url = s(it && it.url).trim();
  const source = low((it && it.source) || p.source);
  const thumb = low((it && it.thumbnail) || p.thumbnail || p.thumb || p.image || p.og_image);
  const payloadText = low(flatText({
    tags: p.tags,
    channel: p.channel,
    section: p.section,
    page: p.page,
    route: p.route,
    bind: p.bind,
    extension: p.extension
  }));

  if(!hasRealUrl(it)) score += 0.30;
  if(isGenericPlaceholderTitle(title)) score += 0.30;
  if(!summary || summary.length < 8) score += 0.12;

  if(source.includes('seed')) score += 0.18;
  if(source.includes('placeholder')) score += 0.22;
  if(payloadText.includes('placeholder')) score += 0.18;
  if(payloadText.includes('seed')) score += 0.12;
  if(payloadText.includes('replaceable')) score += 0.08;

  if(thumb.includes('/assets/sample/')) score += 0.14;
  if(thumb.includes('placeholder')) score += 0.18;
  if(thumb.includes('noimage') || thumb.includes('no_image')) score += 0.18;

  if(p.placeholder === true) score += 0.35;
  if(p.seed === true) score += 0.24;
  if(p.source === 'seed') score += 0.24;
  if(p.extension && p.extension.placeholder === true) score += 0.35;
  if(url.includes('/seed/')) score += 0.28;

  return Math.min(1, score);
}

function isContextRelevant(it, query, context){
  const q = low(query);
  const p = payloadOf(it);
  const ctx = [
    context && context.scope,
    context && context.target,
    context && context.intent,
    context && context.region,
    context && context.country,
    context && context.state,
    context && context.city,
    context && context.channel,
    context && context.section,
    context && context.page,
    context && context.route
  ].map(low).filter(Boolean);

  const hay = low([
    it && it.title,
    it && it.summary,
    it && it.source,
    it && it.type,
    it && it.mediaType,
    it && it.url,
    p.channel,
    p.section,
    p.page,
    p.route,
    p.source,
    flatText(p.tags),
    flatText(p.bind),
    flatText(p.geo),
    flatText(p.extension)
  ].join(' '));

  if(q && hay.includes(q)) return true;
  return ctx.some(v => v && hay.includes(v));
}

function applyInsightQualityGate(items, query, context){
  const out = [];
  const stats = {
    input: Array.isArray(items) ? items.length : 0,
    output: 0,
    dropped: 0,
    downgraded: 0,
    preparedSlots: 0
  };

  for(const it of Array.isArray(items) ? items : []){
    if(!it) continue;

    const signal = placeholderSignalScore(it);
    const relevant = isContextRelevant(it, query, context);
    const realUrl = hasRealUrl(it);
    const hasBody = !!(s(it.title).trim() && s(it.summary).trim().length >= 8);
    const preparedSlot = isPreparedExpansionSlot(it, context);

    if(preparedSlot) stats.preparedSlots++;

    // Exclude only clear noise. Future social/broadcast/academic/literature slots are preserved.
    if(signal >= 0.78 && !realUrl && !hasBody && !relevant && !preparedSlot){
      stats.dropped++;
      continue;
    }

    let penalty = 0;
    let qualityClass = 'real_content';

    if(signal >= 0.50){
      qualityClass = preparedSlot ? 'prepared_slot' : 'placeholder_likely';
      penalty = preparedSlot ? 0.18 : (relevant ? 0.28 : 0.58);
    }else if(signal >= 0.24){
      qualityClass = preparedSlot ? 'prepared_slot' : 'weak_placeholder_signal';
      penalty = preparedSlot ? 0.08 : (relevant ? 0.12 : 0.24);
    }

    if(penalty > 0) stats.downgraded++;

    out.push({
      ...it,
      score: Math.max(0, Number(it.score || 0) - penalty),
      payload: {
        ...payloadOf(it),
        insightQuality: {
          class: qualityClass,
          placeholderSignal: signal,
          relevant,
          preparedSlot,
          penalty,
          summaryEligible: qualityClass === 'real_content' || (realUrl && signal < 0.50)
        }
      }
    });
  }

  stats.output = out.length;
  return { items: out, stats };
}

function summarySafeItems(items){
  const clean = (Array.isArray(items) ? items : []).filter(it => {
    const iq = it && it.payload && it.payload.insightQuality;
    if(iq && iq.summaryEligible === false) return false;
    const signal = iq ? Number(iq.placeholderSignal || 0) : placeholderSignalScore(it);
    return signal < 0.50 || hasRealUrl(it);
  });

  return clean.length ? clean : (Array.isArray(items) ? items : []);
}

function pickSummary(query, items){
  const q = s(query).trim();
  if(!q) return "";
  const top = (Array.isArray(items) ? items : []).slice(0, 5)
    .map(it => s(it.title || "").trim())
    .filter(Boolean);
  if(top.length) return `“${q}” 관련 상위 결과: ${top.join(' · ')}`;
  return `“${q}” 관련 인사이트를 취합 중입니다.`;
}

function ok(body){
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
    },
    body: JSON.stringify(body)
  };
}

function fail(message, detail){
  return ok({
    status: "fail",
    engine: "maru-global-insight",
    version: VERSION,
    message: s(message || "ENGINE_ERROR"),
    detail: detail == null ? null : s(detail)
  });
}

// ---------- ENGINE CALLS ----------
async function callMaruSearch(query, mode, limit, context){

  if(!MaruSearch || typeof MaruSearch.runEngine !== "function"){
    return { ok:false, error:"MARU_SEARCH_UNAVAILABLE" };
  }

  try{
    context = context || {};
    const runMode = mode || "global-insight";
    const res = await MaruSearch.runEngine({}, {
      q: query,
      query: query,
      mode: runMode,
      limit,
      scope: context.scope || null,
      target: context.target || null,
      intent: context.intent || null,
      uiLang: context.uiLang || null,
      targetLang: context.targetLang || null,
      region: context.region || null,
      country: context.country || null,
      state: context.state || null,
      city: context.city || null,
      channel: context.channel || null,
      section: context.section || null,
      page: context.page || null,
      route: context.route || null,
      external: context.external,
      noExternal: context.noExternal,
      disableExternal: context.disableExternal,
      noAnalytics: true,
      noRevenue: true,
      from: "global-insight"
    });

    const items =
      (res && Array.isArray(res.items)) ? res.items :
      (res && Array.isArray(res.results)) ? res.results :
      (res && res.data && Array.isArray(res.data.items)) ? res.data.items :
      [];

    if(res && (items.length || res.source || res.region || res.route || res.meta)){
      return {
        ok:true,
        data:{
          status:"ok",
          engine:"maru-search",
          version: res.version || null,
          source: res.source || "maru-search",
          region: res.region || null,
          route: res.route || null,
          meta: res.meta || null,
          items,
          results: items
        }
      };
    }

    return { ok:false, error:"SEARCH_FAIL" };
  }catch(e){
    return { ok:false, error:(e && e.message) ? e.message : "SEARCH_EXCEPTION" };
  }
}

async function callSearchBank(event, query, limit, context){
  if(!BankEngine || typeof BankEngine.runEngine !== 'function'){
    return { ok:false, error:"BANK_ENGINE_UNAVAILABLE" };
  }
  try{
    context = context || {};
    const params = {
      q: query,
      query: query,
      limit,
      from: 'global-insight',
      channel: context.channel || (context.intent === 'media' ? 'media' : undefined),
      section: context.section || undefined,
      page: context.page || undefined,
      route: context.route || undefined,
      region: context.region || undefined,
      country: context.country || undefined,
      state: context.state || undefined,
      city: context.city || undefined,
      external: context.external,
      noExternal: context.noExternal,
      disableExternal: context.disableExternal,
      type: context.intent === 'media' ? 'video' : undefined
    };
    const res = await BankEngine.runEngine(event || {}, params);
    if(res && res.status === 'ok') return { ok:true, data: res };
    return { ok:true, data: res || { status:'ok', items:[] } };
  }catch(e){
    return { ok:false, error: s(e && e.message ? e.message : "BANK_EXCEPTION") };
  }
}

// ---------- AGGREGATOR CORE ----------
async function runGlobalInsightV2(event, params){
  const query = normalizeQuery(params.q || params.query);
  const mode = s(params.mode || 'global-insight').trim() || 'global-insight';
  const limit = clampInt(params.limit, 20, 1, 1000);
  const context = normalizeContext(params);

  // Validate query (non-breaking)
  if(Core && typeof Core.validateQuery === 'function'){
    const v = Core.validateQuery(query);
    if(v === false || (v && typeof v === 'object' && v.ok === false)){
      return {
        status: 'ok',
        engine: 'maru-global-insight',
        version: VERSION,
        timestamp: nowISO(),
        query,
        mode,
        context,
        items: [],
        results: [],
        summary: query ? `“${query}” 관련 인사이트를 취합 중입니다.` : '',
        text: query ? `“${query}” 관련 인사이트를 취합 중입니다.` : '',
        issues: [],
        meta: { trace: { core_validate: 'blocked' }, count: 0, limit }
      };
    }
  }

  if(!query && mode === 'search'){
    return {
      status: 'ok',
      engine: 'maru-global-insight',
      version: VERSION,
      timestamp: nowISO(),
      query,
      mode,
      context,
      items: [],
      results: [],
      summary: '',
      text: '',
      issues: [],
      meta: { trace: { empty_query: true }, count: 0, limit }
    };
  }

  const trace = {
    maru_search: { ok:false, count:0, error:null },
    search_bank: { ok:false, count:0, error:null }
  };

const [ms, bank] = await Promise.allSettled([
  callMaruSearch(query, mode, limit, context),
  callSearchBank(event, query, Math.min(limit, 200), context)
]);

const msRes =
  ms.status === "fulfilled"
    ? ms.value
    : { ok:false, error:"SEARCH_FAIL" };

const bankRes =
  bank.status === "fulfilled"
    ? bank.value
    : { ok:false, error:"BANK_FAIL" };

let msItems = [];
if(msRes.ok && msRes.data){
  const d = msRes.data;
  const arr = Array.isArray(d.items)
    ? d.items
    : (Array.isArray(d.results)
        ? d.results
        : (Array.isArray(d.data && d.data.items)
            ? d.data.items
            : []));
  msItems = arr.map(it => canonicalizeItem(it, query)).filter(Boolean);
  trace.maru_search.ok = (d.status === 'ok');
  trace.maru_search.count = msItems.length;
} else {
  trace.maru_search.ok = false;
  trace.maru_search.error = msRes.error || 'SEARCH_FAIL';
}

let bankItems = [];
if(bankRes.ok && bankRes.data){
  const d = bankRes.data;
  const arr = Array.isArray(d.items) ? d.items : [];
  bankItems = arr.map(it => canonicalizeItem(it, query)).filter(Boolean);
  trace.search_bank.ok = (d.status === 'ok');
  trace.search_bank.count = bankItems.length;
} else {
  trace.search_bank.ok = false;
  trace.search_bank.error = bankRes.error || 'BANK_FAIL';
}

  // merge + dedup + quality gate + rank
  let merged = dedup([ ...bankItems, ...msItems ]);
  const qualityGate = applyInsightQualityGate(merged, query, context);
  merged = qualityGate.items;
  merged.sort((a,b)=> (b.score||0) - (a.score||0));
  merged = merged.slice(0, limit);

  // summary: avoid using prepared/placeholder slot titles as representative insight text
  const summary = pickSummary(query, summarySafeItems(merged));

  // issues (future). keep stable array.
  const issues = [];

  const payload = {
    status: 'ok',
    engine: 'maru-global-insight',
    version: VERSION,
    timestamp: nowISO(),
    query,
    mode,
    context,

    // Canonical outputs
    items: merged,
    results: merged, // legacy alias

    // Human-facing
    summary,
    text: summary,

    issues,

    meta: {
      count: merged.length,
      limit,
      trace,
	  
    served_from: {
    bank: bankRes.ok ? (bankRes.data && bankRes.data.served_from) : null,
    search: msRes.ok ? (msRes.data && (msRes.data.source || msRes.data.engine)) : null
},
    quality: qualityGate.stats
    },

    // Raw passthrough (for debugging / future consumers)
    data: {
      bank: bankRes.ok ? (bankRes.data || null) : null,
      search: msRes.ok ? (msRes.data || null) : null
}
  };

  // Optional normalizeResult hook (non-breaking)
  if(Core && typeof Core.normalizeResult === 'function'){
    try{
      // normalizeResult may return a new object; keep canonical keys guaranteed
      const n = Core.normalizeResult(payload);
      if(n && typeof n === 'object'){
        // re-assert canonical guarantees
        n.status = 'ok';
        n.engine = 'maru-global-insight';
        n.version = VERSION;
        n.query = payload.query;
        n.mode = payload.mode;
        n.context = payload.context;
        n.items = Array.isArray(n.items) ? n.items : payload.items;
        n.results = Array.isArray(n.results) ? n.results : n.items;
        n.summary = s(n.summary || n.text || payload.summary);
        n.text = s(n.text || n.summary || payload.text);
        n.meta = (n.meta && typeof n.meta === 'object') ? n.meta : payload.meta;
        if(!n.meta.trace) n.meta.trace = payload.meta.trace;
        return n;
      }
    }catch(_){ /* ignore */ }
  }

  return payload;
}

// ---------- NETLIFY HANDLER ----------
exports.handler = async function(event){
  try{
    const params = event && event.queryStringParameters ? event.queryStringParameters : {};
    const out = await runGlobalInsightV2(event || {}, params || {});
    return ok(out);
  }catch(e){
    return fail('ENGINE_EXCEPTION', e && e.message ? e.message : String(e));
  }
};

exports.runGlobalInsight = async function(params = {}, event = null){
  // Compatibility: keep name "runGlobalInsight" exported
  return await runGlobalInsightV2(event || {}, params || {});
};

// =========================================================
// GLOBAL INSIGHT ENGINE EXPORT ADAPTER (Collector compatibility)
// 기존 코드 수정 없음 / 확장 export만 추가
// =========================================================

async function runEngine(event = {}, params = {}) {

  if (typeof runGlobalInsightV2 === "function") {

    return await runGlobalInsightV2(event, {
      q: params.q || params.query || "",
      mode: params.mode || "global-insight",
      limit: params.limit || 20,
      scope: params.scope,
      target: params.target,
      intent: params.intent,
      uiLang: params.uiLang || params.locale || params.lang,
      targetLang: params.targetLang || params.contentLang || params.filterLang || params.searchLang,
      region: params.region || params.geo_region,
      country: params.country || params.geo_country,
      state: params.state || params.geo_state,
      city: params.city || params.geo_city,
      channel: params.channel,
      section: params.section || params.bind_section,
      page: params.page,
      route: params.route,
      external: params.external,
      noExternal: params.noExternal,
      disableExternal: params.disableExternal
    });

  }

  return {
    status: "fail",
    engine: "maru-global-insight",
    message: "INSIGHT_ENGINE_NOT_AVAILABLE"
  };
}

exports.runEngine = runEngine;

