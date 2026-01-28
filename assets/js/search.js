/* =========================================================
   MARU SEARCH – Standalone Advanced Search Engine
   Version: v4.0 (Future-ready / Multi-source tolerant)
   Role:
   - Single entry: maru-search Netlify Function
   - Tolerant to multiple payload schemas
   - Rich result cards (title, description, link, thumbnail, source)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') || '';

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');

  if (input && q) input.value = q;
  if (q) runSearch(q);

  if (btn) {
    btn.addEventListener('click', () => {
      const keyword = input.value.trim();
      if (!keyword) return;
      window.location.search = `?q=${encodeURIComponent(keyword)}`;
    });
  }

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });
  }

  async function runSearch(keyword) {
    setStatus('검색 중입니다…');
    results.innerHTML = '';

    try {
      const res = await fetch(
        `/netlify/functions/maru-search?q=${encodeURIComponent(keyword)}`
      );

      if (!res.ok) throw new Error('MARU SEARCH API ERROR');

      const data = await res.json();

      // Normalize results from any possible schema
      const list = normalizeResults(data);

      if (!list.length) {
        setStatus('검색 결과가 없습니다.');
        return;
      }

      setStatus(`${list.length}개의 결과`);
      list.forEach(renderCard);

    } catch (err) {
      console.error('[MARU SEARCH]', err);
      setStatus('검색 중 오류가 발생했습니다.');
    }
  }

  function normalizeResults(data) {
    if (!data) return [];

    // Preferred: data.results
    if (Array.isArray(data.results)) return data.results.map(normalizeItem);

    // Fallback: data.items (global / legacy)
    if (Array.isArray(data.items)) return data.items.map(normalizeItem);

    // Snapshot-style object map
    if (typeof data === 'object') {
      return Object.values(data)
        .filter(v => typeof v === 'object')
        .map(normalizeItem);
    }

    return [];
  }

  function normalizeItem(item) {
    return {
      title: item.title || item.name || '제목 없음',
      url: item.url || item.link || '#',
      description:
        item.description ||
        item.snippet ||
        item.summary ||
        '',
      thumbnail:
        item.thumbnail ||
        item.image ||
        item.thumb ||
        null,
      source:
        item.source ||
        item.provider ||
        'MARU'
    };
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'search-card';

    // Entire card clickable
    card.addEventListener('click', () => {
      if (item.url && item.url !== '#') {
        window.open(item.url, '_blank', 'noopener');
      }
    });

    if (item.thumbnail) {
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.alt = item.title;
      img.className = 'search-thumb';
      card.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'search-body';

    const title = document.createElement('div');
    title.className = 'search-title';
    title.textContent = item.title;

    const desc = document.createElement('div');
    desc.className = 'search-desc';
    desc.textContent = item.description;

    const meta = document.createElement('div');
    meta.className = 'search-meta';
    meta.textContent = item.source;

    body.appendChild(title);
    if (item.description) body.appendChild(desc);
    body.appendChild(meta);

    card.appendChild(body);
    results.appendChild(card);
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }
});
