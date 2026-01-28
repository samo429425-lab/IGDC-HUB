/* =========================================================
   MARU SEARCH – Standalone Search.js (FINAL / v5.0)
   ---------------------------------------------------------
   목표:
   - 오직 maru-search(Netlify Function)만 호출
   - maru-search 실제 응답 스키마(status/ items/ meta) 100% 호환
   - 에러/빈결과 안전 처리 (200 + status:'error' 포함)
   - 페이지 리로드 없이 재검색 (history.replaceState)
   - 카드 전체 클릭(링크), 설명/출처/썸네일 표시
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const initialQ = (params.get('q') || '').trim();

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const statusEl = document.getElementById('searchStatus');
  const resultsEl = document.getElementById('searchResults');

  if (!input || !btn || !statusEl || !resultsEl) {
    console.error('[MARU SEARCH] required DOM ids missing: searchInput/searchBtn/searchStatus/searchResults');
    return;
  }

  if (initialQ) {
    input.value = initialQ;
    runSearch(initialQ);
  } else {
    setStatus('검색어를 입력하세요.');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const q = (input.value || '').trim();
    if (!q) return;
    setQueryWithoutReload(q);
    runSearch(q);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });

  function setQueryWithoutReload(q) {
    const url = new URL(window.location.href);
    url.searchParams.set('q', q);
    window.history.replaceState(null, '', url.toString());
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function fetchMaruSearch(q) {
    // Netlify에서 보통 /.netlify/functions 이지만,
    // 프로젝트에 따라 /netlify/functions 리라이트가 있을 수 있어 둘 다 시도.
    const candidates = [
      `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`,
      `/netlify/functions/maru-search?q=${encodeURIComponent(q)}`
    ];

    let lastErr = null;

    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: 'GET', cache: 'no-store' });
        if (!res.ok) {
          lastErr = new Error(`HTTP_${res.status}`);
          continue;
        }
        // maru-search는 에러여도 200 + {status:'error'} 를 반환할 수 있음
        const data = await res.json();
        return data;
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error('fetch_failed');
  }

  async function runSearch(q) {
    setStatus('검색 중입니다…');
    resultsEl.innerHTML = '';

    try {
      const data = await fetchMaruSearch(q);

      // maru-search error payload: {status:'error', message, detail...}
      if (data && data.status === 'error') {
        setStatus(data.message ? `검색 엔진 오류: ${data.message}` : '검색 엔진 오류가 발생했습니다.');
        // detail은 콘솔에만
        console.error('[MARU SEARCH ENGINE ERROR]', data);
        return;
      }

      // maru-search ok payload: {status:'ok', items:[...], meta:{...}}
      const rawItems =
        (data && Array.isArray(data.items) && data.items) ||
        (data && Array.isArray(data.results) && data.results) ||
        (data && data.data && Array.isArray(data.data.items) && data.data.items) ||
        [];

      const items = rawItems.map(normalizeItem).filter(x => x.url || x.title);

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

  function normalizeItem(it) {
    const title = (it.title || it.name || it.heading || '').trim() || '제목 없음';
    const url = (it.url || it.link || it.href || '').trim() || '';
    const description =
      (it.description || it.summary || it.snippet || it.excerpt || '').trim();

    const thumbnail =
      (it.thumbnail || it.image || it.thumb || it.icon || '').trim() || '';

    const source =
      (it.source || it.provider || it.site || '').trim();

    return { title, url, description, thumbnail, source };
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'search-card';

    const a = document.createElement('a');
    a.className = 'search-card-link';
    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    // 썸네일
    if (item.thumbnail) {
      const img = document.createElement('img');
      img.className = 'search-thumb';
      img.src = item.thumbnail;
      img.alt = item.title;
      img.loading = 'lazy';
      // 이미지 로드 실패 시 숨김
      img.addEventListener('error', () => {
        img.remove();
      });
      a.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'search-body';

    const t = document.createElement('div');
    t.className = 'search-title';
    t.textContent = item.title;

    body.appendChild(t);

    if (item.description) {
      const d = document.createElement('div');
      d.className = 'search-desc';
      d.textContent = item.description;
      body.appendChild(d);
    }

    if (item.source) {
      const m = document.createElement('div');
      m.className = 'search-meta';
      m.textContent = item.source;
      body.appendChild(m);
    }

    a.appendChild(body);
    card.appendChild(a);
    resultsEl.appendChild(card);
  }
});
