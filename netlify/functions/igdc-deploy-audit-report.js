'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function s(v){ return String(v == null ? '' : v); }
function low(v){ return s(v).trim().toLowerCase(); }
function nowIso(){ return new Date().toISOString(); }
function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
function asArray(v){ return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function truthy(v){ return ['1','true','yes','on','live','enabled'].includes(low(v)); }
function safeJsonParse(text){ try { return { ok:true, value: JSON.parse(text) }; } catch(e){ return { ok:false, error:String(e && e.message || e) }; } }
function hashText(text){ return crypto.createHash('sha1').update(s(text)).digest('hex').slice(0, 16); }
function readText(file){ try { return { ok:true, text: fs.readFileSync(file, 'utf8') }; } catch(e){ return { ok:false, error:String(e && e.message || e) }; } }
function statFile(file){ try { const st = fs.statSync(file); return { exists:true, size:st.size, mtime:st.mtime.toISOString(), isFile:st.isFile(), isDirectory:st.isDirectory() }; } catch(e){ return { exists:false }; } }
function rel(root, p){ return path.relative(root, p).replace(/\\/g, '/'); }
function existsRel(root, p){ return statFile(path.join(root, p)); }
function normRel(p){ return String(p || '').replace(/\\/g, '/').replace(/^\/+/, ''); }

function walk(dir, opts, out){
  opts = opts || {}; out = out || [];
  const maxFiles = opts.maxFiles || 5000;
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

function rootScore(c){
  let score = 0;
  if(fs.existsSync(path.join(c, 'netlify/functions'))) score += 25;
  if(fs.existsSync(path.join(c, 'data/search-bank.snapshot.json'))) score += 25;
  if(fs.existsSync(path.join(c, 'netlify/functions/data/search-bank.snapshot.json'))) score += 20;
  if(fs.existsSync(path.join(c, 'assets/js'))) score += 15;
  if(fs.existsSync(path.join(c, 'index.html'))) score += 15;
  return score;
}
function findRoot(){
  const envCandidates = [process.env.IGDC_ROOT, process.env.NETLIFY_PUBLISH_DIR, process.env.PWD].filter(Boolean);
  const candidates = [
    ...envCandidates,
    process.cwd(),
    path.resolve(__dirname || process.cwd(), '../..'),
    path.resolve(__dirname || process.cwd(), '../../..'),
    path.resolve(__dirname || process.cwd(), '..'),
    '/var/task'
  ];
  let best = process.cwd(), bestScore = -1;
  const seen = new Set();
  for(const raw of candidates){
    const c = path.resolve(raw);
    if(seen.has(c)) continue;
    seen.add(c);
    const score = rootScore(c);
    if(score > bestScore){ best = c; bestScore = score; }
  }
  return best;
}
function readJsonAbs(file){
  const r = readText(file);
  if(!r.ok) return { exists:false, ok:false, path:file, error:r.error };
  const parsed = safeJsonParse(r.text);
  const base = { exists:true, path:file, size:Buffer.byteLength(r.text), hash:hashText(r.text) };
  if(!parsed.ok) return Object.assign(base, { ok:false, error:parsed.error });
  return Object.assign(base, { ok:true, value:parsed.value });
}
function readJsonRel(root, p){ return readJsonAbs(path.join(root, p)); }
function firstJson(root, candidates){
  const tried = candidates.map(p => {
    const r = readJsonRel(root, p);
    return { path:p, exists:r.exists, ok:r.ok, size:r.size, hash:r.hash, error:r.error };
  });
  const hit = tried.find(x => x.ok);
  return { hit, tried, result: hit ? readJsonRel(root, hit.path) : { exists:false, ok:false, error:'no valid JSON candidate' } };
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
function field(item, names){
  for(const n of names){
    const parts = String(n).split('.');
    let v = item;
    for(const p of parts){ if(isObj(v)) v = v[p]; else { v = undefined; break; } }
    if(v != null && s(v).trim()) return v;
  }
  return '';
}
function itemText(item){
  if(!isObj(item)) return s(item);
  return [item.title, item.name, item.summary, item.description, item.snippet, item.url, item.link, asArray(item.tags).join(' '), item.section, item.category, field(item,['bind.section','psom_key'])].map(s).join(' ');
}
function hostOf(url){ try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch(e){ return ''; } }
function isPlaceholderLike(it){
  const url = low(field(it, ['url','link','href','targetUrl']));
  const text = low(itemText(it));
  return !!(
    text.includes('placeholder') || text.includes('sample/') || text.includes('sample ') || text.includes('dummy') || text.includes('lorem') ||
    url.includes('example.com') || url === '#' || url.startsWith('#') || (!field(it,['summary','description','snippet']) && (!url || url === '#'))
  );
}
function sectionOf(it){ return s(field(it, ['section','bind.section','bind_section','psom_key','slot','pageSection']) || 'unknown').trim() || 'unknown'; }
function categoryOf(it){ return s(field(it, ['category','group','type','vertical']) || 'unknown').trim() || 'unknown'; }
function snapshotStats(json, mode){
  const items = extractItems(json);
  const stats = {
    mode,
    totalItems: items.length,
    missingTitle:0, missingSummary:0, missingImage:0,
    emptyOrHashUrl:0, exampleUrl:0, nonHttpUrl:0,
    placeholderLikeCount:0, realCandidateCount:0,
    monetizationCount:0, revenueDestinationCount:0,
    directSaleReadyCount:0, paymentReadyCount:0,
    countryPresentCount:0, currencyPresentCount:0, pricePresentCount:0,
    uniqueIdCount:0, duplicateIdCount:0,
    sectionCounts:{}, categoryCounts:{}, hostCounts:{},
    topSections:[], topCategories:[], topHosts:[],
    ratios:{}
  };
  const ids = new Set();
  for(let slotIndex = 0; slotIndex < items.length; slotIndex++){
    const it = items[slotIndex];
    const title = field(it, ['title','name','label']);
    const summary = field(it, ['summary','description','snippet','excerpt','body']);
    const image = field(it, ['image','thumb','thumbnail','imageUrl','poster','ogImage']);
    const url = low(field(it, ['url','link','href','targetUrl']));
    const host = hostOf(url);
    const id = field(it, ['id','uid','contentId','productId','sku']);
    if(id){ if(ids.has(s(id))) stats.duplicateIdCount++; else ids.add(s(id)); }
    if(!title) stats.missingTitle++;
    if(!summary) stats.missingSummary++;
    if(!image) stats.missingImage++;
    if(!url || url === '#' || url.startsWith('#') || url === 'javascript:void(0)') stats.emptyOrHashUrl++;
    if(url && !url.startsWith('http') && !url.startsWith('/')) stats.nonHttpUrl++;
    if(url.includes('example.com')) stats.exampleUrl++;
    const placeholder = isPlaceholderLike(it);
    if(placeholder) stats.placeholderLikeCount++;
    if(!placeholder && url && (url.startsWith('http') || url.startsWith('/')) && !url.includes('example.com')) stats.realCandidateCount++;
    if(isObj(it) && it.monetization) stats.monetizationCount++;
    if(isObj(it) && it.revenueDestination) stats.revenueDestinationCount++;
    if(field(it, ['directSale.enabled','commerce.orderable','orderable'])) stats.directSaleReadyCount++;
    if(field(it, ['payment.enabled','blockchainPayment.enabled','pgProvider','directSale.pgProvider'])) stats.paymentReadyCount++;
    if(field(it, ['country','audienceCountry','producerCountry','shipping.country'])) stats.countryPresentCount++;
    if(field(it, ['currency','directSale.currency','commerce.currency','payment.currency'])) stats.currencyPresentCount++;
    if(field(it, ['price','amount','directSale.price','commerce.price','payment.price'])) stats.pricePresentCount++;
    const sec = sectionOf(it);
    const cat = categoryOf(it);
    stats.sectionCounts[sec] = (stats.sectionCounts[sec] || 0) + 1;
    stats.categoryCounts[cat] = (stats.categoryCounts[cat] || 0) + 1;
    if(host) stats.hostCounts[host] = (stats.hostCounts[host] || 0) + 1;
  }
  stats.uniqueIdCount = ids.size;
  stats.topSections = Object.entries(stats.sectionCounts).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,v])=>({ key:k, count:v }));
  stats.topCategories = Object.entries(stats.categoryCounts).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,v])=>({ key:k, count:v }));
  stats.topHosts = Object.entries(stats.hostCounts).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>({ key:k, count:v }));
  const total = Math.max(1, stats.totalItems);
  stats.ratios.placeholder = +(stats.placeholderLikeCount / total).toFixed(4);
  stats.ratios.realCandidate = +(stats.realCandidateCount / total).toFixed(4);
  stats.ratios.exampleUrl = +(stats.exampleUrl / total).toFixed(4);
  stats.ratios.emptyOrHashUrl = +(stats.emptyOrHashUrl / total).toFixed(4);
  stats.ratios.monetization = +(stats.monetizationCount / total).toFixed(4);
  return stats;
}
function readScriptRefsFromHtml(html){
  const refs = [];
  const scriptRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while((m = scriptRe.exec(html))) refs.push(m[1]);
  return refs;
}
function scanScripts(root){
  const files = walk(root, { maxFiles:5000 }).filter(f => /\.html?$/i.test(f));
  const missing = [], suspicious = [], checked = [];
  for(const file of files){
    const html = readText(file); if(!html.ok) continue;
    for(const src of readScriptRefsFromHtml(html.text)){
      if(/api\.netlify\.com/i.test(src)) suspicious.push({ html:rel(root,file), src });
      if(/^https?:\/\//i.test(src) || /^\/\//.test(src) || /^data:/.test(src)) continue;
      const clean = src.split('?')[0].split('#')[0];
      if(!clean || clean.startsWith('mailto:')) continue;
      const target = clean.startsWith('/') ? path.join(root, clean.replace(/^\/+/, '')) : path.join(path.dirname(file), clean);
      checked.push({ html:rel(root,file), src });
      if(!fs.existsSync(target)) missing.push({ html:rel(root,file), src, expected:rel(root,target) });
    }
  }
  return { fsStaticScanAvailable:files.length > 0, htmlFiles:files.length, checkedScriptRefs:checked.length, missingScriptRefs:missing, suspiciousApiNetlifyScripts:suspicious };
}
function scanDataPsom(root){
  const files = walk(root, { maxFiles:5000 }).filter(f => /\.html?$/i.test(f));
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
  return { totalDataPsomKeys:total, pages:byPage.slice(0,80) };
}
function scanFunctionExports(root){
  const fnFiles = [
    'netlify/functions/maru-search.js',
    'netlify/functions/sanmaru_engine_v2.js',
    'netlify/functions/search-bank-engine.js',
    'netlify/functions/search-bank-index-engine.js',
    'netlify/functions/maru-global-insight-engine.js',
    'netlify/functions/snapshot-engine.js',
    'netlify/functions/core.js',
    'netlify/functions/lib/trustFilter.core.v1.js',
    'netlify/functions/media-candidate-review.js',
    'netlify/functions/media-candidate-action.js',
    'netlify/functions/media-snapshot-publish.js',
    'netlify/functions/sanmaru-media-candidate-sync.js',
    'netlify/functions/social-candidate-review.js',
    'netlify/functions/social-candidate-action.js',
    'netlify/functions/social-rotation-selector.js',
    'netlify/functions/social-snapshot-publish.js',
    'netlify/functions/sanmaru-social-candidate-gateway.js',
    'netlify/functions/sanmaru-social-pipeline-trigger.js',
    'netlify/functions/commerce-candidate-review.js',
    'netlify/functions/product-go-live-audit.js',
    'netlify/functions/regional-brokerage-autoselector.js',
    'netlify/functions/regional-brokerage-snapshot.js'
  ];
  const checked = [], missing = [];
  for(const p of fnFiles){
    const f = path.join(root,p);
    const st = statFile(f);
    const rec = { path:p, exists:st.exists, size:st.size || 0, exports:[], requireCore:false, hash:null, version:null };
    if(st.exists){
      const txt = readText(f).text || '';
      if(/exports\.handler|module\.exports\s*=\s*\{[^}]*handler|handler\s*=/.test(txt)) rec.exports.push('handler?');
      if(/exports\.runEngine|runEngine\s*[:=]/.test(txt)) rec.exports.push('runEngine?');
      if(/exports\.queryIndex|queryIndex\s*[:=]/.test(txt)) rec.exports.push('queryIndex?');
      rec.requireCore = /require\(["']\.\/core["']\)/.test(txt);
      rec.version = ((txt.match(/VERSION\s*=\s*["']([^"']+)/) || [])[1]) || null;
      rec.hash = hashText(txt);
    } else missing.push(p);
    checked.push(rec);
  }
  return { checked, missing, requireCoreFiles:checked.filter(x=>x.requireCore).map(x=>x.path), coreBridgeExists:fs.existsSync(path.join(root,'netlify/functions/core.js')) };
}
function countTrustEntries(v){
  if(!isObj(v) && !Array.isArray(v)) return { total:0 };
  if(Array.isArray(v)) return { total:v.length, array:v.length };
  const keys = ['domains','tlds','patterns','categories','sources','keywords'];
  const out = { total:0 };
  for(const k of keys){
    out[k] = Array.isArray(v[k]) ? v[k].length : 0;
    out.total += out[k];
  }
  if(out.total === 0) out.total = Object.keys(v).length;
  return out;
}
function compareFiles(root, pairs){
  return pairs.map(([a,b]) => {
    const ar = readJsonRel(root,a), br = readJsonRel(root,b);
    return {
      a, b,
      aExists:ar.exists, bExists:br.exists,
      aOk:ar.ok, bOk:br.ok,
      aHash:ar.hash, bHash:br.hash,
      same:!!(ar.ok && br.ok && ar.hash === br.hash),
      aSize:ar.size, bSize:br.size,
      error: ar.error || br.error || null
    };
  });
}
function scanSnapshotCopies(root){
  const searchBankCandidates = [
    'data/search-bank.snapshot.json',
    'netlify/functions/data/search-bank.snapshot.json',
    'netlify/functions/search-bank.snapshot.json',
    'search-bank.snapshot.json'
  ];
  const frontendPairs = [
    ['data/front.snapshot.json','netlify/functions/data/front.snapshot.json'],
    ['data/distribution.snapshot.json','netlify/functions/data/distribution.snapshot.json'],
    ['data/media.snapshot.json','netlify/functions/data/media.snapshot.json'],
    ['data/social.snapshot.json','netlify/functions/data/social.snapshot.json'],
    ['data/networkhub-snapshot.json','netlify/functions/data/networkhub-snapshot.json'],
    ['data/tour-snapshot.json','netlify/functions/data/tour-snapshot.json'],
    ['data/donation.snapshot.json','netlify/functions/data/donation.snapshot.json'],
    ['data/psom.json','netlify/functions/data/psom.json']
  ];
  const sb = searchBankCandidates.map(p => {
    const r = readJsonRel(root,p);
    return { path:p, exists:r.exists, ok:r.ok, size:r.size, hash:r.hash, error:r.error };
  });
  const hashes = Object.create(null);
  sb.filter(x=>x.ok).forEach(x => { hashes[x.hash] = (hashes[x.hash] || 0) + 1; });
  return {
    searchBankCandidates:sb,
    searchBankOkCount:sb.filter(x=>x.ok).length,
    searchBankAllSame:sb.filter(x=>x.ok).length > 1 ? Object.keys(hashes).length === 1 : null,
    frontendSnapshotPairs:compareFiles(root, frontendPairs)
  };
}
function scanPayment(root){
  const files = [
    'pay-config.js','pay-config.json',
    'data/pay-config.js','data/pay-config.json',
    'netlify/functions/pay-config.js','netlify/functions/pay-config.json',
    'netlify/functions/checkout.js','netlify/functions/status.js','netlify/functions/update-pay-config.js',
    'assets/js/igdc-pay.min.js','assets/js/admin-pay-toggle.js'
  ];
  const recs = files.map(p => Object.assign({ path:p }, existsRel(root,p)));
  const readers = [];
  for(const p of ['netlify/functions/checkout.js','netlify/functions/status.js','netlify/functions/update-pay-config.js']){
    const r = readText(path.join(root,p));
    const refs = [];
    if(r.ok){
      if(/pay-config\.json/.test(r.text)) refs.push('pay-config.json');
      if(/pay-config\.js/.test(r.text)) refs.push('pay-config.js');
      if(/PAYMENT_LIVE/.test(r.text)) refs.push('PAYMENT_LIVE');
      if(/admin|owner|role|Authorization|Bearer/i.test(r.text)) refs.push('auth-or-role-check?');
    }
    readers.push({ path:p, exists:r.ok, refs });
  }
  return { files:recs, readers };
}
function scanGlobalInsight(root){
  const candidates = ['netlify/functions/maru-global-insight-engine.js','assets/js/maru-global-insight.js','assets/js/maru-global-insight.min.js','assets/js/global-insight.js'];
  return { files:candidates.map(p => Object.assign({ path:p }, existsRel(root,p))) };
}
function getMode(event){
  const q = (event && event.queryStringParameters) || {};
  const raw = low(q.mode || q.stage || process.env.IGDC_AUDIT_MODE || 'pre-product');
  if(['production','prod','live'].includes(raw)) return 'production';
  if(['pre','preproduct','pre-product','before-product','staging','full'].includes(raw)) return 'pre-product';
  return 'pre-product';
}

const SNAPSHOT_AUDIT_TARGETS = [
  { page:'home', file:'front.snapshot.json', server:'netlify/functions/data/front.snapshot.json', public:'data/front.snapshot.json' },
  { page:'distribution', file:'distribution.snapshot.json', server:'netlify/functions/data/distribution.snapshot.json', public:'data/distribution.snapshot.json' },
  { page:'media', file:'media.snapshot.json', server:'netlify/functions/data/media.snapshot.json', public:'data/media.snapshot.json' },
  { page:'social', file:'social.snapshot.json', server:'netlify/functions/data/social.snapshot.json', public:'data/social.snapshot.json' },
  { page:'network', file:'networkhub-snapshot.json', server:'netlify/functions/data/networkhub-snapshot.json', public:'data/networkhub-snapshot.json' },
  { page:'tour', file:'tour-snapshot.json', server:'netlify/functions/data/tour-snapshot.json', public:'data/tour-snapshot.json' },
  { page:'donation', file:'donation.snapshot.json', server:'netlify/functions/data/donation.snapshot.json', public:'data/donation.snapshot.json' }
];
function itemUrl(it){ return low(field(it, ['url','link','href','targetUrl','video','videoUrl','outbound.url'])); }
function itemImage(it){ return field(it, ['image','thumb','thumbnail','imageUrl','poster','ogImage']); }
function itemTrack(it){ return field(it, ['trackId','track_id','slotId','slot_id','contentId','content_id','productId','product_id','snapshotRecordId']); }
function extractSectionItems(v){
  if(Array.isArray(v)) return v;
  if(isObj(v)){
    if(Array.isArray(v.slots)) return v.slots;
    if(Array.isArray(v.items)) return v.items;
    if(Array.isArray(v.data)) return v.data;
    const flat = [];
    Object.keys(v).forEach(k => { if(Array.isArray(v[k])) flat.push.apply(flat, v[k]); });
    return flat;
  }
  return [];
}
function mergeSection(map, key, source, items, raw){
  key = s(key || 'unknown') || 'unknown';
  if(!map[key]) map[key] = { section:key, sources:[], items:[], rawMeta:{} };
  if(source && map[key].sources.indexOf(source) < 0) map[key].sources.push(source);
  if(items && items.length) map[key].items = map[key].items.concat(items);
  if(isObj(raw)){
    ['slot_limit','limit','capacity','title','key','psom_key'].forEach(k => { if(raw[k] != null && map[key].rawMeta[k] == null) map[key].rawMeta[k] = raw[k]; });
  }
}
function collectSnapshotSections(json, pageName){
  const out = Object.create(null);
  function addMap(map, source){
    if(!isObj(map)) return;
    Object.keys(map).forEach(k => mergeSection(out, k, source, extractSectionItems(map[k]), map[k]));
  }
  if(isObj(json) && isObj(json.pages) && isObj(json.pages[pageName]) && isObj(json.pages[pageName].sections)) addMap(json.pages[pageName].sections, 'pages.' + pageName + '.sections');
  if(isObj(json) && isObj(json.sections)) addMap(json.sections, 'sections');
  const items = extractItems(json);
  if(items.length){
    for(const it of items){ mergeSection(out, sectionOf(it), 'items', [it], null); }
  }
  return Object.keys(out).sort().map(k => out[k]);
}
function sectionStats(section, mode){
  const items = section.items || [];
  const st = {
    section:section.section,
    sources:section.sources,
    expectedLimit:Number(section.rawMeta && (section.rawMeta.slot_limit || section.rawMeta.limit || section.rawMeta.capacity)) || null,
    itemCount:items.length,
    missingTitle:0,
    missingImage:0,
    emptyOrHashUrl:0,
    exampleUrl:0,
    nonHttpUrl:0,
    placeholderLikeCount:0,
    potentialIssueCount:0,
    slotIssueCount:0,
    slotIssueList:[],
    trackingCount:0,
    monetizationCount:0,
    priceCount:0,
    currencyCount:0,
    sampleIssues:[],
    status:'ok',
    note:''
  };
  for(let slotIndex = 0; slotIndex < items.length; slotIndex++){
    const it = items[slotIndex];
    const title = field(it, ['title','name','label']);
    const url = itemUrl(it);
    const img = itemImage(it);
    const issues = [];
    if(!title){ st.missingTitle++; issues.push('missing-title'); }
    if(!img){ st.missingImage++; issues.push('missing-image'); }
    if(!url || url === '#' || url.startsWith('#') || url === 'javascript:void(0)'){ st.emptyOrHashUrl++; issues.push('empty-or-hash-url'); }
    if(url && !url.startsWith('http') && !url.startsWith('/')){ st.nonHttpUrl++; issues.push('non-http-url'); }
    if(url.includes('example.com')){ st.exampleUrl++; issues.push('example-url'); }
    if(isPlaceholderLike(it)){ st.placeholderLikeCount++; issues.push('placeholder-like'); }
    if(itemTrack(it)) st.trackingCount++;
    if(isObj(it) && (it.monetization || it.linkRevenue || it.revenue || it.directSale || it.payment || it.mediaRevenue || it.donation)) st.monetizationCount++;
    if(field(it, ['price','amount','directSale.price','commerce.price','payment.price','donation.amount'])) st.priceCount++;
    if(field(it, ['currency','directSale.currency','commerce.currency','payment.currency','donation.currency'])) st.currencyCount++;
    if(issues.length){
      st.potentialIssueCount++;
      const issueRec = {
        slotIndex: slotIndex + 1,
        slotId: s(field(it,['slotId','slot_id'])).slice(0,80),
        id: s(field(it,['id','uid','contentId','content_id','productId','product_id'])).slice(0,100),
        title: s(title).slice(0,160),
        url: s(url).slice(0,240),
        issues
      };
      if(st.sampleIssues.length < 8) st.sampleIssues.push(issueRec);
      if(mode === 'production') st.slotIssueList.push(issueRec);
    }
  }
  st.slotIssueCount = st.slotIssueList.length;
  if(!st.itemCount){ st.status = 'warn'; st.note = 'empty section'; }
  else if(mode === 'production' && (st.emptyOrHashUrl || st.exampleUrl || st.missingTitle)){ st.status = 'fail'; st.note = 'production-blocking item issues'; }
  else if(mode === 'production' && st.placeholderLikeCount > Math.max(2, st.itemCount * 0.15)){ st.status = 'warn'; st.note = 'production placeholder ratio high'; }
  else if(mode !== 'production' && (st.emptyOrHashUrl || st.exampleUrl || st.placeholderLikeCount)){ st.status = 'ok'; st.note = 'pre-product seed/placeholder accepted'; }
  return st;
}
function analyzeSnapshotJson(json, pageName, mode){
  const rows = collectSnapshotSections(json, pageName).map(sec => sectionStats(sec, mode));
  const totalItems = rows.reduce((a,b)=>a + b.itemCount, 0);
  const counts = { ok:0, warn:0, fail:0 };
  rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const slotIssueList = [];
  rows.forEach(r => {
    (r.slotIssueList || []).forEach(issue => slotIssueList.push({ page:pageName, section:r.section, ...issue }));
  });
  return {
    page:pageName,
    totalSections:rows.length,
    totalItems,
    statusCounts:counts,
    slotIssueCount:slotIssueList.length,
    slotIssueList,
    sections:rows,
    topProblemSections:rows.filter(r => r.status !== 'ok' || r.sampleIssues.length).slice(0,30)
  };
}
function scanServerSnapshots(root, mode){
  const pages = SNAPSHOT_AUDIT_TARGETS.map(t => {
    const r = readJsonRel(root, t.server);
    const out = { page:t.page, serverPath:t.server, publicPath:t.public, exists:r.exists, ok:r.ok, size:r.size, hash:r.hash, error:r.error || null };
    if(r.ok) out.analysis = analyzeSnapshotJson(r.value, t.page, mode);
    return out;
  });
  return {
    source:'server-fs',
    totalPages:pages.length,
    okPages:pages.filter(p => p.ok).length,
    totalSections:pages.reduce((a,p)=>a + (p.analysis ? p.analysis.totalSections : 0), 0),
    totalItems:pages.reduce((a,p)=>a + (p.analysis ? p.analysis.totalItems : 0), 0),
    pages
  };
}


function scanEngineTopology(root){
  const targets = [
    { key:'maru-search', role:'CPU search dispatcher', path:'netlify/functions/maru-search.js', critical:true, downstream:['search-bank-engine','search-bank-index-engine','maru-search-display-engine','sanmaru'] },
    { key:'sanmaru', role:'OSAI global information integrator', path:'netlify/functions/sanmaru_engine_v2.js', critical:true, downstream:['maru-search','search-bank-engine','front-supply','slot-supply'] },
    { key:'search-bank-engine', role:'SearchBank snapshot request/router', path:'netlify/functions/search-bank-engine.js', critical:true, downstream:['data/search-bank.snapshot.json','front snapshots'] },
    { key:'search-bank-index', role:'front reservoir/index supplier', path:'netlify/functions/search-bank-index-engine.js', critical:true, downstream:['search-bank-engine','front slot candidates'] },
    { key:'maru-search-display', role:'search result display bridge', path:'netlify/functions/maru-search-display-engine.js', critical:true, downstream:['front cards','search UI'] },
    { key:'global-insight', role:'regional/global insight supplier', path:'netlify/functions/maru-global-insight-engine.js', critical:false, downstream:['right panel','admin insight'] },
    { key:'collector', role:'external/data collection feeder', path:'netlify/functions/collector.js', critical:false, downstream:['search-bank','sanmaru'] },
    { key:'planetary', role:'planetary data connector', path:'netlify/functions/planetary-data-connector.js', critical:false, downstream:['sanmaru','search-bank'] },
    { key:'snapshot-engine', role:'SearchBank to front snapshot merger', path:'netlify/functions/snapshot-engine.js', critical:true, downstream:['front.snapshot','distribution.snapshot','media.snapshot','social.snapshot','network.snapshot','tour.snapshot'] }
  ];
  const nodes = targets.map(t => {
    const file = path.join(root, t.path);
    const st = statFile(file);
    const rec = Object.assign({ key:t.key, role:t.role, path:t.path, critical:!!t.critical, downstream:t.downstream, exists:st.exists, size:st.size || 0 }, {});
    if(st.exists){
      const txt = readText(file).text || '';
      rec.hash = hashText(txt);
      rec.version = ((txt.match(/VERSION\s*=\s*["']([^"']+)/) || [])[1]) || null;
      rec.requireCore = /require\(["']\.\/core["']\)/.test(txt);
      rec.hasHandler = /exports\.handler|module\.exports\s*=\s*\{[^}]*handler|handler\s*=/.test(txt);
      rec.hasRunEngine = /exports\.runEngine|runEngine\s*[:=]/.test(txt);
      rec.hasQueryIndex = /exports\.queryIndex|queryIndex\s*[:=]/.test(txt);
      rec.mentions = {
        sanmaru:/sanmaru/i.test(txt),
        searchBank:/search[-_ ]?bank/i.test(txt),
        index:/index/i.test(txt),
        display:/display/i.test(txt),
        snapshot:/snapshot/i.test(txt),
        collector:/collector/i.test(txt),
        planetary:/planetary/i.test(txt),
        globalInsight:/global[-_ ]?insight/i.test(txt)
      };
    }
    rec.staticStatus = !rec.exists && rec.critical ? 'fail' : (!rec.exists ? 'warn' : 'ok');
    return rec;
  });
  const missingCritical = nodes.filter(n => n.critical && !n.exists).map(n => n.key);
  const criticalOk = missingCritical.length === 0;
  return {
    source:'server-fs-static',
    criticalOk,
    missingCritical,
    total:nodes.length,
    ok:nodes.filter(n => n.exists).length,
    nodes,
    pipeline:[
      'sanmaru → maru-search → search-bank-index → search-bank-engine → search-bank.snapshot.json',
      'search-bank.snapshot.json → snapshot-engine → /data/*.snapshot.json → automap/front slots',
      'collector/planetary → sanmaru/search-bank auxiliary supply',
      'maru-global-insight-engine → insight/right-panel/admin insight',
      'maru-search-display-engine → search/display presentation layer'
    ]
  };
}


function scanEngineDiagnosticReadiness(root){
  const targets = [
    { key:'maru-search', path:'netlify/functions/maru-search.js', critical:true },
    { key:'sanmaru', path:'netlify/functions/sanmaru_engine_v2.js', critical:true },
    { key:'search-bank-engine', path:'netlify/functions/search-bank-engine.js', critical:true },
    { key:'search-bank-index', path:'netlify/functions/search-bank-index-engine.js', critical:true },
    { key:'maru-search-display', path:'netlify/functions/maru-search-display-engine.js', critical:true },
    { key:'global-insight', path:'netlify/functions/maru-global-insight-engine.js', critical:false },
    { key:'collector', path:'netlify/functions/collector.js', critical:false },
    { key:'planetary', path:'netlify/functions/planetary-data-connector.js', critical:false }
  ];
  const rows = targets.map(t => {
    const file = path.join(root, t.path);
    const st = statFile(file);
    const rec = { key:t.key, path:t.path, critical:!!t.critical, exists:st.exists, size:st.size || 0 };
    if(st.exists){
      const txt = readText(file).text || '';
      rec.hash = hashText(txt);
      rec.hasHandler = /exports\.handler|module\.exports\s*=\s*\{[^}]*handler|handler\s*=/.test(txt);
      rec.hasFastHealthBranch = /(health|ping|probe|audit|dryRun|noWrite)/i.test(txt);
      rec.hasTimeoutGuard = /(AbortController|timeout|setTimeout|Promise\.race)/i.test(txt);
      rec.mentionsSearchBank = /search[-_ ]?bank/i.test(txt);
      rec.mentionsSnapshot = /snapshot/i.test(txt);
      rec.mentionsDisplay = /display/i.test(txt);
      rec.mentionsGlobalInsight = /global[-_ ]?insight/i.test(txt);
      rec.readiness = rec.hasHandler && rec.hasFastHealthBranch ? 'probe-ready' : (rec.hasHandler ? 'callable-no-fast-probe' : 'not-http-callable');
      rec.recommendation = rec.readiness === 'probe-ready'
        ? 'fast audit/probe branch appears present or referenced'
        : 'add an explicit early-return branch for ?audit=1&probe=1&health=1 that does not run heavy collection/search';
    } else {
      rec.readiness = t.critical ? 'missing-critical' : 'missing-optional';
      rec.recommendation = 'file missing or not bundled';
    }
    return rec;
  });
  return {
    source:'server-fs-static-v4',
    total:rows.length,
    probeReady:rows.filter(r => r.readiness === 'probe-ready').length,
    callableNoFastProbe:rows.filter(r => r.readiness === 'callable-no-fast-probe').map(r => r.key),
    criticalWithoutFastProbe:rows.filter(r => r.critical && r.readiness !== 'probe-ready').map(r => r.key),
    rows
  };
}

function scanCandidateSubsystems(root){
  const groups = [
    {
      key:'media-candidates',
      label:'Media candidate queue',
      purpose:'media rights/review/publish candidate pipeline',
      required:[
        'netlify/functions/media-candidate-review.js',
        'netlify/functions/media-candidate-action.js',
        'netlify/functions/media-snapshot-publish.js',
        'netlify/functions/lib/media-candidate-store.v1.js'
      ],
      optional:[
        'netlify/functions/sanmaru-media-candidate-sync.js',
        'netlify/functions/data/media.candidates.snapshot.json'
      ]
    },
    {
      key:'social-candidates',
      label:'Social candidate queue',
      purpose:'9 SNS candidate gateway/review/rotation/generated snapshot pipeline',
      required:[
        'netlify/functions/social-candidate-review.js',
        'netlify/functions/social-candidate-action.js',
        'netlify/functions/social-rotation-selector.js',
        'netlify/functions/social-snapshot-publish.js',
        'netlify/functions/sanmaru-social-candidate-gateway.js',
        'netlify/functions/sanmaru-social-pipeline-trigger.js',
        'netlify/functions/lib/social-candidate-store.v1.js',
        'netlify/functions/lib/social-candidate-policy.v1.js'
      ],
      optional:[
        'netlify/functions/sanmaru-social-collection-policy.js',
        'netlify/functions/data/social.candidates.snapshot.json'
      ]
    },
    {
      key:'commerce-candidates',
      label:'Commerce/product candidate queue',
      purpose:'product/open-supply/regional brokerage readiness checks',
      required:[
        'netlify/functions/commerce-candidate-review.js',
        'netlify/functions/product-go-live-audit.js'
      ],
      optional:[
        'netlify/functions/regional-brokerage-autoselector.js',
        'netlify/functions/regional-brokerage-snapshot.js',
        'netlify/functions/lib/regional-brokerage-autoselection.core.v1.js',
        'netlify/functions/lib/regional-brokerage-front-supply-gate.core.v1.js',
        'netlify/functions/data/commerce-candidate-review-queue.v1.json',
        'netlify/functions/data/regional-brokerage-policy.json'
      ]
    }
  ];
  function inspectFile(p){
    const file = path.join(root, p);
    const st = statFile(file);
    const rec = { path:p, exists:st.exists, size:st.size || 0, kind:/\.json$/i.test(p)?'data':(/\.html$/i.test(p)?'page':(/\/lib\//.test(p)?'library':'function')) };
    if(st.exists && !/\.json$/i.test(p)){
      const txt = readText(file).text || '';
      rec.hash = hashText(txt);
      rec.version = ((txt.match(/VERSION\s*=\s*["']([^"']+)/) || [])[1]) || null;
      rec.hasHandler = /exports\.handler|module\.exports\s*=\s*\{[^}]*handler|handler\s*=/.test(txt);
      rec.hasRunEngine = /exports\.runEngine|runEngine\s*[:=]/.test(txt);
      rec.hasFastProbeHint = /(audit|probe|health|diagnostic|readOnly|noWrite|dryRun)/i.test(txt);
      rec.mentionsSupabase = /supabase|SUPABASE_/i.test(txt);
      rec.mentionsSnapshot = /snapshot/i.test(txt);
      rec.mentionsSearchBank = /search[-_ ]?bank/i.test(txt);
    }
    if(st.exists && /\.json$/i.test(p)){
      const jr = readJsonRel(root,p);
      rec.ok = jr.ok;
      rec.hash = jr.hash;
      rec.error = jr.error || null;
    }
    return rec;
  }
  const rows = groups.map(g => {
    const required = g.required.map(inspectFile);
    const optional = g.optional.map(inspectFile);
    const missingRequired = required.filter(x => !x.exists).map(x => x.path);
    const existingRequired = required.length - missingRequired.length;
    const handlerMissing = required.filter(x => x.exists && x.kind === 'function' && !x.hasHandler).map(x => x.path);
    const level = missingRequired.length ? 'warn' : (handlerMissing.length ? 'warn' : 'ok');
    return Object.assign({}, g, {
      required,
      optional,
      totalRequired:required.length,
      existingRequired,
      missingRequired,
      handlerMissing,
      optionalPresent:optional.filter(x=>x.exists).length,
      level,
      note: level === 'ok' ? 'candidate subsystem files present' : 'candidate subsystem is partially installed or needs deployment sync'
    });
  });
  return {
    source:'server-fs-static-v4.2',
    totalGroups:rows.length,
    okGroups:rows.filter(r => r.level === 'ok').length,
    warnGroups:rows.filter(r => r.level === 'warn').length,
    missingRequired:rows.reduce((a,r)=>a.concat(r.missingRequired.map(p=>({ group:r.key, path:p }))),[]),
    handlerMissing:rows.reduce((a,r)=>a.concat(r.handlerMissing.map(p=>({ group:r.key, path:p }))),[]),
    rows
  };
}


function buildWarnings(report){
  const w = [];
  const mode = report.mode || 'pre-product';
  const snap = report.searchBank && report.searchBank.snapshot;
  if(!snap || !snap.totalItems) w.push('search-bank.snapshot.json item count is zero or unavailable.');
  if(snap && snap.placeholderLikeCount > Math.max(50, snap.totalItems * 0.35)){
    if(mode === 'production') w.push('Production mode: Search Bank snapshot placeholder-like ratio is too high.');
    else w.push('Pre-product mode: high placeholder-like ratio is expected before real product upload.');
  }
  if(mode === 'production' && snap && snap.exampleUrl > 0) w.push('Production mode: example.com URLs remain in Search Bank snapshot.');
  if(mode === 'production' && snap && snap.emptyOrHashUrl > 0) w.push('Production mode: empty/hash URLs remain in Search Bank snapshot.');
  if(report.frontend && report.frontend.fsStaticScanAvailable && report.frontend.missingScriptRefs && report.frontend.missingScriptRefs.length) w.push('Some HTML script references are missing.');
  if(report.frontend && report.frontend.suspiciousApiNetlifyScripts && report.frontend.suspiciousApiNetlifyScripts.length) w.push('Suspicious api.netlify.com script references remain. Remove them before production.');
  if(report.functions && report.functions.missing && report.functions.missing.length) w.push('Some important Netlify function/core files are missing.');
  if(report.functions && report.functions.requireCoreFiles && report.functions.requireCoreFiles.length && !report.functions.coreBridgeExists) w.push('Some functions require ./core but netlify/functions/core.js is missing.');
  if(report.engineTopology && report.engineTopology.missingCritical && report.engineTopology.missingCritical.length) w.push('Critical engine files are missing: ' + report.engineTopology.missingCritical.join(', '));
  if(report.engineDiagnosticReadiness && report.engineDiagnosticReadiness.criticalWithoutFastProbe && report.engineDiagnosticReadiness.criticalWithoutFastProbe.length) w.push('Engine diagnostic readiness: add fast health/probe branches to critical engines: ' + report.engineDiagnosticReadiness.criticalWithoutFastProbe.join(', '));
  const copies = report.snapshotCopies;
  if(copies && copies.searchBankOkCount < 2) w.push('SearchBank snapshot copy count is low. Confirm data/ and function-side copies before production.');
  if(copies && copies.searchBankAllSame === false) w.push('SearchBank snapshot copies have different hashes. Confirm intended sync state.');
  if(report.productSupply && report.productSupply.enabled && mode === 'pre-product') w.push('Product supply gate is ON while audit mode is pre-product. Confirm this is intended.');
  if(report.productSupply && !report.productSupply.enabled && mode === 'production') w.push('Production mode: product supply gate is OFF.');
  if(report.serverSnapshots && report.serverSnapshots.okPages < report.serverSnapshots.totalPages) w.push('Server snapshot pages are missing or invalid. Check netlify/functions/data/*.snapshot.json.');
  if(mode === 'production' && report.serverSnapshots && report.serverSnapshots.pages && report.serverSnapshots.pages.some(p => p.analysis && p.analysis.statusCounts && p.analysis.statusCounts.fail)) w.push('Production mode: one or more server snapshot sections have blocking item issues.');
  if(report.candidateSubsystems && report.candidateSubsystems.warnGroups){
    w.push('Candidate subsystem static scan has ' + report.candidateSubsystems.warnGroups + ' partial group(s). This is a deployment-sync warning only.');
  }
  return w;
}
function computeSummary(report){
  let score = 100;
  const mode = report.mode || 'pre-product';
  const missingScripts = report.frontend && report.frontend.fsStaticScanAvailable ? (report.frontend.missingScriptRefs || []).length : 0;
  const suspicious = (report.frontend && report.frontend.suspiciousApiNetlifyScripts || []).length;
  const missingFn = (report.functions && report.functions.missing || []).length;
  const snap = report.searchBank && report.searchBank.snapshot;
  score -= Math.min(30, missingScripts * 3);
  score -= Math.min(25, suspicious * 5);
  score -= Math.min(30, missingFn * 6);
  if(!snap || !snap.totalItems) score -= 20;
  else if(mode === 'production'){
    score -= Math.min(25, Math.round((snap.ratios.placeholder || 0) * 25));
    if(snap.exampleUrl) score -= Math.min(15, Math.ceil(snap.exampleUrl / 100));
    if(snap.emptyOrHashUrl) score -= Math.min(15, Math.ceil(snap.emptyOrHashUrl / 100));
  } else {
    if(snap.totalItems < 1000) score -= 8;
  }
  if(report.snapshotCopies && report.snapshotCopies.searchBankAllSame === false) score -= 8;
  if(report.functions && report.functions.requireCoreFiles && report.functions.requireCoreFiles.length && !report.functions.coreBridgeExists) score -= 10;
  if(report.engineTopology && report.engineTopology.missingCritical && report.engineTopology.missingCritical.length) score -= Math.min(25, report.engineTopology.missingCritical.length * 7);
  if(report.engineDiagnosticReadiness && report.engineDiagnosticReadiness.criticalWithoutFastProbe && report.engineDiagnosticReadiness.criticalWithoutFastProbe.length) score -= Math.min(8, report.engineDiagnosticReadiness.criticalWithoutFastProbe.length * 2);
  if(report.serverSnapshots && report.serverSnapshots.okPages < report.serverSnapshots.totalPages) score -= Math.min(12, (report.serverSnapshots.totalPages - report.serverSnapshots.okPages) * 3);
  if(mode === 'production' && report.serverSnapshots && report.serverSnapshots.pages){
    const badSections = report.serverSnapshots.pages.reduce((n,p)=> n + (p.analysis && p.analysis.statusCounts ? (p.analysis.statusCounts.fail || 0) : 0), 0);
    score -= Math.min(20, badSections);
  }
  score = Math.max(0, Math.min(100, score));
  let level = 'ok';
  if(score < 80) level = 'warn';
  if(score < 55) level = 'fail';
  return { level, score, mode };
}
function audit(event){
  const root = findRoot();
  const mode = getMode(event);
  const report = {
    ok:true,
    auditVersion:'engine-diagnostic-v4.2-candidate-stability',
    mode,
    generatedAt:nowIso(),
    root,
    runtime:{ node:process.version, platform:process.platform, cwd:process.cwd(), dirname:__dirname },
    productSupply:{
      enabled:['PRODUCT_SUPPLY_ON','DATA_UPLOAD_ON','FRONT_SLOT_AUTO_FILL','PAYMENT_LIVE'].some(k => truthy(process.env[k])),
      flags:{
        PRODUCT_SUPPLY_ON: low(process.env.PRODUCT_SUPPLY_ON || 'false'),
        DATA_UPLOAD_ON: low(process.env.DATA_UPLOAD_ON || 'false'),
        FRONT_SLOT_AUTO_FILL: low(process.env.FRONT_SLOT_AUTO_FILL || 'false'),
        PAYMENT_LIVE: low(process.env.PAYMENT_LIVE || 'false')
      }
    },
    files:{}, functions:{}, searchBank:{}, frontend:{}, trust:{}, globalInsight:{}, payment:{}, snapshotCopies:{}, candidateSubsystems:{}, warnings:[]
  };
  const importantFiles = [
    'index.html','home.html','distributionhub.html','socialnetwork.html','mediahub.html','tour.html','donation.html','networkhub.html','search.html','admin.html',
    'assets/js/search.js','assets/js/igdc-core.min.js','assets/js/member-admin-modal.js','assets/js/maru-global-insight.js','assets/js/maru-search.js','assets/js/maru-searchbank-sync.js',
    'data/search-bank.snapshot.json','netlify/functions/data/search-bank.snapshot.json','netlify/functions/search-bank.snapshot.json',
    'netlify/functions/data/trust.allowlist.json','netlify/functions/data/trust.blocklist.json'
  ];
  report.files.important = importantFiles.map(p => Object.assign({ path:p }, existsRel(root,p)));
  report.functions = scanFunctionExports(root);
  const snapFind = firstJson(root, ['data/search-bank.snapshot.json','netlify/functions/data/search-bank.snapshot.json','netlify/functions/search-bank.snapshot.json','search-bank.snapshot.json']);
  report.searchBank.snapshotFile = { exists:!!snapFind.hit, ok:!!snapFind.hit, path:snapFind.hit && snapFind.hit.path, size:snapFind.hit && snapFind.hit.size, hash:snapFind.hit && snapFind.hit.hash, tried:snapFind.tried };
  report.searchBank.snapshot = snapFind.result && snapFind.result.ok ? snapshotStats(snapFind.result.value, mode) : null;
  const allow = readJsonRel(root, 'netlify/functions/data/trust.allowlist.json');
  const block = readJsonRel(root, 'netlify/functions/data/trust.blocklist.json');
  report.trust.allowlist = { exists:allow.exists, ok:allow.ok, size:allow.size, hash:allow.hash, entries: allow.ok ? countTrustEntries(allow.value) : null, error:allow.error };
  report.trust.blocklist = { exists:block.exists, ok:block.ok, size:block.size, hash:block.hash, entries: block.ok ? countTrustEntries(block.value) : null, error:block.error };
  report.frontend = Object.assign(scanScripts(root), { psom: scanDataPsom(root) });
  report.globalInsight = scanGlobalInsight(root);
  report.payment = scanPayment(root);
  report.engineTopology = scanEngineTopology(root);
  report.engineDiagnosticReadiness = scanEngineDiagnosticReadiness(root);
  report.candidateSubsystems = scanCandidateSubsystems(root);
  report.snapshotCopies = scanSnapshotCopies(root);
  report.serverSnapshots = scanServerSnapshots(root, mode);
  report.warnings = buildWarnings(report);
  report.summary = computeSummary(report);
  return report;
}

exports.audit = audit;
exports.handler = async function(event){
  try{
    const report = audit(event || {});
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

if(require.main === module){
  const mode = process.argv.includes('--production') ? 'production' : 'pre-product';
  console.log(JSON.stringify(audit({ queryStringParameters:{ mode } }), null, 2));
}
