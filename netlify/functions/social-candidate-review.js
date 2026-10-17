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

const VERSION = "social-candidate-review-api-v1.4.0-six-section-complete-read";
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
    ? SocialStore.Policy.SECTION_KEYS : ["social-youtube","social-instagram","social-tiktok","social-facebook","social-bilibili","social-douyin"];
}
function first(obj, keys) {
  for (const key of keys) if (obj && obj[key] != null && text(obj[key])) return obj[key];
  return "";
}
function youtubeThumbnailFromUrl(value) {
  const match = text(value).match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/))([A-Za-z0-9_-]{6,})/i);
  return match ? "https://i.ytimg.com/vi/" + match[1] + "/hqdefault.jpg" : "";
}
function thumbnailFrom(value, platformHint) {
  const obj = value && typeof value === "object" ? value : {};
  const raw = obj.raw && typeof obj.raw === "object" ? obj.raw : {};
  const social = obj.social && typeof obj.social === "object" ? obj.social : {};
  const source = obj.source && typeof obj.source === "object" ? obj.source : {};
  const media = obj.media && typeof obj.media === "object" ? obj.media : {};
  const groups = [obj, raw, social, source, media];
  const keys = ["thumbnail_url","thumbnailUrl","thumbnail","thumb","image","imageUrl","image_url","poster","posterUrl","cover","coverUrl","previewImage","preview_image"];
  for (const group of groups) {
    const found = text(first(group, keys));
    if (/^https:\/\//i.test(found)) return found;
  }
  const platform = lower(platformHint || first(obj,["platform","provider","network"]) || first(source,["platform","provider"])).replace(/^social-/, "");
  if (platform === "youtube") {
    return youtubeThumbnailFromUrl(first(obj,["latestContentUrl","latest_content_url","sourceUrl","source_url","url","link","href","permalink"]) || first(raw,["latestContentUrl","latest_content_url","sourceContentUrl","source_content_url","url"]));
  }
  return "";
}
function snapshotIdentity(item) {
  const raw = item && typeof item === "object" ? item : {};
  const audit = raw.audit && typeof raw.audit === "object" ? raw.audit : {};
  return text(first(audit,["candidate_id","candidateId"]) || first(raw,["candidateId","candidate_id","contentId","content_id","id","sourceUrl","source_url","url","link","href"]));
}
function recoverablePublishedItem(item) {
  const raw = item && typeof item === "object" ? item : {};
  const id = lower(first(raw,["id","candidateId","candidate_id","contentId","content_id"]));
  const title = lower(first(raw,["title","name","label","channelName","author"]));
  const sourceUrl = text(first(raw,["source_url","sourceUrl","url","link","href","permalink"]));
  const rawMeta = raw.raw && typeof raw.raw === "object" ? raw.raw : {};
  if (/^ph[_:-]/.test(id) || raw.placeholder === true || rawMeta.placeholder === true) return false;
  if (!sourceUrl || sourceUrl === "#" || !/^https:\/\//i.test(sourceUrl)) return false;
  if (/^(loading(?:…|\.\.\.)?|placeholder|sample|준비\s*중)$/.test(title)) return false;
  return true;
}
function recoveredRow(item, sectionKey, index, assetClass) {
  const raw = item && typeof item === "object" ? item : {};
  const id = text(first(raw, ["id","candidateId","candidate_id","contentId","content_id","uuid"])) ||
    "recovered:" + sectionKey + ":" + index + ":" + Buffer.from(text(first(raw,["url","sourceUrl","source_url","link","href","title"])) || String(index)).toString("base64url").slice(0,32);
  const sourceUrl = text(first(raw, ["source_url","sourceUrl","url","link","href","permalink"]));
  const platform = lower(first(raw, ["platform","provider","network"]) || sectionKey).replace(/^social-/, "");
  const thumbnail = thumbnailFrom(raw, platform) || (platform === "youtube" ? youtubeThumbnailFromUrl(sourceUrl) : "");
  const title = text(first(raw, ["title","name","label","channelName","author"]));
  const description = text(first(raw, ["description","desc","summary","caption"]));
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
    const poolRaw = Array.isArray(candidatePool && candidatePool[sectionKey]) ? candidatePool[sectionKey] : [];
    const pool = poolRaw.filter(recoverablePublishedItem);
    const visibleRaw = sections && sections[sectionKey];
    const visibleAll = Array.isArray(visibleRaw) ? visibleRaw : (Array.isArray(visibleRaw && visibleRaw.items) ? visibleRaw.items : []);
    const visible = visibleAll.filter(recoverablePublishedItem);
    const visibleByIdentity = new Map();
    visible.forEach((item) => {
      const key = snapshotIdentity(item);
      if (key) visibleByIdentity.set(key, item);
    });
    const items = pool.length ? pool.map((item) => {
      const visibleItem = visibleByIdentity.get(snapshotIdentity(item)) || {};
      const poolThumb = thumbnailFrom(item, sectionKey);
      const visibleThumb = thumbnailFrom(visibleItem, sectionKey);
      return Object.assign({}, visibleItem, item, {
        thumbnail_url: poolThumb || visibleThumb || undefined,
        thumbnailUrl: poolThumb || visibleThumb || undefined
      });
    }) : visible.slice();
    items.forEach((item, index) => {
      const row = recoveredRow(item, sectionKey, index, "latest_content");
      const key = text(row.id) || text(row.source_url);
      if (!key || seen.has(key)) return;
      seen.add(key); out.push(row);
    });
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
      // PostgREST/Supabase projects commonly cap a single response at 1000 rows.
      // The old one-shot `limit=10000` therefore returned exactly 1000 mixed
      // legacy/current rows and could hide newly researched Bilibili/Douyin
      // candidates. Read each of the six active Social sections independently
      // so every current section is visible to the administrator and diagnostics.
      const activeSections = sectionKeys();
      const settled = await Promise.allSettled(activeSections.map(async (sectionKey) => {
        const rows = await SocialStore.selectCandidates(
          "select=*&section_key=eq." + encodeURIComponent(sectionKey) +
          "&order=updated_at.desc&limit=1000"
        );
        return Array.isArray(rows) ? rows : [];
      }));
      const pages = settled.map((entry) => entry.status === "fulfilled" ? entry.value : []);
      const rows = pages.flat();
      const sectionReadErrors = Object.fromEntries(activeSections.map((key, index) => {
        const entry = settled[index];
        return [key, entry && entry.status === "rejected" ? text(entry.reason && (entry.reason.message || entry.reason)) : null];
      }).filter((row) => row[1]));
      if (rows.length) {
        return {
          file: "supabase:" + (SocialStore.CANDIDATE_TABLE || "social_candidates"),
          sourceMode: Object.keys(sectionReadErrors).length ? "supabase_active_sections_partial" : "supabase_active_sections_complete",
          storeError: null,
          rows,
          sectionReadCounts: Object.fromEntries(activeSections.map((key, index) => [key, pages[index].length])),
          sectionReadErrors
        };
      }
      stage = {
        sourceMode: Object.keys(sectionReadErrors).length ? "supabase_active_sections_unavailable" : "supabase_active_sections_empty_ambiguous",
        storeError: Object.keys(sectionReadErrors).length ? { code:"social_section_reads_failed", message:JSON.stringify(sectionReadErrors) } : null
      };
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
function normalizeRows(rows) {
  const allowed = new Set(sectionKeys());
  return rows.map((row) => {
    const normalized = SocialStore && SocialStore.normalizeDbRow ? SocialStore.normalizeDbRow(row) : Object.assign({}, row);
    const platform = lower(normalized && normalized.platform || row && row.platform);
    const thumb = text(normalized && normalized.thumbnailUrl) || thumbnailFrom(row, platform);
    const channelThumb = text(normalized && normalized.channelThumbnailUrl) || text(first(row && row.raw || {}, ["channelThumbnailUrl","channel_thumbnail_url"]));
    if (thumb) { normalized.thumbnailUrl = thumb; normalized.thumbnail_url = thumb; }
    if (channelThumb) normalized.channelThumbnailUrl = channelThumb;
    if (!thumb && platform === "youtube") {
      const yt = youtubeThumbnailFromUrl(normalized.latestContentUrl || normalized.sourceUrl || row && (row.latestContentUrl || row.sourceUrl || row.source_url));
      if (yt) { normalized.thumbnailUrl = yt; normalized.thumbnail_url = yt; }
    }
    return normalized;
  }).filter((row) => allowed.has(text(row && (row.sectionKey || row.section_key))));
}
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
function isContentHold(row) {
  return assetClass(row) === "latest_content" && /^(hold|content_hold|held)$/.test(reviewStatus(row));
}
function compactDiagnosticRow(row) {
  const raw = row && row.raw || {};
  return {
    id: text(row && row.id),
    sectionKey: text(row && (row.sectionKey || row.section_key)),
    platform: lower(row && row.platform),
    assetClass: assetClass(row),
    reviewStatus: reviewStatus(row),
    candidateOnly: row && row.candidateOnly == null ? (row && row.candidate_only == null ? null : !!row.candidate_only) : !!row.candidateOnly,
    verificationStatus: text(row && (row.verificationStatus || row.verification_status)),
    title: text(row && (row.title || row.name)),
    creatorName: text(row && (row.creatorName || row.creator_name || row.channelName || row.channel_name)),
    sourceUrl: text(row && (row.sourceUrl || row.source_url || row.url)),
    latestContentUrl: text(row && (row.latestContentUrl || row.latest_content_url || raw.latestContentUrl || raw.sourceContentUrl)),
    channelUrl: text(row && (row.channelUrl || row.channel_url || raw.channelUrl)),
    thumbnailUrl: text(row && (row.thumbnailUrl || row.thumbnail_url)),
    excluded: isExcluded(row),
    blocked: isBlocked(row),
    contentHold: isContentHold(row),
    exclusionReason: text(raw.exclusionReason || raw.exclusion_reason || row && row.exclusionReason),
    holdReason: text(raw.holdReason || raw.hold_reason || row && row.holdReason),
    createdAt: text(row && (row.createdAt || row.created_at)),
    updatedAt: text(row && (row.updatedAt || row.updated_at))
  };
}
function detailedStatusDiagnostic(base, rows, kind, route) {
  const scoped = scopedRows(rows, route);
  let filtered = [];
  let reportType = "igdc-social-status-diagnostic";
  if (kind === "hold") {
    filtered = scoped.filter(isContentHold);
    reportType = "igdc-social-content-hold-diagnostic";
  } else if (kind === "exclusion") {
    filtered = scoped.filter(isExcluded);
    reportType = "igdc-social-search-exclusion-diagnostic";
  } else {
    filtered = scoped.filter((row) => assetClass(row) === "latest_content");
    reportType = "igdc-social-latest-content-rows-diagnostic";
  }
  return {
    ok: true,
    reportType,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    scope: { mode:text(route && route.scopeMode)||null, countryCode:text(route && route.countryCode).toUpperCase()||null, worldRegion:text(route && (route.worldRegion||route.regionId))||null, source:text(route && route.source)||null },
    source: base.source,
    queue: { schema:"social_candidates.supabase.v1", libraryVersion:base.libraryVersion, renderPolicy:"private_review_only", rowPayloadIncluded:true, rowCount:filtered.length, rotationPolicy:base.rotationPolicy },
    counts: { total:filtered.length, active:filtered.filter((row)=>!isExcluded(row)).length, excluded:filtered.filter((row)=>reviewStatus(row)==="search_excluded").length, blocked:filtered.filter(isBlocked).length, held:filtered.filter(isContentHold).length },
    consumptionScopeBreakdown: scopeBreakdown(filtered, route),
    sections: diagnosticSectionSummary(filtered),
    rows: filtered.map(compactDiagnosticRow),
    safety: base.safety,
    note: "읽기 전용 점검 JSON입니다. 이 요청은 후보·프론트·SearchBank·Snapshot 데이터를 변경하지 않습니다."
  };
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
      sectionReadCounts: source.sectionReadCounts || null,
      sectionReadErrors: source.sectionReadErrors || null,
      activeSectionFilter: sectionKeys(),
      legacySectionRowsIgnored: true,
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
    if (action === "latest_content_rows_diagnostic") return json(200, Object.assign(detailedStatusDiagnostic(base,rows,"latest",route), { administrator:admin }));
    if (action === "hold_diagnostic" || action === "content_hold_diagnostic") return json(200, Object.assign(detailedStatusDiagnostic(base,rows,"hold",route), { administrator:admin }));
    if (action === "exclusion_diagnostic" || action === "search_exclusion_diagnostic") return json(200, Object.assign(detailedStatusDiagnostic(base,rows,"exclusion",route), { administrator:admin }));
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
