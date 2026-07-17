"use strict";

/**
 * Thin trigger bridge for Social Network candidate pipeline.
 *
 * Purpose:
 * - Gives Sanmaru / SearchBank / admin queue one stable endpoint to call.
 * - Runs the existing social candidate gateway against search-bank.snapshot.json.
 * - Stores only validated real candidates in social_candidates when dryRun is false.
 * - Never mutates public social.snapshot.json and never removes sample slots.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const Gateway = require("./sanmaru-social-candidate-gateway");

const VERSION = "sanmaru-social-pipeline-trigger-v1.0.0-thin-bridge";

function flag(value) {
  return value === true || value === "true" || value === "1" || value === 1 || value === "yes";
}
function jsonBody(response) {
  try { return JSON.parse(response && response.body || "{}"); } catch (_error) { return {}; }
}
function requestBody(event) {
  try { return SocialStore.parseBody(event); } catch (_error) { return {}; }
}
function query(event) {
  return event && event.queryStringParameters || {};
}
function makeGatewayEvent(event, body) {
  return Object.assign({}, event || {}, {
    httpMethod: "POST",
    body: JSON.stringify(body || {}),
    queryStringParameters: {},
    path: "/.netlify/functions/sanmaru-social-candidate-gateway"
  });
}
function normalizeAction(value) {
  const v = SocialStore.lowerText(value).replace(/[\s-]+/g, "_");
  if (!v || v === "run" || v === "import" || v === "import_searchbank" || v === "searchbank_import" || v === "search_bank_import") return "import_searchbank";
  if (v === "dry_run" || v === "dryrun" || v === "diagnostic") return "dry_run";
  return v;
}

exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    const qs = query(event);
    if (!event || event.httpMethod === "GET") {
      return SocialStore.response(200, {
        ok: true,
        version: VERSION,
        mode: "ready",
        triggerTarget: "sanmaru-social-candidate-gateway",
        supportedActions: ["dry_run", "import_searchbank"],
        writeScope: "social_candidates only",
        publicSnapshotMutation: false,
        sampleSlotMutation: false,
        coreEngineMutation: false,
        internalCallerHeaders: ["X-IGDC-Internal-Token", "X-Sanmaru-Token"],
        adminCaller: "Bearer admin token accepted through the gateway auth contract",
        note: "POST {action:'dry_run'} to test SearchBank import without saving, or POST {action:'import_searchbank'} to save accepted real candidates. Public social.snapshot.json is never changed here.",
        query: qs
      });
    }
    if (event.httpMethod !== "POST") return SocialStore.response(405, { ok: false, version: VERSION, error: "method_not_allowed" });

    const body = requestBody(event);
    const action = normalizeAction(body.action || body.mode || qs.action || qs.mode);
    if (!["dry_run", "import_searchbank"].includes(action)) {
      return SocialStore.response(400, { ok: false, version: VERSION, error: "unsupported_trigger_action", supportedActions: ["dry_run", "import_searchbank"] });
    }
    const dryRun = action === "dry_run" || flag(body.dryRun) || flag(body.dry_run) || flag(qs.dryRun) || flag(qs.dry_run);
    const limit = Math.max(1, Math.min(5000, Number(body.limit || qs.limit || 5000) || 5000));
    const gatewayEvent = makeGatewayEvent(event, {
      mode: "search-bank",
      source: "search-bank",
      fromSearchBankSnapshot: true,
      dryRun,
      limit,
      trigger: "sanmaru-social-pipeline-trigger"
    });
    const gatewayResponse = await Gateway.handler(gatewayEvent);
    const payload = jsonBody(gatewayResponse);
    payload.trigger = {
      ok: gatewayResponse.statusCode >= 200 && gatewayResponse.statusCode < 300,
      version: VERSION,
      action,
      dryRun,
      limit,
      source: "search-bank.snapshot.json",
      target: "social_candidates",
      publicSnapshotMutation: false,
      sampleSlotMutation: false,
      coreEngineMutation: false,
      contract: "Sanmaru/SearchBank may call this thin bridge after snapshot refresh with an internal token."
    };
    return SocialStore.response(gatewayResponse.statusCode || 200, payload);
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, {
      ok: false,
      version: VERSION,
      error: error.code || "sanmaru_social_pipeline_trigger_failed",
      message: error.message || String(error),
      publicSnapshotMutation: false,
      sampleSlotMutation: false,
      coreEngineMutation: false
    });
  }
};
