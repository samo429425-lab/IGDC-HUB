"use strict";

const Registry=require("./revenue-provider-registry.v1");
const Sync=require("./revenue-provider-sync.v1");
const Confirmed=require("./confirmed-revenue-event.v1");
const LedgerStore=require("./revenue-ledger-supabase.v1");

const VERSION="revenue-reconciliation-v1.0.0";
const TABLE=process.env.LEDGER_TABLE||process.env.LEGER_TABLE||"inflow_ledger";
const COST_FIELDS=[["taxAmount","tax"],["withholdingAmount","withholding"],["providerFeeAmount","provider_fee"],["fxFeeAmount","fx_fee"],["otherCostAmount","other_cost"]];
function text(v){return v==null?"":String(v).trim();}
function getPath(o,p){return Registry.getPath(o,p);}
function expectedNote(evt,p){const source=p.sourcePrefix||p.id;return evt.state==="reversed"?`provider:${source}:${evt.originalEventId}:reversal:${evt.eventId}`:`provider:${source}:${evt.eventId}`;}
function expectedAmount(evt){const base=evt.amount.canonical.replace(/^[-+]/,"");return evt.state==="reversed"&&base!=="0"?"-"+base:base;}
function canon(v){const p=Confirmed.parseDecimal(v,12);return p.ok?p.canonical:null;}
async function readLedger(hours,deps){
  const store=deps&&deps.store||LedgerStore;
  const config=deps&&deps.config||store.resolveConfig();
  if(!config.configured||!config.valid) return {ok:false,error:"ledger_not_ready",rows:[]};
  const from=new Date(Date.now()-hours*3600000).toISOString();
  const route=`/rest/v1/${encodeURIComponent(TABLE)}?select=ts,source,kind,amount,ccy,channel,note&ts=gte.${encodeURIComponent(from)}&order=ts.desc&limit=5000`;
  const result=await store.request(config,route,{method:"GET"});
  return result.ok?{ok:true,rows:Array.isArray(result.data)?result.data:[]}:{ok:false,error:result.errorCode||"ledger_read_failed",rows:[]};
}
async function reconcileProvider(p,ledgerRows,deps){
  const pulled=await Sync.fetchProvider(p,deps);
  if(!pulled.ok) return {providerId:p.id,ok:false,error:pulled.error,mismatches:[]};
  const arrPath=p.fields&&p.fields.arrayPath;
  const rows=Array.isArray(arrPath?getPath(pulled.body,arrPath):pulled.body)?(arrPath?getPath(pulled.body,arrPath):pulled.body):[];
  const ledgerMap=new Map((ledgerRows||[]).map(r=>[text(r.note),r]));
  const mismatches=[];
  let checked=0;
  for(const row of rows){
    const evt=Sync.normalizeEvent(row,p);
    if(evt.blockers.includes("not_confirmed")) continue;
    if(!evt.ok){mismatches.push({type:"provider_event_invalid",eventId:evt.eventId||null,detail:evt.blockers});continue;}
    checked++;
    const note=expectedNote(evt,p);
    const found=ledgerMap.get(note);
    if(!found){mismatches.push({type:"ledger_row_missing",eventId:evt.eventId,note});continue;}
    if(String(found.ccy||"").toUpperCase()!==evt.currency) mismatches.push({type:"currency_mismatch",eventId:evt.eventId,provider:evt.currency,ledger:found.ccy||null});
    if(canon(found.amount)!==canon(expectedAmount(evt))) mismatches.push({type:"amount_mismatch",eventId:evt.eventId,provider:expectedAmount(evt),ledger:String(found.amount)});
    if(p.amountBasis==="gross"&&evt.state==="confirmed"){
      const source=p.sourcePrefix||p.id;
      for(const [field,label] of COST_FIELDS){
        const path=p.financialFields&&p.financialFields[field]; if(!path) continue;
        const parsed=Confirmed.parseDecimal(getPath(evt.item,path),p.maxAmountScale);
        if(!parsed.ok||parsed.units<=0n) continue;
        const costNote=`provider:${source}:${evt.eventId}:cost:${label}`;
        const cost=ledgerMap.get(costNote);
        if(!cost){mismatches.push({type:"cost_row_missing",eventId:evt.eventId,cost:label});continue;}
        const expected="-"+parsed.canonical.replace(/^[-+]/,"");
        if(canon(cost.amount)!==canon(expected)) mismatches.push({type:"cost_amount_mismatch",eventId:evt.eventId,cost:label,provider:expected,ledger:String(cost.amount)});
      }
    }
  }
  return {providerId:p.id,ok:mismatches.length===0,checked,mismatchCount:mismatches.length,mismatches:mismatches.slice(0,100)};
}
async function run(deps){
  const env=deps&&deps.env||process.env;
  const providers=Registry.activeValid(env);
  const maxHours=Math.max(24,...providers.map(p=>p.lookbackHours||48));
  const ledger=await readLedger(maxHours,deps&&deps.ledgerDeps);
  if(!ledger.ok) return {ok:false,version:VERSION,error:ledger.error,providers:[]};
  const results=[];
  for(const p of providers) results.push(await reconcileProvider(p,ledger.rows,deps));
  return {ok:results.every(x=>x.ok),version:VERSION,generatedAt:new Date().toISOString(),ledgerRows:ledger.rows.length,providers:results};
}
module.exports={VERSION,run,reconcileProvider,readLedger,expectedNote,expectedAmount};
