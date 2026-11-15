/* IGDC administrator-only 1–15 stage automation diagnostic download.
 * Independent of front matching, thumbnail loaders and research controls.
 */
(function(){
  'use strict';
  var button=document.getElementById('autoResearch15DiagnosticDownloadBtn');
  var status=document.getElementById('autoResearch15DiagnosticState');
  if(!button||!status)return;
  var endpoint='/.netlify/functions/commerce-country-control?action=auto_research_15_diagnostic';
  function say(value){status.textContent=value;}
  function txt(v){return String(v==null?'':v).trim();}
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
  function filename(){return 'IGDC_AUTO_RESEARCH_PHASE01-15_DIAGNOSTIC_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';}
  function download(data){
    var blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json;charset=utf-8'});
    var url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename();a.style.display='none';document.body.appendChild(a);a.click();
    setTimeout(function(){a.remove();URL.revokeObjectURL(url);},1200);
  }
  function safeFailure(e){
    var message=txt(e&&e.message).slice(0,180).replace(/https?:\/\/\S+/gi,'[URL]').replace(/bearer\s+\S+/gi,'Bearer [REDACTED]');
    return {ok:false,reportType:'igdc-country-automatic-research-phase01-15-diagnostic-request-failure',
      generatedAt:new Date().toISOString(),readErrors:[{component:'diagnostic_request',httpStatus:Number(e&&e.status)||null,message:message||'진단 요청 실패'}],
      instructionsKo:'서버 응답 실패는 자동 조사 실패의 직접 증거가 아닙니다. Netlify commerce-country-control 함수 로그를 확인해 주세요.',
      safety:{noWrites:true,noSecretsExported:true}};
  }
  async function request(token){
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},45000);
    try{
      var response=await fetch(endpoint+'&fresh='+Date.now(),{method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json',Authorization:'Bearer '+token},signal:controller.signal});
      var data=null;try{data=await response.json();}catch(_e){}
      if(!response.ok||!data||data.ok!==true){var err=new Error(txt(data&&data.error)||'HTTP '+response.status);err.status=response.status;throw err;}
      if(data.reportType!=='igdc-country-automatic-research-phase01-15-diagnostic')throw new Error('진단 응답 형식이 올바르지 않습니다.');
      return data;
    }catch(e){if(e&&e.name==='AbortError'){var timeout=new Error('45초 안에 진단을 완료하지 못했습니다. 서버 연결·DB 응답 시간 확인 필요');timeout.status=504;throw timeout;}throw e;}
    finally{clearTimeout(timer);}
  }
  button.addEventListener('click',async function(){
    if(button.disabled)return;button.disabled=true;say('전 세계 국가별 자동 조사·상품 조사·PSOM 저장 상태를 읽는 중입니다.');
    try{
      var options=await tokens();if(!options.length)throw new Error('관리자 로그인 인증 토큰을 찾지 못했습니다. 관리자 인증 후 다시 시도해 주세요.');
      var data=null,lastError=null;
      for(var i=0;i<options.length;i++){
        try{data=await request(options[i]);break;}
        catch(error){lastError=error;if(Number(error.status)!==401)break;}
      }
      if(!data)throw lastError||new Error('진단 데이터를 읽지 못했습니다.');
      download(data);
      var count=Number(data.summary&&data.summary.issueCount||0);
      say('점검 JSON 다운로드 완료 · 국가/지역 '+Number(data.coverage&&data.coverage.observedScopes||0)+
        '개 · 진단 항목 '+count+'개'+(data.coverage&&data.coverage.complete===false?' · 일부 자료 누락, JSON의 readErrors 확인':'')+
        '. 해당 파일을 대화에 올리면 국가별 병목을 분석할 수 있습니다.');
    }catch(e){
      download(safeFailure(e));
      say('점검 요청 실패 · 원인 확인용 오류 JSON을 다운로드했습니다. '+txt(e&&e.message).slice(0,120));
    }finally{button.disabled=false;}
  });
})();
