"use strict";

/*
MARU Search Engine
- core-driven orchestration
- preserves direct compatibility for legacy engines
- safe optional integration with helper engines
- defense-first without blocking normal users
*/

let Core = null;
let Planetary = null;
let Bank = null;
let Collector = null;
let GlobalInsight = null;
let Resilience = null;
let Knowledge = null;

try { Core = require("../maru/core"); } catch (e) {}
try { Planetary = require("./planetary-data-connector"); } catch (e) {}
try { Bank = require("./search-bank-engine"); } catch (e) {}
try { Collector = require("./collector"); } catch (e) {}
try { GlobalInsight = require("./maru-global-insight-engine"); } catch (e) {}
try { Resilience = require("./maru-resilience-engine"); } catch (e) {}
try { Knowledge = require("./maru-knowledge-graph-engine"); } catch (e) {}

const VERSION = "maru-search-v300-core-driven-integrated";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;
const MAX_QUERY_LENGTH = 260;
const ENGINE_TIMEOUT = 9000;
const MAX_RETRY = 5;
const CIRCUIT_THRESHOLD = 10;
const CIRCUIT_COOLDOWN = 30000;
const CACHE_TTL = 45000;
const MAX_RESULTS_PER_ENGINE = 200;

const CACHE = new Map();
const CIRCUIT = {
  planetary: { failures: 0, lastFail: 0 },
  bank: { failures: 0, lastFail: 0 },
  collector: { failures: 0, lastFail: 0 },
  globalInsight: { failures: 0, lastFail: 0 }
};

/* ===== UTIL ===== */
function s(x) { return String(x == null ? "" : x); }
function low(x) { return s(x).toLowerCase(); }
function now() { return Date.now(); }
function nowIso() {
  if (Core && typeof Core.nowIso === "function") return Core.nowIso();
  return new Date().toISOString();
}
function requestId() {
  if (Core && typeof Core.requestId === "function") return Core.requestId();
  return `req_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
function safeInt(v, d, min, max) {
  if (Core && typeof Core.safeInt === "function") {
    return Core.safeInt(v, d, min, max);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function sanitize(q) {
  return s(q || "")
    .replace(/[<>;$`]/g, "")
    .replace(/script/gi, "")
    .replace(/process\.env/gi, "")
    .replace(/drop\s+table/gi, "")
    .replace(/rm\s+-rf/gi, "")
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}
function detectPromptInjection(q) {
  const t = low(q);
  const patterns = [
    "ignore previous instruction",
    "ignore previous instructions",
    "system prompt",
    "developer message",
    "override rules",
    "<script",
    "process.env",
    "drop table",
    "rm -rf"
  ];
  return patterns.some(p => t.includes(p));
}
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}
function getCache(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (now() - hit.time > CACHE_TTL) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}
function setCache(key, value) {
  if (CACHE.size > 5000) CACHE.clear();
  CACHE.set(key, { time: now(), value });
}
function circuitOpen(name) {
  const c = CIRCUIT[name];
  if (!c) return false;
  if (c.failures < CIRCUIT_THRESHOLD) return false;
  if (now() - c.lastFail > CIRCUIT_COOLDOWN) {
    c.failures = 0;
    return false;
  }
  return true;
}
function circuitFail(name) {
  const c = CIRCUIT[name];
  if (!c) return;
  c.failures += 1;
  c.lastFail = now();
}
function circuitSuccess(name) {
  const c = CIRCUIT[name];
  if (!c) return;
  if (c.failures > 0) c.failures -= 1;
}

/* ===== BASE VALIDATION ===== */
function validateQuery(q) {
  if (Core && typeof Core.validateQuery === "function") {
    const v = Core.validateQuery(q);
    if (v && typeof v === "object") return v;
  }
  const qq = sanitize(q);
  if (!qq) return { ok: false, code: "BAD_QUERY", value: "" };
  return { ok: true, value: qq };
}
function parseParams(params = {}) {
  const rawQ = params.q || params.query || "";
  const v = validateQuery(rawQ);
  const q = v.ok ? sanitize(v.value) : sanitize(rawQ);
  return {
    q,
    query: q,
    limit: safeInt(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    region: params.region || null,
    mode: s(params.mode || "search").trim() || "search",
    intent: params.intent || null,
    scope: params.scope || null,
    target: params.target || null,
    lang: params.lang || null,
    debug: String(params.debug || "0") === "1"
  };
}

/* ===== NORMALIZE ===== */
function normalizeItem(it, fallbackSource) {
  if (!it || typeof it !== "object") return null;
  const url = s(it.url || it.link || it.href || "").trim();
  const title = s(it.title || it.name || "").trim();
  const summary = s(it.summary || it.description || it.snippet || "").trim();
  return {
    id: it.id ? s(it.id) : null,
    title,
    summary,
    url,
    source: s(it.source || fallbackSource || "unknown").trim() || "unknown",
    mediaType: s(it.mediaType || it.type || "web").trim() || "web",
    platform: s(it.platform || "").trim(),
    license: s(it.license || "").trim(),
    score: typeof it.score === "number" ? it.score : 0.5,
    sourceTrust: typeof it.sourceTrust === "number" ? it.sourceTrust : 0.5,
    deepfakeRisk: typeof it.deepfakeRisk === "number" ? it.deepfakeRisk : 0,
    manipulationRisk: typeof it.manipulationRisk === "number" ? it.manipulationRisk : 0,
    timestamp: it.timestamp || now(),
    thumbnail: s(it.thumbnail || it.thumb || "").trim(),
    imageSet: Array.isArray(it.imageSet) ? it.imageSet.slice(0, 8) : undefined,
    media: (it.media && typeof it.media === "object") ? it.media : undefined,
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 20).map(x => s(x)).filter(Boolean) : undefined,
    lang: s(it.lang || "").trim() || undefined,
    payload: it.payload && typeof it.payload === "object" ? it.payload : it
  };
}
function normalizeEnginePayload(res, fallbackSource) {
  if (!res || typeof res !== "object") return [];

  if (Core && Core.aiAdapter && typeof Core.aiAdapter.normalizeAIResult === "function") {
    try {
      const aiNorm = Core.aiAdapter.normalizeAIResult(res);
      if (Array.isArray(aiNorm) && aiNorm.length && typeof aiNorm[0] === "object") {
        return aiNorm.map(it => normalizeItem(it, fallbackSource)).filter(Boolean);
      }
    } catch (e) {}
  }

  if (Array.isArray(res.items)) {
    return res.items.map(it => normalizeItem(it, fallbackSource)).filter(Boolean);
  }

  if (Array.isArray(res.results)) {
    const out = [];
    for (const r of res.results) {
      if (!r) continue;
      if (Array.isArray(r.items)) {
        for (const it of r.items) {
          const x = normalizeItem({ ...it, source: it?.source || r.source || fallbackSource }, fallbackSource);
          if (x) out.push(x);
        }
        continue;
      }
      const data = Array.isArray(r.data) ? r.data : [r.data];
      for (const it of data) {
        const x = normalizeItem({
          ...it,
          source: r.source || it?.source || fallbackSource,
          sourceTrust: r.sourceTrust ?? it?.sourceTrust,
          timestamp: r.timestamp || it?.timestamp
        }, fallbackSource);
        if (x) out.push(x);
      }
    }
    return out;
  }

  if (res.data && Array.isArray(res.data.items)) {
    return res.data.items.map(it => normalizeItem(it, fallbackSource)).filter(Boolean);
  }

  if (Array.isArray(res.data)) {
    return res.data.map(it => normalizeItem(it, fallbackSource)).filter(Boolean);
  }

  if (res.item && typeof res.item === "object") {
    const single = normalizeItem(res.item, fallbackSource);
    return single ? [single] : [];
  }

  return [];
}

/* ===== RESILIENCE ===== */
function makeResilienceEngine() {
  if (!Resilience || typeof Resilience.ResilienceEngine !== "function") return null;
  try {
    return new Resilience.ResilienceEngine();
  } catch (e) {
    return null;
  }
}
const resilience = makeResilienceEngine();
async function resilientCall(name, fn) {
  let lastError = null;
  if (circuitOpen(name)) throw new Error(name + "_circuit_open");
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      const result = await withTimeout(fn(), ENGINE_TIMEOUT);
      circuitSuccess(name);
      return result;
    } catch (e) {
      lastError = e;
      circuitFail(name);
    }
  }
  throw lastError || new Error(name + "_failed");
}

/* ===== OPTIONAL HELPER INTEGRATIONS ===== */
async function collectorHook(payload) {
  if (!Collector) return null;
  const params = payload?.params || {};
  const event = payload?.event || {};

  if (typeof Collector.collect === "function") {
    return await Collector.collect({ event, ...params });
  }
  if (typeof Collector.runEngine === "function") {
    return await Collector.runEngine(event, { action: "collect", ...params });
  }
  if (typeof Collector.handler === "function") {
    return await Collector.handler({ ...event, queryStringParameters: { ...params, action: "collect" } });
  }
  return null;
}
async function globalInsightHook(items, payload) {
  if (!GlobalInsight) return null;
  if (typeof GlobalInsight.analyze === "function") {
    return await GlobalInsight.analyze({ items, payload });
  }
  if (typeof GlobalInsight.runEngine === "function") {
    return await GlobalInsight.runEngine(payload?.event || {}, {
      action: "analyze",
      q: payload?.params?.q,
      query: payload?.params?.q,
      items
    });
  }
  return null;
}

/* ===== ENGINE REGISTRATION ===== */
function engineSearchAdapter(name, engine) {
  if (!engine) return null;
  if (typeof engine.search === "function") {
    return {
      name,
      search: async function(payload) {
        return await engine.search(payload);
      }
    };
  }
  if (name === "planetary" && typeof engine.connect === "function") {
    return {
      name,
      search: async function(payload) {
        return await engine.connect(payload?.event || {}, payload?.params || {});
      }
    };
  }
  if (name === "bank" && typeof engine.runEngine === "function") {
    return {
      name,
      search: async function(payload) {
        return await engine.runEngine(payload?.event || {}, payload?.params || {});
      }
    };
  }
  if (name === "collector") {
    return {
      name,
      search: async function(payload) {
        return await collectorHook(payload);
      }
    };
  }
  if (name === "globalInsight") {
    return {
      name,
      search: async function(payload) {
        return await globalInsightHook([], payload);
      }
    };
  }
  return null;
}
function ensureCoreRegistry() {
  if (!Core || !Core.engineRegistry || typeof Core.engineRegistry.register !== "function") return;

  const adapters = [
    engineSearchAdapter("planetary", Planetary),
    engineSearchAdapter("bank", Bank),
    engineSearchAdapter("collector", Collector)
  ].filter(Boolean);

  for (const adapter of adapters) {
    Core.engineRegistry.register(adapter.name, adapter);
  }
}

/* ===== INTENT / ROUTING ===== */
function classifyIntent(q) {
  const t = low(q);
  if (/video|watch|clip|media|stream/.test(t)) return "media";
  if (/price|buy|product|shop|market/.test(t)) return "commerce";
  if (/news|headline|breaking|current/.test(t)) return "news";
  if (/science|research|paper|study|nasa|space/.test(t)) return "science";
  if (/city|country|region|map|local|geo/.test(t)) return "geo";
  if (/why|how|meaning|analysis|trend|forecast/.test(t)) return "analysis";
  return "general";
}
function semanticSignals(q) {
  const t = low(q);
  const out = [];
  if (t.includes("video") || t.includes("media")) out.push("media");
  if (t.includes("news")) out.push("news");
  if (t.includes("science") || t.includes("research")) out.push("science");
  if (t.includes("local") || t.includes("region")) out.push("geo");
  if (t.includes("analysis") || t.includes("forecast")) out.push("analysis");
  return out;
}
function sourcePlan(params) {
  const intent = classifyIntent(params.q);
  const signals = semanticSignals(params.q);
  const engines = ["planetary", "bank"];

  if (intent === "news" || intent === "analysis" || intent === "science") {
    engines.unshift("collector");
  }

  return { intent, signals, engines };
}

/* ===== FETCH ===== */
async function fetchViaCore(event, params, plan) {
  ensureCoreRegistry();

  const cacheKey = "core:" + JSON.stringify([
    params.q,
    params.limit,
    params.region,
    params.mode,
    params.intent,
    params.scope,
    params.target,
    params.lang,
    plan.engines
  ]);

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const reqId = requestId();
  const payload = {
    requestId: reqId,
    event,
    params: {
      q: params.q,
      query: params.q,
      limit: params.limit,
      region: params.region,
      mode: params.mode,
      intent: params.intent,
      scope: params.scope,
      target: params.target,
      lang: params.lang
    }
  };

  if (Core && Core.engineBus && typeof Core.engineBus.emit === "function") {
    try { await Core.engineBus.emit("search:start", payload); } catch (e) {}
  }

  const grouped = {};
  let flatItems = [];
  let usedCoreFederation = false;

  if (Core && Core.federation && typeof Core.federation.route === "function" && Core.engineRegistry) {
    usedCoreFederation = true;

    const tasks = plan.engines.map(async (name) => {
      try {
        const adapter = Core.engineRegistry.get(name);
        if (!adapter || typeof adapter.search !== "function") {
          return { name, status: "fail", items: [], raw: null, error: "ENGINE_UNAVAILABLE" };
        }
        const raw = await resilientCall(name, async () => {
          return await adapter.search(payload);
        });
        const items = normalizeEnginePayload(raw, name).slice(0, MAX_RESULTS_PER_ENGINE);
        return { name, status: "ok", items, raw, error: null };
      } catch (e) {
        return { name, status: "fail", items: [], raw: null, error: s(e && e.message ? e.message : e) };
      }
    });

    const settled = await Promise.all(tasks);
    for (const row of settled) {
      grouped[row.name] = row;
      flatItems = flatItems.concat(row.items || []);
    }
  }

  if (!usedCoreFederation) {
    const fallbackTasks = [];

    if (Collector) {
      fallbackTasks.push(
        resilientCall("collector", async () => await collectorHook(payload))
          .then(raw => ({ name: "collector", status: "ok", items: normalizeEnginePayload(raw, "collector"), raw, error: null }))
          .catch(e => ({ name: "collector", status: "fail", items: [], raw: null, error: s(e && e.message ? e.message : e) }))
      );
    }
    if (Planetary && typeof Planetary.connect === "function") {
      fallbackTasks.push(
        resilientCall("planetary", async () => await Planetary.connect(event || {}, payload.params))
          .then(raw => ({ name: "planetary", status: "ok", items: normalizeEnginePayload(raw, "planetary"), raw, error: null }))
          .catch(e => ({ name: "planetary", status: "fail", items: [], raw: null, error: s(e && e.message ? e.message : e) }))
      );
    }
    if (Bank && typeof Bank.runEngine === "function") {
      fallbackTasks.push(
        resilientCall("bank", async () => await Bank.runEngine(event || {}, payload.params))
          .then(raw => ({ name: "bank", status: "ok", items: normalizeEnginePayload(raw, "bank"), raw, error: null }))
          .catch(e => ({ name: "bank", status: "fail", items: [], raw: null, error: s(e && e.message ? e.message : e) }))
      );
    }

    const settled = await Promise.all(fallbackTasks);
    for (const row of settled) {
      grouped[row.name] = row;
      flatItems = flatItems.concat(row.items || []);
    }
  }

  if (flatItems.length && GlobalInsight) {
    try {
      const insightRaw = await globalInsightHook(flatItems, payload);
      grouped.globalInsight = {
        name: "globalInsight",
        status: "ok",
        items: normalizeEnginePayload(insightRaw, "globalInsight"),
        raw: insightRaw,
        error: null
      };
    } catch (e) {
      grouped.globalInsight = {
        name: "globalInsight",
        status: "fail",
        items: [],
        raw: null,
        error: s(e && e.message ? e.message : e)
      };
    }
  }

  const out = { usedCoreFederation, grouped, items: flatItems };
 
 /* ===== SEARCH BANK STORE LOOP ===== */
try {

  if (Bank && typeof Bank.runEngine === "function" && flatItems.length) {

    await Bank.runEngine(event || {}, {
      action: "store",
      items: flatItems,
      source: "maru-search",
      timestamp: nowIso()
    });

  }

} catch (e) {
  console.warn("search-bank store failed:", e && e.message ? e.message : e);
}
  setCache(cacheKey, out);

  if (Core && Core.engineBus && typeof Core.engineBus.emit === "function") {
    try { await Core.engineBus.emit("search:end", { ...payload, resultCount: flatItems.length }); } catch (e) {}
  }

  return out;
}

/* ===== RANK ===== */
function truthConfidence(item) {
  if (Core && Core.trustLayer && typeof Core.trustLayer.trustScore === "function") {
    try { return Core.trustLayer.trustScore(item); } catch (e) {}
  }
  let score = 1;
  if (typeof item.sourceTrust === "number") score *= item.sourceTrust;
  if (typeof item.deepfakeRisk === "number") score *= (1 - item.deepfakeRisk);
  if (typeof item.manipulationRisk === "number") score *= (1 - item.manipulationRisk);
  return score;
}
function trustFilter(items) {
  return (items || []);
}
function knowledgeBoost(item, q) {
  if (!Knowledge) return 0;
  try {
    const title = low(item.title || "");
    const qq = low(q || "");
    if (title && qq && title.includes(qq)) return 0.08;
  } catch (e) {}
  return 0;
}
function computeScore(item, q, intent) {
  let score = typeof item.score === "number" ? item.score : 0.5;
  score *= truthConfidence(item);
  const title = low(item.title || "");
  const summary = low(item.summary || "");
  const query = low(q || "");
  if (query && title.includes(query)) score += 0.45;
  if (query && summary.includes(query)) score += 0.20;
  if (intent === "media" && (item.mediaType === "video" || item.media?.kind === "video")) score += 0.35;
  if (intent === "news" && /news|reuters|bbc|ap/.test(low(item.source))) score += 0.15;
  if (intent === "science" && /gov|edu|ac|nasa|arxiv/.test(low(item.source))) score += 0.18;
  if (intent === "geo" && /gov|map|city|region/.test(low(item.source))) score += 0.12;
  if (item.thumbnail) score += 0.05;
  if (item.imageSet && item.imageSet.length) score += 0.08;
  score += knowledgeBoost(item, q);
  return score;
}
function dedup(items) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const key = low(it.url || (it.title + "|" + it.source));
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
function rankItems(items, q, intent) {
  const merged = dedup(trustFilter(items)).map(it => ({
    ...it,
    qualityScore: computeScore(it, q, intent)
  }));
  merged.sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  return merged;
}

/* ===== META ===== */
function buildMeta(reqId, params, plan, fetched, ranked) {
  const planetaryRes = fetched.grouped.planetary || { status: "skip", items: [] };
  const bankRes = fetched.grouped.bank || { status: "skip", items: [] };
  const collectorRes = fetched.grouped.collector || { status: "skip", items: [] };
  const insightRes = fetched.grouped.globalInsight || { status: "skip", items: [] };

  return {
    request_id: reqId,
    updated: nowIso(),
    intent: plan.intent,
    signals: plan.signals,
    used_core_federation: fetched.usedCoreFederation,
    collector_ok: collectorRes.status === "ok",
    planetary_ok: planetaryRes.status === "ok",
    bank_ok: bankRes.status === "ok",
    insight_ok: insightRes.status === "ok",
    collector_count: (collectorRes.items || []).length,
    planetary_count: (planetaryRes.items || []).length,
    bank_count: (bankRes.items || []).length,
    insight_count: (insightRes.items || []).length,
    ranked_count: ranked.length,
    retry_policy: MAX_RETRY,
    defense_first: true,
    circuits: {
      collector: { ...CIRCUIT.collector },
      planetary: { ...CIRCUIT.planetary },
      bank: { ...CIRCUIT.bank },
      globalInsight: { ...CIRCUIT.globalInsight }
    }
  };
}

/* ===== MAIN ENGINE ===== */
async function runEngine(event, params = {}) {
  const nowTime = Date.now();
  if (global.__MARU_LAST_CALL && (nowTime - global.__MARU_LAST_CALL) < 150) {
  return { status:"rate_limited", engine:"maru-search" };
}
global.__MARU_LAST_CALL = nowTime;
  const p = parseParams(params);
  const reqId = requestId();

  if (!p.q) {
    return {
      status: "ok",
      engine: "maru-search",
      version: VERSION,
      items: [],
      results: []
    };
  }

  if (detectPromptInjection(p.q)) {
    return {
      status: "ok",
      engine: "maru-search",
      version: VERSION,
      query: p.q,
      items: [],
      results: [],
      meta: {
        defense_first: true,
        protected: true,
        reason: "prompt_injection_guard"
      }
    };
  }

  const plan = sourcePlan(p);
  const fetched = await fetchViaCore(event || {}, p, plan);

  if (!fetched.items.length) {
    return {
      status: "ok",
      engine: "maru-search",
      version: VERSION,
      query: p.q,
      mode: p.mode,
      items: [],
      results: [],
      meta: buildMeta(reqId, p, plan, fetched, []),
      data: {
        collector: fetched.grouped.collector?.raw || null,
        planetary: fetched.grouped.planetary?.raw || null,
        bank: fetched.grouped.bank?.raw || null,
        globalInsight: fetched.grouped.globalInsight?.raw || null
      }
    };
  }

  const ranked = rankItems(fetched.items, p.q, plan.intent).slice(0, p.limit);

  return {
    status: "ok",
    engine: "maru-search",
    version: VERSION,
    query: p.q,
    mode: p.mode,
    items: ranked,
    results: ranked,
    meta: buildMeta(reqId, p, plan, fetched, ranked),
    data: {
      collector: fetched.grouped.collector?.raw || null,
      planetary: fetched.grouped.planetary?.raw || null,
      bank: fetched.grouped.bank?.raw || null,
      globalInsight: fetched.grouped.globalInsight?.raw || null
    }
  };
}

/* ===== SEARCH BRIDGE COMPATIBILITY ===== */
async function maruSearchDispatcher(payload = {}) {
  const query = s(payload.q || payload.query || "").trim();
  if (!query) return { ok: false, error: "INVALID_PAYLOAD" };

  const event = {
    queryStringParameters: {
      q: query,
      limit: payload.limit,
      mode: payload.mode,
      region: payload.context?.region,
      intent: payload.context?.intent,
      scope: payload.context?.scope,
      target: payload.context?.target,
      lang: payload.context?.lang,
      debug: payload.context?.debug ? "1" : "0"
    },
    headers: payload.headers || {}
  };

  return await runEngine(event, event.queryStringParameters || {});
}

/* ===== NETLIFY HANDLER ===== */
exports.runEngine = runEngine;
exports.maruSearchDispatcher = maruSearchDispatcher;
exports.handler = async function(event) {
  try {
    const params = event?.queryStringParameters || {};
    const res = await runEngine(event || {}, params);
    const origin = process.env.ALLOWED_ORIGIN || "https://igdcglobal.com";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(res)
    };
  } catch (e) {
    const origin = process.env.ALLOWED_ORIGIN || "https://igdcglobal.com";
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        status: "ok",
        engine: "maru-search",
        version: VERSION,
        items: [],
        results: [],
        meta: {
          protected: true,
          reason: s(e && e.message ? e.message : e)
        }
      })
    };
  }
};