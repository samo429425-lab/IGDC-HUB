'use strict';
const crypto=require('crypto');
const paddle=require('./maru-paddle-windows');
function header(event,key){return String(Object.entries(event.headers||{}).find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1]||'');}
function isWindows(event){return header(event,'X-MARU-Client')==='MARU-Media-Player' && header(event,'X-MARU-Client-Version')==='v96-site-oauth';}
function authError(code,statusCode=402){const e=new Error(code);e.statusCode=statusCode;e.code=code;return e;}
function body(event){try{return JSON.parse(event.body||'{}');}catch{return {};}}
function unitsFor(event,action){
 const val=body(event),purpose=String(action||'').toLowerCase();
 if(['license-check','status','health','ping'].includes(purpose))return 0;
 if(['generate-subtitle','subtitle','transcribe'].includes(purpose)){
   const s=Number(val.chunkDurationSeconds);return Number.isFinite(s)&&s>0?Math.min(1000,s/60):0.5;
 }
 if(purpose.includes('translate')){
  const raw=String(val.subtitle||val.text||'');
  const cueRe=/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;
  let totalSeconds=0;
  for(const m of raw.matchAll(cueRe)){
    const left=Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4].padEnd(3,'0'))/1000;
    const right=Number(m[5])*3600+Number(m[6])*60+Number(m[7])+Number(m[8].padEnd(3,'0'))/1000;
    totalSeconds+=Math.max(0,Math.min(1800,right-left));
  }
  const minutes=totalSeconds>0?Math.max(.25,totalSeconds/60):Math.max(.25,raw.length/900);
  return Math.min(1000,minutes*.15);
 }
 return 0;
}
async function windowsPaidAccess(event,member,purpose){
 if(!isWindows(event))return null;
 if(!paddle.configured())throw authError('paddle_not_ready',503);
 const balance=await paddle.rpc('maru_paddle_win_balance',{p_user_id:member.userId});
 if(balance?.active!==true)throw authError('ai_membership_required');
 const action=String(purpose||'').toLowerCase();
 if(/dubbing|tts|speech|video-enhancement/.test(action))throw authError('feature_not_in_plan',403);
 const units=unitsFor(event,action);
 let creditUsage=null;
 if(units>0){
  const client=body(event);
  const salt=String(client.creditEventKey||client.jobId||'').slice(0,120);
  const digest=crypto.createHash('sha256')
    .update(`${member.userId}|${action}|${salt}|${event.body||''}`).digest('hex');
  const charged=await paddle.rpc('maru_paddle_win_use',{
   p_user_id:member.userId,p_usage_key:digest,p_units:Math.max(.001,Math.round(units*1000)/1000)
  });
  if(charged?.allowed!==true)throw authError(charged?.reason==='insufficient_credits'?'ai_credits_exhausted':charged?.reason==='usage_previously_refunded'?'usage_retry_requires_new_key':'ai_membership_required');
  creditUsage={charged:charged.charged===true,eventHash:digest};
 }
 return {...member,allowed:true,accessClass:'paddle_windows_paid_member',plan:balance.plan==='premium'?'PADDLE_PREMIUM':'PADDLE_PRO',
   pgReady:true,googlePlayReady:false,monthlyCreditUnits:balance.plan==='premium'?1200:400,
   usageRemaining:Math.max(0,Number(balance.monthly||0)+Number(balance.extra||0)-(creditUsage?.charged?units:0)),
   paddlePeriodEnd:balance.period_end,creditUsage};
}
module.exports={isWindows,windowsPaidAccess,unitsFor};
