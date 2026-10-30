/* IGDC Social Public Navigation Pause (2026-10-31)
 * Hide Social globally in index top navigation and mainFrame hub sidebars
 * across all 30 languages. Reuses the country-gate route guards.
 * Does NOT modify country/Donation policy, admin, Social content or DB.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root || window.__IGDC_SOCIAL_MENU_COUNTRY_GATE_BOUND__) return;
  window.__IGDC_SOCIAL_MENU_COUNTRY_GATE_BOUND__ = true;
  var state = 'pending';
  var pendingSocialSrc = '';
  var frame = document.getElementById('mainFrame');
  var originalRestore = (typeof window.restoreFrameWithoutHistory === 'function')
    ? window.restoreFrameWithoutHistory : null;
  var originalLoad = (typeof window.loadPage === 'function') ? window.loadPage : null;
  var SIDEBAR_STYLE_ID = 'igdc-social-country-hidden-sidebar';
  var SIDE_CSS = '.sidebar a[href*="socialnetwork" i]{display:none!important;pointer-events:none!important;}';
  var HUB_NAME = /^(?:home|networkhub|distributionhub|mediahub|tour)(?:_[a-z]{2,3})?\.html$/i;
  var SOCIAL_NAME = /^socialnetwork(?:_[a-z]{2,3})?(?:\.html)?$/i;

  function pathName(value) {
    try { return new URL(String(value || ''), location.origin).pathname.split('/').pop() || ''; }
    catch (_error) { return ''; }
  }
  function socialPath(value) { return SOCIAL_NAME.test(pathName(value)); }
  function restricted() { return state !== 'allowed'; }
  function isHubDocument(doc) {
    try { return !!doc && HUB_NAME.test(pathName(doc.location.href)); }
    catch (_error) { return false; }
  }
  function applySidebar() {
    if (!frame) frame = document.getElementById('mainFrame');
    if (!frame) return;
    var doc;
    try { doc = frame.contentDocument; } catch (_error) { return; }
    if (!doc) return;
    var oldStyle = doc.getElementById(SIDEBAR_STYLE_ID);
    if (!restricted() || !isHubDocument(doc)) {
      if (oldStyle) oldStyle.remove();
      return;
    }
    if (!oldStyle) {
      var style = doc.createElement('style');
      style.id = SIDEBAR_STYLE_ID;
      style.textContent = SIDE_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }
    if (!doc.__igdcSocialCountryClickGuard) {
      doc.__igdcSocialCountryClickGuard = true;
      doc.addEventListener('click', function (event) {
        if (!restricted()) return;
        var link = event.target && event.target.closest && event.target.closest('a[href]');
        if (link && link.closest('.sidebar') && socialPath(link.href)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  }

  function homeLocation() {
    var lang = 'ko';
    try {
      if (typeof currentLang === 'string' && /^[a-z]{2,3}$/i.test(currentLang)) lang = currentLang;
    } catch (_error) {}
    var src = lang === 'ko' ? '/home.html' : '/' + lang + '/home_' + lang + '.html';
    var publicPath = src.replace(/\.html$/, '');
    return { lang: lang, src: src + '?lang=' + encodeURIComponent(lang), publicPath: publicPath + '?lang=' + encodeURIComponent(lang) };
  }
  function redirectToHome() {
    var home = homeLocation();
    pendingSocialSrc = '';
    try { if (typeof currentPageIndex !== 'undefined') currentPageIndex = 0; } catch (_error) {}
    try { history.replaceState({ igdcPage: 0, lang: home.lang, frameSrc: home.src }, '', home.publicPath); }
    catch (_error) {}
    if (originalRestore) originalRestore.call(window, home.src);
  }
  function onState(next) {
    state = next;
    root.setAttribute('data-igdc-social-menu-country', next);
    applySidebar();
    if (next === 'allowed') {
      var wanted = pendingSocialSrc;
      pendingSocialSrc = '';
      if (wanted && originalRestore) originalRestore.call(window, wanted);
    } else if (socialPath(location.pathname) ||
      (frame && (function () {
        try { return socialPath(frame.contentWindow.location.href) || socialPath(frame.getAttribute('src')); }
        catch (_error) { return socialPath(frame.getAttribute('src')); }
      })())) {
      redirectToHome();
    }
  }

  // Block accidental index navigation even when an external caller invokes
  // loadPage(3) without clicking the now-hidden navigation link.
  if (originalLoad) {
    window.loadPage = function (index, event, options) {
      if (Number(index) === 3 && restricted()) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        return false;
      }
      return originalLoad.call(this, index, event, options);
    };
  }
  // The index can also restore an extensionless Social route on refresh or
  // browser Back. Hold it until the country resolves; redirect when blocked.
  if (originalRestore) {
    window.restoreFrameWithoutHistory = function (src) {
      if (socialPath(src) && restricted()) {
        if (state === 'pending') pendingSocialSrc = src;
        else redirectToHome();
        return;
      }
      return originalRestore.apply(this, arguments);
    };
  }

  if (frame) {
    frame.addEventListener('load', function () {
      applySidebar();
      if (state === 'blocked') {
        try { if (socialPath(frame.contentWindow.location.href)) redirectToHome(); }
        catch (_error) {}
      }
    });
    applySidebar();
  }
  document.addEventListener('click', function (event) {
    if (!restricted()) return;
    var link = event.target && event.target.closest && event.target.closest('nav a[href]');
    if (link && (link.getAttribute('data-page-index') === '3' || socialPath(link.href))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Temporary global public-menu pause. Existing database collection,
  // administrator views and other country rules remain unchanged.
  // Restore the previous geo-decision block when reopening the public hub.
  onState('blocked');
})();
