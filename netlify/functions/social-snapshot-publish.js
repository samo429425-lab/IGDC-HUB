"use strict";

/**
 * Builds a publishable social.snapshot.json from approved Supabase candidates.
 * It does not write runtime static files. Use download=1 to receive JSON, or
 * storeRelease=true to save a release copy in Supabase for deployment/build tooling.
 */
const fs = require("fs");
const path = require("path");
const SocialStore = require("./lib/social-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "social-snapshot-publish-v1.0.0-approved-rotation-only";
function text(value) { return value == null ? "" : String(value).trim(); }
async function actorFor(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  const member = { memberId: text(actor && (actor.memberId || actor.sub)), email: text(actor && actor.email), roles: Array.isArray(actor && actor.roles) ? actor.roles : [] };
  SocialStore.requireRole(member, "write");
  return member;
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { return null; } }
function baseSnapshot() {
  const root = process.cwd();
  const files = [
    path.join(root, "data", "social.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "social.snapshot.json"),
    path.join(__dirname, "data", "social.snapshot.json")
  ];
  for (const file of files) { const doc = readJson(file); if (doc) return { file, doc }; }
  const sections = {};
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => { sections[sectionKey] = []; });
  return { file: "generated-empty", doc: { version: "social.snapshot.empty", type: "social_snapshot", pages: { social: { sections } }, meta: {} } };
}
function approvedQuery(limit) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 3500));
  return "select=*&review_status=eq.approved&candidate_only=eq.false&seed_content=eq.false&order=section_key.asc,rotation_score.desc,approved_at.desc&limit=" + safeLimit;
}
exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    if (!["GET", "POST"].includes(event.httpMethod)) return SocialStore.response(405, { ok: false, error: "method_not_allowed" });
    const actor = await actorFor(event);
    const params = Object.assign({}, event.queryStringParameters || {}, event.httpMethod === "POST" ? SocialStore.parseBody(event) : {});
    const rows = await SocialStore.selectCandidates(approvedQuery(params.limit));
    const base = baseSnapshot();
    const snapshot = SocialStore.buildSnapshot(base.doc, Array.isArray(rows) ? rows : [], { rotationSalt: params.rotationSalt || params.salt, limitPerSection: params.limitPerSection });
    const hash = SocialStore.sha256(snapshot);
    const rotation = snapshot.meta && snapshot.meta.rotation || {};
    const eligible = Array.isArray(rows) ? rows.filter(SocialStore.isApprovedForSnapshot).length : 0;
    const release = {
      release_id: "social_snapshot_" + SocialStore.shortHash({ hash, at: SocialStore.nowIso() }),
      status: params.storeRelease === true || params.storeRelease === "true" ? "stored" : "preview",
      generated_by: SocialStore.compact(actor.email || actor.memberId || "admin", 200),
      rotation_salt: text(params.rotationSalt || params.salt) || new Date().toISOString().slice(0, 10),
      section_counts: rotation.counts || {},
      snapshot_hash: hash,
      snapshot,
      notes: SocialStore.compact(params.notes || "approved_social_rotation_snapshot", 1000),
      created_at: SocialStore.nowIso()
    };
    let stored = null;
    if (params.storeRelease === true || params.storeRelease === "true") stored = await SocialStore.insertRelease(release);
    if (params.download === "1" || params.download === true || params.format === "snapshot") {
      return { statusCode: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store, max-age=0", "content-disposition": "attachment; filename=social.snapshot.generated.json" }, body: JSON.stringify(snapshot, null, 2) + "\n" };
    }
    return SocialStore.response(200, {
      ok: true,
      version: VERSION,
      baseFile: base.file,
      hash,
      approvedRows: Array.isArray(rows) ? rows.length : 0,
      eligibleRows: eligible,
      releaseStored: !!stored,
      stored,
      rotation,
      release: params.includeSnapshot === "1" ? release : Object.assign({}, release, { snapshot: undefined }),
      snapshot: params.includeSnapshot === "1" ? snapshot : undefined,
      safety: {
        runtimeFileWrite: false,
        socialSnapshotMutation: false,
        sampleSlotsPreserved: true,
        externalProviderCalls: false,
        externalMembershipOverride: false
      }
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, { ok: false, version: VERSION, error: error.code || "social_snapshot_publish_failed", message: error.message || String(error) });
  }
};
