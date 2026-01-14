/**
 * MARU SITE CONTROL ADDON — CONNECTOR FIX
 * -------------------------------------
 * 목적:
 * - 기존 애드온/보이스/컨버세이션/사이트컨트롤이 기대하는
 *   엔트리 포인트(handleTextQuery/handleVoiceQuery)를 100% 복원
 * - 내부 로직은 현재 Netlify Function(maru-global-insight) 기반 유지
 * - 기존 파일 수정 없이 '연결 고리'만 정상화
 */

(function(){
  'use strict';

  // 기존 MaruAddon이 있더라도 엔트리 포인트만 병합
  const Prev = window.MaruAddon || {};
  const Addon = {};

  let CURRENT_SCOPE = 'global';

  function isVoiceEnabled(){
    return (
      window.MARU_REGION_VOICE_READY === true ||
      window.MARU_COUNTRY_VOICE_READY === true
    );
  }

  function setScope(scope){
    CURRENT_SCOPE = scope || 'global';
  }

  /* =========================
     SUMMARY RENDER (호환)
  ========================= */
  function renderSummary(text){
    const box =
      document.querySelector('.igdc-sc-ai.maru-global-insight textarea') ||
      document.querySelector('.igdc-sc-ai textarea') ||
      document.querySelector('#maru-global-insight-summary');

    if (!box) return;

    if (box.tagName === 'TEXTAREA') {
      box.value = text || '';
    } else {
      box.innerHTML = '';
      const pre = document.createElement('pre');
      pre.style.whiteSpace='pre-wrap';
      pre.style.lineHeight='1.5';
      pre.style.maxHeight='160px';
      pre.style.overflowY='auto';
      pre.textContent = text || '';
      box.appendChild(pre);
    }
  }

  /* =========================
     NETLIFY INSIGHT CALL
  ========================= */
  async function requestInsight(payload){
    const body = payload || {};
    try{
      const res = await fetch('/.netlify/functions/maru-global-insight', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify(body)
      });
      const json = await res.json();
      handleServerResponse(json);
      return json;
    }catch(e){
      console.error('[MARU] insight request failed', e);
      return null;
    }
  }

  /* =========================
     SERVER RESPONSE (호환)
  ========================= */
  function handleServerResponse(res){
    if (!res || !res.ok) return;

    renderSummary(res.text || '');

    if (res.mode === 'expand' && typeof Prev.openExpandedInsight === 'function') {
      Prev.openExpandedInsight(res);
      return;
    }

    if (res.speech && isVoiceEnabled() && typeof window.maruVoiceSpeak === 'function') {
      window.maruVoiceSpeak(res.speech);
    }

    // Conversation 복귀
    if (window.MaruConversationModal && typeof window.MaruConversationModal.showInput === 'function') {
      window.MaruConversationModal.showInput();
    }
  }

  /* =========================
     LEGACY ENTRY POINTS (핵심)
  ========================= */
  function handleTextQuery(text, context){
    return requestInsight({
      text: String(text || ''),
      scope: CURRENT_SCOPE,
      depth: 'summary',
      context
    });
  }

  function handleVoiceQuery(text, context){
    if (!isVoiceEnabled()) return;
    const t = String(text || '');
    const expand = t.length > 80 || /자세히|상세|브리핑|프리핑|expand/i.test(t);
    return requestInsight({
      text: t,
      scope: CURRENT_SCOPE,
      depth: expand ? 'expand' : 'summary',
      context
    });
  }

  /* =========================
     BUTTON BIND (보존)
  ========================= */
  function bindButtons(){
    const aiBtn =
      document.getElementById('btn-ai-global-insight') ||
      document.querySelector('button[data-maru="ai-global"]');

    if (aiBtn && !aiBtn.dataset.maruBound) {
      aiBtn.dataset.maruBound = '1';
      aiBtn.addEventListener('click', ()=>{
        requestInsight({ scope: CURRENT_SCOPE, depth:'expand' });
      });
    }

    const issueBtn =
      document.getElementById('btn-realtime-issue') ||
      document.querySelector('button[data-maru="realtime-issue"]');

    if (issueBtn && !issueBtn.dataset.maruBound) {
      issueBtn.dataset.maruBound = '1';
      issueBtn.addEventListener('click', ()=>{
        requestInsight({ scope:'global', depth:'summary', issue:true });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButtons);
  } else {
    bindButtons();
    setTimeout(bindButtons, 500);
  }

  // 병합 공개
  window.MaruAddon = Object.assign({}, Prev, {
    setScope,
    handleTextQuery,
    handleVoiceQuery,
    handleServerResponse,
    requestInsight
  });

})();