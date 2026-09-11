"use strict";

/**
 * Confirmed revenue event core.
 *
 * Production rules:
 * - Never accept simulated / estimated / points-based revenue kinds.
 * - Parse monetary amounts as exact decimal text; never use binary floating
 *   point for ingestion or reversal comparison.
 * - Idempotency is based on the external provider receipt/event key.
 * - Reversals are append-only and must reference an existing confirmed row.
 * - Verified provider tax/fee/withholding components may be recorded as cost rows.
 *   Costs are factual accounting entries and are not suppressed even if they
 *   reveal a negative realized margin; the pre-trade profitability gate is
 *   responsible for preventing loss-making routes before activation.
 * - Storage schema remains compatible with the existing inflow_ledger table.
 */

const LedgerStore = require("./revenue-ledger-supabase.v1");

const VERSION = "confirmed-revenue-event-v1.1.0-cost-accounting";
const DEFAULT_TABLE = "inflow_ledger";
const SAFE_ID = /^[A-Za-z0-9_.:@+\/-]{1,220}$/;
const BLOCKED_KIND = /(estimate|estimated|simulation|simulated|dummy|test[_-]?revenue|points?|signal|virtual|mock)/i;

function text(v){ return v == null ? "" : String(v).trim(); }
function cleanId(v){ const s=text(v); return SAFE_ID.test(s) ? s : ""; }
function cleanCurrency(v){ const s=text(v).toUpperCase(); return /^[A-Z0-9]{3,12}$/.test(s) ? s : ""; }
function cleanKind(v){ const s=text(v).toLowerCase().replace(/[^a-z0-9_.:-]+/g,"_"); return /^[a-z0-9][a-z0-9_.:-]{0,119}$/.test(s) ? s : ""; }
function cleanSource(v){ return cleanId(v); }
function cleanNote(v){ const s=text(v); return s && s.length<=500 ? s : ""; }

function parseDecimal(input, maxScale){
  const raw=text(input);
  const limit=Number.isInteger(maxScale) ? Math.max(0,Math.min(12,maxScale)) : 8;
  const m=raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if(!m) return {ok:false,error:"invalid_decimal_amount"};
  const fraction=m[3]||"";
  if(fraction.length>limit) return {ok:false,error:"amount_precision_exceeds_limit",scale:fraction.length,maxScale:limit};
  const scale=fraction.length;
  const digits=(m[2]+fraction).replace(/^0+(?=\d)/,"")||"0";
  let units;
  try { units=BigInt(digits); } catch(_e){ return {ok:false,error:"amount_out_of_range"}; }
  if(m[1]==="-") units=-units;
  const canonical=(m[1]==="-"&&units!==0n?"-":"") + (m[2].replace(/^0+(?=\d)/,"")||"0") + (fraction ? "."+fraction.replace(/0+$/g,"") : "");
  const normalized=canonical.endsWith(".") ? canonical.slice(0,-1) : canonical;
  return {ok:true,raw,scale,units,canonical:normalized || "0"};
}
function alignUnits(a,b){
  const scale=Math.max(a.scale,b.scale);
  const ax=a.units * (10n ** BigInt(scale-a.scale));
  const bx=b.units * (10n ** BigInt(scale-b.scale));
  return {scale,a:ax,b:bx};
}
function compareAbs(a,b){
  const x=alignUnits(a,b);
  const aa=x.a<0n?-x.a:x.a, bb=x.b<0n?-x.b:x.b;
  return aa===bb?0:(aa<bb?-1:1);
}
function signedCanonical(parsed, direction){
  const negative=direction<0;
  const base=parsed.canonical.replace(/^[-+]/,"");
  return negative && base!=="0" ? "-"+base : base;
}
function tableName(input){ return text(input) || process.env.LEDGER_TABLE || process.env.LEGER_TABLE || DEFAULT_TABLE; }
function invalidKind(kind){ return !kind || BLOCKED_KIND.test(kind); }

async function request(method, route, body, deps){
  const store=deps&&deps.store || LedgerStore;
  const config=(deps&&deps.config) || store.resolveConfig();
  const result=await store.request(config,route,{method,headers:{Prefer:"return=representation"},body:body==null?undefined:JSON.stringify(body)});
  return result;
}
async function readByNote(note, table, deps){
  const route=`/rest/v1/${encodeURIComponent(table)}?select=ts,source,kind,amount,ccy,channel,note&note=eq.${encodeURIComponent(note)}&limit=1`;
  const result=await request("GET",route,null,deps);
  return {result,row:result.ok&&Array.isArray(result.data)&&result.data.length?result.data[0]:null};
}
async function readByPrefix(prefix, table, deps){
  const route=`/rest/v1/${encodeURIComponent(table)}?select=ts,source,kind,amount,ccy,channel,note&note=like.${encodeURIComponent(prefix+"*")}&limit=5000`;
  const result=await request("GET",route,null,deps);
  return {result,rows:result.ok&&Array.isArray(result.data)?result.data:[]};
}

function validateEvent(input){
  const source=cleanSource(input&&input.source);
  const eventId=cleanId(input&&input.eventId);
  const kind=cleanKind(input&&input.kind);
  const currency=cleanCurrency(input&&input.currency);
  const state=text(input&&input.state).toLowerCase();
  const amount=parseDecimal(input&&input.amount, Number.isInteger(input&&input.maxScale)?input.maxScale:8);
  const note=cleanNote(input&&input.note);
  const originalNote=cleanNote(input&&input.originalNote);
  const blockers=[];
  if(!source) blockers.push("source_invalid");
  if(!eventId) blockers.push("event_id_invalid");
  if(invalidKind(kind)) blockers.push("revenue_kind_not_production_confirmed");
  if(!currency) blockers.push("currency_invalid");
  if(!["confirmed","reversed","cost"].includes(state)) blockers.push("state_invalid");
  if(!amount.ok) blockers.push(amount.error||"amount_invalid");
  else if(amount.units<=0n) blockers.push("amount_must_be_positive_before_direction");
  if(!note) blockers.push("idempotency_note_invalid");
  if(state==="reversed"&&!originalNote) blockers.push("reversal_original_note_missing");
  return {ok:blockers.length===0,blockers,source,eventId,kind,currency,state,amount,note,originalNote};
}

async function persist(input,deps){
  const checked=validateEvent(input||{});
  if(!checked.ok) return {ok:false,status:400,error:"invalid_confirmed_revenue_event",blockers:checked.blockers};
  const table=tableName(input&&input.table);

  const duplicate=await readByNote(checked.note,table,deps);
  if(!duplicate.result.ok){
    return {ok:false,status:duplicate.result.unavailable?503:502,error:"ledger_idempotency_lookup_failed",errorCode:duplicate.result.errorCode||null};
  }
  if(duplicate.row) return {ok:true,status:200,duplicate:true,row:duplicate.row,eventId:checked.eventId};

  if(checked.state==="reversed"){
    const original=await readByNote(checked.originalNote,table,deps);
    if(!original.result.ok) return {ok:false,status:original.result.unavailable?503:502,error:"reversal_original_lookup_failed",errorCode:original.result.errorCode||null};
    if(!original.row) return {ok:false,status:409,error:"orphan_reversal_rejected",originalNote:checked.originalNote};
    const originalCurrency=cleanCurrency(original.row.ccy);
    if(originalCurrency!==checked.currency) return {ok:false,status:409,error:"reversal_currency_mismatch"};
    const originalAmount=parseDecimal(original.row.amount,12);
    if(!originalAmount.ok || originalAmount.units<=0n) return {ok:false,status:409,error:"reversal_original_amount_invalid"};
    if(compareAbs(checked.amount,originalAmount)>0) return {ok:false,status:409,error:"reversal_exceeds_confirmed_amount"};

    const reversalPrefix=cleanNote(input&&input.reversalPrefix);
    if(reversalPrefix){
      const prior=await readByPrefix(reversalPrefix,table,deps);
      if(!prior.result.ok) return {ok:false,status:prior.result.unavailable?503:502,error:"reversal_history_lookup_failed",errorCode:prior.result.errorCode||null};
      let priorAbs={ok:true,scale:0,units:0n,canonical:"0"};
      for(const row of prior.rows){
        const parsed=parseDecimal(row&&row.amount,12);
        if(!parsed.ok || parsed.units>=0n) continue;
        const aligned=alignUnits(priorAbs,parsed);
        priorAbs={ok:true,scale:aligned.scale,units:(aligned.a<0n?-aligned.a:aligned.a)+(aligned.b<0n?-aligned.b:aligned.b),canonical:"0"};
      }
      const combined=alignUnits(priorAbs,checked.amount);
      const combinedAbs=(combined.a<0n?-combined.a:combined.a)+(combined.b<0n?-combined.b:combined.b);
      const cumulative={ok:true,scale:combined.scale,units:combinedAbs,canonical:"0"};
      if(compareAbs(cumulative,originalAmount)>0) return {ok:false,status:409,error:"cumulative_reversal_exceeds_confirmed_amount"};
    }
  }

  const row={
    ts:text(input&&input.ts)||new Date().toISOString(),
    source:checked.source,
    kind:checked.kind,
    amount:signedCanonical(checked.amount,(checked.state==="reversed"||checked.state==="cost")?-1:1),
    ccy:checked.currency,
    channel:text(input&&input.channel)||"confirmed_external",
    note:checked.note
  };
  const saved=await request("POST",`/rest/v1/${encodeURIComponent(table)}`,[row],deps);
  if(!saved.ok) return {ok:false,status:saved.unavailable?503:502,error:"confirmed_revenue_not_persisted",errorCode:saved.errorCode||null};
  return {ok:true,status:200,duplicate:false,row,eventId:checked.eventId,ledgerTable:table};
}

module.exports={
  VERSION,
  parseDecimal,
  compareAbs,
  signedCanonical,
  validateEvent,
  persist,
  cleanId,
  cleanCurrency,
  cleanKind,
  invalidKind
};
