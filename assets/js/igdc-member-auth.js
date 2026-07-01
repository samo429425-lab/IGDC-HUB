/* IGDC Member Auth Contract v1.0.1
 * One browser-side source of truth for an already-configured Auth0/OSO session.
 * It does not create a second Auth0 client or store any secret.
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
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[\s.]+/g, '_');
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
    } catch (e) {
      return null;
    }
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
    var s;
    var i;
    for (s = 0; s < stores.length; s++) {
      for (i = 0; i < TOKEN_KEYS.length; i++) {
        try {
          var raw = stores[s].getItem(TOKEN_KEYS[i]);
          var record = raw ? safeJson(raw) : null;
          if (record && typeof record === 'object') return record;
        } catch (e) {}
      }
    }
    return null;
  }

  function getIdToken() {
    var candidates = [];
    try {
      if (typeof existingGetIdToken === 'function' && existingGetIdToken !== getIdToken) {
        candidates.push(existingGetIdToken.call(window.osAuth));
      }
    } catch (e) {}
    var record = tokenRecord();
    if (record) {
      candidates.push(record.id_token);
      candidates.push(record.idToken);
      candidates.push(record.__raw);
      candidates.push(record.raw);
    }
    var stores = getStoreItems();
    for (var s = 0; s < stores.length; s++) {
      try {
        candidates.push(stores[s].getItem('igdc_id_token'));
        candidates.push(stores[s].getItem('id_token'));
        candidates.push(stores[s].getItem('auth0_id_token'));
      } catch (e) {}
    }
    for (var i = 0; i < candidates.length; i++) {
      if (validIdToken(candidates[i])) return candidates[i];
    }
    return '';
  }

  function getIdTokenPayload() {
    return decodeJwt(getIdToken()) || null;
  }

  function getRoles() {
    var payload = getIdTokenPayload() || {};
    var values = [];
    ROLE_CLAIMS.forEach(function (claim) {
      var roleValue = payload[claim];
      if (Array.isArray(roleValue)) values = values.concat(roleValue);
      else if (typeof roleValue === 'string') values = values.concat(roleValue.split(','));
    });
    return unique(values);
  }

  function roleLevel(role) {
    var normalized = normalizeRole(role);
    if (ROLE_LEVEL[normalized] != null) return ROLE_LEVEL[normalized];
    if (normalized.indexOf('site_manager_') === 0) return 12;
    return 0;
  }

  function highestRole(roles) {
    var uniqueRoles = unique(roles);
    if (!uniqueRoles.length) return 'guest';
    uniqueRoles.sort(function (left, right) {
      return roleLevel(right) - roleLevel(left);
    });
    return uniqueRoles[0] || 'guest';
  }

  function isAuthenticated() {
    return !!getIdToken();
  }

  function beginLogin() {
    if (isAuthenticated()) return true;
    try {
      if (typeof window.osLogin === 'function') {
        window.osLogin();
        return false;
      }
    } catch (e) {}
    try {
      if (window.osAuth && typeof window.osAuth.loginWithRedirect === 'function') {
        window.osAuth.loginWithRedirect();
        return false;
      }
    } catch (e) {}
    try {
      document.dispatchEvent(new CustomEvent('igdc:login-request'));
    } catch (e) {}
    return false;
  }

  function normalizeExistingOsAuth() {
    try {
      if (!window.osAuth) window.osAuth = {};
      if (!existingGetIdToken && typeof window.osAuth.getIdToken === 'function' && window.osAuth.getIdToken !== getIdToken) {
        existingGetIdToken = window.osAuth.getIdToken;
      }
      if (typeof window.osAuth.getIdToken !== 'function') {
        window.osAuth.getIdToken = getIdToken;
      }
      if (typeof window.osAuth.getIdTokenClaims !== 'function') {
        window.osAuth.getIdTokenClaims = getIdTokenPayload;
      }
    } catch (e) {}
  }

  function dispatchReady() {
    normalizeExistingOsAuth();
    try {
      document.dispatchEvent(new CustomEvent('igdc:member-auth-ready', {
        detail: {
          authenticated: isAuthenticated(),
          roles: getRoles(),
          role: highestRole(getRoles())
        }
      }));
    } catch (e) {}
  }

  normalizeExistingOsAuth();

  window.IGDCMemberAuth = {
    __version: '1.0.1',
    getIdToken: getIdToken,
    getIdTokenPayload: getIdTokenPayload,
    getRoles: getRoles,
    highestRole: highestRole,
    roleLevel: roleLevel,
    isAuthenticated: isAuthenticated,
    beginLogin: beginLogin,
    refresh: beginLogin
  };

  document.addEventListener('igdc:auth-storage-ready', dispatchReady);
  document.addEventListener('osauth:ready', dispatchReady);
  document.addEventListener('osauth:done', dispatchReady, true);
  window.addEventListener('pageshow', dispatchReady);
  dispatchReady();
})();
