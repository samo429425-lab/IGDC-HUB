/* IGDC Distribution: single-click selected-country automation evidence export.
 * Combines the EXISTING read-only, authenticated server diagnostics.
 * No research starts, database writes, front matching or publication.
 */
(function(){
  'use strict';
  var button=document.getElementById('autoResearch15DiagnosticDownloadBtn');
  var status=document.getElementById('autoResearch15DiagnosticState');
  if(!button||!status)return;
  var endpoint='/.netlify/functions/commerce-country-control';
  var VERSION='igdc-selected-country-automation-evidence.v1.2-249-scope-coverage';
  function say(value){status.textContent=value;}
  function txt(v){return String(v==null?'':v).trim();}
  function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
  function arr(v){return Array.isArray(v)?v:[];}
  function number(v){var n=Number(v);return Number.isFinite(n)&&n>=0?n:0;}
  function code(v){var x=txt(v).toUpperCase();return /^[A-Z]{2}$/.test(x)?x:'';}
  function region(v){return txt(v||'NATIONWIDE').toUpperCase()||'NATIONWIDE';}
  function scopeCode(v){return code(txt(v).split('|')[0]);}
  function jwt(v){var x=txt(v);return x.length>32&&x.split('.').length===3?x:'';}
  function parse(v){try{return JSON.parse(v);}catch(_){return null;}}
  function push(v,out,seen,depth){
    if(depth>4||v==null)return;
    if(typeof v==='string'){var token=jwt(v);if(token&&!seen[token]){seen[token]=true;out.push(token);return;}
      var decoded=parse(v);if(decoded)push(decoded,out,seen,depth+1);return;}
    if(Array.isArray(v)){v.forEach(function(x){push(x,out,seen,depth+1);});return;}
    if(typeof v==='object') ['id_token','idToken','access_token','accessToken','token','__raw','raw'].forEach(function(k){push(v[k],out,seen,depth+1);});
  }
  async function tokens(){
    var out=[],seen={},frames=[window];
    try{if(window.parent!==window&&window.parent.location.origin===window.location.origin)frames.push(window.parent);}catch(_e){}
    try{if(window.top!==window&&window.top!==window.parent&&window.top.location.origin===window.location.origin)frames.push(window.top);}catch(_e){}
    for(var i=0;i<frames.length;i++){
      var w=frames[i];
      for(var j=0;j<2;j++){
        try{var provider=j===0?w.IGDCMemberAuth:w.osAuth;
          if(provider&&typeof provider.getIdToken==='function')push(await provider.getIdToken(),out,seen,0);
        }catch(_e){}
      }
      [w.localStorage,w.sessionStorage].forEach(function(storage){if(!storage)return;
        ['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'].forEach(function(k){
          try{push(storage.getItem(k),out,seen,0);}catch(_e){}
        });
      });
    }
    return out;
  }
  function safeMessage(v){return txt(v).slice(0,220)
    .replace(/https?:\/\/\S+/gi,'[URL]').replace(/bearer\s+\S+/gi,'Bearer [REDACTED]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL]')
    .replace(/(?:sk|eyJ)[A-Za-z0-9_.-]{24,}/g,'[TOKEN]');}
  function filename(){return 'IGDC_DISTRIBUTION_SELECTED_COUNTRIES_ALL_AUTOMATION_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';}
  function download(data){
    // Large all-country exports stay readable JSON but avoid whitespace
    // inflation when hundreds of markets and subdivisions are selected.
    var compact=number(obj(data.selection).selectedCountryCount)>100;
    var blob=new Blob([JSON.stringify(data,null,compact?0:2)+'\n'],{type:'application/json;charset=utf-8'});
    var url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename();a.style.display='none';document.body.appendChild(a);a.click();
    setTimeout(function(){a.remove();URL.revokeObjectURL(url);},1200);
  }
  async function request(action,token,expected){
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},45000);
    try{
      var response=await fetch(endpoint+'?action='+encodeURIComponent(action)+'&fresh='+Date.now(),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json',Authorization:'Bearer '+token},signal:controller.signal});
      var data=null;
      try{data=await response.json();}catch(_e){}
      if(!response.ok||!data||data.ok!==true){
        var err=new Error(safeMessage(data&&data.error)||'HTTP '+response.status);err.status=response.status;throw err;
      }
      if(data.reportType!==expected){var formatError=new Error('점검 응답 종류 불일치: '+action);formatError.status=502;throw formatError;}
      return data;
    }catch(e){if(e&&e.name==='AbortError'){
      var timeout=new Error(action+' 서버 조회가 45초를 초과했습니다. Netlify 함수 로그와 DB 조회 시간을 확인해 주세요.');timeout.status=504;throw timeout;
    }throw e;}
    finally{clearTimeout(timer);}
  }
  async function authorized(action,expected,options){
    var last=null;
    for(var i=0;i<options.length;i++){
      try{return await request(action,options[i],expected);}
      catch(error){last=error;if(Number(error.status)!==401)break;}
    }
    throw last||new Error('관리자 인증 정보가 유효하지 않습니다.');
  }
  function distinct(values){var seen={};return values.filter(function(x){if(!x||seen[x])return false;seen[x]=true;return true;});}
  function scopeFrom(s){return txt(s.scope);}
  function filterList(list,predicate){return arr(list).filter(predicate);}
  function summarize(report){
    var phase=obj(report.phase15),global=obj(report.globalControl),bottleneck=obj(report.bottleneck);
    var master=obj(global.master),operating=obj(global.operatingStatus),coverage=obj(phase.coverage),bScope=obj(bottleneck.scope);
    var mode=txt(master.mode||coverage.masterMode||bScope.mode||'unknown');
    var configSelected=distinct(arr(master.selectedCountryCodes).map(code).filter(Boolean));
    var scheduled=distinct(arr(phase.scopes).filter(function(s){return s.scheduled===true;}).map(function(s){return scopeCode(s.scope);}).filter(Boolean));
    var bottleneckSelected=distinct(arr(bottleneck.countries).filter(function(x){return x.scheduled===true||x.autoRunExpected===true;}).map(function(x){return code(x.country);}).filter(Boolean));
    var selected=mode==='selected'&&configSelected.length?configSelected:
      mode==='manual'&&code(master.selectedCountryCode)?[code(master.selectedCountryCode)]:
      scheduled.length?scheduled:bottleneckSelected;
    var selectedSet=new Set(selected);
    var selectedScopeRows=filterList(phase.scopes,function(s){return selectedSet.has(scopeCode(s.scope))&&s.scheduled===true;});
    var selectedIssues=filterList(phase.issues,function(x){return selectedSet.has(scopeCode(x.scope));});
    var matchedBottlenecks=filterList(bottleneck.countries,function(x){return selectedSet.has(code(x.country));});
    var matchedBlockers=filterList(bottleneck.blockers,function(x){return selectedSet.has(code(obj(x.scope).country));});
    var staged=filterList(obj(global.stagedAutomation).rows,function(x){return selectedSet.has(code(x.country));});
    var psom=filterList(obj(global.privatePsomAutomation).rows,function(x){return selectedSet.has(code(x.country));});
    var settings=filterList(global.savedSettings,function(x){return x.scopeType==='master'||selectedSet.has(code(x.countryCode));});
    var names={};matchedBottlenecks.forEach(function(x){names[code(x.country)]=x;});
    var scoped={};selectedScopeRows.forEach(function(s){var c=scopeCode(s.scope);(scoped[c]||(scoped[c]=[])).push(s);});
    var stagedBy={},psomBy={},settingsBy={};
    staged.forEach(function(x){(stagedBy[code(x.country)]||(stagedBy[code(x.country)]=[])).push(x);});
    psom.forEach(function(x){(psomBy[code(x.country)]||(psomBy[code(x.country)]=[])).push(x);});
    settings.forEach(function(x){if(x.scopeType!=='master')(settingsBy[code(x.countryCode)]||(settingsBy[code(x.countryCode)]=[])).push(x);});
    var countries=selected.map(function(c){
      var state=names[c]||{},s=scoped[c]||[],scopeIssues=selectedIssues.filter(function(x){return scopeCode(x.scope)===c;}),warnings=matchedBlockers.filter(function(x){return code(obj(x.scope).country)===c;});
      return {country:c,countryNameKo:state.countryNameKo||null,regionGroup:state.regionGroup||null,
        configured:true,scheduled:state.scheduled===true||s.some(function(x){return x.scheduled===true;}),
        ipSelection:{ipResolvable:typeof state.ipResolvable==='boolean'?state.ipResolvable:null,
          adminResearchIndependentOfVisitorIp:state.adminResearchIndependentOfVisitorIp===true,
          selectionReason:state.schedulingReason||null,requiresSubdivision:state.requiresSubdivision===true},
        settings:settingsBy[c]||[],registered:state.registered===true,
        registeredSelected:state.registeredSelected===true,
        effectiveCountryMode:state.effectiveCountryMode||null,
        durableSupplierMarkerAt:state.durableSupplierMarkerAt||null,
        lastSupplierAttemptAt:state.lastSupplierAttemptAt||null,
        countryReadStatus:state.readStatus||'not_reported',
        // Compact index only. Full evidence is already present in scopeDiagnostics;
        // do not double payload size across 93 or 249 selected markets.
        tenStageTrace:s.map(function(x){return {scope:x.scope,firstBlocker:obj(x.evidence).firstActionableBlocker||null,
          stages:arr(obj(x.evidence).stages).map(function(stage){return {name:stage.name,state:stage.state};}),
          providerCalls:Object.keys(obj(obj(obj(x.supplier).provider).totals)).length,
          providerAttemptsRecorded:arr(obj(obj(x.supplier).provider).history).length};}),
        scopeDiagnostics:s, supplierAutomation:filterList(stagedBy[c],function(x){return x.kind==='supplier';}),
        productAutomation:filterList(stagedBy[c],function(x){return x.kind==='product';}),
        psomAutomation:psomBy[c]||[],bottleneck:{supplier:state.supplier||null,product:state.product||null,
          relatedStagedScopes:number(state.relatedStagedScopes),problems:arr(state.problems),blockers:warnings},
        issues:scopeIssues, completeness:{phase15:s.length>0,globalStaged:(stagedBy[c]||[]).length>0,
          bottleneckCountry:!!names[c]}};
    });
    var errors=arr(report.readErrors).slice();
    arr(phase.readErrors).forEach(function(x){errors.push(Object.assign({source:'phase15'},obj(x)));});
    arr(bottleneck.readErrors).forEach(function(x){errors.push(Object.assign({source:'bottleneck'},obj(x)));});
    if(obj(global.stagedAutomation).readError)errors.push({source:'globalControl',component:'stagedAutomation',message:safeMessage(global.stagedAutomation.readError)});
    if(obj(global.privatePsomAutomation).readError)errors.push({source:'globalControl',component:'privatePsomAutomation',message:safeMessage(global.privatePsomAutomation.readError)});
    if(!selected.length)errors.push({component:'selectedCountries',message:'자동화 대상 국가를 증명할 설정 자료가 없습니다. 전체 국가가 정상이라고 판단할 수 없습니다.'});
    var missing=countries.filter(function(c){return !c.completeness.phase15||!c.completeness.bottleneckCountry;}).map(function(c){return c.country;});
    var unscheduled=distinct(arr(coverage.selectedButNotScheduledCountryCodes).map(code).filter(function(x){return selectedSet.has(x);}));
    // A selected market can legitimately be disabled by policy or have an
    // ineffective country override. Report that exception; never label 249
    // selected settings as 249 running workers without matching evidence.
    var unscheduledObserved=selected.filter(function(c){return !scheduled.includes(c);});
    unscheduled=distinct(unscheduled.concat(unscheduledObserved));
    if(unscheduled.length)errors.push({component:'selected_not_scheduled',count:unscheduled.length,
      message:'선택된 국가 중 예약 실행 대상이 아닌 국가가 있습니다. 비활성 국가·설정·정책을 점검하세요.'});
    var complete=!!phase.reportType&&!!global.reportType&&!!bottleneck.reportType&&coverage.complete===true&&errors.length===0&&missing.length===0;
    return {ok:complete,partial:!complete,reportType:'igdc-distribution-selected-country-all-automation-evidence',version:VERSION,
      generatedAt:new Date().toISOString(),selection:{mode,selectedCountryCodes:selected,
        selectedCountryCount:selected.length,observedScheduledCountries:scheduled.length,
        selectedButNotScheduled:unscheduled,
        adminResearchIndependentOfVisitorIp:operating.administratorResearchIgnoresVisitorIp===true,
        note:'IP는 방문자 개인 주소가 아니라 국가별 자동화 대상/지역 판정 메타데이터입니다. 실제 방문자 IP는 수집하지 않습니다.'},
      coverage:{complete,partial:!complete,countriesWithPhase15: countries.filter(function(c){return c.completeness.phase15;}).length,
        countriesWithStagedCheckpoints:countries.filter(function(c){return c.completeness.globalStaged;}).length,
        countriesWithBottleneck:countries.filter(function(c){return c.completeness.bottleneckCountry;}).length,
        missingCountryEvidence:missing,selectedNotScheduled:unscheduled,phase15:phase.coverage||null,readErrors:errors},
      summary:{diagnosticStages:10,
        firstBlockers:selectedScopeRows.reduce(function(acc,x){var blocker=obj(x.evidence).firstActionableBlocker;
          if(blocker)acc[blocker]=(acc[blocker]||0)+1;return acc;},{}),
        selectedCountryCount:selected.length,selectedScopeCount:selectedScopeRows.length,
        selectedSupplierCheckpoints:selectedScopeRows.filter(function(x){return !!x.supplier;}).length,
        selectedProductCheckpoints:selectedScopeRows.filter(function(x){return !!x.product;}).length,
        selectedPsomCheckpoints:selectedScopeRows.filter(function(x){return !!x.psom;}).length,
        selectedSupplierUsableSitesCheckpointSum:selectedScopeRows.reduce(function(v,x){return v+number(obj(obj(x.supplier).supplier).privateLedgerGate&&obj(obj(obj(x.supplier).supplier).privateLedgerGate).eligibleSellerSites);},0),
        selectedPrivateProductsStagedCheckpointSum:selectedScopeRows.reduce(function(v,x){return v+number(obj(obj(x.product).product).privateStaged);},0),
        selectedIssues:selectedIssues.length,selectedBottleneckFlags:matchedBlockers.length,
        interpretation:'체크포인트 합계는 실제 신규 업체/상품 DB INSERT 확정 건수와 다릅니다. stageSummary와 원장 재조회 증거가 없으면 성공으로 단정하지 않습니다.'},
      scopeInterpretation:'countries[] 및 summary는 선택 국가 기준입니다. sourceReports의 registryWide 접두사 집계는 원본 전체 국가 진단값으로 구분 표시합니다.',
      sourceVersions:{phase15:phase.version||null,globalControl:global.version||null,
        bottleneck:bottleneck.version||null,deploy:phase.deploy||bottleneck.serverBuild||null},
      countries,
      sourceReports:{phase15:{registryWideSummary:phase.summary||null,issues:selectedIssues,readErrors:phase.readErrors||[],
          coverage:phase.coverage||null,evidenceReport:phase.evidenceReport||null},
        globalControl:{operatingStatus:global.operatingStatus||null,master:global.master||null,savedSettings:settings,
          scheduler:global.scheduler||null,searchProviderReadiness:global.searchProviderReadiness||null,
          registryWideDurableWriteEvidence:global.durableWriteEvidence||null,stagedAutomationReadError:obj(global.stagedAutomation).readError||null,
          privatePsomReadError:obj(global.privatePsomAutomation).readError||null},
        bottleneck:{scope:bottleneck.scope||null,registryWideSummary:bottleneck.summary||null,
          blockers:matchedBlockers,readErrors:bottleneck.readErrors||[],sources:bottleneck.sources||null}},
      missingRuntimeEvidence:['Netlify 예약 함수별 실제 실행 ID·요청 시간·개별 외부 검색 HTTP 응답은 서버 로그가 필요합니다.',
        '이 보고서는 저장된 체크포인트를 조회합니다. 실제 DB 신규 INSERT·재조회 확인이 없는 건 성공으로 표시하지 않습니다.'],
      safety:{readOnly:true,selectedCountriesOnly:true,doesNotChangeAutoSelection:true,
        noRawMerchantUrlsFromResearchJobs:true,noVisitorIp:true,noSecrets:true,
        noCandidateMutation:true,noPsomMutation:true,noFrontMatch:true}};
  }
  function safeFailure(e){return {ok:false,partial:true,reportType:'igdc-distribution-selected-country-all-automation-evidence-failure',version:VERSION,
    generatedAt:new Date().toISOString(),readErrors:[{component:'diagnostic_request',httpStatus:Number(e&&e.status)||null,
      message:safeMessage(e&&e.message)||'진단 요청 실패'}],safety:{readOnly:true,noSecrets:true}};}
  button.addEventListener('click',async function(){
    if(button.disabled)return;button.disabled=true;
    var reports={phase15:null,globalControl:null,bottleneck:null,readErrors:[]};
    try{
      var options=await tokens();if(!options.length)throw new Error('관리자 로그인 인증 토큰을 찾지 못했습니다. 관리자 인증 후 다시 시도해 주세요.');
      var tasks=[['phase15','auto_research_15_diagnostic','igdc-country-automatic-research-phase01-15-diagnostic','1~15단계 국가별 기록'],
        ['globalControl','global_control_diagnostic','igdc-global-automation-control-diagnostic','전체 국가 운영·배치 관제'],
        ['bottleneck','auto_bottleneck_diagnostic','igdc-auto-bottleneck-readonly','국가/IP·자동화 장애 원인']];
      for(var i=0;i<tasks.length;i++){
        var task=tasks[i];say('전체 자동화 점검 ('+(i+1)+'/3) · '+task[3]+'을 읽고 있습니다.');
        try{reports[task[0]]=await authorized(task[1],task[2],options);}
        catch(error){reports.readErrors.push({component:task[0],httpStatus:Number(error&&error.status)||null,
          message:safeMessage(error&&error.message)});
          // Authorization failure is not a genuine country audit; do not export stale cached data.
          if(Number(error&&error.status)===401||Number(error&&error.status)===403)break;
        }
      }
      if(!reports.phase15&&!reports.globalControl&&!reports.bottleneck)throw new Error('전체 자동화 점검 서버의 세 가지 진단을 모두 읽지 못했습니다.');
      say('선택 국가의 업체·상품·원장·배치·오류 기록을 국가별로 통합하는 중입니다.');
      var data=summarize(reports);download(data);
      say('통합 JSON 다운로드 완료 · 선택 국가 '+data.selection.selectedCountryCount+'개 · 조회된 국가 '+
        data.coverage.countriesWithPhase15+'개 · 문제 '+data.summary.selectedIssues+'건'+
        (data.partial?' · 일부 조회 실패 또는 누락: JSON coverage.readErrors 확인':' · 전체 진단 조회 완료')+'.');
    }catch(e){download(safeFailure(e));say('전체 점검 오류 JSON 다운로드 · '+safeMessage(e&&e.message));}
    finally{button.disabled=false;}
  });
})();
