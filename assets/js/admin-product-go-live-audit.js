(function(){
  'use strict';
  var lastReport = null;
  var $ = function(id){ return document.getElementById(id); };
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function text(v){ return v == null ? '' : String(v); }
  function statusClass(v){ v=String(v||'').toLowerCase(); if(/block|fail|error/.test(v)) return 'fail'; if(/not_ready|hold|warn|review_required|attention|required/.test(v)) return 'warn'; if(/ready|ok|pass/.test(v)) return 'ok'; return 'info'; }
  function setStatus(message, cls){ var el=$('status'); if(!el) return; el.className='small '+(cls||''); el.textContent=message; }
  function nowStamp(){ var d=new Date(), z=function(n){ return String(n).padStart(2,'0'); }; return d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+'_'+z(d.getHours())+z(d.getMinutes())+z(d.getSeconds()); }
  function download(name, data, type){ var blob=new Blob([data],{type:type||'application/octet-stream'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href); a.remove();},1000); }
  function mode(){ return $('auditMode') && $('auditMode').value === 'production' ? 'production' : 'pre-product'; }
  function card(title, number, note, cls){ return '<div class="card"><h2>'+esc(title)+'</h2><div class="num '+(cls||'info')+'">'+esc(number)+'</div><div class="small">'+esc(note||'')+'</div></div>'; }
  function boolMark(v){ return v ? '<span class="ok">준비</span>' : '<span class="warn">미설정</span>'; }
  function render(report){
    lastReport=report;
    var s=report.summary||{}, gate=report.gate||{}, runtime=report.runtime||{}, ps=runtime.providerSettlement||{};
    $('summary').innerHTML=[
      card('실제 상품 후보',s.realProductCandidates||0,'샘플·시드 제외','info'),
      card('제휴 수수료 준비',s.readyAffiliate||0,'승인 제휴 계약 + 추적 URL','ok'),
      card('직접 광고·중개 수익 준비',s.readyDirectRevenue||0,'검증된 계약·상대방·고지·정산 근거','ok'),
      card('수익권 검토 필요',s.revenueReviewRequired||0,'트래픽 가치 또는 계약 증빙 보강 필요','warn'),
      card('구형 외부추천 상태',s.readyExternalReferral||0,'호환 집계값 · 수익 준비로 계산하지 않음','info'),
      card('전면 노출 보류',s.hold||0,'신뢰·권역·배송·계약 보강 필요','warn'),
      card('전면 노출 차단',s.block||0,'URL·식별·프론트 계약 오류','fail'),
      card('샘플/시드',s.seedOrSample||0,'현재 준비용 데이터','info')
    ].join('');

    var gateClass=statusClass(gate.state);
    $('gatePanel').classList.remove('hidden');
    $('gatePanel').innerHTML='<h2>개방 게이트</h2><div class="notice '+(gateClass==='ok'?'okbox':(gateClass==='warn'?'warnbox':''))+'"><strong class="'+gateClass+'">'+esc(gate.state||'unknown')+'</strong><br>'+esc(gate.reason||'')+'<br><span class="small">'+esc(gate.note||'')+'</span></div>';

    var snapRows=(report.snapshots||[]).map(function(row){
      return '<tr><td>'+esc(row.key)+'</td><td>'+esc(row.totalItems||0)+'</td><td>'+esc(row.seedOrSample||0)+'</td><td>'+esc(row.realProductCandidates||0)+'</td><td>'+esc(row.readyAffiliate||0)+'</td><td>'+esc(row.readyDirectRevenue||0)+'</td><td>'+esc(row.revenueReviewRequired||0)+'</td><td>'+esc(row.readyExternalReferral||0)+'</td><td>'+esc(row.hold||0)+'</td><td>'+esc(row.block||0)+'</td><td class="'+(row.copies&&row.copies.synchronized?'ok':'warn')+'">'+(row.copies&&row.copies.synchronized?'동기화':'확인 필요')+'</td></tr>';
    }).join('');
    $('snapshotPanel').classList.remove('hidden');
    $('snapshotPanel').innerHTML='<h2>스냅샷별 실상품 준비 상태</h2><div class="small">공개 데이터와 함수 배포본의 해시를 비교합니다. 외부 판매처에는 접속하지 않습니다.</div><table><thead><tr><th>스냅샷</th><th>전체</th><th>샘플</th><th>실상품</th><th>제휴</th><th>직접수익</th><th>수익검토</th><th>구형 외부추천</th><th>보류</th><th>차단</th><th>복제본</th></tr></thead><tbody>'+snapRows+'</tbody></table>';

    var candidates=report.candidateRows||[];
    var candRows=candidates.length?candidates.map(function(row){
      var reasons=(row.issues||[]).concat(row.info||[]).slice(0,6).join(', ');
      var revenue=row.revenueQualification||{};
      var revenueText=(revenue.type||'미확인')+' / '+(revenue.payable?'지급 가능 검증':(revenue.potential?'검토 필요':'수익권 없음'));
      if(revenue.contractId) revenueText+=' / '+revenue.contractId;
      return '<tr><td class="'+statusClass(row.status)+'"><strong>'+esc(row.status)+'</strong></td><td>'+esc(row.id||'')+'<br><span class="small">'+esc(row.title||'')+'</span></td><td>'+esc(row.page||'')+' / '+esc(row.section||'')+'</td><td>'+esc(row.sellerHost||'')+'<br><span class="small">'+esc(row.sellerUrlState||'')+'</span></td><td>'+esc(row.affiliate&&row.affiliate.providerId||'없음')+'<br><span class="small">'+esc(row.affiliate&&row.affiliate.status||'')+'</span></td><td>'+esc(revenueText)+'<br><span class="small">'+esc((revenue.verificationReasons||[]).join(', '))+'</span></td><td>'+esc(reasons)+'</td></tr>';
    }).join(''):'<tr><td colspan="7" class="small">현재는 실상품 후보가 없습니다. 실제 공급이 아직 꺼져 있거나, 스냅샷이 샘플 상태인 경우 정상입니다.</td></tr>';
    $('candidatePanel').classList.remove('hidden');
    $('candidatePanel').innerHTML='<h2>실상품 후보 판정</h2><div class="small">승인된 제휴 계약 또는 검증된 직접 광고·중개·리드·협찬 계약만 수익 준비 후보로 계산합니다. 일반 외부 판매처와 트래픽 가치 후보는 수익권 검토 상태로 유지하며 확정 수수료로 처리하지 않습니다.</div><table><thead><tr><th>판정</th><th>상품</th><th>배치</th><th>판매처</th><th>제휴 계약</th><th>수익 자격</th><th>보류/정보</th></tr></thead><tbody>'+candRows+'</tbody></table>';

    $('runtimePanel').classList.remove('hidden');
    $('runtimePanel').innerHTML='<h2>비PG 수익 수령 준비</h2><table><tbody>'+
      '<tr><th>확정 수익 원장 저장소</th><td>'+boolMark(!!ps.ledgerStorageConfigured)+'</td></tr>'+
      '<tr><th>제휴 클릭 서명</th><td>'+boolMark(!!ps.affiliateClickSigningConfigured)+'</td></tr>'+
      '<tr><th>제휴 파트너 설정</th><td>'+boolMark(!!ps.affiliatePartnerConfigConfigured)+' <span class="small">('+esc(ps.affiliatePartnerCount||0)+'개)</span></td></tr>'+
      '<tr><th>제휴 전환 웹훅 수령</th><td>'+boolMark(!!ps.affiliateConversionWebhookReady)+'</td></tr>'+
      '<tr><th>광고·제휴 정산명세 수입</th><td>'+boolMark(!!ps.nonPgSettlementIngestReady)+'</td></tr>'+
      '<tr><th>상품 자동공급 스위치</th><td class="mono">PRODUCT_SUPPLY_ON='+esc(runtime.supplySwitches&&runtime.supplySwitches.productSupplyOn||'not-configured')+'<br>DATA_UPLOAD_ON='+esc(runtime.supplySwitches&&runtime.supplySwitches.dataUploadOn||'not-configured')+'<br>FRONT_SLOT_AUTO_FILL='+esc(runtime.supplySwitches&&runtime.supplySwitches.frontSlotAutoFill||'not-configured')+'<br>PAYMENT_LIVE='+esc(runtime.supplySwitches&&runtime.supplySwitches.paymentLive||'not-configured')+'</td></tr>'+
      '</tbody></table><div class="small">환경변수의 실제 값·토큰·계좌 정보는 표시하지 않습니다.</div>';

    $('rawOutput').textContent=JSON.stringify(report,null,2);
    $('downloadJsonBtn').disabled=false; $('downloadHtmlBtn').disabled=false;
  }
  async function runAudit(){
    var btn=$('runAuditBtn'); if(btn) btn.disabled=true;
    setStatus('실상품·신뢰·권역·제휴 계약·정산 수령 준비 상태를 읽는 중입니다…','info');
    try{
      var url='/.netlify/functions/product-go-live-audit?mode='+encodeURIComponent(mode())+'&limit=120&ts='+Date.now();
      var res=await fetch(url,{cache:'no-store',headers:{'accept':'application/json'}});
      var body=await res.json().catch(function(){return null;});
      if(!res.ok || !body || body.ok!==true) throw new Error((body&&body.error)||('HTTP '+res.status));
      render(body);
      setStatus('점검 완료 · '+(body.gate&&body.gate.state||'unknown'),' '+statusClass(body.status));
    }catch(err){ setStatus('점검 실패: '+String(err&&err.message||err),'fail'); }
    finally{ if(btn) btn.disabled=false; }
  }
  function publicTargets(){ return [
    ['홈','/home.html'],['유통 허브','/distributionhub.html'],['네트워크','/networkhub.html'],['미디어','/mediahub.html'],['소셜','/socialnetwork.html'],['관광','/tour.html'],['후원','/donation.html'],['검색','/search.html']
  ]; }
  function observePage(label,url){
    return new Promise(function(resolve){
      var frame=document.createElement('iframe');
      frame.setAttribute('aria-hidden','true'); frame.tabIndex=-1;
      frame.style.cssText='position:fixed;left:-10000px;top:-10000px;width:1200px;height:900px;visibility:hidden;pointer-events:none;border:0';
      var done=false; var timer;
      function finish(result){ if(done) return; done=true; clearTimeout(timer); try{frame.remove();}catch(_e){} resolve(result); }
      frame.addEventListener('load',function(){
        try{
          var doc=frame.contentDocument;
          var body=doc&&doc.body;
          var textLen=body?(body.innerText||'').trim().length:0;
          var scripts=doc?doc.scripts.length:0;
          var cards=doc?doc.querySelectorAll('[data-slot],[data-card-id],[data-id],.product-card,.media-card,.item-card,.feed-card,.card').length:0;
          var links=doc?Array.prototype.filter.call(doc.querySelectorAll('a[href]'),function(a){var h=(a.getAttribute('href')||'').trim(); return /^https?:\/\//i.test(h);}).length:0;
          finish({label:label,url:url,status:(textLen>20?'ok':'warn'),textLength:textLen,scriptCount:scripts,cardHint:cards,externalLinkHint:links});
        }catch(e){ finish({label:label,url:url,status:'fail',error:String(e&&e.message||e)}); }
      });
      timer=setTimeout(function(){ finish({label:label,url:url,status:'warn',error:'load-timeout'}); },9000);
      document.body.appendChild(frame);
      frame.src=url+(url.indexOf('?')>=0?'&':'?')+'igdc_readonly_audit=1&ts='+Date.now();
    });
  }
  async function runPageObservation(){
    var btn=$('runPageObserveBtn'); if(btn) btn.disabled=true;
    setStatus('읽기 전용으로 대표 페이지의 로드 상태를 관찰 중입니다. 카드·외부 링크는 클릭하지 않습니다…','info');
    try{
      var values=await Promise.all(publicTargets().map(function(x){ return observePage(x[0],x[1]); }));
      var rows=values.map(function(r){ return '<div class="page-row"><strong class="'+statusClass(r.status)+'">'+esc(r.status)+'</strong> · '+esc(r.label)+'<br><span class="small">'+esc(r.url)+' · 본문 '+esc(r.textLength||0)+'자 · 스크립트 '+esc(r.scriptCount||0)+'개 · 카드 감지 '+esc(r.cardHint||0)+' · 외부 링크 감지 '+esc(r.externalLinkHint||0)+(r.error?' · '+esc(r.error):'')+'</span></div>'; }).join('');
      $('pagePanel').classList.remove('hidden');
      $('pagePanel').innerHTML='<h2>대표 페이지 로드 관찰</h2><div class="small">이 값은 실제 카드 클릭 검증이 아니라 같은 도메인에서 페이지가 열리고 기본 DOM이 생성되는지의 읽기 전용 관찰값입니다.</div><div class="page-checks">'+rows+'</div>';
      setStatus('대표 페이지 로드 관찰 완료','ok');
    }catch(err){ setStatus('페이지 관찰 실패: '+String(err&&err.message||err),'fail'); }
    finally{ if(btn) btn.disabled=false; }
  }
  function htmlSummary(){
    var raw=$('rawOutput').textContent||'';
    return '<!doctype html><meta charset="utf-8"><title>IGDC 실상품 공급 개방 점검</title><pre>'+esc(raw)+'</pre>';
  }
  function returnToAdmin(){
    var q=new URLSearchParams(location.search); var back=q.get('returnPath');
    location.href=back&&back.charAt(0)==='/'?back:'/admin.html';
  }
  function init(){
    var q=new URLSearchParams(location.search); var saved=localStorage.getItem('igdc_product_go_live_audit_mode');
    var requested=q.get('mode'); if($('auditMode')) $('auditMode').value=(requested==='production'||saved==='production')?'production':'pre-product';
    $('auditMode').addEventListener('change',function(){ localStorage.setItem('igdc_product_go_live_audit_mode',mode()); });
    $('runAuditBtn').addEventListener('click',runAudit); $('runPageObserveBtn').addEventListener('click',runPageObservation);
    $('downloadJsonBtn').addEventListener('click',function(){ if(lastReport) download('IGDC_PRODUCT_GO_LIVE_AUDIT_'+nowStamp()+'.json',JSON.stringify(lastReport,null,2),'application/json'); });
    $('downloadHtmlBtn').addEventListener('click',function(){ if(lastReport) download('IGDC_PRODUCT_GO_LIVE_AUDIT_'+nowStamp()+'.html',htmlSummary(),'text/html;charset=utf-8'); });
    $('returnBtn').addEventListener('click',returnToAdmin);
    runAudit();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
