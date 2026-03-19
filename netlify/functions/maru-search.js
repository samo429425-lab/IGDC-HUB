"use strict";

/**
 * MARU Search — Full Integrated Production Engine
 * ------------------------------------------------------------------
 * Re-designed from:
 *  - legacy maru-search.js  (direct snapshot/recommend/search core)
 *  - maru-search-Q.js       (multi-engine orchestration / ranking / guards)
 *
 * Architecture
 *   External triad : Collector / Direct / Planetary
 *   Internal triad : SearchBank / GlobalInsight / (SearchJS consumer)
 *   MARU Search    : the producer + orchestrator
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

let Core = null;
let Planetary = null;
let Bank = null;
let Collector = null;
let GlobalInsight = null;
let Resilience = null;
let Knowledge = null;

try { Core = require("./core"); } catch (_) {}
try { Planetary = require("./planetary-data-connector"); } catch (_) {}
try { Bank = require("./search-bank-engine"); } catch (_) {}
try { Collector = require("./collector"); } catch (_) {}
try { GlobalInsight = require("./maru-global-insight-engine"); } catch (_) {}
try { Resilience = require("./maru-resilience-engine"); } catch (_) {}
try { Knowledge = require("./maru-knowledge-graph-engine"); } catch (_) {}

const VERSION = "maru-search-v401-full-integrated";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;
const MAX_QUERY_LENGTH = 260;
const ENGINE_TIMEOUT = 9000;
const MAX_RETRY = 4;
const CACHE_TTL = 45 * 1000;
const MAX_RESULTS_PER_ENGINE = 250;
const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");
const SEARCH_BANK_TARGETS = [
  path.join(process.cwd(), "data", "search-bank.snapshot.json"),
  path.join(process.cwd(), "netlify", "functions", "data", "search-bank.snapshot.json"),
  path.join(__dirname, "data", "search-bank.snapshot.json"),
  path.join(__dirname, "search-bank.snapshot.json")
];

const CACHE = new Map();
const CIRCUIT = {
  collector: { failures: 0, lastFail: 0 },
  planetary: { failures: 0, lastFail: 0 },
  bank: { failures: 0, lastFail: 0 },
  globalInsight: { failures: 0, lastFail: 0 },
  direct: { failures: 0, lastFail: 0 }
};
const CIRCUIT_THRESHOLD = 10;
const CIRCUIT_COOLDOWN = 30 * 1000;

function s(x) { return String(x == null ? "" : x); }
function low(x) { return s(x).trim().toLowerCase(); }
function now() { return Date.now(); }
function nowIso() { return (Core && typeof Core.nowIso === "function") ? Core.nowIso() : new Date().toISOString(); }
function requestId() { return (Core && typeof Core.requestId === "function") ? Core.requestId() : crypto.randomBytes(12).toString("hex"); }
function safeInt(v, d, min, max) {
  if (Core && typeof Core.safeInt === "function") return Core.safeInt(v, d, min, max);
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function stableHash(v) { return crypto.createHash("sha1").update(String(v || "")).digest("hex").slice(0, 16); }
function safeText(v, maxLen) {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  return maxLen ? t.slice(0, maxLen) : t;
}
function safeUrl(u) {
  if (typeof u !== "string") return "";
  const t = u.trim();
  if (!t) return "";
  const l = t.toLowerCase();
  if (l.startsWith("javascript:") || l.startsWith("data:")) return "";
  if (t.startsWith("/") || t.startsWith("./") || t.startsWith("../")) return t;
  try {
    const url = new URL(t);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch (_) {}
  return "";
}
function uniqueStrings(arr, max = 20) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const text = safeText(String(v || ""), 60);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}
function safeJsonParse(text, fallback = null) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}
function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store"
  };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
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
  return [
    "ignore previous instruction",
    "ignore previous instructions",
    "system prompt",
    "developer message",
    "override rules",
    "<script",
    "process.env",
    "drop table",
    "rm -rf"
  ].some(p => t.includes(p));
}
function validateQuery(q) {
  if (Core && typeof Core.validateQuery === "function") {
    const v = Core.validateQuery(q);
    if (v && typeof v === "object") return v;
  }
  const qq = sanitize(q);
  return qq ? { ok: true, value: qq } : { ok: false, code: "BAD_QUERY", value: "" };
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
async function resilientCall(name, fn) {
  if (circuitOpen(name)) throw new Error(name + "_circuit_open");
  let lastError = null;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      const res = await withTimeout(fn(), ENGINE_TIMEOUT);
      circuitSuccess(name);
      return res;
    } catch (e) {
      lastError = e;
      circuitFail(name);
      if (i < MAX_RETRY - 1) await sleep(120 * (i + 1));
    }
  }
  throw lastError || new Error(name + "_failed");
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}

function flattenSnapshotSections(snapshot) {
  try {
    if (!snapshot || !Array.isArray(snapshot.sections)) return [];
    const out = [];
    for (const sec of snapshot.sections) {
      const sid = s(sec && (sec.id || sec.sectionId) || "").trim();
      const arr = Array.isArray(sec && sec.items) ? sec.items : (Array.isArray(sec && sec.cards) ? sec.cards : []);
      for (const it of arr) {
        if (!it) continue;
        const copy = { ...it };
        if (!copy.sectionId && sid) copy.sectionId = sid;
        out.push(copy);
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

function loadCoreSnapshot() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
    const parsed = safeJsonParse(raw, { items: [] });
    return parsed && typeof parsed === "object" ? parsed : { items: [] };
  } catch (_) {
    return { items: [] };
  }
}

function loadSearchBankSnapshot() {
  for (const p of SEARCH_BANK_TARGETS) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = safeJsonParse(raw, null);
      if (parsed && Array.isArray(parsed.items)) return parsed;
    } catch (_) {}
  }
  return { meta: { generated_at: nowIso(), source: "maru-search" }, items: [] };
}

function normalizeItem(raw, fallbackSource = "unknown") {
  if (!raw) return null;
  if (typeof raw !== "object") {
    raw = { title: s(raw), summary: s(raw), source: fallbackSource };
  }

  const url = safeUrl(raw.url || raw.link || raw.href || raw.FirstURL || "");
  const title = safeText(raw.title || raw.name || raw.label || raw.Text || "", 160);
  const summary = safeText(raw.summary || raw.description || raw.snippet || raw.abstract || raw.Text || "", 500);
  const source = safeText(raw.source || raw.provider || raw.platform || fallbackSource || domainOf(url), 80) || fallbackSource || "unknown";
  const thumb = safeUrl(raw.thumb || raw.thumbnail || raw.image || raw.poster || "");
  const tags = uniqueStrings(raw.tags || raw.keywords || []);
  const media = (raw.media && typeof raw.media === "object") ? raw.media : undefined;
  const imageSet = Array.isArray(raw.imageSet) ? raw.imageSet.map(safeUrl).filter(Boolean).slice(0, 8) : undefined;
  const type = safeText(raw.type || raw.mediaType || (media && (media.kind || media.type)) || "web", 40) || "web";

  const out = {
    id: raw.id ? s(raw.id) : (url ? stableHash(url) : stableHash(title + "|" + source)),
    title: title || "no-title",
    summary,
    url,
    source,
    mediaType: type,
    type,
    platform: safeText(raw.platform || "", 40),
    license: safeText(raw.license || "", 40),
    score: typeof raw.score === "number" ? raw.score : (typeof raw.qualityScore === "number" ? raw.qualityScore : 0.5),
    sourceTrust: typeof raw.sourceTrust === "number" ? raw.sourceTrust : 0.5,
    deepfakeRisk: typeof raw.deepfakeRisk === "number" ? raw.deepfakeRisk : 0,
    manipulationRisk: typeof raw.manipulationRisk === "number" ? raw.manipulationRisk : 0,
    riskLabel:
      ((raw.deepfakeRisk || 0) > 0.8 || (raw.manipulationRisk || 0) > 0.8) ? "⚠️ high-risk" :
      ((raw.deepfakeRisk || 0) > 0.4 || (raw.manipulationRisk || 0) > 0.4) ? "⚠️ medium-risk" : "safe",
    timestamp: raw.timestamp || Date.parse(raw.published_at || raw.publishedAt || raw.date || "") || now(),
    thumbnail: thumb,
    imageSet,
    media,
    tags: tags.length ? tags : undefined,
    lang: safeText(raw.lang || raw.language || "", 12) || undefined,
    sectionId: safeText(raw.sectionId || raw.section || "", 80) || undefined,
    channel: safeText(raw.channel || raw.section || raw.page || "", 80) || undefined,
    geo: raw.geo && typeof raw.geo === "object" ? raw.geo : undefined,
    producer: raw.producer && typeof raw.producer === "object" ? raw.producer : undefined,
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload : raw
  };

  return out;
}

function normalizeEnginePayload(res, fallbackSource) {
  if (!res) return [];
  let arr = [];
  if (Array.isArray(res)) arr = res;
  else if (Array.isArray(res.items)) arr = res.items;
  else if (Array.isArray(res.results)) arr = res.results;
  else if (Array.isArray(res.data)) arr = res.data;
  else if (res.data && Array.isArray(res.data.items)) arr = res.data.items;
  else if (res.baseResult && Array.isArray(res.baseResult.items)) arr = res.baseResult.items;
  else if (res.baseResult && res.baseResult.data && Array.isArray(res.baseResult.data.items)) arr = res.baseResult.data.items;
  else if (Array.isArray(res.list)) arr = res.list;
  else if (res.item && typeof res.item === "object") arr = [res.item];
  else if (typeof res === "object") arr = [res];
  return arr.map(it => normalizeItem(it, fallbackSource)).filter(Boolean);
}

function scoreLocalItem(item, query) {
  const q = low(query || "");
  if (!q) return 0;
  if (Core && typeof Core.scoreItem === "function") {
    try { return Core.scoreItem(q, item); } catch (_) {}
  }
  let score = 0;
  const title = low(item.title || "");
  const summary = low(item.summary || "");
  const tags = Array.isArray(item.tags) ? item.tags.join(" ").toLowerCase() : "";
  if (title.includes(q)) score += 6;
  if (summary.includes(q)) score += 3;
  if (tags.includes(q)) score += 2;
  return score;
}

function truthConfidence(item) {
  if (Core && Core.trustLayer && typeof Core.trustLayer.trustScore === "function") {
    try { return Core.trustLayer.trustScore(item); } catch (_) {}
  }
  let score = 1;
  if (typeof item.sourceTrust === "number") score *= item.sourceTrust;
  if (typeof item.deepfakeRisk === "number") score *= (1 - item.deepfakeRisk);
  if (typeof item.manipulationRisk === "number") score *= (1 - item.manipulationRisk);
  return score;
}

function knowledgeBoost(item, q) {
  if (!Knowledge) return 0;
  const title = low(item.title || "");
  const qq = low(q || "");
  if (qq && title.includes(qq)) return 0.08;
  return 0;
}

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
  const intent = classifyIntent(params.q || "");
  const signals = semanticSignals(params.q || "");
  const engines = ["collector", "planetary"];
  if (intent === "news" || intent === "analysis" || intent === "science") engines.unshift("collector");
  return { intent, signals, engines };
}

function parseParams(params = {}) {
  const rawQ = params.q || params.query || "";
  const v = validateQuery(rawQ);
  const q = v.ok ? sanitize(v.value) : sanitize(rawQ);
  return {
    q,
    query: q,
    domain: safeText(params.domain || "", 80) || null,
    limit: safeInt(params.limit, q ? DEFAULT_LIMIT : 12, 1, MAX_LIMIT),
    region: params.region || null,
    mode: safeText(params.mode || (q ? "search" : "recommend"), 20) || (q ? "search" : "recommend"),
    intent: params.intent || null,
    scope: params.scope || null,
    target: params.target || null,
    lang: safeText(params.lang || "", 12) || null,
    debug: String(params.debug || "0") === "1"
  };
}

async function httpGetText(url) {
  return await new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === "http:" ? http : https;
      const req = lib.get(u, { headers: { "user-agent": "MARU-Search/4.0", "cache-control": "no-store" } }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error("HTTP_" + res.statusCode));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", c => data += c);
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function directFetchApi(query, limit) {
  return await resilientCall("direct", async () => {
    const body = await httpGetText(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`);
    const data = safeJsonParse(body, {});
    const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
    return related
      .flatMap(t => Array.isArray(t.Topics) ? t.Topics : [t])
      .map(it => normalizeItem({
        title: it.Text || "",
        summary: it.Text || "",
        url: it.FirstURL || "",
        source: "direct-duckduckgo",
        score: 0.60,
        sourceTrust: 0.60,
        timestamp: now()
      }, "direct-duckduckgo"))
      .filter(Boolean)
      .filter(it => it.url)
      .slice(0, limit);
  });
}

async function directFetchHtml(query, limit) {
  return await resilientCall("direct", async () => {
    const html = await httpGetText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
    const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g)];
    return matches.slice(0, limit).map(m => normalizeItem({
      title: s(m[2]).replace(/<[^>]+>/g, "").trim(),
      summary: "",
      url: m[1],
      source: "forced-duckduckgo",
      score: 0.8,
      sourceTrust: 0.6,
      timestamp: now()
    }, "forced-duckduckgo")).filter(Boolean);
  });
}

async function invokeCollector(event, params) {
  if (!Collector) return null;
  return await resilientCall("collector", async () => {
    if (typeof Collector.collect === "function") return await Collector.collect({ event, ...params });
    if (typeof Collector.runEngine === "function") return await Collector.runEngine(event, { action: "collect", ...params });
    if (typeof Collector.handler === "function") {
      const wrapped = await Collector.handler({
        ...event,
        httpMethod: event.httpMethod || "GET",
        queryStringParameters: { ...(event.queryStringParameters || {}), action: "collect", ...params }
      });
      if (wrapped && typeof wrapped.body === "string") return safeJsonParse(wrapped.body, wrapped);
      return wrapped;
    }
    return null;
  });
}

async function invokePlanetary(event, params) {
  if (!Planetary) return null;
  return await resilientCall("planetary", async () => {
    if (typeof Planetary.connect === "function") return await Planetary.connect(event, params);
    if (typeof Planetary.runEngine === "function") return await Planetary.runEngine(event, params);
    if (typeof Planetary.handler === "function") {
      const wrapped = await Planetary.handler({
        ...event,
        httpMethod: event.httpMethod || "GET",
        queryStringParameters: { ...(event.queryStringParameters || {}), ...params }
      });
      if (wrapped && typeof wrapped.body === "string") return safeJsonParse(wrapped.body, wrapped);
      return wrapped;
    }
    if (typeof Planetary.search === "function") return await Planetary.search({ event, params });
    return null;
  });
}

async function invokeBankSearch(event, params) {
  if (!Bank || typeof Bank.runEngine !== "function") return null;
  return await resilientCall("bank", async () => await Bank.runEngine(event, params));
}

async function invokeGlobalInsight(event, params) {
  if (!GlobalInsight) return null;
  return await resilientCall("globalInsight", async () => {
    if (typeof GlobalInsight.runEngine === "function") {
      return await GlobalInsight.runEngine(event, {
        q: params.q,
        query: params.q,
        mode: params.mode,
        limit: Math.min(params.limit, 50),
        scope: params.scope,
        target: params.target,
        intent: params.intent
      });
    }
    if (typeof GlobalInsight.runGlobalInsight === "function") {
      return await GlobalInsight.runGlobalInsight({
        q: params.q,
        query: params.q,
        mode: params.mode,
        limit: Math.min(params.limit, 50),
        scope: params.scope,
        target: params.target,
        intent: params.intent
      }, event);
    }
    return null;
  });
}

function dedup(items) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    if (!it) continue;
    const key = low(it.url || (it.id || "") || (it.title + "|" + it.source));
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function computeScore(item, q, intent) {
  let score = typeof item.score === "number" ? item.score : 0.5;
  score *= truthConfidence(item);
  const title = low(item.title || "");
  const summary = low(item.summary || "");
  const query = low(q || "");
  if (query && title.includes(query)) score += 0.45;
  if (query && summary.includes(query)) score += 0.20;
  if (intent === "media" && (item.mediaType === "video" || (item.media && item.media.kind === "video"))) score += 0.35;
  if (intent === "news" && /news|reuters|bbc|ap/.test(low(item.source))) score += 0.15;
  if (intent === "science" && /gov|edu|ac|nasa|arxiv/.test(low(item.source))) score += 0.18;
  if (intent === "geo" && /gov|map|city|region/.test(low(item.source))) score += 0.12;
  if (item.thumbnail) score += 0.05;
  if (item.imageSet && item.imageSet.length) score += 0.08;
  score += knowledgeBoost(item, q);
  return score;
}

function rankItems(items, q, intent) {
  const ranked = dedup(items).map(it => ({ ...it, qualityScore: computeScore(it, q, intent) }));
  ranked.sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  return ranked;
}

function selectSnapshotRecommend(snapshot, domain, lang, limit) {
  let items = [];
  const baseItems = (Array.isArray(snapshot.items) ? snapshot.items : []).concat(flattenSnapshotSections(snapshot));
  let normalized = baseItems.map(it => normalizeItem(it, "snapshot")).filter(Boolean);
  if (lang && lang !== "all") {
    normalized = normalized.filter(i => !i.lang || i.lang === "all" || i.lang === lang);
  }
  if (!domain) return normalized.slice(0, limit);

  const d = low(domain);
  const variants = new Set([d, d.replace(/_/g, "-"), d.replace(/-/g, "_")]);
  if (snapshot && Array.isArray(snapshot.sections)) {
    for (const sec of snapshot.sections) {
      const sid = low(sec && (sec.id || sec.sectionId) || "");
      if (!sid || !variants.has(sid)) continue;
      const arr = Array.isArray(sec.items) ? sec.items : (Array.isArray(sec.cards) ? sec.cards : []);
      items = arr.map(it => normalizeItem(it, "snapshot")).filter(Boolean);
      break;
    }
  }
  if (!items.length) {
    items = normalized.filter(i =>
      (i.sectionId && variants.has(low(i.sectionId))) ||
      (i.type && variants.has(low(i.type))) ||
      (Array.isArray(i.tags) && i.tags.some(t => variants.has(low(t))))
    );
  }
  return items.slice(0, limit);
}

function selectLocalSearchItems(snapshot, q, lang, limit) {
  const baseItems = (Array.isArray(snapshot.items) ? snapshot.items : []).concat(flattenSnapshotSections(snapshot));
  let normalized = baseItems.map(it => normalizeItem(it, "snapshot")).filter(Boolean);
  if (lang && lang !== "all") {
    normalized = normalized.filter(i => !i.lang || i.lang === "all" || i.lang === lang);
  }
  return normalized
    .map(i => ({ ...i, score: scoreLocalItem(i, q) }))
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function mergeSearchBankSnapshot(bankSnapshot, newItems) {
  const existing = Array.isArray(bankSnapshot.items) ? bankSnapshot.items : [];
  const byKey = new Map();
  for (const it of existing) {
    const n = normalizeItem(it, "search-bank");
    if (!n) continue;
    const key = low(n.url || (n.title + "|" + n.source));
    if (!key) continue;
    byKey.set(key, n);
  }
  for (const it of newItems || []) {
    const n = normalizeItem(it, "maru-search");
    if (!n) continue;
    const key = low(n.url || (n.title + "|" + n.source));
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      ...n,
      source: n.source || "maru-search",
      ingested_at: nowIso()
    });
  }
  const merged = Array.from(byKey.values()).slice(-50000);
  return {
    meta: {
      ...(bankSnapshot.meta || {}),
      generated_at: nowIso(),
      source: "maru-search"
    },
    items: merged
  };
}

function writeSearchBankSnapshots(snapshot) {
  for (const target of SEARCH_BANK_TARGETS) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), "utf8");
    } catch (_) {}
  }
}

function pushExtensionPipeline(items) {
  if (!global.SearchBankExtensionCore || typeof global.SearchBankExtensionCore.pipeline !== "function") return;
  for (const it of items || []) {
    try { global.SearchBankExtensionCore.pipeline(it); } catch (_) {}
  }
}

async function syncSearchBank(items) {
  if (!items || !items.length) return;
  const bankSnapshot = loadSearchBankSnapshot();
  const merged = mergeSearchBankSnapshot(bankSnapshot, items);
  writeSearchBankSnapshots(merged);
  pushExtensionPipeline(items);
}

async function fetchFromIntegratedSources(event, p, plan) {
  const cacheKey = "integrated:" + JSON.stringify([p.q, p.limit, p.region, p.mode, p.scope, p.target, p.lang, plan.intent, plan.signals]);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const grouped = {};
  let items = [];

  const tasks = [];
  tasks.push((async () => {
    try {
      const res = await invokeCollector(event, {
        q: p.q,
        query: p.q,
        limit: Math.min(p.limit, MAX_RESULTS_PER_ENGINE),
        region: p.region,
        mode: p.mode,
        intent: plan.intent,
        scope: p.scope,
        target: p.target,
        lang: p.lang
      });
      const norm = normalizeEnginePayload(res, "collector").slice(0, MAX_RESULTS_PER_ENGINE);
      grouped.collector = { status: "ok", raw: res, items: norm };
      items = items.concat(norm);
    } catch (e) {
      grouped.collector = { status: "fail", raw: null, items: [], error: s(e && e.message ? e.message : e) };
    }
  })());

  tasks.push((async () => {
    try {
      const res = await invokePlanetary(event, {
        q: p.q,
        query: p.q,
        limit: Math.min(p.limit, MAX_RESULTS_PER_ENGINE),
        region: p.region,
        mode: p.mode,
        intent: plan.intent,
        scope: p.scope,
        target: p.target,
        lang: p.lang,
        route: plan.intent
      });
      const norm = normalizeEnginePayload(res, "planetary").slice(0, MAX_RESULTS_PER_ENGINE);
      grouped.planetary = { status: "ok", raw: res, items: norm };
      items = items.concat(norm);
    } catch (e) {
      grouped.planetary = { status: "fail", raw: null, items: [], error: s(e && e.message ? e.message : e) };
    }
  })());

  tasks.push((async () => {
    try {
      const res = await invokeBankSearch(event, {
        q: p.q,
        query: p.q,
        limit: Math.min(p.limit, MAX_RESULTS_PER_ENGINE),
        region: p.region,
        channel: plan.intent === "media" ? "media" : undefined,
        type: plan.intent === "media" ? "video" : undefined,
        lang: p.lang
      });
      const norm = normalizeEnginePayload(res, "search-bank").slice(0, MAX_RESULTS_PER_ENGINE);
      grouped.bank = { status: "ok", raw: res, items: norm };
      items = items.concat(norm);
    } catch (e) {
      grouped.bank = { status: "fail", raw: null, items: [], error: s(e && e.message ? e.message : e) };
    }
  })());

  await Promise.all(tasks);

  if (!items.length) {
    try {
      const directApi = await directFetchApi(p.q, Math.min(p.limit, 30));
      grouped.direct_api = { status: "ok", raw: { items: directApi }, items: directApi };
      items = items.concat(directApi);
    } catch (e) {
      grouped.direct_api = { status: "fail", raw: null, items: [], error: s(e && e.message ? e.message : e) };
    }
  }

  if (!items.length || items.length < Math.min(5, p.limit)) {
    try {
      const directHtml = await directFetchHtml(p.q, Math.min(p.limit, 20));
      grouped.direct_html = { status: "ok", raw: { items: directHtml }, items: directHtml };
      items = items.concat(directHtml);
    } catch (e) {
      grouped.direct_html = { status: "fail", raw: null, items: [], error: s(e && e.message ? e.message : e) };
    }
  }

  if (items.length) {
    try {
      const insightRes = await invokeGlobalInsight(event, {
        q: p.q,
        mode: p.mode,
        limit: p.limit,
        intent: plan.intent,
        scope: p.scope,
        target: p.target
      });
      const insightItems = normalizeEnginePayload(insightRes, "globalInsight");
      grouped.globalInsight = { status: "ok", raw: insightRes, items: insightItems };
      items = items.concat(insightItems);
    } catch (e) {
      grouped.globalInsight = { status: "fail", raw: null, items: [], error: s(e && e.message ? e.message : e) };
    }
  }

  const out = { grouped, items };
  setCache(cacheKey, out);
  return out;
}

function buildMeta(reqId, p, plan, integrated, ranked, localSnapshotCount) {
  const collectorRes = integrated.grouped.collector || { status: "skip", items: [] };
  const planetaryRes = integrated.grouped.planetary || { status: "skip", items: [] };
  const bankRes = integrated.grouped.bank || { status: "skip", items: [] };
  const insightRes = integrated.grouped.globalInsight || { status: "skip", items: [] };
  const directApi = integrated.grouped.direct_api || { status: "skip", items: [] };
  const directHtml = integrated.grouped.direct_html || { status: "skip", items: [] };

  return {
    request_id: reqId,
    updated: nowIso(),
    version: VERSION,
    mode: p.mode,
    query: p.q || undefined,
    domain: p.domain || undefined,
    intent: plan.intent,
    signals: plan.signals,
    collector_ok: collectorRes.status === "ok",
    planetary_ok: planetaryRes.status === "ok",
    bank_ok: bankRes.status === "ok",
    insight_ok: insightRes.status === "ok",
    direct_api_ok: directApi.status === "ok",
    direct_html_ok: directHtml.status === "ok",
    collector_count: (collectorRes.items || []).length,
    planetary_count: (planetaryRes.items || []).length,
    bank_count: (bankRes.items || []).length,
    insight_count: (insightRes.items || []).length,
    direct_api_count: (directApi.items || []).length,
    direct_html_count: (directHtml.items || []).length,
    local_snapshot_count: localSnapshotCount,
    ranked_count: ranked.length,
    circuits: {
      collector: { ...CIRCUIT.collector },
      planetary: { ...CIRCUIT.planetary },
      bank: { ...CIRCUIT.bank },
      globalInsight: { ...CIRCUIT.globalInsight },
      direct: { ...CIRCUIT.direct }
    }
  };
}

async function runSearchMode(event, p) {
  const reqId = requestId();
  const plan = sourcePlan(p);
  const snapshot = loadCoreSnapshot();
  const localItems = selectLocalSearchItems(snapshot, p.q, p.lang || "all", Math.min(p.limit, 100));
  const integrated = await fetchFromIntegratedSources(event, p, plan);

  let merged = [];
  const bankSeed = integrated.grouped.bank && Array.isArray(integrated.grouped.bank.items) ? integrated.grouped.bank.items : [];
  if (bankSeed.length) merged = merged.concat(bankSeed);
  if (localItems.length) merged = merged.concat(localItems);
  if (integrated.items.length) merged = merged.concat(integrated.items);

  merged = dedup(merged);
  const ranked = rankItems(merged, p.q, plan.intent).slice(0, p.limit);

  await syncSearchBank(ranked);

  return {
    status: "ok",
    engine: "maru-search",
    version: VERSION,
    query: p.q,
    mode: "search",
    items: ranked,
    results: ranked,
    meta: buildMeta(reqId, p, plan, integrated, ranked, localItems.length),
    data: {
      collector: integrated.grouped.collector ? integrated.grouped.collector.raw : null,
      planetary: integrated.grouped.planetary ? integrated.grouped.planetary.raw : null,
      bank: integrated.grouped.bank ? integrated.grouped.bank.raw : null,
      globalInsight: integrated.grouped.globalInsight ? integrated.grouped.globalInsight.raw : null
    }
  };
}

async function runRecommendMode(event, p) {
  const reqId = requestId();
  const snapshot = loadCoreSnapshot();
  const plan = { intent: p.domain ? classifyIntent(p.domain) : "general", signals: p.domain ? semanticSignals(p.domain) : [] };
  const recommended = selectSnapshotRecommend(snapshot, p.domain, p.lang || "all", p.limit);

  const out = {
    status: "ok",
    engine: "maru-search",
    version: VERSION,
    mode: "recommend",
    domain: p.domain || "all",
    items: recommended,
    results: recommended,
    meta: {
      request_id: reqId,
      updated: nowIso(),
      version: VERSION,
      mode: "recommend",
      domain: p.domain || "all",
      intent: plan.intent,
      signals: plan.signals,
      ranked_count: recommended.length
    }
  };

  if (recommended.length) await syncSearchBank(recommended);
  return out;
}

async function runEngine(event = {}, params = {}) {
  const p = parseParams(params || event.queryStringParameters || {});

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

  if (p.mode === "recommend" || (!p.q && p.domain)) {
    return await runRecommendMode(event, p);
  }

  if (!p.q) {
    return {
      status: "ok",
      engine: "maru-search",
      version: VERSION,
      mode: p.mode || "search",
      items: [],
      results: []
    };
  }

  return await runSearchMode(event, p);
}

async function maruSearchDispatcher(payload = {}) {
  const query = s(payload.q || payload.query || "").trim();
  if (!query && !payload.domain) return { ok: false, error: "INVALID_PAYLOAD" };
  const event = {
    queryStringParameters: {
      q: query,
      domain: payload.domain,
      limit: payload.limit,
      mode: payload.mode,
      region: payload.context && payload.context.region,
      intent: payload.context && payload.context.intent,
      scope: payload.context && payload.context.scope,
      target: payload.context && payload.context.target,
      lang: payload.context && payload.context.lang,
      debug: payload.context && payload.context.debug ? "1" : "0"
    },
    headers: payload.headers || {}
  };
  return await runEngine(event, event.queryStringParameters || {});
}

exports.runEngine = runEngine;
exports.maruSearchDispatcher = maruSearchDispatcher;
exports.handler = async function handler(event = {}) {
  if ((event.httpMethod || "GET").toUpperCase() === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  try {
    const params = event.queryStringParameters || {};
    const res = await runEngine(event, params);
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(res) };
  } catch (e) {
    return {
      statusCode: 200,
      headers: corsHeaders(),
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
