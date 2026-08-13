"use strict";

/**
 * Administrator-only read interface for the Social Network candidate queue.
 * Read-only: no public social.snapshot.json publication and no external SNS calls.
 */
const fs = require("fs");
const path = require("path");
const SharedAdminAuth = require("./lib/global-slot-console-auth");
let SocialStore = null;
try { SocialStore = require("./lib/social-candidate-store.v1"); } catch (_error) { SocialStore = null; }

const VERSION = "social-candidate-review-api-v1.0.3-lightweight-diagnostics";
const READ_ROLES = new Set(["owner", "admin", "super_admin", "site_manager", "site_manager_director", "director", "social_manager", "media_manager", "commerce_manager"]);

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase().replace(/\s+/g, "_"); }
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-allow-methods": "GET,OPTIONS"
    },
    body: statusCode === 204 ? "" : JSON.stringify(body)
  };
}
function roles(member) { return Array.from(new Set((member && member.roles || []).map(lower).filter(Boolean))); }
function requireRead(member) {
  const values = roles(member);
  if (!values.some((role) => READ_ROLES.has(role))) {
    const err = new Error("소셜 콘텐츠 후보 대기열은 관리자/운영진 권한에서만 볼 수 있습니다.");
    err.statusCode = 403;
    err.code = "social_candidate_read_forbidden";
    throw err;
  }
  return values;
}
async function resolveCurrentAdmin(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  return {
    memberId: text(actor && (actor.memberId || actor.sub)),
    email: text(actor && actor.email),
    name: text(actor && actor.name),
    roles: Array.isArray(actor && actor.roles) ? actor.roles : [],
    authMode: "validated_platform_bearer"
  };
}
function readJsonFile(file) { try { if (!fs.existsSync(file)) return null; return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; } }
async function supabaseCandidateSnapshot() {
  if (!SocialStore || typeof SocialStore.selectCandidates !== "function") return null;
  try {
    SocialStore.config();
    const rows = await SocialStore.selectCandidates("select=*&order=updated_at.desc&limit=3500");
    return {
      file: "supabase:" + (SocialStore.CANDIDATE_TABLE || "social_candidates"),
      sourceMode: "supabase",
      doc: {
        version: "social.candidate-library.supabase.v1",
        type: "social_candidate_library",
        schema: "social_candidates.supabase.v1",
        generatedAt: new Date().toISOString(),
        renderPolicy: "private_review_only",
        rotationPolicy: {
          targetPerSection: SocialStore.POOL_TARGET_PER_SECTION,
          minPerSection: SocialStore.POOL_MIN_PER_SECTION,
          maxPerSection: SocialStore.POOL_MAX_PER_SECTION,
          publicSlotsPerSection: SocialStore.ROTATION_LIMIT_PER_SECTION
        },
        count: Array.isArray(rows) ? rows.length : 0,
        items: Array.isArray(rows) ? rows : []
      }
    };
  } catch (error) {
    return { file: "", sourceMode: "supabase_unavailable", storeError: { code: error && error.code || null, message: text(error && error.message || error) }, doc: null };
  }
}
async function candidateSnapshot(root) {
  const stage = await supabaseCandidateSnapshot();
  if (stage && stage.doc) return stage;
  const candidates = [
    path.join(__dirname, "data", "social.candidates.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "social.candidates.snapshot.json"),
    path.join(root, "data", "social.candidates.snapshot.json")
  ];
  for (const file of candidates) {
    const doc = readJsonFile(file);
    if (doc) return { file, sourceMode: "static_snapshot", storeError: stage && stage.storeError || null, doc };
  }
  return { file: "", sourceMode: "missing", storeError: stage && stage.storeError || null, doc: { items: [] } };
}
function rowsFrom(doc) { return Array.isArray(doc && doc.items) ? doc.items : []; }
function normalizeRows(rows) { return rows.map((row) => SocialStore && SocialStore.normalizeDbRow ? SocialStore.normalizeDbRow(row) : row); }

function assetClass(row) {
  const raw = row && row.raw || {};
  return text(row && (row.assetClass || row.asset_class) || raw.assetClass || (raw.latestContentAsset === true ? "latest_content" : "influencer_registry"));
}
function reviewStatus(row) { return lower(row && (row.reviewStatus || row.review_status)); }
function isExcluded(row) { return /^(search_excluded|permanent_blocked|blocked)$/.test(reviewStatus(row)); }
function isBlocked(row) { return /^(permanent_blocked|blocked)$/.test(reviewStatus(row)); }
function rowCountryScopes(row) {
  const raw = row && row.raw || {};
  const values = row && (row.countryScopes || row.country_scopes) || raw.countryScopes || [];
  return Array.isArray(values) ? values.map((v) => text(v).toUpperCase()).filter(Boolean) : [];
}
function scopedRows(rows, countryCode) {
  const code = text(countryCode).toUpperCase();
  if (!code) return rows.slice();
  return rows.filter((row) => {
    const scopes = rowCountryScopes(row);
    return !scopes.length || scopes.includes(code);
  });
}
function diagnosticSectionSummary(rows) {
  const result = {};
  (SocialStore && SocialStore.Policy && SocialStore.Policy.SECTION_KEYS || []).forEach((sectionKey) => {
    const sectionRows = rows.filter((row) => text(row && (row.sectionKey || row.section_key)) === sectionKey);
    result[sectionKey] = {
      total: sectionRows.length,
      active: sectionRows.filter((row) => !isExcluded(row)).length,
      influencers: sectionRows.filter((row) => assetClass(row) === "influencer_registry" && !isExcluded(row)).length,
      latestContents: sectionRows.filter((row) => assetClass(row) === "latest_content" && !isExcluded(row)).length,
      approved: sectionRows.filter((row) => reviewStatus(row) === "approved" && !isExcluded(row)).length,
      searchExcluded: sectionRows.filter((row) => reviewStatus(row) === "search_excluded").length,
      blocked: sectionRows.filter(isBlocked).length
    };
  });
  return result;
}
function lightweightDiagnostic(base, rows, kind, countryCode) {
  const scoped = scopedRows(rows, countryCode);
  const wanted = kind === "registry" ? "influencer_registry" : kind === "latest" ? "latest_content" : "";
  const filtered = wanted ? scoped.filter((row) => assetClass(row) === wanted) : scoped;
  return {
    ok: true,
    reportType: kind === "registry" ? "igdc-social-influencer-registry-diagnostic" : kind === "latest" ? "igdc-social-latest-content-diagnostic" : "igdc-social-candidate-queue-diagnostic",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    scope: { countryCode: text(countryCode).toUpperCase() || null, mode: text(countryCode) ? "country" : "global" },
    source: base.source,
    queue: {
      schema: "social_candidates.supabase.v1",
      libraryVersion: base.libraryVersion,
      renderPolicy: "private_review_only",
      rowPayloadIncluded: false,
      rowCount: filtered.length,
      rotationPolicy: base.rotationPolicy
    },
    counts: {
      total: filtered.length,
      active: filtered.filter((row) => !isExcluded(row)).length,
      approved: filtered.filter((row) => reviewStatus(row) === "approved" && !isExcluded(row)).length,
      excluded: filtered.filter((row) => reviewStatus(row) === "search_excluded").length,
      blocked: filtered.filter(isBlocked).length
    },
    sections: diagnosticSectionSummary(wanted ? scoped.filter((row) => assetClass(row) === wanted) : scoped),
    summary: base.summary,
    blockingConditions: base.blockingConditions,
    safety: base.safety,
    note: "진단 화면에는 전체 후보 rows를 포함하지 않습니다. 전체 원문은 후보 목록 JSON에서 별도로 내려받습니다."
  };
}

function publicSnapshotDigest(root) {
  const files = [path.join(root, "data", "social.snapshot.json"), path.join(__dirname, "data", "social.snapshot.json")];
  for (const file of files) {
    const doc = readJsonFile(file);
    if (!doc) continue;
    const sections = doc.pages && doc.pages.social && doc.pages.social.sections || doc.sections || {};
    const keys = Object.keys(sections || {});
    const counts = {};
    keys.forEach((key) => {
      const raw = sections[key];
      const items = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.items) ? raw.items : []);
      counts[key] = items.length;
    });
    return { checked: true, file, sectionKeys: keys, sectionCounts: counts };
  }
  return { checked: false, file: "", sectionKeys: [], sectionCounts: {} };
}
exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return json(204, {});
  try {
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "method_not_allowed" });
    if (!SocialStore) return json(500, { ok: false, version: VERSION, error: "social_store_missing" });
    const actor = await resolveCurrentAdmin(event);
    const roleValues = requireRead(actor);
    const root = path.resolve(__dirname, "..", "..");
    const source = await candidateSnapshot(root);
    const rawRows = rowsFrom(source.doc);
    const rows = normalizeRows(rawRows);
    const summary = SocialStore.summaryDoc ? SocialStore.summaryDoc(rawRows) : { candidateCount: rows.length };
    const publicSnapshot = publicSnapshotDigest(root);
    const blockingConditions = [];
    if (!rows.length) blockingConditions.push("social_candidate_queue_empty");
    if (!summary.promotableCount) blockingConditions.push("no_verified_promotable_social_yet");
    const rotationPolicy = source.doc && source.doc.rotationPolicy || {
      targetPerSection: SocialStore.POOL_TARGET_PER_SECTION,
      minPerSection: SocialStore.POOL_MIN_PER_SECTION,
      maxPerSection: SocialStore.POOL_MAX_PER_SECTION,
      publicSlotsPerSection: SocialStore.ROTATION_LIMIT_PER_SECTION
    };
    const safety = {
      readOnly: true, writes: false, publicSnapshotPublication: false, socialSnapshotMutation: false,
      externalProviderCalls: false, externalMembershipOverride: false, paymentOrRevenueMutation: false, secretsExcluded: true
    };
    const sourceInfo = {
      candidateFileLoaded: !!source.doc, candidateFile: source.file, candidateSourceMode: source.sourceMode,
      supabaseStoreError: source.storeError || null, publicSnapshotChecked: publicSnapshot.checked,
      publicSnapshotSections: publicSnapshot.sectionKeys, publicSnapshotSectionCounts: publicSnapshot.sectionCounts
    };
    const base = {
      source: sourceInfo, libraryVersion: source.doc && source.doc.version || null, rotationPolicy, summary, blockingConditions, safety
    };
    const params = event.queryStringParameters || {};
    const action = lower(params.action || "candidates");
    const countryCode = text(params.countryCode || params.country).toUpperCase();
    if (action === "diagnostic") return json(200, Object.assign(lightweightDiagnostic(base, rows, "all", countryCode), { administrator: { roles: roleValues, access: "validated-social-candidate-read", authMode: actor.authMode } }));
    if (action === "registry_diagnostic" || action === "influencer_registry_diagnostic") return json(200, Object.assign(lightweightDiagnostic(base, rows, "registry", countryCode), { administrator: { roles: roleValues, access: "validated-social-candidate-read", authMode: actor.authMode } }));
    if (action === "latest_content_diagnostic" || action === "waiting_diagnostic") return json(200, Object.assign(lightweightDiagnostic(base, rows, "latest", countryCode), { administrator: { roles: roleValues, access: "validated-social-candidate-read", authMode: actor.authMode } }));
    return json(200, {
      ok: true, reportType: "igdc-social-candidate-queue", version: VERSION, generatedAt: new Date().toISOString(),
      safety, administrator: { roles: roleValues, access: "validated-social-candidate-read", authMode: actor.authMode },
      source: sourceInfo,
      queue: { schema: "social_candidates.supabase.v1", libraryVersion: source.doc && source.doc.version || null, renderPolicy: "private_review_only", rotationPolicy, rows },
      summary, blockingConditions
    });
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, version: VERSION, error: error.code || "social_candidate_review_failed", message: error.message || String(error) });
  }
};
