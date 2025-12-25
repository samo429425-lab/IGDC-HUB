/*!
 * distribution-automap.v1.research-fixed.js
 * 목적: "통블록(스켈레톤/전면폭 카드 고착)" + "2~3차 렌더링으로 일부 섹션 미복구" 방지
 * 핵심 정책:
 *  - 섹션별로 "자기 키(data-psom-key)"를 기준으로 개별 fetch (feed.js의 ?key= 를 정식 사용)
 *  - 절대 전체 innerHTML 초기화하지 않음
 *  - 스켈레톤(.thumb-card.skeleton)만 안전 제거 후 실제 카드 append
 *  - 이미 실카드가 있으면(스켈레톤 제외) 추가 렌더링 금지(중복/3차 렌더 방지)
 */
(function () {
  'use strict';

  const SELECTOR_HOST = '.thumb-grid[data-psom-key], .thumb-list[data-psom-key], .thumb-scroller[data-psom-key]';
  const FEED_FN = '/.netlify/functions/feed'; // feed.js (Netlify Function)
  const FALLBACK_PREFIXES = [
    '/assets/data/',          // e.g. /assets/data/distribution-new.json (있으면)
    '/assets/hero/'           // e.g. /assets/hero/psom.json (최후수단)
  ];

  // 렌더링 단위(초기/추가)
  const RENDER = { initial: 8, batch: 10 };

  function safeText(s){ return (s==null?'':String(s)).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,''); }

  function isSkeleton(el){ return !!(el && el.classList && el.classList.contains('skeleton')); }

  function hasRealCards(host){
    const cards = host.querySelectorAll('.thumb-card');
    for (const c of cards) { if (!isSkeleton(c)) return true; }
    return false;
  }

  function removeSkeletons(host){
    host.querySelectorAll('.thumb-card.skeleton').forEach(el => el.remove());
  }

  function normalizeItems(json){
    if (!json) return [];
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.sections)) {
      // sections 배열이면 items만 평탄화 (예: 백업 구조)
      const out = [];
      json.sections.forEach(s => Array.isArray(s.items) && out.push(...s.items));
      return out;
    }
    if (Array.isArray(json)) return json;
    if (json.data && Array.isArray(json.data.items)) return json.data.items;
    if (json.data && Array.isArray(json.data)) return json.data;
    return [];
  }

  function isAllowed(x){
    if (!x) return false;
    const t = [x.title, x.brand, x.desc, x.url, x.detailUrl].filter(Boolean).join(' ');
    const ban = [/도박|베팅|카지노|토토/i, /성인|19\\+|porn|sex/i, /범죄|마약|총기/i, /스캠|피싱|사기|scam/i];
    if (ban.some(rx => rx.test(t))) return false;
    return !!(x.id && (x.thumb || x.photo || x.img || x.image) && (x.detailUrl || x.url || x.href));
  }

  function detailUrl(x){
    return x.detailUrl || x.url || x.href || ('/product.html?id=' + encodeURIComponent(x.id || ''));
  }

  function imgUrl(x){ return x.thumb || x.photo || x.img || x.image || x.thumbnail || ''; }

  function cardHTML(x){
    const title = safeText(x.title || x.name || '');
    const price = x.price ? `<div class="thumb-price">${safeText(x.price)}</div>` : '';
    const tag   = x.tag ? `<span class="thumb-tag">${safeText(x.tag)}</span>` : '';
    return `<a class="thumb-card product-card" href="${detailUrl(x)}" data-product-id="${safeText(x.id||'')}" data-title="${title}" rel="noopener">
      <img class="thumb-img" loading="lazy" decoding="async" src="${imgUrl(x)}" alt="${title}">
      <div class="thumb-body">
        <div class="thumb-title">${title}</div>
        <div class="thumb-meta">${price}${tag}</div>
      </div>
    </a>`;
  }

  async function fetchJSON(url){
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP_' + r.status);
    return await r.json();
  }

  async function loadForKey(key){
    // 1) Netlify Function (정식): /.netlify/functions/feed?key=...
    try {
      return await fetchJSON(`${FEED_FN}?key=${encodeURIComponent(key)}&limit=120`);
    } catch (e) {}

    // 2) /assets/data/<key>.json (있으면)
    try {
      return await fetchJSON(`${FALLBACK_PREFIXES[0]}${encodeURIComponent(key)}.json`);
    } catch (e) {}

    // 3) /assets/hero/psom.json (배열일 가능성 큼) => page/key 필터
    try {
      const all = await fetchJSON(`${FALLBACK_PREFIXES[1]}psom.json`);
      const items = normalizeItems(all);
      return { items: items.filter(it => {
        const k = (it.page || it.pageKey || it.key || it.section || '').toLowerCase();
        return k === String(key).toLowerCase();
      }) };
    } catch (e) {}

    return { items: [] };
  }

  function mount(host, rawItems){
    if (!host) return;

    // host 내부에서 실제 카드가 이미 있으면(스켈레톤 제외) 중복 렌더 금지
    if (hasRealCards(host)) { host.dataset.mounted = '1'; return; }
    if (host.dataset.mounted === '1') return;

    host.dataset.mounted = '1';

    // 스켈레톤은 제거하고, 기존에 있던 다른 요소는 건드리지 않음
    removeSkeletons(host);

    const list = (rawItems || []).filter(isAllowed);
    let i = 0;

    const push = (it)=> host.insertAdjacentHTML('beforeend', cardHTML(it));

    for (; i < Math.min(RENDER.initial, list.length); i++) push(list[i]);

    if (!('IntersectionObserver' in window) || !host.lastElementChild) return;

    const io = new IntersectionObserver((ents)=>{
      ents.forEach(ent=>{
        if(!ent.isIntersecting) return;
        io.unobserve(ent.target);
        const s = i;
        const e = Math.min(i + RENDER.batch, list.length);
        for (let k=s; k<e; k++) push(list[k]);
        i = e;
        if (i < list.length && host.lastElementChild) io.observe(host.lastElementChild);
      });
    }, { rootMargin: '900px 0px' });

    io.observe(host.lastElementChild);
  }

  async function init(){
    const hosts = Array.from(document.querySelectorAll(SELECTOR_HOST));
    if (!hosts.length) return;

    await Promise.all(hosts.map(async (host)=>{
      const key = (host.getAttribute('data-psom-key') || '').trim();
      if (!key) return;
      try{
        const json = await loadForKey(key);
        const items = normalizeItems(json);
        mount(host, items);
      }catch(e){
        removeSkeletons(host);
      }
    }));

    document.dispatchEvent(new CustomEvent('thumbs:ready', { bubbles: true }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
