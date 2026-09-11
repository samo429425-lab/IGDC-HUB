"use strict";

/**
 * Server-only ingestion endpoint for confirmed ad/affiliate settlement reports.
 * The caller must use IGDC_NONPG_SETTLEMENT_INGEST_TOKEN.
 *
 * Production guarantees:
 * - confirmed external settlement only (no estimate/simulation/points kinds)
 * - exact decimal ingestion (no floating-point conversion before persistence)
 * - receipt-id idempotency
 * - negative/reversal rows require an existing original receipt
 */

const crypto = require("crypto");
const ConfirmedRevenue = require("./lib/confirmed-revenue-event.v1");

const TABLE = process.env.LEDGER_TABLE || process.env.LEGER_TABLE || "inflow_ledger";
function json(statusCode, body){ return { statusCode, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}, body:JSON.stringify(body) }; }
function timing(a,b){ const x=Buffer.from(String(a||"")); const y=Buffer.from(String(b||"")); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function parse(event){ try { const raw=event&&event.body||""; const text=event&&event.isBase64Encoded?Buffer.from(raw,"base64").toString("utf8"):raw; return text?JSON.parse(text):{}; } catch(_e){ return null; } }
function text(v){ return v == null ? "" : String(v).trim(); }

exports.handler = async(event) => {
  if(String(event&&event.httpMethod||"GET").toUpperCase()!=="POST") return json(405,{ok:false,error:"method_not_allowed"});
  const auth=String((event&&event.headers&&(event.headers.authorization||event.headers.Authorization))||"").replace(/^Bearer\s+/i,"");
  const expected=process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN||"";
  if(!expected || !timing(auth,expected)) return json(401,{ok:false,error:"unauthorized"});

  const body=parse(event);
  if(!body||typeof body!=="object") return json(400,{ok:false,error:"invalid_json"});

  const source=text(body.source);
  const receiptId=text(body.receiptId||body.receipt_id);
  const originalReceiptId=text(body.originalReceiptId||body.original_receipt_id||body.reversalOf||body.reversal_of);
  const kind=text(body.kind);
  const currency=text(body.currency||body.ccy||"USD").toUpperCase();
  const parsed=ConfirmedRevenue.parseDecimal(body.amount, Number.isInteger(Number(body.maxAmountScale)) ? Number(body.maxAmountScale) : 8);
  if(!parsed.ok || parsed.units===0n) return json(400,{ok:false,error:"invalid_settlement_amount",detail:parsed.error||null});

  const reversed=parsed.units<0n || ["reversed","refunded","refund","chargeback","cancelled","canceled"].includes(text(body.state||body.status).toLowerCase());
  if(reversed && !originalReceiptId) return json(400,{ok:false,error:"reversal_original_receipt_required"});

  const absAmount=(parsed.canonical||"").replace(/^-/,"");
  const originalNote=originalReceiptId?`settlement:${source}:${originalReceiptId}`:null;
  const reversalPrefix=originalReceiptId?`settlement:${source}:${originalReceiptId}:reversal:`:null;
  const note=reversed?`${reversalPrefix}${receiptId}`:`settlement:${source}:${receiptId}`;
  const saved=await ConfirmedRevenue.persist({
    source,
    eventId:receiptId,
    state:reversed?"reversed":"confirmed",
    kind,
    amount:absAmount,
    currency,
    channel:text(body.channel)||"settlement",
    note,
    originalNote,
    reversalPrefix,
    ts:text(body.ts)||new Date().toISOString(),
    table:TABLE,
    maxScale:Number.isInteger(Number(body.maxAmountScale))?Number(body.maxAmountScale):8
  });
  if(!saved.ok) return json(saved.status||502,{ok:false,error:saved.error||"settlement_not_persisted",errorCode:saved.errorCode||null,blockers:saved.blockers||null,source,receiptId});

  return json(200,{
    ok:true,
    status:saved.duplicate?"duplicate_ignored":(reversed?"confirmed_settlement_reversal_recorded":"confirmed_settlement_recorded"),
    source,
    receiptId,
    originalReceiptId:reversed?originalReceiptId:null,
    amount:saved.row&&saved.row.amount||null,
    currency,
    ledgerTable:TABLE,
    eventCoreVersion:ConfirmedRevenue.VERSION
  });
};
