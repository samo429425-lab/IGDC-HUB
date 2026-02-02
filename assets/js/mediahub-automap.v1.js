/**
 * mediahub-automap.v1.js
 * Purpose: Render /data/media.snapshot.json into mediahub.html sections (FRONT-DOM MATCH)
 *
 * FRONT DOM contract (mediahub.html):
 *  - Section lines are: .thumb-line[data-psom-key="{sectionKey}"]
 *  - Each line contains placeholder cards: .card.media-card[data-placeholder="true"]
 *  - On successful render (items.length>0): hide placeholders
 *  - On failure/empty: keep placeholders visible
 */

async function loadMediaSnapshot(url = '/data/media.snapshot.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load media snapshot');
  return res.json();
}

function formatDuration(sec = 0) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function createCard(item) {
  // Use same DOM shape as existing placeholders: <a class="card media-card">
  const a = document.createElement('a');
  a.className = 'card media-card';
  a.href = item.video ? item.video : 'javascript:void(0)';
  a.target = item.video ? '_blank' : '';
  if (item.video) a.rel = 'noopener';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (item.thumbnail) {
    // keep <img> to match existing CSS selectors (.card img, .thumb, etc.)
    const img = document.createElement('img');
    img.src = item.thumbnail;
    img.alt = item.title || '';
    img.loading = 'lazy';
    thumb.appendChild(img);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = item.title || '';

  a.appendChild(thumb);
  a.appendChild(meta);

  // Optional duration badge if your CSS supports it
  const dur = formatDuration(item.duration);
  if (dur) {
    const badge = document.createElement('span');
    badge.className = 'duration';
    badge.textContent = dur;
    // put inside thumb to mimic previous version
    thumb.appendChild(badge);
  }

  return a;
}

function getLineElByKey(sectionKey) {
  // mediahub.html uses data-psom-key on .thumb-line for content rows
  return document.querySelector(`.thumb-line[data-psom-key="${sectionKey}"]`);
}

function getPlaceholders(lineEl) {
  return Array.from(lineEl.querySelectorAll('.card.media-card[data-placeholder="true"]'));
}

function hidePlaceholders(lineEl) {
  const ph = getPlaceholders(lineEl);
  ph.forEach(el => { el.style.display = 'none'; });
}

function showPlaceholders(lineEl) {
  const ph = getPlaceholders(lineEl);
  ph.forEach(el => { el.style.display = ''; });
}

function clearNonPlaceholders(lineEl) {
  // Remove only cards we injected previously (NOT placeholders)
  Array.from(lineEl.querySelectorAll('.card.media-card:not([data-placeholder="true"])')).forEach(el => el.remove());
}

function renderSection(sectionKey, items) {
  const line = getLineElByKey(sectionKey);
  if (!line) return false;

  // Keep placeholders unless we have real items to render
  const safeItems = Array.isArray(items) ? items : [];
  const realItems = safeItems.filter(it => it && (it.thumbnail || it.title || it.video));

  // Always clear previously injected cards to avoid duplication
  clearNonPlaceholders(line);

  if (realItems.length === 0) {
    // no data => keep placeholders visible
    showPlaceholders(line);
    return true;
  }

  // data present => hide placeholders and append real cards
  hidePlaceholders(line);

  realItems.forEach(item => {
    line.appendChild(createCard(item));
  });

  return true;
}

function renderHero(snapshot) {
  // Front: <div id="hero" data-psom-key="media-hero"> ... </div> exists
  // Main visual seems inside <section class="hero"><img .../></section>
  // We update the first hero image only if we have a valid hero item with thumbnail/poster.
  try {
    const heroItem = snapshot && snapshot.hero && Array.isArray(snapshot.hero.items) ? snapshot.hero.items[0] : null;
    if (!heroItem) return;

    const imgUrl = heroItem.poster || heroItem.thumbnail || '';
    if (!imgUrl) return;

    const heroImg = document.querySelector('section.hero img');
    if (!heroImg) return;

    heroImg.src = imgUrl;
    heroImg.alt = heroItem.title || heroImg.alt || 'hero';
  } catch (e) {
    // silent
  }
}

export async function runMediaAutoMap() {
  const snapshot = await loadMediaSnapshot();

  if (!snapshot) return;

  // HERO (optional, non-destructive)
  renderHero(snapshot);

  // Sections array expected in media.snapshot.json
  const sections = Array.isArray(snapshot.sections) ? snapshot.sections : [];

  // Render each section by key
  sections.forEach(sec => {
    if (!sec || !sec.key) return;
    renderSection(sec.key, sec.items || []);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  runMediaAutoMap().catch(console.error);
});
