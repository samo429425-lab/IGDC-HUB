/**
 * checkout.js
 * IGDC unified checkout gateway.
 *
 * PG safety contract:
 * - pay-config.js may describe product/donation features, but never enables live PG by itself.
 * - Live PG requires explicit approval + execution flags + provider bridge configuration.
 * - Affiliate/tracking remain non-PG routes.
 * - Donation information may be returned before PG, but no payment session is created.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

function envBool(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
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

  const executionEnabled =
    !maintenance &&
    approved &&
    executionRequested &&
    Boolean(provider) &&
    bridgeConfigured;

  let status = "pending_pg_approval";
  if (maintenance) status = "maintenance";
  else if (!approved) status = "pending_pg_approval";
  else if (!provider) status = "provider_unconfigured";
  else if (!executionRequested) status = "execution_not_enabled";
  else if (!bridgeConfigured) status = "provider_adapter_unconfigured";
  else status = "ready";

  return {
    status,
    maintenance,
    approved,
    provider: provider || null,
    bridgeUrl: bridgeConfigured ? bridgeUrl : "",
    bridgeToken: bridgeConfigured ? bridgeToken : "",
    executionEnabled
  };
}

function corsHeaders(origin) {
  const allow = String(process.env.IGDC_CORS_ALLOW || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigin = !allow.length || (origin && allow.includes(origin)) ? (origin || "*") : "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type, X-Idempotency-Key, X-IGDC-Client",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}

function json(statusCode, body, headers) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function safeParse(body) {
  try {
    const value = JSON.parse(body || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

function isUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function createId() {
  return crypto.randomBytes(12).toString("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

const RATE_LIMIT = new Map();
function rateLimit(key, limitPerMinute) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = Number.isFinite(limitPerMinute) ? limitPerMinute : 120;
  const entry = RATE_LIMIT.get(key) || { startedAt: now, count: 0 };
  if (now - entry.startedAt > windowMs) {
    entry.startedAt = now;
    entry.count = 0;
  }
  entry.count += 1;
  RATE_LIMIT.set(key, entry);
  return entry.count <= limit;
}

function getDonationTarget(config, requestedTarget) {
  const donation = config.donation || {};
  const targets = donation.targets || {};
  const fallback = donation.defaultTarget || "mission";
  const target = String(requestedTarget || fallback).trim().toLowerCase();
  return {
    target: targets[target] ? target : fallback,
    account: targets[target] || targets[fallback] || { label: "도네이션", note: "대상 미지정" }
  };
}

function applyAffiliateDefaults(config, rawUrl, affiliate) {
  const url = new URL(rawUrl);
  const defaults = config.affiliate?.utmDefaults || config.utmDefaults || {};
  if (defaults.utm_source && !url.searchParams.get("utm_source")) url.searchParams.set("utm_source", defaults.utm_source);
  if (defaults.utm_medium && !url.searchParams.get("utm_medium")) url.searchParams.set("utm_medium", defaults.utm_medium);
  if (defaults.utm_campaign && !url.searchParams.get("utm_campaign")) url.searchParams.set("utm_campaign", defaults.utm_campaign);
  const tagParam = config.affiliate?.tagParam || "tag";
  if (affiliate?.tag && !url.searchParams.get(tagParam)) url.searchParams.set(tagParam, String(affiliate.tag));
  return url.toString();
}

async function createPaymentSession(pg, payload) {
  // The bridge is the only provider-specific integration point. It must be a trusted,
  // HTTPS-only server endpoint managed with the approved PG contract.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(pg.bridgeUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${pg.bridgeToken}`,
        "X-IGDC-Payment-Source": "checkout"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      return {
        ok: false,
        error: "provider_session_failed",
        providerStatus: response.status
      };
    }

    if (result.redirectUrl && !isHttpsUrl(result.redirectUrl)) {
      return { ok: false, error: "provider_response_invalid" };
    }

    if (!result.redirectUrl && !result.html) {
      return { ok: false, error: "provider_response_invalid" };
    }

    return {
      ok: true,
      mode: result.html ? "modal" : "redirect",
      redirectUrl: result.redirectUrl || undefined,
      html: result.html || undefined,
      provider: pg.provider
    };
  } catch (error) {
    const code = error?.name === "AbortError" ? "provider_timeout" : "provider_unavailable";
    return { ok: false, error: code };
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const headers = corsHeaders(origin);

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, headers);

  const ip =
    event.headers?.["x-nf-client-connection-ip"] ||
    event.headers?.["x-forwarded-for"] ||
    "unknown";

  if (!rateLimit(String(ip).split(",")[0].trim(), Number(process.env.IGDC_RPM || 120))) {
    return json(429, { ok: false, error: "rate_limited" }, headers);
  }

  const config = loadConfig();
  const features = config.features || {};
  const pg = resolvePg(config);
  const req = safeParse(event.body);

  const method = String(req.method || "card").toLowerCase();
  const purpose = String(req.purpose || "commerce").toLowerCase();
  const allowedPurposes = Array.isArray(config.policy?.purposes)
    ? config.policy.purposes
    : ["commerce", "donation", "affiliate", "tracking"];

  if (!allowedPurposes.includes(purpose)) {
    return json(400, { ok: false, error: "purpose_not_allowed" }, headers);
  }

  const currency = String(req.currency || config.policy?.defaultCurrency || "KRW").toUpperCase();
  const maxAmount = Number(config.policy?.maxAmount || 1_000_000_000);
  const amount = clamp(req.amount || 0, 0, maxAmount);
  const title = String(req.title || "").slice(0, 120);
  const source = String(req.source || "").slice(0, 200);
  const meta = req.meta && typeof req.meta === "object" ? req.meta : {};
  const affiliate = req.affiliate && typeof req.affiliate === "object" ? req.affiliate : null;

  const requestId = createId();
  const orderId = `IGDC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${requestId.slice(0, 8)}`;
  const idem = event.headers?.["x-idempotency-key"] || event.headers?.["X-Idempotency-Key"] || "";
  const payloadHash = sha256(JSON.stringify({ method, purpose, currency, amount, title, source, meta, affiliate }));

  console.log("[IGDC:CHECKOUT]", JSON.stringify({
    requestId,
    orderId,
    purpose,
    method,
    amount,
    currency,
    source,
    ip: String(ip).split(",")[0].trim(),
    payloadHash,
    idempotencyKeyHash: idem ? sha256(idem) : null,
    pgStatus: pg.status
  }));

  if (purpose === "affiliate") {
    if (features.affiliate !== true) {
      return json(503, { ok: false, error: "affiliate_disabled" }, headers);
    }

    const rawUrl = affiliate?.url || req.url || req.href || "";
    if (!rawUrl || !isUrl(rawUrl)) {
      return json(400, { ok: false, error: "affiliate_url_missing" }, headers);
    }

    return json(200, {
      ok: true,
      mode: "redirect",
      purpose,
      orderId,
      requestId,
      redirectUrl: applyAffiliateDefaults(config, rawUrl, affiliate)
    }, headers);
  }

  if (purpose === "tracking") {
    if (features.tracking !== true) {
      return json(503, { ok: false, error: "tracking_disabled" }, headers);
    }

    console.log("[IGDC:TRACK]", JSON.stringify({ requestId, orderId, title, source, meta }));
    return json(200, { ok: true, mode: "tracked", purpose, orderId, requestId }, headers);
  }

  if (purpose === "donation") {
    if (features.donation !== true) {
      return json(503, { ok: false, error: "donation_disabled" }, headers);
    }

    if (!pg.executionEnabled) {
      const donation = getDonationTarget(config, meta.donationTarget || meta.target);
      return json(200, {
        ok: true,
        mode: "donation_information",
        purpose,
        orderId,
        requestId,
        pg: { status: pg.status, executionEnabled: false },
        donation: {
          target: donation.target,
          account: donation.account,
          amount,
          currency,
          title: title || "도네이션"
        },
        message: "PG 승인 전에는 도네이션 결제 세션을 만들지 않습니다."
      }, headers);
    }
  }

  if (purpose === "commerce" && features.commerce !== true) {
    return json(503, { ok: false, error: "commerce_disabled" }, headers);
  }

  if (!pg.executionEnabled) {
    return json(503, {
      ok: false,
      error: "pg_pending_approval",
      pg: {
        status: pg.status,
        approvalRequired: !pg.approved,
        provider: pg.provider
      }
    }, headers);
  }

  const session = await createPaymentSession(pg, {
    orderId,
    requestId,
    purpose,
    method,
    amount,
    currency,
    title,
    source,
    meta,
    idempotencyKeyHash: idem ? sha256(idem) : null
  });

  if (!session.ok) {
    return json(502, {
      ok: false,
      error: session.error || "provider_session_failed",
      orderId,
      requestId,
      provider: pg.provider
    }, headers);
  }

  return json(200, {
    ok: true,
    mode: session.mode,
    purpose,
    orderId,
    requestId,
    provider: session.provider,
    redirectUrl: session.redirectUrl,
    html: session.html
  }, headers);
};
