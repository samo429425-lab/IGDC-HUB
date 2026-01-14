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
   SERVER RESPONSE — FIXED (Q/A 분리)
========================= */
function handleServerResponse(res){
  // --- FAIL SAFE ---
  if (!res || !res.ok) {
    renderSummary('글로벌 인사이트 데이터를 불러오지 못했습니다.\n다시 실행해 주세요.');

    if (window.MaruConversationModal?.showInput) {
      window.MaruConversationModal.showInput();
    }

    console.warn('[MARU][INSIGHT][FAIL]', res);
    return;
  }

  // --- RESULT LABEL ---
let resultLabel = '';
if (res.mode === 'realtime') {
  resultLabel = '🟠 실시간 이슈 요약';
} else if (res.mode === 'global') {
  resultLabel = '🔵 AI 글로벌 인사이트';
} else if (res.mode === 'expand') {
  resultLabel = '🟣 상세 인사이트';
}

// --- SUMMARY (라벨 포함) ---
renderSummary(
  (resultLabel ? resultLabel + '\n\n' : '') +
  (res.text || '')
);

  // --- EXPAND HANDOFF ---
  if (res.mode === 'expand' && typeof Prev.openExpandedInsight === 'function') {
    Prev.openExpandedInsight(res);
    return;
  }

  // --- SPEECH OUTPUT (답변만 읽기) ---
  const hasSpeech =
    typeof res.speech === 'string' &&
    res.speech.trim().length > 0;

  const isQuestionEcho =
    typeof res.text === 'string' &&
    hasSpeech &&
    res.speech.trim() === res.text.trim();

  if (
    hasSpeech &&
    !isQuestionEcho &&                    // 질문 echo 차단
    isVoiceEnabled() &&
    typeof window.maruVoiceSpeak === 'function'
  ) {
    window.maruVoiceSpeak(res.speech);    // 답변만 읽기
  }

  // --- INPUT RECOVER ---
  if (window.MaruConversationModal?.showInput) {
    window.MaruConversationModal.showInput();
  }
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