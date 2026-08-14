"use strict";

/**
 * Fail-closed bridge from an administrator-stored media snapshot release to
 * the existing Netlify production build pipeline. The hook URL and release
 * key remain server-only.
 */
const VERSION="media-release-dispatch-v1.2.0-admin-authorized-hook-diagnostics";
const HOOK_ENVS=Object.freeze([
  "MEDIA_RELEASE_BUILD_HOOK_URL",
  "NETLIFY_BUILD_HOOK_URL",
  "NETLIFY_DEPLOY_HOOK_URL",
  "BUILD_HOOK_URL",
  "COMMERCE_RELEASE_BUILD_HOOK_URL"
]);
const HOOK_ENV=HOOK_ENVS.find((name)=>String(process.env[name]||"").trim())||HOOK_ENVS[0];
const MODE_ENV="MEDIA_RELEASE_MODE";
const KEY_ENV="MEDIA_RELEASE_KEY";

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase();}
function configuredHook(){
  for(const name of HOOK_ENVS){
    const value=text(process.env[name]);
    if(value)return{name,value};
  }
  return{name:HOOK_ENVS[0],value:""};
}
function releaseArmed(input){
  const mode=lower(process.env[MODE_ENV]);
  const key=text(process.env[KEY_ENV]);
  const environmentArmed=mode==="enabled"&&key.length>=32;
  const explicitAdminAuthorization=!!(input&&input.explicitAdminAuthorization===true);
  return{
    armed:environmentArmed||explicitAdminAuthorization,
    mode:environmentArmed?mode:(explicitAdminAuthorization?"explicit_admin_confirmation":mode),
    keyPresent:key.length>=32,
    environmentArmed,
    explicitAdminAuthorization
  };
}

function configurationStatus(){
  const configured=configuredHook();
  const envGate=releaseArmed({explicitAdminAuthorization:false});
  return {
    version:VERSION,
    environmentArmed:!!envGate.environmentArmed,
    explicitAdminActionSupported:true,
    hookConfigured:!!configured.value,
    hookSource:configured.value?configured.name:null,
    hookValid:!!validHook(configured.value),
    mode:envGate.mode||"",
    keyPresent:!!envGate.keyPresent
  };
}

function validHook(raw){
  try{
    const url=new URL(text(raw));
    return url.protocol==="https:"&&url.hostname==="api.netlify.com"&&/^\/build_hooks\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)?url:null;
  }catch(_error){return null;}
}
function safeReason(error){
  const message=text(error&&error.message||error);
  return/abort|timeout/i.test(message)?"build_hook_timeout":"build_hook_request_failed";
}
async function dispatch(input){
  const release=releaseArmed(input);
  const configured=configuredHook();
  if(!release.armed){
    return{ok:true,queued:false,version:VERSION,reason:"release_gate_not_armed",releaseGate:release,hookConfigured:!!configured.value,hookSource:configured.value?configured.name:null};
  }
  const hook=validHook(configured.value);
  if(!hook){
    return{
      ok:true,queued:false,version:VERSION,
      reason:configured.value?"build_hook_invalid":"build_hook_not_configured",
      releaseGate:release,hookConfigured:false,hookSource:configured.value?configured.name:null
    };
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  const fetchImpl=input&&input.fetch||global.fetch;
  if(typeof fetchImpl!=="function"){
    clearTimeout(timeout);
    return{ok:false,queued:false,version:VERSION,reason:"fetch_unavailable",releaseGate:release,hookConfigured:true,hookSource:configured.name};
  }
  const payload={
    trigger:"approved-media-snapshot-release",
    releaseId:text(input&&input.releaseId)||null,
    snapshotHash:text(input&&input.snapshotHash)||null,
    actorId:text(input&&input.actorId)||null,
    authorization:release.explicitAdminAuthorization?"explicit_admin_confirmation":"deployment_release_gate",
    requestedAt:new Date().toISOString()
  };
  try{
    const response=await fetchImpl(hook.toString(),{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(payload),
      signal:controller.signal
    });
    const queued=response.status>=200&&response.status<300;
    return{
      ok:queued,queued,version:VERSION,
      reason:queued?"build_hook_queued":"build_hook_http_"+response.status,
      status:response.status,releaseGate:release,hookConfigured:true,hookSource:configured.name
    };
  }catch(error){
    return{ok:false,queued:false,version:VERSION,reason:safeReason(error),releaseGate:release,hookConfigured:true,hookSource:configured.name};
  }finally{clearTimeout(timeout);}
}

module.exports={VERSION,HOOK_ENVS,HOOK_ENV,MODE_ENV,KEY_ENV,configuredHook,configurationStatus,releaseArmed,validHook,dispatch};
