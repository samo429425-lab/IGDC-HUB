"use strict";

/**
 * Social Candidate Store v1
 *
 * Thin server-only adapter between broad Sanmaru/SearchBank discovery and
 * reviewed Social Network candidates. It does not mutate public social.snapshot.json.
 */
const crypto = require("crypto");
const Policy = require("./social-candidate-policy.v1");
const CountryRouting = require("./social-country-routing.v1");
const CountryContentPolicy = require("./social-country-content-policy.v1");
const ChannelLink = require("./social-channel-link.v1");

const VERSION =
  "social-candidate-store-v1.7.1-selected-unpublish-sample-restore";
const DEFAULT_TIMEOUT_MS = 12000;
const CANDIDATE_TABLE =
  process.env.SOCIAL_CANDIDATE_TABLE || "social_candidates";
const RELEASE_TABLE =
  process.env.SOCIAL_SNAPSHOT_RELEASE_TABLE || "social_snapshot_releases";
const READ_ROLES = new Set([
  "owner",
  "admin",
  "super_admin",
  "site_manager",
  "site_manager_director",
  "director",
  "social_manager",
  "media_manager",
  "commerce_manager",
]);
const WRITE_ROLES = new Set([
  "owner",
  "admin",
  "super_admin",
  "site_manager_director",
  "director",
  "social_manager",
]);

const {
  text,
  compact,
  lowerText,
  lowerKey,
  array,
  plain,
  bool,
  clamp,
  ALLOWED_SECTIONS,
  PLATFORM_BY_SECTION,
  POOL_TARGET_PER_SECTION,
  POOL_MIN_PER_SECTION,
  POOL_MAX_PER_SECTION,
  ROTATION_LIMIT_PER_SECTION,
} = Policy;

function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(stableStringify).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stableStringify(value[key]))
      .join(",") +
    "}"
  );
}
function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}
function shortHash(value) {
  return sha256(value).slice(0, 20);
}
function nowIso() {
  return new Date().toISOString();
}
function unique(values) {
  return Array.from(new Set(array(values).map(text).filter(Boolean)));
}
function roleList(member) {
  return Array.from(
    new Set(
      array(member && member.roles)
        .map(lowerKey)
        .filter(Boolean),
    ),
  );
}
function requireRole(member, mode) {
  const allowed = mode === "write" ? WRITE_ROLES : READ_ROLES;
  const roles = roleList(member);
  if (!roles.some((role) => allowed.has(role))) {
    const error = new Error(
      mode === "write"
        ? "소셜 후보 변경 권한이 없습니다."
        : "소셜 후보 조회 권한이 없습니다.",
    );
    error.statusCode = 403;
    error.code = "social_candidate_forbidden";
    throw error;
  }
  return roles;
}
function jsonHeaders(extra) {
  return Object.assign(
    {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "access-control-allow-headers":
        "Content-Type, Authorization, X-IGDC-Internal-Token, X-Sanmaru-Token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    extra || {},
  );
}
function response(statusCode, body, headers) {
  return {
    statusCode,
    headers: jsonHeaders(headers),
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}
function parseBody(event) {
  const raw = (event && event.body) || "";
  if (!raw) return {};
  try {
    return JSON.parse(
      event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw,
    );
  } catch (_e) {
    const error = new Error("요청 JSON이 올바르지 않습니다.");
    error.statusCode = 400;
    error.code = "invalid_json_body";
    throw error;
  }
}
function firstEnv(names) {
  for (const name of names) {
    const value = text(process.env[name]);
    if (value) return { name, value };
  }
  return { name: null, value: "" };
}
function config() {
  const urlRec = firstEnv([
    "SOCIAL_SUPABASE_URL",
    "IGDC_SOCIAL_SUPABASE_URL",
    "GSLOT_SUPABASE_URL",
    "SUPABASE_URL",
  ]);
  const keyRec = firstEnv([
    "SOCIAL_SUPABASE_SERVICE_ROLE_KEY",
    "SOCIAL_SUPABASE_SECRET_KEY",
    "IGDC_SOCIAL_SUPABASE_SERVICE_ROLE_KEY",
    "IGDC_SOCIAL_SUPABASE_SECRET_KEY",
    "GSLOT_SUPABASE_SECRET_KEY",
    "GSLOT_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_KEY",
  ]);
  const url = text(urlRec.value).replace(/\/+$/g, "");
  const key = text(keyRec.value);
  if (!/^https:\/\/[^/]+$/i.test(url) || !key) {
    const error = new Error(
      "소셜 후보 Supabase 연결 환경변수가 없습니다. SOCIAL_SUPABASE_URL/SOCIAL_SUPABASE_SERVICE_ROLE_KEY 또는 기존 SUPABASE 서버 키를 설정하세요.",
    );
    error.statusCode = 503;
    error.code = "social_supabase_config_missing";
    throw error;
  }
  return {
    url,
    key,
    urlSource: urlRec.name,
    keySource: keyRec.name,
    candidateTable: CANDIDATE_TABLE,
    releaseTable: RELEASE_TABLE,
  };
}
async function supabase(path, init) {
  const cfg = config();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(
      2000,
      Math.min(
        30000,
        Number(process.env.SOCIAL_SUPABASE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) ||
          DEFAULT_TIMEOUT_MS,
      ),
    ),
  );
  const headers = Object.assign({}, (init && init.headers) || {}, {
    apikey: cfg.key,
    Authorization: "Bearer " + cfg.key,
    "content-type": "application/json",
  });
  try {
    const res = await fetch(
      cfg.url + path,
      Object.assign({}, init || {}, { headers, signal: controller.signal }),
    );
    const raw = await res.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (_e) {
      body = raw || null;
    }
    if (!res.ok) {
      const error = new Error(
        (body && body.message) ||
          (body && body.error_description) ||
          (body && body.error) ||
          raw ||
          "Supabase HTTP " + res.status,
      );
      error.statusCode = res.status;
      error.code =
        res.status === 404
          ? "social_supabase_table_missing"
          : "social_supabase_http_error";
      error.supabaseBody = body;
      throw error;
    }
    return body;
  } catch (error) {
    if (error && error.name === "AbortError") {
      error.statusCode = 504;
      error.code = "social_supabase_timeout";
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function rest(table, query) {
  return "/rest/v1/" + encodeURIComponent(table) + (query ? "?" + query : "");
}
function encodeIn(values) {
  return "in.(" + values.map((v) => JSON.stringify(text(v))).join(",") + ")";
}
async function selectCandidates(query) {
  return supabase(rest(CANDIDATE_TABLE, query || "select=*"), {
    method: "GET",
    headers: { Prefer: "count=exact" },
  });
}
async function upsertCandidates(rows) {
  if (!rows.length) return [];
  return supabase(rest(CANDIDATE_TABLE, "on_conflict=id"), {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
}
async function updateCandidates(ids, patch) {
  const list = unique(ids);
  if (!list.length) return [];
  return supabase(rest(CANDIDATE_TABLE, "id=" + encodeIn(list)), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch || {}),
  });
}
async function deleteCandidates(ids) {
  const list = unique(ids);
  if (!list.length) return [];
  return supabase(rest(CANDIDATE_TABLE, "id=" + encodeIn(list)), {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
}
function idFor(input, normalized) {
  const row = plain(input);
  const assetClass = lowerKey(
    row.assetClass || row.asset_class || plain(row.raw).assetClass,
  );
  const raw = text(row.id || row.contentId || row.candidateId);
  if (raw && !/^ph_/i.test(raw) && !/seed/i.test(raw))
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9_.:-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 110);
  return (
    (assetClass === "influencer-registry" ? "influencer_" : "social_") +
    shortHash({
      section: normalized.sectionKey,
      platform: normalized.platform,
      creatorChannel:
        text(row.channelUrl || row.channel_url) || normalized.sourceUrl,
    })
  );
}
function normalizeCandidate(input, actor) {
  let row = plain(input);
  const assetClass =
    lowerKey(row.assetClass || row.asset_class || plain(row.raw).assetClass) ===
    "influencer-registry"
      ? "influencer_registry"
      : "latest_content";
  const sourceInput = text(
    row.source_url ||
      row.sourceUrl ||
      row.url ||
      row.permalink ||
      row.pageUrl ||
      row.link ||
      row.href ||
      row.accountUrl ||
      row.channelUrl,
  );
  const platformInput = Policy.normalizePlatform(
    row.platform ||
      row.sourcePlatform ||
      plain(row.source).platform ||
      plain(row.bind).platform,
    sourceInput,
  );
  const requestedContentUrl =
    assetClass === "latest_content"
      ? Policy.normalizeUrl(
    row.latestContentUrl ||
      row.latest_content_url ||
      row.sourceContentUrl ||
      row.source_content_url ||
      (row.latestContentAsset || row.latest_content_asset ? sourceInput : ""),
        )
      : "";
  const channelInput = text(
    row.channelUrl || row.channel_url || row.accountUrl || sourceInput,
  );
  const channel = channelInput
    ? ChannelLink.resolve(channelInput, {
        platform: platformInput || undefined,
        title: row.title || row.name || row.label,
      })
    : { ok: false };
  if (channel.ok && channel.channelUrl) {
    const contentPlatform = requestedContentUrl
      ? Policy.platformFromHost(requestedContentUrl)
      : "";
    const validLatestContent =
      requestedContentUrl &&
      contentPlatform &&
      contentPlatform === (platformInput || channel.platform);
    row = Object.assign({}, row, {
      sourceUrl: validLatestContent
        ? requestedContentUrl
        : channel.channelUrl,
      latestContentUrl: validLatestContent ? requestedContentUrl : "",
      channelUrl: channel.channelUrl,
      channelEvidenceUrl: validLatestContent
        ? requestedContentUrl
        : channel.evidenceUrl,
      sourceContentUrl: validLatestContent ? requestedContentUrl : "",
      entityKind: validLatestContent
        ? text(row.entityKind || row.entity_kind || "latest_post")
        : channel.entityKind,
      channelEntityKind: channel.entityKind,
      channelAsset: true,
      latestContentAsset: !!validLatestContent,
      assetClass,
    });
  }
  const normalized = Policy.classifyCandidate(row);
  const now = nowIso();
  const by = compact(
    (actor && (actor.email || actor.memberId)) || "social-candidate-gateway",
    200,
  );
  const scores = normalized.scores || {};
  const geoScopes = CountryRouting.scopesFrom(
    Object.assign({}, row, { language: normalized.language }),
  );
  return {
    id: idFor(row, normalized),
    section_key: normalized.sectionKey,
    platform: normalized.platform,
    title: normalized.title,
    creator_name: normalized.creatorName,
    creator_handle: normalized.creatorHandle,
    source_url: normalized.sourceUrl,
    embed_url: normalized.embedUrl,
    thumbnail_url: normalized.thumbnailUrl,
    description: normalized.description,
    language: normalized.language || "und",
    region: normalized.region,
    public_access: normalized.publicAccess,
    login_required: normalized.loginRequired,
    access_status: normalized.accessStatus,
    display_mode: normalized.displayMode,
    ad_control: normalized.adControl || "platform_controlled",
    platform_account_dependent: true,
    external_membership_controlled: true,
    maru_membership_overrides_external_ads: false,
    premium_benefit_platform_controlled: true,
    safety_score: Math.round(scores.safety || 0),
    quality_score: Math.round(scores.quality || 0),
    engagement_score: Math.round(scores.engagement || 0),
    revenue_score: Math.round(scores.revenue || 0),
    locale_score: Math.round(scores.locale || 0),
    trust_score: Math.round(scores.trust || 0),
    rotation_score: Math.round(scores.rotation || 0),
    risk_level: normalized.riskLevel || "medium",
    review_status: lowerKey(row.review_status || row.reviewStatus) || "pending",
    verification_status:
      lowerKey(row.verification_status || row.verificationStatus) ||
      "web_verification_required",
    candidate_only:
      row.candidate_only === false || row.candidateOnly === false
        ? false
        : true,
    seed_content:
      normalized.seedContent || bool(row.seed_content || row.seedContent),
    rotation_eligible: bool(row.rotation_eligible || row.rotationEligible),
    evidence: {
      source: "social_candidate_gateway",
      policyVersion: Policy.VERSION,
      sourceHost: Policy.hostOf(normalized.sourceUrl),
      candidateAssetType: text(row.entityKind || row.entity_kind || "channel"),
      assetClass,
      channelAsset: row.channelAsset !== false && row.channel_asset !== false,
      latestContentAsset:
        row.latestContentAsset === true || row.latest_content_asset === true,
      latestContentUrl: text(
        row.latestContentUrl ||
          row.latest_content_url ||
          row.sourceContentUrl ||
          row.source_content_url,
      ),
      contentPublishedAt: text(
        row.contentPublishedAt ||
          row.content_published_at ||
          row.publishedAt ||
          row.published_at,
      ),
      channelUrl: text(row.channelUrl || row.channel_url),
      channelEntityKind: text(
        row.channelEntityKind || row.channel_entity_kind,
      ),
      channelEvidenceUrl: text(
        row.channelEvidenceUrl ||
          row.channel_evidence_url ||
          row.sourceContentUrl ||
          row.source_content_url,
      ),
      searchBankSection: text(
        row.section || row.sectionKey || plain(row.bind).section,
      ),
      searchBankPsomKey: text(
        row.psom_key || row.psomKey || plain(row.bind).psom_key,
      ),
      softRiskCount: normalized.softRiskCount || 0,
      revenueHintCount: scores.revenueHintCount || 0,
      membershipPolicy: {
        externalMembershipControlled: true,
        maruMembershipOverridesExternalAds: false,
        premiumBenefitPlatformControlled: true,
        adControl: "platform_controlled",
      },
    },
    raw: Object.assign({}, row, {
      assetClass,
      countryScopes: geoScopes.countries,
      languageScopes: geoScopes.languages,
    }),
    created_by: by,
    updated_by: by,
    created_at: row.created_at || row.createdAt || now,
    updated_at: now,
  };
}
function validateCandidate(row) {
  const reasons = [];
  if (!row || typeof row !== "object") reasons.push("invalid_row");
  if (!ALLOWED_SECTIONS.has(row.section_key))
    reasons.push("section_not_allowed");
  if (
    row.section_key &&
    row.platform &&
    PLATFORM_BY_SECTION[row.section_key] &&
    PLATFORM_BY_SECTION[row.section_key] !== row.platform
  )
    reasons.push("platform_section_mismatch");
  if (!row.title) reasons.push("title_required");
  if (!row.source_url || Policy.isBadPlaceholderUrl(row.source_url))
    reasons.push("source_url_required");
  if (!plain(row.raw).channelAsset)
    reasons.push("channel_profile_group_required");
  const assetClass = text(plain(row.raw).assetClass || "latest_content");
  if (
    assetClass === "latest_content" &&
    !plain(row.raw).latestContentAsset
  )
    reasons.push("latest_public_content_required");
  if (row.seed_content)
    reasons.push("seed_or_placeholder_preserved_not_imported");
  if (row.risk_level === "blocked") reasons.push("safety_blocked");
  return { ok: reasons.length === 0, reasons };
}
function candidatesFromSearchBankSnapshot(snapshot, actor, options) {
  const opts = plain(options);
  const items = Array.isArray(snapshot && snapshot.items) ? snapshot.items : [];
  const accepted = [];
  const rejected = [];
  const ignored = [];
  const cap = Math.max(
    1,
    Math.min(10000, Number(opts.limit || 10000) || 10000),
  );
  for (
    let index = 0;
    index < items.length && accepted.length < cap;
    index += 1
  ) {
    const item = items[index];
    const row = normalizeCandidate(item, actor);
    if (!row.section_key) {
      ignored.push({ index, reason: "not_social_section" });
      continue;
    }
    if (row.seed_content) {
      ignored.push({
        index,
        id: row.id,
        section: row.section_key,
        platform: row.platform,
        title: row.title,
        reason: "seed_or_placeholder_preserved_in_searchbank_snapshot",
      });
      continue;
    }
    const check = validateCandidate(row);
    if (check.ok) accepted.push(row);
    else
      rejected.push({
        index,
        id: row.id,
        section: row.section_key,
        platform: row.platform,
        title: row.title,
        reasons: check.reasons,
      });
  }
  return {
    accepted,
    rejected,
    ignoredCount: ignored.length,
    total: items.length,
  };
}
function isPromotable(row) {
  return isApprovedForSnapshot(row);
}
function normalizeDbRow(row) {
  const r = plain(row);
  const raw = plain(r.raw);
  const geoScopes = CountryRouting.scopesFrom(r);
  return {
    id: text(r.id),
    sectionKey: text(r.section_key || r.sectionKey),
    platform: text(r.platform),
    title: text(r.title),
    creatorName: text(r.creator_name || r.creatorName),
    creatorHandle: text(r.creator_handle || r.creatorHandle),
    sourceUrl: text(r.source_url || r.sourceUrl),
    channelUrl: text(
      raw.channelUrl ||
        raw.channel_url ||
        plain(r.evidence).channelUrl ||
        r.source_url ||
        r.sourceUrl,
    ),
    latestContentUrl: text(
      raw.latestContentUrl ||
        raw.latest_content_url ||
        raw.sourceContentUrl ||
        raw.source_content_url ||
        plain(r.evidence).latestContentUrl ||
        r.source_url ||
        r.sourceUrl,
    ),
    contentPublishedAt: text(
      raw.contentPublishedAt ||
        raw.content_published_at ||
        raw.publishedAt ||
        raw.published_at ||
        plain(r.evidence).contentPublishedAt,
    ),
    channelEvidenceUrl: text(
      raw.channelEvidenceUrl ||
        raw.channel_evidence_url ||
        raw.sourceContentUrl ||
        raw.source_content_url,
    ),
    entityKind: text(
      raw.entityKind ||
        raw.entity_kind ||
        plain(r.evidence).candidateAssetType ||
        "channel",
    ),
    channelAsset: raw.channelAsset !== false && raw.channel_asset !== false,
    assetClass: text(
      raw.assetClass ||
        plain(r.evidence).assetClass ||
        (raw.latestContentAsset === true ? "latest_content" : "influencer_registry"),
    ),
    latestContentAsset:
      raw.latestContentAsset === true ||
      raw.latest_content_asset === true ||
      plain(r.evidence).latestContentAsset === true,
    category: text(raw.category),
    embedUrl: text(r.embed_url || r.embedUrl),
    thumbnailUrl: text(r.thumbnail_url || r.thumbnailUrl),
    channelThumbnailUrl: text(
      raw.channelThumbnailUrl ||
        raw.channel_thumbnail_url ||
        plain(r.evidence).channelThumbnailUrl,
    ),
    description: text(r.description),
    language: text(r.language),
    region: text(r.region),
    countryScopes: geoScopes.countries,
    languageScopes: geoScopes.languages,
    displayMode: text(r.display_mode || r.displayMode),
    adControl: text(r.ad_control || r.adControl),
    publicAccess: r.public_access === true || r.publicAccess === true,
    loginRequired: r.login_required === true || r.loginRequired === true,
    accessStatus: text(r.access_status || r.accessStatus),
    safetyScore: Number(r.safety_score || r.safetyScore || 0),
    qualityScore: Number(r.quality_score || r.qualityScore || 0),
    engagementScore: Number(r.engagement_score || r.engagementScore || 0),
    revenueScore: Number(r.revenue_score || r.revenueScore || 0),
    localeScore: Number(r.locale_score || r.localeScore || 0),
    trustScore: Number(r.trust_score || r.trustScore || 0),
    rotationScore: Number(r.rotation_score || r.rotationScore || 0),
    riskLevel: text(r.risk_level || r.riskLevel),
    reviewStatus: text(r.review_status || r.reviewStatus),
    verificationStatus: text(r.verification_status || r.verificationStatus),
    candidateOnly: r.candidate_only !== false && r.candidateOnly !== false,
    seedContent: r.seed_content === true || r.seedContent === true,
    rotationEligible:
      r.rotation_eligible === true || r.rotationEligible === true,
    platformAccountDependent: r.platform_account_dependent !== false,
    externalMembershipControlled: r.external_membership_controlled !== false,
    premiumBenefitPlatformControlled:
      r.premium_benefit_platform_controlled !== false,
    maruMembershipOverridesExternalAds:
      r.maru_membership_overrides_external_ads === true,
    reviewNote: text(r.review_note || r.reviewNote),
    blockedReason: text(r.blocked_reason || r.blockedReason),
    reviewedBy: text(r.reviewed_by || r.reviewedBy),
    reviewedAt: text(r.reviewed_at || r.reviewedAt),
    approvedAt: text(r.approved_at || r.approvedAt),
    createdAt: text(r.created_at || r.createdAt),
    updatedAt: text(r.updated_at || r.updatedAt),
    raw,
    promotable: isPromotable(r),
  };
}
function summaryDoc(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const bySection = {},
    byRisk = {},
    byReview = {},
    byPlatform = {},
    byAssetClass = {};
  let activeCandidateCount = 0,
    searchExcludedCount = 0,
    permanentBlockedCount = 0,
    promotable = 0,
    verificationRequired = 0;
  list.forEach((row) => {
    const r = normalizeDbRow(row);
    const reviewStatus = statusKey(r.reviewStatus);
    bySection[r.sectionKey] = (bySection[r.sectionKey] || 0) + 1;
    byRisk[r.riskLevel || "unknown"] =
      (byRisk[r.riskLevel || "unknown"] || 0) + 1;
    byReview[r.reviewStatus || "unknown"] =
      (byReview[r.reviewStatus || "unknown"] || 0) + 1;
    byPlatform[r.platform || "unknown"] =
      (byPlatform[r.platform || "unknown"] || 0) + 1;
    byAssetClass[r.assetClass || "unknown"] =
      (byAssetClass[r.assetClass || "unknown"] || 0) + 1;
    if (reviewStatus === "search_excluded") searchExcludedCount += 1;
    else if (reviewStatus === "permanent_blocked" || reviewStatus === "blocked")
      permanentBlockedCount += 1;
    else activeCandidateCount += 1;
    if (r.promotable) promotable += 1;
    if (
      reviewStatus !== "search_excluded" &&
      reviewStatus !== "permanent_blocked" &&
      reviewStatus !== "blocked" &&
      r.verificationStatus &&
      r.verificationStatus.indexOf("required") >= 0
    )
      verificationRequired += 1;
  });
  return {
    version: VERSION,
    policyVersion: Policy.VERSION,
    generatedAt: nowIso(),
    candidateCount: list.length,
    activeCandidateCount,
    searchExcludedCount,
    permanentBlockedCount,
    promotableCount: promotable,
    verificationRequired,
    rotationPolicy: {
      targetPerSection: POOL_TARGET_PER_SECTION,
      minPerSection: POOL_MIN_PER_SECTION,
      maxPerSection: POOL_MAX_PER_SECTION,
      publicSlotsPerSection: ROTATION_LIMIT_PER_SECTION,
    },
    bySection,
    byRisk,
    byReview,
    byPlatform,
    byAssetClass,
  };
}

async function insertRelease(row) {
  return supabase(rest(RELEASE_TABLE), {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([row]),
  });
}
async function selectReleases(query) {
  return supabase(
    rest(RELEASE_TABLE, query || "select=*&order=created_at.desc&limit=1"),
    { method: "GET" },
  );
}
function statusKey(value) {
  return lowerText(value)
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function isApprovedForSnapshot(row) {
  const r = plain(row);
  const raw = plain(r.raw);
  const assetClass = text(
    raw.assetClass ||
      plain(r.evidence).assetClass ||
      (raw.latestContentAsset === true ? "latest_content" : ""),
  );
  const review = statusKey(r.review_status || r.reviewStatus);
  const verify = statusKey(r.verification_status || r.verificationStatus);
  const risk = statusKey(r.risk_level || r.riskLevel);
  const section = lowerKey(r.section_key || r.sectionKey);
  const access = statusKey(r.access_status || r.accessStatus);
  const publicAccess = r.public_access === true || r.publicAccess === true;
  const loginRequired = r.login_required === true || r.loginRequired === true;
  const candidateOnly = r.candidate_only === true || r.candidateOnly === true;
  const seedContent = r.seed_content === true || r.seedContent === true;
  const approvedVerify =
    verify === "approved_for_snapshot" ||
    verify === "verified" ||
    verify === "approved";
  const accessOk =
    publicAccess === true &&
    loginRequired !== true &&
    !/private|blocked|login_required/.test(access || "public");
  return (
    review === "approved" &&
    approvedVerify &&
    accessOk &&
    !candidateOnly &&
    !seedContent &&
    assetClass === "latest_content" &&
    (raw.latestContentAsset === true ||
      raw.latest_content_asset === true ||
      plain(r.evidence).latestContentAsset === true) &&
    risk !== "blocked" &&
    risk !== "rejected" &&
    ALLOWED_SECTIONS.has(section) &&
    !!text(r.title) &&
    !!text(r.source_url || r.sourceUrl)
  );
}
function contentPublishedValue(row) {
  const r = plain(row);
  const raw = plain(r.raw);
  const evidence = plain(r.evidence);
  const timestamps = plain(r.timestamps);
  const value = Date.parse(
    text(
      raw.contentPublishedAt ||
        raw.content_published_at ||
        raw.publishedAt ||
        raw.published_at ||
        evidence.contentPublishedAt ||
        evidence.publishedAt ||
        timestamps.published ||
        r.content_published_at ||
        r.contentPublishedAt,
    ),
  );
  return Number.isFinite(value) ? value : 0;
}
function freshnessScore(row) {
  const published = contentPublishedValue(row);
  if (!published) return 0;
  const ageDays = Math.max(0, (Date.now() - published) / 86400000);
  if (ageDays <= 2) return 24;
  if (ageDays <= 7) return 20;
  if (ageDays <= 14) return 16;
  if (ageDays <= 30) return 12;
  if (ageDays <= 60) return 8;
  if (ageDays <= 120) return 4;
  return 0;
}
function rowScore(row) {
  const r = plain(row);
  return (
    Number(r.rotation_score || r.rotationScore || 0) * 2 +
    Number(r.revenue_score || r.revenueScore || 0) * 1.6 +
    Number(r.quality_score || r.qualityScore || 0) * 1.4 +
    Number(r.engagement_score || r.engagementScore || 0) * 1.1 +
    Number(r.trust_score || r.trustScore || 0) +
    Number(r.safety_score || r.safetyScore || 0) +
    Number(r.locale_score || r.localeScore || 0) * 0.7 +
    freshnessScore(r)
  );
}
function dateValue(row) {
  const r = plain(row);
  const contentDate = contentPublishedValue(r);
  if (contentDate) return contentDate;
  const value = Date.parse(
    text(
      r.approved_at ||
        r.approvedAt ||
        r.reviewed_at ||
        r.reviewedAt ||
        r.updated_at ||
        r.updatedAt ||
        r.created_at ||
        r.createdAt,
    ),
  );
  return Number.isFinite(value) ? value : 0;
}
function commercialRoute(row) {
  const r = plain(row);
  const raw = plain(r.raw);
  const source = plain(
    raw.commercial || raw.monetization || r.commercial || r.monetization,
  );
  const affiliateUrl = text(
    source.affiliateOutboundUrl ||
      source.affiliateUrl ||
      raw.affiliateOutboundUrl ||
      raw.affiliateUrl ||
      r.affiliate_outbound_url ||
      r.affiliateOutboundUrl,
  );
  const campaignId = text(
    source.campaignId || raw.campaignId || r.campaign_id || r.campaignId,
  );
  const leadRoute = text(
    source.leadRoute || raw.leadRoute || r.lead_route || r.leadRoute,
  );
  const sponsorAgreement =
    source.sponsorAgreement === true ||
    raw.sponsorAgreement === true ||
    r.sponsor_agreement === true;
  const eligible =
    !!affiliateUrl || !!campaignId || !!leadRoute || sponsorAgreement;
  return {
    eligible,
    affiliateUrl: affiliateUrl || undefined,
    campaignId: campaignId || undefined,
    leadRoute: leadRoute || undefined,
    sponsorAgreement,
    policy: "explicit_agreement_or_attribution_only",
  };
}
function groupRowsBySection(rows) {
  const out = {};
  Policy.SECTION_KEYS.forEach((section) => {
    out[section] = [];
  });
  array(rows).forEach((row) => {
    const section = lowerKey(row.section_key || row.sectionKey);
    if (ALLOWED_SECTIONS.has(section)) out[section].push(row);
  });
  return out;
}
function channelIdentity(row) {
  const r = plain(row);
  const raw = plain(r.raw);
  return text(
    raw.channelUrl ||
      raw.channel_url ||
      plain(r.evidence).channelUrl ||
      r.channel_url ||
      r.channelUrl,
  ).toLowerCase();
}
function assetClassOf(row) {
  const r = plain(row);
  const raw = plain(r.raw);
  return text(
    raw.assetClass ||
      plain(r.evidence).assetClass ||
      (raw.latestContentAsset === true ? "latest_content" : ""),
  );
}
function isApprovedInfluencer(row) {
  const r = plain(row);
  const review = statusKey(r.review_status || r.reviewStatus);
  const verify = statusKey(r.verification_status || r.verificationStatus);
  const risk = statusKey(r.risk_level || r.riskLevel);
  const candidateOnly = r.candidate_only === true || r.candidateOnly === true;
  return (
    assetClassOf(r) === "influencer_registry" &&
    review === "approved" &&
    (verify === "approved_for_snapshot" ||
      verify === "verified" ||
      verify === "approved") &&
    !candidateOnly &&
    risk !== "blocked" &&
    risk !== "rejected" &&
    !!channelIdentity(r)
  );
}
function approvedContentRows(rows) {
  const list = array(rows);
  const registryBySection = {};
  const approvedChannelsBySection = {};
  list.forEach((row) => {
    const section = lowerKey(row.section_key || row.sectionKey);
    if (!section) return;
    if (assetClassOf(row) === "influencer_registry") {
      registryBySection[section] = true;
      if (isApprovedInfluencer(row)) {
        if (!approvedChannelsBySection[section])
          approvedChannelsBySection[section] = new Set();
        approvedChannelsBySection[section].add(channelIdentity(row));
      }
    }
  });
  return list.filter((row) => {
    if (!isApprovedForSnapshot(row)) return false;
    const section = lowerKey(row.section_key || row.sectionKey);
    if (!registryBySection[section]) return true;
    const channels = approvedChannelsBySection[section] || new Set();
    return channels.has(channelIdentity(row));
  });
}
function byRank(salt) {
  return function (a, b) {
    const d = rowScore(b) - rowScore(a);
    if (d) return d;
    const ah = shortHash({
      id: a.id,
      section: a.section_key || a.sectionKey,
      salt,
    });
    const bh = shortHash({
      id: b.id,
      section: b.section_key || b.sectionKey,
      salt,
    });
    return ah < bh ? -1 : ah > bh ? 1 : 0;
  };
}
function byRouteRank(route, salt) {
  return function (a, b) {
    const d =
      rowScore(b) +
      CountryRouting.matchScore(b, route) +
      CountryContentPolicy.contentAffinityScore(b, route) -
      (rowScore(a) +
        CountryRouting.matchScore(a, route) +
        CountryContentPolicy.contentAffinityScore(a, route));
    if (d) return d;
    return byRank(salt)(a, b);
  };
}
function uniqueRows(rows) {
  const seen = new Set();
  const out = [];
  array(rows).forEach((row) => {
    const id = text(
      row.id || row.candidateId || row.source_url || row.sourceUrl,
    );
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(row);
  });
  return out;
}
function selectRotation(rows, options) {
  const opts = plain(options);
  const limit = Math.max(
    1,
    Math.min(
      200,
      Number(
        opts.limitPerSection ||
          opts.publicSlotsPerSection ||
          ROTATION_LIMIT_PER_SECTION,
      ) || ROTATION_LIMIT_PER_SECTION,
    ),
  );
  const stableCount = Math.min(limit, Math.round(limit * 0.7));
  const refreshCount = Math.min(limit - stableCount, Math.round(limit * 0.2));
  const discoveryCount = Math.max(0, limit - stableCount - refreshCount);
  const salt =
    text(opts.rotationSalt || opts.salt) ||
    new Date().toISOString().slice(0, 10);
  const route =
    opts.route && typeof opts.route === "object"
      ? opts.route
      : {
          countryCode: opts.countryCode || opts.country,
          languages: opts.languages || opts.language || opts.lang,
        };
  const groups = groupRowsBySection(approvedContentRows(rows));
  const selected = {};
  const replacement = {};
  const counts = {};
  Object.keys(groups).forEach((section) => {
    const ranked = groups[section].slice().sort(byRouteRank(route, salt));
    const forcedReplacement = ranked.filter(
      (row) =>
        plain(row && row.raw).placementOverride === "replacement_waiting",
    );
    const selectable = ranked.filter(
      (row) =>
        plain(row && row.raw).placementOverride !== "replacement_waiting",
    );
    const stable = selectable.slice(0, stableCount);
    const stableIds = new Set(stable.map((row) => text(row.id)));
    const remaining = selectable.filter((row) => !stableIds.has(text(row.id)));
    const refresh = remaining
      .slice()
      .sort((a, b) => dateValue(b) - dateValue(a))
      .slice(0, refreshCount);
    const used = new Set(stable.concat(refresh).map((row) => text(row.id)));
    const discovery = remaining
      .filter((row) => !used.has(text(row.id)))
      .sort((a, b) => {
        const ah = shortHash({ id: a.id, salt, mode: "discovery" });
        const bh = shortHash({ id: b.id, salt, mode: "discovery" });
        return ah < bh ? -1 : ah > bh ? 1 : 0;
      })
      .slice(0, discoveryCount);
    const merged = uniqueRows(
      stable.concat(refresh, discovery, selectable),
    ).slice(0, limit);
    selected[section] = merged;
    const selectedIds = new Set(merged.map((row) => text(row.id)));
    replacement[section] = uniqueRows(
      selectable
        .filter((row) => !selectedIds.has(text(row.id)))
        .concat(forcedReplacement),
    );
    counts[section] = {
      available: ranked.length,
      selected: merged.length,
      replacement: replacement[section].length,
      stable: Math.min(stable.length, merged.length),
      refresh: Math.min(
        refresh.length,
        Math.max(0, merged.length - stable.length),
      ),
      discovery: Math.max(0, merged.length - stable.length - refresh.length),
    };
  });
  return {
    selected,
    replacement,
    counts,
    rotationSalt: salt,
    limitPerSection: limit,
    route: {
      scopeMode: text(route.scopeMode) || null,
      countryCode:
        text(route.countryCode || route.country).toUpperCase() || null,
      worldRegion: text(route.worldRegion || route.regionId) || null,
      languages: CountryRouting.normalizeLanguages(
        route.languages || route.language || route.lang,
      ),
    },
    policy: {
      stablePercent: 70,
      refreshPercent: 20,
      discoveryPercent: 10,
      scopeStrategy: "consumption_weighted_country_region_global",
      countryHardFilter: false,
      freshnessBoost: true,
    },
  };
}
function publicSocialSlot(row, slotId, defaults) {
  const base = plain(defaults);
  const r = plain(row);
  const raw = plain(r.raw);
  const sourceUrl = text(r.source_url || r.sourceUrl);
  const thumb = text(
    r.thumbnail_url ||
      r.thumbnailUrl ||
      base.thumb ||
      base.thumbnail ||
      base.image ||
      "",
  );
  const section = text(r.section_key || r.sectionKey);
  const platform = text(r.platform || PLATFORM_BY_SECTION[section] || "social");
  const now = nowIso();
  const channelUrl = text(
    raw.channelUrl || raw.channel_url || plain(r.evidence).channelUrl,
  );
  const contentPublishedAt = text(
    raw.contentPublishedAt ||
      raw.content_published_at ||
      raw.publishedAt ||
      raw.published_at ||
      plain(r.evidence).contentPublishedAt,
  );
  return Object.assign({}, base, {
    slotId: Number(slotId) || Number(base.slotId) || 1,
    id: text(r.id) || "social_" + shortHash({ section, platform, sourceUrl }),
    contentId: text(r.id) || text(base.contentId),
    type: "external_social",
    title: text(r.title),
    url: sourceUrl,
    link: sourceUrl,
    href: sourceUrl,
    permalink: sourceUrl,
    thumb: thumb || undefined,
    thumbnail: thumb || undefined,
    thumbnailUrl: thumb || undefined,
    image: thumb || undefined,
    description: text(r.description),
    creator: text(
      r.creator_name || r.creatorName || r.creator_handle || r.creatorHandle,
    ),
    creatorName: text(r.creator_name || r.creatorName),
    creatorHandle: text(r.creator_handle || r.creatorHandle),
    embedUrl: text(r.embed_url || r.embedUrl) || undefined,
    displayMode: text(r.display_mode || r.displayMode || "link_card"),
    source: Object.assign({}, plain(base.source), {
      platform,
      section_key: section,
      provider: "external_social_platform",
      url: sourceUrl,
    }),
    social: {
      platform,
      sectionKey: section,
      assetType: text(
        raw.entityKind ||
          raw.entity_kind ||
          plain(r.evidence).candidateAssetType ||
          "channel",
      ),
      channelAsset: true,
      latestContentAsset: true,
      channelUrl: channelUrl || undefined,
      latestContentUrl: sourceUrl,
      contentPublishedAt: contentPublishedAt || undefined,
      category: text(raw.category),
      topicTags: unique(raw.tags).slice(0, 12),
      adControl: text(r.ad_control || r.adControl || "platform_controlled"),
      platformAccountDependent: r.platform_account_dependent !== false,
      externalMembershipControlled: r.external_membership_controlled !== false,
      premiumBenefitPlatformControlled:
        r.premium_benefit_platform_controlled !== false,
      maruMembershipOverridesExternalAds:
        r.maru_membership_overrides_external_ads === true,
      loginRequired: r.login_required === true,
      publicAccess: r.public_access === true,
      countryScopes: CountryRouting.scopesFrom(r).countries,
      languageScopes: CountryRouting.scopesFrom(r).languages,
      commercial: commercialRoute(r),
    },
    signals: Object.assign({}, plain(base.signals), {
      quality_score: Number(r.quality_score || 0),
      trust_score: Number(r.trust_score || 0),
      safety_score: Number(r.safety_score || 0),
      revenue_score: Number(r.revenue_score || 0),
      rotation_score: Number(r.rotation_score || 0),
    }),
    candidateOnly: false,
    seedContent: false,
    verificationStatus: text(r.verification_status || "approved_for_snapshot"),
    audit: Object.assign({}, plain(base.audit), {
      origin: "social_candidates",
      candidate_id: text(r.id),
      approved_at: text(r.approved_at || r.approvedAt),
      generated_at: now,
    }),
    timestamps: Object.assign({}, plain(base.timestamps), {
      published: contentPublishedAt || now,
      ingested: text(r.created_at || r.createdAt),
      updated: text(r.updated_at || r.updatedAt || now),
    }),
  });
}
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value == null ? {} : value));
}
function buildSnapshot(baseSnapshot, rows, options) {
  const opts = plain(options);
  const base = cloneJson(baseSnapshot || {});
  if (!base.pages) base.pages = {};
  if (!base.pages.social) base.pages.social = {};
  if (!base.pages.social.sections) base.pages.social.sections = {};
  const sections = base.pages.social.sections;
  const requestedSection = Policy.normalizeSectionKey(
    opts.sectionKey || opts.section || opts.targetSection,
  );
  const targetSections =
    requestedSection && ALLOWED_SECTIONS.has(requestedSection)
      ? [requestedSection]
      : Policy.SECTION_KEYS;
  const rotation = selectRotation(rows, opts);
  const approvedRows = approvedContentRows(rows);
  const filled = {};
  targetSections.forEach((sectionKey) => {
    const current = Array.isArray(sections[sectionKey])
      ? sections[sectionKey].slice()
      : [];
    const capacity = Math.max(
      current.length,
      Number(
        opts.limitPerSection ||
          opts.publicSlotsPerSection ||
          ROTATION_LIMIT_PER_SECTION,
      ) || ROTATION_LIMIT_PER_SECTION,
    );
    const next = [];
    for (let index = 0; index < capacity; index += 1) {
      next.push(
        current[index]
          ? Object.assign({}, current[index])
          : {
              id: "ph_" + sectionKey + "_" + String(index + 1).padStart(3, "0"),
              type: "placeholder",
              title: "Loading…",
              url: "#",
              source: { platform: "placeholder", section_key: sectionKey },
            },
      );
    }
    const selected = rotation.selected[sectionKey] || [];
    selected.slice(0, capacity).forEach((row, index) => {
      next[index] = publicSocialSlot(row, index + 1, next[index]);
    });
    sections[sectionKey] = next;
    filled[sectionKey] = selected.length;
  });
  const candidatePool = plain(base.pages.social.candidatePool);
  const poolGroups = groupRowsBySection(approvedRows);
  targetSections.forEach((sectionKey) => {
    candidatePool[sectionKey] = poolGroups[sectionKey]
      .slice()
      .sort(byRouteRank(opts.route || {}, rotation.rotationSalt))
      .slice(0, POOL_MAX_PER_SECTION)
      .map((row, index) => publicSocialSlot(row, index + 1, {}));
  });
  base.pages.social.candidatePool = candidatePool;
  base.pages.social.countryRouting = {
    version: CountryRouting.VERSION,
    scope: "country_region_global_consumption_weighted",
    ipStorage: "none",
    selectedCountryPrecedence: true,
    ipCountryFallback: true,
    regionFallback: true,
    globalFallback: true,
    countryHardFilter: false,
    languageFallback: true,
    publicSlotsPerSection: ROTATION_LIMIT_PER_SECTION,
    poolTargetPerSection: POOL_TARGET_PER_SECTION,
  };
  base.version = "social.snapshot.generated.supabase.v1";
  base.meta = Object.assign({}, plain(base.meta), {
    generatedAt: nowIso(),
    generatedBy: "social-snapshot-publish",
    source: "supabase.social_candidates",
    samplePreservePolicy:
      "Approved rotation candidates replace only their target slots; all remaining sample/placeholder slots are preserved.",
    excludedSections: ["social-maru", "rightPanel"],
    appliedSections: targetSections,
    applicationScope: {
      scopeMode: text(rotation.route && rotation.route.scopeMode) || null,
      countryCode:
        text(rotation.route && rotation.route.countryCode).toUpperCase() ||
        null,
      languages: CountryRouting.normalizeLanguages(
        rotation.route && rotation.route.languages,
      ),
      worldRegion:
        text(rotation.route && rotation.route.worldRegion) ||
        text(opts.route && (opts.route.worldRegion || opts.route.regionId)) ||
        null,
      ipMatchedAtRead: true,
      rawIpStored: false,
    },
    filled,
    rotation: {
      salt: rotation.rotationSalt,
      counts: rotation.counts,
      policy: rotation.policy,
    },
  });
  return base;
}

function slotCandidateId(slot) {
  const value = plain(slot);
  return text(
    value.contentId ||
      value.candidateId ||
      plain(value.audit).candidate_id ||
      value.id,
  );
}

function sampleSlot(seedSections, sectionKey, index) {
  const seed = Array.isArray(seedSections[sectionKey])
    ? seedSections[sectionKey][index]
    : null;
  if (seed)
    return Object.assign({}, cloneJson(seed), {
      slotId: Number(seed.slotId) || index + 1,
    });
  return {
    id: "ph_" + sectionKey + "_" + String(index + 1).padStart(3, "0"),
    slotId: index + 1,
    type: "placeholder",
    title: "Loading…",
    url: "#",
    source: { platform: "placeholder", section_key: sectionKey },
  };
}

function unpublishSnapshot(currentSnapshot, seedSnapshot, candidateIds, options) {
  const opts = plain(options);
  const base = cloneJson(currentSnapshot || {});
  const seed = cloneJson(seedSnapshot || {});
  if (!base.pages) base.pages = {};
  if (!base.pages.social) base.pages.social = {};
  if (!base.pages.social.sections) base.pages.social.sections = {};
  const sections = base.pages.social.sections;
  const seedSections = plain(
    seed.pages && seed.pages.social && seed.pages.social.sections,
  );
  const ids = new Set(array(candidateIds).map(text).filter(Boolean));
  const requestedSection = Policy.normalizeSectionKey(
    opts.sectionKey || opts.section || opts.targetSection,
  );
  const targetSections =
    requestedSection && ALLOWED_SECTIONS.has(requestedSection)
      ? [requestedSection]
      : Policy.SECTION_KEYS;
  const removedBySection = {};
  let removedSlots = 0;

  targetSections.forEach((sectionKey) => {
    const current = Array.isArray(sections[sectionKey])
      ? sections[sectionKey].slice()
      : [];
    let sectionRemoved = 0;
    sections[sectionKey] = current.map((slot, index) => {
      const candidateId = slotCandidateId(slot);
      if (!candidateId || !ids.has(candidateId)) return slot;
      sectionRemoved += 1;
      removedSlots += 1;
      const fallback = sampleSlot(seedSections, sectionKey, index);
      return ids.has(slotCandidateId(fallback))
        ? sampleSlot({}, sectionKey, index)
        : fallback;
    });
    removedBySection[sectionKey] = sectionRemoved;
  });

  const candidatePool = plain(base.pages.social.candidatePool);
  targetSections.forEach((sectionKey) => {
    candidatePool[sectionKey] = array(candidatePool[sectionKey]).filter(
      (slot) => !ids.has(slotCandidateId(slot)),
    );
  });
  base.pages.social.candidatePool = candidatePool;

  const filled = Object.assign({}, plain(plain(base.meta).filled));
  targetSections.forEach((sectionKey) => {
    filled[sectionKey] = array(sections[sectionKey]).filter(
      (slot) =>
        text(plain(slot).type) === "external_social" &&
        text(plain(plain(slot).audit).origin) === "social_candidates",
    ).length;
  });
  base.version = "social.snapshot.generated.supabase.v1";
  base.meta = Object.assign({}, plain(base.meta), {
    generatedAt: nowIso(),
    generatedBy: "social-snapshot-publish",
    samplePreservePolicy:
      "Unpublished selected candidates return to the replacement queue and their original sample/placeholder slots are restored.",
    excludedSections: ["social-maru", "rightPanel"],
    appliedSections: targetSections,
    filled,
    frontUnpublish: {
      candidateIds: Array.from(ids),
      removedSlots,
      removedBySection,
      operation: "selected_front_unpublish",
    },
  });
  return {
    snapshot: base,
    candidateIds: Array.from(ids),
    removedSlots,
    removedBySection,
    targetSections,
  };
}

module.exports = {
  VERSION,
  CANDIDATE_TABLE,
  RELEASE_TABLE,
  READ_ROLES,
  WRITE_ROLES,
  POOL_TARGET_PER_SECTION,
  POOL_MIN_PER_SECTION,
  POOL_MAX_PER_SECTION,
  ROTATION_LIMIT_PER_SECTION,
  Policy,
  text,
  compact,
  lowerText,
  lowerKey,
  array,
  plain,
  bool,
  clamp,
  response,
  parseBody,
  nowIso,
  sha256,
  shortHash,
  config,
  supabase,
  rest,
  encodeIn,
  insertRelease,
  selectReleases,
  selectCandidates,
  upsertCandidates,
  updateCandidates,
  deleteCandidates,
  requireRole,
  normalizeCandidate,
  validateCandidate,
  candidatesFromSearchBankSnapshot,
  normalizeDbRow,
  isPromotable,
  summaryDoc,
  isApprovedForSnapshot,
  rowScore,
  selectRotation,
  publicSocialSlot,
  buildSnapshot,
  slotCandidateId,
  unpublishSnapshot,
  commercialRoute,
  channelIdentity,
  assetClassOf,
  isApprovedInfluencer,
  approvedContentRows,
};
