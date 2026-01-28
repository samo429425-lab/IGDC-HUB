/**
 * netlify/functions/maru-search.js
 * ------------------------------------------------------------
 * MARU SEARCH v2 (Aggregator / Future-ready)
 *
 * Goals:
 * - Expand-only, backward compatible with search.js (items/results)
 * - Produce rich aggregated result: entity/knowledge/media/signals/actions
 *
 * Primary web sources:
 * - NAVER Search API (preferred when configured)
 * - Google Custom Search (fallback when configured)
 *
 * Public knowledge sources (no keys required):
 * - Wikidata API (wbsearchentities + Special:EntityData)
 * - Wikipedia REST summary (optional)
 * - Wikimedia PageImages (optional)
 * - OpenStreetMap Nominatim (geocoding)
 * - Open-Meteo (weather)
 *
 * Env:
 * - NAVER_API_KEY, NAVER_CLIENT_SECRET
 * - optional: GOOGLE_API_KEY, GOOGLE_CSE_ID
 */

'use strict';

const VERSION = '2.0.0';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

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
  return ok(

// ===== FAN-OUT 5 hook (source-specific + RU) =====
try{
  if (typeof fanoutCollect === 'function') {
    const baseQ = query || q;
    const stratQueries = expandSourceStrategies(baseQ);
    const tasks = stratQueries.map(sq => fanoutCollect(sq));
    const settled = await Promise.allSettled(tasks);
    const merged = [];
    for (const s of settled){
      if (s.status === 'fulfilled' && Array.isArray(s.value)){
        merged.push(...s.value);
      }
    }
    if (merged.length){
      items = dedupeByUrl([...(items || []), ...merged]);
      results = items;
    }
  }
}catch(e){}
// ===== /FAN-OUT 5 hook =====
{
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

async function safeJson(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch (_) { return null; }
}

function toWebItem(r, source) {
  return {
    type: r.type || 'web',
    title: r.title || '',
    summary: r.snippet || r.summary || '',
    url: r.link || r.url || '',
    source,
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

// ------------------------------
// Web search collectors
// ------------------------------
async function naverSearch(q, limit) {
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(q)}&display=${limit}`;
  const res = await fetch(url, {
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
  const res = await fetch(url);
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

// ------------------------------
// Entity / Knowledge collectors (public)
// ------------------------------
async function wikidataSearchEntity(q, lang = 'en') {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=${encodeURIComponent(lang)}&format=json&limit=5&origin=*`;
  const res = await fetch(url, { headers: { 'accept': 'application/json' }});
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
  const res = await fetch(url, { headers: { 'accept': 'application/json' }});
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
  // P625 coordinate location
  const coordSnak = claims.P625 && claims.P625[0] && claims.P625[0].mainsnak && claims.P625[0].mainsnak.datavalue;
  const coord = coordSnak && coordSnak.value ? { lat: coordSnak.value.latitude, lon: coordSnak.value.longitude } : null;

  // P31 instance of
  const p31 = claims.P31 && claims.P31[0] && claims.P31[0].mainsnak && claims.P31[0].mainsnak.datavalue;
  const instanceOf = p31 && p31.value && p31.value.id ? p31.value.id : null;

  // sitelinks wikipedia
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
  const res = await fetch(url, { headers: { 'accept': 'application/json' }});
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
  const res = await fetch(url, { headers: { 'accept': 'application/json' }});
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
  const res = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'maru-search/2.0 (netlify)' }});
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
  const res = await fetch(url, { headers: { 'accept': 'application/json' }});
  if (!res.ok) return null;
  const data = await res.json();
  return data || null;
}

// ------------------------------
// Entity type heuristics + actions
// ------------------------------
function guessEntityType(q, wikidataBasics) {
  // Simple heuristics: will evolve; keep backward compatible
  const s = q.toLowerCase();
  if (/(weather|날씨|기온)/i.test(s)) return 'weather_query';
  if (/(map|지도|위치|how to get|route|길찾기)/i.test(s)) return 'map_query';

  // If wikidata instanceOf available, keep generic mapping (expand later)
  if (wikidataBasics && wikidataBasics.instanceOf) {
    // Q515 = city, Q6256 = country, Q5 = human, Q43229 = organization (not exhaustive)
    const i = wikidataBasics.instanceOf;
    if (i === 'Q515') return 'city';
    if (i === 'Q6256') return 'country';
    if (i === 'Q5') return 'person';
    if (i === 'Q43229') return 'organization';
  }
  // fallback
  return 'unknown';
}

function buildActions(entityType, q) {
  // Keep short; front can render later
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
// Aggregation pipeline
// ------------------------------
async function aggregateV2(q, limit, mode) {
  const query = normalizeQuery(q);
  const meta = { version: VERSION, limit, mode, ts: new Date().toISOString() };

  // 1) Web results (primary)
  const webSourcesTried = [];
  let webRaw = [];
  let usedSource = null;

  try {
    const n = await naverSearch(query, limit);
    if (n && n.results) {
      usedSource = 'naver';
      webSourcesTried.push('naver');
      webRaw = n.results;
    } else {
      webSourcesTried.push('naver:disabled');
    }
  } catch (e) {
    webSourcesTried.push('naver:error');
  }

  if (!webRaw.length) {
    try {
      const g = await googleCseSearch(query, limit);
      if (g && g.results) {
        usedSource = 'google';
        webSourcesTried.push('google');
        webRaw = g.results;
      } else {
        webSourcesTried.push('google:disabled');
      }
    } catch (e) {
      webSourcesTried.push('google:error');
    }
  }

  const webItems = uniqBy(
    webRaw.map(r => toWebItem(r, usedSource || r.payload?.source || 'unknown')).filter(it => it.url),
    it => it.url
  );

  // 2) Knowledge / entity
  const wdTop = await wikidataSearchEntity(query, 'en').catch(() => null);
  const wdEnt = wdTop ? await wikidataEntityData(wdTop.id).catch(() => null) : null;
  const wdBasics = extractWikidataBasics(wdEnt, 'en');

  // prefer wikipedia title from wikidata
  const wikiTitleEn = wdBasics && wdBasics.wikipedia && wdBasics.wikipedia.en;
  const wikiTitleKo = wdBasics && wdBasics.wikipedia && wdBasics.wikipedia.ko;

  const wikiEn = wikiTitleEn ? await wikipediaSummary(wikiTitleEn, 'en').catch(() => null) : null;
  const wikiKo = wikiTitleKo ? await wikipediaSummary(wikiTitleKo, 'ko').catch(() => null) : null;

  const img = (wikiEn && wikiEn.thumbnail) ? { source: wikiEn.thumbnail } :
              (wikiKo && wikiKo.thumbnail) ? { source: wikiKo.thumbnail } :
              (wikiTitleEn ? await wikimediaPageImage(wikiTitleEn, 'en').catch(() => null) : null);

  // 3) Signals: map/weather (use wikidata coord first, else nominatim)
  let coord = wdBasics && wdBasics.coord ? wdBasics.coord : null;
  let geo = null;
  if (!coord) {
    geo = await nominatimGeocode(query).catch(() => null);
    if (geo) coord = { lat: geo.lat, lon: geo.lon };
  }

  const weather = coord ? await openMeteoWeather(coord.lat, coord.lon).catch(() => null) : null;
  const map = coord ? {
    lat: coord.lat, lon: coord.lon,
    osm: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(coord.lat)}&mlon=${encodeURIComponent(coord.lon)}#map=11/${encodeURIComponent(coord.lat)}/${encodeURIComponent(coord.lon)}`
  } : null;

  const entityType = guessEntityType(query, wdBasics);
  const entity = {
    type: entityType,
    name: (wdBasics && wdBasics.label) || (wdTop && wdTop.label) || query,
    summary: (wdBasics && wdBasics.description) || (wdTop && wdTop.description) || '',
    images: img && img.source ? [img.source] : [],
    official: {},
    wikidata: wdBasics ? { id: wdBasics.id, url: wdTop ? wdTop.url : '' } : (wdTop ? { id: wdTop.id, url: wdTop.url } : {}),
    coord: coord || null,
    geo: geo || null,
  };

  const knowledge = {
    wikipedia: { en: wikiEn || null, ko: wikiKo || null },
    wikidata: wdBasics ? wdBasics : (wdTop ? wdTop : null),
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

  // 4) Core (optional scoring)
  let rankedWeb = webItems;
  if (Core && typeof Core.scoreItem === "function") {
    rankedWeb = rankedWeb.map(it => ({ ...it, _coreScore: Core.scoreItem(it) }))
                         .sort((a,b) => (b._coreScore||0) - (a._coreScore||0));
  }

  // 5) Backward compatible flat list for search.js (items/results)
  // Keep same shape expected by current search.js: title/link/snippet
  const legacyItems = rankedWeb.map(it => ({
    title: it.title,
    link: it.url,
    snippet: it.summary,
    type: it.type || 'web',
    source: it.source || usedSource || 'web',
  }));

  return {
    status: 'ok',
    engine: 'maru-search',
    version: VERSION,
    query: query,

    // v2 aggregated schema
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
    },

    // backward compatible
    items: legacyItems,
    results: legacyItems,
  };
}

// ------------------------------
// Netlify handler
// ------------------------------
exports.handler = async (event) => {
  try {
    const { q, limit, mode } = pickParams(event);

    // schema endpoint (optional)
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

    // validate query through Core if available
    if (Core && typeof Core.validateQuery === "function") {
      if (!Core.validateQuery(q)) {
        return ok({ status: "fail", message: "INVALID_QUERY" });
      }
    }

    const aggregated = await aggregateV2(q, limit, mode);
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


/* ===== FAN-OUT 5 (source-specific strategies + RU) ===== */
// Source-focused query variants (no judgment, expand-only)
const FANOUT_SOURCE_QUERIES = {
  encyclopedia: (q) => [
    q,
    `${q} wikipedia`,
    `${q} wiki`,
  ],
  government: (q) => [
    q,
    `${q} official`,
    `${q} site:gov`,
  ],
  news: (q) => [
    q,
    `${q} news`,
    `${q} press`,
  ],
  academic: (q) => [
    q,
    `${q} research`,
    `${q} study`,
  ]
};

// Russian (RU) canonical expansion
function expandRU(baseQuery){
  if (!baseQuery) return [];
  // Mechanical RU hints (no translation decision)
  return [
    baseQuery,
    `${baseQuery} официальный`,
    `${baseQuery} википедия`,
    `${baseQuery} новости`
  ];
}

function expandSourceStrategies(baseQuery){
  const out = new Set();
  if (!baseQuery) return [];
  Object.values(FANOUT_SOURCE_QUERIES).forEach(fn => {
    try{
      fn(baseQuery).forEach(v => out.add(v));
    }catch(e){}
  });
  // RU additions
  expandRU(baseQuery).forEach(v => out.add(v));
  return Array.from(out);
}
/* ===== /FAN-OUT 5 ===== */
