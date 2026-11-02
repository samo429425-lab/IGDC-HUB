'use strict';

/*
 * MARU Windows download-request analytics (not completed downloads/installations).
 * The public event endpoint accepts two fixed download buttons only; the
 * dashboard requires the existing verified IGDC administrator session.
 * Independent of all revenue, billing and Windows application paths.
 */
const crypto = require('crypto');
const AdminAuth = require('./lib/global-slot-console-auth');
const VERSION = 'maru-windows-download-metrics-v1.0.0';
const TABLE = 'maru_windows_download_events';
const PROGRAMS = new Set(['maru_windows_player', 'maru_capture_windows']);
const ADMIN_ROLES = new Set(['owner','admin','super_admin','director','site_manager_director','site_manager','coordinator_director']);

function result(statusCode, body) {
  return {statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer'},body:JSON.stringify(body)};
}
function clean(value){return String(value == null ? '' : value).trim();}
function bad(statusCode, code){const e=new Error(code); e.statusCode=statusCode; e.code=code; throw e;}
function settings(){
  const url=clean(process.env.MARU_DOWNLOAD_SUPABASE_URL||process.env.GSLOT_SUPABASE_URL||process.env.SUPABASE_URL).replace(/\/+$/,'');
  const key=clean(process.env.MARU_DOWNLOAD_SUPABASE_SERVICE_KEY||process.env.GSLOT_SUPABASE_SECRET_KEY||process.env.GSLOT_SUPABASE_SERVICE_ROLE_KEY||process.env.GSLOT_SUPABASE_SERVICE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY);
  if(!/^https:\/\/[a-z0-9.-]+$/i.test(url)||!key)bad(503,'metrics_storage_not_configured');
  return {url,key};
}
async function store(path,init){
  const cfg=settings();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8500);
  try{
    const response=await fetch(cfg.url+path,{...init,signal:controller.signal,headers:{'apikey':cfg.key,'Authorization':'Bearer '+cfg.key,'content-type':'application/json',...(init&&init.headers||{})}});
    const raw=await response.text();let data=null;
    try{data=raw?JSON.parse(raw):null;}catch(_e){}
    if(!response.ok){
      // Database table or RPC must be installed once; never return fabricated zeros.
      if(response.status===404||data&&(/PGRST202|42P01|42883/.test(clean(data.code))))bad(503,'metrics_database_setup_required');
      bad(503,'metrics_storage_unavailable');
    }
    return data;
  }catch(error){if(error&&error.statusCode)throw error;bad(503,'metrics_storage_unavailable');}
  finally{clearTimeout(timer);}
}
function firstHeader(event,name){const h=event&&event.headers||{};return clean(h[name]||h[name.toLowerCase()]||h[name.toUpperCase()]);}
function sameOrigin(event){
  const host=firstHeader(event,'host').toLowerCase();
  if(!host)return false;
  const raw=firstHeader(event,'origin')||firstHeader(event,'referer');
  if(!raw)return false;
  try{const url=new URL(raw);return (url.protocol==='https:'||url.protocol==='http:')&&url.host.toLowerCase()===host;}catch(_){return false;}
}
function countryOf(event){
  let geo={};
  try{geo=JSON.parse(firstHeader(event,'x-nf-geo')||'{}');}catch(_e){}
  const country=geo&&geo.country||{};
  const value=firstHeader(event,'x-nf-country')||firstHeader(event,'x-country')||firstHeader(event,'cf-ipcountry')||clean(country.code||country.alpha2||(typeof country==='string'?country:''));
  return /^[A-Za-z]{2}$/.test(value)?value.toUpperCase():'ZZ';
}
function ipForHash(event){
  // Never save raw IPs or full user agents. Use a daily keyed digest solely for deduplication.
  const raw=firstHeader(event,'x-nf-client-connection-ip')||firstHeader(event,'client-ip')||firstHeader(event,'x-forwarded-for').split(',')[0]||'';
  return raw.slice(0,128);
}
function osOf(event){
  const ua=firstHeader(event,'user-agent');
  if(/windows nt/i.test(ua))return 'windows';
  if(/android/i.test(ua))return 'android';
  if(/iphone|ipad|ipod/i.test(ua))return 'ios';
  if(/macintosh|mac os x/i.test(ua))return 'mac';
  if(/linux/i.test(ua))return 'linux';
  return 'unknown';
}
function isCrawler(event){return /bot\b|crawler|spider|headless|monitor|lighthouse/i.test(firstHeader(event,'user-agent'));}
async function record(event){
  if(!sameOrigin(event))bad(403,'invalid_download_origin');
  if(isCrawler(event))return result(202,{ok:true,recorded:false,reason:'automated_agent'});
  if(!event.body||event.body.length>2048)bad(400,'invalid_download_event');
  let data;
  try{data=JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body);}catch(_){bad(400,'invalid_download_event');}
  const program=clean(data&&data.program);
  if(!PROGRAMS.has(program))bad(400,'unknown_download_program');
  // Require a generated browser install-page event, never a caller-supplied count.
  if(clean(data&&data.event)!=='download_click')bad(400,'invalid_download_event');
  const now=Date.now();
  const minuteBucket=new Date(Math.floor(now/60000)*60000).toISOString();
  const day=new Date(now).toISOString().slice(0,10);
  const cfg=settings();
  const visitor=[ipForHash(event),clean(data&&data.session).slice(0,90)].join('|');
  const ua=firstHeader(event,'user-agent').slice(0,400);
  const dedupeKey=crypto.createHmac('sha256',cfg.key).update([day,visitor,ua].join('|')).digest('hex');
  await store('/rest/v1/'+TABLE+'?on_conflict=program,minute_bucket,dedupe_key',{
    method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},
    body:JSON.stringify([{program,country_code:countryOf(event),os_family:osOf(event),minute_bucket:minuteBucket,dedupe_key:dedupeKey}])
  });
  return result(202,{ok:true,recorded:true,metric:'download_request'});
}
async function stats(event){
  const actor=await AdminAuth.resolveUser(event);
  if(!Array.isArray(actor.roles)||!actor.roles.some(role=>ADMIN_ROLES.has(clean(role).toLowerCase())))bad(403,'administrator_required');
  const data=await store('/rest/v1/rpc/maru_windows_download_summary_v1',{method:'POST',body:'{}'});
  if(!data||typeof data!=='object'||!data.byProgram)bad(503,'metrics_summary_unavailable');
  return result(200,{ok:true,version:VERSION,metric:'download_requests_not_installs',...data});
}
exports.handler=async(event)=>{
  try{
    const method=clean(event&&event.httpMethod).toUpperCase();
    if(method==='POST')return await record(event);
    if(method==='GET')return await stats(event);
    return result(405,{ok:false,error:'method_not_allowed'});
  }catch(error){
    const status=error.statusCode||500;
    return result(status,{ok:false,error:error.code||'metrics_unavailable'});
  }
};
exports.__test={sameOrigin,countryOf,osOf,isCrawler};
