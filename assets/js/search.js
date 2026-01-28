/**
 * netlify/functions/maru-search.js
 * ------------------------------------------------------------
 * MARU SEARCH v2.2 (Fan-out Multi-source Web Collection 강화)
 *
 * ✅ Backward compatible (NO BREAKING CHANGES):
 * - exports.handler (HTTP)
 * - exports.maruSearchDispatcher (bridge internal call)
 * - legacy outputs: items/results (search.js 호환)
 * - 기존 entity/knowledge/signals/actions 구조 유지
 *
 * ✅ Upgrade focus (Step 1-B: 요청 기반 수집 → 다중 소스 Fan-out)
 * - NAVER + Google (configured) 를 "fallback"이 아니라 "병렬 수집"으로 동시 집계
 * - 소스별 결과를 합치고(merge) 중복 제거
 * - limit은 기존 유지(기본 10) + 상한 확장(최대 50)  ※ 더 큰 값은 다음 단계(페이지네이션)에서 처리
 *
 * Env:
 * - NAVER_API_KEY, NAVER_CLIENT_SECRET
 * - optional: GOOGLE_API_KEY, GOOGLE_CSE_ID
 */

'use strict';

const VERSION = '2.2.0';
const DEFAULT_LIMIT = 10;

// Fan-out 1차 상한 (Netlify 안정성용). "수백/수천"은 다음 단계에서 page loop로 확장.
const MAX_LIMIT = 50;

// Per-fetch timeout (ms). Netlify 환경에서 과도한 대기 방지.
const FETCH_TIMEOUT_MS = 6500;

// Lightweight in-memory cache (persists during warm function instances)
const CACHE_TTL_MS = 60 * 1000; // 60s
const CACHE_MAX = 80;
const __CACHE__ = globalThis.__MARU_SEARCH_CACHE__ || (globalThis.__MARU_SEARCH_CACHE__ = new Map());

let Core = null;
try { Core = require("./core"); } catch (_) { Core = null; }

// ------------------------------
// Helpers
// ------------------------------
function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(obj),
  };
}

function ok(obj) { return json(200, obj); }

function fail(message, detail) {
  return ok({
    status: 'error',
    engine: 'maru-search',
    version: VERSION,
    message,
    detail: detail || null,
  });
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function clampLimit(x) {
  const n = parseInt(x, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, n), MAX_LIMIT);
}

function pickParams(event) {
  const qs = event.queryStringParameters || {};
  const q = String(qs.q || qs.query || '').trim();
  const limit = clampLimit(qs.limit);
  const mode = String(qs.mode || 'search').trim();
  return { q, limit, mode, qs };
}

function toWebItem(r, source) {
  return {
    type: r.type || 'web',
    title: r.title || '',
    summary: r.snippet || r.summary || '',
    url: r.link || r.url || '',
    source: source || r.source || r.payload?.source || 'web',
    score: 0.0,
    payload: r.payload || {},
  };
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of (arr || [])) {
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function normalizeQuery(q) {
  return String(q || '').trim().replace(/\s+/g, ' ');
}

function nowMs() { return Date.now(); }

function cacheKey(prefix, obj) {
  try { return `${prefix}:${JSON.stringify(obj)}`; } catch (_) { return `${prefix}:${String(obj)}`; }
}

function cacheGet(key) {
  const hit = __CACHE__.get(key);
  if (!hit) return null;
  const { exp, val } = hit;
  if (exp < nowMs()) {
    __CACHE__.delete(key);
    return null;
  }
  return val;
}

function cacheSet(key, val, ttl = CACHE_TTL_MS) {
  __CACHE__.set(key, { exp: nowMs() + ttl, val });
  if (__CACHE__.size > CACHE_MAX) {
    const firstKey = __CACHE__.keys().next().value;
    if (firstKey) __CACHE__.delete(firstKey);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ------------------------------
// Web search collectors
// ------------------------------
async function naverSearch(q, limit) {
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(q)}&display=${limit}`;
  const res = await fetchWithTimeout(url, {
    headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
  });
  if (!res.ok) throw new Error(`NAVER_HTTP_${res.status}`);
  const data = await res.json();

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map(it => ({
    title: stripHtml(it.title),
    link: it.link || '',
    snippet: stripHtml(it.description),
    type: 'web',
    payload: { source: 'naver', raw: it },
  }));
  return { source: 'naver', results };
}

async function googleCseSearch(q, limit) {
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;

  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`GOOGLE_HTTP_${res.status}`);
  const data = await res.json();

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map(it => ({
    title: stripHtml(it.title),
    link: it.link || '',
    snippet: stripHtml(it.snippet),
    type: 'web',
    payload: { source: 'google', raw: it },
  }));
  return { source: 'google', results };
}

/**
 * Fan-out: NAVER + Google 병렬 수집 후 merge.
 * - 기존 "fallback" 제거 (단, 둘 다 비활성일 수는 있음)
 * - sourcesTried에 상태 기록
 */
async function webSearchFanout(q, limit) {
  const sourcesTried = [];
  const jobs = [
    (async () => {
      try {
        const n = await naverSearch(q, limit);
        if (!n) { sourcesTried.push('naver:disabled'); return []; }
        sourcesTried.push('naver');
        return (n.results || []).map(r => ({ ...r, __src: 'naver' }));
      } catch (_) {
        sourcesTried.push('naver:error');
        return [];
      }
    })(),
    (async () => {
      try {
        const g = await googleCseSearch(q, limit);
        if (!g) { sourcesTried.push('google:disabled'); return []; }
        sourcesTried.push('google');
        return (g.results || []).map(r => ({ ...r, __src: 'google' }));
      } catch (_) {
        sourcesTried.push('google:error');
        return [];
      }
    })(),
  ];

  const settled = await Promise.allSettled(jobs);
  const mergedRaw = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));

  // merge + dedupe by url
  const merged = uniqBy(
    mergedRaw.map(r => toWebItem(r, r.__src)).filter(it => it.url),
    it => it.url
  );

  // no hard trimming here beyond MAX_LIMIT - keep full merge within requested limit*2 possible,
  // but we only request "limit" per provider, so max ~2*limit.
  return { sourcesTried, webItems: merged };
}

// ------------------------------
// Entity / Knowledge collectors (public)
// ------------------------------
async function wikidataSearchEntity(q, lang = 'en') {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=${encodeURIComponent(lang)}&format=json&limit=5&origin=*`;
  const res = await fetchWithTimeout(url, { headers: { 'accept': 'application/json' }});
  if (!res.ok) return null;
  const data = await res.json();
  const list = (data && data.search) || [];
  if (!list.length) return null;
  const top = list[0];
  return {
    id: top.id,
    label: top.label || '',
    description: top.description || '',
    url: top.concepturi || '',
  };
}

async function wikidataEntityData(id) {
  if (!id) return null;
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(id)}.json`;
  const res = await fetchWithTimeout(url, { headers: { 'accept': 'application/json' }});
  if (!res.ok) return null;
  const data = await res.json();
  const ent = data && data.entities && data.entities[id];
  if (!ent) return null;
  return ent;
}

function extractWikidataBasics(ent, lang = 'en') {
  if (!ent) return null;
  const label = (ent.labels && (ent.labels[lang] || ent.labels.en || ent.labels.ko)) || null;
  const desc = (ent.descriptions && (ent.descriptions[lang] || ent.descriptions.en || ent.descriptions.ko)) || null;

  const claims = ent.claims || {};
  const coordSnak = claims.P625 && claims.P625[0] && claims.P625[0].mainsnak && claims.P625[0].mainsnak.datavalue;
  const coord = coordSnak && coordSnak.value ? { lat: coordSnak.value.latitude, lon: coordSnak.value.longitude } : null;

  const p31 = claims.P31 && claims.P31[0] && claims.P31[0].mainsnak && claims.P31[0].mainsnak.datavalue;
  const instanceOf = p31 && p31.value && p31.value.id ? p31.value.id : null;

  const wiki = ent.sitelinks || {};
  const enwiki = wiki.enwiki ? wiki.enwiki.title : null;
  const kowiki = wiki.kowiki ? wiki.kowiki.title : null;

  return {
    id: ent.id,
    label: label ? label.value : '',
    description: desc ? desc.value : '',
    instanceOf,
    coord,
    wikipedia: { en: enwiki, ko: kowiki },
  };
}

async function wikipediaSummary(title, lang = 'en') {
  if (!title) return null;
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetchWithTimeout(url, { headers: { 'accept': 'application/json' }});
  if (!res.ok) return null;
  const data = await res.json();
  return {
    title: data.title || title,
    extract: data.extract || '',
    url: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || '',
    thumbnail: (data.thumbnail && data.thumbnail.source) || '',
  };
}

async function wikimediaPageImage(title, lang = 'en') {
  if (!title) return null;
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=640&origin=*`;
  const res = await fetchWithTimeout(url, { headers: { 'accept': 'application/json' }});
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
  const p = pages && pages[0];
  if (!p || !p.thumbnail) return null;
  return { source: p.thumbnail.source, width: p.thumbnail.width, height: p.thumbnail.height };
}

// ------------------------------
// Signals collectors (public)
// ------------------------------
async function nominatimGeocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'maru-search/2.2 (netlify)'
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const top = data[0];
  const lat = parseFloat(top.lat);
  const lon = parseFloat(top.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    display_name: top.display_name || '',
    lat, lon,
    osm_type: top.osm_type || '',
    osm_id: top.osm_id || '',
    type: top.type || '',
  };
}

async function openMeteoWeather(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  const res = await fetchWithTimeout(url, { headers: { 'accept': 'application/json' }});
  if (!res.ok) return null;
  const data = await res.json();
  return data || null;
}

// ------------------------------
// Entity type heuristics + actions
// ------------------------------
function guessEntityType(q, wikidataBasics) {
  const s = q.toLowerCase();
  if (/(weather|날씨|기온)/i.test(s)) return 'weather_query';
  if (/(map|지도|위치|how to get|route|길찾기)/i.test(s)) return 'map_query';

  if (wikidataBasics && wikidataBasics.instanceOf) {
    const i = wikidataBasics.instanceOf;
    if (i === 'Q515') return 'city';
    if (i === 'Q6256') return 'country';
    if (i === 'Q5') return 'person';
    if (i === 'Q43229') return 'organization';
  }
  return 'unknown';
}

function buildActions(entityType, q) {
  const base = [
    { type: 'web', label: 'Open web results', query: q },
  ];
  if (entityType === 'city' || entityType === 'country') {
    base.unshift({ type: 'map', label: 'Open map', query: q });
    base.unshift({ type: 'weather', label: 'Check weather', query: q });
  }
  if (entityType === 'person') base.unshift({ type: 'bio', label: 'Biography', query: q });
  if (entityType === 'organization') base.unshift({ type: 'official', label: 'Official site', query: q });
  return base;
}

// ------------------------------
// Aggregation pipeline (request-driven + fan-out)
// ------------------------------
async function aggregateV22(q, limit, mode) {
  const query = normalizeQuery(q);
  const meta = { version: VERSION, limit, mode, ts: new Date().toISOString() };

  const ck = cacheKey("agg", { query, limit, mode });
  const cached = cacheGet(ck);
  if (cached) return cached;

  const t0 = nowMs();

  // 1) Web fan-out (NAVER + Google 병렬)
  const { sourcesTried: webSourcesTried, webItems } = await webSearchFanout(query, limit).catch(() => ({ sourcesTried: ['fanout:error'], webItems: [] }));

  // 2) Knowledge/entity + 3) Signals in parallel (unchanged)
  const settled = await Promise.allSettled([
    (async () => {
      const wdTop = await wikidataSearchEntity(query, 'en').catch(() => null);
      const wdEnt = wdTop ? await wikidataEntityData(wdTop.id).catch(() => null) : null;
      const wdBasics = extractWikidataBasics(wdEnt, 'en');

      const wikiTitleEn = wdBasics && wdBasics.wikipedia && wdBasics.wikipedia.en;
      const wikiTitleKo = wdBasics && wdBasics.wikipedia && wdBasics.wikipedia.ko;

      const [wikiEn, wikiKo] = await Promise.allSettled([
        wikiTitleEn ? wikipediaSummary(wikiTitleEn, 'en') : Promise.resolve(null),
        wikiTitleKo ? wikipediaSummary(wikiTitleKo, 'ko') : Promise.resolve(null),
      ]).then(r => r.map(x => x.status === 'fulfilled' ? x.value : null));

      const img = (wikiEn && wikiEn.thumbnail) ? { source: wikiEn.thumbnail } :
                  (wikiKo && wikiKo.thumbnail) ? { source: wikiKo.thumbnail } :
                  (wikiTitleEn ? await wikimediaPageImage(wikiTitleEn, 'en').catch(() => null) : null);

      return { wdTop, wdBasics, wikiEn, wikiKo, img };
    })(),

    (async () => {
      const geo = await nominatimGeocode(query).catch(() => null);
      const coord = geo ? { lat: geo.lat, lon: geo.lon } : null;
      const weather = coord ? await openMeteoWeather(coord.lat, coord.lon).catch(() => null) : null;
      const map = coord ? {
        lat: coord.lat, lon: coord.lon,
        osm: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(coord.lat)}&mlon=${encodeURIComponent(coord.lon)}#map=11/${encodeURIComponent(coord.lat)}/${encodeURIComponent(coord.lon)}`
      } : null;
      return { geo, coord, weather, map };
    })()
  ]);

  const kn = settled[0].status === 'fulfilled' ? settled[0].value : { wdTop: null, wdBasics: null, wikiEn: null, wikiKo: null, img: null };
  const sig = settled[1].status === 'fulfilled' ? settled[1].value : { geo: null, coord: null, weather: null, map: null };

  let coord = (kn.wdBasics && kn.wdBasics.coord) ? kn.wdBasics.coord : sig.coord;
  let geo = sig.geo;
  let weather = sig.weather;
  let map = sig.map;

  if (coord && (!weather || !map)) {
    if (!weather) weather = await openMeteoWeather(coord.lat, coord.lon).catch(() => null);
    if (!map) map = {
      lat: coord.lat, lon: coord.lon,
      osm: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(coord.lat)}&mlon=${encodeURIComponent(coord.lon)}#map=11/${encodeURIComponent(coord.lat)}/${encodeURIComponent(coord.lon)}`
    };
  }

  const entityType = guessEntityType(query, kn.wdBasics);
  const entity = {
    type: entityType,
    name: (kn.wdBasics && kn.wdBasics.label) || (kn.wdTop && kn.wdTop.label) || query,
    summary: (kn.wdBasics && kn.wdBasics.description) || (kn.wdTop && kn.wdTop.description) || '',
    images: (kn.img && kn.img.source) ? [kn.img.source] : [],
    official: {},
    wikidata: kn.wdBasics ? { id: kn.wdBasics.id, url: kn.wdTop ? kn.wdTop.url : '' } : (kn.wdTop ? { id: kn.wdTop.id, url: kn.wdTop.url } : {}),
    coord: coord || null,
    geo: geo || null,
  };

  const knowledge = {
    wikipedia: { en: kn.wikiEn || null, ko: kn.wikiKo || null },
    wikidata: kn.wdBasics ? kn.wdBasics : (kn.wdTop ? kn.wdTop : null),
  };

  const media = {
    images: entity.images.map(u => ({ url: u, source: 'wikipedia' })),
    videos: [],
  };

  const signals = {
    weather: weather || null,
    map: map || null,
  };

  const actions = buildActions(entityType, query);

  // 4) Core scoring (optional) - unchanged
  let rankedWeb = webItems;
  if (Core && typeof Core.scoreItem === "function") {
    rankedWeb = rankedWeb.map(it => ({ ...it, _coreScore: Core.scoreItem(it) }))
                         .sort((a, b) => (b._coreScore || 0) - (a._coreScore || 0));
  }

  // 5) Backward compatible flat list for search.js (items/results)
  // NOTE: source는 각 아이템별 실제 출처(naver/google)로 유지
  const legacyItems = rankedWeb.map(it => ({
    title: it.title,
    link: it.url,
    snippet: it.summary,
    type: it.type || 'web',
    source: it.source || 'web',
  }));

  const out = {
    status: 'ok',
    engine: 'maru-search',
    version: VERSION,
    query: query,

    entity,
    knowledge,
    media,
    web: rankedWeb,
    signals,
    actions,

    meta: {
      ...meta,
      sources: webSourcesTried,
      count: legacyItems.length,
      timingMs: { total: nowMs() - t0 },
      cache: false,
    },

    items: legacyItems,
    results: legacyItems,
  };

  cacheSet(ck, { ...out, meta: { ...out.meta, cache: true } });
  return out;
}

// ------------------------------
// Netlify handler
// ------------------------------
exports.handler = async (event) => {
  try {
    const { q, limit, mode } = pickParams(event);

    if (mode === 'schema') {
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        schema: {
          query: 'string',
          entity: { type: 'string', name: 'string', summary: 'string', images: 'string[]', official: 'object', coord: '{lat,lon}|null' },
          knowledge: { wikipedia: 'object', wikidata: 'object' },
          media: { images: 'array', videos: 'array' },
          web: 'array',
          signals: { weather: 'object|null', map: 'object|null' },
          actions: 'array',
          items: 'array (legacy)',
          results: 'array (legacy)',
        }
      });
    }

    if (!q) {
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        query: '',
        items: [],
        results: [],
        meta: { count: 0, limit },
      });
    }

    if (Core && typeof Core.validateQuery === "function") {
      if (!Core.validateQuery(q)) {
        return ok({ status: "fail", message: "INVALID_QUERY" });
      }
    }

    const aggregated = await aggregateV22(q, limit, mode);
    return ok(aggregated);

  } catch (e) {
    return fail('Search failed', String((e && e.message) || e));
  }
};

// ------------------------------
// Internal dispatcher for bridge (non-HTTP call)
// ------------------------------
async function maruSearchDispatcher(req = {}) {
  const q = String(req.q || req.query || "").trim();
  const limit = req.limit;
  const mode = req.mode || 'search';
  const event = { queryStringParameters: { q, limit, mode } };
  const res = await exports.handler(event);
  const parsed = await (async () => {
    try { return JSON.parse(res.body || '{}'); } catch (_) { return null; }
  })();
  return parsed || { status: "fail", message: "BAD_JSON" };
}

exports.maruSearchDispatcher = maruSearchDispatcher;
