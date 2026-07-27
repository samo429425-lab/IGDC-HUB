"use strict";

/**
 * Public web/Sanmaru discovery -> IGDC Social Hub channel candidate collector.
 *
 * This is a thin social-only adapter. It does not modify Sanmaru, SearchBank,
 * Snapshot Engine, sample slots, or public social.snapshot.json. Search hits
 * are promoted to a public channel/profile/group asset before they enter the
 * existing candidate gateway.
 */
const crypto = require("crypto");
const SocialStore = require("./lib/social-candidate-store.v1");
const Policy = require("./lib/social-candidate-policy.v1");
const ChannelLink = require("./lib/social-channel-link.v1");
const AdminAuth = require("./lib/commerce-candidate-auth.v1");
const MaruSearch = require("./maru-search");
const CandidateGateway = require("./sanmaru-social-candidate-gateway");
const CountryRouting = require("./lib/social-country-routing.v1");

const VERSION = "sanmaru-social-live-collector-v1.4.0-no-key-public-directory";
const DEFAULT_QUERY_PASSES = 1;
const MAX_QUERY_PASSES = 2;
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 12;
const REQUEST_TIMEOUT_MS = 9000;
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

const CHANNEL_SITE_FILTERS = Object.freeze({
  youtube: "(site:youtube.com/@ OR site:youtube.com/channel/ OR site:youtube.com/user/)",
  instagram: "site:instagram.com -inurl:/p/ -inurl:/reel/ -inurl:/stories/",
  tiktok: "site:tiktok.com/@",
  facebook: "(site:facebook.com/groups/ OR site:facebook.com/pages/ OR site:facebook.com)",
  wechat: "site:mp.weixin.qq.com/s",
  weibo: "(site:weibo.com/u/ OR site:weibo.com)",
  pinterest: "site:pinterest.com -inurl:/pin/",
  reddit: "site:reddit.com/r/",
  twitter: "(site:x.com OR site:twitter.com) -inurl:/status/"
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
      role: "Instagram·TikTok·Facebook·WeChat·Weibo·Pinterest·Reddit·X 공개 채널 주소 검색"
    },
    youtubeDataApi: {
      ready: !!cfg.youtubeKey,
      apiKeyConfigured: !!cfg.youtubeKey,
      role: "게시물이 아닌 YouTube 채널(type=channel) 직접 검색 및 공개 통계 확인"
    },
    naverSearch: {
      ready: !!(cfg.naverId && cfg.naverSecret),
      clientIdConfigured: !!cfg.naverId,
      clientSecretConfigured: !!cfg.naverSecret,
      role: "한국어 공개 웹 채널 검색 보조"
    },
    publicSocialDirectory: {
      ready: true,
      apiKeyRequired: false,
      provider: "Wikidata Query Service",
      role: "API 키 없이 공개 등록된 실제 SNS 채널·프로필·커뮤니티 주소 자동 발견"
    },
    searchBankImport: { ready: true, role: "SearchBank의 실제 SNS 주소만 채널 자산으로 승격하여 반입" },
    countryLanguageRouting: { ready: true, role: "국가 단위와 언어 우선순위 적용; 원 IP는 저장하지 않음" },
    directPublicUrlIntake: { ready: true, role: "키 없이 관리자가 공개 채널·프로필·그룹·게시물 URL을 붙여넣어 채널 후보로 변환" },
    channelPromotion: { ready: true, role: "YouTube 영상, TikTok 영상, X 게시물, Reddit 글 등을 운영 채널·프로필·커뮤니티 주소로 승격" },
    collectionCanRun: true,
    keyFreeAutomaticDiscovery: true,
    requirements: [
      { key: "필수 키 없음", neededFor: "공개 디렉터리 기반 9개 SNS 실제 채널 링크 자동 후보 수집", cost: "무료 공개 데이터; 관리자 검증 후 사용" },
      { key: "GOOGLE_API_KEY + GOOGLE_CSE_ID", neededFor: "8개 비YouTube 플랫폼의 공개 채널 자동 발견", cost: "Google 무료 할당량 및 서비스 약관 범위" },
      { key: "YOUTUBE_API_KEY", neededFor: "YouTube 채널 직접 검색", cost: "Google Cloud에서 YouTube Data API v3 활성화" },
      { key: "NAVER_CLIENT_ID + NAVER_CLIENT_SECRET", neededFor: "한국어 공개 웹 검색 보조", cost: "Naver Developers 애플리케이션 등록" },
      { key: "공개 URL 직접 반입", neededFor: "키가 없거나 검색 API가 제한된 플랫폼의 후보 확보", cost: "무료; 관리자 공개성·안전성 검토 필요" }
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
function stripHtml(value) {
  return SocialStore.text(value).replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function countryQueryTerm(route) {
  const code = SocialStore.text(route && route.countryCode).toUpperCase();
  if (!code) return "";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (_error) { return code; }
}
function scopedQueries(plan, cursor, passes, route) {
  const base = plan.policy.collectionQueries || [];
  const offset = Math.max(0, Number(cursor || 0) || 0);
  const count = Math.max(1, Math.min(MAX_QUERY_PASSES, Number(passes || DEFAULT_QUERY_PASSES) || DEFAULT_QUERY_PASSES));
  const queries = [];
  for (let index = 0; index < count; index += 1) {
    const baseQuery = base[(offset + index) % base.length] || (plan.platform + " useful creator channel");
    queries.push([baseQuery, countryQueryTerm(route)].filter(Boolean).join(" "));
  }
  return Array.from(new Set(queries));
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
    }, 12000);
    const bindings = data && data.results && Array.isArray(data.results.bindings) ? data.results.bindings : [];
    const items = bindings.map((binding) => {
      const account = bindingValue(binding, "account");
      const url = account ? directory.url(account) : "";
      return {
        provider: "wikidata-public-social-directory",
        platform: plan.platform,
        channelUrl: url,
        url,
        title: bindingValue(binding, "itemLabel"),
        creatorName: bindingValue(binding, "itemLabel"),
        description: bindingValue(binding, "itemDescription"),
        thumbnail: commonsHttps(bindingValue(binding, "image")),
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
  const primary = await publicDirectoryRequest(plan, route, limit, offset, countryStrict);
  if (primary.items.length || !countryStrict || primary.status !== "ok") return primary;
  const globalFallback = await publicDirectoryRequest(plan, route, limit, offset, false);
  globalFallback.countryFallback = true;
  globalFallback.countryPrimaryCount = 0;
  globalFallback.items.forEach((item) => { item.publicDirectoryCountryFallback = true; });
  return globalFallback;
}
async function youtubeChannelSearch(queryText, limit, cfg, qualitySweep) {
  if (!cfg.youtubeKey) return { provider: "youtube-data-api-channel", status: "not_configured", items: [] };
  const params = new URLSearchParams({
    part: "snippet", type: "channel", maxResults: String(Math.min(25, limit)),
    q: queryText, key: cfg.youtubeKey, safeSearch: "strict", order: qualitySweep ? "viewCount" : "relevance"
  });
  try {
    const data = await fetchJson("https://www.googleapis.com/youtube/v3/search?" + params.toString());
    const base = (data.items || []).map((row) => ({
      provider: "youtube-data-api-channel",
      platform: "youtube",
      channelUrl: row && row.id && row.id.channelId ? "https://www.youtube.com/channel/" + row.id.channelId : "",
      channelId: row && row.id && row.id.channelId,
      title: row && row.snippet && row.snippet.channelTitle || row && row.snippet && row.snippet.title,
      creatorName: row && row.snippet && row.snippet.channelTitle,
      description: row && row.snippet && row.snippet.description,
      thumbnail: row && row.snippet && row.snippet.thumbnails && (row.snippet.thumbnails.high || row.snippet.thumbnails.medium || row.snippet.thumbnails.default) && (row.snippet.thumbnails.high || row.snippet.thumbnails.medium || row.snippet.thumbnails.default).url,
      language: row && row.snippet && row.snippet.defaultLanguage,
      entityKind: "channel"
    })).filter((row) => row.channelUrl);
    const ids = base.map((row) => row.channelId).filter(Boolean);
    if (ids.length) {
      try {
        const statsParams = new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key: cfg.youtubeKey });
        const stats = await fetchJson("https://www.googleapis.com/youtube/v3/channels?" + statsParams.toString());
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
    q: queryText + " " + CHANNEL_SITE_FILTERS[plan.platform],
    num: String(Math.min(10, limit)), start: String(Math.max(1, Math.min(91, start || 1))),
    safe: "active"
  });
  try {
    const data = await fetchJson("https://www.googleapis.com/customsearch/v1?" + params.toString());
    const items = (data.items || []).map((row) => {
      const page = row.pagemap || {};
      const thumb = (page.cse_thumbnail && page.cse_thumbnail[0] && page.cse_thumbnail[0].src) ||
        (page.cse_image && page.cse_image[0] && page.cse_image[0].src) || "";
      return {
        provider: "google-cse-channel",
        platform: plan.platform,
        url: row.link,
        title: row.title,
        description: row.snippet,
        thumbnail: thumb,
        entityKind: "channel_search_hit"
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
    // appended. Search broadly, then the channel resolver keeps only the
    // requested platform's real public channel/profile/group URLs.
    query: queryText + " " + plan.platform,
    display: String(Math.min(100, limit)), start: String(Math.max(1, Math.min(1000, start || 1))), sort: "sim"
  });
  try {
    const data = await fetchJson("https://openapi.naver.com/v1/search/webkr.json?" + params.toString(), {
      headers: { "X-Naver-Client-Id": cfg.naverId, "X-Naver-Client-Secret": cfg.naverSecret }
    });
    return {
      provider: "naver-web-channel",
      status: "ok",
      items: (data.items || []).map((row) => ({
        provider: "naver-web-channel", platform: plan.platform,
        url: row.link, title: stripHtml(row.title), description: stripHtml(row.description),
        entityKind: "channel_search_hit", language: "ko"
      }))
    };
  } catch (error) {
    return { provider: "naver-web-channel", status: error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 429 ? "credential_or_quota_error" : "error", error: error.message, items: [] };
  }
}
async function maruSearchOne(event, plan, queryText, limit, language, start) {
  try {
    const result = await MaruSearch.runEngine({
      httpMethod: "GET",
      headers: event && event.headers || {},
      queryStringParameters: {
        action: "search-ui", searchUi: "1", publicSearch: "1", realContentFirst: "1",
        openPipe: "1", external: "1", noAnalytics: "1", noRevenue: "1"
      }
    }, {
      q: queryText + " " + CHANNEL_SITE_FILTERS[plan.platform],
      limit, lang: language || null, start: start || 1, deep: false, external: true,
      type: plan.platform === "youtube" ? "video" : "sns", noAnalytics: true, noRevenue: true
    });
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
async function searchOne(event, plan, queryText, limit, language, start, route, cfg, qualitySweep, directoryOffset) {
  const providers = [];
  providers.push(await publicDirectorySearch(plan, route, limit, directoryOffset));
  if (plan.platform === "youtube") providers.push(await youtubeChannelSearch(queryText, limit, cfg, qualitySweep));
  providers.push(await googleChannelSearch(plan, queryText, limit, start, cfg));
  providers.push(await naverChannelSearch(plan, queryText, limit, start, route, cfg));
  providers.push(await maruSearchOne(event, plan, queryText, limit, language, start));
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
    const data = await fetchJson("https://www.youtube.com/oembed?" + new URLSearchParams({ url: value, format: "json" }).toString(), {}, 7000);
    return {
      ok: !!Policy.normalizeUrl(data.author_url),
      channelUrl: Policy.normalizeUrl(data.author_url),
      title: firstText([data.author_name, data.title]),
      creatorName: firstText([data.author_name]),
      thumbnail: firstText([data.thumbnail_url])
    };
  } catch (_error) { return { ok: false }; }
}
async function resolveChannelAsset(item, platform) {
  const title = firstText([item && item.title, item && item.name, item && item.label]);
  for (const url of candidateUrls(item)) {
    let resolved = ChannelLink.resolve(url, { platform, title });
    if (resolved.ok && resolved.needsEnrichment === "youtube_oembed_author") {
      const enriched = await youtubeOembed(resolved.evidenceUrl);
      if (enriched.ok) {
        resolved = ChannelLink.resolve(enriched.channelUrl, { platform, title: enriched.title });
        if (resolved.ok) resolved.enrichment = enriched;
      }
    }
    if (resolved.ok && resolved.channelUrl) return resolved;
  }
  const hasPlatformUrl = candidateUrls(item).some((url) => Policy.platformFromHost(url) === platform);
  return { ok: false, reason: hasPlatformUrl ? "channel_target_not_resolved" : "platform_host_mismatch" };
}
async function candidateFromItem(item, sectionKey, platform, queryText, route) {
  const resolved = await resolveChannelAsset(item, platform);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const originalTitle = firstText([item && item.title, item && item.name, item && item.label]);
  const enrichment = resolved.enrichment || {};
  const isDirectEntity = /^(channel|profile|public_group|public_page|community|board)$/.test(SocialStore.text(item && item.entityKind));
  const title = firstText([
    enrichment.title,
    isDirectEntity ? originalTitle : "",
    resolved.promotedFromContent ? resolved.suggestedTitle : "",
    originalTitle,
    resolved.suggestedTitle
  ]);
  if (syntheticTitle(title)) return { ok: false, reason: "real_channel_title_required" };
  const source = item && item.source;
  const creatorName = firstText([
    enrichment.creatorName, item && item.creatorName, item && item.channelName,
    item && item.channel, item && item.publisher, source && typeof source === "object" && source.name,
    title
  ]);
  const routeLanguages = route && route.languages || [];
  const category = firstText([item && item.category, categoryFromQuery(platform, queryText)]);
  const candidate = {
    sectionKey,
    platform,
    title: title.slice(0, 240),
    sourceUrl: resolved.channelUrl,
    channelUrl: resolved.channelUrl,
    channelEvidenceUrl: resolved.evidenceUrl,
    sourceContentUrl: resolved.promotedFromContent ? resolved.evidenceUrl : "",
    entityKind: resolved.entityKind,
    channelAsset: true,
    thumbnailUrl: firstText([enrichment.thumbnail, item && item.thumbnail, item && item.thumb, item && item.image, item && item.imageUrl, item && item.cardImage]),
    description: firstText([item && item.description, item && item.summary, item && item.snippet]).slice(0, 1200),
    creatorName: creatorName.slice(0, 180),
    language: firstText([item && item.lang, item && item.language, routeLanguages[0], "und"]),
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
      mode: "social_hub_channel_discovery"
    },
    bind: { section: sectionKey, psom_key: sectionKey, platform },
    tags: Array.from(new Set([].concat(item && item.tags || [], [platform, category, resolved.entityKind, "public", "channel_asset"]))).slice(0, 12),
    quality: { rank: Number(item && (item._finalScore || item.score || item.rank) || 0) }
  };
  const reasons = Policy.validationReasons(candidate);
  return reasons.length ? { ok: false, reason: reasons[0] } : { ok: true, candidate };
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
      title: item && item.title,
      sourceUrl: item && (item.source_url || item.sourceUrl),
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
    const key = converted.candidate.sourceUrl.toLowerCase();
    if (seen.has(key)) { rejected.push({ index: index + 1, reason: "duplicate_channel_url" }); continue; }
    seen.add(key);
    candidates.push(converted.candidate);
  }
  return { candidates, rejected, lineCount: lines.filter((line) => SocialStore.text(line) && !SocialStore.text(line).startsWith("#")).length };
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
        target: "public channel/profile/group candidates through existing social candidate gateway",
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

    if (/^(intake_channels|intake_urls|direct_intake)$/i.test(SocialStore.text(body.action))) {
      const intake = await intakeCandidates(body, plan, route);
      const selected = intake.candidates.slice(0, 500);
      const gatewayResponse = await CandidateGateway.handler(gatewayEvent(event, selected, sectionKey, dryRun, selected.length || 1, "admin-public-channel-url-intake"));
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
        resolvedChannels: intake.candidates.length,
        submittedCandidates: selected.length,
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
    const qualitySweep = flag(body.qualitySweep || body.quality_sweep);
    const queries = scopedQueries(plan, queryCursor, passes, route).map((query) =>
      qualitySweep ? query + " popular high quality active official" : query
    );
    const perQueryLimit = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.ceil(target / queries.length)));
    const catalogSize = Math.max(1, plan.policy.collectionQueries.length);
    const searchStart = Math.max(1, Math.min(91, Number(body.searchStart || body.search_start || (Math.floor(queryCursor / catalogSize) * perQueryLimit + 1)) || 1));
    const searchResults = [];
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const queryText = queries[queryIndex];
      const directoryOffset = Math.max(0, (queryCursor + queryIndex) * perQueryLimit);
      searchResults.push(await searchOne(
        event, plan, queryText, perQueryLimit,
        body.language || body.lang || route.languages[0],
        searchStart, route, cfg, qualitySweep, directoryOffset
      ));
    }

    const rejected = [];
    const candidates = [];
    const seenUrls = new Set();
    for (const result of searchResults) {
      for (const item of result.items) {
        const converted = await candidateFromItem(item, sectionKey, plan.platform, result.query, route);
        if (!converted.ok) { rejected.push({ reason: converted.reason }); continue; }
        const key = converted.candidate.sourceUrl.toLowerCase();
        if (seenUrls.has(key)) { rejected.push({ reason: "duplicate_channel_url" }); continue; }
        seenUrls.add(key);
        candidates.push(converted.candidate);
      }
    }

    const selected = candidates.slice(0, target);
    const gatewayResponse = await CandidateGateway.handler(gatewayEvent(event, selected, sectionKey, dryRun, target));
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
      queryCatalogSize: catalogSize,
      queryCursor,
      searchStart,
      qualitySweep,
      queries,
      searchedRows: searchResults.reduce((sum, result) => sum + result.items.length, 0),
      directCandidates: candidates.length,
      submittedCandidates: selected.length,
      rejectedRows: rejected.length,
      rejectedByReason: rejectionSummary(rejected),
      providerTrace: searchResults.map((result) => ({ query: result.query, providers: result.providers })),
      nextQueryCursor: queryCursor + queries.length,
      providerReadiness: providerReadiness(cfg),
      candidateAssetType: "channel_profile_group",
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
