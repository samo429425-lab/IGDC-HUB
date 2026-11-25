'use strict';
// One durable lease for the four scheduled commerce lanes. No schema change.
// DB pressure is inferred from actual REST failures, NOT from CPU telemetry.
const {AsyncLocalStorage}=require('node:async_hooks');
const crypto=require('node:crypto');
const ctx=new AsyncLocalStorage();
const ID='commerce_scheduler_db_guard_v1', HUB='country-commerce-scheduler-guard';
const ACTOR='scheduled-commerce-db-guard', LEASE_MS=90000, RECOVERY_MS=20*60000;
const fields='select=id,rule,updated_at&id=eq.'+ID+'&limit=1';
const date=v=>new Date(v).toISOString();
const ts=v=>Date.parse(v)||0;
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function pressure(error){
  const status=Number(error&&error.statusCode||error&&error.status||0);
  const code=String(error&&error.dbCode||error&&error.code||'');
  const msg=String(error&&error.name||'')+' '+String(error&&error.message||error||'');
  return /^(57014|55P03|40P01|53300|57P0[123]|08\w{3})$/.test(code)||[429,500,502,503,504].includes(status)||/statement timeout|lock timeout|deadlock detected|broken pipe|connection reset|fetch failed|ECONNRESET|ETIMEDOUT|AbortError|TimeoutError/i.test(msg);
}
function noteDbError(error){const state=ctx.getStore();if(state&&pressure(error)){state.failures++;state.reason='database_transport_or_pressure';}}
function requestSignal(method){const state=ctx.getStore();if(!state)return undefined;if(state.guardIO)return AbortSignal.timeout(5000);return String(method||'GET').toUpperCase()==='GET'?AbortSignal.timeout(10000):undefined;}
function scopeBatchLimit(max){const state=ctx.getStore();return state&&(state.recovery||state.failures)?1:max;}
function storeDefault(){return require('./global-slot-console-supabase');}
function create({store=storeDefault(),now=Date.now,token=()=>crypto.randomBytes(16).toString('hex'),paused=()=>/^(1|true|yes)$/i.test(String(process.env.IGDC_COMMERCE_SCHEDULER_PAUSE||''))}={}){
  let localUntil=0;
  const read=async()=>{const rows=await store.select('gslot_policies',fields);if(!Array.isArray(rows)||rows.length>1)throw new Error('scheduler_guard_invalid_read');return rows[0]||null;};
  const io=fn=>ctx.run({guardIO:true,failures:0},fn);
  const revision=(row,t)=>date(Math.max(t,ts(row.updated_at)+1));
  const save=(row,rule,t)=>store.update('gslot_policies','id=eq.'+ID+'&updated_at=eq.'+encodeURIComponent(row.updated_at),{rule,updated_at:revision(row,t),updated_by:ACTOR});
  function skip(reason,extra){return Object.assign({ok:true,skipped:true,reason,processed:0,results:[],automationProtection:{state:reason}},extra||{});}
  async function run(lane,work){
    if(paused())return skip('environment_pause');
    if(now()<localUntil)return skip('local_backoff');
    let row,claim;
    try{
      row=await io(read);
      if(!row){const t=date(now());await io(()=>store.insert('gslot_policies',{id:ID,name:'유통 예약 작업 공통 부하 보호',scope_hub:HUB,scope_country:null,scope_region:null,enabled:true,rule:{schema:ID,failures:0},created_at:t,updated_at:t,updated_by:ACTOR},'resolution=ignore-duplicates,return=minimal'));row=await io(read);}
      if(!row||!row.updated_at)throw new Error('scheduler_guard_missing');
      const prior=obj(row.rule),t=now();
      if(ts(prior.cooldownUntil)>t)return skip('database_cooldown',{resumeAfter:prior.cooldownUntil});
      if(ts(prior.leaseUntil)>t)return skip('another_worker_active',{resumeAfter:prior.leaseUntil});
      const owner=token(),next=Object.assign({},prior,{schema:ID,lane,leaseToken:owner,leaseUntil:date(t+LEASE_MS),lastStartedAt:date(t)});
      const written=await io(()=>save(row,next,t));
      if(!Array.isArray(written)||written.length!==1||obj(written[0].rule).leaseToken!==owner||!written[0].updated_at)return skip('lease_conflict');
      claim=written[0];
    }catch(error){localUntil=now()+60000;return skip('guard_unavailable',{guardError:true});}
    const state={failures:0,recovery:ts(obj(claim.rule).recoveryUntil)>now(),reason:null};
    let result,thrown;
    try{result=await ctx.run(state,work);}catch(error){thrown=error;}
    const failed=state.failures>0||(thrown&&pressure(thrown));
    const old=obj(claim.rule),t=now(),streak=failed?Math.min(6,Math.max(0,Number(old.failures)||0)+1):0;
    const delay=failed?Math.min(30,5*Math.pow(2,streak-1))*60000:0;
    const next=Object.assign({},old,{leaseToken:null,leaseUntil:null,lastFinishedAt:date(t),lastLane:lane,
      lastOutcome:failed?'db_pressure':thrown||result&&result.ok===false?'worker_error':'completed',
      failures:streak,lastDbErrors:state.failures,cooldownUntil:failed?date(t+delay):null,
      recoveryUntil:failed?date(t+delay+RECOVERY_MS):ts(old.recoveryUntil)>t?old.recoveryUntil:null});
    let saved=false;
    try{const rows=await io(()=>save(claim,next,t));saved=Array.isArray(rows)&&rows.length===1;}catch(_error){localUntil=t+60000;}
    if(thrown)throw thrown;
    return Object.assign({},result,{automationProtection:{state:failed?'database_cooldown':state.recovery?'recovery':'normal',dbErrors:state.failures,checkpointSaved:saved,resumeAfter:next.cooldownUntil,globalLease:true}});
  }
  async function status(){try{const row=await io(read);if(!row)return{state:'not_initialized',cpuMeasured:false};const r=obj(row.rule),t=now();return{state:paused()?'environment_pause':ts(r.cooldownUntil)>t?'database_cooldown':ts(r.leaseUntil)>t?'worker_active':ts(r.recoveryUntil)>t?'recovery':'normal',lane:r.lane||null,lastLane:r.lastLane||null,lastStartedAt:r.lastStartedAt||null,lastFinishedAt:r.lastFinishedAt||null,lastOutcome:r.lastOutcome||null,cooldownUntil:r.cooldownUntil||null,recoveryUntil:r.recoveryUntil||null,lastDbErrors:Number(r.lastDbErrors)||0,cpuMeasured:false};}catch(_error){return{state:'guard_unavailable',cpuMeasured:false};}}
  return{run,status};
}
let singleton;
const instance=()=>singleton||(singleton=create());
module.exports={ID,HUB,create,run:(lane,work)=>instance().run(lane,work),status:()=>instance().status(),noteDbError,requestSignal,scopeBatchLimit,pressure};
