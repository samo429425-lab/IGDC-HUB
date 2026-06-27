import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import crypto from "crypto";

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

function requireInternalUpgradeCall(event) {
  const expected = String(process.env.IGDC_STANDARD_UPGRADE_INTERNAL_TOKEN || process.env.IGDC_PAYMENT_INTERNAL_TOKEN || "");
  const provided = header(event, "x-igdc-standard-upgrade-token") || header(event, "x-igdc-payment-internal-token");
  return sameSecret(expected, provided);
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

async function applyStandardRole(userId) {
  const roleId = String(process.env.AUTH0_ROLE_STANDARD_ID || "").trim();
  if (!roleId) throw new Error("standard_role_not_configured");

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
        "Access-Control-Allow-Headers": "Content-Type, X-IGDC-Standard-Upgrade-Token",
        "Cache-Control": "no-store"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  // Standard upgrade is a server-owned eligibility decision, never a browser-side user_id claim.
  if (!envTrue("IGDC_STANDARD_UPGRADE_ENABLED")) {
    return json(503, { ok: false, error: "standard_upgrade_pending_configuration" });
  }
  if (!requireInternalUpgradeCall(event)) {
    return json(403, { ok: false, error: "internal_verification_required" });
  }

  const body = parseRequest(event);
  if (!body) return json(400, { ok: false, error: "invalid_json" });

  const userId = String(body.user_id || "").trim();
  if (!userId) return json(400, { ok: false, error: "user_id_missing" });

  try {
    const supabase = getSupabase();
    const profileResult = await supabase
      .from("profiles")
      .select("phone, address")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileResult.error) throw new Error("profile_lookup_failed");
    if (!profileResult.data?.phone || !profileResult.data?.address) {
      return json(400, { ok: false, error: "eligibility_not_met" });
    }

    await applyStandardRole(userId);
    return json(200, { ok: true, status: "verified", membership: "standard" });
  } catch (error) {
    console.error("[IGDC:STANDARD_VERIFY]", error?.message || error);
    return json(502, { ok: false, error: "standard_upgrade_failed" });
  }
}
