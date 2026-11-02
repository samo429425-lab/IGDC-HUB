'use strict';
/*
 * IGDC official program-download request analytics.
 * Existing event/table names are preserved for historical compatibility.
 * Counts represent clicks on the IGDC download page, not completed downloads,
 * installations, distinct people, payments or application executions.
 */
const crypto = require('crypto');
const AdminAuth = require('./lib/global-slot-console-auth');
const VERSION = 'maru-download-metrics-v2.0.0';
const TABLE = 'maru_windows_download_events';
const REGISTRY = 'maru_download_program_registry';
const DEFAULT_PROGRAMS = [
  {program:'maru_windows_player',name:'MARU Media Player (Windows)',is_builtin:true,enabled:true},
  {program:'maru_capture_windows',name:'MARU Capture (Windows)',is_builtin:true,enabled:true}
];
const ADMIN_ROLES = new Set(['owner','admin','super_admin','director','site_manager_director','site_manager','coordinator_director']);
const PERIODS = new Set(['7d','30d','90d','365d','all']);
const ID_RE = /^[a-z][a-z0-9_]{2,63}$/;

function result(statusCode, body) {
  return {statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer'},body:JSON.stringify(body)};
}
function clean(value){return String(value == null ? '' : value).trim();}
function bad(statusCode,code){const e=new Error(code);e.statusCode=statusCode;e.code=code;throw e;}
function settings(){
  const url=clean(process.env.MARU_DOWNLOAD_SUPABASE_URL||process.env.GSLOT_SUPABASE_URL||process.env.SUPABASE_URL).replace(/\/+$/,'');
  const key=clean(process.env.MARU_DOWNLOAD_SUPABASE_SERVICE_KEY||process.env.GSLOT_SUPABASE_SECRET_KEY||process.env.GSLOT_SUPABASE_SERVICE_ROLE_KEY||process.env.GSLOT_SUPABASE_SERVICE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY);
  if(!/^https:\/\/[a-z0-9.-]+$/i.test(url)||!key)bad(503,'metrics_storage_not_configured');
  return {url,key};
}
async function store(path,init){
  const cfg=settings();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  try{
    const res=await fetch(cfg.url+path,{...init,signal:controller.signal,headers:{'apikey':cfg.key,'authorization':'Bearer '+cfg.key,'content-type':'application/json',...(init&&init.headers||{})}});
    const raw=await res.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch(_e){}
    if(!res.ok){
      if(res.status===404||(data&&/PGRST202|42P01|42883/.test(clean(data.code))))bad(503,'metrics_database_setup_required');
      if(res.status===409)bad(409,'program_already_registered');
      bad(503,'metrics_storage_unavailable');
    }
    return data;
  }catch(e){if(e&&e.statusCode)throw e;bad(503,'metrics_storage_unavailable');}
  finally{clearTimeout(timer);}
}
function firstHeader(event,name){const h=event&&event.headers||{};return clean(h[name]||h[name.toLowerCase()]||h[name.toUpperCase()]);}
function sameOrigin(event){
  const host=firstHeader(event,'host').toLowerCase(),raw=firstHeader(event,'origin')||firstHeader(event,'referer');
  if(!host||!raw)return false;
  try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)&&u.host.toLowerCase()===host;}catch(_){return false;}
}
function countryOf(event){
  let geo={};try{geo=JSON.parse(firstHeader(event,'x-nf-geo')||'{}');}catch(_e){}
  const c=geo&&geo.country||{};
  const v=firstHeader(event,'x-nf-country')||firstHeader(event,'x-country')||firstHeader(event,'cf-ipcountry')||clean(c.code||c.alpha2||(typeof c==='string'?c:''));
  return /^[A-Za-z]{2}$/.test(v)?v.toUpperCase():'ZZ';
}
function ipForHash(event){return (firstHeader(event,'x-nf-client-connection-ip')||firstHeader(event,'client-ip')||firstHeader(event,'x-forwarded-for').split(',')[0]||'').slice(0,128);}
function osOf(event){const ua=firstHeader(event,'user-agent');if(/windows nt/i.test(ua))return 'windows';if(/android/i.test(ua))return 'android';if(/iphone|ipad|ipod/i.test(ua))return 'ios';if(/macintosh|mac os x/i.test(ua))return 'mac';if(/linux/i.test(ua))return 'linux';return 'unknown';}
function isCrawler(event){return /bot\b|crawler|spider|headless|monitor|lighthouse/i.test(firstHeader(event,'user-agent'));}
async function authorize(event){
  const user=await AdminAuth.resolveUser(event);
  if(!Array.isArray(user.roles)||!user.roles.some(role=>ADMIN_ROLES.has(clean(role).toLowerCase())))bad(403,'administrator_required');
  return user;
}
function validOfficialUrl(value){
  const url=clean(value);if(url.length>900)return false;
  try{
    const u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return false;
    if(u.hostname.toLowerCase()==='github.com')return /^\/samo429425-lab\/[A-Za-z0-9_.-]+\/releases\/(?:download\/[^?#]+|latest\/download\/[^?#]+)$/i.test(u.pathname);
    if(u.hostname.toLowerCase()==='igdcglobal.com'||u.hostname.toLowerCase()==='www.igdcglobal.com')return /^\/(?:downloads|assets\/downloads)\/[A-Za-z0-9_./%+()\-]+$/i.test(u.pathname)&&!u.pathname.includes('..');
    return false;
  }catch(_){return false;}
}
async function registry(){
  const data=await store('/rest/v1/'+REGISTRY+'?select=program,name,download_url,enabled,is_builtin&order=is_builtin.desc,name.asc&limit=250',{method:'GET'});
  return Array.isArray(data)?data:[];
}
async function programsForPublic(){
  try{
    const list=await registry();
    return result(200,{ok:true,programs:list.filter(p=>p.enabled).map(p=>({program:p.program,name:p.name,url:p.download_url||'',is_builtin:!!p.is_builtin}))});
  }catch(e){
    // Existing buttons continue to work before the optional expansion SQL is installed.
    if(e.code==='metrics_database_setup_required')return result(200,{ok:true,upgradeRequired:true,programs:DEFAULT_PROGRAMS.map(p=>({program:p.program,name:p.name,url:'',is_builtin:true}))});
    throw e;
  }
}
async function record(event,data){
  if(!sameOrigin(event))bad(403,'invalid_download_origin');
  if(isCrawler(event))return result(202,{ok:true,recorded:false,reason:'automated_agent'});
  const program=clean(data&&data.program);
  if(!ID_RE.test(program)||clean(data&&data.event)!=='download_click')bad(400,'invalid_download_event');
  // When the program registry is enabled, no unknown button/program can create events.
  // Prior to the expansion SQL, the two legacy program buttons remain operational.
  let allowed=false;
  try{allowed=(await registry()).some(p=>p.enabled&&p.program===program);}
  catch(e){if(e.code==='metrics_database_setup_required')allowed=DEFAULT_PROGRAMS.some(p=>p.program===program);else throw e;}
  if(!allowed)bad(400,'unknown_download_program');
  const now=Date.now(),minuteBucket=new Date(Math.floor(now/60000)*60000).toISOString(),day=new Date(now).toISOString().slice(0,10);
  const cfg=settings(),visitor=[ipForHash(event),clean(data&&data.session).slice(0,90)].join('|');
  const ua=firstHeader(event,'user-agent').slice(0,400);
  const dedupeKey=crypto.createHmac('sha256',cfg.key).update([day,visitor,ua].join('|')).digest('hex');
  await store('/rest/v1/'+TABLE+'?on_conflict=program,minute_bucket,dedupe_key',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify([{program,country_code:countryOf(event),os_family:osOf(event),minute_bucket:minuteBucket,dedupe_key:dedupeKey}])});
  return result(202,{ok:true,recorded:true,metric:'download_request'});
}
async function register(event,data){
  if(!sameOrigin(event))bad(403,'invalid_download_origin');
  await authorize(event);
  const program=clean(data&&data.program),name=clean(data&&data.name),url=clean(data&&data.url);
  if(!ID_RE.test(program)||name.length<2||name.length>100||!validOfficialUrl(url))bad(400,'invalid_program_registration');
  if(DEFAULT_PROGRAMS.some(p=>p.program===program))bad(409,'program_already_registered');
  const existing=await registry();
  if(existing.length>=200)bad(409,'program_limit_reached');
  if(existing.some(p=>p.program===program))bad(409,'program_already_registered');
  await store('/rest/v1/'+REGISTRY,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([{program,name,download_url:url,enabled:true,is_builtin:false}])});
  return result(201,{ok:true,program,name});
}
async function stats(event){
  await authorize(event);
  const q=event.queryStringParameters||{};
  if(q.view==='detail'){
    const period=clean(q.period||'30d'),program=clean(q.program||'all');
    if(!PERIODS.has(period)||!(program==='all'||ID_RE.test(program)))bad(400,'invalid_metrics_filter');
    const detail=await store('/rest/v1/rpc/maru_download_detail_v2',{method:'POST',body:JSON.stringify({p_period:period,p_program:program})});
    if(!detail||typeof detail!=='object'||!Array.isArray(detail.series))bad(503,'metrics_detail_unavailable');
    const list=await registry();
    return result(200,{ok:true,version:VERSION,metric:'download_requests_not_installs',programs:list.map(p=>({program:p.program,name:p.name,enabled:p.enabled})),...detail});
  }
  const data=await store('/rest/v1/rpc/maru_windows_download_summary_v1',{method:'POST',body:'{}'});
  if(!data||typeof data!=='object'||!data.byProgram)bad(503,'metrics_summary_unavailable');
  let list=DEFAULT_PROGRAMS;
  try{list=await registry();}catch(e){if(e.code!=='metrics_database_setup_required')throw e;}
  return result(200,{ok:true,version:VERSION,metric:'download_requests_not_installs',programs:list.map(p=>({program:p.program,name:p.name,enabled:p.enabled})),...data});
}
exports.handler=async(event)=>{
  try{
    const method=clean(event&&event.httpMethod).toUpperCase(),q=event.queryStringParameters||{};
    if(method==='GET'&&q.view==='programs')return await programsForPublic();
    if(method==='GET')return await stats(event);
    if(method==='POST'){
      if(!event.body||event.body.length>4096)bad(400,'invalid_request');
      let data;try{data=JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body);}catch(_){bad(400,'invalid_request');}
      if(data&&data.action==='register_program')return await register(event,data);
      return await record(event,data);
    }
    return result(405,{ok:false,error:'method_not_allowed'});
  }catch(e){return result(e.statusCode||500,{ok:false,error:e.code||'metrics_unavailable'});}
};
exports.__test={sameOrigin,countryOf,osOf,isCrawler,validOfficialUrl};
