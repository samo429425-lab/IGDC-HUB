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
  "social-candidate-auto-curator-v1.3.0-active-influencer-ip-preference";
const MAX_PER_SECTION = SocialStore.POOL_MAX_PER_SECTION || 350;
const INFLUENCER_REGISTRY_LIMIT_PER_SECTION = 200;

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
function metric(row, names) {
  const raw = SocialStore.plain(row && row.raw);
  const engagement = SocialStore.plain(row && row.engagement);
  const rawEngagement = SocialStore.plain(raw.engagement);
  for (const name of names || []) {
    const values = [
      row && row[name], engagement[name], rawEngagement[name], raw[name],
      raw.metrics && raw.metrics[name], raw.statistics && raw.statistics[name]
    ];
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return 0;
}
function publishedAtMs(row) {
  const raw = SocialStore.plain(row && row.raw);
  const values = [
    row && row.content_published_at, row && row.contentPublishedAt,
    raw.contentPublishedAt, raw.content_published_at, raw.publishedAt, raw.published_at,
    row && row.updated_at
  ];
  for (const value of values) {
    const ms = Date.parse(text(value));
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}
function logSignal(value, weight) {
  const n = Math.max(0, Number(value) || 0);
  return n > 0 ? Math.log10(n + 1) * weight : 0;
}
function activeInfluenceScore(row) {
  let score = 0;
  score += logSignal(metric(row, ["subscriberCount", "subscribers", "followers", "followerCount"]), 12);
  score += logSignal(metric(row, ["viewCount", "views", "plays", "playCount"]), 7);
  score += logSignal(metric(row, ["likes", "likeCount", "reactions", "reactionCount"]), 9);
  score += logSignal(metric(row, ["recommendations", "recommendCount", "shares", "shareCount"]), 8);
  score += logSignal(metric(row, ["comments", "commentCount"]), 5);
  score += Math.min(24, logSignal(metric(row, ["videoCount", "postCount", "posts", "contentCount"]), 5));
  const ms = publishedAtMs(row);
  if (ms) {
    const ageDays = Math.max(0, (Date.now() - ms) / 86400000);
    if (ageDays <= 3) score += 34;
    else if (ageDays <= 7) score += 28;
    else if (ageDays <= 30) score += 20;
    else if (ageDays <= 90) score += 10;
    else if (ageDays > 180) score -= 18;
  }
  return score;
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
  const aiVerdict = AIPolicy.evaluate(row, normalizedAI);
  if (!aiVerdict.ok) return { ok: false, reason: aiVerdict.reason };
  // Country/IP is a preference weight, not a creator-origin exclusion.
  // CountryRouting.matchScore() below boosts locally preferred rows while
  // same-region/global healthy content stays eligible.
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
      const rankRows = (items, influencerMode) =>
        items.slice().sort((a, b) => {
          const av = AIPolicy.evaluate(a, aiPolicy);
          const bv = AIPolicy.evaluate(b, aiPolicy);
          const aScore =
            SocialStore.rowScore(a) +
            CountryRouting.matchScore(a, route) +
            Number(av.scoreAdjustment || 0) +
            (influencerMode ? activeInfluenceScore(a) : activeInfluenceScore(a) * 0.35);
          const bScore =
            SocialStore.rowScore(b) +
            CountryRouting.matchScore(b, route) +
            Number(bv.scoreAdjustment || 0) +
            (influencerMode ? activeInfluenceScore(b) : activeInfluenceScore(b) * 0.35);
          return bScore - aScore;
        });
      const influencers = rankRows(
        groups[section].filter(
          (row) => SocialStore.assetClassOf(row) === "influencer_registry",
        ),
        true,
      ).slice(0, INFLUENCER_REGISTRY_LIMIT_PER_SECTION);
      const contents = rankRows(
        groups[section].filter(
          (row) => SocialStore.assetClassOf(row) === "latest_content",
        ),
        false,
      ).slice(0, MAX_PER_SECTION);
      const selected = influencers.concat(contents);
      bySection[section] = {
        eligible: groups[section].length,
        influencerRegistry: influencers.length,
        influencerRegistryLimit: INFLUENCER_REGISTRY_LIMIT_PER_SECTION,
        influencerSelection: "active_followers_engagement_recency_quality_ip_preference",
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
