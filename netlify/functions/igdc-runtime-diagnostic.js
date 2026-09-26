"use strict";

const AdminSession=require("./lib/global-slot-console-auth");
const SlotStore=require("./lib/global-slot-console-supabase");

const VERSION="igdc-runtime-diagnostic-v1.3.0-canonical-product-source-ref";
const ROLES=new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager"]);
function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase();}
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"},body:JSON.stringify(body)};}
function roles(actor){return Array.from(new Set((actor&&actor.roles||[]).map(lower).filter(Boolean)));}
function safeEnvFlag(name){return !!text(process.env[name]);}
function header(event,name){const h=event&&event.headers||{};return h[name]||h[name.toLowerCase()]||h[name.toUpperCase()]||"";}
async function supabaseProbe(name,path,timeoutMs){
  const started=Date.now();let timer=null,controller=null;
  try{
    const cfg=SlotStore.config();controller=new AbortController();timer=setTimeout(()=>controller.abort(),timeoutMs||7000);
    const response=await fetch(cfg.url+path,{method:"GET",signal:controller.signal,headers:{apikey:cfg.serviceKey,Authorization:"Bearer "+cfg.serviceKey,Accept:"application/json"}});
    const raw=await response.text();
    return{name,ok:response.ok,status:response.status,ms:Date.now()-started,bytes:Buffer.byteLength(raw||"","utf8"),error:response.ok?null:(raw||("HTTP "+response.status)).slice(0,300)};
  }catch(error){return{name,ok:false,status:0,ms:Date.now()-started,bytes:0,error:error&&error.name==="AbortError"?"timeout":text(error&&error.message||error).slice(0,300)};}
  finally{if(timer)clearTimeout(timer);}
}
exports.handler=async function(event){
  const started=Date.now();
  try{
    const actor=await AdminSession.resolveUser(event),actorRoles=roles(actor);
    if(!actorRoles.some((role)=>ROLES.has(role)))return json(403,{ok:false,error:"administrator_required"});
    const query=event.queryStringParameters||{},country=text(query.country).toUpperCase(),region=text(query.region||"NATIONWIDE").toUpperCase();
    const sourceRef="country-product-ranking-review";
    const candidateScope=country&&/^[A-Z]{2}$/.test(country)?"&source_payload->marketScope->>marketCountry=eq."+encodeURIComponent(country)+"&source_payload->marketScope->>marketRegion=eq."+encodeURIComponent(region||"NATIONWIDE"):"";
    const probes=[];
    probes.push(await supabaseProbe("candidates_scope_sample","/rest/v1/gslot_candidates?select=id,status,updated_at&source_ref=eq."+encodeURIComponent(sourceRef)+candidateScope+"&order=updated_at.desc&limit=3",6500));
    probes.push(await supabaseProbe("candidates_source_ref_unfiltered","/rest/v1/gslot_candidates?select=id,status,updated_at,source_payload&source_ref=eq."+encodeURIComponent(sourceRef)+"&order=updated_at.desc&limit=3",6500));
    // Exercise the same source_payload shape used by the administrator candidate
    // fast path, including a deep offset where the 600-row KR ledger previously
    // appeared disconnected. These are read-only DB probes.
    probes.push(await supabaseProbe("candidate_management_page_first25","/rest/v1/gslot_candidates?select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at&source_ref=eq."+encodeURIComponent(sourceRef)+candidateScope+"&order=updated_at.desc,id.asc&limit=25&offset=0",9000));
    probes.push(await supabaseProbe("candidate_management_page_offset500","/rest/v1/gslot_candidates?select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at&source_ref=eq."+encodeURIComponent(sourceRef)+candidateScope+"&order=updated_at.desc,id.asc&limit=25&offset=500",9000));
    probes.push(await supabaseProbe("assignments_sample","/rest/v1/gslot_slot_assignments?select=id,candidate_id,publication_status,updated_at&order=updated_at.desc&limit=3",6500));
    probes.push(await supabaseProbe("availability_sample","/rest/v1/gslot_candidate_availability?select=candidate_id,availability_state,updated_at&order=updated_at.desc&limit=3",6500));
    probes.push(await supabaseProbe("revenue_sample","/rest/v1/gslot_candidate_revenue?select=id,candidate_id,status,updated_at&order=updated_at.desc&limit=3",6500));
    probes.push(await supabaseProbe("evidence_sample","/rest/v1/gslot_candidate_evidence?select=id,candidate_id,verified,created_at&order=created_at.desc&limit=3",6500));
    const memory=process.memoryUsage();
    return json(200,{ok:probes.every((row)=>row.ok),reportType:"igdc-netlify-runtime-diagnostic",version:VERSION,generatedAt:new Date().toISOString(),scope:{country:country||null,region:region||null},deploy:{commitRef:text(process.env.COMMIT_REF)||null,deployId:text(process.env.DEPLOY_ID)||null,context:text(process.env.CONTEXT)||null,siteName:text(process.env.SITE_NAME)||null,branch:text(process.env.BRANCH)||null,nodeVersion:process.version,region:text(process.env.AWS_REGION||process.env.AWS_DEFAULT_REGION)||null},environment:{supabaseUrlConfigured:safeEnvFlag("GSLOT_SUPABASE_URL"),supabaseServiceKeyConfigured:safeEnvFlag("GSLOT_SUPABASE_SECRET_KEY")||safeEnvFlag("GSLOT_SUPABASE_SERVICE_ROLE_KEY")||safeEnvFlag("GSLOT_SUPABASE_SERVICE_KEY")},request:{countryHeader:text(header(event,"x-nf-country")||header(event,"cf-ipcountry"))||null,requestId:text(header(event,"x-nf-request-id"))||null,userAgent:text(header(event,"user-agent")).slice(0,180)||null},runtime:{totalMs:Date.now()-started,uptimeSeconds:Math.round(process.uptime()),rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,heapTotalBytes:memory.heapTotal},probes,safety:{readOnly:true,secretsReturned:false,mutatesDatabase:false,publicAccess:false}});
  }catch(error){return json(Number(error&&error.statusCode)||500,{ok:false,reportType:"igdc-netlify-runtime-diagnostic-error",version:VERSION,generatedAt:new Date().toISOString(),error:text(error&&error.message||error),runtime:{totalMs:Date.now()-started},safety:{readOnly:true,secretsReturned:false,mutatesDatabase:false}});}
};
