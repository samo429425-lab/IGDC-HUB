// MARU SEARCH – matched with upgraded search.html
// search.html 전용 / 기존 maru-search 파이프라인 유지

document.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/search.html')) return;

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');

  if (!input || !btn || !status || !results) return;

  const params = new URLSearchParams(location.search);
  const q0 = params.get('q');
  if (q0) {
    input.value = q0;
    runSearch(q0);
  }

  btn.onclick = () => {
    const q = input.value.trim();
    if (!q) return;
    const url = new URL(location.href);
    url.searchParams.set('q', q);
    history.replaceState(null, '', url.toString());
    runSearch(q);
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click();
  });

  async function runSearch(q) {
    status.textContent = '검색 중...';
    results.innerHTML = '';

    try {
      const res = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      const data = json.data || json.baseResult || json;
      const items = data.items || data.results || [];

      if (!items.length) {
        status.textContent = '검색 결과가 없습니다.';
        return;
      }

      status.textContent = `${items.length}개 결과`;
      items.forEach(renderItem);
    } catch (e) {
      console.error(e);
      status.textContent = '검색 오류';
    }
  }

  function renderItem(it) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.onclick = () => {
      if (it.url) {
        location.href = `/search-view.html?u=${encodeURIComponent(it.url)}`;
      }
    };

    if (it.thumbnail || it.image) {
      const img = document.createElement('img');
      img.className = 'result-thumb';
      img.src = it.thumbnail || it.image;
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'result-body';

    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = it.title || it.name || '제목 없음';

    const desc = document.createElement('div');
    desc.className = 'result-desc';
    desc.textContent = it.summary || it.description || it.snippet || '';

    body.appendChild(title);
    if (desc.textContent) body.appendChild(desc);

    card.appendChild(body);
    results.appendChild(card);
  }
});
