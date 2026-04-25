/**
 * netlify/functions/maru-search.js
 * ------------------------------------------------------------
 * MARU SEARCH — CANONICAL CAPABILITY CORE (A1.7.4)
 *
 * Goals (expand-only, no regressions):
 * - Keep existing API: exports.handler / exports.maruSearchDispatcher / items + results alias
 * - Add "Capability Layer" inside maru-search:
 *   - Canonical Result Object (thumbnail/mediaType/lang/source fields)
 *   - Resilience: timeouts, safe fetch, soft circuit-breaker (per function runtime)
 *   - Future-ready containers registry (web/snapshot/media/ai) without breaking current flow
 *
 * Notes:
 * - No hard dependency on external storage. "Snapshot/AI" containers are optional and safe-noop unless configured.
 */

'use strict';

// ===== CORE ENGINE INTEGRATION (EXPAND ONLY) =====
let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

const VERSION = 'A1.7.4-stable-mapping-gateway';
const DEFAULT_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 1000;
const DEFAULT_SUPPLY_LIMIT = 200;
const MAX_RETURN_LIMIT = 5000;
const SEARCH_BANK_PAGE_SIZE = 100;
const MAX_BANK_SCAN = 10000;
const MIN_SEARCH_RESULTS = 500;

// ===== Runtime Cache Note =====
// Active per-runtime caching is handled by globalThis.__MARU_CACHE inside orchestrateSearch().
// The older QUERY_CACHE helper block was removed in A1.7.4 because it was unused.

// ===== Resilience (lightweight; safe on Netlify) =====
const CB = {
  // name -> { fails, openUntil }
  states: Object.create(null),
  maxFails: 4,
  coolDownMs: 25_000
};

function nowMs() { return Date.now(); }

function cbCanRun(name){
  const st = CB.states[name];
  if (!st) return true;
  if (!st.openUntil) return true;
  return nowMs() > st.openUntil;
}
function cbOnSuccess(name){
  const st = CB.states[name];
  if (!st) return;
  st.fails = 0;
  st.openUntil = 0;
}
function cbOnFail(name){
  const st = CB.states[name] || (CB.states[name] = { fails: 0, openUntil: 0 });
  st.fails += 1;
  if (st.fails >= CB.maxFails) {
    st.openUntil = nowMs() + CB.coolDownMs;
  }
}

async function fetchWithTimeout(url, options, timeoutMs){
  const ms = Math.max(500, Math.min(12_000, timeoutMs || 8_000));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try{
    return await fetch(url, { ...(options || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}


function eventBaseUrl(event){
  try{
    const headers = (event && event.headers) || {};
    const host = headers['x-forwarded-host'] || headers['host'] || "";
    const proto = headers['x-forwarded-proto'] || "https";
    if(!host) return "";
    return `${proto}://${host}`.replace(/\/+$/, '');
  }catch(e){
    return "";
  }
}

function normalizeBaseUrl(v){
  const s = String(v || '').trim().replace(/\/+$/, '');
  if(!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function resolveRuntimeBaseUrl(event){
  return normalizeBaseUrl(process.env.DEPLOY_URL || process.env.URL || process.env.SITE_URL) || eventBaseUrl(event);
}

// ===== HTTP helpers =====
function ok(body) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'Vary': 'Accept-Language, Query-String',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function fail(message, detail) {
  return ok({
    status: 'error',
    engine: 'maru-search',
    version: VERSION,
    message,
    detail: detail || null,
  });
}

function truthyParam(v){
  const t = String(v == null ? '' : v).trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

function clampIntValue(n, d, min, max){
  const x = parseInt(n, 10);
  const v = Number.isFinite(x) ? x : d;
  return Math.max(min, Math.min(max, v));
}

function parseLimitParam(raw, mode){
  const r = String(raw == null ? '' : raw).trim().toLowerCase();
  if (r === 'all' || r === 'full' || r === 'max') return MAX_RETURN_LIMIT;
  const fallback = mode === 'search' ? DEFAULT_SEARCH_LIMIT : DEFAULT_SUPPLY_LIMIT;
  return clampIntValue(raw, fallback, 1, MAX_RETURN_LIMIT);
}

function normalizeLangCode(v){
  const raw = String(v || '').trim().toLowerCase().replace('_','-');
  if (!raw) return null;
  if (raw === 'zht' || raw === 'zh-hant' || raw === 'zh-tw' || raw === 'zh-hk' || raw === 'zh-mo') return 'zht';
  if (raw === 'zh-hans' || raw === 'zh-cn' || raw === 'zh-sg' || raw === 'zh') return 'zh';
  const base = raw.split('-')[0];
  const supported = new Set(['ko','en','zh','zht','ja','es','fr','de','ru','pt','it','ar','vi','th','id','hi','tr','ta','sw','ur','bn','fa','hu','ms','nl','pl','sv','tl','uk','uz']);
  return supported.has(base) ? base : raw.slice(0, 12);
}

function pickQ(event) {
  const qs = event.queryStringParameters || {};
  const q = String(qs.q || qs.query || '').trim();
  const explicitMode = String(qs.mode || '').trim().toLowerCase();
  const hasSupplyHint = !!(
    qs.channel || qs.section || qs.bind_section || qs.page || qs.route || qs.psom_key ||
    qs.category || qs.semantic_category || qs.tags || qs.tag
  );
  const mode = explicitMode || (q ? 'search' : (hasSupplyHint ? 'feed' : 'search'));
  const limit = parseLimitParam(qs.limit || qs.max || qs.count, mode);

  const startRaw = parseInt(qs.start || 1, 10);
  const start = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 1;

  const offsetRaw = parseInt(qs.offset || 0, 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const lang = String(qs.lang || '').trim() || null;
  const uiLang = normalizeLangCode(qs.uiLang || qs.locale || qs.lang || qs.hl || '') || lang || null;
  const targetLang = normalizeLangCode(qs.targetLang || qs.contentLang || qs.filterLang || qs.searchLang || '') || null;

  return { q, limit, start, offset, mode, lang, uiLang, targetLang };
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, '');
}

// ===== Canonical Result helpers (Capability Layer) =====
function safeUrl(u){
  const s = String(u || '').trim();
  if (!s) return '';
  return s;
}

function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./,''); }
  catch(e){ return ''; }
}

function faviconOf(url){
  const d = domainOf(url);
  if (!d) return '';
  // Google S2 favicon service (works globally). Front can still override if needed.
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
}

function detectLangFromTextFallback(text){
  // VERY light heuristic; true language intelligence layer will replace this.
  const t = String(text || '');
  if (!t) return null;
  if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t)) return 'ko';
  if (/[ぁ-ゟ゠-ヿ]/.test(t)) return 'ja';
  if (/[一-龥]/.test(t)) return 'zh';
  if (/[А-Яа-яЁё]/.test(t)) return 'ru';
  return 'en';
}

function firstNonEmpty(...vals){
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return v;
  }
  return '';
}

function canonicalizeItem(it = {}, query){
  const p = (it && typeof it.payload === 'object') ? it.payload : {};
  const bind = (it && typeof it.bind === 'object' && it.bind) ? it.bind : {};

  const url = safeUrl(firstNonEmpty(it.url, it.link, it.href, p.url, p.link));
  const title = String(firstNonEmpty(it.title, it.name, p.title, p.name)).trim();
  const summary = String(firstNonEmpty(it.summary, it.snippet, it.description, p.summary, p.description)).trim();

  const explicitThumb = String(firstNonEmpty(
    it.thumbnail, it.thumb, it.image, it.image_url,
    p.thumb, p.thumbnail, p.image, p.image_url, p.og_image
  )).trim();
  const favicon = faviconOf(url);
  const thumbnail = explicitThumb || favicon;

  const lang =
    it.lang ||
    p.lang ||
    detectLangFromTextFallback(title + ' ' + summary) ||
    null;

  const mediaType =
    it.mediaType ||
    p.mediaType ||
    (it.type === 'image' ? 'image' : (it.type === 'video' ? 'video' : 'article'));

  const id = it.id || url || title || ('item-' + Math.random().toString(16).slice(2));
  const source = it.source || p.source || null;
  const channel = firstNonEmpty(it.channel, bind.page, p.channel);
  const section = firstNonEmpty(it.section, bind.section, p.section);
  const page = firstNonEmpty(it.page, bind.page, p.page);
  const psom_key = firstNonEmpty(it.psom_key, bind.psom_key, section, p.psom_key);
  const route = firstNonEmpty(it.route, bind.route, p.route);

  return {
    ...it,
    id,
    type: it.type || p.type || 'web',
    mediaType,
    title,
    summary,
    description: it.description !== undefined ? it.description : summary,
    url,
    link: it.link || url,
    source,
    lang,
    channel: channel || it.channel,
    section: section || it.section,
    page: page || it.page,
    psom_key: psom_key || it.psom_key,
    route: route || it.route,
    bind: {
      ...(it.bind && typeof it.bind === 'object' ? it.bind : {}),
      page: bind.page || page || channel || undefined,
      section: bind.section || section || undefined,
      psom_key: bind.psom_key || psom_key || undefined,
      route: bind.route || route || undefined
    },
    thumbnail,
    thumb: it.thumb || explicitThumb || thumbnail,
    image: it.image || p.image || p.image_url || '',
    tags: Array.isArray(it.tags) ? it.tags : (Array.isArray(p.tags) ? p.tags : []),
    score: typeof it.score === 'number' ? it.score : (typeof p.score === 'number' ? p.score : 0.9),
    payload: p
  };
}

function toStandardItems(arr, source) {
  return (Array.isArray(arr) ? arr : []).map((r, idx) => {
    const raw = (r && typeof r === 'object') ? r : {};
    const item = {
      ...raw,
      id: raw.id || raw.link || raw.url || raw.title || `${source}-${idx}`,
      type: raw.type || 'web',
      title: raw.title || raw.name || '',
      summary: raw.snippet || raw.summary || raw.description || '',
      url: raw.url || raw.link || raw.href || '',
      link: raw.link || raw.url || raw.href || '',
      source: raw.source || source,
      score: typeof raw.score === 'number' ? raw.score : 0.9,
      payload: raw.payload || {}
    };
    return canonicalizeItem(item, null);
  });
}

// ===== Runtime Routing / Dedup helpers =====
function parseAcceptLanguage(header){
  return String(header || '')
    .split(',')
    .map(x => x.trim().split(';')[0].toLowerCase())
    .filter(Boolean);
}

function detectRuntimeRegion(event, lang, q){
  try{
    const qs = (event && event.queryStringParameters) || {};
    const forcedRegion = String(qs.region || qs.geo || '').trim().toUpperCase();
    const forcedCountry = String(qs.country || '').trim().toUpperCase();
    if (forcedRegion) return forcedRegion;
    if (forcedCountry === 'KR') return 'KR';
    if (forcedCountry === 'US') return 'US';

    const headers = (event && event.headers) || {};
    const xfCountry = String(headers['x-country'] || headers['cf-ipcountry'] || headers['x-vercel-ip-country'] || '').trim().toUpperCase();
    if (xfCountry === 'KR') return 'KR';
    if (xfCountry === 'US') return 'US';

    const langs = [
      String(lang || '').toLowerCase(),
      ...parseAcceptLanguage(headers['accept-language'] || headers['Accept-Language'] || '')
    ].filter(Boolean);

    if (langs.some(x => x.startsWith('ko'))) return 'KR';
    if (langs.some(x => x.startsWith('en-us'))) return 'US';
    if (langs.some(x => x.startsWith('en'))) return 'US';

    const text = String(q || '');
    if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) return 'KR';
    return 'GLOBAL';
  }catch(e){
    return 'GLOBAL';
  }
}

function sourceOrderForRegion(region){
  const base = String(region || '').toUpperCase();
  if (base === 'KR') return ['search_bank', 'web_naver', 'web_google', 'web_bing', 'web_youtube', 'web_image', 'planetary', 'collector'];
  return ['search_bank', 'web_google', 'web_bing', 'web_naver', 'web_youtube', 'web_image', 'planetary', 'collector'];
}

function dedupeCanonicalItems(items){
  const seen = new Set();
  const out = [];

  for (const it of (Array.isArray(items) ? items : [])) {
    const rawUrl = String(it?.url || '').trim();
    const normUrl = rawUrl.toLowerCase();

    const isPlaceholderUrl =
      !rawUrl ||
      rawUrl === '#' ||
      rawUrl === '/' ||
      normUrl === 'javascript:void(0)' ||
      normUrl.startsWith('javascript:');

    const key = (
      !isPlaceholderUrl
        ? rawUrl
        : (String(it?.id || '').trim() || String(it?.title || '').trim())
    ).toLowerCase() || JSON.stringify(it || {}).toLowerCase();

    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }

  return out;
}


// ===== SNAPSHOT DIRECT ACCESS =====
const fs = require('fs');
const path = require('path');
function safeRequireModule(name){ try { return require(name); } catch(e) { return null; } }
const PlanetaryModule = safeRequireModule('./planetary-data-connector');
const CollectorModule = safeRequireModule('./collector');
let SearchBankModuleCache;
function getSearchBankModule(){
  if (SearchBankModuleCache !== undefined) return SearchBankModuleCache;
  SearchBankModuleCache = safeRequireModule('./search-bank-engine');
  return SearchBankModuleCache;
}

function snapshotCandidates(){
  return [
    './search-bank.snapshot.json',
    './data/search-bank.snapshot.json',
    './snapshot.json',
    path.join(process.cwd(), 'search-bank.snapshot.json'),
    path.join(process.cwd(), 'data', 'search-bank.snapshot.json')
  ];
}

function haystackForItem(it){
  return [
    it.title, it.name, it.summary, it.description, it.url, it.link,
    it.channel, it.section, it.page, it.psom_key, it.route,
    it.category, it.semantic_category,
    it.bind && it.bind.page, it.bind && it.bind.section, it.bind && it.bind.psom_key, it.bind && it.bind.route,
    Array.isArray(it.tags) ? it.tags.join(' ') : ''
  ].filter(Boolean).join(' ').toLowerCase();
}

function itemFieldValues(it, keys){
  const out = [];
  const p = (it && typeof it.payload === 'object') ? it.payload : {};
  const geo = (it && typeof it.geo === 'object') ? it.geo : {};
  const location = (it && typeof it.location === 'object') ? it.location : {};
  for (const key of keys) {
    const v = it && it[key];
    if (v !== undefined && v !== null && v !== '') out.push(v);
    const pv = p && p[key];
    if (pv !== undefined && pv !== null && pv !== '') out.push(pv);
    const gv = geo && geo[key];
    if (gv !== undefined && gv !== null && gv !== '') out.push(gv);
    const lv = location && location[key];
    if (lv !== undefined && lv !== null && lv !== '') out.push(lv);
  }
  return out.map(x => String(x).trim().toLowerCase()).filter(Boolean);
}

function matchesStructuredValue(values, wanted){
  const w = String(wanted || '').trim().toLowerCase();
  if (!w) return true;
  const list = (Array.isArray(values) ? values : []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  return list.some(x => x === w || x.includes(w) || w.includes(x));
}

function matchesHardValue(values, wanted){
  const w = String(wanted || '').trim().toLowerCase();
  if (!w) return true;
  const list = (Array.isArray(values) ? values : []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  return list.some(x => x === w);
}

function loadSnapshotLocal(q, limit, opts = {}){
  try{
    let data = null;
    for (const p of snapshotCandidates()) {
      if (fs.existsSync(p)) {
        data = JSON.parse(fs.readFileSync(p,'utf-8'));
        break;
      }
    }
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : null);
    if(!rows) return null;

    const qq = String(q || '').trim().toLowerCase();
    const wantedChannel = String(opts.channel || '').trim().toLowerCase();
    const wantedSection = String(opts.section || opts.psom_key || '').trim().toLowerCase();
    const wantedPage = String(opts.page || '').trim().toLowerCase();
    const wantedRoute = String(opts.route || '').trim().toLowerCase();
    const wantedTags = Array.isArray(opts.tags) ? opts.tags.map(x => String(x).toLowerCase()) : [];
    const wantedLang = normalizeLangCode(opts.lang || '') || '';
    const wantedRegion = String(opts.region || '').trim().toLowerCase();
    const wantedCountry = String(opts.country || '').trim().toLowerCase();
    const wantedState = String(opts.state || '').trim().toLowerCase();
    const wantedCity = String(opts.city || '').trim().toLowerCase();
    const wantedCategory = String(opts.category || '').trim().toLowerCase();
    const wantedSemanticCategory = String(opts.semantic_category || '').trim().toLowerCase();
    const wantedType = String(opts.type || '').trim().toLowerCase();

    const filtered = rows.filter(it => {
      if (!it) return false;
      const h = haystackForItem(it);
      if (qq && !h.includes(qq) && !qq.split(/\s+/).some(tok => tok && h.includes(tok))) return false;
      if (wantedChannel && ![it.channel, it.bind?.page, it.page].map(x=>String(x||'').toLowerCase()).some(x => x.includes(wantedChannel) || wantedChannel.includes(x))) return false;
      if (wantedSection && ![it.section, it.bind?.section, it.psom_key, it.bind?.psom_key].map(x=>String(x||'').toLowerCase()).some(x => x.includes(wantedSection) || wantedSection.includes(x))) return false;
      if (wantedPage && ![it.page, it.bind?.page, it.channel].map(x=>String(x||'').toLowerCase()).some(x => x.includes(wantedPage) || wantedPage.includes(x))) return false;
      if (wantedRoute && ![it.route, it.bind?.route].map(x=>String(x||'').toLowerCase()).some(x => x.includes(wantedRoute) || wantedRoute.includes(x))) return false;
      if (wantedTags.length) {
        const tags = Array.isArray(it.tags) ? it.tags.map(x => String(x).toLowerCase()) : [];
        if (!wantedTags.some(t => tags.some(x => x.includes(t) || t.includes(x)) || h.includes(t))) return false;
      }
      if (wantedLang && !matchesHardValue(itemFieldValues(it, ['lang','language','contentLang','targetLang']), wantedLang)) return false;
      if (wantedRegion && !matchesHardValue(itemFieldValues(it, ['region','area','continent','targetRegion']), wantedRegion)) return false;
      if (wantedCountry && !matchesHardValue(itemFieldValues(it, ['country','countryCode','targetCountry']), wantedCountry)) return false;
      if (wantedState && !matchesStructuredValue(itemFieldValues(it, ['state','province','admin1']), wantedState)) return false;
      if (wantedCity && !matchesStructuredValue(itemFieldValues(it, ['city','locality']), wantedCity)) return false;
      if (wantedCategory && !matchesStructuredValue(itemFieldValues(it, ['category']), wantedCategory)) return false;
      if (wantedSemanticCategory && !matchesStructuredValue(itemFieldValues(it, ['semantic_category','semanticCategory']), wantedSemanticCategory)) return false;
      if (wantedType && !matchesStructuredValue(itemFieldValues(it, ['type','mediaType']), wantedType)) return false;
      return true;
    });

    return filtered.slice(0, Math.min(limit || DEFAULT_SUPPLY_LIMIT, MAX_RETURN_LIMIT));
  }catch(e){
    return null;
  }
}

// ===== Containers (future-ready, but safe-noop unless active) =====
const Containers = {

  // ===== SEARCH BANK (유지, 안정화) =====
  search_bank: {
    name: 'search_bank',
    async fetch(q, limit, offset, event, opts = {}){
      try{
        const runDirect = async () => {
          const SearchBankModule = getSearchBankModule();
          if (!SearchBankModule || typeof SearchBankModule.runEngine !== 'function') return null;
          const directParams = {
            ...(opts || {}),
            q: String(q || ''),
            query: String(q || ''),
            limit: Math.min(limit || SEARCH_BANK_PAGE_SIZE, 1000),
            offset: Math.max(0, Number(offset || 0)),
            from: 'maru-search'
          };
          const data = await SearchBankModule.runEngine(event || {}, directParams);
          if (data && Array.isArray(data.items)) {
            return {
              source: 'search-bank',
              results: data.items,
              total: typeof data.total === 'number' ? data.total : null,
              filters: data.filters || null,
              meta: data.meta || null,
              served_from: data.served_from || null
            };
          }
          return null;
        };

        const sp = new URLSearchParams();
        sp.set('q', String(q || ''));
        sp.set('limit', String(Math.min(limit || SEARCH_BANK_PAGE_SIZE, 1000)));
        sp.set('offset', String(offset || 0));
        sp.set('from', 'maru-search');

        const pass = ['channel','section','page','psom_key','route','type','category','semantic_category','lang','region','country','state','city','sector','sector_minor','entity','external','noExternal','disableExternal','list','autoFill','slotFill','frontFill','pageFill','snapshotFill','minItems'];
        for (const key of pass) {
          const v = opts[key];
          if (v !== undefined && v !== null && v !== '') sp.set(key, String(v));
        }
        if (!String(q || '').trim() && (opts.channel || opts.section || opts.page || opts.route || opts.psom_key || opts.mode !== 'search')) {
          sp.set('list', '1');
          sp.set('autoFill', '1');
        }

        const base = resolveRuntimeBaseUrl(event);
        if (base) {
          const url = base + '/.netlify/functions/search-bank-engine?' + sp.toString();
          const res = await fetchWithTimeout(url, null, 7000);
          if(res && res.ok) {
            const data = await res.json();
            if(data && Array.isArray(data.items)){
              return {
                source: 'search-bank',
                results: data.items,
                total: typeof data.total === 'number' ? data.total : null,
                filters: data.filters || null,
                meta: data.meta || null,
                served_from: data.served_from || null
              };
            }
          }
        }

        return await runDirect();
      }catch{
        try {
          const SearchBankModule = getSearchBankModule();
          if (!SearchBankModule || typeof SearchBankModule.runEngine !== 'function') return null;
          const data = await SearchBankModule.runEngine(event || {}, {
            ...(opts || {}),
            q: String(q || ''),
            query: String(q || ''),
            limit: Math.min(limit || SEARCH_BANK_PAGE_SIZE, 1000),
            offset: Math.max(0, Number(offset || 0)),
            from: 'maru-search'
          });
          if(data && Array.isArray(data.items)){
            return {
              source: 'search-bank',
              results: data.items,
              total: typeof data.total === 'number' ? data.total : null,
              filters: data.filters || null,
              meta: data.meta || null,
              served_from: data.served_from || null
            };
          }
        } catch(_) {}
        return null;
      }
    }
  },

  // ===== NAVER =====
  web_naver: {
    name: 'web_naver',
    async fetch(q, limit, start){
      return naverSearch(q, limit, start);
    }
  },

  // ===== GOOGLE =====
  web_google: {
    name: 'web_google',
    async fetch(q, limit, start){
      return googleSearch(q, limit, start);
    }
  },

  // ===== BING (신규 핵심) =====
  web_bing: {
    name: 'web_bing',
    async fetch(q, limit, start){
      try{
        const key = process.env.BING_API_KEY;
        if (!key) return null;

        const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&count=${limit}&offset=${start}`;

        const res = await fetchWithTimeout(url, {
          headers: { 'Ocp-Apim-Subscription-Key': key }
        }, 8000);

        if (!res.ok) return null;
        const data = await res.json();

        return {
          source: 'bing',
          results: (data.webPages?.value || []).map(it => ({
            title: it.name,
            link: it.url,
            snippet: it.snippet,
            type: 'web'
          }))
        };
      }catch{
        return null;
      }
    }
  },

// ===== BLOCK 398~624 (FULL VERIFIED / SAFE FIX APPLIED) =====
// ✔ 전체 구조 유지
// ✔ 기능 삭제 없음
// ✔ 단일 문제만 수정: wikipedia fetch → timeout 적용

// ===== WIKIPEDIA =====
web_wikipedia: {
  name: 'web_wikipedia',
  async fetch(q){
    try{
      const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(q);
      const res = await fetchWithTimeout(url, null, 6000); // 🔧 FIX
      if(!res.ok) return null;
      const d = await res.json();

      return {
        source: 'wikipedia',
        results: [{
          title: d.title,
          link: d.content_urls?.desktop?.page || '',
          snippet: d.extract,
          type: 'web'
        }]
      };
    }catch{
      return null;
    }
  }
},

// ===== SNAPSHOT =====
snapshot: {
  name: 'snapshot',
  async fetch(q, limit, opts = {}){
    const local = loadSnapshotLocal(q, limit, opts);
    if(local) return { source:'snapshot-local', results: local };
    return null;
  }
},

// ===== AI =====
ai: {
  name: 'ai',
  async fetch(){
    return null;
  }
},

// ===== YOUTUBE =====
web_youtube: {
  name: 'web_youtube',
  async fetch(q, limit){
    try{
      const key = process.env.YOUTUBE_API_KEY;
      if(!key) return null;

      const url =
        'https://www.googleapis.com/youtube/v3/search' +
        '?part=snippet&type=video&maxResults=' + Math.min(limit,50) +
        '&q=' + encodeURIComponent(q) +
        '&key=' + key;

      const res = await fetchWithTimeout(url, null, 8000);
      if(!res.ok) return null;

      const data = await res.json();

      return {
        source: 'youtube',
        results: (data.items || []).map(it => ({
          title: it.snippet.title,
          link: 'https://www.youtube.com/watch?v=' + it.id.videoId,
          snippet: it.snippet.description,
          type: 'video',
          payload: {
            thumb: it.snippet.thumbnails?.medium?.url
          }
        }))
      };

    }catch{
      return null;
    }
  }
},

// ===== IMAGE =====
web_image: {
  name: 'web_image',
  async fetch(q, limit){
    try{
      const key = process.env.GOOGLE_API_KEY;
      const cx  = process.env.GOOGLE_CSE_ID;
      if(!key || !cx) return null;

      const url =
        'https://www.googleapis.com/customsearch/v1' +
        '?key=' + key +
        '&cx=' + cx +
        '&q=' + encodeURIComponent(q) +
        '&searchType=image' +
        '&num=' + Math.min(limit,10);

      const res = await fetchWithTimeout(url, null, 8000);
      if(!res.ok) return null;

      const data = await res.json();

      return {
        source: 'google_image',
        results: (data.items || []).map(it => ({
          title: it.title,
          link: it.link,
          snippet: '',
          type: 'image',
          payload: {
            thumb: it.link
          }
        }))
      };

    }catch{
      return null;
    }
  }
}
};

// ===== ORCHESTRATOR =====

function parseTagsParam(v){
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v || '').split(',').map(x => x.trim()).filter(Boolean);
}

function externalIsSuppressed(opts = {}){
  return String(opts.external || '').toLowerCase() === 'off' || truthyParam(opts.noExternal) || truthyParam(opts.disableExternal);
}

function isSupplyMode(mode){
  return ['feed','block','admin','insight','global-insight','snapshot','inventory','donation','media','commerce','revenue'].includes(String(mode || '').toLowerCase());
}

function hasStructuredSupplyParams(opts = {}){
  return !!(opts.channel || opts.section || opts.page || opts.route || opts.psom_key || opts.category || opts.semantic_category || (Array.isArray(opts.tags) && opts.tags.length) || isSupplyMode(opts.mode));
}

async function orchestrateSearch({ event, q, limit, start, offset: initialOffset, lang, uiLang, targetLang, mode, channel, section, page, psom_key, route, category, semantic_category, tags, type, region: forcedRegion, country, state, city, sector, sector_minor, entity, external, noExternal, disableExternal, skipSearchBank, from }) {

  mode = String(mode || (q ? 'search' : 'feed')).toLowerCase();
  limit = clampIntValue(limit, mode === 'search' ? DEFAULT_SEARCH_LIMIT : DEFAULT_SUPPLY_LIMIT, 1, MAX_RETURN_LIMIT);
  const normalizedUiLang = normalizeLangCode(uiLang || lang || '') || null;
  const normalizedTargetLang = normalizeLangCode(targetLang || '') || null;
  const neutralGeo = new Set(['GLOBAL','WORLD','ALL','ANY','INTERNATIONAL','INTL','']);
  const rawTargetRegion = String(forcedRegion || '').trim().toUpperCase();
  const rawTargetCountry = String(country || '').trim().toUpperCase();
  const targetRegion = neutralGeo.has(rawTargetRegion) ? null : rawTargetRegion;
  const targetCountry = neutralGeo.has(rawTargetCountry) ? null : rawTargetCountry;
  const normalizedTags = Array.isArray(tags) ? tags : parseTagsParam(tags);
  const suppressedExternal = externalIsSuppressed({ external, noExternal, disableExternal });
  const supplyMode = isSupplyMode(mode) || hasStructuredSupplyParams({ mode, channel, section, page, route, psom_key, category, semantic_category, tags: normalizedTags });
  const targetMin = mode === 'search' ? Math.min(MIN_SEARCH_RESULTS, limit) : Math.min(limit, DEFAULT_SUPPLY_LIMIT);
  const internalTarget = Math.max(limit, targetMin);
  const bankScanLimit = Math.min(MAX_BANK_SCAN, Math.max(internalTarget + SEARCH_BANK_PAGE_SIZE, mode === 'search' ? 3000 : internalTarget));

  globalThis.__MARU_CACHE = globalThis.__MARU_CACHE || new Map();
  const tagKey = normalizedTags.join(',');
  const cacheKey = [q, mode, limit, start, initialOffset || 0, normalizedUiLang || '', normalizedTargetLang || '', channel || '', section || '', page || '', psom_key || '', route || '', category || '', semantic_category || '', tagKey, type || '', targetRegion || '', targetCountry || '', state || '', city || '', sector || '', sector_minor || '', entity || '', external || '', noExternal || '', disableExternal || '', skipSearchBank ? 'skip-bank' : 'bank', from || ''].join('::');

  const cached = globalThis.__MARU_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.t < 300000) {
    return cached.v;
  }

  const collected = [];
  const trace = [];
  const sourceHealth = {};
  let sourceUsed = null;
  let bankTotal = null;

  const runtimeRegion = detectRuntimeRegion(event, normalizedUiLang, q);
  const region = runtimeRegion;
  const sourceOrder = sourceOrderForRegion(runtimeRegion);
  const commonOpts = {
    mode, channel, section, page, psom_key, route, category, semantic_category,
    lang: normalizedTargetLang || undefined,
    region: targetRegion || undefined,
    country: targetCountry || undefined,
    state, city, sector, sector_minor, entity,
    external, noExternal, disableExternal,
    tags: normalizedTags,
    list: supplyMode ? 1 : undefined,
    autoFill: supplyMode ? 1 : undefined,
    snapshotFill: supplyMode ? 1 : undefined
  };

  function record(name, status, count, extra){
    trace.push({ name, status, count: count || 0, ...(extra || {}) });
    sourceHealth[name] = { status, count: count || 0, ...(extra || {}) };
  }

  async function pullFromSearchBank(){
    if (!cbCanRun('search-bank')) {
      record('search-bank', 'circuit-open', 0);
      return;
    }
    let offset = Math.max(0, initialOffset || 0);
    let pulled = 0;
    const pageSize = Math.min(500, Math.max(50, SEARCH_BANK_PAGE_SIZE));

    while (offset < bankScanLimit) {
      const b = await Containers.search_bank.fetch(q, pageSize, offset, event, commonOpts).catch(() => null);
      if (!b?.results?.length) {
        if (pulled === 0) {
          record('search-bank', 'empty', 0, { offset });
          cbOnFail('search-bank');
        }
        break;
      }

      cbOnSuccess('search-bank');
      sourceUsed = sourceUsed || 'search-bank';
      bankTotal = typeof b.total === 'number' ? b.total : bankTotal;
      const standardized = toStandardItems(b.results, b.source || 'search-bank');
      collected.push(...standardized);
      pulled += standardized.length;

      record('search-bank', 'ok', pulled, { offset, total: bankTotal, served_from: b.served_from || undefined });

      if (b.results.length < pageSize) break;
      offset += pageSize;
      if (bankTotal !== null && offset >= bankTotal) break;
      if (pulled >= internalTarget && mode === 'search') break;
    }
  }

  async function pullFromSnapshotLocal(){
    const snap = await Containers.snapshot.fetch(q, Math.max(limit, targetMin), commonOpts).catch(() => null);
    if (snap?.results?.length) {
      collected.push(...toStandardItems(snap.results, snap.source || 'snapshot-local'));
      sourceUsed = sourceUsed || 'snapshot-local';
      record('snapshot-local', 'ok', snap.results.length);
    }
  }

  async function pullFromPlanetary(){
    if (!PlanetaryModule || typeof PlanetaryModule.connect !== 'function') return;
    if (from === 'planetary') return;
    try{
      const r = await PlanetaryModule.connect(event, {
        q, query: q, limit: Math.min(limit, 1000), mode, channel, section, page, route,
        region: targetRegion || undefined, country: targetCountry || undefined, type, from: 'maru-search', useMaruSearchFallback: false, skipMaruSearch: true
      });
      const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r?.results) ? r.results.flatMap(x => Array.isArray(x.items) ? x.items : []) : []);
      if (arr.length) {
        collected.push(...toStandardItems(arr, 'planetary'));
        sourceUsed = sourceUsed || 'planetary';
        record('planetary', 'ok', arr.length);
      } else record('planetary', 'empty', 0);
    }catch(e){ record('planetary', 'fail', 0, { error: e?.message || 'error' }); }
  }

  async function pullFromCollector(){
    if (!CollectorModule || typeof CollectorModule.runEngine !== 'function') return;
    if (from === 'collector') return;
    try{
      const r = await CollectorModule.runEngine(event, {
        q, query: q, limit: Math.min(limit, 1000), mode, channel, section, page, route,
        region: targetRegion || undefined, country: targetCountry || undefined, type, from: 'maru-search', skipMaruSearch: true
      });
      const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r?.results) ? r.results : []);
      if (arr.length) {
        collected.push(...toStandardItems(arr, 'collector'));
        sourceUsed = sourceUsed || 'collector';
        record('collector', 'ok', arr.length);
      } else record('collector', 'empty', 0);
    }catch(e){ record('collector', 'fail', 0, { error: e?.message || 'error' }); }
  }

  async function pullFromNaver(){
    let pageStart = start || 1;
    let count = 0;
    while (pageStart <= 1000 && count < 1000) {
      const n = await Containers.web_naver.fetch(q, 100, pageStart).catch(() => null);
      if (!n?.results?.length) break;
      sourceUsed = sourceUsed || 'naver';
      collected.push(...toStandardItems(n.results, n.source || 'naver'));
      count += n.results.length;
      if (n.results.length < 100) break;
      pageStart += 100;
    }
    if (count) record('naver', 'ok', count);
  }

  async function pullFromGoogle(){
    let pageStart = start || 1;
    let count = 0;
    while (pageStart <= 100 && count < 100) {
      const g = await Containers.web_google.fetch(q, 10, pageStart).catch(() => null);
      if (!g?.results?.length) break;
      sourceUsed = sourceUsed || 'google';
      collected.push(...toStandardItems(g.results, g.source || 'google'));
      count += g.results.length;
      if (g.results.length < 10) break;
      pageStart += 10;
    }
    if (count) record('google', 'ok', count);
  }

  async function pullFromBing(){
    if (!Containers.web_bing) return;
    let offset = 0;
    let count = 0;
    while (offset <= 450) {
      const b = await Containers.web_bing.fetch(q, 50, offset).catch(() => null);
      if (!b?.results?.length) break;
      sourceUsed = sourceUsed || 'bing';
      collected.push(...toStandardItems(b.results, b.source || 'bing'));
      count += b.results.length;
      if (b.results.length < 50) break;
      offset += 50;
    }
    if (count) record('bing', 'ok', count);
  }

  async function pullFromYouTube(){
    if (!Containers.web_youtube) return;
    const y = await Containers.web_youtube.fetch(q, 20).catch(() => null);
    if (y?.results?.length) {
      collected.push(...toStandardItems(y.results, y.source || 'youtube'));
      record('youtube', 'ok', y.results.length);
    }
  }

  async function pullFromImage(){
    if (!Containers.web_image) return;
    const img = await Containers.web_image.fetch(q, 10).catch(() => null);
    if (img?.results?.length) {
      collected.push(...toStandardItems(img.results, img.source || 'google_image'));
      record('google_image', 'ok', img.results.length);
    }
  }

  function fetchNews(){
    if (!q) return [];
    return [{
      title: `[News] ${q}`,
      url: 'https://www.google.com/search?tbm=nws&q=' + encodeURIComponent(q),
      source: 'news',
      sourceType: 'search-link',
      provider: 'google-news-search-link',
      generatedBy: 'maru-search',
      placeholder: true,
      mediaType: 'article',
      thumbnail: '',
      score: 0.7
    }];
  }

  function fetchShopping(){
    if (!q) return [];
    return [{
      title: `[Shopping] ${q}`,
      url: 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(q),
      source: 'shopping',
      sourceType: 'search-link',
      provider: 'google-shopping-search-link',
      generatedBy: 'maru-search',
      placeholder: true,
      mediaType: 'product',
      thumbnail: '',
      score: 0.6
    }];
  }

  if (!skipSearchBank && from !== 'search-bank') {
    await pullFromSearchBank();
  } else {
    record('search-bank', 'skipped', 0, { reason: 'skipSearchBank_or_from_search_bank' });
  }

  if (!collected.length) await pullFromSnapshotLocal();

  const canUseExternal = !suppressedExternal && !!q;
  if (canUseExternal) {
    await Promise.all([
      pullFromNaver(),
      pullFromGoogle(),
      pullFromBing(),
      pullFromYouTube(),
      pullFromImage()
    ]);

    if (collected.length < internalTarget || mode !== 'search') {
      await Promise.all([pullFromPlanetary(), pullFromCollector()]);
    }

    collected.push(...fetchNews(), ...fetchShopping());
  } else if (suppressedExternal) {
    record('external', 'suppressed', 0);
  }

  let unique = dedupeCanonicalItems(collected);
  unique = await applyCorePipeline(q, unique);
  unique = applyServerSideBoosts(unique, { q, lang: normalizedUiLang, targetLang: normalizedTargetLang, mode, channel, section, page, route, country: targetCountry, region: runtimeRegion, targetRegion });
  const finalItems = unique.slice(0, limit);
  const placeholderCount = finalItems.filter(it => it && it.placeholder === true).length;

  const result = {
    source: sourceUsed || (collected.length ? 'multi' : null),
    route: sourceOrder,
    sourceRoute: sourceOrder,
    region: runtimeRegion,
    country: targetCountry || null,
    runtimeRegion,
    targetRegion,
    uiLang: normalizedUiLang,
    targetLang: normalizedTargetLang,
    mode,
    items: finalItems,
    meta: {
      count: finalItems.length,
      returned: finalItems.length,
      requestedLimit: limit,
      internalTarget,
      bankScanLimit,
      totalCandidates: collected.length,
      deduped: Math.max(0, collected.length - unique.length),
      placeholderCount,
      hasPlaceholders: placeholderCount > 0,
      bankTotal,
      q: q || '',
      uiLang: normalizedUiLang,
      targetLang: normalizedTargetLang,
      runtimeRegion,
      targetRegion,
      targetCountry,
      channel: channel || null,
      section: section || null,
      page: page || null,
      psom_key: psom_key || null,
      route: route || null,
      category: category || null,
      semantic_category: semantic_category || null,
      tags: normalizedTags,
      externalSuppressed: suppressedExternal,
      sourceRoute: sourceOrder,
      executionRoute: sourceOrder,
      sourceHealth,
      trace
    }
  };

  globalThis.__MARU_CACHE.set(cacheKey, { t: Date.now(), v: result });
  return result;
}
// ===== Source Fetchers =====
async function naverSearch(q, limit, start) {
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(q)}&display=${Math.min(limit, 100)}&start=${start}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
    },
  }, 8500);

  if (!res.ok) throw new Error(`NAVER_HTTP_${res.status}`);
  const data = await res.json();

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map(it => ({
    title: stripHtml(it.title),
    link: it.link || '',
    snippet: stripHtml(it.description),
    type: 'web',
    payload: { source: 'naver' }
  }));

  return { source: 'naver', results };
}

async function googleSearch(q, limit, start) {
  const key = process.env.GOOGLE_API_KEY;
  const cx  = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;

  const base =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${encodeURIComponent(key)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&q=${encodeURIComponent(q)}` +
    `&num=${Math.min(limit, 10)}` +
    `&start=${start}` +
    `&gl=us` +
    `&lr=lang_en|lang_ko` +
    `&sort=date`;

  const webRes = await fetchWithTimeout(base, null, 8500)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const newsRes = await fetchWithTimeout(base + `&tbm=nws`, null, 8500)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const mergeItems = (data, type, source) => {
    const items = Array.isArray(data && data.items) ? data.items : [];
    return items.map(it => {
      const pagemap = it.pagemap || {};
      const cseThumb = Array.isArray(pagemap.cse_thumbnail) ? pagemap.cse_thumbnail[0] : null;
      const cseImg   = Array.isArray(pagemap.cse_image) ? pagemap.cse_image[0] : null;

      return {
        title: it.title || '',
        link: it.link || '',
        snippet: it.snippet || '',
        type,
        payload: {
          source,
          thumb: (cseThumb && cseThumb.src) || (cseImg && cseImg.src) || ''
        }
      };
    });
  };

  const results = [
    ...mergeItems(webRes,  'web',  'google'),
    ...mergeItems(newsRes, 'news', 'google_news')
  ];

  return { source: 'google+news', results };
}

async function postJson(url, body){
  try{
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }, 8000);

    if(!res || !res.ok) return null;

    const text = await res.text();
    try{
      return JSON.parse(text);
    }catch{
      return { ok:true, raw:text };
    }
  }catch{
    return null;
  }
}

// ===== CORE PIPELINE APPLY (NON-DESTRUCTIVE) =====
async function applyCorePipeline(query, items) {
  const q = query;

  if (Core && typeof Core.validateQuery === "function") {
    const v = Core.validateQuery(q);
    // 🔧 절대 막지 않음 (완전 패스)
  }

  let results = Array.isArray(items) ? items : [];

  if (Core && typeof Core.scoreItem === "function") {
    results = results.map(it => ({
      ...it,
      _coreScore: Core.scoreItem(q, it)
    })).sort((a, b) => (b._coreScore || 0) - (a._coreScore || 0));
  }

  return results.map(it => canonicalizeItem(it, q));
}

// ===== INTENT =====
function detectIntent(q){
  const text = String(q||"").toLowerCase();
  if(text.includes("buy") || text.includes("price")) return "commerce";
  if(text.includes("news")) return "news";
  if(text.includes("video")) return "media";
  return "general";
}

function applyIntentBoost(items, q){
  const intent = detectIntent(q);
  return items.map(it=>{
    let boost = 0;
    if(intent === "commerce" && (it.type==="product"||it.mediaType==="product")) boost+=2;
    if(intent === "media" && (it.mediaType==="video"||it.mediaType==="image")) boost+=1.5;
    if(intent === "news" && String(it.source||"").includes("news")) boost+=1.2;
    return {...it, _intentBoost: boost, _finalScore:(it._finalScore||0)+boost};
  }).sort((a,b)=>b._finalScore-a._finalScore);
}

// ===== SERVER BOOST =====
function applyServerSideBoosts(items, opts){
  const q = String((opts && opts.q) || "").toLowerCase();
  const lang = String((opts && opts.lang) || "").toLowerCase();

  const ranked = (Array.isArray(items) ? items : []).map((it, idx) => {
    let bonus = 0;
    const title = String(it.title || "").toLowerCase();
    const summary = String(it.summary || "").toLowerCase();
    const source = String(it.source || "").toLowerCase();

    if (q && title.includes(q)) bonus += 3;
    if (q && summary.includes(q)) bonus += 1.5;
    if (lang && String(it.lang || "").toLowerCase() === lang) bonus += 1;
    if (source.includes("search-bank")) bonus += 0.6;
    if (it.mediaType === "image" || it.mediaType === "video") bonus += 0.25;

    return { ...it, _bonus: bonus, _finalScore: Number(it._coreScore || it.score || 0) + bonus, _seq: idx };
  });

  ranked.sort((a,b) => {
    if ((b._finalScore || 0) !== (a._finalScore || 0)) return (b._finalScore || 0) - (a._finalScore || 0);
    return (a._seq || 0) - (b._seq || 0);
  });

  return applyIntentBoost(ranked, q);
}

// ===== ANALYTICS =====
async function syncSearchAnalytics(event, q, items){
  try{
    const base = resolveRuntimeBaseUrl(event);
    if(!base) return null;

    return await postJson(`${base}/.netlify/functions/revenue-engine`, {
      action: "track",
      event: {
        type: "search",
        query: q,
        count: Array.isArray(items) ? items.length : 0,
        timestamp: Date.now()
      }
    });
  }catch{
    return null;
  }
}

async function distributeRevenue(event, items){
  try{
    const base = resolveRuntimeBaseUrl(event);
    if(!base) return null;

    const queue = (Array.isArray(items) ? items : []).filter(item =>
      item && (item.type === "ad" || item.type === "product" || item.mediaType === "product")
    );

    // 🔧 병렬 처리 (속도 개선)
    await Promise.all(queue.map(item =>
      postJson(`${base}/.netlify/functions/revenue-engine`, {
        action: "distribute",
        producerId: item.producerId || item.payload?.producerId || "global",
        amount: item._finalScore || item._coreScore || item.score || 1
      })
    ));

    return { ok:true, count: queue.length };
  }catch{
    return null;
  }
}

// ===== MAIN HANDLER =====
exports.handler = async function (event) {
  try {
    const { q, limit, start, offset, lang, uiLang, targetLang, mode } = pickQ(event);
    const qs = event.queryStringParameters || {};
    const tags = parseTagsParam(qs.tags || qs.tag || '');
    const hasSupplyContext = hasStructuredSupplyParams({
      mode,
      channel: qs.channel || null,
      section: qs.section || qs.bind_section || null,
      page: qs.page || null,
      route: qs.route || null,
      psom_key: qs.psom_key || null,
      category: qs.category || null,
      semantic_category: qs.semantic_category || null,
      tags
    });

    if (!q && !hasSupplyContext) {
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        query: q,
        mode,
        source: null,
        items: [],
        results: [],
        meta: { count: 0, limit, reason: 'empty_query_without_supply_context' },
      });
    }

    const base = await orchestrateSearch({
      event, q, limit, start, offset, lang, uiLang, targetLang, mode,
      channel: qs.channel || null,
      section: qs.section || qs.bind_section || null,
      page: qs.page || null,
      psom_key: qs.psom_key || null,
      route: qs.route || null,
      category: qs.category || null,
      semantic_category: qs.semantic_category || null,
      tags,
      type: qs.type || null,
      region: qs.region || qs.geo_region || null,
      country: qs.country || qs.geo_country || null,
      state: qs.state || qs.geo_state || null,
      city: qs.city || qs.geo_city || null,
      sector: qs.sector || null,
      sector_minor: qs.sector_minor || null,
      entity: qs.entity || null,
      external: qs.external ?? null,
      noExternal: qs.noExternal ?? null,
      disableExternal: qs.disableExternal ?? null,
      skipSearchBank: !!(qs.skipSearchBank || qs.noSearchBank || qs.from === "search-bank"),
      from: qs.from || null
    });

    // 🔧 비동기 처리 (응답 속도 확보)
    // Admin/insight/snapshot 계열은 noAnalytics/noRevenue 플래그로 부작용 호출을 끌 수 있게 한다.
    const analyticsOff = truthyParam(qs.noAnalytics) || truthyParam(qs.disableAnalytics);
    const revenueOff = truthyParam(qs.noRevenue) || truthyParam(qs.disableRevenue) || analyticsOff;
    if (!analyticsOff) syncSearchAnalytics(event, q, base.items);
    if (!revenueOff) distributeRevenue(event, base.items);

    return ok({
      status: 'ok',
      engine: 'maru-search',
      version: VERSION,
      query: q,
      mode: base.mode || mode,
      source: base.source,
      items: base.items,
      results: base.items,
      meta: {
        ...(base.meta || {}),
        count: (base.items || []).length,
        limit,
        region: base.region || null,
        country: base.country || null,
        route: (base.meta && base.meta.route) || null,
        sourceRoute: base.sourceRoute || base.route || null,
        analyticsSuppressed: analyticsOff,
        revenueSuppressed: revenueOff
      },
    });

  } catch (e) {
    return fail('Search failed', String((e && e.message) || e));
  }
};

// ===== DISPATCHER =====
async function maruSearchDispatcher(req = {}) {
  const q = String(req.q || req.query || "").trim();
  const limit = req.limit;
  const lang = req.lang;
  const mode = req.mode;

  const res = await exports.handler({ queryStringParameters: {
    q, limit, lang, mode,
    uiLang: req.uiLang || req.locale || req.lang,
    targetLang: req.targetLang || req.contentLang || req.filterLang || req.searchLang,
    contentLang: req.contentLang,
    filterLang: req.filterLang,
    searchLang: req.searchLang,
    start: req.start,
    offset: req.offset,
    channel: req.channel,
    section: req.section,
    bind_section: req.bind_section,
    page: req.page,
    psom_key: req.psom_key,
    route: req.route,
    type: req.type,
    category: req.category,
    semantic_category: req.semantic_category,
    tags: Array.isArray(req.tags) ? req.tags.join(',') : req.tags,
    region: req.region || req.geo_region,
    country: req.country || req.geo_country,
    state: req.state || req.geo_state,
    city: req.city || req.geo_city,
    sector: req.sector,
    sector_minor: req.sector_minor,
    entity: req.entity,
    external: req.external,
    noExternal: req.noExternal,
    disableExternal: req.disableExternal,
    noAnalytics: req.noAnalytics,
    disableAnalytics: req.disableAnalytics,
    noRevenue: req.noRevenue,
    disableRevenue: req.disableRevenue,
    skipSearchBank: req.skipSearchBank,
    noSearchBank: req.noSearchBank,
    from: req.from
  } });

  try {
    return JSON.parse(res.body || "{}");
  } catch {
    return { status: "fail", message: "BAD_JSON" };
  }
}

exports.maruSearchDispatcher = maruSearchDispatcher;

// ===== ENGINE ENTRY =====
exports.runEngine = async function(event = {}, params = {}){
  const mode = params.mode || (params.q || params.query ? 'search' : 'feed');
  return await orchestrateSearch({
    event,
    q: String(params.q || params.query || "").trim(),
    limit: parseLimitParam(params.limit, mode),
    start: params.start,
    offset: params.offset,
    mode,
    lang: params.lang || null,
    uiLang: params.uiLang || params.locale || params.lang || null,
    targetLang: params.targetLang || params.contentLang || params.filterLang || params.searchLang || null,
    channel: params.channel || null,
    section: params.section || params.bind_section || null,
    page: params.page || null,
    psom_key: params.psom_key || null,
    route: params.route || null,
    category: params.category || null,
    semantic_category: params.semantic_category || null,
    tags: Array.isArray(params.tags) ? params.tags : parseTagsParam(params.tags || params.tag || ''),
    type: params.type || null,
    region: params.region || params.geo_region || null,
    country: params.country || params.geo_country || null,
    state: params.state || params.geo_state || null,
    city: params.city || params.geo_city || null,
    sector: params.sector || null,
    sector_minor: params.sector_minor || null,
    entity: params.entity || null,
    external: params.external ?? null,
    noExternal: params.noExternal ?? null,
    disableExternal: params.disableExternal ?? null,
    skipSearchBank: !!(params.skipSearchBank || params.noSearchBank),
    from: params.from || null
  });
};