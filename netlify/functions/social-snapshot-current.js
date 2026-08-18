"use strict";

/**
 * Public read-only Social Hub snapshot endpoint.
 *
 * IMPORTANT PIPELINE CONTRACT
 * ---------------------------
 * The browser must read only the canonical Social snapshot produced by:
 *   SearchBank Snapshot -> existing Snapshot Engine -> social.snapshot.json
 *
 * A stored Social release is only an approval/build input.  It is NOT a front
 * snapshot and must never be returned directly to AutoMap.  Returning a stored
 * release bypasses SearchBank/Snapshot Engine and can also replace reserved
 * structural sections such as rightPanel with placeholders.
 */
const CountryRouting = require("./lib/social-country-routing.v1");

const VERSION = "social-snapshot-current-v1.3.0-canonical-readback";

function text(value) {
  return value == null ? "" : String(value).trim();
}

function response(statusCode, body, headers) {
  return {
    statusCode,
    headers: Object.assign(
      {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "access-control-allow-origin": "*",
      },
      headers || {},
    ),
    body: JSON.stringify(body),
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function loadCanonicalSnapshot() {
  // Static require makes Netlify bundle the build-generated canonical mirror.
  // The build script/Snapshot Engine updates this mirror before deployment.
  try {
    return clone(require("./data/social.snapshot.json"));
  } catch (_e1) {
    try {
      return clone(require("./social.snapshot.json"));
    } catch (_e2) {
      return null;
    }
  }
}

function sectionItems(snapshot, key) {
  const sections =
    snapshot &&
    snapshot.pages &&
    snapshot.pages.social &&
    snapshot.pages.social.sections;
  const raw = sections && sections[key];
  return Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.items)
      ? raw.items
      : [];
}

function isRealSocial(slot) {
  if (!slot) return false;
  const type = text(slot.type).toLowerCase();
  const audit = slot.audit || {};
  if (type === "external_social" && text(audit.origin) === "social_candidates")
    return true;
  if (slot.placeholder === true || slot.sample === true || slot.isSample === true)
    return false;
  return !!text(slot.contentId || slot.candidateId) && /^social-/.test(text(slot.section || slot.psom_key));
}

function publicSlotCounts(snapshot) {
  const keys = [
    "social-youtube",
    "social-instagram",
    "social-tiktok",
    "social-facebook",
    "social-wechat",
    "social-weibo",
    "social-pinterest",
    "social-reddit",
    "social-twitter",
  ];
  const bySection = {};
  let total = 0;
  keys.forEach((key) => {
    const count = sectionItems(snapshot, key).filter(isRealSocial).length;
    bySection[key] = count;
    total += count;
  });
  return { total, bySection };
}

function rightPanelSummary(snapshot) {
  const rows = sectionItems(snapshot, "rightPanel");
  const real = rows.filter((slot) => {
    if (!slot) return false;
    if (slot.placeholder === true || slot.sample === true || slot.isSample === true || text(slot.type).toLowerCase() === "placeholder")
      return false;
    return !!text(slot.title || slot.name || slot.productId || slot.id);
  });
  return { total: rows.length, real: real.length };
}

exports.handler = async function (event) {
  if (event && event.httpMethod === "OPTIONS") return response(204, {});
  if (!event || event.httpMethod !== "GET")
    return response(405, { ok: false, version: VERSION, error: "method_not_allowed" });

  try {
    const route = CountryRouting.resolve(event, event.queryStringParameters || {});
    const snapshot = loadCanonicalSnapshot();
    if (!snapshot) {
      return response(404, {
        ok: false,
        version: VERSION,
        error: "canonical_social_snapshot_not_found",
      });
    }

    const publicSlots = publicSlotCounts(snapshot);
    const rightPanel = rightPanelSummary(snapshot);

    return response(
      200,
      {
        ok: true,
        version: VERSION,
        source: "canonical_social_snapshot",
        publicSlots,
        rightPanel,
        route: {
          countryCode: route.countryCode || null,
          worldRegion: route.worldRegion || null,
          rawIpStored: false,
        },
        pipeline: {
          frontReadSource: "data/social.snapshot.json",
          requiredUpstream: [
            "social_stored_release",
            "search_bank_engine_contract",
            "data/search-bank.snapshot.json",
            "existing_snapshot_engine",
            "data/social.snapshot.json",
          ],
          storedReleaseDirectRead: "disabled",
          reservedRightPanelBypass: "disabled",
          canonicalFrontPayload: publicSlots.total > 0 ? "real_social_present" : "sample_only",
        },
        snapshot,
      },
      { vary: "x-country-code, x-nf-country, cf-ipcountry" },
    );
  } catch (error) {
    return response(error.statusCode || 500, {
      ok: false,
      version: VERSION,
      error: error.code || "social_snapshot_current_failed",
      message: error.message || String(error),
    });
  }
};
