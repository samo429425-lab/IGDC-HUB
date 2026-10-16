(function(){'use strict';
 var ENDPOINT='/.netlify/functions/commerce-admin-ledger-rescue';
 var $=function(id){return document.getElementById(id);},snapshot=null,busy=false,stop=false,report=null;
 function t(x){return String(x==null?'':x);}
 function esc(x){return t(x).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
 function status(s,kind){$('status').className=kind||'muted';$('status').textContent=s;}
 function tokens(){var found=[],seen={};function add(v){if(!v)return;if(typeof v==='string'){if(v.split('.').length===3&&v.length>40&&!seen[v]){seen[v]=true;found.push(v);}else try{add(JSON.parse(v));}catch(_){}}else if(Array.isArray(v))v.forEach(add);else if(typeof v==='object')['id_token','idToken','access_token','accessToken','token','raw','__raw'].forEach(function(k){if(v[k])add(v[k]);});}
  try{if(window.IGDCMemberAuth&&window.IGDCMemberAuth.getIdToken)add(window.IGDCMemberAuth.getIdToken());}catch(_){}
  var keys=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'];
  [window.localStorage,window.sessionStorage].forEach(function(st){if(!st)return;keys.forEach(function(k){try{add(st.getItem(k));}catch(_){}});});return found;
 }
 async function getTokens(){var out=tokens();try{if(window.IGDCMemberAuth&&window.IGDCMemberAuth.getIdToken){var x=await window.IGDCMemberAuth.getIdToken();if(x&&out.indexOf(x)<0)out.unshift(x);}}catch(_){}return out;}
 async function request(method,data){var auth=await getTokens(),err=null,url=ENDPOINT+'?country=KR&region=NATIONWIDE';if(!auth.length)throw Error('관리자 로그인 토큰을 찾지 못했습니다. 관리자 페이지에서 로그인한 뒤 다시 열어주세요.');
  for(var k=0;k<auth.length;k++){var controller=typeof AbortController!=='undefined'?new AbortController():null,timer=controller?setTimeout(function(){controller.abort();},45000):null;
    try{var r=await fetch(url,{method:method,cache:'no-store',credentials:'same-origin',headers:{'Accept':'application/json','Authorization':'Bearer '+auth[k],...(method==='POST'?{'Content-Type':'application/json'}:{})},body:method==='POST'?JSON.stringify(data):undefined,signal:controller?controller.signal:undefined});var o=await r.json();if((r.status===401||r.status===403)&&k<auth.length-1)continue;if(!r.ok||!o||!o.ok)throw Error('HTTP '+r.status+' · '+(o&&o.error||'조회 실패'));return o;}
    catch(e){err=e;if(/HTTP (401|403)/.test(t(e.message))&&k<auth.length-1)continue;throw e;}finally{if(timer)clearTimeout(timer);}}
  throw err||Error('인증 오류');}
 function download(obj,name){var blob=new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json;charset=utf-8'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(u);},1500);}
 function setBusy(v){busy=v;$('audit').disabled=v;$('restore').disabled=v||!snapshot||!snapshot.scannerComplete||!snapshot.eligibleCount;$('refresh').disabled=v||!snapshot;$('stop').disabled=!v;$('json').disabled=v||!snapshot;}
 async function audit(){if(busy)return;setBusy(true);status('현재 KR 전국 상품 DB를 읽고 기존 배치 증빙과 비교하고 있습니다.','muted');try{
   var d=await request('GET');snapshot=d;report=d;var n=d.states||{},metrics=[['DB 상품 원장',d.rawCandidateCount],['미배치 후보',n.undecided||0],['기존 섹션 후보',n.slot_candidate||0],['보류',n.hold||0],['제외',n.reject||0],['복구 가능',d.eligibleCount]];
   $('metrics').innerHTML=metrics.map(function(row){return'<div><strong class="count">'+esc(row[1])+'</strong>'+esc(row[0])+'</div>';}).join('');
   $('diagnosis').textContent='상품 행 '+d.rawCandidateCount+'건 / DB 스캔 '+d.rawScanned+'건 / 과거 배치 589건 / 복구 가능 '+d.eligibleCount+'건 / 조회 '+(d.scannerComplete?'완료':'미완료')+'. '+(d.rawCandidateCount&&!(n.slot_candidate||0)?'보류·제외로 분류되어 후보 0건일 수 있습니다.':'');
   $('preview').innerHTML=(d.eligiblePreview||[]).length?d.eligiblePreview.map(function(r){return'<tr><td class="tiny">'+esc(r.id)+'</td><td>'+esc(r.title)+'</td><td>'+esc(r.from)+'</td><td>'+esc(r.to)+'</td></tr>';}).join(''):'<tr><td colspan="4">복구 가능 상품이 없거나 조회 범위가 일치하지 않습니다.</td></tr>';
   status('읽기 전용 점검 완료 · 복구 가능 '+d.eligibleCount+'건 · 기존 배치 중 정상 상태인 상품은 변경하지 않습니다.','ok');
  }catch(e){snapshot=null;status('조회 실패: '+t(e.message)+' · 기존 원장에 아무 변경도 하지 않았습니다.','error');}finally{setBusy(false);}}
 async function restore(){if(busy||!snapshot||!snapshot.scannerComplete||!snapshot.eligibleCount)return;
   var ids=(snapshot.eligibleIds||[]).slice();if(!ids.length)return;
   if(!window.confirm('확인: 과거 섹션 배치 근거와 현재 상품 ID·URL이 일치한 '+ids.length+'건의 비공개 관리자 배치 상태만 복구할까요? 프론트 매칭과 AI 자동화는 실행하지 않습니다.'))return;
   busy=true;stop=false;setBusy(true);var r={requested:ids.length,restored:0,preserved:0,conflicts:0,failed:0,batches:[],scope:{country:'KR',region:'NATIONWIDE'},type:'igdc-admin-recovery-execution-log'};
   try{for(var i=0;i<ids.length;i+=8){if(stop)break;var batch=ids.slice(i,i+8),data=await request('POST',{country:'KR',region:'NATIONWIDE',action:'restore',confirm:'RESTORE_PRIOR_PRIVATE_PLACEMENTS',candidateIds:batch});r.restored+=Number(data.restored||0);r.preserved+=Number(data.preserved||0);r.conflicts+=Number(data.conflicts||0);r.failed+=Number(data.failed||0);r.batches.push({offset:i,...data});
       status('처리 '+Math.min(i+8,ids.length)+' / '+ids.length+'건 · 원장 복구 '+r.restored+' · 보존 '+r.preserved+' · 충돌 '+r.conflicts+' · 실패 '+r.failed,'muted');
       if(r.failed||r.conflicts){status('중단: 일부 상품에 쓰기 실패·충돌이 발생했습니다. 추가 진행하지 않고 기록을 확인하십시오. 복구 '+r.restored+'건, 실패 '+r.failed+'건, 충돌 '+r.conflicts+'건','error');break;}}
    report={audit:snapshot,execution:r};download(report,'IGDC_ADMIN_PRIVATE_LEDGER_RESCUE_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    if(!r.failed&&!r.conflicts)status((stop?'중단됨 · ':'복구 요청 완료 · ')+'관리자 후보 원장 복귀 '+r.restored+'건 · 건너뜀 '+r.preserved+'건. 관리자 페이지 새로고침 후 후보 수를 확인하십시오.','ok');
    snapshot=null;}
   catch(e){status('요청 중단: '+t(e.message)+' · 확인 전에는 추가 작업을 실행하지 마십시오.','error');report={audit:snapshot,execution:r,error:t(e.message)};download(report,'IGDC_ADMIN_RESCUE_PARTIAL_REPORT.json');snapshot=null;}
   finally{busy=false;setBusy(false);$('stop').disabled=true;}}
 $('audit').addEventListener('click',audit);$('refresh').addEventListener('click',audit);$('restore').addEventListener('click',restore);$('stop').addEventListener('click',function(){stop=true;status('중단 요청됨. 현재 진행 중인 8건 요청이 완료되면 남은 상품은 처리하지 않습니다.','muted');});$('json').addEventListener('click',function(){if(report)download(report,'IGDC_ADMIN_LEDGER_AUDIT_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');});
})();
