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

const VERSION = "sanmaru-social-candidate-gateway-v1.2.0-registry-review-preserve";

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
async function excludedIdSet() {
  try {
    const rows = await SocialStore.selectCandidates("select=id,review_status&review_status=in.(search_excluded,permanent_blocked,blocked)&limit=10000");
    return new Set((Array.isArray(rows) ? rows : []).map((row) => SocialStore.text(row && row.id)).filter(Boolean));
  } catch (_error) {
    return new Set();
  }
}
async function existingRowsById(ids) {
  const list = Array.from(new Set((ids || []).map(SocialStore.text).filter(Boolean)));
  if (!list.length) return new Map();
  try {
    const rows = await SocialStore.selectCandidates(
      "select=*&id=" + SocialStore.encodeIn(list)
    );
    return new Map(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => row && row.id)
        .map((row) => [SocialStore.text(row.id), row])
    );
  } catch (_error) {
    return new Map();
  }
}
function preserveReviewState(next, previous) {
  if (!previous) return next;
  const review = SocialStore.text(previous.review_status);
  if (!/^(approved|hold|recheck|rejected)$/i.test(review)) return next;
  const merged = Object.assign({}, next, {
    review_status: previous.review_status,
    verification_status: previous.verification_status,
    candidate_only: previous.candidate_only,
    rotation_eligible: previous.rotation_eligible,
    reviewed_by: previous.reviewed_by,
    reviewed_at: previous.reviewed_at,
    approved_at: previous.approved_at,
    review_note: previous.review_note,
    raw: Object.assign({}, previous.raw || {}, next.raw || {})
  });
  if (
    SocialStore.text(previous.source_url) !== SocialStore.text(next.source_url) &&
    SocialStore.assetClassOf(next) === "latest_content"
  ) {
    merged.raw.placementOverride = "replacement_waiting";
    merged.raw.placementOverrideAt = SocialStore.nowIso();
    merged.raw.placementOverrideBy = "automatic_latest_content_refresh";
    merged.raw.latestContentRefresh = {
      status: "replacement_waiting",
      previousUrl: SocialStore.text(previous.source_url),
      nextUrl: SocialStore.text(next.source_url),
      detectedAt: SocialStore.nowIso()
    };
  }
  return merged;
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
    const requestedSection = Policy.normalizeSectionKey(body.sectionKey || body.section || body.targetSection);
    if ((body.sectionKey || body.section || body.targetSection) && !Policy.ALLOWED_SECTIONS.has(requestedSection)) {
      return SocialStore.response(400, { ok: false, version: VERSION, error: "invalid_social_section", allowedSections: Policy.SECTION_KEYS });
    }
    if (wantsSearchBankImport(body)) {
      const source = searchBankSnapshot();
      if (!source.doc) return SocialStore.response(404, { ok: false, version: VERSION, error: "search_bank_snapshot_not_found" });
      const parsed = SocialStore.candidatesFromSearchBankSnapshot(source.doc, actor, { limit: 10000 });
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
    if (requestedSection) incoming = incoming.filter((row) => row.section_key === requestedSection);
    const cap = Math.max(1, Math.min(5000, Number(body.limit || incoming.length || 5000) || 5000));
    const capped = incoming.slice(0, cap);
    const dryRun = body.dryRun === true || body.dry_run === true;
    const excludedIds = await excludedIdSet();
    const existing = await existingRowsById(
      capped.map((row) => row && row.id)
    );
    const normalized = capped
      .filter((row) => !excludedIds.has(SocialStore.text(row && row.id)))
      .map((row) =>
        preserveReviewState(row, existing.get(SocialStore.text(row && row.id)))
      );
    const excludedSkipped = capped.length - normalized.length;
    const saved = dryRun ? [] : await SocialStore.upsertCandidates(normalized);
    return SocialStore.response(200, {
      ok: true,
      version: VERSION,
      actor: { mode: actor.mode, email: actor.email || null, memberId: actor.memberId || null },
      sourceMode,
      sourceFile,
      requestedSection: requestedSection || null,
      dryRun,
      received: capped.length + rejected.length + ignoredCount,
      accepted: normalized.length,
      acceptedBySection: bySection(normalized),
      saved: dryRun ? 0 : (Array.isArray(saved) ? saved.length : normalized.length),
      excludedSkipped,
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
