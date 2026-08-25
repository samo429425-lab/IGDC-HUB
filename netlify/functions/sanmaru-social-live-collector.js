"use strict";

/**
 * Public web/Sanmaru discovery -> IGDC Social Hub latest-content collector.
 *
 * This is a thin social-only adapter. It does not modify Sanmaru, SearchBank,
 * Snapshot Engine, sample slots, or public social.snapshot.json. Search hits
 * keep their public channel/profile/group as the creator identity, while the
 * latest public video/post remains the visible candidate and outbound target.
 */
const crypto = require("crypto");
const SocialStore = require("./lib/social-candidate-store.v1");
const Policy = require("./lib/social-candidate-policy.v1");
const ChannelLink = require("./lib/social-channel-link.v1");
const AdminAuth = require("./lib/commerce-candidate-auth.v1");
const MaruSearch = require("./maru-search");
const CandidateGateway = require("./sanmaru-social-candidate-gateway");
const CountryRouting = require("./lib/social-country-routing.v1");
const AIPolicy = require("./lib/social-ai-policy-runtime.v1");

const VERSION = "sanmaru-social-live-collector-v1.10.0-eight-platform-pipeline-continuity";
const DEFAULT_QUERY_PASSES = 1;
const MAX_QUERY_PASSES = 2;
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 12;
const REQUEST_TIMEOUT_MS = 3800;
const PROVIDER_GROUP_COUNT = 3;
const PROVIDER_GROUP_NAMES = Object.freeze([
  "public_directory",
  "configured_search_apis",
  "sanmaru_searchbank"
]);
const CHANNEL_RESOLUTION_TIMEOUT_MS = 1500;
const PUBLIC_METADATA_TIMEOUT_MS = 1500;
const CHANNEL_RESOLUTION_BUDGET_MS = 4200;
const CHANNEL_RESOLUTION_CONCURRENCY = 4;
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

/*
 * Key-free public directory fallback.
 *
 * Wikidata stores public social identifiers for notable people,
 * organisations and communities. These rows are discovery candidates only:
 * they still pass through the existing channel resolver, candidate policy,
 * administrator review and final publish controls.
 */
const PUBLIC_DIRECTORY = Object.freeze({
  youtube: {
    property: "P2397",
    entityKind: "channel",
    url: (value) => "https://www.youtube.com/channel/" + encodeURIComponent(value)
  },
  instagram: {
    property: "P2003",
    entityKind: "profile",
    url: (value) => "https://www.instagram.com/" + encodeURIComponent(String(value).replace(/^@/, "")) + "/"
  },
  tiktok: {
    property: "P7085",
    entityKind: "profile",
    url: (value) => "https://www.tiktok.com/@" + encodeURIComponent(String(value).replace(/^@/, ""))
  },
  facebook: {
    property: "P2013",
    entityKind: "public_page",
    url: (value) => "https://www.facebook.com/" + encodeURIComponent(value)
  },
  wechat: {
    property: "P7650",
    entityKind: "official_account",
    url: (value) => "https://open.weixin.qq.com/qr/code?username=" + encodeURIComponent(value)
  },
  weibo: {
    property: "P3579",
    entityKind: "profile",
    url: (value) => "https://weibo.com/u/" + encodeURIComponent(value)
  },
  pinterest: {
    property: "P3836",
    entityKind: "profile",
    url: (value) => "https://www.pinterest.com/" + encodeURIComponent(String(value).replace(/^@/, "")) + "/"
  },
  reddit: {
    property: "P3984",
    entityKind: "community",
    url: (value) => "https://www.reddit.com/r/" + encodeURIComponent(String(value).replace(/^r\//i, "")) + "/"
  },
  twitter: {
    property: "P2002",
    entityKind: "profile",
    url: (value) => "https://x.com/" + encodeURIComponent(String(value).replace(/^@/, ""))
  }
});

const CONTENT_SITE_FILTERS = Object.freeze({
  youtube: "(site:youtube.com/watch OR site:youtube.com/shorts/ OR site:youtu.be)",
  instagram: "(site:instagram.com/p/ OR site:instagram.com/reel/)",
  tiktok: "site:tiktok.com/@ inurl:/video/",
  facebook: "(site:facebook.com/reel/ OR site:facebook.com/watch OR site:facebook.com/videos/ OR site:facebook.com/posts/)",
  wechat: "site:mp.weixin.qq.com/s",
  weibo: "(site:weibo.com/status/ OR site:m.weibo.cn/detail/)",
  pinterest: "site:pinterest.com/pin/",
  reddit: "site:reddit.com/r/ inurl:/comments/",
  twitter: "(site:x.com/status/ OR site:twitter.com/status/)"
});

const LATEST_QUERY_TERMS = Object.freeze({
  ko: "한국어 최신 영상 새 게시물",
  en: "latest video recent post",
  ja: "日本語 最新動画 新しい投稿",
  zh: "中文 最新视频 最新帖子",
  zht: "繁體中文 最新影片 最新貼文",
  de: "deutsch neuestes Video aktueller Beitrag",
  fr: "français dernière vidéo publication récente",
  es: "español último video publicación reciente",
  pt: "português vídeo mais recente publicação",
  ru: "русский последнее видео новая публикация",
  it: "italiano ultimo video post recente",
  nl: "Nederlands nieuwste video recent bericht",
  sv: "svenska senaste video nytt inlägg",
  pl: "polski najnowszy film nowy wpis",
  tr: "Türkçe en son video yeni gönderi",
  ar: "العربية أحدث فيديو منشور",
  th: "ภาษาไทย วิดีโอล่าสุด โพสต์ล่าสุด",
  vi: "tiếng Việt video mới nhất bài đăng mới",
  bn: "বাংলা সর্বশেষ ভিডিও নতুন পোস্ট",
  fa: "فارسی جدیدترین ویدیو پست",
  hi: "हिन्दी नवीनतम वीडियो नई पोस्ट",
  hu: "magyar legújabb videó friss bejegyzés",
  id: "bahasa Indonesia video terbaru posting terbaru",
  ms: "bahasa Melayu video terkini siaran terbaru",
  sw: "Kiswahili video mpya chapisho jipya",
  ta: "தமிழ் சமீபத்திய காணொளி புதிய பதிவு",
  tl: "Filipino pinakabagong video bagong post",
  uk: "українська останнє відео новий допис",
  ur: "اردو تازہ ترین ویڈیو نئی پوسٹ",
  uz: "o‘zbekcha eng so‘nggi video yangi post"
});

const FRIENDLY_KEY_NAMES = Object.freeze({
  googleKey: [
    "Google Custom Search API Key", "Google Search API Key", "Google API Key",
    "google_custom_search_api_key", "google_api_key"
  ],
  googleCx: [
    "Google Custom Search Engine ID", "Google Programmable Search Engine ID",
    "Google CSE ID", "google_cse_id", "google_cx"
  ],
  youtubeKey: ["YouTube Data API Key", "YouTube API Key", "youtube_api_key"],
  naverId: ["Naver Client ID", "NAVER Client ID", "naver_client_id"],
  naverSecret: ["Naver Client Secret", "NAVER Client Secret", "naver_client_secret"]
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
    row.channelUrl, row.accountUrl, row.profileUrl, row.groupUrl,
    row.url, row.link, row.href, row.openUrl, row.pageUrl, row.sourcePageUrl,
    row.watchUrl, row.videoUrl, row.contextLink,
    payload.url, payload.link, payload.openUrl, payload.pageUrl, payload.watchUrl,
    preview.pageUrl, preview.videoUrl
  ].map(Policy.normalizeUrl).filter(Boolean);
}
function contentKind(platform, value) {
  const normalized = Policy.normalizeUrl(value);
  if (!normalized || Policy.platformFromHost(normalized) !== platform) return "";
  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+/g, "/");
    if (platform === "youtube") {
      if (/youtu\.be$/i.test(url.hostname) && /^\/[^/]+/.test(path)) return "latest_video";
      if (/^\/watch/i.test(path) && url.searchParams.get("v")) return "latest_video";
      if (/^\/(shorts|live|embed)\/[^/]+/i.test(path)) return "latest_video";
    }
    if (platform === "instagram" && /^\/(p|reel|tv)\/[^/]+/i.test(path)) return "latest_post";
    if (platform === "tiktok" && /^\/@[^/]+\/video\/[^/]+/i.test(path)) return "latest_video";
    if (platform === "facebook" && (/^\/(reel|watch|videos|posts)\//i.test(path) || /\/(videos|posts)\/[^/]+/i.test(path) || /\/permalink\.php$/i.test(path))) return "latest_post";
    if (platform === "wechat" && (/^\/s(?:\/|$)/i.test(path) || url.searchParams.get("__biz"))) return "latest_post";
    if (platform === "weibo" && (/^\/(status|detail|tv\/show)\//i.test(path) || /^\/\d+\/[a-z0-9]+/i.test(path))) return "latest_post";
    if (platform === "pinterest" && /^\/pin\/[^/]+/i.test(path)) return "latest_post";
    if (platform === "reddit" && /\/comments\/[^/]+/i.test(path)) return "latest_post";
    if (platform === "twitter" && /\/status\/[^/]+/i.test(path)) return "latest_post";
  } catch (_error) {}
  return "";
}
function channelIdFromItem(item) {
  const direct = SocialStore.text(item && item.channelId);
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(direct)) return direct;
  for (const value of candidateUrls(item)) {
    try {
      const match = new URL(value).pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{20,})/i);
      if (match) return match[1];
    } catch (_error) {}
  }
  return "";
}
function syntheticTitle(value) {
  const title = SocialStore.text(value);
  return !title || /^\[[^\]]+\].*(검색|공개 게시물|공개 글|공개 영상)/i.test(title) || /(검색 결과|search results?)$/i.test(title);
}
function categoryFromQuery(platform, queryText) {
  const policy = Policy.PLATFORM_POLICIES[platform] || {};
  const query = SocialStore.text(queryText).toLowerCase();
  const matched = (policy.categories || []).find((category) => query.includes(String(category).toLowerCase()));
  if (matched) return matched;
  if (/(travel|tour|trip|관광|여행)/i.test(query)) return "travel";
  if (/(music|artist|performance|음악|공연)/i.test(query)) return "music";
  if (/(education|learning|tutorial|교육|학습)/i.test(query)) return "education";
  if (/(art|design|gallery|미술|디자인)/i.test(query)) return "art";
  if (/(technology|tech|기술)/i.test(query)) return "technology";
  return "creator";
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
function flattenKeyValues(value, output) {
  const out = output || {};
  if (!value || typeof value !== "object") return out;
  Object.entries(value).forEach(([key, item]) => {
    if (item && typeof item === "object") flattenKeyValues(item, out);
    else if (typeof item === "string" || typeof item === "number") out[key] = String(item).trim();
  });
  return out;
}
function looseJsonPairs(value) {
  const out = {};
  const raw = SocialStore.text(value);
  const pattern = /"([^"\\]{2,100})"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match;
  while ((match = pattern.exec(raw))) {
    try { out[match[1]] = JSON.parse('"' + match[2] + '"'); } catch (_error) { out[match[1]] = match[2]; }
  }
  return out;
}
function envJson() {
  const raw = SocialStore.text(process.env.MARU_API_KEYS_JSON || process.env.API_KEYS_JSON || process.env.IGDC_API_KEYS_JSON);
  if (!raw) return { present: false, valid: true, recovered: false, values: {} };
  let decoded = raw;
  try {
    if (/^eyJ|^ewog|^[A-Za-z0-9+/=]{80,}$/i.test(raw)) decoded = Buffer.from(raw, "base64").toString("utf8");
  } catch (_error) { decoded = raw; }
  try {
    const values = JSON.parse(decoded);
    return { present: true, valid: !!(values && typeof values === "object"), recovered: false, values: flattenKeyValues(values) };
  } catch (_error) {
    const values = looseJsonPairs(decoded);
    return { present: true, valid: false, recovered: Object.keys(values).length > 0, values };
  }
}
function keyValue(names, aliases, values) {
  for (const name of names || []) {
    const value = SocialStore.text(process.env[name] || values[name]);
    if (value) return value;
  }
  const aliasesLower = new Set((aliases || []).map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(values || {})) {
    if (aliasesLower.has(name.toLowerCase()) && SocialStore.text(value)) return SocialStore.text(value);
  }
  return "";
}
function providerConfig() {
  const bundle = envJson();
  const values = bundle.values || {};
  const googleKey = keyValue(
    ["GOOGLE_API_KEY", "GOOGLE_SEARCH_API_KEY", "GOOGLE_CUSTOM_SEARCH_API_KEY", "GOOGLE_CLOUD_API_KEY"],
    FRIENDLY_KEY_NAMES.googleKey, values
  );
  const googleCx = keyValue(
    ["GOOGLE_CSE_ID", "GOOGLE_CX", "GOOGLE_SEARCH_ENGINE_ID", "GOOGLE_CUSTOM_SEARCH_ENGINE_ID", "GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID"],
    FRIENDLY_KEY_NAMES.googleCx, values
  );
  const youtubeKey = keyValue(
    ["YOUTUBE_API_KEY", "GOOGLE_YOUTUBE_API_KEY"], FRIENDLY_KEY_NAMES.youtubeKey, values
  ) || googleKey;
  const naverId = keyValue(
    ["NAVER_API_KEY", "NAVER_CLIENT_ID", "NAVER_SEARCH_CLIENT_ID", "NAVER_OPENAPI_CLIENT_ID"],
    FRIENDLY_KEY_NAMES.naverId, values
  );
  const naverSecret = keyValue(
    ["NAVER_CLIENT_SECRET", "NAVER_API_SECRET", "NAVER_SEARCH_CLIENT_SECRET", "NAVER_OPENAPI_CLIENT_SECRET"],
    FRIENDLY_KEY_NAMES.naverSecret, values
  );
  return { bundle, googleKey, googleCx, youtubeKey, naverId, naverSecret };
}
function providerReadiness(configValue) {
  const cfg = configValue || providerConfig();
  const bundle = cfg.bundle;
  return {
    apiKeyBundle: {
      configured: bundle.present,
      validJson: bundle.valid,
      recoveredKeyNames: bundle.recovered,
      note: bundle.present && !bundle.valid
        ? (bundle.recovered ? "JSON 문법 오류가 있지만 키 이름·문자열 값은 임시 복구했습니다. 배포 환경변수에는 정상 JSON 사용을 권장합니다." : "API 키 묶음 JSON 문법 오류로 값을 읽지 못했습니다.")
        : "비밀 키 값은 응답에 포함하지 않습니다."
    },
    googleCustomSearch: {
      ready: !!(cfg.googleKey && cfg.googleCx),
      googleApiKeyConfigured: !!cfg.googleKey,
      cseIdConfigured: !!cfg.googleCx,
      role: "Instagram·TikTok·Facebook·WeChat·Weibo·Pinterest·Reddit·X 공개 최신 게시물 검색"
    },
    youtubeDataApi: {
      ready: !!cfg.youtubeKey,
      apiKeyConfigured: !!cfg.youtubeKey,
      role: "국가·언어별 YouTube 채널 검색 후 공개 RSS로 최신 영상 확인"
    },
    naverSearch: {
      ready: !!(cfg.naverId && cfg.naverSecret),
      clientIdConfigured: !!cfg.naverId,
      clientSecretConfigured: !!cfg.naverSecret,
      role: "한국어 최신 공개 영상·게시물 검색 보조"
    },
    publicSocialDirectory: {
      ready: true,
      apiKeyRequired: false,
      provider: "Wikidata Query Service",
      role: "API 키 없이 공개 등록된 크리에이터를 찾고, YouTube는 공개 RSS로 최신 영상 확인"
    },
    searchBankImport: { ready: true, role: "SearchBank의 실제 최신 SNS 영상·게시물 주소를 후보로 반입" },
    countryLanguageRouting: { ready: true, role: "국가 단위와 언어 우선순위 적용; 원 IP는 저장하지 않음" },
    directPublicUrlIntake: { ready: true, role: "키 없이 관리자가 공개 최신 영상·게시물 URL을 후보로 반입" },
    channelPromotion: { ready: true, role: "운영 채널은 내부 식별자로 보존하고 최신 영상·게시물을 표시·클릭 대상으로 유지" },
    collectionCanRun: true,
    keyFreeAutomaticDiscovery: true,
    requirements: [
      { key: "필수 키 없음", neededFor: "공개 디렉터리의 YouTube 크리에이터별 최신 영상 RSS 수집", cost: "무료 공개 데이터; 관리자 검증 후 사용" },
      { key: "GOOGLE_API_KEY + GOOGLE_CSE_ID", neededFor: "8개 비YouTube 플랫폼의 최신 공개 게시물 발견", cost: "Google 무료 할당량 및 서비스 약관 범위" },
      { key: "YOUTUBE_API_KEY", neededFor: "국가·언어별 YouTube 크리에이터 직접 검색", cost: "Google Cloud에서 YouTube Data API v3 활성화" },
      { key: "NAVER_CLIENT_ID + NAVER_CLIENT_SECRET", neededFor: "한국어 최신 공개 영상·게시물 검색 보조", cost: "Naver Developers 애플리케이션 등록" },
      { key: "공개 최신 콘텐츠 URL 직접 반입", neededFor: "키가 없거나 검색 API가 제한된 플랫폼의 후보 확보", cost: "무료; 관리자 공개성·안전성 검토 필요" }
    ]
  };
}
async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1500, Number(timeoutMs || REQUEST_TIMEOUT_MS)));
  try {
    const response = await fetch(url, Object.assign({}, init || {}, { signal: controller.signal }));
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_error) { data = {}; }
    if (!response.ok) {
      const error = new Error(firstText([data && data.error && data.error.message, data && data.message, raw, "HTTP " + response.status]));
      error.statusCode = response.status;
      throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}
async function fetchText(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || REQUEST_TIMEOUT_MS)));
  try {
    const response = await fetch(url, Object.assign({}, init || {}, { signal: controller.signal }));
    const raw = await response.text();
    if (!response.ok) {
      const error = new Error(raw || "HTTP " + response.status);
      error.statusCode = response.status;
      throw error;
    }
    return raw;
  } finally { clearTimeout(timer); }
}
async function withDeadline(promise, timeoutMs, fallback) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve(typeof fallback === "function" ? fallback() : fallback),
          Math.max(500, Number(timeoutMs) || REQUEST_TIMEOUT_MS)
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function stripHtml(value) {
  return decodeXml(
    SocialStore.text(value).replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}
function pageMapValue(page, names) {
  const source = page && typeof page === "object" ? page : {};
  for (const group of Object.values(source)) {
    for (const row of Array.isArray(group) ? group : []) {
      for (const name of names || []) {
        const value = firstText([
          row && row[name],
          row && row[name.toLowerCase()],
          row && row[name.toUpperCase()]
        ]);
        if (value) return value;
      }
    }
  }
  return "";
}
function countryQueryTerm(route) {
  const code = SocialStore.text(route && route.countryCode).toUpperCase();
  if (!code) return "";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (_error) { return code; }
}
function languageQueryTerm(route) {
  const languages = CountryRouting.normalizeLanguages(route && route.languages);
  const primary = languages[0] || "en";
  return LATEST_QUERY_TERMS[primary] || LATEST_QUERY_TERMS.en;
}
function scopedQueries(plan, cursor, passes, route) {
  const base = plan.policy.collectionQueries || [];
  const offset = Math.max(0, Number(cursor || 0) || 0);
  const count = Math.max(1, Math.min(MAX_QUERY_PASSES, Number(passes || DEFAULT_QUERY_PASSES) || DEFAULT_QUERY_PASSES));
  const queries = [];
  for (let index = 0; index < count; index += 1) {
    const baseQuery = base[(offset + index) % base.length] || (plan.platform + " useful creator");
    queries.push([baseQuery, countryQueryTerm(route), languageQueryTerm(route)].filter(Boolean).join(" "));
  }
  return Array.from(new Set(queries));
}
function registryRowActive(row) {
  const status = SocialStore.text(row && (row.review_status || row.reviewStatus)).toLowerCase();
  return !/^(search_excluded|permanent_blocked|blocked|rejected)$/.test(status);
}
function registryChannelUrl(row) {
  const raw = row && row.raw && typeof row.raw === "object" ? row.raw : {};
  return Policy.normalizeUrl(
    raw.channelUrl || raw.channel_url || row && (row.channel_url || row.channelUrl) ||
      row && (row.source_url || row.sourceUrl) || ""
  );
}
function registryHandleFromUrl(value, platform) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (platform === "reddit") {
      const index = parts.findIndex((part) => String(part).toLowerCase() === "r");
      if (index >= 0 && parts[index + 1]) return "r/" + parts[index + 1];
    }
    if (platform === "youtube") {
      const token = parts.find((part) => /^@/.test(part));
      return token || "";
    }
    const token = parts.find((part) =>
      part && !/^(u|user|users|profile|people|channel|official)$/i.test(part)
    );
    return token ? decodeURIComponent(token) : "";
  } catch (_error) { return ""; }
}
function registryIdentity(row, platform) {
  const raw = row && row.raw && typeof row.raw === "object" ? row.raw : {};
  const url = registryChannelUrl(row);
  const title = firstText([
    row && (row.creator_name || row.creatorName),
    raw.creatorName,
    row && row.title,
    raw.title,
  ]).replace(/^(false|null|undefined)$/i, "");
  const handle = registryHandleFromUrl(url, platform).replace(/^@/, "");
  const thumbnail = firstText([
    row && (row.thumbnail_url || row.thumbnailUrl),
    raw.channelThumbnailUrl,
    raw.channel_thumbnail_url,
    raw.thumbnailUrl,
    raw.thumbnail,
    raw.image,
  ]);
  return { row, url, title, handle, thumbnail };
}
async function influencerRegistrySeeds(sectionKey, platform) {
  try {
    const rows = await SocialStore.selectCandidates(
      "select=*&section_key=eq." + encodeURIComponent(sectionKey) +
        "&order=rotation_score.desc,updated_at.desc&limit=350",
    );
    const seen = new Set();
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => SocialStore.assetClassOf(row) === "influencer_registry" && registryRowActive(row))
      .map((row) => registryIdentity(row, platform))
      .filter((seed) => {
        const key = String(seed.url || (seed.title + "|" + seed.handle)).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return !!(seed.url || seed.title || seed.handle);
      });
  } catch (_error) { return []; }
}
function registryLatestQuery(seed, route) {
  if (!seed) return "";
  const identity = [
    seed.handle ? '"' + seed.handle.replace(/"/g, "") + '"' : "",
    seed.title ? '"' + seed.title.replace(/"/g, "") + '"' : "",
  ].filter(Boolean).join(" ");
  return [identity, languageQueryTerm(route), "latest recent public"].filter(Boolean).join(" ");
}
function scopedQueriesWithRegistry(plan, cursor, passes, route, registrySeeds) {
  const seeds = Array.isArray(registrySeeds) ? registrySeeds : [];
  if (!seeds.length) {
    return { queries: scopedQueries(plan, cursor, passes, route), targeted: false, seed: null, seedByQuery: {} };
  }
  const offset = Math.max(0, Number(cursor || 0) || 0);
  const count = Math.max(1, Math.min(MAX_QUERY_PASSES, Number(passes || DEFAULT_QUERY_PASSES) || DEFAULT_QUERY_PASSES));
  const queries = [];
  const seedByQuery = {};
  let selectedSeed = null;
  for (let index = 0; index < count; index += 1) {
    const seed = seeds[(offset + index) % seeds.length];
    if (!selectedSeed) selectedSeed = seed;
    const q = registryLatestQuery(seed, route);
    if (q) {
      queries.push(q);
      if (!seedByQuery[q]) seedByQuery[q] = seed;
    }
  }
  const finalQueries = Array.from(new Set(queries.length ? queries : scopedQueries(plan, cursor, passes, route)));
  return {
    queries: finalQueries,
    targeted: queries.length > 0,
    seed: selectedSeed,
    seedByQuery,
  };
}

function sparqlLiteral(value) {
  return '"' + String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ") + '"';
}
function publicDirectoryQuery(plan, route, limit, offset, countryStrict) {
  const directory = PUBLIC_DIRECTORY[plan.platform];
  const countryCode = SocialStore.text(route && route.countryCode).toUpperCase();
  const countryFilter = countryStrict && countryCode
    ? [
        "?country wdt:P297 " + sparqlLiteral(countryCode) + " .",
        "{ ?item wdt:P27 ?country . } UNION",
        "{ ?item wdt:P17 ?country . } UNION",
        "{ ?item wdt:P495 ?country . }"
      ].join("\n")
    : "";
  return [
    "SELECT DISTINCT ?item ?itemLabel ?itemDescription ?account ?image ?sitelinks WHERE {",
    "  ?item wdt:" + directory.property + " ?account .",
    countryFilter ? "  " + countryFilter.replace(/\n/g, "\n  ") : "",
    "  OPTIONAL { ?item wdt:P18 ?image . }",
    "  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "ko,en,[AUTO_LANGUAGE]" . }',
    "}",
    "ORDER BY DESC(?sitelinks)",
    "LIMIT " + Math.max(1, Math.min(MAX_BATCH_SIZE, Number(limit) || DEFAULT_BATCH_SIZE)),
    "OFFSET " + Math.max(0, Number(offset) || 0)
  ].filter(Boolean).join("\n");
}
function bindingValue(binding, key) {
  return SocialStore.text(binding && binding[key] && binding[key].value);
}
function commonsHttps(value) {
  const clean = SocialStore.text(value);
  return /^http:\/\//i.test(clean) ? "https://" + clean.slice(7) : clean;
}
async function publicDirectoryRequest(plan, route, limit, offset, countryStrict) {
  const directory = PUBLIC_DIRECTORY[plan.platform];
  if (!directory) return { provider: "wikidata-public-social-directory", status: "unsupported_platform", items: [] };
  const query = publicDirectoryQuery(plan, route, limit, offset, countryStrict);
  const params = new URLSearchParams({ query, format: "json" });
  try {
    const data = await fetchJson(WIKIDATA_ENDPOINT + "?" + params.toString(), {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "IGDC-MARU-SocialHub/1.0 (public-channel-candidate-discovery)"
      }
    }, REQUEST_TIMEOUT_MS);
    const bindings = data && data.results && Array.isArray(data.results.bindings) ? data.results.bindings : [];
    const items = bindings.map((binding) => {
      const account = bindingValue(binding, "account");
      const url = account ? directory.url(account) : "";
      return {
        provider: "wikidata-public-social-directory",
        platform: plan.platform,
        channelId: plan.platform === "youtube" ? account : "",
        channelUrl: url,
        url,
        title: bindingValue(binding, "itemLabel"),
        creatorName: bindingValue(binding, "itemLabel"),
        description: bindingValue(binding, "itemDescription"),
        thumbnail: commonsHttps(bindingValue(binding, "image")),
        channelThumbnail: commonsHttps(bindingValue(binding, "image")),
        entityKind: directory.entityKind,
        publicDirectoryItem: bindingValue(binding, "item"),
        quality: { rank: Number(bindingValue(binding, "sitelinks") || 0) },
        country: countryStrict && route && route.countryCode || ""
      };
    }).filter((item) => item.channelUrl && item.title && !/^Q\d+$/i.test(item.title));
    return {
      provider: "wikidata-public-social-directory",
      status: "ok",
      countryStrict: !!countryStrict,
      offset,
      items
    };
  } catch (error) {
    return {
      provider: "wikidata-public-social-directory",
      status: error.name === "AbortError" ? "timeout" : (error.statusCode === 429 ? "rate_limited" : "error"),
      countryStrict: !!countryStrict,
      offset,
      error: error.message,
      items: []
    };
  }
}
async function publicDirectorySearch(plan, route, limit, offset) {
  const countryStrict = !!SocialStore.text(route && route.countryCode);
  if (!countryStrict) return publicDirectoryRequest(plan, route, limit, offset, false);
  const results = await Promise.all([
    publicDirectoryRequest(plan, route, limit, offset, true),
    publicDirectoryRequest(plan, route, limit, offset, false)
  ]);
  const primary = results[0];
  const globalFallback = results[1];
  if (primary.items.length) return primary;
  globalFallback.countryFallback = true;
  globalFallback.countryPrimaryCount = 0;
  globalFallback.countryPrimaryStatus = primary.status;
  globalFallback.countryPrimaryError = primary.error || null;
  globalFallback.items.forEach((item) => { item.publicDirectoryCountryFallback = true; });
  return globalFallback;
}
function youtubeLanguageCode(route) {
  const primary = CountryRouting.normalizeLanguages(route && route.languages)[0] || "";
  return primary === "zht" ? "zh-TW" : primary;
}
async function youtubeChannelSearch(queryText, limit, cfg, qualitySweep, route) {
  if (!cfg.youtubeKey) return { provider: "youtube-data-api-channel", status: "not_configured", items: [] };
  const params = new URLSearchParams({
    part: "snippet", type: "channel", maxResults: String(Math.min(25, limit)),
    q: queryText, key: cfg.youtubeKey, safeSearch: "strict", order: qualitySweep ? "viewCount" : "relevance"
  });
  const regionCode = SocialStore.text(route && route.countryCode).toUpperCase();
  const relevanceLanguage = youtubeLanguageCode(route);
  if (/^[A-Z]{2}$/.test(regionCode)) params.set("regionCode", regionCode);
  if (relevanceLanguage) params.set("relevanceLanguage", relevanceLanguage);
  try {
    const data = await fetchJson("https://www.googleapis.com/youtube/v3/search?" + params.toString(), {}, 2600);
    const base = (data.items || []).map((row) => ({
      provider: "youtube-data-api-channel",
      platform: "youtube",
      channelUrl: row && row.id && row.id.channelId ? "https://www.youtube.com/channel/" + row.id.channelId : "",
      channelId: row && row.id && row.id.channelId,
      title: row && row.snippet && row.snippet.channelTitle || row && row.snippet && row.snippet.title,
      creatorName: row && row.snippet && row.snippet.channelTitle,
      description: row && row.snippet && row.snippet.description,
      thumbnail: row && row.snippet && row.snippet.thumbnails && (row.snippet.thumbnails.high || row.snippet.thumbnails.medium || row.snippet.thumbnails.default) && (row.snippet.thumbnails.high || row.snippet.thumbnails.medium || row.snippet.thumbnails.default).url,
      channelThumbnail: row && row.snippet && row.snippet.thumbnails && (row.snippet.thumbnails.high || row.snippet.thumbnails.medium || row.snippet.thumbnails.default) && (row.snippet.thumbnails.high || row.snippet.thumbnails.medium || row.snippet.thumbnails.default).url,
      language: row && row.snippet && row.snippet.defaultLanguage,
      entityKind: "channel"
    })).filter((row) => row.channelUrl);
    const ids = base.map((row) => row.channelId).filter(Boolean);
    if (ids.length) {
      try {
        const statsParams = new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key: cfg.youtubeKey });
        const stats = await fetchJson("https://www.googleapis.com/youtube/v3/channels?" + statsParams.toString(), {}, 1200);
        const byId = new Map((stats.items || []).map((row) => [row.id, row]));
        base.forEach((row) => {
          const detail = byId.get(row.channelId);
          if (!detail) return;
          const s = detail.statistics || {};
          row.engagement = { subscriberCount: Number(s.subscriberCount || 0), viewCount: Number(s.viewCount || 0), videoCount: Number(s.videoCount || 0) };
          row.language = row.language || detail.snippet && detail.snippet.defaultLanguage;
          row.country = detail.snippet && detail.snippet.country;
        });
      } catch (_error) { /* Search results remain useful when statistics quota fails. */ }
    }
    return { provider: "youtube-data-api-channel", status: "ok", items: base };
  } catch (error) {
    return { provider: "youtube-data-api-channel", status: error.statusCode === 403 ? "quota_or_api_disabled" : "error", error: error.message, items: [] };
  }
}
async function googleChannelSearch(plan, queryText, limit, start, cfg) {
  if (!cfg.googleKey || !cfg.googleCx) return { provider: "google-cse-channel", status: "not_configured", items: [] };
  const params = new URLSearchParams({
    key: cfg.googleKey, cx: cfg.googleCx,
    q: queryText + " " + CONTENT_SITE_FILTERS[plan.platform],
    num: String(Math.min(10, limit)), start: String(Math.max(1, Math.min(91, start || 1))),
    safe: "active", dateRestrict: "m6"
  });
  try {
    const data = await fetchJson("https://www.googleapis.com/customsearch/v1?" + params.toString(), {}, REQUEST_TIMEOUT_MS);
    const items = (data.items || []).map((row) => {
      const page = row.pagemap || {};
      const thumb = (page.cse_thumbnail && page.cse_thumbnail[0] && page.cse_thumbnail[0].src) ||
        (page.cse_image && page.cse_image[0] && page.cse_image[0].src) ||
        pageMapValue(page, [
          "og:image", "og:image:url", "twitter:image", "twitter:image:src",
          "thumbnailUrl", "thumbnailurl", "image", "contentUrl"
        ]) || "";
      return {
        provider: "google-cse-channel",
        platform: plan.platform,
        url: row.link,
        title: row.title,
        description: row.snippet,
        thumbnail: thumb,
        entityKind: contentKind(plan.platform, row.link) || "content_search_hit"
      };
    });
    return { provider: "google-cse-channel", status: "ok", items };
  } catch (error) {
    return { provider: "google-cse-channel", status: error.statusCode === 403 || error.statusCode === 429 ? "quota_or_api_disabled" : "error", error: error.message, items: [] };
  }
}
async function naverChannelSearch(plan, queryText, limit, start, route, cfg) {
  if (!cfg.naverId || !cfg.naverSecret) return { provider: "naver-web-channel", status: "not_configured", items: [] };
  const langs = route && route.languages || [];
  if (route && route.countryCode && route.countryCode !== "KR" && !langs.includes("ko")) {
    return { provider: "naver-web-channel", status: "route_skipped", items: [] };
  }
  const params = new URLSearchParams({
    // Naver Web Search often returns zero when Google-style site: filters are
    // appended. Search broadly, then the latest-content resolver keeps only
    // the requested platform's real public video/post URLs.
    query: queryText + " " + plan.platform,
    display: String(Math.min(100, limit)), start: String(Math.max(1, Math.min(1000, start || 1))), sort: "date"
  });
  try {
    const data = await fetchJson("https://openapi.naver.com/v1/search/webkr.json?" + params.toString(), {
      headers: { "X-Naver-Client-Id": cfg.naverId, "X-Naver-Client-Secret": cfg.naverSecret }
    }, REQUEST_TIMEOUT_MS);
    return {
      provider: "naver-web-channel",
      status: "ok",
      items: (data.items || []).map((row) => ({
        provider: "naver-web-channel", platform: plan.platform,
        url: row.link, title: stripHtml(row.title), description: stripHtml(row.description),
        entityKind: contentKind(plan.platform, row.link) || "content_search_hit", language: "ko"
      }))
    };
  } catch (error) {
    return { provider: "naver-web-channel", status: error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 429 ? "credential_or_quota_error" : "error", error: error.message, items: [] };
  }
}
async function maruSearchOne(event, plan, queryText, limit, language, start) {
  try {
    const result = await withDeadline(
      MaruSearch.runEngine({
        httpMethod: "GET",
        headers: event && event.headers || {},
        queryStringParameters: {
          action: "search-ui", searchUi: "1", publicSearch: "1", realContentFirst: "1",
          openPipe: "1", external: "1", noAnalytics: "1", noRevenue: "1"
        }
      }, {
        q: queryText + " " + CONTENT_SITE_FILTERS[plan.platform],
        limit, lang: language || null, start: start || 1, deep: false, external: true,
        type: plan.platform === "youtube" ? "video" : "sns",
        sort: "date", freshness: "recent", noAnalytics: true, noRevenue: true
      }),
      REQUEST_TIMEOUT_MS,
      () => ({ __providerTimeout: true })
    );
    if (result && result.__providerTimeout) {
      return { provider: "sanmaru-public-search", status: "timeout", error: "provider_deadline", items: [], trace: [] };
    }
    return {
      provider: "sanmaru-public-search",
      status: "ok",
      source: result && result.source || null,
      items: Array.isArray(result && result.items) ? result.items : [],
      trace: Array.isArray(result && result.meta && result.meta.trace)
        ? result.meta.trace.map((entry) => ({ name: entry && entry.name, status: entry && entry.status, count: Number(entry && entry.count || 0) }))
        : []
    };
  } catch (error) {
    return { provider: "sanmaru-public-search", status: "error", error: error.message, items: [], trace: [] };
  }
}
async function searchOne(event, plan, queryText, limit, language, start, route, cfg, qualitySweep, directoryOffset, providerGroup, registryTargeted) {
  let tasks = [];
  if (providerGroup === 0) {
    tasks = [publicDirectorySearch(plan, route, limit, directoryOffset)];
    // A public-directory row is a creator profile, not a post. When a known
    // registry identity is being targeted, also ask the existing Maru/SearchBank
    // public search in the same pass so keyless deployments can still discover
    // a real latest post/video URL instead of repeatedly rejecting profiles.
    if (registryTargeted || plan.platform !== "youtube") {
      // Non-YouTube sections must never depend on a directory/profile result
      // becoming a post by itself. Always pair the directory pass with the
      // existing public Maru/SearchBank path so a real latest content URL can
      // reach the candidate gateway even when external API keys are absent.
      tasks.push(maruSearchOne(event, plan, queryText, limit, language, start));
    }
  } else if (providerGroup === 1) {
    if (plan.platform === "youtube") {
      tasks.push(youtubeChannelSearch(queryText, limit, cfg, qualitySweep, route));
    }
    tasks.push(googleChannelSearch(plan, queryText, limit, start, cfg));
    tasks.push(naverChannelSearch(plan, queryText, limit, start, route, cfg));
    if (plan.platform !== "youtube") {
      // Configured search APIs are optional. Keep the canonical Maru public
      // search as a same-pass fallback so Instagram/TikTok/Facebook/WeChat/
      // Weibo/Pinterest/Reddit/X do not collapse to zero when keys, quotas or
      // provider metadata are unavailable.
      tasks.push(maruSearchOne(event, plan, queryText, limit, language, start));
    }
  } else {
    tasks = [maruSearchOne(event, plan, queryText, limit, language, start)];
  }
  const settled = await Promise.allSettled(tasks);
  const providers = settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    return {
      provider: "provider-group-" + providerGroup + "-" + index,
      status: "error",
      error: entry.reason && entry.reason.message || String(entry.reason || "provider_failed"),
      items: []
    };
  });
  return {
    query: queryText,
    items: providers.flatMap((result) => result.items || []),
    providers: providers.map((result) => ({
      provider: result.provider, status: result.status, count: (result.items || []).length,
      source: result.source || null, error: result.error || null, trace: result.trace || [],
      countryStrict: result.countryStrict == null ? null : !!result.countryStrict,
      countryFallback: !!result.countryFallback,
      offset: Number(result.offset || 0)
    }))
  };
}
async function youtubeOembed(value) {
  try {
    const data = await fetchJson(
      "https://www.youtube.com/oembed?" + new URLSearchParams({ url: value, format: "json" }).toString(),
      {},
      CHANNEL_RESOLUTION_TIMEOUT_MS
    );
    return {
      ok: !!Policy.normalizeUrl(data.author_url),
      channelUrl: Policy.normalizeUrl(data.author_url),
      title: firstText([data.title]),
      creatorName: firstText([data.author_name]),
      thumbnail: firstText([data.thumbnail_url])
    };
  } catch (_error) { return { ok: false }; }
}
function decodeXml(value) {
  return SocialStore.text(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, function (_m, hex) {
      const code = parseInt(hex, 16);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : _m; } catch (_e) { return _m; }
    })
    .replace(/&#([0-9]+);/g, function (_m, dec) {
      const code = parseInt(dec, 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : _m; } catch (_e) { return _m; }
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp("<" + tag.replace(":", "\\:") + "[^>]*>([\\s\\S]*?)<\\/" + tag.replace(":", "\\:") + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}
function absoluteHttps(value, baseUrl) {
  try {
    const url = new URL(SocialStore.text(value), baseUrl);
    return url.protocol === "https:" ? url.toString() : "";
  } catch (_error) { return ""; }
}
function htmlMetaValue(html, names) {
  const source = String(html || "").slice(0, 1500000);
  for (const name of names || []) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp("<meta[^>]+(?:property|name)=[\"']" + escaped + "[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>", "i"),
      new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']" + escaped + "[\"'][^>]*>", "i")
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) return decodeXml(match[1]);
    }
  }
  return "";
}
async function publicOembed(platform, contentUrl) {
  const endpoints = {
    tiktok: "https://www.tiktok.com/oembed?url=",
    twitter: "https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=",
    reddit: "https://www.reddit.com/oembed?url=",
    pinterest: "https://www.pinterest.com/oembed.json?url="
  };
  const endpoint = endpoints[platform];
  if (!endpoint) return {};
  try {
    const data = await fetchJson(
      endpoint + encodeURIComponent(contentUrl),
      { headers: { Accept: "application/json" } },
      PUBLIC_METADATA_TIMEOUT_MS
    );
    return {
      title: firstText([data.title]),
      creatorName: firstText([data.author_name]),
      channelUrl: Policy.normalizeUrl(data.author_url),
      thumbnail: firstText([
        data.thumbnail_url,
        data.thumbnailUrl,
        data.image,
        data.image_url
      ])
    };
  } catch (_error) { return {}; }
}
async function publicPageMetadata(platform, contentUrl) {
  if (
    !contentUrl ||
    Policy.platformFromHost(contentUrl) !== platform
  ) return {};
  const oembed = await publicOembed(platform, contentUrl);
  if (Policy.normalizeUrl(oembed.thumbnail)) return oembed;
  try {
    const html = await fetchText(
      contentUrl,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (compatible; IGDC-MARU-SocialHub/1.0)"
        }
      },
      PUBLIC_METADATA_TIMEOUT_MS
    );
    const thumbnail = absoluteHttps(
      htmlMetaValue(html, [
        "og:image:secure_url", "og:image", "twitter:image:src",
        "twitter:image", "thumbnail"
      ]),
      contentUrl
    );
    return Object.assign({}, oembed, {
      title: firstText([
        oembed.title,
        htmlMetaValue(html, ["og:title", "twitter:title"])
      ]),
      creatorName: firstText([
        oembed.creatorName,
        htmlMetaValue(html, ["author", "article:author", "og:site_name"])
      ]),
      thumbnail
    });
  } catch (_error) { return oembed; }
}
function signedFacebookThumbnailExpiry(value) {
  try {
    const url = new URL(value);
    if (!/(?:^|\.)fbcdn\.net$/i.test(url.hostname)) return 0;
    const token = url.searchParams.get("oe");
    if (!token || !/^[0-9a-f]+$/i.test(token)) return 0;
    const seconds = parseInt(token, 16);
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  } catch (_error) { return 0; }
}
function usableThumbnail(value, contentUrl, platform) {
  const normalized = Policy.normalizeUrl(value);
  if (!normalized || !/^https:\/\//i.test(normalized)) return "";
  if (contentUrl && normalized === Policy.normalizeUrl(contentUrl)) return "";
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    const platformHosts = {
      facebook: /(^|\.)facebook\.com$/i,
      instagram: /(^|\.)instagram\.com$/i,
      tiktok: /(^|\.)tiktok\.com$/i,
      twitter: /(^|\.)(x|twitter)\.com$/i,
      reddit: /(^|\.)reddit\.com$/i,
      pinterest: /(^|\.)pinterest\.com$/i,
      weibo: /(^|\.)weibo\.(com|cn)$/i,
      wechat: /(^|\.)mp\.weixin\.qq\.com$/i,
    };
    const pageHost = platformHosts[platform];
    const imagePath = /\.(?:avif|webp|jpe?g|png|gif)(?:$|[?#])/i.test(url.pathname + url.search);
    if (pageHost && pageHost.test(host) && !imagePath) return "";
    const expiry = signedFacebookThumbnailExpiry(normalized);
    if (expiry && expiry <= Date.now() + 24 * 60 * 60 * 1000) return "";
    return normalized;
  } catch (_error) { return ""; }
}
async function stablePublicThumbnail(platform, contentUrl, supplied) {
  let thumb = usableThumbnail(supplied, contentUrl, platform);
  if (thumb) return { thumbnail: thumb, metadata: {} };
  const metadata = await publicPageMetadata(platform, contentUrl);
  thumb = usableThumbnail(metadata.thumbnail, contentUrl, platform);
  return { thumbnail: thumb, metadata };
}

async function youtubeLatestFromFeed(channelId) {
  if (!/^UC[a-zA-Z0-9_-]{20,}$/.test(SocialStore.text(channelId))) return { ok: false };
  try {
    const xml = await fetchText(
      "https://www.youtube.com/feeds/videos.xml?channel_id=" + encodeURIComponent(channelId),
      { headers: { Accept: "application/atom+xml, application/xml;q=0.9" } },
      CHANNEL_RESOLUTION_TIMEOUT_MS
    );
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
    const entry = entryMatch && entryMatch[1] || "";
    const videoId = xmlValue(entry, "yt:videoId");
    const title = xmlValue(entry, "title");
    const publishedAt = xmlValue(entry, "published") || xmlValue(entry, "updated");
    const authorMatch = xml.match(/<author>([\s\S]*?)<\/author>/i);
    const creatorName = xmlValue(authorMatch && authorMatch[1], "name");
    const thumbnailMatch = entry.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    if (!videoId || !title) return { ok: false };
    return {
      ok: true,
      channelId,
      channelUrl: "https://www.youtube.com/channel/" + channelId,
      contentUrl: "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId),
      title,
      creatorName,
      thumbnail: thumbnailMatch ? decodeXml(thumbnailMatch[1]) : "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg",
      publishedAt,
      entityKind: "latest_video"
    };
  } catch (_error) { return { ok: false }; }
}
async function resolveChannelAsset(item, platform, registrySeed) {
  const title = firstText([item && item.title, item && item.name, item && item.label]);
  const urls = candidateUrls(item);
  let latestContentUrl = urls.find((url) => contentKind(platform, url)) || "";
  let latest = {};

  // A registry-targeted search already has the approved creator identity.
  // Bind a discovered real latest post/video back to that known channel instead
  // of trying to infer the creator from every platform's post URL shape/title.
  // The searched URL still has to be a genuine content URL on the same platform.
  if (latestContentUrl && registrySeed && registrySeed.url) {
    const seedChannel = ChannelLink.resolve(registrySeed.url, {
      platform,
      title: firstText([registrySeed.title, registrySeed.handle, title]),
    });
    if (seedChannel.ok && seedChannel.channelUrl) {
      seedChannel.latestContentUrl = latestContentUrl;
      seedChannel.latestContentKind = contentKind(platform, latestContentUrl);
      seedChannel.latest = latest;
      seedChannel.registryBound = true;
      seedChannel.enrichment = Object.assign({}, seedChannel.enrichment || {}, {
        creatorName: firstText([registrySeed.title, registrySeed.handle, seedChannel.suggestedTitle]),
        // A registered creator image is a valid continuity fallback when a
        // platform blocks anonymous post-page metadata. The outbound URL still
        // points to the verified latest post/video; only the visual preview
        // falls back to the known creator image instead of dropping the row.
        thumbnail: firstText([registrySeed.thumbnail]),
      });
      return seedChannel;
    }
  }
  if (platform === "youtube" && !latestContentUrl) {
    latest = await youtubeLatestFromFeed(channelIdFromItem(item));
    if (latest.ok) latestContentUrl = latest.contentUrl;
  }
  if (latest.ok && latest.channelUrl) {
    const channel = ChannelLink.resolve(latest.channelUrl, { platform, title: latest.creatorName });
    if (channel.ok && channel.channelUrl) {
      channel.latestContentUrl = latestContentUrl;
      channel.latestContentKind = "latest_video";
      channel.latest = latest;
      return channel;
    }
  }
  const ordered = latestContentUrl
    ? [latestContentUrl].concat(urls.filter((url) => url !== latestContentUrl))
    : urls;
  for (const url of ordered) {
    let resolved = ChannelLink.resolve(url, { platform, title });
    if (resolved.ok && resolved.needsEnrichment === "youtube_oembed_author") {
      const enriched = await youtubeOembed(resolved.evidenceUrl);
      if (enriched.ok) {
        resolved = ChannelLink.resolve(enriched.channelUrl, { platform, title: enriched.title });
        if (resolved.ok) resolved.enrichment = Object.assign({}, enriched, latest);
      }
    }
    if (resolved.ok && resolved.channelUrl) {
      resolved.latestContentUrl = latestContentUrl;
      resolved.latestContentKind = contentKind(platform, latestContentUrl);
      resolved.latest = latest;
      return resolved;
    }
  }
  const hasPlatformUrl = urls.some((url) => Policy.platformFromHost(url) === platform);
  return { ok: false, reason: hasPlatformUrl ? "channel_target_not_resolved" : "platform_host_mismatch" };
}
async function candidateFromItem(item, sectionKey, platform, queryText, route, registrySeed) {
  const resolved = await resolveChannelAsset(item, platform, registrySeed);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  if (!resolved.latestContentUrl || !resolved.latestContentKind) {
    return { ok: false, reason: "latest_public_content_required" };
  }
  const originalTitle = firstText([item && item.title, item && item.name, item && item.label]);
  const enrichment = resolved.enrichment || {};
  const latest = resolved.latest || {};
  const media = item && item.media && typeof item.media === "object" ? item.media : {};
  const mediaPreview = media.preview && typeof media.preview === "object" ? media.preview : {};
  const suppliedThumbnail = firstText([
    latest.thumbnail,
    enrichment.thumbnail,
    item && item.thumbnail,
    item && item.thumb,
    item && item.image,
    item && item.imageUrl,
    item && item.cardImage,
    item && item.poster,
    media.thumbnail,
    media.poster,
    mediaPreview.thumbnail,
    mediaPreview.poster,
    mediaPreview.image
  ]);
  const thumbnailResolution = await stablePublicThumbnail(
    platform,
    resolved.latestContentUrl,
    suppliedThumbnail,
  );
  const publicMetadata = thumbnailResolution.metadata || {};
  const resolvedThumbnail = thumbnailResolution.thumbnail;
  if (!resolvedThumbnail) return { ok: false, reason: "usable_thumbnail_required" };
  const title = firstText([
    latest.title,
    enrichment.title,
    publicMetadata.title,
    resolved.promotedFromContent ? resolved.suggestedTitle : "",
    originalTitle,
    resolved.suggestedTitle
  ]);
  if (syntheticTitle(title)) return { ok: false, reason: "real_content_title_required" };
  const source = item && item.source;
  const creatorName = firstText([
    latest.creatorName, enrichment.creatorName, publicMetadata.creatorName,
    item && item.creatorName, item && item.channelName,
    item && item.channel, item && item.publisher, source && typeof source === "object" && source.name,
    resolved.suggestedTitle
  ]).replace(/^(false|null|undefined)$/i, "") || firstText([resolved.suggestedTitle, title]);
  const routeLanguages = route && route.languages || [];
  const explicitCountry = SocialStore.text(item && item.country).toUpperCase();
  if (route && route.countryCode && explicitCountry && explicitCountry !== route.countryCode) {
    return { ok: false, reason: "country_creator_mismatch" };
  }
  const category = firstText([item && item.category, categoryFromQuery(platform, queryText)]);
  const itemLanguage = CountryRouting.normalizeLanguage(item && (item.lang || item.language));
  const language = itemLanguage && routeLanguages.includes(itemLanguage)
    ? itemLanguage
    : firstText([routeLanguages[0], itemLanguage, "und"]);
  const candidate = {
    assetClass: "latest_content",
    sectionKey,
    platform,
    title: title.slice(0, 240),
    sourceUrl: resolved.latestContentUrl,
    latestContentUrl: resolved.latestContentUrl,
    channelUrl: resolved.channelUrl,
    channelEvidenceUrl: resolved.latestContentUrl,
    sourceContentUrl: resolved.latestContentUrl,
    entityKind: resolved.latestContentKind,
    channelEntityKind: resolved.entityKind,
    channelAsset: true,
    latestContentAsset: true,
    contentPublishedAt: firstText([latest.publishedAt, item && item.publishedAt, item && item.published_at, item && item.pubDate, item && item.date]),
    thumbnailUrl: resolvedThumbnail,
    channelThumbnailUrl: firstText([
      item && item.channelThumbnail,
      item && item.channelThumbnailUrl,
      latest.channelThumbnail
    ]),
    description: firstText([item && item.description, item && item.summary, item && item.snippet]).slice(0, 1200),
    creatorName: creatorName.slice(0, 180),
    language,
    countryScopes: item && item.publicDirectoryCountryFallback
      ? []
      : (route && route.countryCode ? [route.countryCode] : []),
    languageScopes: routeLanguages,
    category,
    publicAccess: true,
    loginRequired: false,
    accessStatus: "public",
    candidateOnly: true,
    verificationStatus: "web_verification_required",
    discoveryQuery: queryText,
    engagement: item && item.engagement || {},
    source: {
      name: itemSourceName(item),
      platform,
      mode: "social_hub_latest_content_discovery"
    },
    bind: { section: sectionKey, psom_key: sectionKey, platform },
    tags: Array.from(new Set([].concat(item && item.tags || [], [platform, category, resolved.latestContentKind, "public", "latest_content", "creator_channel_identified"]))).slice(0, 12),
    quality: { rank: Number(item && (item._finalScore || item.score || item.rank) || 0) }
  };
  const reasons = Policy.validationReasons(candidate);
  if (reasons.length) return { ok: false, reason: reasons[0] };
  const influencer = {
    assetClass: "influencer_registry",
    sectionKey,
    platform,
    title: creatorName.slice(0, 240),
    sourceUrl: resolved.channelUrl,
    channelUrl: resolved.channelUrl,
    channelEvidenceUrl: resolved.latestContentUrl,
    entityKind: resolved.entityKind,
    channelEntityKind: resolved.entityKind,
    channelAsset: true,
    latestContentAsset: false,
    thumbnailUrl: firstText([
      candidate.channelThumbnailUrl,
      item && item.channelThumbnail,
      item && item.channelThumbnailUrl,
      item && item.publicDirectoryItem && item.thumbnail
    ]),
    description: candidate.description,
    creatorName: creatorName.slice(0, 180),
    language,
    countryScopes: candidate.countryScopes,
    languageScopes: routeLanguages,
    category,
    publicAccess: true,
    loginRequired: false,
    accessStatus: "public",
    candidateOnly: true,
    verificationStatus: "web_verification_required",
    discoveryQuery: queryText,
    engagement: candidate.engagement,
    source: {
      name: itemSourceName(item),
      platform,
      mode: "social_hub_influencer_registry_discovery"
    },
    bind: { section: sectionKey, psom_key: sectionKey, platform },
    tags: Array.from(new Set([
      platform, category, resolved.entityKind, "public", "influencer_registry"
    ])).slice(0, 12),
    quality: candidate.quality
  };
  return { ok: true, candidate, influencer };
}
function latestContentPriority(item, platform) {
  return candidateUrls(item).some((url) => contentKind(platform, url)) ? 0 : 1;
}
async function resolveSearchCandidates(searchResults, sectionKey, platform, route, target) {
  const inputs = [];
  (searchResults || []).forEach((result) => {
    (result.items || []).forEach((item) => {
      inputs.push({ item, query: result.query, registrySeed: result.registrySeed || null, order: inputs.length });
    });
  });
  inputs.sort((left, right) =>
    latestContentPriority(left.item, platform) - latestContentPriority(right.item, platform) ||
    left.order - right.order
  );
  const limit = Math.max(target, Math.min(48, target * 4));
  const selectedInputs = inputs.slice(0, limit);
  const converted = new Array(selectedInputs.length);
  const deadline = Date.now() + CHANNEL_RESOLUTION_BUDGET_MS;
  let cursor = 0;
  async function worker() {
    while (cursor < selectedInputs.length && Date.now() < deadline) {
      const index = cursor;
      cursor += 1;
      const input = selectedInputs[index];
      try {
        converted[index] = await candidateFromItem(
          input.item,
          sectionKey,
          platform,
          input.query,
          route,
          input.registrySeed
        );
      } catch (error) {
        converted[index] = {
          ok: false,
          reason: error && error.message || "channel_resolution_failed"
        };
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(CHANNEL_RESOLUTION_CONCURRENCY, selectedInputs.length || 1) },
      worker
    )
  );

  const rejected = [];
  const candidates = [];
  const influencers = [];
  const seenUrls = new Set();
  converted.forEach((result) => {
    if (!result) return;
    if (!result.ok) {
      rejected.push({ reason: result.reason });
      return;
    }
    const key = result.candidate.channelUrl.toLowerCase();
    if (seenUrls.has(key)) {
      rejected.push({ reason: "duplicate_creator_channel" });
      return;
    }
    seenUrls.add(key);
    candidates.push(result.candidate);
    influencers.push(result.influencer);
  });
  return {
    candidates,
    influencers,
    rejected,
    inputRows: inputs.length,
    resolutionRows: converted.filter(Boolean).length,
    deferredRows: Math.max(0, inputs.length - converted.filter(Boolean).length)
  };
}
function gatewayEvent(event, candidates, sectionKey, dryRun, limit, source) {
  return Object.assign({}, event || {}, {
    httpMethod: "POST",
    path: "/.netlify/functions/sanmaru-social-candidate-gateway",
    queryStringParameters: {},
    body: JSON.stringify({ candidates, sectionKey, dryRun, limit, source: source || "social-hub-channel-discovery" })
  });
}
function previewItems(payload) {
  return (payload.items || []).slice(0, 50).map((item) => {
    const raw = item && item.raw || {};
    return {
      id: item && item.id,
      sectionKey: item && (item.section_key || item.sectionKey),
      platform: item && item.platform,
      assetClass: raw.assetClass || item && item.assetClass,
      title: item && item.title,
      sourceUrl: item && (item.source_url || item.sourceUrl),
      latestContentUrl: raw.latestContentUrl || raw.sourceContentUrl || item && (item.source_url || item.sourceUrl),
      channelUrl: raw.channelUrl || item && item.channelUrl,
      contentPublishedAt: raw.contentPublishedAt || item && item.contentPublishedAt,
      thumbnailUrl: item && (item.thumbnail_url || item.thumbnailUrl),
      entityKind: raw.entityKind || item && item.entityKind,
      countryScopes: raw.countryScopes || item && item.countryScopes || []
    };
  });
}
async function intakeCandidates(body, plan, route) {
  // Policy.text intentionally removes control characters, so preserve line
  // breaks here before each individual line is normalized.
  const lines = String(body.rawText || body.urls || body.urlList || "").trim().split(/\r?\n/).slice(0, 500);
  const candidates = [];
  const influencers = [];
  const rejected = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = ChannelLink.parseIntakeLine(lines[index]);
    if (!parsed) continue;
    if (!parsed.ok) { rejected.push({ index: index + 1, reason: parsed.reason }); continue; }
    const converted = await candidateFromItem({
      url: parsed.url,
      title: parsed.title,
      category: parsed.category,
      provider: "admin-public-url-intake"
    }, plan.sectionKey, plan.platform, "admin_public_url_intake", route);
    if (!converted.ok) { rejected.push({ index: index + 1, reason: converted.reason }); continue; }
    const key = converted.candidate.channelUrl.toLowerCase();
    if (seen.has(key)) { rejected.push({ index: index + 1, reason: "duplicate_creator_channel" }); continue; }
    seen.add(key);
    candidates.push(converted.candidate);
    influencers.push(converted.influencer);
  }
  return {
    candidates,
    influencers,
    rejected,
    lineCount: lines.filter((line) => SocialStore.text(line) && !SocialStore.text(line).startsWith("#")).length
  };
}

exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    const cfg = providerConfig();
    if (!event || event.httpMethod === "GET") {
      return SocialStore.response(200, {
        ok: true,
        version: VERSION,
        channelLinkVersion: ChannelLink.VERSION,
        mode: "ready",
        allowedSections: Policy.SECTION_KEYS,
        externalProviderCalls: "POST only after administrator authorization",
        source: "direct provider + existing Maru/Sanmaru public gateway",
        target: "country-language matched creator latest public content through existing social candidate gateway",
        providerReadiness: providerReadiness(cfg),
        publicSnapshotMutation: false,
        searchBankCoreMutation: false,
        sampleSlotMutation: false,
        countryRouting: { version: CountryRouting.VERSION, scope: "country_only", ipStorage: false }
      });
    }
    if (event.httpMethod !== "POST") return SocialStore.response(405, { ok: false, version: VERSION, error: "method_not_allowed" });

    const actor = await requireCollectorActor(event);
    const body = SocialStore.parseBody(event);
    const sectionKey = Policy.normalizeSectionKey(body.sectionKey || body.section || body.targetSection);
    const plan = sectionPlan(sectionKey);
    if (!plan) return SocialStore.response(400, { ok: false, version: VERSION, error: "invalid_social_section", allowedSections: Policy.SECTION_KEYS });

    const dryRun = flag(body.dryRun || body.dry_run);
    const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(body.batchSize || body.batch_size || body.limit || DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));
    const route = CountryRouting.resolve(event, body);
    const aiPolicy = AIPolicy.normalize(body.aiPolicy || {});

    if (/^(intake_channels|intake_urls|direct_intake)$/i.test(SocialStore.text(body.action))) {
      const intake = await intakeCandidates(body, plan, route);
      const selected = intake.candidates.slice(0, 500);
      const submitted = [];
      selected.forEach((candidate, index) => {
        if (intake.influencers[index]) submitted.push(intake.influencers[index]);
        submitted.push(candidate);
      });
      const gatewayResponse = await CandidateGateway.handler(gatewayEvent(
        event,
        submitted,
        sectionKey,
        dryRun,
        submitted.length || 1,
        "admin-public-influencer-and-latest-content-intake"
      ));
      const payload = jsonBody(gatewayResponse);
      payload.itemsPreview = previewItems(payload);
      delete payload.items;
      payload.channelIntake = {
        version: VERSION,
        sectionKey,
        platform: plan.platform,
        route,
        dryRun,
        inputLines: intake.lineCount,
        resolvedLatestContents: intake.candidates.length,
        resolvedInfluencers: intake.influencers.length,
        submittedCandidates: selected.length,
        submittedRecords: submitted.length,
        rejectedRows: intake.rejected.length,
        rejectedByReason: rejectionSummary(intake.rejected),
        rejectedPreview: intake.rejected.slice(0, 50),
        publicSnapshotMutation: false
      };
      return SocialStore.response(gatewayResponse.statusCode || 200, payload);
    }

    const target = batchSize;
    const passes = Math.max(1, Math.min(MAX_QUERY_PASSES, Number(body.queryPasses || body.passes || DEFAULT_QUERY_PASSES) || DEFAULT_QUERY_PASSES));
    const queryCursor = Math.max(0, Number(body.queryCursor || body.cursor || 0) || 0);
    const providerGroup = queryCursor % PROVIDER_GROUP_COUNT;
    const researchCursor = Math.floor(queryCursor / PROVIDER_GROUP_COUNT);
    const qualitySweep = flag(body.qualitySweep || body.quality_sweep);
    // Existing influencer registry is the primary identity source for latest
    // content collection. Generic discovery remains the fallback. This closes
    // the previous gap where hundreds of registered Instagram/TikTok/X/etc.
    // profiles existed but collection searched unrelated generic web results.
    const registrySeeds = await influencerRegistrySeeds(sectionKey, plan.platform);
    const scoped = scopedQueriesWithRegistry(plan, researchCursor, passes, route, registrySeeds);
    const aiQuerySuffix = AIPolicy.querySuffix(aiPolicy);
    const querySeeds = {};
    const queries = scoped.queries.map((query) => {
      var value = qualitySweep ? query + " popular high quality active official" : query;
      value = aiQuerySuffix ? value + " " + aiQuerySuffix : value;
      querySeeds[value] = scoped.seedByQuery && scoped.seedByQuery[query] || null;
      return value;
    });
    const perQueryLimit = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.ceil(target / Math.max(1, queries.length))));
    const baseCatalogSize = Math.max(1, plan.policy.collectionQueries.length);
    const registryCatalogSize = registrySeeds.length ? Math.min(45, registrySeeds.length) : 0;
    const catalogSize = Math.max(baseCatalogSize, registryCatalogSize);
    const searchStart = Math.max(1, Math.min(91, Number(body.searchStart || body.search_start || (Math.floor(researchCursor / catalogSize) * perQueryLimit + 1)) || 1));
    const searchResults = [];
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const queryText = queries[queryIndex];
      const directoryOffset = Math.max(0, (researchCursor + queryIndex) * perQueryLimit);
      const searchResult = await searchOne(
        event, plan, queryText, perQueryLimit,
        body.language || body.lang || route.languages[0],
        searchStart, route, cfg, qualitySweep, directoryOffset, providerGroup, scoped.targeted
      );
      searchResult.registrySeed = querySeeds[queryText] || null;
      searchResults.push(searchResult);
    }

    const resolved = await resolveSearchCandidates(
      searchResults,
      sectionKey,
      plan.platform,
      route,
      target
    );
    const rejected = resolved.rejected;
    const candidates = resolved.candidates;
    const policyAccepted = [];
    candidates.forEach((candidate) => {
      const verdict = AIPolicy.evaluate(candidate, aiPolicy);
      if (verdict.ok) policyAccepted.push(candidate);
      else rejected.push({ id: candidate && candidate.id, reason: verdict.reason });
    });

    const selected = policyAccepted.slice(0, target);
    const submitted = [];
    selected.forEach((candidate, index) => {
      if (resolved.influencers[index]) submitted.push(resolved.influencers[index]);
      submitted.push(candidate);
    });
    const gatewayResponse = await CandidateGateway.handler(
      gatewayEvent(event, submitted, sectionKey, dryRun, submitted.length || 1)
    );
    const payload = jsonBody(gatewayResponse);
    payload.itemsPreview = previewItems(payload);
    delete payload.items;
    payload.liveCollection = {
      version: VERSION,
      channelLinkVersion: ChannelLink.VERSION,
      actor: { mode: actor.mode, email: actor.email || null, memberId: actor.memberId || null },
      sectionKey,
      platform: plan.platform,
      route,
      dryRun,
      target,
      batchSize,
      queryPasses: queries.length,
      queryCatalogSize: catalogSize * PROVIDER_GROUP_COUNT,
      queryCursor,
      researchCursor,
      providerGroup,
      providerGroupName: PROVIDER_GROUP_NAMES[providerGroup],
      providerGroupCount: PROVIDER_GROUP_COUNT,
      searchStart,
      qualitySweep,
      registryTargeted: scoped.targeted,
      registrySeedCount: registrySeeds.length,
      registrySeed: scoped.seed ? {
        title: scoped.seed.title || null,
        handle: scoped.seed.handle || null,
        channelUrl: scoped.seed.url || null,
      } : null,
      aiPolicy: {
        applied: !!(body.aiPolicy && typeof body.aiPolicy === "object"),
        scopeType: aiPolicy.scopeType,
        includeTopics: aiPolicy.includeTopics,
        excludeTopics: aiPolicy.excludeTopics,
        requireThumbnail: aiPolicy.requireThumbnail,
        replaceDeadUrls: aiPolicy.replaceDeadUrls
      },
      queries,
      searchedRows: searchResults.reduce((sum, result) => sum + result.items.length, 0),
      resolutionRows: resolved.resolutionRows,
      resolutionDeferredRows: resolved.deferredRows,
      directCandidates: candidates.length,
      submittedCandidates: selected.length,
      submittedInfluencers: Math.min(selected.length, resolved.influencers.length),
      submittedRecords: submitted.length,
      rejectedRows: rejected.length,
      rejectedByReason: rejectionSummary(rejected),
      providerTrace: searchResults.map((result) => ({ query: result.query, providers: result.providers })),
      nextQueryCursor: queryCursor + 1,
      providerReadiness: providerReadiness(cfg),
      candidateAssetType: "influencer_registry_plus_latest_content",
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
