"use strict";

/**
 * IGDC/MARU Social Candidate Policy v1
 *
 * Server-side policy for Social Network candidate discovery, classification,
 * scoring, and first-stage rejection. This file is intentionally independent
 * from SearchBank core engines: SearchBank remains a broad ledger, and this
 * policy is applied only when copying social candidates into social_candidates.
 */
const VERSION = "social-candidate-policy-v1.6.0-bilibili-douyin-six";
const CountryContentPolicy = require("./social-country-content-policy.v1");

const POOL_TARGET_PER_SECTION = 120;
const POOL_MIN_PER_SECTION = 100;
const POOL_MAX_PER_SECTION = 120;
const ROTATION_LIMIT_PER_SECTION = 100;

const LANGUAGES_30 = Object.freeze([
  "ko", "en", "ja", "zh", "zht", "de", "fr", "es", "pt", "ru",
  "it", "nl", "sv", "pl", "tr", "ar", "th", "vi",
  "bn", "fa", "hi", "hu", "id", "ms", "sw", "ta", "tl", "uk", "ur", "uz"
]);

const SECTION_KEYS = Object.freeze([
  "social-youtube",
  "social-instagram",
  "social-tiktok",
  "social-facebook",
  "social-snapchat",
  "social-bilibili",
  "social-douyin"
]);

const ALLOWED_SECTIONS = new Set(SECTION_KEYS);
const EXCLUDED_SECTIONS = new Set(["social-maru", "rightPanel", "right-panel", "social-rightpanel"]);

const PLATFORM_BY_SECTION = Object.freeze({
  "social-youtube": "youtube",
  "social-instagram": "instagram",
  "social-tiktok": "tiktok",
  "social-facebook": "facebook",
  "social-snapchat": "snapchat",
  "social-bilibili": "bilibili",
  "social-douyin": "douyin"
});

const SECTION_ALIASES = Object.freeze({
  "youtube": "social-youtube", "yt": "social-youtube", "social-youtube": "social-youtube",
  "instagram": "social-instagram", "insta": "social-instagram", "ig": "social-instagram", "social-instagram": "social-instagram",
  "tiktok": "social-tiktok", "tik-tok": "social-tiktok", "social-tiktok": "social-tiktok",
  "facebook": "social-facebook", "fb": "social-facebook", "social-facebook": "social-facebook",
  "snapchat": "social-snapchat", "snap": "social-snapchat", "spotlight": "social-snapchat", "social-snapchat": "social-snapchat",
  "bilibili": "social-bilibili", "bili": "social-bilibili", "social-bilibili": "social-bilibili",
  "douyin": "social-douyin", "dy": "social-douyin", "抖音": "social-douyin", "social-douyin": "social-douyin"
});

const HOST_PLATFORM = Object.freeze({
  "youtube.com": "youtube", "m.youtube.com": "youtube", "youtu.be": "youtube", "youtube-nocookie.com": "youtube",
  "instagram.com": "instagram",
  "tiktok.com": "tiktok", "vm.tiktok.com": "tiktok", "vt.tiktok.com": "tiktok",
  "facebook.com": "facebook", "m.facebook.com": "facebook", "fb.watch": "facebook",
  "snapchat.com": "snapchat", "www.snapchat.com": "snapchat",
  "bilibili.com": "bilibili", "www.bilibili.com": "bilibili", "m.bilibili.com": "bilibili", "space.bilibili.com": "bilibili", "b23.tv": "bilibili",
  "douyin.com": "douyin", "www.douyin.com": "douyin", "v.douyin.com": "douyin", "iesdouyin.com": "douyin"
});

const PLATFORM_POLICIES = Object.freeze({
  youtube: {
    sectionKey: "social-youtube",
    defaultDisplayMode: "link_card_or_official_embed",
    externalMembershipControlled: true,
    premiumBenefitPlatformControlled: true,
    maruMembershipOverridesExternalAds: false,
    publicPreference: "official_embed_or_link_card",
    categories: ["education", "music", "travel", "culture", "art", "technology", "documentary", "creator", "tutorial", "shorts"],
    collectionQueries: [
      "youtube popular music live performance official",
      "youtube trending entertainment performance official",
      "youtube travel tourism culture documentary",
      "youtube local travel food culture creator",
      "youtube education knowledge documentary",
      "youtube science technology tutorial creator",
      "youtube art design museum culture creator",
      "youtube sports lifestyle healthy creator",
      "youtube traditional culture heritage performance",
      "youtube learning shorts useful creator",
      "youtube official artist singer musician channel",
      "youtube high quality documentary creator"
    ]
  },
  instagram: {
    sectionKey: "social-instagram",
    defaultDisplayMode: "link_card",
    publicPreference: "public_profile_or_post_card",
    categories: ["celebrity", "artist", "designer", "travel", "fashion", "brand", "creator", "gallery", "performance"],
    collectionQueries: [
      "instagram popular artist creator reel", "instagram celebrity official reel", "instagram travel tourism creator reel",
      "instagram food culture creator reel", "instagram fashion designer creator", "instagram art gallery museum creator",
      "instagram musician singer performance official", "instagram healthy lifestyle creator", "instagram useful education creator"
    ]
  },
  tiktok: {
    sectionKey: "social-tiktok",
    defaultDisplayMode: "link_card_or_official_embed",
    publicPreference: "public_video_card",
    categories: ["music", "dance", "travel", "lifestyle", "creator", "short_video", "culture", "tutorial"],
    collectionQueries: [
      "tiktok popular music performance creator", "tiktok travel tourism creator", "tiktok food culture creator",
      "tiktok healthy lifestyle creator", "tiktok culture heritage video", "tiktok art design creator",
      "tiktok useful tutorial education short video", "tiktok science technology creator"
    ]
  },
  facebook: {
    sectionKey: "social-facebook",
    defaultDisplayMode: "link_card_or_official_embed",
    publicPreference: "public_creator_post_reel_or_major_issue",
    categories: ["influencer", "creator", "celebrity", "artist", "athlete", "music", "travel", "food", "culture", "lifestyle", "major_issue", "reel", "video"],
    collectionQueries: [
      "facebook popular influencer creator reel public post",
      "facebook artist athlete musician creator public video",
      "facebook travel tourism food culture creator reel",
      "facebook healthy lifestyle useful creator public post",
      "facebook education science technology creator public video",
      "facebook art culture heritage creator reel",
      "facebook major public interest creator discussion",
      "facebook trending creator public video"
    ]
  },
  snapchat: {
    sectionKey: "social-snapchat",
    defaultDisplayMode: "link_card_or_contained_preview",
    publicPreference: "public_spotlight_video_card",
    categories: ["music", "travel", "culture", "food", "education", "art", "nature", "lifestyle", "creator", "short_video"],
    // Discover individual Spotlight posts worldwide. Profiles are supplemental only.
    collectionQueries: [
      "snapchat spotlight music performance", "snapchat spotlight travel places",
      "snapchat spotlight food culture", "snapchat spotlight education tutorial",
      "snapchat spotlight art design", "snapchat spotlight nature outdoor",
      "snapchat spotlight comedy creator", "snapchat spotlight wellness lifestyle"
    ]
  },
  bilibili: {
    sectionKey: "social-bilibili",
    defaultDisplayMode: "link_card_or_official_embed",
    publicPreference: "public_video_or_creator_channel",
    categories: ["music", "travel", "culture", "documentary", "education", "technology", "gaming", "animation", "art", "creator", "video"],
    // Native-search seed terms deliberately stay short and in Chinese.
    // Quality verification is applied after actual video URLs are discovered.
    collectionQueries: [
      "音乐 演出", "旅行 旅游", "科普 教育", "纪录片 文化",
      "艺术 摄影", "游戏 动画", "美食 文化", "自然 生活"
    ]
  },
  douyin: {
    sectionKey: "social-douyin",
    defaultDisplayMode: "link_card_or_contained_preview",
    publicPreference: "public_video_or_note_card",
    categories: ["music", "dance", "travel", "food", "culture", "lifestyle", "creator", "short_video", "education", "art"],
    // Chinese first. English-only creator queries return very little from
    // Douyin's native public search and Chinese regional indices.
    collectionQueries: [
      "音乐 演出", "旅行 景点", "美食 文化", "健康 生活",
      "非遗 传统文化", "艺术 摄影", "教育 科普", "科技 创意"
    ]
  }
});

const HARD_BLOCK_TERMS = Object.freeze([
  "terror", "terrorism", "extremist", "hate speech", "porn", "pornography", "adult extreme", "nsfw",
  "gambling", "casino", "drug", "narcotic", "scam", "fraud", "phishing", "malware", "piracy",
  "graphic violence", "weapon sale", "self harm", "suicide guide", "fake news", "malicious redirect"
]);

const SOFT_RISK_TERMS = Object.freeze([
  "religious conflict", "conspiracy", "breaking controversy", "unverified claim", "graphic conflict footage"
]);

const REVENUE_HINTS = Object.freeze([
  "travel", "tour", "hotel", "education", "course", "tutorial", "music", "concert", "artist", "art", "design",
  "fashion", "beauty", "food", "restaurant", "technology", "creator", "influencer", "brand", "product",
  "shopping", "review", "culture", "museum", "festival", "book", "learning", "camera", "audio", "movie", "gallery"
]);

function text(value) { return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f\u200b\u200c\u200d\ufeff]/g, " ").trim(); }
function compact(value, max) { const v = text(value).replace(/\s+/g, " "); return v.length > (max || 500) ? v.slice(0, max || 500) : v; }
function lowerText(value) { return text(value).toLowerCase(); }
function lowerKey(value) { return lowerText(value).replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, ""); }
function array(value) { return Array.isArray(value) ? value : (value == null ? [] : [value]); }
function plain(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function bool(value) { if (value === true) return true; if (value === false || value == null) return false; return /^(1|true|yes|on)$/i.test(text(value)); }
function clamp(value, min, max) { const n = Number(value); if (!Number.isFinite(n)) return min; return Math.max(min, Math.min(max, n)); }
function hostOf(value) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch (_e) { return ""; } }
function normalizeUrl(value) {
  const raw = text(value);
  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    // Stable content identities, independent of tracking queries. Preserve
    // non-content query parameters for endpoints that require them (YouTube watch).
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/{2,}/g, "/");
    if (host === "snapchat.com" && /^\/spotlight\/[^/]+\/?$/i.test(path)) {
      url.hostname = "www.snapchat.com";
      url.pathname = "/spotlight/" + path.split("/").filter(Boolean)[1];
      url.search = "";
    } else if (host === "bilibili.com" && /^\/video\/(BV[0-9A-Za-z]+|av\d+)\/?$/i.test(path)) {
      url.hostname = "www.bilibili.com";
      url.pathname = "/video/" + path.split("/").filter(Boolean)[1];
      url.search = "";
    } else if (host === "douyin.com" && /^\/(video|note)\/\d+\/?$/i.test(path)) {
      url.hostname = "www.douyin.com";
      url.pathname = path.replace(/\/$/, "");
      url.search = "";
    } else if (host === "instagram.com" && /^\/(reel|p|tv)\/[A-Za-z0-9_-]+\/?$/i.test(path)) {
      url.hostname = "www.instagram.com";
      url.pathname = path.replace(/\/$/, "");
      url.search = "";
    } else if (host === "tiktok.com" && /^\/@[^/]+\/video\/\d+\/?$/i.test(path)) {
      url.hostname = "www.tiktok.com";
      url.pathname = path.replace(/\/$/, "");
      url.search = "";
    }
    return url.toString();
  } catch (_e) { return ""; }
}
function platformFromHost(url) {
  const host = hostOf(url);
  if (!host) return "";
  if (HOST_PLATFORM[host]) return HOST_PLATFORM[host];
  const parts = host.split(".");
  while (parts.length > 2) {
    parts.shift();
    const h = parts.join(".");
    if (HOST_PLATFORM[h]) return HOST_PLATFORM[h];
  }
  return "";
}
function normalizePlatform(value, url) {
  const rawText = lowerText(value);
  const raw = lowerKey(value);
  if (raw === "yt") return "youtube";
  if (raw === "ig" || raw === "insta") return "instagram";
  if (raw === "bili" || rawText === "哔哩哔哩" || rawText === "嗶哩嗶哩" || rawText === "b站") return "bilibili";
  if (raw === "dy" || rawText === "抖音") return "douyin";
  if (Object.prototype.hasOwnProperty.call(PLATFORM_POLICIES, raw)) return raw;
  return platformFromHost(url) || "";
}
function normalizeSectionKey(value, platform, url) {
  const raw = text(value);
  if (EXCLUDED_SECTIONS.has(raw)) return "";
  if (ALLOWED_SECTIONS.has(raw)) return raw;
  const key = lowerKey(raw);
  if (EXCLUDED_SECTIONS.has(key)) return "";
  if (SECTION_ALIASES[key] && ALLOWED_SECTIONS.has(SECTION_ALIASES[key])) return SECTION_ALIASES[key];
  const p = normalizePlatform(platform, url);
  return p && PLATFORM_POLICIES[p] && ALLOWED_SECTIONS.has(PLATFORM_POLICIES[p].sectionKey) ? PLATFORM_POLICIES[p].sectionKey : "";
}
function isBadPlaceholderUrl(url) {
  const raw = lowerText(url);
  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return true;
  if (/example\.com|placehold\.co|placeholder\.|transparent\.gif|coming-soon/i.test(raw)) return true;
  if (/social(?:youtube|instagram|tiktok|facebook|snapchat|bilibili|douyin)\d{3}/i.test(raw)) return true;
  if (/watch\?v=xxxx/i.test(raw)) return true;
  return false;
}
function textCorpus(row) {
  const r = plain(row);
  return [
    r.title, r.name, r.summary, r.description, r.caption, r.category, r.section, r.platform,
    array(r.tags).join(" "), array(r.keywords).join(" "), plain(r.source).name, plain(r.source).platform,
    plain(r.bind).section, plain(r.bind).psom_key
  ].map((v) => Array.isArray(v) ? v.join(" ") : text(v)).join(" ").toLowerCase();
}
function isSeedOrPlaceholder(row) {
  const r = plain(row);
  const corpus = textCorpus(r);
  const id = lowerText(r.id || r.contentId || r.candidateId);
  const title = lowerText(r.title || r.name);
  const source = plain(r.source);
  const ext = plain(r.extension);
  if (source.name && lowerText(source.name) === "seed") return true;
  if (source.platform && lowerText(source.platform) === "placeholder") return true;
  if (plain(ext.placeholder).slot || ext.placeholder === true) return true;
  if (/^ph_/i.test(id)) return true;
  if (title === "loading" || title === "loading…" || title === "right sample") return true;
  if (/seed placeholder|replace with ranked|placeholder/.test(corpus) && /social/.test(corpus)) return true;
  if (/\bseed\b/.test(corpus) && /\bsocial\b/.test(corpus)) return true;
  return false;
}
function includesAny(corpus, terms) { return terms.some((term) => corpus.indexOf(term.toLowerCase()) >= 0); }
function revenueHintCount(row) {
  const corpus = textCorpus(row);
  return REVENUE_HINTS.filter((term) => corpus.indexOf(term.toLowerCase()) >= 0).length;
}
function hardBlocked(row) { return includesAny(textCorpus(row), HARD_BLOCK_TERMS); }
function softRiskCount(row) { return SOFT_RISK_TERMS.filter((term) => textCorpus(row).indexOf(term.toLowerCase()) >= 0).length; }
function numberMetric(row, names) {
  const r = plain(row);
  for (const name of names) {
    const parts = name.split(".");
    let value = r;
    for (const part of parts) value = value && value[part];
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}
function logScore(value, max) { return clamp(Math.log10(Number(value) || 0) / Math.log10(max || 1000000) * 100, 0, 100); }
function maybeYoutubeEmbed(sourceUrl) {
  const url = normalizeUrl(sourceUrl);
  if (!url) return "";
  try {
    const u = new URL(url);
    let id = "";
    if (/youtu\.be$/i.test(u.hostname)) id = u.pathname.replace(/^\/+/, "").split("/")[0];
    else if (/youtube\.com$/i.test(u.hostname) || /m\.youtube\.com$/i.test(u.hostname)) {
      if (u.pathname.indexOf("/watch") === 0) id = u.searchParams.get("v") || "";
      else if (u.pathname.indexOf("/shorts/") === 0 || u.pathname.indexOf("/embed/") === 0) id = u.pathname.split("/").filter(Boolean).pop() || "";
    }
    id = text(id).replace(/[^a-zA-Z0-9_-]/g, "");
    return id ? "https://www.youtube.com/embed/" + id : "";
  } catch (_e) { return ""; }
}
function displayModeFor(platform, embedUrl) {
  const p = PLATFORM_POLICIES[platform];
  if (embedUrl) return "official_embed";
  return p ? p.defaultDisplayMode : "link_card";
}
function scoreCandidate(input, normalized) {
  const row = plain(input);
  const hard = hardBlocked(row);
  const soft = softRiskCount(row);
  const hints = revenueHintCount(row);
  const engagementRaw = numberMetric(row, [
    "engagement.views", "engagement.viewCount", "engagement.likes", "engagement.comments", "engagement.shares",
    "views", "view_count", "likes", "comments", "shares", "watch_time_sec", "dwell_time_sec"
  ]);
  const rank = numberMetric(row, ["quality.rank", "rank", "priority"]);
  let qualityBase = 55;
  if (rank > 0 && rank <= 1) qualityBase = rank * 100;
  else if (rank > 1) qualityBase = 100 - Math.min(90, rank);
  const accessPenalty = normalized.loginRequired ? 18 : (normalized.accessStatus === "unknown" ? 6 : 0);
  const safety = hard ? 5 : clamp(86 - accessPenalty - soft * 12, 0, 100);
  const quality = clamp(qualityBase + Math.min(20, hints * 4), 0, 100);
  const engagement = logScore(engagementRaw, 10000000);
  const revenue = clamp(38 + hints * 9 + (normalized.creatorName || normalized.creatorHandle ? 8 : 0), 0, 100);
  const locale = normalized.language && normalized.language !== "und" ? 66 : 50;
  const trust = normalized.publicAccess ? 66 : 42;
  const riskPenalty = hard ? 90 : (soft * 15 + (normalized.loginRequired ? 16 : 0));
  const rotation = clamp(safety * 0.30 + quality * 0.20 + engagement * 0.14 + revenue * 0.20 + locale * 0.06 + trust * 0.10 - riskPenalty * 0.18, 0, 100);
  return { safety, quality, engagement, revenue, locale, trust, rotation, hard, soft, revenueHintCount: hints };
}
function classifyCandidate(input) {
  const row = plain(input);
  const rawUrl = row.source_url || row.sourceUrl || row.url || row.permalink || row.pageUrl || row.link || row.href || row.accountUrl || row.channelUrl;
  const sourceUrl = normalizeUrl(rawUrl);
  const platform = normalizePlatform(row.platform || row.sourcePlatform || plain(row.source).platform || plain(row.bind).platform || plain(row.extension).platform, sourceUrl);
  const sectionKey = normalizeSectionKey(row.section_key || row.sectionKey || row.section || row.targetSection || plain(row.bind).section || plain(row.bind).psom_key || row.psom_key || row.psomKey || row.category, platform, sourceUrl);
  const requiredPlatform = PLATFORM_BY_SECTION[sectionKey] || "";
  const finalPlatform = requiredPlatform || platform;
  const policy = PLATFORM_POLICIES[finalPlatform] || null;
  const loginRequired = bool(row.loginRequired || row.login_required || row.requiresLogin || row.requires_login);
  const publicAccess = row.publicAccess === false || row.public_access === false ? false : (!!sourceUrl && !loginRequired);
  const accessStatus = loginRequired ? "login_required" : (publicAccess ? "public" : "unknown");
  const embedUrl = normalizeUrl(row.embed_url || row.embedUrl || row.embed || row.iframeUrl) || (finalPlatform === "youtube" ? maybeYoutubeEmbed(sourceUrl) : "");
  const normalized = {
    sectionKey,
    platform: finalPlatform,
    policy,
    sourceUrl,
    embedUrl,
    thumbnailUrl: normalizeUrl(row.thumbnail_url || row.thumbnailUrl || row.thumbnail || row.thumb || row.image || row.imageUrl || row.poster || plain(plain(row.media).preview).poster),
    title: compact(row.title || row.name || row.text || row.label, 240),
    creatorName: compact(row.creatorName || row.creator_name || row.channelName || row.channel || row.publisher || plain(row.producer).name || plain(row.source).name, 180),
    creatorHandle: compact(row.creatorHandle || row.creator_handle || row.handle || row.username || plain(row.account).handle || plain(plain(row.extension).account).handle, 120),
    description: compact(row.description || row.summary || row.caption || "", 1200),
    language: compact(row.language || row.lang || row.locale || "und", 20),
    region: compact(row.region || row.country || plain(row.geo).country || plain(row.geo).region || "", 50),
    loginRequired,
    publicAccess,
    accessStatus,
    seedContent: isSeedOrPlaceholder(row),
    hardBlocked: hardBlocked(row),
    softRiskCount: softRiskCount(row)
  };
  const scores = scoreCandidate(row, normalized);
  return Object.assign(normalized, {
    displayMode: displayModeFor(finalPlatform, embedUrl),
    adControl: "platform_controlled",
    platformAccountDependent: true,
    externalMembershipControlled: true,
    maruMembershipOverridesExternalAds: false,
    premiumBenefitPlatformControlled: true,
    scores,
    riskLevel: scores.hard ? "blocked" : (scores.soft >= 2 ? "medium" : (loginRequired ? "medium" : "low"))
  });
}
function validationReasons(row, normalized) {
  const n = normalized || classifyCandidate(row);
  const reasons = [];
  if (!n.sectionKey || !ALLOWED_SECTIONS.has(n.sectionKey)) reasons.push("section_not_allowed");
  if (!n.platform || !PLATFORM_POLICIES[n.platform]) reasons.push("platform_not_allowed");
  if (n.sectionKey && n.platform && PLATFORM_BY_SECTION[n.sectionKey] && PLATFORM_BY_SECTION[n.sectionKey] !== n.platform) reasons.push("platform_section_mismatch");
  if (!n.title) reasons.push("title_required");
  if (!n.sourceUrl || isBadPlaceholderUrl(n.sourceUrl)) reasons.push("source_url_required");
  if (n.seedContent) reasons.push("seed_or_placeholder_preserved_not_imported");
  if (n.hardBlocked || n.riskLevel === "blocked") reasons.push("safety_blocked");
  return reasons;
}
function buildCollectionPlan(options) {
  const opts = plain(options);
  const countryCode = text(opts.countryCode || opts.country || (opts.route && opts.route.countryCode)).toUpperCase();
  const route = opts.route && typeof opts.route === "object"
    ? opts.route
    : {
        scopeMode: opts.scopeMode,
        countryCode,
        worldRegion: opts.worldRegion || opts.regionId || opts.region,
        languages: opts.languages || opts.lang || opts.language
      };
  const languages = array(opts.languages || opts.lang || opts.language || route.languages || LANGUAGES_30).map(text).filter(Boolean);
  const perSection = clamp(Number(opts.perSection || POOL_TARGET_PER_SECTION), POOL_MIN_PER_SECTION, POOL_MAX_PER_SECTION);
  return {
    version: VERSION,
    purpose: "broad_social_discovery_then_strict_candidate_review",
    poolPolicy: {
      targetPerSection: POOL_TARGET_PER_SECTION,
      minPerSection: POOL_MIN_PER_SECTION,
      maxPerSection: POOL_MAX_PER_SECTION,
      selectedPerSection: perSection,
      publicSlotsPerSection: ROTATION_LIMIT_PER_SECTION
    },
    externalMembershipPolicy: {
      externalMembershipControlled: true,
      maruMembershipOverridesExternalAds: false,
      premiumBenefitPlatformControlled: true,
      adControl: "platform_controlled"
    },
    sections: SECTION_KEYS.map((sectionKey) => {
      const platform = PLATFORM_BY_SECTION[sectionKey];
      const policy = CountryContentPolicy.applyToPlatformPolicy(PLATFORM_POLICIES[platform], route, platform);
      return {
        sectionKey,
        platform,
        poolTarget: perSection,
        publicSlots: ROTATION_LIMIT_PER_SECTION,
        categories: policy.categories,
        publicPreference: policy.publicPreference,
        collectionQueries: policy.collectionQueries,
        languages,
        countryCode: countryCode || null,
        worldRegion: text(route.worldRegion || route.regionId) || null,
        scopeMode: text(route.scopeMode) || null,
        countryContentPolicy: policy.countryContentPolicy
      };
    })
  };
}

module.exports = {
  VERSION,
  POOL_TARGET_PER_SECTION,
  POOL_MIN_PER_SECTION,
  POOL_MAX_PER_SECTION,
  ROTATION_LIMIT_PER_SECTION,
  LANGUAGES_30,
  SECTION_KEYS,
  ALLOWED_SECTIONS,
  EXCLUDED_SECTIONS,
  PLATFORM_BY_SECTION,
  SECTION_ALIASES,
  HOST_PLATFORM,
  PLATFORM_POLICIES,
  HARD_BLOCK_TERMS,
  SOFT_RISK_TERMS,
  REVENUE_HINTS,
  text,
  compact,
  lowerText,
  lowerKey,
  array,
  plain,
  bool,
  clamp,
  hostOf,
  normalizeUrl,
  platformFromHost,
  normalizePlatform,
  normalizeSectionKey,
  isBadPlaceholderUrl,
  isSeedOrPlaceholder,
  scoreCandidate,
  classifyCandidate,
  validationReasons,
  buildCollectionPlan,
  CountryContentPolicy
};
