'use strict';
/*
 * Optional, independent LIVE web search for country supplier discovery.
 * Only genuine provider results are returned. No synthetic leads, browser
 * search links, cached SearchBank display links or seed-only success claims.
 * Every result still passes existing supplier inspection and private-ledger
 * policy before it can unlock product research.
 *
 * Required runtime secret: IGDC_BRAVE_SEARCH_API_KEY (or BRAVE_SEARCH_API_KEY).
 * The key is never emitted in a result or log.
 */
const Guard = require('./commerce-supplier-source-guard.v1');
const VERSION = 'igdc-commerce-live-supplier-search.v1';
// Brave's web-search country filter accepts a limited enum, not all ISO
// countries. A blind country=EG (or 50+ other countries) returns HTTP 422.
// Use global search for unsupported markets; seller identity and marketplace
// eligibility are still checked by the existing country supplier pipeline.
const SEARCH_COUNTRIES=new Set('AR AU AT BE BR CA CL DK FI FR DE GR HK IN ID IT JP KR MY MX NL NZ NO CN PL PT PH RU SA ZA ES SE CH TW TR GB US'.split(' '));
function text(v){return v == null ? '' : String(v).trim();}
function code(error){
  const m = text(error && (error.code || error.message || error)).match(/(?:http[_ ]?)(\d{3})/i);
  return m ? 'http_'+m[1] : /abort|timeout/i.test(text(error && error.message)) ? 'timeout' : 'network_error';
}
function configured(){return !!text(process.env.IGDC_BRAVE_SEARCH_API_KEY || process.env.BRAVE_SEARCH_API_KEY);}
function safeSupplierUrl(value){
  try{
    const u=new URL(text(value));const host=u.hostname.toLowerCase();
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!host||Guard.reason(u.toString()))return '';
    // Provider entries are untrusted. They must never become automatic probes
    // of local/cloud metadata or private-address HTTP services.
    if(host==='metadata.google.internal'||host.endsWith('.internal')||host.endsWith('.local')||
       host==='[::1]'||/^\[(?:fc|fd|fe80)[0-9a-f:]*\]$/i.test(host)||
       /^(?:0|10|127|169\.254|192\.168)\./.test(host)||
       /^172\.(?:1[6-9]|2[0-9]|3[01])\./.test(host))return '';
    if(u.searchParams.has('q') && /(?:^|\/)(?:search|results)(?:\/|$)/i.test(u.pathname))return '';
    u.hash='';return u.toString();
  }catch(_error){return '';}
}
async function search(task, scope, options){
  if(!configured())return {provider:'brave',status:'not_configured',count:0,items:[]};
  const query=text(task && task.query).slice(0,600),country=text(scope && scope.country).toUpperCase();
  if(!query)return {provider:'brave',status:'invalid_query',count:0,items:[]};
  const key=text(process.env.IGDC_BRAVE_SEARCH_API_KEY || process.env.BRAVE_SEARCH_API_KEY);
  const endpoint=new URL('https://api.search.brave.com/res/v1/web/search');
  endpoint.searchParams.set('q',query);
  endpoint.searchParams.set('count','20');
  endpoint.searchParams.set('country',SEARCH_COUNTRIES.has(country)?country.toLowerCase():'all');
  // Brave uses 'jp' for Japanese and 'zh-hans'/'zh-hant' for Chinese;
  // unsupported search_lang values can cause a rejected request (422).
  const lang=text(task && task.locale).split('-')[0].toLowerCase();
  const braveLang=lang==='ja'?'jp':lang==='zh'?'zh-hans':lang;
  if(/^(?:en|ko|jp|zh-hans|de|fr|es|pt|it|nl|pl|ru|ar|hi|th|vi|tr|id)$/.test(braveLang))endpoint.searchParams.set('search_lang',braveLang);
  const timeout=Math.max(2000,Math.min(6500,Number(options && options.timeoutMs)||5500));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const res=await fetch(endpoint.toString(),{method:'GET',signal:controller.signal,
      headers:{'Accept':'application/json','X-Subscription-Token':key}});
    if(!res.ok)return {provider:'brave',status:'http_'+res.status,count:0,items:[]};
    const payload=await res.json(),raw=Array.isArray(payload&&payload.web&&payload.web.results)?payload.web.results:[];
    const found=[],seen=new Set();
    for(const result of raw){
      const url=safeSupplierUrl(result && result.url),title=text(result && result.title).replace(/<[^>]+>/g,' ').slice(0,180);
      if(!url||!title||seen.has(url))continue;
      seen.add(url);
      found.push({title,name:title,url,link:url,summary:text(result.description).replace(/<[^>]+>/g,' ').slice(0,500),
        source:'brave_country_discovery',provider:'brave',type:'web',
        payload:{source:'brave',country,query,queryLocale:text(task && task.locale),queryOrigin:'independent-live-provider',supplyLane:text(task && task.supplyLane)}});
      if(found.length>=20)break;
    }
    return {provider:'brave',status:found.length?'ok':'empty',count:found.length,items:found};
  }catch(e){return {provider:'brave',status:code(e),count:0,items:[]};}
  finally{clearTimeout(timer);}
}
module.exports={VERSION,configured,safeSupplierUrl,search};
