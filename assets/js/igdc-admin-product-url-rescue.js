(function(){'use strict';
const API='/.netlify/functions/commerce-admin-product-url-rescue';
const el=id=>document.getElementById(id);let busy=false,stop=false,scanComplete=false,all=[],results=[],offset=0;
function text(x){return String(x==null?'':x);}
function esc(v){return text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
function report(msg,type){el('notice').className=type||'normal';el('notice').textContent=msg;}
function tokens(){const found=[];function add(v){if(!v)return;if(typeof v==='string'){if(v.split('.').length===3&&v.length>40){if(!found.includes(v))found.push(v);}else try{add(JSON.parse(v));}catch(_){}}else if(Array.isArray(v))v.forEach(add);else if(typeof v==='object')for(const k of ['id_token','idToken','access_token','accessToken','token','raw','__raw'])add(v[k]);}
 try{if(window.IGDCMemberAuth&&window.IGDCMemberAuth.getIdToken)add(window.IGDCMemberAuth.getIdToken());}catch(_){}
 const keys=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'];
 [window.localStorage,window.sessionStorage].forEach(s=>keys.forEach(k=>{try{add(s.getItem(k));}catch(_){}}));return found;}
async function request(method,query,body){const auth=tokens();try{if(window.IGDCMemberAuth&&window.IGDCMemberAuth.getIdToken){const v=await window.IGDCMemberAuth.getIdToken();if(v&&!auth.includes(v))auth.unshift(v);}}catch(_){}
 if(!auth.length)throw Error('로그인 인증을 읽을 수 없습니다. 관리자에서 로그인한 뒤 이 페이지를 다시 여십시오.');let last;
 for(let i=0;i<auth.length;i++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
  try{const qs=new URLSearchParams(query);const resp=await fetch(API+'?'+qs.toString(),{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Authorization':'Bearer '+auth[i],'Accept':'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},body:method==='POST'?JSON.stringify(body):undefined});let j;try{j=await resp.json();}catch(_){throw Error('서버가 JSON 응답을 보내지 않았습니다. HTTP '+resp.status);}
   if((resp.status===401||resp.status===403)&&i<auth.length-1)continue;
   if(!resp.ok||!j||j.ok!==true)throw Error('HTTP '+resp.status+' '+text(j&&j.error));return j;
  }catch(e){last=e;if(i<auth.length-1&&/HTTP (401|403)/.test(text(e.message)))continue;throw e;}
  finally{clearTimeout(timer);}}
 throw last||Error('요청 실패');}
function saveJson(obj){const blob=new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='IGDC_CAFE24_CHALLENGE_URL_AUDIT_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1200);}
function toggle(){el('audit').disabled=busy;el('repair').disabled=busy||!scanComplete||!all.some(x=>x.restorable);el('json').disabled=busy||!all.length;el('stop').disabled=!busy;el('country').disabled=busy;el('region').disabled=busy;}
function render(){const fixable=all.filter(x=>x.restorable),unrecoverable=all.filter(x=>!x.restorable);
 el('counts').textContent='접근 제한 주소 '+all.length+'건 · 원본 주소가 확인된 상품 '+fixable.length+'건 · 원본 주소 근거 부족/보호 '+unrecoverable.length+'건';
 el('rows').innerHTML=all.length?all.map((item,index)=>'<tr><td>'+esc(index+1)+'</td><td>'+esc(item.name)+'</td><td>'+esc(item.decision)+'</td><td class="tiny">'+esc(item.challengeExample)+'</td><td class="tiny">'+(item.restorable?'<span class="good">원본 주소 확인</span> '+esc(item.recoveryUrl):'<span class="warn">복구 유보</span> · '+esc(item.reason))+'</td></tr>').join(''):'<tr><td colspan="5">스캔 결과가 없거나 상품 URL이 정상입니다.</td></tr>';
 toggle();}
async function audit(){if(busy)return;all=[];results=[];offset=0;stop=false;busy=true;scanComplete=false;toggle();render();const country=el('country').value.toUpperCase(),region=el('region').value.toUpperCase();report('원장 읽기 시작: 변경 없이 조회만 진행합니다.');
 try{for(let page=0;page<61;page++){
   if(stop)break;const data=await request('GET',{country,region,offset,limit:100});all.push(...data.items);offset+=(Number(data.processed)||0);render();report('DB '+offset+'건 읽음 · 접근 제한 URL '+all.length+'건 · 원본 근거 확인 '+all.filter(x=>x.restorable).length+'건');
   if(!data.hasMore){scanComplete=true;break;}if(!data.nextOffset||data.nextOffset<=offset-100)throw Error('페이지 이동 오류');offset=data.nextOffset;
 }
 if(scanComplete)report('읽기 전용 조사 완료 · 복구 가능한 원본 URL '+all.filter(x=>x.restorable).length+'건. URL 오염이 없는 상품은 변경하지 않습니다.','ok');
 else report('점검 중단 또는 조회 범위 상한입니다. 전체 검증이 완료되지 않아 쓰기 버튼은 비활성화됩니다.','warn');
 }catch(e){report('원장 조회 실패: '+text(e.message)+' · DB 변경 없음','error');scanComplete=false;}
 finally{busy=false;toggle();}}
async function repair(){if(busy||!scanComplete)return;const items=all.filter(x=>x.restorable),ids=items.map(x=>x.id);if(!ids.length)return;
 if(!window.confirm('현재 DB에 저장된 동일 판매자·동일 상품번호의 원본 상세주소가 확인된 '+ids.length+'건만 URL을 복원합니다. 보류/배치 상태는 그대로 유지합니다. 계속할까요?'))return;
 busy=true;stop=false;toggle();let repaired=0,preserved=0,failed=0;try{for(let start=0;start<ids.length;start+=6){if(stop)break;
   const batch=ids.slice(start,start+6),data=await request('POST',{country:el('country').value,region:el('region').value},{action:'repair',country:el('country').value,region:el('region').value,confirm:'REPAIR_STORED_CHALLENGE_URL_ONLY',ids:batch});results.push(...(data.results||[]));repaired+=Number(data.repaired)||0;preserved+=Number(data.preserved)||0;failed+=Number(data.failed)||0;
   report('URL 복구 '+Math.min(start+batch.length,ids.length)+'/'+ids.length+'건 처리 · 복구 '+repaired+' · 보호 '+preserved+' · 실패 '+failed);
   if(data.failed||data.conflicts){report('복구 도중 실패·충돌 발생: 더 진행하지 않습니다. 기록을 확인하십시오.','error');break;}
 }saveJson({type:'igdc-challenge-url-repair.v1',scanned:offset,results,audit:all});scanComplete=false;
 report('작업 종료 · 원본 상세주소 복구 '+repaired+'건 · 기존 상태 보존 '+preserved+'건 · 실패 '+failed+'건. 관리자 새로고침 후 링크를 확인하십시오. 이 작업은 상품 자체를 정상 판정하거나 자동 배치하지 않습니다.',failed?'warn':'ok');
 }catch(e){saveJson({type:'igdc-challenge-url-repair.partial.v1',scanned:offset,results,audit:all,error:text(e.message)});scanComplete=false;report('실행 중단: '+text(e.message)+' · 로그가 다운로드됐습니다.','error');}
 finally{busy=false;toggle();}}
el('audit').addEventListener('click',audit);el('repair').addEventListener('click',repair);el('stop').addEventListener('click',()=>{stop=true;report('중단 요청됨. 현재 API 요청만 완료하고 멈춥니다.','warn');});el('json').addEventListener('click',()=>saveJson({type:'igdc-challenge-url-diagnostic.v1',scanned:offset,scanComplete,audit:all}));toggle();})();
