"use strict";
/**
 * Read-only, bounded administrator view of the existing Social candidate ledger.
 * Splitting reads by SNS and page avoids a single oversized gateway response.
 * Does not create, delete, reclassify, approve, publish or replace any record.
 */
const SharedAdminAuth = require("./lib/global-slot-console-auth");
const SocialStore = require("./lib/social-candidate-store.v1");
const READ_ROLES = new Set(["owner", "admin", "super_admin", "site_manager", "site_manager_director", "director", "social_manager", "media_manager", "commerce_manager"]);
const VERSION = "social-candidate-page-read-v1.0.0";
const PAGE_LIMIT_MAX = 150;
const text = (v) => String(v == null ? "" : v).trim();
function reply(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-allow-methods": "GET,OPTIONS"
    },
    body: statusCode === 204 ? "" : JSON.stringify(payload)
  };
}
exports.handler = async (event) => {
  if (event && event.httpMethod === "OPTIONS") return reply(204, {});
  if (!event || event.httpMethod !== "GET") return reply(405, {ok:false, error:"method_not_allowed"});
  try {
    // Preserve the very same authenticated administrator authority as social-candidate-review.
    const actor = await SharedAdminAuth.resolveUser(event);
    const roles = (Array.isArray(actor && actor.roles) ? actor.roles : [])
      .map((role) => text(role).toLowerCase().replace(/\s+/g, "_"));
    if (!roles.some((role) => READ_ROLES.has(role))) {
      return reply(403, {ok:false, error:"social_candidate_read_forbidden"});
    }
    const args = event.queryStringParameters || {};
    const sectionKey = text(args.sectionKey || args.section);
    if (!SocialStore.Policy.SECTION_KEYS.includes(sectionKey)) {
      return reply(400, {ok:false, error:"invalid_social_section"});
    }
    const offset = Number(args.offset || 0);
    const limit = Number(args.limit || PAGE_LIMIT_MAX);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) {
      return reply(400, {ok:false, error:"invalid_pagination"});
    }
    SocialStore.config();
    const query = [
      "select=*",
      "section_key=eq." + encodeURIComponent(sectionKey),
      "order=updated_at.desc",
      "offset=" + offset,
      "limit=" + limit
    ].join("&");
    const page = await SocialStore.selectCandidates(query);
    if (!Array.isArray(page)) throw new Error("candidate_page_invalid_db_response");
    const rows = page.map(SocialStore.normalizeDbRow);
    return reply(200, {
      ok:true, version:VERSION, source:"supabase_social_candidates_read_only",
      sectionKey, offset, limit, count:rows.length,
      hasMore:rows.length === limit,
      rows
    });
  } catch (error) {
    return reply(error && error.statusCode >= 400 ? error.statusCode : 503, {
      ok:false, version:VERSION,
      error:text(error && error.code) || "social_candidate_page_read_failed",
      message:text(error && error.message) || "소셜 후보 원장 조회 실패",
      stage:"social_candidates_read_only"
    });
  }
};
