/**
 * donation-automap.integrated.v8.js
 * ------------------------------------------------------------
 * 목적:
 * - 기존 donation-automap.v7.enterprise.js 구조/역할 유지
 * - legacy donation-feed 없이 builder를 단일 실시간 소스로 사용
 * - donation HTML + donation.snapshot.json + donation builder 구조 모두 대응
 * - data-psom-key 기반 DOM 매핑 유지
 * - snapshot.items 기반 groupBySection 유지
 * - slot_limit / bank-first / rank sorting / verify bonus 유지
 */

(async function(){
  'use strict';

  const SNAPSHOT_PATHS = [
    // 1) canonical donation builder
    '/.netlify/functions/donation-snapshot-builder',
    '/netlify/functions/donation-snapshot-builder',

    // 2) static snapshot fallback
    '/data/donation.snapshot.json',
    '/netlify/functions/data/donation.snapshot.json'
  ];

  async function fetchJsonLoose(url){
    const r = await fetch(url, { cache:'no-store' });
    if(!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);

    let data;
    try{
      data = await r.json();
    }catch(e){
      throw new Error('INVALID_JSON @ ' + url);
    }

    // Netlify wrapper body support
    if(data && typeof data.body === 'string'){
      try{
        const parsed = JSON.parse(data.body);
        if(parsed) data = parsed;
      }catch(_e){}
    }

    return data;
  }

  function normalizeSections(rawSections){
    if(!rawSections) return [];

    // array form: [{ psom_key, slot_limit }]
    if(Array.isArray(rawSections)){
      return rawSections
        .filter(Boolean)
        .map((s)=>({
          psom_key: s.psom_key || s.key || s.section_key || s.id || '',
          slot_limit: Number(s.slot_limit || s.limit || s.count || 80)
        }))
        .filter((s)=>!!s.psom_key);
    }

    // object form: { donation-global:[...], donation-mission:[...] } or nested objects
    if(typeof rawSections === 'object'){
      return Object.keys(rawSections).map((key)=>{
        const sec = rawSections[key];

        if(sec && typeof sec === 'object' && !Array.isArray(sec)){
          return {
            psom_key: sec.psom_key || key,
            slot_limit: Number(sec.slot_limit || sec.limit || sec.count || 80)
          };
        }

        if(Array.isArray(sec)){
          return {
            psom_key: key,
            slot_limit: sec.length || 80
          };
        }

        return {
          psom_key: key,
          slot_limit: 80
        };
      }).filter((s)=>!!s.psom_key);
    }

    return [];
  }

  function normalizeItems(rawItems){
    const list = Array.isArray(rawItems) ? rawItems : [];

    return list.map((it)=>{
      it.__score = scoreItem(it);
      return it;
    });
  }

  function snapshotFromSectionsObject(raw){
    const sectionsArr = normalizeSections(raw);
    const items = [];

    Object.keys(raw || {}).forEach((key)=>{
      const sec = raw[key];
      const arr = Array.isArray(sec)
        ? sec
        : (Array.isArray(sec?.items) ? sec.items : []);

      arr.forEach((it)=>{
        if(!it || typeof it !== 'object') return;
        if(!it.psom_key) it.psom_key = key;
        items.push(it);
      });
    });

    return { sections: sectionsArr, items };
  }

  function normalizeSnapshot(data){
    if(!data || typeof data !== 'object') return null;

    // already correct shape
    if(data.sections && data.items){
      return {
        ...data,
        sections: normalizeSections(data.sections),
        items: Array.isArray(data.items) ? data.items : []
      };
    }

    // builder/page shape
    if(data.pages?.donation?.sections || data.pages?.donation?.items){
      const rawSections = data.pages.donation.sections || {};
      const rawItems = data.pages.donation.items || data.items || [];

      if(Array.isArray(rawItems) && rawItems.length){
        return {
          ...data,
          sections: normalizeSections(rawSections),
          items: rawItems
        };
      }

      return snapshotFromSectionsObject(rawSections);
    }

    // plain sections object with embedded arrays
    if(data.sections && typeof data.sections === 'object'){
      return snapshotFromSectionsObject(data.sections);
    }

    return null;
  }

  async function loadSnapshot(){
    let lastErr = null;

    for(const p of SNAPSHOT_PATHS){
      try{
        const data = await fetchJsonLoose(p);
        const snapshot = normalizeSnapshot(data);
        if(snapshot && snapshot.sections && snapshot.items){
          return snapshot;
        }
      }catch(e){
        lastErr = e;
      }
    }

    throw lastErr || new Error('Donation snapshot not found');
  }

  function buildSectionIndex(sections){
    const map = {};

    (Array.isArray(sections) ? sections : []).forEach((s)=>{
      if(!s || !s.psom_key) return;
      map[s.psom_key] = clampLimit(s.slot_limit || 80);
    });

    return map;
  }

  function scoreItem(it){
    let score = 0;

    // Bank priority
    if(it?.bank_ref && it.bank_ref.record_id){
      score += 1000000;
    }

    // Rank score
    if(it?.rank && typeof it.rank.score === 'number'){
      score += it.rank.score * 1000;
    }

    // Verification bonus
    if(it?.verify && it.verify.status === 'verified'){
      score += 500;
    }

    return score;
  }

function itemUrl(it){
  return safeUrl(it?.link?.url) || safeUrl(it?.media?.src) || safeUrl(it?.donation?.checkout_url) || safeUrl(it?.org?.homepage) || '';
}

function isUsableItem(it){
  if(!it || typeof it !== 'object') return false;
  const title = String(it?.title || it?.org?.name || '').trim();
  const url = itemUrl(it);
  const source = String(it?.meta?.source || it?.source?.name || '').toLowerCase();
  const text = (title + ' ' + String(it?.summary || '')).toLowerCase();
  if(!title || !/^https:\/\//i.test(url)) return false;
  if(/seed|sample|placeholder|automap-sample|demo|mock/.test(source)) return false;
  if(/\b(donation partner|global donation news|global news partner|ngo partner|mission partner|service partner|relief partner|education partner|environment partner|others partner)\s+\d+\b/i.test(text)) return false;
  if(/placeholder|sample-card/.test(String(it?.media?.thumb || it?.image || '').toLowerCase()) && !it?.meta?.managed_published) return false;
  return true;
}

function groupBySection(items){
  const map = {};
  (Array.isArray(items) ? items : []).forEach((it)=>{
    const k = it?.psom_key;
    if(!k || !isUsableItem(it)) return;
    if(!map[k]) map[k] = [];
    map[k].push(it);
  });
  return map;
}

  function sortSection(items){
    return (Array.isArray(items) ? items : []).sort((a,b)=>{
      if((b.__score || 0) !== (a.__score || 0)){
        return (b.__score || 0) - (a.__score || 0);
      }

      const ta = a?.meta?.updated_at || a?.updated_at || '';
      const tb = b?.meta?.updated_at || b?.updated_at || '';
      return String(tb).localeCompare(String(ta));
    });
  }

  function clampLimit(n){
    const x = Number(n);
    if(!Number.isFinite(x) || x <= 0) return 80;
    return Math.max(1, Math.min(200, Math.floor(x)));
  }

  function escHtml(s){
    const str = String(s ?? '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(s){
    return escHtml(String(s ?? '')).replace(/\s+/g, ' ').trim();
  }

  function safeUrl(u){
    const s = String(u ?? '').trim();
    if(!s || s === '#' || s === '/') return '';
    if(/^javascript:/i.test(s)) return '';
    if(/^https:\/\//i.test(s) || /^\/(?!\/)/.test(s)) return s;
    return '';
  }

  function renderCard(it){
    const img = safeUrl(it?.media?.thumb) || safeUrl(it?.image) || '';
    const title = escHtml(it?.title || it?.org?.name || '');
    const isVideo = String(it?.media?.kind || it?.type || '').toLowerCase() === 'video';
    const meta = escHtml(
      (isVideo ? 'VIDEO · ' : '') + (it?.org?.country || it?.category || '')
    );
    const summary = escHtml(it?.summary || it?.org?.legal_name || '');
    const url = itemUrl(it);
    const uid = escAttr(it?.uid || it?.id || '');

    return `
      <div class="card donation-card${isVideo ? ' donation-video-card' : ''}" data-uid="${uid}" data-url="${escAttr(url)}" data-media-kind="${isVideo ? 'video' : 'link'}" role="link" tabindex="0" aria-label="${title}">
        <div class="thumb">${img ? `<img src="${img}" loading="lazy" alt="">` : ''}${isVideo ? '<span class="donation-video-badge" aria-hidden="true">▶</span>' : ''}</div>
        <div class="card-body">
          <div class="card-title">${title || '-'}</div>
          <div class="card-meta">${meta || '-'}</div>
          <div class="card-preview">${summary || ''}</div>
        </div>
      </div>
    `;
  }

function mountSection(key, items, limit){
  const box = document.querySelector(`[data-psom-key="${key}"]`);
  if(!box) return;

  const row = box.closest?.('.feed-row');
  const htmlCount = row ? Number(row.dataset.count || 0) : 0;
  const finalLimit = clampLimit(htmlCount || limit || 80);
  const list = (Array.isArray(items) ? items : []).filter(isUsableItem);

  // Never manufacture fake front content.  When there is no approved data,
  // preserve the page's existing state until a later publication arrives.
  if(list.length === 0) return;

  box.innerHTML = '';
  const slice = list.slice(0, finalLimit);
  for(const it of slice) box.insertAdjacentHTML('beforeend', renderCard(it));
  box.setAttribute('data-donation-mounted', '1');
}

  async function main(){
    let snapshot;
    try{ snapshot = await loadSnapshot(); }catch(error){
      console.warn('[IGDC Donation] snapshot unavailable:', error && error.message || error);
      return;
    }

    if(!snapshot?.sections || !snapshot?.items){
      console.error('Invalid donation snapshot');
      return;
    }

    const limits = buildSectionIndex(snapshot.sections);
    const items = normalizeItems(snapshot.items);
    const groups = groupBySection(items);

    Object.keys(limits).forEach((key)=>{
      let list = groups[key] || [];
      list = sortSection(list);
      mountSection(key, list, limits[key]);
    });
  }

  function bindClicks(){
    document.addEventListener('click', (e)=>{
      const card = e.target?.closest?.('.donation-card');
      if(!card) return;
      const url = card.getAttribute('data-url');
      if(url) window.open(url, '_blank', 'noopener');
    });

    document.addEventListener('keydown', (e)=>{
      if(e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target?.closest?.('.donation-card');
      if(!card) return;
      e.preventDefault();
      const url = card.getAttribute('data-url');
      if(url) window.open(url, '_blank', 'noopener');
    });
  }

  function boot(){
    bindClicks();
    main();

    let reran = false;
    const mo = new MutationObserver(()=>{
      if(reran) return;
      const anyTrack = document.querySelector('[data-psom-key].row-track');
      if(anyTrack && anyTrack.querySelector('.card') && !anyTrack.querySelector('.donation-card')){
        reran = true;
        main();
        try{ mo.disconnect(); }catch(_e){}
      }
    });
    try{ mo.observe(document.documentElement, { childList:true, subtree:true }); }catch(_e){}
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
