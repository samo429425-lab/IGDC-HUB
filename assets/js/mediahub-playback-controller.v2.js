/*
 * IGDC / MARU MediaHub playback controller v2
 * Restored inline Media Hub transition contract.
 *
 * This controller keeps media-card navigation inside the existing Media Hub
 * document. It does not route to a separate watch page. The list is restored
 * at the original scroll position when the user chooses Back. ESC exits only
 * browser fullscreen and leaves the detail view open, matching the legacy flow.
 */
(function (global, document) {
  'use strict';

  if (global.__IGDC_MEDIAHUB_PLAYBACK_V2__) return;
  global.__IGDC_MEDIAHUB_PLAYBACK_V2__ = true;

  var state = { open: false, detail: null, stage: null, restore: [], scrollY: 0 };
  var COPY = {
    ko: { back: '← 목록으로 돌아가기', fullscreen: '전체 화면', exitFullscreen: '전체 화면 나가기', preparing: '콘텐츠를 준비 중입니다.', unavailable: '이 콘텐츠의 재생 소스가 아직 연결되지 않았습니다.' },
    en: { back: '← Back to list', fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', preparing: 'Content is being prepared.', unavailable: 'A playable source has not been connected yet.' }
  };

  function copy() {
    var lang = String((document.documentElement && document.documentElement.lang) || 'ko').toLowerCase();
    if (lang === 'zh-hant' || lang === 'zh-tw' || lang === 'zh-hk') lang = 'zht';
    lang = lang.split('-')[0];
    return COPY[lang] || COPY.en;
  }

  function text(value) { return value == null ? '' : String(value).trim(); }
  function create(tag, className, content) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (content != null) element.textContent = content;
    return element;
  }
  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function isMediaCard(node) {
    return node && node.closest && node.closest('.thumb-line[data-psom-key^="media-"] a.card');
  }
  function titleFor(card) {
    return text(card && card.dataset && (card.dataset.mediaTitle || card.dataset.title)) ||
      text(card && card.querySelector && card.querySelector('.meta') && card.querySelector('.meta').textContent) || 'Media';
  }
  function sourceFor(card) {
    return text(card && card.dataset && (card.dataset.mediaSource || card.dataset.videoSource || card.dataset.videoUrl || card.dataset.mediaUrl));
  }
  function imageFor(card) {
    var image = card && card.querySelector && card.querySelector('img');
    return (image && (image.currentSrc || image.src)) || '';
  }
  function directVideo(source) { return /\.(mp4|webm|ogv|ogg|m4v)(?:[?#].*)?$/i.test(source); }
  function youtubeId(source) {
    var match = String(source || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
    return match ? match[1] : '';
  }
  function frameHeight() {
    try {
      if (global.parent === global || !global.parent.postMessage) return;
      var de = document.documentElement, body = document.body;
      var height = Math.max(de ? de.scrollHeight : 0, body ? body.scrollHeight : 0, de ? de.offsetHeight : 0, body ? body.offsetHeight : 0);
      global.parent.postMessage({ type: 'igdcFrameHeight', height: height, page: global.location.pathname }, '*');
    } catch (_) {}
  }

  function injectStyle() {
    if (document.getElementById('igdc-mediahub-playback-v2-style')) return;
    var style = document.createElement('style');
    style.id = 'igdc-mediahub-playback-v2-style';
    style.textContent = [
      '#igdc-media-detail-view{display:block;width:100%;min-height:100vh;background:#0d1118;color:#eef3fb;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#igdc-media-detail-view *{box-sizing:border-box}',
      '.igdc-media-detail-header{display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 16px;background:#151d29;border-bottom:1px solid rgba(255,255,255,.12)}',
      '.igdc-media-detail-back,.igdc-media-detail-fullscreen{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:#202b3d;color:#fff;padding:8px 12px;font:inherit;cursor:pointer}',
      '.igdc-media-detail-back:hover,.igdc-media-detail-fullscreen:hover{background:#2c3c57}',
      '.igdc-media-detail-back:focus-visible,.igdc-media-detail-fullscreen:focus-visible{outline:3px solid #8eb3ff;outline-offset:2px}',
      '.igdc-media-detail-title{flex:1;min-width:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.igdc-media-detail-stage{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:16/9;min-height:320px;background:#05070b;outline:none}',
      '.igdc-media-detail-stage:fullscreen{width:100vw;height:100vh;aspect-ratio:auto;min-height:100vh}',
      '.igdc-media-detail-stage video,.igdc-media-detail-stage iframe{display:block;width:100%;height:100%;border:0;background:#000;object-fit:contain}',
      '.igdc-media-detail-pending{position:relative;display:grid;place-items:center;width:100%;height:100%;overflow:hidden;background:#0e1521}',
      '.igdc-media-detail-pending img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.24;filter:blur(1px)}',
      '.igdc-media-detail-pending-panel{position:relative;max-width:620px;margin:24px;padding:22px 24px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(7,11,17,.88);text-align:center;line-height:1.55}',
      '.igdc-media-detail-pending-panel strong{display:block;margin-bottom:6px}',
      '@media(max-width:700px){.igdc-media-detail-header{padding:8px 10px;gap:8px}.igdc-media-detail-back,.igdc-media-detail-fullscreen{padding:7px 9px;font-size:.86rem}.igdc-media-detail-stage{min-height:56vw}}'
    ].join('');
    document.head.appendChild(style);
  }

  function hideList(card) {
    var roots = [];
    function add(node) { if (node && roots.indexOf(node) < 0) roots.push(node); }
    add(document.getElementById('hero'));
    add(card && card.closest('.layout'));
    add(document.querySelector('.hero-overlay'));
    add(document.querySelector('footer'));
    add(document.getElementById('providers-drawer-left'));
    add(document.getElementById('providers-backdrop-left'));
    add(document.getElementById('providers-tab-left'));
    add(document.getElementById('providers-banner'));
    state.restore = roots.map(function (node) {
      return { node: node, display: node.style.display, ariaHidden: node.getAttribute('aria-hidden') };
    });
    state.restore.forEach(function (entry) {
      entry.node.style.display = 'none';
      entry.node.setAttribute('aria-hidden', 'true');
    });
  }
  function restoreList() {
    state.restore.forEach(function (entry) {
      entry.node.style.display = entry.display;
      if (entry.ariaHidden == null) entry.node.removeAttribute('aria-hidden');
      else entry.node.setAttribute('aria-hidden', entry.ariaHidden);
    });
    state.restore = [];
  }

  function appendLegacyPlayer(stage, card) {
    var c = copy();
    var source = sourceFor(card);
    var youtube = youtubeId(source);
    if (youtube) {
      var frame = document.createElement('iframe');
      frame.title = titleFor(card);
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(youtube) + '?autoplay=1&rel=0';
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      frame.setAttribute('allowfullscreen', '');
      stage.appendChild(frame);
      return;
    }
    if (directVideo(source)) {
      var video = document.createElement('video');
      video.src = source;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', titleFor(card));
      stage.appendChild(video);
      return;
    }
    var pending = create('div', 'igdc-media-detail-pending');
    var image = imageFor(card);
    if (image) {
      var preview = document.createElement('img');
      preview.src = image;
      preview.alt = '';
      pending.appendChild(preview);
    }
    var panel = create('div', 'igdc-media-detail-pending-panel');
    panel.appendChild(create('strong', '', c.preparing));
    panel.appendChild(create('div', '', c.unavailable));
    pending.appendChild(panel);
    stage.appendChild(pending);
  }

  function appendPlayer(stage, card) {
    var ott = global.IGDCMediaHubOTTInline;
    if (ott && typeof ott.mount === 'function') {
      try {
        if (ott.mount(stage, card, { legacyMount: appendLegacyPlayer })) return;
      } catch (_) {}
    }
    appendLegacyPlayer(stage, card);
  }

  function leaveFullscreen() {
    try {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (fullscreenElement() && exit) {
        var result = exit.call(document);
        if (result && result.catch) result.catch(function () {});
      }
    } catch (_) {}
  }
  function updateFullscreenButton() {
    if (!state.detail) return;
    var button = state.detail.querySelector('.igdc-media-detail-fullscreen');
    if (button) button.textContent = fullscreenElement() ? copy().exitFullscreen : copy().fullscreen;
  }
  function toggleFullscreen() {
    if (!state.stage) return;
    if (fullscreenElement()) { leaveFullscreen(); return; }
    try {
      var request = state.stage.requestFullscreen || state.stage.webkitRequestFullscreen;
      if (request) {
        var result = request.call(state.stage);
        if (result && result.catch) result.catch(function () {});
      }
    } catch (_) {}
  }

  function close() {
    if (!state.open) return;
    if (fullscreenElement()) leaveFullscreen();
    try {
      if (state.stage && global.IGDCMediaHubOTTInline && typeof global.IGDCMediaHubOTTInline.dispose === 'function') {
        global.IGDCMediaHubOTTInline.dispose(state.stage);
      }
    } catch (_) {}
    if (state.detail) state.detail.remove();
    restoreList();
    var restoreY = state.scrollY;
    state.open = false;
    state.detail = null;
    state.stage = null;
    global.requestAnimationFrame(function () {
      global.scrollTo(0, restoreY);
      frameHeight();
    });
  }

  function open(card) {
    if (!card || state.open) return;
    injectStyle();
    state.open = true;
    state.scrollY = global.scrollY || global.pageYOffset || 0;
    hideList(card);

    var c = copy();
    var detail = create('section', '');
    detail.id = 'igdc-media-detail-view';
    detail.setAttribute('aria-label', titleFor(card));
    var header = create('header', 'igdc-media-detail-header');
    var back = create('button', 'igdc-media-detail-back', c.back);
    back.type = 'button';
    var title = create('div', 'igdc-media-detail-title', titleFor(card));
    var fullscreen = create('button', 'igdc-media-detail-fullscreen', c.fullscreen);
    fullscreen.type = 'button';
    header.appendChild(back);
    header.appendChild(title);
    header.appendChild(fullscreen);

    var stage = create('div', 'igdc-media-detail-stage');
    stage.tabIndex = -1;
    appendPlayer(stage, card);
    detail.appendChild(header);
    detail.appendChild(stage);
    document.body.appendChild(detail);

    state.detail = detail;
    state.stage = stage;
    back.addEventListener('click', close);
    fullscreen.addEventListener('click', toggleFullscreen);
    global.requestAnimationFrame(function () {
      global.scrollTo(0, 0);
      stage.focus({ preventScroll: true });
      frameHeight();
    });
  }

  document.addEventListener('click', function (event) {
    var card = isMediaCard(event.target);
    if (!card || state.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(card);
  }, true);
  document.addEventListener('keydown', function (event) {
    if (!state.open) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (event.key === 'Escape' && fullscreenElement()) {
      event.preventDefault();
      leaveFullscreen();
    }
  }, true);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

  global.IGDCMediaHubPlayback = { open: open, close: close, VERSION: '2.0.0-inline-restored' };
})(window, document);
