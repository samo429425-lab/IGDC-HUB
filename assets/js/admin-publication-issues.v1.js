/* IGDC administrator read-only issue lists: Distribution 20 and Social 3 sections. */
(function(){
 "use strict";
 var root=document.getElementById("distributionMaintenanceIssues")||document.getElementById("socialContentIssues");
 if(!root)return;
 var dist=!!document.getElementById("distributionMaintenanceIssues"),id=dist?"distributionIssue":"socialIssue";
 var btn=document.getElementById(id+"Refresh"),dl=document.getElementById(id+"Download"),state=document.getElementById(id+"Status"),list=document.getElementById(id+"Rows");
 var endpoint=dist?"/.netlify/functions/commerce-publication-issues-report":"/.netlify/functions/social-content-issues-report";
 var report=null,loading=false;
 function txt(v){return String(v==null?"":v).trim();}
 function jwt(v){return typeof v==="string"&&v.split(".").length===3&&v.length>32?v:"";}
 function tokens(value,out,depth){
  if(depth>3||value==null)return;
  if(typeof value==="string"){
   var t=jwt(value);if(t){if(out.indexOf(t)<0)out.push(t);return;}
   if(value[0]==="{"||value[0]==="[")try{tokens(JSON.parse(value),out,depth+1);}catch(_e){}
  }else if(Array.isArray(value)){value.forEach(function(x){tokens(x,out,depth+1);});}
  else if(typeof value==="object"){
   ["id_token","idToken","access_token","accessToken","token","__raw","raw"].forEach(function(k){tokens(value[k],out,depth+1);});
  }
 }
 async function authTokens(){
  var all=[],keys=["igdc.socialCandidateQueue.adminBearer","osauth.tokens.v2","osauth.tokens.v1","igdc.tokens","igdc_auth_tokens","auth0_tokens","auth0spa","igdc_id_token","id_token","auth0_id_token"];
  var windows=[window];try{if(window.parent!==window)windows.push(window.parent);}catch(_e){}
  for(var w of windows){
   try{if(w.IGDCMemberAuth&&w.IGDCMemberAuth.getIdToken)tokens(await w.IGDCMemberAuth.getIdToken(),all,0);}catch(_e){}
   try{if(w.osAuth&&w.osAuth.getIdToken)tokens(await w.osAuth.getIdToken(),all,0);}catch(_e){}
   ["sessionStorage","localStorage"].forEach(function(kind){try{var storage=w[kind];keys.forEach(function(k){try{tokens(storage.getItem(k),all,0);}catch(_e){}});}catch(_e){}});
  }
  return all;
 }
 function addCell(tr,value){var td=document.createElement("td");td.textContent=txt(value)||"—";td.style.cssText="padding:7px;border-bottom:1px solid #2e4259;vertical-align:top;overflow-wrap:anywhere";tr.appendChild(td);return td;}
 function linkCell(tr,url,label){var td=addCell(tr,"");try{var u=new URL(txt(url),window.location.href);if(!/^https?:$/.test(u.protocol)||!/^https:/.test(u.protocol))throw new Error("unsafe_url");var a=document.createElement("a");a.href=u.href;a.target="_blank";a.rel="noopener noreferrer nofollow";a.textContent=(txt(label)||u.hostname).slice(0,100);a.style.color="#8ddaff";td.appendChild(a);}catch(_e){td.textContent="주소 확인 필요";}}
 function render(doc){
  list.textContent="";
  var info=document.createElement("p");info.style.margin="8px 0";
  info.textContent="조회 항목 "+(doc.issues||[]).length+"건 · "+(dist?"22개 섹션 · 최근 확인된 이상/교체 대기":"3개 SNS · 저장된 근거 기준")+(doc.summary&&doc.summary.partial?" · 조회 일부 미완료":"");list.appendChild(info);
  if(!(doc.issues||[]).length){var p=document.createElement("p");p.textContent="현재 저장된 점검 기록에 표시할 문제가 없습니다. 최근 조회 범위가 전체 실시간 정상 판정을 의미하지는 않습니다.";list.appendChild(p);return;}
  var outer=document.createElement("div");outer.style.overflowX="auto";var table=document.createElement("table");table.style.cssText="width:100%;border-collapse:collapse;font-size:12px;min-width:650px";
  var head=document.createElement("tr");["섹션","국가·지역","상품/콘텐츠","문제 또는 대체 상태","원본 확인"].forEach(function(t){var th=document.createElement("th");th.textContent=t;th.style.cssText="text-align:left;padding:7px;border-bottom:1px solid #67809d";head.appendChild(th);});table.appendChild(head);
  (doc.issues||[]).forEach(function(it){var tr=document.createElement("tr");addCell(tr,(it.sectionNumber?it.sectionNumber+"번 ":"")+(it.sectionName||it.sectionKey||"미확인"));addCell(tr,dist?[it.country,it.region].filter(Boolean).join(" / "):"GLOBAL / "+(it.publishedInStoredRelease?"저장 릴리스":"후보 원장"));addCell(tr,it.title||it.candidateId);addCell(tr,dist?(it.issueStatus+" · "+(it.recoveryReason||it.reason||it.reasons||[]).toString()):(it.reasons||[]).join(", "));linkCell(tr,dist?it.productUrl:it.url,"상세 주소 열기");table.appendChild(tr);});outer.appendChild(table);list.appendChild(outer);
 }
 async function run(){if(loading)return;loading=true;btn.disabled=true;dl.disabled=true;report=null;state.textContent="관리자 인증 후 저장된 최근 점검 기록을 조회하는 중입니다.";
  try{
   var candidateTokens=await authTokens();if(!candidateTokens.length)throw new Error("관리자 로그인 토큰을 찾지 못했습니다. 기존 관리자 로그인으로 다시 입장해 주세요.");
   var lastError=null;
   for(var token of candidateTokens){
    var response=await fetch(endpoint,{method:"GET",credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json",Authorization:"Bearer "+token}}),doc=await response.json().catch(function(){return null;});
    if(response.status===401||response.status===403){lastError=new Error(doc&&doc.message||"관리자 인증 또는 권한이 필요합니다.");continue;}
    if(!response.ok||!doc||doc.ok!==true)throw new Error(doc&&doc.message||"점검 서버 HTTP "+response.status);
    report=doc;render(report);dl.disabled=false;
    state.textContent="조회 완료 · "+doc.summary.issues+"건 · "+(new Date(doc.generatedAt)).toLocaleString("ko-KR")+" · 읽기 전용";
    return;
   }
   throw lastError||new Error("관리자 인증 실패");
  }catch(e){state.textContent="조회 실패: "+txt(e&&e.message);list.textContent="원장 데이터는 변경하지 않았습니다. 인증과 서버 접근 상태를 확인해 주세요.";}
  finally{btn.disabled=false;loading=false;}
 }
 btn.addEventListener("click",run);
 dl.addEventListener("click",function(){if(!report)return;var blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json;charset=utf-8"});var url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=(dist?"IGDC_Distribution_20Section_Issues_":"IGDC_Social_3Section_Issues_")+new Date().toISOString().replace(/[:.]/g,"-")+".json";a.style.display="none";document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},2500);});
})();
