/**
 * feedback.js
 * --------------------------------------------------------------------------
 * Canonical server intake for existing product/detail like and recommend UI.
 * - Persists the reaction as a non-cash engagement event in igdc_social_events.
 * - Sends the same event to the existing revenue signal bridge.
 * - Never creates a payment, payout, settled revenue, or product mutation.
 */
"use strict";

const crypto = require("crypto");
const RevenueTrack = require("./maru-revenue-track-bridge");

const VERSION = "igdc-feedback-v1.0.0-final7-rebase";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const TABLE = "igdc_social_events";
const ALLOWED_TYPES = new Set(["like", "recommend"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Cache-Control": "no-store"
};
const recent = new Map();
const RECENT_WINDOW_MS = 1500;
const MAX_RECENT = 4000;

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function clean(v, max){ return s(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500); }
function hash(v){ return crypto.createHash("sha1").update(s(v)).digest("hex").slice(0, 18); }
function nowIso(){ return new Date().toISOString(); }
function json(statusCode, body){
  return { statusCode, headers:Object.assign({"Content-Type":"application/json; charset=utf-8"}, CORS), body:JSON.stringify(body) };
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
function throttleKey(event, type, itemId){
  const headers = event && event.headers || {};
  const ip = clean(headers["x-nf-client-connection-ip"] || headers["x-forwarded-for"] || "anon", 160);
  return hash([ip, type, itemId].join("|"));
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
async function insertEvent(row){
  if(!SUPABASE_URL || !SUPABASE_KEY){
    throw new Error("Supabase server credentials are not configured.");
  }
  const url = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + TABLE;
  const res = await fetchCompat(url, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "apikey":SUPABASE_KEY,
      "Authorization":"Bearer " + SUPABASE_KEY,
      "Prefer":"return=representation"
    },
    body:JSON.stringify([row])
  });
  const raw = await res.text();
  let data = null;
  try{ data = raw ? JSON.parse(raw) : null; }catch(_){ data = raw; }
  if(!res.ok){
    const msg = data && (data.message || data.error || data.hint) || raw || ("HTTP " + res.status);
    throw new Error(clean(msg, 360));
  }
  return Array.isArray(data) ? data[0] || null : data;
}
async function trackSignal(eventId, type, itemId, page, source){
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

async function handler(event){
  const method = low(event && event.httpMethod || "GET").toUpperCase();
  if(method === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };
  if(method !== "POST") return json(405, { ok:false, version:VERSION, error:"Method not allowed" });

  const body = parseBody(event || {});
  const type = low(body.type || body.action);
  const itemId = clean(body.id || body.item_id || body.itemId, 240);
  if(!ALLOWED_TYPES.has(type)) return json(400, { ok:false, version:VERSION, error:"Unsupported feedback type" });
  if(!itemId) return json(400, { ok:false, version:VERSION, error:"Missing item id" });

  const page = publicPath(event, body);
  const key = throttleKey(event, type, itemId);
  if(recentlySeen(key)){
    return json(200, { ok:true, version:VERSION, status:"duplicate_ignored", type, item_id:itemId, page, confirmedRevenue:false });
  }

  const eventId = clean(body.event_id, 160) || ("feedback-" + hash([type, itemId, page, Date.now(), Math.random()].join("|")));
  const createdAt = nowIso();
  const row = {
    page,
    section_key:"feedback",
    event_type:type,
    title:itemId,
    description:null,
    href:null,
    watch_time_sec:0,
    event_id:eventId,
    event_ts:createdAt,
    payload:{ item_id:itemId, type, page, source:clean(body.source || "feedback", 120), version:VERSION },
    created_at:createdAt
  };

  try{
    await insertEvent(row);
    const tracker = await trackSignal(eventId, type, itemId, page, row.payload.source);
    return json(201, {
      ok:true,
      version:VERSION,
      status:"stored",
      stored:true,
      type,
      item_id:itemId,
      page,
      event_id:eventId,
      tracker,
      confirmedRevenue:false,
      note:"Reaction is stored as a non-cash engagement signal; it is not a confirmed settlement or payout."
    });
  }catch(err){
    return json(503, { ok:false, version:VERSION, error:clean(err && err.message || err, 360), stored:false });
  }
}

module.exports = { VERSION, handler };
