/*
 * IGDC / MARU Media Hub OTT inline extension — stages 2–6 hardened
 *
 * This file extends only the existing Media Hub inline detail view. It never
 * routes a card to /media/watch.html. The legacy controller still owns card
 * interception, list hiding, fullscreen, Escape, Back, and scroll restore.
 *
 * Only a title explicitly registered in the secure server-side media catalog
 * uses this OTT layer. Every other Media Hub card immediately returns to the
 * original inline player path.
 */
(function (global, document) {
  'use strict';

  if (global.IGDCMediaHubOTTInline) return;

  var PLAYBACK_URL = '/.netlify/functions/media-playback';
  var VIEWING_STATE_URL = '/.netlify/functions/media-viewing-state';
  var AD_DECISION_URL = '/.netlify/functions/media-ad-decision';
  var ACCESS_URL = '/.netlify/functions/media-access';
  var ACCESS_ORDER_URL = '/.netlify/functions/media-access-order';
  var LOGIN_RETURN_KEY = 'igdc.media.ott.login-return.v1';
  var LOGIN_RETURN_TTL_MS = 15 * 60 * 1000;
  var LOCAL_STATE_PREFIX = 'igdc.media.ott.viewing-state.v1';
  var LOCAL_STATE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
  var MAX_LOCAL_RECORDS = 200;
  var LOCAL_SAVE_INTERVAL_MS = 10000;
  var REMOTE_SAVE_INTERVAL_MS = 30000;
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
      mediaError: '이 브라우저에서 영상을 재생할 수 없습니다.',
      hlsUnavailable: '이 HLS 전달 방식은 현재 브라우저에서 지원되지 않습니다. MP4 시범 재생으로 확인해 주세요.',
      captions: '자막',
      captionsOff: '자막 없음',
      resumeTitle: '이어서 시청하시겠습니까?',
      resumeText: '마지막 시청 위치',
      resume: '이어서 시청',
      startOver: '처음부터',
      advertisement: '광고',
      skipAd: '건너뛰기',
      adNotice: '광고 후 본편이 재생됩니다.',
      seasons: '시즌',
      episodes: '회차',
      episode: '화',
      selectEpisode: '회차 선택',
      backToEpisodes: '회차 목록',
      previousEpisodes: '이전 회차',
      nextEpisodes: '다음 회차',
      noEpisodes: '현재 시청 가능한 회차가 없습니다.',
      episodeUnavailable: '이 회차는 아직 시청 준비 중입니다.',
      accessTag: 'Media Access',
      accessTitle: '이 콘텐츠는 이용권이 필요합니다',
      accessText: '이 콘텐츠는 회원 이용권 또는 구독 권한이 확인된 뒤 시청할 수 있습니다.',
      accessPrepareTitle: '이용권 결제를 준비 중입니다',
      accessPrepareText: '카드 결제 연결은 PG 승인 후 활성화됩니다. 현재는 상품·권한·결제 주문 구조만 안전하게 준비되어 있습니다.',
      accessOpen: '이용권 확인',
      accessBack: '시청 정보로 돌아가기',
      accessOffers: '이용권 선택',
      accessNoOffers: '현재 선택 가능한 이용권이 준비 중입니다.',
      accessTerms: '이용권 조건 및 환불 안내를 확인했습니다.',
      accessPrepareOrder: '결제 준비 확인',
      accessTermsRequired: '이용권 조건 확인이 필요합니다.',
      accessOrderReadyTitle: '결제 준비가 완료되었습니다',
      accessOrderReadyText: 'PG 승인과 카드 결제 연결이 완료되면 이 주문 흐름에서 안전하게 결제가 진행됩니다. 현재 결제나 청구는 이루어지지 않습니다.',
      accessPendingTitle: '결제 연결 준비 중',
      accessPendingText: '이 콘텐츠의 이용권·권한 구조는 준비되어 있으나 카드 결제 연결은 아직 활성화되지 않았습니다.',
      accessError: '이용권 정보를 불러올 수 없습니다.',
      accessPrice: '이용 요금',
      accessPaymentPending: 'PG 승인 대기',
      accessPlan: '이용권'
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
      mediaError: 'This browser cannot play the video.',
      hlsUnavailable: 'This HLS delivery is not supported by the current browser. Please use the MP4 pilot delivery.',
      captions: 'Captions',
      captionsOff: 'No captions',
      resumeTitle: 'Continue watching?',
      resumeText: 'Last viewing position',
      resume: 'Continue',
      startOver: 'Start over',
      advertisement: 'Advertisement',
      skipAd: 'Skip',
      adNotice: 'The program begins after this message.',
      seasons: 'Seasons',
      episodes: 'Episodes',
      episode: 'Episode',
      selectEpisode: 'Select episode',
      backToEpisodes: 'Episodes',
      previousEpisodes: 'Previous episodes',
      nextEpisodes: 'Next episodes',
      noEpisodes: 'No episodes are currently available to view.',
      episodeUnavailable: 'This episode is not ready for viewing yet.',
      accessTag: 'Media Access',
      accessTitle: 'This title requires viewing access',
      accessText: 'A valid member pass or subscription entitlement is required before playback can begin.',
      accessPrepareTitle: 'Access payment is being prepared',
      accessPrepareText: 'Card payment will be activated after PG approval. The product, entitlement, and order safeguards are ready without collecting a charge.',
      accessOpen: 'View access options',
      accessBack: 'Back to viewing details',
      accessOffers: 'Choose access',
      accessNoOffers: 'Access options are being prepared.',
      accessTerms: 'I have reviewed the access terms and refund information.',
      accessPrepareOrder: 'Prepare payment flow',
      accessTermsRequired: 'Please confirm the access terms first.',
      accessOrderReadyTitle: 'Payment preparation is complete',
      accessOrderReadyText: 'After PG approval and card activation, this order flow will continue securely. No payment or charge is made now.',
      accessPendingTitle: 'Payment connection is being prepared',
      accessPendingText: 'The access and entitlement structure is ready, but card payment is not activated yet.',
      accessError: 'Unable to load access information.',
      accessPrice: 'Price',
      accessPaymentPending: 'PG approval pending',
      accessPlan: 'Access pass'
    }
  };

  function text(value) { return value == null ? '' : String(value).trim(); }
  function finite(value, maximum) {
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.min(number, maximum || 60 * 60 * 24 * 365);
  }
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
  function allowedUrl(value) {
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
  function validLanguage(value) {
    var raw = text(value).toLowerCase().replace(/_/g, '-');
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,12})?$/i.test(raw) ? raw : '';
  }
  function cleanCaptions(items) {
    var rows = Array.isArray(items) ? items : [];
    var seen = {};
    var result = [];
    rows.slice(0, 30).forEach(function (item, index) {
      var source = allowedUrl(item && (item.src || item.url || item.href));
      var language = validLanguage(item && (item.language || item.lang || item.srclang));
      var kind = text(item && item.kind || 'subtitles').toLowerCase();
      if (!source || !language || (kind !== 'subtitles' && kind !== 'captions')) return;
      var key = language + '|' + source;
      if (seen[key]) return;
      seen[key] = true;
      result.push({
        value: String(index),
        language: language,
        label: text(item && (item.label || item.name) || language) || language,
        kind: kind,
        src: source,
        isDefault: Boolean(item && (item.default === true || item.isDefault === true))
      });
    });
    return result;
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
      '.igdc-ott-loading{display:flex;align-items:center;gap:10px;color:#dce9ff}',
      '.igdc-ott-spinner{width:20px;height:20px;border:3px solid rgba(255,255,255,.25);border-top-color:#9ec4ff;border-radius:50%;animation:igdcOttSpin .85s linear infinite}',
      '.igdc-ott-video-shell{position:relative;width:100%;height:100%;min-height:inherit;background:#000}',
      '.igdc-ott-video{display:block;width:100%;height:100%;background:#000;object-fit:contain}',
      '.igdc-ott-tools{position:absolute;top:12px;right:12px;z-index:3;display:flex;gap:8px;max-width:calc(100% - 24px)}',
      '.igdc-ott-caption-label{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(255,255,255,.28);border-radius:7px;background:rgba(5,8,12,.76);color:#fff;font-size:.82rem}',
      '.igdc-ott-caption-select{max-width:190px;border:0;background:transparent;color:inherit;font:inherit}',
      '.igdc-ott-caption-select option{background:#111927;color:#fff}',
      '.igdc-ott-resume,.igdc-ott-ad{position:absolute;inset:0;z-index:4;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.58)}',
      '.igdc-ott-resume-card,.igdc-ott-ad-card{width:min(440px,100%);padding:20px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(8,13,21,.95);color:#eef3fb;text-align:center;line-height:1.5}',
      '.igdc-ott-resume-card h2,.igdc-ott-ad-card h2{margin:0 0 8px;font-size:1.12rem}',
      '.igdc-ott-resume-card p,.igdc-ott-ad-card p{margin:0;color:#cbd6e7}',
      '.igdc-ott-resume-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:18px}',
      '.igdc-ott-resume-actions button,.igdc-ott-ad-skip{min-height:40px;padding:8px 13px;border:1px solid rgba(255,255,255,.26);border-radius:8px;background:#275ea8;color:#fff;font:inherit;font-weight:700;cursor:pointer}',
      '.igdc-ott-resume-actions button:last-child{background:#202b3d}',
      '.igdc-ott-ad-media{display:block;width:100%;max-height:52vh;margin:12px 0;border:0;background:#000;object-fit:contain}',
      '.igdc-ott-ad-skip{margin-top:12px;background:#202b3d}',
      '.igdc-ott-series{width:100%;height:100%;min-height:inherit;overflow:auto;padding:20px;background:#05070b;color:#eef3fb}',
      '.igdc-ott-series-head{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;max-width:1180px;margin:0 auto 14px}',
      '.igdc-ott-series-head h2{margin:0;font-size:1.3rem}.igdc-ott-series-head p{margin:0;color:#cbd6e7;line-height:1.5}',
      '.igdc-ott-series-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}',
      '.igdc-ott-series-button{min-height:36px;padding:7px 11px;border:1px solid rgba(255,255,255,.25);border-radius:7px;background:#182235;color:#eef3fb;font:inherit;font-weight:700;cursor:pointer}',
      '.igdc-ott-series-button[aria-pressed="true"]{background:#275ea8;border-color:#7eaeff}',
      '.igdc-ott-series-button:focus-visible,.igdc-ott-episode:focus-visible{outline:3px solid #8eb3ff;outline-offset:3px}',
      '.igdc-ott-series-player{max-width:1180px;min-height:300px;margin:0 auto 16px;background:#000}',
      '.igdc-ott-series-shelf{max-width:1180px;margin:0 auto}.igdc-ott-series-shelf-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 9px;font-size:1rem;font-weight:700}',
      '.igdc-ott-shelf-controls{display:flex;gap:6px}.igdc-ott-shelf-controls button{width:34px;height:32px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:#182235;color:#fff;font-size:1.1rem;cursor:pointer}',
      '.igdc-ott-episodes{display:flex;gap:10px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;padding:2px 2px 12px;scrollbar-color:#456994 #111927}',
      '.igdc-ott-episode{flex:0 0 166px;min-height:148px;padding:0;overflow:hidden;border:1px solid rgba(255,255,255,.22);border-radius:9px;background:#111927;color:#eef3fb;text-align:left;font:inherit;cursor:pointer;scroll-snap-align:start}',
      '.igdc-ott-episode[aria-current="true"]{border-color:#8eb3ff;box-shadow:0 0 0 1px #8eb3ff inset}',
      '.igdc-ott-episode img,.igdc-ott-episode-fallback{display:block;width:100%;height:91px;object-fit:cover;background:#1b2738}',
      '.igdc-ott-episode-fallback{display:grid;place-items:center;color:#9db6d5;font-size:.78rem}',
      '.igdc-ott-episode-meta{display:block;padding:7px 8px 8px;line-height:1.35}.igdc-ott-episode-number{display:block;color:#9ec4ff;font-size:.75rem;font-weight:700}.igdc-ott-episode-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem}',
      '.igdc-ott-series-empty{max-width:1180px;margin:24px auto;padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:#111927;color:#cbd6e7}',
      '.igdc-ott-access{max-width:760px;margin:24px;padding:24px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(9,14,22,.96);color:#eef3fb;line-height:1.5}',
      '.igdc-ott-access h2{margin:0 0 8px;font-size:1.2rem}.igdc-ott-access p{margin:0;color:#cbd6e7}',
      '.igdc-ott-access-products{display:grid;gap:10px;margin-top:16px}.igdc-ott-access-product{padding:14px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:#111927}',
      '.igdc-ott-access-product h3{margin:0 0 5px;font-size:1rem}.igdc-ott-access-price{margin-top:8px;color:#9ec4ff;font-weight:700}',
      '.igdc-ott-access-terms{display:flex;align-items:flex-start;gap:8px;margin-top:14px;color:#d5deec;font-size:.88rem}.igdc-ott-access-terms input{margin-top:3px}',
      '.igdc-ott-access-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.igdc-ott-access-actions button{min-height:40px;padding:8px 13px;border:1px solid rgba(255,255,255,.26);border-radius:8px;background:#275ea8;color:#fff;font:inherit;font-weight:700;cursor:pointer}.igdc-ott-access-actions button.secondary{background:#202b3d}',
      '@keyframes igdcOttSpin{to{transform:rotate(360deg)}}',
      '@media(max-width:700px){.igdc-ott-card{margin:14px;padding:18px}.igdc-ott-action{width:100%}.igdc-ott-tools{top:8px;right:8px}.igdc-ott-caption-label{font-size:.75rem}.igdc-ott-caption-select{max-width:150px}.igdc-ott-resume-card,.igdc-ott-ad-card{padding:16px}.igdc-ott-series{padding:14px}.igdc-ott-series-head h2{font-size:1.1rem}.igdc-ott-episode{flex-basis:144px}.igdc-ott-episode img,.igdc-ott-episode-fallback{height:80px}}'
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
    if (options.secondaryAction) {
      var secondary = create('button', 'igdc-ott-action', options.secondaryAction.label);
      secondary.type = 'button';
      secondary.style.marginLeft = '8px';
      secondary.style.background = '#202b3d';
      secondary.addEventListener('click', options.secondaryAction.onClick);
      card.appendChild(secondary);
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


  function numberValue(value, fallback) {
    var number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }
  function seriesSeasons(series) {
    var raw = Array.isArray(series && series.seasons) ? series.seasons : [];
    return raw.map(function (season, index) {
      var episodes = Array.isArray(season && season.episodes) ? season.episodes.slice() : [];
      return {
        seasonNumber: numberValue(season && season.seasonNumber, index + 1),
        title: text(season && season.title) || (phrase('seasons') + ' ' + (index + 1)),
        description: text(season && season.description),
        episodes: episodes.filter(function (episode) { return text(episode && episode.contentId); }).sort(function (a, b) {
          return numberValue(a && a.episodeNumber, 999999) - numberValue(b && b.episodeNumber, 999999);
        })
      };
    }).filter(function (season) { return season.episodes.length; }).sort(function (a, b) { return a.seasonNumber - b.seasonNumber; });
  }
  function seriesSeason(series, seasonNumber) {
    var seasons = seriesSeasons(series);
    return seasons.find(function (season) { return season.seasonNumber === Number(seasonNumber); }) || seasons[0] || null;
  }
  function cleanupActivePlayback(instance) {
    if (!instance) return;
    cleanupInstance(instance);
    try {
      if (instance.video) {
        instance.video.pause();
        instance.video.removeAttribute('src');
        instance.video.load();
      }
    } catch (_) {}
    instance.video = null;
    instance.content = null;
  }
  function episodeLabel(episode) {
    var number = numberValue(episode && episode.episodeNumber, 0);
    return number ? phrase('episode') + ' ' + number : phrase('episode');
  }
  function makeEpisodeCard(instance, series, season, episode, selectedId) {
    var button = create('button', 'igdc-ott-episode');
    button.type = 'button';
    button.setAttribute('aria-current', text(episode && episode.contentId) === text(selectedId) ? 'true' : 'false');
    button.setAttribute('aria-label', episodeLabel(episode) + ': ' + (text(episode && episode.title) || ''));
    var poster = allowedUrl(episode && episode.posterUrl);
    if (poster) {
      var image = document.createElement('img');
      image.src = poster;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', function () { try { image.replaceWith(create('span', 'igdc-ott-episode-fallback', episodeLabel(episode))); } catch (_) {} }, { once: true });
      button.appendChild(image);
    } else {
      button.appendChild(create('span', 'igdc-ott-episode-fallback', episodeLabel(episode)));
    }
    var meta = create('span', 'igdc-ott-episode-meta');
    meta.appendChild(create('span', 'igdc-ott-episode-number', episodeLabel(episode)));
    meta.appendChild(create('span', 'igdc-ott-episode-title', text(episode && episode.title) || episodeLabel(episode)));
    button.appendChild(meta);
    button.addEventListener('click', function () { selectSeriesEpisode(instance, series, season, episode); });
    return button;
  }
  function renderSeriesShelf(instance, series, season, selectedId) {
    var section = create('section', 'igdc-ott-series-shelf');
    var heading = create('div', 'igdc-ott-series-shelf-title');
    heading.appendChild(create('span', '', (season.title || (phrase('seasons') + ' ' + season.seasonNumber)) + ' · ' + phrase('episodes')));
    var controls = create('div', 'igdc-ott-shelf-controls');
    var previous = create('button', '', '‹');
    var next = create('button', '', '›');
    previous.type = 'button'; next.type = 'button';
    previous.setAttribute('aria-label', phrase('previousEpisodes'));
    next.setAttribute('aria-label', phrase('nextEpisodes'));
    controls.appendChild(previous); controls.appendChild(next); heading.appendChild(controls);
    section.appendChild(heading);
    var row = create('div', 'igdc-ott-episodes');
    season.episodes.forEach(function (episode) { row.appendChild(makeEpisodeCard(instance, series, season, episode, selectedId)); });
    previous.addEventListener('click', function () { row.scrollBy({ left: -Math.max(260, row.clientWidth * 0.82), behavior: 'smooth' }); });
    next.addEventListener('click', function () { row.scrollBy({ left: Math.max(260, row.clientWidth * 0.82), behavior: 'smooth' }); });
    section.appendChild(row);
    return section;
  }
  function renderSeriesHeader(instance, series, activeSeason) {
    var head = create('header', 'igdc-ott-series-head');
    head.appendChild(create('div', 'igdc-ott-eyebrow', phrase('pilotTag')));
    head.appendChild(create('h2', '', text(series && series.title) || titleFor(instance.card)));
    if (text(series && series.description)) head.appendChild(create('p', '', text(series.description)));
    var tools = create('div', 'igdc-ott-series-tools');
    seriesSeasons(series).forEach(function (season) {
      var button = create('button', 'igdc-ott-series-button', season.title || (phrase('seasons') + ' ' + season.seasonNumber));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(season.seasonNumber === activeSeason.seasonNumber));
      button.addEventListener('click', function () { renderSeriesBrowser(instance, series, season.seasonNumber); });
      tools.appendChild(button);
    });
    head.appendChild(tools);
    return head;
  }
  function renderSeriesBrowser(instance, series, wantedSeason) {
    if (!instance || instance.disposed) return;
    cleanupActivePlayback(instance);
    instance.seriesId = text(series && series.contentId) || instance.seriesId || instance.rootContentId;
    instance.series = series;
    instance.contentId = instance.seriesId;
    var season = seriesSeason(series, wantedSeason || instance.activeSeasonNumber);
    if (!season) { renderCard(instance.stage, { title: phrase('unavailableTitle'), text: phrase('noEpisodes') }); return; }
    instance.activeSeasonNumber = season.seasonNumber;
    clearStage(instance.stage);
    var layout = create('section', 'igdc-ott-series');
    layout.appendChild(renderSeriesHeader(instance, series, season));
    layout.appendChild(renderSeriesShelf(instance, series, season, ''));
    instance.stage.appendChild(layout);
  }
  function renderSeriesPlayback(instance, series, content, savedState, ad) {
    if (!instance || instance.disposed) return;
    var season = seriesSeason(series, content && content.seasonNumber || instance.activeSeasonNumber);
    if (!season) { renderVideo(instance, content, savedState, ad); return; }
    instance.activeSeasonNumber = season.seasonNumber;
    clearStage(instance.stage);
    var layout = create('section', 'igdc-ott-series');
    layout.appendChild(renderSeriesHeader(instance, series, season));
    var playerTarget = create('div', 'igdc-ott-series-player');
    layout.appendChild(playerTarget);
    layout.appendChild(renderSeriesShelf(instance, series, season, content && content.contentId));
    instance.stage.appendChild(layout);
    renderVideo(instance, content, savedState, ad, playerTarget);
  }
  function accessTargetId(instance) {
    return text(instance && (instance.accessTargetId || instance.seriesId || instance.rootContentId || instance.contentId));
  }
  function fetchJson(url, init) {
    return global.fetch(url, init).then(function (response) {
      return responseJson(response).then(function (payload) { return { response: response, payload: payload || {} }; });
    });
  }
  function money(value) {
    if (!value || !text(value.currency) || !Number.isFinite(Number(value.amountMinor))) return '';
    try {
      return new Intl.NumberFormat(currentLanguage() === 'ko' ? 'ko-KR' : 'en-US', {
        style: 'currency', currency: text(value.currency), minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(Number(value.amountMinor) / 100);
    } catch (_) { return text(value.currency) + ' ' + (Number(value.amountMinor) / 100).toFixed(2); }
  }
  function accessBack(instance) {
    if (!instance || instance.disposed) return;
    if (instance.series) { renderSeriesBrowser(instance, instance.series, instance.activeSeasonNumber); return; }
    run(instance);
  }
  function renderAccessPending(instance, payload) {
    var access = payload && payload.access || {};
    renderCard(instance.stage, {
      eyebrow: phrase('accessTag'),
      title: phrase('accessPendingTitle'),
      text: text(payload && payload.message) || (access.state === 'offer_pending' ? phrase('accessNoOffers') : phrase('accessPendingText')),
      secondaryAction: { label: phrase('accessBack'), onClick: function () { accessBack(instance); } }
    });
  }
  function showAccessRequired(instance, payload) {
    var access = payload && payload.access || {};
    if (access.state === 'offer_pending' || access.state === 'storage_pending' || access.state === 'configuration_pending') {
      renderAccessPending(instance, payload || {});
      return;
    }
    renderCard(instance.stage, {
      eyebrow: phrase('accessTag'),
      title: phrase('accessTitle'),
      text: phrase('accessText'),
      action: { label: phrase('accessOpen'), onClick: function () { openAccessOptions(instance); } },
      secondaryAction: { label: phrase('accessBack'), onClick: function () { accessBack(instance); } }
    });
  }
  function newAccessButton(label, secondary) {
    var button = create('button', secondary ? 'secondary' : '', label);
    button.type = 'button';
    return button;
  }
  function renderAccessOptions(instance, payload) {
    if (!instance || instance.disposed) return;
    var access = payload && payload.access || {};
    var offers = Array.isArray(access.offers) ? access.offers : [];
    clearStage(instance.stage);
    var panel = create('section', 'igdc-ott-access');
    panel.appendChild(create('div', 'igdc-ott-eyebrow', phrase('accessTag')));
    panel.appendChild(create('h2', '', phrase('accessOffers')));
    panel.appendChild(create('p', '', phrase('accessText')));
    var products = create('div', 'igdc-ott-access-products');
    if (!offers.length) {
      products.appendChild(create('div', 'igdc-ott-card', phrase('accessNoOffers')));
    } else {
      offers.forEach(function (offer) {
        var product = create('article', 'igdc-ott-access-product');
        product.appendChild(create('h3', '', text(offer.title) || phrase('accessPlan')));
        if (text(offer.description)) product.appendChild(create('p', '', text(offer.description)));
        var price = create('div', 'igdc-ott-access-price');
        price.textContent = phrase('accessPrice') + ': ' + (money(offer.price) || '-');
        product.appendChild(price);
        product.dataset.productId = text(offer.productId);
        products.appendChild(product);
      });
    }
    panel.appendChild(products);
    var termsLabel = create('label', 'igdc-ott-access-terms');
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'igdc-media-access-terms';
    termsLabel.appendChild(checkbox);
    termsLabel.appendChild(create('span', '', phrase('accessTerms')));
    panel.appendChild(termsLabel);
    var actions = create('div', 'igdc-ott-access-actions');
    if (offers.length) {
      var prepare = newAccessButton(phrase('accessPrepareOrder'));
      prepare.addEventListener('click', function () {
        if (!checkbox.checked) { renderCard(instance.stage, { title: phrase('accessPrepareTitle'), text: phrase('accessTermsRequired'), action: { label: phrase('accessOpen'), onClick: function () { openAccessOptions(instance); } } }); return; }
        var first = offers[0];
        prepareAccessOrder(instance, first, checkbox.checked);
      });
      actions.appendChild(prepare);
    }
    var back = newAccessButton(phrase('accessBack'), true);
    back.addEventListener('click', function () { accessBack(instance); });
    actions.appendChild(back);
    panel.appendChild(actions);
    instance.stage.appendChild(panel);
  }
  function openAccessOptions(instance) {
    if (!instance || instance.disposed) return;
    renderLoading(instance.stage);
    var url = new URL(ACCESS_URL, global.location.origin);
    url.searchParams.set('contentId', accessTargetId(instance));
    fetchJson(url.toString(), {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ Accept: 'application/json' }, authorizationHeaders())
    }).then(function (result) {
      if (instance.disposed) return;
      if (result.response.ok && result.payload && result.payload.ok) { renderAccessOptions(instance, result.payload); return; }
      if (result.response.status === 401) { showLogin(instance); return; }
      renderAccessPending(instance, result.payload || {});
    }).catch(function () { if (!instance.disposed) renderCard(instance.stage, { title: phrase('accessPendingTitle'), text: phrase('accessError') }); });
  }
  function prepareAccessOrder(instance, offer, termsAccepted) {
    if (!instance || instance.disposed || !offer) return;
    renderLoading(instance.stage);
    var orderContentId = text(instance.seriesId || instance.rootContentId || instance.contentId);
    var key = 'ui_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    fetchJson(ACCESS_ORDER_URL, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': key }, authorizationHeaders()),
      body: JSON.stringify({ contentId: orderContentId, productId: text(offer.productId), currency: offer.price && offer.price.currency || '', termsAccepted: termsAccepted === true, idempotencyKey: key })
    }).then(function (result) {
      if (instance.disposed) return;
      if (result.response.status === 401) { showLogin(instance); return; }
      if (result.response.status === 202 && result.payload && result.payload.ok) {
        renderCard(instance.stage, { eyebrow: phrase('accessPaymentPending'), title: phrase('accessOrderReadyTitle'), text: phrase('accessOrderReadyText'), secondaryAction: { label: phrase('accessBack'), onClick: function () { accessBack(instance); } } });
        return;
      }
      renderCard(instance.stage, { title: phrase('accessPrepareTitle'), text: text(result.payload && result.payload.message) || phrase('accessPendingText'), secondaryAction: { label: phrase('accessBack'), onClick: function () { accessBack(instance); } } });
    }).catch(function () { if (!instance.disposed) renderCard(instance.stage, { title: phrase('accessPrepareTitle'), text: phrase('accessError') }); });
  }

  function selectSeriesEpisode(instance, series, season, episode) {
    if (!instance || instance.disposed || !text(episode && episode.contentId)) return;
    cleanupActivePlayback(instance);
    instance.seriesId = text(series && series.contentId) || instance.seriesId || instance.rootContentId;
    instance.accessTargetId = text(episode && episode.contentId) || instance.seriesId;
    instance.activeSeasonNumber = season.seasonNumber;
    renderLoading(instance.stage);
    loadPlayback(instance, instance.seriesId, text(episode.contentId)).then(function (result) {
      if (instance.disposed) return;
      var response = result.response;
      var payload = result.payload || {};
      if (response.ok && payload.ok && payload.mode === 'episode' && payload.content) {
        instance.viewerKey = text(payload.viewer && payload.viewer.key) || instance.viewerKey;
        instance.contentId = text(payload.content.contentId);
        instance.series = payload.series || series;
        attachVideo(instance, payload.content, instance.series);
        return;
      }
      if (response.status === 402 && payload.error === 'media_access_required') { showAccessRequired(instance, payload); return; }
      if (response.status === 503 && (payload.error === 'media_access_not_configured' || payload.error === 'media_access_offer_unavailable')) { renderAccessPending(instance, payload); return; }
      if (response.status === 409 || response.status === 404) {
        renderSeriesBrowser(instance, series, season.seasonNumber);
        return;
      }
      renderCard(instance.stage, { title: phrase('unavailableTitle'), text: text(payload.message) || phrase('episodeUnavailable') });
    }).catch(function () {
      if (instance.disposed) return;
      renderCard(instance.stage, { title: phrase('unavailableTitle'), text: phrase('unavailableText') });
    });
  }

  function localScope(instance) {
    return text(instance && instance.viewerKey) || 'browser';
  }
  function localStateKey(instance) {
    return LOCAL_STATE_PREFIX + ':' + localScope(instance);
  }
  function cleanStoredState(value, expectedId) {
    if (!value || typeof value !== 'object') return null;
    var id = text(value.contentId);
    var updated = Number(value.updatedAtMs || Date.parse(value.updatedAt || '') || 0);
    if (!id || (expectedId && id !== expectedId) || !updated || Date.now() - updated > LOCAL_STATE_TTL_MS) return null;
    return {
      contentId: id,
      title: text(value.title).slice(0, 300),
      positionSec: finite(value.positionSec),
      durationSec: finite(value.durationSec),
      completed: Boolean(value.completed),
      captionLanguage: validLanguage(value.captionLanguage),
      updatedAt: new Date(updated).toISOString(),
      updatedAtMs: updated
    };
  }
  function readLocalStore(instance) {
    try {
      var raw = global.localStorage.getItem(localStateKey(instance)) || '';
      var parsed = raw ? JSON.parse(raw) : null;
      var records = parsed && parsed.records && typeof parsed.records === 'object' ? parsed.records : {};
      var cleaned = {};
      Object.keys(records).forEach(function (key) {
        var state = cleanStoredState(records[key], key);
        if (state) cleaned[key] = state;
      });
      return cleaned;
    } catch (_) {
      return {};
    }
  }
  function writeLocalStore(instance, records) {
    try {
      var rows = Object.keys(records || {}).map(function (key) { return records[key]; }).filter(Boolean);
      rows.sort(function (a, b) { return Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0); });
      var limited = {};
      rows.slice(0, MAX_LOCAL_RECORDS).forEach(function (state) { limited[state.contentId] = state; });
      global.localStorage.setItem(localStateKey(instance), JSON.stringify({ version: 1, updatedAt: Date.now(), records: limited }));
    } catch (_) {}
  }
  function readLocalState(instance) {
    return cleanStoredState(readLocalStore(instance)[instance.contentId], instance.contentId);
  }
  function saveLocalState(instance, state) {
    if (!instance || !state || !state.contentId) return;
    var records = readLocalStore(instance);
    var now = Date.now();
    records[state.contentId] = {
      contentId: state.contentId,
      title: text(state.title).slice(0, 300),
      positionSec: finite(state.positionSec),
      durationSec: finite(state.durationSec),
      completed: Boolean(state.completed),
      captionLanguage: validLanguage(state.captionLanguage),
      updatedAt: new Date(now).toISOString(),
      updatedAtMs: now
    };
    writeLocalStore(instance, records);
  }
  function updatedAtMs(state) {
    if (!state) return 0;
    return Number(state.updatedAtMs || Date.parse(state.updatedAt || '') || 0);
  }
  function latestState(first, second) {
    if (!first) return second || null;
    if (!second) return first;
    return updatedAtMs(second) > updatedAtMs(first) ? second : first;
  }
  function endpoint(url, contentId, extra) {
    var value = new URL(url, global.location.origin);
    value.searchParams.set('id', contentId);
    Object.keys(extra || {}).forEach(function (key) { value.searchParams.set(key, extra[key]); });
    return value.toString();
  }
  function responseJson(response) {
    return response.json().catch(function () { return {}; });
  }
  function loadRemoteState(instance) {
    return global.fetch(endpoint(VIEWING_STATE_URL, instance.contentId), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ Accept: 'application/json' }, authorizationHeaders())
    }).then(function (response) {
      return responseJson(response).then(function (payload) {
        return response.ok && payload && payload.ok && payload.state ? cleanStoredState(payload.state, instance.contentId) : null;
      });
    }).catch(function () { return null; });
  }
  function saveRemoteState(instance, state) {
    if (!instance || !state || instance.disposed) return Promise.resolve(null);
    return global.fetch(VIEWING_STATE_URL, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, authorizationHeaders()),
      body: JSON.stringify({
        contentId: state.contentId,
        title: state.title,
        page: global.location.pathname,
        positionSec: state.positionSec,
        durationSec: state.durationSec,
        completed: state.completed,
        captionLanguage: state.captionLanguage
      })
    }).then(function (response) {
      return responseJson(response).then(function (payload) {
        return response.ok && payload && payload.ok && payload.state ? cleanStoredState(payload.state, state.contentId) : null;
      });
    }).catch(function () { return null; });
  }
  function loadViewingState(instance) {
    var local = readLocalState(instance);
    return loadRemoteState(instance).then(function (remote) {
      return latestState(local, remote);
    }).catch(function () { return local; });
  }
  function loadAdDecision(instance) {
    return global.fetch(endpoint(AD_DECISION_URL, instance.contentId), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ Accept: 'application/json' }, authorizationHeaders())
    }).then(function (response) {
      return responseJson(response).then(function (payload) {
        return response.ok && payload && payload.ok && payload.decision === 'preroll' && payload.ad ? payload.ad : null;
      });
    }).catch(function () { return null; });
  }
  function formatTime(seconds) {
    var value = Math.max(0, Math.floor(finite(seconds)));
    var hours = Math.floor(value / 3600);
    var minutes = Math.floor((value % 3600) / 60);
    var rest = value % 60;
    return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0') : minutes + ':' + String(rest).padStart(2, '0');
  }

  function appendCaptionControl(instance, shell, video, captions, savedState) {
    if (!captions.length) return;
    var tools = create('div', 'igdc-ott-tools');
    var label = create('label', 'igdc-ott-caption-label');
    label.appendChild(create('span', '', phrase('captions')));
    var select = document.createElement('select');
    select.className = 'igdc-ott-caption-select';
    select.setAttribute('aria-label', phrase('captions'));
    var off = document.createElement('option');
    off.value = 'off';
    off.textContent = phrase('captionsOff');
    select.appendChild(off);
    captions.forEach(function (caption) {
      var option = document.createElement('option');
      option.value = caption.value;
      option.textContent = caption.label;
      select.appendChild(option);
      var track = document.createElement('track');
      track.kind = caption.kind;
      track.label = caption.label;
      track.srclang = caption.language;
      track.src = caption.src;
      if (caption.isDefault) track.default = true;
      video.appendChild(track);
    });
    label.appendChild(select);
    tools.appendChild(label);
    shell.appendChild(tools);
    function apply(value, remember) {
      var selected = null;
      captions.forEach(function (caption, index) {
        var track = video.textTracks && video.textTracks[index];
        var active = String(caption.value) === String(value);
        if (track) {
          try { track.mode = active ? 'showing' : 'disabled'; } catch (_) {}
        }
        if (active) selected = caption;
      });
      instance.captionLanguage = selected ? selected.language : '';
      if (remember && instance.flushProgress) instance.flushProgress(true);
    }
    var desired = validLanguage(savedState && savedState.captionLanguage);
    var selectedCaption = captions.find(function (caption) { return caption.language === desired; }) ||
      captions.find(function (caption) { return caption.isDefault; }) || null;
    select.value = selectedCaption ? selectedCaption.value : 'off';
    global.setTimeout(function () { apply(select.value, false); }, 0);
    select.addEventListener('change', function () { apply(select.value, true); });
  }
  function stateFromVideo(instance, video, content, completed) {
    return {
      contentId: instance.contentId,
      title: text(content && content.title) || titleFor(instance.card),
      positionSec: finite(video && video.currentTime),
      durationSec: finite(video && video.duration),
      completed: Boolean(completed),
      captionLanguage: validLanguage(instance.captionLanguage)
    };
  }
  function attachProgressTracking(instance, video, content) {
    var lastLocal = 0;
    var lastRemote = 0;
    function capture(force, completed) {
      if (instance.disposed || !video) return;
      var state = stateFromVideo(instance, video, content, completed);
      var now = Date.now();
      if (force || now - lastLocal >= LOCAL_SAVE_INTERVAL_MS) {
        saveLocalState(instance, state);
        lastLocal = now;
      }
      if (force || now - lastRemote >= REMOTE_SAVE_INTERVAL_MS) {
        lastRemote = now;
        saveRemoteState(instance, state).then(function (saved) {
          if (saved) saveLocalState(instance, latestState(readLocalState(instance), saved));
        });
      }
    }
    instance.flushProgress = capture;
    var onTime = function () { capture(false, false); };
    var onPause = function () { capture(true, false); };
    var onEnded = function () { capture(true, true); };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    var onPageHide = function () { capture(true, Boolean(video.ended)); };
    global.addEventListener('pagehide', onPageHide);
    instance.cleanup.push(function () {
      try { capture(true, Boolean(video.ended)); } catch (_) {}
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      global.removeEventListener('pagehide', onPageHide);
    });
  }
  function playVideo(video, position) {
    try {
      if (position > 0) video.currentTime = position;
    } catch (_) {}
    var result = video.play();
    if (result && typeof result.catch === 'function') result.catch(function () {});
  }
  function showResume(instance, shell, video, savedState) {
    var duration = finite(video.duration);
    var position = finite(savedState && savedState.positionSec);
    var usable = position > 7 && !Boolean(savedState && savedState.completed) && (!duration || position < Math.max(8, duration - 7));
    if (!usable) {
      playVideo(video, 0);
      return;
    }
    var overlay = create('section', 'igdc-ott-resume');
    var card = create('div', 'igdc-ott-resume-card');
    card.appendChild(create('h2', '', phrase('resumeTitle')));
    card.appendChild(create('p', '', phrase('resumeText') + ' · ' + formatTime(position)));
    var actions = create('div', 'igdc-ott-resume-actions');
    var resume = create('button', '', phrase('resume'));
    var restart = create('button', '', phrase('startOver'));
    resume.type = 'button';
    restart.type = 'button';
    function finish(at) {
      overlay.remove();
      playVideo(video, at);
    }
    resume.addEventListener('click', function () { finish(position); });
    restart.addEventListener('click', function () {
      saveLocalState(instance, Object.assign({}, savedState, { positionSec: 0, completed: false }));
      finish(0);
    });
    actions.appendChild(resume);
    actions.appendChild(restart);
    card.appendChild(actions);
    overlay.appendChild(card);
    shell.appendChild(overlay);
  }
  function showAd(instance, shell, ad, done) {
    if (!ad || !['video', 'image'].includes(text(ad.type).toLowerCase()) || !allowedUrl(ad.src)) {
      done();
      return;
    }
    var overlay = create('section', 'igdc-ott-ad');
    var card = create('div', 'igdc-ott-ad-card');
    card.appendChild(create('h2', '', text(ad.label) || phrase('advertisement')));
    card.appendChild(create('p', '', phrase('adNotice')));
    var source = allowedUrl(ad.src);
    var media;
    if (text(ad.type).toLowerCase() === 'video') {
      media = document.createElement('video');
      media.muted = true;
      media.autoplay = true;
      media.playsInline = true;
      media.preload = 'auto';
      media.src = source;
    } else {
      media = document.createElement('img');
      media.src = source;
      media.alt = '';
    }
    media.className = 'igdc-ott-ad-media';
    card.appendChild(media);
    if (allowedUrl(ad.clickUrl)) {
      var link = document.createElement('a');
      link.href = allowedUrl(ad.clickUrl);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'igdc-ott-action';
      link.textContent = text(ad.label) || phrase('advertisement');
      card.appendChild(link);
    }
    overlay.appendChild(card);
    shell.appendChild(overlay);
    var finished = false;
    var timer = 0;
    function finish() {
      if (finished) return;
      finished = true;
      if (timer) global.clearTimeout(timer);
      try { overlay.remove(); } catch (_) {}
      done();
    }
    var duration = Math.max(1, Math.min(finite(ad.durationSec, 60) || 0, 60));
    timer = global.setTimeout(finish, duration * 1000);
    if (media.tagName === 'VIDEO') {
      media.addEventListener('ended', finish, { once: true });
      media.addEventListener('error', finish, { once: true });
      var start = media.play();
      if (start && typeof start.catch === 'function') start.catch(finish);
    } else {
      media.addEventListener('error', finish, { once: true });
    }
    var skipAfter = Math.max(0, Math.min(finite(ad.skipAfterSec, duration), duration));
    if (skipAfter < duration) {
      global.setTimeout(function () {
        if (finished || instance.disposed) return;
        var skip = create('button', 'igdc-ott-ad-skip', phrase('skipAd'));
        skip.type = 'button';
        skip.addEventListener('click', finish);
        card.appendChild(skip);
      }, skipAfter * 1000);
    }
    instance.cleanup.push(finish);
  }
  function browserSupportsNativeHls(video) {
    try { return Boolean(video && video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')); } catch (_) { return false; }
  }
  function renderVideo(instance, content, savedState, ad, target) {
    if (!instance || instance.disposed) return;
    var streamUrl = allowedUrl(content && content.stream && content.stream.url);
    var mount = target || instance.stage;
    if (!streamUrl) {
      renderCard(mount, { title: phrase('preparingTitle'), text: phrase('preparingText') });
      return;
    }
    clearStage(mount);
    var shell = create('div', 'igdc-ott-video-shell');
    var video = document.createElement('video');
    if (String(content && content.stream && content.stream.format || '').toLowerCase() === 'hls' && !browserSupportsNativeHls(video)) {
      renderCard(mount, { title: phrase('unavailableTitle'), text: phrase('hlsUnavailable') });
      return;
    }
    video.className = 'igdc-ott-video';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = streamUrl;
    if (content.posterUrl) video.poster = allowedUrl(content.posterUrl);
    video.setAttribute('aria-label', text(content.title) || titleFor(instance.card));
    shell.appendChild(video);
    mount.appendChild(shell);
    instance.video = video;
    instance.content = content;
    instance.cleanup = instance.cleanup || [];
    var captions = cleanCaptions(content && content.captions);
    appendCaptionControl(instance, shell, video, captions, savedState);
    video.addEventListener('error', function () {
      if (instance.disposed) return;
      renderCard(mount, { title: phrase('unavailableTitle'), text: phrase('mediaError') });
    }, { once: true });
    video.addEventListener('loadedmetadata', function () {
      if (instance.disposed) return;
      attachProgressTracking(instance, video, content);
      function startProgram() { showResume(instance, shell, video, savedState); }
      if (ad) showAd(instance, shell, ad, startProgram);
      else startProgram();
    }, { once: true });
  }
  function attachVideo(instance, content, series) {
    if (!instance || instance.disposed) return;
    renderLoading(instance.stage);
    Promise.all([loadViewingState(instance), loadAdDecision(instance)]).then(function (result) {
      if (instance.disposed) return;
      if (series) renderSeriesPlayback(instance, series, content, result[0], result[1]);
      else renderVideo(instance, content, result[0], result[1]);
    }).catch(function () {
      if (instance.disposed) return;
      if (series) renderSeriesPlayback(instance, series, content, readLocalState(instance), null);
      else renderVideo(instance, content, readLocalState(instance), null);
    });
  }

  function loadPlayback(instance, rootId, episodeId) {
    var endpointUrl = new URL(PLAYBACK_URL, global.location.origin);
    endpointUrl.searchParams.set('id', text(rootId) || instance.seriesId || instance.rootContentId || instance.contentId);
    if (text(episodeId)) endpointUrl.searchParams.set('episode', text(episodeId));
    return global.fetch(endpointUrl.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ Accept: 'application/json' }, authorizationHeaders())
    }).then(function (response) {
      return responseJson(response).then(function (payload) { return { response: response, payload: payload || {} }; });
    });
  }
  function cleanupInstance(instance) {
    if (!instance) return;
    (instance.cleanup || []).splice(0).forEach(function (fn) {
      try { fn(); } catch (_) {}
    });
    instance.flushProgress = null;
  }
  function fallbackLegacy(instance) {
    if (!instance || instance.disposed) return;
    cleanupInstance(instance);
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
      if (response.ok && payload.ok && payload.mode === 'series' && payload.series) {
        instance.viewerKey = text(payload.viewer && payload.viewer.key);
        instance.seriesId = text(payload.series.contentId) || instance.rootContentId;
        instance.series = payload.series;
        renderSeriesBrowser(instance, payload.series);
        return;
      }
      if (response.ok && payload.ok && payload.content) {
        instance.viewerKey = text(payload.viewer && payload.viewer.key);
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
      if (response.status === 402 && payload.error === 'media_access_required') {
        showAccessRequired(instance, payload);
        return;
      }
      if (response.status === 503 && (payload.error === 'media_access_not_configured' || payload.error === 'media_access_offer_unavailable')) {
        renderAccessPending(instance, payload);
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
      rootContentId: contentId,
      accessTargetId: contentId,
      seriesId: '',
      series: null,
      activeSeasonNumber: 0,
      legacyMount: options.legacyMount,
      disposed: false,
      video: null,
      content: null,
      viewerKey: '',
      captionLanguage: '',
      cleanup: [],
      flushProgress: null
    };
    instances.set(stage, instance);
    renderLoading(stage);
    run(instance);
    return true;
  }
  function dispose(stage) {
    var instance = stage && instances.get(stage);
    if (!instance) return;
    try {
      if (instance.flushProgress) instance.flushProgress(true, Boolean(instance.video && instance.video.ended));
    } catch (_) {}
    instance.disposed = true;
    cleanupInstance(instance);
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

  global.IGDCMediaHubOTTInline = { mount: mount, dispose: dispose, VERSION: '1.3.0-inline-stage2-10-access-ready' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resumeAfterLogin, { once: true });
  else resumeAfterLogin();
})(window, document);
