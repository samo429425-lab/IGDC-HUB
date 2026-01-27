/**
 * assets/js/search.js — IGDC Search Page Controller (v1.1)
 * Matches current search.html IDs:
 * - #searchInput, #searchBtn, #results, #searchMeta, #externalLinks, #googleTranslateLink
 * Behavior:
 * - Reads ?q= from URL and auto-runs
 * - Renders clickable links (url/link)
 */

(function () {
  'use strict';

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const resultsEl = document.getElementById('results');
  const metaEl = document.getElementById('searchMeta');
  const externalEl = document.getElementById('externalLinks');
  const translateLink = document.getElementById('googleTranslateLink');

  function qp(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(text) {
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div class="status">${esc(text)}</div>`;
  }

  function render(items) {
    if (!resultsEl) return;

    if (!Array.isArray(items) || items.length === 0) {
      setStatus('No results.');
      return;
    }

    resultsEl.innerHTML = '';
    items.forEach((it) => {
      const title = it.title || '(제목 없음)';
      const summary = it.summary || it.snippet || '';
      const url = it.url || it.link || '';

      const card = document.createElement('div');
      card.className = 'result-item';

      if (url) {
        card.innerHTML = `
          <a class="result-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>
          <div class="result-summary">${esc(summary)}</div>
        `;
      } else {
        card.innerHTML = `
          <div class="result-title">${esc(title)}</div>
          <div class="result-summary">${esc(summary)}</div>
        `;
      }

      resultsEl.appendChild(card);
    });
  }

  async function run(q) {
    q = String(q || '').trim();
    if (!q) {
      setStatus('Enter a search term.');
      return;
    }

    if (metaEl) metaEl.textContent = `Results for: "${q}"`;
    if (translateLink) {
      translateLink.href = 'https://translate.google.com/translate?u=' + encodeURIComponent(window.location.href);
    }

    setStatus('Searching...');

    try {
      const res = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP_' + res.status);
      const data = await res.json();

      const items = data.items || data.results || [];
      render(items);

      if (externalEl) {
        externalEl.style.display = 'block';
        externalEl.innerHTML = `
          <strong>External search:</strong><br/>
          <a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">Google</a>
          <a href="https://www.bing.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">Bing</a>
          <a href="https://search.naver.com/search.naver?query=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">Naver</a>
        `;
      }
    } catch (e) {
      console.error(e);
      setStatus('Search error occurred.');
    }
  }

  function trigger() {
    const q = (input && input.value ? input.value : '').trim();
    if (!q) return;
    window.history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
    run(q);
  }

  if (btn) btn.addEventListener('click', trigger);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        trigger();
      }
    });
  }

  const initial = qp('q');
  if (input) input.value = initial;
  run(initial);
})();