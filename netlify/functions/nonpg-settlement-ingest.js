"use strict";

/**
 * Server-only ingestion endpoint for confirmed ad/affiliate settlement reports.
 * It is intentionally not callable from public page code. The caller must use
 * the Netlify environment secret IGDC_NONPG_SETTLEMENT_INGEST_TOKEN.
 */

const crypto = require("crypto");

const TABLE = process.env.LEDGER_TABLE || process.env.LEGER_TABLE || "inflow_ledger";
function json(statusCode, body){ return { statusCode, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}, body:JSON.stringify(body) }; }
function timing(a,b){ const x=Buffer.from(String(a||"")); const y=Buffer.from(String(b||"")); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function parse(event){ try { const raw=event&&event.body||""; const text=event&&event.isBase64Encoded?Buffer.from(raw,"base64").toString("utf8"):raw; return text?JSON.parse(text):{}; } catch(_e){ return null; } }
async function request(method, route, body){
  const base=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!base||!key) return {ok:false,unavailable:true,status:503};
  const res=await fetch(base+route,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,"content-type":"application/json",Prefer:"return=representation"},body:body==null?undefined:JSON.stringify(body)});
  let data=null; try{data=await res.json();}catch(_e){}
  return {ok:res.ok,unavailable:false,status:res.status,data};
}
exports.handler = async(event) => {
  if(String(event&&event.httpMethod||"GET").toUpperCase()!=="POST") return json(405,{ok:false,error:"method_not_allowed"});
  const auth=String((event&&event.headers&& (event.headers.authorization||event.headers.Authorization))||"").replace(/^Bearer\s+/i,"");
  const expected=process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN||"";
  if(!expected || !timing(auth,expected)) return json(401,{ok:false,error:"unauthorized"});
  const body=parse(event); if(!body||typeof body!=="object") return json(400,{ok:false,error:"invalid_json"});
  const source=String(body.source||"").trim();
  const receiptId=String(body.receiptId||body.receipt_id||"").trim();
  const kind=String(body.kind||"").trim();
  const currency=String(body.currency||body.ccy||"USD").trim().toUpperCase();
  const amount=Number(body.amount);
  if(!source||!receiptId||!kind||!Number.isFinite(amount)||amount===0) return json(400,{ok:false,error:"invalid_settlement_payload"});
  const note=`settlement:${source}:${receiptId}`;
  const exists=await request("GET",`/rest/v1/${encodeURIComponent(TABLE)}?select=note&note=eq.${encodeURIComponent(note)}&limit=1`,null);
  if(!exists.ok) return json(exists.unavailable?503:502,{ok:false,error:"ledger_unavailable"});
  if(Array.isArray(exists.data)&&exists.data.length) return json(200,{ok:true,status:"duplicate_ignored",source,receiptId});
  const saved=await request("POST",`/rest/v1/${encodeURIComponent(TABLE)}`,[{ts:body.ts||new Date().toISOString(),source,kind,amount,ccy:currency,channel:body.channel||"settlement",note}]);
  if(!saved.ok) return json(saved.unavailable?503:502,{ok:false,error:"settlement_not_persisted"});
  return json(200,{ok:true,status:"confirmed_settlement_recorded",source,receiptId,amount,currency});
};
