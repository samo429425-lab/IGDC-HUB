"use strict";

/**
 * Sanmaru/SearchBank -> Social candidate gateway.
 *
 * Reads broad SearchBank snapshot rows or explicit POST candidates, applies the
 * Social Candidate Policy, and stores accepted rows in social_candidates.
 * It does not publish social.snapshot.json and does not call external SNS providers.
 */
const fs = require("fs");
const path = require("path");
const SocialStore = require("./lib/social-candidate-store.v1");
const Policy = require("./lib/social-candidate-policy.v1");
const AdminAuth = require("./lib/commerce-candidate-auth.v1");

const VERSION = "sanmaru-social-candidate-gateway-v1.0.2-sample-preserve-candidate-only";

function internalAuthorized(event) {
  const expected = SocialStore.text(process.env.SOCIAL_CANDIDATE_SYNC_SECRET || process.env.SANMARU_INTERNAL_TOKEN || process.env.IGDC_INTERNAL_TOKEN);
  if (!expected) return false;
  const h = event && event.headers || {};
  const got = SocialStore.text(h["x-igdc-internal-token"] || h["X-IGDC-Internal-Token"] || h["x-sanmaru-token"] || h["X-Sanmaru-Token"]);
  return !!(got && got === expected);
}
async function actorFor(event) {
  if (internalAuthorized(event)) return { memberId: "sanmaru-internal", email: "sanmaru-internal", roles: ["social_manager"], mode: "internal" };
  const actor = await AdminAuth.authenticateCommerceAdmin(event);
  SocialStore.requireRole(actor, "write");
  return Object.assign({}, actor, { mode: "admin" });
}
function readJsonFile(file) { try { if (!fs.existsSync(file)) return null; return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { return null; } }
function searchBankSnapshot() {
  const root = path.resolve(__dirname, "..", "..");
  const candidates = [
    path.join(__dirname, "data", "search-bank.snapshot.json"),
    path.join(__dirname, "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "search-bank.snapshot.json"),
    path.join(root, "data", "search-bank.snapshot.json")
  ];
  for (const file of candidates) {
    const doc = readJsonFile(file);
    if (doc) return { file, doc };
  }
  return { file: "", doc: null };
}
function candidatesFromBody(body) {
  const raw = body.candidates || body.items || body.rows || body.results || body.socialCandidates || body.data || [];
  return Array.isArray(raw) ? raw : [raw];
}
function wantsSearchBankImport(body) {
  return body.fromSearchBankSnapshot === true || body.source === "search-bank" || body.mode === "searchbank" || body.mode === "search-bank" || body.mode === "search_bank";
}
function rejectSummary(rejected) {
  const out = {};
  (rejected || []).forEach((r) => (r.reasons || []).forEach((reason) => { out[reason] = (out[reason] || 0) + 1; }));
  return out;
}
function bySection(rows) {
  const out = {};
  (rows || []).forEach((r) => { const key = r.section_key || "unknown"; out[key] = (out[key] || 0) + 1; });
  return out;
}
exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    if (event.httpMethod === "GET") {
      let storeReady = true, storeError = null;
      try { SocialStore.config(); } catch (error) { storeReady = false; storeError = { code: error.code || null, message: SocialStore.text(error.message || error) }; }
      const source = searchBankSnapshot();
      return SocialStore.response(200, {
        ok: true,
        version: VERSION,
        store: SocialStore.VERSION,
        policy: Policy.VERSION,
        table: SocialStore.CANDIDATE_TABLE,
        mode: "ready",
        storeReady,
        storeError,
        searchBankSnapshotFound: !!source.doc,
        searchBankSnapshotFile: source.file || null,
        allowedSections: Policy.SECTION_KEYS,
        poolPolicy: {
          targetPerSection: SocialStore.POOL_TARGET_PER_SECTION,
          minPerSection: SocialStore.POOL_MIN_PER_SECTION,
          maxPerSection: SocialStore.POOL_MAX_PER_SECTION,
          rotationLimitPerSection: SocialStore.ROTATION_LIMIT_PER_SECTION
        },
        collectionPlan: Policy.buildCollectionPlan({ perSection: SocialStore.POOL_TARGET_PER_SECTION }),
        note: "POST {mode:'search-bank', dryRun:true} to test SearchBank import; POST explicit candidates to store. Public social.snapshot.json is never changed here."
      });
    }
    if (event.httpMethod !== "POST") return SocialStore.response(405, { ok: false, error: "method_not_allowed" });
    const actor = await actorFor(event);
    const body = SocialStore.parseBody(event);
    let incoming = [];
    let rejected = [];
    let ignoredCount = 0;
    let sourceMode = "direct_candidates";
    let sourceFile = null;
    if (wantsSearchBankImport(body)) {
      const source = searchBankSnapshot();
      if (!source.doc) return SocialStore.response(404, { ok: false, version: VERSION, error: "search_bank_snapshot_not_found" });
      const parsed = SocialStore.candidatesFromSearchBankSnapshot(source.doc, actor, { limit: body.limit });
      incoming = parsed.accepted;
      rejected = parsed.rejected;
      ignoredCount = parsed.ignoredCount;
      sourceMode = "search_bank_snapshot";
      sourceFile = source.file;
    } else {
      const raw = candidatesFromBody(body);
      raw.forEach((item, index) => {
        const row = SocialStore.normalizeCandidate(item, actor);
        const check = SocialStore.validateCandidate(row);
        if (check.ok) incoming.push(row);
        else rejected.push({ index, id: row.id, section: row.section_key, platform: row.platform, title: row.title, reasons: check.reasons });
      });
    }
    const cap = Math.max(1, Math.min(5000, Number(body.limit || incoming.length || 5000) || 5000));
    const normalized = incoming.slice(0, cap);
    const dryRun = body.dryRun === true || body.dry_run === true;
    const saved = dryRun ? [] : await SocialStore.upsertCandidates(normalized);
    return SocialStore.response(200, {
      ok: true,
      version: VERSION,
      actor: { mode: actor.mode, email: actor.email || null, memberId: actor.memberId || null },
      sourceMode,
      sourceFile,
      dryRun,
      received: normalized.length + rejected.length + ignoredCount,
      accepted: normalized.length,
      acceptedBySection: bySection(normalized),
      saved: dryRun ? 0 : (Array.isArray(saved) ? saved.length : normalized.length),
      rejectedCount: rejected.length,
      rejectedByReason: rejectSummary(rejected),
      ignoredCount,
      rejected: rejected.slice(0, 500),
      poolPolicy: {
        targetPerSection: SocialStore.POOL_TARGET_PER_SECTION,
        minPerSection: SocialStore.POOL_MIN_PER_SECTION,
        maxPerSection: SocialStore.POOL_MAX_PER_SECTION,
        rotationLimitPerSection: SocialStore.ROTATION_LIMIT_PER_SECTION
      },
      items: dryRun ? normalized : saved
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, { ok: false, version: VERSION, error: error.code || "sanmaru_social_candidate_gateway_failed", message: error.message || String(error) });
  }
};
