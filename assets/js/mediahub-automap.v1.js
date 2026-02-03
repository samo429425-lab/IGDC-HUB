/**
 * mediahub-automap.v1.js
 * FINAL — CLASSIC SCRIPT SAFE (NO MODULE EXPORT)
 *
 * Contract:
 *  - Snapshot: /data/media.snapshot.json
 *  - DOM line: .thumb-line[data-psom-key="{sectionKey}"]
 *  - Placeholders: .card.media-card[data-placeholder="true"] (hide only when real items exist)
 */
(function () {
  'use strict';

  // prevent double-run when included twice
  if (window.__MEDIAHUB_AUTOMAP_V1__) return;
  window.__MEDIAHUB_AUTOMAP_V1__ = true;

  async function loadMediaSnapshot(url) {
    url = url || '/data/media.snapshot.json';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load media snapshot: ' + res.status);
    return res.json();
  }

  function formatDuration(sec) {
    sec = Number(sec || 0);
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function createCard(item) {
    item = item || {};

    const a = document.createElement('a');
    a.className = 'card media-card';

    const href = item.video || item.url || '';
    a.href = href ? href : 'javascript:void(0)';
    if (href) { a.target = '_blank'; a.rel = 'noopener'; }

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const imgUrl = item.thumbnail || item.poster || item.image || '';
    if (imgUrl) {
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = item.title || '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    }

    const dur = formatDuration(item.duration);
    if (dur) {
      const badge = document.createElement('span');
      badge.className = 'duration';
      badge.textContent = dur;
      thumb.appendChild(badge);
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
    line.querySelectorAll('.card.media-card[data-placeholder="true"]').forEach(el => {
      el.style.display = 'none';
    });
  }

  function showPlaceholders(line) {
    line.querySelectorAll('.card.media-card[data-placeholder="true"]').forEach(el => {
      el.style.display = '';
    });
  }

  function clearInjected(line) {
    // only remove injected real cards (keep placeholders)
    line.querySelectorAll('.card.media-card:not([data-placeholder="true"])').forEach(el => el.remove());
  }

  function renderHero(snapshot) {
    try {
      const heroItem = snapshot && snapshot.hero && Array.isArray(snapshot.hero.items) ? snapshot.hero.items[0] : null;
      if (!heroItem) return;

      const imgUrl = heroItem.poster || heroItem.thumbnail || heroItem.image || '';
      if (!imgUrl) return;

      const heroImg = document.querySelector('section.hero img');
      if (heroImg) {
        heroImg.src = imgUrl;
        heroImg.alt = heroItem.title || heroImg.alt || 'hero';
      }

      // If hero has an anchor wrapper, link it
      const heroLink = document.querySelector('section.hero a');
      const href = heroItem.video || heroItem.url || '';
      if (heroLink && href) {
        heroLink.href = href;
        heroLink.target = '_blank';
        heroLink.rel = 'noopener';
      }
    } catch (e) { /* silent */ }
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

    const hasReal = safeItems.some(it => it && (it.thumbnail || it.poster || it.image || it.title || it.video || it.url));
    if (hasReal) hidePlaceholders(line);
    else showPlaceholders(line);

    safeItems.forEach(item => {
      if (!item) return;
      line.appendChild(createCard(item));
    });
  }

  async function runMediaAutoMap() {
    const snapshot = await loadMediaSnapshot('/data/media.snapshot.json');
    if (!snapshot) return;

    renderHero(snapshot);

    const sections = Array.isArray(snapshot.sections) ? snapshot.sections : [];
    sections.forEach(sec => {
      if (!sec || !sec.key) return;
      renderSection(sec.key, sec.items || []);
    });
  }

  // expose for console sanity-check: typeof runMediaAutoMap === 'function'
  window.runMediaAutoMap = runMediaAutoMap;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { runMediaAutoMap().catch(console.error); });
  } else {
    runMediaAutoMap().catch(console.error);
  }
})();