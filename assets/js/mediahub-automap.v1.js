// mediahub-automap.v1.js
// FINAL — HOME-STYLE PIPELINE VALIDATION
// Section activation: items.length
// Real content arrival auto-hides placeholders

async function loadMediaSnapshot(url = '/data/media.snapshot.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load media snapshot');
  return res.json();
}

function formatDuration(sec = 0) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
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
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = item.title || '';

  const dur = formatDuration(item.duration);
  if (dur) {
    const badge = document.createElement('span');
    badge.className = 'duration';
    badge.textContent = dur;
    thumb.appendChild(badge);
  }

  a.appendChild(thumb);
  a.appendChild(meta);
  return a;
}

function getLine(sectionKey) {
  return document.querySelector(`.thumb-line[data-psom-key="${sectionKey}"]`);
}

function hidePlaceholders(line) {
  line.querySelectorAll('.card.media-card[data-placeholder="true"]')
    .forEach(el => el.style.display = 'none');
}

function showPlaceholders(line) {
  line.querySelectorAll('.card.media-card[data-placeholder="true"]')
    .forEach(el => el.style.display = '');
}

function clearInjected(line) {
  line.querySelectorAll('.card.media-card:not([data-placeholder="true"])')
    .forEach(el => el.remove());
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

  safeItems.forEach(item => {
    if (!item) return;
    line.appendChild(createCard(item));
  });
}

export async function runMediaAutoMap() {
  const snapshot = await loadMediaSnapshot();
  if (!snapshot || !Array.isArray(snapshot.sections)) return;

  snapshot.sections.forEach(sec => {
    if (!sec || !sec.key) return;
    renderSection(sec.key, sec.items || []);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  runMediaAutoMap().catch(console.error);
});
