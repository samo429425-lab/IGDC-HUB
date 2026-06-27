import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import crypto from "crypto";

const PREMIUM_PRICE_USD = 3.0;
const USD_TO_KRW = 1350;
const PREMIUM_PRICE_KRW = Math.round(PREMIUM_PRICE_USD * USD_TO_KRW);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function envTrue(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

function header(event, name) {
  const headers = event.headers || {};
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) return String(value || "");
  }
  return "";
}

function sameSecret(actual, provided) {
  if (!actual || !provided) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireInternalPaymentCall(event) {
  const expected = String(process.env.IGDC_PAYMENT_INTERNAL_TOKEN || "");
  const provided = header(event, "x-igdc-payment-internal-token");
  return sameSecret(expected, provided);
}

function pgExecutionReady() {
  const rawProvider = String(process.env.IGDC_PG_PROVIDER || process.env.PG_PROVIDER || "").trim();
  const provider = ["", "auto", "none", "pending"].includes(rawProvider.toLowerCase()) ? "" : rawProvider;
  return (
    envTrue("IGDC_PG_APPROVED") &&
    envTrue("IGDC_PG_EXECUTION_ENABLED") &&
    envTrue("PAYMENT_LIVE") &&
    Boolean(provider) &&
    Boolean(String(process.env.IGDC_PG_CHECKOUT_BRIDGE_URL || "").trim()) &&
    Boolean(String(process.env.IGDC_PG_BRIDGE_TOKEN || "").trim())
  );
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function getAuth0Token() {
  const domain = String(process.env.AUTH0_DOMAIN || "").replace(/\/$/, "");
  if (!domain || !process.env.AUTH0_M2M_CLIENT_ID || !process.env.AUTH0_M2M_CLIENT_SECRET) {
    throw new Error("auth0_not_configured");
  }

  const response = await fetch(`${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.AUTH0_M2M_CLIENT_ID,
      client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
      audience: `${domain}/api/v2/`,
      grant_type: "client_credentials"
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("auth0_token_failed");
  return { domain, token: payload.access_token };
}

async function applyPremiumRole(userId) {
  const roleId = String(process.env.AUTH0_ROLE_PREMIUM_ID || "").trim();
  if (!roleId) throw new Error("premium_role_not_configured");

  const { domain, token } = await getAuth0Token();
  const response = await fetch(`${domain}/api/v2/users/${encodeURIComponent(userId)}/roles`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roles: [roleId] })
  });

  if (!response.ok) throw new Error("auth0_role_apply_failed");
}

function parseRequest(event) {
  try {
    const value = JSON.parse(event.body || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-IGDC-Payment-Internal-Token",
        "Cache-Control": "no-store"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  if (!pgExecutionReady()) return json(503, { ok: false, error: "pg_pending_approval" });
  if (!requireInternalPaymentCall(event)) return json(403, { ok: false, error: "internal_verification_required" });

  const body = parseRequest(event);
  if (!body) return json(400, { ok: false, error: "invalid_json" });

  const userId = String(body.user_id || "").trim();
  const orderId = String(body.order_id || "").trim();
  const currency = String(body.currency || "").toUpperCase();
  const amount = Number(body.amount);

  if (!userId || !orderId || !Number.isFinite(amount) || !currency) {
    return json(400, { ok: false, error: "payment_data_missing" });
  }

  if (currency === "KRW" && amount !== PREMIUM_PRICE_KRW) {
    return json(400, { ok: false, error: "amount_mismatch" });
  }
  if (currency === "USD" && Math.abs(amount - PREMIUM_PRICE_USD) > 0.000001) {
    return json(400, { ok: false, error: "amount_mismatch" });
  }
  if (!["KRW", "USD"].includes(currency)) {
    return json(400, { ok: false, error: "unsupported_currency" });
  }

  try {
    const supabase = getSupabase();
    const existing = await supabase
      .from("payments")
      .select("order_id")
      .eq("order_id", orderId)
      .maybeSingle();

    if (existing.error) throw new Error("payment_lookup_failed");

    if (!existing.data) {
      const inserted = await supabase.from("payments").insert({
        user_id: userId,
        order_id: orderId,
        amount,
        currency,
        type: "premium",
        base_usd: PREMIUM_PRICE_USD
      });

      if (inserted.error) throw new Error("payment_record_failed");
    }

    await applyPremiumRole(userId);

    return json(200, {
      ok: true,
      status: existing.data ? "already_verified" : "verified",
      order_id: orderId,
      membership: "premium"
    });
  } catch (error) {
    console.error("[IGDC:PREMIUM_VERIFY]", error?.message || error);
    return json(502, { ok: false, error: "premium_verification_failed" });
  }
}
