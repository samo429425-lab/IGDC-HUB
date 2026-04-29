/**
 * maru-global-insight-engine.js
 * ------------------------------------------------------------
 * MARU Global Insight Engine — Aggregator Core (v2)
 * ------------------------------------------------------------
 * Goals:
 * - Multi-engine router (maru-search + search-bank + future)
 * - Canonical unified payload for Addon / Donation / Front pages
 * - Always guarantees: status, engine, version, items[], summary, meta.trace
 * - Partial failure tolerant
 */

"use strict";

const VERSION = "v2.2-global-insight-brief-external-on";

let Core = null;
try { Core = require("./core"); } catch (_) {
  try { Core = require("../maru/core"); } catch (_) { Core = null; }
}

let MaruSearch = null;
try { MaruSearch = require("./maru-search"); } catch (_) { MaruSearch = null; }

let BankEngine = null;
try { BankEngine = require("./search-bank-engine"); } catch (_) { BankEngine = null; }

// ---------- UTIL ----------
function s(x){ return String(x == null ? "" : x); }
function low(x){ return s(x).toLowerCase(); }
function nowISO(){ return new Date().toISOString(); }

function clampInt(n, d, min, max){
  const v = parseInt(n, 10);
  const x = Number.isFinite(v) ? v : d;
  return Math.max(min, Math.min(max, x));
}

function normalizeQuery(q){
  return s(q).trim();
}

function normalizeContext(params){
  params = params || {};
  const scope = s(params.scope || params.level || "global").trim() || "global";
  const target = (params.target == null) ? null : s(params.target).trim();
  const intent = s(params.intent || "summary").trim() || "summary";
  return {
    scope,
    target,
    intent,
    uiLang: params.uiLang || params.locale || params.lang || null,
    targetLang: params.targetLang || params.contentLang || params.filterLang || params.searchLang || null,
    region: params.region || params.geo_region || null,
    country: params.country || params.geo_country || null,
    state: params.state || params.geo_state || null,
    city: params.city || params.geo_city || null,
    channel: params.channel || null,
    section: params.section || params.bind_section || null,
    page: params.page || null,
    route: params.route || null,
    external: params.external == null ? null : params.external,
    noExternal: params.noExternal == null ? null : params.noExternal,
    disableExternal: params.disableExternal == null ? null : params.disableExternal
  };
}

function safeUrl(u){
  const v = s(u).trim();
  return v;
}

function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./,''); }
  catch(_){ return ""; }
}

function canonicalizeItem(raw, query){
  if(!raw || typeof raw !== 'object') return null;

  const url = safeUrl(raw.url || raw.link || raw.href || "");
  const title = s(raw.title || raw.name || "").trim();
  const summary = s(raw.summary || raw.snippet || raw.description || "").trim();

  // prefer existing canonical keys; preserve routing/slot metadata for insight quality gate
  const basePayload = (raw.payload && typeof raw.payload === 'object') ? raw.payload : {};
  const rawSource = (raw.source && typeof raw.source === 'object')
    ? (raw.source.name || raw.source.platform || raw.source.id || "")
    : raw.source;
  const payload = {
    ...basePayload,
    source: basePayload.source || rawSource || null,
    tags: Array.isArray(basePayload.tags) ? basePayload.tags : (Array.isArray(raw.tags) ? raw.tags : []),
    channel: basePayload.channel || raw.channel || raw.bind?.channel || null,
    section: basePayload.section || raw.section || raw.bind?.section || null,
    page: basePayload.page || raw.page || raw.bind?.page || null,
    route: basePayload.route || raw.route || raw.bind?.route || null,
    geo: basePayload.geo || raw.geo || null,
    bind: basePayload.bind || raw.bind || null,
    extension: basePayload.extension || raw.extension || null,
    monetization: basePayload.monetization || raw.monetization || null,
    revenue: basePayload.revenue || raw.revenue || null,
    revenueDestination: basePayload.revenueDestination || raw.revenueDestination || null,
    directSale: basePayload.directSale || raw.directSale || null,
    media: basePayload.media || raw.media || null
  };

  const id = s(raw.id || url || title || "").trim() || ("item-" + Math.random().toString(16).slice(2));

  const type = s(raw.type || payload.type || "web").trim() || "web";
  const mediaType = s(raw.mediaType || payload.mediaType || (type === 'video' ? 'video' : (type === 'image' ? 'image' : 'article'))).trim();

  const source = s(rawSource || payload.source || domainOf(url) || "").trim() || null;
  const thumbnail = s(raw.thumbnail || raw.thumb || payload.thumb || payload.thumbnail || payload.image || payload.image_url || payload.og_image || "").trim() || "";

  // keep existing scoring signals if present
  const score =
    (typeof raw.qualityScore === 'number') ? raw.qualityScore :
    (typeof raw._coreScore === 'number') ? raw._coreScore :
    (typeof raw.score === 'number') ? raw.score :
    (payload && typeof payload.score === 'number') ? payload.score :
    0;

  // basic query relevance bump (non-destructive)
  let qBoost = 0;
  if(query){
    const q = low(query);
    const t = low(title);
    const d = low(summary);
    if(t.includes(q)) qBoost += 0.15;
    if(d.includes(q)) qBoost += 0.08;
  }

  return {
    id,
    type,
    mediaType,
    title,
    summary,
    url,
    source,
    thumbnail,
    score: score + qBoost,
    payload
  };
}

function dedup(items){
  const out = [];
  const seen = new Set();
  for(const it of items){
    if(!it) continue;
    const k = s(it.url || it.id || "").trim();
    const key = k ? low(k) : low(s(it.title || "") + "|" + s(it.source || ""));
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function payloadOf(it){
  return (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
}

function flatText(v){
  try{
    if(Array.isArray(v)) return v.map(flatText).join(' ');
    if(v && typeof v === 'object') return Object.keys(v).map(k => flatText(v[k])).join(' ');
    return s(v);
  }catch(_){ return ''; }
}

function hasRealUrl(it){
  const u = s(it && it.url).trim();
  if(!u || u === '#') return false;
  if(/^javascript:/i.test(u)) return false;
  if(/^void\(/i.test(u)) return false;
  return true;
}

function isGenericPlaceholderTitle(title){
  const raw = s(title).trim();
  const t = low(raw);
  if(!t) return true;
  return (
    /^network item\s*\d+$/i.test(raw) ||
    /^item\s*\d+$/i.test(raw) ||
    /^sample\s+item\s*\d*$/i.test(raw) ||
    t.includes('placeholder') ||
    t.includes('sample') ||
    t.includes('demo') ||
    t.includes('dummy') ||
    t.includes('seed placeholder')
  );
}

function isPreparedExpansionSlot(it, context){
  const p = payloadOf(it);
  const hay = low([
    it && it.title,
    it && it.summary,
    it && it.source,
    it && it.type,
    it && it.mediaType,
    it && it.url,
    p.channel,
    p.section,
    p.page,
    p.route,
    p.source,
    flatText(p.tags),
    flatText(p.bind),
    flatText(p.extension),
    context && context.intent,
    context && context.channel,
    context && context.section,
    context && context.page,
    context && context.route
  ].join(' '));

  const allowHints = [
    'social', 'networkhub', 'network', 'broadcaster', 'broadcast',
    'academic', 'literature', 'scholar', 'research', 'journal', 'book',
    'media', 'video', 'webtoon', 'commerce', 'shopping', 'distribution',
    'donation', 'tour', 'culture', 'arts', 'education', 'platform'
  ];

  return allowHints.some(k => hay.includes(k));
}

function placeholderSignalScore(it){
  let score = 0;
  const p = payloadOf(it);
  const title = s(it && it.title).trim();
  const summary = s(it && it.summary).trim();
  const url = s(it && it.url).trim();
  const source = low((it && it.source) || p.source);
  const thumb = low((it && it.thumbnail) || p.thumbnail || p.thumb || p.image || p.og_image);
  const payloadText = low(flatText({
    tags: p.tags,
    channel: p.channel,
    section: p.section,
    page: p.page,
    route: p.route,
    bind: p.bind,
    extension: p.extension
  }));

  if(!hasRealUrl(it)) score += 0.30;
  if(isGenericPlaceholderTitle(title)) score += 0.30;
  if(!summary || summary.length < 8) score += 0.12;

  if(source.includes('seed')) score += 0.18;
  if(source.includes('placeholder')) score += 0.22;
  if(payloadText.includes('placeholder')) score += 0.18;
  if(payloadText.includes('seed')) score += 0.12;
  if(payloadText.includes('replaceable')) score += 0.08;

  if(thumb.includes('/assets/sample/')) score += 0.14;
  if(thumb.includes('placeholder')) score += 0.18;
  if(thumb.includes('noimage') || thumb.includes('no_image')) score += 0.18;

  if(p.placeholder === true) score += 0.35;
  if(p.seed === true) score += 0.24;
  if(p.source === 'seed') score += 0.24;
  if(p.extension && p.extension.placeholder === true) score += 0.35;
  if(url.includes('/seed/')) score += 0.28;

  return Math.min(1, score);
}

function isContextRelevant(it, query, context){
  const q = low(query);
  const p = payloadOf(it);
  const ctx = [
    context && context.scope,
    context && context.target,
    context && context.intent,
    context && context.region,
    context && context.country,
    context && context.state,
    context && context.city,
    context && context.channel,
    context && context.section,
    context && context.page,
    context && context.route
  ].map(low).filter(Boolean);

  const hay = low([
    it && it.title,
    it && it.summary,
    it && it.source,
    it && it.type,
    it && it.mediaType,
    it && it.url,
    p.channel,
    p.section,
    p.page,
    p.route,
    p.source,
    flatText(p.tags),
    flatText(p.bind),
    flatText(p.geo),
    flatText(p.extension)
  ].join(' '));

  if(q && hay.includes(q)) return true;
  return ctx.some(v => v && hay.includes(v));
}

function applyInsightQualityGate(items, query, context){
  const out = [];
  const stats = {
    input: Array.isArray(items) ? items.length : 0,
    output: 0,
    dropped: 0,
    downgraded: 0,
    preparedSlots: 0
  };

  for(const it of Array.isArray(items) ? items : []){
    if(!it) continue;

    const signal = placeholderSignalScore(it);
    const relevant = isContextRelevant(it, query, context);
    const realUrl = hasRealUrl(it);
    const hasBody = !!(s(it.title).trim() && s(it.summary).trim().length >= 8);
    const preparedSlot = isPreparedExpansionSlot(it, context);

    if(preparedSlot) stats.preparedSlots++;

    // Exclude only clear noise. Future social/broadcast/academic/literature slots are preserved.
    if(signal >= 0.78 && !realUrl && !hasBody && !relevant && !preparedSlot){
      stats.dropped++;
      continue;
    }

    let penalty = 0;
    let qualityClass = 'real_content';

    if(signal >= 0.50){
      qualityClass = preparedSlot ? 'prepared_slot' : 'placeholder_likely';
      penalty = preparedSlot ? 0.18 : (relevant ? 0.28 : 0.58);
    }else if(signal >= 0.24){
      qualityClass = preparedSlot ? 'prepared_slot' : 'weak_placeholder_signal';
      penalty = preparedSlot ? 0.08 : (relevant ? 0.12 : 0.24);
    }

    if(penalty > 0) stats.downgraded++;

    out.push({
      ...it,
      score: Math.max(0, Number(it.score || 0) - penalty),
      payload: {
        ...payloadOf(it),
        insightQuality: {
          class: qualityClass,
          placeholderSignal: signal,
          relevant,
          preparedSlot,
          penalty,
          summaryEligible: qualityClass === 'real_content' || (realUrl && signal < 0.50)
        }
      }
    });
  }

  stats.output = out.length;
  return { items: out, stats };
}

function summarySafeItems(items){
  const clean = (Array.isArray(items) ? items : []).filter(it => {
    const iq = it && it.payload && it.payload.insightQuality;
    if(iq && iq.summaryEligible === false) return false;
    const signal = iq ? Number(iq.placeholderSignal || 0) : placeholderSignalScore(it);
    return signal < 0.50 || hasRealUrl(it);
  });

  return clean.length ? clean : (Array.isArray(items) ? items : []);
}



function truthyValue(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const t = low(v).trim();
  return !!t && !['0','false','no','off','disable','disabled','null','undefined'].includes(t);
}

function isExternalExplicitlyOff(context){
  context = context || {};
  const ext = low(context.external).trim();
  return ext === 'off' || ext === '0' || ext === 'false'
    || truthyValue(context.noExternal)
    || truthyValue(context.disableExternal);
}

function shouldForceExternalForInsight(mode, context){
  const m = low(mode || 'global-insight');
  const c = context || {};
  if(isExternalExplicitlyOff(c)) return false;
  if(m.includes('global-insight')) return true;
  if(['region','country','global','continent','area'].includes(low(c.scope))) return true;
  if(['summary','brief','country_brief','region_brief','global_brief','analysis','research','media','news'].includes(low(c.intent))) return true;
  return false;
}

function withGlobalInsightSearchDefaults(context, mode){
  const out = { ...(context || {}) };
  if(shouldForceExternalForInsight(mode, out)){
    if(out.external == null || s(out.external).trim() === '') out.external = 'deep';
    if(out.deep == null) out.deep = true;
    out.useExternal = true;
    out.useLive = true;
    out.useExternalSources = true;
  }
  return out;
}

const REGION_ALIASES = [
  { key:'europe', labels:['유럽','europe','eu','european union','유럽연합'], nameKo:'유럽' },
  { key:'americas', labels:['아메리카','americas','america','미주','북미','남미','라틴아메리카','north america','south america','latin america'], nameKo:'아메리카' },
  { key:'africa', labels:['아프리카','africa'], nameKo:'아프리카' },
  { key:'asia', labels:['아시아','asia','동아시아','동남아','중앙아시아','east asia','southeast asia','central asia'], nameKo:'아시아' },
  { key:'middle_east', labels:['중동','middle east','mena','서아시아'], nameKo:'중동' },
  { key:'oceania', labels:['오세아니아','oceania','태평양','pacific'], nameKo:'오세아니아' }
];

const COUNTRY_ALIASES = [
  { key:'us', labels:['미국','usa','u.s.','united states','america','미합중국'], nameKo:'미국' },
  { key:'uk', labels:['영국','uk','united kingdom','britain','great britain'], nameKo:'영국' },
  { key:'japan', labels:['일본','japan'], nameKo:'일본' },
  { key:'singapore', labels:['싱가포르','singapore'], nameKo:'싱가포르' },
  { key:'china', labels:['중국','china'], nameKo:'중국' },
  { key:'germany', labels:['독일','germany'], nameKo:'독일' },
  { key:'france', labels:['프랑스','france'], nameKo:'프랑스' },
  { key:'ukraine', labels:['우크라이나','ukraine'], nameKo:'우크라이나' },
  { key:'russia', labels:['러시아','russia'], nameKo:'러시아' },
  { key:'india', labels:['인도','india'], nameKo:'인도' },
  { key:'korea', labels:['한국','대한민국','south korea','republic of korea','korea'], nameKo:'대한민국' },
  { key:'canada', labels:['캐나다','canada'], nameKo:'캐나다' },
  { key:'australia', labels:['호주','오스트레일리아','australia'], nameKo:'호주' },
  { key:'brazil', labels:['브라질','brazil'], nameKo:'브라질' }
];

function matchAlias(query, list){
  const q = low(query).trim();
  if(!q) return null;
  for(const item of list){
    if(item.labels.some(label => q === low(label) || q.includes(low(label)))) return item;
  }
  return null;
}

function inferFocus(query, context){
  const hay = low([query, context && context.intent, context && context.channel, context && context.section].join(' '));
  if(/교육|학술|학교|대학|education|academic|university/.test(hay)) return 'education';
  if(/문화|종교|문학|예술|culture|religion|literature|arts/.test(hay)) return 'culture';
  if(/경제|산업|무역|시장|금융|commerce|economy|industry|trade|finance/.test(hay)) return 'economy';
  if(/안보|국방|전쟁|분쟁|외교|security|defense|war|conflict|diplomacy/.test(hay)) return 'security';
  if(/뉴스|미디어|영상|방송|media|video|news|broadcast/.test(hay)) return 'media';
  if(/정치|정부|선거|policy|politic|government|election/.test(hay)) return 'politics';
  return null;
}

function buildInsightProfile(query, context){
  context = context || {};
  const targetText = s(context.target || context.country || context.region || query).trim();
  const regionHit = matchAlias(targetText || query, REGION_ALIASES);
  const countryHit = matchAlias(targetText || query, COUNTRY_ALIASES);
  const focus = inferFocus(query, context);
  let scope = low(context.scope || 'global');
  let kind = 'topic';
  let targetName = targetText || query;

  if(scope === 'region' || scope === 'continent' || regionHit){
    kind = 'region';
    scope = 'region';
    targetName = regionHit ? regionHit.nameKo : targetName;
  }else if(scope === 'country' || countryHit || (targetText && targetText.length <= 24 && !focus)){
    kind = 'country';
    scope = 'country';
    targetName = countryHit ? countryHit.nameKo : targetName;
  }

  const baseTerms = kind === 'region'
    ? '정치 경제 문화 국가 현황 안보 분쟁 뉴스 미디어 overview politics economy culture security news'
    : kind === 'country'
      ? '인구 영토 국가 개요 정치 경제 문화 종교 사회 안보 외교 뉴스 overview population territory politics economy culture religion security news'
      : '개요 배경 현황 주요 이슈 전망 관련 뉴스 분석 overview background current issues analysis news';

  const focusTerms = focus ? ({
    education:'교육 학술 대학 연구 제도 education academic research',
    culture:'문화 종교 문학 예술 사회 culture religion literature arts society',
    economy:'경제 산업 무역 시장 금융 economy industry trade market finance',
    security:'안보 국방 전쟁 분쟁 외교 security defense war conflict diplomacy',
    media:'뉴스 미디어 영상 방송 현장 자료 news media video broadcast',
    politics:'정치 정부 정책 선거 외교 politics government policy election diplomacy'
  }[focus] || '') : '';

  return {
    kind,
    scope,
    target: targetName,
    focus,
    defaultLimit: kind === 'region' || kind === 'country' ? 80 : 60,
    searchQuery: [query, targetName !== query ? targetName : '', baseTerms, focusTerms].filter(Boolean).join(' ')
  };
}

function applyInsightProfileToContext(context, profile){
  return {
    ...(context || {}),
    scope: profile.scope || (context && context.scope) || 'global',
    target: (context && context.target) || profile.target || null,
    intent: profile.focus ? profile.focus : ((context && context.intent) || (profile.kind === 'country' ? 'country_brief' : (profile.kind === 'region' ? 'region_brief' : 'summary'))),
    insightKind: profile.kind,
    insightFocus: profile.focus || null
  };
}

function snippet(v, max = 150){
  const t = s(v).replace(/\s+/g, ' ').trim();
  if(!t) return '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function itemText(it){
  const p = payloadOf(it);
  return low([it && it.title, it && it.summary, it && it.source, it && it.type, it && it.mediaType, it && it.url, flatText(p.tags), flatText(p.geo), flatText(p.bind)].join(' '));
}

function sectionDefinitions(profile){
  const commonNews = { id:'news_media', title:'뉴스·미디어·현안', keywords:/뉴스|속보|전쟁|분쟁|우크라이나|media|news|video|youtube|broadcast|war|conflict|current/i };
  if(profile.kind === 'country'){
    return [
      { id:'overview', title:'기본 개요', keywords:/개요|인구|영토|수도|국가|사회|overview|population|territory|capital|profile/i },
      { id:'politics', title:'정치·정부·외교', keywords:/정치|정부|대통령|총리|의회|외교|선거|policy|politic|government|election|diplomacy/i },
      { id:'economy', title:'경제·산업·시장', keywords:/경제|산업|무역|수출|시장|금융|기업|gdp|economy|industry|trade|market|finance|business/i },
      { id:'culture', title:'문화·종교·사회', keywords:/문화|종교|교육|사회|문학|예술|관광|culture|religion|education|society|literature|arts|tour/i },
      { id:'security', title:'안보·국방·리스크', keywords:/안보|국방|군사|전쟁|분쟁|위험|제재|security|defense|military|war|conflict|risk|sanction/i },
      commonNews
    ];
  }
  if(profile.kind === 'region'){
    return [
      { id:'overview', title:'권역 개요', keywords:/개요|권역|국가|지역|동맹|연합|overview|region|countries|union|bloc/i },
      { id:'countries', title:'주요 국가·지역 상황', keywords:/국가|지역|수도|인구|유럽연합|eu|country|state|region|population/i },
      { id:'politics_security', title:'정치·안보·분쟁', keywords:/정치|안보|전쟁|분쟁|외교|우크라이나|nato|security|war|conflict|diplomacy|politic/i },
      { id:'economy', title:'경제·산업·무역', keywords:/경제|산업|무역|에너지|시장|금융|economy|industry|trade|energy|market|finance/i },
      { id:'culture_society', title:'문화·사회·이동', keywords:/문화|사회|교육|종교|관광|이민|culture|society|education|religion|tour|migration/i },
      commonNews
    ];
  }
  return [
    { id:'overview', title:'핵심 개요', keywords:/개요|배경|정의|overview|background|profile/i },
    { id:'current', title:'현재 이슈', keywords:/뉴스|현황|최근|속보|current|latest|news|issue/i },
    { id:'analysis', title:'분석 포인트', keywords:/분석|전망|영향|리스크|analysis|impact|risk|outlook/i },
    { id:'media', title:'관련 자료·미디어', keywords:/미디어|영상|이미지|방송|media|video|image|broadcast|youtube/i }
  ];
}

function selectSectionItems(items, def, used){
  const arr = Array.isArray(items) ? items : [];
  const matches = arr.filter(it => !used.has(it.id || it.url || it.title) && def.keywords.test(itemText(it))).slice(0, 4);
  if(matches.length < 2){
    for(const it of arr){
      const key = it.id || it.url || it.title;
      if(matches.length >= 3) break;
      if(used.has(key)) continue;
      if(matches.includes(it)) continue;
      matches.push(it);
    }
  }
  matches.forEach(it => used.add(it.id || it.url || it.title));
  return matches;
}

function bulletFromItem(it){
  const title = snippet(it && it.title, 90);
  const body = snippet((it && (it.summary || it.description)) || '', 130);
  const source = snippet((it && it.source) || domainOf(it && it.url), 36);
  if(title && body) return `${title} — ${body}${source ? ` (${source})` : ''}`;
  if(title) return `${title}${source ? ` (${source})` : ''}`;
  if(body) return body;
  return '';
}

function buildInsightBrief(query, items, context, profile){
  const safeItems = Array.isArray(items) ? items : [];
  profile = profile || buildInsightProfile(query, context);
  const target = profile.target || query;
  const used = new Set();
  const defs = sectionDefinitions(profile);

  const sections = defs.map(def => {
    const picked = selectSectionItems(safeItems, def, used);
    const bullets = picked.map(bulletFromItem).filter(Boolean);
    if(!bullets.length){
      bullets.push('현재 수집 결과에서 이 항목을 직접 뒷받침하는 자료가 부족합니다. 외부 검색 또는 세부 질문으로 보강할 수 있습니다.');
    }
    return {
      id: def.id,
      title: def.title,
      bullets,
      items: picked.slice(0, 3)
    };
  });

  if(profile.focus){
    const focusLabel = {
      education:'교육·학술', culture:'문화·종교·사회', economy:'경제·산업', security:'안보·분쟁', media:'미디어·뉴스', politics:'정치·정책'
    }[profile.focus] || '세부 주제';
    sections.unshift({
      id:'focused_request',
      title:`요청 집중 분야: ${focusLabel}`,
      bullets:[`이번 요청은 ${target}의 ${focusLabel} 축을 우선으로 해석했습니다. 관련 자료를 상단에 배치하고 나머지는 배경 정보로 정리합니다.`],
      items: []
    });
  }

  const title = profile.kind === 'region'
    ? `“${target}” 권역 인사이트 요약`
    : profile.kind === 'country'
      ? `“${target}” 국가 인사이트 요약`
      : `“${query}” 글로벌 인사이트 요약`;

  const lines = [
    title,
    `수집 기준: Search Bank/Snapshot 보강 + Maru Search 외부 검색 기본 확장 · 관련 자료 ${safeItems.length}건`,
    ''
  ];
  for(const sec of sections){
    lines.push(`■ ${sec.title}`);
    sec.bullets.slice(0, 3).forEach(b => lines.push(`- ${b}`));
    lines.push('');
  }

  return {
    headline: title,
    summary: lines.join('\n').trim(),
    text: lines.join('\n').trim(),
    sections,
    profile
  };
}

function pickSummary(query, items){
  const q = s(query).trim();
  if(!q) return "";
  return buildInsightBrief(q, items, { scope:'global', intent:'summary' }, null).summary;
}

function ok(body){
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
    },
    body: JSON.stringify(body)
  };
}

function fail(message, detail){
  return ok({
    status: "fail",
    engine: "maru-global-insight",
    version: VERSION,
    message: s(message || "ENGINE_ERROR"),
    detail: detail == null ? null : s(detail)
  });
}

// ---------- ENGINE CALLS ----------
async function callMaruSearch(query, mode, limit, context){

  if(!MaruSearch || typeof MaruSearch.runEngine !== "function"){
    return { ok:false, error:"MARU_SEARCH_UNAVAILABLE" };
  }

  try{
    context = context || {};
    const runMode = mode || "global-insight";
    const searchContext = withGlobalInsightSearchDefaults(context, runMode);
    const externalOff = isExternalExplicitlyOff(searchContext);
    const res = await MaruSearch.runEngine({}, {
      q: query,
      query: query,
      mode: runMode,
      limit,
      scope: searchContext.scope || null,
      target: searchContext.target || null,
      intent: searchContext.intent || null,
      uiLang: searchContext.uiLang || null,
      targetLang: searchContext.targetLang || null,
      region: searchContext.region || null,
      country: searchContext.country || null,
      state: searchContext.state || null,
      city: searchContext.city || null,
      channel: searchContext.channel || null,
      section: searchContext.section || null,
      page: searchContext.page || null,
      route: searchContext.route || null,
      external: searchContext.external,
      noExternal: searchContext.noExternal,
      disableExternal: searchContext.disableExternal,
      deep: !externalOff && truthyValue(searchContext.deep),
      useExternal: !externalOff && truthyValue(searchContext.useExternal),
      useLive: !externalOff && truthyValue(searchContext.useLive),
      useExternalSources: !externalOff && truthyValue(searchContext.useExternalSources),
      noAnalytics: true,
      noRevenue: true,
      from: "global-insight"
    });

    const items =
      (res && Array.isArray(res.items)) ? res.items :
      (res && Array.isArray(res.results)) ? res.results :
      (res && res.data && Array.isArray(res.data.items)) ? res.data.items :
      [];

    if(res && (items.length || res.source || res.region || res.route || res.meta)){
      return {
        ok:true,
        data:{
          status:"ok",
          engine:"maru-search",
          version: res.version || null,
          source: res.source || "maru-search",
          region: res.region || null,
          route: res.route || null,
          meta: res.meta || null,
          items,
          results: items
        }
      };
    }

    return { ok:false, error:"SEARCH_FAIL" };
  }catch(e){
    return { ok:false, error:(e && e.message) ? e.message : "SEARCH_EXCEPTION" };
  }
}

async function callSearchBank(event, query, limit, context){
  if(!BankEngine || typeof BankEngine.runEngine !== 'function'){
    return { ok:false, error:"BANK_ENGINE_UNAVAILABLE" };
  }
  try{
    context = context || {};
    const params = {
      q: query,
      query: query,
      limit,
      from: 'global-insight',
      channel: context.channel || (context.intent === 'media' ? 'media' : undefined),
      section: context.section || undefined,
      page: context.page || undefined,
      route: context.route || undefined,
      region: context.region || undefined,
      country: context.country || undefined,
      state: context.state || undefined,
      city: context.city || undefined,
      external: context.external,
      noExternal: context.noExternal,
      disableExternal: context.disableExternal,
      type: context.intent === 'media' ? 'video' : undefined
    };
    const res = await BankEngine.runEngine(event || {}, params);
    if(res && res.status === 'ok') return { ok:true, data: res };
    return { ok:true, data: res || { status:'ok', items:[] } };
  }catch(e){
    return { ok:false, error: s(e && e.message ? e.message : "BANK_EXCEPTION") };
  }
}

// ---------- AGGREGATOR CORE ----------
async function runGlobalInsightV2(event, params){
  const query = normalizeQuery(params.q || params.query);
  const mode = s(params.mode || 'global-insight').trim() || 'global-insight';
  const requestedLimit = clampInt(params.limit, 20, 1, 1000);
  const context = normalizeContext(params);
  const insightProfile = buildInsightProfile(query, context);
  const effectiveContext = applyInsightProfileToContext(context, insightProfile);
  const effectiveLimit = clampInt(Math.max(requestedLimit, insightProfile.defaultLimit || requestedLimit), 20, 1, 1000);

  // Validate query (non-breaking)
  if(Core && typeof Core.validateQuery === 'function'){
    const v = Core.validateQuery(query);
    if(v === false || (v && typeof v === 'object' && v.ok === false)){
      return {
        status: 'ok',
        engine: 'maru-global-insight',
        version: VERSION,
        timestamp: nowISO(),
        query,
        mode,
        context,
        items: [],
        results: [],
        summary: query ? `“${query}” 관련 인사이트를 취합 중입니다.` : '',
        text: query ? `“${query}” 관련 인사이트를 취합 중입니다.` : '',
        issues: [],
        meta: { trace: { core_validate: 'blocked' }, count: 0, limit: effectiveLimit, requestedLimit }
      };
    }
  }

  if(!query && mode === 'search'){
    return {
      status: 'ok',
      engine: 'maru-global-insight',
      version: VERSION,
      timestamp: nowISO(),
      query,
      mode,
      context,
      items: [],
      results: [],
      summary: '',
      text: '',
      issues: [],
      meta: { trace: { empty_query: true }, count: 0, limit: effectiveLimit, requestedLimit }
    };
  }

  const trace = {
    maru_search: { ok:false, count:0, error:null },
    search_bank: { ok:false, count:0, error:null }
  };

const [ms, bank] = await Promise.allSettled([
  callMaruSearch(insightProfile.searchQuery || query, mode, effectiveLimit, effectiveContext),
  callSearchBank(event, query, Math.min(effectiveLimit, 200), effectiveContext)
]);

const msRes =
  ms.status === "fulfilled"
    ? ms.value
    : { ok:false, error:"SEARCH_FAIL" };

const bankRes =
  bank.status === "fulfilled"
    ? bank.value
    : { ok:false, error:"BANK_FAIL" };

let msItems = [];
if(msRes.ok && msRes.data){
  const d = msRes.data;
  const arr = Array.isArray(d.items)
    ? d.items
    : (Array.isArray(d.results)
        ? d.results
        : (Array.isArray(d.data && d.data.items)
            ? d.data.items
            : []));
  msItems = arr.map(it => canonicalizeItem(it, query)).filter(Boolean);
  trace.maru_search.ok = (d.status === 'ok');
  trace.maru_search.count = msItems.length;
} else {
  trace.maru_search.ok = false;
  trace.maru_search.error = msRes.error || 'SEARCH_FAIL';
}

let bankItems = [];
if(bankRes.ok && bankRes.data){
  const d = bankRes.data;
  const arr = Array.isArray(d.items) ? d.items : [];
  bankItems = arr.map(it => canonicalizeItem(it, query)).filter(Boolean);
  trace.search_bank.ok = (d.status === 'ok');
  trace.search_bank.count = bankItems.length;
} else {
  trace.search_bank.ok = false;
  trace.search_bank.error = bankRes.error || 'BANK_FAIL';
}

  // merge + dedup + quality gate + rank
  let merged = dedup([ ...bankItems, ...msItems ]);
  const qualityGate = applyInsightQualityGate(merged, query, effectiveContext);
  merged = qualityGate.items;
  merged.sort((a,b)=> (b.score||0) - (a.score||0));
  merged = merged.slice(0, effectiveLimit);

  // briefing: global insight uses Maru Search as collection layer and composes a readable brief here.
  const brief = buildInsightBrief(query, summarySafeItems(merged), effectiveContext, insightProfile);
  const summary = brief.summary;
  const text = brief.text;

  // issues (future). keep stable array.
  const issues = [];

  const payload = {
    status: 'ok',
    engine: 'maru-global-insight',
    version: VERSION,
    timestamp: nowISO(),
    query,
    mode,
    context: effectiveContext,

    // Canonical outputs
    items: merged,
    results: merged, // legacy alias

    // Human-facing
    headline: brief.headline,
    summary,
    text,
    brief,
    sections: brief.sections,

    issues,

    meta: {
      count: merged.length,
      limit: effectiveLimit,
      requestedLimit,
      trace,
	  
    served_from: {
    bank: bankRes.ok ? (bankRes.data && bankRes.data.served_from) : null,
    search: msRes.ok ? (msRes.data && (msRes.data.source || msRes.data.engine)) : null
},
    quality: qualityGate.stats,
    insightProfile: brief.profile,
    externalDefault: {
      maruSearch: shouldForceExternalForInsight(mode, effectiveContext) ? 'on' : 'off_or_request_controlled',
      value: withGlobalInsightSearchDefaults(effectiveContext, mode).external || null
    }
    },

    // Raw passthrough (for debugging / future consumers)
    data: {
      bank: bankRes.ok ? (bankRes.data || null) : null,
      search: msRes.ok ? (msRes.data || null) : null
}
  };

  // Optional normalizeResult hook (non-breaking)
  if(Core && typeof Core.normalizeResult === 'function'){
    try{
      // normalizeResult may return a new object; keep canonical keys guaranteed
      const n = Core.normalizeResult(payload);
      if(n && typeof n === 'object'){
        // re-assert canonical guarantees
        n.status = 'ok';
        n.engine = 'maru-global-insight';
        n.version = VERSION;
        n.query = payload.query;
        n.mode = payload.mode;
        n.context = payload.context;
        n.items = Array.isArray(n.items) ? n.items : payload.items;
        n.results = Array.isArray(n.results) ? n.results : n.items;
        n.summary = s(n.summary || n.text || payload.summary);
        n.text = s(n.text || n.summary || payload.text);
        n.headline = s(n.headline || payload.headline || '');
        n.brief = n.brief || payload.brief;
        n.sections = Array.isArray(n.sections) ? n.sections : payload.sections;
        n.meta = (n.meta && typeof n.meta === 'object') ? n.meta : payload.meta;
        if(!n.meta.trace) n.meta.trace = payload.meta.trace;
        return n;
      }
    }catch(_){ /* ignore */ }
  }

  return payload;
}

// ---------- NETLIFY HANDLER ----------
exports.handler = async function(event){
  try{
    const params = event && event.queryStringParameters ? event.queryStringParameters : {};
    const out = await runGlobalInsightV2(event || {}, params || {});
    return ok(out);
  }catch(e){
    return fail('ENGINE_EXCEPTION', e && e.message ? e.message : String(e));
  }
};

exports.runGlobalInsight = async function(params = {}, event = null){
  // Compatibility: keep name "runGlobalInsight" exported
  return await runGlobalInsightV2(event || {}, params || {});
};

// =========================================================
// GLOBAL INSIGHT ENGINE EXPORT ADAPTER (Collector compatibility)
// 기존 코드 수정 없음 / 확장 export만 추가
// =========================================================

async function runEngine(event = {}, params = {}) {

  if (typeof runGlobalInsightV2 === "function") {

    return await runGlobalInsightV2(event, {
      q: params.q || params.query || "",
      mode: params.mode || "global-insight",
      limit: params.limit || 20,
      scope: params.scope,
      target: params.target,
      intent: params.intent,
      uiLang: params.uiLang || params.locale || params.lang,
      targetLang: params.targetLang || params.contentLang || params.filterLang || params.searchLang,
      region: params.region || params.geo_region,
      country: params.country || params.geo_country,
      state: params.state || params.geo_state,
      city: params.city || params.geo_city,
      channel: params.channel,
      section: params.section || params.bind_section,
      page: params.page,
      route: params.route,
      external: params.external,
      noExternal: params.noExternal,
      disableExternal: params.disableExternal
    });

  }

  return {
    status: "fail",
    engine: "maru-global-insight",
    message: "INSIGHT_ENGINE_NOT_AVAILABLE"
  };
}

exports.runEngine = runEngine;

