/**
 * IGDC confirmed non-PG income summary (read-only)
 *
 * Public contract: /api/igdc/income/summary
 *
 * Reports only durable rows already recorded in the confirmed revenue ledger.
 * A successful query with zero rows is a normal "자료 없음" state. Storage,
 * key, schema, permission, or network failures remain explicit errors.
 */
"use strict";

const LedgerStore = require("./lib/revenue-ledger-supabase.v1");

const VERSION = "igdc-income-summary-v1.1.0-unified-supabase-key";
const DASHBOARD_KEYS = ["social","video","platform","distribution","donation","tour","ads","misc"];
const TABLE = process.env.LEDGER_TABLE || process.env.LEGER_TABLE || "inflow_ledger";
const KRW_PER_USD = Number(process.env.IGDC_FX_KRW_PER_USD || 1300);
const WINDOW_DAYS = Math.max(31, Number(process.env.IGDC_INCOME_SUMMARY_WINDOW_DAYS || 366) || 366);

function json(statusCode, body){
  return {
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store, max-age=0",
      "x-content-type-options":"nosniff"
    },
    body:JSON.stringify(body)
  };
}
function zeroSummary(){
  return DASHBOARD_KEYS.reduce((summary, key) => {
    summary[key] = { day:0, week:0, month:0, year:0, total:0 };
    return summary;
  }, {});
}
function lower(value){ return String(value == null ? "" : value).trim().toLowerCase(); }
function number(value){ const n=Number(value); return Number.isFinite(n) ? n : 0; }
function toUsd(amount, currency){
  const c=lower(currency || "usd");
  if(c === "usd") return number(amount);
  if(c === "krw") return number(amount) / KRW_PER_USD;
  return null;
}
function bucketFor(row){
  const text=[row && row.kind, row && row.source, row && row.channel, row && row.note].map(lower).join(" ");
  if(/donation|donate|후원|기부/.test(text)) return "donation";
  if(/affiliate|referral|commission|brokerage|seller/.test(text)) return "distribution";
  if(/adsense|advert| ad |youtube|display_ad|ad_settlement/.test(" "+text+" ")) return "ads";
  if(/tour|travel|hotel|flight|관광|여행/.test(text)) return "tour";
  if(/media|movie|drama|video|watch/.test(text)) return "video";
  if(/social|instagram|facebook|tiktok|youtube_channel|x\.com|twitter/.test(text)) return "social";
  if(/platform|subscription|license|service/.test(text)) return "platform";
  return "misc";
}
function periods(ts, now){
  const time=Date.parse(ts || "");
  if(!Number.isFinite(time)) return { day:false, week:false, month:false, year:false };
  const delta=Math.max(0, now-time);
  return {
    day:delta <= 24*60*60*1000,
    week:delta <= 7*24*60*60*1000,
    month:delta <= 31*24*60*60*1000,
    year:delta <= 366*24*60*60*1000
  };
}
async function readLedger(){
  const config=LedgerStore.resolveConfig();
  const safeConfig=LedgerStore.describeConfig(config);
  if(!config.configured) return { ok:false, unconfigured:true, rows:[], config:safeConfig };
  if(!config.valid) return { ok:false, unconfigured:false, rows:[], errorCode:config.errorCode, error:config.errorMessage, config:safeConfig };

  const from=new Date(Date.now()-WINDOW_DAYS*24*60*60*1000).toISOString();
  const route=`/rest/v1/${encodeURIComponent(TABLE)}?` + [
    "select=ts,source,kind,amount,ccy,channel,note",
    `ts=gte.${encodeURIComponent(from)}`,
    "order=ts.desc",
    "limit=5000"
  ].join("&");
  const result=await LedgerStore.request(config, route, {method:"GET"});
  if(!result.ok){
    return {
      ok:false,
      unconfigured:false,
      rows:[],
      errorCode:result.errorCode,
      error:result.errorMessage,
      statusCode:result.status,
      config:result.config || safeConfig
    };
  }
  return { ok:true, rows:Array.isArray(result.data) ? result.data : [], config:result.config || safeConfig };
}

exports.handler=async(event)=>{
  const method=String(event && event.httpMethod || "GET").toUpperCase();
  if(method !== "GET" && method !== "HEAD") return json(405,{ok:false,error:"method_not_allowed",message:"Income summary is read-only."});

  let source;
  try { source=await readLedger(); }
  catch(error){ source={ok:false,unconfigured:false,errorCode:"revenue_ledger_unexpected_error",error:String(error && error.message || error),rows:[],config:null}; }

  const summary=zeroSummary();
  const now=Date.now();
  let totalUsd=0;
  let unconvertedRows=0;
  let confirmedRows=0;

  for(const row of source.rows || []){
    const usd=toUsd(row.amount,row.ccy);
    if(usd === null){ unconvertedRows++; continue; }
    const bucket=bucketFor(row);
    const target=summary[bucket] || summary.misc;
    const active=periods(row.ts,now);
    if(active.day) target.day += usd;
    if(active.week) target.week += usd;
    if(active.month) target.month += usd;
    if(active.year) target.year += usd;
    target.total += usd;
    totalUsd += usd;
    confirmedRows++;
  }

  Object.values(summary).forEach(row => {
    ["day","week","month","year","total"].forEach(key => { row[key]=Number(row[key].toFixed(6)); });
  });
  const totalKrw=Math.round(totalUsd*KRW_PER_USD);
  const dataState=source.unconfigured
    ? "confirmed_ledger_unconfigured"
    : (source.ok ? (confirmedRows ? "confirmed_external_income" : "confirmed_ledger_empty") : "confirmed_ledger_unavailable");

  const body={
    ok:source.ok || source.unconfigured,
    status:source.ok || source.unconfigured ? "ok" : "source_unavailable",
    endpoint:"/api/igdc/income/summary",
    version:VERSION,
    generatedAt:new Date().toISOString(),
    readOnly:true,
    dryRun:true,
    settlementExecution:false,
    payoutExecution:false,
    pgExecution:false,
    pgStatus:"pending_pg_approval",
    currency:"USD",
    dataState,
    dataMessage:dataState === "confirmed_ledger_empty"
      ? "확정 수익 자료 없음"
      : (dataState === "confirmed_external_income" ? "확정 수익 자료 있음" : (dataState === "confirmed_ledger_unconfigured" ? "확정 수익 원장 미연결" : "확정 수익 원장 연결 오류")),
    summary,
    totalRevenue:totalKrw,
    totalRevenueUsd:Number(totalUsd.toFixed(6)),
    totalRevenueKrw:totalKrw,
    confirmedRows,
    unconvertedRows,
    source:{
      ledgerTable:TABLE,
      mode:source.unconfigured ? "unconfigured" : (source.ok ? "supabase" : "supabase_error"),
      errorCode:source.errorCode || null,
      error:source.error || null,
      statusCode:source.statusCode || null,
      config:source.config || null
    }
  };
  if(method === "HEAD") return {statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, max-age=0","x-content-type-options":"nosniff"},body:""};
  return json(200,body);
};

module.exports={VERSION,handler:exports.handler,readLedger};
