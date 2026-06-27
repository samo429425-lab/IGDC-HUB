"use strict";

/**
 * Confirmed non-PG income ledger reader.
 *
 * This endpoint never fabricates donation, affiliate, advertising, or payout
 * rows. It reads only durable rows imported from an approved provider report
 * or written by a verified provider conversion callback.
 */

const TABLE_NAME = process.env.LEDGER_TABLE || process.env.LEGER_TABLE || "inflow_ledger";
const DEFAULT_WINDOW_HOURS = Number(process.env.LEDGER_TIME_WINDOW_HOURS || "720");

function json(statusCode, body){
  return {
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store, max-age=0"
    },
    body:JSON.stringify(body, null, 2)
  };
}

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return json(200, {
      endpoint:"/api/ledger",
      ok:true,
      mode:"unconfigured",
      rows:[],
      warning:"confirmed ledger storage is not configured"
    });
  }

  try {
    const windowHours = Number(process.env.LEDGER_TIME_WINDOW_HOURS || DEFAULT_WINDOW_HOURS) || DEFAULT_WINDOW_HOURS;
    const fromTs = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    const baseUrl = String(SUPABASE_URL).replace(/\/+$/, "");
    const url = baseUrl + `/rest/v1/${encodeURIComponent(TABLE_NAME)}?` + [
      "select=ts,source,kind,amount,ccy,channel,note",
      `ts=gte.${encodeURIComponent(fromTs)}`,
      "order=ts.desc"
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
    return json(200, { endpoint:"/api/ledger", ok:true, mode:"supabase", rows });
  } catch(error) {
    return json(200, {
      endpoint:"/api/ledger",
      ok:false,
      mode:"supabase_error",
      rows:[],
      error:String(error && error.message || error)
    });
  }
};
