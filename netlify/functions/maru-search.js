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

try { Core = require("./core"); } catch (e) {}
try { Planetary = require("./planetary-data-connector"); } catch (e) {}
try { Bank = require("./search-bank-engine"); } catch (e) {}
try { Collector = require("./collector"); } catch (e) {}
try { GlobalInsight = require("./maru-global-insight-engine"); } catch (e) {}
try { Resilience = require("./maru-resilience-engine"); } catch (e) {}
try { Knowledge = require("./maru-knowledge-graph-engine"); } catch (e) {}

const fs = require("fs");
const path = require("path");
const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

function safeTextLocal(v, maxLen) {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function safeUrlLocal(v) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return "";
  if (t.startsWith("/") || t.startsWith("./") || t.startsWith("../")) return t;
  try {
    const u = new URL(t);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch (e) {}
  return "";
}

function uniqueStringsLocal(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = safeTextLocal(String(v), 40);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeSnapshotItem(it, fallbackSource) {
  const o = it || {};
  return normalizeItem({
    id: o.id ? String(o.id) : null,
    title: safeTextLocal(o.title || o.name || "", 120),
    summary: safeTextLocal(o.summary || o.description || "", 240),
    url: safeUrlLocal(o.url || o.link || ""),
    thumb: safeUrlLocal(o.thumb || o.thumbnail || ""),
    type: safeTextLocal(o.type || o.mediaType || "web", 40),
    platform: safeTextLocal(o.platform || "", 40),
    license: safeTextLocal(o.license || "", 40),
    tags: uniqueStringsLocal(o.tags),
    lang: safeTextLocal(o.lang || "all", 8) || "all",
    active: o.active !== false,
    score: Number.isFinite(o.score) ? o.score : 0.35,
    source: o.source || fallbackSource || "local-snapshot",
    timestamp: o.timestamp || now(),
    sectionId: o.sectionId || o.section || ""
  }, fallbackSource || "local-snapshot");
}

function loadLocalSnapshotItems(lang) {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const out = [];

    if (Array.isArray(parsed.items)) {
      for (const it of parsed.items) {
        const row = normalizeSnapshotItem(it, "local-snapshot");
        if (row) out.push(row);
      }
    }

    if (Array.isArray(parsed.sections)) {
      for (const sec of parsed.sections) {
        const sid = String((sec && (sec.id || sec.sectionId)) || "").trim();
        const arr = Array.isArray(sec?.items) ? sec.items : (Array.isArray(sec?.cards) ? sec.cards : []);
        for (const it of arr) {
          const row = normalizeSnapshotItem(
            { ...(it || {}), sectionId: (it && it.sectionId) || sid || "" },
            "local-snapshot"
          );
          if (row) out.push(row);
        }
      }
    }

    let items = out.filter(it => it && it.active !== false);

    if (lang && lang !== "all") {
      items = items.filter(it => !it.lang || it.lang === "all" || it.lang === lang);
    }

    return items;
  } catch (e) {
    return [];
  }
}

function scoreLocalSnapshotItem(item, q) {
  const query = low(q || "");
  if (!query) return 0;

  let score = 0;
  const title = low(item.title || "");
  const summary = low(item.summary || "");

  if (title.includes(query)) score += 6;
  if (summary.includes(query)) score += 3;

  if (Array.isArray(item.tags)) {
    for (const tag of item.tags) {
      const tt = low(tag);
      if (tt.includes(query)) score += 2;
    }
  }

  return score;
}

function findLocalSnapshotSeed(q, lang, limit) {
  const pool = loadLocalSnapshotItems(lang);
  if (!q) return [];

  return pool
    .map(it => ({
      ...it,
      score: Math.max(typeof it.score === "number" ? it.score : 0.35, scoreLocalSnapshotItem(it, q) / 10)
    }))
    .filter(it => scoreLocalSnapshotItem(it, q) > 0)
    .sort((a, b) => {
      const as = scoreLocalSnapshotItem(a, q);
      const bs = scoreLocalSnapshotItem(b, q);
      if (bs !== as) return bs - as;
      return timeValue(b.timestamp) - timeValue(a.timestamp);
    })
    .slice(0, limit || DEFAULT_LIMIT);
}

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
function timeValue(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof ts === "string") {
    const n = Date.parse(ts);
    if (Number.isFinite(n)) return n;
    const asNum = Number(ts);
    if (Number.isFinite(asNum)) return asNum;
  }
  return 0;
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
  if (!it) return null;

  if (typeof it !== "object") {
    it = {
      title: s(it),
      summary: s(it),
      url: "#",
      source: fallbackSource || "unknown"
    };
  }

  const url = s(it.url || it.link || it.href || "#").trim();
  const title = s(it.title || it.name || it.label || "no-title").trim();
  const summary = s(it.summary || it.description || it.snippet || "").trim();

  const deepfakeRisk = typeof it.deepfakeRisk === "number" ? it.deepfakeRisk : 0;
  const manipulationRisk = typeof it.manipulationRisk === "number" ? it.manipulationRisk : 0;

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

    deepfakeRisk,
    manipulationRisk,

    riskLabel:
      (deepfakeRisk > 0.8 || manipulationRisk > 0.8)
        ? "⚠️ high-risk"
        : (deepfakeRisk > 0.4 || manipulationRisk > 0.4)
          ? "⚠️ medium-risk"
          : "safe",

    active: it.active !== false,
    timestamp: it.timestamp || now(),
    thumbnail: s(it.thumbnail || it.thumb || "").trim(),
    imageSet: Array.isArray(it.imageSet) ? it.imageSet.slice(0, 8) : undefined,
    media: (it.media && typeof it.media === "object") ? it.media : undefined,
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 20).map(x => s(x)).filter(Boolean) : undefined,
    lang: s(it.lang || "").trim() || undefined,
    sectionId: s(it.sectionId || it.section || "").trim() || undefined,
    payload: it.payload && typeof it.payload === "object" ? it.payload : it
  };
}

function normalizeEnginePayload(res, fallbackSource) {
  if (!res) return [];

  let arr = [];

  if (Array.isArray(res)) arr = res;
  else if (Array.isArray(res.items)) arr = res.items;
  else if (Array.isArray(res.results)) arr = res.results;
  else if (Array.isArray(res.data)) arr = res.data;
  else if (res.data && Array.isArray(res.data.items)) arr = res.data.items;
  else if (Array.isArray(res.list)) arr = res.list;
  else if (res.item && typeof res.item === "object") arr = [res.item];
  else if (typeof res === "object") arr = [res];

  return arr
    .map(it => normalizeItem(it, fallbackSource))
    .filter(Boolean);
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
    engineSearchAdapter("collector", Collector),
    engineSearchAdapter("globalInsight", GlobalInsight)
  ].filter(Boolean);

  for (const adapter of adapters) {
    if (adapter && adapter.name && adapter.search) {
      Core.engineRegistry.register(adapter.name, adapter);
    }
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
  const engines = ["planetary"];

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

    let raw = null;

    // 1️⃣ Collector 직접 실행
    if (name === "collector" && Collector) {
      raw = (typeof Collector.collect === "function")
        ? await Collector.collect({ event: payload.event || {}, ...(payload.params || {}) })
        : (typeof Collector.runEngine === "function")
          ? await Collector.runEngine(payload.event || {}, { action: "collect", ...(payload.params || {}) })
          : null;
    }

    // 2️⃣ Planetary 직접 실행
    else if (name === "planetary" && Planetary) {
      raw = (typeof Planetary.connect === "function")
        ? await Planetary.connect(payload.event || {}, payload.params || {})
        : (typeof Planetary.search === "function")
          ? await Planetary.search(payload)
          : null;
    }

    // 3️⃣ fallback (core adapter)
    if (!raw) {
      raw = await resilientCall(name, async () => {
        return await adapter.search(payload);
      });
    }

    const items = normalizeEnginePayload(raw, name).slice(0, MAX_RESULTS_PER_ENGINE);

    return { name, status: "ok", items, raw, error: null };

  } catch (e) {
    return {
      name,
      status: "fail",
      items: [],
      raw: null,
      error: String(e && e.message ? e.message : e)
    };
  }
});


    const settled = await Promise.all(tasks);
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
    return timeValue(b.timestamp) - timeValue(a.timestamp);
  });
  return merged;
}

/* ===== META ===== */
function buildMeta(reqId, params, plan, fetched, ranked, bankSeed) {
  const planetaryRes = fetched.grouped.planetary || { status: "skip", items: [] };
  const collectorRes = fetched.grouped.collector || { status: "skip", items: [] };
  const insightRes = fetched.grouped.globalInsight || { status: "skip", items: [] };

  const bankSeedItems = Array.isArray(bankSeed) ? bankSeed : [];
  const bankEngineReady = !!(Bank && typeof Bank.runEngine === "function");
  const fetchedBankRes = fetched.grouped.bank || null;

  const bankRes = fetchedBankRes || {
    status: bankEngineReady ? "ready" : "skip",
    items: bankSeedItems
  };

  return {
    request_id: reqId,
    updated: nowIso(),
    intent: plan.intent,
    signals: plan.signals,
    used_core_federation: fetched.usedCoreFederation,
    collector_ok: collectorRes.status === "ok",
    planetary_ok: planetaryRes.status === "ok",
    bank_ok: bankEngineReady,
    bank_status: bankRes.status,
    insight_ok: insightRes.status === "ok",
    collector_count: (collectorRes.items || []).length,
    planetary_count: (planetaryRes.items || []).length,
    bank_count: Math.max((bankRes.items || []).length, bankSeedItems.length),
    bank_seed_count: bankSeedItems.length,
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

/* ===== LOCAL SNAPSHOT PREFILL CHECK ===== */
let localSnapshotSeed = [];

try {
  localSnapshotSeed = findLocalSnapshotSeed(p.q, p.lang || "all", p.limit);
} catch (e) {
  localSnapshotSeed = [];
}

/* ===== SEARCH BANK PREFILL CHECK ===== */
let bankSeed = [];

try {
  if (Bank && typeof Bank.runEngine === "function") {
    const bankRes = await Bank.runEngine(event || {}, {
      action: "search",
      q: p.q,
      limit: p.limit
    });

    if (bankRes && Array.isArray(bankRes.items)) {
      bankSeed = bankRes.items;
    }
  }
} catch (e) {}

/* ===== CORE FETCH ===== */
const fetched = await fetchViaCore(event || {}, p, plan);

/* ===== LOCAL SNAPSHOT MERGE ===== */
if (localSnapshotSeed.length) {
  fetched.items = [...localSnapshotSeed, ...(fetched.items || [])];
}
let forcedItems = [];

if (!fetched.items || !fetched.items.length) {
  try {
    const https = require("https");
    const q = encodeURIComponent(p.q);

    const html = await new Promise((resolve, reject) => {
      https.get(`https://html.duckduckgo.com/html/?q=${q}`, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve(data));
      }).on("error", reject);
    });

    const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g)];

    forcedItems = matches
      .slice(0, 20)
      .map(m => normalizeItem({
        title: m[2].replace(/<[^>]+>/g, "").trim(),
        summary: "",
        url: m[1],
        source: "forced-duckduckgo",
        mediaType: "web",
        score: 0.8,
        sourceTrust: 0.6,
        active: true,
        timestamp: now()
      }, "forced-duckduckgo"))
      .filter(Boolean)
      .filter(it => it.url);

  } catch (e) {
    console.warn("forced search failed:", e && e.message ? e.message : e);
  }
}

/* ===== DIRECT FETCH FALLBACK (CRITICAL) ===== */
let directItems = [];

if (!fetched.items || fetched.items.length < p.limit) {
  try {
    const https = require("https");
    const q = encodeURIComponent(p.q);

    const data = await new Promise((resolve, reject) => {
      https.get(`https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1&no_html=1`, (res) => {
        let body = "";

        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }).on("error", reject);
    });

    if (data && data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      directItems = data.RelatedTopics
        .flatMap(t => t.Topics || [t])
        .map(it => normalizeItem({
          title: it.Text || "",
          summary: it.Text || "",
          url: it.FirstURL || "",
          source: "direct-duckduckgo",
          mediaType: "web",
          score: 0.6,
          sourceTrust: 0.6,
          active: true,
          timestamp: now()
        }, "direct-duckduckgo"))
        .filter(Boolean)
        .filter(it => it.url);
    }

  } catch (e) {
    console.warn("direct fetch failed:", e && e.message ? e.message : e);
  }
}

/* ===== DIRECT MERGE ===== */
if (directItems.length) {
  fetched.items = [...directItems, ...(fetched.items || [])];
}

/* ===== BANK AUTO FILL LOGIC (LIMIT BASED) ===== */
const REQUIRED_COUNT = p.limit || 20;

const bankKeys = new Set(
  bankSeed.map(it => (it.url || (it.title + "|" + it.source) || "").toLowerCase())
);

const externalItems = fetched.items || [];

const combinedCount = new Set([
  ...bankSeed.map(it => (it.url || (it.title + "|" + it.source) || "").toLowerCase()).filter(Boolean),
  ...externalItems.map(it => (it.url || (it.title + "|" + it.source) || "").toLowerCase()).filter(Boolean)
]).size;

const needFill = combinedCount < REQUIRED_COUNT;

if (needFill && externalItems.length) {
  const newItems = externalItems.filter(it => {
    const key = (it.url || (it.title + "|" + it.source) || "").toLowerCase();
    if (!key || bankKeys.has(key)) return false;
    return true;
  });

  if (newItems.length && Bank && typeof Bank.runEngine === "function") {
    try {
      await Bank.runEngine(event || {}, {
        action: "store",
        items: newItems.slice(0, REQUIRED_COUNT - combinedCount),
        source: "maru-search-autofill",
        region: p.region || "global",
        lang: p.lang || "auto",
        intent: plan.intent,
        timestamp: nowIso()
      });
    } catch (e) {
      console.warn("bank autofill failed:", e && e.message ? e.message : e);
    }
  }
}

/* ===== MERGE BANK SEED ===== */
if (bankSeed.length) {
  fetched.items = [...bankSeed, ...fetched.items];
}

  /* ===== DEDUP + PRIORITY ===== */
let mergedItems = fetched.items || [];
mergedItems = [...mergedItems, ...forcedItems];

/* 1차 중복 제거 */
const seen = new Set();
mergedItems = mergedItems.filter(it => {
  const key = (it.url || (it.title + "|" + it.source) || "").toLowerCase();
  if (!key) return false;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

/* 2차: Bank 우선 (앞쪽 유지) */
if (bankSeed.length) {
  const bankKeys = new Set(
    bankSeed.map(it => (it.url || (it.title + "|" + it.source) || "").toLowerCase())
  );

  mergedItems = [
    ...mergedItems.filter(it => bankKeys.has((it.url || (it.title + "|" + it.source) || "").toLowerCase())),
    ...mergedItems.filter(it => !bankKeys.has((it.url || (it.title + "|" + it.source) || "").toLowerCase()))
  ];
}

/* 최종 랭킹 */
const ranked = rankItems(mergedItems, p.q, plan.intent).slice(0, p.limit);

   return {
    status: "ok",
    engine: "maru-search",
    version: VERSION,
    query: p.q,
    mode: p.mode,
    items: ranked,
    results: ranked,
    meta: buildMeta(reqId, p, plan, fetched, ranked, bankSeed),
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