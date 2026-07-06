"use strict";

/**
 * Confirmed non-PG income ledger reader.
 *
 * This endpoint never fabricates donation, affiliate, advertising, or payout
 * rows. It reads only durable rows imported from an approved provider report
 * or written by a verified provider conversion callback.
 *
 * Optional read-only query parameters:
 *   - window_hours (1..8784)
 *   - window_days  (1..366, used only when window_hours is absent)
 *   - limit        (1..5000)
 *
 * Existing callers without parameters retain the configured default window.
 */

const TABLE_NAME = process.env.LEDGER_TABLE || process.env.LEGER_TABLE || "inflow_ledger";
const DEFAULT_WINDOW_HOURS = Number(process.env.LEDGER_TIME_WINDOW_HOURS || "720");
const MAX_WINDOW_HOURS = 366 * 24;
const MAX_LIMIT = 5000;

function json(statusCode, body){
  return {
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store, max-age=0",
      "x-content-type-options":"nosniff"
    },
    body:JSON.stringify(body, null, 2)
  };
}

function boundedInt(value, fallback, min, max){
  const parsed = Number.parseInt(String(value == null ? "" : value), 10);
  if(!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function requestedWindow(event){
  const query = event && event.queryStringParameters || {};
  const explicitHours = query.window_hours || query.windowHours;
  const explicitDays = query.window_days || query.windowDays;
  const defaultHours = boundedInt(process.env.LEDGER_TIME_WINDOW_HOURS, DEFAULT_WINDOW_HOURS, 1, MAX_WINDOW_HOURS);
  if(String(explicitHours || "").trim()) {
    return boundedInt(explicitHours, defaultHours, 1, MAX_WINDOW_HOURS);
  }
  if(String(explicitDays || "").trim()) {
    return boundedInt(explicitDays, Math.ceil(defaultHours / 24), 1, 366) * 24;
  }
  return defaultHours;
}

function requestedLimit(event){
  const query = event && event.queryStringParameters || {};
  return boundedInt(query.limit, 1000, 1, MAX_LIMIT);
}

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const windowHours = requestedWindow(event);
  const limit = requestedLimit(event);

  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return json(200, {
      endpoint:"/api/ledger",
      ok:true,
      mode:"unconfigured",
      windowHours,
      windowDays:Number((windowHours / 24).toFixed(3)),
      limit,
      rows:[],
      warning:"confirmed ledger storage is not configured"
    });
  }

  try {
    const fromTs = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    const baseUrl = String(SUPABASE_URL).replace(/\/+$/, "");
    const url = baseUrl + `/rest/v1/${encodeURIComponent(TABLE_NAME)}?` + [
      "select=ts,source,kind,amount,ccy,channel,note",
      `ts=gte.${encodeURIComponent(fromTs)}`,
      "order=ts.desc",
      `limit=${encodeURIComponent(String(limit))}`
    ].join("&");

    const res = await fetch(url, {
      method:"GET",
      headers:{
        apikey:SUPABASE_SERVICE_ROLE_KEY,
        Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type":"application/json"
      }
    });
    if(!res.ok){
      return json(200, {
        endpoint:"/api/ledger",
        ok:false,
        mode:"supabase_error",
        windowHours,
        windowDays:Number((windowHours / 24).toFixed(3)),
        limit,
        rows:[],
        error:`Supabase HTTP ${res.status}`
      });
    }

    const data = await res.json();
    const rows = (Array.isArray(data) ? data : []).map(row => ({
      ts:row.ts || null,
      source:row.source || null,
      kind:row.kind || null,
      amount:row.amount == null ? 0 : Number(row.amount),
      ccy:row.ccy || null,
      channel:row.channel || null,
      note:row.note || null
    }));
    return json(200, {
      endpoint:"/api/ledger",
      ok:true,
      mode:"supabase",
      windowHours,
      windowDays:Number((windowHours / 24).toFixed(3)),
      limit,
      rows
    });
  } catch(error) {
    return json(200, {
      endpoint:"/api/ledger",
      ok:false,
      mode:"supabase_error",
      windowHours,
      windowDays:Number((windowHours / 24).toFixed(3)),
      limit,
      rows:[],
      error:String(error && error.message || error)
    });
  }
};

module.exports = {
  handler: exports.handler,
  requestedWindow,
  requestedLimit
};
