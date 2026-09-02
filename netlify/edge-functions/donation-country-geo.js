/**
 * Donation-only request IP country detector.
 * Dedicated path intentionally avoids the project's /api/* Function redirect.
 */
export const config = { path: "/__igdc-donation-country-geo" };

function text(value) {
  return value == null ? "" : String(value).trim();
}
function countryCode(value) {
  if (value && typeof value === "object") {
    value = value.code || value.alpha2 || value.iso_code || value.countryCode || value.country_code || "";
  }
  const code = text(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
function parseCountryList(value) {
  if (Array.isArray(value)) return value.map(countryCode).filter(Boolean);
  return text(value).split(/[|,\s]+/).map(countryCode).filter(Boolean);
}
function donationBlockedCountries() {
  let raw = "";
  try {
    if (typeof Netlify !== "undefined" && Netlify.env && typeof Netlify.env.get === "function") {
      raw = Netlify.env.get("MARU_DONATION_BLOCK_COUNTRIES") || "";
    }
  } catch (_) {}
  try {
    if (!raw && typeof Deno !== "undefined" && Deno.env && typeof Deno.env.get === "function") {
      raw = Deno.env.get("MARU_DONATION_BLOCK_COUNTRIES") || "";
    }
  } catch (_) {}
  const set = new Set(parseCountryList(raw));
  ["CN", "IR", "SY", "CU", "KP"].forEach((code) => set.add(code));
  return set;
}

export default async function handler(_request, context) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const country = countryCode(geo.country || geo.countryCode || geo.country_code);
  const excluded = !!country && donationBlockedCountries().has(country);
  return new Response(JSON.stringify({
    ok: true,
    source: "netlify-edge-donation-country-geo",
    detectedCountry: country || null,
    country: country || null,
    resolved: !!country,
    excluded
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff"
    }
  });
}
