
/* =========================================================
 * MARU SITE CONTROL ADD-ON — GLOBAL INSIGHT BRAIN
 * FINAL MASTER VERSION (v1.1 — FIXED & CONSOLIDATED)
 * ========================================================= */

(function(){
  'use strict';

  /* ================= SNAPSHOT (SINGLE SOURCE OF TRUTH) ================= */
  const SNAPSHOT = {
    status: 'IDLE',   // IDLE | LOADING | READY | ERROR
    ts: null,
    raw: null,
    view: {
      global: null,
      regions: {},
      countries: {},
      critical: { regions: {}, countries: {} }
    }
  };

  /* ================= UTILS ================= */
  const $ = (s,r)=> (r||document).querySelector(s);
  const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
  const log = (...a)=> window.DEBUG_MARU && console.log('[MARU ADDON]',...a);

  /* ================= UI TARGET ================= */
  function summaryBox(){
    return $('[data-maru="global-insight"] textarea') || $('.igdc-sc-ai textarea');
  }
  function renderSummary(t){ const box = summaryBox(); if(box) box.value = t||''; }

  /* ================= ENGINE ================= */
  async function runGlobalInsight(){
    SNAPSHOT.status = 'LOADING';
    renderSummary('전 세계 AI 인사이트를 취합 중입니다…');

    try{
      const res = await fetch('/api/maru-global-insight',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        cache:'no-store',
        body: JSON.stringify({
          context:'global-insight',
          scope:'global',
          timeline:['today'],
          include:['summary','regions','countries','critical','videos','voice'],
          locale:'ko-KR'
        })
      });
      if(!res.ok) throw new Error(res.status);
      const json = await res.json();
      buildSnapshot(json);
    }catch(e){
      SNAPSHOT.status='ERROR';
      log('ENGINE FAIL',e);
      renderSummary('※ 글로벌 인사이트 취합 실패');
    }
  }

  /* ================= SNAPSHOT BUILD ================= */
  function buildSnapshot(engineData){
    SNAPSHOT.raw = engineData;
    SNAPSHOT.ts = new Date().toISOString();
    SNAPSHOT.status='READY';

    SNAPSHOT.view.global = engineData.today || engineData.globalSummary || '';

    (engineData.regions||[]).forEach(r=>{
      SNAPSHOT.view.regions[r.id]=r.today||'';
      if(r.critical) SNAPSHOT.view.critical.regions[r.id]=r.critical;
    });

    (engineData.countries||[]).forEach(c=>{
      SNAPSHOT.view.countries[c.code]=c.today||'';
      if(c.critical) SNAPSHOT.view.critical.countries[c.code]=c.critical;
    });

    distribute();
    renderSummary(SNAPSHOT.view.global || '현재 전 세계 주요 상황 요약 정보가 없습니다.');
  }

  /* ================= DISTRIBUTE ================= */
  function distribute(){
    if(!SNAPSHOT.raw) return;

    window.injectMaruGlobalRegionData?.({
      today: SNAPSHOT.view.regions,
      critical: SNAPSHOT.view.critical.regions,
      snapshot: SNAPSHOT.raw
    });

    window.injectMaruGlobalCountryData?.({
      today: SNAPSHOT.view.countries,
      critical: SNAPSHOT.view.critical.countries,
      snapshot: SNAPSHOT.raw
    });

    window.MARU_VOICE_READY = true;
  }

  /* ================= CRITICAL DETAIL ================= */
  function requestCriticalDetail(type,id){
    const crit = type==='region'
      ? SNAPSHOT.view.critical.regions[id]
      : SNAPSHOT.view.critical.countries[id];
    if(!crit) return;

    const text = crit.detail || crit.summary || '';
    if(text && window.maruVoiceSpeak){
      window.maruVoiceSpeak(text);
    }
  }

  /* ================= CONVERSATION HUB ================= */
  function shouldRunGlobalInsight(text){
    if(!text) return false;
    const triggers=['설명','자세히','분석','현황','최근','이슈','정보','왜','어떻게','실행','수집','업데이트'];
    return triggers.some(t=>text.includes(t));
  }

  async function runInsightFromQuestion(text, context){
    if(window.MaruConversationModal){
      MaruConversationModal.appendAssistant('요청을 분석 중입니다. 최신 정보를 수집하고 있습니다…');
    }
    await runGlobalInsight();

    if(!window.MaruConversationModal) return;

    if(context?.type==='region' && SNAPSHOT.view.regions[context.id]){
      MaruConversationModal.appendAssistant(SNAPSHOT.view.regions[context.id]);
    }else if(context?.type==='country' && SNAPSHOT.view.countries[context.id]){
      MaruConversationModal.appendAssistant(SNAPSHOT.view.countries[context.id]);
    }else if(SNAPSHOT.view.global){
      MaruConversationModal.appendAssistant(SNAPSHOT.view.global);
    }
  }

  function handleVoiceQuery(text){
    if(!text) return;
    window.MaruConversationModal?.appendAssistant(text);
    if(shouldRunGlobalInsight(text)){
      runInsightFromQuestion(text, window.MaruConversationModal?.context||null);
    }
  }

  function handleTextQuery(payload){
    const text = typeof payload==='string' ? payload : payload?.text;
    const context = payload?.context||null;
    if(!text) return;
    window.MaruConversationModal?.appendAssistant(text);
    if(shouldRunGlobalInsight(text)){
      runInsightFromQuestion(text, context);
    }
  }

  /* ================= BUTTON BIND ================= */
  function bindButtons(){
    const runBtn = document.getElementById('btnMaruGlobalInsight') ||
      $$('button').find(b=>b.textContent.includes('AI 글로벌 인사이트'));
    if(runBtn && !runBtn.dataset.bound){
      runBtn.dataset.bound='1';
      runBtn.onclick=e=>{e.stopPropagation(); runGlobalInsight();};
    }
  }

  /* ================= PUBLIC API ================= */
  window.MaruAddon = {
    get status(){ return SNAPSHOT.status; },
    get snapshot(){ return SNAPSHOT.raw; },
    get ts(){ return SNAPSHOT.ts; },
    runGlobalInsight,
    handleVoiceQuery,
    handleTextQuery,
    criticalDetail: requestCriticalDetail
  };

  /* ================= INIT ================= */
  function init(){
    bindButtons();
    if(!SNAPSHOT.raw){
      renderSummary('AI 글로벌 인사이트 실행을 눌러 최신 정보를 불러오세요.');
    }
  }

  const obs=new MutationObserver(init);
  obs.observe(document.body,{childList:true,subtree:true});
  document.readyState==='loading'
    ? document.addEventListener('DOMContentLoaded',init)
    : init();

})();
