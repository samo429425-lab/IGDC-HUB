/**
 * MARU SITE CONTROL ADDON — STEP 5 FINAL PLUS
 * -----------------------------------------
 * 추가 개선:
 * 1) 우측 패널 요약 카드 다중 라인 요약 표시
 * 2) AI 글로벌 인사이트 버튼 → 서버 재요청 확실 연결
 * 3) 실시간 이슈 버튼 → 글로벌 핫 이슈 요약 카드 표시
 * 4) Region / Country 요청 → Netlify Function 전달 경로 점검
 *
 * 전제:
 * - 서버 응답은 STEP 4 스키마를 따른다.
 */

(function(){
  'use strict';

  if (window.MaruAddon) return;

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
     SUMMARY CARD RENDER
  ========================= */
  function renderSummaryCard(res){
    const box = document.querySelector('#maru-global-insight-summary');
    if (!box) return;

    box.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.lineHeight = '1.5';
    pre.style.maxHeight = '160px';
    pre.style.overflowY = 'auto';
    pre.textContent = res.text || '';
    box.appendChild(pre);
  }

  /* =========================
     SERVER RESPONSE HANDLER
  ========================= */
  function handleServerResponse(res){
    if (!res || !res.ok) return;

    // 요약 카드 우선 반영
    renderSummaryCard(res);

    if (res.mode === 'expand') {
      openExpandedInsight(res);
      return;
    }

    if (res.speech && isVoiceEnabled() && window.maruVoiceSpeak) {
      window.maruVoiceSpeak(res.speech);
    }
  }

  /* =========================
     BUTTON WIRING CHECK
  ========================= */
  function bindButtons(){
    const aiBtn = document.querySelector('#btn-ai-global-insight');
    if (aiBtn) {
      aiBtn.onclick = () => {
        requestInsight({ scope: CURRENT_SCOPE, depth: 'expand' });
      };
    }

    const issueBtn = document.querySelector('#btn-realtime-issue');
    if (issueBtn) {
      issueBtn.onclick = () => {
        requestInsight({ scope: 'global', depth: 'summary', issue: true });
      };
    }
  }

  /* =========================
     REQUEST TO NETLIFY FUNCTION
  ========================= */
  async function requestInsight(payload){
    try {
      const res = await fetch('/.netlify/functions/maru-global-insight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      handleServerResponse(json);
    } catch (e) {
      console.error('[MARU] insight request failed', e);
    }
  }

  /* =========================
     EXPANDED INSIGHT UI
  ========================= */
  let expandedEl = null;

  function openExpandedInsight(res){
    if (!expandedEl) {
      expandedEl = document.createElement('div');
      expandedEl.id = 'maru-expanded-insight';
      expandedEl.innerHTML = `
        <div class="mei-overlay"></div>
        <div class="mei-panel">
          <div class="mei-header">
            <span class="mei-title">MARU Insight</span>
            <button class="mei-close">×</button>
          </div>
          <div class="mei-body">
            <pre class="mei-text"></pre>
          </div>
        </div>
      `;
      document.body.appendChild(expandedEl);
      expandedEl.querySelector('.mei-close').onclick = closeExpandedInsight;
      expandedEl.querySelector('.mei-overlay').onclick = closeExpandedInsight;
      injectStyle();
    }

    expandedEl.querySelector('.mei-text').textContent = res.text || '';
    expandedEl.style.display = 'block';

    if (res.speech && isVoiceEnabled() && window.maruVoiceSpeak) {
      window.maruVoiceSpeak(res.speech);
    }
  }

  function closeExpandedInsight(){
    if (expandedEl) expandedEl.style.display = 'none';
  }

  function injectStyle(){
    if (document.getElementById('mei-style')) return;
    const s = document.createElement('style');
    s.id = 'mei-style';
    s.textContent = `
      #maru-expanded-insight { position: fixed; inset:0; z-index:9999; display:none; }
      .mei-overlay { position:absolute; inset:0; background:rgba(0,0,0,.45); }
      .mei-panel {
        position:absolute; top:5%; left:50%; transform:translateX(-50%);
        width:80%; max-width:960px; height:90%;
        background:#fff; border-radius:10px; display:flex; flex-direction:column;
      }
      .mei-header {
        padding:12px 16px; border-bottom:1px solid #ddd;
        display:flex; justify-content:space-between; align-items:center;
        font-weight:bold;
      }
      .mei-close { background:none; border:0; font-size:22px; cursor:pointer; }
      .mei-body { padding:16px; overflow:auto; }
      .mei-text { white-space:pre-wrap; line-height:1.6; }
    `;
    document.head.appendChild(s);
  }

  /* =========================
     INIT
  ========================= */
  document.addEventListener('DOMContentLoaded', bindButtons);

  window.MaruAddon = {
    setScope,
    handleServerResponse,
    requestInsight
  };

})();