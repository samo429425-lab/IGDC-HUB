/**
 * mediahub-automap.v1.js (FIXED)
 * - classic script (NO export)
 * - target: .thumb-line[data-psom-key="{sectionKey}"]
 * - placeholders: a.card.media-card[data-placeholder="true"] auto-hide when real items exist
 */

(function () {
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V1_FIXED__) return;
  window.__MEDIAHUB_AUTOMAP_V1_FIXED__ = true;

  async function loadMediaSnapshot(url) {
    url = url || '/data/media.snapshot.json';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load media snapshot: ' + res.status);
    return res.json();
  }

  function createCard(item) {
    const a = document.createElement('a');
    a.className = 'card media-card';
    a.href = item.video || 'javascript:void(0)';
    if (item.video) { a.target = '_blank'; a.rel = 'noopener'; }

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    if (item.thumbnail) {
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.alt = item.title || '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      // keep layout stable
      const ph = document.createElement('div');
      ph.className = 'thumb ph';
      thumb.appendChild(ph);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = item.title || '';

    a.appendChild(thumb);
    a.appendChild(meta);
    return a;
  }

  function getLine(sectionKey) {
    return document.querySelector(`.thumb-line[data-psom-key="${sectionKey}"]`);
  }

  function hidePlaceholders(line) {
    line.querySelectorAll('a.card.media-card[data-placeholder="true"]').forEach(el => {
      el.style.display = 'none';
    });
  }

  function showPlaceholders(line) {
    line.querySelectorAll('a.card.media-card[data-placeholder="true"]').forEach(el => {
      el.style.display = '';
    });
  }

  function clearInjected(line) {
    line.querySelectorAll('a.card.media-card:not([data-placeholder="true"])').forEach(el => el.remove());
  }

  function renderSection(sectionKey, items) {
    const line = getLine(sectionKey);
    if (!line) return;

    const safeItems = Array.isArray(items) ? items : [];
    clearInjected(line);

    if (safeItems.length === 0) {
      showPlaceholders(line);
      return;
    }

    const hasReal = safeItems.some(it => it && (it.thumbnail || it.title || it.video));
    if (hasReal) hidePlaceholders(line);
    else showPlaceholders(line);

    safeItems.forEach(it => {
      if (!it) return;
      line.appendChild(createCard(it));
    });
  }

  async function run() {
    const snapshot = await loadMediaSnapshot('/data/media.snapshot.json');
    const sections = (snapshot && Array.isArray(snapshot.sections)) ? snapshot.sections : [];
    sections.forEach(sec => {
      if (!sec || !sec.key) return;
      renderSection(sec.key, sec.items || []);
    });
  }

  // expose for console check
  window.runMediaAutoMap = run;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { run().catch(console.error); });
  } else {
    run().catch(console.error);
  }
})();
