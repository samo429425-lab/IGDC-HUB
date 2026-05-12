/* IGDC Member/Admin Modal v2.4.1
   6번 권한별 서비스 패널 + 7번 안정 트리거/호환 구조 통합본.
   - Trigger: #mo-btn, [data-member-modal="open"], .js-member-admin-modal-trigger, .js-seller-modal-trigger
   - Legacy compatibility: openModal('apply'), injectModal(), openMemberAdminModal()
   - Admin member list: server-only API endpoint required. Never exposes Auth0 M2M secret in browser.
   - Default API: /.netlify/functions/member-admin
*/
(function () {
  'use strict';

  if (window.IGDCMemberAdminModal && window.IGDCMemberAdminModal.__version) return;

  var VERSION = '2.4.4';
  var DEFAULT_API = '/.netlify/functions/member-admin';
  var ROOT_ID = 'igdc-member-admin-root';
  var STYLE_ID = 'igdc-member-admin-style-v2';

  var STATE = {
    opened: false,
    tab: 'member-home',
    me: null,
    members: [],
    notices: [],
    questions: [],
    reviewDocs: [],
    loadingReview: false,
    loading: false,
    error: '',
    query: '',
    page: 0,
    total: 0,
    lastFocus: null
  };

  var ROLE_LEVEL = {
    guest: 0,
    member: 1,
    member_standard: 2,
    member_premium: 3,
    special_menber: 4,
    commerce_manager: 5,
    site_manager_home_om: 10,
    site_manager_home_op: 11,
    site_manager_home: 12,
    site_manager_distribution_om: 10,
    site_manager_distribution_op: 11,
    site_manager_distribution: 12,
    site_manager_donation_om: 10,
    site_manager_donation_op: 11,
    site_manager_donation: 12,
    site_manager_mediahub_om: 10,
    site_manager_mediahub_op: 11,
    site_manager_mediahub: 12,
    site_manager_networkhub_om: 10,
    site_manager_networkhub_op: 11,
    site_manager_networkhub: 12,
    site_manager_socialnetwork_om: 10,
    site_manager_socialnetwork_op: 11,
    site_manager_socialnetwork: 12,
    site_manager_tour_om: 10,
    site_manager_tour_op: 11,
    site_manager_tour: 12,
    coordinator_director: 13,
    site_manager_director: 14,
    director: 15,
    admin: 20,
    owner: 30
  };

  var LABELS = {
    ko: {
      title: '🔒 회원전용',
      desc: '로그인 권한에 따라 회원 서비스와 관리자 관리 기능이 열립니다.',
      login: 'OS-Login',
      renew: '세션 갱신',
      close: '닫기',
      refresh: '새로고침',
      openPage: '전용 페이지 열기',
      memberPage: '회원 페이지',
      adminPage: '관리 페이지',
      loading: '불러오는 중입니다.',
      noAccess: '관리자 권한이 필요한 영역입니다.',
      apiMissing: '회원 관리 API가 연결되지 않았습니다.',
      searchPlaceholder: '이름, 이메일, user_id 검색',
      tabs: {
        memberHome: '회원 홈',
        submit: '서류 제출',
        question: '질문/문의',
        notice: '공지사항',
        adminMembers: '회원 목록',
        adminQueue: '승급 검토',
        adminNotice: '답글/공지 관리'
      }
    },
    en: {
      title: '🔒 Members Only',
      desc: 'Member services and admin tools open according to the signed-in role.',
      login: 'OS-Login',
      renew: 'Renew session',
      close: 'Close',
      refresh: 'Refresh',
      openPage: 'Open private page',
      memberPage: 'Member page',
      adminPage: 'Admin page',
      loading: 'Loading.',
      noAccess: 'Admin permission is required.',
      apiMissing: 'Member admin API is not connected.',
      searchPlaceholder: 'Search name, email, or user_id',
      tabs: {
        memberHome: 'Member Home',
        submit: 'Documents',
        question: 'Questions',
        notice: 'Notices',
        adminMembers: 'Members',
        adminQueue: 'Review Documents',
        adminNotice: 'Replies/Notices'
      }
    }
  };

  function cfg() {
    return window.IGDC_MEMBER_ADMIN_CONFIG || {};
  }
  function apiBase() {
    return String(cfg().apiBase || DEFAULT_API);
  }
  function lang() {
    try {
      var v = (document.documentElement.getAttribute('lang') || localStorage.getItem('igdc_lang') || navigator.language || 'en').toLowerCase();
      if (v.indexOf('ko') === 0) return 'ko';
    } catch (e) {}
    return 'en';
  }
  function t() { return LABELS[lang()] || LABELS.en; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>'"]/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];
    });
  }
  function safeJsonParse(v, fallback) {
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }
  function decodeJwtPayload(token) {
    try {
      var p = String(token || '').split('.');
      if (p.length < 2) return null;
      var b = p[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(atob(b));
    } catch (e) { return null; }
  }
  function tokenExpiry(token) {
    var p = decodeJwtPayload(token);
    return p && p.exp ? Number(p.exp) : 0;
  }
  function isJwtLike(token) {
    return !!token && typeof token === 'string' && token.split('.').length === 3 && !!decodeJwtPayload(token);
  }
  function tokenUsable(token) {
    if (!isJwtLike(token)) return false;
    var exp = tokenExpiry(token);
    return !!exp && exp * 1000 > Date.now() + 15000;
  }
  function cleanDisplayName(v, fallback) {
    var s = String(v || '').trim();
    if (!s || /[�]/.test(s) || /Ã|Â|ì|í|ë|ê|ð/.test(s)) return fallback || 'Member';
    return s;
  }
  function normalizeRole(v) { return String(v || '').trim().toLowerCase().replace(/[\s.]+/g, '_'); }
  function unique(arr) {
    var map = {};
    return (arr || []).map(normalizeRole).filter(function (x) {
      if (!x || map[x]) return false;
      map[x] = true;
      return true;
    });
  }
  function roleLevel(role) { return ROLE_LEVEL[normalizeRole(role)] || 0; }
  function highestRole(roles) {
    roles = unique(roles);
    if (!roles.length) return 'guest';
    return roles.sort(function (a,b) { return roleLevel(b) - roleLevel(a); })[0];
  }
  function isManagerRole(role) {
    role = normalizeRole(role);
    return role === 'owner' || role === 'admin' || role === 'director' || role === 'site_manager_director';
  }
  function canAdmin(roles) {
    roles = unique(roles);
    return roles.some(isManagerRole);
  }
  function managerRole(roles) {
    roles = unique(roles).filter(isManagerRole);
    return highestRole(roles);
  }
  function canViewOrManageRole(myRoles, targetRoles) {
    var mine = managerRole(myRoles);
    if (!isManagerRole(mine)) return false;
    var target = highestRole(targetRoles || []);
    if (mine === 'owner') return true;
    if (mine === 'admin') return target !== 'owner';
    return roleLevel(target) < roleLevel(mine);
  }
  function canAssignRole(myRoles, targetRole) {
    var mine = managerRole(myRoles);
    targetRole = normalizeRole(targetRole);
    if (!isManagerRole(mine)) return false;
    if (mine === 'owner') return true;
    if (mine === 'admin') return targetRole !== 'owner';
    return roleLevel(targetRole) < roleLevel(mine);
  }

  function topLoginButton() {
    try {
      return document.getElementById('osLoginBtn') || document.querySelector('[data-os-login], .os-login, [data-login]');
    } catch (e) { return null; }
  }
  function topLoginState() {
    var btn = topLoginButton();
    var label = '';
    try { label = btn ? String(btn.textContent || btn.value || '').trim() : ''; } catch (e) {}
    var low = label.toLowerCase();
    var saysLogout = !!(low && (low.indexOf('logout') >= 0 || label.indexOf('로그아웃') >= 0));
    var saysLogin = !!(low && !saysLogout && (low.indexOf('login') >= 0 || label.indexOf('로그인') >= 0));
    return { button: btn, label: label, saysLogin: saysLogin, saysLogout: saysLogout };
  }
  function topLoginLooksActive() {
    var st = topLoginState();
    if (st.saysLogout) return true;
    if (st.saysLogin) return false;
    try {
      var badge = document.getElementById('igtcRoleText3') || document.querySelector('[data-role], .role-badge, .igdc-role, .igtc-role');
      var r = badge && String(badge.textContent || badge.getAttribute('data-role') || '').trim().toLowerCase();
      if (r && r !== 'guest' && r !== '게스트') return true;
    } catch (e) {}
    try {
      var tok = storedTokens && storedTokens();
      if (tok && (tok.id_token || tok.idToken || tok.access_token || tok.__raw || tok.raw)) return true;
    } catch (e) {}
    return false;
  }
  function topLoginLooksLoggedOut() {
    var st = topLoginState();
    return !!st.saysLogin && !st.saysLogout;
  }
  function topLoginActionLabel() {
    var st = topLoginState();
    if (st.label) return st.label;
    return isLoggedIn() ? 'OS-Logout' : 'OS-Login';
  }
  function clickTopLoginButton() {
    var btn = topLoginButton();
    if (btn) { btn.click(); return true; }
    return false;
  }
  function roleEngineRole() {
    try { if (typeof window.getUserRole === 'function') return window.getUserRole(); } catch (e) {}
    return '';
  }
  function roleEngineHas(perm) {
    try {
      if (!window.IGDC_ROLE_PERM || typeof window.IGDC_ROLE_PERM.hasPermission !== 'function') return false;
      return window.IGDC_ROLE_PERM.hasPermission(roleEngineRole(), window.IGDC_ROLE_PERM.PERMISSIONS[perm]);
    } catch (e) { return false; }
  }
  function readRoles() {
    var roles = [];
    try { if (window.__IGDC_ROLE) roles.push(window.__IGDC_ROLE); } catch (e) {}
    try { if (roleEngineRole()) roles.push(roleEngineRole()); } catch (e) {}
    try { if (window.__IGDC_ROLE_LABEL) roles.push(window.__IGDC_ROLE_LABEL); } catch (e) {}
    try { if (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.role) roles.push(document.documentElement.dataset.role); } catch (e) {}
    try {
      var badge = document.getElementById('igtcRoleText3') || document.querySelector('[data-role], .role-badge, .igdc-role, .igtc-role');
      if (badge && badge.textContent) roles.push(badge.textContent);
      if (badge && badge.getAttribute && badge.getAttribute('data-role')) roles.push(badge.getAttribute('data-role'));
    } catch (e) {}
    try {
      var stored = localStorage.getItem('igdc_role') || localStorage.getItem('igdc_roles');
      var storedLabel = localStorage.getItem('igdc_role_label');
      if (stored) roles = roles.concat(stored.indexOf('[') === 0 ? safeJsonParse(stored, []) : stored.split(','));
      if (storedLabel) roles.push(storedLabel);
    } catch (e) {}
    try {
      if (window.osAuth && typeof window.osAuth.getIdTokenPayload === 'function') {
        var p = window.osAuth.getIdTokenPayload() || {};
        var keys = [cfg().rolesClaim, 'https://igdcglobal.com/roles', 'https://example.com/roles', 'https://osu/roles', 'roles', 'role', 'permissions'];
        keys.forEach(function (k) {
          if (!k) return;
          var v = p[k];
          if (Array.isArray(v)) roles = roles.concat(v);
          else if (typeof v === 'string') roles = roles.concat(v.split(','));
        });
      }
    } catch (e) {}
    roles = unique(roles);
    if ((!roles.length || roles.indexOf('guest') !== -1) && topLoginLooksActive()) {
      roles = roles.filter(function (r) { return r !== 'guest'; });
      roles.push('member');
    }
    return unique(roles);
  }
  function hasPlatformRole() {
    if (topLoginLooksLoggedOut()) return false;
    var roles = readRoles();
    if (roles.length > 0 && roles.indexOf('guest') === -1) return true;
    return topLoginLooksActive();
  }
  function readStorageItem(key) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function activeToken() {
    var candidates = [];
    try {
      if (window.osAuth && typeof window.osAuth.getIdTokenClaims === 'function') {
        var c = window.osAuth.getIdTokenClaims();
        if (c) candidates.push(c.__raw || c.raw || c.id_token);
      }
    } catch (e) {}
    try { if (window.osAuth && typeof window.osAuth.getIdToken === 'function') candidates.push(window.osAuth.getIdToken()); } catch (e) {}
    try {
      var tok = storedTokens();
      if (tok) {
        candidates.push(tok.id_token);
        candidates.push(tok.idToken);
        candidates.push(tok.__raw);
        candidates.push(tok.raw);
        candidates.push(tok.access_token);
      }
      candidates.push(readStorageItem('igdc_id_token'));
      candidates.push(readStorageItem('id_token'));
      candidates.push(readStorageItem('auth0_id_token'));
      candidates.push(readStorageItem('igdc_access_token'));
      candidates.push(readStorageItem('access_token'));
    } catch (e) {}
    for (var i = 0; i < candidates.length; i++) {
      if (tokenUsable(candidates[i])) return candidates[i];
    }
    return '';
  }
  function isLoggedIn() {
    if (topLoginLooksLoggedOut()) return false;
    try { if (window.osAuth && typeof window.osAuth.isAuthenticated === 'function' && window.osAuth.isAuthenticated()) return true; } catch (e) {}
    return hasPlatformRole() || topLoginLooksActive();
  }
  function storedTokens() {
    var keys = ['osauth.tokens.v2', 'igdc.tokens', 'igdc_auth_tokens', 'auth0_tokens', 'auth0spa'];
    var stores = [];
    try { stores.push(localStorage); } catch (e) {}
    try { stores.push(sessionStorage); } catch (e) {}
    for (var sidx = 0; sidx < stores.length; sidx++) {
      for (var i = 0; i < keys.length; i++) {
        try {
          var raw = stores[sidx].getItem(keys[i]);
          if (!raw) continue;
          var data = safeJsonParse(raw, null);
          if (data && (data.id_token || data.idToken || data.access_token || data.__raw || data.raw)) return data;
        } catch (e) {}
      }
    }
    return null;
  }
  function idToken() { return activeToken(); }
  function hasValidToken() { return !!activeToken(); }
  function userProfile() {
    var forceLoggedOut = topLoginLooksLoggedOut();
    var p = {};
    try { if (window.osAuth && typeof window.osAuth.getUser === 'function') p = window.osAuth.getUser() || {}; } catch (e) {}
    try { if (!p.email && window.osAuth && typeof window.osAuth.getIdTokenPayload === 'function') p = window.osAuth.getIdTokenPayload() || p; } catch (e) {}
    var roles = readRoles();
    var email = p.email || '';
    var display = cleanDisplayName(p.name || p.nickname || '', '');
    if (!display || normalizeRole(display) === normalizeRole(email)) display = '';
    if ((!roles.length || roles.indexOf('guest') !== -1) && topLoginLooksActive()) {
      roles = roles.filter(function (r) { return r !== 'guest'; });
      roles.push('member');
    }
    return {
      name: display || email || 'Member',
      email: email,
      user_id: p.sub || p.user_id || '',
      roles: roles,
      role: highestRole(roles),
      admin: canAdmin(roles)
    };
  }
  function openLogin() {
    if (topLoginLooksActive()) {
      try { alert('이미 로그인되어 있습니다.'); } catch (e) {}
      return;
    }
    if (typeof window.osLogin === 'function') { window.osLogin(); return; }
    if (typeof window.loginWithRedirect === 'function') { window.loginWithRedirect(); return; }
    try { document.dispatchEvent(new CustomEvent('igdc:login-request')); } catch (e) {}
    var btn = document.getElementById('osLoginBtn') || document.querySelector('[data-os-login], .os-login, [data-login]');
    if (btn) {
      var txt = String(btn.textContent || '').toLowerCase();
      if (txt.indexOf('logout') < 0 && txt.indexOf('로그아웃') < 0) btn.click();
    }
  }
  function targetPage() {
    return canAdmin(readRoles()) ? (cfg().adminPage || 'admin.html') : (cfg().memberPage || 'member.html');
  }
  function openTarget() {
    var url = targetPage();
    var frame = document.getElementById('mainFrame') || document.querySelector('iframe[name="mainFrame"]');
    if (frame) frame.src = url;
    else window.location.href = url;
  }
  function headers() {
    var h = {'Content-Type':'application/json'};
    var tok = idToken();
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
  }
  function apiGet(params) {
    var q = new URLSearchParams(params || {}).toString();
    return fetch(apiBase() + (q ? '?' + q : ''), {method:'GET', credentials:'include', headers:headers()}).then(readJson);
  }
  function apiPost(action, body) {
    body = body || {};
    body.action = action;
    return fetch(apiBase(), {method:'POST', credentials:'include', headers:headers(), body:JSON.stringify(body)}).then(readJson);
  }
  function readJson(res) {
    return res.text().then(function (txt) {
      var data = txt ? safeJsonParse(txt, {ok:false, error:txt}) : {};
      if (!res.ok || data.ok === false) throw new Error(data.error || data.message || ('HTTP ' + res.status));
      return data;
    });
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ''+
      '#'+ROOT_ID+'{position:fixed;inset:0;z-index:2147483645;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111}'+
      '#'+ROOT_ID+'[hidden]{display:none!important}'+
      '#'+ROOT_ID+' .igdc-ma-mask{position:absolute;inset:0;background:rgba(0,0,0,.52)}'+
      '#'+ROOT_ID+' .igdc-ma-modal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1180px,94vw);height:min(760px,88vh);background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.34);display:flex;overflow:hidden}'+
      '#'+ROOT_ID+' .igdc-ma-side{width:248px;background:#0b2440;color:#fff;padding:18px;display:flex;flex-direction:column;gap:10px}'+
      '#'+ROOT_ID+' .igdc-ma-side h3{font-size:19px;margin:0 0 4px;color:#fff}'+
      '#'+ROOT_ID+' .igdc-ma-side p{font-size:12px;line-height:1.45;margin:0 0 10px;color:#cfe3f7}'+
      '#'+ROOT_ID+' .igdc-ma-tab{display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;border-radius:10px;padding:10px;cursor:pointer;font-weight:700}'+
      '#'+ROOT_ID+' .igdc-ma-tab.active{background:#fff;color:#0b2440}'+
      '#'+ROOT_ID+' .igdc-ma-body{flex:1;min-width:0;display:flex;flex-direction:column;background:#f6f8fb}'+
      '#'+ROOT_ID+' .igdc-ma-top{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border-bottom:1px solid #e5e8ee;padding:14px 18px}'+
      '#'+ROOT_ID+' .igdc-ma-top h2{font-size:20px;margin:0;color:#0b3f74}'+
      '#'+ROOT_ID+' .igdc-ma-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}'+
      '#'+ROOT_ID+' button{border:1px solid #d0d7de;border-radius:9px;padding:7px 10px;background:#fff;cursor:pointer;font-weight:700}'+
      '#'+ROOT_ID+' button.primary{background:#0b74de;color:#fff;border-color:#0b74de}'+
      '#'+ROOT_ID+' button.danger{background:#b42318;color:#fff;border-color:#b42318}'+
      '#'+ROOT_ID+' button:disabled{opacity:.5;cursor:not-allowed}'+
      '#'+ROOT_ID+' .igdc-ma-content{padding:16px 18px;overflow:auto;flex:1}'+
      '#'+ROOT_ID+' .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}'+
      '#'+ROOT_ID+' .card{background:#fff;border:1px solid #e5e8ee;border-radius:14px;padding:14px;box-shadow:0 4px 18px rgba(15,23,42,.04)}'+
      '#'+ROOT_ID+' .card h4{margin:0 0 8px;font-size:15px;color:#0b3f74}'+
      '#'+ROOT_ID+' .muted{color:#667085;font-size:13px;line-height:1.45}'+
      '#'+ROOT_ID+' .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'+
      '#'+ROOT_ID+' input,#'+ROOT_ID+' select,#'+ROOT_ID+' textarea{border:1px solid #d0d7de;border-radius:9px;padding:9px;width:100%;box-sizing:border-box;background:#fff}'+
      '#'+ROOT_ID+' textarea{min-height:110px;resize:vertical}'+
      '#'+ROOT_ID+' table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;table-layout:fixed}'+
      '#'+ROOT_ID+' th,#'+ROOT_ID+' td{border-bottom:1px solid #edf0f5;padding:7px 8px;text-align:left;font-size:13px;vertical-align:middle;line-height:1.3}'+
      '#'+ROOT_ID+' th{background:#eef4fb;color:#0b3f74;font-size:12px;position:sticky;top:0;z-index:1}'+
      '#'+ROOT_ID+' .igdc-ma-member-card{padding:10px 12px!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-tools{margin:8px 0 10px!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-list{border:1px solid #e5e8ee;border-radius:12px;overflow:hidden;background:#fff;display:block!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-head,#'+ROOT_ID+' .igdc-ma-member-row{display:grid!important;grid-template-columns:minmax(210px,1.25fr) minmax(170px,1.05fr) minmax(145px,.85fr) minmax(170px,.9fr) minmax(150px,.9fr)!important;align-items:center!important;gap:6px!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-head{background:#eef4fb;color:#0b3f74;font-size:12px;font-weight:800;padding:7px 10px!important;min-height:30px!important;line-height:1.2!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row{padding:5px 10px!important;border-top:1px solid #edf0f5!important;min-height:34px!important;height:auto!important;max-height:none!important;margin:0!important;line-height:1.18!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row>*{margin:0!important;padding-top:0!important;padding-bottom:0!important;min-height:0!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row:hover{background:#f8fafc}'+
      '#'+ROOT_ID+' .igdc-ma-member-id{font-size:11.5px!important;line-height:1.18!important;word-break:break-all;color:#344054}'+
      '#'+ROOT_ID+' .igdc-ma-member-name{font-size:12.5px!important;line-height:1.18!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-name .muted{font-size:12px!important;line-height:1.18!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-start}'+
      '#'+ROOT_ID+' .igdc-ma-member-actions button{padding:4px 7px!important;font-size:11.5px!important;border-radius:6px!important;line-height:1.15!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row select{padding:4px 7px!important;font-size:11.5px!important;border-radius:6px!important;height:30px!important;line-height:1.15!important}'+      '#'+ROOT_ID+' .igdc-ma-review-list{border:1px solid #e5e8ee;border-radius:12px;overflow:hidden;background:#fff;display:block!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-head,#'+ROOT_ID+' .igdc-ma-review-row{display:grid!important;grid-template-columns:minmax(210px,1.2fr) minmax(170px,1fr) minmax(130px,.75fr) minmax(130px,.75fr) minmax(190px,1fr)!important;align-items:center!important;gap:6px!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-head{background:#eef4fb;color:#0b3f74;font-size:12px;font-weight:800;padding:7px 10px!important;min-height:30px!important;line-height:1.2!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-row{padding:6px 10px!important;border-top:1px solid #edf0f5!important;min-height:36px!important;margin:0!important;line-height:1.2!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-row>*{margin:0!important;padding-top:0!important;padding-bottom:0!important;min-height:0!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-row:hover{background:#f8fafc}'+

      '#'+ROOT_ID+' .badge{display:inline-block;border-radius:999px;background:#eef4fb;color:#0b3f74;padding:2px 7px;margin:1px 2px;font-size:11px;font-weight:700}'+
      '#'+ROOT_ID+' .error{background:#fff1f0;color:#b42318;border:1px solid #ffccc7;border-radius:10px;padding:10px;margin-bottom:10px}'+
      '#'+ROOT_ID+' .ok{background:#ecfdf3;color:#027a48;border:1px solid #abefc6;border-radius:10px;padding:10px;margin-bottom:10px}'+
      '@media(max-width:760px){#'+ROOT_ID+' .igdc-ma-modal{width:96vw;height:92vh;flex-direction:column}#'+ROOT_ID+' .igdc-ma-side{width:auto;max-height:210px;overflow:auto}#'+ROOT_ID+' .grid{grid-template-columns:1fr}#'+ROOT_ID+' .igdc-ma-member-head{display:none}#'+ROOT_ID+' .igdc-ma-member-row{grid-template-columns:1fr;gap:5px}#'+ROOT_ID+' th:nth-child(1),#'+ROOT_ID+' td:nth-child(1){display:none}}';
    document.head.appendChild(style);
  }
  function root() {
    ensureStyle();
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = ROOT_ID;
    el.hidden = true;
    el.innerHTML = '<div class="igdc-ma-mask" data-close></div><section class="igdc-ma-modal" role="dialog" aria-modal="true" aria-labelledby="igdc-member-admin-title"></section>';
    document.body.appendChild(el);
    el.addEventListener('click', handleClick);
    el.addEventListener('change', handleChange);
    el.addEventListener('submit', handleSubmit);
    return el;
  }
  function setTab(tab) {
    STATE.tab = tab;
    render();
    if (tab === 'admin-members') loadMembers();
    if (tab === 'admin-queue') loadReviewDocs();
  }
  function setError(msg) { STATE.error = msg || ''; render(); }
  function render() {
    var el = root();
    var modal = el.querySelector('.igdc-ma-modal');
    var me = STATE.me || userProfile();
    var labels = t();
    var admin = !!me.admin;
    modal.innerHTML = sideHtml(labels, me, admin) + bodyHtml(labels, me, admin);
  }
  function sideHtml(labels, me, admin) {
    function tab(id, text, adminOnly) {
      if (adminOnly && !admin) return '';
      return '<button type="button" class="igdc-ma-tab '+(STATE.tab===id?'active':'')+'" data-tab="'+id+'">'+esc(text)+'</button>';
    }
    return '<aside class="igdc-ma-side">'+
      '<h3 id="igdc-member-admin-title">'+esc(labels.title)+'</h3>'+
      '<p>'+esc(labels.desc)+'</p>'+
      '<p><b>'+esc(me.name || me.email || me.user_id || 'Member')+'</b>'+((me.email && normalizeRole(me.email)!==normalizeRole(me.name))?'<br>'+esc(me.email):'')+(!me.email && me.user_id?'<br>'+esc(me.user_id):'')+'<br><span class="badge">'+esc(me.role || 'guest')+'</span></p>'+
      tab('member-home', labels.tabs.memberHome) +
      tab('submit', labels.tabs.submit) +
      tab('question', labels.tabs.question) +
      tab('notice', labels.tabs.notice) +
      tab('admin-members', labels.tabs.adminMembers, true) +
      tab('admin-queue', labels.tabs.adminQueue, true) +
      tab('admin-notice', labels.tabs.adminNotice, true) +
    '</aside>';
  }
  function bodyHtml(labels, me, admin) {
    return '<main class="igdc-ma-body">'+
      '<div class="igdc-ma-top"><div><h2>'+esc(titleForTab(labels))+'</h2><div class="muted">IGDC Member/Admin Modal v'+VERSION+'</div></div>'+
      '<div class="igdc-ma-actions">'+
        '<button type="button" class="'+(isLoggedIn()?'':'primary')+'" data-action="top-os-login">'+esc(topLoginActionLabel())+'</button>'+
        '<button type="button" data-action="open-page">'+esc(admin?labels.adminPage:labels.memberPage)+'</button>'+
        '<button type="button" data-close>'+esc(labels.close)+'</button>'+
      '</div></div>'+
      '<div class="igdc-ma-content">'+
        (STATE.error ? '<div class="error">'+esc(STATE.error)+'</div>' : '')+
        renderTab(labels, me, admin)+
      '</div></main>';
  }
  function titleForTab(labels) {
    var m = labels.tabs;
    return ({'member-home':m.memberHome,'submit':m.submit,'question':m.question,'notice':m.notice,'admin-members':m.adminMembers,'admin-queue':m.adminQueue,'admin-notice':m.adminNotice})[STATE.tab] || m.memberHome;
  }
  function renderTab(labels, me, admin) {
    if (STATE.tab.indexOf('admin-') === 0 && !admin) return '<div class="card"><h4>'+esc(labels.noAccess)+'</h4></div>';
    if (STATE.tab === 'member-home') return memberHomeHtml(me);
    if (STATE.tab === 'submit') return submitHtml();
    if (STATE.tab === 'question') return questionHtml(admin);
    if (STATE.tab === 'notice') return noticeHtml(admin);
    if (STATE.tab === 'admin-members') return adminMembersHtml(labels);
    if (STATE.tab === 'admin-queue') return adminQueueHtml(labels);
    if (STATE.tab === 'admin-notice') return adminNoticeHtml();
    return '';
  }
  function memberHomeHtml(me) {
    var canStandard = roleEngineHas('APPLY_STANDARD') || roleLevel(me.role) >= 1;
    var canPremium = roleEngineHas('APPLY_PREMIUM') || roleLevel(me.role) >= 2;
    var canCommerce = roleEngineHas('APPLY_COMMERCE') || roleLevel(me.role) >= 3;
    return '<div class="grid">'+
      '<div class="card"><h4>회원 상태</h4><div class="muted">현재 역할: <b>'+esc(me.role)+'</b><br>일반 회원은 미디어 콘텐츠 구매/열람 중심으로 사용합니다.</div></div>'+
      '<div class="card"><h4>프리미엄/스페셜 회원</h4><div class="muted">주소·구매 정보 연동이 필요한 회원 등급입니다. 서버 승인 및 M2M 검토 후 승급됩니다.</div><br><button '+(!canPremium?'disabled':'')+' data-action="request-upgrade" data-role="premium">프리미엄 신청</button></div>'+
      '<div class="card"><h4>커머스/상위 권한</h4><div class="muted">상품·커머스·상위 롤은 관리자 검토 후 부여합니다.</div><br><button '+(!canCommerce?'disabled':'')+' data-action="request-upgrade" data-role="commerce">커머스 신청</button></div>'+
      '<div class="card"><h4>스탠다드 신청</h4><div class="muted">기본 회원 서비스 확장 신청입니다.</div><br><button '+(!canStandard?'disabled':'')+' data-action="request-upgrade" data-role="standard">스탠다드 신청</button></div>'+
      '<div class="card"><h4>회원 페이지</h4><div class="muted">전용 문서, 문의, 제출 상태를 확인합니다.</div><br><button class="primary" data-action="open-page">회원 페이지 열기</button></div>'+
      (me.admin ? '<div class="card"><h4>관리자 회원 목록</h4><div class="muted">owner/admin 권한으로 OS0/Auth0 회원 목록을 불러오고 롤을 관리합니다.</div><br><button class="primary" data-tab="admin-members">회원 목록 열기</button> <button data-tab="admin-queue">승급 검토 열기</button></div>' : '')+
      (isLoggedIn()
        ? '<div class="card"><h4>로그인 상태</h4><div class="muted">사이트 로그인과 회원전용 모달이 연동되어 있습니다.<br>사이트 역할 표시: <b>'+esc(me.role || 'member')+'</b><br>'+(hasValidToken()?'Auth0 ID 토큰이 정상 연결되어 있습니다.':'회원 화면은 이용 가능하지만, 관리자 회원 목록 API에는 세션 토큰 갱신이 필요할 수 있습니다.')+'</div></div>'
        : '<div class="card"><h4>로그인</h4><div class="muted">회원전용 영역은 로그인 후 사용할 수 있습니다.</div><br><button data-action="login">OS-Login</button></div>')+
    '</div>';
  }
  function submitHtml() {
    return '<form class="card" data-form="document-submit"><h4>서류 제출</h4><div class="muted">회원 서류/검토 자료를 제출합니다. 실제 저장은 서버 API 또는 기존 제출 엔진과 연결됩니다.</div><br>'+ 
      '<label>제목<input name="title" required placeholder="제출 제목"></label><br><br>'+ 
      '<label>내용<textarea name="body" required placeholder="제출 내용"></textarea></label><br><br>'+ 
      '<button class="primary" type="submit">제출</button></form>';
  }
  function questionHtml(admin) {
    return '<form class="card" data-form="question-submit"><h4>질문/문의</h4><div class="muted">일반 회원은 질문을 등록할 수 있고, 답글은 관리자 권한에서 활성화됩니다.</div><br>'+ 
      '<label>질문 제목<input name="title" required placeholder="질문 제목"></label><br><br>'+ 
      '<label>질문 내용<textarea name="body" required placeholder="질문 내용"></textarea></label><br><br>'+ 
      '<button class="primary" type="submit">질문 등록</button> '+(admin?'<button type="button" data-tab="admin-notice">답글 관리 열기</button>':'')+'</form>';
  }
  function noticeHtml(admin) {
    return '<div class="card"><h4>공지사항</h4><div class="muted">공지 목록은 서버 API 연결 시 자동으로 표시됩니다.</div>'+ 
      (admin?'<br><button data-tab="admin-notice">공지 작성/답글 관리</button>':'')+'</div>';
  }
  function rolesForSelect(current) {
    var roles = (cfg().roleOptions || [
      'guest',
      'member',
      'member_standard',
      'member_premium',
      'special_menber',
      'commerce_manager',
      'site_manager.home.om',
      'site_manager.home.op',
      'site_manager.home',
      'site_manager.distribution.om',
      'site_manager.distribution.op',
      'site_manager.distribution',
      'site_manager.mediahub.om',
      'site_manager.mediahub.op',
      'site_manager.mediahub',
      'site_manager.networkhub.om',
      'site_manager.networkhub.op',
      'site_manager.networkhub',
      'site_manager.socialnetwork.om',
      'site_manager.socialnetwork.op',
      'site_manager.socialnetwork',
      'site_manager.tour.om',
      'site_manager.tour.op',
      'site_manager.tour',
      'site_manager.donation.om',
      'site_manager.donation.op',
      'site_manager.donation',
      'coordinator_director',
      'site_manager_director',
      'director',
      'admin',
      'owner'
    ]);
    var myRoles = (STATE.me && STATE.me.roles) || readRoles();
    var filtered = roles.filter(function (r) { return canAssignRole(myRoles, r); });
    if (current && filtered.map(normalizeRole).indexOf(normalizeRole(current)) < 0 && canAssignRole(myRoles, current)) filtered.unshift(current);
    return filtered.map(function (r) { return '<option value="'+esc(r)+'" '+(normalizeRole(current)===normalizeRole(r)?'selected':'')+'>'+esc(r)+'</option>'; }).join('');
  }
  function adminMembersHtml(labels) {
    var myRoles = (STATE.me && STATE.me.roles) || readRoles();
    var visibleMembers = (STATE.members || []).filter(function (m) {
      var roles = unique(m.roles || (m.app_metadata && m.app_metadata.roles) || []);
      return canViewOrManageRole(myRoles, roles);
    });
    var rows = visibleMembers.map(function (m) {
      var roles = unique(m.roles || (m.app_metadata && m.app_metadata.roles) || []);
      var role = highestRole(roles);
      var canManage = canViewOrManageRole(myRoles, roles);
      var options = rolesForSelect(role);
      return '<div class="igdc-ma-member-row" data-user-id="'+esc(m.user_id || m.id || '')+'">'+
        '<div class="igdc-ma-member-id">'+esc(m.user_id || '')+'</div>'+ 
        '<div class="igdc-ma-member-name"><b>'+esc(m.name || m.nickname || '')+'</b><br><span class="muted">'+esc(m.email || '')+'</span></div>'+ 
        '<div>'+roles.map(function (r) { return '<span class="badge">'+esc(r)+'</span>'; }).join('')+'</div>'+ 
        '<div>'+(canManage && options ? '<select data-role-select>'+options+'</select>' : '<span class="muted">권한 없음</span>')+'</div>'+ 
        '<div class="igdc-ma-member-actions">'+(canManage && options ? '<button data-action="save-role">변경</button><button data-action="block-user" class="danger">차단</button>' : '')+'</div>'+ 
      '</div>';
    }).join('');
    return '<div class="card igdc-ma-member-card"><div class="row" style="justify-content:space-between"><h4>OS0/Auth0 회원 목록</h4><button data-action="reload-members">'+esc(labels.refresh)+'</button></div>'+ 
      '<div class="muted" style="margin-bottom:8px">현재 롤 확인, 변경 롤 선택, 차단 관리를 이 목록에서 처리합니다. owner만 owner를 볼 수 있고, admin은 owner를 볼 수 없습니다. director/site_manager_director는 자기보다 아래 롤만 관리합니다.</div>'+
      '<div class="row igdc-ma-member-tools"><input id="igdc-member-search" value="'+esc(STATE.query)+'" placeholder="'+esc(labels.searchPlaceholder)+'"><button data-action="search-members">검색</button></div>'+ 
      (STATE.loading?'<div class="muted">'+esc(labels.loading)+'</div>':'')+
      '<div class="igdc-ma-member-list">'+
        '<div class="igdc-ma-member-head"><div>User ID</div><div>회원</div><div>현재 롤</div><div>변경 롤/승급 검토</div><div>관리</div></div>'+
        (rows || '<div class="igdc-ma-member-row"><div class="muted" style="grid-column:1/-1">관리 권한으로 볼 수 있는 회원이 없거나 API 연결 대기 중입니다.</div></div>')+
      '</div>'+ 
      '<div class="muted" style="margin-top:8px">표시 '+esc(visibleMembers.length)+'명 / 서버 조회 '+esc(STATE.total || STATE.members.length)+'명 / 페이지 '+esc(STATE.page + 1)+'</div></div>';
  }
  function docRoles(doc) {
    return unique(
      doc.roles ||
      doc.user_roles ||
      doc.submitter_roles ||
      doc.current_roles ||
      (doc.user && doc.user.roles) ||
      (doc.app_metadata && doc.app_metadata.roles) ||
      []
    );
  }
  function docTargetRole(doc) {
    return normalizeRole(doc.target_role || doc.requested_role || doc.apply_role || doc.role || '');
  }
  function canReviewDoc(myRoles, doc) {
    var roles = docRoles(doc);
    var target = docTargetRole(doc);
    if (roles.length && !canViewOrManageRole(myRoles, roles)) return false;
    if (target && !canAssignRole(myRoles, target)) return false;
    return true;
  }
  function adminQueueHtml(labels) {
    var myRoles = (STATE.me && STATE.me.roles) || readRoles();
    var docs = (STATE.reviewDocs || []).filter(function (d) { return canReviewDoc(myRoles, d); });
    var rows = docs.map(function (d) {
      var id = d.id || d.document_id || d.review_id || d.submission_id || '';
      var user = d.user || {};
      var email = d.email || user.email || d.user_email || '';
      var name = d.name || user.name || user.nickname || d.user_name || '';
      var title = d.title || d.subject || d.type || '제출 서류';
      var target = d.target_role || d.requested_role || d.apply_role || '';
      var status = d.status || d.review_status || 'pending';
      var date = d.created_at || d.updated_at || d.date || '';
      var fileUrl = d.file_url || d.url || d.download_url || d.attachment_url || '';
      return '<div class="igdc-ma-review-row" data-review-id="'+esc(id)+'">'+
        '<div><b>'+esc(title)+'</b><br><span class="muted">'+esc(name || email || d.user_id || '')+'</span></div>'+ 
        '<div>'+esc(email || d.user_id || '')+'</div>'+ 
        '<div>'+esc(target || '-')+'</div>'+ 
        '<div><span class="badge">'+esc(status)+'</span><br><span class="muted">'+esc(date)+'</span></div>'+ 
        '<div class="igdc-ma-member-actions">'+
          (fileUrl ? '<button data-action="open-review-doc" data-url="'+esc(fileUrl)+'">열람</button>' : '<button data-action="open-review-doc">상세</button>')+
          '<button data-action="approve-review-doc" class="primary">승인</button>'+
          '<button data-action="reject-review-doc" class="danger">반려</button>'+
        '</div>'+ 
      '</div>';
    }).join('');
    return '<div class="card igdc-ma-member-card"><div class="row" style="justify-content:space-between"><h4>승급 검토</h4><button data-action="reload-review-queue">새로고침</button></div>'+ 
      '<div class="muted" style="margin-bottom:8px">회원이 제출한 서류와 승급·권한 신청 자료를 검토하는 영역입니다. owner는 전체, admin은 owner 제외, director/site_manager_director는 자기보다 아래 롤의 제출 자료만 볼 수 있습니다.</div>'+ 
      (STATE.loadingReview ? '<div class="muted">불러오는 중입니다.</div>' : '')+
      '<div class="igdc-ma-review-list">'+
        '<div class="igdc-ma-review-head"><div>제출 서류</div><div>회원</div><div>요청 롤</div><div>상태</div><div>검토</div></div>'+ 
        (rows || '<div class="igdc-ma-review-row"><div class="muted" style="grid-column:1/-1">현재 권한으로 볼 수 있는 제출 서류가 없거나, 서류 검토 API 연결 대기 중입니다.</div></div>')+
      '</div>'+ 
      '<div class="muted" style="margin-top:8px">표시 '+esc(docs.length)+'건 / 서버 조회 '+esc((STATE.reviewDocs || []).length)+'건</div></div>';
  }
  function adminNoticeHtml() {
    return '<form class="card" data-form="admin-reply"><h4>답글/공지 관리</h4><div class="muted">관리자 권한에서만 답글 작성·공지 등록 버튼이 활성화됩니다.</div><br>'+ 
      '<label>대상/제목<input name="title" required placeholder="공지 제목 또는 답글 대상"></label><br><br>'+ 
      '<label>내용<textarea name="body" required placeholder="공지 또는 답글 내용"></textarea></label><br><br>'+ 
      '<button class="primary" type="submit">등록</button></form>';
  }
  function handleClick(ev) {
    var closeBtn = ev.target.closest('[data-close]');
    if (closeBtn) { ev.preventDefault(); close(); return; }
    var tab = ev.target.closest('[data-tab]');
    if (tab) { ev.preventDefault(); setTab(tab.getAttribute('data-tab')); return; }
    var action = ev.target.closest('[data-action]');
    if (!action) return;
    ev.preventDefault();
    var act = action.getAttribute('data-action');
    if (act === 'login') openLogin();
    else if (act === 'top-os-login') { if (!clickTopLoginButton()) openLogin(); }
    else if (act === 'open-page') openTarget();
    else if (act === 'reload-members') loadMembers();
    else if (act === 'search-members') { var s = document.getElementById('igdc-member-search'); STATE.query = s ? s.value : ''; STATE.page = 0; loadMembers(); }
    else if (act === 'save-role') saveRole(action.closest('[data-user-id]'));
    else if (act === 'block-user') blockUser(action.closest('[data-user-id]'));
    else if (act === 'request-upgrade') requestUpgrade(action.getAttribute('data-role'));
    else if (act === 'reload-review-queue') loadReviewDocs();
    else if (act === 'open-review-doc') openReviewDoc(action.closest('[data-review-id]'), action.getAttribute('data-url'));
    else if (act === 'approve-review-doc') reviewDoc(action.closest('[data-review-id]'), 'approve');
    else if (act === 'reject-review-doc') reviewDoc(action.closest('[data-review-id]'), 'reject');
  }
  function handleChange(ev) {
    if (ev.target && ev.target.id === 'igdc-member-search') STATE.query = ev.target.value;
  }
  function formDataObj(form) {
    var fd = new FormData(form), o = {};
    fd.forEach(function (v,k) { o[k] = v; });
    return o;
  }
  function handleSubmit(ev) {
    var form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    var type = form.getAttribute('data-form');
    var body = formDataObj(form);
    var action = type === 'document-submit' ? 'submit-document' : type === 'question-submit' ? 'submit-question' : 'admin-reply';
    apiPost(action, body).then(function () { setError(''); alert('등록되었습니다.'); form.reset(); }).catch(function (e) { setError(e.message); });
  }
  function loadReviewDocs() {
    if (!canAdmin(readRoles()) && !(STATE.me && STATE.me.admin)) return;
    if (!hasValidToken()) {
      STATE.loadingReview = false;
      STATE.reviewDocs = [];
      STATE.error = '사이트 역할은 확인되지만 Auth0 ID 토큰이 모달/API에 연결되지 않았습니다. 상단의 세션 갱신 후 승급 검토를 다시 열어야 합니다.';
      render();
      return;
    }
    STATE.loadingReview = true; STATE.error = ''; render();
    apiGet({action:'review-documents', page:0, per_page:cfg().reviewPerPage || 100}).then(function (data) {
      STATE.reviewDocs = data.documents || data.docs || data.items || data.queue || data.submissions || [];
      STATE.loadingReview = false;
      render();
    }).catch(function (e) {
      STATE.loadingReview = false;
      STATE.reviewDocs = [];
      STATE.error = e.message || '서류 검토 API 연결이 필요합니다.';
      render();
    });
  }
  function findReviewDoc(row) {
    if (!row) return null;
    var id = row.getAttribute('data-review-id');
    return (STATE.reviewDocs || []).filter(function (d) {
      return String(d.id || d.document_id || d.review_id || d.submission_id || '') === String(id || '');
    })[0] || null;
  }
  function openReviewDoc(row, url) {
    var doc = findReviewDoc(row) || {};
    var fileUrl = url || doc.file_url || doc.url || doc.download_url || doc.attachment_url || '';
    if (fileUrl) { window.open(fileUrl, '_blank', 'noopener'); return; }
    alert((doc.title || '제출 서류') + '\n\n' + (doc.body || doc.memo || doc.description || '열람 가능한 첨부 URL이 없습니다.'));
  }
  function reviewDoc(row, decision) {
    var doc = findReviewDoc(row);
    if (!doc) return;
    var id = doc.id || doc.document_id || doc.review_id || doc.submission_id;
    if (!id) return;
    if (!confirm((decision === 'approve' ? '승인' : '반려') + ' 처리할까요?')) return;
    apiPost('review-document', {id:id, decision:decision}).then(loadReviewDocs).catch(function (e) { setError(e.message); });
  }
  function loadMe() {
    STATE.me = userProfile();
    return apiGet({action:'me'}).then(function (data) {
      if (data && data.me) STATE.me = Object.assign({}, STATE.me, data.me, {admin: data.me.admin != null ? data.me.admin : STATE.me.admin});
    }).catch(function () {});
  }
  function loadMembers() {
    if (!canAdmin(readRoles()) && !(STATE.me && STATE.me.admin)) return;
    if (!hasValidToken()) {
      STATE.loading = false;
      STATE.members = [];
      STATE.total = 0;
      STATE.error = '사이트 역할은 확인되지만 Auth0 ID 토큰이 모달/API에 연결되지 않았습니다. 상단의 세션 갱신 후 회원 목록을 다시 열어야 합니다.';
      render();
      return;
    }
    STATE.loading = true; STATE.error = ''; render();
    apiGet({action:'members', q:STATE.query || '', page:STATE.page || 0, per_page:cfg().perPage || 50}).then(function (data) {
      STATE.members = data.users || data.members || [];
      STATE.total = data.total || STATE.members.length;
      STATE.loading = false;
      render();
    }).catch(function (e) {
      STATE.loading = false;
      STATE.error = (e.message || t().apiMissing) + (!hasValidToken() ? ' / 현재 로그인 세션 토큰이 만료되었거나 없습니다.' : '');
      render();
    });
  }
  function saveRole(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    var sel = row.querySelector('[data-role-select]');
    var role = sel && sel.value;
    if (!userId || !role) return;
    if (!canAssignRole((STATE.me && STATE.me.roles) || readRoles(), role)) { setError('현재 권한으로는 해당 롤로 변경할 수 없습니다.'); return; }
    if (!confirm('회원 롤을 '+role+' 로 변경할까요?')) return;
    apiPost('update-role', {user_id:userId, role:role}).then(loadMembers).catch(function (e) { setError(e.message); });
  }
  function blockUser(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    if (!userId) return;
    if (!confirm('이 회원을 차단/퇴출 처리할까요?')) return;
    apiPost('block-user', {user_id:userId, blocked:true}).then(loadMembers).catch(function (e) { setError(e.message); });
  }
  function requestUpgrade(role) {
    apiPost('request-upgrade', {role:role}).then(function () { alert('신청되었습니다.'); }).catch(function (e) { setError(e.message); });
  }
  function open(preferredTab) {
    if (topLoginLooksLoggedOut()) { openLogin(); return; }
    if (!isLoggedIn() && !hasValidToken()) { openLogin(); return; }
    STATE.lastFocus = document.activeElement;
    STATE.opened = true;
    STATE.tab = preferredTab || 'member-home';
    var el = root();
    el.hidden = false;
    loadMe().then(function () { render(); if (STATE.tab === 'admin-members') loadMembers(); if (STATE.tab === 'admin-queue') loadReviewDocs(); });
    render();
    try { el.querySelector('button').focus(); } catch (e) {}
  }
  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.hidden = true;
    STATE.opened = false;
    try { if (STATE.lastFocus && STATE.lastFocus.focus) STATE.lastFocus.focus(); } catch (e) {}
  }
  function bindTrigger() {
    if (bindTrigger.done) return;
    bindTrigger.done = true;
    document.addEventListener('click', function (ev) {
      var target = ev.target && ev.target.closest && ev.target.closest('#mo-btn,[data-member-modal="open"],.js-member-admin-modal-trigger,.js-seller-modal-trigger');
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation();
      open('member-home');
    }, true);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
  }

  window.IGDCMemberAdminModal = { __version: VERSION, open: open, close: close, loadMembers: loadMembers, targetPage: targetPage, isLoggedIn: isLoggedIn };
  window.openMemberAdminModal = open;
  window.closeMemberAdminModal = close;
  if (typeof window.openModal !== 'function') window.openModal = function () { open('member-home'); };
  if (typeof window.injectModal !== 'function') window.injectModal = function () { open('member-home'); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTrigger, {once:true});
  else bindTrigger();
})();
