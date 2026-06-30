/*
 * IGDC / MARU Media Hub OTT inline extension — stages 2–3
 *
 * This file extends the existing Media Hub detail view. It never navigates to
 * /media/watch.html. The legacy controller still owns card interception,
 * list hiding, fullscreen, Escape handling, Back, and scroll restoration.
 *
 * Only content explicitly registered in the server-side secure media catalog
 * is handled here. Every other card immediately falls back to the exact
 * pre-existing inline player path.
 */
(function (global, document) {
  'use strict';

  if (global.IGDCMediaHubOTTInline) return;

  var PLAYBACK_URL = '/.netlify/functions/media-playback';
  var LOGIN_RETURN_KEY = 'igdc.media.ott.login-return.v1';
  var LOGIN_RETURN_TTL_MS = 15 * 60 * 1000;
  var instances = new WeakMap();

  var COPY = {
    ko: {
      loading: '시청 정보를 확인하는 중입니다…',
      loginTitle: '회원 로그인 또는 가입이 필요합니다',
      loginText: '시범 운영 기간에는 가입된 IGDC 회원에게 무료로 제공합니다. 로그인 또는 회원가입 후 계속해 주세요.',
      login: '로그인 또는 회원가입',
      pilotTag: '시범 운영',
      pilotTitle: '회원 무료 시청',
      pilotText: '이 콘텐츠는 시범 운영 기간에 가입 회원에게 무료로 제공됩니다. 시청 요금은 청구되지 않습니다.',
      play: '시청 시작',
      preparingTitle: '콘텐츠를 준비 중입니다.',
      preparingText: '재생 가능한 권리·전달 경로가 확인되면 이 화면에서 바로 시청할 수 있습니다.',
      unavailableTitle: '시청 정보를 불러올 수 없습니다.',
      unavailableText: '잠시 후 다시 시도해 주세요.',
      mediaError: '이 브라우저에서 영상을 재생할 수 없습니다.'
    },
    en: {
      loading: 'Checking viewing access…',
      loginTitle: 'Member login or sign-up is required',
      loginText: 'During pilot operation, viewing is free for registered IGDC members. Please sign in or join to continue.',
      login: 'Sign in or join',
      pilotTag: 'Pilot operation',
      pilotTitle: 'Free viewing for members',
      pilotText: 'This title is available free to registered members during the pilot. No viewing charge is collected.',
      play: 'Start viewing',
      preparingTitle: 'Content is being prepared.',
      preparingText: 'Playback will be available here after its rights and delivery path are confirmed.',
      unavailableTitle: 'Viewing information is unavailable.',
      unavailableText: 'Please try again shortly.',
      mediaError: 'This browser cannot play the video.'
    }
  };

  function text(value) { return value == null ? '' : String(value).trim(); }
  function currentLanguage() {
    var raw = text(document.documentElement && document.documentElement.lang).toLowerCase();
    if (raw === 'zh-hant' || raw === 'zh-tw' || raw === 'zh-hk') return 'zht';
    return raw.split('-')[0] || 'en';
  }
  function phrase(key) {
    var language = currentLanguage();
    return (COPY[language] && COPY[language][key]) || COPY.en[key] || key;
  }
  function create(tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = value;
    return element;
  }
  function safeSameOriginTop() {
    try {
      if (global.top && global.top.location && global.top.location.origin === global.location.origin) return global.top;
    } catch (_) {}
    try {
      if (global.parent && global.parent.location && global.parent.location.origin === global.location.origin) return global.parent;
    } catch (_) {}
    return global;
  }
  function readToken() {
    var scope = safeSameOriginTop();
    try {
      var raw = scope.localStorage.getItem('osauth.tokens.v2');
      var tokens = raw ? JSON.parse(raw) : null;
      var expiry = Number(tokens && tokens.exp || 0);
      if (!tokens || !tokens.id_token || (expiry && expiry * 1000 <= Date.now())) return '';
      return text(tokens.id_token);
    } catch (_) {
      return '';
    }
  }
  function authorizationHeaders() {
    var token = readToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }
  function contentIdFor(card) {
    if (!card) return '';
    var fromData = text(card.dataset && (card.dataset.igdcContentId || card.dataset.contentId || card.dataset.itemId || card.dataset.mediaId));
    if (fromData) return fromData;
    try {
      var href = card.getAttribute('href') || card.href || '';
      var url = new URL(href, global.location.href);
      return text(url.searchParams.get('id') || url.searchParams.get('contentId'));
    } catch (_) {
      return '';
    }
  }
  function titleFor(card) {
    return text(card && card.dataset && (card.dataset.mediaTitle || card.dataset.title)) ||
      text(card && card.querySelector && card.querySelector('.meta') && card.querySelector('.meta').textContent) || 'Media';
  }
  function injectStyle() {
    if (document.getElementById('igdc-mediahub-ott-inline-style')) return;
    var style = document.createElement('style');
    style.id = 'igdc-mediahub-ott-inline-style';
    style.textContent = [
      '.igdc-ott-inline{display:grid;place-items:center;width:100%;height:100%;min-height:inherit;background:#05070b;color:#eef3fb}',
      '.igdc-ott-inline *{box-sizing:border-box}',
      '.igdc-ott-card{max-width:640px;margin:24px;padding:24px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(9,14,22,.92);text-align:center;line-height:1.55}',
      '.igdc-ott-card h2{margin:0 0 10px;font-size:1.2rem}',
      '.igdc-ott-card p{margin:0;color:#cbd6e7}',
      '.igdc-ott-eyebrow{margin:0 0 8px;color:#9ec4ff;font-size:.82rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}',
      '.igdc-ott-action{display:inline-flex;align-items:center;justify-content:center;min-height:42px;margin-top:18px;padding:9px 16px;border:1px solid rgba(255,255,255,.26);border-radius:8px;background:#275ea8;color:#fff;font:inherit;font-weight:700;cursor:pointer}',
      '.igdc-ott-action:hover{background:#3474c9}',
      '.igdc-ott-action:focus-visible{outline:3px solid #8eb3ff;outline-offset:3px}',
      '.igdc-ott-video{display:block;width:100%;height:100%;background:#000;object-fit:contain}',
      '.igdc-ott-loading{display:flex;align-items:center;gap:10px;color:#dce9ff}',
      '.igdc-ott-spinner{width:20px;height:20px;border:3px solid rgba(255,255,255,.25);border-top-color:#9ec4ff;border-radius:50%;animation:igdcOttSpin .85s linear infinite}',
      '@keyframes igdcOttSpin{to{transform:rotate(360deg)}}',
      '@media(max-width:700px){.igdc-ott-card{margin:14px;padding:18px}.igdc-ott-action{width:100%}}'
    ].join('');
    document.head.appendChild(style);
  }
  function clearStage(stage) {
    while (stage && stage.firstChild) stage.removeChild(stage.firstChild);
  }
  function renderCard(stage, options) {
    clearStage(stage);
    var card = create('section', 'igdc-ott-card');
    if (options.eyebrow) card.appendChild(create('div', 'igdc-ott-eyebrow', options.eyebrow));
    card.appendChild(create('h2', '', options.title || ''));
    if (options.text) card.appendChild(create('p', '', options.text));
    if (options.action) {
      var button = create('button', 'igdc-ott-action', options.action.label);
      button.type = 'button';
      button.addEventListener('click', options.action.onClick);
      card.appendChild(button);
    }
    stage.appendChild(card);
  }
  function renderLoading(stage) {
    clearStage(stage);
    var loading = create('div', 'igdc-ott-loading');
    loading.appendChild(create('span', 'igdc-ott-spinner'));
    loading.appendChild(create('span', '', phrase('loading')));
    stage.appendChild(loading);
  }
  function validReturnPath(pathname) {
    var path = text(pathname);
    if (path === '/mediahub.html') return true;
    return /^\/[a-z]{2,3}\/mediahub_[a-z]{2,3}\.html$/i.test(path);
  }
  function saveLoginReturn(instance) {
    try {
      var scope = safeSameOriginTop();
      scope.localStorage.setItem(LOGIN_RETURN_KEY, JSON.stringify({
        version: 1,
        path: global.location.pathname,
        contentId: instance.contentId,
        createdAt: Date.now()
      }));
    } catch (_) {}
  }
  function requestLogin(instance) {
    saveLoginReturn(instance);
    var scope = safeSameOriginTop();
    try {
      if (typeof scope.osLogin === 'function') {
        scope.osLogin();
        return;
      }
    } catch (_) {}
    renderCard(instance.stage, { title: phrase('loginTitle'), text: phrase('loginText') });
  }
  function showLogin(instance) {
    renderCard(instance.stage, {
      title: phrase('loginTitle'),
      text: phrase('loginText'),
      action: { label: phrase('login'), onClick: function () { requestLogin(instance); } }
    });
  }
  function showPilotNotice(instance, content) {
    renderCard(instance.stage, {
      eyebrow: phrase('pilotTag'),
      title: text(content && content.title) || titleFor(instance.card),
      text: phrase('pilotText'),
      action: { label: phrase('play'), onClick: function () { attachVideo(instance, content); } }
    });
  }
  function allowedStreamUrl(value) {
    var raw = text(value);
    if (!raw) return '';
    if (raw.charAt(0) === '/') return raw;
    try {
      var parsed = new URL(raw);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.toString() : '';
    } catch (_) {
      return '';
    }
  }
  function attachVideo(instance, content) {
    if (!instance || instance.disposed) return;
    var streamUrl = allowedStreamUrl(content && content.stream && content.stream.url);
    if (!streamUrl) {
      renderCard(instance.stage, { title: phrase('preparingTitle'), text: phrase('preparingText') });
      return;
    }
    clearStage(instance.stage);
    var video = document.createElement('video');
    video.className = 'igdc-ott-video';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = streamUrl;
    if (content.posterUrl) video.poster = allowedStreamUrl(content.posterUrl);
    video.setAttribute('aria-label', text(content.title) || titleFor(instance.card));
    video.addEventListener('error', function () {
      if (instance.disposed) return;
      renderCard(instance.stage, { title: phrase('unavailableTitle'), text: phrase('mediaError') });
    }, { once: true });
    instance.stage.appendChild(video);
    instance.video = video;
    var play = video.play();
    if (play && typeof play.catch === 'function') play.catch(function () {});
  }
  function responseJson(response) {
    return response.json().catch(function () { return {}; });
  }
  function loadPlayback(instance) {
    var endpoint = new URL(PLAYBACK_URL, global.location.origin);
    endpoint.searchParams.set('id', instance.contentId);
    return global.fetch(endpoint.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ Accept: 'application/json' }, authorizationHeaders())
    }).then(function (response) {
      return responseJson(response).then(function (payload) { return { response: response, payload: payload || {} }; });
    });
  }
  function fallbackLegacy(instance) {
    if (!instance || instance.disposed) return;
    instances.delete(instance.stage);
    clearStage(instance.stage);
    try { instance.legacyMount(instance.stage, instance.card); } catch (_) {
      renderCard(instance.stage, { title: phrase('unavailableTitle'), text: phrase('unavailableText') });
    }
  }
  function run(instance) {
    loadPlayback(instance).then(function (result) {
      if (instance.disposed) return;
      var response = result.response;
      var payload = result.payload || {};
      if (response.ok && payload.ok && payload.content) {
        showPilotNotice(instance, payload.content);
        return;
      }
      if (response.status === 404 && payload.error === 'ott_not_registered') {
        fallbackLegacy(instance);
        return;
      }
      if (response.status === 401 && (payload.error === 'member_login_required' || payload.error === 'member_token_expired' || payload.error === 'member_token_invalid')) {
        showLogin(instance);
        return;
      }
      if (response.status === 409 && payload.error === 'content_not_ready') {
        renderCard(instance.stage, { title: phrase('preparingTitle'), text: phrase('preparingText') });
        return;
      }
      renderCard(instance.stage, {
        title: phrase('unavailableTitle'),
        text: text(payload.message) || phrase('unavailableText')
      });
    }).catch(function () {
      if (instance.disposed) return;
      // Do not bypass a failed managed-content gate. Only a confirmed 404 falls back.
      renderCard(instance.stage, { title: phrase('unavailableTitle'), text: phrase('unavailableText') });
    });
  }
  function mount(stage, card, options) {
    var contentId = contentIdFor(card);
    if (!contentId || !stage || !options || typeof options.legacyMount !== 'function') return false;
    injectStyle();
    var instance = {
      stage: stage,
      card: card,
      contentId: contentId,
      legacyMount: options.legacyMount,
      disposed: false,
      video: null
    };
    instances.set(stage, instance);
    renderLoading(stage);
    run(instance);
    return true;
  }
  function dispose(stage) {
    var instance = stage && instances.get(stage);
    if (!instance) return;
    instance.disposed = true;
    try {
      if (instance.video) {
        instance.video.pause();
        instance.video.removeAttribute('src');
        instance.video.load();
      }
    } catch (_) {}
    instances.delete(stage);
  }
  function readLoginReturn() {
    try {
      var raw = global.localStorage.getItem(LOGIN_RETURN_KEY) || '';
      var value = raw ? JSON.parse(raw) : null;
      if (!value || Number(value.version) !== 1 || !validReturnPath(value.path) || !text(value.contentId)) return null;
      if (!Number(value.createdAt) || Date.now() - Number(value.createdAt) > LOGIN_RETURN_TTL_MS) return null;
      return value;
    } catch (_) {
      return null;
    }
  }
  function clearLoginReturn() {
    try { global.localStorage.removeItem(LOGIN_RETURN_KEY); } catch (_) {}
  }
  function resumeAfterLogin() {
    var pending = readLoginReturn();
    if (!pending || pending.path !== global.location.pathname) return;
    var attempts = 0;
    var timer = global.setInterval(function () {
      attempts += 1;
      var player = global.IGDCMediaHubPlayback;
      var cards = Array.prototype.slice.call(document.querySelectorAll('.thumb-line[data-psom-key^="media-"] a.card'));
      var card = cards.find(function (entry) { return contentIdFor(entry) === pending.contentId; });
      if (player && typeof player.open === 'function' && card) {
        global.clearInterval(timer);
        clearLoginReturn();
        player.open(card);
        return;
      }
      if (attempts >= 48) global.clearInterval(timer);
    }, 250);
  }

  global.IGDCMediaHubOTTInline = { mount: mount, dispose: dispose, VERSION: '1.0.0-inline-stage2-3' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resumeAfterLogin, { once: true });
  else resumeAfterLogin();
})(window, document);
