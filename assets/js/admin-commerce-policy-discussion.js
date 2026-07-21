/* IGDC administrator policy discussion workspace v1.2.0
 * - global/region/country policy drafting and AI discussion
 * - administrator decision preview before persistence
 * - manual country priority/blocked targets remain above normal automation
 */
(function () {
  'use strict';

  var CONTROL = '/.netlify/functions/commerce-country-control';
  var $ = function (id) { return document.getElementById(id); };
  var text = function (value) { return String(value == null ? '' : value).trim(); };
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  };

  var token = '';
  var sessionPromise = null;
  var currentScope = null;
  var currentWorkspace = null;
  var currentResponse = null;
  var pendingSavePayload = null;
  var TOKEN_KEYS = [
    'osauth.tokens.v2', 'osauth.tokens.v1', 'igdc.tokens', 'igdc_auth_tokens',
    'auth0_tokens', 'auth0spa', 'igdc_id_token', 'id_token', 'auth0_id_token'
  ];

  function jwt(value) {
    var candidate = text(value);
    return candidate.split('.').length === 3 && candidate.length > 32 ? candidate : '';
  }

  function parse(value) {
    try { return JSON.parse(value); } catch (_error) { return null; }
  }

  function pushToken(value, output, seen, depth) {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string') {
      var candidate = jwt(value);
      if (candidate && !seen[candidate]) {
        seen[candidate] = 1;
        output.push(candidate);
        return;
      }
      var parsed = parse(value);
      if (parsed) pushToken(parsed, output, seen, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item) { pushToken(item, output, seen, depth + 1); });
      return;
    }
    if (typeof value === 'object') {
      ['id_token', 'idToken', 'access_token', 'accessToken', 'token', '__raw', 'raw'].forEach(function (key) {
        pushToken(value[key], output, seen, depth + 1);
      });
    }
  }

  async function tokens() {
    var output = [];
    var seen = {};
    var tasks = [];
    [window, window.parent, window.top].forEach(function (targetWindow) {
      try {
        if (!targetWindow || tasks.some(function (item) { return item.w === targetWindow; })) return;
        void targetWindow.location.href;
        var box = { w: targetWindow };
        tasks.push(box);
        if (targetWindow.IGDCMemberAuth && targetWindow.IGDCMemberAuth.getIdToken) {
          box.p = Promise.resolve(targetWindow.IGDCMemberAuth.getIdToken()).then(function (value) {
            pushToken(value, output, seen, 0);
          }).catch(function () {});
        }
        [targetWindow.localStorage, targetWindow.sessionStorage].forEach(function (store) {
          if (!store) return;
          TOKEN_KEYS.forEach(function (key) {
            try { pushToken(store.getItem(key), output, seen, 0); } catch (_error) {}
          });
        });
      } catch (_error) {}
    });
    await Promise.all(tasks.map(function (item) { return item.p || Promise.resolve(); }));
    return output;
  }

  async function request(action, method, params, body, authToken) {
    var url = new URL(CONTROL, location.origin);
    url.searchParams.set('action', action);
    Object.keys(params || {}).forEach(function (key) {
      if (params[key] != null && params[key] !== '') url.searchParams.set(key, params[key]);
    });
    var init = {
      method: method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + authToken }
    };
    if (init.method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(Object.assign({ action: action }, body || {}));
    }
    var response = await fetch(url.pathname + url.search, init);
    var data = await response.json().catch(function () { return null; });
    if (!response.ok || !data || data.ok !== true) {
      var error = new Error(data && data.error || ('HTTP ' + response.status));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function ensure() {
    if (token) return token;
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async function () {
      var list = await tokens();
      for (var index = 0; index < list.length; index += 1) {
        try {
          await request('session', 'GET', {}, null, list[index]);
          token = list[index];
          return token;
        } catch (_error) {}
      }
      throw new Error('관리자 공통 세션을 확인하지 못했습니다.');
    })();
    try { return await sessionPromise; } finally { sessionPromise = null; }
  }

  async function api(action, method, params, body) {
    var authToken = await ensure();
    try {
      return await request(action, method, params, body, authToken);
    } catch (error) {
      if (Number(error.status) === 401) {
        token = '';
        authToken = await ensure();
        return request(action, method, params, body, authToken);
      }
      throw error;
    }
  }

  function lines(value) {
    var output = [];
    text(value).split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean).forEach(function (item) {
      if (output.indexOf(item) < 0) output.push(item);
    });
    return output;
  }

  function scopeState() {
    var state = window.IGDC_ADMIN_COUNTRY_SCOPE || {};
    return {
      country: text(state.country).toUpperCase(),
      region: text(state.region || 'NATIONWIDE').toUpperCase() || 'NATIONWIDE',
      regionGroup: text(state.regionGroup)
    };
  }

  function buildScope(type) {
    var state = scopeState();
    if (type === 'global') return { scopeType: 'global' };
    if (type === 'regional') {
      if (!state.regionGroup) throw new Error('먼저 권역을 선택해 주세요.');
      return { scopeType: 'regional', regionGroup: state.regionGroup };
    }
    if (!state.country) throw new Error('먼저 국가를 선택해 주세요.');
    return {
      scopeType: 'country',
      regionGroup: state.regionGroup,
      countryCode: state.country,
      subdivisionCode: state.region
    };
  }

  function modalNotice(message, kind) {
    var element = $('policyModalNotice');
    element.className = 'notice ' + (kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : kind === 'fail' ? 'fail' : '');
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function clearModalNotice() {
    var element = $('policyModalNotice');
    element.classList.add('hidden');
    element.textContent = '';
  }

  function workspaceStatus(workspace) {
    if (!workspace) return '저장 정책 없음';
    var label = workspace.status === 'active' ? '활성' : workspace.status === 'paused' ? '일시중지' : '초안';
    return label +
      (workspace.validUntil ? ' · ' + workspace.validUntil.slice(0, 10) + '까지' : '') +
      (workspace.updatedAt ? ' · ' + workspace.updatedAt.slice(0, 16).replace('T', ' ') : '');
  }

  function updateBadge(scope, workspace) {
    var id = scope.scopeType === 'global' ? 'globalPolicyState' : scope.scopeType === 'regional' ? 'regionalPolicyState' : 'countryPolicyState';
    var element = $(id);
    if (element) element.textContent = '관리자 정책: ' + workspaceStatus(workspace);
  }

  function renderMessages(messages) {
    var element = $('policyTranscript');
    var rows = Array.isArray(messages) ? messages : [];
    if (!rows.length) {
      element.innerHTML = '<div class="small">저장된 협의 기록이 없습니다.</div>';
      return;
    }
    element.innerHTML = rows.map(function (row) {
      var role = row.role === 'assistant' ? 'assistant' : 'user';
      return '<div class="policy-message ' + role + '"><strong>' + (role === 'assistant' ? 'AI' : '관리자') + '</strong>\n' + esc(row.content || '') + '</div>';
    }).join('');
    element.scrollTop = element.scrollHeight;
  }

  function proposalData(workspace) {
    return workspace && workspace.latestProposal && typeof workspace.latestProposal === 'object' ? workspace.latestProposal : {};
  }

  function notifyVoiceAnswer(workspace, proposal) {
    var messageRows = Array.isArray(workspace && workspace.messages) ? workspace.messages : [];
    var latestAssistant = '';
    for (var index = messageRows.length - 1; index >= 0; index -= 1) {
      if (messageRows[index] && messageRows[index].role === 'assistant') {
        latestAssistant = text(messageRows[index].content);
        break;
      }
    }
    var summary = text(proposal && proposal.summary) || latestAssistant;
    if (summary) {
      window.dispatchEvent(new CustomEvent('igdc:policy-ai-response', { detail: { text: summary } }));
    }
  }

  function updateVoiceTargetAvailability(isCountry) {
    var select = $('policyVoiceTarget');
    if (!select) return;
    ['policyPriorityTargets', 'policyBlockedTargets'].forEach(function (value) {
      var option = Array.prototype.find.call(select.options, function (item) { return item.value === value; });
      if (option) option.disabled = !isCountry;
    });
    if (!isCountry && (select.value === 'policyPriorityTargets' || select.value === 'policyBlockedTargets')) {
      select.value = 'policyInstruction';
    }
  }

  function renderWorkspace(workspace) {
    currentWorkspace = workspace;
    var proposal = proposalData(workspace);
    var scope = workspace.scope || {};
    $('policyScopeLabel').textContent = scope.scopeLabel || scope.scopeType || '';
    $('policyInstruction').value = workspace.administratorInstruction || '';
    $('policyFinalDecision').value = workspace.finalDecision || '';
    $('policyStatus').value = workspace.status || 'draft';
    $('policyValidityDays').value = workspace.validityDays || 30;
    $('policyWeights').value = JSON.stringify(
      workspace.categoryWeights && Object.keys(workspace.categoryWeights).length ? workspace.categoryWeights : (proposal.categoryWeights || {}),
      null,
      2
    );
    $('policyPriorityDirections').value = (workspace.priorityDirections && workspace.priorityDirections.length ? workspace.priorityDirections : (proposal.priorityDirections || [])).join('\n');
    $('policyAvoidDirections').value = (workspace.avoidDirections && workspace.avoidDirections.length ? workspace.avoidDirections : (proposal.avoidDirections || [])).join('\n');
    $('policyPriorityTargets').value = (workspace.manualPriorityTargets && workspace.manualPriorityTargets.length ? workspace.manualPriorityTargets : (proposal.manualPriorityTargets || [])).join('\n');
    $('policyBlockedTargets').value = (workspace.manualBlockedTargets && workspace.manualBlockedTargets.length ? workspace.manualBlockedTargets : (proposal.manualBlockedTargets || [])).join('\n');
    $('policyProposal').textContent = Object.keys(proposal).length ? JSON.stringify(proposal, null, 2) : 'AI와 협의하면 구조화된 정책안이 표시됩니다.';
    renderMessages(workspace.messages || []);
    var isCountry = scope.scopeType === 'country';
    $('policyCountryFields').classList.toggle('hidden', !isCountry);
    updateVoiceTargetAvailability(isCountry);
    updateBadge(scope, workspace);
    notifyVoiceAnswer(workspace, proposal);
  }

  function pageNotice(message, kind) {
    var element = $('notice');
    if (!element) return;
    element.className = 'notice ' + (kind === 'warn' ? 'warn' : kind === 'fail' ? 'fail' : kind === 'ok' ? 'ok' : '');
    element.textContent = message;
    element.classList.remove('hidden');
  }

  async function openPolicy(type) {
    clearModalNotice();
    try {
      currentScope = buildScope(type);
    } catch (error) {
      pageNotice(error.message, 'warn');
      return;
    }
    $('policyModal').classList.remove('hidden');
    $('policyModalTitle').textContent = type === 'global'
      ? '전 세계 정책 입안·AI 협의'
      : type === 'regional'
        ? '선택 권역 정책 입안·AI 협의'
        : '선택 국가 정책 입안·AI 협의·수동 통제';
    $('policyScopeLabel').textContent = '정책 작업공간을 불러오는 중입니다.';
    try {
      var data = await api('policy_workspace', 'GET', currentScope);
      currentResponse = data;
      renderWorkspace(data.workspace);
    } catch (error) {
      modalNotice(error.message || '정책 작업공간을 불러오지 못했습니다.', 'fail');
    }
  }

  function stopVoice() {
    if (window.IGDCPolicyVoice && typeof window.IGDCPolicyVoice.stop === 'function') {
      window.IGDCPolicyVoice.stop();
    }
  }

  function closeConfirm() {
    pendingSavePayload = null;
    $('policyConfirmModal').classList.add('hidden');
  }

  function closePolicy() {
    closeConfirm();
    stopVoice();
    $('policyModal').classList.add('hidden');
    clearModalNotice();
  }

  function setBusy(busy) {
    ['policyDiscussBtn', 'policySaveBtn', 'policyCloseBtn', 'policyConfirmSaveBtn'].forEach(function (id) {
      var element = $(id);
      if (element) element.disabled = !!busy;
    });
    window.dispatchEvent(new CustomEvent('igdc:policy-busy', { detail: { busy: !!busy } }));
  }

  async function discuss() {
    clearModalNotice();
    var instruction = text($('policyInstruction').value);
    if (!instruction) {
      modalNotice('AI에 전달할 정책 지시나 질문을 입력해 주세요.', 'warn');
      return false;
    }
    setBusy(true);
    try {
      var data = await api('policy_ai_discuss', 'POST', {}, { scope: currentScope, instruction: instruction });
      currentResponse = data;
      renderWorkspace(data.workspace);
      var proposal = data.ai && data.ai.proposal || {};
      $('policyWeights').value = JSON.stringify(proposal.categoryWeights || {}, null, 2);
      $('policyPriorityDirections').value = (proposal.priorityDirections || []).join('\n');
      $('policyAvoidDirections').value = (proposal.avoidDirections || []).join('\n');
      if (currentScope.scopeType === 'country') {
        $('policyPriorityTargets').value = (proposal.manualPriorityTargets || []).join('\n');
        $('policyBlockedTargets').value = (proposal.manualBlockedTargets || []).join('\n');
      }
      $('policyProposal').textContent = JSON.stringify(proposal, null, 2);
      var speechText = text(proposal.summary) || 'AI 정책안을 작성했습니다.';
      window.dispatchEvent(new CustomEvent('igdc:policy-ai-response', { detail: { text: speechText } }));
      modalNotice(
        data.ai && data.ai.error
          ? 'AI 협의는 제한 모드로 저장됐습니다: ' + data.ai.error
          : 'AI 정책안을 작성하고 협의 기록을 저장했습니다. 관리자 최종 결정을 확인해 주세요.',
        data.ai && data.ai.error ? 'warn' : 'ok'
      );
      return true;
    } catch (error) {
      modalNotice(error.message || 'AI 정책 협의에 실패했습니다.', 'fail');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function weightsValue() {
    var raw = text($('policyWeights').value);
    if (!raw) return {};
    var parsed = parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('품목군 가중치 JSON 형식을 확인해 주세요.');
    }
    return parsed;
  }

  function collectPayload() {
    var payload = {
      scope: currentScope,
      administratorInstruction: text($('policyInstruction').value),
      finalDecision: text($('policyFinalDecision').value),
      status: $('policyStatus').value,
      validityDays: Number($('policyValidityDays').value) || 30,
      categoryWeights: weightsValue(),
      priorityDirections: lines($('policyPriorityDirections').value),
      avoidDirections: lines($('policyAvoidDirections').value),
      manualPriorityTargets: lines($('policyPriorityTargets').value),
      manualBlockedTargets: lines($('policyBlockedTargets').value)
    };
    if (payload.status === 'active' && !payload.finalDecision) {
      throw new Error('활성 정책으로 저장하려면 관리자 최종 결정 내용을 입력해 주세요.');
    }
    return payload;
  }

  function scopeLabel(scope) {
    if (!scope) return '-';
    if (scope.scopeType === 'global') return '전 세계 통합';
    if (scope.scopeType === 'regional') return '권역 · ' + text(scope.regionGroup);
    return '국가 · ' + text(scope.countryCode) + ' / ' + text(scope.subdivisionCode || 'NATIONWIDE');
  }

  function statusLabel(status) {
    return status === 'active' ? '활성 정책' : status === 'paused' ? '일시중지' : '초안 저장';
  }

  function payloadSummary(payload) {
    var summary = [
      '적용 범위: ' + scopeLabel(payload.scope),
      '저장 상태: ' + statusLabel(payload.status),
      '유효기간: ' + payload.validityDays + '일',
      '',
      '[관리자 최종 결정]',
      payload.finalDecision || '(비어 있음)',
      '',
      '[정책 지시·질문]',
      payload.administratorInstruction || '(비어 있음)',
      '',
      '[품목군 가중치]',
      JSON.stringify(payload.categoryWeights || {}, null, 2),
      '',
      '[우선 방향]',
      payload.priorityDirections.length ? payload.priorityDirections.join('\n') : '(없음)',
      '',
      '[축소·제외 방향]',
      payload.avoidDirections.length ? payload.avoidDirections.join('\n') : '(없음)'
    ];
    if (payload.scope && payload.scope.scopeType === 'country') {
      summary.push(
        '',
        '[관리자 수동 우선 업체·상품·URL]',
        payload.manualPriorityTargets.length ? payload.manualPriorityTargets.join('\n') : '(없음)',
        '',
        '[관리자 수동 제외 업체·상품·URL]',
        payload.manualBlockedTargets.length ? payload.manualBlockedTargets.join('\n') : '(없음)'
      );
    }
    return summary.join('\n');
  }

  function requestSaveReview() {
    clearModalNotice();
    try {
      pendingSavePayload = collectPayload();
    } catch (error) {
      modalNotice(error.message, 'warn');
      return;
    }
    $('policyConfirmSummary').textContent = payloadSummary(pendingSavePayload);
    $('policyConfirmModal').classList.remove('hidden');
    $('policyConfirmSaveBtn').focus();
  }

  async function commitSave() {
    if (!pendingSavePayload) return;
    var payload = pendingSavePayload;
    setBusy(true);
    try {
      var data = await api('policy_decision_save', 'POST', {}, payload);
      currentResponse = data;
      renderWorkspace(data.workspace);
      closeConfirm();
      modalNotice('관리자 결정과 정책 통제 내용을 저장했습니다. 활성 정책은 다음 자동 수집부터 일반 AI보다 우선 적용됩니다.', 'ok');
    } catch (error) {
      modalNotice(error.message || '관리자 정책 저장에 실패했습니다.', 'fail');
      $('policyConfirmModal').classList.add('hidden');
      pendingSavePayload = null;
    } finally {
      setBusy(false);
    }
  }

  function clearDraftInputs() {
    ['policyInstruction', 'policyFinalDecision', 'policyPriorityDirections', 'policyAvoidDirections', 'policyPriorityTargets', 'policyBlockedTargets'].forEach(function (id) {
      var element = $(id);
      if (element) element.value = '';
    });
    $('policyWeights').value = '{}';
    $('policyStatus').value = 'draft';
    $('policyValidityDays').value = 30;
    closeConfirm();
    modalNotice('현재 입력창의 작성 내용만 삭제했습니다. 서버에 이미 저장된 정책과 협의 기록은 변경하지 않았습니다.', 'warn');
    $('policyInstruction').focus();
  }

  function download() {
    var data = currentResponse || { ok: true, workspace: currentWorkspace };
    if (!data) return;
    var scope = currentScope || {};
    var stamp = new Date().toISOString().replace(/[:.]/g, '-');
    var name = 'IGDC_POLICY_' + text(scope.scopeType).toUpperCase() +
      (scope.regionGroup ? '_' + text(scope.regionGroup).toUpperCase() : '') +
      (scope.countryCode ? '_' + scope.countryCode : '') + '_' + stamp + '.json';
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function runGlobalSituationCheck() {
    var sourceButton = $('globalSignalBtn');
    if (!sourceButton) {
      pageNotice('전 세계 상황 점검 기능을 찾지 못했습니다.', 'fail');
      return;
    }
    sourceButton.click();
    sourceButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sourceButton.focus({ preventScroll: true });
  }

  function wire() {
    if (!$('policyModal')) return;
    $('globalPolicyBtn').addEventListener('click', function () { openPolicy('global'); });
    $('regionalPolicyBtn').addEventListener('click', function () { openPolicy('regional'); });
    $('countryPolicyBtn').addEventListener('click', function () { openPolicy('country'); });
    $('globalSituationBtn').addEventListener('click', runGlobalSituationCheck);
    $('policyCloseBtn').addEventListener('click', closePolicy);
    $('policyDiscussBtn').addEventListener('click', discuss);
    $('policySaveBtn').addEventListener('click', requestSaveReview);
    $('policyDownloadBtn').addEventListener('click', download);
    $('policyConfirmSaveBtn').addEventListener('click', commitSave);
    $('policyConfirmEditBtn').addEventListener('click', function () {
      closeConfirm();
      $('policyFinalDecision').focus();
    });
    $('policyConfirmClearBtn').addEventListener('click', clearDraftInputs);
    $('policyConfirmCancelBtn').addEventListener('click', closeConfirm);
    $('policyModal').addEventListener('click', function (event) {
      if (event.target === $('policyModal')) closePolicy();
    });
    $('policyConfirmModal').addEventListener('click', function (event) {
      if (event.target === $('policyConfirmModal')) closeConfirm();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!$('policyConfirmModal').classList.contains('hidden')) {
        closeConfirm();
        return;
      }
      if (!$('policyModal').classList.contains('hidden')) closePolicy();
    });
  }

  window.IGDCPolicyDiscussion = {
    open: openPolicy,
    close: closePolicy,
    discuss: discuss,
    getCurrentScope: function () { return currentScope; },
    getCurrentWorkspace: function () { return currentWorkspace; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
