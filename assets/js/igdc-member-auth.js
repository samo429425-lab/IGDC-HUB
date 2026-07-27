/* IGDC Member Auth Contract v1.0.2-session-keeper
 * One browser-side source of truth for the configured Auth0/OSO session.
 * It preserves the current role hierarchy and asks the index session owner
 * to renew an expired token before the UI is downgraded to guest.
 */
(function () {
  'use strict';

  if (window.IGDCMemberAuth && window.IGDCMemberAuth.__version) return;

  var TOKEN_KEYS = [
    'osauth.tokens.v2',
    'osauth.tokens.v1',
    'igdc.tokens',
    'igdc_auth_tokens',
    'auth0_tokens',
    'auth0spa'
  ];
  var ROLE_CLAIMS = [
    'https://igdcglobal.com/roles',
    'https://os.auth/roles',
    'https://os0.app/roles',
    'https://example.com/roles',
    'https://osu/roles',
    'roles',
    'role',
    'permissions'
  ];
  var ROLE_LEVEL = {
    guest: 0,
    member: 1,
    member_standard: 2,
    member_premium: 3,
    special_member: 4,
    special_menber: 4,
    commerce_manager: 5,
    site_manager: 12,
    site_manager_home_om: 10,
    site_manager_distribution_om: 10,
    site_manager_donation_om: 10,
    site_manager_mediahub_om: 10,
    site_manager_networkhub_om: 10,
    site_manager_socialnetwork_om: 10,
    site_manager_tour_om: 10,
    site_manager_home_op: 11,
    site_manager_distribution_op: 11,
    site_manager_donation_op: 11,
    site_manager_mediahub_op: 11,
    site_manager_networkhub_op: 11,
    site_manager_socialnetwork_op: 11,
    site_manager_tour_op: 11,
    site_manager_home: 12,
    site_manager_distribution: 12,
    site_manager_donation: 12,
    site_manager_mediahub: 12,
    site_manager_networkhub: 12,
    site_manager_socialnetwork: 12,
    site_manager_tour: 12,
    coordinator_director: 13,
    site_manager_director: 14,
    director: 15,
    admin: 20,
    owner: 30
  };

  var existingGetIdToken = null;

  function safeJson(value) {
    try { return JSON.parse(value); } catch (e) { return null; }
  }
  function normalizeRole(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s.]+/g, '_');
  }
  function unique(values) {
    var seen = {};
    return (values || []).map(normalizeRole).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }
  function decodeJwt(token) {
    try {
      var parts = String(token || '').split('.');
      if (parts.length !== 3) return null;
      var value = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (value.length % 4) value += '=';
      return JSON.parse(window.atob(value));
    } catch (e) { return null; }
  }
  function validIdToken(token) {
    var payload = decodeJwt(token);
    if (!payload || !payload.exp) return false;
    return Number(payload.exp) * 1000 > Date.now() + 15000;
  }
  function getStoreItems() {
    var stores = [];
    try { stores.push(window.localStorage); } catch (e) {}
    try { stores.push(window.sessionStorage); } catch (e) {}
    return stores;
  }
  function tokenRecord() {
    var stores = getStoreItems();
    for (var s = 0; s < stores.length; s++) {
      for (var i = 0; i < TOKEN_KEYS.length; i++) {
        try {
          var raw = stores[s].getItem(TOKEN_KEYS[i]);
          var record = raw ? safeJson(raw) : null;
          if (record && typeof record === 'object') return record;
        } catch (e) {}
      }
    }
    return null;
  }
  function storedIdToken() {
    var record = tokenRecord();
    if (record) {
      var token = record.id_token || record.idToken || record.__raw || record.raw;
      if (token) return token;
    }
    var stores = getStoreItems();
    for (var s = 0; s < stores.length; s++) {
      try {
        var candidate = stores[s].getItem('igdc_id_token') || stores[s].getItem('id_token') || stores[s].getItem('auth0_id_token');
        if (candidate) return candidate;
      } catch (e) {}
    }
    return '';
  }
  function getIdToken() {
    var candidates = [];
    try {
      if (typeof existingGetIdToken === 'function' && existingGetIdToken !== getIdToken) {
        candidates.push(existingGetIdToken.call(window.osAuth));
      }
    } catch (e) {}
    candidates.push(storedIdToken());
    for (var i = 0; i < candidates.length; i++) {
      if (validIdToken(candidates[i])) return candidates[i];
    }
    return '';
  }
  function getIdTokenPayload() { return decodeJwt(getIdToken()) || null; }
  function getStoredIdTokenPayload() { return decodeJwt(storedIdToken()) || null; }
  function rolesFromPayload(payload) {
    payload = payload || {};
    var values = [];
    ROLE_CLAIMS.forEach(function (claim) {
      var roleValue = payload[claim];
      if (Array.isArray(roleValue)) values = values.concat(roleValue);
      else if (typeof roleValue === 'string') values = values.concat(roleValue.split(','));
    });
    return unique(values);
  }
  function getRoles() { return rolesFromPayload(getIdTokenPayload()); }
  function getStoredRoles() { return rolesFromPayload(getStoredIdTokenPayload()); }
  function roleLevel(role) {
    var normalized = normalizeRole(role);
    if (ROLE_LEVEL[normalized] != null) return ROLE_LEVEL[normalized];
    if (normalized.indexOf('site_manager_') === 0) return 12;
    return 0;
  }
  function highestRole(roles) {
    var uniqueRoles = unique(roles);
    if (!uniqueRoles.length) return 'guest';
    uniqueRoles.sort(function (left, right) { return roleLevel(right) - roleLevel(left); });
    return uniqueRoles[0] || 'guest';
  }
  function usableSession(value) {
    return !!(value && (typeof value.ensureSession === 'function' ||
      typeof value.refreshSession === 'function' ||
      typeof value.isAuthenticated === 'function' ||
      typeof value.loginWithRedirect === 'function'));
  }
  function sessionOwner() {
    try { if (usableSession(window.osAuth)) return window.osAuth; } catch (e) {}
    try {
      if (window.parent && window.parent !== window && usableSession(window.parent.osAuth)) return window.parent.osAuth;
    } catch (e) {}
    try {
      if (window.top && window.top !== window && usableSession(window.top.osAuth)) return window.top.osAuth;
    } catch (e) {}
    return null;
  }
  function isAuthenticated() { return !!getIdToken(); }
  function isRestoring() {
    var owner = sessionOwner();
    try {
      return !!(owner && ((owner.isRenewing && owner.isRenewing()) ||
        (owner.hasRestorableSession && owner.hasRestorableSession())));
    } catch (e) { return false; }
  }
  function beginLogin() {
    if (isAuthenticated()) return true;
    var owner = sessionOwner();
    try {
      if (owner && typeof owner.loginWithRedirect === 'function') {
        owner.loginWithRedirect();
        return false;
      }
    } catch (e) {}
    try {
      if (window.parent && window.parent !== window && typeof window.parent.osLogin === 'function') {
        window.parent.osLogin();
        return false;
      }
    } catch (e) {}
    try {
      if (typeof window.osLogin === 'function') {
        window.osLogin();
        return false;
      }
    } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('igdc:login-request')); } catch (e) {}
    return false;
  }
  function refresh(options) {
    var owner = sessionOwner();
    try {
      if (owner && typeof owner.ensureSession === 'function') {
        return owner.ensureSession(Object.assign({ allowSilent:window.parent === window }, options || {}));
      }
      if (owner && typeof owner.refreshSession === 'function') {
        return owner.refreshSession(Object.assign({ allowSilent:window.parent === window }, options || {}));
      }
    } catch (e) {}
    return Promise.resolve(isAuthenticated());
  }
  function normalizeExistingOsAuth() {
    try {
      if (!window.osAuth) window.osAuth = {};
      if (!existingGetIdToken && typeof window.osAuth.getIdToken === 'function' && window.osAuth.getIdToken !== getIdToken) {
        existingGetIdToken = window.osAuth.getIdToken;
      }
      if (typeof window.osAuth.getIdToken !== 'function') window.osAuth.getIdToken = getIdToken;
      if (typeof window.osAuth.getIdTokenClaims !== 'function') window.osAuth.getIdTokenClaims = getIdTokenPayload;
    } catch (e) {}
  }
  function dispatchReady() {
    normalizeExistingOsAuth();
    var roles = getRoles();
    var pending = !isAuthenticated() && isRestoring();
    var storedRoles = pending ? getStoredRoles() : [];
    try {
      document.dispatchEvent(new CustomEvent('igdc:member-auth-ready', {
        detail: {
          authenticated:isAuthenticated(),
          pending:pending,
          roles:roles,
          storedRoles:storedRoles,
          role:highestRole(roles.length ? roles : storedRoles)
        }
      }));
    } catch (e) {}
  }

  normalizeExistingOsAuth();

  window.IGDCMemberAuth = {
    __version:'1.0.2-session-keeper',
    getIdToken:getIdToken,
    getStoredIdToken:storedIdToken,
    getIdTokenPayload:getIdTokenPayload,
    getStoredIdTokenPayload:getStoredIdTokenPayload,
    getRoles:getRoles,
    getStoredRoles:getStoredRoles,
    highestRole:highestRole,
    roleLevel:roleLevel,
    isAuthenticated:isAuthenticated,
    isRestoring:isRestoring,
    beginLogin:beginLogin,
    refresh:refresh,
    ensureSession:refresh
  };

  ['igdc:auth-storage-ready','osauth:ready','osauth:done','osauth:refreshed','osauth:renewing','osauth:renew-failed'].forEach(function(name){
    document.addEventListener(name, dispatchReady, true);
  });
  window.addEventListener('pageshow', function(){ refresh({ reason:'member-auth-pageshow' }).then(dispatchReady); });
  window.addEventListener('storage', dispatchReady);
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) refresh({ reason:'member-auth-visible' }).then(dispatchReady);
  });
  dispatchReady();
})();
