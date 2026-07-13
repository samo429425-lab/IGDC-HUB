"use strict";

/**
 * Affiliate conversion confirmation endpoint.
 *
 * This endpoint receives confirmed commission callbacks from an approved
 * affiliate provider. It does not accept browser-originated confirmations.
 * Provider credentials and field mappings remain in Netlify environment
 * variables, never in public snapshots or JavaScript.
 *
 * Required environment values once a provider is approved:
 * - IGDC_AFFILIATE_PARTNERS_JSON
 * - IGDC_AFFILIATE_CLICK_SIGNING_SECRET
 * - one secret environment variable named by each provider's secretEnv
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for confirmed ledger storage
 */

const crypto = require("crypto");
const Contract = require("./lib/nonpg-revenue-contract.core.v1");
const LedgerStore = require("./lib/revenue-ledger-supabase.v1");

const TABLE = process.env.LEDGER_TABLE || process.env.LEGER_TABLE || "inflow_ledger";

function json(statusCode, body){
  return {
    statusCode,
    headers:{ "content-type":"application/json; charset=utf-8", "cache-control":"no-store" },
    body:JSON.stringify(body)
  };
}
function parseJson(event){
  try{
    const raw = event && event.body || "";
    const text = event && event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    return { raw:text || "{}", body:text ? JSON.parse(text) : {} };
  }catch(e){ return { raw:"", body:null, error:e }; }
}
function headers(event){
  const out = {};
  Object.entries(event && event.headers || {}).forEach(([k,v]) => { out[String(k).toLowerCase()] = String(v || ""); });
  return out;
}
function getPath(obj, dotted){
  const path = String(dotted || "").split(".").filter(Boolean);
  let cur = obj;
  for(const key of path){
    if(!cur || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}
function first(){ for(const value of arguments){ if(value !== undefined && value !== null && String(value).trim() !== "") return value; } return ""; }
function lower(v){ return String(v == null ? "" : v).trim().toLowerCase(); }
function number(v){ const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function cleanProvider(v){ return Contract.cleanId(v); }
function partnerConfig(){
  try {
    const parsed = JSON.parse(process.env.IGDC_AFFILIATE_PARTNERS_JSON || "[]");
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.providers) ? parsed.providers : []);
    return list.filter(x => x && typeof x === "object" && x.active === true).map(x => Object.assign({}, x, { id: cleanProvider(x.id || x.providerId) }));
  } catch(_e){ return []; }
}
function readSignature(event, config){
  const h = headers(event);
  const key = String(config.signatureHeader || "x-igdc-affiliate-signature").toLowerCase();
  return h[key] || "";
}
function validSignature(raw, signature, secret, config){
  if(!raw || !signature || !secret) return false;
  const digest = crypto.createHmac("sha256", String(secret)).update(String(raw)).digest("hex");
  const prefix = config.signaturePrefix == null ? "sha256=" : String(config.signaturePrefix);
  const expected = prefix + digest;
  return Contract.timingEqual(signature, expected) || Contract.timingEqual(signature, digest);
}
function eventState(value, config){
  const raw = lower(value);
  const confirmed = new Set((config.confirmedValues || ["confirmed","approved","paid","completed"]).map(lower));
  const reversed = new Set((config.reversedValues || ["reversed","cancelled","canceled","refunded","chargeback"]).map(lower));
  if(confirmed.has(raw)) return "confirmed";
  if(reversed.has(raw)) return "reversed";
  return "pending";
}
async function supabaseRequest(method, route, body){
  const config = LedgerStore.resolveConfig();
  const result = await LedgerStore.request(config, route, {
    method,
    headers:{ Prefer:"return=representation" },
    body:body == null ? undefined : JSON.stringify(body)
  });
  return {
    ok:result.ok,
    unavailable:result.unavailable,
    status:result.status,
    data:result.data,
    errorCode:result.errorCode,
    errorMessage:result.errorMessage
  };
}
async function duplicateExists(note){
  const route = `/rest/v1/${encodeURIComponent(TABLE)}?select=note&note=eq.${encodeURIComponent(note)}&limit=1`;
  const result = await supabaseRequest("GET", route, null);
  if(!result.ok) return { ok:false, result };
  return { ok:true, exists:Array.isArray(result.data) && result.data.length > 0 };
}
async function writeLedger(row){
  const duplicate = await duplicateExists(row.note);
  if(!duplicate.ok) return { ok:false, stage:"lookup", result:duplicate.result };
  if(duplicate.exists) return { ok:true, duplicate:true };
  const result = await supabaseRequest("POST", `/rest/v1/${encodeURIComponent(TABLE)}`, [row]);
  return result.ok ? { ok:true, duplicate:false, row:result.data } : { ok:false, stage:"insert", result };
}

exports.handler = async (event) => {
  if(String(event && event.httpMethod || "GET").toUpperCase() !== "POST") return json(405, { ok:false, error:"method_not_allowed" });
  const parsed = parseJson(event);
  if(!parsed.body || parsed.error) return json(400, { ok:false, error:"invalid_json" });

  const body = parsed.body;
  const providerId = cleanProvider(first(body.providerId, body.provider_id, body.provider, body.partnerId, body.partner_id));
  const config = partnerConfig().find(p => p.id === providerId);
  if(!config) return json(503, { ok:false, error:"affiliate_provider_not_configured", providerId:providerId || null });

  const secret = process.env[String(config.secretEnv || "")] || "";
  const signature = readSignature(event, config);
  if(!validSignature(parsed.raw, signature, secret, config)) return json(401, { ok:false, error:"invalid_provider_signature" });

  const mapping = config.fields || {};
  const transactionId = Contract.cleanId(first(
    getPath(body, mapping.transactionId || "transactionId"), body.transactionId, body.transaction_id, body.orderId, body.order_id
  ));
  if(!transactionId) return json(400, { ok:false, error:"missing_transaction_id" });

  const state = eventState(first(getPath(body, mapping.status || "status"), body.status), config);
  const clickToken = String(first(getPath(body, mapping.clickId || "clickId"), body.clickId, body.click_id, body.subid, body.sub_id) || "");
  const click = Contract.verifyClick(clickToken, process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET || "");
  if(!click || click.providerId !== providerId) return json(400, { ok:false, error:"invalid_or_expired_click_reference" });

  if(state === "pending") return json(202, { ok:true, status:"pending_confirmation", providerId, transactionId, itemId:click.id || null });

  const amount = number(first(getPath(body, mapping.commissionAmount || "commissionAmount"), body.commissionAmount, body.commission_amount, body.amount));
  const currency = String(first(getPath(body, mapping.currency || "currency"), body.currency, config.currency, "USD")).toUpperCase();
  if(!Number.isFinite(amount) || amount <= 0) return json(400, { ok:false, error:"invalid_commission_amount" });

  const direction = state === "reversed" ? -1 : 1;
  const note = `affiliate:${providerId}:${transactionId}:${state}`;
  const row = {
    ts: new Date().toISOString(),
    source: providerId,
    kind: state === "reversed" ? "affiliate_reversal" : "affiliate_commission",
    amount: Number((direction * amount).toFixed(8)),
    ccy: currency,
    channel: "affiliate",
    note
  };
  const saved = await writeLedger(row);
  if(!saved.ok){
    const status = saved.result && saved.result.unavailable ? 503 : 502;
    return json(status, { ok:false, error:"confirmed_commission_not_persisted", errorCode:saved.result && saved.result.errorCode || null, stage:saved.stage || null, providerId, transactionId });
  }
  return json(200, {
    ok:true,
    status:saved.duplicate ? "duplicate_ignored" : "confirmed_commission_recorded",
    providerId,
    transactionId,
    itemId:click.id || null,
    amount:row.amount,
    currency,
    ledgerTable:TABLE
  });
};
