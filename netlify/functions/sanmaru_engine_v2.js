'use strict';

/**
 * SANMARU ENGINE v2
 * ------------------------------------------------------------------
 * Global meta-intelligence orchestrator.
 *
 * Goals:
 * - Preserve v1 style: exports.runSanmaru(query, ctx)
 * - Access-first orchestration (not DB-centric)
 * - Flow capture + ephemeral buffer + selective promotion
 * - Recall + global index + resilience / failover aware routing
 * - Logos-governed scoring and filtering
 * - Zero-config friendly: runs with local core/logos only
 */

const CORE = require('./core');
let LogosModule = null;
try { LogosModule = require('./maru-logos-engine'); } catch (_) { LogosModule = null; }

const VERSION = 'SANMARU-v2.0-orchestrator';
const DEFAULT_BUFFER_TTL_MS = 1000 * 60 * 10;
const DEFAULT_PROMOTION_THRESHOLD = 0.78;
const DEFAULT_MAX_BUFFER = 4000;
const DEFAULT_MAX_MEMORY = 500;
const DEFAULT_MAX_RECALL = 5000;
const DEFAULT_MAX_RESULTS = 200;
const DEFAULT_HEALTH_OPEN_MS = 25_000;

const STATE = {
  sessionMemory: [],
  ephemeralBuffer: new Map(),
  persistentMemory: new Map(),
  globalIndex: new Map(),
  health: new Map(),
  telemetry: [],
  initialized: false,
  bootstrapped: false
};

function now() { return Date.now(); }
function low(x) { return String(x == null ? '' : x).trim().toLowerCase(); }
function asArray(v) { return Array.isArray(v) ? v : []; }
function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }
function safeJson(v) { try { return JSON.stringify(v); } catch (_) { return ''; } }

function stableId(input) {
  const text = typeof input === 'string' ? input : safeJson(input);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return 'smr_' + (h >>> 0).toString(16);
}

function canonicalItem(item = {}, sourceHint = null) {
  const title = String(item.title || item.name || '').trim();
  const summary = String(item.summary || item.snippet || item.description || '').trim();
  const url = String(item.url || item.link || item.href || '').trim();
  const source = String(item.source || sourceHint || item.provider || '').trim() || null;
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
  const mediaType = item.mediaType || item.type || payload.mediaType || 'web';
  const trustScore = Number(item.trustScore ?? item.trust ?? item.sourceTrust ?? 0);
  const repeatCount = Number(item.repeatCount || 0);
  const freshnessSeconds = Number(item.freshnessSeconds || 0);
  const impact = Number(item.impact || 0);
  const entities = asArray(item.entities || payload.entities).map(String);
  const tags = asArray(item.tags || payload.tags).map(String);

  return {
    id: item.id || url || stableId({ title, summary, source, mediaType }),
    title,
    summary,
    url,
    source,
    mediaType,
    lang: item.lang || payload.lang || null,
    score: typeof item.score === 'number' ? item.score : 0,
    trustScore: Number.isFinite(trustScore) ? trustScore : 0,
    sourceTrust: Number(item.sourceTrust ?? payload.sourceTrust ?? 0),
    deepfakeRisk: Number(item.deepfakeRisk ?? payload.deepfakeRisk ?? 0),
    manipulationRisk: Number(item.manipulationRisk ?? payload.manipulationRisk ?? 0),
    repeatCount: Number.isFinite(repeatCount) ? repeatCount : 0,
    freshnessSeconds: Number.isFinite(freshnessSeconds) ? freshnessSeconds : 0,
    impact: Number.isFinite(impact) ? impact : 0,
    entities,
    tags,
    timestamp: item.timestamp || payload.timestamp || now(),
    payload
  };
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const raw of asArray(items)) {
    const item = canonicalItem(raw);
    const key = low(item.url || item.id || item.title || safeJson(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function initialize() {
  if (STATE.initialized) return;
  STATE.initialized = true;
  if (!CORE.plugins || typeof CORE.plugins.load !== 'function') return;
}

function makeLogosEngine(ctx = {}) {
  if (ctx.logosEngine) return ctx.logosEngine;
  if (LogosModule && typeof LogosModule.LogosEngine === 'function') {
    return new LogosModule.LogosEngine();
  }
  return null;
}

function detectIntent(query) {
  const q = low(query);
  const intents = [];

  if (/(buy|price|market|product|shop|commerce)/.test(q)) intents.push('commerce');
  if (/(risk|scam|hack|fraud|attack|war|threat)/.test(q)) intents.push('risk');
  if (/(trend|analysis|forecast|outlook|insight|strategy)/.test(q)) intents.push('analysis');
  if (/(news|headline|breaking|today|update)/.test(q)) intents.push('news');
  if (/(video|image|watch|photo|media)/.test(q)) intents.push('media');
  if (/(research|paper|study|science|nasa|space|report)/.test(q)) intents.push('research');
  if (!intents.length) intents.push('info');

  return { primary: intents[0], intents };
}

function classifySignals(item) {
  const title = low(item.title);
  const summary = low(item.summary);
  const text = `${title} ${summary}`;

  let type = 'neutral';
  let intent = 'observe';
  let lifeImpact = 0;

  if (/(war|attack|kill|violence|weapon)/.test(text)) {
    type = 'violence';
    intent = 'harm';
    lifeImpact = -1;
  } else if (/(fraud|scam|hack|manipulat)/.test(text)) {
    type = 'conflict';
    intent = 'risk';
  } else if (/(recovery|restore|heal|aid|peace)/.test(text)) {
    type = 'recovery';
    intent = 'restore';
    lifeImpact = 0.5;
  } else if (/(innovation|breakthrough|discover|launch)/.test(text)) {
    type = 'innovation';
  }

  return {
    type,
    intent,
    truthConfidence: Math.max(0, Math.min(1, Number(item.trustScore || item.sourceTrust || 0))),
    lifeImpact,
    environmentImpact: 0,
    humanSuffering: /(death|injur|refugee|crisis|hunger)/.test(text),
    recoveryOpportunity: /(recover|restore|stabil|support|aid)/.test(text),
    manipulationRisk: Number(item.manipulationRisk || 0)
  };
}

function healthState(name) {
  if (!STATE.health.has(name)) {
    STATE.health.set(name, {
      name,
      alive: true,
      failures: 0,
      openUntil: 0,
      success: 0,
      latency: 0,
      lastError: null,
      updatedAt: 0
    });
  }
  return STATE.health.get(name);
}

function markHealthSuccess(name, latency) {
  const st = healthState(name);
  st.alive = true;
  st.failures = 0;
  st.openUntil = 0;
  st.success += 1;
  st.latency = latency;
  st.lastError = null;
  st.updatedAt = now();
}

function markHealthFailure(name, err, openMs = DEFAULT_HEALTH_OPEN_MS) {
  const st = healthState(name);
  st.failures += 1;
  st.alive = false;
  st.lastError = String(err && err.message ? err.message : err || 'ENGINE_FAIL');
  st.updatedAt = now();
  if (st.failures >= 3) st.openUntil = now() + openMs;
}

function isEngineAlive(name) {
  const st = healthState(name);
  if (!st.openUntil) return true;
  if (now() > st.openUntil) {
    st.alive = true;
    st.failures = 0;
    st.openUntil = 0;
    return true;
  }
  return false;
}

function buildPlan(query, ctx = {}) {
  const intent = detectIntent(query);
  const names = [];

  if (intent.primary === 'risk') names.push('searchbank', 'web_google', 'web_naver');
  else if (intent.primary === 'research') names.push('searchbank', 'web_google', 'web_naver');
  else if (intent.primary === 'news') names.push('web_google', 'searchbank', 'web_naver');
  else names.push('searchbank', 'web_google', 'web_naver');

  if (ctx.additionalEngineNames) names.push(...asArray(ctx.additionalEngineNames));

  return {
    intent,
    engineNames: uniq(names).filter(isEngineAlive),
    maxResults: Math.max(1, Math.min(Number(ctx.maxResults || DEFAULT_MAX_RESULTS), 1000)),
    promotionThreshold: typeof ctx.promotionThreshold === 'number' ? ctx.promotionThreshold : DEFAULT_PROMOTION_THRESHOLD,
    bufferTtlMs: Number(ctx.bufferTtlMs || DEFAULT_BUFFER_TTL_MS),
    now: now()
  };
}

async function runFederation(query, engineNames) {
  const started = now();
  try {
    const items = await CORE.federation.route(query, engineNames);
    markHealthSuccess('federation', now() - started);
    return asArray(items);
  } catch (err) {
    markHealthFailure('federation', err);
    return [];
  }
}

async function runAdapterAccess(query, ctx = {}, plan = {}) {
  const adapters = asArray(ctx.adapters);
  if (!adapters.length) return [];

  const calls = adapters
    .filter(a => typeof a.access === 'function')
    .filter(a => !a.match || a.match(query, plan.intent))
    .slice(0, 12)
    .map(async (adapter) => {
      const name = adapter.name || stableId(adapter);
      if (!isEngineAlive(name)) return [];
      const started = now();
      try {
        const out = await adapter.access(query, ctx, plan);
        markHealthSuccess(name, now() - started);
        return asArray(out).map(item => canonicalItem(item, name));
      } catch (err) {
        markHealthFailure(name, err);
        return [];
      }
    });

  const results = await Promise.all(calls);
  return results.flat();
}

async function runAI(query, ctx = {}, plan = {}) {
  if (typeof ctx.ai !== 'function') return [];
  const started = now();
  try {
    let aiQuery = query;
    if (plan.intent.primary === 'commerce') aiQuery += ' best product recommendation';
    if (plan.intent.primary === 'risk') aiQuery += ' risk analysis warning';
    if (plan.intent.primary === 'analysis') aiQuery += ' analysis insight';
    if (plan.intent.primary === 'research') aiQuery += ' research summary';

    const raw = await ctx.ai(aiQuery, { plan });
    const items = CORE.aiAdapter.normalizeAIResult(raw).map(item => canonicalItem(item, 'ai'));
    markHealthSuccess('ai', now() - started);
    return items;
  } catch (err) {
    markHealthFailure('ai', err);
    return [];
  }
}

function captureFlow(items, plan) {
  const ttl = plan.bufferTtlMs;
  const limit = DEFAULT_MAX_BUFFER;
  const captured = [];

  for (const item of asArray(items)) {
    const key = item.id || stableId(item);
    const entry = {
      ...item,
      seenAt: now(),
      expiresAt: now() + ttl,
      ttl
    };
    STATE.ephemeralBuffer.set(key, entry);
    captured.push(entry);
  }

  if (STATE.ephemeralBuffer.size > limit) {
    const entries = Array.from(STATE.ephemeralBuffer.entries())
      .sort((a, b) => (a[1].seenAt || 0) - (b[1].seenAt || 0));
    while (entries.length && STATE.ephemeralBuffer.size > limit) {
      const [key] = entries.shift();
      STATE.ephemeralBuffer.delete(key);
    }
  }

  flushExpiredBuffer();
  return captured;
}

function flushExpiredBuffer() {
  const t = now();
  for (const [key, value] of STATE.ephemeralBuffer.entries()) {
    if ((value.expiresAt || 0) <= t) STATE.ephemeralBuffer.delete(key);
  }
}

function importanceScore(item) {
  let score = 0;
  if ((item.repeatCount || 0) > 2) score += 0.2;
  if ((item.sourceTrust || item.trustScore || 0) > 0.7) score += 0.25;
  if ((item.freshnessSeconds || 0) > 0 && (item.freshnessSeconds || 0) < 3600) score += 0.15;
  if ((item.impact || 0) > 0.5) score += 0.2;
  if (asArray(item.entities).length >= 2) score += 0.1;
  if ((item.logosWeight || 0) > 0.8) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function packPersistent(item, score) {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    url: item.url,
    source: item.source,
    mediaType: item.mediaType,
    entities: asArray(item.entities),
    sourceRefs: uniq([item.source, ...(asArray(item.payload?.sources))]),
    trustScore: Number(item.trustScore || 0),
    logosWeight: Number(item.logosWeight || 0),
    importanceScore: score,
    timestamp: item.timestamp || now()
  };
}

async function defaultStorePersistent(data, ctx = {}) {
  const region = (ctx.regionResolver && ctx.regionResolver(data)) || 'global';
  const location = `memory://${region}`;
  STATE.persistentMemory.set(data.id, { ...data, location });
  STATE.globalIndex.set(data.id, {
    id: data.id,
    location,
    priority: data.importanceScore,
    timestamp: data.timestamp,
    title: data.title
  });
  return { ok: true, location };
}

async function promoteImportant(items, ctx = {}, plan = {}) {
  const promoted = [];
  const store = typeof ctx.storePersistent === 'function' ? ctx.storePersistent : defaultStorePersistent;

  for (const item of asArray(items)) {
    const score = importanceScore(item);
    if (score < plan.promotionThreshold) continue;

    const packed = packPersistent(item, score);
    try {
      const stored = await store(packed, ctx, plan);
      STATE.globalIndex.set(packed.id, {
        id: packed.id,
        location: stored && stored.location ? stored.location : 'memory://global',
        priority: score,
        timestamp: packed.timestamp,
        title: packed.title
      });
      promoted.push({ ...packed, location: stored && stored.location ? stored.location : 'memory://global' });
    } catch (_) {}
  }
  return promoted;
}

function recall(query, ctx = {}) {
  const q = low(query);
  const out = [];

  for (const item of STATE.persistentMemory.values()) {
    const text = low(`${item.title} ${item.summary} ${asArray(item.entities).join(' ')}`);
    if (q && !text.includes(q)) continue;
    out.push({ ...item, recall: true });
  }

  return out.slice(0, Number(ctx.maxRecall || DEFAULT_MAX_RECALL));
}

function applyTrust(items) {
  return asArray(items).map(item => {
    const trust = Number(item.trustScore || CORE.trustLayer.trustScore(item) || 0);
    return { ...item, trustScore: trust };
  });
}

function applyLogos(items, ctx = {}) {
  const logosEngine = makeLogosEngine(ctx);
  if (!logosEngine) {
    return asArray(items)
      .map(item => ({ ...item, logosWeight: Number(item.trustScore || 0), logosRisk: Number(item.manipulationRisk || 0) }))
      .filter(item => item.logosRisk < 5);
  }

  const guidanceMap = new Map();
  const signals = asArray(items).map(classifySignals);
  const run = logosEngine.run(signals);
  const guidance = asArray(run && run.guidance);

  guidance.forEach((g, idx) => guidanceMap.set(idx, g));

  return asArray(items)
    .map((item, idx) => {
      const g = guidanceMap.get(idx);
      const logosWeight = Number(g && g.logosWeight || 0);
      const logosRisk = Number(item.manipulationRisk || 0) + (g && g.narrative === 'manipulation_narrative' ? 1.5 : 0);
      return {
        ...item,
        logosWeight,
        logosRisk,
        logosPattern: g && g.pattern || 'neutral_pattern',
        logosNarrative: g && g.narrative || 'neutral_narrative'
      };
    })
    .filter(item => item.logosRisk < 5);
}

function mergeAndRank(resultSets, plan) {
  let items = dedupeItems(resultSets.flat());
  items = applyTrust(items);
  items = applyLogos(items);

  items = items.map(item => {
    const score =
      Number(item.score || 0) +
      Number(item.trustScore || 0) * 1.1 +
      Number(item.logosWeight || 0) * 0.9 -
      Number(item.logosRisk || 0) * 0.8;
    return { ...item, finalScore: score };
  });

  items.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
  return items.slice(0, plan.maxResults);
}

function remember(query, result, plan) {
  STATE.sessionMemory.push({
    query,
    intent: plan.intent,
    count: asArray(result.items).length,
    promoted: asArray(result.promoted).length,
    timestamp: now()
  });
  if (STATE.sessionMemory.length > DEFAULT_MAX_MEMORY) STATE.sessionMemory.shift();
}

function telemetry(event, payload) {
  STATE.telemetry.push({ time: now(), event, ...payload });
  if (STATE.telemetry.length > 5000) STATE.telemetry.shift();
}

function bootstrap(engines = {}) {
  if (STATE.bootstrapped) return;
  STATE.bootstrapped = true;

  const register = (name, fn) => {
    if (!name || typeof fn !== 'function') return;
    CORE.engineRegistry.register(name, { search: fn });
  };

  for (const [name, mod] of Object.entries(engines)) {
    if (mod && typeof mod.search === 'function') register(name, mod.search.bind(mod));
    else if (mod && typeof mod.runEngine === 'function') {
      register(name, async (query) => {
        const out = await mod.runEngine(null, { q: query, query, limit: 50 });
        return dedupeItems(out && (out.items || out.results || []));
      });
    } else if (typeof mod === 'function') {
      register(name, mod);
    }
  }
}

async function runSanmaru(query, ctx = {}) {
  initialize();
  if (ctx.bootstrapEngines) bootstrap(ctx.bootstrapEngines);

  const plan = buildPlan(query, ctx);
  telemetry('run_start', { query, intent: plan.intent });

  const federationResults = await runFederation(query, plan.engineNames);
  const adapterResults = await runAdapterAccess(query, ctx, plan);
  const aiResults = await runAI(query, ctx, plan);
  const recallResults = recall(query, ctx);

  const merged = mergeAndRank([federationResults, adapterResults, aiResults, recallResults], plan);
  captureFlow(merged, plan);
  const promoted = await promoteImportant(merged, ctx, plan);

  const result = {
    items: merged,
    promoted,
    recalled: recallResults.slice(0, 20),
    meta: {
      engine: 'SANMARU',
      version: VERSION,
      count: merged.length,
      promoted: promoted.length,
      intent: plan.intent,
      engineNames: plan.engineNames,
      bufferSize: STATE.ephemeralBuffer.size,
      persistentSize: STATE.persistentMemory.size,
      indexSize: STATE.globalIndex.size
    }
  };

  remember(query, result, plan);
  telemetry('run_end', { query, count: result.meta.count, promoted: result.meta.promoted });
  return result;
}

function getState() {
  flushExpiredBuffer();
  return {
    version: VERSION,
    sessionMemory: STATE.sessionMemory.slice(),
    bufferSize: STATE.ephemeralBuffer.size,
    persistentSize: STATE.persistentMemory.size,
    indexSize: STATE.globalIndex.size,
    health: Array.from(STATE.health.values()),
    telemetrySize: STATE.telemetry.length
  };
}

function recallById(id) {
  return STATE.persistentMemory.get(id) || null;
}

module.exports = {
  VERSION,
  runSanmaru,
  getState,
  recallById,
  bootstrap,
  _STATE: STATE
};
