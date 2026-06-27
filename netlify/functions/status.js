// netlify/functions/status.js
// IGDC payment capability status — PG approval/preparation contract.
// This endpoint intentionally exposes no secret values.

"use strict";

const fs = require("fs");
const path = require("path");

function envBool(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function readJsonIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {}
  return null;
}

function loadConfig() {
  const jsCandidates = [
    path.join(__dirname, "data", "pay-config.js"),
    path.join(process.cwd(), "netlify", "functions", "data", "pay-config.js"),
    path.join(process.cwd(), "functions", "data", "pay-config.js")
  ];

  for (const filePath of jsCandidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      delete require.cache[require.resolve(filePath)];
      const config = require(filePath);
      if (config && typeof config === "object") return config;
    } catch (_) {}
  }

  const jsonCandidates = [
    path.join(__dirname, "data", "pay-config.json"),
    path.join(process.cwd(), "netlify", "functions", "data", "pay-config.json"),
    path.join(process.cwd(), "functions", "data", "pay-config.json")
  ];

  for (const filePath of jsonCandidates) {
    const config = readJsonIfExists(filePath);
    if (config && typeof config === "object") return config;
  }

  return {};
}

function textEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function resolvePg(config) {
  const maintenance = envBool("IGDC_MAINTENANCE") ?? (config.maintenance === true);
  const approved = envBool("IGDC_PG_APPROVED") === true;
  const executionRequested =
    (envBool("IGDC_PG_EXECUTION_ENABLED") === true) &&
    (envBool("PAYMENT_LIVE") === true);

  const rawProvider = textEnv("IGDC_PG_PROVIDER", "PG_PROVIDER");
  const provider = ["", "auto", "none", "pending"].includes(rawProvider.toLowerCase()) ? "" : rawProvider;
  const bridgeUrl = textEnv("IGDC_PG_CHECKOUT_BRIDGE_URL");
  const bridgeToken = textEnv("IGDC_PG_BRIDGE_TOKEN");
  const bridgeConfigured = isHttpsUrl(bridgeUrl) && Boolean(bridgeToken);

  const providerConfigured = Boolean(provider);
  const executionEnabled =
    !maintenance &&
    approved &&
    executionRequested &&
    providerConfigured &&
    bridgeConfigured;

  let status = "pending_pg_approval";
  if (maintenance) status = "maintenance";
  else if (!approved) status = "pending_pg_approval";
  else if (!providerConfigured) status = "provider_unconfigured";
  else if (!executionRequested) status = "execution_not_enabled";
  else if (!bridgeConfigured) status = "provider_adapter_unconfigured";
  else status = "ready";

  return {
    status,
    approved,
    executionRequested,
    executionEnabled,
    provider: provider || null,
    bridgeConfigured,
    maintenance
  };
}

exports.handler = async function (event) {
  if (event.httpMethod && !["GET", "HEAD", "OPTIONS"].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: "method_not_allowed" })
    };
  }

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store"
      },
      body: ""
    };
  }

  const config = loadConfig();
  const features = config.features || {};
  const pg = resolvePg(config);

  // Direct card/PG execution is never inferred from pay-config.js alone.
  const payment = {
    card: pg.executionEnabled,
    bank: pg.executionEnabled,
    wallet: pg.executionEnabled,
    crypto: false
  };

  const response = {
    ok: true,
    enabled: pg.executionEnabled,
    maintenance: pg.maintenance,
    pg: {
      status: pg.status,
      approvalRequired: !pg.approved,
      executionEnabled: pg.executionEnabled,
      provider: pg.provider,
      providerAdapterConfigured: pg.bridgeConfigured
    },
    payment,
    features: {
      commerce: pg.executionEnabled,
      donation: features.donation === true,
      affiliate: features.affiliate === true,
      tracking: features.tracking === true
    },
    capabilities: {
      commerceCheckout: pg.executionEnabled,
      donationPayment: pg.executionEnabled && features.donation === true,
      affiliateRedirect: features.affiliate === true,
      tracking: features.tracking === true,
      runtimeAdminToggle: false
    }
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: event.httpMethod === "HEAD" ? "" : JSON.stringify(response)
  };
};
