"use strict";

/**
 * Administrator action endpoint for social candidates stored in Supabase.
 * Queue delete is reversible search exclusion. Permanent block prevents re-import.
 * Provider content is never deleted and this endpoint never publishes social.snapshot.json.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "social-candidate-action-v1.1.0-search-exclusion-staging";
const ACTIONS = new Set(["approve", "hold", "reject", "block", "reset", "delete", "restore", "permanent_block", "forget", "request_replacement"]);

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
  return Array.from(new Set(SocialStore.array(values).map(SocialStore.text).filter(Boolean))).slice(0, 1000);
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
  if (action === "reject") return { review_status: "rejected", verification_status: "rejected", rotation_eligible: false, candidate_only: true, blocked_reason: note || "rejected_by_admin", review_note: note, reviewed_by: by, reviewed_at: now, approved_at: null, updated_by: by, updated_at: now };
  if (action === "delete") return { review_status: "search_excluded", verification_status: "search_excluded", rotation_eligible: false, candidate_only: true, blocked_reason: note || "moved_from_candidate_queue", review_note: note, reviewed_by: by, reviewed_at: now, approved_at: null, updated_by: by, updated_at: now };
  if (action === "block" || action === "permanent_block") return { review_status: "permanent_blocked", verification_status: "permanent_blocked", risk_level: "blocked", rotation_eligible: false, candidate_only: true, blocked_reason: note || "permanent_blocked_by_admin", review_note: note, reviewed_by: by, reviewed_at: now, approved_at: null, updated_by: by, updated_at: now };
  if (action === "request_replacement") return { review_status: "replacement_requested", verification_status: "replacement_requested", rotation_eligible: false, candidate_only: true, review_note: note || "replacement_requested", reviewed_by: by, reviewed_at: now, updated_by: by, updated_at: now };
  return { review_status: "pending", verification_status: "web_verification_required", risk_level: "medium", rotation_eligible: false, candidate_only: true, seed_content: false, review_note: note, blocked_reason: null, reviewed_by: by, reviewed_at: now, approved_at: null, updated_by: by, updated_at: now };
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
    if (action === "delete" && body.confirmQueueDelete !== true && body.confirmQueueDelete !== "true") {
      return SocialStore.response(400, { ok: false, error: "queue_delete_confirmation_required", message: "검색 제외 목록 이동 확인값이 필요합니다." });
    }
    if (action === "forget") {
      if (body.confirmPermanentDelete !== true && body.confirmPermanentDelete !== "true") {
        return SocialStore.response(400, { ok: false, error: "permanent_delete_confirmation_required", message: "검색 제외 기록 완전 삭제 확인값이 필요합니다." });
      }
      const excludedRows = await SocialStore.selectCandidates("select=id,review_status&review_status=in.(search_excluded,permanent_blocked,blocked)&limit=10000");
      const requested = new Set(ids);
      const deletableIds = (Array.isArray(excludedRows) ? excludedRows : []).map((row) => SocialStore.text(row && row.id)).filter((id) => id && requested.has(id));
      if (!deletableIds.length) {
        return SocialStore.response(409, { ok: false, version: VERSION, error: "excluded_candidates_required", message: "기록 완전 삭제는 검색 제외 또는 영구 차단 목록에 있는 항목만 가능합니다." });
      }
      const deleted = await SocialStore.deleteCandidates(deletableIds);
      return SocialStore.response(200, {
        ok: true,
        version: VERSION,
        action,
        requested: ids.length,
        eligible: deletableIds.length,
        skipped: ids.length - deletableIds.length,
        deleted: Array.isArray(deleted) ? deleted.length : 0,
        items: Array.isArray(deleted) ? deleted.map(SocialStore.normalizeDbRow) : [],
        sourceContentDeleted: false,
        recollectAllowed: true
      });
    }
    const patch = patchFor(action, body, actor);
    const updated = await SocialStore.updateCandidates(ids, patch);
    return SocialStore.response(200, {
      ok: true,
      version: VERSION,
      action,
      requested: ids.length,
      updated: Array.isArray(updated) ? updated.length : 0,
      items: Array.isArray(updated) ? updated.map(SocialStore.normalizeDbRow) : [],
      sourceContentDeleted: false,
      recollectAllowed: action === "restore" || action === "reset",
      movedToSearchExclusion: action === "delete",
      permanentBlocked: action === "block" || action === "permanent_block"
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, { ok: false, version: VERSION, error: error.code || "social_candidate_action_failed", message: error.message || String(error) });
  }
};
