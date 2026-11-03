/* IGDC Social public navigation pause — display-only, 2026-11-03.
 * Only hide the Social entry in public hub sidebars and index navigation.
 * Do not intercept links, frame navigation, routes, history, or admin access.
 * The synchronous common head script prehides public sidebar links before paint.
 */
(function () {
  'use strict';
  if (window.__IGDC_SOCIAL_MENU_COUNTRY_GATE_BOUND__) return;
  window.__IGDC_SOCIAL_MENU_COUNTRY_GATE_BOUND__ = true;

  var root = document.documentElement;
  var frame = document.getElementById('mainFrame');
  var STYLE_ID = 'igdc-social-country-hidden-sidebar';
  var HUB_NAME = /^(?:home|networkhub|distributionhub|mediahub|tour)(?:_[a-z]{2,3})?\.html$/i;
  var CSS = '.sidebar a[href*="socialnetwork" i]{display:none!important;pointer-events:none!important;}';

  // The existing index.html head stylesheet hides the top navigation from
  // first paint. Preserve its selector without disabling any navigation route.
  if (root) root.setAttribute('data-igdc-social-menu-country', 'blocked');

  function hideInPublicHub() {
    if (!frame) frame = document.getElementById('mainFrame');
    if (!frame) return;
    var doc;
    try { doc = frame.contentDocument; } catch (_error) { return; }
    if (!doc) return;
    var pathname;
    try { pathname = new URL(doc.location.href).pathname.split('/').pop() || ''; }
    catch (_error) { return; }
    var existing = doc.getElementById(STYLE_ID);
    if (!HUB_NAME.test(pathname)) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }

  if (frame) frame.addEventListener('load', hideInPublicHub);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideInPublicHub, { once: true });
  } else {
    hideInPublicHub();
  }
})();
