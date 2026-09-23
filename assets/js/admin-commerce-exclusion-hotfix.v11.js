/* IGDC Distribution admin exclusion/hold controls isolation hotfix v11.2
 * Scope: supplier hold/block bulk actions, product hold/reject bulk actions,
 * and exclusive accordion behavior only. No front publication action here.
 */
(function(){
  'use strict';
  var CONTROL='/.netlify/functions/commerce-country-control';
  var QUEUE='/.netlify/functions/commerce-candidate-queue-control';
  var TOKEN_KEYS=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'];
  function text(v){return String(v==null?'':v).trim();}
  function parse(v){try{return JSON.parse(v);}catch(_e){return null;}}
  function jwt(v){var s=text(v);return s.split('.').length===3&&s.length>32?s:'';}
  function collect(value,out,seen,depth){
    if(depth>4||value==null)return;
    if(typeof value==='string'){var t=jwt(value);if(t&&!seen[t]){seen[t]=1;out.push(t);return;}var p=parse(value);if(p)collect(p,out,seen,depth+1);return;}
    if(Array.isArray(value)){value.forEach(function(x){collect(x,out,seen,depth+1);});return;}
    if(typeof value==='object'){['id_token','idToken','access_token','accessToken','token','__raw','raw'].forEach(function(k){collect(value[k],out,seen,depth+1);});}
  }
  async function token(){
    var out=[],seen={};
    try{if(window.IGDCMemberAuth&&window.IGDCMemberAuth.getIdToken)collect(await window.IGDCMemberAuth.getIdToken(),out,seen,0);}catch(_e){}
    try{if(window.osAuth&&window.osAuth.getIdToken)collect(await window.osAuth.getIdToken(),out,seen,0);}catch(_e){}
    [window.localStorage,window.sessionStorage].forEach(function(store){if(!store)return;TOKEN_KEYS.forEach(function(k){try{collect(store.getItem(k),out,seen,0);}catch(_e){}});});
    return out[0]||'';
  }
  function scope(){
    var row=window.IGDC_ADMIN_COUNTRY_SCOPE||{},stored={};
    try{stored=JSON.parse(sessionStorage.getItem('igdc_admin_country_scope_v1')||'{}')||{};}catch(_e){}
    var q=new URLSearchParams(location.search);
    return{countryCode:text(row.country||q.get('country')||stored.country).toUpperCase(),subdivisionCode:text(row.region||q.get('region')||stored.region||'NATIONWIDE').toUpperCase()||'NATIONWIDE'};
  }
  function notice(message,kind){
    var n=document.getElementById('notice');if(!n)return;
    n.className='notice '+(kind==='ok'?'ok':kind==='fail'?'fail':'warn');n.textContent=message;n.classList.remove('hidden');
  }
  async function post(endpoint,action,body){
    var auth=await token();if(!auth)throw new Error('관리자 인증 토큰을 확인하지 못했습니다.');
    var url=endpoint+'?action='+encodeURIComponent(action),res=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(Object.assign({action:action},body||{}))}),data=null;
    try{data=await res.json();}catch(_e){}
    if(!res.ok||!data||data.ok!==true)throw new Error(text(data&&data.error)||('HTTP '+res.status));
    return data;
  }
  function checked(selector){return Array.prototype.slice.call(document.querySelectorAll(selector+':checked')).filter(function(x){return !x.disabled;});}
  function syncSupplier(kind){
    var boxes=Array.prototype.slice.call(document.querySelectorAll('[data-supplier-select="'+kind+'"]')).filter(function(x){return !x.disabled;}),selected=boxes.filter(function(x){return x.checked;}),all=document.getElementById(kind==='hold'?'supplierHoldSelectAll':kind==='blocked'?'supplierBlockedSelectAll':'supplierActiveSelectAll');
    if(all){all.disabled=boxes.length===0;all.checked=boxes.length>0&&selected.length===boxes.length;all.indeterminate=selected.length>0&&selected.length<boxes.length;}
    var count=document.getElementById(kind==='hold'?'supplierHoldSelectedCount':kind==='blocked'?'supplierBlockedSelectedCount':'supplierActiveSelectedCount'),countText='선택 '+selected.length+'건';if(count&&count.textContent!==countText)count.textContent=countText;
    document.querySelectorAll('[data-supplier-bulk-scope="'+kind+'"]').forEach(function(b){b.disabled=selected.length===0;});
  }
  function syncProduct(kind){
    var boxes=Array.prototype.slice.call(document.querySelectorAll('[data-product-exclusion-select="'+kind+'"]')).filter(function(x){return !x.disabled;}),selected=boxes.filter(function(x){return x.checked;}),all=document.getElementById(kind==='hold'?'productHoldSelectAll':'productRejectSelectAll');
    if(all){all.disabled=boxes.length===0;all.checked=boxes.length>0&&selected.length===boxes.length;all.indeterminate=selected.length>0&&selected.length<boxes.length;}
    var count=document.getElementById(kind==='hold'?'productHoldSelectedCount':'productRejectSelectedCount'),countText='선택 '+selected.length+'건';if(count&&count.textContent!==countText)count.textContent=countText;
    document.querySelectorAll('[data-product-exclusion-scope="'+kind+'"]').forEach(function(b){b.disabled=selected.length===0;});
  }
  function reloadAfter(message){notice(message,'ok');setTimeout(function(){location.reload();},300);}
  async function supplierBulk(button){
    var kind=text(button.getAttribute('data-supplier-bulk-scope')),decision=text(button.getAttribute('data-supplier-bulk')),boxes=checked('[data-supplier-select="'+kind+'"]'),urls=Array.from(new Set(boxes.map(function(x){return text(x.value);}).filter(Boolean)));
    if(!urls.length){notice('먼저 처리할 업체를 선택해 주세요.','warn');return;}
    var labels={restore:'후보 목록으로 복원',dismiss:'삭제·재수집 허용',purge:'URL 영구 제외',block:'도메인 차단',unblock:'차단 해제',remove_from_list:'목록에서만 제거'};
    if(!window.confirm('선택 '+urls.length+'건을 '+(labels[decision]||decision)+' 처리하시겠습니까?'))return;
    button.disabled=true;try{var s=scope();if(!s.countryCode)throw new Error('선택 국가를 확인하지 못했습니다.');var data=await post(CONTROL,'research_candidate_action',{countryCode:s.countryCode,subdivisionCode:s.subdivisionCode,urls:urls,url:urls[0],decision:decision}),r=data.candidateAction||{},processed=Number(r.processed||urls.length),failed=Number(r.durableFailed||0);if(failed)notice('업체 관리 처리 '+processed+'건 · 저장 실패 '+failed+'건. 실패 항목은 화면에 유지됩니다.','warn');else reloadAfter('업체 관리 '+processed+'건을 반영했습니다.');}catch(e){button.disabled=false;notice(text(e&&e.message)||'업체 관리 작업을 완료하지 못했습니다.','fail');}
  }
  async function productBulk(button){
    var kind=text(button.getAttribute('data-product-exclusion-scope')),decision=text(button.getAttribute('data-product-exclusion-bulk')),boxes=checked('[data-product-exclusion-select="'+kind+'"]'),ids=Array.from(new Set(boxes.map(function(x){return text(x.value);}).filter(Boolean)));
    if(!ids.length){notice('먼저 처리할 상품을 선택해 주세요.','warn');return;}
    var labels={undecided:'후보 목록으로 복원',reject:'제외 목록으로 이동',dismiss:'삭제·재수집 허용',purge:'영구 제외',remove_from_list:'목록에서만 제거'};
    if(!window.confirm('선택 '+ids.length+'건을 '+(labels[decision]||decision)+' 처리하시겠습니까?'))return;
    button.disabled=true;try{var s=scope();if(!s.countryCode)throw new Error('선택 국가를 확인하지 못했습니다.');var data;
      if(decision==='undecided')data=await post(CONTROL,'product_candidate_ledger_bulk_action',{countryCode:s.countryCode,subdivisionCode:s.subdivisionCode,candidateIds:ids,decision:'undecided'});
      else data=await post(QUEUE,'bulk_action',{countryCode:s.countryCode,subdivisionCode:s.subdivisionCode,candidateIds:ids,decision:decision,expectedBucket:kind});
      var processed=Number(data&&data.processed||0),failed=Number(data&&data.failed||(data&&data.failures&&data.failures.length)||0);if(failed)notice('상품 관리 요청 '+ids.length+'건 · 성공 '+processed+'건 · 실패 '+failed+'건. 성공 항목만 반영됐습니다.','warn');else reloadAfter('상품 관리 '+processed+'건을 반영했습니다.');
    }catch(e){button.disabled=false;notice(text(e&&e.message)||'상품 관리 작업을 완료하지 못했습니다.','fail');}
  }
  function exclusive(details){
    if(!details.open)return;['supplierControlQueue','productHoldQueue','productRejectQueue'].forEach(function(id){var other=document.getElementById(id);if(other&&other!==details&&other.open)other.open=false;});
  }
  document.addEventListener('change',function(event){
    var t=event.target;if(!t||!t.getAttribute)return;
    var kind=t.getAttribute('data-supplier-select');if(kind){syncSupplier(kind);return;}var all=t.getAttribute('data-supplier-select-all');if(all){document.querySelectorAll('[data-supplier-select="'+all+'"]').forEach(function(b){if(!b.disabled)b.checked=t.checked;});syncSupplier(all);return;}
    kind=t.getAttribute('data-product-exclusion-select');if(kind){syncProduct(kind);return;}all=t.getAttribute('data-product-exclusion-select-all');if(all){document.querySelectorAll('[data-product-exclusion-select="'+all+'"]').forEach(function(b){if(!b.disabled)b.checked=t.checked;});syncProduct(all);}
  },true);
  document.addEventListener('click',function(event){
    var t=event.target&&event.target.closest?event.target.closest('[data-supplier-bulk],[data-product-exclusion-bulk]'):null;if(!t)return;
    event.preventDefault();event.stopPropagation();if(event.stopImmediatePropagation)event.stopImmediatePropagation();
    if(t.hasAttribute('data-supplier-bulk'))supplierBulk(t);else productBulk(t);
  },true);
  function observeList(id,sync){
    var root=document.getElementById(id);if(!root||root.dataset.hotfixListObserver==='1')return;root.dataset.hotfixListObserver='1';
    var queued=false,observer=new MutationObserver(function(){if(queued)return;queued=true;(window.requestAnimationFrame||function(fn){return setTimeout(fn,0);})(function(){queued=false;sync();});});
    observer.observe(root,{subtree:true,childList:true});
  }
  function wire(){
    ['supplierControlQueue','productHoldQueue','productRejectQueue'].forEach(function(id){var d=document.getElementById(id);if(d&&!d.dataset.exclusiveWired){d.dataset.exclusiveWired='1';d.addEventListener('toggle',function(){exclusive(d);});}});
    observeList('supplierHoldRows',function(){syncSupplier('hold');});
    observeList('supplierBlockedRows',function(){syncSupplier('blocked');});
    observeList('productHoldRows',function(){syncProduct('hold');});
    observeList('productRejectRows',function(){syncProduct('reject');});
    syncSupplier('hold');syncSupplier('blocked');syncProduct('hold');syncProduct('reject');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();
