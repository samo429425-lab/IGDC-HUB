"use strict";

/**
 * Confirmed non-PG income ledger reader.
 *
 * Reads only durable rows imported from an approved provider report or written
 * by a verified conversion callback. A successful empty query is reported as
 * "confirmed_ledger_empty"; configuration or network failures remain errors.
 */

const LedgerStore = require("./lib/revenue-ledger-supabase.v1");

const VERSION = "confirmed-revenue-ledger-reader-v1.1.0-unified-supabase-key";
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
  if(String(explicitHours || "").trim()) return boundedInt(explicitHours, defaultHours, 1, MAX_WINDOW_HOURS);
  if(String(explicitDays || "").trim()) return boundedInt(explicitDays, Math.ceil(defaultHours / 24), 1, 366) * 24;
  return defaultHours;
}
function requestedLimit(event){
  const query = event && event.queryStringParameters || {};
  return boundedInt(query.limit, 1000, 1, MAX_LIMIT);
}
function common(windowHours, limit){
  return {
    endpoint:"/api/ledger",
    version:VERSION,
    windowHours,
    windowDays:Number((windowHours / 24).toFixed(3)),
    limit,
    ledgerTable:TABLE_NAME
  };
}

exports.handler = async (event) => {
  const windowHours = requestedWindow(event);
  const limit = requestedLimit(event);
  const config = LedgerStore.resolveConfig();
  const configState = LedgerStore.describeConfig(config);

  if(!config.configured){
    return json(200, Object.assign(common(windowHours, limit), {
      ok:true,
      mode:"unconfigured",
      dataState:"confirmed_ledger_unconfigured",
      rows:[],
      warning:"confirmed ledger storage is not configured",
      config:configState
    }));
  }
  if(!config.valid){
    return json(200, Object.assign(common(windowHours, limit), {
      ok:false,
      mode:"configuration_error",
      dataState:"confirmed_ledger_unavailable",
      rows:[],
      errorCode:config.errorCode,
      error:config.errorMessage,
      config:configState
    }));
  }

  const fromTs = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const route = `/rest/v1/${encodeURIComponent(TABLE_NAME)}?` + [
    "select=ts,source,kind,amount,ccy,channel,note",
    `ts=gte.${encodeURIComponent(fromTs)}`,
    "order=ts.desc",
    `limit=${encodeURIComponent(String(limit))}`
  ].join("&");
  const result = await LedgerStore.request(config, route, { method:"GET" });

  if(!result.ok){
    return json(200, Object.assign(common(windowHours, limit), {
      ok:false,
      mode:"supabase_error",
      dataState:"confirmed_ledger_unavailable",
      rows:[],
      errorCode:result.errorCode,
      error:result.errorMessage,
      statusCode:result.status,
      config:result.config || configState
    }));
  }

  const rows = (Array.isArray(result.data) ? result.data : []).map(row => ({
    ts:row.ts || null,
    source:row.source || null,
    kind:row.kind || null,
    amount:row.amount == null ? 0 : Number(row.amount),
    ccy:row.ccy || null,
    channel:row.channel || null,
    note:row.note || null
  }));
  return json(200, Object.assign(common(windowHours, limit), {
    ok:true,
    mode:"supabase",
    dataState:rows.length ? "confirmed_ledger_available" : "confirmed_ledger_empty",
    rows,
    config:result.config || configState
  }));
};

module.exports = {
  VERSION,
  handler: exports.handler,
  requestedWindow,
  requestedLimit
};
