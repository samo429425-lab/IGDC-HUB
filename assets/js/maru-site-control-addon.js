/* =========================================================
 * MARU SITE CONTROL ADD-ON — GLOBAL INSIGHT BRAIN
 * FINAL MASTER VERSION (v1.0 — LOCKED)
 * =========================================================
 * ROLE
 *  - Single authoritative brain for MARU Global Insight
 *  - Explicit, user-intent driven execution ONLY
 *  - Snapshot-based intelligence controller
 *
 * ABSOLUTE RULES (FINAL)
 * 1. NO auto-fetch on load
 * 2. NO background refresh
 * 3. ONLY trigger = "AI 글로벌 인사이트 실행" button
 * 4. Snapshot replaces state atomically
 * 5. Default UI display = TODAY / CURRENT SITUATION ONLY
 * 6. Year/Month/Week/Integrated used ONLY on explicit request
 * 7. Region / Country / Voice / Video share SAME snapshot
 * 8. Video & Voice are SNAPSHOT-BOUND (no re-fetch)
 * ========================================================= */

(function(){
  'use strict';

  /* =======================================================
   * SESSION SNAPSHOT STATE (SINGLE SOURCE OF TRUTH)
   * ===================================================== */
  const SNAPSHOT = {
    status: 'IDLE',          // IDLE | LOADING | READY | ERROR
    ts: null,
    raw: null,               // full engine response (snapshot)
    view: {
      global: null,          // today summary
      regions: {},           // region.today
      countries: {},         // country.today
      critical: {
        regions: {},
        countries: {}
      }
    }
  };

  /* =======================================================
   * UTILS
   * ===================================================== */
  const $ = (s,r)=> (r||document).querySelector(s);
  const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
  const log = (...a)=> window.DEBUG_MARU && console.log('[MARU ADDON]',...a);

  /* =======================================================
   * UI TARGETS
   * ===================================================== */
  function summaryBox(){
    return $('[data-maru="global-insight"] textarea') || $('.igdc-sc-ai textarea');
  }

  function hasExpandedLayout(type){
    if(type==='region') return !!document.querySelector('.maru-region-expanded');
    if(type==='country') return !!document.querySelector('.maru-country-expanded');
    return false;
  }

  /* =======================================================
   * ENGINE ORDER — GLOBAL SNAPSHOT
   * ===================================================== */
  async function runGlobalInsight(){
    SNAPSHOT.status = 'LOADING';
    renderSummary('전 세계 AI 인사이트를 취합 중입니다…');

    const order = {
      context: 'global-insight',
      scope: 'global',
      timeline: ['year','month','week','today','integrated'],
      include: ['summary','regions','countries','critical','videos','voice'],
      locale: 'ko-KR'
    };

    try{
      const res = await fetch('/api/maru-search',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(order),
        cache:'no-store'
      });
      if(!res.ok) throw new Error('ENGINE_'+res.status);

      const json = await res.json();
      buildSnapshot(json);

    }catch(e){
      SNAPSHOT.status = 'ERROR';
      log('ENGINE FAIL', e);
      renderSummary('※ 글로벌 인사이트 취합 실패');
    }
  }

  /* =======================================================
   * SNAPSHOT BUILD (ATOMIC)
   * ===================================================== */
  function buildSnapshot(engineData){
    SNAPSHOT.raw = engineData;
    SNAPSHOT.ts = new Date().toISOString();
    SNAPSHOT.status = 'READY';

    // Global today summary
    SNAPSHOT.view.global = engineData.today || engineData.globalSummary || '';

    // Regions (TODAY only)
    (engineData.regions||[]).forEach(r=>{
      SNAPSHOT.view.regions[r.id] = r.today || '';
      if(r.critical) SNAPSHOT.view.critical.regions[r.id] = r.critical;
    });

    // Countries (TODAY only)
    (engineData.countries||[]).forEach(c=>{
      SNAPSHOT.view.countries[c.code] = c.today || '';
      if(c.critical) SNAPSHOT.view.critical.countries[c.code] = c.critical;
    });

    distribute();
    renderSummary(SNAPSHOT.view.global || '현재 전 세계 주요 상황 요약 정보가 없습니다.');
  }

  /* =======================================================
   * DISTRIBUTION (ONE SNAPSHOT, MANY CONSUMERS)
   * ===================================================== */
  function distribute(){
    if(!SNAPSHOT.raw) return;

    // Region modal
    if(window.injectMaruGlobalRegionData){
      window.injectMaruGlobalRegionData({
        today: SNAPSHOT.view.regions,
        critical: SNAPSHOT.view.critical.regions,
        snapshot: SNAPSHOT.raw
      });
    }

    // Country modal
    if(window.injectMaruGlobalCountryData){
      window.injectMaruGlobalCountryData({
        today: SNAPSHOT.view.countries,
        critical: SNAPSHOT.view.critical.countries,
        snapshot: SNAPSHOT.raw
      });
    }

    // Voice engine
    if(window.MaruVoice){ window.MARU_VOICE_READY = true; }
  }

  /* =======================================================
   * SUMMARY RENDER
   * ===================================================== */
  function renderSummary(t){ const box = summaryBox(); if(box) box.value = t||''; }

  /* =======================================================
   * IMPORTANT ISSUE EXPANSION
   * ===================================================== */
  function requestCriticalDetail(type,id){
    const crit = type==='region'
      ? SNAPSHOT.view.critical.regions[id]
      : SNAPSHOT.view.critical.countries[id];

    if(!crit) return;

    if(hasExpandedLayout(type)){
      document.dispatchEvent(new CustomEvent('maru:expand',{
        detail:{ type,id,data:crit }
      }));
    }

    if(window.MaruVoice){
      MaruVoice.play({
        level:type,
        id:id,
        depth:2,
        text:crit.detail || crit.summary
      });
    }
  }

  /* =======================================================
   * BUTTON BINDINGS
   * ===================================================== */
  function bindButtons(){
    const runBtn = document.getElementById('btnMaruGlobalInsight') ||
      $$('button').find(b=>b.textContent.includes('AI 글로벌 인사이트'));

    if(runBtn && !runBtn.dataset.bound){
      runBtn.dataset.bound='1';
      runBtn.onclick = e=>{ e.stopPropagation(); runGlobalInsight(); };
    }

    const rtBtn = $$('button').find(b=>b.textContent.includes('실시간'));
    if(rtBtn && !rtBtn.dataset.bound){
      rtBtn.dataset.bound='1';
      rtBtn.onclick = async()=>{
        renderSummary('전 세계 실시간 핵심 이슈 취합 중…');
        try{
          const r = await fetch('/api/maru-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:'realtime-issue',scope:'global'})});
          const j = await r.json();
          renderSummary(j.summary||'현재 주요 실시간 이슈가 없습니다.');
        }catch(_){ renderSummary('※ 실시간 이슈 취합 실패'); }
      };
    }
  }

/* =======================================================
 * CONVERSATION HUB (VOICE / TEXT → CONVERSATION MODAL)
 * =======================================================
 * 역할:
 *  - 보이스 인사이트에서 전달된 음성 텍스트 수신
 *  - 컨버세이션 모달에 사용자 발화 표시
 *  - 문자 입력창에서 전달된 텍스트 수신
 *  - 이후 AI 글로벌 인사이트 / 마루 엔진 확장 대비
 * 
 * 주의:
 *  - 기존 SNAPSHOT / runGlobalInsight / distribute 로직 절대 건드리지 않음
 *  - UI 생성 없음 (Conversation Modal 전담)
 * ===================================================== */

/**
 * 음성 입력 수신
 * maru-voice-insight.js 에서 호출됨
 */
function handleVoiceQuery(text){
  if(!text) return;

  // 1. 대화창에 사용자 발화 표시
  if(window.MaruConversationModal){
    MaruConversationModal.appendAssistant(text);
  }

  // 2. (향후 확장 지점)
  // - 음성 명령 분석
  // - "자세히", "실행", "확장" 등 트리거 판별
  // - AI 글로벌 인사이트 실행 연계 가능
}

/**
 * 문자 입력 수신
 * maru-conversation-modal.js 에서 호출됨
 */
function handleTextQuery({ text, context }){
  if(!text) return;

  // 1. 대화창에 사용자 발화 표시
  if(window.MaruConversationModal){
    MaruConversationModal.appendAssistant(text);
  }

  // 2. context 예시
  //    { type: 'region', id: 'asia' }
  //    { type: 'country', id: 'KR' }
  //    { type: null, id: null }
  // → 현재는 보존만, 추후 분기 처리 가능

  // 3. (향후 확장 지점)
  // - 특정 권역/국가 상세 요청
  // - AI 글로벌 인사이트 재실행
}

/**
 * AI 글로벌 인사이트 실행 결과를
 * 컨버세이션 모달로 전달 (선택적 사용)
 */
function pushGlobalInsightToConversation(){
  if(!window.MaruConversationModal) return;
  if(!SNAPSHOT || !SNAPSHOT.view) return;

  if(SNAPSHOT.view.global){
    MaruConversationModal.appendAssistant(SNAPSHOT.view.global);
  }
}

/* =======================================================
 * AUTO QUESTION → GLOBAL INSIGHT EXECUTION HUB
 * =======================================================
 * 역할:
 *  - 음성/문자 질문을 자동 분석
 *  - AI 글로벌 인사이트 실행 여부 판단
 *  - 마루 엔진을 통해 최신 데이터 수집
 *  - 결과를 컨버세이션 모달로 응답
 * ===================================================== */

/**
 * 질문이 "데이터 수집/분석"이 필요한지 판단
 */
function shouldRunGlobalInsight(text){
  if(!text) return false;

  const triggers = [
    '설명', '자세히', '분석', '현황', '상황', '최근', 
    '이슈', '정보', '왜', '어떻게', '문제점',
    '알려줘', '말해줘', '정리해줘', '조사',
    '확인', '비교', '실행', '수집', '업데이트'
  ];

  return triggers.some(t => text.includes(t));
}

/**
 * 질문을 기반으로 자동 AI 글로벌 인사이트 실행
 */
async function runInsightFromQuestion(text, context){
  try {
    // 사용자에게 즉시 피드백
    if(window.MaruConversationModal){
      MaruConversationModal.appendAssistant(
        '요청을 분석 중입니다. 최신 정보를 수집하고 있습니다…'
      );
    }

    // 기존 버튼 로직과 동일한 글로벌 인사이트 실행
    await runGlobalInsight();

    // 수집 완료 후 결과를 대화창으로 전달
    if(window.MaruConversationModal && SNAPSHOT?.view){
      if(context?.type === 'region' && SNAPSHOT.view.region?.[context.id]){
        MaruConversationModal.appendAssistant(
          SNAPSHOT.view.region[context.id]
        );
      } else if(context?.type === 'country' && SNAPSHOT.view.country?.[context.id]){
        MaruConversationModal.appendAssistant(
          SNAPSHOT.view.country[context.id]
        );
      } else if(SNAPSHOT.view.global){
        MaruConversationModal.appendAssistant(
          SNAPSHOT.view.global
        );
      } else {
        MaruConversationModal.appendAssistant(
          '수집된 자료를 정리하지 못했습니다.'
        );
      }
    }

  } catch(e){
    console.error('[AUTO INSIGHT ERROR]', e);
    if(window.MaruConversationModal){
      MaruConversationModal.appendAssistant(
        '자료 수집 중 오류가 발생했습니다.'
      );
    }
  }
}

/**
 * 기존 handleVoiceQuery 확장
 */
function handleVoiceQuery(text){
  if(!text) return;

  if(window.MaruConversationModal){
    MaruConversationModal.appendAssistant(text);
  }

  if(shouldRunGlobalInsight(text)){
    runInsightFromQuestion(text, window.MaruConversationModal?.context || null);
  }
}

/**
 * 기존 handleTextQuery 확장
 */
function handleTextQuery({ text, context }){
  if(!text) return;

  if(window.MaruConversationModal){
    MaruConversationModal.appendAssistant(text);
  }

  if(shouldRunGlobalInsight(text)){
    runInsightFromQuestion(text, context || null);
  }
}

/* =======================================================
 * EXPORT EXTENSION (PUBLIC API에 연결)
 * =======================================================
 * 이 아래의 window.MaruAddon 블럭에
 * handleVoiceQuery, handleTextQuery만 추가해서 연결
 * ===================================================== */

  /* =======================================================
   * PUBLIC API (FOR MODALS / VOICE)
   * ===================================================== */
  window.MaruAddon = {
    get status(){ return SNAPSHOT.status; },
    get snapshot(){ return SNAPSHOT.raw; },
    get ts(){ return SNAPSHOT.ts; },
    criticalDetail: requestCriticalDetail
  };

  /* =======================================================
   * INIT
   * ===================================================== */
  function init(){
    bindButtons();
    if(!SNAPSHOT.raw){ renderSummary('AI 글로벌 인사이트 실행을 눌러 최신 정보를 불러오세요.'); }
  }

  const obs = new MutationObserver(init);
  obs.observe(document.body,{childList:true,subtree:true});

  document.readyState==='loading'
    ? document.addEventListener('DOMContentLoaded',init)
    : init();

})();