"use strict";

/*
 * Social-only country/language routing contract.
 * It deliberately ignores state/province information used by Commerce.
 * No IP value is stored or returned; only an already-resolved country code
 * from the hosting edge is used for the current response.
 */
const Registry = require("../data/country-region-registry.v1.json");

const VERSION = "social-country-routing-v1.1.0-region-country-ip-scope";
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
function resolve(event, input) {
  const source = plain(input);
  const explicit = text(
    source.countryCode || source.country || source.country_code,
  ).toUpperCase();
  const forceGlobal = /^(global|world|all)$/i.test(
    text(source.scopeMode || source.countryScope || source.managementScope),
  );
  const selected = forceGlobal ? "" : countryRow(explicit) ? explicit : "";
  const edge = forceGlobal ? "" : edgeCountry(event);
  const code = selected || edge;
  const row = countryRow(code);
  const languages = localesForCountry(
    code,
    source.languages || source.language || source.lang,
  );
  return {
    version: VERSION,
    countryCode: row ? row.code : null,
    countryNameKo: row ? row.nameKo : null,
    countryNameEn: row ? row.nameEn : null,
    worldRegion: row ? row.regionGroup : null,
    languages,
    source: forceGlobal
      ? "explicit_global"
      : selected
        ? "explicit_country"
        : edge
          ? "edge_country"
          : "language_fallback",
    stateProvinceUsed: false,
    ipStored: false,
    fallback: row ? "country_language_then_global" : "language_then_global",
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
function matchScore(row, route) {
  const scopes = scopesFrom(row);
  const country = text(route && route.countryCode).toUpperCase();
  const languages = normalizeLanguages(route && route.languages);
  const rowLanguage = normalizeLanguage(row && (row.language || row.lang));
  let score = 0;
  // Country fit outranks generic popularity: a visitor should first see
  // candidates explicitly researched for that country, then fall back.
  if (country && scopes.countries.includes(country)) score += 120;
  else if (scopes.countries.length) score -= 60;
  if (rowLanguage && languages.includes(rowLanguage))
    score += 16 - languages.indexOf(rowLanguage) * 2;
  else if (scopes.languages.some((language) => languages.includes(language)))
    score += 10;
  return score;
}

module.exports = {
  VERSION,
  catalog,
  regionCatalog,
  countryRow,
  normalizeLanguage,
  normalizeLanguages,
  localesForCountry,
  edgeCountry,
  resolve,
  scopesFrom,
  matchScore,
};
