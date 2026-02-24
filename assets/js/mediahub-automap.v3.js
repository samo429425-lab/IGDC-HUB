/* ===================================================
   IGDC MEDIA HUB AUTOMAP v3 - FINAL STABLE
   - Dummy 구조 100% 동일
   - 막대 슬롯 제거
   - 모바일 비율 정상
   - Feed / Snapshot 연동
=================================================== */

(function(){

  /* ================= CONFIG ================= */

  const LIMIT = 50;

  const MEDIA_KEYS = [
    'media-trending',
    'media-movie',
    'media-drama',
    'media-thriller',
    'media-romance',
    'media-variety',
    'media-documentary',
    'media-animation',
    'media-music',
    'media-shorts'
  ];

  const FEED_URL = '/.netlify/functions/feed-media';

  /* ========================================== */


  /* ---------- 카드 생성 (더미 구조 100% 동일) ---------- */

  function createCard(item){

    const a = document.createElement('a');
    a.className = 'card media-card';
    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';


    /* thumb */

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const img = document.createElement('img');
    img.src = item.thumbnail || item.image || '';
    img.alt = item.title || '';
    img.loading = 'lazy';

    thumb.appendChild(img);


    /* meta */

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = item.title || '';


    /* assemble */

    a.appendChild(thumb);
    a.appendChild(meta);

    return a;
  }


  /* ---------- 컨테이너 찾기 ---------- */

  function getContainer(line){

    return (
      line.querySelector(':scope > .scroll-content') ||
      line
    );

  }


  /* ---------- 더미 제거 ---------- */

  function clearPlaceholders(container){

    container
      .querySelectorAll('a.card[data-placeholder]')
      .forEach(el => el.remove());

  }


  /* ---------- 실카드 제거 ---------- */

  function clearRealCards(container){

    container
      .querySelectorAll('a.card:not([data-placeholder])')
      .forEach(el => el.remove());

  }


  /* ---------- 섹션 적용 ---------- */

  function applySection(key, list){

    const line = document.querySelector(
      '.thumb-line[data-psom-key="'+ key +'"]'
    );

    if(!line) return;


    const container = getContainer(line);

    if(!container) return;


    /* 기존 카드 정리 */

    clearPlaceholders(container);
    clearRealCards(container);


    if(!Array.isArray(list) || !list.length) return;


    /* 새 카드 삽입 */

    const frag = document.createDocumentFragment();

    list.slice(0, LIMIT).forEach(item => {

      const card = createCard(item);
      frag.appendChild(card);

    });

    container.appendChild(frag);

  }


  /* ---------- 전체 적용 ---------- */

  function applyAll(data){

    if(!data || !data.sections) return;


    MEDIA_KEYS.forEach(key => {

      const list = data.sections[key] || [];

      applySection(key, list);

    });

  }


  /* ---------- 데이터 로드 ---------- */

  function loadData(){

    /* window 주입 우선 */

    if(window.__MEDIA_SNAPSHOT__){

      applyAll(window.__MEDIA_SNAPSHOT__);
      return;

    }


    /* fetch fallback */

    fetch(FEED_URL, { cache:'no-store' })

      .then(res => res.json())

      .then(applyAll)

      .catch(function(){
        console.warn('[MEDIA AUTOMAP] Feed load failed');
      });

  }


  /* ---------- 시작 ---------- */

  function boot(){

    loadData();

  }


  if(document.readyState === 'loading'){

    document.addEventListener('DOMContentLoaded', boot);

  }else{

    boot();

  }

})();