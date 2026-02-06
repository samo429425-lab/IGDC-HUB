/* =========================================================
 * MARU Detached Pane
 * Global expandable window for detail / video / music
 * ========================================================= */

(function () {
  'use strict';

  if (window.MaruDetachedPane) return;

  let zIndexBase = 210000;

  function createPane({ title = '', content = '' }) {
    const pane = document.createElement('div');
    pane.className = 'maru-detached-pane';
    pane.style.zIndex = zIndexBase++;
    pane.style.left = '120px';
    pane.style.top = '120px';

    pane.innerHTML = `
      <div class="maru-pane-header">
        <span class="maru-pane-title">${title}</span>
        <button class="maru-pane-close">✕</button>
      </div>
      <div class="maru-pane-body"></div>
    `;

    const body = pane.querySelector('.maru-pane-body');
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }

    document.body.appendChild(pane);
    makeDraggable(pane);
    bindClose(pane);

    return pane;
  }

function bindClose(pane) {
  pane.querySelector('.maru-pane-close').onclick = () => {

    // === FIX: media state OFF ===
    if (window.MaruAddon && typeof window.MaruAddon.setMediaState === 'function') {
      window.MaruAddon.setMediaState('video', false);
    }

    pane.remove();
  };
}


  function makeDraggable(pane) {
    const header = pane.querySelector('.maru-pane-header');
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let dragging = false;

    header.addEventListener('pointerdown', e => {
      dragging = true;
      pane.style.zIndex = zIndexBase++;
      startX = e.clientX;
      startY = e.clientY;
      const rect = pane.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', e => {
      if (!dragging) return;
      pane.style.left = startLeft + (e.clientX - startX) + 'px';
      pane.style.top = startTop + (e.clientY - startY) + 'px';
    });

    header.addEventListener('pointerup', e => {
      dragging = false;
      header.releasePointerCapture(e.pointerId);
    });
  }

  function openDetail({ title, text }) {
    createPane({
      title,
      content: `<div class="maru-pane-text">${text || ''}</div>`
    });
  }

  function openVideo({ title, videoSrc, audioSrc }) {
  let html = '';

  if (videoSrc) {
    html += `<video src="${videoSrc}" controls></video>`;
  }
  if (audioSrc) {
    html += `<audio src="${audioSrc}" controls></audio>`;
  }

  createPane({ title, content: html });

  // media ON (영상/오디오 재생 중 → TTS 차단)
  window.MaruAddon?.setMediaState?.('video', true);
}

function openMusic({ title, audioSrc }) {
  createPane({
    title,
    content: `<audio src="${audioSrc}" controls></audio>`
  });

  // media ON (음악도 video 상태로 통일)
  window.MaruAddon?.setMediaState?.('video', true);
}

  function openIframe({ title, iframeSrc }) {
    createPane({
      title,
      content: `<iframe src="${iframeSrc}" frameborder="0"></iframe>`
    });
  }

  window.MaruDetachedPane = {
    open(opts = {}) {
      switch (opts.type) {
        case 'video': openVideo(opts); break;
        case 'music': openMusic(opts); break;
        case 'iframe': openIframe(opts); break;
        case 'detail':
        default: openDetail(opts);
      }
    }
  };

})();
