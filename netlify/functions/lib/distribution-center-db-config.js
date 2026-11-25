'use strict';
// Phase 28: use the existing IGDC slot database only when no dedicated pair is set.
// Never combine a URL from one configuration with a key from another.
const clean=v=>String(v??'').trim();
function resolve(env=process.env){
 const du=clean(env.DCENTER_SUPABASE_URL),dk=clean(env.DCENTER_SUPABASE_SERVICE_KEY);
 const explicit=Boolean(du||dk);
 const raw=explicit?du:clean(env.GSLOT_SUPABASE_URL);
 const key=explicit?dk:clean(env.GSLOT_SUPABASE_SECRET_KEY)||clean(env.GSLOT_SUPABASE_SERVICE_ROLE_KEY)||clean(env.GSLOT_SUPABASE_SERVICE_KEY);
 if(!raw||!key)throw Object.assign(Error('유통센터 DB 연결 설정이 필요합니다.'),{statusCode:503,code:explicit?'dcenter_partial_config':'dcenter_missing_config'});
 let u;try{u=new URL(raw);}catch{}
 if(!u||u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!/^\/*$/.test(u.pathname))throw Object.assign(Error('유통센터 DB URL 설정을 확인하세요.'),{statusCode:503,code:'dcenter_invalid_url'});
 return {url:u.origin,key,source:explicit?'dedicated':'existing_igdc'};
}
function status(env=process.env){try{return {configured:true,source:resolve(env).source};}catch(e){return {configured:false,source:null,code:e.code||'dcenter_config_error'};}}
module.exports={resolve,status};
