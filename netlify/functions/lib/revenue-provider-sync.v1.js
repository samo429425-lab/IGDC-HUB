"use strict";

const Registry = require("./revenue-provider-registry.v1");
const Confirmed = require("./confirmed-revenue-event.v1");

const VERSION = "revenue-provider-sync-v1.0.0";
const COST_FIELDS = [
  ["taxAmount","tax"],
  ["withholdingAmount","withholding"],
  ["providerFeeAmount","provider_fee"],
  ["fxFeeAmount","fx_fee"],
  ["otherCostAmount","other_cost"]
];

function text(v){ return v==null?"":String(v).trim(); }
function getPath(obj,p){ return Registry.getPath(obj,p); }
function lower(v){ return text(v).toLowerCase(); }
function arrayAt(body,path){ const value=path?getPath(body,path):body; return Array.isArray(value)?value:[]; }
function stateFor(raw,p){ const v=lower(raw); if(p.confirmedValues.includes(v)) return "confirmed"; if(p.reversedValues.includes(v)) return "reversed"; return "pending"; }
function exactPositive(value,scale){ const p=Confirmed.parseDecimal(value,scale); return p.ok&&p.units>0n?p:null; }
function exactForState(value,scale,state){
  const p=Confirmed.parseDecimal(value,scale);
  if(!p.ok || p.units===0n) return null;
  if(state!=="reversed" && p.units<0n) return null;
  if(p.units<0n){ p.units=-p.units; p.canonical=p.canonical.replace(/^-/ ,""); }
  return p;
}
function addSince(endpoint, provider, nowMs){
  if(!provider.sinceParam) return endpoint;
  const u=new URL(endpoint);
  const since=new Date(nowMs-provider.lookbackHours*3600000).toISOString();
  u.searchParams.set(provider.sinceParam,since);
  return u.toString();
}
function authHeaders(p, env){
  const out={Accept:"application/json"};
  if(p.authType==="none") return out;
  const secret=text((env||process.env)[p.authEnv]);
  out[p.authHeader || "Authorization"]=(p.authPrefix||"")+secret;
  return out;
}
async function fetchProvider(p,deps){
  const fetchFn=deps&&deps.fetch || global.fetch;
  const env=deps&&deps.env || process.env;
  const now=deps&&deps.now ? deps.now() : Date.now();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),p.timeoutMs);
  try{
    const res=await fetchFn(addSince(p.endpoint,p,now),{method:"GET",headers:authHeaders(p,env),redirect:"error",signal:controller.signal});
    const raw=await res.text();
    let body=null; try{ body=raw?JSON.parse(raw):null; }catch(_e){}
    if(!res.ok) return {ok:false,status:res.status,error:"provider_http_error"};
    if(body==null) return {ok:false,status:502,error:"provider_invalid_json"};
    return {ok:true,status:res.status,body};
  }catch(error){ return {ok:false,status:503,error:error&&error.name==="AbortError"?"provider_timeout":"provider_fetch_failed"}; }
  finally{ clearTimeout(timer); }
}
function normalizeEvent(item,p){
  const f=p.fields||{};
  const eventId=Confirmed.cleanId(getPath(item,f.eventId||"eventId") || item.eventId || item.id || item.receiptId);
  const state=stateFor(getPath(item,f.status||"status") || item.status,p);
  const amountRaw=getPath(item,f.amount||"amount") ?? item.amount;
  const amount=exactForState(amountRaw,p.maxAmountScale,state);
  const currency=Confirmed.cleanCurrency(getPath(item,f.currency||"currency") || item.currency || p.defaultCurrency);
  const kind=Confirmed.cleanKind(getPath(item,f.kind||"kind") || item.kind || p.defaultKind);
  const originalEventId=Confirmed.cleanId(getPath(item,f.originalEventId||"originalEventId") || item.originalEventId || item.reversalOf);
  const ts=text(getPath(item,f.timestamp||"timestamp") || item.timestamp || item.ts || new Date().toISOString());
  const blockers=[];
  if(!eventId) blockers.push("event_id_missing");
  if(state==="pending") blockers.push("not_confirmed");
  if(!amount) blockers.push("amount_invalid");
  if(!currency) blockers.push("currency_invalid");
  if(!kind || Confirmed.invalidKind(kind)) blockers.push("kind_invalid");
  if(state==="reversed"&&!originalEventId) blockers.push("reversal_original_missing");
  return {ok:blockers.length===0,blockers,eventId,state,amount,currency,kind,originalEventId,ts,item};
}
async function persistMain(evt,p,deps){
  const source=p.sourcePrefix||p.id;
  const note=evt.state==="reversed"?`provider:${source}:${evt.originalEventId}:reversal:${evt.eventId}`:`provider:${source}:${evt.eventId}`;
  const originalNote=evt.state==="reversed"?`provider:${source}:${evt.originalEventId}`:null;
  return Confirmed.persist({source,eventId:evt.eventId,state:evt.state,kind:evt.kind,amount:evt.amount.canonical,currency:evt.currency,channel:"provider_sync",note,originalNote,reversalPrefix:evt.state==="reversed"?`provider:${source}:${evt.originalEventId}:reversal:`:null,ts:evt.ts,maxScale:p.maxAmountScale},deps&&deps.confirmedDeps);
}
async function persistCosts(evt,p,deps){
  if(evt.state!=="confirmed") return [];
  const results=[];
  const source=p.sourcePrefix||p.id;
  for(const [field,label] of COST_FIELDS){
    const path=p.financialFields&&p.financialFields[field];
    if(!path) continue;
    const parsed=exactPositive(getPath(evt.item,path),p.maxAmountScale);
    if(!parsed) continue;
    const costId=`${evt.eventId}:${label}`;
    const saved=await Confirmed.persist({source,eventId:costId,state:"cost",kind:`${evt.kind}_${label}`,amount:parsed.canonical,currency:evt.currency,channel:"provider_sync_cost",note:`provider:${source}:${evt.eventId}:cost:${label}`,ts:evt.ts,maxScale:p.maxAmountScale},deps&&deps.confirmedDeps);
    results.push({label,ok:saved.ok,error:saved.error||null,duplicate:saved.duplicate===true});
  }
  return results;
}
async function syncProvider(p,deps){
  const pulled=await fetchProvider(p,deps);
  if(!pulled.ok) return {providerId:p.id,ok:false,error:pulled.error,status:pulled.status,seen:0,recorded:0,duplicates:0,pending:0,rejected:0,costRows:0};
  const rows=arrayAt(pulled.body,p.fields&&p.fields.arrayPath);
  const summary={providerId:p.id,ok:true,seen:rows.length,recorded:0,duplicates:0,pending:0,rejected:0,costRows:0,errors:[]};
  for(const row of rows){
    const evt=normalizeEvent(row,p);
    if(evt.blockers.includes("not_confirmed")){ summary.pending++; continue; }
    if(!evt.ok){ summary.rejected++; summary.errors.push({eventId:evt.eventId||null,blockers:evt.blockers}); continue; }
    const saved=await persistMain(evt,p,deps);
    if(!saved.ok){ summary.rejected++; summary.errors.push({eventId:evt.eventId,error:saved.error||"persist_failed"}); continue; }
    if(saved.duplicate) summary.duplicates++; else summary.recorded++;
    if(!saved.duplicate && p.amountBasis==="gross"){
      const costs=await persistCosts(evt,p,deps);
      summary.costRows += costs.filter(x=>x.ok&&!x.duplicate).length;
      const failed=costs.filter(x=>!x.ok); if(failed.length){ summary.ok=false; summary.errors.push({eventId:evt.eventId,costErrors:failed}); }
    }
  }
  return summary;
}
async function run(deps){
  const env=deps&&deps.env || process.env;
  const providers=Registry.activeValid(env);
  const invalid=Registry.list(env).filter(x=>x.active&&!x.valid).map(x=>({providerId:x.id||null,errors:x.errors}));
  const results=[];
  for(const p of providers) results.push(await syncProvider(p,deps));
  return {ok:invalid.length===0&&results.every(x=>x.ok),version:VERSION,generatedAt:new Date().toISOString(),providers:results,invalidProviders:invalid};
}

module.exports={VERSION,run,syncProvider,fetchProvider,normalizeEvent,stateFor};
