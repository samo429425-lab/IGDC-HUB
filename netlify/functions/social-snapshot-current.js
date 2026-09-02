"use strict";

/**
 * Public read-only endpoint for the latest stored Social Hub release.
 * It exposes only the already-sanitized public snapshot document.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const CountryRouting = require("./lib/social-country-routing.v1");

const VERSION = "social-snapshot-current-v1.4.0-compact-front-read-cache";

function text(value) {
  return value == null ? "" : String(value).trim();
}

const FRONT_SECTION_KEYS = Object.freeze([
  "social-youtube", "social-instagram", "social-tiktok", "social-facebook",
  "social-wechat", "social-weibo", "social-pinterest", "social-reddit", "social-twitter",
]);
let warmProjectionCache = null;

function compactObject(source, keys) {
  const input = source && typeof source === "object" ? source : {};
  const out = {};
  keys.forEach((key) => {
    const value = input[key];
    if (value == null || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    out[key] = value;
  });
  return out;
}

function compactFrontSlot(slot) {
  if (!slot || typeof slot !== "object") return null;
  const out = compactObject(slot, [
    "id", "contentId", "type", "title", "description",
    "url", "link", "href", "permalink", "sourceUrl", "latestContentUrl",
    "viewerUrl", "thumb", "thumbnail", "thumbnailUrl", "image", "embedUrl",
    "platform", "creator", "creatorName", "creatorHandle", "displayMode",
    "sample", "placeholder", "isSample", "realProduct",
  ]);
  const source = compactObject(slot.source, ["platform", "provider", "url"]);
  if (Object.keys(source).length) out.source = source;
  const social = compactObject(slot.social, [
    "platform", "sectionKey", "latestContentUrl", "channelUrl",
    "contentPublishedAt", "countryScopes", "languageScopes",
  ]);
  if (Object.keys(social).length) out.social = social;
  const signals = compactObject(slot.signals, ["rotation_score", "quality_score"]);
  if (Object.keys(signals).length) out.signals = signals;
  const audit = compactObject(slot.audit, ["origin"]);
  if (Object.keys(audit).length) out.audit = audit;
  return out;
}

function compactFrontSnapshot(snapshot) {
  const sections = snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections || {};
  const compactSections = {};
  FRONT_SECTION_KEYS.forEach((key) => {
    compactSections[key] = (Array.isArray(sections[key]) ? sections[key] : [])
      .map(compactFrontSlot)
      .filter(Boolean);
  });
  return {
    meta: compactObject(snapshot && snapshot.meta, ["generatedAt", "updatedAt", "releaseId", "applicationScope"]),
    pages: { social: { sections: compactSections } },
  };
}

function projectionForRelease(release) {
  const cacheKey = text(release && release.release_id) + "|" + text(release && release.snapshot_hash);
  if (warmProjectionCache && warmProjectionCache.key === cacheKey) return warmProjectionCache;
  const documentHash = SocialStore.sha256(release.snapshot);
  const projected = {
    key: cacheKey,
    documentHash,
    hashVerified: !!release.snapshot_hash && release.snapshot_hash === documentHash,
    publicSlots: publicSlotCounts(release.snapshot),
    snapshot: compactFrontSnapshot(release.snapshot),
  };
  warmProjectionCache = projected;
  return projected;
}
function releaseCountry(row) {
  return text(
    row &&
      row.snapshot &&
      row.snapshot.meta &&
      row.snapshot.meta.applicationScope &&
      row.snapshot.meta.applicationScope.countryCode,
  ).toUpperCase();
}
async function latestForToken(token) {
  const rows = await SocialStore.selectReleases(
    "select=release_id,status,snapshot_hash,snapshot,created_at,notes&status=eq.stored&notes=like." +
      encodeURIComponent("scope=" + token + ";%") +
      "&order=created_at.desc&limit=1",
  );
  return Array.isArray(rows) && rows[0];
}
function publicSlotCounts(snapshot) {
  const sections =
    snapshot &&
    snapshot.pages &&
    snapshot.pages.social &&
    snapshot.pages.social.sections;
  const counts = {};
  let total = 0;
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    const list = Array.isArray(sections && sections[sectionKey])
      ? sections[sectionKey]
      : [];
    counts[sectionKey] = list.filter((slot) => {
      const audit = (slot && slot.audit) || {};
      return (
        SocialStore.text(slot && slot.type) === "external_social" &&
        SocialStore.text(audit.origin) === "social_candidates"
      );
    }).length;
    total += counts[sectionKey];
  });
  return { total, bySection: counts };
}

exports.handler = async function (event) {
  if (event && event.httpMethod === "OPTIONS")
    return SocialStore.response(204, {});
  try {
    if (!event || event.httpMethod !== "GET")
      return SocialStore.response(405, {
        ok: false,
        version: VERSION,
        error: "method_not_allowed",
      });
    const query = event.queryStringParameters || {};
    const frontView = text(query.view).toLowerCase() === "front";
    const route = CountryRouting.resolve(
      event,
      query,
    );
    const countryCode = text(route.countryCode).toUpperCase();
    let exact = countryCode ? await latestForToken(countryCode) : null;
    let global = exact ? null : await latestForToken("GLOBAL");
    let release = exact || global;
    if (!release) {
      const rows = await SocialStore.selectReleases(
        "select=release_id,status,snapshot_hash,snapshot,created_at,notes&status=eq.stored&order=created_at.desc&limit=25",
      );
      const list = Array.isArray(rows) ? rows : [];
      exact = countryCode
        ? list.find((row) => releaseCountry(row) === countryCode)
        : null;
      global = list.find((row) => !releaseCountry(row));
      // A stored release is a durable publication record. If routing metadata
      // changed after publication, do not blank the public Social main page:
      // use the newest valid stored release as a last-resort Social-only read.
      release = exact || global || list.find((row) => row && row.snapshot) || null;
    }
    if (!release || !release.snapshot) {
      return SocialStore.response(
        404,
        {
          ok: false,
          version: VERSION,
          error: "stored_social_release_not_found",
        },
        { "cache-control": "no-store, max-age=0" },
      );
    }
    const projection = projectionForRelease(release);
    const documentHash = projection.documentHash;
    const publicSlots = projection.publicSlots;
    return SocialStore.response(
      200,
      {
        ok: true,
        version: VERSION,
        releaseId: release.release_id,
        hash: release.snapshot_hash,
        documentHash,
        hashVerified: projection.hashVerified,
        createdAt: release.created_at,
        publicSlots,
        route: {
          countryCode: route.countryCode,
          worldRegion: route.worldRegion,
          matchedCountryApplication: !!exact,
          usedGlobalFallback: !exact && !!global,
          rawIpStored: false,
        },
        pipeline: {
          releaseLookup: "passed",
          releaseScope:
            exact && countryCode
              ? "country_exact"
              : global
                ? "global_fallback"
                : "latest_stored_fallback",
          storedHashVerification:
            release.snapshot_hash === documentHash ? "passed" : "failed",
          frontPayloadReady: publicSlots.total > 0 ? "passed" : "empty",
        },
        snapshot: frontView ? projection.snapshot : release.snapshot,
      },
      {
        "cache-control": frontView
          ? "private, max-age=2"
          : "no-store, max-age=0",
        "access-control-allow-origin": "*",
        vary: "x-country-code, x-nf-country, cf-ipcountry",
      },
    );
  } catch (error) {
    return SocialStore.response(
      error.statusCode || 500,
      {
        ok: false,
        version: VERSION,
        error: error.code || "social_snapshot_current_failed",
        message: error.message || String(error),
      },
      { "cache-control": "no-store" },
    );
  }
};
