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
  var currentWorkspaceType = 'global';
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

  function buildScope(type, options) {
    var state = scopeState();
    var opts = options && typeof options === 'object' ? options : {};
    var workspaceKey = text(opts.workspaceKey || 'policy') || 'policy';
    var workspaceLabel = text(opts.workspaceLabel || '');
    var base;
    if (type === 'global') base = { scopeType: 'global' };
    else if (type === 'regional') {
      if (!state.regionGroup) throw new Error('먼저 권역을 선택해 주세요.');
      base = { scopeType: 'regional', regionGroup: state.regionGroup };
    } else {
      if (!state.country) throw new Error('먼저 국가를 선택해 주세요.');
      base = { scopeType: 'country', regionGroup: state.regionGroup, countryCode: state.country, subdivisionCode: state.region };
    }
    base.workspaceKey = workspaceKey;
    if (workspaceLabel) base.workspaceLabel = workspaceLabel;
    return base;
  }

  function canonicalWorkspace(scope) {
    return !scope || !text(scope.workspaceKey) || text(scope.workspaceKey) === 'policy';
  }

  function detectLanguage(value) {
    var sample = text(value);
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(sample)) return 'ko-KR';
    if (/[ぁ-んァ-ヶ]/.test(sample)) return 'ja-JP';
    if (/[一-鿿]/.test(sample)) return 'zh-CN';
    if (/[؀-ۿ]/.test(sample)) return 'ar-SA';
    if (/[ऀ-ॿ]/.test(sample)) return 'hi-IN';
    if (/[฀-๿]/.test(sample)) return 'th-TH';
    return 'en-US';
  }

  function responseLanguage() {
    var select = $('policyVoiceLanguage');
    var selected = select ? text(select.value) : 'auto';
    if (selected && selected !== 'auto') return selected;
    return detectLanguage($('policyInstruction') && $('policyInstruction').value);
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
    if (!canonicalWorkspace(scope)) return;
    var id = scope.scopeType === 'global' ? 'globalPolicyState' : scope.scopeType === 'regional' ? 'regionalPolicyState' : 'countryPolicyState';
    var element = $(id);
    if (element) element.textContent = '관리자 정책: ' + workspaceStatus(workspace);
  }

  function selectedMessageIds() {
    return Array.prototype.map.call(document.querySelectorAll('[data-policy-message-select]:checked'), function (box) {
      return text(box.value);
    }).filter(Boolean);
  }

  function syncMessageSelection() {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-policy-message-select]'));
    var selected = boxes.filter(function (box) { return box.checked; });
    var all = $('policyMessageSelectAll');
    if (all) {
      all.checked = boxes.length > 0 && selected.length === boxes.length;
      all.indeterminate = selected.length > 0 && selected.length < boxes.length;
      all.disabled = !boxes.length;
    }
    if ($('policyMessageSelectedCount')) $('policyMessageSelectedCount').textContent = '선택 ' + selected.length + '건';
    if ($('policyMessageDeleteBtn')) $('policyMessageDeleteBtn').disabled = !selected.length;
    if ($('policyMessageClearBtn')) $('policyMessageClearBtn').disabled = !boxes.length;
  }

  function renderMessages(messages) {
    var element = $('policyTranscript');
    var rows = Array.isArray(messages) ? messages : [];
    if (!rows.length) {
      element.innerHTML = '<div class="small">저장된 대화 기록이 없습니다.</div>';
      syncMessageSelection();
      return;
    }
    element.innerHTML = rows.map(function (row, index) {
      var role = row.role === 'assistant' ? 'assistant' : row.role === 'system' ? 'system' : 'user';
      var label = role === 'assistant' ? 'AI' : role === 'system' ? '시스템' : '관리자';
      var id = text(row.id || ('message_' + index));
      var created = text(row.createdAt);
      return '<div class="policy-message ' + role + '"><label class="policy-message-select"><input type="checkbox" data-policy-message-select="1" value="' + esc(id) + '"> 선택</label><strong>' + label + '</strong>' +
        (created ? '<span class="policy-message-time">' + esc(created.slice(0, 16).replace('T', ' ')) + '</span>' : '') +
        '<div class="policy-message-content">' + esc(row.content || '') + '</div></div>';
    }).join('');
    element.scrollTop = element.scrollHeight;
    syncMessageSelection();
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
      window.dispatchEvent(new CustomEvent('igdc:policy-ai-response', { detail: { text: summary, language: text(proposal && proposal.language && proposal.language.code) || responseLanguage() } }));
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
    var workspaceName = text(workspace.workspaceLabel || scope.workspaceLabel);
    $('policyScopeLabel').textContent = (scope.scopeLabel || scope.scopeType || '') + (workspaceName ? ' · ' + workspaceName : '');
    $('policyInstruction').value = workspace.administratorInstruction || '';
    $('policyFinalDecision').value = workspace.finalDecision || '';
    var canonical = canonicalWorkspace(scope);
    $('policyStatus').value = canonical ? (workspace.status || 'draft') : 'draft';
    $('policyStatus').disabled = !canonical;
    if ($('policyPromoteBtn')) $('policyPromoteBtn').classList.toggle('hidden', canonical);
    if ($('policyWorkspaceDeleteBtn')) $('policyWorkspaceDeleteBtn').classList.toggle('hidden', canonical);
    if ($('policyDecisionClearBtn')) $('policyDecisionClearBtn').disabled = !text(workspace.finalDecision) && !(workspace.categoryWeights && Object.keys(workspace.categoryWeights).some(function (key) { return Number(workspace.categoryWeights[key]) !== 0; }));
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
    $('policyProposal').textContent = Object.keys(proposal).length ? JSON.stringify(proposal, null, 2) : 'AI와 대화하면 운영 의견과 구조화된 제안이 표시됩니다.';
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

  async function openPolicy(type, options) {
    clearModalNotice();
    currentWorkspaceType = type || 'global';
    try {
      currentScope = buildScope(currentWorkspaceType, options || {});
    } catch (error) {
      pageNotice(error.message, 'warn');
      return;
    }
    $('policyModal').classList.remove('hidden');
    var workspaceName = text(currentScope.workspaceLabel);
    $('policyModalTitle').textContent = workspaceName ? workspaceName + ' · AI 운영·정책 대화' :
      currentWorkspaceType === 'global' ? '전 세계 정책 입안·AI 협의' :
      currentWorkspaceType === 'regional' ? '선택 권역 정책 입안·AI 협의' : '선택 국가 정책 입안·AI 협의·수동 통제';
    $('policyScopeLabel').textContent = 'AI 대화 작업공간을 불러오는 중입니다.';
    try {
      var data = await api('policy_workspace', 'GET', currentScope);
      currentResponse = data;
      renderWorkspace(data.workspace);
      setTimeout(function () { if ($('policyInstruction')) $('policyInstruction').focus(); }, 0);
    } catch (error) {
      modalNotice(error.message || 'AI 대화 작업공간을 불러오지 못했습니다.', 'fail');
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
    ['policyDiscussBtn', 'policySaveBtn', 'policyCloseBtn', 'policyConfirmSaveBtn', 'policyMessageDeleteBtn', 'policyMessageClearBtn', 'policyDecisionClearBtn', 'policyWorkspaceDeleteBtn', 'policyPromoteBtn'].forEach(function (id) {
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
      var language = responseLanguage();
      var data = await api('policy_ai_discuss', 'POST', {}, { scope: currentScope, instruction: instruction, language: language });
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
      modalNotice(
        data.ai && data.ai.error
          ? 'AI 대화는 제한 모드로 저장됐습니다: ' + data.ai.error
          : (canonicalWorkspace(currentScope) ? 'AI 정책안을 작성하고 대화 기록을 저장했습니다. 관리자 최종 결정을 확인해 주세요.' : '이 블록의 운영 대화와 AI 제안을 저장했습니다. 필요한 내용만 정책 초안으로 반영할 수 있습니다.'),
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
      status: canonicalWorkspace(currentScope) ? $('policyStatus').value : 'draft',
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
      modalNotice(canonicalWorkspace(currentScope) ? '관리자 결정과 정책 통제 내용을 저장했습니다. 활성 정책은 다음 자동 수집부터 일반 AI보다 우선 적용됩니다.' : '이 블록의 운영 결정·메모를 저장했습니다. 아직 운영 정책에는 자동 반영되지 않습니다.', 'ok');
    } catch (error) {
      modalNotice(error.message || '관리자 정책 저장에 실패했습니다.', 'fail');
      $('policyConfirmModal').classList.add('hidden');
      pendingSavePayload = null;
    } finally {
      setBusy(false);
    }
  }

  async function reloadCurrentWorkspace() {
    if (!currentScope) return null;
    var data = await api('policy_workspace', 'GET', currentScope);
    currentResponse = data;
    renderWorkspace(data.workspace);
    return data;
  }

  async function deleteSelectedMessages(all) {
    var ids = all ? [] : selectedMessageIds();
    if (!all && !ids.length) {
      modalNotice('삭제할 대화 기록을 선택해 주세요.', 'warn');
      return;
    }
    var countText = all ? '이 작업공간의 저장된 대화 기록 전체' : '선택한 대화 기록 ' + ids.length + '건';
    if (!window.confirm(countText + '를 삭제합니다. 최종 정책·관리자 결정은 별도로 유지됩니다. 계속할까요?')) return;
    setBusy(true);
    try {
      var data = await api('policy_messages_delete', 'POST', {}, { scope: currentScope, messageIds: ids, all: all === true });
      currentResponse = data;
      renderWorkspace(data.workspace);
      modalNotice('대화 기록 ' + Number(data.deleted || 0) + '건을 삭제했습니다.', 'ok');
    } catch (error) {
      modalNotice(error.message || '대화 기록을 삭제하지 못했습니다.', 'fail');
    } finally {
      setBusy(false);
    }
  }

  async function clearSavedDecision() {
    if (!currentScope) return;
    if (!window.confirm('이 작업공간에 저장된 관리자 최종 결정·가중치·우선/제외 방향을 삭제하고 초안 상태로 되돌립니다. 대화 기록은 유지합니다. 계속할까요?')) return;
    setBusy(true);
    try {
      var data = await api('policy_decision_clear', 'POST', {}, { scope: currentScope });
      currentResponse = data;
      renderWorkspace(data.workspace);
      modalNotice('저장된 결정·정책 내용을 삭제했습니다. 대화 기록은 그대로 유지했습니다.', 'ok');
    } catch (error) {
      modalNotice(error.message || '저장된 결정 내용을 삭제하지 못했습니다.', 'fail');
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentWorkspace() {
    if (!currentScope || canonicalWorkspace(currentScope)) return;
    var label = text(currentScope.workspaceLabel || currentScope.workspaceKey);
    if (!window.confirm('[' + label + '] 작업공간의 대화 기록·저장 결정 전체를 삭제합니다. 정식 정책 작업공간에는 영향을 주지 않습니다. 계속할까요?')) return;
    setBusy(true);
    try {
      var data = await api('policy_workspace_delete', 'POST', {}, { scope: currentScope });
      currentResponse = data;
      renderWorkspace(data.workspace);
      modalNotice('이 블록의 AI 대화 작업공간을 초기화했습니다.', 'ok');
    } catch (error) {
      modalNotice(error.message || '작업공간을 삭제하지 못했습니다.', 'fail');
    } finally {
      setBusy(false);
    }
  }

  async function promoteCurrentToPolicy() {
    if (!currentScope || canonicalWorkspace(currentScope)) return;
    var decision = text($('policyFinalDecision').value);
    if (!decision) {
      var proposal = proposalData(currentWorkspace);
      decision = text(proposal.summary) || text($('policyInstruction').value);
    }
    if (!decision) {
      modalNotice('정책 초안으로 반영할 관리자 결정 또는 대화 내용을 먼저 작성해 주세요.', 'warn');
      return;
    }
    if (!window.confirm('이 블록에서 협의한 내용을 현재 국가·권역·전 세계의 정식 정책 작업공간에 "초안"으로 복사합니다. 자동 활성화되지는 않습니다. 계속할까요?')) return;
    setBusy(true);
    try {
      await api('policy_promote', 'POST', {}, { scope: currentScope, finalDecision: decision, status: 'draft' });
      modalNotice('이 블록의 결정 내용을 정식 정책 작업공간에 초안으로 반영했습니다. 정책 버튼에서 다시 확인·수정·활성화할 수 있습니다.', 'ok');
    } catch (error) {
      modalNotice(error.message || '정책 초안으로 반영하지 못했습니다.', 'fail');
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
    if ($('policyMessageSelectAll')) $('policyMessageSelectAll').addEventListener('change', function () {
      var checked = this.checked;
      Array.prototype.forEach.call(document.querySelectorAll('[data-policy-message-select]'), function (box) { box.checked = checked; });
      syncMessageSelection();
    });
    if ($('policyTranscript')) $('policyTranscript').addEventListener('change', function (event) {
      if (event.target && event.target.matches('[data-policy-message-select]')) syncMessageSelection();
    });
    if ($('policyMessageDeleteBtn')) $('policyMessageDeleteBtn').addEventListener('click', function () { deleteSelectedMessages(false); });
    if ($('policyMessageClearBtn')) $('policyMessageClearBtn').addEventListener('click', function () { deleteSelectedMessages(true); });
    if ($('policyDecisionClearBtn')) $('policyDecisionClearBtn').addEventListener('click', clearSavedDecision);
    if ($('policyWorkspaceDeleteBtn')) $('policyWorkspaceDeleteBtn').addEventListener('click', deleteCurrentWorkspace);
    if ($('policyPromoteBtn')) $('policyPromoteBtn').addEventListener('click', promoteCurrentToPolicy);
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
    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-policy-workspace]') : null;
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      var requestedType = text(button.getAttribute('data-policy-scope') || 'country');
      openPolicy(requestedType, {
        workspaceKey: text(button.getAttribute('data-policy-workspace')),
        workspaceLabel: text(button.getAttribute('data-policy-workspace-label'))
      });
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
    openWorkspace: function (options) {
      options = options || {};
      return openPolicy(text(options.scopeType || 'country'), options);
    },
    close: closePolicy,
    discuss: discuss,
    getCurrentScope: function () { return currentScope; },
    getCurrentWorkspace: function () { return currentWorkspace; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
