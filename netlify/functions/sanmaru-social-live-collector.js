"use strict";

/**
 * Sanmaru live public-search -> Social candidate collector.
 *
 * This is a thin operational bridge. It asks the existing Maru/Sanmaru search
 * gateway for public results, keeps only direct platform content/account URLs,
 * and hands those rows to the existing social candidate gateway. It does not
 * modify SearchBank core files or publish social.snapshot.json.
 */
const crypto = require("crypto");
const SocialStore = require("./lib/social-candidate-store.v1");
const Policy = require("./lib/social-candidate-policy.v1");
const AdminAuth = require("./lib/commerce-candidate-auth.v1");
const MaruSearch = require("./maru-search");
const CandidateGateway = require("./sanmaru-social-candidate-gateway");

const VERSION = "sanmaru-social-live-collector-v1.0.0-direct-public-content";
const DEFAULT_QUERY_PASSES = 4;
const MAX_QUERY_PASSES = 6;

const SITE_FILTERS = Object.freeze({
  youtube: "site:youtube.com OR site:youtu.be",
  instagram: "site:instagram.com",
  tiktok: "site:tiktok.com",
  facebook: "site:facebook.com OR site:fb.watch",
  wechat: "site:mp.weixin.qq.com/s",
  weibo: "site:weibo.com OR site:m.weibo.cn",
  pinterest: "site:pinterest.com/pin OR site:pin.it",
  reddit: "site:reddit.com",
  twitter: "site:x.com OR site:twitter.com"
});

const RESERVED_PROFILE_PATHS = Object.freeze({
  youtube: new Set(["feed", "gaming", "music", "premium", "results", "shorts", "watch"]),
  instagram: new Set(["about", "accounts", "developer", "direct", "directory", "explore", "legal", "privacy", "reels", "stories", "web"]),
  tiktok: new Set(["about", "business", "community-guidelines", "discover", "explore", "legal", "login", "search", "tag"]),
  facebook: new Set(["about", "ads", "business", "events", "gaming", "groups", "help", "login", "marketplace", "privacy", "reel", "search", "share", "stories", "watch"]),
  weibo: new Set(["about", "login", "newlogin", "search", "weibo"]),
  pinterest: new Set(["about", "business", "ideas", "login", "search", "settings", "today"]),
  reddit: new Set(["about", "appeals", "best", "hot", "login", "new", "popular", "search", "settings", "submit", "top"]),
  twitter: new Set(["compose", "explore", "hashtag", "home", "i", "intent", "login", "messages", "notifications", "search", "settings", "share", "tos"])
});

function safeEqual(left, right) {
  const a = Buffer.from(SocialStore.text(left));
  const b = Buffer.from(SocialStore.text(right));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function internalAuthorized(event) {
  const expected = SocialStore.text(process.env.SOCIAL_CANDIDATE_SYNC_SECRET || process.env.SANMARU_INTERNAL_TOKEN || process.env.IGDC_INTERNAL_TOKEN);
  if (!expected) return false;
  const headers = event && event.headers || {};
  const received = headers["x-igdc-internal-token"] || headers["X-IGDC-Internal-Token"] || headers["x-sanmaru-token"] || headers["X-Sanmaru-Token"];
  return safeEqual(received, expected);
}
async function requireCollectorActor(event) {
  if (internalAuthorized(event)) return { memberId: "sanmaru-internal", email: "sanmaru-internal", roles: ["social_manager"], mode: "internal" };
  const actor = await AdminAuth.authenticateCommerceAdmin(event);
  SocialStore.requireRole(actor, "write");
  return Object.assign({}, actor, { mode: "admin" });
}
function flag(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(SocialStore.text(value));
}
function jsonBody(response) {
  try { return JSON.parse(response && response.body || "{}"); } catch (_error) { return {}; }
}
function parseUrl(value) {
  const normalized = Policy.normalizeUrl(value);
  if (!normalized) return null;
  try { return new URL(normalized); } catch (_error) { return null; }
}
function firstText(values) {
  for (const value of values || []) {
    const clean = SocialStore.text(value);
    if (clean) return clean;
  }
  return "";
}
function itemSourceName(item) {
  const source = item && item.source;
  return firstText([
    typeof source === "string" ? source : "",
    source && source.name,
    source && source.provider,
    item && item.provider,
    item && item.generatedBy,
    "sanmaru-public-search"
  ]);
}
function candidateUrls(item) {
  const row = item && typeof item === "object" ? item : {};
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const media = row.media && typeof row.media === "object" ? row.media : {};
  const preview = media.preview && typeof media.preview === "object" ? media.preview : {};
  return [
    row.url, row.link, row.href, row.openUrl, row.pageUrl, row.sourcePageUrl,
    row.watchUrl, row.videoUrl, row.contextLink,
    payload.url, payload.link, payload.openUrl, payload.pageUrl, payload.watchUrl,
    preview.pageUrl, preview.videoUrl
  ].map(Policy.normalizeUrl).filter(Boolean);
}
function cleanTracking(url) {
  const parsed = parseUrl(url);
  if (!parsed) return "";
  Array.from(parsed.searchParams.keys()).forEach((key) => {
    if (/^(utm_|gclid$|fbclid$|igshid$|si$|feature$|ref_|ref$)/i.test(key)) parsed.searchParams.delete(key);
  });
  parsed.hash = "";
  return parsed.toString();
}
function pathParts(parsed) {
  return parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
}
function profilePathAllowed(platform, parts) {
  if (parts.length !== 1) return false;
  const first = decodeURIComponent(parts[0]).toLowerCase();
  if (!first || (RESERVED_PROFILE_PATHS[platform] && RESERVED_PROFILE_PATHS[platform].has(first))) return false;
  return /^[a-z0-9._@-]{2,100}$/i.test(first);
}
function directKind(url, platform) {
  const parsed = parseUrl(url);
  if (!parsed || Policy.platformFromHost(parsed.toString()) !== platform) return "";
  const path = parsed.pathname.replace(/\/+/g, "/");
  const parts = pathParts(parsed);
  const query = parsed.searchParams;

  if (platform === "youtube") {
    if (parsed.hostname.replace(/^www\./, "") === "youtu.be" && parts[0]) return "video";
    if (/^\/watch\/?$/i.test(path) && query.get("v")) return "video";
    if (/^\/(shorts|live)\/[a-zA-Z0-9_-]+/i.test(path)) return "video";
    if (/^\/(channel|c|user)\/[^/]+/i.test(path) || /^\/@[^/]+/i.test(path)) return "channel";
    return "";
  }
  if (platform === "instagram") {
    if (/^\/(p|reel|tv)\/[^/]+/i.test(path)) return "post";
    return profilePathAllowed(platform, parts) ? "profile" : "";
  }
  if (platform === "tiktok") {
    if (/^\/@[^/]+\/video\/\d+/i.test(path)) return "video";
    return /^\/@[^/]+\/?$/i.test(path) ? "profile" : "";
  }
  if (platform === "facebook") {
    if (/^\/(reel|watch|videos)\/?/i.test(path) || /\/(posts|videos)\/[^/]+/i.test(path) || /\/permalink\.php$/i.test(path) || /\/story\.php$/i.test(path) || query.get("v")) return "post";
    return profilePathAllowed(platform, parts) ? "page" : "";
  }
  if (platform === "wechat") {
    return /^\/s(?:\/|$)/i.test(path) && (parts.length >= 2 || query.get("__biz") || query.get("mid")) ? "article" : "";
  }
  if (platform === "weibo") {
    if (/^s\.weibo\.com$/i.test(parsed.hostname)) return "";
    if (/^\/detail\/\d+/i.test(path) || /^\/status\/[a-zA-Z0-9]+/i.test(path) || /^\/\d+\/[a-zA-Z0-9]+/i.test(path)) return "post";
    if (/^\/u\/\d+/i.test(path) || profilePathAllowed(platform, parts)) return "profile";
    return "";
  }
  if (platform === "pinterest") {
    if (/^\/pin\/[^/]+/i.test(path) || (parsed.hostname.replace(/^www\./, "") === "pin.it" && parts[0])) return "pin";
    if (parts.length === 2 && !RESERVED_PROFILE_PATHS.pinterest.has(parts[0].toLowerCase()) && parts.every((part) => /^[a-z0-9._-]+$/i.test(part))) return "board";
    return profilePathAllowed(platform, parts) ? "profile" : "";
  }
  if (platform === "reddit") {
    if (/\/comments\/[a-z0-9]+/i.test(path) || /^\/comments\/[a-z0-9]+/i.test(path)) return "thread";
    if (/^\/r\/[^/]+\/?$/i.test(path)) return "community";
    if (/^\/user\/[^/]+\/?$/i.test(path)) return "profile";
    return "";
  }
  if (platform === "twitter") {
    if (/^\/[^/]+\/status\/\d+/i.test(path) || /^\/i\/web\/status\/\d+/i.test(path)) return "post";
    return profilePathAllowed(platform, parts) ? "profile" : "";
  }
  return "";
}
function syntheticTitle(value) {
  const title = SocialStore.text(value);
  return !title || /^\[[^\]]+\].*(검색|공개 게시물|공개 글|공개 영상)/i.test(title) || /(검색 결과|search results?)$/i.test(title);
}
function candidateFromItem(item, sectionKey, platform, queryText) {
  const urls = candidateUrls(item);
  let sourceUrl = "";
  let contentKind = "";
  for (const url of urls) {
    const kind = directKind(url, platform);
    if (kind) {
      sourceUrl = cleanTracking(url);
      contentKind = kind;
      break;
    }
  }
  if (!sourceUrl) return { ok: false, reason: urls.some((url) => Policy.platformFromHost(url) === platform) ? "not_direct_content_url" : "platform_host_mismatch" };

  const title = firstText([item && item.title, item && item.name, item && item.label]);
  if (syntheticTitle(title)) return { ok: false, reason: "real_title_required" };
  const source = item && item.source;
  const creatorName = firstText([
    item && item.creatorName, item && item.channelName, item && item.channel,
    item && item.publisher, source && typeof source === "object" && source.name
  ]);
  const candidate = {
    sectionKey,
    platform,
    title: title.slice(0, 240),
    sourceUrl,
    thumbnailUrl: firstText([item && item.thumbnail, item && item.thumb, item && item.image, item && item.imageUrl, item && item.cardImage]),
    description: firstText([item && item.description, item && item.summary, item && item.snippet]).slice(0, 1200),
    creatorName: creatorName.slice(0, 180),
    language: firstText([item && item.lang, item && item.language, "und"]),
    publicAccess: true,
    loginRequired: false,
    accessStatus: "public",
    candidateOnly: true,
    verificationStatus: "web_verification_required",
    contentKind,
    discoveryQuery: queryText,
    source: {
      name: itemSourceName(item),
      platform,
      mode: "sanmaru_live_public_search"
    },
    bind: { section: sectionKey, psom_key: sectionKey, platform },
    tags: Array.from(new Set([].concat(item && item.tags || [], [platform, contentKind, "public"]))).slice(0, 12),
    quality: { rank: Number(item && (item._finalScore || item.score || item.rank) || 0) }
  };
  const reasons = Policy.validationReasons(candidate);
  return reasons.length ? { ok: false, reason: reasons[0] } : { ok: true, candidate };
}
function rejectionSummary(entries) {
  const out = {};
  (entries || []).forEach((entry) => {
    const reason = entry && entry.reason || "unknown";
    out[reason] = (out[reason] || 0) + 1;
  });
  return out;
}
function sectionPlan(sectionKey) {
  const platform = Policy.PLATFORM_BY_SECTION[sectionKey];
  const policy = Policy.PLATFORM_POLICIES[platform];
  return platform && policy ? { sectionKey, platform, policy } : null;
}
function scopedQueries(plan, cursor, passes) {
  const base = plan.policy.collectionQueries || [];
  const offset = Math.max(0, Number(cursor || 0) || 0);
  const count = Math.max(1, Math.min(MAX_QUERY_PASSES, Number(passes || DEFAULT_QUERY_PASSES) || DEFAULT_QUERY_PASSES));
  const queries = [];
  for (let index = 0; index < count; index += 1) {
    const baseQuery = base[(offset + index) % base.length] || (plan.platform + " public content");
    queries.push(baseQuery + " " + SITE_FILTERS[plan.platform]);
  }
  return Array.from(new Set(queries));
}
async function searchOne(event, plan, queryText, perQueryLimit, language) {
  const result = await MaruSearch.runEngine({
    httpMethod: "GET",
    headers: event && event.headers || {},
    queryStringParameters: {
      action: "search-ui",
      searchUi: "1",
      publicSearch: "1",
      realContentFirst: "1",
      noAnalytics: "1",
      noRevenue: "1"
    }
  }, {
    q: queryText,
    limit: perQueryLimit,
    lang: language || null,
    deep: true,
    external: true,
    type: plan.platform === "youtube" ? "video" : "sns",
    noAnalytics: true,
    noRevenue: true
  });
  return {
    query: queryText,
    source: result && result.source || null,
    items: Array.isArray(result && result.items) ? result.items : [],
    trace: Array.isArray(result && result.meta && result.meta.trace)
      ? result.meta.trace.map((entry) => ({ name: entry && entry.name, status: entry && entry.status, count: Number(entry && entry.count || 0) }))
      : []
  };
}
function gatewayEvent(event, candidates, sectionKey, dryRun, limit) {
  return Object.assign({}, event || {}, {
    httpMethod: "POST",
    path: "/.netlify/functions/sanmaru-social-candidate-gateway",
    queryStringParameters: {},
    body: JSON.stringify({
      candidates,
      sectionKey,
      dryRun,
      limit,
      source: "sanmaru-live-public-search"
    })
  });
}

exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    if (!event || event.httpMethod === "GET") {
      return SocialStore.response(200, {
        ok: true,
        version: VERSION,
        mode: "ready",
        allowedSections: Policy.SECTION_KEYS,
        externalProviderCalls: "POST only after administrator authorization",
        source: "existing maru-search/Sanmaru public gateway",
        target: "social_candidates through sanmaru-social-candidate-gateway",
        directUrlOnly: true,
        publicSnapshotMutation: false,
        searchBankCoreMutation: false,
        sampleSlotMutation: false
      });
    }
    if (event.httpMethod !== "POST") return SocialStore.response(405, { ok: false, version: VERSION, error: "method_not_allowed" });

    const actor = await requireCollectorActor(event);
    const body = SocialStore.parseBody(event);
    const sectionKey = Policy.normalizeSectionKey(body.sectionKey || body.section || body.targetSection);
    const plan = sectionPlan(sectionKey);
    if (!plan) return SocialStore.response(400, { ok: false, version: VERSION, error: "invalid_social_section", allowedSections: Policy.SECTION_KEYS });

    const dryRun = flag(body.dryRun || body.dry_run);
    const target = Math.max(1, Math.min(300, Number(body.limit || body.target || 100) || 100));
    const passes = Math.max(1, Math.min(MAX_QUERY_PASSES, Number(body.queryPasses || body.passes || DEFAULT_QUERY_PASSES) || DEFAULT_QUERY_PASSES));
    const queries = scopedQueries(plan, body.queryCursor || body.cursor, passes);
    const perQueryLimit = Math.max(25, Math.min(100, Math.ceil(target / queries.length) * 2));
    const searchResults = await Promise.all(queries.map((queryText) => searchOne(event, plan, queryText, perQueryLimit, body.language || body.lang)));

    const rejected = [];
    const candidates = [];
    const seenUrls = new Set();
    searchResults.forEach((result) => {
      result.items.forEach((item) => {
        const converted = candidateFromItem(item, sectionKey, plan.platform, result.query);
        if (!converted.ok) {
          rejected.push({ reason: converted.reason });
          return;
        }
        const key = converted.candidate.sourceUrl.toLowerCase();
        if (seenUrls.has(key)) {
          rejected.push({ reason: "duplicate_source_url" });
          return;
        }
        seenUrls.add(key);
        candidates.push(converted.candidate);
      });
    });

    const selected = candidates.slice(0, target);
    const gatewayResponse = await CandidateGateway.handler(gatewayEvent(event, selected, sectionKey, dryRun, target));
    const payload = jsonBody(gatewayResponse);
    const itemPreview = (payload.items || []).slice(0, 20).map((item) => ({
      id: item && item.id,
      sectionKey: item && (item.section_key || item.sectionKey),
      platform: item && item.platform,
      title: item && item.title,
      sourceUrl: item && (item.source_url || item.sourceUrl)
    }));
    delete payload.items;
    payload.itemsPreview = itemPreview;
    payload.liveCollection = {
      version: VERSION,
      actor: { mode: actor.mode, email: actor.email || null, memberId: actor.memberId || null },
      sectionKey,
      platform: plan.platform,
      dryRun,
      target,
      queryPasses: queries.length,
      queries,
      searchedRows: searchResults.reduce((sum, result) => sum + result.items.length, 0),
      directCandidates: candidates.length,
      submittedCandidates: selected.length,
      rejectedRows: rejected.length,
      rejectedByReason: rejectionSummary(rejected),
      providerTrace: searchResults.map((result) => ({ query: result.query, source: result.source, itemCount: result.items.length, trace: result.trace })),
      nextQueryCursor: (Math.max(0, Number(body.queryCursor || body.cursor || 0) || 0) + queries.length) % Math.max(1, plan.policy.collectionQueries.length),
      directUrlOnly: true,
      publicSnapshotMutation: false,
      searchBankCoreMutation: false,
      sampleSlotMutation: false
    };
    return SocialStore.response(gatewayResponse.statusCode || 200, payload);
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, {
      ok: false,
      version: VERSION,
      error: error.code || "sanmaru_social_live_collection_failed",
      message: error.message || String(error),
      publicSnapshotMutation: false,
      searchBankCoreMutation: false,
      sampleSlotMutation: false
    });
  }
};
