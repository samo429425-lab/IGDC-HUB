/* IGDC contained external viewer v1
 * Scope:
 *   - Network Hub main marketplace .link-btn links
 *   - Tour main service .link-btn links
 *   - Blockchain .bc-tile links on every front page
 *
 * Goal: keep the IGDC page/tab as the owner of navigation.  Direct iframe is
 * used only when the source permits framing.  When framing is blocked, the
 * existing IGDC search-page-proxy provides a contained static view.  No
 * top-navigation or unsandboxed popup permission is granted to source pages.
 */
(function (global) {
  'use strict';

  if (global.__IGDC_CONTAINED_EXTERNAL_VIEWER_V1__) return;
  global.__IGDC_CONTAINED_EXTERNAL_VIEWER_V1__ = true;

  var PROXY_PATH = '/.netlify/functions/search-page-proxy';
  var ROOT_ID = 'igdc-contained-external-viewer';
  var STYLE_ID = 'igdc-contained-external-viewer-style';
  var HISTORY_KEY = '__igdcContainedViewer';
  var state = {
    open: false,
    target: '',
    label: '',
    proxyId: '',
    root: null,
    frame: null,
    loading: null,
    host: null,
    title: null,
    scrollY: 0,
    prevBodyOverflow: '',
    prevHtmlOverflow: '',
    previousFocus: null
  };

  function isHttpUrl(raw) {
    try {
      var u = new URL(String(raw || ''), global.location.href);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  function hostOf(raw) {
    try { return new URL(raw).hostname.replace(/^www\./i, ''); }
    catch (e) { return ''; }
  }

  function textOf(el) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function isNetworkOrTourPage() {
    var p = String(global.location.pathname || '').toLowerCase();
    return /(?:^|\/)(?:networkhub|tour)(?:_[a-z0-9-]+)?(?:\.html)?\/?$/.test(p);
  }

  function eligibleAnchor(target) {
    var a = target && target.closest ? target.closest('a[href]') : null;
    if (!a) return null;
    var href = isHttpUrl(a.getAttribute('href') || a.href || '');
    if (!href) return null;

    if (a.matches('.bc-tile')) return { anchor: a, href: href, kind: 'blockchain' };
    if (isNetworkOrTourPage() && a.matches('.link-btn')) {
      return {
        anchor: a,
        href: href,
        kind: /(?:^|\/)tour(?:_|\.|\/|$)/i.test(global.location.pathname || '') ? 'tour' : 'market'
      };
    }
    return null;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + ROOT_ID + '{position:fixed;inset:0;z-index:2147483200;display:none;background:#fff;color:#0f172a;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}',
      '#' + ROOT_ID + '[data-open="1"]{display:flex;flex-direction:column;}',
      '#' + ROOT_ID + ' .igdc-contained-bar{height:48px;min-height:48px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#0b1220;color:#fff;border-bottom:1px solid rgba(255,255,255,.12);box-sizing:border-box;}',
      '#' + ROOT_ID + ' .igdc-contained-back{appearance:none;border:1px solid rgba(255,255,255,.18);background:#151f30;color:#fff;border-radius:8px;padding:7px 12px;font-size:14px;font-weight:800;cursor:pointer;white-space:nowrap;}',
      '#' + ROOT_ID + ' .igdc-contained-back:focus-visible{outline:2px solid #93c5fd;outline-offset:2px;}',
      '#' + ROOT_ID + ' .igdc-contained-label{min-width:0;display:flex;align-items:baseline;gap:10px;overflow:hidden;}',
      '#' + ROOT_ID + ' .igdc-contained-title{font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#' + ROOT_ID + ' .igdc-contained-host{font-size:12px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#' + ROOT_ID + ' .igdc-contained-body{position:relative;flex:1;min-height:0;background:#fff;overflow:hidden;}',
      '#' + ROOT_ID + ' .igdc-contained-frame{display:block;width:100%;height:100%;border:0;background:#fff;}',
      '#' + ROOT_ID + ' .igdc-contained-loading{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;background:#fff;color:#64748b;font-size:14px;font-weight:700;}',
      '#' + ROOT_ID + ' .igdc-contained-loading[hidden]{display:none;}',
      '@media(max-width:640px){#' + ROOT_ID + ' .igdc-contained-bar{height:44px;min-height:44px;padding:0 8px;gap:8px}#' + ROOT_ID + ' .igdc-contained-host{display:none}#' + ROOT_ID + ' .igdc-contained-back{padding:6px 9px;font-size:13px}}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureDom() {
    if (state.root && state.root.isConnected) return state.root;
    ensureStyle();

    var root = document.createElement('section');
    root.id = ROOT_ID;
    root.setAttribute('data-open', '0');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '' +
      '<div class="igdc-contained-bar">' +
        '<button type="button" class="igdc-contained-back" aria-label="IGDC 페이지로 돌아가기">← 돌아가기</button>' +
        '<div class="igdc-contained-label">' +
          '<strong class="igdc-contained-title">IGDC 내부 보기</strong>' +
          '<span class="igdc-contained-host"></span>' +
        '</div>' +
      '</div>' +
      '<div class="igdc-contained-body">' +
        '<div class="igdc-contained-loading">사이트를 불러오는 중입니다…</div>' +
        '<iframe class="igdc-contained-frame" title="외부 사이트 내부 보기" referrerpolicy="no-referrer-when-downgrade"></iframe>' +
      '</div>';

    (document.body || document.documentElement).appendChild(root);
    state.root = root;
    state.frame = root.querySelector('.igdc-contained-frame');
    state.loading = root.querySelector('.igdc-contained-loading');
    state.host = root.querySelector('.igdc-contained-host');
    state.title = root.querySelector('.igdc-contained-title');

    root.querySelector('.igdc-contained-back').addEventListener('click', function () {
      if (state.open && history.state && history.state[HISTORY_KEY] === 1) {
        try { history.back(); return; } catch (e) {}
      }
      close(false);
    });

    state.frame.addEventListener('load', function () {
      hideLoadingSoon(220);
    });

    return root;
  }

  function showLoading(message) {
    ensureDom();
    if (!state.loading) return;
    state.loading.textContent = message || '사이트를 불러오는 중입니다…';
    state.loading.hidden = false;
  }

  function hideLoadingSoon(delay) {
    global.setTimeout(function () {
      if (state.loading) state.loading.hidden = true;
    }, Math.max(0, Number(delay) || 0));
  }

  function frameCheckUrl(target) {
    return PROXY_PATH + '?action=frame-check&url=' + encodeURIComponent(target);
  }

  function proxyUrl(target, proxyId) {
    return PROXY_PATH + '?safe=1&embed=1&mode=static&proxyId=' + encodeURIComponent(proxyId || '') + '&url=' + encodeURIComponent(target);
  }

  async function framePolicy(target) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = global.setTimeout(function () {
      try { if (ctrl) ctrl.abort(); } catch (e) {}
    }, 5200);
    try {
      var r = await fetch(frameCheckUrl(target), {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: ctrl ? ctrl.signal : undefined
      });
      var json = await r.json().catch(function () { return null; });
      clearTimeout(timer);
      if (!r.ok || !json) return { directAllowed: false, reason: 'check-failed' };
      return json;
    } catch (e) {
      clearTimeout(timer);
      // A failed policy check must not risk replacing the IGDC tab with a source
      // page or leaving a permanently blank XFO/CSP-blocked iframe.
      return { directAllowed: false, reason: 'check-timeout' };
    }
  }

  function setFrameDirect(target) {
    var frame = state.frame;
    if (!frame) return;
    frame.removeAttribute('srcdoc');
    frame.dataset.viewerMode = 'direct';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-presentation');
    frame.setAttribute('allow', 'clipboard-read; clipboard-write; payment; fullscreen');
    frame.src = target;
  }

  function setFrameProxy(target) {
    var frame = state.frame;
    if (!frame) return;
    frame.removeAttribute('srcdoc');
    frame.dataset.viewerMode = 'static-proxy';
    // Upstream scripts are stripped by search-page-proxy. allow-scripts is kept
    // only so IGDC's injected navigation bridge can post the next URL upward.
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-downloads allow-presentation');
    frame.setAttribute('allow', 'clipboard-write; fullscreen');
    frame.src = proxyUrl(target, state.proxyId);
  }

  function updateBar(target, label) {
    var host = hostOf(target);
    if (state.host) state.host.textContent = host;
    if (state.title) state.title.textContent = label || host || 'IGDC 내부 보기';
  }

  async function loadTarget(target, options) {
    options = options || {};
    target = isHttpUrl(target);
    if (!target || !state.open) return;
    state.target = target;
    updateBar(target, options.label || state.label);
    showLoading('사이트를 불러오는 중입니다…');

    if (options.forceProxy) {
      setFrameProxy(target);
      return;
    }

    var policy = await framePolicy(target);
    if (!state.open || state.target !== target) return;
    if (policy && policy.directAllowed) setFrameDirect(target);
    else setFrameProxy(target);
  }

  function lockPage() {
    state.prevBodyOverflow = document.body ? document.body.style.overflow : '';
    state.prevHtmlOverflow = document.documentElement ? document.documentElement.style.overflow : '';
    if (document.body) document.body.style.overflow = 'hidden';
    if (document.documentElement) document.documentElement.style.overflow = 'hidden';
  }

  function unlockPage() {
    if (document.body) document.body.style.overflow = state.prevBodyOverflow || '';
    if (document.documentElement) document.documentElement.style.overflow = state.prevHtmlOverflow || '';
  }

  function open(target, options) {
    options = options || {};
    target = isHttpUrl(target);
    if (!target) return false;

    ensureDom();
    state.previousFocus = document.activeElement;
    state.scrollY = global.scrollY || global.pageYOffset || 0;
    state.label = String(options.label || '').trim();
    state.proxyId = 'igdc-contained-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    state.open = true;
    state.root.setAttribute('data-open', '1');
    state.root.setAttribute('aria-hidden', 'false');
    lockPage();

    if (options.pushHistory !== false) {
      try {
        history.pushState({
          ...(history.state || {}),
          [HISTORY_KEY]: 1,
          igdcContainedTarget: target,
          igdcContainedLabel: state.label
        }, '', global.location.href);
      } catch (e) {}
    }

    try { state.root.querySelector('.igdc-contained-back').focus({ preventScroll: true }); } catch (e) {}
    loadTarget(target, { label: state.label });
    return true;
  }

  function close(fromPopState) {
    if (!state.open) return;
    state.open = false;
    if (state.root) {
      state.root.setAttribute('data-open', '0');
      state.root.setAttribute('aria-hidden', 'true');
    }
    if (state.frame) {
      try { state.frame.src = 'about:blank'; } catch (e) {}
    }
    unlockPage();
    try { global.scrollTo(0, state.scrollY || 0); } catch (e) {}
    try {
      if (state.previousFocus && state.previousFocus.focus) state.previousFocus.focus({ preventScroll: true });
    } catch (e) {}
    if (!fromPopState && history.state && history.state[HISTORY_KEY] === 1) {
      try { history.back(); } catch (e) {}
    }
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented) return;
    var found = eligibleAnchor(ev.target);
    if (!found) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    open(found.href, { label: textOf(found.anchor), kind: found.kind });
  }, true);

  global.addEventListener('message', function (ev) {
    if (!state.open || !state.frame || ev.source !== state.frame.contentWindow) return;
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.__igdcProxyNavigate !== 1) return;
    if (String(data.proxyId || '') !== String(state.proxyId || '')) return;
    var next = isHttpUrl(data.url || '');
    if (!next) return;
    state.target = next;
    updateBar(next, hostOf(next));
    showLoading('사이트를 불러오는 중입니다…');
    // Once a source required proxy containment, keep subsequent navigation in
    // the same contained proxy instead of trying to promote it to top-level.
    setFrameProxy(next);
  });

  global.addEventListener('popstate', function (ev) {
    var hs = ev && ev.state;
    if (hs && hs[HISTORY_KEY] === 1) {
      var target = isHttpUrl(hs.igdcContainedTarget || '');
      if (!state.open && target) open(target, { label: hs.igdcContainedLabel || '', pushHistory: false });
      return;
    }
    if (state.open) close(true);
  });

  document.addEventListener('keydown', function (ev) {
    if (!state.open || ev.key !== 'Escape') return;
    ev.preventDefault();
    if (history.state && history.state[HISTORY_KEY] === 1) {
      try { history.back(); return; } catch (e) {}
    }
    close(false);
  }, true);

  global.IGDCContainedViewer = Object.freeze({
    open: open,
    close: function () { close(false); },
    isOpen: function () { return !!state.open; }
  });
})(window);
