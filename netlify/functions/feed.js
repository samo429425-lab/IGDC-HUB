
// === Begin: Light content safety filter (gaming/illegal/adult) ===
let __PSOM_BLOCK = { blockedDomains: [], blockedKeywords: [] };
try {
  const fs = require('fs');
  const path = require('path');
  const candidate = path.join(__dirname, 'psom.json');
  const raw = fs.readFileSync(candidate, 'utf-8');
  __PSOM_BLOCK = JSON.parse(raw);
} catch(e) {
  __PSOM_BLOCK = __PSOM_BLOCK || { blockedDomains: [], blockedKeywords: [] };
}

// Normalize helpers
const __norm = (s)=> (typeof s === 'string' ? s.toLowerCase() : '');
const __in = (s, arr)=> {
  const t = __norm(s);
  return !!arr.find(k => t.includes(k.toLowerCase()));
};
const __urlHitsBlockedDomain = (u)=>{
  const t = __norm(u);
  return !!__PSOM_BLOCK.blockedDomains.find(dom => t.includes(dom.toLowerCase()));
};
const __textHasBlockedKeyword = (t)=> __in(t, __PSOM_BLOCK.blockedKeywords);
const __extractUrl = (item)=>{
  const keys = ['url','href','link','detailUrl','embedUrl','videoUrl','buyUrl'];
  for (const k of keys) if (item && item[k]) return item[k];
  return '';
};
const __extractText = (item)=>{
  const keys = ['title','name','desc','description','summary','tag','tags'];
  let acc = '';
  for (const k of keys) {
    const v = item && item[k];
    if (!v) continue;
    acc += (typeof v === 'string') ? (' ' + v) : (Array.isArray(v) ? (' ' + v.join(' ')) : '');
  }
  return acc.trim();
};
const __isBlockedItem = (item)=>{
  const url = __extractUrl(item);
  const text = __extractText(item);
  return __urlHitsBlockedDomain(url) || __textHasBlockedKeyword(text);
};
const __filterList = (arr)=> Array.isArray(arr) ? arr.filter(it => !__isBlockedItem(it)) : arr;
const __deepFilter = (payload)=>{
  if (!payload || typeof payload !== 'object') return payload;
  // rightPanel.items
  if (payload.rightPanel && Array.isArray(payload.rightPanel.items)) {
    payload.rightPanel.items = __filterList(payload.rightPanel.items);
  }
  // data or data.items
  if (Array.isArray(payload.data)) payload.data = __filterList(payload.data);
  if (payload.data && Array.isArray(payload.data.items)) payload.data.items = __filterList(payload.data.items);
  // socialnetwork grid.sections[].items
  if (payload.grid && Array.isArray(payload.grid.sections)) {
    payload.grid.sections = payload.grid.sections.map(sec => {
      if (Array.isArray(sec.items)) sec.items = __filterList(sec.items);
      return sec;
    });
  }
  return payload;
};
// === End: Light content safety filter (gaming/illegal/adult) ===


/**
 * feed.js — Geo-aware feed function with socialnetwork validation
 * Netlify Function (ESM compatible via Node 18+)
 *
 * Features:
 * - Page routing: home, mediahub, distributionhub, socialnetwork, tour, networkhub, donation
 * - Source priority: Netlify Blobs ('feed.data') → /assets/hero/psom.json fallback
 * - Lang support: ko|en|zh via ?lang=
 * - Geo mapping: country→region→_default using psom.json.geo_rules.thumbnail_mapping
 * - Donation page excluded from geo rules
 * - Socialnetwork filters: platform-root ban, platform+handle dedupe, pagination (initial/pageSize),
 *   optional silent auth hints (publicAccess/requiresAuth/silentConnect/fallbackHref passthrough)
 */

const BLOB_NS = 'feed';
const BLOB_KEY = 'data';

// Lazy import to avoid build complaints if blobs not configured
async function getBlobClient() {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: BLOB_NS });
  } catch (_) {
    return null;
  }
}

// Small helpers
const ok = (body, headers = {}) => ({
  statusCode: 200,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    ...headers,
  },
  body: JSON.stringify(body),
});

const noContent = () => ({ statusCode: 204, body: '' });
const bad = (msg, code = 400) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ error: msg }),
});

// Geo helpers (Netlify passes x-country/x-region when enabled)
function getGeo(event) {
  const q = new URLSearchParams(event.queryStringParameters || {});
  const country =
    (q.get('country') || event.headers['x-country'] || event.headers['x-country-code'] || '').toUpperCase() || null;
  const region =
    (q.get('region') || event.headers['x-region'] || event.headers['x-geo-region'] || '').toUpperCase() || null;
  const lang = (q.get('lang') || 'en').toLowerCase();
  return __deepFilter({ country, region, lang });
}

function selectGeoBucket(sectionGeo, country, region) {
  if (!sectionGeo || typeof sectionGeo !== 'object') return [];
  if (country && sectionGeo[country]) return sectionGeo[country];
  if (region && sectionGeo[region]) return sectionGeo[region];
  if (sectionGeo._default) return sectionGeo._default;
  // If structure is simple {items:[]} style
  if (Array.isArray(sectionGeo)) return sectionGeo;
  return [];
}

// Load psom.json (fallback) from site assets
async function loadPSOM() {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  if (!base) throw new Error('Base URL is not available for fetching psom.json');
  const url = `${base.replace(/\/+$/,'')}/assets/hero/psom.json`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`Failed to fetch psom.json: ${res.status}`);
  return await res.json();
}

// Load from Blobs first, fallback to PSOM
async function loadFeedData() {
  // try blobs
  const store = await getBlobClient();
  if (store) {
    try {
      const blob = await store.get(BLOB_KEY, { type: 'json' });
      if (blob) return blob;
    } catch {}
  }
  // fallback
  return await loadPSOM();
}

// -------- Socialnetwork validators --------

const PLATFORM_ROOT_PATTERNS = [
  // youtube root (no /@handle or /watch)
  { host: /(^|\.)youtube\.com$/i, allow: [/\/@[^/]+/, /\/watch\?v=/, /\/shorts\//, /\/playlist\?list=/] },
  { host: /(^|\.)youtu\.be$/i, allow: [/\/[^/]+$/] },
  // instagram: require /p/ or /reel/ or profile /{username}/
  { host: /(^|\.)instagram\.com$/i, allow: [/\/p\//, /\/reel\//, /^\/[^/]+\/$/] },
  // twitter/x
  { host: /(^|\.)twitter\.com$/i, allow: [/\/status\//, /^\/[^/]+\/$/] },
  { host: /(^|\.)x\.com$/i, allow: [/\/status\//, /^\/[^/]+\/$/] },
  // reddit: require /r/ or /u/ or /comments/
  { host: /(^|\.)reddit\.com$/i, allow: [/\/r\//, /\/u\//, /\/comments\//] },
];

function isPlatformRoot(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname;
    const path = u.pathname;
    for (const rule of PLATFORM_ROOT_PATTERNS) {
      if (rule.host.test(host)) {
        const ok = rule.allow.some((re) => re.test(path + (u.search || '')));
        return !ok;
      }
    }
    // unknown hosts: treat as valid if path is not root
    return (path === '/' || path === '');
  } catch {
    return true; // invalid URLs are treated as root/invalid
  }
}

function dedupeCreators(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const key = (it.platform || '') + '::' + (it.handle || it.id || '');
    if (!key.trim()) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function validateCreators(items) {
  return dedupeCreators((items || []).filter((it) => !isPlatformRoot(it.href)));
}

// Paginate for infinite scroll
function paginate(items, initial=18, pageSize=18, page=1) {
  if (!Array.isArray(items)) return [];
  const start = page === 1 ? 0 : (initial + (page-2)*pageSize);
  const count = page === 1 ? initial : pageSize;
  return items.slice(0, initial + (page-1)*pageSize).slice(start, start + count);
}

// -------- Handler --------

export async function handler(event) {
  try {
    const q = new URLSearchParams(event.queryStringParameters || {});
    const page = (q.get('page') || 'home').toLowerCase();
    const section = q.get('section') || null;
    const pageNum = Math.max(1, parseInt(q.get('p') || '1', 10));
    const { country, region, lang } = getGeo(event);

    // Load data
    const data = await loadFeedData();

    // Donation page exclusion from geo rules
    const donationPages = new Set([
      'donation','donations','donationhub','donation.html','donations.html','donationhub.html','/donation','/donations','/donationhub'
    ]);

    // Geo rules
    const rules = (data.geo_rules && data.geo_rules.thumbnail_mapping) || null;
    const applyGeo = rules && rules.enabled && !donationPages.has(page);

    // Route per page
    if (page === 'socialnetwork') {
      const meta = data.socialnetwork_meta || {};
      const gridMeta = meta.infiniteScroll || { initial: 18, pageSize: 18 };
      const initial = Number(gridMeta.initial || 18);
      const pageSize = Number(gridMeta.pageSize || 18);

      // Sections grid
      const grid = (data.socialnetwork && data.socialnetwork.grid) || {};
      const sections = Array.isArray(grid.sections) ? grid.sections : [];
      const outSections = sections.map((s) => {
        let items = [];
        const geo = s.geo || {};
        const base = applyGeo ? selectGeoBucket(geo, country, region) : (geo._default || []);
        items = validateCreators(base);
        return __deepFilter({ id: s.id, title: s.title, items: paginate(items, initial, pageSize, pageNum) });
      });

      // Right panel products (geo-aware weekly)
      const right = (data.socialnetwork && data.socialnetwork.rightPanel) || null;
      let rightItems = [];
      if (right && right.geo) {
        rightItems = applyGeo ? selectGeoBucket(right.geo, country, region) : (right.geo._default || []);
      }

      return ok({
        page, lang, country, region,
        grid: outSections,
        rightPanel: { title: right?.title || '인기 아이템', type: right?.type || 'product', items: rightItems },
        pagination: { page: pageNum, initial, pageSize },
        meta: { refreshedAt: data.updatedAt || null }
      });
    }

    // Generic pages
    const pages = ['home','mediahub','distributionhub','tour','networkhub','donation'];
    if (!pages.includes(page)) {
      return bad(`Unsupported page: ${page}`, 404);
    }

    const payload = data[page];
    if (!payload) return noContent();

    // For tour/networkhub rightPanel structure
    if (payload.rightPanel && payload.rightPanel.geo) {
      const items = applyGeo
        ? selectGeoBucket(payload.rightPanel.geo, country, region)
        : (payload.rightPanel.geo._default || []);
      return ok({
        page, lang, country, region,
        rightPanel: { title: payload.rightPanel.title, type: payload.rightPanel.type, items },
        meta: { refreshedAt: data.updatedAt || null }
      });
    }

    // For home/distributionhub generic structures, just return payload as-is
    return ok({ page, lang, country, region, data: payload, meta: { refreshedAt: data.updatedAt || null } });

  } catch (err) {
    return bad(err.message || 'Server error', 500);
  }
}
