/**
 * reviews.js
 * --------------------------------------------------------------------------
 * Public review read/write endpoint for the existing front review widgets.
 * Reviews are stored in the same deployed non-cash engagement table used by
 * feedback. No product, payment, inventory, seller or settlement data changes.
 */
"use strict";

const crypto = require("crypto");

const VERSION = "igdc-reviews-v1.0.0-social-event-store";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const TABLE = "igdc_social_events";
const MIN_CHARS = 10;
const MAX_CHARS = 2000;
const MAX_LIST = 100;
const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type,Authorization",
  "Cache-Control":"no-store"
};
const recent = new Map();

function s(v){ return v == null ? "" : String(v); }
function clean(v, max){ return s(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500); }
function low(v){ return clean(v, 80).toLowerCase(); }
function hash(v){ return crypto.createHash("sha1").update(s(v)).digest("hex").slice(0, 18); }
function nowIso(){ return new Date().toISOString(); }
function json(statusCode, body){ return { statusCode, headers:Object.assign({"Content-Type":"application/json; charset=utf-8"}, CORS), body:JSON.stringify(body) }; }
function parseBody(event){
  try{
    const raw = event && event.body ? event.body : "";
    const text = event && event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    return text ? JSON.parse(text) : {};
  }catch(_){ return {}; }
}
async function fetchCompat(url, init){
  if(typeof fetch === "function") return fetch(url, init);
  const mod = await import("node-fetch");
  return mod.default(url, init);
}
function configured(){ return !!(SUPABASE_URL && SUPABASE_KEY); }
function restUrl(path){ return SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path; }
async function request(path, init){
  if(!configured()) throw new Error("Supabase server credentials are not configured.");
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
function queryValue(event, key){
  return event && event.queryStringParameters && event.queryStringParameters[key];
}
function pageFor(event, body){
  const direct = clean(body && body.page, 320);
  if(direct && direct.startsWith("/")) return direct.split("?")[0];
  const h = event && event.headers || {};
  const ref = clean(h.referer || h.Referer, 1000);
  try{ return clean(new URL(ref).pathname, 320) || "/"; }catch(_){ return "/"; }
}
function reviewerFor(event, body){
  const declared = clean(body && (body.reviewer_id || body.viewer_id || body.user_id), 120);
  if(declared) return declared;
  const h = event && event.headers || {};
  return "reviewer-" + hash(h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "anonymous");
}
function recentKey(event, productId, reviewer){
  const h = event && event.headers || {};
  return hash([h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "anon", productId, reviewer].join("|"));
}
function tooSoon(key){
  const now = Date.now();
  const old = recent.get(key);
  recent.set(key, now);
  if(recent.size > 2000){
    for(const [k, ts] of recent){ if(now - ts > 15000 || recent.size > 2000) recent.delete(k); if(recent.size <= 2000) break; }
  }
  return !!old && now - old < 3000;
}
function rowToReview(row){
  const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
  const created = row && (row.event_ts || row.created_at) || null;
  return {
    id:row && (row.event_id || row.id) || null,
    user:payload.display_name || "Member",
    date:created ? new Date(created).toLocaleString() : "",
    content:clean(row && row.description, MAX_CHARS),
    created_at:created
  };
}
async function listReviews(productId){
  const path = TABLE + "?select=event_id,event_ts,created_at,description,payload&title=eq." + encodeURIComponent(productId) + "&event_type=eq.review&order=event_ts.desc&limit=" + MAX_LIST;
  const rows = await request(path, { method:"GET", headers:{ "Prefer":"" } });
  return (Array.isArray(rows) ? rows : []).map(rowToReview).filter(x=>x.content);
}
async function saveReview(event, body){
  const productId = clean(body.productId || body.product_id || body.id, 240);
  const content = clean(body.content || body.review || body.text, MAX_CHARS);
  if(!productId) throw Object.assign(new Error("Missing product id"), { statusCode:400 });
  if(content.length < MIN_CHARS) throw Object.assign(new Error("Review is too short"), { statusCode:400 });
  const reviewer = reviewerFor(event, body);
  if(tooSoon(recentKey(event, productId, reviewer))) throw Object.assign(new Error("Please wait before submitting another review."), { statusCode:429 });
  const createdAt = nowIso();
  const row = {
    page:pageFor(event, body),
    section_key:"review",
    event_type:"review",
    title:productId,
    description:content,
    href:null,
    watch_time_sec:0,
    event_id:"review-" + hash([productId, reviewer, createdAt, Math.random()].join("|")),
    event_ts:createdAt,
    payload:{ reviewer_id:reviewer, display_name:"Member", source:"product-review", version:VERSION },
    created_at:createdAt
  };
  const data = await request(TABLE, { method:"POST", headers:{ "Prefer":"return=representation" }, body:JSON.stringify([row]) });
  const saved = Array.isArray(data) ? data[0] || row : (data || row);
  return rowToReview(saved);
}

exports.handler = async function(event){
  const method = low(event && event.httpMethod || "GET").toUpperCase();
  if(method === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };
  try{
    if(method === "GET"){
      const productId = clean(queryValue(event, "productId") || queryValue(event, "product_id") || queryValue(event, "id"), 240);
      if(!productId) return json(400, { ok:false, version:VERSION, error:"Missing product id" });
      const rows = await listReviews(productId);
      return json(200, rows);
    }
    if(method !== "POST") return json(405, { ok:false, version:VERSION, error:"Method not allowed" });
    const review = await saveReview(event, parseBody(event || {}));
    return json(201, { ok:true, version:VERSION, review });
  }catch(err){
    const statusCode = err && err.statusCode || 503;
    return json(statusCode, { ok:false, version:VERSION, error:clean(err && err.message || err, 360) });
  }
};
