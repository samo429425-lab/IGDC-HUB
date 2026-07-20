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

export default async function handler(_request, context) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const country = countryCode(geo.country || geo.countryCode || geo.country_code);
  const excluded = country === "KP";
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
