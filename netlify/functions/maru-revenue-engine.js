/**
 * maru-revenue-engine.js
 * ------------------------------------------------------------
 * Admin-compatible wrapper for revenue-engine.js.
 *
 * Admin can keep calling:
 *   /.netlify/functions/maru-revenue-engine?action=report
 *
 * Stabilized diagnostic path:
 *   /.netlify/functions/maru-revenue-engine?action=report&fast=1&probe=1
 *   returns a lightweight read-only summary without running the full report scan.
 *
 * Maru Search can keep requiring:
 *   require("./revenue-engine")
 */
"use strict";

let RevenueEngine = null;


const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const WRAPPER_VERSION = "maru-revenue-engine-wrapper-v1.0.1-fast-report-probe";

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function truthy(v){
  if(v === true) return true;
  const x = low(v);
  return x === "1" || x === "true" || x === "yes" || x === "on" || x === "fast";
}
function n(v, d){ const x = Number(v); return Number.isFinite(x) ? x : (d || 0); }
function hashText(v){ return crypto.createHash("sha1").update(String(v || "")).digest("hex").slice(0,16); }
function jsonResponse(body){
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}
function parseEventPayload(event){
  event = event || {};
  const qs = event.queryStringParameters || {};
  if(String(event.httpMethod || "GET").toUpperCase() === "GET") return qs;
  try{
    const raw = event.body || "";
    const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    const body = text ? JSON.parse(text) : {};
    return Object.assign({}, qs, body || {});
  }catch(e){ return qs; }
}
function candidateSnapshotPaths(){
  return [
    path.join(process.cwd(), "data", "search-bank.snapshot.json"),
    path.join(process.cwd(), "netlify", "functions", "data", "search-bank.snapshot.json"),
    path.join(__dirname || ".", "data", "search-bank.snapshot.json"),
    path.join(__dirname || ".", "search-bank.snapshot.json"),
    path.join(process.cwd(), "search-bank.snapshot.json")
  ];
}
function readSnapshotItemsFast(){
  for(const p of candidateSnapshotPaths()){
    try{
      if(!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, "utf8");
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      return { path:p, size:text.length, hash:hashText(text), items };
    }catch(e){}
  }
  return { path:null, size:0, hash:null, items:[] };
}
function validUrl(it){
  const u = s((it && (it.url || it.link || it.href)) || "").trim();
  return !!u && u !== "#" && u !== "/" && !/^javascript:/i.test(u);
}
function hasRevenueStructure(it){
  it = it || {};
  return !!(it.monetization || it.linkRevenue || it.affiliateRevenue || it.revenueDestination || it.settlementDestination || it.directSale || it.blockchainPayment || it.commerce);
}
function fastReport(payload){
  const started = Date.now();
  const snap = readSnapshotItemsFast();
  const items = snap.items || [];
  const limit = Math.max(1, Math.min(100, n(payload.limit, 50)));
  let sample = 0, real = 0, revenueStructure = 0, invalidUrl = 0;
  const byPage = {};
  const bySection = {};
  items.forEach(it => {
    const page = s(it && (it.page || it.channel || it._snapshotPage || (it.bind && it.bind.page)) || "unknown") || "unknown";
    const section = s(it && (it.section || it.psom_key || it._snapshotSection || (it.bind && (it.bind.section || it.bind.psom_key))) || "unknown") || "unknown";
    byPage[page] = (byPage[page] || 0) + 1;
    bySection[section] = (bySection[section] || 0) + 1;
    const placeholder = it && (it.placeholder === true || /placeholder|sample|seed/i.test([it.title,it.summary,it.url,it.id].join(" ")) || /example\.com|example\.edu/i.test(s(it.url || it.link)) || !validUrl(it));
    if(placeholder) sample++; else real++;
    if(!validUrl(it)) invalidUrl++;
    if(hasRevenueStructure(it)) revenueStructure++;
  });
  return {
    ok:true,
    status:"ok",
    engine:"maru-revenue-engine",
    version:WRAPPER_VERSION,
    action:"report",
    reportMode:"fast-readonly-diagnostic-summary",
    generatedAt:new Date().toISOString(),
    elapsedMs:Date.now()-started,
    noWrite:true,
    pgExecution:false,
    snapshot:{ path:snap.path, size:snap.size, hash:snap.hash, count:items.length },
    summary:{
      totalItems:items.length,
      sampleItems:sample,
      realItems:real,
      revenueStructureCount:revenueStructure,
      invalidOrPlaceholderUrlCount:invalidUrl,
      revenueOk:0,
      revenueWarn:items.length,
      revenueError:0,
      note:"Fast diagnostic summary only. Full settlement/payment execution is not run."
    },
    lineHealth:{ ok:0, warn:items.length, error:0 },
    byPage,
    topSections:Object.entries(bySection).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([key,count])=>({ key, count })),
    items:items.slice(0, limit)
  };
}
function isFastReportPayload(payload){
  payload = payload || {};
  const action = low(payload.action || payload.mode || payload.fn || "report");
  return action === "report" && (truthy(payload.fast) || truthy(payload.probe) || truthy(payload.audit) || truthy(payload.summary) || truthy(payload.diagnostic));
}

function getEngine(){
  if(RevenueEngine) return RevenueEngine;
  RevenueEngine = require("./revenue-engine");
  return RevenueEngine;
}

async function runEngine(payload){
  const engine = getEngine();
  if(engine && typeof engine.runEngine === "function") return engine.runEngine(payload || {});
  if(engine && typeof engine.dispatch === "function") return engine.dispatch(payload || {});
  throw new Error("revenue-engine.js does not expose runEngine/dispatch");
}

async function dispatch(payload){
  return runEngine(payload || {});
}

async function handle(payload){
  return runEngine(payload || {});
}

async function handler(event, context){
  const payload = parseEventPayload(event || {});
  if(isFastReportPayload(payload)){
    return jsonResponse(fastReport(payload));
  }
  const engine = getEngine();
  if(engine && typeof engine.handler === "function") return engine.handler(event, context);
  const result = await runEngine({});
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(result)
  };
}

module.exports = {
  handler,
  runEngine,
  dispatch,
  handle
};
