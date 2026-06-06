/**
 * netlify/functions/maru-ai-key-health.js
 * MARU OpenAI API Key Health Diagnostic v90
 *
 * Required Netlify environment variable:
 *   OPENAI_API_KEY
 *
 * Browser test:
 *   https://igdcglobal.com/.netlify/functions/maru-ai-key-health
 *
 * This diagnostic never returns the raw API key.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body, null, 2) };
}

function maskKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw.length <= 14) return raw.slice(0, 3) + "..." + raw.slice(-2);
  return raw.slice(0, 7) + "..." + raw.slice(-6);
}

function keyShape(rawValue) {
  const original = String(rawValue || "");
  const trimmed = original.trim();
  return {
    present: !!trimmed,
    length: trimmed.length,
    startsWithSk: trimmed.startsWith("sk-"),
    startsWithProject: trimmed.startsWith("sk-proj-"),
    hasLeadingOrTrailingWhitespace: original !== trimmed,
    masked: maskKey(trimmed)
  };
}

async function checkOpenAIKey() {
  const startedAt = Date.now();
  const raw = process.env.OPENAI_API_KEY || "";
  const key = String(raw).trim();
  const shape = keyShape(raw);

  if (!shape.present) {
    return {
      ok: false,
      alive: false,
      diagnosis: "missing_netlify_env",
      message: "Netlify Function cannot read OPENAI_API_KEY.",
      key: shape,
      nextStep: "Add OPENAI_API_KEY to this Netlify site's Environment variables, then redeploy.",
      latencyMs: Date.now() - startedAt
    };
  }

  if (!shape.startsWithSk) {
    return {
      ok: false,
      alive: false,
      diagnosis: "bad_key_format",
      message: "OPENAI_API_KEY exists, but it does not look like an OpenAI API key.",
      key: shape,
      nextStep: "Check for wrong value, quotes, copied JSON, or pasted variable name instead of key value.",
      latencyMs: Date.now() - startedAt
    };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      }
    });

    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = { raw: text.slice(0, 500) }; }

    if (res.ok) {
      return {
        ok: true,
        alive: true,
        diagnosis: "openai_key_alive",
        message: "Netlify can read OPENAI_API_KEY and OpenAI accepts it.",
        openaiStatus: res.status,
        checkedEndpoint: "GET https://api.openai.com/v1/models",
        key: shape,
        latencyMs: Date.now() - startedAt
      };
    }

    const error = payload && payload.error ? payload.error : {};
    const errorCode = String(error.code || "");
    const errorType = String(error.type || "");
    const errorMessage = String(error.message || "").slice(0, 500);

    let diagnosis = "openai_rejected_request";
    let message = "OpenAI rejected the request.";
    let nextStep = "Check OpenAI project permission, billing, and API key status.";

    if (res.status === 401 || errorCode === "invalid_api_key") {
      diagnosis = "invalid_openai_api_key";
      message = "OpenAI rejected this key as invalid.";
      nextStep = "Create a new OpenAI API key, replace Netlify OPENAI_API_KEY, then clear-cache redeploy.";
    } else if (res.status === 429 || /quota|billing|rate/i.test(errorMessage + " " + errorCode)) {
      diagnosis = "quota_billing_or_rate_limit";
      message = "The key is recognized, but usage is blocked by quota, billing, or rate limits.";
      nextStep = "Check OpenAI billing, usage limits, and project quota.";
    } else if (res.status === 403) {
      diagnosis = "permission_or_project_block";
      message = "The key is recognized, but the project or permission is blocked.";
      nextStep = "Check OpenAI project permissions and organization/project selection.";
    }

    return {
      ok: false,
      alive: false,
      diagnosis,
      message,
      nextStep,
      openaiStatus: res.status,
      openaiErrorType: errorType || null,
      openaiErrorCode: errorCode || null,
      openaiErrorMessage: errorMessage || null,
      checkedEndpoint: "GET https://api.openai.com/v1/models",
      key: shape,
      latencyMs: Date.now() - startedAt
    };
  } catch (err) {
    return {
      ok: false,
      alive: false,
      diagnosis: "netlify_to_openai_network_error",
      message: "Netlify Function could not reach OpenAI API.",
      error: String(err && err.message || err).slice(0, 500),
      key: shape,
      nextStep: "Check Netlify outbound network/runtime error logs.",
      latencyMs: Date.now() - startedAt
    };
  }
}

exports.handler = async function handler(event) {
  if (event && event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  const result = await checkOpenAIKey();
  return json(200, {
    service: "maru-ai-key-health",
    version: "v90",
    time: new Date().toISOString(),
    ...result
  });
};
