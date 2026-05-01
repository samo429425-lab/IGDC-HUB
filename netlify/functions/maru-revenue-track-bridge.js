/**
 * netlify/functions/maru-revenue-track-bridge.js
 * ------------------------------------------------------------
 * IGDC / MARU Revenue Track Bridge v1
 *
 * Server-side event bridge for maru-revenue-tracker.js.
 *
 * Purpose:
 * - Accept single or batched live_event revenue signals.
 * - Normalize tracker events into revenue-engine compatible payloads.
 * - Add idempotency / duplicate guard.
 * - Keep snapshot JSON as reference/seed data and live events as separate signals.
 * - Does not execute PG payment, payout, or confirmed settlement.
 */
"use strict";

const crypto = require("crypto");

const VERSION = "maru-revenue-track-bridge-v1.0.0";
const FX_KRW_PER_USD = Number(process.env.IGDC_FX_KRW_PER_USD || 1300);
const SIGNAL_POINT_USD = Number(process.env.IGDC_SIGNAL_POINT_USD || 0.001);

let RevenueEngine = null;
function getRevenueEngine(){
  if(RevenueEngine) return RevenueEngine;
  try { RevenueEngine = require("./revenue-engine"); } catch(e){ RevenueEngine = null; }
  return RevenueEngine;
}

const seen = new Map();
const MAX_SEEN = 5000;
function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function n(v,d){ const x = Number(v); return Number.isFinite(x) ? x : (d || 0); }
function nowIso(){ return new Date().toISOString(); }
function hash(v){ return crypto.createHash("sha1").update(String(v || "")).digest("hex").slice(0,16); }
function id(prefix, seed){ return (prefix || "id") + "-" + hash(seed || (Date.now() + Math.random())); }
function safeArray(x){ return Array.isArray(x) ? x : []; }
function cleanObj(obj){
  const out = {};
  Object.keys(obj || {}).forEach(k => {
    const v = obj[k];
    if(v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}
function fromUsd(usd){ return Math.round(n(usd) * FX_KRW_PER_USD); }

const POINTS = {
  search_submit:0,
  search_result_impression:0.001,
  search_result_click:0.010,
  slot_impression:0.001,
  slot_click:0.010,
  ad_impression:0.002,
  ad_click:0.030,
  product_impression:0.001,
  product_click:0.015,
  affiliate_click:0.030,
  media_impression:0.001,
  media_click:0.010,
  media_watch_time:0.0005,
  media_dwell:0.0003,
  media_complete:0.020,
  spatial_interaction:0.002,
  like:0.003,
  recommend:0.005,
  share:0.008,
  save:0.004,
  comment_create:0.010,
  post_create:0.015,
  review_create:0.015,
  rating:0.004,
  donation_entry:0.003,
  donation_cta_click:0.020,
  donation_modal_open:0.020,
  donation_intent:0.050,
  tour_impression:0.001,
  tour_click:0.015,
  tour_booking_intent:0.040,
  culture_art_impression:0.001,
  culture_art_click:0.010,
  culture_artist_click:0.010,
  culture_event_click:0.010,
  culture_ticket_click:0.030,
  culture_sponsor_click:0.030,
  culture_donation_intent:0.050
};

function revenueLineFor(event){
  const e = event || {};
  const original = low(e.original_type || e.type);
  const content = e.content || {};
  const line = s(content.revenue_line || e.revenueLine);
  if(line) return line;
  if(original.includes("ad_")) return "display_ad";
  if(original.includes("search")) return "search_click";
  if(original.includes("affiliate") || original.includes("product")) return "product_affiliate";
  if(original.includes("media_watch")) return "media_watchtime";
  if(original.includes("media") || original === "spatial_interaction") return "media_engagement";
  if(original.includes("donation")) return "donation_intent";
  if(original.includes("tour")) return "tour_commission";
  if(original === "like") return "like_reward";
  if(original === "recommend") return "recommend_reward";
  if(original === "share") return "share_reward";
  if(original === "save") return "save_reward";
  if(original.includes("comment")) return "comment_reward";
  if(original.includes("post") || original.includes("review")) return "post_reward";
  if(original.includes("culture_ticket")) return "culture_ticket";
  if(original.includes("culture_sponsor")) return "culture_sponsor";
  if(original.includes("culture_donation")) return "culture_donation";
  if(original.includes("culture")) return "sponsor_click";
  return "general_signal";
}

function pointsFor(event){
  const e = event || {};
  if(e.tracker && e.tracker.points != null) return n(e.tracker.points, 0);
  const original = low(e.original_type || e.type);
  const base = n(POINTS[original], 0);
  if(original === "media_watch_time" || original === "media_dwell"){
    const sec = n(e.metrics && (e.metrics.watchTimeSec || e.metrics.dwellTimeSec), 0);
    return Number((base * sec).toFixed(6));
  }
  return base;
}

function normalizeEvent(input){
  const event = input && input.event ? input.event : input;
  const e = event && typeof event === "object" ? event : {};
  const source = e.source || {};
  const user = e.user || {};
  const content = e.content || {};
  const transaction = e.transaction || {};
  const metrics = e.metrics || {};
  const original = s(e.original_type || e.type || "track");
  const eventId = s(e.event_id || e.id || id("evt", JSON.stringify(e)));
  const idempotencyKey = s(e.idempotency_key || e.idempotencyKey || id("idem", [
    original,
    source.service,
    source.page,
    content.item_id,
    content.slot_id,
    content.url,
    user.session_id,
    Math.floor(Date.now()/1000)
  ].join("|")));

  const line = revenueLineFor(e);
  const points = pointsFor(e);
  const estimatedSignalUsd = Number((points * SIGNAL_POINT_USD).toFixed(8));

  return {
    event_id: eventId,
    idempotency_key: idempotencyKey,
    timestamp: s(e.timestamp || nowIso()),
    type: s(e.type || original),
    original_type: original,
    revenue_line: line,
    source: cleanObj({
      service: source.service || "front",
      page: source.page || "unknown",
      section: source.section,
      route: source.route,
      url: source.url,
      referrer: source.referrer,
      source_type: source.source_type || "live_event",
      snapshot_source: source.snapshot_source,
      snapshot_record_id: source.snapshot_record_id
    }),
    user: cleanObj({
      session_id: user.session_id,
      anon_id: user.anon_id
    }),
    content: cleanObj({
      item_id: content.item_id || eventId,
      content_id: content.content_id,
      product_id: content.product_id,
      slot_id: content.slot_id,
      campaign_id: content.campaign_id,
      provider_id: content.provider_id,
      producer_id: content.producer_id,
      affiliate_id: content.affiliate_id,
      seller_id: content.seller_id,
      psom_key: content.psom_key,
      track_id: content.track_id,
      category: content.category || line,
      item_type: content.item_type,
      media_type: content.media_type,
      title: content.title,
      url: content.url,
      domain: content.domain,
      revenue_line: line,
      text: content.text
    }),
    transaction: cleanObj({
      price: n(transaction.price, 0),
      gross_amount: n(transaction.gross_amount, 0),
      currency: transaction.currency || "USD"
    }),
    metrics: metrics,
    tracker: Object.assign({}, e.tracker || {}, {
      points,
      estimated_signal_usd: estimatedSignalUsd,
      estimated_signal_krw: fromUsd(estimatedSignalUsd),
      bridge_version: VERSION,
      source_type: "live_event",
      settlement_status: "pending",
      status: "estimated_signal"
    })
  };
}

function isDuplicate(event){
  const key = event.idempotency_key;
  if(!key) return false;
  if(seen.has(key)) return true;
  seen.set(key, Date.now());
  if(seen.size > MAX_SEEN){
    const keys = Array.from(seen.keys()).slice(0, seen.size - MAX_SEEN);
    keys.forEach(k => seen.delete(k));
  }
  return false;
}

function enginePayload(event){
  const original = low(event.original_type || event.type);
  let engineType = event.type || original;
  const line = event.revenue_line;

  if(line === "display_ad") engineType = "ad";
  else if(line === "product_affiliate" || line === "commerce_direct") engineType = "product";
  else if(line === "media_watchtime" || line === "media_engagement") engineType = "media";
  else if(line === "donation_intent") engineType = "donation";
  else if(line === "tour_commission") engineType = "tour";
  else if(line === "search_click") engineType = "search";
  else if(line && line.indexOf("culture_") === 0) engineType = "culture";
  else if(["like_reward","recommend_reward","share_reward","save_reward","comment_reward","post_reward"].includes(line)) {
    engineType = event.content.media_type ? "media" : "engagement";
  }

  const metrics = Object.assign({}, event.metrics || {});
  // Backward compatibility with existing revenue-engine calculations.
  if(original === "search_result_click") metrics.searchClick = n(metrics.searchClick,0) || 1;
  if(original === "ad_impression") metrics.adImpression = n(metrics.adImpression,0) || 1;
  if(original === "ad_click") metrics.adClick = n(metrics.adClick,0) || 1;
  if(original === "media_watch_time" && !metrics.watchTimeSec) metrics.watchTimeSec = n(event.metrics && event.metrics.watchTimeSec, 0);
  if(original === "like") metrics.like = n(metrics.like,0) || 1;
  if(original === "recommend") metrics.recommend = n(metrics.recommend,0) || 1;
  if(["product_click","affiliate_click","tour_click","slot_click"].includes(original)) metrics.click = n(metrics.click,0) || 1;

  return {
    action:"track",
    event:{
      event_id:event.event_id,
      timestamp:event.timestamp,
      type:engineType,
      original_type:event.original_type,
      source:event.source,
      user:event.user,
      content:event.content,
      transaction:event.transaction,
      metrics
    }
  };
}

async function callRevenueEngine(event){
  const engine = getRevenueEngine();
  if(!engine) return null;
  try{
    const payload = enginePayload(event);
    if(typeof engine.runEngine === "function") return await engine.runEngine(payload);
    if(typeof engine.dispatch === "function") return await engine.dispatch(payload);
    if(typeof engine.handle === "function") return await engine.handle(payload);
    return null;
  }catch(e){
    return { ok:false, status:"error", error:String(e && e.message || e) };
  }
}

async function acceptOne(raw){
  const event = normalizeEvent(raw);
  const duplicate = isDuplicate(event);
  if(duplicate){
    return {
      ok:true,
      status:"duplicate_ignored",
      eventId:event.event_id,
      idempotencyKey:event.idempotency_key,
      revenueLine:event.revenue_line,
      ledger:{
        id:"dup-" + event.idempotency_key,
        ts:nowIso(),
        itemId:event.content.item_id,
        type:event.original_type,
        revenueLine:event.revenue_line,
        signalPoints:0,
        estimatedSignalUsd:0,
        estimatedSignalKrw:0,
        status:"duplicate_ignored",
        sourceType:"live_event",
        settlementStatus:"ignored"
      }
    };
  }

  const engineResult = await callRevenueEngine(event);
  const ledger = {
    id:"sig-" + hash(event.idempotency_key),
    ts:event.timestamp,
    source:"maru-revenue-track-bridge",
    sourceType:"live_event",
    eventId:event.event_id,
    idempotencyKey:event.idempotency_key,
    itemId:event.content.item_id,
    contentId:event.content.content_id,
    productId:event.content.product_id,
    slotId:event.content.slot_id,
    campaignId:event.content.campaign_id,
    providerId:event.content.provider_id,
    page:event.source.page,
    section:event.source.section,
    snapshotSource:event.source.snapshot_source,
    snapshotRecordId:event.source.snapshot_record_id,
    eventType:event.original_type,
    engineType:event.type,
    revenueLine:event.revenue_line,
    signalPoints:n(event.tracker.points,0),
    estimatedSignalUsd:n(event.tracker.estimated_signal_usd,0),
    estimatedSignalKrw:n(event.tracker.estimated_signal_krw,0),
    status:"accepted_estimated_signal",
    settlementStatus:"pending",
    pgExecution:false,
    confirmed:false
  };

  return {
    ok:true,
    status:"accepted",
    event,
    ledger,
    revenueEngine:engineResult ? {
      ok:engineResult.ok !== false,
      status:engineResult.status,
      amountUsd:engineResult.ledger && engineResult.ledger.amountUsd,
      amountKrw:engineResult.ledger && engineResult.ledger.amountKrw
    } : null
  };
}

async function runEngine(payload){
  const action = low(payload.action || payload.mode || payload.fn || "track");
  if(action === "health"){
    return {
      ok:true,
      status:"ok",
      engine:"maru-revenue-track-bridge",
      version:VERSION,
      features:{
        track:true,
        trackBatch:true,
        idempotency:true,
        snapshotAware:true,
        liveEventOnly:true,
        pgExecution:false,
        settlementExecution:false,
        revenueEngineBridge:!!getRevenueEngine()
      }
    };
  }

  const events = safeArray(payload.events).length ? payload.events :
    safeArray(payload.batch).length ? payload.batch :
    payload.event ? [payload.event] :
    [payload];

  const results = [];
  for(const ev of events){
    results.push(await acceptOne(ev));
  }

  const accepted = results.filter(r => r.status === "accepted").length;
  const duplicateIgnored = results.filter(r => r.status === "duplicate_ignored").length;
  const signalUsd = results.reduce((a,r) => a + n(r.ledger && r.ledger.estimatedSignalUsd,0),0);
  return {
    ok:true,
    status:"ok",
    engine:"maru-revenue-track-bridge",
    version:VERSION,
    action:events.length > 1 ? "track_batch" : "track",
    accepted,
    duplicateIgnored,
    count:results.length,
    signalSummary:{
      estimatedSignalUsd:Number(signalUsd.toFixed(8)),
      estimatedSignalKrw:fromUsd(signalUsd)
    },
    results
  };
}

function parseEventBody(event){
  if(!event) return {};
  if((event.httpMethod || "GET").toUpperCase() === "GET"){
    return event.queryStringParameters || {};
  }
  try{
    const raw = event.body || "";
    const text = event.isBase64Encoded ? Buffer.from(raw,"base64").toString("utf8") : raw;
    return text ? JSON.parse(text) : {};
  }catch(e){
    return event.queryStringParameters || {};
  }
}

function json(statusCode, body){
  return {
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*",
      "access-control-allow-headers":"content-type"
    },
    body:JSON.stringify(body)
  };
}

async function handler(event){
  if(event && event.httpMethod === "OPTIONS") return json(204, {});
  try{
    const payload = parseEventBody(event || {});
    const result = await runEngine(payload);
    return json(200, result);
  }catch(e){
    return json(500, { ok:false, status:"error", engine:"maru-revenue-track-bridge", version:VERSION, error:String(e && e.message || e) });
  }
}

module.exports = { VERSION, handler, runEngine, normalizeEvent, acceptOne };

if(require.main === module){
  runEngine({ action:"health" }).then(r => console.log(JSON.stringify(r,null,2))).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
