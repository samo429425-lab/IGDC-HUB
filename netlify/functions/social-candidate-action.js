"use strict";

/**
 * Administrator action endpoint for social candidates stored in Supabase.
 * Actions update candidate review state only. They do not publish social.snapshot.json.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "social-candidate-action-v1.0.0-review-state-only";
const ACTIONS = new Set(["approve", "hold", "reject", "block", "restore", "request_replacement"]);

function text(value) { return value == null ? "" : String(value).trim(); }
async function actorFor(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  const member = {
    memberId: text(actor && (actor.memberId || actor.sub)),
    email: text(actor && actor.email),
    name: text(actor && actor.name),
    roles: Array.isArray(actor && actor.roles) ? actor.roles : []
  };
  SocialStore.requireRole(member, "write");
  return member;
}
function idsFrom(body) {
  const values = body.ids || body.candidateIds || body.id || body.candidateId || [];
  return Array.from(new Set(SocialStore.array(values).map(SocialStore.text).filter(Boolean))).slice(0, 500);
}
function patchFor(action, body, actor) {
  const now = SocialStore.nowIso();
  const by = SocialStore.compact(actor.email || actor.memberId || "admin", 200);
  const note = SocialStore.compact(body.note || body.reason || "", 1200);
  if (action === "approve") {
    if (body.confirmSocialSafe !== true && body.confirmSocialSafe !== "true") {
      const error = new Error("승인은 confirmSocialSafe=true 확인값이 필요합니다.");
      error.statusCode = 400;
      error.code = "social_safety_confirmation_required";
      throw error;
    }
    return {
      review_status: "approved",
      verification_status: "approved_for_snapshot",
      candidate_only: false,
      seed_content: false,
      rotation_eligible: true,
      review_note: note,
      reviewed_by: by,
      reviewed_at: now,
      approved_at: now,
      updated_by: by,
      updated_at: now
    };
  }
  if (action === "hold") return { review_status: "hold", verification_status: "hold", rotation_eligible: false, review_note: note, reviewed_by: by, reviewed_at: now, updated_by: by, updated_at: now };
  if (action === "reject") return { review_status: "rejected", verification_status: "rejected", rotation_eligible: false, candidate_only: true, blocked_reason: note || "rejected_by_admin", review_note: note, reviewed_by: by, reviewed_at: now, updated_by: by, updated_at: now };
  if (action === "block") return { review_status: "blocked", verification_status: "blocked", risk_level: "blocked", rotation_eligible: false, candidate_only: true, blocked_reason: note || "blocked_by_admin", review_note: note, reviewed_by: by, reviewed_at: now, updated_by: by, updated_at: now };
  if (action === "request_replacement") return { review_status: "replacement_requested", verification_status: "replacement_requested", rotation_eligible: false, candidate_only: true, review_note: note || "replacement_requested", reviewed_by: by, reviewed_at: now, updated_by: by, updated_at: now };
  return { review_status: "pending", verification_status: "web_verification_required", rotation_eligible: false, candidate_only: true, seed_content: false, review_note: note, blocked_reason: null, reviewed_by: by, reviewed_at: now, approved_at: null, updated_by: by, updated_at: now };
}

exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    if (event.httpMethod !== "POST") return SocialStore.response(405, { ok: false, error: "method_not_allowed" });
    const actor = await actorFor(event);
    const body = SocialStore.parseBody(event);
    const action = String(body.action || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!ACTIONS.has(action)) return SocialStore.response(400, { ok: false, error: "invalid_action", allowed: Array.from(ACTIONS) });
    const ids = idsFrom(body);
    if (!ids.length) return SocialStore.response(400, { ok: false, error: "candidate_ids_required" });
    const patch = patchFor(action, body, actor);
    const updated = await SocialStore.updateCandidates(ids, patch);
    return SocialStore.response(200, {
      ok: true,
      version: VERSION,
      action,
      requested: ids.length,
      updated: Array.isArray(updated) ? updated.length : 0,
      items: Array.isArray(updated) ? updated.map(SocialStore.normalizeDbRow) : []
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, { ok: false, version: VERSION, error: error.code || "social_candidate_action_failed", message: error.message || String(error) });
  }
};
