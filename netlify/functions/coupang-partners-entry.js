"use strict";

/**
 * IGDC -> Coupang Partners entry gateway.
 * Scope is intentionally limited to the Coupang marketplace entry.
 * No other Network Hub or Tour destination is rewritten here.
 */
const DEFAULT_COUPANG_URL = "https://www.coupang.com/";

function text(value) {
  return value == null ? "" : String(value).trim();
}

function isAllowedCoupangUrl(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "coupang.com" || host.endsWith(".coupang.com");
  } catch (_error) {
    return false;
  }
}

function sourceFromEvent(event) {
  const raw = text(event && event.queryStringParameters && event.queryStringParameters.source).toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(raw) ? raw : "networkhub";
}

exports.handler = async function handler(event) {
  const configured = text(process.env.COUPANG_PARTNERS_ENTRY_URL);
  const enabled = /^(1|true|yes|on|enabled)$/i.test(text(process.env.COUPANG_PARTNERS_ENABLED));
  const affiliateActive = enabled && isAllowedCoupangUrl(configured);
  const destination = affiliateActive ? configured : DEFAULT_COUPANG_URL;
  const format = text(event && event.queryStringParameters && event.queryStringParameters.format).toLowerCase();

  if (format === "json") {
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, private",
        "x-igdc-outbound-provider": "coupang-partners-kr",
        "x-igdc-affiliate-state": affiliateActive ? "configured" : "fallback-unconfigured"
      },
      body: JSON.stringify({
        ok: true,
        destination,
        affiliateActive,
        provider: "coupang-partners-kr",
        source: sourceFromEvent(event)
      })
    };
  }

  return {
    statusCode: 302,
    headers: {
      Location: destination,
      "cache-control": "no-store, private",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-igdc-outbound-provider": "coupang-partners-kr",
      "x-igdc-outbound-source": sourceFromEvent(event),
      "x-igdc-affiliate-state": affiliateActive ? "configured" : "fallback-unconfigured"
    },
    body: ""
  };
};
