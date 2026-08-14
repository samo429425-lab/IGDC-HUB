"use strict";

/*
 * Social-only country/language routing contract.
 * It deliberately ignores state/province information used by Commerce.
 * No IP value is stored or returned; only an already-resolved country code
 * from the hosting edge is used for the current response.
 */
const Registry = require("../data/country-region-registry.v1.json");

const VERSION = "social-country-routing-v1.2.0-consumption-weighted-scope";
const SUPPORTED = new Set([
  "ko",
  "en",
  "ja",
  "zh",
  "zht",
  "de",
  "fr",
  "es",
  "pt",
  "ru",
  "it",
  "nl",
  "sv",
  "pl",
  "tr",
  "ar",
  "th",
  "vi",
  "bn",
  "fa",
  "hi",
  "hu",
  "id",
  "ms",
  "sw",
  "ta",
  "tl",
  "uk",
  "ur",
  "uz",
]);
const COUNTRY_LOCALES = Object.freeze({
  KR: "ko,en",
  US: "en",
  GB: "en",
  CA: "en,fr",
  AU: "en",
  NZ: "en",
  IE: "en",
  SG: "en,zh,ms,ta",
  HK: "zht,en",
  MO: "zht,pt,en",
  TW: "zht",
  CN: "zh,en",
  JP: "ja",
  DE: "de,en",
  AT: "de",
  CH: "de,fr,it,en",
  FR: "fr",
  BE: "nl,fr,en",
  NL: "nl,en",
  ES: "es",
  MX: "es",
  AR: "es",
  CL: "es",
  CO: "es",
  PE: "es",
  PT: "pt",
  BR: "pt",
  IT: "it",
  SE: "sv,en",
  PL: "pl",
  RU: "ru,en",
  UA: "uk,ru,en",
  TR: "tr,en",
  SA: "ar,en",
  AE: "ar,en",
  EG: "ar,en",
  MA: "ar,fr,en",
  IN: "hi,en,bn,ta,ur",
  BD: "bn,en",
  PK: "ur,en",
  IR: "fa",
  ID: "id,en",
  MY: "ms,en,zh,ta",
  TH: "th",
  VN: "vi",
  KE: "sw,en",
  TZ: "sw,en",
  UG: "en,sw",
  UZ: "uz,ru,en",
  HU: "hu,en",
  PH: "tl,en",
  LK: "ta,en",
});
const FALLBACK_LOCALES = Object.freeze(["en"]);

function text(value) {
  return value == null ? "" : String(value).trim();
}
function unique(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean)),
  );
}
function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function baseLanguage(value) {
  const raw = text(value).replace(/_/g, "-").toLowerCase();
  if (!raw) return "";
  if (raw === "zh-hans" || raw === "zh-cn" || raw === "zh-sg") return "zh";
  if (
    raw === "zh-hant" ||
    raw === "zh-tw" ||
    raw === "zh-hk" ||
    raw === "zh-mo"
  )
    return "zht";
  if (raw === "fil") return "tl";
  return raw.split("-")[0];
}
function normalizeLanguage(value) {
  const lang = baseLanguage(value);
  return SUPPORTED.has(lang) ? lang : "";
}
function normalizeLanguages(values) {
  return unique(
    (Array.isArray(values) ? values : text(values).split(",")).map(
      normalizeLanguage,
    ),
  ).filter(Boolean);
}
function countries() {
  return Array.isArray(Registry && Registry.countries)
    ? Registry.countries
    : [];
}
function regionCatalog() {
  return Array.isArray(Registry && Registry.regions)
    ? Registry.regions
        .filter((row) => row && row.id)
        .map((row) => ({
          id: row.id,
          order: row.order,
          nameKo: row.nameKo,
          nameEn: row.nameEn,
          countryCount: row.countryCount,
        }))
    : [];
}
function catalog() {
  return countries()
    .filter((row) => row && row.enabled !== false)
    .map((row) => ({
      code: row.code,
      nameKo: row.nameKo,
      nameEn: row.nameEn,
      regionGroup: row.regionGroup,
    }));
}
function countryRow(value) {
  const code = text(value).toUpperCase();
  return (
    countries().find(
      (row) =>
        text(row && row.code).toUpperCase() === code && row.enabled !== false,
    ) || null
  );
}
function localesForCountry(value, requested) {
  const country = countryRow(value);
  const code = country ? country.code : "";
  const preferred = normalizeLanguages(requested);
  const defaults = normalizeLanguages(
    COUNTRY_LOCALES[code] || FALLBACK_LOCALES,
  );
  const out = unique(preferred.concat(defaults));
  if (!out.includes("en")) out.push("en");
  return out.slice(0, 8);
}
function headerMap(event) {
  const out = {};
  Object.entries((event && event.headers) || {}).forEach(([key, value]) => {
    out[String(key).toLowerCase()] = value;
  });
  return out;
}
function readGeoHeader(value) {
  const raw = text(value);
  if (!raw) return {};
  for (const candidate of [
    raw,
    (() => {
      try {
        return decodeURIComponent(raw);
      } catch (_e) {
        return "";
      }
    })(),
  ]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_e) {}
  }
  return {};
}
function edgeCountry(event) {
  const headers = headerMap(event);
  const geo = Object.assign(
    {},
    plain(event && event.geo),
    readGeoHeader(headers["x-nf-geo"]),
  );
  const country = plain(geo.country);
  const raw = text(
    country.code ||
      country.alpha2 ||
      (typeof geo.country === "string" ? geo.country : "") ||
      geo.countryCode ||
      geo.country_code ||
      headers["cf-ipcountry"] ||
      headers["x-country"] ||
      headers["x-vercel-ip-country"] ||
      headers["x-nf-country"],
  ).toUpperCase();
  return countryRow(raw) ? raw : "";
}
function regionRow(value) {
  const id = text(value);
  if (!id) return null;
  return (
    regionCatalog().find((row) => text(row && row.id) === id) || null
  );
}
function regionForCountry(value) {
  const row = countryRow(value);
  return row ? text(row.regionGroup) : "";
}
function countriesInRegion(value) {
  const id = text(value);
  if (!id) return [];
  return countries()
    .filter((row) => row && row.enabled !== false && text(row.regionGroup) === id)
    .map((row) => text(row.code).toUpperCase())
    .filter(Boolean);
}
function resolve(event, input) {
  const source = plain(input);
  const explicit = text(
    source.countryCode || source.country || source.country_code,
  ).toUpperCase();
  const requestedMode = text(
    source.scopeMode || source.countryScope || source.managementScope,
  ).toLowerCase();
  const explicitRegion = text(
    source.regionId || source.region || source.worldRegion || source.regionGroup,
  );
  const forceGlobal = /^(global|world|all)$/.test(requestedMode);
  const forceRegion = /^(region|regional)$/.test(requestedMode);
  const forceCountry = /^(country|local)$/.test(requestedMode);
  const autoMode = !requestedMode || /^(auto|ip|edge)$/.test(requestedMode);
  const selected = !forceGlobal && countryRow(explicit) ? explicit : "";
  const edge = !forceGlobal ? edgeCountry(event) : "";
  const code = selected || (!forceRegion && !forceGlobal ? edge : "");
  const row = countryRow(code);
  const inferredRegion = row ? text(row.regionGroup) : "";
  const region = forceGlobal
    ? ""
    : regionRow(explicitRegion)
      ? explicitRegion
      : inferredRegion;
  const languages = localesForCountry(
    code,
    source.languages || source.language || source.lang,
  );
  const mode = forceGlobal
    ? "global"
    : selected || forceCountry
      ? "country"
      : forceRegion && region
        ? "region"
        : edge
          ? "auto_country"
          : region
            ? "region"
            : "global_fallback";
  return {
    version: VERSION,
    scopeMode: mode,
    countryCode: row ? row.code : null,
    countryNameKo: row ? row.nameKo : null,
    countryNameEn: row ? row.nameEn : null,
    worldRegion: region || null,
    regionId: region || null,
    regionCountries: countriesInRegion(region),
    languages,
    source: forceGlobal
      ? "explicit_global"
      : selected
        ? "explicit_country"
        : forceRegion && region
          ? "explicit_region"
          : edge
            ? "edge_country"
            : region
              ? "region_fallback"
              : autoMode
                ? "language_global_fallback"
                : "global_fallback",
    stateProvinceUsed: false,
    ipStored: false,
    fallback: row
      ? "country_consumption_then_region_then_global"
      : region
        ? "region_consumption_then_global"
        : "global_consumption",
  };
}
function scopesFrom(row) {
  const source = plain(row);
  const raw = plain(source.raw);
  const evidence = plain(source.evidence);
  const geo = plain(
    source.geo ||
      source.geoScope ||
      raw.geo ||
      raw.geoScope ||
      evidence.geoScope,
  );
  const countryValues =
    source.countryScopes ||
    source.countryScope ||
    source.countryCodes ||
    source.countryCode ||
    source.country ||
    raw.countryScopes ||
    raw.countryScope ||
    raw.countryCodes ||
    raw.countryCode ||
    raw.country ||
    geo.countryCodes ||
    geo.countryCode ||
    geo.country;
  const languageValues =
    source.languageScopes ||
    source.languages ||
    source.language ||
    source.lang ||
    raw.languageScopes ||
    raw.languages ||
    raw.language ||
    raw.lang ||
    geo.languages ||
    geo.language;
  return {
    countries: unique(
      (Array.isArray(countryValues)
        ? countryValues
        : text(countryValues).split(",")
      )
        .map((v) => text(v).toUpperCase())
        .filter((v) => !!countryRow(v)),
    ),
    languages: normalizeLanguages(languageValues),
  };
}
function matchTier(row, route) {
  const scopes = scopesFrom(row);
  const country = text(route && route.countryCode).toUpperCase();
  const region = text(route && (route.worldRegion || route.regionId));
  const mode = text(route && route.scopeMode).toLowerCase();
  const rowRegions = unique(scopes.countries.map(regionForCountry).filter(Boolean));
  if (mode === "global" || mode === "global_fallback" || (!country && !region)) {
    return scopes.countries.length ? "global_scoped" : "global_unscoped";
  }
  if (country && scopes.countries.includes(country)) return "country_exact";
  if (region && rowRegions.includes(region)) return "region_match";
  if (!scopes.countries.length) return "global_unscoped";
  return "cross_region";
}
function matchScore(row, route) {
  const scopes = scopesFrom(row);
  const languages = normalizeLanguages(route && route.languages);
  const rowLanguage = normalizeLanguage(row && (row.language || row.lang));
  const tier = matchTier(row, route);
  let score = 0;
  if (tier === "country_exact") score += 120;
  else if (tier === "region_match") score += 58;
  else if (tier === "global_unscoped") score += 34;
  else if (tier === "global_scoped") score += 18;
  else if (tier === "cross_region") score += 6;
  if (rowLanguage && languages.includes(rowLanguage))
    score += 18 - languages.indexOf(rowLanguage) * 2;
  else if (scopes.languages.some((language) => languages.includes(language)))
    score += 11;
  return score;
}


module.exports = {
  VERSION,
  catalog,
  regionCatalog,
  countryRow,
  regionRow,
  regionForCountry,
  countriesInRegion,
  normalizeLanguage,
  normalizeLanguages,
  localesForCountry,
  edgeCountry,
  resolve,
  scopesFrom,
  matchTier,
  matchScore,
};
