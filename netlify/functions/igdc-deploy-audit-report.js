'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function s(v){ return String(v == null ? '' : v); }
function low(v){ return s(v).trim().toLowerCase(); }
function nowIso(){ return new Date().toISOString(); }
function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
function asArray(v){ return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function safeJsonParse(text){ try { return { ok:true, value: JSON.parse(text) }; } catch(e){ return { ok:false, error:String(e && e.message || e) }; } }
function hashText(text){ return crypto.createHash('sha1').update(s(text)).digest('hex').slice(0, 16); }
function readText(file){ try { return { ok:true, text: fs.readFileSync(file, 'utf8') }; } catch(e){ return { ok:false, error:String(e && e.message || e) }; } }
function statFile(file){ try { const st = fs.statSync(file); return { exists:true, size:st.size, mtime:st.mtime.toISOString(), isFile:st.isFile(), isDirectory:st.isDirectory() }; } catch(e){ return { exists:false }; } }
function walk(dir, opts, out){
  opts = opts || {}; out = out || [];
  const maxFiles = opts.maxFiles || 2000;
  const ignore = opts.ignore || /(^|\/)(node_modules|\.git|\.netlify|dist|build|coverage)(\/|$)/;
  if(out.length >= maxFiles) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch(e){ return out; }
  for(const ent of entries){
    const p = path.join(dir, ent.name);
    const relNorm = p.replace(/\\/g,'/');
    if(ignore.test(relNorm)) continue;
    if(ent.isDirectory()) walk(p, opts, out);
    else { out.push(p); if(out.length >= maxFiles) break; }
  }
  return out;
}
function findRoot(){
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '../..'),
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '..')
  ];
  for(const c of candidates){
    if(fs.existsSync(path.join(c, 'netlify')) || fs.existsSync(path.join(c, 'assets')) || fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return process.cwd();
}
function rel(root, p){ return path.relative(root, p).replace(/\\/g, '/'); }
function existsRel(root, p){ return statFile(path.join(root, p)); }
function readJsonRel(root, p){
  const f = path.join(root, p);
  const r = readText(f);
  if(!r.ok) return { exists:false, ok:false, error:r.error };
  const parsed = safeJsonParse(r.text);
  if(!parsed.ok) return { exists:true, ok:false, error:parsed.error, size:Buffer.byteLength(r.text), hash:hashText(r.text) };
  return { exists:true, ok:true, value:parsed.value, size:Buffer.byteLength(r.text), hash:hashText(r.text) };
}
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
function itemText(item){
  if(!isObj(item)) return s(item);
  return [item.title, item.name, item.summary, item.description, item.snippet, item.url, item.link, asArray(item.tags).join(' '), item.section, item.category].map(s).join(' ');
}
function field(item, names){
  for(const n of names){
    if(isObj(item) && item[n] != null && s(item[n]).trim()) return item[n];
  }
  return '';
}
function snapshotStats(json){
  const items = extractItems(json);
  const stats = {
    totalItems: items.length,
    missingTitle:0,
    missingSummary:0,
    missingImage:0,
    emptyOrHashUrl:0,
    exampleUrl:0,
    placeholderLikeCount:0,
    monetizationCount:0,
    revenueDestinationCount:0,
    sectionCounts:{},
    categoryCounts:{},
    topSections:[],
    topCategories:[]
  };
  for(const it of items){
    const title = field(it, ['title','name','label']);
    const summary = field(it, ['summary','description','snippet','excerpt','body']);
    const image = field(it, ['image','thumb','thumbnail','imageUrl','poster','ogImage']);
    const url = low(field(it, ['url','link','href','targetUrl']));
    if(!title) stats.missingTitle++;
    if(!summary) stats.missingSummary++;
    if(!image) stats.missingImage++;
    if(!url || url === '#' || url.startsWith('#') || url === 'javascript:void(0)') stats.emptyOrHashUrl++;
    if(url.includes('example.com')) stats.exampleUrl++;
    const text = low(itemText(it));
    if(text.includes('placeholder') || text.includes('sample/') || text.includes('sample ') || text.includes('dummy') || text.includes('lorem') || url.includes('example.com') || (!summary && (!url || url === '#'))) stats.placeholderLikeCount++;
    if(isObj(it) && it.monetization) stats.monetizationCount++;
    if(isObj(it) && it.revenueDestination) stats.revenueDestinationCount++;
    const sec = s(field(it, ['section','bind_section','slot','pageSection']) || 'unknown').trim() || 'unknown';
    const cat = s(field(it, ['category','group','type','vertical']) || 'unknown').trim() || 'unknown';
    stats.sectionCounts[sec] = (stats.sectionCounts[sec] || 0) + 1;
    stats.categoryCounts[cat] = (stats.categoryCounts[cat] || 0) + 1;
  }
  stats.topSections = Object.entries(stats.sectionCounts).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>({ key:k, count:v }));
  stats.topCategories = Object.entries(stats.categoryCounts).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>({ key:k, count:v }));
  return stats;
}
function scanScripts(root){
  const files = walk(root, { maxFiles:3000 }).filter(f => /\.html?$/i.test(f));
  const missing = [];
  const suspicious = [];
  const checked = [];
  const scriptRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for(const file of files){
    const html = readText(file);
    if(!html.ok) continue;
    let m;
    while((m = scriptRe.exec(html.text))){
      const src = m[1];
      if(/api\.netlify\.com/i.test(src)) suspicious.push({ html:rel(root,file), src });
      if(/^https?:\/\//i.test(src) || /^\/\//.test(src) || /^data:/.test(src)) continue;
      const clean = src.split('?')[0].split('#')[0];
      if(!clean || clean.startsWith('mailto:')) continue;
      const target = clean.startsWith('/') ? path.join(root, clean.replace(/^\/+/, '')) : path.join(path.dirname(file), clean);
      checked.push({ html:rel(root,file), src });
      if(!fs.existsSync(target)) missing.push({ html:rel(root,file), src, expected:rel(root,target) });
    }
  }
  return { htmlFiles:files.length, checkedScriptRefs:checked.length, missingScriptRefs:missing, suspiciousApiNetlifyScripts:suspicious };
}
function scanDataPsom(root){
  const files = walk(root, { maxFiles:3000 }).filter(f => /\.html?$/i.test(f));
  let total = 0;
  const byPage = [];
  const re = /data-psom-key=["']([^"']+)["']/gi;
  for(const f of files){
    const r = readText(f); if(!r.ok) continue;
    let n = 0, m;
    while((m = re.exec(r.text))) n++;
    if(n){ total += n; byPage.push({ page:rel(root,f), count:n }); }
  }
  byPage.sort((a,b)=>b.count-a.count);
  return { totalDataPsomKeys:total, pages:byPage.slice(0,50) };
}
function scanFunctionExports(root){
  const fnFiles = [
    'netlify/functions/maru-search.js',
    'netlify/functions/sanmaru_engine_v2.js',
    'netlify/functions/search-bank-engine.js',
    'netlify/functions/search-bank-index-engine.js',
    'netlify/functions/maru-global-insight-engine.js',
    'netlify/functions/core.js',
    'netlify/functions/lib/trustFilter.core.v1.js'
  ];
  const checked = [];
  const missing = [];
  for(const p of fnFiles){
    const f = path.join(root,p);
    const st = statFile(f);
    const rec = { path:p, exists:st.exists, size:st.size || 0, exports:[] };
    if(st.exists){
      const txt = readText(f).text || '';
      if(/exports\.handler|module\.exports\s*=\s*\{[^}]*handler|handler\s*=/.test(txt)) rec.exports.push('handler?');
      if(/exports\.runEngine|runEngine\s*[:=]/.test(txt)) rec.exports.push('runEngine?');
      if(/exports\.queryIndex|queryIndex\s*[:=]/.test(txt)) rec.exports.push('queryIndex?');
      rec.version = ((txt.match(/VERSION\s*=\s*["']([^"']+)/) || [])[1]) || null;
      rec.hash = hashText(txt);
    } else missing.push(p);
    checked.push(rec);
  }
  return { checked, missing };
}
function buildWarnings(report){
  const w = [];
  const snap = report.searchBank && report.searchBank.snapshot;
  if(!snap || !snap.totalItems) w.push('search-bank.snapshot.json item count is zero or unavailable.');
  if(snap && snap.placeholderLikeCount > Math.max(50, snap.totalItems * 0.35)) w.push('Search Bank snapshot has high placeholder-like ratio. This is acceptable before product upload but must be lowered before production content ON.');
  if(report.frontend && report.frontend.missingScriptRefs && report.frontend.missingScriptRefs.length) w.push('Some HTML script references are missing.');
  if(report.frontend && report.frontend.suspiciousApiNetlifyScripts && report.frontend.suspiciousApiNetlifyScripts.length) w.push('Suspicious api.netlify.com script references remain. Remove them before production.');
  if(report.functions && report.functions.missing && report.functions.missing.length) w.push('Some important Netlify function/core files are missing.');
  if(report.productSupply && report.productSupply.enabled) w.push('Product supply gate is ON. Confirm this is intended; current stage is usually OFF before real product upload.');
  return w;
}
function computeSummary(report){
  let score = 100;
  const missingScripts = (report.frontend && report.frontend.missingScriptRefs || []).length;
  const suspicious = (report.frontend && report.frontend.suspiciousApiNetlifyScripts || []).length;
  const missingFn = (report.functions && report.functions.missing || []).length;
  const snap = report.searchBank && report.searchBank.snapshot;
  score -= Math.min(35, missingScripts * 3);
  score -= Math.min(25, suspicious * 5);
  score -= Math.min(30, missingFn * 6);
  if(!snap || !snap.totalItems) score -= 20;
  else if(snap.placeholderLikeCount > snap.totalItems * 0.6) score -= 10;
  score = Math.max(0, Math.min(100, score));
  let level = 'ok';
  if(score < 80) level = 'warn';
  if(score < 55) level = 'fail';
  return { level, score };
}
function audit(){
  const root = findRoot();
  const report = {
    ok:true,
    generatedAt:nowIso(),
    root:root,
    runtime:{ node:process.version, platform:process.platform, cwd:process.cwd() },
    productSupply:{
      enabled:['PRODUCT_SUPPLY_ON','DATA_UPLOAD_ON','FRONT_SLOT_AUTO_FILL','PAYMENT_LIVE'].some(k => ['1','true','yes','on','live'].includes(low(process.env[k]))),
      flags:{
        PRODUCT_SUPPLY_ON: low(process.env.PRODUCT_SUPPLY_ON || 'false'),
        DATA_UPLOAD_ON: low(process.env.DATA_UPLOAD_ON || 'false'),
        FRONT_SLOT_AUTO_FILL: low(process.env.FRONT_SLOT_AUTO_FILL || 'false'),
        PAYMENT_LIVE: low(process.env.PAYMENT_LIVE || 'false')
      }
    },
    files:{},
    functions:{},
    searchBank:{},
    frontend:{},
    trust:{},
    globalInsight:{},
    warnings:[]
  };
  const importantFiles = [
    'index.html','home.html','distributionhub.html','socialnetwork.html','mediahub.html','tour.html','donation.html','networkhub.html','search.html','admin.html',
    'assets/js/search.js','assets/js/igdc-core.min.js','assets/js/member-admin-modal.js','assets/js/maru-global-insight.js','assets/js/maru-search.js','assets/js/maru-searchbank-sync.js',
    'search-bank.snapshot.json','netlify/functions/data/trust.allowlist.json','netlify/functions/data/trust.blocklist.json'
  ];
  report.files.important = importantFiles.map(p => Object.assign({ path:p }, existsRel(root,p)));
  report.functions = scanFunctionExports(root);
  const snap = readJsonRel(root, 'search-bank.snapshot.json');
  report.searchBank.snapshotFile = { exists:snap.exists, ok:snap.ok, size:snap.size, hash:snap.hash, error:snap.error };
  report.searchBank.snapshot = snap.ok ? snapshotStats(snap.value) : null;
  const allow = readJsonRel(root, 'netlify/functions/data/trust.allowlist.json');
  const block = readJsonRel(root, 'netlify/functions/data/trust.blocklist.json');
  report.trust.allowlist = { exists:allow.exists, ok:allow.ok, size:allow.size, hash:allow.hash, entries: allow.ok ? extractItems(allow.value).length || (Array.isArray(allow.value) ? allow.value.length : Object.keys(allow.value || {}).length) : null, error:allow.error };
  report.trust.blocklist = { exists:block.exists, ok:block.ok, size:block.size, hash:block.hash, entries: block.ok ? extractItems(block.value).length || (Array.isArray(block.value) ? block.value.length : Object.keys(block.value || {}).length) : null, error:block.error };
  report.frontend = Object.assign(scanScripts(root), { psom: scanDataPsom(root) });
  report.globalInsight.files = ['netlify/functions/maru-global-insight-engine.js','assets/js/maru-global-insight.js'].map(p => Object.assign({ path:p }, existsRel(root,p)));
  report.warnings = buildWarnings(report);
  report.summary = computeSummary(report);
  return report;
}
exports.handler = async function(event){
  try{
    const report = audit();
    return {
      statusCode: 200,
      headers: {
        'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store, no-cache, must-revalidate'
      },
      body: JSON.stringify(report, null, 2)
    };
  }catch(e){
    return {
      statusCode: 500,
      headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
      body: JSON.stringify({ ok:false, generatedAt:nowIso(), error:String(e && e.stack || e) }, null, 2)
    };
  }
};
