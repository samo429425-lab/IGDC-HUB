/**
 * checkout.js (Netlify Function)
 * IGDC Unified Checkout Gateway - v2 (production-grade skeleton)
 *
 * Deploy path: netlify/functions/checkout.js
 *
 * Supports purposes:
 * - commerce  : internal payment (PG now or later). If PG not enabled -> safe mock.
 * - donation  : donation routing (foundation/mission group). Returns instructions or redirectUrl.
 * - affiliate : external redirect with tracking payload
 * - tracking  : server-side click/view tracking stub
 *
 * Notes:
 * - No secrets in response.
 * - Keys are env-only (Netlify env vars).
 * - Admin toggles can be stored in ./data/pay-config.json (non-secret).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function readJsonIfExists(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {}
  return null;
}

function getConfig() {
  const candidates = [
    path.join(__dirname, "data", "pay-config.json"),
    path.join(process.cwd(), "netlify", "functions", "data", "pay-config.json"),
    path.join(process.cwd(), "functions", "data", "pay-config.json"),
  ];
  for (const p of candidates) {
    const j = readJsonIfExists(p);
    if (j) return { configPath: p, config: j };
  }
  return { configPath: null, config: {} };
}

function boolEnv(name) {
  const v = process.env[name];
  if (!v) return false;
  return String(v).toLowerCase() === "true" || v === "1" || v === "yes" || v === "on";
}

function corsHeaders(origin) {
  const allow = (process.env.IGDC_CORS_ALLOW || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = !allow.length || (origin && allow.includes(origin));
  return {
    "Access-Control-Allow-Origin": ok ? (origin || "*") : "null",
    "Access-Control-Allow-Headers": "Content-Type, X-Idempotency-Key, X-IGDC-Client",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}

function json(statusCode, obj, headers) {
  return { statusCode, headers, body: JSON.stringify(obj) };
}

function safeParse(body) {
  try { return JSON.parse(body || "{}"); } catch (_) { return {}; }
}

function isUrl(u) {
  try { new URL(u); return true; } catch (_) { return false; }
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function id() {
  return crypto.randomBytes(12).toString("hex");
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

// in-memory soft rate limiter (per function instance)
const RL = { bucket: new Map() };
function rateLimit(key, limitPerMin) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = limitPerMin || 60;
  const ent = RL.bucket.get(key) || { t: now, c: 0 };
  if (now - ent.t > windowMs) { ent.t = now; ent.c = 0; }
  ent.c += 1;
  RL.bucket.set(key, ent);
  return ent.c <= limit;
}

function paymentEnabled(config) {
  const enabled = boolEnv("IGDC_PAY_ENABLED") || config.enabled === true;
  const maintenance = boolEnv("IGDC_MAINTENANCE") || config.maintenance === true;
  return { enabled: enabled && !maintenance, maintenance };
}

function resolveAccounts(config) {
  // non-sensitive display accounts (actual settlement handled elsewhere)
  const commerce = config.commerceAccount || { label: "IGDC 종합상사", note: "운영 계좌(관리자 설정)" };
  const donation = config.donationAccounts || {
    mission: { label: "선교재단", note: "도네이션(선교)" },
    doctrine: { label: "교리봉사단", note: "도네이션(봉사)" }
  };
  return { commerce, donation };
}

/** Provider stub: add Stripe/Toss/etc when ready */
async function createPaymentSession(provider, payload) {
  // IMPORTANT: do not import heavy SDKs unless actually used
  // Return shape:
  // { redirectUrl } OR { html } OR { ok:true, mode:"mock" }
  return { ok: true, mode: "mock", message: "PG 미연동(모의 처리)", echo: payload };
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const headers = corsHeaders(origin);

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, headers);

  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown";
  if (!rateLimit(ip, Number(process.env.IGDC_RPM || 120))) {
    return json(429, { ok: false, error: "rate_limited" }, headers);
  }

  const { config } = getConfig();
  const { enabled, maintenance } = paymentEnabled(config);
  if (!enabled) {
    return json(503, { ok: false, error: "payment_disabled", maintenance }, headers);
  }

  const req = safeParse(event.body);
  const method = String(req.method || "card").toLowerCase();
  const purpose = String(req.purpose || "commerce").toLowerCase(); // commerce|donation|affiliate|tracking
  const currency = String(req.currency || "KRW").toUpperCase();
  const amount = clamp(req.amount || 0, 0, 1_000_000_000);
  const title = String(req.title || "").slice(0, 120);
  const source = String(req.source || "").slice(0, 200);
  const meta = (req.meta && typeof req.meta === "object") ? req.meta : {};
  const affiliate = (req.affiliate && typeof req.affiliate === "object") ? req.affiliate : null;

  // idempotency: client can pass X-Idempotency-Key; we hash it with payload signature
  const idem = event.headers["x-idempotency-key"] || event.headers["X-Idempotency-Key"] || "";
  const sig = sha256(JSON.stringify({ method, purpose, currency, amount, title, source, meta, affiliate }));
  const requestId = id();
  const orderId = "IGDC-" + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + requestId.slice(0,8);

  // Light audit log (no secrets)
  console.log("[IGDC:CHECKOUT]", JSON.stringify({
    requestId, orderId, purpose, method, amount, currency, title, source,
    ip: String(ip).split(",")[0].trim(),
    idem: idem ? sha256(idem) : null
  }));

  // --- 목적별 분기 ---
  if (purpose === "affiliate") {
    const url = affiliate?.url || req.url || req.href || "";
    if (!url || !isUrl(url)) {
      return json(400, { ok: false, error: "affiliate_url_missing" }, headers);
    }

    // optional: attach utm defaults (server-side)
    let redirectUrl = url;
    try {
      const u = new URL(url);
      const utm = config.utmDefaults || {};
      if (utm.source && !u.searchParams.get("utm_source")) u.searchParams.set("utm_source", utm.source);
      if (utm.medium && !u.searchParams.get("utm_medium")) u.searchParams.set("utm_medium", utm.medium);
      if (utm.campaign && !u.searchParams.get("utm_campaign")) u.searchParams.set("utm_campaign", utm.campaign);
      if (affiliate?.tag && !u.searchParams.get("tag")) u.searchParams.set("tag", affiliate.tag);
      redirectUrl = u.toString();
    } catch (_) {}

    return json(200, {
      ok: true,
      mode: "redirect",
      orderId,
      requestId,
      redirectUrl
    }, headers);
  }

  if (purpose === "tracking") {
    // Server-side tracking stub (expand later to DB/log pipeline)
    console.log("[IGDC:TRACK]", JSON.stringify({ requestId, orderId, title, source, meta }));
    return json(200, { ok: true, mode: "tracked", orderId, requestId }, headers);
  }

  if (purpose === "donation") {
    const { donation } = resolveAccounts(config);

    // choose target: mission or doctrine (default mission)
    const target = String(meta.donationTarget || meta.target || "mission").toLowerCase();
    const account = donation[target] || donation.mission || { label: "도네이션", note: "대상 미지정" };

    // If admin provided a donationRedirectUrl, use it (e.g., hosted donation page)
    if (config.donationRedirectUrl && isUrl(config.donationRedirectUrl)) {
      return json(200, {
        ok: true,
        mode: "redirect",
        purpose: "donation",
        orderId,
        requestId,
        redirectUrl: config.donationRedirectUrl
      }, headers);
    }

    // Otherwise return instructions (non-sensitive display data)
    return json(200, {
      ok: true,
      mode: "donation",
      purpose: "donation",
      orderId,
      requestId,
      donation: {
        target,
        account,
        amount,
        currency,
        title: title || "도네이션"
      },
      message: "도네이션 안내(표시용). 실제 입금/정산은 운영 정책에 따라 처리됩니다."
    }, headers);
  }

  // default: commerce
  // Capability gates (env/config)
  const cardEnabled = (boolEnv("IGDC_CARD_ENABLED") || config.card === true) && !!(process.env.STRIPE_SECRET_KEY || process.env.TOSS_SECRET_KEY || process.env.INICIS_KEY);

  if (!cardEnabled) {
    // Safe mock mode until PG is connected
    return json(200, {
      ok: true,
      mode: "mock",
      purpose: "commerce",
      orderId,
      requestId,
      message: "PG 미연동(모의 처리). 연동 후 자동으로 실결제 흐름으로 전환됩니다.",
      echo: { method, amount, currency, title, source }
    }, headers);
  }

  // Provider selection
  const provider = String(process.env.PG_PROVIDER || "auto").toLowerCase();

  const session = await createPaymentSession(provider, {
    orderId, requestId, method, amount, currency, title, source, meta
  });

  // Normalize responses to what igdc-pay understands
  if (session && session.redirectUrl) {
    return json(200, { ok: true, mode: "redirect", orderId, requestId, redirectUrl: session.redirectUrl }, headers);
  }
  if (session && session.html) {
    return json(200, { ok: true, mode: "modal", orderId, requestId, html: session.html }, headers);
  }
  return json(200, Object.assign({ orderId, requestId }, session || { ok:false, error:"provider_error" }), headers);
};
