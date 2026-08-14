"use strict";

/**
 * IGDC/MARU Social country-aware content discovery policy.
 *
 * Design rule:
 * - Search broadly, select strictly.
 * - Keep one shared pipeline; apply country/language/topic overlays here.
 * - Do not mutate SearchBank, Snapshot Engine, AutoMap, or front HTML.
 * - Topic preference is soft guidance, never an absolute exclusion rule.
 */
const VERSION = "social-country-content-policy-v1.1.0-consumption-weighted";

const GLOBAL_TOPICS = Object.freeze([
  { key: "music", weight: 100, terms: ["music", "singer", "artist", "live performance", "concert", "official music"] },
  { key: "travel", weight: 96, terms: ["travel", "tourism", "destination", "local culture", "hotel", "resort", "cruise", "outdoor", "leisure"] },
  { key: "world", weight: 90, terms: ["world news", "international affairs", "global issue", "international organization", "science", "economy", "culture"] },
  { key: "culture", weight: 82, terms: ["culture", "festival", "museum", "heritage", "food culture"] },
  { key: "sports", weight: 78, terms: ["sports", "football", "golf", "outdoor sports", "major sporting event"] },
  { key: "education", weight: 72, terms: ["education", "documentary", "learning", "technology", "science"] }
]);

const COUNTRY_OVERRIDES = Object.freeze({
  KR: {
    topics: [
      { key: "music", weight: 110, terms: ["한국 가수", "라이브 무대", "음악방송", "공식 공연", "K-pop", "트로트", "보컬"] },
      { key: "travel", weight: 102, terms: ["국내 여행", "한국 관광", "지역 축제", "여행지", "호텔", "리조트", "골프", "캠핑"] },
      { key: "world", weight: 94, terms: ["국제 주요 이슈", "세계 뉴스", "국제기구", "글로벌 경제", "과학 뉴스"] }
    ]
  },
  JP: {
    topics: [
      { key: "music", weight: 106, terms: ["日本 音楽", "歌手", "ライブ", "公式パフォーマンス", "アーティスト"] },
      { key: "travel", weight: 102, terms: ["日本 旅行", "観光", "温泉", "地域文化", "ホテル", "アウトドア"] },
      { key: "culture", weight: 94, terms: ["日本 文化", "アニメ", "芸術", "祭り", "伝統文化"] }
    ]
  },
  BR: {
    topics: [
      { key: "music", weight: 106, terms: ["música brasileira", "cantor", "cantora", "show ao vivo", "artista oficial"] },
      { key: "travel", weight: 104, terms: ["turismo no Brasil", "viagem", "destino", "praia", "hotel", "resort", "cruzeiro"] },
      { key: "sports", weight: 98, terms: ["futebol", "esportes", "eventos esportivos"] },
      { key: "world", weight: 92, terms: ["notícias internacionais", "assuntos globais", "economia mundial", "ciência"] }
    ]
  },
  CN: {
    topics: [
      { key: "culture", weight: 106, terms: ["中国 文化", "艺术", "演出", "传统文化"] },
      { key: "travel", weight: 104, terms: ["中国 旅游", "景点", "酒店", "度假", "户外"] },
      { key: "music", weight: 102, terms: ["中国 音乐", "歌手", "现场演出", "官方"] },
      { key: "world", weight: 90, terms: ["国际 新闻", "全球 经济", "科技", "国际组织"] }
    ]
  },
  US: {
    topics: [
      { key: "music", weight: 104, terms: ["official artist", "live performance", "concert", "singer"] },
      { key: "travel", weight: 100, terms: ["US travel", "destination", "national park", "hotel", "resort", "cruise"] },
      { key: "world", weight: 98, terms: ["international news", "global affairs", "world economy", "science news"] },
      { key: "sports", weight: 92, terms: ["major sports", "golf", "outdoor sports"] }
    ]
  },
  GB: {
    topics: [
      { key: "world", weight: 100, terms: ["international news", "world affairs", "global economy", "science"] },
      { key: "music", weight: 100, terms: ["British music", "live performance", "official artist"] },
      { key: "travel", weight: 96, terms: ["UK travel", "tourism", "heritage", "hotel", "countryside"] }
    ]
  },
  FR: {
    topics: [
      { key: "travel", weight: 104, terms: ["voyage France", "tourisme", "destination", "hôtel", "culture locale"] },
      { key: "music", weight: 100, terms: ["musique française", "chanteur", "chanteuse", "concert", "artiste officiel"] },
      { key: "culture", weight: 98, terms: ["culture française", "art", "musée", "patrimoine"] }
    ]
  },
  ES: {
    topics: [
      { key: "travel", weight: 104, terms: ["turismo España", "viaje", "destino", "hotel", "cultura local"] },
      { key: "music", weight: 100, terms: ["música española", "cantante", "actuación en vivo", "artista oficial"] },
      { key: "sports", weight: 94, terms: ["fútbol", "deportes"] }
    ]
  },
  IN: {
    topics: [
      { key: "music", weight: 106, terms: ["Indian singer", "live music", "official performance", "Bollywood music"] },
      { key: "travel", weight: 100, terms: ["India travel", "tourism", "heritage", "hotel", "local culture"] },
      { key: "world", weight: 92, terms: ["international news", "global economy", "science", "technology"] }
    ]
  },
  PH: {
    topics: [
      { key: "music", weight: 108, terms: ["Filipino singer", "OPM", "live performance", "music artist"] },
      { key: "travel", weight: 104, terms: ["Philippines travel", "tourism", "island", "beach", "resort", "local food"] },
      { key: "world", weight: 88, terms: ["international news", "global affairs"] }
    ]
  }
});


const REGION_OVERRIDES = Object.freeze({
  east_asia_pacific: {
    topics: [
      { key: "music", weight: 104, terms: ["East Asia popular music", "Asia live performance", "regional music trend"] },
      { key: "travel", weight: 103, terms: ["East Asia travel", "Southeast Asia travel", "Pacific tourism"] },
      { key: "world", weight: 94, terms: ["Asia international news", "regional economy", "Asia science technology"] }
    ]
  },
  south_central_asia: {
    topics: [
      { key: "music", weight: 102, terms: ["South Asia music", "Central Asia music", "live performance"] },
      { key: "travel", weight: 101, terms: ["South Asia travel", "Central Asia travel", "heritage tourism"] },
      { key: "world", weight: 94, terms: ["South Asia international news", "Central Asia economy"] }
    ]
  },
  middle_east_north_africa: {
    topics: [
      { key: "travel", weight: 103, terms: ["Middle East travel", "North Africa tourism", "regional culture"] },
      { key: "music", weight: 98, terms: ["Middle East music", "Arab live performance", "North Africa music"] },
      { key: "world", weight: 96, terms: ["Middle East international news", "North Africa economy"] }
    ]
  },
  europe: {
    topics: [
      { key: "travel", weight: 104, terms: ["Europe travel", "European tourism", "heritage destination"] },
      { key: "music", weight: 101, terms: ["European music", "live performance Europe", "official artist"] },
      { key: "world", weight: 98, terms: ["Europe international news", "European economy", "science Europe"] }
    ]
  },
  sub_saharan_africa: {
    topics: [
      { key: "music", weight: 103, terms: ["African music", "live performance Africa", "Afrobeats"] },
      { key: "travel", weight: 101, terms: ["Africa travel", "safari tourism", "African culture"] },
      { key: "world", weight: 92, terms: ["Africa international news", "African economy"] }
    ]
  },
  north_america: {
    topics: [
      { key: "music", weight: 103, terms: ["North America music", "live performance", "official artist"] },
      { key: "travel", weight: 101, terms: ["North America travel", "national parks", "tourism"] },
      { key: "world", weight: 98, terms: ["North America international news", "global economy", "science news"] }
    ]
  },
  latin_america_caribbean: {
    topics: [
      { key: "music", weight: 105, terms: ["Latin music", "música latina", "live performance"] },
      { key: "travel", weight: 103, terms: ["Latin America travel", "Caribbean tourism", "regional destination"] },
      { key: "sports", weight: 96, terms: ["Latin America football", "regional sports"] }
    ]
  }
});
const PLATFORM_TOPIC_BIAS = Object.freeze({
  youtube: ["music", "travel", "world", "education", "sports", "culture"],
  instagram: ["travel", "music", "culture", "sports"],
  tiktok: ["music", "travel", "culture", "sports"],
  facebook: ["travel", "world", "culture", "music", "community"],
  wechat: ["travel", "world", "culture", "education"],
  weibo: ["music", "culture", "world", "travel"],
  pinterest: ["travel", "culture", "design", "food"],
  reddit: ["world", "technology", "travel", "music", "sports"],
  twitter: ["world", "music", "sports", "travel"]
});

function text(v) { return v == null ? "" : String(v).trim(); }
function unique(values) { return Array.from(new Set((values || []).map(text).filter(Boolean))); }
function mergeTopics(base, override) {
  const map = new Map();
  (base || []).concat(override || []).forEach((topic) => {
    if (!topic || !topic.key) return;
    const prev = map.get(topic.key) || { key: topic.key, weight: 0, terms: [] };
    map.set(topic.key, {
      key: topic.key,
      weight: Math.max(Number(prev.weight || 0), Number(topic.weight || 0)),
      terms: unique((prev.terms || []).concat(topic.terms || []))
    });
  });
  return Array.from(map.values()).sort((a, b) => b.weight - a.weight);
}
function routeInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return { countryCode: value };
}
function profile(value) {
  const route = routeInput(value);
  const code = text(route.countryCode || route.country).toUpperCase();
  const regionId = text(route.worldRegion || route.regionId || route.region);
  const specific = COUNTRY_OVERRIDES[code] || {};
  const regional = REGION_OVERRIDES[regionId] || {};
  const topics = mergeTopics(
    mergeTopics(specific.topics || [], regional.topics || []),
    GLOBAL_TOPICS
  );
  return {
    version: VERSION,
    countryCode: code || null,
    regionId: regionId || null,
    mode: code
      ? "country_consumption_plus_region_plus_global"
      : regionId
        ? "region_consumption_plus_global"
        : "global_consumption",
    topics
  };
}
function topicQueries(routeOrCountry, platform, maxTerms) {
  const p = profile(routeOrCountry);
  const bias = PLATFORM_TOPIC_BIAS[text(platform).toLowerCase()] || [];
  const ranked = p.topics.slice().sort((a, b) => {
    const ai = bias.indexOf(a.key), bi = bias.indexOf(b.key);
    const ab = ai < 0 ? 0 : (bias.length - ai) * 4;
    const bb = bi < 0 ? 0 : (bias.length - bi) * 4;
    return (b.weight + bb) - (a.weight + ab);
  });
  const limit = Math.max(6, Math.min(24, Number(maxTerms) || 18));
  const out = [];
  let termIndex = 0;
  while (out.length < limit) {
    let added = false;
    for (const topic of ranked) {
      const term = (topic.terms || [])[termIndex];
      if (term && !out.includes(term)) {
        out.push(term);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
    termIndex += 1;
  }
  return unique(out);
}
function applyToPlatformPolicy(basePolicy, routeOrCountry, platform) {
  const base = basePolicy && typeof basePolicy === "object" ? basePolicy : {};
  const p = profile(routeOrCountry);
  const topicTerms = topicQueries(routeOrCountry, platform, 18);
  const baseQueries = base.collectionQueries || [];
  const topicSearchQueries = topicTerms.map((term) =>
    [platform, term, "official public latest high quality"].filter(Boolean).join(" ")
  );
  const queries = [];
  const max = Math.max(baseQueries.length, Math.ceil(topicSearchQueries.length / 2));
  for (let i = 0; i < max; i += 1) {
    const a = topicSearchQueries[i * 2];
    const b = topicSearchQueries[i * 2 + 1];
    const baseQuery = baseQueries[i];
    if (a) queries.push(a);
    if (b) queries.push(b);
    if (baseQuery) queries.push(baseQuery);
  }
  return Object.assign({}, base, {
    categories: unique((base.categories || []).concat(p.topics.map((t) => t.key))),
    collectionQueries: queries,
    countryContentPolicy: {
      version: VERSION,
      countryCode: p.countryCode,
      regionId: p.regionId,
      strategy: "broad_search_consumption_weighted_strict_selection",
      topics: p.topics
    }
  });
}

function contentText(row) {
  const source = row && typeof row === "object" ? row : {};
  const raw = source.raw && typeof source.raw === "object" ? source.raw : {};
  const values = [
    source.title, source.description, source.category, source.creatorName, source.creator_name,
    raw.title, raw.description, raw.category, raw.discoveryQuery,
    ...(Array.isArray(raw.tags) ? raw.tags : []),
    ...(Array.isArray(source.tags) ? source.tags : [])
  ];
  return values.map(text).filter(Boolean).join(" ").toLowerCase();
}
function contentAffinityScore(row, routeOrCountry) {
  const haystack = contentText(row);
  if (!haystack) return 0;
  const p = profile(routeOrCountry);
  let best = 0;
  let matchedTopics = 0;
  p.topics.forEach((topic) => {
    const terms = (topic.terms || []).map((term) => text(term).toLowerCase()).filter((term) => term.length >= 3);
    const key = text(topic.key).toLowerCase();
    const keyMatched = key.length >= 5 && new RegExp("(^|[^a-z0-9])" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)", "i").test(haystack);
    const matched = terms.some((term) => haystack.includes(term)) || keyMatched;
    if (!matched) return;
    matchedTopics += 1;
    best = Math.max(best, Number(topic.weight || 0));
  });
  if (!best) return 0;
  return Math.min(42, Math.round(best * 0.30 + Math.min(10, matchedTopics * 3)));
}

module.exports = {
  VERSION,
  GLOBAL_TOPICS,
  COUNTRY_OVERRIDES,
  REGION_OVERRIDES,
  PLATFORM_TOPIC_BIAS,
  profile,
  topicQueries,
  applyToPlatformPolicy,
  contentAffinityScore
};
