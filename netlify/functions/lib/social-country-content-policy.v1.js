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
const VERSION = "social-country-content-policy-v1.0.0";

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
function profile(countryCode) {
  const code = text(countryCode).toUpperCase();
  const specific = COUNTRY_OVERRIDES[code] || {};
  return {
    version: VERSION,
    countryCode: code || null,
    mode: code && COUNTRY_OVERRIDES[code] ? "country_override_plus_global" : "global_fallback",
    topics: mergeTopics(specific.topics || [], GLOBAL_TOPICS)
  };
}
function topicQueries(countryCode, platform, maxTerms) {
  const p = profile(countryCode);
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
function applyToPlatformPolicy(basePolicy, countryCode, platform) {
  const base = basePolicy && typeof basePolicy === "object" ? basePolicy : {};
  const topicTerms = topicQueries(countryCode, platform, 18);
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
    categories: unique((base.categories || []).concat(profile(countryCode).topics.map((t) => t.key))),
    collectionQueries: queries,
    countryContentPolicy: {
      version: VERSION,
      countryCode: text(countryCode).toUpperCase() || null,
      strategy: "broad_search_strict_selection",
      topics: profile(countryCode).topics
    }
  });
}

module.exports = {
  VERSION,
  GLOBAL_TOPICS,
  COUNTRY_OVERRIDES,
  PLATFORM_TOPIC_BIAS,
  profile,
  topicQueries,
  applyToPlatformPolicy
};
