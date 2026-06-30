/* Restores only a same-origin Media Hub card after the existing site login flow. */
(function (global, document) {
  'use strict';
  var KEY = 'igdc.media.ott.login-return.v1';
  var TTL_MS = 15 * 60 * 1000;
  var restored = false;

  function text(value) { return value == null ? '' : String(value).trim(); }
  function validPath(path) {
    if (path === '/mediahub.html') return true;
    return /^\/[a-z]{2,3}\/mediahub_[a-z]{2,3}\.html$/i.test(path);
  }
  function pending() {
    try {
      var raw = global.localStorage.getItem(KEY) || '';
      var value = raw ? JSON.parse(raw) : null;
      if (!value || Number(value.version) !== 1 || !validPath(text(value.path)) || !text(value.contentId)) return null;
      if (!Number(value.createdAt) || Date.now() - Number(value.createdAt) > TTL_MS) { global.localStorage.removeItem(KEY); return null; }
      return value;
    } catch (_) { return null; }
  }
  function authenticated() {
    try {
      if (global.osAuth && typeof global.osAuth.isAuthenticated === 'function' && global.osAuth.isAuthenticated()) return true;
    } catch (_) {}
    try {
      var raw = global.localStorage.getItem('osauth.tokens.v2');
      var tokens = raw ? JSON.parse(raw) : null;
      return Boolean(tokens && tokens.id_token && (!tokens.exp || Number(tokens.exp) * 1000 > Date.now()));
    } catch (_) { return false; }
  }
  function restore() {
    if (restored || !authenticated()) return;
    var value = pending();
    if (!value) return;
    var frame = document.getElementById('mainFrame') || document.querySelector('iframe[name="mainFrame"]');
    if (!frame) return;
    restored = true;
    frame.src = value.path;
  }
  function boot() {
    var attempts = 0;
    var timer = global.setInterval(function () {
      attempts += 1;
      restore();
      if (restored || attempts >= 40) global.clearInterval(timer);
    }, 250);
    restore();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { global.setTimeout(boot, 120); }, { once: true });
  else global.setTimeout(boot, 120);
  document.addEventListener('osauth:ready', function () { global.setTimeout(restore, 80); });
})(window, document);
