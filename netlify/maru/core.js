/**
 * MARU Engine Core (v1.1-safe)
 * - Connector → Normalize → Store → Index/Score → Serve
 * - No external deps (Netlify Functions friendly)
 * - Safe stabilization layer for SANMARU / Maru Search / Search Bank
 *
 * Compatibility rule:
 * - Existing public exports are preserved.
 * - Existing callers can keep using nowIso/requestId/validateQuery/safeInt/scoreItem/
 *   normalizeResult/tieredFetch/engineRegistry/engineBus/aiAdapter/trustLayer/federation/plugins.
 * - The only behavioral hardening is that tieredFetch now defaults to internal-first
 *   (cache/snapshot → live) to reduce external calls. Legacy live-first is still
 *   available with { strategy:"live-first" } or { preferLive:true }.
 */
'use strict';

const crypto = require('crypto');

const CORE_VERSION = '1.1.0-safe-internal-first';
const DEFAULT_QUERY_MAX_LENGTH = 200;
const DEFAULT_PROVIDER_TIMEOUT_MS = 3500;

function nowIso() {
  return new Date().toISOString();
}

function requestId() {
  try {
    return crypto.randomBytes(12).toString('hex');
  } catch (e) {
    return 'rid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
}

function safeString(v) {
  return String(v == null ? '' : v);
}

function compactSpaces(v) {
  return safeString(v).replace(/\s+/g, ' ').trim();
}

function lower(v) {
  return compactSpaces(v).toLowerCase();
}

/** Basic allowlist-based input validation (defensive). */
function validateQuery(q, opts) {
  opts = opts || {};
  if (typeof q !== 'string') return { ok: false, code: 'BAD_QUERY', message: 'q must be string' };

  const qq = compactSpaces(q);
  const maxLength = safeInt(opts.maxLength, DEFAULT_QUERY_MAX_LENGTH, 1, 2000);

  if (!qq) return { ok: false, code: 'BAD_QUERY', message: 'q is empty' };
  if (qq.length > maxLength) return { ok: false, code: 'BAD_QUERY', message: 'q too long' };

  // Preserve the existing conservative guard. This is intentionally small and
  // does not block Korean/Chinese/Japanese/Arabic/etc. text.
  if (/[<>`$\\]/.test(qq)) return { ok: false, code: 'BAD_QUERY', message: 'q contains disallowed chars' };

  return { ok: true, value: qq };
}

function safeInt(n, d, min, max) {
  const x = Number.isFinite(Number(n)) ? Number(n) : d;
  const lo = Number.isFinite(Number(min)) ? Number(min) : Number.NEGATIVE_INFINITY;
  const hi = Number.isFinite(Number(max)) ? Number(max) : Number.POSITIVE_INFINITY;
  return Math.min(hi, Math.max(lo, Math.trunc(x)));
}

function stableHash(v) {
  try {
    return crypto.createHash('sha1').update(safeString(v)).digest('hex').slice(0, 20);
  } catch (e) {
    return safeString(v).replace(/[^a-z0-9가-힣]+/gi, '-').slice(0, 60) || requestId();
  }
}

function itemText(item) {
  item = item && typeof item === 'object' ? item : {};
  const source = item.source && typeof item.source === 'object'
    ? [item.source.name, item.source.platform, item.source.id].filter(Boolean).join(' ')
    : item.source;
  return [
    item.title,
    item.name,
    item.summary,
    item.snippet,
    item.description,
    item.url,
    item.link,
    item.channel,
    item.section,
    item.category,
    source,
    Array.isArray(item.tags) ? item.tags.join(' ') : ''
  ].map(compactSpaces).filter(Boolean).join(' ');
}

/**
 * Simple internal index scorer.
 * Compatibility: still returns a number and does not mutate the item.
 */
function scoreItem(q, item) {
  const query = lower(q);
  const it = item && typeof item === 'object' ? item : {};
  const text = lower(itemText(it));
  const title = lower(it.title || it.name || '');
  const tags = Array.isArray(it.tags) ? lower(it.tags.join(' ')) : '';
  const url = lower(it.url || it.link || '');

  let s = 0;
  if (query) {
    if (title === query) s += 6;
    if (title.includes(query)) s += 2;
    if (text.includes(query)) s += 1;
    if (tags.includes(query)) s += 1;

    const tokens = query.split(/[\s,.;:/|()[\]{}"'`~!@#%^&*_+=<>?\-]+/).filter(t => t.length >= 2).slice(0, 8);
    for (const t of tokens) {
      if (title.includes(t)) s += 0.5;
      else if (text.includes(t)) s += 0.2;
    }
  }

  // Internal/authority signal: only a mild boost, never a hard filter.
  if (/search[-_ ]?bank|sanmaru|maru/i.test(safeString(it.source || it.provider || ''))) s += 0.25;
  if (/\.go\.kr|\.gov(\.|$)|korea\.kr|go\.jp|gov\.cn|gov\.uk|\.edu(\.|$)|\.ac\./i.test(url)) s += 0.8;
  if (typeof it.sourceTrust === 'number') s += Math.max(0, Math.min(2, it.sourceTrust));
  if (typeof it.score === 'number') s += Math.max(0, Math.min(1, it.score));

  // Existing short-title boost preserved.
  s += Math.max(0, 0.2 - (title.length / 1000));
  return s;
}

function hasItems(x) {
  return !!(x && typeof x === 'object' && Array.isArray(x.items));
}

function normalizeResult(res) {
  if (!res || typeof res !== 'object') return res;

  if (Array.isArray(res.items)) return res;
  if (res.data && Array.isArray(res.data.items)) return res.data;

  if (res.baseResult && Array.isArray(res.baseResult.items)) return res.baseResult;
  if (res.baseResult && res.baseResult.data && Array.isArray(res.baseResult.data.items)) return res.baseResult.data;

  if (Array.isArray(res.results)) return Object.assign({}, res, { items: res.results });
  if (Array.isArray(res.pageItems)) return Object.assign({}, res, { items: res.pageItems });
  if (res.visiblePagePack && Array.isArray(res.visiblePagePack.pageItems)) {
    return Object.assign({}, res, { items: res.visiblePagePack.pageItems });
  }
  if (res.sectionPack && Array.isArray(res.sectionPack.pageItems)) {
    return Object.assign({}, res, { items: res.sectionPack.pageItems });
  }

  return res;
}

function providerOrderFromOptions(opts) {
  opts = opts || {};
  if (Array.isArray(opts.order) && opts.order.length) return opts.order.slice();

  const strategy = lower(opts.strategy || opts.mode || opts.fetchMode || '');
  if (opts.preferLive || strategy === 'live-first' || strategy === 'legacy-live-first') {
    return ['live', 'cache', 'snapshot'];
  }
  if (opts.preferSnapshot || strategy === 'snapshot-first') {
    return ['snapshot', 'cache', 'live'];
  }

  // Default: internal-first. Cache is checked before snapshot so a warmer internal
  // result can win, while live is last to protect external credits.
  return ['cache', 'snapshot', 'live'];
}

function providerByName(name, providers) {
  if (name === 'live') return providers.liveProvider;
  if (name === 'cache') return providers.cacheProvider;
  if (name === 'snapshot') return providers.snapshotProvider;
  return null;
}

function withTimeout(promise, ms, label) {
  ms = safeInt(ms, DEFAULT_PROVIDER_TIMEOUT_MS, 100, 60000);
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error((label || 'provider') + '_timeout')), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isUsableProviderResult(data, minItems, allowEmpty) {
  const normalized = normalizeResult(data);
  if (!normalized || typeof normalized !== 'object') return false;
  if (!Array.isArray(normalized.items)) return false;
  if (allowEmpty && normalized.items.length === 0) return true;
  return normalized.items.length >= minItems;
}

/**
 * tieredFetch({ liveProvider, cacheProvider, snapshotProvider, ...options })
 * - Default: cache → snapshot → live.
 * - External/live calls happen only after internal layers fail or are insufficient.
 * - Legacy behavior can be forced with { strategy:"live-first" }.
 */
async function tieredFetch(providers) {
  providers = providers || {};
  const order = providerOrderFromOptions(providers);
  const minItems = safeInt(providers.minItems, 1, 0, 1000000);
  const allowEmpty = providers.allowEmpty === true;
  const timeoutMs = safeInt(providers.timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS, 100, 60000);
  const externalMode = lower(providers.external || providers.externalMode || 'auto');
  const liveBlocked = externalMode === 'off' || providers.noLive === true || providers.disableLive === true || providers.noExternal === true || providers.disableExternal === true;
  const trace = [];
  let lastData = null;
  let lastError = null;

  for (const name of order) {
    if (name === 'live' && liveBlocked) {
      trace.push({ name, status: 'blocked', reason: 'external-off' });
      continue;
    }

    const fn = providerByName(name, providers);
    if (typeof fn !== 'function') {
      trace.push({ name, status: 'missing' });
      continue;
    }

    const started = Date.now();
    try {
      const raw = await withTimeout(fn(), timeoutMs, name);
      const data = normalizeResult(raw);
      lastData = data;

      if (isUsableProviderResult(data, minItems, allowEmpty || name === 'snapshot')) {
        const out = { served_from: name, data };
        if (providers.includeTrace) out.trace = trace.concat({ name, status: 'ok', count: Array.isArray(data.items) ? data.items.length : 0, elapsedMs: Date.now() - started });
        return out;
      }

      trace.push({ name, status: 'insufficient', count: data && Array.isArray(data.items) ? data.items.length : 0, elapsedMs: Date.now() - started });
    } catch (e) {
      lastError = e;
      trace.push({ name, status: 'error', error: safeString(e && e.message || e).slice(0, 160), elapsedMs: Date.now() - started });
    }
  }

  if (lastData && typeof lastData === 'object') {
    const out = { served_from: 'fallback-last-data', data: lastData };
    if (providers.includeTrace) out.trace = trace;
    return out;
  }

  if (typeof providers.snapshotProvider === 'function') {
    // Preserve the old contract that snapshot is the final required layer.
    const data = normalizeResult(await providers.snapshotProvider());
    const out = { served_from: 'snapshot', data };
    if (providers.includeTrace) out.trace = trace.concat({ name: 'snapshot', status: 'forced-final' });
    return out;
  }

  if (lastError) throw lastError;
  const empty = { items: [] };
  const out = { served_from: 'empty', data: empty };
  if (providers.includeTrace) out.trace = trace;
  return out;
}

function stableItemKey(it) {
  it = it && typeof it === 'object' ? it : {};
  const url = compactSpaces(it.url || it.link || it.href).toLowerCase();
  if (url && url !== '#' && url !== '/' && !url.startsWith('javascript:')) return 'url:' + url;
  return 'txt:' + lower([it.id, it.title, it.name, it.source && (it.source.name || it.source), it.provider].filter(Boolean).join('|'));
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const key = stableItemKey(it);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

const CORE = {
  version: CORE_VERSION,
  nowIso,
  requestId,
  validateQuery,
  safeInt,
  scoreItem,
  normalizeResult,
  tieredFetch,
  stableHash,
  stableItemKey,
  dedupeItems,
};

/* ===== ENGINE REGISTRY ===== */
CORE.engineRegistry = {
  engines: new Map(),

  register(name, engine) {
    if (!name || !engine) return false;
    this.engines.set(String(name), engine);
    return true;
  },

  unregister(name) {
    return this.engines.delete(String(name));
  },

  get(name) {
    return this.engines.get(String(name));
  },

  has(name) {
    return this.engines.has(String(name));
  },

  list() {
    return Array.from(this.engines.keys());
  },

  snapshot() {
    return this.list().map(name => ({ name, registered: true }));
  }
};

/* ===== GLOBAL ENGINE BUS ===== */
CORE.engineBus = {
  listeners: new Map(),

  on(event, fn) {
    if (!event || typeof fn !== 'function') return function noop() {};
    const key = String(event);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
    return () => this.off(key, fn);
  },

  once(event, fn) {
    if (typeof fn !== 'function') return function noop() {};
    const off = this.on(event, async payload => {
      off();
      return fn(payload);
    });
    return off;
  },

  off(event, fn) {
    const key = String(event);
    const list = this.listeners.get(key) || [];
    const next = list.filter(x => x !== fn);
    if (next.length) this.listeners.set(key, next);
    else this.listeners.delete(key);
    return true;
  },

  async emit(event, payload) {
    const list = (this.listeners.get(String(event)) || []).slice();
    const results = [];
    for (const fn of list) {
      try {
        results.push(await fn(payload));
      } catch (e) {
        results.push({ error: safeString(e && e.message || e).slice(0, 160) });
      }
    }
    return results;
  }
};

/* ===== AI ADAPTER ===== */
CORE.aiAdapter = {
  normalizeAIResult(res) {
    const normalized = normalizeResult(res);
    if (!normalized) return [];
    if (Array.isArray(normalized)) return normalized;
    if (Array.isArray(normalized.items)) return normalized.items;
    return [normalized];
  },

  mergeResults(searchResults = [], aiResults = []) {
    return dedupeItems([].concat(searchResults || [], aiResults || []));
  }
};

/* ===== TRUST LAYER ===== */
CORE.trustLayer = {
  trustScore(item) {
    item = item && typeof item === 'object' ? item : {};
    let score = 1;

    if (typeof item.sourceTrust === 'number') score *= Math.max(0, item.sourceTrust);
    if (typeof item.deepfakeRisk === 'number') score *= Math.max(0, 1 - Math.max(0, Math.min(1, item.deepfakeRisk)));
    if (typeof item.manipulationRisk === 'number') score *= Math.max(0, 1 - Math.max(0, Math.min(1, item.manipulationRisk)));
    if (item.verified || item.official || item.sourceType === 'official-authority') score *= 1.1;

    return Math.max(0, score);
  },

  sort(items) {
    return (Array.isArray(items) ? items.slice() : []).sort((a, b) => this.trustScore(b) - this.trustScore(a));
  }
};

/* ===== FEDERATION ROUTER ===== */
CORE.federation = {
  async route(query, engines = [], opts = {}) {
    const names = Array.isArray(engines) ? engines : [];
    const tasks = [];

    for (const name of names) {
      const engine = CORE.engineRegistry.get(name);
      if (!engine) continue;

      try {
        if (typeof engine.search === 'function') tasks.push(Promise.resolve(engine.search(query, opts)));
        else if (typeof engine.runEngine === 'function') tasks.push(Promise.resolve(engine.runEngine({}, Object.assign({}, opts, { q: query, query }))));
        else if (typeof engine.handler === 'function') tasks.push(Promise.resolve(engine.handler({ queryStringParameters: Object.assign({}, opts, { q: query, query }) })));
      } catch (e) {}
    }

    const results = await Promise.allSettled(tasks);
    const items = [];

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const value = normalizeResult(r.value && r.value.body ? safeJson(r.value.body, r.value) : r.value);
      if (Array.isArray(value)) items.push(...value);
      else if (value && Array.isArray(value.items)) items.push(...value.items);
    }

    const merged = dedupeItems(items);
    const limit = opts && opts.limit ? safeInt(opts.limit, merged.length, 1, 1000000) : merged.length;
    return merged.slice(0, limit);
  }
};

function safeJson(text, fallback) {
  try { return JSON.parse(text); }
  catch (e) { return fallback; }
}

/* ===== PLUGIN SYSTEM ===== */
CORE.plugins = {
  list: [],

  load(plugin) {
    if (!plugin || this.list.includes(plugin)) return false;
    this.list.push(plugin);
    if (typeof plugin.init === 'function') {
      try { plugin.init(CORE); } catch (e) {}
    }
    return true;
  },

  names() {
    return this.list.map(p => p && (p.name || p.id || p.constructor && p.constructor.name)).filter(Boolean);
  }
};

module.exports = CORE;
