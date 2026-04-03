/**
 * donation-automap.integrated.v8.js
 * ------------------------------------------------------------
 * 목적:
 * - 기존 donation-automap.v7.enterprise.js 구조/역할 유지
 * - feed 없이도 동작하도록 builder/feed 역할을 오토맵에 흡수
 * - donation HTML + donation.snapshot.json + donation builder 구조 모두 대응
 * - data-psom-key 기반 DOM 매핑 유지
 * - snapshot.items 기반 groupBySection 유지
 * - slot_limit / bank-first / rank sorting / verify bonus 유지
 */

(async function(){
  'use strict';

  const SNAPSHOT_PATHS = [
    // 1) direct builder (feed integrated)
    '/.netlify/functions/donation-snapshot-builder',
    '/netlify/functions/donation-snapshot-builder',

    // 2) legacy thin feed wrapper (still accepted if present)
    '/.netlify/functions/donation-feed',
    '/netlify/functions/donation-feed',

    // 3) static snapshot fallback
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

function groupBySection(items){
  const map = {};
  let globalSeedSkipped = false;

  (Array.isArray(items) ? items : []).forEach((it)=>{

const isSeed =
  (
    it?.meta?.source === 'seed' ||
    it?.meta?.type === 'seed' ||
    it?.id === 'seed' ||
    it?.uid === 'seed' ||
    (it?.title && it.title.toLowerCase().includes('seed')) ||
    (it?.org?.name && it.org.name.toLowerCase().includes('seed'))
  ) &&
  !it?.bank_ref?.record_id;

    // 👉 donation-global 첫 더미 1개만 제거
    if(
      !globalSeedSkipped &&
      isSeed &&
      it?.psom_key === 'donation-global'
    ){
      globalSeedSkipped = true;
      return;
    }

    const k = it?.psom_key;
    if(!k) return;

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
    if(!s) return '';
    if(/^javascript:/i.test(s)) return '';
    return s;
  }

  function renderCard(it){
    const img = safeUrl(it?.media?.thumb) || '';
    const title = escHtml(it?.org?.name || it?.title || '');
    const meta = escHtml(
      it?.org?.country ||
      it?.donation?.currency ||
      it?.category ||
      ''
    );
    const summary = escHtml(it?.summary || it?.org?.legal_name || '');
    const url = safeUrl(it?.donation?.checkout_url) || safeUrl(it?.link?.url) || safeUrl(it?.org?.homepage) || '';
    const uid = escAttr(it?.uid || it?.id || '');

    return `
      <div class="card donation-card" data-uid="${uid}" data-url="${escAttr(url)}" role="link" tabindex="0" aria-label="${title}">
        <div class="thumb">${img ? `<img src="${img}" loading="lazy" alt="">` : ''}</div>
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

  const list = (Array.isArray(items) ? items : []);

  // 🔴 핵심: 데이터 없으면 기존 HTML 유지
  if(list.length === 0){
    return;
  }

  box.innerHTML = '';

  const slice = list.slice(0, finalLimit);
  for(const it of slice){
    box.insertAdjacentHTML('beforeend', renderCard(it));
  }
}

  async function main(){
    const snapshot = await loadSnapshot();

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
