/* IGDC contained external viewer v4
 * Scope:
 *   - Network Hub main marketplace .link-btn links
 *   - Tour main service .link-btn links
 *   - Blockchain .bc-tile links on every front page
 *
 * v2 refinements:
 *   - Immediate direct-frame start (no frame-policy preflight stall)
 *   - Session policy cache; blocked sources fall back to IGDC static proxy
 *   - Amazon marketplace hosts prefer proxy because direct framing is normally blocked
 *   - One-click/one-step back: viewer closes immediately, history cleanup follows
 *   - Light-green contained toolbar with navy text
 *
 * The IGDC top page is never handed to the source site.  No top-navigation or
 * unsandboxed source-popup permission is granted.
 */
(function (global) {
  'use strict';

  if (global.__IGDC_CONTAINED_EXTERNAL_VIEWER_V4__) return;
  global.__IGDC_CONTAINED_EXTERNAL_VIEWER_V4__ = true;

  var VIEWER_VERSION = 4;

  var PROXY_PATH = '/.netlify/functions/search-page-proxy';
  var ROOT_ID = 'igdc-contained-external-viewer';
  var STYLE_ID = 'igdc-contained-external-viewer-style';
  var HISTORY_KEY = '__igdcContainedViewer';
  var HISTORY_TOKEN_KEY = '__igdcContainedViewerToken';
  var POLICY_CACHE_KEY = '__igdcContainedFramePolicyV2';
  var POLICY_TTL_MS = 30 * 60 * 1000;
  var POLICY_TIMEOUT_MS = 3600;

  var policyMemory = Object.create(null);
  var policyInflight = Object.create(null);

  var state = {
    open: false,
    closePending: false,
    target: '',
    label: '',
    proxyId: '',
    historyToken: '',
    root: null,
    frame: null,
    loading: null,
    host: null,
    title: null,
    scrollY: 0,
    prevBodyOverflow: '',
    prevHtmlOverflow: '',
    previousFocus: null,
    viewerMode: '',
    activeLoadSeq: 0,
    pendingPolicyTarget: '',
    kind: ''
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

  function originOf(raw) {
    try { return new URL(raw).origin; }
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
      '#' + ROOT_ID + '{position:fixed;inset:0;z-index:2147483200;display:none;background:#fff;color:#16365c;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}',
      '#' + ROOT_ID + '[data-open="1"]{display:flex;flex-direction:column;}',
      '#' + ROOT_ID + ' .igdc-contained-bar{height:48px;min-height:48px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#cce89a;color:#16365c;border-bottom:1px solid #9dbd69;box-shadow:0 1px 2px rgba(15,23,42,.06);box-sizing:border-box;}',
      '#' + ROOT_ID + ' .igdc-contained-back{appearance:none;border:1px solid #9fc9aa;background:#eff8df;color:#16365c;border-radius:8px;padding:7px 12px;font-size:14px;font-weight:800;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease;}',
      '#' + ROOT_ID + ' .igdc-contained-back:hover{background:#c3df86;border-color:#7fa34f;}',
      '#' + ROOT_ID + ' .igdc-contained-back:active{background:#b7d679;}',
      '#' + ROOT_ID + ' .igdc-contained-back:focus-visible{outline:2px solid #315f87;outline-offset:2px;}',
      '#' + ROOT_ID + ' .igdc-contained-label{min-width:0;display:flex;align-items:baseline;gap:10px;overflow:hidden;}',
      '#' + ROOT_ID + ' .igdc-contained-title{font-size:14px;font-weight:800;color:#16365c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#' + ROOT_ID + ' .igdc-contained-host{font-size:12px;color:#3f617c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#' + ROOT_ID + ' .igdc-contained-body{position:relative;flex:1;min-height:0;background:#fff;overflow:hidden;}',
      '#' + ROOT_ID + ' .igdc-contained-frame{display:block;width:100%;height:100%;border:0;background:#fff;}',
      '#' + ROOT_ID + ' .igdc-contained-loading{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.96);color:#536779;font-size:14px;font-weight:700;}',
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
      requestClose();
    });

    state.frame.addEventListener('load', function () {
      /* Direct pages are allowed to paint as soon as the browser has them.  If
       * the policy check later says framing is blocked we re-show the loader
       * briefly and replace the frame with the contained proxy. */
      hideLoadingSoon(state.viewerMode === 'direct' ? 60 : 120);
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
    var seq = state.activeLoadSeq;
    global.setTimeout(function () {
      if (seq !== state.activeLoadSeq) return;
      if (state.loading) state.loading.hidden = true;
    }, Math.max(0, Number(delay) || 0));
  }

  function frameCheckUrl(target) {
    return PROXY_PATH + '?action=frame-check&url=' + encodeURIComponent(target);
  }

  function proxyUrl(target, proxyId, mode) {
    return PROXY_PATH + '?safe=1&embed=1&mode=' + encodeURIComponent(mode || 'static') + '&proxyId=' + encodeURIComponent(proxyId || '') + '&url=' + encodeURIComponent(target);
  }

  function hostMatches(host, suffix) {
    host = String(host || '').toLowerCase();
    suffix = String(suffix || '').toLowerCase();
    return host === suffix || host.endsWith('.' + suffix);
  }

  function directKnownGood(target, kind) {
    var host = hostOf(target).toLowerCase();
    if (kind === 'market') {
      return hostMatches(host, 'coupang.com') ||
             hostMatches(host, 'jd.com') ||
             host === 'amazon.com' || host === 'www.amazon.com';
    }
    if (kind === 'tour') {
      return hostMatches(host, 'booking.com') || hostMatches(host, 'hanatour.com');
    }
    return false;
  }

  function loadPolicyStore() {
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(POLICY_CACHE_KEY);
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  function savePolicyStore(store) {
    try {
      if (global.sessionStorage) global.sessionStorage.setItem(POLICY_CACHE_KEY, JSON.stringify(store || {}));
    } catch (e) {}
  }

  function getCachedPolicy(target) {
    var key = originOf(target);
    if (!key) return null;
    var mem = policyMemory[key];
    if (mem && mem.expires > Date.now()) return mem.policy;

    var store = loadPolicyStore();
    var row = store[key];
    if (!row || Number(row.expires || 0) <= Date.now()) return null;
    var policy = { ok:true, directAllowed: !!row.directAllowed, reason: row.reason || 'cached' };
    policyMemory[key] = { expires: Number(row.expires), policy: policy };
    return policy;
  }

  function putCachedPolicy(target, policy) {
    if (!policy || policy.ok === false) return;
    var key = originOf(target);
    if (!key) return;
    var expires = Date.now() + POLICY_TTL_MS;
    var normalized = { ok:true, directAllowed: !!policy.directAllowed, reason: String(policy.reason || '') };
    policyMemory[key] = { expires: expires, policy: normalized };
    var store = loadPolicyStore();
    store[key] = { expires: expires, directAllowed: normalized.directAllowed, reason: normalized.reason };
    /* Keep this tiny even during long sessions. */
    var keys = Object.keys(store);
    if (keys.length > 48) {
      keys.sort(function (a, b) { return Number(store[a].expires || 0) - Number(store[b].expires || 0); });
      while (keys.length > 48) delete store[keys.shift()];
    }
    savePolicyStore(store);
  }

  function preferProxy(target) {
    var host = hostOf(target).toLowerCase();
    /* Amazon marketplace pages normally send SAMEORIGIN/frame-ancestor policy.
     * Going straight to the contained proxy avoids a known blank first frame. */
    return /(^|\.)amazon\.[a-z.]+$/i.test(host);
  }

  function framePolicy(target) {
    var key = originOf(target) || target;
    var cached = getCachedPolicy(target);
    if (cached) return Promise.resolve(cached);
    if (policyInflight[key]) return policyInflight[key];

    policyInflight[key] = new Promise(function (resolve) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var settled = false;
      var timer = global.setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (e) {}
        if (!settled) {
          settled = true;
          resolve({ ok:false, directAllowed:false, reason:'check-timeout' });
        }
      }, POLICY_TIMEOUT_MS);

      fetch(frameCheckUrl(target), {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (json) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          /* An upstream check failure must not be interpreted as "frame it".
           * That was the source of blank Amazon-style frames in v1. */
          if (!r.ok || !json || json.ok === false) {
            resolve({ ok:false, directAllowed:false, reason:(json && json.reason) || 'check-failed' });
            return;
          }
          var policy = {
            ok:true,
            directAllowed: !!json.directAllowed,
            reason:String(json.reason || '')
          };
          putCachedPolicy(target, policy);
          resolve(policy);
        });
      }).catch(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok:false, directAllowed:false, reason:'check-error' });
      });
    }).then(function (policy) {
      delete policyInflight[key];
      return policy;
    }, function (err) {
      delete policyInflight[key];
      throw err;
    });

    return policyInflight[key];
  }

  function setFrameDirect(target) {
    var frame = state.frame;
    if (!frame) return;
    frame.removeAttribute('srcdoc');
    state.viewerMode = 'direct';
    frame.dataset.viewerMode = 'direct';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-presentation');
    frame.setAttribute('allow', 'clipboard-read; clipboard-write; payment; fullscreen');
    frame.src = target;
  }

  function setFrameProxy(target, mode) {
    var frame = state.frame;
    if (!frame) return;
    frame.removeAttribute('srcdoc');
    mode = mode || 'static';
    state.viewerMode = mode + '-proxy';
    frame.dataset.viewerMode = state.viewerMode;
    /* Upstream scripts are stripped by search-page-proxy. allow-scripts is kept
     * only so IGDC's injected navigation bridge can post the next URL upward. */
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-downloads allow-presentation');
    frame.setAttribute('allow', 'clipboard-write; fullscreen');
    frame.src = proxyUrl(target, state.proxyId, mode);
  }

  function updateBar(target, label) {
    var host = hostOf(target);
    if (state.host) state.host.textContent = host;
    if (state.title) state.title.textContent = label || host || 'IGDC 내부 보기';
  }

  function loadTarget(target, options) {
    options = options || {};
    target = isHttpUrl(target);
    if (!target || !state.open) return;

    state.target = target;
    state.kind = String(options.kind || state.kind || '');
    state.activeLoadSeq += 1;
    var seq = state.activeLoadSeq;
    updateBar(target, options.label || state.label);
    showLoading('사이트를 불러오는 중입니다…');

    /* Network/Tour compatibility path.
     * Most large commerce/travel sites reject third-party iframe embedding even
     * though their URL is valid.  Do not show a browser-level "refused to
     * connect" page first.  Use IGDC's contained relay immediately unless the
     * host is one of the few sources already verified by the operator to frame
     * correctly.  The frame-policy check still runs in the background so the
     * origin decision is cached without delaying first paint. */
    if ((state.kind === 'market' || state.kind === 'tour') && !directKnownGood(target, state.kind)) {
      /* Fast path: proxy is already the chosen compatibility route.  Do not run
       * a second frame-policy request in parallel; that duplicated the same
       * upstream work and made first paint slower on restrictive sites. */
      setFrameProxy(target, 'static');
      return;
    }

    if (options.forceProxy || preferProxy(target)) {
      setFrameProxy(target, 'static');
      return;
    }

    var cached = getCachedPolicy(target);
    if (cached) {
      if (cached.directAllowed) setFrameDirect(target);
      else setFrameProxy(target, 'static');
      return;
    }

    /* v2 speed path: start the actual source immediately instead of waiting
     * several seconds for the server-side frame-policy probe. */
    setFrameDirect(target);
    state.pendingPolicyTarget = target;

    framePolicy(target).then(function (policy) {
      if (!state.open || seq !== state.activeLoadSeq || state.target !== target) return;
      state.pendingPolicyTarget = '';
      if (policy && policy.directAllowed) {
        /* Direct page is already loading/rendered. Nothing else to do. */
        return;
      }
      showLoading('사이트를 안전하게 불러오는 중입니다…');
      setFrameProxy(target, 'static');
    });
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

  function historyStateFor(target, label, token) {
    var base = {};
    try {
      if (history.state && typeof history.state === 'object') {
        Object.keys(history.state).forEach(function (k) { base[k] = history.state[k]; });
      }
    } catch (e) {}
    base[HISTORY_KEY] = 1;
    base[HISTORY_TOKEN_KEY] = token;
    base.igdcContainedTarget = target;
    base.igdcContainedLabel = label || '';
    base.igdcContainedKind = state.kind || '';
    return base;
  }

  function open(target, options) {
    options = options || {};
    target = isHttpUrl(target);
    if (!target) return false;

    ensureDom();

    if (state.open) {
      state.label = String(options.label || state.label || '').trim();
      state.kind = String(options.kind || state.kind || '');
      loadTarget(target, { label: state.label, forceProxy: !!options.forceProxy, kind: state.kind });
      return true;
    }

    state.closePending = false;
    state.previousFocus = document.activeElement;
    state.scrollY = global.scrollY || global.pageYOffset || 0;
    state.label = String(options.label || '').trim();
    state.kind = String(options.kind || '');
    state.proxyId = 'igdc-contained-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    state.historyToken = String(options.historyToken || ('igdc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)));
    state.open = true;
    state.root.setAttribute('data-open', '1');
    state.root.setAttribute('aria-hidden', 'false');
    lockPage();

    if (options.pushHistory !== false) {
      try {
        history.pushState(historyStateFor(target, state.label, state.historyToken), '', global.location.href);
      } catch (e) {}
    }

    try { state.root.querySelector('.igdc-contained-back').focus({ preventScroll: true }); } catch (e) {}
    loadTarget(target, { label: state.label, forceProxy: !!options.forceProxy, kind: state.kind });
    return true;
  }

  function hideViewer() {
    if (!state.open) return;
    state.open = false;
    state.activeLoadSeq += 1;
    state.pendingPolicyTarget = '';
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
  }

  function currentHistoryMatchesViewer() {
    try {
      var hs = history.state;
      return !!(hs && hs[HISTORY_KEY] === 1 && String(hs[HISTORY_TOKEN_KEY] || '') === String(state.historyToken || ''));
    } catch (e) {
      return false;
    }
  }

  function requestClose() {
    if (!state.open || state.closePending) return;
    state.closePending = true;
    var shouldBack = currentHistoryMatchesViewer();

    /* Close visually first so one click always feels immediate.  History is a
     * cleanup step, not a prerequisite for the interface to respond. */
    hideViewer();

    if (shouldBack) {
      try { history.back(); }
      catch (e) { state.closePending = false; }
      global.setTimeout(function () { state.closePending = false; }, 900);
    } else {
      state.closePending = false;
    }
  }

  /* v3 upgrade capture: this is attached at window level so it runs before
   * the older v2 document-capture listener if a cached FrontBus loaded v2 first. */
  global.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || !isNetworkOrTourPage()) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a.link-btn[href]') : null;
    if (!a) return;
    var href = isHttpUrl(a.getAttribute('href') || a.href || '');
    if (!href) return;
    var kind = /(?:^|\/)tour(?:_|\.|\/|$)/i.test(global.location.pathname || '') ? 'tour' : 'market';
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    open(href, { label: textOf(a), kind: kind });
  }, true);

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
    state.activeLoadSeq += 1;
    updateBar(next, hostOf(next));
    showLoading('사이트를 불러오는 중입니다…');
    /* Once a source required proxy containment, keep subsequent navigation in
     * the same contained proxy instead of trying to promote it to top-level. */
    setFrameProxy(next, 'static');
  });

  global.addEventListener('popstate', function (ev) {
    var hs = ev && ev.state;
    if (hs && hs[HISTORY_KEY] === 1) {
      var target = isHttpUrl(hs.igdcContainedTarget || '');
      if (!state.open && target) {
        state.closePending = false;
        open(target, {
          label: hs.igdcContainedLabel || '',
          historyToken: hs[HISTORY_TOKEN_KEY] || '',
          pushHistory: false,
          kind: hs.igdcContainedKind || ''
        });
      }
      return;
    }
    if (state.open) hideViewer();
    state.closePending = false;
  });

  document.addEventListener('keydown', function (ev) {
    if (!state.open || ev.key !== 'Escape') return;
    ev.preventDefault();
    requestClose();
  }, true);

  global.IGDCContainedViewer = Object.freeze({
    version: VIEWER_VERSION,
    open: open,
    close: requestClose,
    isOpen: function () { return !!state.open; }
  });
})(window);
