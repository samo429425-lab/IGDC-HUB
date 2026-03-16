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

const VERSION = "v2-aggregator";

let Core = null;
try { Core = require("../maru/core"); } catch (_) { Core = null; }

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
  const scope = s(params.scope || params.level || "global").trim() || "global";
  const target = (params.target == null) ? null : s(params.target).trim();
  const intent = s(params.intent || "summary").trim() || "summary";
  return { scope, target, intent };
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

  // prefer existing canonical keys
  const payload = (raw.payload && typeof raw.payload === 'object') ? raw.payload : {};

  const id = s(raw.id || url || title || "").trim() || ("item-" + Math.random().toString(16).slice(2));

  const type = s(raw.type || payload.type || "web").trim() || "web";
  const mediaType = s(raw.mediaType || payload.mediaType || (type === 'video' ? 'video' : (type === 'image' ? 'image' : 'article'))).trim();

  const source = s(raw.source || payload.source || domainOf(url) || "").trim() || null;
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
    const res = await MaruSearch.runEngine({}, {
      q: query,
      mode: mode || "search",
      limit,
      scope: context ? context.scope : null,
      target: context ? context.target : null,
      intent: context ? context.intent : null
    });

    if(res && res.status === "ok"){
      return { ok:true, data:res };
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
    const params = {
      q: query,
      limit,
      // optional routing hints (future)
      channel: context && context.intent === 'media' ? 'media' : undefined,
      type: context && context.intent === 'media' ? 'video' : undefined,
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
  const mode = s(params.mode || 'search').trim() || 'search';
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

  // merge + dedup + rank
  let merged = dedup([ ...bankItems, ...msItems ]);
  merged.sort((a,b)=> (b.score||0) - (a.score||0));
  merged = merged.slice(0, limit);

  // summary
  const summary = pickSummary(query, merged);

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
}
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
      mode: params.mode || "search",
      limit: params.limit || 20,
      scope: params.scope,
      target: params.target,
      intent: params.intent
    });

  }

  return {
    status: "fail",
    engine: "maru-global-insight",
    message: "INSIGHT_ENGINE_NOT_AVAILABLE"
  };
}

exports.runEngine = runEngine;

