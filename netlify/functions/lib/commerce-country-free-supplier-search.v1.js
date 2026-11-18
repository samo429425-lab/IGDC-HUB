'use strict';
/**
 * No-fee, bounded discovery of organizations' publicly declared official
 * websites via Wikidata Query Service. No Brave or other paid search account.
 *
 * This is only a CANDIDATE source. A Wikidata URL is NOT evidence of seller
 * eligibility, country commerce availability, inventory, or product authenticity.
 * The caller must preserve the existing supplier inspection/ledger gates.
 *
 * Courtesy limits are enforced by the country scheduler's persisted global
 * `wikidata` cooldown and per-cycle cap. A denied, empty or timed-out query
 * is never converted into a successful supplier discovery.
 */
const Guard = require('./commerce-supplier-source-guard.v1');
const VERSION = 'igdc-country-free-supplier-search.v1';
const ENDPOINT = 'https://query.wikidata.org/sparql';
function txt(v){return v == null ? '' : String(v).trim();}
function configured(){return true;} // Public, no API key, no subscription required.
function safeSupplierUrl(raw){
  try{
    const u = new URL(txt(raw));
    const host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!host) return '';
    if(host==='localhost'||host==='metadata.google.internal'||host.endsWith('.localhost')||host.endsWith('.internal')||host.endsWith('.local'))return '';
    if(host.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(host)){
      // Never ask the server to fetch literal IP addresses discovered in a
      // public, mutable record; avoids private/loopback and DNS surprises.
      return '';
    }
    if(Guard.reason(u.toString()))return '';
    if(u.searchParams.has('q')&&/(?:^|\/)(?:search|results)(?:\/|$)/i.test(u.pathname))return '';
    u.hash='';return u.toString();
  }catch(_e){return '';}
}
function queryForCountry(country){
  const code=txt(country).toUpperCase();
  if(!/^[A-Z]{2}$/.test(code))return '';
  // ISO 3166 country codes are literal values in P297. Only declared
  // official website (P856) results of organizations with corporate classes
  // are candidates; not Google search pages or generated seller sites.
  return `SELECT DISTINCT ?company ?companyLabel ?website WHERE {\n`+
    `  ?country wdt:P297 "${code}" .\n`+
    `  ?company wdt:P17 ?country ; wdt:P31 ?class ; wdt:P856 ?website .\n`+
    `  VALUES ?class { wd:Q4830453 wd:Q783794 wd:Q6881511 }\n`+
    `  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }\n`+
    `} LIMIT 24`;
}
function errorCode(error){
  const e=txt(error&&error.message||error);
  if(/abort|timeout/i.test(e))return 'timeout';
  return 'network_error';
}
async function search(task,scope,opts){
  const country=txt(scope&&scope.country).toUpperCase(),query=queryForCountry(country);
  if(!query)return {provider:'wikidata',status:'invalid_country',count:0,items:[]};
  const timeoutMs=Math.max(1500,Math.min(5500,Number(opts&&opts.timeoutMs)||4500));
  const url=new URL(ENDPOINT);
  url.searchParams.set('query',query);
  url.searchParams.set('format','json');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url.toString(),{signal:controller.signal,headers:{
      'Accept':'application/sparql-results+json',
      'User-Agent':'IGDC-CountrySupplierResearch/1.0 (https://igdcglobal.com; rate-limited, no-paid-search)'
    }});
    if(!response.ok)return {provider:'wikidata',status:'http_'+response.status,count:0,items:[]};
    const payload=await response.json();
    const rows=Array.isArray(payload&&payload.results&&payload.results.bindings)?payload.results.bindings:[];
    const found=[],seen=new Set();
    for(const row of rows){
      const official=safeSupplierUrl(row&&row.website&&row.website.value);
      const name=txt(row&&row.companyLabel&&row.companyLabel.value).replace(/<[^>]*>/g,' ').slice(0,180);
      if(!official||!name||seen.has(official))continue;
      const source=txt(row&&row.company&&row.company.value);
      // The origin remains attached to a discovered candidate. This is not
      // a verified seller; full official-store validation happens downstream.
      if(!/^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(source))continue;
      seen.add(official);
      found.push({title:name,name,url:official,link:official,
        summary:'Official website URL listed in Wikidata; selling activity not independently verified',
        source:'wikidata_official_website',provider:'wikidata',type:'web',
        payload:{source:'wikidata',country,entity:source,queryOrigin:'public-company-official-site',supplyLane:txt(task&&task.supplyLane)}});
      if(found.length>=16)break;
    }
    return {provider:'wikidata',status:found.length?'ok':'empty',count:found.length,items:found};
  }catch(e){return {provider:'wikidata',status:errorCode(e),count:0,items:[]};}
  finally{clearTimeout(timer);}
}
module.exports={VERSION,configured,safeSupplierUrl,queryForCountry,search};
