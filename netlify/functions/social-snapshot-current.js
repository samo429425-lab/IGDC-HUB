"use strict";

/**
 * Public read-only endpoint for the latest stored Social Hub release.
 * It exposes only the already-sanitized public snapshot document.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const CountryRouting = require("./lib/social-country-routing.v1");

const VERSION = "social-snapshot-current-v1.3.0-durable-stored-release-fallback";

function text(value) {
  return value == null ? "" : String(value).trim();
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
    const route = CountryRouting.resolve(
      event,
      event.queryStringParameters || {},
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
    const documentHash = SocialStore.sha256(release.snapshot);
    const publicSlots = publicSlotCounts(release.snapshot);
    return SocialStore.response(
      200,
      {
        ok: true,
        version: VERSION,
        releaseId: release.release_id,
        hash: release.snapshot_hash,
        documentHash,
        hashVerified:
          !!release.snapshot_hash && release.snapshot_hash === documentHash,
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
        snapshot: release.snapshot,
      },
      {
        "cache-control": "no-store, max-age=0",
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
