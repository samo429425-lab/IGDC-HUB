// socialnetwork-automap.prod.js (PRODUCTION, Distribution-style mapping)
// 원칙:
// 1) 오토맵은 슬롯을 "생성"하지 않는다. (데이터 없으면 건드리지 않음)
// 2) 데이터가 있을 때만, HTML 더미 슬롯을 "제자리"에서 교체한다.
// 3) Desktop: RightRail에만 꽂음 / Mobile: rpMobileGrid에만 꽂음

(function(){
  'use strict';

  if (window.__SOCIALNETWORK_AUTOMAP_PROD__) return;
  window.__SOCIALNETWORK_AUTOMAP_PROD__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';
  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 100;
  const BREAKPOINT = 1024; // <=1024: mobile/tablet

  // snapshot key -> selector (기본은 같은 키)
  // HTML이 구버전 키를 쓰는 경우(alias)도 흡수
  const SECTION_MAP = [
    { key: 'social-youtube',   selectors: ['[data-psom-key="social-youtube"]'],   limit: LIMIT_MAIN },
    { key: 'social-instagram', selectors: ['[data-psom-key="social-instagram"]'], limit: LIMIT_MAIN },
    { key: 'social-tiktok',    selectors: ['[data-psom-key="social-tiktok"]'],    limit: LIMIT_MAIN },
    { key: 'social-facebook',  selectors: ['[data-psom-key="social-facebook"]'],  limit: LIMIT_MAIN },
    { key: 'social-twitter',   selectors: ['[data-psom-key="social-twitter"]'],   limit: LIMIT_MAIN },

    // aliases (HTML 구버전 흡수)
    { key: 'social-threads',   selectors: ['[data-psom-key="social-threads"]','[data-psom-key="social-pinterest"]'], limit: LIMIT_MAIN },
    { key: 'social-telegram',  selectors: ['[data-psom-key="social-telegram"]','[data-psom-key="social-reddit"]'],    limit: LIMIT_MAIN },
    { key: 'social-discord',   selectors: ['[data-psom-key="social-discord"]','[data-psom-key="social-wechat"]'],     limit: LIMIT_MAIN },
    { key: 'social-community', selectors: ['[data-psom-key="social-community"]','[data-psom-key="social-weibo"]'],     limit: LIMIT_MAIN },
  ];

  // right panel: desktop vs mobile targets are different nodes
  function rightTargets(){
    const isMobile = (window.innerWidth || 0) <= BREAKPOINT;
    if (isMobile){
      const el = document.querySelector('#rpMobileGrid');
      return el ? [el] : [];
    }
    // desktop: only right rail
    const el = document.querySelector('#rightRail [data-psom-key="socialnetwork"]');
    return el ? [el] : [];
  }

  function pick(obj, keys){
    for (const k of keys){
      const v = obj && obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function pickImage(item){
    return pick(item, ['thumb','image','img','thumbnail','thumbnailUrl','cover','poster','thumbnail_url','imageUrl']);
  }

  function pickTitle(item){
    return pick(item, ['title','name','label','caption','text']);
  }

  function pickUrl(item){
    return pick(item, ['url','href','link','path','detailUrl','productUrl','checkoutUrl']) || '#';
  }

  function ensureScroller(box){
    if(!box) return;
    // mobile drag friendliness
    box.style.overflowX = 'auto';
    box.style.overflowY = 'hidden';
    box.style.webkitOverflowScrolling = 'touch';
    box.style.touchAction = 'pan-x';
  }

  function clearChildren(el){
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function createCard(item){
    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';
    const src = pickImage(item);
    if (src) {
      img.style.backgroundImage = "url('" + String(src).replace(/'/g,'%27') + "')";
      img.style.backgroundSize = 'cover';
      img.style.backgroundPosition = 'center';
    }

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = pickTitle(item) || 'Item';

    card.appendChild(img);
    card.appendChild(title);

    const href = pickUrl(item);
    if (href && href !== '#'){
      card.addEventListener('click', function(){ location.href = href; });
      card.style.cursor = 'pointer';
    }

    return card;
  }

  async function loadSnapshot(){
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error('Snapshot load failed: ' + res.status);
    return await res.json();
  }

  function getSections(snapshot){
    return (snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections) ||
           (snapshot && snapshot.sections) ||
           null;
  }

  // data가 있을 때만 clear + render (없으면 더미 유지)
  function renderBox(box, items, limit){
    if (!box) return;
    if (!Array.isArray(items) || items.length === 0) return; // keep dummy

    ensureScroller(box);

    const list = items.slice(0, limit);
    clearChildren(box);
    list.forEach(it => box.appendChild(createCard(it)));
  }

  // 여러 selector 중, 실제 존재하는 첫 box를 찾아 렌더
  function renderBySelectors(selectors, items, limit){
    for (const sel of selectors){
      const box = document.querySelector(sel);
      if (!box) continue;
      renderBox(box, items, limit);
      return true;
    }
    return false;
  }

  let CACHED_SECTIONS = null;
  let LAST_MODE = null;

  function mode(){
    return ((window.innerWidth || 0) <= BREAKPOINT) ? 'mobile' : 'desktop';
  }

  function renderMainSections(sections){
    SECTION_MAP.forEach(cfg => {
      const raw = sections && sections[cfg.key];
      const arr = Array.isArray(raw) ? raw : [];
      renderBySelectors(cfg.selectors, arr, cfg.limit || LIMIT_MAIN);
    });
  }

  function renderRightPanel(sections){
    const raw = sections && sections['socialnetwork'];
    const arr = Array.isArray(raw) ? raw : [];

    const targets = rightTargets();
    targets.forEach(t => renderBox(t, arr, LIMIT_RIGHT));
  }

  function renderAll(){
    if(!CACHED_SECTIONS) return;
    renderMainSections(CACHED_SECTIONS);
    renderRightPanel(CACHED_SECTIONS);
  }

  function onResize(){
    const m = mode();
    if (m === LAST_MODE) return;
    LAST_MODE = m;
    // right panel 타겟만 바뀌므로 right panel만 다시 렌더
    renderRightPanel(CACHED_SECTIONS);
  }

  (async function run(){
    try{
      const snapshot = await loadSnapshot();
      const sections = getSections(snapshot);
      if(!sections) return;

      CACHED_SECTIONS = sections;
      LAST_MODE = mode();

      renderAll();

      window.addEventListener('resize', function(){
        // light debounce
        clearTimeout(window.__SOCIAL_AUTOMAP_RESIZE_T__);
        window.__SOCIAL_AUTOMAP_RESIZE_T__ = setTimeout(onResize, 120);
      });

      console.log('[AUTOMAP] socialnetwork prod mapping loaded');

    }catch(e){
      // 실패 시 더미 유지 (no clear)
      console.error('[AUTOMAP] Error:', e);
    }
  })();

})();
