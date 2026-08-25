"use strict";

/**
 * Administrator-only read interface for the Social Network candidate queue.
 * Durable queue rule:
 * - A transient/ambiguous Supabase [] must never erase the administrator list.
 * - Prefer live Supabase rows when non-empty.
 * - When live rows are empty, recover the last known rows from the deployed
 *   candidate snapshot and then from the last published Social snapshot.
 * - This function is read-only. Explicit delete/exclude actions remain the
 *   only authority that may remove existing candidates.
 */
const fs = require("fs");
const path = require("path");
const SharedAdminAuth = require("./lib/global-slot-console-auth");
let SocialStore = null;
try { SocialStore = require("./lib/social-candidate-store.v1"); } catch (_error) { SocialStore = null; }
const CountryRouting = require("./lib/social-country-routing.v1");

const VERSION = "social-candidate-review-api-v1.2.0-durable-nonempty-fallback";
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
function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_error) { return null; }
}
function rowsFrom(doc) { return Array.isArray(doc && doc.items) ? doc.items : []; }
function sectionKeys() {
  return SocialStore && SocialStore.Policy && Array.isArray(SocialStore.Policy.SECTION_KEYS)
    ? SocialStore.Policy.SECTION_KEYS : ["youtube","instagram","tiktok","facebook","wechat","weibo","pinterest","reddit","twitter"];
}
function first(obj, keys) {
  for (const key of keys) if (obj && obj[key] != null && text(obj[key])) return obj[key];
  return "";
}
function recoveredRow(item, sectionKey, index, assetClass) {
  const raw = item && typeof item === "object" ? item : {};
  const id = text(first(raw, ["id","candidateId","candidate_id","contentId","content_id","uuid"])) ||
    "recovered:" + sectionKey + ":" + index + ":" + Buffer.from(text(first(raw,["url","sourceUrl","source_url","link","href","title"])) || String(index)).toString("base64url").slice(0,32);
  const sourceUrl = text(first(raw, ["source_url","sourceUrl","url","link","href","permalink"]));
  const thumbnail = text(first(raw, ["thumbnail_url","thumbnailUrl","thumbnail","image","imageUrl","image_url","thumb"]));
  const title = text(first(raw, ["title","name","label","channelName","author"]));
  const description = text(first(raw, ["description","desc","summary","caption"]));
  const platform = lower(first(raw, ["platform","provider","network"]) || sectionKey);
  return Object.assign({}, raw, {
    id,
    section_key: text(first(raw,["section_key","sectionKey"])) || sectionKey,
    sectionKey: text(first(raw,["sectionKey","section_key"])) || sectionKey,
    platform,
    source_url: sourceUrl,
    sourceUrl,
    thumbnail_url: thumbnail,
    thumbnailUrl: thumbnail,
    title,
    description,
    review_status: lower(first(raw,["review_status","reviewStatus"])) || "approved",
    reviewStatus: lower(first(raw,["reviewStatus","review_status"])) || "approved",
    verification_status: text(first(raw,["verification_status","verificationStatus"])) || "recovered_from_last_known_snapshot",
    candidate_only: false,
    seed_content: false,
    public_access: raw.public_access !== false,
    login_required: raw.login_required === true,
    asset_class: text(first(raw,["asset_class","assetClass"])) || assetClass || "latest_content",
    assetClass: text(first(raw,["assetClass","asset_class"])) || assetClass || "latest_content",
    raw: Object.assign({}, raw.raw && typeof raw.raw === "object" ? raw.raw : {}, {
      recoveredFromLastKnownSnapshot: true,
      channelAsset: true,
      latestContentAsset: (assetClass || "latest_content") === "latest_content"
    })
  });
}
function rowsFromPublishedSnapshot(doc) {
  const social = doc && doc.pages && doc.pages.social || doc && doc.social || {};
  const candidatePool = social && social.candidatePool || {};
  const sections = social && social.sections || doc && doc.sections || {};
  const out = [];
  const seen = new Set();
  sectionKeys().forEach((sectionKey) => {
    const pool = Array.isArray(candidatePool && candidatePool[sectionKey]) ? candidatePool[sectionKey] : [];
    const visibleRaw = sections && sections[sectionKey];
    const visible = Array.isArray(visibleRaw) ? visibleRaw : (Array.isArray(visibleRaw && visibleRaw.items) ? visibleRaw.items : []);
    const sources = pool.length ? [{items: pool, cls: "latest_content"}] : [{items: visible, cls: "latest_content"}];
    sources.forEach((source) => source.items.forEach((item, index) => {
      const row = recoveredRow(item, sectionKey, index, source.cls);
      const key = text(row.id) || text(row.source_url);
      if (!key || seen.has(key)) return;
      seen.add(key); out.push(row);
    }));
  });
  return out;
}
function staticCandidateSnapshot(root) {
  const candidates = [
    path.join(__dirname, "data", "social.candidates.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "social.candidates.snapshot.json"),
    path.join(root, "data", "social.candidates.snapshot.json")
  ];
  for (const file of candidates) {
    const doc = readJsonFile(file);
    const rows = rowsFrom(doc);
    if (rows.length) return { file, rows, doc };
  }
  return null;
}
function publishedCandidateSnapshot(root) {
  const files = [
    path.join(root, "data", "social.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "social.snapshot.json"),
    path.join(__dirname, "data", "social.snapshot.json")
  ];
  for (const file of files) {
    const doc = readJsonFile(file);
    if (!doc) continue;
    const rows = rowsFromPublishedSnapshot(doc);
    if (rows.length) return { file, rows, doc };
  }
  return null;
}
async function candidateSnapshot(root) {
  let stage = null;
  if (SocialStore && typeof SocialStore.selectCandidates === "function") {
    try {
      SocialStore.config();
      const rows = await SocialStore.selectCandidates("select=*&order=updated_at.desc&limit=10000");
      if (Array.isArray(rows) && rows.length) {
        return { file: "supabase:" + (SocialStore.CANDIDATE_TABLE || "social_candidates"), sourceMode: "supabase", storeError: null, rows };
      }
      stage = { sourceMode: "supabase_empty_ambiguous", storeError: null };
    } catch (error) {
      stage = { sourceMode: "supabase_unavailable", storeError: { code: error && error.code || null, message: text(error && error.message || error) } };
    }
  }

  const staticStage = staticCandidateSnapshot(root);
  if (staticStage) return { file: staticStage.file, sourceMode: "static_candidate_fallback", storeError: stage && stage.storeError || null, rows: staticStage.rows };

  const published = publishedCandidateSnapshot(root);
  if (published) return { file: published.file, sourceMode: "published_snapshot_recovery", storeError: stage && stage.storeError || null, rows: published.rows };

  return { file: "", sourceMode: stage && stage.sourceMode || "missing", storeError: stage && stage.storeError || null, rows: [] };
}
function normalizeRows(rows) { return rows.map((row) => SocialStore && SocialStore.normalizeDbRow ? SocialStore.normalizeDbRow(row) : row); }
function assetClass(row) {
  const raw = row && row.raw || {};
  return text(row && (row.assetClass || row.asset_class) || raw.assetClass || (raw.latestContentAsset === true ? "latest_content" : "influencer_registry"));
}
function reviewStatus(row) { return lower(row && (row.reviewStatus || row.review_status)); }
function isExcluded(row) { return /^(search_excluded|permanent_blocked|blocked)$/.test(reviewStatus(row)); }
function isBlocked(row) { return /^(permanent_blocked|blocked)$/.test(reviewStatus(row)); }
function scopedRows(rows, route) { return (rows || []).slice().sort((a,b) => CountryRouting.matchScore(b,route) - CountryRouting.matchScore(a,route)); }
function scopeBreakdown(rows, route) {
  const out = { country_exact:0, region_match:0, global_unscoped:0, global_scoped:0, cross_region:0 };
  (rows || []).forEach((row) => { const key = CountryRouting.matchTier(row, route); out[key] = (out[key] || 0) + 1; });
  return out;
}
function diagnosticSectionSummary(rows) {
  const result = {};
  sectionKeys().forEach((sectionKey) => {
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
function lightweightDiagnostic(base, rows, kind, route) {
  const scoped = scopedRows(rows, route);
  const wanted = kind === "registry" ? "influencer_registry" : kind === "latest" ? "latest_content" : "";
  const filtered = wanted ? scoped.filter((row) => assetClass(row) === wanted) : scoped;
  return {
    ok:true,
    reportType: kind === "registry" ? "igdc-social-influencer-registry-diagnostic" : kind === "latest" ? "igdc-social-latest-content-diagnostic" : "igdc-social-candidate-queue-diagnostic",
    version:VERSION, generatedAt:new Date().toISOString(),
    scope:{ mode:text(route && route.scopeMode)||null, countryCode:text(route && route.countryCode).toUpperCase()||null, worldRegion:text(route && (route.worldRegion||route.regionId))||null, source:text(route && route.source)||null },
    source:base.source,
    queue:{ schema:"social_candidates.supabase.v1", libraryVersion:base.libraryVersion, renderPolicy:"private_review_only", rowPayloadIncluded:false, rowCount:filtered.length, rotationPolicy:base.rotationPolicy },
    counts:{ total:filtered.length, active:filtered.filter((row)=>!isExcluded(row)).length, approved:filtered.filter((row)=>reviewStatus(row)==="approved"&&!isExcluded(row)).length, excluded:filtered.filter((row)=>reviewStatus(row)==="search_excluded").length, blocked:filtered.filter(isBlocked).length },
    consumptionScopeBreakdown:scopeBreakdown(filtered,route), sections:diagnosticSectionSummary(wanted ? scoped.filter((row)=>assetClass(row)===wanted) : scoped),
    summary:base.summary, blockingConditions:base.blockingConditions, safety:base.safety,
    note:"0건 응답은 삭제 확정으로 취급하지 않습니다. 마지막 정상 후보/게시 스냅샷을 읽기 전용으로 복원합니다."
  };
}
function publicSnapshotDigest(root) {
  const files = [path.join(root,"data","social.snapshot.json"), path.join(root,"netlify","functions","data","social.snapshot.json"), path.join(__dirname,"data","social.snapshot.json")];
  for (const file of files) {
    const doc = readJsonFile(file); if (!doc) continue;
    const sections = doc.pages && doc.pages.social && doc.pages.social.sections || doc.sections || {};
    const keys = Object.keys(sections || {}), counts = {};
    keys.forEach((key) => { const raw = sections[key]; const items = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.items) ? raw.items : []); counts[key] = items.length; });
    return { checked:true, file, sectionKeys:keys, sectionCounts:counts };
  }
  return { checked:false, file:"", sectionKeys:[], sectionCounts:{} };
}
exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return json(204, {});
  try {
    if (!event || event.httpMethod !== "GET") return json(405, { ok:false, error:"method_not_allowed" });
    if (!SocialStore) return json(500, { ok:false, version:VERSION, error:"social_store_missing" });
    const actor = await resolveCurrentAdmin(event);
    const roleValues = requireRead(actor);
    const root = path.resolve(__dirname,"..","..");
    const source = await candidateSnapshot(root);
    const rawRows = Array.isArray(source.rows) ? source.rows : [];
    const rows = normalizeRows(rawRows);
    const summary = SocialStore.summaryDoc ? SocialStore.summaryDoc(rawRows) : { candidateCount:rows.length, promotableCount:rows.filter((r)=>!isExcluded(r)).length };
    const publicSnapshot = publicSnapshotDigest(root);
    const blockingConditions = [];
    if (!rows.length) blockingConditions.push("social_candidate_queue_empty_after_all_durable_fallbacks");
    if (!summary.promotableCount && rows.length) blockingConditions.push("no_verified_promotable_social_yet");
    const rotationPolicy = { targetPerSection:SocialStore.POOL_TARGET_PER_SECTION, minPerSection:SocialStore.POOL_MIN_PER_SECTION, maxPerSection:SocialStore.POOL_MAX_PER_SECTION, publicSlotsPerSection:SocialStore.ROTATION_LIMIT_PER_SECTION };
    const safety = { readOnly:true, writes:false, publicSnapshotPublication:false, socialSnapshotMutation:false, externalProviderCalls:false, externalMembershipOverride:false, paymentOrRevenueMutation:false, secretsExcluded:true };
    const sourceInfo = {
      candidateFileLoaded:!!rows.length, candidateFile:source.file, candidateSourceMode:source.sourceMode,
      supabaseStoreError:source.storeError || null, zeroRowsNeverMeansDelete:true,
      publicSnapshotChecked:publicSnapshot.checked, publicSnapshotSections:publicSnapshot.sectionKeys, publicSnapshotSectionCounts:publicSnapshot.sectionCounts
    };
    const base = { source:sourceInfo, libraryVersion:"social.candidate-library.durable.v1", rotationPolicy, summary, blockingConditions, safety };
    const params = event.queryStringParameters || {};
    const action = lower(params.action || "candidates");
    const route = CountryRouting.resolve(event, params);
    const admin = { roles:roleValues, access:"validated-social-candidate-read", authMode:actor.authMode };
    if (action === "diagnostic") return json(200, Object.assign(lightweightDiagnostic(base,rows,"all",route), { administrator:admin }));
    if (action === "registry_diagnostic" || action === "influencer_registry_diagnostic") return json(200, Object.assign(lightweightDiagnostic(base,rows,"registry",route), { administrator:admin }));
    if (action === "latest_content_diagnostic" || action === "waiting_diagnostic") return json(200, Object.assign(lightweightDiagnostic(base,rows,"latest",route), { administrator:admin }));
    return json(200, {
      ok:true, reportType:"igdc-social-candidate-queue", version:VERSION, generatedAt:new Date().toISOString(), safety, administrator:admin,
      source:sourceInfo,
      queue:{ schema:"social_candidates.supabase.v1", libraryVersion:base.libraryVersion, renderPolicy:"private_review_only", rotationPolicy, rows },
      summary, blockingConditions
    });
  } catch (error) {
    return json(error.statusCode || 500, { ok:false, version:VERSION, error:error.code || "social_candidate_review_failed", message:error.message || String(error) });
  }
};
