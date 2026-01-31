/**
 * media-automap.v2.video.snapshot.js
 * VIDEO-AWARE MEDIA AUTOMAP (SNAPSHOT-FIRST)
 *
 * PRINCIPLES
 * 1) Media ≠ Donation (video-centric)
 * 2) Snapshot first: front.snapshot.json → pages.media.sections
 * 3) Supports video / iframe / embed / poster
 * 4) If snapshot has no usable video items → fallback to legacy loader
 *
 * EXPECTED ITEM FIELDS (any)
 * - video / video_url / embed / iframe
 * - poster / thumb
 * - title
 */

(function () {
  'use strict';
  if (window.__MEDIA_AUTOMAP_V2_VIDEO__) return;
  window.__MEDIA_AUTOMAP_V2_VIDEO__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';

  function qsAll(sel){ return document.querySelectorAll(sel); }

  function pick(o, keys){
    for (const k of keys){
      if (o && typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
    }
    return '';
  }

  function buildVideoCard(item){
    const wrap = document.createElement('div');
    wrap.className = 'card';

    const media = document.createElement('div');
    media.className = 'thumb';

    const iframeSrc = pick(item, ['iframe','embed','video','video_url','url']);
    if (iframeSrc && iframeSrc.startsWith('http')){
      const iframe = document.createElement('iframe');
      iframe.src = iframeSrc;
      iframe.loading = 'lazy';
      iframe.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      media.appendChild(iframe);
    } else {
      const poster = pick(item, ['poster','thumb','image','image_url']);
      if (poster){
        media.style.backgroundImage = 'url('+poster+')';
        media.style.backgroundSize = 'cover';
        media.style.backgroundPosition = 'center';
      }
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = item.title || '';

    wrap.appendChild(media);
    wrap.appendChild(meta);
    return wrap;
  }

  function render(grid, items){
    if (!Array.isArray(items) || !items.length) return false;

    const hasVideo = items.some(it =>
      pick(it, ['iframe','embed','video','video_url','url'])
    );
    if (!hasVideo) return false;

    grid.innerHTML = '';
    items.forEach(it => grid.appendChild(buildVideoCard(it)));
    return true;
  }

  async function loadSnapshot(grid, key){
    try{
      const r = await fetch(SNAPSHOT_URL, { cache:'no-store' });
      if (!r.ok) return false;
      const snap = await r.json();
      const items = snap?.pages?.media?.sections?.[key];
      return render(grid, items);
    }catch(e){
      return false;
    }
  }

  async function run(){
    const grids = qsAll('.thumb-grid[data-psom-key]');
    if (!grids.length) return;

    for (const grid of grids){
      const key = grid.getAttribute('data-psom-key');
      if (!key) continue;

      if (grid.dataset.mediaLoaded === 'true') continue;
      grid.dataset.mediaLoaded = 'true';

      const used = await loadSnapshot(grid, key);

      if (!used && typeof window.loadThumbnails === 'function') {
        window.loadThumbnails(grid, key);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();