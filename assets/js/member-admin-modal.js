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

  var VERSION = '2.5.1-roleclaims';
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
    hasMore: false,
    lastFocus: null
  };

  var ROLE_LEVEL = {
    guest: 0,
    member: 1,
    member_standard: 2,
    member_premium: 3,
    special_menber: 4,
    special_member: 4,
    commerce_manager: 5,
    site_manager: 12,
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
    super_admin: 25,
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

  var UI_TEXT = {
    ko: {
      memberStatusTitle:'회원 상태', currentRole:'현재 역할', memberStatusDesc:'일반 회원은 미디어 콘텐츠 구매/열람 중심으로 사용합니다.',
      premiumTitle:'프리미엄/스페셜 회원', premiumDesc:'주소·구매 정보 연동이 필요한 회원 등급입니다. 서버 승인 및 M2M 검토 후 승급됩니다.', premiumApply:'프리미엄 신청',
      commerceTitle:'커머스/상위 권한', commerceDesc:'상품·커머스·상위 롤은 관리자 검토 후 부여합니다.', commerceApply:'커머스 신청',
      standardTitle:'스탠다드 신청', standardDesc:'기본 회원 서비스 확장 신청입니다.', standardApply:'스탠다드 신청',
      memberPageTitle:'회원 페이지', memberPageDesc:'전용 문서, 문의, 제출 상태를 확인합니다.', openMemberPage:'회원 페이지 열기',
      adminMembersTitle:'관리자 회원 목록', adminMembersDesc:'실제 Auth0 세션으로 권한 범위의 회원 목록을 불러오고 롤을 관리합니다.', openMembers:'회원 목록 열기', openReview:'승급 검토 열기',
      loginStateTitle:'로그인 상태', siteRole:'사이트 역할 표시', tokenOk:'Auth0 ID 토큰이 정상 연결되어 있습니다.', tokenMissing:'역할 표시는 있으나 Auth0 ID 토큰이 없거나 만료되었습니다. 회원 목록 조회는 세션 갱신 후 가능합니다.', renewSession:'세션 갱신',
      loginTitle:'로그인', loginDesc:'회원전용 영역은 로그인 후 사용할 수 있습니다.',
      submitTitle:'서류 제출', submitDesc:'회원 서류/검토 자료를 제출합니다. 실제 저장은 서버 API 또는 기존 제출 엔진과 연결됩니다.', titleLabel:'제목', submitTitlePlaceholder:'제출 제목', bodyLabel:'내용', submitBodyPlaceholder:'제출 내용', submitButton:'제출',
      questionTitle:'질문/문의', questionDesc:'일반 회원은 질문을 등록할 수 있고, 답글은 관리자 권한에서 활성화됩니다.', qTitleLabel:'질문 제목', qTitlePlaceholder:'질문 제목', qBodyLabel:'질문 내용', qBodyPlaceholder:'질문 내용', qButton:'질문 등록', openReplyAdmin:'답글 관리 열기',
      noticeTitle:'공지사항', noticeDesc:'공지 목록은 서버 API 연결 시 자동으로 표시됩니다.', manageNotice:'공지 작성/답글 관리',
      noPermission:'권한 없음', save:'변경', block:'차단', adminMembersTitle2:'OS0/Auth0 회원 목록', adminMembersDesc2:'현재 롤 확인·변경·차단을 처리합니다. owner는 전체, admin은 owner를 제외한 전체를 관리합니다. director·site manager는 자기보다 낮은 롤만 보이며, 상위·동급 롤은 목록에서 제외됩니다.', search:'검색', colMember:'회원', colRole:'현재 롤', colChangeReview:'변경 롤/승급 검토', colManage:'관리', noMembers:'관리 권한으로 볼 수 있는 회원이 없거나 API 연결 대기 중입니다.', shown:'표시', serverQuery:'서버 조회', page:'페이지', previous:'이전', next:'다음',
      reviewDocDefault:'제출 서류', open:'열람', detail:'상세', approve:'승인', reject:'반려', reviewTitle:'승급 검토', reviewRefresh:'새로고침', reviewDesc:'회원이 제출한 서류와 승급·권한 신청 자료를 검토하는 영역입니다. owner는 전체, admin은 owner 제외, director/site_manager_director는 자기보다 아래 롤의 제출 자료만 볼 수 있습니다.', reviewHeadDoc:'제출 서류', reviewHeadMember:'회원', reviewHeadTarget:'요청 롤', reviewHeadStatus:'상태', reviewHeadReview:'검토', noReviewDocs:'현재 권한으로 볼 수 있는 제출 서류가 없거나, 서류 검토 API 연결 대기 중입니다.', shownItems:'표시', serverItems:'서버 조회',
      adminNoticeTitle:'답글/공지 관리', adminNoticeDesc:'관리자 권한에서만 답글 작성·공지 등록 버튼이 활성화됩니다.', targetTitleLabel:'대상/제목', targetTitlePlaceholder:'공지 제목 또는 답글 대상', adminNoticeBodyLabel:'내용', adminNoticeBodyPlaceholder:'공지 또는 답글 내용', register:'등록',
      registered:'등록되었습니다.', reviewTokenMissing:'사이트 역할은 확인되지만 Auth0 ID 토큰이 모달/API에 연결되지 않았습니다. 상단의 세션 갱신 후 승급 검토를 다시 열어야 합니다.', reviewApiMissing:'서류 검토 API 연결이 필요합니다.', noAttachment:'열람 가능한 첨부 URL이 없습니다.', confirmProcess:'처리할까요?', memberTokenMissing:'사이트 역할은 확인되지만 Auth0 ID 토큰이 모달/API에 연결되지 않았습니다. 상단의 세션 갱신 후 회원 목록을 다시 열어야 합니다.', tokenExpiredSuffix:' / 현재 로그인 세션 토큰이 만료되었거나 없습니다.', changeNoPerm:'현재 권한으로는 해당 롤로 변경할 수 없습니다.', confirmRoleChangePrefix:'회원 롤을 ', confirmRoleChangeSuffix:' 로 변경할까요?', confirmBlock:'이 회원을 차단/퇴출 처리할까요?', upgradeRequested:'신청되었습니다.'
    },
    en: {
      memberStatusTitle:'Member Status', currentRole:'Current role', memberStatusDesc:'General members use this area mainly for media content purchases and viewing.',
      premiumTitle:'Premium / Special Member', premiumDesc:'This tier is for members who need address and purchase information integration. Upgrades are approved after server and M2M review.', premiumApply:'Apply for Premium',
      commerceTitle:'Commerce / Higher Permissions', commerceDesc:'Product, commerce, and higher roles are assigned after administrator review.', commerceApply:'Apply for Commerce',
      standardTitle:'Standard Application', standardDesc:'Apply to extend basic member services.', standardApply:'Apply for Standard',
      memberPageTitle:'Member Page', memberPageDesc:'Check private documents, inquiries, and submission status.', openMemberPage:'Open Member Page',
      adminMembersTitle:'Admin Member List', adminMembersDesc:'Load and manage the permitted Auth0 member scope through a real signed-in session.', openMembers:'Open Member List', openReview:'Open Review Queue',
      loginStateTitle:'Login Status', siteRole:'Site role', tokenOk:'The Auth0 ID token is connected correctly.', tokenMissing:'A site role is visible, but the Auth0 ID token is missing or expired. Renew the session before viewing the member list.', renewSession:'Renew session',
      loginTitle:'Login', loginDesc:'Members-only areas are available after login.',
      submitTitle:'Document Submission', submitDesc:'Submit member documents or review materials. Actual saving is handled by the server API or the existing submission engine.', titleLabel:'Title', submitTitlePlaceholder:'Submission title', bodyLabel:'Content', submitBodyPlaceholder:'Submission content', submitButton:'Submit',
      questionTitle:'Questions / Inquiry', questionDesc:'General members can submit questions, and replies are enabled for administrators.', qTitleLabel:'Question title', qTitlePlaceholder:'Question title', qBodyLabel:'Question content', qBodyPlaceholder:'Question content', qButton:'Submit Question', openReplyAdmin:'Open Reply Management',
      noticeTitle:'Notices', noticeDesc:'Notice lists are displayed automatically when the server API is connected.', manageNotice:'Create Notice / Manage Replies',
      noPermission:'No permission', save:'Save', block:'Block', adminMembersTitle2:'OS0/Auth0 Member List', adminMembersDesc2:'Check roles, change allowed roles, and manage blocking. Owners manage all; admins manage everyone except owners. Directors and site managers see only lower roles; higher and equal roles are excluded.', search:'Search', colMember:'Member', colRole:'Current Role', colChangeReview:'Change Role / Review', colManage:'Manage', noMembers:'No members are visible with the current permission, or the API is waiting for connection.', shown:'Shown', serverQuery:'Server query', page:'Page', previous:'Previous', next:'Next',
      reviewDocDefault:'Submitted Document', open:'Open', detail:'Details', approve:'Approve', reject:'Reject', reviewTitle:'Review Queue', reviewRefresh:'Refresh', reviewDesc:'Review member-submitted documents and upgrade/permission requests. Owner can view all, admin can view all except owner, and director/site_manager_director can view only roles below their own.', reviewHeadDoc:'Document', reviewHeadMember:'Member', reviewHeadTarget:'Requested Role', reviewHeadStatus:'Status', reviewHeadReview:'Review', noReviewDocs:'No submitted documents are visible with the current permission, or the review API is waiting for connection.', shownItems:'Shown', serverItems:'Server query',
      adminNoticeTitle:'Replies / Notice Management', adminNoticeDesc:'Reply and notice registration buttons are enabled only for administrators.', targetTitleLabel:'Target / Title', targetTitlePlaceholder:'Notice title or reply target', adminNoticeBodyLabel:'Content', adminNoticeBodyPlaceholder:'Notice or reply content', register:'Register',
      registered:'Registered.', reviewTokenMissing:'The site role is visible, but the Auth0 ID token is not connected to the modal/API. Renew the session at the top and reopen the review queue.', reviewApiMissing:'Document review API connection is required.', noAttachment:'No viewable attachment URL is available.', confirmProcess:'Proceed?', memberTokenMissing:'The site role is visible, but the Auth0 ID token is not connected to the modal/API. Renew the session at the top and reopen the member list.', tokenExpiredSuffix:' / The current login session token is missing or expired.', changeNoPerm:'You do not have permission to assign this role.', confirmRoleChangePrefix:'Change this member role to ', confirmRoleChangeSuffix:'?', confirmBlock:'Block or remove this member?', upgradeRequested:'Application submitted.'
    }
  };
  function uiText() { return lang() === 'ko' ? UI_TEXT.ko : UI_TEXT.en; }

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
  function roleLevel(role) {
    var normalized = normalizeRole(role);
    if (ROLE_LEVEL[normalized] != null) return ROLE_LEVEL[normalized];
    if (normalized.indexOf('site_manager_') === 0) return 12;
    return 0;
  }
  function highestRole(roles) {
    roles = unique(roles);
    if (!roles.length) return 'guest';
    return roles.sort(function (a,b) { return roleLevel(b) - roleLevel(a); })[0];
  }
  function isManagerRole(role) {
    role = normalizeRole(role);
    return role === 'owner' || role === 'admin' || role === 'super_admin' || role === 'director' || role === 'coordinator_director' || role === 'site_manager' || role === 'site_manager_director' || role.indexOf('site_manager_') === 0;
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
    if (mine === 'admin' || mine === 'super_admin') return target !== 'owner';
    return roleLevel(target) < roleLevel(mine);
  }
  function canAssignRole(myRoles, targetRole) {
    var mine = managerRole(myRoles);
    targetRole = normalizeRole(targetRole);
    if (!isManagerRole(mine)) return false;
    if (mine === 'owner') return true;
    if (mine === 'admin' || mine === 'super_admin') return targetRole !== 'owner';
    return roleLevel(targetRole) < roleLevel(mine);
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

  function roleTextCandidate(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    var n = normalizeRole(v);
    if (!n || n === 'guest' || n === 'os-login' || n === 'os_login' || n === 'login' || n === 'logout' || n === 'log_out' || n === '로그인' || n === '로그아웃' || n === '회원전용' || n === 'members_only') return '';
    if (ROLE_LEVEL[n] || n.indexOf('site_manager') === 0 || n.indexOf('member') === 0 || n === 'owner' || n === 'admin' || n === 'director') return n;
    return '';
  }
  function pushRoleValue(list, v) {
    var n = roleTextCandidate(v);
    if (n) list.push(n);
  }
  function visibleHeaderRoles() {
    var roles = [];
    function pushTextById(id) {
      try {
        var el = document.getElementById(id);
        if (el && el.textContent) pushRoleValue(roles, el.textContent);
        if (el) {
          pushRoleValue(roles, el.getAttribute('data-role-base'));
          pushRoleValue(roles, el.getAttribute('data-current-role'));
          pushRoleValue(roles, el.getAttribute('data-igdc-role'));
        }
      } catch (e) {}
    }
    pushTextById('igtcRoleText3');
    pushTextById('roleStatusBtn');
    pushTextById('igtcRoleInline3');
    pushTextById('userRole');
    try {
      var login = document.getElementById('osLoginBtn');
      if (login && login.nextElementSibling) pushRoleValue(roles, login.nextElementSibling.textContent);
    } catch (e) {}
    try {
      var roleNodes = document.querySelectorAll('[data-role-base], [data-current-role], [data-igdc-role], .role-display');
      Array.prototype.forEach.call(roleNodes, function (el) {
        pushRoleValue(roles, el.getAttribute('data-role-base'));
        pushRoleValue(roles, el.getAttribute('data-current-role'));
        pushRoleValue(roles, el.getAttribute('data-igdc-role'));
        if (el.textContent) pushRoleValue(roles, el.textContent);
      });
    } catch (e) {}
    if (!roles.length) {
      try {
        Array.prototype.forEach.call(document.querySelectorAll('button,span,div'), function (el) {
          var r = el.getBoundingClientRect();
          if (r.top < 130 && r.left < 420 && r.width < 280 && r.height < 80) pushRoleValue(roles, el.textContent);
        });
      } catch (e) {}
    }
    return unique(roles);
  }

  function readRoles() {
    try {
      if (window.IGDCMemberAuth) {
        if (!window.IGDCMemberAuth.isAuthenticated || !window.IGDCMemberAuth.isAuthenticated()) return [];
        if (typeof window.IGDCMemberAuth.getRoles === 'function') return unique(window.IGDCMemberAuth.getRoles());
      }
    } catch (e) {}
    if (!hasValidToken()) return [];
    var roles = [];
    try {
      if (window.osAuth && typeof window.osAuth.getIdTokenPayload === 'function') {
        var payload = window.osAuth.getIdTokenPayload() || {};
        var keys = [cfg().rolesClaim, 'https://igdcglobal.com/roles', 'https://os.auth/roles', 'https://os0.app/roles', 'https://example.com/roles', 'https://osu/roles', 'roles', 'role', 'permissions'];
        keys.forEach(function (key) {
          if (!key) return;
          var value = payload[key];
          if (Array.isArray(value)) roles = roles.concat(value);
          else if (typeof value === 'string') roles = roles.concat(value.split(','));
        });
      }
    } catch (e) {}
    return unique(roles);
  }
  function hasPlatformRole() {
    var roles = readRoles();
    return roles.length > 0 && roles.indexOf('guest') === -1;
  }
  function hasKnownSession() {
    try { if (window.osAuth && typeof window.osAuth.isAuthenticated === 'function' && window.osAuth.isAuthenticated()) return true; } catch (e) {}
    if (hasValidToken()) return true;
    return hasPlatformRole();
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
  function isLoggedIn() { return hasKnownSession(); }
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
    var p = {};
    try { if (window.osAuth && typeof window.osAuth.getUser === 'function') p = window.osAuth.getUser() || {}; } catch (e) {}
    try { if (!p.email && window.osAuth && typeof window.osAuth.getIdTokenPayload === 'function') p = window.osAuth.getIdTokenPayload() || p; } catch (e) {}
    var roles = readRoles();
    var email = p.email || '';
    var display = cleanDisplayName(p.name || p.nickname || '', '');
    if (!display || normalizeRole(display) === normalizeRole(email)) display = '';
    return {
      name: display || email || 'Member',
      email: email,
      user_id: p.sub || p.user_id || '',
      roles: roles,
      role: highestRole(roles),
      admin: canAdmin(roles)
    };
  }
  function openLogin(force) {
    if (!force && hasValidToken()) {
      try { if (window.IGDCMemberAdminModal && typeof window.IGDCMemberAdminModal.open === 'function') { window.IGDCMemberAdminModal.open('member-home'); return; } } catch (e) {}
      return;
    }
    try {
      if (window.IGDCMemberAuth && typeof window.IGDCMemberAuth.beginLogin === 'function') {
        window.IGDCMemberAuth.beginLogin();
        return;
      }
    } catch (e) {}
    if (typeof window.osLogin === 'function') { window.osLogin(); return; }
    if (typeof window.loginWithRedirect === 'function') { window.loginWithRedirect(); return; }
    try { document.dispatchEvent(new CustomEvent('igdc:login-request')); } catch (e) {}
  }
  /* Member and delegated administration stay inside this modal.
     There is no separate member-page route. The public admin console remains
     accessible through the site navigation under its own access controls. */
  function targetPage() { return ''; }
  function openTarget() {
    setTab(canAdmin(readRoles()) ? 'admin-members' : 'member-home');
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
        (!(hasPlatformRole() || (me && me.role && me.role !== 'guest'))?'<button type="button" class="primary" data-action="login">'+esc(labels.login)+'</button>':(!hasValidToken()?'<button type="button" data-action="login">'+esc(labels.renew || '세션 갱신')+'</button>':''))+
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
    var u = uiText();
    var canStandard = roleEngineHas('APPLY_STANDARD') || roleLevel(me.role) >= 1;
    var canPremium = roleEngineHas('APPLY_PREMIUM') || roleLevel(me.role) >= 2;
    var canCommerce = roleEngineHas('APPLY_COMMERCE') || roleLevel(me.role) >= 3;
    return '<div class="grid">'+
      '<div class="card"><h4>'+esc(u.memberStatusTitle)+'</h4><div class="muted">'+esc(u.currentRole)+': <b>'+esc(me.role)+'</b><br>'+esc(u.memberStatusDesc)+'</div></div>'+
      '<div class="card"><h4>'+esc(u.premiumTitle)+'</h4><div class="muted">'+esc(u.premiumDesc)+'</div><br><button '+(!canPremium?'disabled':'')+' data-action="request-upgrade" data-role="premium">'+esc(u.premiumApply)+'</button></div>'+
      '<div class="card"><h4>'+esc(u.commerceTitle)+'</h4><div class="muted">'+esc(u.commerceDesc)+'</div><br><button '+(!canCommerce?'disabled':'')+' data-action="request-upgrade" data-role="commerce">'+esc(u.commerceApply)+'</button></div>'+
      '<div class="card"><h4>'+esc(u.standardTitle)+'</h4><div class="muted">'+esc(u.standardDesc)+'</div><br><button '+(!canStandard?'disabled':'')+' data-action="request-upgrade" data-role="standard">'+esc(u.standardApply)+'</button></div>'+
      (me.admin ? '<div class="card"><h4>'+esc(u.adminMembersTitle)+'</h4><div class="muted">'+esc(u.adminMembersDesc)+'</div><br><button class="primary" data-tab="admin-members">'+esc(u.openMembers)+'</button> <button data-tab="admin-queue">'+esc(u.openReview)+'</button></div>' : '')+
      (hasPlatformRole()
        ? '<div class="card"><h4>'+esc(u.loginStateTitle)+'</h4><div class="muted">'+esc(u.siteRole)+': <b>'+esc(me.role || 'member')+'</b><br>'+(hasValidToken()?esc(u.tokenOk):esc(u.tokenMissing))+'</div>'+(hasValidToken()?'':'<br><button data-action="login">'+esc(u.renewSession)+'</button>')+'</div>'
        : '<div class="card"><h4>'+esc(u.loginTitle)+'</h4><div class="muted">'+esc(u.loginDesc)+'</div><br><button data-action="login">OS-Login</button></div>')+
    '</div>';
  }
  function submitHtml() {
    var u = uiText();
    return '<form class="card" data-form="document-submit"><h4>'+esc(u.submitTitle)+'</h4><div class="muted">'+esc(u.submitDesc)+'</div><br>'+
      '<label>'+esc(u.titleLabel)+'<input name="title" required placeholder="'+esc(u.submitTitlePlaceholder)+'"></label><br><br>'+
      '<label>'+esc(u.bodyLabel)+'<textarea name="body" required placeholder="'+esc(u.submitBodyPlaceholder)+'"></textarea></label><br><br>'+
      '<button class="primary" type="submit">'+esc(u.submitButton)+'</button></form>';
  }
  function questionHtml(admin) {
    var u = uiText();
    return '<form class="card" data-form="question-submit"><h4>'+esc(u.questionTitle)+'</h4><div class="muted">'+esc(u.questionDesc)+'</div><br>'+
      '<label>'+esc(u.qTitleLabel)+'<input name="title" required placeholder="'+esc(u.qTitlePlaceholder)+'"></label><br><br>'+
      '<label>'+esc(u.qBodyLabel)+'<textarea name="body" required placeholder="'+esc(u.qBodyPlaceholder)+'"></textarea></label><br><br>'+
      '<button class="primary" type="submit">'+esc(u.qButton)+'</button> '+(admin?'<button type="button" data-tab="admin-notice">'+esc(u.openReplyAdmin)+'</button>':'')+'</form>';
  }
  function noticeHtml(admin) {
    var u = uiText();
    return '<div class="card"><h4>'+esc(u.noticeTitle)+'</h4><div class="muted">'+esc(u.noticeDesc)+'</div>'+
      (admin?'<br><button data-tab="admin-notice">'+esc(u.manageNotice)+'</button>':'')+'</div>';
  }
  function rolesForSelect(current) {
    var roles = (cfg().roleOptions || [
      'guest',
      'member',
      'member_standard',
      'member_premium',
      'special_menber',
      'commerce_manager',
      'site_manager',
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
    var u = uiText();
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
        '<div>'+(canManage && options ? '<select data-role-select>'+options+'</select>' : '<span class="muted">'+esc(u.noPermission)+'</span>')+'</div>'+ 
        '<div class="igdc-ma-member-actions">'+(canManage && options ? '<button data-action="save-role">'+esc(u.save)+'</button><button data-action="block-user" class="danger">'+esc(u.block)+'</button>' : '')+'</div>'+ 
      '</div>';
    }).join('');
    return '<div class="card igdc-ma-member-card"><div class="row" style="justify-content:space-between"><h4>'+esc(u.adminMembersTitle2)+'</h4><button data-action="reload-members">'+esc(labels.refresh)+'</button></div>'+ 
      '<div class="muted" style="margin-bottom:8px">'+esc(u.adminMembersDesc2)+'</div>'+
      '<div class="row igdc-ma-member-tools"><input id="igdc-member-search" value="'+esc(STATE.query)+'" placeholder="'+esc(labels.searchPlaceholder)+'"><button data-action="search-members">'+esc(u.search)+'</button></div>'+ 
      (STATE.loading?'<div class="muted">'+esc(labels.loading)+'</div>':'')+
      '<div class="igdc-ma-member-list">'+
        '<div class="igdc-ma-member-head"><div>User ID</div><div>'+esc(u.colMember)+'</div><div>'+esc(u.colRole)+'</div><div>'+esc(u.colChangeReview)+'</div><div>'+esc(u.colManage)+'</div></div>'+
        (rows || '<div class="igdc-ma-member-row"><div class="muted" style="grid-column:1/-1">'+esc(u.noMembers)+'</div></div>')+
      '</div>'+ 
      '<div class="row" style="margin-top:8px;justify-content:space-between"><div class="muted">'+esc(u.shown)+' '+esc(visibleMembers.length)+' / '+esc(u.serverQuery)+' '+esc(STATE.total || STATE.members.length)+' / '+esc(u.page)+' '+esc(STATE.page + 1)+'</div><div class="row"><button data-action="prev-members" '+(STATE.page > 0 ? '' : 'disabled')+'>'+esc(u.previous || 'Previous')+'</button><button data-action="next-members" '+(STATE.hasMore ? '' : 'disabled')+'>'+esc(u.next || 'Next')+'</button></div></div></div>';
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
    var u = uiText();
    var myRoles = (STATE.me && STATE.me.roles) || readRoles();
    var docs = (STATE.reviewDocs || []).filter(function (d) { return canReviewDoc(myRoles, d); });
    var rows = docs.map(function (d) {
      var id = d.id || d.document_id || d.review_id || d.submission_id || '';
      var user = d.user || {};
      var email = d.email || user.email || d.user_email || '';
      var name = d.name || user.name || user.nickname || d.user_name || '';
      var title = d.title || d.subject || d.type || u.reviewDocDefault;
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
          (fileUrl ? '<button data-action="open-review-doc" data-url="'+esc(fileUrl)+'">'+esc(u.open)+'</button>' : '<button data-action="open-review-doc">'+esc(u.detail)+'</button>')+
          '<button data-action="approve-review-doc" class="primary">'+esc(u.approve)+'</button>'+
          '<button data-action="reject-review-doc" class="danger">'+esc(u.reject)+'</button>'+
        '</div>'+ 
      '</div>';
    }).join('');
    return '<div class="card igdc-ma-member-card"><div class="row" style="justify-content:space-between"><h4>'+esc(u.reviewTitle)+'</h4><button data-action="reload-review-queue">'+esc(u.reviewRefresh)+'</button></div>'+ 
      '<div class="muted" style="margin-bottom:8px">'+esc(u.reviewDesc)+'</div>'+ 
      (STATE.loadingReview ? '<div class="muted">'+esc(labels.loading)+'</div>' : '')+
      '<div class="igdc-ma-review-list">'+
        '<div class="igdc-ma-review-head"><div>'+esc(u.reviewHeadDoc)+'</div><div>'+esc(u.reviewHeadMember)+'</div><div>'+esc(u.reviewHeadTarget)+'</div><div>'+esc(u.reviewHeadStatus)+'</div><div>'+esc(u.reviewHeadReview)+'</div></div>'+ 
        (rows || '<div class="igdc-ma-review-row"><div class="muted" style="grid-column:1/-1">'+esc(u.noReviewDocs)+'</div></div>')+
      '</div>'+ 
      '<div class="muted" style="margin-top:8px">'+esc(u.shownItems)+' '+esc(docs.length)+' / '+esc(u.serverItems)+' '+esc((STATE.reviewDocs || []).length)+'</div></div>';
  }
  function adminNoticeHtml() {
    var u = uiText();
    return '<form class="card" data-form="admin-reply"><h4>'+esc(u.adminNoticeTitle)+'</h4><div class="muted">'+esc(u.adminNoticeDesc)+'</div><br>'+
      '<label>'+esc(u.targetTitleLabel)+'<input name="title" required placeholder="'+esc(u.targetTitlePlaceholder)+'"></label><br><br>'+
      '<label>'+esc(u.adminNoticeBodyLabel)+'<textarea name="body" required placeholder="'+esc(u.adminNoticeBodyPlaceholder)+'"></textarea></label><br><br>'+
      '<button class="primary" type="submit">'+esc(u.register)+'</button></form>';
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
    if (act === 'login') openLogin(true);
    else if (act === 'open-page') openTarget();
    else if (act === 'reload-members') loadMembers();
    else if (act === 'prev-members') { if (STATE.page > 0) { STATE.page -= 1; loadMembers(); } }
    else if (act === 'next-members') { if (STATE.hasMore) { STATE.page += 1; loadMembers(); } }
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
    apiPost(action, body).then(function () { setError(''); alert(uiText().registered); form.reset(); }).catch(function (e) { setError(e.message); });
  }
  function loadReviewDocs() {
    if (!canAdmin(readRoles()) && !(STATE.me && STATE.me.admin)) return;
    if (!hasValidToken()) {
      STATE.loadingReview = false;
      STATE.reviewDocs = [];
      STATE.error = uiText().reviewTokenMissing;
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
      STATE.error = e.message || uiText().reviewApiMissing;
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
    var u = uiText(); alert((doc.title || u.reviewDocDefault) + '\n\n' + (doc.body || doc.memo || doc.description || u.noAttachment));
  }
  function reviewDoc(row, decision) {
    var doc = findReviewDoc(row);
    if (!doc) return;
    var id = doc.id || doc.document_id || doc.review_id || doc.submission_id;
    if (!id) return;
    var u = uiText(); if (!confirm((decision === 'approve' ? u.approve : u.reject) + ' ' + u.confirmProcess)) return;
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
      STATE.hasMore = false;
      STATE.error = uiText().memberTokenMissing;
      render();
      return;
    }
    STATE.loading = true; STATE.error = ''; render();
    apiGet({action:'members', q:STATE.query || '', page:STATE.page || 0, per_page:cfg().perPage || 50}).then(function (data) {
      STATE.members = data.users || data.members || [];
      STATE.total = data.total || STATE.members.length;
      STATE.hasMore = !!data.has_more;
      STATE.loading = false;
      render();
    }).catch(function (e) {
      STATE.loading = false;
      STATE.hasMore = false;
      STATE.error = (e.message || t().apiMissing) + (!hasValidToken() ? uiText().tokenExpiredSuffix : '');
      render();
    });
  }
  function saveRole(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    var sel = row.querySelector('[data-role-select]');
    var role = sel && sel.value;
    if (!userId || !role) return;
    if (!canAssignRole((STATE.me && STATE.me.roles) || readRoles(), role)) { setError(uiText().changeNoPerm); return; }
    var u = uiText(); if (!confirm(u.confirmRoleChangePrefix + role + u.confirmRoleChangeSuffix)) return;
    apiPost('update-role', {user_id:userId, role:role}).then(loadMembers).catch(function (e) { setError(e.message); });
  }
  function blockUser(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    if (!userId) return;
    if (!confirm(uiText().confirmBlock)) return;
    apiPost('block-user', {user_id:userId, blocked:true}).then(loadMembers).catch(function (e) { setError(e.message); });
  }
  function requestUpgrade(role) {
    apiPost('request-upgrade', {role:role}).then(function () { alert(uiText().upgradeRequested); }).catch(function (e) { setError(e.message); });
  }
  function open(preferredTab) {
    if (!hasValidToken()) { openLogin(true); return; }
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
