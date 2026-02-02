
/**
 * media-automap.js
 * Purpose: Render media.snapshot.json into mediahub.html sections
 * Requirements:
 *  - Each section container has data-media-section="{sectionKey}"
 *  - Cards are rendered into .scroll-content
 */

async function loadMediaSnapshot(url = '/data/media.snapshot.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load media snapshot');
  return res.json();
}

function createCard(item) {
  const card = document.createElement('div');
  card.className = 'media-card';

  card.innerHTML = `
    <div class="thumb">
      <img src="${item.thumbnail || ''}" alt="${item.title || ''}">
      <span class="duration">${formatDuration(item.duration)}</span>
    </div>
    <div class="meta">
      <h4>${item.title || ''}</h4>
    </div>
  `;

  card.addEventListener('click', () => {
    if (item.video) {
      window.open(item.video, '_blank');
    }
  });

  return card;
}

function formatDuration(sec = 0) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function renderSection(sectionKey, items) {
  const wrapper = document.querySelector(`[data-media-section="${sectionKey}"]`);
  if (!wrapper) return;

  const scroller = wrapper.querySelector('.scroll-content');
  if (!scroller) return;

  scroller.innerHTML = '';

  items.forEach(item => {
    scroller.appendChild(createCard(item));
  });
}

export async function runMediaAutoMap() {
  const snapshot = await loadMediaSnapshot();

  if (!snapshot || !snapshot.sections) return;

  snapshot.sections.forEach(sec => {
    renderSection(sec.key, sec.items || []);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  runMediaAutoMap().catch(console.error);
});
