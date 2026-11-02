/* Read-only MARU Windows download request counts under the existing revenue box.
 * Values are never calculated from revenue and are never simulated locally. */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/maru-windows-download-metrics';
  var KEYS=['maru_windows_player','maru_capture_windows'];
  var COLS=['day','week','month','year','total'];
  function byId(id){return document.getElementById(id);}
  function status(message,isError){
    var el=byId('maru-win-download-status');
    if(el){el.textContent=message;el.style.color=isError?'#9b2c2c':'#476783';}
  }
  function tokenFrom(value,depth){
    if(depth>4||value==null)return '';
    if(typeof value==='string'){
      var s=value.trim();if(s.split('.').length===3&&s.length>100)return s;
      try{return tokenFrom(JSON.parse(s),depth+1);}catch(_){return '';}
    }
    if(typeof value==='object'){
      var keys=['id_token','idToken','access_token','accessToken','token','jwt'];
      for(var i=0;i<keys.length;i++){if(value[keys[i]]){var t=tokenFrom(value[keys[i]],depth+1);if(t)return t;}}
    }
    return '';
  }
  function adminToken(){
    try{if(window.IGDCMemberAuth&&typeof window.IGDCMemberAuth.getIdToken==='function'){
      var direct=tokenFrom(window.IGDCMemberAuth.getIdToken(),0);if(direct)return direct;
    }}catch(_e){}
    try{if(window.osAuth&&typeof window.osAuth.getIdToken==='function'){
      var t=tokenFrom(window.osAuth.getIdToken(),0);if(t)return t;
    }}catch(_e){}
    var keys=['osauth.tokens.v2','osauth.tokens.v1','igdc.auth.tokens','igdc.tokens','igdc_auth_tokens','auth0_tokens','igdc_id_token','id_token','igdc_access_token','access_token','igdc.mediaCandidateQueue.adminBearer'];
    for(var s=0;s<2;s++){
      var storage;try{storage=s?window.localStorage:window.sessionStorage;}catch(_){continue;}
      for(var j=0;j<keys.length;j++){
        try{var t2=tokenFrom(storage.getItem(keys[j]),0);if(t2)return t2;}catch(_e){}
      }
    }
    return '';
  }
  function cell(program,col){return document.querySelector('#maru-win-download-table [data-win-program="'+program+'"] [data-col="'+col+'"]');}
  function clear(){KEYS.forEach(function(key){COLS.forEach(function(col){var el=cell(key,col);if(el)el.textContent='—';});});}
  function apply(data){
    if(!data||data.ok!==true||!data.byProgram)throw new Error('invalid_response');
    KEYS.forEach(function(key){
      var counts=data.byProgram[key]||{};
      COLS.forEach(function(col){var el=cell(key,col);if(!el)return;var n=Number(counts[col]||0);el.textContent=Number.isFinite(n)&&n>=0?n.toLocaleString('ko-KR'):'—';});
    });
    var countries=Array.isArray(data.countries30d)?data.countries30d:[];
    var body=byId('maru-win-download-countries');
    if(body){body.textContent='';
      if(!countries.length){var none=document.createElement('span');none.textContent='최근 30일 국가별 요청 기록이 없습니다.';body.appendChild(none);}
      countries.forEach(function(row){
        var piece=document.createElement('span');piece.style.cssText='display:inline-block;padding:4px 8px;background:#edf5fc;border:1px solid #cee0ee;border-radius:6px;margin:3px;';
        var name=row.program==='maru_capture_windows'?'Capture':'Player';
        piece.textContent=name+' · '+String(row.country||'ZZ')+' '+Number(row.count||0).toLocaleString('ko-KR');body.appendChild(piece);
      });
    }
    status('실제 기록 조회 완료 · '+(data.timezone||'Asia/Seoul')+' 기준',false);
  }
  var busy=false;
  async function refresh(){
    if(busy)return;
    var token=adminToken();
    if(!token){clear();status('관리자 로그인 후 조회할 수 있습니다.',true);return;}
    busy=true;var button=byId('maru-win-download-refresh');if(button)button.disabled=true;
    status('다운로드 요청 집계 조회 중…',false);
    try{
      var response=await fetch(ENDPOINT,{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin'});
      var data=await response.json();
      if(!response.ok||!data.ok)throw new Error((data&&data.error)||'metrics_request_failed');
      apply(data);
    }catch(error){
      clear();
      var code=String(error&&error.message||'');
      status(code==='metrics_database_setup_required'?'집계 저장소 초기 설정(SQL)이 필요합니다.':
        code==='metrics_storage_not_configured'?'Netlify 집계 DB 환경변수 연결이 필요합니다.':
        /required|invalid|login|401|403/i.test(code)?'관리자 권한 확인이 필요합니다.':'집계 서버 연결 실패 · 값은 표시하지 않습니다.',true);
    }finally{busy=false;if(button)button.disabled=false;}
  }
  function start(){
    var button=byId('maru-win-download-refresh');
    if(!button||button.dataset.bound==='1')return;
    button.dataset.bound='1';button.addEventListener('click',refresh);
    refresh();
    window.addEventListener('focus',function(){if(adminToken()&&byId('maru-win-download-status')&&/로그인/.test(byId('maru-win-download-status').textContent||''))refresh();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  window.MARUWindowsDownloadStats={refresh:refresh};
})();
