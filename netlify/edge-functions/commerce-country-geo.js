/**
 * IGDC administrator country/region detector.
 * Returns only the current request's coarse Netlify geo scope.
 */
export const config = { path: "/api/igdc-country-geo" };

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
function regionCode(value, country) {
  if (value && typeof value === "object") {
    value = value.code || value.iso_code || value.id || value.subdivisionCode || value.regionCode || value.stateCode || value.provinceCode || "";
  }
  let code = text(value).toUpperCase().replace(/[._/\s]+/g, "-").replace(/^-+|-+$/g, "");
  if (country && code.startsWith(country + "-")) code = code.slice(country.length + 1);
  return /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(code) ? code : "";
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
  try {
    if (!raw && typeof process !== "undefined" && process.env) {
      raw = process.env.MARU_DONATION_BLOCK_COUNTRIES || "";
    }
  } catch (_) {}

  const set = new Set(parseCountryList(raw));
  /* Keep the existing hard safety floor without replacing the configured OCS/SearchBank policy. */
  set.add("KP");
  return set;
}

export default async function handler(_request, context) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const country = countryCode(geo.country || geo.countryCode || geo.country_code);
  const excluded = !!country && donationBlockedCountries().has(country);
  const resolvedCountry = excluded ? "" : country;
  const region = resolvedCountry ? regionCode(
    geo.subdivision || geo.subdivisionCode || geo.regionCode || geo.stateCode || geo.provinceCode || geo.region || geo.state,
    resolvedCountry
  ) : "";
  const payload = {
    ok: true,
    source: "netlify-edge-context-geo",
    country: resolvedCountry || null,
    region: region || null,
    resolved: !!resolvedCountry,
    excluded,
    detectedCountry: country || null
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff"
    }
  });
}
