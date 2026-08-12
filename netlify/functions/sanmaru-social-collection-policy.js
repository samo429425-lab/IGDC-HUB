"use strict";

/**
 * Read-only Social Network collection policy endpoint.
 * Shows what Sanmaru/Maru Search should collect broadly before the candidate gateway filters it.
 */
const Policy = require("./lib/social-candidate-policy.v1");
const VERSION = "sanmaru-social-collection-policy-v1.1.0-country-aware-readonly";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "access-control-allow-methods": "GET,OPTIONS"
    },
    body: statusCode === 204 ? "" : JSON.stringify(body)
  };
}
exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return json(204, {});
  if (event && event.httpMethod !== "GET") return json(405, { ok: false, error: "method_not_allowed" });
  const qs = event && event.queryStringParameters || {};
  const perSection = Number(qs.perSection || qs.pool || Policy.POOL_TARGET_PER_SECTION) || Policy.POOL_TARGET_PER_SECTION;
  const languages = qs.languages ? String(qs.languages).split(/[|,\s]+/).filter(Boolean) : Policy.LANGUAGES_30;
  return json(200, {
    ok: true,
    version: VERSION,
    policy: Policy.VERSION,
    collectionPlan: Policy.buildCollectionPlan({ perSection, languages, countryCode: qs.countryCode || qs.country }),
    safety: {
      readOnly: true,
      writes: false,
      externalProviderCalls: false,
      publicSnapshotMutation: false
    }
  });
};
