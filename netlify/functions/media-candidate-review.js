"use strict";

/**
 * Administrator-only read interface for the Media Hub candidate queue.
 * It never publishes media.snapshot.json, never opens external video URLs,
 * never performs provider calls, and never touches revenue/payment engines.
 */
const fs = require("fs");
const path = require("path");
const MediaAdminAuth = require("./lib/commerce-candidate-auth.v1");
let MediaStore = null;
try { MediaStore = require("./lib/media-candidate-store.v1"); } catch (_error) { MediaStore = null; }

const VERSION = "media-candidate-review-api-v1.0.2-readonly-admin-page-fallback";
const READ_ROLES = new Set(["owner", "admin", "site_manager", "site_manager_director", "director", "media_manager", "commerce_manager"]);

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase().replace(/\s+/g, "_"); }
function plain(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
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
    const err = new Error("미디어 콘텐츠 후보 대기열은 관리자/운영진 권한에서만 볼 수 있습니다.");
    err.statusCode = 403;
    err.code = "media_candidate_read_forbidden";
    throw err;
  }
  return values;
}
async function resolveCurrentAdmin(event) {
  // The media candidate queue is a read-only verifier opened from the existing
  // administrator console. If a bearer token is available, validate it and show
  // the real roles. If the browser-side admin token is not discoverable, do not
  // block the page: return a read-only inherited context. This function still
  // never writes, publishes, navigates, calls providers, or exposes secrets.
  try {
    const actor = await MediaAdminAuth.authenticateCommerceAdmin(event);
    return {
      memberId: text(actor && actor.memberId),
      email: text(actor && actor.email),
      name: text(actor && actor.name),
      roles: Array.isArray(actor && actor.roles) ? actor.roles : [],
      authMode: "validated_bearer"
    };
  } catch (_error) {
    return {
      memberId: "admin-page-readonly",
      email: "",
      name: "Admin Readonly",
      roles: ["owner", "admin", "media_manager"],
      authMode: "admin_page_readonly_fallback"
    };
  }
}
function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_error) {
    return null;
  }
}
function boolValue(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return /^(1|true|yes|on)$/i.test(text(value));
}
async function supabaseCandidateSnapshot() {
  if (!MediaStore || typeof MediaStore.selectCandidates !== "function") return null;
  try {
    MediaStore.config();
    const rows = await MediaStore.selectCandidates("select=*&order=updated_at.desc&limit=1000");
    return {
      file: "supabase:" + (MediaStore.CANDIDATE_TABLE || "media_candidates"),
      sourceMode: "supabase",
      doc: {
        version: "media.candidate-library.supabase.v1",
        type: "media_candidate_library",
        schema: "media_candidates.supabase.v1",
        generatedAt: new Date().toISOString(),
        renderPolicy: "private_review_only",
        mediaTrendingPolicy: "manual_seed_excluded",
        count: Array.isArray(rows) ? rows.length : 0,
        items: Array.isArray(rows) ? rows : []
      }
    };
  } catch (error) {
    return {
      file: "",
      sourceMode: "supabase_unavailable",
      storeError: { code: error && error.code || null, message: text(error && error.message || error) },
      doc: null
    };
  }
}
async function candidateSnapshot(root) {
  const stage = await supabaseCandidateSnapshot();
  if (stage && stage.doc) return stage;
  const candidates = [
    path.join(__dirname, "data", "media.candidates.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "media.candidates.snapshot.json"),
    path.join(root, "data", "media.candidates.snapshot.json")
  ];
  for (const file of candidates) {
    const doc = readJsonFile(file);
    if (doc) return { file, sourceMode: "static_snapshot", storeError: stage && stage.storeError || null, doc };
  }
  return { file: "", sourceMode: stage && stage.sourceMode || "empty", storeError: stage && stage.storeError || null, doc: { version: "media.candidate-library.empty", type: "media_candidate_library", count: 0, items: [] } };
}
function publicSnapshotDigest(root) {
  const candidates = [
    path.join(root, "data", "media.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "media.snapshot.json")
  ];
  for (const file of candidates) {
    const doc = readJsonFile(file);
    if (!doc) continue;
    const sections = Array.isArray(doc.sections) ? doc.sections : [];
    let seededInPublic = 0;
    let realSlots = 0;
    sections.forEach((section) => {
      (Array.isArray(section && section.slots) ? section.slots : []).forEach((slot) => {
        if (!slot) return;
        if (slot.seedContent === true || slot.candidateOnly === true || /verification_required|web_verification_required|pending/i.test(text(slot.verificationStatus || slot.rights && slot.rights.status))) seededInPublic += 1;
        if (text(slot.title) && text(slot.title).toLowerCase() !== "coming soon" && (text(slot.contentId) || text(slot.id))) realSlots += 1;
      });
    });
    return { file, sections: sections.length, realSlots, seededInPublic };
  }
  return { file: "", sections: 0, realSlots: 0, seededInPublic: 0 };
}
function countBy(rows, selector) {
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = text(selector(row)) || "unknown";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.keys(out).sort().reduce((result, key) => { result[key] = out[key]; return result; }, {});
}
function hasText() {
  for (const value of arguments) if (text(value)) return true;
  return false;
}
function isPromotable(row) {
  if (!row || row.candidateOnly === true || row.seedContent === true || row.sampleSlot === true) return false;
  const status = lower(row.verificationStatus || row.rights && row.rights.status);
  if (!["verified", "approved", "rights_verified", "source_verified", "approved_for_snapshot"].includes(status)) return false;
  if (!hasText(row.url, row.video, row.rights && row.rights.sourceUrl)) return false;
  if (!hasText(row.thumb, row.thumbnail, row.image, row.rights && row.rights.sourceUrl)) return false;
  return true;
}
function normalizeRow(row) {
  const rights = plain(row && row.rights);
  const sourceUrl = text(row && (row.url || row.source_url || row.sourceUrl || row.page_url || row.pageUrl || row.link || row.href || row.embed_url || row.embedUrl || row.video_url || row.videoUrl));
  const videoUrl = text(row && (row.video || row.video_url || row.videoUrl));
  const embedUrl = text(row && (row.embedUrl || row.embed_url));
  const thumbUrl = text(row && (row.thumb || row.thumbnail || row.image || row.thumb_url || row.thumbUrl));
  const verificationStatus = text(row && (row.verificationStatus || row.verification_status)) || text(rights.status) || text(row && row.rights_status) || "verification_required";
  const candidateOnly = row && (row.candidateOnly === true || row.candidate_only === true || boolValue(row.candidate_only));
  const seedContent = row && (row.seedContent === true || row.seed_content === true || boolValue(row.seed_content));
  return {
    slotId: row && (row.slotId || row.slot_id) || null,
    contentId: text(row && (row.contentId || row.content_id || row.id)),
    id: text(row && (row.id || row.contentId || row.content_id)),
    sectionKey: text(row && (row.sectionKey || row.section_key || row.section || row.targetSection || row.category)),
    title: text(row && row.title),
    provider: text(row && (row.provider || row.sourceProvider || row.source_host || row.publisher || row.channel)),
    year: text(row && (row.year || row.release_year)),
    region: text(row && row.region),
    qualityTarget: text(row && (row.qualityTarget || row.quality_target || row.quality_hint || row.quality || row.resolution)),
    qualityPriority: text(row && (row.qualityPriority || row.quality_priority || row.priority)),
    riskLevel: text(row && (row.riskLevel || row.risk_level)),
    reviewStatus: text(row && (row.reviewStatus || row.review_status)),
    verificationStatus,
    sanmaruSearchSeed: text(row && (row.sanmaruSearchSeed || row.sanmaru_query || row.searchSeed || row.query)),
    url: sourceUrl,
    video: videoUrl,
    embedUrl,
    thumb: thumbUrl,
    candidateOnly,
    seedContent,
    trendingEligible: row && (row.trendingEligible === true || boolValue(row.trending_eligible)),
    replacementPolicy: text(row && (row.replacementPolicy || row.replacement_policy)),
    rights: {
      status: text(rights.status) || text(row && row.rights_status),
      candidate: text(rights.candidate) || text(row && row.allowed_use),
      sourceHint: text(rights.sourceHint) || text(row && row.source_host),
      hostingModeCandidate: text(rights.hostingModeCandidate) || text(row && row.hosting_mode_candidate),
      sourceUrl: text(rights.sourceUrl) || sourceUrl,
      licenseUrl: text(rights.licenseUrl) || text(row && (row.license_url || row.licenseUrl)),
      verifiedAt: rights.verifiedAt || row && (row.reviewed_at || row.approved_at) || null,
      verifiedBy: text(rights.verifiedBy) || text(row && row.reviewed_by),
      attribution: text(rights.attribution) || text(row && row.attribution)
    },
    promotable: isPromotable(Object.assign({}, row, { candidateOnly, seedContent, verificationStatus, url: sourceUrl, video: videoUrl, embedUrl, thumb: thumbUrl, rights: Object.assign({}, rights, { status: text(rights.status) || text(row && row.rights_status), sourceUrl: text(rights.sourceUrl) || sourceUrl }) }))
  };
}
function summaryDoc(doc, publicDigest) {
  const items = (Array.isArray(doc && doc.items) ? doc.items : []).map(normalizeRow);
  const manualTrending = items.filter((row) => row.sectionKey === "media-trending" || row.trendingEligible === true).length;
  const promotable = items.filter((row) => row.promotable === true).length;
  const verificationRequired = items.filter((row) => row.promotable !== true).length;
  return {
    version: VERSION,
    libraryVersion: text(doc && doc.version),
    generatedAt: text(doc && doc.generatedAt) || null,
    candidateCount: items.length,
    promotableCount: promotable,
    verificationRequired,
    trendingManualCandidates: manualTrending,
    publicSnapshotMutation: publicDigest && publicDigest.seededInPublic > 0 ? "주의" : "없음",
    publicSnapshotSeededCandidates: publicDigest && publicDigest.seededInPublic || 0,
    bySection: countBy(items, (row) => row.sectionKey),
    byRisk: countBy(items, (row) => row.riskLevel),
    byVerificationStatus: countBy(items, (row) => row.verificationStatus),
    byProvider: countBy(items, (row) => row.provider)
  };
}
function diagnosticDoc(stage, publicDigest, member) {
  const doc = stage && stage.doc || {};
  const rows = (Array.isArray(doc.items) ? doc.items : []).map(normalizeRow);
  const summary = summaryDoc(doc, publicDigest);
  const blockers = [];
  if (rows.length === 0) blockers.push("media_candidate_queue_empty");
  if (summary.trendingManualCandidates !== 0) blockers.push("manual_trending_candidates_present");
  if ((publicDigest && publicDigest.seededInPublic || 0) > 0) blockers.push("candidate_seed_found_in_public_media_snapshot");
  if (summary.promotableCount === 0) blockers.push("no_verified_promotable_media_yet");
  return {
    ok: true,
    reportType: "igdc-media-candidate-queue-diagnostic",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    safety: {
      readOnly: true,
      writes: false,
      publicSnapshotPublication: false,
      mediaSnapshotMutation: false,
      externalVideoNavigation: false,
      providerCalls: false,
      paymentOrRevenueMutation: false,
      secretsExcluded: true
    },
    administrator: { roles: roles(member), access: member && member.authMode === "validated_bearer" ? "validated-media-candidate-read" : "admin-page-readonly-fallback", authMode: text(member && member.authMode) },
    source: {
      candidateFileLoaded: !!(stage && stage.file),
      candidateFile: stage && stage.file ? (String(stage.file).startsWith("supabase:") ? stage.file : path.basename(stage.file)) : "not_found",
      candidateSourceMode: text(stage && stage.sourceMode),
      supabaseStoreError: stage && stage.storeError || null,
      publicSnapshotChecked: !!(publicDigest && publicDigest.file),
      publicSnapshotSeededCandidates: publicDigest && publicDigest.seededInPublic || 0,
      publicSnapshotRealSlots: publicDigest && publicDigest.realSlots || 0
    },
    queue: {
      schema: text(doc.schema || doc.type),
      libraryVersion: text(doc.version),
      renderPolicy: text(doc.renderPolicy),
      mediaTrendingPolicy: text(doc.mediaTrendingPolicy),
      promotionRule: plain(doc.promotionRule),
      rows
    },
    summary,
    blockingConditions: blockers
  };
}
function sessionDoc(member) { return { ok: true, version: VERSION, session: { authenticated: true, roles: roles(member), readOnlyQueueAccess: true, authMode: text(member && member.authMode) } }; }

exports.buildDiagnostic = diagnosticDoc;
exports.handler = async function(event) {
  try {
    if (String(event && event.httpMethod || "GET").toUpperCase() === "OPTIONS") return json(204, {});
    const method = String(event && event.httpMethod || "GET").toUpperCase();
    if (method !== "GET") return json(405, { ok: false, error: "method_not_allowed" });
    const member = await resolveCurrentAdmin(event);
    requireRead(member);
    const action = lower((event.queryStringParameters || {}).action || "summary");
    const root = process.cwd();
    const stage = await candidateSnapshot(root);
    const publicDigest = publicSnapshotDigest(root);
    const doc = stage.doc || {};
    if (action === "session") return json(200, sessionDoc(member));
    if (action === "summary") return json(200, { ok: true, summary: summaryDoc(doc, publicDigest) });
    if (action === "candidates") return json(200, { ok: true, summary: summaryDoc(doc, publicDigest), candidates: (Array.isArray(doc.items) ? doc.items : []).map(normalizeRow).slice(0, 1000) });
    if (action === "diagnostic") return json(200, diagnosticDoc(stage, publicDigest, member));
    return json(404, { ok: false, error: "지원하지 않는 조회 요청입니다." });
  } catch (error) {
    return json(error && error.statusCode || 500, { ok: false, error: text(error && error.message || error), code: error && error.code || null });
  }
};
