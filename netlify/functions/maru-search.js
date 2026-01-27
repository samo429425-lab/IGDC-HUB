/**
 * netlify/functions/maru-search.js
 * v2.0 — External Search API First (A 단계)
 *
 * 목표:
 * - 외부 검색 API 결과(구글/네이버처럼 링크 목록)를 즉시 반환
 * - (옵션) 내부 feed(homeproducts)도 함께 병렬로 섞어 반환
 *
 * 지원 (둘 중 하나만 있어도 됨):
 * - SERPER_API_KEY  : Serper.dev (Google-like)  ✅ 추천(간단)
 * - BING_API_KEY    : Microsoft Bing Web Search
 *
 * Netlify 환경변수:
 * - SERPER_API_KEY=...
 * - (또는) BING_API_KEY=...
 * - (옵션) BING_ENDPOINT=https://api.bing.microsoft.com/v7.0/search
 * - (옵션) INCLUDE_INTERNAL_FEED=true
 */

'use strict';

const VERSION = '2.0.0';
const DEFAULT_LIMIT = 10;

function now() { return Date.now(); }
function norm(s) { return String(s || '').trim(); }
function toInt(v, d){ const n = parseInt(v,10); return Number.isFinite(n) && n>0 ? n : d; }
function pickLang(event){
  // optional: use Accept-Language
  const al = (event.headers && (event.headers['accept-language'] || event.headers['Accept-Language'])) || '';
  return al.split(',')[0]?.trim() || 'en';
}

function ok(body){
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function err(message, detail){
  return ok({
    status: 'error',
    engine: 'maru-search',
    version: VERSION,
    message,
    detail: detail || null,
    timestamp: now()
  });
}

async function serperSearch(q, limit, lang){
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q,
      num: Math.min(limit, 20),
      gl: 'kr', // 기본 KR (원하면 나중에 옵션화)
      hl: (lang || 'en').slice(0,2)
    })
  });

  if (!res.ok) throw new Error(`SERPER_HTTP_${res.status}`);
  const data = await res.json();

  const items = [];
  // organic results
  if (Array.isArray(data.organic)) {
    for (const r of data.organic.slice(0, limit)) {
      items.push({
        id: r.link || r.title || `serper-${items.length}`,
        type: 'web',
        title: r.title || '',
        summary: r.snippet || '',
        url: r.link || '',
        source: 'serper',
        score: 0.9,
        payload: { position: r.position ?? null }
      });
    }
  }
  // news (if provided)
  if (Array.isArray(data.news)) {
    for (const r of data.news.slice(0, Math.max(0, limit - items.length))) {
      items.push({
        id: r.link || r.title || `serper-news-${items.length}`,
        type: 'news',
        title: r.title || '',
        summary: r.snippet || '',
        url: r.link || '',
        source: 'serper',
        score: 0.85,
        payload: { date: r.date ?? null, source: r.source ?? null }
      });
    }
  }
  return { provider: 'serper', items };
}

async function bingSearch(q, limit){
  const key = process.env.BING_API_KEY;
  if (!key) return null;

  const endpoint = process.env.BING_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/search';
  const url = `${endpoint}?q=${encodeURIComponent(q)}&count=${Math.min(limit, 20)}`;

  const res = await fetch(url, {
    headers: { 'Ocp-Apim-Subscription-Key': key }
  });
  if (!res.ok) throw new Error(`BING_HTTP_${res.status}`);
  const data = await res.json();

  const items = [];
  const web = data.webPages && Array.isArray(data.webPages.value) ? data.webPages.value : [];
  for (const r of web.slice(0, limit)) {
    items.push({
      id: r.url || r.name || `bing-${items.length}`,
      type: 'web',
      title: r.name || '',
      summary: r.snippet || '',
      url: r.url || '',
      source: 'bing',
      score: 0.9,
      payload: { dateLastCrawled: r.dateLastCrawled || null }
    });
  }
  return { provider: 'bing', items };
}

async function internalFeedSearch(event, q, limit){
  const include = String(process.env.INCLUDE_INTERNAL_FEED || '').toLowerCase() === 'true';
  if (!include) return { provider: 'feed', items: [] };

  // Call feed function (same site). Use Netlify URL if present.
  const base = process.env.URL || '';
  const res = await fetch(`${base}/.netlify/functions/feed?page=homeproducts`, { cache: 'no-store' });
  if (!res.ok) return { provider: 'feed', items: [] };
  const data = await res.json();

  const items = [];
  const needle = q.toLowerCase();

  if (Array.isArray(data.sections)) {
    for (const sec of data.sections) {
      if (!Array.isArray(sec.items)) continue;
      for (const it of sec.items) {
        const blob = JSON.stringify(it).toLowerCase();
        if (needle && !blob.includes(needle)) continue;

        items.push({
          id: it.url || it.id || it.title || `feed-${items.length}`,
          type: 'internal',
          title: it.title || it.name || 'Untitled',
          summary: it.description || it.summary || '',
          url: it.url || '',
          source: 'feed',
          score: 0.7,
          payload: { section: sec.id || null }
        });

        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }
  }
  return { provider: 'feed', items };
}

function mergeItems(primary, secondary, limit){
  const out = [];
  const seen = new Set();
  const push = (x) => {
    const key = x.url || x.id || x.title;
    if (!key) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(x);
  };

  for (const x of (primary || [])) push(x);
  for (const x of (secondary || [])) push(x);

  return out.slice(0, limit);
}

exports.handler = async function(event){
  const qs = event.queryStringParameters || {};
  const q = norm(qs.q || qs.query);
  const limit = toInt(qs.limit, DEFAULT_LIMIT);
  const lang = pickLang(event);

  if (!q) {
    return ok({
      status: 'ok',
      engine: 'maru-search',
      version: VERSION,
      query: q,
      timestamp: now(),
      items: [],
      meta: { count: 0, limit, sources: [] }
    });
  }

  try {
    // A 단계: 외부 검색 API (serper 우선, 없으면 bing)
    const ext = (await serperSearch(q, limit, lang)) || (await bingSearch(q, limit));
    if (!ext) {
      return err('No external search API key found', 'Set SERPER_API_KEY or BING_API_KEY in Netlify env.');
    }

    // (옵션) 내부 feed 병렬 결합
    const internal = await internalFeedSearch(event, q, limit);

    const items = mergeItems(ext.items, internal.items, limit);

    return ok({
      status: 'ok',
      engine: 'maru-search',
      version: VERSION,
      query: q,
      timestamp: now(),
      items,
      meta: {
        count: items.length,
        limit,
        sources: [ext.provider].concat(internal.items.length ? [internal.provider] : [])
      }
    });

  } catch (e) {
    return err('External search failed', String(e && e.message || e));
  }
};
