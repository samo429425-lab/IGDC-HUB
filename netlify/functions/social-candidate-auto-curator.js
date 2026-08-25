"use strict";

/**
 * Administrator-triggered Sanmaru policy/score automation for Social Hub.
 *
 * It promotes only existing public channel assets that already passed the
 * candidate gateway. It never searches external providers and never publishes
 * a front snapshot. Manual replacement-waiting overrides are preserved.
 */
const SocialStore = require("./lib/social-candidate-store.v1");
const CountryRouting = require("./lib/social-country-routing.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");
const AIPolicy = require("./lib/social-ai-policy-runtime.v1");

const VERSION =
  "social-candidate-auto-curator-v1.4.0-thumbnail-continuity";
const MAX_PER_SECTION = SocialStore.POOL_MAX_PER_SECTION || 350;

function text(value) {
  return value == null ? "" : String(value).trim();
}
async function actorFor(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  const member = {
    memberId: text(actor && (actor.memberId || actor.sub)),
    email: text(actor && actor.email),
    roles: Array.isArray(actor && actor.roles) ? actor.roles : [],
  };
  SocialStore.requireRole(member, "write");
  return member;
}
function chunks(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size)
    out.push(values.slice(index, index + size));
  return out;
}
function reviewKey(row) {
  return text(row && (row.review_status || row.reviewStatus)).toLowerCase();
}
function rowThumbnail(row) {
  const raw = SocialStore.plain(row && row.raw);
  return text(
    row && (row.thumbnail_url || row.thumbnailUrl) ||
    raw.thumbnailUrl || raw.thumbnail || raw.thumb || raw.image ||
    raw.channelThumbnailUrl || raw.channel_thumbnail_url || ""
  );
}
function rowSourceUrl(row) {
  return text(row && (row.source_url || row.sourceUrl));
}
function realThumbnail(row) {
  const value = rowThumbnail(row);
  if (!/^https:\/\//i.test(value)) return false;
  if (value === rowSourceUrl(row)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const platform = text(row && row.platform).toLowerCase();
    const pageHosts = {
      facebook: /(^|\.)facebook\.com$/i,
      instagram: /(^|\.)instagram\.com$/i,
      tiktok: /(^|\.)tiktok\.com$/i,
      twitter: /(^|\.)(x|twitter)\.com$/i,
      reddit: /(^|\.)reddit\.com$/i,
      pinterest: /(^|\.)pinterest\.com$/i,
      weibo: /(^|\.)weibo\.(com|cn)$/i,
      wechat: /(^|\.)mp\.weixin\.qq\.com$/i,
    };
    const imagePath = /\.(?:avif|webp|jpe?g|png|gif)(?:$|[?#])/i.test(url.pathname + url.search);
    if (pageHosts[platform] && pageHosts[platform].test(host) && !imagePath) return false;
    if (/(?:^|\.)fbcdn\.net$/i.test(host)) {
      const token = url.searchParams.get("oe");
      if (token && /^[0-9a-f]+$/i.test(token)) {
        const expiry = parseInt(token, 16) * 1000;
        if (Number.isFinite(expiry) && expiry <= Date.now() + 24 * 60 * 60 * 1000) return false;
      }
    }
    return true;
  } catch (_error) { return false; }
}

function eligible(row, route, aiPolicy) {
  const raw = SocialStore.plain(row && row.raw);
  const validation = SocialStore.validateCandidate(row);
  if (!validation.ok)
    return {
      ok: false,
      reason: validation.reasons[0] || "candidate_validation_failed",
    };
  if (
    /^(search_excluded|permanent_blocked|blocked|rejected)$/.test(
      reviewKey(row),
    )
  )
    return { ok: false, reason: "review_status_not_eligible" };
  if (row.public_access !== true || row.login_required === true)
    return { ok: false, reason: "public_channel_required" };
  if (text(row.risk_level) === "blocked")
    return { ok: false, reason: "safety_blocked" };
  const normalizedAI = AIPolicy.normalize(aiPolicy || {});
  if (Number(row.safety_score || 0) < normalizedAI.minSafetyScore)
    return { ok: false, reason: "safety_score_below_ai_policy_minimum" };
  if (Number(row.trust_score || 0) < normalizedAI.minTrustScore)
    return { ok: false, reason: "trust_score_below_ai_policy_minimum" };
  if (raw.channelAsset !== true)
    return { ok: false, reason: "channel_asset_required" };
  if (SocialStore.assetClassOf(row) === "latest_content" && !realThumbnail(row))
    return { ok: false, reason: "usable_thumbnail_required" };
  const aiVerdict = AIPolicy.evaluate(row, normalizedAI);
  if (!aiVerdict.ok) return { ok: false, reason: aiVerdict.reason };
  const scopes = CountryRouting.scopesFrom(row);
  if (
    route.countryCode &&
    scopes.countries.length &&
    !scopes.countries.includes(route.countryCode)
  ) {
    return { ok: false, reason: "country_scope_mismatch" };
  }
  return { ok: true };
}
function rejectionSummary(entries) {
  const out = {};
  entries.forEach((entry) => {
    out[entry.reason] = (out[entry.reason] || 0) + 1;
  });
  return out;
}

exports.handler = async function (event) {
  if (event && event.httpMethod === "OPTIONS")
    return SocialStore.response(204, {});
  try {
    if (!event || event.httpMethod === "GET") {
      return SocialStore.response(200, {
        ok: true,
        version: VERSION,
        mode: "ready",
        engine: "sanmaru_policy_score_channel_selection",
        externalProviderCalls: false,
        snapshotPublication: false,
        maxCandidatePoolPerSection: MAX_PER_SECTION,
      });
    }
    if (event.httpMethod !== "POST")
      return SocialStore.response(405, {
        ok: false,
        version: VERSION,
        error: "method_not_allowed",
      });
    const actor = await actorFor(event);
    const body = SocialStore.parseBody(event);
    const aiPolicy = AIPolicy.normalize(body.aiPolicy || {});
    if (body.confirmAutoCurate !== true && body.confirmAutoCurate !== "true") {
      return SocialStore.response(400, {
        ok: false,
        version: VERSION,
        error: "auto_curate_confirmation_required",
      });
    }
    const requestedSection = SocialStore.Policy.normalizeSectionKey(
      body.sectionKey || body.section || body.targetSection,
    );
    if (
      (body.sectionKey || body.section || body.targetSection) &&
      !SocialStore.Policy.ALLOWED_SECTIONS.has(requestedSection)
    ) {
      return SocialStore.response(400, {
        ok: false,
        version: VERSION,
        error: "invalid_social_section",
        allowedSections: SocialStore.Policy.SECTION_KEYS,
      });
    }
    const route = CountryRouting.resolve(event, body);
    const rows = await SocialStore.selectCandidates(
      "select=*&order=section_key.asc,rotation_score.desc,updated_at.desc&limit=10000",
    );
    const groups = {};
    SocialStore.Policy.SECTION_KEYS.forEach((section) => {
      groups[section] = [];
    });
    const rejected = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const section = text(row && row.section_key);
      if (requestedSection && section !== requestedSection) return;
      if (!groups[section]) return;
      const check = eligible(row, route, aiPolicy);
      if (!check.ok) {
        rejected.push({ id: row && row.id, section, reason: check.reason });
        return;
      }
      groups[section].push(row);
    });

    const now = SocialStore.nowIso();
    const by = SocialStore.compact(
      actor.email || actor.memberId || "admin",
      200,
    );
    const approvedIds = [];
    const bySection = {};
    Object.keys(groups).forEach((section) => {
      const rankRows = (items) =>
        items.slice().sort((a, b) => {
          const av = AIPolicy.evaluate(a, aiPolicy);
          const bv = AIPolicy.evaluate(b, aiPolicy);
          return (SocialStore.rowScore(b) + CountryRouting.matchScore(b, route) + Number(bv.scoreAdjustment || 0)) -
            (SocialStore.rowScore(a) + CountryRouting.matchScore(a, route) + Number(av.scoreAdjustment || 0));
        });
      const influencers = rankRows(
        groups[section].filter(
          (row) => SocialStore.assetClassOf(row) === "influencer_registry",
        ),
      ).slice(0, MAX_PER_SECTION);
      const contents = rankRows(
        groups[section].filter(
          (row) => SocialStore.assetClassOf(row) === "latest_content",
        ),
      ).slice(0, MAX_PER_SECTION);
      const selected = influencers.concat(contents);
      bySection[section] = {
        eligible: groups[section].length,
        influencerRegistry: influencers.length,
        latestContentPool: contents.length,
        registeredCandidatePool: selected.length,
      };
      selected.forEach((row) => approvedIds.push(text(row.id)));
    });

    const patch = {
      review_status: "approved",
      verification_status: "approved_for_snapshot",
      candidate_only: false,
      seed_content: false,
      rotation_eligible: true,
      review_note: "sanmaru_ai_policy_score_auto_curated",
      reviewed_by: by,
      reviewed_at: now,
      approved_at: now,
      updated_by: by,
      updated_at: now,
    };
    let updated = 0;
    for (const group of chunks(approvedIds.filter(Boolean), 100)) {
      const result = await SocialStore.updateCandidates(group, patch);
      updated += Array.isArray(result) ? result.length : group.length;
    }
    const approvedRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => approvedIds.includes(text(row.id)))
      .map((row) => Object.assign({}, row, patch));
    const rotation = SocialStore.selectRotation(approvedRows, {
      limitPerSection: SocialStore.ROTATION_LIMIT_PER_SECTION,
      route,
    });
    const placement = {};
    Object.keys(rotation.counts || {}).forEach((section) => {
      placement[section] = {
        finalSelected: rotation.counts[section].selected || 0,
        replacementWaiting: rotation.counts[section].replacement || 0,
        available: rotation.counts[section].available || 0,
      };
    });
    return SocialStore.response(200, {
      ok: true,
      version: VERSION,
      engine: "sanmaru_policy_score_channel_selection",
      actor: { memberId: actor.memberId || null, email: actor.email || null },
      route,
      requestedSection: requestedSection || null,
      scanned: Array.isArray(rows) ? rows.length : 0,
      autoRegistered: approvedIds.length,
      updated,
      bySection,
      placement,
      rejectedCount: rejected.length,
      rejectedByReason: rejectionSummary(rejected),
      rejectedPreview: rejected.slice(0, 100),
      aiPolicy: {
        applied: !!(body.aiPolicy && typeof body.aiPolicy === "object"),
        scopeType: aiPolicy.scopeType,
        includeTopics: aiPolicy.includeTopics,
        excludeTopics: aiPolicy.excludeTopics
      },
      snapshotPublication: false,
      publicSlotMutation: false,
      manualReplacementOverridesPreserved: true,
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, {
      ok: false,
      version: VERSION,
      error: error.code || "social_candidate_auto_curator_failed",
      message: error.message || String(error),
      snapshotPublication: false,
    });
  }
};
