/**
 * IGDC administrator country/region detector.
 * Returns only the current request's coarse Netlify geo scope from context.geo.
 */
export const config = { path: ["/igdc-country-geo", "/igdc-commerce-country-geo"] };

import { countryCode, fromContext, VERSION } from "./lib/request-geo.v1.mjs";
const text = value => value == null ? "" : String(value).trim();

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

export default async function handler(request, context) {
  const geo = fromContext(context);
  const country = geo.country;
  const commerce = new URL(request.url).pathname === "/igdc-commerce-country-geo";
  const excluded = !!country && (commerce ? country === "KP" : donationBlockedCountries().has(country));
  const resolvedCountry = excluded ? "" : country;
  const region = resolvedCountry ? geo.region : "";
  const payload = {
    ok: true,
    source: "netlify-edge-context-geo",
    geoVersion: VERSION,
    policyScope: commerce ? "commerce" : "donation",
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
      "Netlify-CDN-Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
