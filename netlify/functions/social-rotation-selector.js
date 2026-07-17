"use strict";

/**
 * Preview endpoint for approved social candidate rotation. It does not publish files.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "social-rotation-selector-v1.0.0-preview-only";
function text(value) { return value == null ? "" : String(value).trim(); }
async function actorFor(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  const member = { memberId: text(actor && (actor.memberId || actor.sub)), email: text(actor && actor.email), roles: Array.isArray(actor && actor.roles) ? actor.roles : [] };
  SocialStore.requireRole(member, "read");
  return member;
}
function approvedQuery(limit) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 3500));
  return "select=*&review_status=eq.approved&candidate_only=eq.false&seed_content=eq.false&order=section_key.asc,rotation_score.desc,approved_at.desc&limit=" + safeLimit;
}
exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    if (event.httpMethod !== "GET") return SocialStore.response(405, { ok: false, error: "method_not_allowed" });
    await actorFor(event);
    const params = event.queryStringParameters || {};
    const rows = await SocialStore.selectCandidates(approvedQuery(params.limit));
    const rotation = SocialStore.selectRotation(Array.isArray(rows) ? rows : [], { rotationSalt: params.rotationSalt || params.salt, limitPerSection: params.limitPerSection });
    const normalized = {};
    Object.keys(rotation.selected).forEach((section) => { normalized[section] = rotation.selected[section].map(SocialStore.normalizeDbRow); });
    return SocialStore.response(200, { ok: true, version: VERSION, generatedAt: SocialStore.nowIso(), rotation: Object.assign({}, rotation, { selected: normalized }) });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, { ok: false, version: VERSION, error: error.code || "social_rotation_selector_failed", message: error.message || String(error) });
  }
};
