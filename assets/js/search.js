/* =========================================================
   MARU SEARCH – FINAL A (v6.1 compat)
   - 유지: 기존 v6 흐름(쿼리/상태/2중 URL fallback)
   - 추가: maru-search 표준 스키마(summary/url) + 래핑(data/baseResult) 호환
   - 추가: 카드 전체 클릭 → search-view.html 중계
   - 추가: 밑줄 제거(스타일 보강)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
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

  // 밑줄/링크 기본 스타일 보강 (기존 CSS와 충돌 없음)
  (function ensureStyle(){
    const id = 'maru-search-style-v61';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .search-card, .search-card * { text-decoration: none !important; }
      .search-card { cursor: pointer; }
      .search-title { font-weight: 700; color: #1f2a44; }
      .search-desc { margin-top: 6px; color: #444; line-height: 1.35; font-size: 14px; }
      .search-meta { margin-top: 6px; color: #666; font-size: 12px; }
      .search-thumb { width: 88px; height: 66px; object-fit: cover; border-radius: 10px; margin-right: 12px; flex: 0 0 auto; }
      .search-card { display: flex; gap: 0; align-items: flex-start; background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
      .search-body { flex: 1; min-width: 0; }
    `;
    document.head.appendChild(s);
  })();

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

  async function fetchMaru(q) {
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

  // maru-global-insight-engine / 기타 래핑 구조 호환
  function unwrap(data) {
    if (!data) return data;
    // case: { data: { items: [] } }
    if (data.data && (Array.isArray(data.data.items) || Array.isArray(data.data.results))) return data.data;
    // case: { baseResult: { items: [] } }
    if (data.baseResult && (Array.isArray(data.baseResult.items) || Array.isArray(data.baseResult.results))) return data.baseResult;
    // case: { baseResult: { data: { items: [] } } }
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
    // maru-search 표준 items: { title, url, summary, source }
    const title = (it.title || it.name || '').trim() || '제목 없음';
    const url = (it.url || it.link || '').trim();
    const desc = (it.summary || it.description || it.snippet || '').trim();
    const source = (it.source || it.site || root?.source || root?.engine || '').trim();
    const thumb = (it.thumbnail || it.image || '').trim();

    return { title, url, desc, thumb, source };
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'search-card';

    // 카드 어디를 눌러도 이동
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
