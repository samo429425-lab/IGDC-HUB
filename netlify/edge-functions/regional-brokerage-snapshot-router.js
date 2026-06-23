/**
 * Distribution Hub country/region snapshot router.
 *
 * It is intentionally restricted to the Distribution Hub snapshot. The router
 * only serves paths listed in the publisher's small manifest, so legacy or
 * stale /data/auto files cannot become public merely because they exist.
 */
export const config = { path: "/data/distribution.snapshot.json" };

const MANIFEST_PATH = "/data/auto/regional-brokerage-manifest.json";

function countryCode(context) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const country = geo.country && typeof geo.country === "object" ? geo.country : {};
  for (const value of [country.code, country.alpha2, country.iso_code, geo.countryCode, geo.country_code]) {
    const code = String(value || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return "";
}
function regionCode(context, country) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const subdivision = geo.subdivision && typeof geo.subdivision === "object" ? geo.subdivision : {};
  for (const value of [subdivision.code, subdivision.iso_code, subdivision.id, geo.subdivisionCode, geo.regionCode, geo.stateCode, geo.provinceCode]) {
    let code = String(value || "").trim().toUpperCase().replace(/[._/]/g, "-");
    if (country && code.startsWith(country + "-")) code = code.slice(3);
    if (/^[A-Z0-9]{2,5}$/.test(code)) return code;
  }
  return "";
}
async function approvedPaths(url) {
  const manifestUrl = new URL(MANIFEST_PATH, url);
  try {
    const response = await fetch(manifestUrl.toString(), { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok || !String(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) return new Set();
    const payload = await response.json();
    if (!payload || payload.model !== "verified-external-responsible-seller-referral" || !Array.isArray(payload.snapshots)) return new Set();
    return new Set(payload.snapshots.filter((value) => typeof value === "string" && value.startsWith("/data/auto/") && value.endsWith("/distribution.snapshot.json")));
  } catch (_e) {
    return new Set();
  }
}
async function loadSnapshot(url, request, relative) {
  const target = new URL(relative, url);
  target.search = url.search;
  try {
    const response = await fetch(new Request(target.toString(), request));
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    return response.ok && contentType.includes("application/json") ? response : null;
  } catch (_e) {
    return null;
  }
}

export default async function regionalBrokerageSnapshotRouter(request, context) {
  if (request.method !== "GET" && request.method !== "HEAD") return context.next();
  const url = new URL(request.url);
  const country = countryCode(context);
  if (!country) return context.next();

  const approved = await approvedPaths(url);
  if (!approved.size) return context.next();

  const region = regionCode(context, country);
  const candidates = [];
  if (region) candidates.push({ path: `/data/auto/${country}/${region}/distribution.snapshot.json`, scope: `${country}-${region}` });
  candidates.push({ path: `/data/auto/${country}/distribution.snapshot.json`, scope: country });

  for (const candidate of candidates) {
    if (!approved.has(candidate.path)) continue;
    const response = await loadSnapshot(url, request, candidate.path);
    if (!response) continue;
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-IGDC-Distribution-Scope", candidate.scope);
    headers.set("X-IGDC-Distribution-Model", "regional-brokerage-referral");
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return context.next();
}
