/* =========================================================
   MARU SEARCH – FINAL A (v6.2 SAFE EXPAND)
   - 기준: 정상 작동 흐름(v6 계열) 유지
   - 확장: summary/desc 표시, 카드 전체 클릭 이동, 밑줄 제거, 썸네일 표시(있을 때만)
   - 안전: /search.html 전용 실행 (다른 페이지 영향 0)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  // ===== HARD GUARD: search.html 전용 =====
  const path = (location.pathname || '').toLowerCase();
  const isSearchPage = path.endsWith('/search.html') || path === '/search.html';
  if (!isSearchPage) return;

  const params = new URLSearchParams(window.location.search);
  const initialQ = (params.get('q') || '').trim();

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const statusEl = document.getElementById('searchStatus');
  const resultsEl = document.getElementById('searchResults');

  if (!input || !btn || !statusEl || !resultsEl) {
    console.error('[MARU SEARCH] required DOM ids missing');
    return;
  }

  // 밑줄 제거 + 카드 스타일(기존 CSS에 "추가"만)
  injectStyleOnce();

  if (initialQ) {
    input.value = initialQ;
    runSearch(initialQ);
  } else {
    setStatus('검색어를 입력하세요.');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    updateQuery(q);
    runSearch(q);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });

  function updateQuery(q) {
    const url = new URL(window.location.href);
    url.searchParams.set('q', q);
    history.replaceState(null, '', url.toString());
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function injectStyleOnce() {
    const id = 'maru-search-style-v62';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      /* underline 제거 */
      #searchResults a, #searchResults a:link, #searchResults a:visited { text-decoration:none !important; }
      /* 카드 */
      .search-card{
        background:#fff;
        border-radius:12px;
        padding:14px 16px;
        margin-bottom:12px;
        box-shadow:0 2px 6px rgba(0,0,0,0.05);
        display:flex;
        gap:12px;
        align-items:flex-start;
        cursor:pointer;
      }
      .search-thumb{
        width:92px; height:68px; object-fit:cover;
        border-radius:10px; flex:0 0 auto;
      }
      .search-body{ flex:1; min-width:0; }
      .search-title{ font-size:16px; font-weight:700; color:#4f46e5; }
      .search-desc{ margin-top:6px; font-size:14px; color:#444; line-height:1.4; }
      .search-meta{ margin-top:6px; font-size:12px; color:#666; }
    `;
    document.head.appendChild(s);
  }

  async function fetchMaru(q) {
    // ✅ 기존 안정형: 2중 URL fallback 유지
    const urls = [
      `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`,
      `/netlify/functions/maru-search?q=${encodeURIComponent(q)}`
    ];

    let lastErr;
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status);
          continue;
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  // ✅ 래핑 호환 (maru-global-insight 등)
  function unwrap(data) {
    if (!data) return data;
    if (data.data && (Array.isArray(data.data.items) || Array.isArray(data.data.results))) return data.data;
    if (data.baseResult && (Array.isArray(data.baseResult.items) || Array.isArray(data.baseResult.results))) return data.baseResult;
    if (data.baseResult && data.baseResult.data && (Array.isArray(data.baseResult.data.items) || Array.isArray(data.baseResult.data.results))) return data.baseResult.data;
    return data;
  }

  async function runSearch(q) {
    setStatus('검색 중입니다…');
    resultsEl.innerHTML = '';

    try {
      const data0 = await fetchMaru(q);
      const data = unwrap(data0);

      if (data && data.status === 'error') {
        setStatus(data.message || '검색 엔진 오류');
        console.error('[MARU SEARCH ENGINE]', data);
        return;
      }

      const raw =
        (Array.isArray(data?.items) && data.items) ||
        (Array.isArray(data?.results) && data.results) ||
        [];

      const items = raw.map(it => normalize(it, data)).filter(i => i.url || i.title);

      if (items.length === 0) {
        setStatus('검색 결과가 없습니다.');
        return;
      }

      setStatus(`${items.length}개의 결과`);
      items.forEach(renderCard);

    } catch (e) {
      console.error('[MARU SEARCH JS ERROR]', e);
      setStatus('검색 중 오류가 발생했습니다.');
    }
  }

  function normalize(it, root) {
    // ✅ maru-search 표준: summary / url / title / source
    return {
      title: (it.title || it.name || '').trim() || '제목 없음',
      url: (it.url || it.link || '').trim(),
      desc: (it.summary || it.description || it.snippet || '').trim(),
      thumb: (it.thumbnail || it.image || '').trim(),
      source: (it.source || it.site || root?.source || root?.engine || '').trim()
    };
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'search-card';

    // 카드 어디를 눌러도 이동 (IGDC 컨텍스트 유지)
    card.addEventListener('click', () => {
      if (!item.url) return;
      window.location.href = `/search-view.html?u=${encodeURIComponent(item.url)}`;
    });

    if (item.thumb) {
      const img = document.createElement('img');
      img.className = 'search-thumb';
      img.src = item.thumb;
      img.alt = item.title;
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'search-body';

    const title = document.createElement('div');
    title.className = 'search-title';
    title.textContent = item.title;
    body.appendChild(title);

    if (item.desc) {
      const d = document.createElement('div');
      d.className = 'search-desc';
      d.textContent = item.desc;
      body.appendChild(d);
    }

    if (item.source) {
      const s = document.createElement('div');
      s.className = 'search-meta';
      s.textContent = item.source;
      body.appendChild(s);
    }

    card.appendChild(body);
    resultsEl.appendChild(card);
  }
});
