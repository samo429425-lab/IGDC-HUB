"use strict";

/**
 * Public read-only endpoint for the latest stored Social Hub release.
 * It exposes only the already-sanitized public snapshot document.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const CountryRouting = require("./lib/social-country-routing.v1");

const VERSION = "social-snapshot-current-v1.1.0-country-ip-matched";

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
      release = exact || global || list[0];
    }
    if (!release || !release.snapshot) {
      return SocialStore.response(
        404,
        {
          ok: false,
          version: VERSION,
          error: "stored_social_release_not_found",
        },
        {
          "cache-control": "public, max-age=30, stale-while-revalidate=120",
        },
      );
    }
    return SocialStore.response(
      200,
      {
        ok: true,
        version: VERSION,
        releaseId: release.release_id,
        hash: release.snapshot_hash,
        createdAt: release.created_at,
        route: {
          countryCode: route.countryCode,
          worldRegion: route.worldRegion,
          matchedCountryApplication: !!exact,
          usedGlobalFallback: !exact && !!global,
          rawIpStored: false,
        },
        snapshot: release.snapshot,
      },
      {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
        "access-control-allow-origin": "*",
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
