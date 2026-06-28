/**
 * feedback.js
 * --------------------------------------------------------------------------
 * Canonical non-cash engagement store for likes, recommendations, saves/views.
 *
 * Storage contract
 * - Reuses the deployed `igdc_social_events` table. No new database table or
 *   payment/settlement path is introduced.
 * - The latest event per anonymous viewer and action determines personal state.
 * - Summary reads return shared counts so reloads and other users see the same
 *   server-side total.
 * - Only an "on" like/recommend is forwarded to the existing revenue signal
 *   bridge as a non-cash engagement signal. Nothing here creates revenue,
 *   payment, payout, or a product mutation.
 */
"use strict";

const crypto = require("crypto");
const RevenueTrack = require("./maru-revenue-track-bridge");

const VERSION = "igdc-feedback-v1.2.0-server-summary-toggle";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const TABLE = "igdc_social_events";
const PUBLIC_TYPES = new Set(["like", "recommend", "view"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Cache-Control": "no-store"
};
const recent = new Map();
const RECENT_WINDOW_MS = 1500;
const MAX_RECENT = 4000;
const SUMMARY_LIMIT = 5000;

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function clean(v, max){ return s(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500); }
function hash(v){ return crypto.createHash("sha1").update(s(v)).digest("hex").slice(0, 18); }
function nowIso(){ return new Date().toISOString(); }
function json(statusCode, body){
  return { statusCode, headers:Object.assign({"Content-Type":"application/json; charset=utf-8"}, CORS), body:JSON.stringify(body) };
}
function parseJson(value, fallback){
  if(value && typeof value === "object") return value;
  try{ return value ? JSON.parse(value) : (fallback || {}); }catch(_){ return fallback || {}; }
}
function parseBody(event){
  try{
    const raw = event && event.body ? event.body : "";
    if(!raw) return {};
    const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    return JSON.parse(text || "{}");
  }catch(_){ return {}; }
}
async function fetchCompat(url, init){
  if(typeof fetch === "function") return fetch(url, init);
  const mod = await import("node-fetch");
  return mod.default(url, init);
}
function publicPath(event, body){
  const explicit = clean(body && body.page, 320);
  if(explicit && explicit.startsWith("/")) return explicit.split("?")[0];
  const referer = clean((event && event.headers && (event.headers.referer || event.headers.Referer)) || "", 1000);
  try{
    const u = new URL(referer);
    return clean(u.pathname, 320) || "/";
  }catch(_){ return "/"; }
}
function throttleKey(event, type, itemId, viewerId, state){
  const headers = event && event.headers || {};
  const ip = clean(headers["x-nf-client-connection-ip"] || headers["x-forwarded-for"] || "anon", 160);
  return hash([ip, type, itemId, viewerId, state].join("|"));
}
function recentlySeen(key){
  const now = Date.now();
  const prior = recent.get(key);
  recent.set(key, now);
  if(recent.size > MAX_RECENT){
    const cutoff = now - (RECENT_WINDOW_MS * 3);
    for(const [k, ts] of recent){
      if(ts < cutoff || recent.size > MAX_RECENT) recent.delete(k);
      if(recent.size <= MAX_RECENT) break;
    }
  }
  return !!prior && (now - prior) < RECENT_WINDOW_MS;
}
function clientKey(body){
  return clean(body && (body.viewer_id || body.viewerId || body.client_id || body.clientId), 120);
}
function desiredState(body){
  const raw = low(body && (body.state != null ? body.state : body.enabled));
  if(["0","false","off","remove","removed","unlike","unrecommend"].includes(raw)) return false;
  return true;
}
function eventName(type, state){
  if(type === "like") return state ? "like" : "unlike";
  if(type === "recommend") return state ? "recommend" : "unrecommend";
  return "view";
}
function tokenForRow(row){
  const payload = parseJson(row && row.payload, {});
  return clean(payload.viewer_id || payload.viewerId || row && row.viewer_id || row && row.event_id || "legacy", 160);
}
function timeForRow(row){
  return Date.parse((row && (row.event_ts || row.created_at)) || "") || 0;
}
function normalizeRows(rows){ return Array.isArray(rows) ? rows : []; }
function emptySummary(itemId, viewerId){
  return {
    item_id:itemId,
    counts:{ likes:0, recommendations:0, views:0 },
    viewer:{ liked:false, recommended:false },
    totals:{ like:0, recommend:0, view:0 },
    viewer_id:viewerId || null
  };
}
function summarize(itemId, viewerId, rows){
  const result = emptySummary(itemId, viewerId);
  const latest = new Map();
  normalizeRows(rows).forEach((row, index)=>{
    const eventType = low(row && row.event_type);
    if(eventType === "view"){
      result.counts.views += 1;
      return;
    }
    let kind = "";
    let enabled = true;
    if(eventType === "like"){ kind = "like"; enabled = true; }
    else if(eventType === "unlike"){ kind = "like"; enabled = false; }
    else if(eventType === "recommend"){ kind = "recommend"; enabled = true; }
    else if(eventType === "unrecommend"){ kind = "recommend"; enabled = false; }
    else return;
    const token = tokenForRow(row) || ("legacy-" + index);
    const key = kind + "|" + token;
    const next = { enabled, at:timeForRow(row), index, token, kind };
    const old = latest.get(key);
    if(!old || next.at > old.at || (next.at === old.at && next.index >= old.index)) latest.set(key, next);
  });
  for(const state of latest.values()){
    if(!state.enabled) continue;
    if(state.kind === "like") result.counts.likes += 1;
    if(state.kind === "recommend") result.counts.recommendations += 1;
    if(viewerId && state.token === viewerId){
      if(state.kind === "like") result.viewer.liked = true;
      if(state.kind === "recommend") result.viewer.recommended = true;
    }
  }
  result.totals.like = result.counts.likes;
  result.totals.recommend = result.counts.recommendations;
  result.totals.view = result.counts.views;
  return result;
}
function ensureConfigured(){
  if(!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase server credentials are not configured.");
}
function restUrl(path){ return SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path; }
async function supabaseRequest(path, init){
  ensureConfigured();
  const res = await fetchCompat(restUrl(path), Object.assign({}, init || {}, {
    headers:Object.assign({
      "Content-Type":"application/json",
      "apikey":SUPABASE_KEY,
      "Authorization":"Bearer " + SUPABASE_KEY
    }, init && init.headers || {})
  }));
  const raw = await res.text();
  let data = null;
  try{ data = raw ? JSON.parse(raw) : null; }catch(_){ data = raw; }
  if(!res.ok){
    const msg = data && (data.message || data.error || data.hint) || raw || ("HTTP " + res.status);
    throw new Error(clean(msg, 360));
  }
  return data;
}
async function insertEvent(row){
  const data = await supabaseRequest(TABLE, {
    method:"POST",
    headers:{ "Prefer":"return=representation" },
    body:JSON.stringify([row])
  });
  return Array.isArray(data) ? data[0] || null : data;
}
async function readEvents(itemId){
  const path = TABLE + "?select=event_type,title,payload,event_id,event_ts,created_at&title=eq." + encodeURIComponent(itemId) + "&order=event_ts.asc&limit=" + SUMMARY_LIMIT;
  const data = await supabaseRequest(path, { method:"GET", headers:{ "Prefer":"" } });
  return normalizeRows(data);
}
async function trackSignal(eventId, type, itemId, page, source){
  if(type !== "like" && type !== "recommend") return { ok:true, status:"not_applicable" };
  try{
    const result = await RevenueTrack.runEngine({
      action:"track",
      event:{
        event_id:eventId,
        idempotency_key:eventId,
        timestamp:nowIso(),
        type,
        original_type:type,
        source:{ service:"feedback", page, route:"/api/feedback", source_type:"feedback_event" },
        content:{ item_id:itemId, content_id:itemId, category:"engagement", item_type:"external_candidate", title:itemId },
        metrics:type === "like" ? { like:1 } : { recommend:1 },
        tracker:{ source:source || "feedback" }
      }
    });
    return { ok:!!(result && result.ok), status:result && result.status || "unknown" };
  }catch(err){
    return { ok:false, status:"track_failed", error:clean(err && err.message || err, 220) };
  }
}
async function readSummary(itemId, viewerId){
  const rows = await readEvents(itemId);
  return summarize(itemId, viewerId, rows);
}

async function handler(event){
  const method = low(event && event.httpMethod || "GET").toUpperCase();
  if(method === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };

  try{
    if(method === "GET"){
      const qs = event && event.queryStringParameters || {};
      const action = low(qs.action || "summary");
      const itemId = clean(qs.id || qs.item_id || qs.itemId, 240);
      const viewerId = clean(qs.viewer_id || qs.viewerId || qs.client_id || qs.clientId, 120);
      if(action !== "summary") return json(400, { ok:false, version:VERSION, error:"Unsupported feedback action" });
      if(!itemId) return json(400, { ok:false, version:VERSION, error:"Missing item id" });
      const summary = await readSummary(itemId, viewerId);
      return json(200, { ok:true, version:VERSION, status:"summary", stored:false, summary });
    }

    if(method !== "POST") return json(405, { ok:false, version:VERSION, error:"Method not allowed" });

    const body = parseBody(event || {});
    const type = low(body.type || body.action);
    const itemId = clean(body.id || body.item_id || body.itemId, 240);
    if(!PUBLIC_TYPES.has(type)) return json(400, { ok:false, version:VERSION, error:"Unsupported feedback type" });
    if(!itemId) return json(400, { ok:false, version:VERSION, error:"Missing item id" });

    const viewerId = clientKey(body) || ("anon-" + hash((event && event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"])) || "anonymous"));
    const state = type === "view" ? true : desiredState(body);
    const page = publicPath(event, body);
    const key = throttleKey(event, type, itemId, viewerId, state);
    if(recentlySeen(key)){
      const summary = await readSummary(itemId, viewerId).catch(()=>emptySummary(itemId, viewerId));
      return json(200, { ok:true, version:VERSION, status:"duplicate_ignored", type, item_id:itemId, page, stored:false, summary, confirmedRevenue:false });
    }

    const eventType = eventName(type, state);
    const eventId = clean(body.event_id, 160) || ("feedback-" + hash([eventType, itemId, page, viewerId, Date.now(), Math.random()].join("|")));
    const createdAt = nowIso();
    const row = {
      page,
      section_key:"feedback",
      event_type:eventType,
      title:itemId,
      description:null,
      href:null,
      watch_time_sec:0,
      event_id:eventId,
      event_ts:createdAt,
      payload:{
        item_id:itemId,
        type,
        state,
        page,
        source:clean(body.source || "feedback", 120),
        viewer_id:viewerId,
        version:VERSION
      },
      created_at:createdAt
    };

    await insertEvent(row);
    const tracker = await trackSignal(eventId, type, itemId, page, row.payload.source);
    const summary = await readSummary(itemId, viewerId).catch(()=>emptySummary(itemId, viewerId));
    return json(201, {
      ok:true,
      version:VERSION,
      status:"stored",
      stored:true,
      type,
      state,
      item_id:itemId,
      page,
      event_id:eventId,
      summary,
      tracker,
      confirmedRevenue:false,
      note:"Reaction is stored as a non-cash engagement signal; it is not a confirmed settlement or payout."
    });
  }catch(err){
    return json(503, { ok:false, version:VERSION, error:clean(err && err.message || err, 360), stored:false });
  }
}

module.exports = { VERSION, handler, summarize };
