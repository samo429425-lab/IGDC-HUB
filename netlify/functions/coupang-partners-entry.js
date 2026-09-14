"use strict";

// IGDC -> Coupang Partners entry gateway.
// This function intentionally affects ONLY the Coupang Network Hub entry.
// Before a Partners URL is configured it falls back to the ordinary Coupang
// homepage. Secrets are never exposed to the browser.

const DEFAULT_COUPANG_URL = "https://www.coupang.com/";

function text(v) { return v == null ? "" : String(v).trim(); }
function enabled(v) { return /^(1|true|yes|on|enabled)$/i.test(text(v)); }
function allowedCoupangUrl(value) {
  try {
    const u = new URL(text(value));
    if (u.protocol !== "https:") return false;
    const h = String(u.hostname || "").toLowerCase();
    return h === "coupang.com" || h === "www.coupang.com" || h.endsWith(".coupang.com");
  } catch (_) {
    return false;
  }
}

exports.handler = async function handler(event) {
  const configured = text(process.env.COUPANG_PARTNERS_ENTRY_URL);
  const usePartner = enabled(process.env.COUPANG_PARTNERS_ENABLED) && allowedCoupangUrl(configured);
  const destination = usePartner ? configured : DEFAULT_COUPANG_URL;
  const sourceRaw = text(event && event.queryStringParameters && event.queryStringParameters.source).toLowerCase();
  const source = /^[a-z0-9_-]{1,40}$/.test(sourceRaw) ? sourceRaw : "networkhub";

  return {
    statusCode: 302,
    headers: {
      Location: destination,
      "cache-control": "no-store, private",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-igdc-outbound-provider": "coupang-partners-kr",
      "x-igdc-outbound-source": source,
      "x-igdc-affiliate-state": usePartner ? "configured_partner_link" : "fallback_coupang_home"
    },
    body: ""
  };
};
