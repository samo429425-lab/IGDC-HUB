/**
 * IGDC income summary (read-only)
 *
 * Public contract: /api/igdc/income/summary
 *
 * This function intentionally does not initiate payment, settlement, payout,
 * order creation, or ledger writes. Before operational revenue sources are
 * connected, it returns a stable zero-valued summary rather than estimated
 * snapshot revenue. That prevents the admin dashboard from presenting sample
 * or projected figures as realized income.
 */
"use strict";

const RevenueEngine = require("./revenue-engine");

const DASHBOARD_KEYS = [
  "social",
  "video",
  "platform",
  "distribution",
  "donation",
  "tour",
  "ads",
  "misc"
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

function zeroSummary() {
  return DASHBOARD_KEYS.reduce((summary, key) => {
    summary[key] = { day: 0, week: 0, month: 0, year: 0, total: 0 };
    return summary;
  }, {});
}

function query(event) {
  return (event && event.queryStringParameters) || {};
}

exports.handler = async function handler(event) {
  const method = String((event && event.httpMethod) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return json(405, {
      ok: false,
      error: "method_not_allowed",
      message: "Income summary is read-only."
    });
  }

  const params = query(event);
  let health = null;
  try {
    // Reuse the existing health contract only. No report scan, ledger write,
    // settlement execution, payout execution, or PG action occurs here.
    health = await RevenueEngine.runEngine({ action: "health", probe: params.probe === "1" });
  } catch (error) {
    health = {
      ok: false,
      error: String((error && error.message) || error || "health_unavailable")
    };
  }

  const features = (health && health.features) || {};
  const pgExecution = features.pgExecution === true;
  const pgStatus = features.pgStatus || (pgExecution ? "active" : "pending_pg_approval");

  return json(200, {
    ok: true,
    status: "ok",
    endpoint: "/api/igdc/income/summary",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    dryRun: true,
    settlementExecution: false,
    payoutExecution: false,
    pgExecution,
    pgStatus,
    currency: "USD",
    // Only realized, persisted income belongs in this dashboard. Snapshot
    // estimates and sample cards are intentionally excluded.
    dataState: "no_realized_income_source_connected",
    summary: zeroSummary(),
    totalRevenue: 0,
    totalRevenueUsd: 0,
    totalRevenueKrw: 0,
    source: {
      engine: (health && health.engine) || "revenue-engine",
      version: (health && health.version) || null,
      healthOk: health && health.ok === true
    }
  });
};
