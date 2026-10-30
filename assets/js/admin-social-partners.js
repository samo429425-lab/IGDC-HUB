/* IGDC Social Promotion Partners v1 — Social main only. Never modifies Distribution right panel. */
(function () {
  'use strict';
  var ENDPOINT = '/.netlify/functions/social-promotion-partners';
  var rows = [], selectedId = '', loaded = false, busy = false;
  var $ = function (id) { return document.getElementById(id); };
  var text = function (v) { return String(v == null ? '' : v).trim(); };
  var esc = function (v) { return text(v).replace(/[&<>"']/g, function (m) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
  }); };
  function token() {
    var v = '';
    try { v = window.IGDCMemberAuth && window.IGDCMemberAuth.getIdToken && window.IGDCMemberAuth.getIdToken() || ''; } catch (_) {}
    if (!v) try { v = window.osAuth && window.osAuth.getIdToken && window.osAuth.getIdToken() || ''; } catch (_) {}
    if (!v) try { v = sessionStorage.getItem('igdc.socialCandidateQueue.adminBearer') || localStorage.getItem('igdc.socialCandidateQueue.adminBearer') || ''; } catch (_) {}
    return text(v);
  }
  function state(message, bad) {
    var node = $('socialPartnerState'); if (!node) return;
    node.textContent = message;
    node.style.color = bad ? '#b42318' : '#23533e';
  }
  async function request(action, body) {
    var auth = token();
    if (!auth) throw new Error('관리자 로그인이 필요합니다. 로그인 후 새로고침하세요.');
    var isGet = action === 'list' || action === 'diagnostic';
    var response = await fetch(ENDPOINT + (isGet ? '?action=' + action : ''), {
      method: isGet ? 'GET' : 'POST',
      headers: Object.assign({'Accept':'application/json','Authorization':'Bearer ' + auth},
        isGet ? {} : {'Content-Type':'application/json'}),
      body: isGet ? undefined : JSON.stringify(Object.assign({action: action}, body || {})),
      cache:'no-store', credentials:'same-origin'
    });
    var result = await response.json().catch(function () { return {error:'invalid_response'}; });
    if (!response.ok || !result.ok) {
      var error = new Error(text(result.message) || text(result.error) || '관리 API 오류 ' + response.status);
      error.status = response.status; error.info = result; throw error;
    }
    return result;
  }
  function field(key) { return text($(key) && $(key).value); }
  function resetForm() {
    selectedId = '';
    var form = $('socialPartnerForm'); if (form) form.reset();
    if ($('socialPartnerId')) $('socialPartnerId').value = '';
    if ($('socialPartnerSaveBtn')) $('socialPartnerSaveBtn').textContent = '제휴 후보 등록·변경 저장';
    state('신규 제휴 정보를 입력하거나 기존 원장에서 선택하세요.');
  }
  function populate(item) {
    selectedId = item.id;
    var map = {
      socialPartnerId:item.id, socialPartnerName:item.displayName,
      socialPartnerKind:item.partnerKind, socialPartnerSection:item.sectionKey,
      socialPartnerChannel:item.channelUrl, socialPartnerWebsite:item.websiteUrl,
      socialPartnerTarget:item.promotionTargetUrl, socialPartnerTargetType:item.targetKind,
      socialPartnerFrom:item.signedFrom, socialPartnerUntil:item.signedUntil,
      socialPartnerProof:item.contractProofReference, socialPartnerNote:item.notes
    };
    Object.keys(map).forEach(function(k){ if ($(k)) $(k).value = text(map[k]); });
    if ($('socialPartnerStatus')) $('socialPartnerStatus').value = item.cooperationStatus === 'active' ? 'negotiating' : item.cooperationStatus;
    $('socialPartnerSaveBtn').textContent = '선택 제휴 정보 수정 저장 (재승인 필요)';
    state('선택: ' + item.displayName + (item.activeEligible ? ' · 승인된 협약: 수정을 저장하면 재검증이 필요합니다.' : ''));
    if ($('socialPartnerBody') && $('socialPartnerBody').classList.contains('hidden')) toggle(true);
  }
  function render(doc) {
    rows = Array.isArray(doc.rows) ? doc.rows : [];
    var summary = doc.summary || {};
    $('socialPartnerSummary').textContent = '등록 ' + (summary.total || 0) + '건 · 유효 협약 우선 배치 ' + (summary.activeVerifiedEligible || 0) + '건 · ' +
      'SNS별 ' + Object.keys(summary.bySection || {}).map(function (k) { return k.replace('social-','') + ':' + summary.bySection[k]; }).join(' / ') +
      (summary.truncated ? ' · 최대 500건 조회 제한' : '');
    $('socialPartnerRows').innerHTML = rows.length ? rows.map(function(r){
      var channel = /^https:\/\//i.test(r.channelUrl) ? '<a href="' + esc(r.channelUrl) + '" target="_blank" rel="noopener noreferrer">채널 열기</a>' : '—';
      var website = /^https:\/\//i.test(r.websiteUrl) ? '<a href="' + esc(r.websiteUrl) + '" target="_blank" rel="noopener noreferrer">업체</a>' : '';
      var target = /^https:\/\//i.test(r.promotionTargetUrl) ? '<a href="' + esc(r.promotionTargetUrl) + '" target="_blank" rel="noopener noreferrer">홍보 대상</a>' : '미연결';
      return '<tr><td><strong>' + esc(r.displayName) + '</strong><div class="small">' + esc(r.partnerKind) + '</div></td>' +
        '<td>' + esc((r.sectionKey||'').replace('social-','')) + '</td><td>' + channel + (website ? ' · ' + website : '') + '</td>' +
        '<td>' + target + '</td><td>' + esc(r.cooperationStatus) + (r.signedUntil ? '<div class="small">종료 ' + esc(r.signedUntil) + '</div>' : '') +
        '</td><td>' + (r.activeEligible ? '검증 완료' : '미적용') + '</td><td><button type="button" class="secondary" data-partner-id="' + esc(r.id) + '">선택·수정</button></td></tr>';
    }).join('') : '<tr><td colspan="7">등록된 계약·협약 관리 항목이 없습니다.</td></tr>';
    Array.from($('socialPartnerRows').querySelectorAll('button[data-partner-id]')).forEach(function(btn){
      btn.addEventListener('click',function(){ var item = rows.find(function(r){return r.id === btn.getAttribute('data-partner-id');});if(item) populate(item); });
    });
    loaded = true;
  }
  function payload() {
    return {
      id:selectedId || '',displayName:field('socialPartnerName'),partnerKind:field('socialPartnerKind'),
      sectionKey:field('socialPartnerSection'),channelUrl:field('socialPartnerChannel'),websiteUrl:field('socialPartnerWebsite'),
      promotionTargetUrl:field('socialPartnerTarget'),targetKind:field('socialPartnerTargetType'),
      cooperationStatus:field('socialPartnerStatus'),signedFrom:field('socialPartnerFrom'),
      signedUntil:field('socialPartnerUntil'),contractProofReference:field('socialPartnerProof'),notes:field('socialPartnerNote')
    };
  }
  async function refresh() {
    state('계약·협약 원장을 조회하고 있습니다.');
    try { var doc = await request('list'); render(doc); state('조회 완료 · 변경된 항목은 실제 협약 증빙 확인 후 승인하세요.'); }
    catch(e) {state('조회 실패: ' + e.message + ' · 데이터베이스 테이블 설치 여부를 확인하세요.',true);throw e;}
  }
  function downloadJson(name, data) {
    var blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json;charset=utf-8'});
    var url = URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  async function diagnostic() {
    var report;
    try { report = await request('diagnostic'); state('계약·협약 점검 JSON 생성 완료.'); }
    catch(e) {
      // An absent SQL table should still yield a downloadable operator diagnostic.
      report={ok:false,reportType:'igdc-social-promotion-partners-diagnostic-failed',generatedAt:new Date().toISOString(),
        error:text(e.info && e.info.error)||'request_failed',status:e.status||null,message:e.message,
        recommendedAction:'관리자 인증과 supabase/social_promotion_partners.sql 테이블 설치를 확인하세요.'};
      state('점검 실패 · 오류 상세를 JSON으로 내려받습니다.',true);
    }
    downloadJson('IGDC_SOCIAL_PARTNERS_DIAGNOSTIC_' + new Date().toISOString().slice(0,10) + '.json',report);
  }
  async function mutate(action, data) {
    if(busy) return;busy=true;
    try {
      state(action + ' 처리 중');
      await request(action,data);
      await refresh();
      if(action==='save') resetForm();
      else {selectedId='';resetForm();}
      state(action === 'verify' ? '협약 증빙 승인 완료 · 다음 소셜 프론트 매칭 시 검증된 콘텐츠에 우선순위가 적용됩니다.' : '저장 완료');
    }catch(e){state('처리 실패: '+e.message,true);}finally{busy=false;}
  }
  function toggle(force) {
    var body=$('socialPartnerBody');if(!body)return;
    var next=force===true || (force!==false && body.classList.contains('hidden'));
    body.classList.toggle('hidden',!next);
    $('socialPartnerToggleBtn').textContent=next?'관리창 접기':'관리창 펼치기';
    $('socialPartnerToggleBtn').setAttribute('aria-expanded',next?'true':'false');
    if(next && !loaded) refresh().catch(function(){});
    if(next){
      var reg=$('registryPanelBody');var t=$('toggleRegistryPanelBtn');
      if(reg && !reg.classList.contains('hidden') && t) t.click();
    }
  }
  function init() {
    if(!$('socialPartnerPanel')) return;
    $('socialPartnerToggleBtn').addEventListener('click',function(){toggle();});
    $('socialPartnerRefreshBtn').addEventListener('click',function(){refresh().catch(function(){});});
    $('socialPartnerDiagnosticBtn').addEventListener('click',diagnostic);
    $('socialPartnerClearBtn').addEventListener('click',resetForm);
    $('socialPartnerForm').addEventListener('submit',function(e){e.preventDefault();mutate('save',payload());});
    $('socialPartnerVerifyBtn').addEventListener('click',function(){
      if(!selectedId){state('승인할 계약 항목을 목록에서 선택하세요.',true);return;}
      if(!window.confirm('실제 협약·계약 서류와 홍보 권한을 확인했고, 공개 콘텐츠 안전 심사를 유지하는 조건으로 우선 배치를 승인하시겠습니까?'))return;
      mutate('verify',{id:selectedId});
    });
    $('socialPartnerPauseBtn').addEventListener('click',function(){
      if(!selectedId){state('중지할 계약 항목을 목록에서 선택하세요.',true);return;}
      mutate('pause',{id:selectedId});
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);else init();
})();
