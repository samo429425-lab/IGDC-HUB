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
  function addFrontRuntimeChecks(report){
    report = report || {};
    report.frontRuntime = report.frontRuntime || {};
    report.frontRuntime.location = String(location.href);
    report.frontRuntime.userAgent = navigator.userAgent;
    report.frontRuntime.documentReadyState = document.readyState;
    report.frontRuntime.hasSearchInputs = {
      searchInput: !!document.getElementById('searchInput'),
      globalSearchInput: !!document.getElementById('globalSearchInput'),
      homeSearchInput: !!document.getElementById('homeSearchInput')
    };
    report.frontRuntime.globals = {
      IGDC: !!window.IGDC,
      MaruGlobalInsight: !!window.MaruGlobalInsight,
      maruSearch: !!window.maruSearch,
      IGDC_MEMBER_MODAL: !!window.IGDC_MEMBER_MODAL
    };
    return report;
  }
  function buildSummaryHtml(report){
    var lines = [];
    var score = report && report.summary ? report.summary.score : null;
    var level = report && report.summary ? report.summary.level : 'info';
    lines.push('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>IGDC Audit Summary</title>');
    lines.push('<style>body{font-family:system-ui;margin:24px;line-height:1.55}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}.ok{color:green}.warn{color:#b45309}.fail{color:#b91c1c}pre{background:#f5f5f5;padding:12px;white-space:pre-wrap}</style></head><body>');
    lines.push('<h1>IGDC Deploy Audit Summary</h1>');
    lines.push('<p><b>Level:</b> <span class="'+statusClass(level)+'">'+String(level).toUpperCase()+'</span> / <b>Score:</b> '+(score == null ? '-' : score)+'</p>');
    lines.push('<p><b>Generated:</b> '+String(report.generatedAt || '')+'</p>');
    lines.push('<h2>핵심 요약</h2><table><tbody>');
    lines.push('<tr><th>Search Bank items</th><td>'+(report.searchBank && report.searchBank.snapshot ? report.searchBank.snapshot.totalItems : '-')+'</td></tr>');
    lines.push('<tr><th>Placeholder-like</th><td>'+(report.searchBank && report.searchBank.snapshot ? report.searchBank.snapshot.placeholderLikeCount : '-')+'</td></tr>');
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
  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function render(report){
    lastReport = report;
    $('rawOutput').textContent = safeJson(report);
    $('downloadJsonBtn').disabled = false;
    $('downloadHtmlBtn').disabled = false;
    var cards = [];
    function card(title, value, level, detail){
      cards.push('<div class="card"><h2>'+escapeHtml(title)+'</h2><div class="status '+statusClass(level)+'">'+escapeHtml(value)+'</div><div class="small">'+escapeHtml(detail || '')+'</div></div>');
    }
    var sum = report.summary || {};
    card('전체 상태', String(sum.level || 'info').toUpperCase(), sum.level, 'score: ' + (sum.score == null ? '-' : sum.score));
    card('Search Bank Snapshot', report.searchBank && report.searchBank.snapshot ? String(report.searchBank.snapshot.totalItems || 0) + ' items' : 'N/A', report.searchBank && report.searchBank.snapshot && report.searchBank.snapshot.totalItems ? 'ok':'warn', 'placeholder-like: ' + (report.searchBank && report.searchBank.snapshot ? report.searchBank.snapshot.placeholderLikeCount : '-'));
    card('Function Files', count(report.functions && report.functions.missing) ? 'MISSING ' + count(report.functions.missing) : 'OK', count(report.functions && report.functions.missing) ? 'fail':'ok', 'checked: ' + count(report.functions && report.functions.checked));
    card('HTML Script Refs', count(report.frontend && report.frontend.missingScriptRefs) ? 'MISSING ' + count(report.frontend.missingScriptRefs) : 'OK', count(report.frontend && report.frontend.missingScriptRefs) ? 'fail':'ok', 'suspicious api.netlify: ' + count(report.frontend && report.frontend.suspiciousApiNetlifyScripts));
    card('Product Supply Gate', report.productSupply ? (report.productSupply.enabled ? 'ON' : 'OFF') : 'N/A', report.productSupply && report.productSupply.enabled ? 'warn':'ok', 'OFF is expected before real product upload');
    card('Warnings', String(count(report.warnings)), count(report.warnings) ? 'warn':'ok', 'download JSON and send to ChatGPT for full review');
    $('summary').innerHTML = cards.join('');
  }
  async function runAudit(){
    $('runAuditBtn').disabled = true;
    $('status').textContent = '진단 실행 중...';
    try{
      var res = await fetch('/.netlify/functions/igdc-deploy-audit-report?mode=full&t=' + Date.now(), { cache:'no-store' });
      var data = await res.json().catch(async function(){ return { ok:false, error: await res.text() }; });
      data.browserAudit = true;
      data.httpStatus = res.status;
      data = addFrontRuntimeChecks(data);
      render(data);
      $('status').textContent = '진단 완료. JSON 리포트를 다운로드해서 전달하면 전체 분석이 가능합니다.';
    }catch(e){
      var fail = addFrontRuntimeChecks({ ok:false, generatedAt:new Date().toISOString(), summary:{ level:'fail', score:0 }, error:String(e && e.message || e), warnings:['audit function fetch failed'] });
      render(fail);
      $('status').textContent = '진단 실패: ' + String(e && e.message || e);
    }finally{
      $('runAuditBtn').disabled = false;
    }
  }
  document.addEventListener('DOMContentLoaded', function(){
    $('runAuditBtn').addEventListener('click', runAudit);
    $('downloadJsonBtn').addEventListener('click', function(){
      if(!lastReport) return;
      download('IGDC_DEPLOY_AUDIT_REPORT_' + nowStamp() + '.json', safeJson(lastReport), 'application/json;charset=utf-8');
    });
    $('downloadHtmlBtn').addEventListener('click', function(){
      if(!lastReport) return;
      download('IGDC_DEPLOY_AUDIT_SUMMARY_' + nowStamp() + '.html', buildSummaryHtml(lastReport), 'text/html;charset=utf-8');
    });
  });
})();
