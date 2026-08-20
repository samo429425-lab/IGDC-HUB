"use strict";

/**
 * Administrator action endpoint for social candidates stored in Supabase.
 * Queue delete is reversible search exclusion. Permanent block prevents re-import.
 * Provider content is never deleted and this endpoint never publishes social.snapshot.json.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const CountryRouting = require("./lib/social-country-routing.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "social-candidate-action-v1.4.1-batched-admin-actions";
const ACTIONS = new Set([
  "approve",
  "hold",
  "reject",
  "block",
  "reset",
  "delete",
  "restore",
  "permanent_block",
  "forget",
  "request_replacement",
  "move_to_replacement",
  "promote_candidate",
  "delete_waiting",
]);

function text(value) {
  return value == null ? "" : String(value).trim();
}
async function actorFor(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  const member = {
    memberId: text(actor && (actor.memberId || actor.sub)),
    email: text(actor && actor.email),
    name: text(actor && actor.name),
    roles: Array.isArray(actor && actor.roles) ? actor.roles : [],
  };
  SocialStore.requireRole(member, "write");
  return member;
}
function idsFrom(body) {
  const values =
    body.ids || body.candidateIds || body.id || body.candidateId || [];
  return Array.from(
    new Set(SocialStore.array(values).map(SocialStore.text).filter(Boolean)),
  ).slice(0, 1000);
}
function rawObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function dbValue(row, snake, camel) {
  return row && (row[snake] != null ? row[snake] : row[camel]);
}
function originalState(row) {
  return {
    reviewStatus:
      SocialStore.text(dbValue(row, "review_status", "reviewStatus")) ||
      "pending",
    verificationStatus:
      SocialStore.text(
        dbValue(row, "verification_status", "verificationStatus"),
      ) || "web_verification_required",
    riskLevel:
      SocialStore.text(dbValue(row, "risk_level", "riskLevel")) || "medium",
    candidateOnly: dbValue(row, "candidate_only", "candidateOnly") !== false,
    seedContent: dbValue(row, "seed_content", "seedContent") === true,
    rotationEligible:
      dbValue(row, "rotation_eligible", "rotationEligible") === true,
    blockedReason: SocialStore.text(
      dbValue(row, "blocked_reason", "blockedReason"),
    ),
    reviewNote: SocialStore.text(dbValue(row, "review_note", "reviewNote")),
    approvedAt: dbValue(row, "approved_at", "approvedAt") || null,
    sectionKey: SocialStore.text(dbValue(row, "section_key", "sectionKey")),
  };
}
async function requestedRows(ids) {
  const requested = new Set(ids);
  const rows = await SocialStore.selectCandidates("select=*&limit=10000");
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    requested.has(SocialStore.text(row && row.id)),
  );
}
async function updateIndividually(rows, makePatch) {
  const updated = [];
  const list = Array.isArray(rows) ? rows : [];
  const concurrency = 8;
  for (let index = 0; index < list.length; index += concurrency) {
    const batch = list.slice(index, index + concurrency);
    const results = await Promise.all(
      batch.map((row) => SocialStore.updateCandidates([row.id], makePatch(row))),
    );
    results.forEach((result) => {
      if (Array.isArray(result)) updated.push.apply(updated, result);
    });
  }
  return updated;
}
async function updateInBatches(ids, patch, batchSize = 100) {
  const list = Array.from(new Set((ids || []).map(SocialStore.text).filter(Boolean)));
  const updated = [];
  const size = Math.max(1, Math.min(100, Number(batchSize) || 100));
  for (let index = 0; index < list.length; index += size) {
    const result = await SocialStore.updateCandidates(list.slice(index, index + size), patch);
    if (Array.isArray(result)) updated.push.apply(updated, result);
  }
  return updated;
}
function patchFor(action, body, actor) {
  const now = SocialStore.nowIso();
  const by = SocialStore.compact(actor.email || actor.memberId || "admin", 200);
  const note = SocialStore.compact(body.note || body.reason || "", 1200);
  if (action === "approve") {
    if (body.confirmSocialSafe !== true && body.confirmSocialSafe !== "true") {
      const error = new Error(
        "승인은 confirmSocialSafe=true 확인값이 필요합니다.",
      );
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
      updated_at: now,
    };
  }
  if (action === "hold")
    return {
      review_status: "hold",
      verification_status: "hold",
      rotation_eligible: false,
      review_note: note,
      reviewed_by: by,
      reviewed_at: now,
      updated_by: by,
      updated_at: now,
    };
  if (action === "reject")
    return {
      review_status: "rejected",
      verification_status: "rejected",
      rotation_eligible: false,
      candidate_only: true,
      blocked_reason: note || "rejected_by_admin",
      review_note: note,
      reviewed_by: by,
      reviewed_at: now,
      approved_at: null,
      updated_by: by,
      updated_at: now,
    };
  if (action === "delete")
    return {
      review_status: "search_excluded",
      verification_status: "search_excluded",
      rotation_eligible: false,
      candidate_only: true,
      blocked_reason: note || "moved_from_candidate_queue",
      review_note: note,
      reviewed_by: by,
      reviewed_at: now,
      approved_at: null,
      updated_by: by,
      updated_at: now,
    };
  if (action === "block" || action === "permanent_block")
    return {
      review_status: "permanent_blocked",
      verification_status: "permanent_blocked",
      risk_level: "blocked",
      rotation_eligible: false,
      candidate_only: true,
      blocked_reason: note || "permanent_blocked_by_admin",
      review_note: note,
      reviewed_by: by,
      reviewed_at: now,
      approved_at: null,
      updated_by: by,
      updated_at: now,
    };
  if (action === "request_replacement")
    return {
      review_status: "replacement_requested",
      verification_status: "replacement_requested",
      rotation_eligible: false,
      candidate_only: true,
      review_note: note || "replacement_requested",
      reviewed_by: by,
      reviewed_at: now,
      updated_by: by,
      updated_at: now,
    };
  return {
    review_status: "pending",
    verification_status: "web_verification_required",
    risk_level: "medium",
    rotation_eligible: false,
    candidate_only: true,
    seed_content: false,
    review_note: note,
    blocked_reason: null,
    reviewed_by: by,
    reviewed_at: now,
    approved_at: null,
    updated_by: by,
    updated_at: now,
  };
}
function isWaitingRow(row) {
  const review = SocialStore.text(
    dbValue(row, "review_status", "reviewStatus"),
  ).toLowerCase();
  const raw = rawObject(row && row.raw);
  return (
    raw.placementOverride === "replacement_waiting" ||
    /^(pending|hold|rejected|replacement_requested|replacement_waiting|reset)$/.test(
      review,
    )
  );
}

exports.handler = async function (event) {
  if (event && event.httpMethod === "OPTIONS")
    return SocialStore.response(204, {});
  try {
    if (event.httpMethod !== "POST")
      return SocialStore.response(405, {
        ok: false,
        error: "method_not_allowed",
      });
    const actor = await actorFor(event);
    const body = SocialStore.parseBody(event);
    const action = String(body.action || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (!ACTIONS.has(action))
      return SocialStore.response(400, {
        ok: false,
        error: "invalid_action",
        allowed: Array.from(ACTIONS),
      });
    const ids = idsFrom(body);
    if (!ids.length)
      return SocialStore.response(400, {
        ok: false,
        error: "candidate_ids_required",
      });
    if (
      action === "delete" &&
      body.confirmQueueDelete !== true &&
      body.confirmQueueDelete !== "true"
    ) {
      return SocialStore.response(400, {
        ok: false,
        error: "queue_delete_confirmation_required",
        message: "검색 제외 목록 이동 확인값이 필요합니다.",
      });
    }
    if (action === "forget") {
      if (
        body.confirmPermanentDelete !== true &&
        body.confirmPermanentDelete !== "true"
      ) {
        return SocialStore.response(400, {
          ok: false,
          error: "permanent_delete_confirmation_required",
          message: "검색 제외 기록 완전 삭제 확인값이 필요합니다.",
        });
      }
      const excludedRows = await SocialStore.selectCandidates(
        "select=id,review_status&review_status=in.(search_excluded,permanent_blocked,blocked)&limit=10000",
      );
      const requested = new Set(ids);
      const deletableIds = (Array.isArray(excludedRows) ? excludedRows : [])
        .map((row) => SocialStore.text(row && row.id))
        .filter((id) => id && requested.has(id));
      if (!deletableIds.length) {
        return SocialStore.response(409, {
          ok: false,
          version: VERSION,
          error: "excluded_candidates_required",
          message:
            "기록 완전 삭제는 검색 제외 또는 영구 차단 목록에 있는 항목만 가능합니다.",
        });
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
        items: Array.isArray(deleted)
          ? deleted.map(SocialStore.normalizeDbRow)
          : [],
        sourceContentDeleted: false,
        recollectAllowed: true,
      });
    }
    if (action === "delete_waiting") {
      if (
        body.confirmPermanentDelete !== true &&
        body.confirmPermanentDelete !== "true"
      ) {
        return SocialStore.response(400, {
          ok: false,
          version: VERSION,
          error: "waiting_delete_confirmation_required",
          message: "교체 후보 대기열 기록 완전 삭제 확인값이 필요합니다.",
        });
      }
      const candidates = await requestedRows(ids);
      const approvedRows = await SocialStore.selectCandidates(
        "select=*&review_status=eq.approved&candidate_only=eq.false&seed_content=eq.false&order=section_key.asc,rotation_score.desc,approved_at.desc&limit=5000",
      );
      const route = CountryRouting.resolve(event, body);
      const rotation = SocialStore.selectRotation(
        Array.isArray(approvedRows) ? approvedRows : [],
        { route },
      );
      const replacementIds = new Set();
      Object.keys(rotation.replacement || {}).forEach((section) => {
        (rotation.replacement[section] || []).forEach((row) =>
          replacementIds.add(SocialStore.text(row && row.id)),
        );
      });
      const deletableIds = candidates
        .filter(
          (row) =>
            isWaitingRow(row) ||
            replacementIds.has(SocialStore.text(row && row.id)),
        )
        .map((row) => SocialStore.text(row && row.id))
        .filter(Boolean);
      if (!deletableIds.length) {
        return SocialStore.response(409, {
          ok: false,
          version: VERSION,
          error: "replacement_waiting_candidates_required",
          message: "교체 후보 대기열에 있는 항목만 완전 삭제할 수 있습니다.",
        });
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
        items: Array.isArray(deleted)
          ? deleted.map(SocialStore.normalizeDbRow)
          : [],
        sourceContentDeleted: false,
        recollectAllowed: true,
        permanentBlocked: false,
      });
    }
    let updated;
    if (action === "move_to_replacement" || action === "promote_candidate") {
      const candidates = await requestedRows(ids);
      const by = SocialStore.compact(
        actor.email || actor.memberId || "admin",
        200,
      );
      const now = SocialStore.nowIso();
      updated = await updateIndividually(
        candidates.filter(
          (row) =>
            !/^(permanent_blocked|blocked|search_excluded)$/i.test(
              SocialStore.text(row.review_status),
            ),
        ),
        (row) => {
          const raw = Object.assign({}, rawObject(row.raw));
          if (action === "move_to_replacement") {
            raw.placementOverride = "replacement_waiting";
            raw.placementOverrideAt = now;
            raw.placementOverrideBy = by;
            const alreadyApproved =
              SocialStore.text(row.review_status) === "approved" &&
              row.candidate_only === false;
            return {
              raw,
              review_status: alreadyApproved
                ? "approved"
                : "replacement_waiting",
              verification_status: alreadyApproved
                ? "approved_for_snapshot"
                : "web_verification_required",
              candidate_only: !alreadyApproved,
              rotation_eligible: false,
              review_note: SocialStore.compact(
                body.note || "moved_to_replacement_waiting",
                1200,
              ),
              reviewed_by: by,
              reviewed_at: now,
              updated_by: by,
              updated_at: now,
            };
          }
          if (
            body.confirmSocialSafe !== true &&
            body.confirmSocialSafe !== "true"
          ) {
            const error = new Error(
              "최종 후보 복귀는 confirmSocialSafe=true 확인값이 필요합니다.",
            );
            error.statusCode = 400;
            error.code = "social_safety_confirmation_required";
            throw error;
          }
          delete raw.placementOverride;
          delete raw.placementOverrideAt;
          delete raw.placementOverrideBy;
          return {
            raw,
            review_status: "approved",
            verification_status: "approved_for_snapshot",
            candidate_only: false,
            seed_content: false,
            rotation_eligible: true,
            review_note: SocialStore.compact(
              body.note || "promoted_from_replacement_waiting",
              1200,
            ),
            reviewed_by: by,
            reviewed_at: now,
            approved_at: now,
            updated_by: by,
            updated_at: now,
          };
        },
      );
    } else if (action === "delete") {
      const candidates = await requestedRows(ids);
      const actorId = SocialStore.compact(
        actor.email || actor.memberId || "admin",
        200,
      );
      const note = SocialStore.compact(
        body.note || body.reason || "moved_from_candidate_queue",
        1200,
      );
      updated = await updateIndividually(
        candidates.filter(
          (row) =>
            !/^(permanent_blocked|blocked)$/i.test(
              SocialStore.text(row.review_status),
            ),
        ),
        (row) => {
          const raw = Object.assign({}, rawObject(row.raw), {
            exclusionRestore: Object.assign(originalState(row), {
              storedAt: SocialStore.nowIso(),
              storedBy: actorId,
            }),
          });
          return Object.assign(
            patchFor("delete", Object.assign({}, body, { note }), actor),
            { raw },
          );
        },
      );
    } else if (action === "restore") {
      const candidates = await requestedRows(ids);
      const restoreMode =
        SocialStore.text(
          body.restoreMode || body.restore_mode,
        ).toLowerCase() === "original"
          ? "original"
          : "hold";
      updated = await updateIndividually(
        candidates.filter(
          (row) => SocialStore.text(row.review_status) === "search_excluded",
        ),
        (row) => {
          const stored = rawObject(rawObject(row.raw).exclusionRestore);
          const base =
            restoreMode === "original" && stored.reviewStatus
              ? {
                  review_status: SocialStore.text(stored.reviewStatus),
                  verification_status:
                    SocialStore.text(stored.verificationStatus) ||
                    "web_verification_required",
                  risk_level: SocialStore.text(stored.riskLevel) || "medium",
                  candidate_only: stored.candidateOnly !== false,
                  seed_content: stored.seedContent === true,
                  rotation_eligible: stored.rotationEligible === true,
                  blocked_reason: stored.blockedReason || null,
                  review_note: stored.reviewNote || "restored_original_state",
                  approved_at: stored.approvedAt || null,
                }
              : patchFor(
                  "hold",
                  Object.assign({}, body, { note: "restored_to_hold" }),
                  actor,
                );
          const raw = Object.assign({}, rawObject(row.raw));
          delete raw.exclusionRestore;
          return Object.assign({}, base, {
            raw,
            reviewed_by: SocialStore.compact(
              actor.email || actor.memberId || "admin",
              200,
            ),
            reviewed_at: SocialStore.nowIso(),
            updated_by: SocialStore.compact(
              actor.email || actor.memberId || "admin",
              200,
            ),
            updated_at: SocialStore.nowIso(),
          });
        },
      );
    } else {
      const patch = patchFor(action, body, actor);
      // A registry-wide action can contain 800+ influencer IDs. Sending all IDs
      // in one PostgREST id=in.(...) URL can exceed proxy/URL limits and make
      // the approval appear to hang or do nothing. Keep the same atomic patch
      // semantics, but apply it in bounded batches.
      updated = await updateInBatches(ids, patch, 100);
    }
    return SocialStore.response(200, {
      ok: true,
      version: VERSION,
      action,
      requested: ids.length,
      updated: Array.isArray(updated) ? updated.length : 0,
      items: Array.isArray(updated)
        ? updated.map(SocialStore.normalizeDbRow)
        : [],
      sourceContentDeleted: false,
      recollectAllowed: action === "restore" || action === "reset",
      movedToSearchExclusion: action === "delete",
      movedToReplacementWaiting: action === "move_to_replacement",
      promotedFromReplacementWaiting: action === "promote_candidate",
      permanentBlocked: action === "block" || action === "permanent_block",
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, {
      ok: false,
      version: VERSION,
      error: error.code || "social_candidate_action_failed",
      message: error.message || String(error),
    });
  }
};
