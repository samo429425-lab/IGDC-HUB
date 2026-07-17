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
  function getAdminReturnUrl(){
    try{
      var qs = new URLSearchParams(location.search || '');
      var raw = qs.get('returnPath') || qs.get('returnUrl') || qs.get('adminReturn') || '/admin.html';
      var u = new URL(raw, window.location.origin);
      if (u.origin !== window.location.origin) return '/admin.html';
      return u.pathname + u.search + u.hash;
    }catch(e){
      return '/admin.html';
    }
  }
  function ensureAdminReturnButton(){
    if($('igdcAdminReturnBtn')) return;
    var run = $('runAuditBtn');
    if(!run || !run.parentNode) return;
    var btn = document.createElement('button');
    btn.id = 'igdcAdminReturnBtn';
    btn.type = 'button';
    btn.className = 'secondary';
    btn.textContent = '관리자 화면으로 가기';
    btn.addEventListener('click', function(ev){
      ev.preventDefault();
      window.location.href = getAdminReturnUrl();
      return false;
    });
    var htmlBtn = $('downloadHtmlBtn');
    if(htmlBtn && htmlBtn.parentNode === run.parentNode){
      htmlBtn.insertAdjacentElement('afterend', btn);
    }else{
      run.parentNode.appendChild(btn);
    }
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
    var st = { section:section.section, sources:section.sources, expectedLimit:Number(section.rawMeta && (section.rawMeta.slot_limit || section.rawMeta.limit || section.rawMeta.capacity)) || null, itemCount:items.length, missingTitle:0, missingImage:0, emptyOrHashUrl:0, exampleUrl:0, nonHttpUrl:0, placeholderLikeCount:0, potentialIssueCount:0, slotIssueCount:0, slotIssueList:[], trackingCount:0, monetizationCount:0, priceCount:0, currencyCount:0, sampleIssues:[], status:'ok', note:'' };
    items.forEach(function(it, slotIndex){
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
      if(issues.length){
        st.potentialIssueCount++;
        var issueRec = { slotIndex:slotIndex + 1, slotId:str(field(it,['slotId','slot_id'])).slice(0,80), id:str(field(it,['id','uid','contentId','content_id','productId','product_id'])).slice(0,100), title:str(title).slice(0,160), url:str(url).slice(0,240), issues:issues };
        if(st.sampleIssues.length < 8) st.sampleIssues.push(issueRec);
        if(mode === 'production') st.slotIssueList.push(issueRec);
      }
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
    var slotIssueList = [];
    rows.forEach(function(r){ (r.slotIssueList || []).forEach(function(issue){ var copy = {}; Object.keys(issue).forEach(function(k){ copy[k] = issue[k]; }); copy.page = pageName; copy.section = r.section; slotIssueList.push(copy); }); });
    return { page:pageName, totalSections:rows.length, totalItems:totalItems, statusCounts:counts, slotIssueCount:slotIssueList.length, slotIssueList:slotIssueList, sections:rows, topProblemSections:rows.filter(function(r){ return r.status !== 'ok' || r.sampleIssues.length; }).slice(0,30) };
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
        rec.analysis = analyzeSnapshotJson(json, t.page, mode);
        rec.ok = !!(rec.analysis && Array.isArray(rec.analysis.sections));
        if(!rec.ok) throw new Error('snapshot analysis missing sections');
      }catch(e){ rec.ok = false; rec.error = String(e && e.message || e); }
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

  function slotIssuesHtml(audit){
    if(!audit || !audit.pages) return '';
    var issues = [];
    audit.pages.forEach(function(p){
      var list = p.analysis && p.analysis.slotIssueList || [];
      list.forEach(function(x){ issues.push(x); });
    });
    if(!issues.length) return '<div class="small" style="margin-top:8px">문제 슬롯 전체 목록: 현재 모드에서 별도 출력 대상 없음</div>';
    var shown = issues.slice(0, 500);
    var html = '<h3 style="margin-top:14px">문제 슬롯 전체 목록</h3><div class="small">전체 '+issues.length+'개 중 '+shown.length+'개 표시. JSON 리포트에는 slotIssueList로 저장됩니다.</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px"><thead><tr>'+['페이지','섹션','슬롯','ID/SlotID','제목','문제','URL'].map(function(h){ return '<th style="border:1px solid #ddd;padding:6px;text-align:left">'+escapeHtml(h)+'</th>'; }).join('')+'</tr></thead><tbody>';
    shown.forEach(function(x){
      html += '<tr>'+[
        x.page || '', x.section || '', x.slotIndex || '', (x.id || x.slotId || ''), x.title || '', (x.issues || []).join(', '), x.url || ''
      ].map(function(v){ return '<td style="border:1px solid #ddd;padding:6px;vertical-align:top">'+escapeHtml(v)+'</td>'; }).join('')+'</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function snapshotTablesHtml(audit){
    if(!audit || !audit.pages) return '';
    var html = '<div class="card" style="padding:14px;margin:12px 0;"><h2>프론트 공개 스냅샷 섹션 점검표</h2>';
    html += '<div class="small">/data/*.snapshot.json을 브라우저에서 직접 읽어 페이지·섹션·슬롯 상태를 확인합니다.</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px"><thead><tr>'+['페이지','섹션','상태','슬롯/항목','문제슬롯','잠재이슈','추적ID','이미지누락','URL#','example','placeholder','가격','통화','비고'].map(function(h){ return '<th style="border:1px solid #ddd;padding:6px;text-align:left">'+escapeHtml(h)+'</th>'; }).join('')+'</tr></thead><tbody>';
    audit.pages.forEach(function(p){
      if(!p.ok){ html += '<tr><td style="border:1px solid #ddd;padding:6px">'+escapeHtml(p.page)+'</td><td colspan="11" style="border:1px solid #ddd;padding:6px;color:#b91c1c">'+escapeHtml(p.url+' / '+(p.error||'fetch failed'))+'</td></tr>'; return; }
      if(!p.analysis || !Array.isArray(p.analysis.sections)){ html += '<tr><td style="border:1px solid #ddd;padding:6px">'+escapeHtml(p.page)+'</td><td colspan="13" style="border:1px solid #ddd;padding:6px;color:#b91c1c">'+escapeHtml((p.url || '')+' / snapshot analysis missing sections')+'</td></tr>'; return; }
      (p.analysis.sections || []).forEach(function(r){
        html += '<tr>'+[
          p.page, r.section, String(r.status).toUpperCase(), r.itemCount, r.slotIssueCount || 0, r.potentialIssueCount || 0, r.trackingCount, r.missingImage, r.emptyOrHashUrl, r.exampleUrl, r.placeholderLikeCount, r.priceCount, r.currencyCount, r.note || ''
        ].map(function(v, idx){ var cls = (idx===2 ? statusClass(r.status) : ''); return '<td class="'+cls+'" style="border:1px solid #ddd;padding:6px">'+escapeHtml(v)+'</td>'; }).join('')+'</tr>';
      });
    });
    html += '</tbody></table>' + slotIssuesHtml(audit) + '</div>';
    return html;
  }


  // Runtime probes must mirror the real front routes. They never write data and do not
  // force generic full-search expansion merely to prove that a function is loaded.
  var ENGINE_PROBE_TARGETS = [
    { key:'maru-search', label:'MaruSearch CPU', endpoint:'/.netlify/functions/maru-search', role:'CPU / search dispatcher', critical:true, expectItems:true, params:{ q:'igdc audit', query:'igdc audit', limit:'5', page:'home', section:'home_1', pageWindowOnly:'1', residentFirst:'1', sanmaruFirst:'1', routeOwner:'sanmaru', naturalFlow:'1', smoothIntake:'1', noBlockingWide:'1', noWaitProviders:'1' }, supplyParams:{ q:'igdc audit', query:'igdc audit', limit:'25', page:'home', section:'home_1', action:'front-supply' } },
    { key:'sanmaru', label:'Sanmaru OSAI', endpoint:'/.netlify/functions/sanmaru_engine_v2', role:'global information integrator', critical:true, expectItems:true, pingTimeoutMs:4500, params:{ q:'igdc audit', query:'igdc audit', action:'front-supply', page:'home', section:'home_1', limit:'5' }, supplyParams:{ q:'igdc audit', query:'igdc audit', action:'front-supply', page:'home', section:'home_1', limit:'25' } },
    { key:'search-bank-index', label:'SearchBank Index', endpoint:'/.netlify/functions/search-bank-index-engine', role:'front reservoir/index supplier', critical:true, expectItems:false, params:{ action:'front-supply', page:'home', section:'home_1', limit:'5' }, supplyParams:{ action:'front-supply', page:'home', section:'home_1', limit:'50' } },
    { key:'search-bank-engine', label:'SearchBank Engine', endpoint:'/.netlify/functions/search-bank-engine', role:'snapshot request/router', critical:true, expectItems:true, params:{ list:'1', page:'home', section:'home_1', limit:'5' }, supplyParams:{ list:'1', action:'front-supply', page:'home', section:'home_1', limit:'25' } },
    { key:'maru-search-display', label:'Search Display', endpoint:'/.netlify/functions/maru-search-display-engine', role:'search display bridge', critical:false, expectItems:false, params:{ q:'igdc audit', query:'igdc audit', limit:'5' } },
    { key:'global-insight', label:'Global Insight', endpoint:'/.netlify/functions/maru-global-insight-engine', role:'global insight/right panel', critical:false, expectItems:false, params:{ mode:'global-insight', region:'global', limit:'5' } },
    { key:'collector', label:'Collector', endpoint:'/.netlify/functions/collector', role:'auxiliary data feeder', critical:false, expectItems:false, params:{ audit:'1', probe:'1', dryRun:'1', limit:'1' } },
    { key:'planetary', label:'Planetary', endpoint:'/.netlify/functions/planetary-data-connector', role:'planetary connector', critical:false, expectItems:false, params:{ audit:'1', probe:'1', dryRun:'1', q:'igdc audit', limit:'1' } }
  ];
  function probeUrl(target, phase, params){
    var p = new URLSearchParams();
    p.set('audit','1');
    p.set('probe','1');
    p.set('dryRun','1');
    p.set('noWrite','1');
    p.set('phase', phase || 'light');
    p.set('t', String(Date.now()));
    if(phase === 'ping'){
      p.set('health','1'); p.set('ping','1'); p.set('limit','0');
    }
    Object.keys(params || target.params || {}).forEach(function(k){ p.set(k, params[k]); });
    return target.endpoint + '?' + p.toString();
  }
  function countJsonItems(json){
    try{
      if(Array.isArray(json)) return json.length;
      var paths = ['items','data','results','cards','records','snapshot.items','payload.items','payload.results','output.items','result.items','response.items','front.items'];
      for(var i=0;i<paths.length;i++){
        var v = val(json, paths[i], null);
        if(Array.isArray(v)) return v.length;
      }
      if(isObj(json)){
        var total = val(json, 'totalItems', null) || val(json, 'count', null) || val(json, 'total', null) || val(json, 'meta.total', null);
        if(typeof total === 'number') return total;
      }
    }catch(e){}
    return 0;
  }
  async function fetchWithTimeout(url, ms){
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, ms || 4500);
    try{ return await fetch(url, { cache:'no-store', signal:ctrl.signal, headers:{ 'X-IGDC-Audit-Probe':'1', 'X-IGDC-No-Write':'1' } }); }
    finally{ clearTimeout(timer); }
  }
  async function probePhase(target, phase, params, timeoutMs){
    var started = performance.now();
    var rec = { phase:phase, url:target.endpoint, ok:false, status:0, ms:null, itemCount:0, bytes:0, level:'info', bottleneck:null, error:null, parseError:null, keys:[] };
    try{
      var res = await fetchWithTimeout(probeUrl(target, phase, params), timeoutMs);
      rec.status = res.status;
      rec.ms = Math.round(performance.now() - started);
      var text = await res.text();
      rec.bytes = text.length;
      var json = null;
      try{ json = text ? JSON.parse(text) : null; }catch(e){ rec.parseError = String(e && e.message || e); }
      if(json) {
        rec.itemCount = countJsonItems(json);
        rec.keys = Object.keys(json).slice(0, 14);
        rec.version = json.version || val(json,'meta.version',null) || val(json,'engine.version',null) || null;
        rec.reportedOk = json.ok == null ? null : !!json.ok;
        rec.engineMode = json.mode || val(json,'meta.mode',null) || null;
        rec.probeReady = json.probeReady === true || json.action === 'fast-probe' || val(json,'meta.probeReady',false) === true;
      }
      rec.ok = res.ok && (json ? (json.ok !== false) : true);
      if(!res.ok) { rec.level = res.status >= 500 ? 'fail' : 'warn'; rec.bottleneck = 'HTTP ' + res.status; }
      else if(rec.parseError && text && text.trim().charAt(0) !== '<') { rec.level = 'warn'; rec.bottleneck = 'json-parse-warning'; }
      else if(rec.ms > 5000) { rec.level = 'warn'; rec.bottleneck = 'slow-response'; }
      else { rec.level = 'ok'; rec.bottleneck = 'none'; }
    }catch(e){
      rec.ms = Math.round(performance.now() - started);
      rec.error = String(e && e.name === 'AbortError' ? 'timeout' : (e && e.message || e));
      rec.level = rec.error === 'timeout' ? 'warn' : 'fail';
      rec.bottleneck = rec.error === 'timeout' ? (phase + '-timeout') : 'fetch-error';
    }
    return rec;
  }
  function engineUpgradeHints(target, phases, row){
    var hints = [];
    var ping = phases.ping || {};
    var light = phases.light || {};
    var supply = phases.supply || {};
    if(ping.bottleneck === 'ping-timeout' || ping.error === 'timeout') hints.push('add ultra-fast ?audit=1&probe=1&health=1 branch before heavy search/collection logic');
    if(light.error === 'timeout' || light.bottleneck === 'light-timeout') hints.push('split light query path from full search path and cap internal fan-out for audit/light requests');
    if(supply.error === 'timeout' || supply.bottleneck === 'supply-timeout') hints.push('add front-supply reservoir fallback and page/section prefiltered supply path');
    if((light.status || 0) >= 500 || (supply.status || 0) >= 500) hints.push('inspect server error stack for this engine; add guarded fallback and structured error body');
    if(target.expectItems && light.ok && !light.probeReady && row.lightItems <= 0) hints.push('verify item extraction contract: return items/data/results array for search-bank/front-supply requests');
    if(row.level === 'ok' && !hints.length) hints.push('runtime path is healthy for current probe level');
    if(target.key === 'maru-search') hints.push('MaruSearch CPU should route fast path: query validation → SearchBank/Index first → Sanmaru/global expansion only after first batch');
    if(target.key === 'sanmaru') hints.push('Sanmaru OSAI should keep global web expansion async/non-blocking and return front-supply seed quickly');
    if(target.key === 'search-bank-index') hints.push('Index engine should expose reservoir count and page/section candidate count without scanning full snapshot');
    if(target.key === 'search-bank-engine') hints.push('SearchBank engine should expose exact section routing stats and avoid full JSON scan for every light query');
    if(target.key === 'global-insight') hints.push('Global Insight should return cached regional summary when live aggregation is slow');
    if(target.key === 'planetary') hints.push('Planetary connector should never block critical search; keep it optional with clear 502/fallback state');
    return hints.filter(function(v, i, a){ return a.indexOf(v) === i; });
  }
  function summarizeEngineRow(target, phases){
    var ping = phases.ping || {}, light = phases.light || {}, supply = phases.supply || null;
    var critical = !!target.critical;
    var row = { key:target.key, label:target.label, role:target.role, endpoint:target.endpoint, critical:critical, phases:phases, ok:false, level:'info', bottleneck:'none', diagnosis:'', upgradeHints:[], pingMs:ping.ms, lightMs:light.ms, supplyMs:supply && supply.ms, lightItems:light.itemCount || 0, supplyItems:supply ? (supply.itemCount || 0) : null };
    var httpFail = [ping, light, supply].filter(Boolean).some(function(p){ return (p.status || 0) >= 500 || p.level === 'fail'; });
    var pingTimeout = ping.error === 'timeout' || ping.bottleneck === 'ping-timeout';
    var lightTimeout = light.error === 'timeout' || light.bottleneck === 'light-timeout';
    var supplyTimeout = supply && (supply.error === 'timeout' || supply.bottleneck === 'supply-timeout');
    var noItems = target.expectItems && light.ok && !light.probeReady && (light.itemCount || 0) <= 0;
    if(httpFail){ row.level = critical ? 'fail' : 'warn'; row.bottleneck = 'server-error'; row.diagnosis = 'HTTP 5xx or fetch failure on runtime probe'; }
    else if(pingTimeout){ row.level = 'warn'; row.bottleneck = 'no-fast-ping-or-cold-start'; row.diagnosis = 'ping/health request did not return quickly; engine may be entering heavy path even for audit probe'; }
    else if(lightTimeout){ row.level = critical ? 'warn' : 'warn'; row.bottleneck = 'light-query-timeout'; row.diagnosis = 'light query path is too heavy or waiting on downstream dependency'; }
    else if(supplyTimeout){ row.level = 'warn'; row.bottleneck = 'supply-path-timeout'; row.diagnosis = 'front supply capacity test is slow; use reservoir/cached response before expansion'; }
    else if(noItems){ row.level = 'warn'; row.bottleneck = 'no-items-returned'; row.diagnosis = 'engine responded but did not return items in known contract fields'; }
    else if((light.ms || 0) > 4000 || (supply && (supply.ms || 0) > 5000)){ row.level = 'warn'; row.bottleneck = 'slow-response'; row.diagnosis = 'engine responds but is slower than expected for audit/light mode'; }
    else { row.level = 'ok'; row.bottleneck = 'none'; row.diagnosis = 'engine responded within current probe limits'; }
    row.ok = row.level === 'ok';
    row.upgradeHints = engineUpgradeHints(target, phases, row);
    return row;
  }
  async function probeOneEngineV4(target){
    var phases = {};
    phases.ping = await probePhase(target, 'ping', {}, target.pingTimeoutMs || 2500);
    var pingUsable = phases.ping.ok || phases.ping.status > 0 || phases.ping.error !== 'timeout';
    if(pingUsable){
      phases.light = await probePhase(target, 'light', target.params || {}, target.lightTimeoutMs || 5000);
      if(target.critical && phases.light.ok && phases.light.ms < 4500){
        phases.supply = await probePhase(target, 'supply', target.supplyParams || target.params || {}, target.supplyTimeoutMs || 7000);
      }
    } else {
      phases.light = { phase:'light', skipped:true, ok:false, level:'info', bottleneck:'skipped-after-ping-timeout', itemCount:0, ms:null };
    }
    return summarizeEngineRow(target, phases);
  }
  function buildPipelineDiagnosis(rows){
    function byKey(k){ return rows.filter(function(r){ return r.key === k; })[0] || {}; }
    var maru = byKey('maru-search'), san = byKey('sanmaru'), idx = byKey('search-bank-index'), bank = byKey('search-bank-engine'), disp = byKey('maru-search-display'), insight = byKey('global-insight'), col = byKey('collector'), planet = byKey('planetary');
    var candidates = [];
    if(maru.level !== 'ok' && idx.level === 'ok') candidates.push('MaruSearch CPU dispatch layer is slower than SearchBank Index; check fan-out/order/fallback in maru-search.');
    if(idx.level !== 'ok' && bank.level !== 'ok') candidates.push('SearchBank reservoir/request layer is bottleneck; add light-index path and avoid full snapshot scans.');
    if(disp.level === 'ok' && maru.level !== 'ok') candidates.push('Display engine is not the main bottleneck; issue is before presentation layer.');
    if(san.level !== 'ok') candidates.push('Sanmaru OSAI global expansion should be made non-blocking for front-supply requests.');
    if(insight.level !== 'ok') candidates.push('Global Insight should use cached regional summary for audit/right-panel requests.');
    if(planet.level !== 'ok') candidates.push('Planetary connector is optional; isolate from critical search path and return fallback status.');
    if(col.level === 'ok' && planet.level !== 'ok') candidates.push('Collector path is healthier than Planetary path; keep planetary auxiliary until stable.');
    if(!candidates.length) candidates.push('No clear runtime bottleneck found under current light probes.');
    return {
      maruSearchCpu: maru.level || 'unknown',
      sanmaruOsai: san.level || 'unknown',
      searchBankIndex: idx.level || 'unknown',
      searchBankEngine: bank.level || 'unknown',
      displayBridge: disp.level || 'unknown',
      globalInsight: insight.level || 'unknown',
      auxiliary: { collector: col.level || 'unknown', planetary: planet.level || 'unknown' },
      bottleneckCandidates:candidates
    };
  }
  async function runEngineProbes(){
    var rows = [];
    for(var i=0;i<ENGINE_PROBE_TARGETS.length;i++) rows.push(await probeOneEngineV4(ENGINE_PROBE_TARGETS[i]));
    var counts = { ok:0, warn:0, fail:0, info:0 };
    rows.forEach(function(r){ counts[r.level] = (counts[r.level] || 0) + 1; });
    var criticalFail = rows.filter(function(r){ return r.critical && r.level === 'fail'; });
    var criticalWarn = rows.filter(function(r){ return r.critical && r.level === 'warn'; });
    var bottleneck = 'none';
    if(criticalFail.length) bottleneck = criticalFail.map(function(r){ return r.key + ':' + r.bottleneck; }).join(', ');
    else if(criticalWarn.length) bottleneck = criticalWarn.map(function(r){ return r.key + ':' + r.bottleneck; }).join(', ');
    else {
      var warn = rows.filter(function(r){ return r.level === 'warn'; });
      if(warn.length) bottleneck = warn.map(function(r){ return r.key + ':' + r.bottleneck; }).join(', ');
    }
    var level = criticalFail.length ? 'fail' : (criticalWarn.length || counts.warn ? 'warn' : 'ok');
    return { source:'browser-engine-diagnostic-v4.1-slot-precision', generatedAt:new Date().toISOString(), total:rows.length, counts:counts, level:level, bottleneck:bottleneck, rows:rows, pipeline:buildPipelineDiagnosis(rows) };
  }
  function applyEngineDiagnosticsToReport(report){
    if(!report || !report.engineRuntime) return report;
    report.summary = report.summary || { level:'info', score:0 };
    var score = Number(report.summary.score == null ? 100 : report.summary.score);
    var engine = report.engineRuntime;
    var criticalFail = (engine.rows || []).filter(function(r){ return r.critical && r.level === 'fail'; }).length;
    var criticalWarn = (engine.rows || []).filter(function(r){ return r.critical && r.level === 'warn'; }).length;
    if(criticalFail) score = Math.min(score, Math.max(45, 75 - criticalFail * 8));
    else if(criticalWarn) score = Math.min(score, Math.max(70, 90 - criticalWarn * 4));
    else if(engine.counts && engine.counts.warn) score = Math.min(score, 94);
    report.summary.score = Math.max(0, Math.min(100, Math.round(score)));
    report.summary.engineRuntimeLevel = engine.level;
    if(report.summary.score < 55) report.summary.level = 'fail';
    else if(report.summary.score < 90 || engine.level !== 'ok') report.summary.level = 'warn';
    else report.summary.level = report.summary.level || 'ok';
    var hints = [];
    (engine.rows || []).forEach(function(r){ (r.upgradeHints || []).forEach(function(h){ if(hints.indexOf(h) < 0) hints.push(h); }); });
    report.engineUpgradeHints = hints.slice(0, 40);
    return report;
  }
  function engineRuntimeHtml(engine){
    if(!engine || !engine.rows) return '<div class="small">엔진 런타임 점검 결과 없음</div>';
    var html = '<div class="audit-engine-runtime"><h2>엔진 정밀 런타임 상태표 v4</h2>'+ 
      '<div class="small">mode: ping → light → supply / bottleneck: '+escapeHtml(engine.bottleneck || 'none')+' / level: <b class="'+statusClass(engine.level)+'">'+escapeHtml(String(engine.level||'info').toUpperCase())+'</b></div>'+
      '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px"><thead><tr>'+['엔진','역할','상태','Ping','Light','Supply','결과수','병목','진단/업그레이드 힌트'].map(function(h){return '<th style="border:1px solid #ddd;padding:6px;text-align:left">'+escapeHtml(h)+'</th>';}).join('')+'</tr></thead><tbody>';
    engine.rows.forEach(function(r){
      var ping = r.phases && r.phases.ping ? ((r.phases.ping.status||'-') + ' / ' + (r.phases.ping.ms==null?'-':r.phases.ping.ms+'ms') + (r.phases.ping.error?' / '+r.phases.ping.error:'')) : '-';
      var light = r.phases && r.phases.light ? ((r.phases.light.skipped?'skipped':(r.phases.light.status||'-')) + ' / ' + (r.phases.light.ms==null?'-':r.phases.light.ms+'ms') + (r.phases.light.error?' / '+r.phases.light.error:'')) : '-';
      var supply = r.phases && r.phases.supply ? ((r.phases.supply.status||'-') + ' / ' + (r.phases.supply.ms==null?'-':r.phases.supply.ms+'ms') + (r.phases.supply.error?' / '+r.phases.supply.error:'')) : '-';
      var items = 'light ' + (r.lightItems || 0) + (r.supplyItems == null ? '' : ' / supply ' + r.supplyItems);
      var hint = (r.diagnosis || '') + (r.upgradeHints && r.upgradeHints.length ? '\n- ' + r.upgradeHints.slice(0,4).join('\n- ') : '');
      html += '<tr>'+[
        r.label || r.key, r.role || '', String(r.level || '').toUpperCase(), ping, light, supply, items, r.bottleneck || '', hint
      ].map(function(v, idx){ return '<td class="'+(idx===2?statusClass(r.level):'')+'" style="border:1px solid #ddd;padding:6px;white-space:pre-wrap">'+escapeHtml(v)+'</td>'; }).join('')+'</tr>';
    });
    html += '</tbody></table>';
    if(engine.pipeline && engine.pipeline.bottleneckCandidates){
      html += '<h3>파이프라인 병목 해석</h3><pre style="background:#f5f5f5;padding:10px;white-space:pre-wrap">'+escapeHtml(engine.pipeline.bottleneckCandidates.join('\n'))+'</pre>';
    }
    html += '</div>';
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
    lines.push('<tr><th>Engine runtime</th><td>'+escapeHtml(val(report,'engineRuntime.counts.ok','-'))+' ok / '+escapeHtml(val(report,'engineRuntime.counts.warn','-'))+' warn / '+escapeHtml(val(report,'engineRuntime.counts.fail','-'))+' fail</td></tr>');
    lines.push('</tbody></table>');
    lines.push('<h2>Engine Runtime Table</h2>');
    lines.push(engineRuntimeHtml(report.engineRuntime));
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
    card('Engine Runtime', val(report,'engineRuntime.level','N/A').toString().toUpperCase(), val(report,'engineRuntime.level','info'), 'ok: ' + val(report,'engineRuntime.counts.ok','-') + ', warn: ' + val(report,'engineRuntime.counts.warn','-') + ', fail: ' + val(report,'engineRuntime.counts.fail','-') + ', bottleneck: ' + val(report,'engineRuntime.bottleneck','-'));
    card('Warnings', String(count(report.warnings)), count(report.warnings) ? 'warn':'ok', 'download JSON and send for full review');
    if($('summary')) $('summary').innerHTML = cards.join('');
    ensureSnapshotDetailsHost().innerHTML = engineRuntimeHtml(report.engineRuntime) + snapshotTablesHtml(report.publicSnapshots);
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
      if($('status')) $('status').textContent = '엔진 런타임 점검 중...';
      data.engineRuntime = await runEngineProbes();
      applyEngineDiagnosticsToReport(data);
      if(data.engineRuntime && data.engineRuntime.level !== 'ok'){ data.warnings = data.warnings || []; data.warnings.push('Engine runtime probe detected: ' + (data.engineRuntime.bottleneck || data.engineRuntime.level)); }
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
    ensureAdminReturnButton();
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
