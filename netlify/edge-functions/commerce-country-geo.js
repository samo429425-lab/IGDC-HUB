/**
 * IGDC administrator country/region detector.
 * Returns only the current request's coarse Netlify geo scope.
 */
export const config = { path: "/igdc-country-geo" };

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

function readEnv(name) {
  let raw = "";
  try {
    if (typeof Netlify !== "undefined" && Netlify.env && typeof Netlify.env.get === "function") {
      raw = Netlify.env.get(name) || "";
    }
  } catch (_) {}
  try {
    if (!raw && typeof Deno !== "undefined" && Deno.env && typeof Deno.env.get === "function") {
      raw = Deno.env.get(name) || "";
    }
  } catch (_) {}
  try {
    if (!raw && typeof process !== "undefined" && process.env) {
      raw = process.env[name] || "";
    }
  } catch (_) {}
  return raw;
}

function parseJson(value) {
  try { return JSON.parse(String(value)); } catch (_) { return null; }
}

function parseCountryList(value) {
  if (Array.isArray(value)) return value.map(countryCode).filter(Boolean);
  if (value && typeof value === "object") {
    const nested = value.countries || value.blockedCountries || value.donationBlockedCountries || value.noDonationCountries;
    if (nested != null) return parseCountryList(nested);
    return Object.keys(value)
      .filter((key) => value[key] === true || String(value[key]).toLowerCase() === "true")
      .map(countryCode)
      .filter(Boolean);
  }

  const raw = text(value);
  if (!raw) return [];
  if (/^[\[{]/.test(raw)) {
    const parsed = parseJson(raw);
    if (parsed != null) return parseCountryList(parsed);
  }

  return raw
    .split(/[|,\s]+/)
    .map((part) => part.replace(/^[\[\]{}"']+|[\[\]{}"']+$/g, ""))
    .map(countryCode)
    .filter(Boolean);
}

function rowBlocksDonation(row) {
  if (!row || typeof row !== "object") return false;
  if (row.donation === false || row.noDonation === true) return true;

  const blocked = Array.isArray(row.blockChannels || row.blockedChannels)
    ? (row.blockChannels || row.blockedChannels)
    : text(row.blockChannels || row.blockedChannels).split(/[|,\s]+/);
  if (blocked.some((value) => text(value).toLowerCase() === "donation")) return true;

  /* Match the existing SearchBank country-policy semantics exactly:
     when a country supplies an allow-list, every omitted channel is blocked. */
  const allowed = Array.isArray(row.allowChannels || row.allowedChannels)
    ? (row.allowChannels || row.allowedChannels)
    : text(row.allowChannels || row.allowedChannels).split(/[|,\s]+/);
  const normalizedAllowed = allowed.map((value) => text(value).toLowerCase()).filter(Boolean);
  return normalizedAllowed.length > 0 && !normalizedAllowed.includes("donation");
}

function countryPolicyBlocksDonation(country) {
  const raw = readEnv("MARU_BANK_COUNTRY_POLICY");
  if (!raw || !country) return false;
  const policy = typeof raw === "object" ? raw : parseJson(raw);
  if (!policy || typeof policy !== "object") return false;

  /* SearchBank accepts a country-keyed policy table. Keep compatibility with
     existing wrapped policy objects without creating a second country list. */
  const tables = [policy, policy.markets, policy.countries, policy.countryPolicy, policy.policies];
  for (const table of tables) {
    if (!table || typeof table !== "object") continue;
    const row = table[country] || table[country.toUpperCase()] || table[country.toLowerCase()];
    if (rowBlocksDonation(row)) return true;
  }
  return false;
}

function donationPolicyReadyFor(country) {
  if (!country) return false;

  /* The existing global Donation block-list is itself a complete negative
     policy: if it is configured, a country not in the list is positively allowed. */
  const blockRaw = readEnv("MARU_DONATION_BLOCK_COUNTRIES");
  if (text(blockRaw)) return true;

  /* If the global list is not available in the Edge runtime, only an explicit
     existing SearchBank country-policy row can make a guest-country decision. */
  const raw = readEnv("MARU_BANK_COUNTRY_POLICY");
  if (!raw) return false;
  const policy = typeof raw === "object" ? raw : parseJson(raw);
  if (!policy || typeof policy !== "object") return false;
  const tables = [policy, policy.markets, policy.countries, policy.countryPolicy, policy.policies];
  for (const table of tables) {
    if (!table || typeof table !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(table, country) ||
        Object.prototype.hasOwnProperty.call(table, country.toUpperCase()) ||
        Object.prototype.hasOwnProperty.call(table, country.toLowerCase())) return true;
  }
  return false;
}

function donationBlockedCountries() {
  const set = new Set(parseCountryList(readEnv("MARU_DONATION_BLOCK_COUNTRIES")));
  /* Keep the existing hard safety floor without replacing configured policy. */
  set.add("KP");
  return set;
}

export default async function handler(_request, context) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const country = countryCode(geo.country || geo.countryCode || geo.country_code);
  const blockedByPolicy = !!country && (
    donationBlockedCountries().has(country) ||
    countryPolicyBlocksDonation(country)
  );
  const excluded = blockedByPolicy;
  const donationPolicyReady = donationPolicyReadyFor(country);
  /* Guest visibility is positive-allow only: both current country and the
     existing Donation policy source must be resolved before revealing UI. */
  const donationAllowed = !!country && donationPolicyReady && !blockedByPolicy;
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
    detectedCountry: country || null,
    donationPolicyReady,
    donationAllowed
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
