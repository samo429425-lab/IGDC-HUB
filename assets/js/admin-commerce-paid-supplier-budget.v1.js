/* Distribution administrator-only budget panel. Uses the existing auth bridge;
 * no tokens, API keys, or billing information are stored in the browser.
 */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  var current='',busy=false,lastRefresh=0,onceBusy=false,aiOnceAllowed=false;
  function bridge(){return window.IGDCCountryBudgetBridge;}
  function us(n){var number=Number(n);return Number.isFinite(number)?'$'+number.toFixed(3):'확인 불가';}
  function count(n){return Math.max(0,Number(n)||0).toLocaleString('ko-KR');}
  function say(message){if($('paidBudgetStatus'))$('paidBudgetStatus').textContent=message;}
  function put(id,value){var el=$(id);if(el)el.textContent=value;}
  async function refresh(force){
    var b=bridge(),scope=b&&b.scope&&b.scope(),country=scope&&scope.country;
    if(!b||!country||!$('paidSupplierBudgetPanel')||busy)return;
    if(!force&&current===country&&Date.now()-lastRefresh<55000)return;
    busy=true;var btn=$('paidSupplierBudgetRefresh');if(btn)btn.disabled=true;
    try{
      var res=await b.request('paid_supplier_budget_status','GET',{countryCode:country});
      if(!res||res.ok!==true||!res.country)throw new Error('저장된 사용량 조회 응답이 올바르지 않습니다.');
      // Never paint a KR response after the operator switched to US.
      if((b.scope()||{}).country!==country)return;
      var c=res.country,g=res.aggregate||{},auto=c.auto||{},manual=c.manual||{};
      var selected=Number(g.selectedCountryCount)||0;
      current=country;lastRefresh=Date.now();
      put('paidBudgetSelectedCountries',count(selected)+'개국');
      put('paidBudgetTotalUsed',count((g.autoUsed||0)+(g.manualUsed||0))+' / '+count(g.basicAllowanceCount||0)+'회');
      // Only the countries still selected by the server are in these totals.
      put('paidBudgetTotalRemaining',count(g.remainingAllowanceCount||0)+'회');
      put('paidBudgetSpent',us(g.estimatedSpentUsd||0)+' 예상');
      put('paidBudgetCountryTitle',country+' · 선택 국가 사용량');
      put('paidBudgetAuto',count(auto.used)+' / 10회'+(auto.pending?' · 확인 대기 '+count(auto.pending):''));
      put('paidBudgetManual',count(manual.used)+' / 5회'+(manual.pending?' · 확인 대기 '+count(manual.pending):''));
      put('paidBudgetCountryRemaining',count((auto.remaining||0)+(manual.remaining||0))+'회');
      put('paidBudgetCountrySpent',us(c.estimatedSpentUsd)+' 예상');
      var ai=c.aiAssist||{},aiBtn=$('paidBudgetAiOnce');
      aiOnceAllowed=!!res.openAiAssistConfigured&&Number(ai.remaining)>0;
      if(aiBtn)aiBtn.disabled=onceBusy||!$('paidBudgetAiApproval').checked||!aiOnceAllowed;
      if(ai.used>0)put('paidBudgetAiResult','이 국가의 OpenAI 추가 1회 사용 기록이 있습니다. 추가 호출은 차단됩니다.');
      var message='Google 예상 사용량 기록을 조회했습니다. 실제 외부 결제 잔액은 제공되지 않습니다.';
      if(c.googleAccessBlockedUntil && Date.parse(c.googleAccessBlockedUntil)>Date.now())message='Google API 접근 오류로 검색이 일시 중지됐습니다. 검색 키/서비스 권한을 확인해 주세요.';
      if(!res.openAiAssistConfigured)message+=' OpenAI 검색어 보강 키가 설정되지 않았습니다.';
      say(message);
    }catch(err){say('사용량 조회 실패: '+String(err&&err.message||err)+'. 기존 사용 기록은 변경되지 않았습니다.');}
    finally{busy=false;if(btn)btn.disabled=false;}
  }
  async function once(){
    var approve=$('paidBudgetAiApproval'),b=bridge(),scope=b&&b.scope&&b.scope();
    if(onceBusy||!aiOnceAllowed||!approve||!approve.checked||!b||!scope||!scope.country)return;
    var country=scope.country;
    if(!window.confirm(country+'의 OpenAI API 검색어 보강을 1회 실행합니다. 별도 토큰 비용이 발생할 수 있으며 이 작업은 Google 검색/자동 결제가 아닙니다. 진행하시겠습니까?'))return;
    onceBusy=true;var btn=$('paidBudgetAiOnce');if(btn)btn.disabled=true;
    try{
      var res=await b.request('paid_supplier_ai_assist_once','POST',{}, {countryCode:country,explicitApproval:true});
      if((b.scope()||{}).country===country)put('paidBudgetAiResult',JSON.stringify({country:res.country,queries:res.queries,tokens:res.tokens},null,2));
      say('OpenAI 검색어 보강 1회가 완료됐습니다. 제안 검색어는 자동 등록·공개되지 않습니다.');
    }catch(err){say('OpenAI 추가 1회 요청 실패: '+String(err&&err.message||err));}
    finally{onceBusy=false;approve.checked=false;await refresh(true);}
  }
  document.addEventListener('DOMContentLoaded',function(){
    if(!$('paidSupplierBudgetPanel'))return;
    $('paidSupplierBudgetRefresh').addEventListener('click',function(){refresh(true);});
    $('paidBudgetAiApproval').addEventListener('change',function(){
      var button=$('paidBudgetAiOnce');if(button)button.disabled=!this.checked||!aiOnceAllowed;
    });
    $('paidBudgetAiOnce').addEventListener('click',once);
    // One lightweight poll; a changed selected country refreshes immediately.
    window.setInterval(function(){if(document.visibilityState!=='hidden')refresh(false);},10000);
    refresh(true);
  });
})();
