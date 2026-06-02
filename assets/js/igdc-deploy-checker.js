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

  var PUBLIC_SNAPSHOT_TARGETS = [
    { page:'home', url:'/data/front.snapshot.json' },
    { page:'distribution', url:'/data/distribution.snapshot.json' },
    { page:'media', url:'/data/media.snapshot.json' },
    { page:'social', url:'/data/social.snapshot.json' },
    { page:'network', url:'/data/networkhub-snapshot.json' },
    { page:'tour', url:'/data/tour-snapshot.json' },
    { page:'donation', url:'/data/donation.snapshot.json' }
  ];
  function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function asArray(v){ return Array.isArray(v) ? v : (v == null ? [] : [v]); }
  function str(v){ return String(v == null ? '' : v); }
  function low(v){ return str(v).trim().toLowerCase(); }
  function field(item, names){
    for(var i=0;i<names.length;i++){
      var parts = String(names[i]).split('.');
      var v = item;
      for(var j=0;j<parts.length;j++){ if(isObj(v)) v = v[parts[j]]; else { v = undefined; break; } }
      if(v != null && str(v).trim()) return v;
    }
    return '';
  }
  function itemText(item){
    if(!isObj(item)) return str(item);
    return [item.title,item.name,item.summary,item.description,item.snippet,item.url,item.link,asArray(item.tags).join(' '),item.section,item.category,field(item,['bind.section','psom_key'])].map(str).join(' ');
  }
  function itemUrl(it){ return low(field(it, ['url','link','href','targetUrl','video','videoUrl','outbound.url'])); }
  function itemImage(it){ return field(it, ['image','thumb','thumbnail','imageUrl','poster','ogImage']); }
  function itemTrack(it){ return field(it, ['trackId','track_id','slotId','slot_id','contentId','content_id','productId','product_id','snapshotRecordId']); }
  function extractItems(json){
    if(Array.isArray(json)) return json;
    if(isObj(json)){
      if(Array.isArray(json.items)) return json.items;
      if(Array.isArray(json.data)) return json.data;
      if(isObj(json.snapshot) && Array.isArray(json.snapshot.items)) return json.snapshot.items;
      if(isObj(json.payload) && Array.isArray(json.payload.items)) return json.payload.items;
    }
    return [];
  }
  function sectionOf(it){ return str(field(it, ['section','bind.section','bind_section','psom_key','slot','pageSection']) || 'unknown').trim() || 'unknown'; }
  function isPlaceholderLike(it){
    var url = itemUrl(it);
    var text = low(itemText(it));
    return !!(text.indexOf('placeholder') >= 0 || text.indexOf('sample/') >= 0 || text.indexOf('sample ') >= 0 || text.indexOf('dummy') >= 0 || text.indexOf('lorem') >= 0 || url.indexOf('example.com') >= 0 || url === '#' || url.indexOf('#') === 0 || (!field(it,['summary','description','snippet']) && (!url || url === '#')));
  }
  function extractSectionItems(v){
    if(Array.isArray(v)) return v;
    if(isObj(v)){
      if(Array.isArray(v.slots)) return v.slots;
      if(Array.isArray(v.items)) return v.items;
      if(Array.isArray(v.data)) return v.data;
      var flat = [];
      Object.keys(v).forEach(function(k){ if(Array.isArray(v[k])) flat = flat.concat(v[k]); });
      return flat;
    }
    return [];
  }
  function mergeSection(map, key, source, items, raw){
    key = str(key || 'unknown') || 'unknown';
    if(!map[key]) map[key] = { section:key, sources:[], items:[], rawMeta:{} };
    if(source && map[key].sources.indexOf(source) < 0) map[key].sources.push(source);
    if(items && items.length) map[key].items = map[key].items.concat(items);
    if(isObj(raw)){
      ['slot_limit','limit','capacity','title','key','psom_key'].forEach(function(k){ if(raw[k] != null && map[key].rawMeta[k] == null) map[key].rawMeta[k] = raw[k]; });
    }
  }
  function collectSnapshotSections(json, pageName){
    var out = {};
    function addMap(map, source){
      if(!isObj(map)) return;
      Object.keys(map).forEach(function(k){ mergeSection(out, k, source, extractSectionItems(map[k]), map[k]); });
    }
    if(isObj(json) && isObj(json.pages) && isObj(json.pages[pageName]) && isObj(json.pages[pageName].sections)) addMap(json.pages[pageName].sections, 'pages.' + pageName + '.sections');
    if(isObj(json) && isObj(json.sections)) addMap(json.sections, 'sections');
    var items = extractItems(json);
    if(items.length){ items.forEach(function(it){ mergeSection(out, sectionOf(it), 'items', [it], null); }); }
    return Object.keys(out).sort().map(function(k){ return out[k]; });
  }
  function sectionStats(section, mode){
    var items = section.items || [];
    var st = { section:section.section, sources:section.sources, expectedLimit:Number(section.rawMeta && (section.rawMeta.slot_limit || section.rawMeta.limit || section.rawMeta.capacity)) || null, itemCount:items.length, missingTitle:0, missingImage:0, emptyOrHashUrl:0, exampleUrl:0, nonHttpUrl:0, placeholderLikeCount:0, trackingCount:0, monetizationCount:0, priceCount:0, currencyCount:0, sampleIssues:[], status:'ok', note:'' };
    items.forEach(function(it){
      var title = field(it, ['title','name','label']);
      var url = itemUrl(it);
      var img = itemImage(it);
      var issues = [];
      if(!title){ st.missingTitle++; issues.push('missing-title'); }
      if(!img){ st.missingImage++; issues.push('missing-image'); }
      if(!url || url === '#' || url.indexOf('#') === 0 || url === 'javascript:void(0)'){ st.emptyOrHashUrl++; issues.push('empty-or-hash-url'); }
      if(url && url.indexOf('http') !== 0 && url.indexOf('/') !== 0){ st.nonHttpUrl++; issues.push('non-http-url'); }
      if(url.indexOf('example.com') >= 0){ st.exampleUrl++; issues.push('example-url'); }
      if(isPlaceholderLike(it)){ st.placeholderLikeCount++; issues.push('placeholder-like'); }
      if(itemTrack(it)) st.trackingCount++;
      if(isObj(it) && (it.monetization || it.linkRevenue || it.revenue || it.directSale || it.payment || it.mediaRevenue || it.donation)) st.monetizationCount++;
      if(field(it, ['price','amount','directSale.price','commerce.price','payment.price','donation.amount'])) st.priceCount++;
      if(field(it, ['currency','directSale.currency','commerce.currency','payment.currency','donation.currency'])) st.currencyCount++;
      if(issues.length && st.sampleIssues.length < 8) st.sampleIssues.push({ id:str(field(it,['id','uid','contentId','slotId'])).slice(0,80), title:str(title).slice(0,120), url:str(url).slice(0,180), issues:issues });
    });
    if(!st.itemCount){ st.status = 'warn'; st.note = 'empty section'; }
    else if(mode === 'production' && (st.emptyOrHashUrl || st.exampleUrl || st.missingTitle)){ st.status = 'fail'; st.note = 'production-blocking item issues'; }
    else if(mode === 'production' && st.placeholderLikeCount > Math.max(2, st.itemCount * 0.15)){ st.status = 'warn'; st.note = 'production placeholder ratio high'; }
    else if(mode !== 'production' && (st.emptyOrHashUrl || st.exampleUrl || st.placeholderLikeCount)){ st.status = 'ok'; st.note = 'pre-product seed/placeholder accepted'; }
    return st;
  }
  function analyzeSnapshotJson(json, pageName, mode){
    var rows = collectSnapshotSections(json, pageName).map(function(sec){ return sectionStats(sec, mode); });
    var counts = { ok:0, warn:0, fail:0 };
    var totalItems = 0;
    rows.forEach(function(r){ counts[r.status] = (counts[r.status] || 0) + 1; totalItems += r.itemCount; });
    return { page:pageName, totalSections:rows.length, totalItems:totalItems, statusCounts:counts, sections:rows, topProblemSections:rows.filter(function(r){ return r.status !== 'ok' || r.sampleIssues.length; }).slice(0,30) };
  }
  async function fetchPublicSnapshots(mode){
    var pages = [];
    for(var i=0;i<PUBLIC_SNAPSHOT_TARGETS.length;i++){
      var t = PUBLIC_SNAPSHOT_TARGETS[i];
      var rec = { page:t.page, url:t.url, exists:false, ok:false, status:0, error:null };
      try{
        var res = await fetch(t.url + '?audit=' + Date.now(), { cache:'no-store' });
        rec.status = res.status;
        rec.exists = res.ok;
        if(!res.ok) throw new Error('HTTP ' + res.status);
        var json = await res.json();
        rec.ok = true;
        rec.analysis = analyzeSnapshotJson(json, t.page, mode);
      }catch(e){ rec.error = String(e && e.message || e); }
      pages.push(rec);
    }
    return { source:'public-http', totalPages:pages.length, okPages:pages.filter(function(p){ return p.ok; }).length, totalSections:pages.reduce(function(a,p){ return a + (p.analysis ? p.analysis.totalSections : 0); },0), totalItems:pages.reduce(function(a,p){ return a + (p.analysis ? p.analysis.totalItems : 0); },0), pages:pages };
  }
  function ensureSnapshotDetailsHost(){
    var host = $('snapshotAuditDetails');
    if(host) return host;
    host = document.createElement('div');
    host.id = 'snapshotAuditDetails';
    host.style.cssText = 'margin-top:16px;';
    var raw = $('rawOutput');
    if(raw && raw.parentNode) raw.parentNode.insertBefore(host, raw);
    else document.body.appendChild(host);
    return host;
  }
  function snapshotTablesHtml(audit){
    if(!audit || !audit.pages) return '';
    var html = '<div class="card" style="padding:14px;margin:12px 0;"><h2>프론트 공개 스냅샷 섹션 점검표</h2>';
    html += '<div class="small">/data/*.snapshot.json을 브라우저에서 직접 읽어 페이지·섹션·슬롯 상태를 확인합니다.</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px"><thead><tr>'+['페이지','섹션','상태','슬롯/항목','추적ID','이미지누락','URL#','example','placeholder','가격','통화','비고'].map(function(h){ return '<th style="border:1px solid #ddd;padding:6px;text-align:left">'+escapeHtml(h)+'</th>'; }).join('')+'</tr></thead><tbody>';
    audit.pages.forEach(function(p){
      if(!p.ok){ html += '<tr><td style="border:1px solid #ddd;padding:6px">'+escapeHtml(p.page)+'</td><td colspan="11" style="border:1px solid #ddd;padding:6px;color:#b91c1c">'+escapeHtml(p.url+' / '+(p.error||'fetch failed'))+'</td></tr>'; return; }
      (p.analysis.sections || []).forEach(function(r){
        html += '<tr>'+[
          p.page, r.section, String(r.status).toUpperCase(), r.itemCount, r.trackingCount, r.missingImage, r.emptyOrHashUrl, r.exampleUrl, r.placeholderLikeCount, r.priceCount, r.currencyCount, r.note || ''
        ].map(function(v, idx){ var cls = (idx===2 ? statusClass(r.status) : ''); return '<td class="'+cls+'" style="border:1px solid #ddd;padding:6px">'+escapeHtml(v)+'</td>'; }).join('')+'</tr>';
      });
    });
    html += '</tbody></table></div>';
    return html;
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
    lines.push('<tr><th>Public snapshot pages</th><td>'+escapeHtml(val(report,'publicSnapshots.okPages','-'))+' / '+escapeHtml(val(report,'publicSnapshots.totalPages','-'))+'</td></tr>');
    lines.push('<tr><th>Public snapshot sections</th><td>'+escapeHtml(val(report,'publicSnapshots.totalSections','-'))+' sections / '+escapeHtml(val(report,'publicSnapshots.totalItems','-'))+' items</td></tr>');
    lines.push('</tbody></table>');
    lines.push('<h2>Public Snapshot Section Table</h2>');
    lines.push(snapshotTablesHtml(report.publicSnapshots));
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
    card('Public Snapshots', String(val(report,'publicSnapshots.okPages','-')) + '/' + String(val(report,'publicSnapshots.totalPages','-')) + ' pages', val(report,'publicSnapshots.okPages',0) === val(report,'publicSnapshots.totalPages',-1) ? 'ok':'warn', String(val(report,'publicSnapshots.totalSections','-')) + ' sections / ' + String(val(report,'publicSnapshots.totalItems','-')) + ' items');
    card('Warnings', String(count(report.warnings)), count(report.warnings) ? 'warn':'ok', 'download JSON and send for full review');
    if($('summary')) $('summary').innerHTML = cards.join('');
    ensureSnapshotDetailsHost().innerHTML = snapshotTablesHtml(report.publicSnapshots);
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
      data.publicSnapshots = await fetchPublicSnapshots(mode);
      if(data.publicSnapshots && data.publicSnapshots.okPages < data.publicSnapshots.totalPages){
        data.warnings = data.warnings || [];
        data.warnings.push('Some public /data/*.snapshot.json files are missing or invalid.');
      }
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
