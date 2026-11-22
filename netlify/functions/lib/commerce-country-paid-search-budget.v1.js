'use strict';
/** Country-local paid supplier lookup allowance. No payment/credit issuance.
 * Store atomic reservations in the existing private gslot_policies registry.
 * The allowance is cumulative and survives deployments/research restarts.
 * When a request result is uncertain, count it conservatively as potentially
 * billable. Stale reservations are retained for manual reconciliation.
 */
const crypto=require('crypto');
const Store=require('./global-slot-console-supabase');
const VERSION='igdc-country-paid-supplier-budget.v1';
const HUB='country-paid-supplier-budget';
const LIMITS=Object.freeze({auto:10,manual:5});
const PRICE_ESTIMATE_USD=0.005; // Historical Google CSE reference price, NOT live billing data.
const MAX_RETRIES=8;
const value=v=>v==null?'':String(v).trim();
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
const idFor=c=>'igdc_paid_supplier_search_'+value(c).toLowerCase();
function valid(country,kind){
  const c=value(country).toUpperCase();
  if(!/^[A-Z]{2}$/.test(c)||c==='KP')throw Object.assign(new Error('유효한 국가 코드가 필요합니다.'),{statusCode:400});
  if(kind&&!Object.prototype.hasOwnProperty.call(LIMITS,kind))throw Object.assign(new Error('유료 검색 유형이 올바르지 않습니다.'),{statusCode:400});
  return c;
}
function defaultRule(country){return{schema:VERSION,country,used:{auto:0,manual:0},pending:[],denied:0,lastProviderStatus:null,googleAccessBlockedUntil:null,aiAssistUsed:0,aiAssistPending:[],aiAssistLast:null,history:[]};}
async function rowFor(store,country){return arr(await store.select('gslot_policies','select=id,rule,updated_at&id=eq.'+encodeURIComponent(idFor(country))+'&limit=1'))[0]||null;}
async function createRow(store,country){
  const now=new Date().toISOString();
  await store.insert('gslot_policies',{id:idFor(country),name:'국가별 유료 책임공급업체 검색 사용량',scope_hub:HUB,scope_country:country,scope_region:null,enabled:true,rule:defaultRule(country),created_at:now,updated_at:now,updated_by:'supplier-budget-guard'},'resolution=ignore-duplicates,return=representation');
}
async function mutate(country,change,store=Store){
  const c=valid(country);
  for(let i=0;i<MAX_RETRIES;i++){
    let row=await rowFor(store,c);
    if(!row){await createRow(store,c);row=await rowFor(store,c);if(!row)continue;}
    const initial=obj(row.rule),state=Object.assign(defaultRule(c),initial,{used:Object.assign({auto:0,manual:0},obj(initial.used)),pending:arr(initial.pending).slice(),aiAssistPending:arr(initial.aiAssistPending).slice(),history:arr(initial.history).slice(-80)});
    const result=change(state);
    if(result&&result.noWrite)return result.response;
    const stamp=new Date(Math.max(Date.now(),Date.parse(value(row.updated_at))||0)+1).toISOString();
    const saved=arr(await store.update('gslot_policies','id=eq.'+encodeURIComponent(idFor(c))+'&updated_at=eq.'+encodeURIComponent(value(row.updated_at)),{rule:state,updated_at:stamp,updated_by:'supplier-budget-guard'}));
    if(saved.length===1)return result&&result.response;
  }
  throw Object.assign(new Error('유료 검색 사용량 동시 변경 충돌: 안전을 위해 호출을 차단했습니다.'),{statusCode:409});
}
function totals(rule){
  const state=obj(rule),used=obj(state.used),pending=arr(state.pending),out={};
  for(const kind of ['auto','manual']){
    const completed=Math.max(0,Number(used[kind])||0),reserved=pending.filter(p=>p&&p.kind===kind).length;
    out[kind]={limit:LIMITS[kind],used:completed,pending:reserved,remaining:Math.max(0,LIMITS[kind]-completed-reserved)};
  }
  return out;
}
async function reserve(country,kind,store=Store){
  valid(country,kind);
  const token=crypto.randomUUID();
  return mutate(country,state=>{
    const now=Date.now(),cooldown=Date.parse(value(state.googleAccessBlockedUntil))||0;
    if(cooldown>now)return{noWrite:true,response:{allowed:false,reason:'google_permission_cooldown',retryAt:state.googleAccessBlockedUntil}};
    if(totals(state)[kind].remaining<=0)return{noWrite:true,response:{allowed:false,reason:'country_paid_supplier_limit_reached'}};
    state.pending.push({id:token,kind,at:new Date().toISOString()});
    state.history.push({at:new Date().toISOString(),kind,event:'reserved'});
    return{response:{allowed:true,token,kind,country:valid(country),remaining:totals(state)[kind].remaining}};
  },store);
}
async function settle(country,token,status,store=Store){
  const statusText=value(status).toLowerCase()||'unknown';
  return mutate(country,state=>{
    const i=state.pending.findIndex(p=>p&&p.id===token);
    if(i<0)return{noWrite:true,response:{settled:false,reason:'reservation_missing'}};
    const item=state.pending.splice(i,1)[0];
    const nonBillable=['not_configured','http_401','http_403','http_429','invalid_query','google_permission_cooldown','country_paid_supplier_limit_reached'].includes(statusText);
    if(nonBillable){state.denied=Math.max(0,Number(state.denied)||0)+1;if(statusText==='http_403'||statusText==='http_401'||statusText==='http_429')state.googleAccessBlockedUntil=new Date(Date.now()+(statusText==='http_429'?6:3)*60*60*1000).toISOString();}
    else state.used[item.kind]=Math.max(0,Number(state.used[item.kind])||0)+1;
    state.lastProviderStatus=statusText;
    state.history.push({at:new Date().toISOString(),kind:item.kind,event:nonBillable?'rejected_or_quota_denied_not_estimated_billed':'potentially_billable_search',status:statusText});
    return{response:{settled:true,billableCounted:!nonBillable,kind:item.kind,totals:totals(state)}};
  },store);
}
async function status(country,store=Store){
  const c=valid(country),row=await rowFor(store,c),rule=row?obj(row.rule):defaultRule(c),parts=totals(rule),used=parts.auto.used+parts.manual.used;
  return{ok:true,country:c,auto:parts.auto,manual:parts.manual,used,estimatedSpentUsd:Number((used*PRICE_ESTIMATE_USD).toFixed(4)),estimatedRemainingAllowableUsd:Number(((parts.auto.remaining+parts.manual.remaining)*PRICE_ESTIMATE_USD).toFixed(4)),priceEstimateUsd:PRICE_ESTIMATE_USD,priceSource:'historical_reference_not_live_google_invoice',actualGoogleBalanceUsd:null,actualOpenAiBalanceUsd:null,googleAccessBlockedUntil:rule.googleAccessBlockedUntil||null,denied:Number(rule.denied)||0,aiAssist:{used:Number(rule.aiAssistUsed)||0,pending:arr(rule.aiAssistPending).length,remaining:Math.max(0,1-(Number(rule.aiAssistUsed)||0)-arr(rule.aiAssistPending).length),last:rule.aiAssistLast||null}};
}
async function aggregate(store=Store,countryCodes=null){
  const allowed=Array.isArray(countryCodes)?new Set(countryCodes.map(c=>value(c).toUpperCase())):null;
  const all=[];for(let offset=0;offset<300;offset+=100){const rows=arr(await store.select('gslot_policies','select=scope_country,rule&scope_hub=eq.'+HUB+'&order=id.asc&limit=100&offset='+offset));all.push(...rows);if(rows.length<100)break;}
  const filtered=allowed?all.filter(row=>allowed.has(value(row.scope_country).toUpperCase())):all;
  const totalsAll={autoUsed:0,manualUsed:0,pending:0,estimatedSpentUsd:0,records:filtered.length};
  for(const row of filtered){const counts=totals(row.rule);totalsAll.autoUsed+=counts.auto.used;totalsAll.manualUsed+=counts.manual.used;totalsAll.pending+=counts.auto.pending+counts.manual.pending;}
  const selectedCount=allowed?allowed.size:null;
  totalsAll.selectedCountryCount=selectedCount;
  totalsAll.basicAllowanceCount=selectedCount!=null?selectedCount*(LIMITS.auto+LIMITS.manual):null;
  totalsAll.remainingAllowanceCount=selectedCount!=null?Math.max(0,totalsAll.basicAllowanceCount-totalsAll.autoUsed-totalsAll.manualUsed-totalsAll.pending):null;
  totalsAll.estimatedSpentUsd=Number(((totalsAll.autoUsed+totalsAll.manualUsed)*PRICE_ESTIMATE_USD).toFixed(4));
  return{ok:true,...totalsAll,priceEstimateUsd:PRICE_ESTIMATE_USD,priceSource:'historical_reference_not_live_google_invoice',actualGoogleBalanceUsd:null,actualOpenAiBalanceUsd:null};
}
async function reserveAi(country,store=Store){
  const token=crypto.randomUUID();
  return mutate(country,state=>{
    if(Number(state.aiAssistUsed||0)+state.aiAssistPending.length>=1)return{noWrite:true,response:{allowed:false,reason:'country_ai_assist_once_used'}};
    state.aiAssistPending.push({id:token,at:new Date().toISOString()});
    return{response:{allowed:true,token}};
  },store);
}
async function settleAi(country,token,result,store=Store){
  return mutate(country,state=>{
    const idx=state.aiAssistPending.findIndex(x=>x&&x.id===token);
    if(idx<0)return{noWrite:true,response:{settled:false}};
    state.aiAssistPending.splice(idx,1);
    if(result&&result.called===true)state.aiAssistUsed=Math.max(0,Number(state.aiAssistUsed)||0)+1;
    state.aiAssistLast={at:new Date().toISOString(),status:value(result&&result.status)||'unknown',tokens:Math.max(0,Number(result&&result.tokens)||0)};
    return{response:{settled:true,aiAssistRemaining:Math.max(0,1-state.aiAssistUsed)}};
  },store);
}
module.exports={VERSION,LIMITS,PRICE_ESTIMATE_USD,totals,status,aggregate,reserve,settle,reserveAi,settleAi,create:store=>({status:c=>status(c,store),reserve:(c,k)=>reserve(c,k,store),settle:(c,t,s)=>settle(c,t,s,store),reserveAi:c=>reserveAi(c,store),settleAi:(c,t,r)=>settleAi(c,t,r,store)})};
