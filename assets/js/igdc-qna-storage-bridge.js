/*
 * IGDC Q&A canonical storage bridge — final9 ownership/AI repair
 * Keeps the existing Q&A modal UI intact while routing popup writes, reads and
 * owner/admin deletes through the server-side qa-proxy endpoint.
 */
(function (global, doc) {
  'use strict';
  if (global.__IGDC_QA_STORAGE_BRIDGE_V2__) return;
  global.__IGDC_QA_STORAGE_BRIDGE_V2__ = true;

  var ENDPOINT = '/.netlify/functions/qa-proxy';
  var MODAL_SELECTOR = '.igdc-qa-modal';
  var LIST_SELECTOR = '.igdc-qa-threads';
  var QUESTION_SELECTOR = '.igdc-qa-text.q';
  var ANSWER_SELECTOR = '.igdc-qa-text.a';
  var SUBMIT_SELECTOR = '.igdc-qa-btn.primary';
  var refreshTimer = null;
  var qaSupabaseClient = null;
  var qaSupabaseSessionPromise = null;

  function text(value) {
    return value == null ? '' : String(value);
  }

  function clean(value, limit) {
    return text(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, limit || 2000);
  }

  function langCode() {
    var html = doc.documentElement || {};
    var raw = clean(html.lang || global.navigator && global.navigator.language || 'ko', 24).toLowerCase();
    if (raw.indexOf('zh-hant') === 0 || raw.indexOf('zh-tw') === 0 || raw.indexOf('zh-hk') === 0) return 'zht';
    return raw.split(/[-_]/)[0] || 'ko';
  }

  function message(kind) {
    var lang = langCode();
    var ko = {
      saving: '질문을 저장하고 있습니다.',
      saved: '질문이 저장되었습니다.',
      loadFail: '등록된 질문 목록을 불러오지 못했습니다.',
      saveFail: '질문을 서버에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      answerPending: '답변 준비 중',
      admin: '관리요청',
      normal: '일반',
      remove: '삭제',
      removing: '질문을 삭제하고 있습니다.',
      removed: '질문이 삭제되었습니다.',
      removeFail: '질문을 삭제하지 못했습니다. 작성자 또는 관리자 권한을 확인해 주세요.',
      removeConfirm: '이 질문을 삭제하시겠습니까?'
    };
    var en = {
      saving: 'Saving your question.',
      saved: 'Your question was saved.',
      loadFail: 'The registered question list could not be loaded.',
      saveFail: 'Your question could not be saved. Please try again shortly.',
      answerPending: 'Answer pending',
      admin: 'Admin request',
      normal: 'General',
      remove: 'Delete',
      removing: 'Deleting the question.',
      removed: 'The question was deleted.',
      removeFail: 'The question could not be deleted. Check author or admin permission.',
      removeConfirm: 'Delete this question?'
    };
    return (lang === 'ko' ? ko : en)[kind] || en[kind] || '';
  }

  function getScope() {
    var vars = global.SUPER_VARSAR || {};
    var project = clean(vars.project || 'IGDC', 120) || 'IGDC';
    var pageId = clean(vars.pageId || vars.page_id || (global.location && (global.location.pathname + (global.location.hash || ''))), 360);
    return { project: project, page_id: pageId };
  }

  function modalFor(node) {
    if (node && node.closest) {
      var current = node.closest(MODAL_SELECTOR);
      if (current) return current;
    }
    return doc.querySelector(MODAL_SELECTOR);
  }

  function getList(modal) {
    return modal && modal.querySelector ? modal.querySelector(LIST_SELECTOR) : null;
  }

  function getQuestion(modal) {
    return modal && modal.querySelector ? modal.querySelector(QUESTION_SELECTOR) : null;
  }

  function getAnswer(modal) {
    return modal && modal.querySelector ? modal.querySelector(ANSWER_SELECTOR) : null;
  }

  function getSubmit(modal) {
    return modal && modal.querySelector ? modal.querySelector(SUBMIT_SELECTOR) : null;
  }

  function setStatus(modal, value, isError) {
    if (!modal || !modal.querySelector) return;
    var panel = modal.querySelector('.igdc-qa-panel') || modal;
    var node = panel.querySelector('[data-igdc-qna-storage-status]');
    if (!node) {
      node = doc.createElement('div');
      node.setAttribute('data-igdc-qna-storage-status', '1');
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.style.cssText = 'min-height:1.2em;margin:6px 0 0;font-size:12px;line-height:1.35;';
      var list = getList(modal);
      if (list && list.parentNode) list.parentNode.insertBefore(node, list);
      else panel.appendChild(node);
    }
    node.textContent = value || '';
    node.style.opacity = value ? '1' : '0';
    node.style.color = isError ? '#b00020' : '';
  }

  function dateText(value) {
    try { return new Date(value).toLocaleString(); } catch (e) { return ''; }
  }

  function safeJson(value) {
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  function jwtValid(token) {
    try {
      var parts = text(token).split('.');
      if (parts.length !== 3) return false;
      var value = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (value.length % 4) value += '=';
      var payload = JSON.parse(global.atob(value));
      return !payload.exp || Number(payload.exp) * 1000 > Date.now() + 10000;
    } catch (e) { return false; }
  }

  function memberIdToken() {
    var candidates = [];
    try {
      if (global.IGDCMemberAuth && typeof global.IGDCMemberAuth.getIdToken === 'function') candidates.push(global.IGDCMemberAuth.getIdToken());
    } catch (e) {}
    try {
      if (global.osAuth && typeof global.osAuth.getIdToken === 'function') candidates.push(global.osAuth.getIdToken());
    } catch (e) {}
    var tokenKeys = ['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa'];
    [global.localStorage, global.sessionStorage].forEach(function (store) {
      if (!store) return;
      tokenKeys.forEach(function (key) {
        try {
          var record = safeJson(store.getItem(key));
          if (record && typeof record === 'object') {
            candidates.push(record.id_token, record.idToken, record.__raw, record.raw);
          }
        } catch (e) {}
      });
      ['igdc_id_token','id_token','auth0_id_token'].forEach(function (key) {
        try { candidates.push(store.getItem(key)); } catch (e) {}
      });
    });
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && jwtValid(candidates[i])) return text(candidates[i]);
    }
    return '';
  }

  function tokenFromSupabaseRecord(record) {
    if (!record || typeof record !== 'object') return '';
    if (record.access_token) return text(record.access_token);
    if (record.currentSession && record.currentSession.access_token) return text(record.currentSession.access_token);
    if (record.session && record.session.access_token) return text(record.session.access_token);
    return '';
  }

  function storedSupabaseToken() {
    var stores = [];
    try { stores.push(global.localStorage); } catch (e) {}
    try { stores.push(global.sessionStorage); } catch (e) {}
    for (var s = 0; s < stores.length; s++) {
      var store = stores[s];
      if (!store) continue;
      for (var i = 0; i < store.length; i++) {
        var key = '';
        try { key = store.key(i) || ''; } catch (e) { continue; }
        if (!/^sb-.+-auth-token$/i.test(key)) continue;
        try {
          var token = tokenFromSupabaseRecord(safeJson(store.getItem(key)));
          if (token) return token;
        } catch (e) {}
      }
    }
    return '';
  }

  function supabaseConfig() {
    var vars = global.SUPER_VARSAR || {};
    var pub = global.SUPABASE || {};
    return {
      url: clean(vars.url || vars.supabaseUrl || vars.supabase_url || pub.url || '', 500),
      anonKey: clean(vars.anonKey || vars.supabaseAnonKey || vars.supabase_anon_key || pub.anonKey || '', 2000)
    };
  }

  async function supabaseAccessToken() {
    var stored = storedSupabaseToken();
    if (stored) return stored;
    if (qaSupabaseSessionPromise) return qaSupabaseSessionPromise;
    qaSupabaseSessionPromise = (async function () {
      var cfg = supabaseConfig();
      if (!cfg.url || !cfg.anonKey || !global.supabase || typeof global.supabase.createClient !== 'function') return '';
      try {
        if (!qaSupabaseClient) {
          qaSupabaseClient = global.supabase.createClient(cfg.url, cfg.anonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
          });
        }
        var current = await qaSupabaseClient.auth.getSession();
        var session = current && current.data && current.data.session;
        if (!session && qaSupabaseClient.auth && typeof qaSupabaseClient.auth.signInAnonymously === 'function') {
          var signed = await qaSupabaseClient.auth.signInAnonymously();
          session = signed && signed.data && signed.data.session;
        }
        return session && session.access_token ? text(session.access_token) : storedSupabaseToken();
      } catch (e) {
        return storedSupabaseToken();
      }
    })();
    try { return await qaSupabaseSessionPromise; }
    finally { qaSupabaseSessionPromise = null; }
  }

  async function authHeaders(withJson) {
    var headers = { Accept: 'application/json' };
    if (withJson) headers['Content-Type'] = 'application/json';
    var supabaseToken = await supabaseAccessToken();
    if (supabaseToken) headers.Authorization = 'Bearer ' + supabaseToken;
    var memberToken = memberIdToken();
    if (memberToken && memberToken !== supabaseToken) headers['X-IGDC-Member-Token'] = memberToken;
    return headers;
  }

  function renderRows(modal, rows) {
    var list = getList(modal);
    if (!list) return;
    list.innerHTML = '';
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var box = doc.createElement('div');
      box.className = 'igdc-qa-thread';
      var q = doc.createElement('div');
      q.className = 'igdc-qa-thread-q';
      q.textContent = 'Q. ' + text(row.question || row.q || '');
      var a = doc.createElement('div');
      a.className = 'igdc-qa-thread-a';
      a.textContent = 'A. ' + (text(row.answer || row.a || '') || message('answerPending'));
      var meta = doc.createElement('div');
      meta.className = 'igdc-qa-thread-meta';
      var when = doc.createElement('span');
      when.textContent = row.created_at ? dateText(row.created_at) : '';
      var tag = doc.createElement('span');
      tag.textContent = row.is_admin ? message('admin') : message('normal');
      meta.appendChild(when);
      meta.appendChild(tag);
      if (row.can_delete && row.id != null) {
        var actions = doc.createElement('span');
        actions.className = 'igdc-qa-thread-actions';
        var del = doc.createElement('button');
        del.type = 'button';
        del.className = 'igdc-qa-btn muted';
        del.textContent = message('remove');
        del.setAttribute('data-igdc-qna-delete', clean(row.id, 240));
        actions.appendChild(del);
        meta.appendChild(actions);
      }
      box.appendChild(q);
      box.appendChild(a);
      box.appendChild(meta);
      list.appendChild(box);
    });
    list.setAttribute('data-igdc-qna-storage', 'server');
  }

  async function request(url, init) {
    var res = await global.fetch(url, init);
    var raw = await res.text();
    var body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = { ok: false, error: raw || 'Invalid server response' }; }
    if (!res.ok || !body.ok) {
      var error = body && (body.error || (body.warnings && body.warnings[0])) || ('HTTP ' + res.status);
      throw new Error(clean(error, 360));
    }
    return body;
  }

  async function refresh(modal, quiet) {
    modal = modal || modalFor();
    var list = getList(modal);
    if (!modal || !list) return null;
    var scope = getScope();
    if (!scope.page_id) return null;
    try {
      var query = '?action=list&project=' + encodeURIComponent(scope.project) + '&page_id=' + encodeURIComponent(scope.page_id) + '&limit=100';
      var headers = await authHeaders(false);
      var payload = await request(ENDPOINT + query, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: headers });
      renderRows(modal, payload.rows || []);
      if (!quiet) setStatus(modal, '', false);
      return payload.rows || [];
    } catch (err) {
      if (!quiet) setStatus(modal, message('loadFail'), true);
      try { global.console && global.console.warn && global.console.warn('[IGDC Q&A] thread list load failed:', err); } catch (ignore) {}
      return null;
    }
  }

  async function submit(modal) {
    modal = modal || modalFor();
    var questionBox = getQuestion(modal);
    var answerBox = getAnswer(modal);
    var submitButton = getSubmit(modal);
    if (!questionBox) return;
    var question = clean(questionBox.value, 4000);
    if (!question) { questionBox.focus(); return; }
    var scope = getScope();
    if (!scope.page_id) {
      setStatus(modal, message('saveFail'), true);
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
    }
    setStatus(modal, message('saving'), false);
    try {
      var headers = await authHeaders(true);
      var payload = await request(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: JSON.stringify({
          question: question,
          project: scope.project,
          page_id: scope.page_id,
          lang: langCode(),
          source: 'qna-popup-bridge',
          meta: {
            project: scope.project,
            page_id: scope.page_id,
            lang: langCode(),
            ua: clean(global.navigator && global.navigator.userAgent, 500),
            channel: 'popup'
          }
        })
      });
      questionBox.value = '';
      if (answerBox) answerBox.value = text(payload.answer || '');
      setStatus(modal, message('saved'), false);
      var refreshed = await refresh(modal, true);
      if (refreshed === null && payload.record) renderRows(modal, [payload.record]);
      try {
        doc.dispatchEvent(new CustomEvent('igdc:qna:stored', { detail: payload.record || null }));
      } catch (ignore) {}
    } catch (err) {
      setStatus(modal, message('saveFail'), true);
      try { global.console && global.console.error && global.console.error('[IGDC Q&A] save failed:', err); } catch (ignore) {}
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
      }
    }
  }

  async function removeThread(modal, id) {
    modal = modal || modalFor();
    id = clean(id, 240);
    if (!modal || !id) return;
    if (typeof global.confirm === 'function' && !global.confirm(message('removeConfirm'))) return;
    var scope = getScope();
    setStatus(modal, message('removing'), false);
    try {
      var headers = await authHeaders(true);
      await request(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: JSON.stringify({ action: 'delete', id: id, project: scope.project, page_id: scope.page_id })
      });
      setStatus(modal, message('removed'), false);
      await refresh(modal, true);
    } catch (err) {
      setStatus(modal, message('removeFail'), true);
      try { global.console && global.console.error && global.console.error('[IGDC Q&A] delete failed:', err); } catch (ignore) {}
    }
  }

  function scheduleRefresh(target) {
    var modal = modalFor(target);
    if (!modal) return;
    if (refreshTimer) global.clearTimeout(refreshTimer);
    refreshTimer = global.setTimeout(function () { refresh(modal, false); }, 40);
  }

  // Capture phase wins over the existing popup's direct browser-to-Supabase submit handler.
  // Existing modal layout, lifecycle, answer field and registered-question list stay unchanged.
  doc.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('button, a, [role="button"]') : null;
    if (!target) return;
    var modal = modalFor(target);
    var deleteId = target.getAttribute && target.getAttribute('data-igdc-qna-delete');
    if (deleteId && modal && modal.contains(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      removeThread(modal, deleteId);
      return;
    }
    if (target.matches && target.matches(SUBMIT_SELECTOR) && modal && modal.contains(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submit(modal);
      return;
    }
    if (target.id === 'qnaOpenBtn' || target.getAttribute('data-open') === 'qna' || target.getAttribute('data-target') === '#qna' || target.getAttribute('data-target') === '#qnaModal') {
      global.setTimeout(function () { scheduleRefresh(target); }, 70);
    }
  }, true);

  var observer = new MutationObserver(function (records) {
    var shouldRefresh = false;
    records.forEach(function (record) {
      Array.prototype.forEach.call(record.addedNodes || [], function (node) {
        if (!node || node.nodeType !== 1) return;
        if ((node.matches && node.matches(MODAL_SELECTOR)) || (node.querySelector && node.querySelector(MODAL_SELECTOR))) shouldRefresh = true;
      });
    });
    if (shouldRefresh) scheduleRefresh();
  });

  function start() {
    try { observer.observe(doc.documentElement || doc.body, { childList: true, subtree: true }); } catch (ignore) {}
    var modal = modalFor();
    if (modal) scheduleRefresh(modal);
    global.IGDC_QA_STORAGE = global.IGDC_QA_STORAGE || {};
    global.IGDC_QA_STORAGE.refresh = function () { return refresh(modalFor(), false); };
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window, document);
/* MARU Windows public policy links — PG review reinforcement v1.0 */
(function (global, doc) {
  'use strict';
  if (global.__MARU_WINDOWS_POLICY_LINKS_V1__) return;
  global.__MARU_WINDOWS_POLICY_LINKS_V1__ = true;

  var LABELS = {
    ko:{title:'MARU Windows 정책 문서',terms:'이용약관',privacy:'개인정보처리방침',refund:'환불정책',note:'Windows용 MARU Media Player와 유료 AI 자막 서비스에 적용되는 공개 정책입니다.'},
    en:{title:'MARU Windows policies',terms:'Terms of Service',privacy:'Privacy Policy',refund:'Refund Policy',note:'Public policies for MARU Media Player for Windows and its paid AI subtitle services.'},
    ja:{title:'MARU Windows ポリシー',terms:'利用規約',privacy:'プライバシーポリシー',refund:'返金ポリシー',note:'Windows版MARU Media Playerと有料AI字幕サービスに適用される公開ポリシーです。'},
    zh:{title:'MARU Windows 政策文件',terms:'服务条款',privacy:'隐私政策',refund:'退款政策',note:'适用于 Windows 版 MARU Media Player 及其付费 AI 字幕服务的公开政策。'},
    zht:{title:'MARU Windows 政策文件',terms:'服務條款',privacy:'隱私權政策',refund:'退款政策',note:'適用於 Windows 版 MARU Media Player 及其付費 AI 字幕服務的公開政策。'},
    de:{title:'MARU Windows Richtlinien',terms:'Nutzungsbedingungen',privacy:'Datenschutzrichtlinie',refund:'Erstattungsrichtlinie',note:'Öffentliche Richtlinien für MARU Media Player für Windows und die kostenpflichtigen KI-Untertiteldienste.'},
    fr:{title:'Politiques MARU Windows',terms:'Conditions d’utilisation',privacy:'Politique de confidentialité',refund:'Politique de remboursement',note:'Politiques publiques applicables à MARU Media Player pour Windows et à ses services payants de sous-titres IA.'},
    es:{title:'Políticas de MARU Windows',terms:'Términos del servicio',privacy:'Política de privacidad',refund:'Política de reembolso',note:'Políticas públicas para MARU Media Player para Windows y sus servicios de subtítulos IA de pago.'},
    pt:{title:'Políticas do MARU Windows',terms:'Termos de Serviço',privacy:'Política de Privacidade',refund:'Política de Reembolso',note:'Políticas públicas do MARU Media Player para Windows e dos seus serviços pagos de legendas por IA.'},
    ru:{title:'Политики MARU Windows',terms:'Условия использования',privacy:'Политика конфиденциальности',refund:'Политика возврата',note:'Публичные правила для MARU Media Player для Windows и платных сервисов ИИ-субтитров.'},
    it:{title:'Politiche MARU Windows',terms:'Termini di servizio',privacy:'Informativa sulla privacy',refund:'Politica di rimborso',note:'Politiche pubbliche per MARU Media Player per Windows e i servizi a pagamento di sottotitoli IA.'},
    nl:{title:'MARU Windows-beleid',terms:'Servicevoorwaarden',privacy:'Privacybeleid',refund:'Restitutiebeleid',note:'Openbaar beleid voor MARU Media Player voor Windows en de betaalde AI-ondertitelingsdiensten.'},
    sv:{title:'MARU Windows-policyer',terms:'Användarvillkor',privacy:'Integritetspolicy',refund:'Återbetalningspolicy',note:'Offentliga policyer för MARU Media Player för Windows och dess betalda AI-undertexttjänster.'},
    pl:{title:'Zasady MARU Windows',terms:'Warunki korzystania',privacy:'Polityka prywatności',refund:'Polityka zwrotów',note:'Publiczne zasady dla MARU Media Player dla Windows i płatnych usług napisów AI.'},
    tr:{title:'MARU Windows politikaları',terms:'Hizmet Koşulları',privacy:'Gizlilik Politikası',refund:'İade Politikası',note:'Windows için MARU Media Player ve ücretli yapay zekâ altyazı hizmetlerine ilişkin kamuya açık politikalar.'},
    ar:{title:'سياسات MARU لنظام Windows',terms:'شروط الخدمة',privacy:'سياسة الخصوصية',refund:'سياسة الاسترداد',note:'السياسات العامة لمشغل MARU Media Player لنظام Windows وخدمات ترجمات الذكاء الاصطناعي المدفوعة.'},
    th:{title:'นโยบาย MARU Windows',terms:'ข้อกำหนดการให้บริการ',privacy:'นโยบายความเป็นส่วนตัว',refund:'นโยบายการคืนเงิน',note:'นโยบายสาธารณะสำหรับ MARU Media Player บน Windows และบริการคำบรรยาย AI แบบชำระเงิน'},
    vi:{title:'Chính sách MARU Windows',terms:'Điều khoản dịch vụ',privacy:'Chính sách quyền riêng tư',refund:'Chính sách hoàn tiền',note:'Các chính sách công khai áp dụng cho MARU Media Player trên Windows và dịch vụ phụ đề AI trả phí.'},
    id:{title:'Kebijakan MARU Windows',terms:'Ketentuan Layanan',privacy:'Kebijakan Privasi',refund:'Kebijakan Pengembalian Dana',note:'Kebijakan publik untuk MARU Media Player bagi Windows dan layanan subtitle AI berbayar.'},
    hi:{title:'MARU Windows नीतियाँ',terms:'सेवा की शर्तें',privacy:'गोपनीयता नीति',refund:'धनवापसी नीति',note:'Windows के लिए MARU Media Player और इसकी सशुल्क AI उपशीर्षक सेवाओं की सार्वजनिक नीतियाँ।'},
    ms:{title:'Dasar MARU Windows',terms:'Syarat Perkhidmatan',privacy:'Dasar Privasi',refund:'Dasar Bayaran Balik',note:'Dasar awam untuk MARU Media Player bagi Windows dan perkhidmatan sari kata AI berbayar.'},
    fa:{title:'سیاست‌های MARU Windows',terms:'شرایط خدمات',privacy:'سیاست حریم خصوصی',refund:'سیاست بازپرداخت',note:'سیاست‌های عمومی MARU Media Player برای Windows و خدمات پولی زیرنویس هوش مصنوعی.'},
    bn:{title:'MARU Windows নীতিমালা',terms:'সেবার শর্তাবলি',privacy:'গোপনীয়তা নীতি',refund:'রিফান্ড নীতি',note:'Windows-এর MARU Media Player এবং এর সশুল্ক AI সাবটাইটেল সেবার প্রকাশ্য নীতিমালা।'},
    ta:{title:'MARU Windows கொள்கைகள்',terms:'சேவை விதிமுறைகள்',privacy:'தனியுரிமைக் கொள்கை',refund:'பணத்தீர்ப்பு கொள்கை',note:'Windows-க்கான MARU Media Player மற்றும் கட்டண AI வசன சேவைகளுக்கான பொதுக் கொள்கைகள்.'},
    ur:{title:'MARU Windows پالیسیاں',terms:'سروس کی شرائط',privacy:'رازداری کی پالیسی',refund:'رقم واپسی کی پالیسی',note:'Windows کے لیے MARU Media Player اور اس کی بامعاوضہ AI سب ٹائٹل خدمات کی عوامی پالیسیاں۔'},
    sw:{title:'Sera za MARU Windows',terms:'Masharti ya Huduma',privacy:'Sera ya Faragha',refund:'Sera ya Marejesho',note:'Sera za umma za MARU Media Player ya Windows na huduma zake za kulipia za manukuu ya AI.'},
    hu:{title:'MARU Windows szabályzatok',terms:'Szolgáltatási feltételek',privacy:'Adatvédelmi szabályzat',refund:'Visszatérítési szabályzat',note:'A Windows rendszerű MARU Media Player és fizetős MI-felirat szolgáltatásainak nyilvános szabályzatai.'},
    uk:{title:'Політики MARU Windows',terms:'Умови користування',privacy:'Політика конфіденційності',refund:'Політика повернення',note:'Публічні правила для MARU Media Player для Windows і платних сервісів ШІ-субтитрів.'},
    uz:{title:'MARU Windows siyosatlari',terms:'Xizmat shartlari',privacy:'Maxfiylik siyosati',refund:'Qaytarish siyosati',note:'Windows uchun MARU Media Player va pulli AI subtitr xizmatlariga oid ochiq siyosatlar.'},
    tl:{title:'Mga patakaran ng MARU Windows',terms:'Mga Tuntunin ng Serbisyo',privacy:'Patakaran sa Privacy',refund:'Patakaran sa Refund',note:'Mga pampublikong patakaran para sa MARU Media Player para sa Windows at mga bayad na AI subtitle service.'}
  };
  var RTL = {ar:1,fa:1,ur:1};
  function lang(){
    var raw=(doc.documentElement.getAttribute('lang')||'en').toLowerCase().replace('_','-');
    if(raw==='zh-tw'||raw==='zh-hk'||raw==='zh-hant') return 'zht';
    raw=raw.split('-')[0];
    return LABELS[raw]?raw:'en';
  }
  function links(code){
    var t=LABELS[code]||LABELS.en;
    return '<div class="maruPolicyLinks" dir="'+(RTL[code]?'rtl':'ltr')+'">'+
      '<a href="maru-windows-terms.html?lang='+encodeURIComponent(code)+'" target="_blank" rel="noopener">'+t.terms+'</a>'+
      '<a href="maru-windows-privacy.html?lang='+encodeURIComponent(code)+'" target="_blank" rel="noopener">'+t.privacy+'</a>'+
      '<a href="maru-windows-refund.html?lang='+encodeURIComponent(code)+'" target="_blank" rel="noopener">'+t.refund+'</a>'+
    '</div>';
  }
  function style(){
    if(doc.getElementById('maruPolicyLinksStyle')) return;
    var s=doc.createElement('style'); s.id='maruPolicyLinksStyle';
    s.textContent='.maruPolicyPublicCard{grid-column:1/-1;background:#fff;border:1px solid #d9e4f2;border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.03)}.maruPolicyPublicCard h2{margin:0 0 8px;color:#004080;font-size:20px}.maruPolicyPublicCard p{margin:0 0 12px;line-height:1.6;color:#4c6177}.maruPolicyLinks{display:flex;gap:8px;flex-wrap:wrap}.maruPolicyLinks a{display:inline-block;text-decoration:none;border:1px solid #b9d2ee;background:#eef7ff;color:#004080;border-radius:9px;padding:9px 12px;font-weight:700}.maruPolicyLinks a:hover{text-decoration:underline}.maruProductSection .maruPolicyLinks{margin-top:8px}';
    doc.head.appendChild(s);
  }
  function install(){
    style(); var code=lang(),t=LABELS[code]||LABELS.en;
    var grid=doc.querySelector('.grid');
    if(grid){
      var card=doc.getElementById('maruPolicyPublicCard');
      if(!card){card=doc.createElement('article');card.id='maruPolicyPublicCard';card.className='maruPolicyPublicCard';grid.appendChild(card);}
      card.setAttribute('dir',RTL[code]?'rtl':'ltr');
      card.innerHTML='<h2>'+t.title+'</h2><p>'+t.note+'</p>'+links(code);
    }
    var body=doc.getElementById('maruProductInfoBody');
    if(body){
      var section=doc.getElementById('maruProductPolicySection');
      if(!section){section=doc.createElement('section');section.id='maruProductPolicySection';section.className='maruProductSection';body.appendChild(section);}
      section.innerHTML='<h3>'+t.title+'</h3><p>'+t.note+'</p>'+links(code);
    }
  }
  function start(){install();setTimeout(install,300);setTimeout(install,1200);new MutationObserver(function(){install();}).observe(doc.documentElement,{attributes:true,attributeFilter:['lang'],subtree:false});}
  if(doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})(window, document);
