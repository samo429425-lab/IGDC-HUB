/*
 * IGDC Social Network main-card viewer bridge v2.4.0
 * Scope: social main 9 sections ONLY.
 * Non-goals: right panel, distribution, snapshot storage, candidate/admin, automap ownership.
 *
 * UX contract
 * 1) Main SNS card click -> IGDC in-page full-viewport player (browser chrome remains).
 * 2) Fullscreen button -> native browser fullscreen for the media stage.
 * 3) ESC from native fullscreen -> returns to the in-page full-viewport player.
 * 4) ESC again / top-left list button / browser Back -> returns to the 9-section list.
 * 5) Initial card click never navigates to youtube.com / instagram.com / etc.
 */
(function () {
  'use strict';

  if (window.__IGDC_SOCIAL_SNS_VIEWER_V2__) return;
  window.__IGDC_SOCIAL_SNS_VIEWER_V2__ = true;

  /* Disable the legacy inline social-main fullscreen handler in socialnetwork.html. */
  window.__SOCIAL_MAIN_FULLSCREEN_READY__ = true;

  var MAIN_KEYS = {
    'social-youtube': 'youtube',
    'social-instagram': 'instagram',
    'social-tiktok': 'tiktok',
    'social-facebook': 'facebook',
    'social-wechat': 'wechat',
    'social-weibo': 'weibo',
    'social-pinterest': 'pinterest',
    'social-reddit': 'reddit',
    'social-twitter': 'twitter'
  };

  var state = {
    open: false,
    pushed: false,
    previousFocus: null,
    closingFromHistory: false,
    lastUrl: '',
    platform: ''
  };

  function text(v) { return v == null ? '' : String(v); }
  function q(sel, root) { return (root || document).querySelector(sel); }

  function decodeEntities(value) {
    var raw = text(value);
    if (!raw || raw.indexOf('&') < 0) return raw;
    var box = document.createElement('textarea');
    var current = raw;
    /* Search providers sometimes double-encode numeric entities. Decode a
       bounded number of rounds so `&amp;#xacbd;` also becomes the real text. */
    for (var i = 0; i < 3 && current.indexOf('&') >= 0; i++) {
      box.innerHTML = current;
      var next = text(box.value).trim();
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }

  function language() {
    var raw = text(document.documentElement.lang || navigator.language || 'en')
      .toLowerCase().replace(/_/g, '-');
    if (raw === 'ko-kr') return 'ko';
    if (raw === 'zh-cn' || raw === 'zh-hans') return 'zh';
    if (raw === 'zh-tw' || raw === 'zh-hk' || raw === 'zh-hant') return 'zht';
    if (raw === 'fil') return 'tl';
    return raw.split('-')[0] || 'en';
  }

  var LABELS = {
    ko: { list: '목록으로', fullscreen: '전체 화면', exitFullscreen: '전체 화면 종료', loading: '콘텐츠를 불러오는 중입니다.', unavailable: '이 콘텐츠는 현재 내부 재생을 준비할 수 없습니다.' },
    en: { list: 'Back to list', fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', loading: 'Loading content…', unavailable: 'This content cannot currently be prepared for in-site playback.' },
    ja: { list: '一覧へ', fullscreen: '全画面', exitFullscreen: '全画面を終了', loading: 'コンテンツを読み込み中です。', unavailable: 'このコンテンツは現在サイト内再生を準備できません。' },
    zh: { list: '返回列表', fullscreen: '全屏', exitFullscreen: '退出全屏', loading: '正在加载内容。', unavailable: '此内容目前无法在站内准备播放。' },
    zht:{ list: '返回列表', fullscreen: '全螢幕', exitFullscreen: '退出全螢幕', loading: '正在載入內容。', unavailable: '此內容目前無法在站內準備播放。' }
  };
  function labels() { return LABELS[language()] || LABELS.en; }

  function validHttp(url) {
    return /^https?:\/\//i.test(text(url).trim());
  }

  function placeholderUrl(url) {
    url = text(url).trim();
    return !url || url === '#' || /^javascript:/i.test(url) ||
      /\/pages\/coming-soon\.html/i.test(url) ||
      /(?:^|\.)example\.com(?:[\/:?#]|$)/i.test(url) ||
      /social[_-](?:youtube|instagram|tiktok|facebook|wechat|weibo|pinterest|reddit|twitter)[_-]?\d+/i.test(url) ||
      /tiktok\.com\/@seed\/video\//i.test(url) ||
      /reddit\.com\/r\/seed\/comments\//i.test(url);
  }

  function placeholderCard(card) {
    if (!card) return true;
    var title = decodeEntities(titleOf(card));
    if (/\bSAMPLE\s*\d+\b/i.test(title) || /^Loading(?:…|\.\.\.)?$/i.test(title)) return true;
    return false;
  }

  function sectionPlatform(card) {
    var grid = card && card.closest && card.closest('.thumb-grid[data-psom-key]');
    var key = grid ? text(grid.getAttribute('data-psom-key')).trim() : '';
    return MAIN_KEYS[key] || '';
  }

  function isMainSocialCard(card) {
    var grid = card && card.closest && card.closest('.thumb-grid[data-psom-key]');
    if (!grid) return false;
    var key = text(grid.getAttribute('data-psom-key')).trim();
    return Object.prototype.hasOwnProperty.call(MAIN_KEYS, key);
  }

  function getBgUrl(el) {
    if (!el) return '';
    var bg = text(getComputedStyle(el).backgroundImage);
    var m = bg.match(/url\(["']?(.*?)["']?\)/i);
    return m && m[1] ? m[1] : '';
  }

  function firstUrl(card) {
    if (!card || placeholderCard(card)) return '';
    var d = card.dataset || {};
    var values = [
      d.socialUrl,
      d.latestContentUrl,
      d.contentUrl,
      d.canonicalUrl,
      d.permalink,
      d.embedUrl,
      d.href,
      d.url,
      card.getAttribute('data-social-url'),
      card.getAttribute('data-latest-content-url'),
      card.getAttribute('data-content-url'),
      card.getAttribute('data-canonical-url'),
      card.getAttribute('data-permalink'),
      card.getAttribute('href')
    ];
    for (var i = 0; i < values.length; i++) {
      var value = text(values[i]).trim();
      if (validHttp(value) && !placeholderUrl(value)) return value;
    }
    return '';
  }

  function titleOf(card) {
    var el = q('.title', card);
    return decodeEntities(text(el && el.textContent).trim());
  }

  function descOf(card) {
    var el = q('.desc', card);
    return decodeEntities(text(el && el.textContent).trim());
  }

  function videoIdYouTube(url) {
    try {
      var u = new URL(url, location.href);
      var h = u.hostname.replace(/^www\./, '').toLowerCase();
      if (h === 'youtu.be') return (u.pathname.split('/')[1] || '').trim();
      if (/youtube(?:-nocookie)?\.com$/.test(h)) {
        if (u.pathname === '/watch') return text(u.searchParams.get('v')).trim();
        var m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
        if (m) return m[1];
      }
    } catch (_) {}
    return '';
  }

  function videoIdYouTubeFromThumb(card) {
    var d = card && card.dataset || {};
    var pic = q('.pic', card);
    var img = q('img', card);
    var candidates = [d.thumbnailUrl, d.thumb, d.image, img && img.src, getBgUrl(pic)];
    for (var i = 0; i < candidates.length; i++) {
      var src = text(candidates[i]);
      var m = src.match(/(?:i\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([^/]+)/i);
      if (m) return m[1];
    }
    return '';
  }

  function statusId(url) {
    var m = text(url).match(/\/status(?:es)?\/(\d+)/i);
    return m ? m[1] : '';
  }

  function tiktokVideoId(url) {
    var m = text(url).match(/\/video\/(\d+)/i);
    return m ? m[1] : '';
  }

  function pinterestPinId(url) {
    var m = text(url).match(/\/pin\/(\d+)/i);
    return m ? m[1] : '';
  }

  function normalizeRedditPath(url) {
    try {
      var u = new URL(url, location.href);
      return u.pathname + (u.search || '');
    } catch (_) { return ''; }
  }

  function instagramEmbed(url) {
    try {
      var u = new URL(url, location.href);
      var m = u.pathname.match(/^\/(p|reel|reels|tv)\/([^/?#]+)/i);
      if (!m) return '';
      var kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
      return 'https://www.instagram.com/' + kind + '/' + m[2] + '/embed/';
    } catch (_) { return ''; }
  }

  function facebookIsVideo(url) {
    return /\/(?:reel|watch|videos?)\//i.test(url) || /[?&]v=\d+/i.test(url) || /fb\.watch/i.test(url);
  }

  function facebookEmbed(url) {
    if (!validHttp(url)) return '';
    var encoded = encodeURIComponent(url);
    if (facebookIsVideo(url)) {
      return 'https://www.facebook.com/plugins/video.php?href=' + encoded + '&show_text=false&autoplay=true&width=1280';
    }
    /* Facebook post plugin has a provider-side natural width limit.
       Keep its native 750px document, then scale the whole frame inside IGDC. */
    return 'https://www.facebook.com/plugins/post.php?href=' + encoded + '&show_text=true&width=750';
  }

  function buildEmbed(platform, url, card) {
    platform = text(platform).toLowerCase();
    url = text(url).trim();

    if (platform === 'youtube') {
      var yid = videoIdYouTube(url) || videoIdYouTubeFromThumb(card);
      if (!yid) return null;
      return {
        mode: 'iframe',
        src: 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(yid) + '?autoplay=1&playsinline=1&rel=0&enablejsapi=1',
        aspect: '16/9'
      };
    }

    if (platform === 'instagram') {
      var ig = instagramEmbed(url);
      if (!ig) return null;
      return { mode: 'iframe', src: ig, aspect: '9/16' };
    }

    if (platform === 'tiktok') {
      var tid = tiktokVideoId(url);
      if (!tid) return null;
      return {
        mode: 'iframe',
        src: 'https://www.tiktok.com/player/v1/' + encodeURIComponent(tid) + '?autoplay=1&loop=0&controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1',
        aspect: '9/16'
      };
    }

    if (platform === 'facebook') {
      var fb = facebookEmbed(url);
      if (!fb) return null;
      return {
        mode: 'iframe',
        src: fb,
        aspect: facebookIsVideo(url) ? '16/9' : 'auto',
        provider: facebookIsVideo(url) ? 'facebook-video' : 'facebook-post'
      };
    }

    if (platform === 'twitter') {
      var xid = statusId(url);
      if (!xid) return null;
      return {
        mode: 'iframe',
        src: 'https://platform.twitter.com/embed/Tweet.html?dnt=true&id=' + encodeURIComponent(xid),
        aspect: 'auto'
      };
    }

    if (platform === 'pinterest') {
      var pid = pinterestPinId(url);
      if (!pid) return null;
      return {
        mode: 'iframe',
        src: 'https://assets.pinterest.com/ext/embed.html?id=' + encodeURIComponent(pid),
        aspect: 'auto'
      };
    }

    if (platform === 'reddit') {
      var path = normalizeRedditPath(url);
      if (!path || path.indexOf('/comments/') < 0) return null;
      return {
        mode: 'iframe',
        src: 'https://www.redditmedia.com' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'ref_source=embed&ref=share&embed=true',
        aspect: 'auto'
      };
    }

    /* WeChat / Weibo do not expose a stable public player endpoint.
       Keep them inside IGDC and attempt the original public page in a contained frame.
       No top-navigation/popups are granted to the frame. */
    if ((platform === 'wechat' || platform === 'weibo') && validHttp(url)) {
      return { mode: 'iframe', src: url, aspect: 'auto', restrictedProvider: true };
    }

    return null;
  }

  function injectStyle() {
    if (document.getElementById('igdcSocialViewerV2Style')) return;
    var s = document.createElement('style');
    s.id = 'igdcSocialViewerV2Style';
    var mainScopes = Object.keys(MAIN_KEYS).map(function (key) {
      return '.thumb-grid[data-psom-key="' + key + '"]';
    });
    var mainPic = mainScopes.map(function (scope) { return scope + ' a.card .pic'; }).join(',');
    var mainPicMedia = mainScopes.map(function (scope) { return scope + ' a.card .pic img,' + scope + ' a.card .pic video'; }).join(',');
    var mainMeta = mainScopes.map(function (scope) { return scope + ' a.card .meta'; }).join(',');
    var mainTitle = mainScopes.map(function (scope) { return scope + ' a.card .title'; }).join(',');
    s.textContent = '' +
      mainPic + '{width:100%!important;height:auto!important;aspect-ratio:16/9!important;min-height:0!important;overflow:hidden!important;background-position:center!important;background-size:cover!important;background-repeat:no-repeat!important}' +
      mainPicMedia + '{width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important}' +
      mainMeta + '{display:flex!important;flex-direction:column!important;min-height:92px!important;box-sizing:border-box!important}' +
      mainTitle + '{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:3!important;overflow:hidden!important;white-space:normal!important;text-overflow:ellipsis!important;line-height:1.35!important;max-height:4.05em!important;word-break:break-word!important}' +
      '#igdcSocialViewerV2{position:fixed;inset:0;z-index:2147483640;display:none;background:#000;color:#fff;overscroll-behavior:none}' +
      '#igdcSocialViewerV2.open{display:flex;flex-direction:column}' +
      '#igdcSocialViewerV2 .igsv-toolbar{height:56px;flex:0 0 56px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#090a0c;border-bottom:1px solid rgba(255,255,255,.14);box-sizing:border-box}' +
      '#igdcSocialViewerV2 .igsv-back,#igdcSocialViewerV2 .igsv-full{border:0;border-radius:9px;min-height:40px;padding:0 13px;background:#17191d;color:#fff;font:600 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;white-space:nowrap}' +
      '#igdcSocialViewerV2 .igsv-back{display:inline-flex;align-items:center;gap:7px}' +
      '#igdcSocialViewerV2 .igsv-title{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-stage{position:relative;min-height:0;flex:1 1 auto;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden}' +
      '#igdcSocialViewerV2 .igsv-frame{width:100%;height:100%;border:0;background:#000;display:block}' +
      '#igdcSocialViewerV2 .igsv-stage[data-provider="facebook-post"]{align-items:center;justify-content:center;overflow:hidden}' +
      '#igdcSocialViewerV2 .igsv-stage[data-provider="facebook-post"] .igsv-frame{position:absolute;left:50%;top:50%;width:750px;max-width:none;transform-origin:center center;background:#fff}' +
      '#igdcSocialViewerV2 .igsv-stage[data-aspect="9/16"] .igsv-frame{width:min(100%,calc(100dvh * 9 / 16));max-width:720px}' +
      '#igdcSocialViewerV2 .igsv-stage[data-aspect="16/9"] .igsv-frame{width:100%;height:100%}' +
      '#igdcSocialViewerV2 .igsv-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:500 15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#ddd;background:#000}' +
      '#igdcSocialViewerV2 .igsv-status[hidden]{display:none}' +
      '#igdcSocialViewerV2 .igsv-stage:fullscreen{width:100vw;height:100vh;background:#000}' +
      '#igdcSocialViewerV2 .igsv-stage:fullscreen .igsv-frame{width:100%;height:100%;max-width:none}' +
      '@media(max-width:768px){#igdcSocialViewerV2 .igsv-toolbar{height:52px;flex-basis:52px;padding:0 8px;gap:7px}#igdcSocialViewerV2 .igsv-back,#igdcSocialViewerV2 .igsv-full{min-height:38px;padding:0 10px;font-size:13px}}';
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureViewer() {
    var root = document.getElementById('igdcSocialViewerV2');
    if (root) return root;
    injectStyle();
    var l = labels();
    root = document.createElement('div');
    root.id = 'igdcSocialViewerV2';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '' +
      '<div class="igsv-toolbar">' +
        '<button type="button" class="igsv-back" aria-label="' + l.list + '"><span aria-hidden="true">←</span><span class="igsv-back-label">' + l.list + '</span></button>' +
        '<div class="igsv-title"></div>' +
        '<button type="button" class="igsv-full" aria-label="' + l.fullscreen + '">⛶ <span class="igsv-full-label">' + l.fullscreen + '</span></button>' +
      '</div>' +
      '<div class="igsv-stage" data-aspect="auto">' +
        '<div class="igsv-status"></div>' +
      '</div>';
    document.body.appendChild(root);

    q('.igsv-back', root).addEventListener('click', returnToList);
    q('.igsv-full', root).addEventListener('click', toggleFullscreen);
    return root;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyle, { once: true });
  } else {
    injectStyle();
  }

  function updateLabels(root) {
    var l = labels();
    var back = q('.igsv-back-label', root);
    var full = q('.igsv-full-label', root);
    if (back) back.textContent = l.list;
    var stage = q('.igsv-stage', root);
    var isFull = !!(document.fullscreenElement && stage && document.fullscreenElement === stage);
    if (full) full.textContent = isFull ? l.exitFullscreen : l.fullscreen;
    var b = q('.igsv-back', root);
    var f = q('.igsv-full', root);
    if (b) b.setAttribute('aria-label', l.list);
    if (f) f.setAttribute('aria-label', isFull ? l.exitFullscreen : l.fullscreen);
  }

  function showStatus(message) {
    var root = ensureViewer();
    var status = q('.igsv-status', root);
    if (!status) return;
    status.textContent = message || '';
    status.hidden = !message;
  }

  function clearStage(stage) {
    if (!stage) return;
    var frame = q('.igsv-frame', stage);
    if (frame) frame.remove();
    stage.setAttribute('data-aspect', 'auto');
    stage.removeAttribute('data-provider');
  }

  function sizeProviderFrame(stage, iframe, embed) {
    if (!stage || !iframe || !embed || embed.provider !== 'facebook-post') return;
    var naturalWidth = 750;
    var rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var scale = Math.max(0.45, Math.min(2.4, rect.width / naturalWidth));
    iframe.style.width = naturalWidth + 'px';
    iframe.style.height = Math.max(420, Math.ceil(rect.height / scale)) + 'px';
    iframe.style.left = '50%';
    iframe.style.top = '50%';
    iframe.style.transform = 'translate(-50%,-50%) scale(' + scale.toFixed(4) + ')';
  }

  function mountEmbed(root, embed, title) {
    var stage = q('.igsv-stage', root);
    clearStage(stage);
    if (!embed || !embed.src) {
      showStatus(labels().unavailable);
      return false;
    }

    showStatus(labels().loading);
    stage.setAttribute('data-aspect', embed.aspect || 'auto');
    if (embed.provider) stage.setAttribute('data-provider', embed.provider);
    var iframe = document.createElement('iframe');
    iframe.className = 'igsv-frame';
    iframe.src = embed.src;
    iframe.title = title || 'Social content';
    iframe.loading = 'eager';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share';
    iframe.setAttribute('allowfullscreen', '');
    if (embed.provider === 'facebook-post') iframe.setAttribute('scrolling', 'yes');
    /* Prevent provider content from opening popups or navigating IGDC's top window. */
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads');
    iframe.addEventListener('load', function () {
      sizeProviderFrame(stage, iframe, embed);
      showStatus('');
    }, { once: true });
    stage.appendChild(iframe);
    sizeProviderFrame(stage, iframe, embed);
    iframe.__igdcSocialEmbed = embed;

    /* If a provider never fires load, do not leave the loading veil forever. */
    window.setTimeout(function () {
      if (state.open && q('.igsv-frame', stage) === iframe) showStatus('');
    }, 4500);
    return true;
  }

  function openCard(card) {
    var platform = sectionPlatform(card);
    var url = firstUrl(card);
    if (!platform || !url) return false;

    var root = ensureViewer();
    var title = titleOf(card) || platform;
    var embed = buildEmbed(platform, url, card);

    state.previousFocus = document.activeElement;
    state.lastUrl = url;
    state.platform = platform;
    state.open = true;
    state.closingFromHistory = false;

    q('.igsv-title', root).textContent = title;
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    updateLabels(root);
    mountEmbed(root, embed, title);

    if (!state.pushed) {
      try {
        history.pushState({ igdcSocialViewerV2: true, platform: platform }, '', location.href);
        state.pushed = true;
      } catch (_) {
        state.pushed = false;
      }
    }
    try { q('.igsv-back', root).focus({ preventScroll: true }); } catch (_) {}
    return true;
  }

  function finishClose() {
    var root = document.getElementById('igdcSocialViewerV2');
    if (root) {
      root.classList.remove('open');
      root.setAttribute('aria-hidden', 'true');
      clearStage(q('.igsv-stage', root));
      showStatus('');
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    state.open = false;
    state.pushed = false;
    state.closingFromHistory = false;
    state.lastUrl = '';
    state.platform = '';
    var focus = state.previousFocus;
    state.previousFocus = null;
    if (focus && focus.focus) {
      try { focus.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  function returnToList() {
    if (!state.open) return;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    if (state.pushed && !state.closingFromHistory) {
      try {
        history.back();
        return;
      } catch (_) {}
    }
    finishClose();
  }

  function toggleFullscreen() {
    if (!state.open) return;
    var root = ensureViewer();
    var stage = q('.igsv-stage', root);
    if (!stage) return;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      return;
    }
    if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(function () {});
    }
  }

  function resizeActiveProviderFrame() {
    if (!state.open) return;
    var root = document.getElementById('igdcSocialViewerV2');
    var stage = root && q('.igsv-stage', root);
    var iframe = stage && q('.igsv-frame', stage);
    if (stage && iframe && iframe.__igdcSocialEmbed) {
      sizeProviderFrame(stage, iframe, iframe.__igdcSocialEmbed);
    }
  }

  document.addEventListener('fullscreenchange', function () {
    var root = document.getElementById('igdcSocialViewerV2');
    if (root && state.open) {
      updateLabels(root);
      window.setTimeout(resizeActiveProviderFrame, 30);
    }
    /* Deliberately DO NOT close the viewer when native fullscreen ends.
       This provides the required two-step return: fullscreen -> in-page player -> list. */
  });

  window.addEventListener('resize', function () {
    if (state.open) resizeActiveProviderFrame();
  }, { passive: true });

  window.addEventListener('orientationchange', function () {
    if (state.open) window.setTimeout(resizeActiveProviderFrame, 80);
  }, { passive: true });

  window.addEventListener('popstate', function () {
    if (!state.open) return;
    state.closingFromHistory = true;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    finishClose();
  });

  document.addEventListener('keydown', function (event) {
    if (!state.open || event.key !== 'Escape') return;
    /* Native fullscreen owns the first Escape. fullscreenchange keeps the viewer open. */
    if (document.fullscreenElement) return;
    event.preventDefault();
    event.stopPropagation();
    returnToList();
  }, true);

  function previewUrlOf(card) {
    if (!card) return '';
    var pic = q('.pic', card);
    var img = q('img', card);
    var d = card.dataset || {};
    return text(d.thumbnailUrl || d.thumb || d.image || (img && img.src) || getBgUrl(pic)).trim();
  }

  function facebookPreviewNeedsRefresh(card) {
    var platform = sectionPlatform(card);
    if (platform !== 'facebook') return false;
    var src = previewUrlOf(card);
    if (!src) return true;
    try {
      var u = new URL(src, location.href);
      if (!/(?:^|\.)fbcdn\.net$/i.test(u.hostname)) return false;
      var token = u.searchParams.get('oe');
      if (!token || !/^[0-9a-f]+$/i.test(token)) return false;
      var expiry = parseInt(token, 16) * 1000;
      return Number.isFinite(expiry) && expiry <= Date.now() + 30 * 60 * 1000;
    } catch (_) { return false; }
  }

  function cardHasPreview(card) {
    if (facebookPreviewNeedsRefresh(card)) return false;
    var pic = q('.pic', card);
    if (!pic) return false;
    if (q('img,video,picture', pic)) return true;
    if (getBgUrl(pic)) return true;
    var d = card.dataset || {};
    return validHttp(d.thumbnailUrl || d.thumb || d.image || '');
  }

  function applyDecodedTitle(card) {
    var titleEl = q('.title', card);
    if (!titleEl) return;
    var raw = text(titleEl.textContent).trim();
    var decoded = decodeEntities(raw);
    if (decoded && decoded !== raw) titleEl.textContent = decoded;
    if (decoded) titleEl.setAttribute('title', decoded);
  }

  /*
   * Preview policy v2.4
   * Do NOT issue background metadata requests from the front list.
   * Thumbnails must arrive with the published Social candidate/snapshot.
   * This keeps initial rendering DOM-only and prevents serverless preview
   * calls / MutationObserver rescan loops from delaying the page.
   */

  document.addEventListener('mouseover', function (event) {
    var titleEl = event.target && event.target.closest && event.target.closest('.title');
    if (!titleEl) return;
    var card = titleEl.closest('a.card');
    if (!isMainSocialCard(card)) return;
    var fullTitle = text(titleEl.textContent).trim();
    if (fullTitle && titleEl.getAttribute('title') !== fullTitle) titleEl.setAttribute('title', fullTitle);
  }, true);

  document.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('.rscroll')) return;
    var card = event.target && event.target.closest &&
      event.target.closest('.thumb-grid[data-psom-key] a.card');
    if (!card || !isMainSocialCard(card)) return;

    var url = firstUrl(card);
    if (!url) return; /* Placeholder/sample cards keep their existing behavior. */

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openCard(card);
  }, true);
})();
