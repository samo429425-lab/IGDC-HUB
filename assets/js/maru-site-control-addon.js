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