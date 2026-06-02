(function(){
  'use strict';
  var lastReport = null;
  var $ = function(id){ return document.getElementById(id); };
  function nowStamp(){
    var d = new Date();
    function z(n){ return String(n).padStart(2,'0'); }
    return d.getFullYear() + z(d.getMonth()+1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
  }
  function safeJson(v){ try { return JSON.stringify(v,null,2); } catch(e){ return String(v); } }
  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function download(name, text, type){
    var blob = new Blob([text], { type:type || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function statusClass(level){
    level = String(level || '').toLowerCase();
    if(level === 'ok' || level === 'pass') return 'ok';
    if(level === 'warn' || level === 'warning') return 'warn';
    if(level === 'fail' || level === 'error') return 'fail';
    return 'info';
  }
  function count(arr){ return Array.isArray(arr) ? arr.length : 0; }
  function getMode(){
    try{
      var qs = new URLSearchParams(location.search);
      var q = (qs.get('mode') || qs.get('stage') || '').toLowerCase();
      if(q === 'production' || q === 'prod' || q === 'live') return 'production';
      if(q === 'pre-product' || q === 'pre' || q === 'preproduct') return 'pre-product';
      var sel = $('auditMode');
      if(sel && sel.value) return sel.value;
      return localStorage.getItem('igdc_audit_mode') || 'pre-product';
    }catch(e){ return 'pre-product'; }
  }
  function setMode(mode){
    mode = (mode === 'production') ? 'production' : 'pre-product';
    try{ localStorage.setItem('igdc_audit_mode', mode); }catch(e){}
    var sel = $('auditMode');
    if(sel) sel.value = mode;
    var label = $('auditModeLabel');
    if(label) label.textContent = mode === 'production' ? '실상품 운영 모드' : '실상품 투입 전 모드';
  }
  function ensureModeControls(){
    if($('auditMode')) { setMode(getMode()); return; }
    var run = $('runAuditBtn');
    if(!run || !run.parentNode) return;
    var wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:8px;vertical-align:middle;';
    wrap.innerHTML = '<label for="auditMode" style="font-weight:700">점검모드</label>'+
      '<select id="auditMode" style="padding:6px 8px;border-radius:8px;border:1px solid #ccc">'+
      '<option value="pre-product">실상품 투입 전</option>'+
      '<option value="production">실상품 운영</option>'+
      '</select>'+
      '<span id="auditModeLabel" style="font-size:12px;color:#555"></span>';
    run.parentNode.insertBefore(wrap, run.nextSibling);
    $('auditMode').addEventListener('change', function(){ setMode(this.value); });
    setMode(getMode());
  }
  function addFrontRuntimeChecks(report){
    report = report || {};
    report.frontRuntime = report.frontRuntime || {};
    report.frontRuntime.location = String(location.href);
    report.frontRuntime.userAgent = navigator.userAgent;
    report.frontRuntime.documentReadyState = document.readyState;
    report.frontRuntime.mode = getMode();
    report.frontRuntime.hasSearchInputs = {
      searchInput: !!document.getElementById('searchInput'),
      globalSearchInput: !!document.getElementById('globalSearchInput'),
      homeSearchInput: !!document.getElementById('homeSearchInput')
    };
    report.frontRuntime.globals = {
      IGDC: !!window.IGDC,
      MaruGlobalInsight: !!window.MaruGlobalInsight,
      maruSearch: !!window.maruSearch,
      IGDC_MEMBER_MODAL: !!window.IGDC_MEMBER_MODAL || !!window.IGDCMemberAdminModal
    };
    return report;
  }
  function pct(n){
    n = Number(n || 0);
    if(!isFinite(n)) n = 0;
    return (n * 100).toFixed(1) + '%';
  }
  function val(obj, path, fallback){
    try{
      var cur = obj;
      String(path).split('.').forEach(function(k){ cur = cur && cur[k]; });
      return cur == null ? fallback : cur;
    }catch(e){ return fallback; }
  }
  function buildSummaryHtml(report){
    var score = report && report.summary ? report.summary.score : null;
    var level = report && report.summary ? report.summary.level : 'info';
    var mode = report.mode || val(report,'frontRuntime.mode','pre-product');
    var lines = [];
    lines.push('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>IGDC Audit Summary</title>');
    lines.push('<style>body{font-family:system-ui;margin:24px;line-height:1.55}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}.ok{color:green}.warn{color:#b45309}.fail{color:#b91c1c}pre{background:#f5f5f5;padding:12px;white-space:pre-wrap}</style></head><body>');
    lines.push('<h1>IGDC Deploy Audit Summary</h1>');
    lines.push('<p><b>Mode:</b> '+escapeHtml(mode)+' / <b>Level:</b> <span class="'+statusClass(level)+'">'+String(level).toUpperCase()+'</span> / <b>Score:</b> '+(score == null ? '-' : score)+'</p>');
    lines.push('<p><b>Generated:</b> '+escapeHtml(report.generatedAt || '')+'</p>');
    lines.push('<h2>핵심 요약</h2><table><tbody>');
    lines.push('<tr><th>Search Bank items</th><td>'+escapeHtml(val(report,'searchBank.snapshot.totalItems','-'))+'</td></tr>');
    lines.push('<tr><th>Placeholder-like</th><td>'+escapeHtml(val(report,'searchBank.snapshot.placeholderLikeCount','-'))+' / '+escapeHtml(pct(val(report,'searchBank.snapshot.ratios.placeholder',0)))+'</td></tr>');
    lines.push('<tr><th>Real candidates</th><td>'+escapeHtml(val(report,'searchBank.snapshot.realCandidateCount','-'))+' / '+escapeHtml(pct(val(report,'searchBank.snapshot.ratios.realCandidate',0)))+'</td></tr>');
    lines.push('<tr><th>SearchBank copies same</th><td>'+escapeHtml(String(val(report,'snapshotCopies.searchBankAllSame','-')))+'</td></tr>');
    lines.push('<tr><th>Missing script refs</th><td>'+count(report.frontend && report.frontend.missingScriptRefs)+'</td></tr>');
    lines.push('<tr><th>Suspicious api.netlify scripts</th><td>'+count(report.frontend && report.frontend.suspiciousApiNetlifyScripts)+'</td></tr>');
    lines.push('<tr><th>Function files missing</th><td>'+count(report.functions && report.functions.missing)+'</td></tr>');
    lines.push('<tr><th>Warnings</th><td>'+count(report.warnings)+'</td></tr>');
    lines.push('</tbody></table>');
    lines.push('<h2>Warnings</h2><pre>'+escapeHtml((report.warnings || []).join('\n'))+'</pre>');
    lines.push('<h2>Full JSON</h2><pre>'+escapeHtml(safeJson(report))+'</pre>');
    lines.push('</body></html>');
    return lines.join('\n');
  }
  function render(report){
    lastReport = report;
    if($('rawOutput')) $('rawOutput').textContent = safeJson(report);
    if($('downloadJsonBtn')) $('downloadJsonBtn').disabled = false;
    if($('downloadHtmlBtn')) $('downloadHtmlBtn').disabled = false;
    var cards = [];
    function card(title, value, level, detail){
      cards.push('<div class="card"><h2>'+escapeHtml(title)+'</h2><div class="status '+statusClass(level)+'">'+escapeHtml(value)+'</div><div class="small">'+escapeHtml(detail || '')+'</div></div>');
    }
    var sum = report.summary || {};
    var mode = report.mode || getMode();
    var snap = report.searchBank && report.searchBank.snapshot;
    card('점검 모드', mode === 'production' ? '실상품 운영' : '실상품 투입 전', 'info', mode === 'production' ? 'placeholder / example URL을 엄격 판정' : 'placeholder / 공급 OFF를 준비 상태로 판정');
    card('전체 상태', String(sum.level || 'info').toUpperCase(), sum.level, 'score: ' + (sum.score == null ? '-' : sum.score));
    card('Search Bank Snapshot', snap ? String(snap.totalItems || 0) + ' items' : 'N/A', snap && snap.totalItems ? 'ok':'warn', snap ? ('placeholder: ' + snap.placeholderLikeCount + ' (' + pct(val(snap,'ratios.placeholder',0)) + '), real: ' + snap.realCandidateCount) : 'snapshot unavailable');
    card('Snapshot Copies', val(report,'snapshotCopies.searchBankAllSame',null) === false ? 'HASH DIFF' : 'OK', val(report,'snapshotCopies.searchBankAllSame',null) === false ? 'warn':'ok', 'SearchBank copies: ' + val(report,'snapshotCopies.searchBankOkCount','-'));
    card('Function Files', count(report.functions && report.functions.missing) ? 'MISSING ' + count(report.functions.missing) : 'OK', count(report.functions && report.functions.missing) ? 'fail':'ok', 'checked: ' + count(report.functions && report.functions.checked) + ', core bridge: ' + String(val(report,'functions.coreBridgeExists','-')));
    card('HTML Script Refs', count(report.frontend && report.frontend.missingScriptRefs) ? 'MISSING ' + count(report.frontend.missingScriptRefs) : 'OK', count(report.frontend && report.frontend.missingScriptRefs) ? 'fail':'ok', (val(report,'frontend.fsStaticScanAvailable',false) ? 'fs scan on' : 'serverless fs static scan unavailable') + ', suspicious api.netlify: ' + count(report.frontend && report.frontend.suspiciousApiNetlifyScripts));
    card('Product Supply Gate', report.productSupply ? (report.productSupply.enabled ? 'ON' : 'OFF') : 'N/A', (report.productSupply && report.productSupply.enabled && mode === 'pre-product') ? 'warn':'ok', mode === 'pre-product' ? 'OFF is expected before real product upload' : 'ON is expected in production');
    card('Payment Line', val(report,'productSupply.flags.PAYMENT_LIVE','false'), mode === 'production' && val(report,'productSupply.flags.PAYMENT_LIVE','false') !== 'true' ? 'warn':'info', 'payment config files/readers are included in raw JSON');
    card('Warnings', String(count(report.warnings)), count(report.warnings) ? 'warn':'ok', 'download JSON and send for full review');
    if($('summary')) $('summary').innerHTML = cards.join('');
  }
  async function runAudit(){
    var runBtn = $('runAuditBtn');
    if(runBtn) runBtn.disabled = true;
    if($('status')) $('status').textContent = '진단 실행 중...';
    try{
      var mode = getMode();
      setMode(mode);
      var res = await fetch('/.netlify/functions/igdc-deploy-audit-report?mode=' + encodeURIComponent(mode) + '&t=' + Date.now(), { cache:'no-store' });
      var data = await res.json().catch(async function(){ return { ok:false, error: await res.text() }; });
      data.browserAudit = true;
      data.httpStatus = res.status;
      data = addFrontRuntimeChecks(data);
      render(data);
      if($('status')) $('status').textContent = '진단 완료. JSON 리포트를 다운로드해서 전달하면 전체 분석이 가능합니다.';
    }catch(e){
      var fail = addFrontRuntimeChecks({ ok:false, generatedAt:new Date().toISOString(), summary:{ level:'fail', score:0 }, error:String(e && e.message || e), warnings:['audit function fetch failed'] });
      render(fail);
      if($('status')) $('status').textContent = '진단 실패: ' + String(e && e.message || e);
    }finally{
      if(runBtn) runBtn.disabled = false;
    }
  }
  document.addEventListener('DOMContentLoaded', function(){
    ensureModeControls();
    if($('runAuditBtn')) $('runAuditBtn').addEventListener('click', runAudit);
    if($('downloadJsonBtn')) $('downloadJsonBtn').addEventListener('click', function(){
      if(!lastReport) return;
      download('IGDC_DEPLOY_AUDIT_REPORT_' + (lastReport.mode || getMode()) + '_' + nowStamp() + '.json', safeJson(lastReport), 'application/json;charset=utf-8');
    });
    if($('downloadHtmlBtn')) $('downloadHtmlBtn').addEventListener('click', function(){
      if(!lastReport) return;
      download('IGDC_DEPLOY_AUDIT_SUMMARY_' + (lastReport.mode || getMode()) + '_' + nowStamp() + '.html', buildSummaryHtml(lastReport), 'text/html;charset=utf-8');
    });
  });
})();
