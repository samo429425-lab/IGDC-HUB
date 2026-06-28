/*
 * IGDC Q&A canonical storage bridge
 * Keeps the existing Q&A modal UI intact while routing popup writes and list reads
 * through the server-side qa-proxy endpoint.
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
  var lastScopeKey = '';

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
      normal: '일반'
    };
    var en = {
      saving: 'Saving your question.',
      saved: 'Your question was saved.',
      loadFail: 'The registered question list could not be loaded.',
      saveFail: 'Your question could not be saved. Please try again shortly.',
      answerPending: 'Answer pending',
      admin: 'Admin request',
      normal: 'General'
    };
    return (lang === 'ko' ? ko : en)[kind] || en[kind] || '';
  }

  function getScope() {
    var vars = global.SUPER_VARSAR || {};
    var project = clean(vars.project || 'IGDC', 120) || 'IGDC';
    var pageId = clean(vars.pageId || vars.page_id || (global.location && (global.location.pathname + (global.location.hash || ''))), 360);
    return { project: project, page_id: pageId };
  }

  function scopeKey(scope) {
    return scope.project + '|' + scope.page_id;
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
    lastScopeKey = scopeKey(scope);
    try {
      var query = '?action=list&project=' + encodeURIComponent(scope.project) + '&page_id=' + encodeURIComponent(scope.page_id) + '&limit=100';
      var payload = await request(ENDPOINT + query, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } });
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
      var payload = await request(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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

  function scheduleRefresh(target) {
    var modal = modalFor(target);
    if (!modal) return;
    if (refreshTimer) global.clearTimeout(refreshTimer);
    refreshTimer = global.setTimeout(function () { refresh(modal, false); }, 40);
  }

  // Capture phase wins over the existing popup's direct browser-to-Supabase submit handler.
  // Existing modal layout, modal lifecycle, answer field and registered-question list stay unchanged.
  doc.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('button, a, [role="button"]') : null;
    if (!target) return;
    var modal = modalFor(target);
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
