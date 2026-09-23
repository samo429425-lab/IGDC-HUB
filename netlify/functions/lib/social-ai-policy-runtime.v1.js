"use strict";

/**
 * Optional Social AI policy envelope used only before SearchBank publication.
 * No snapshot/front/rightPanel mutation occurs here.
 */
const VERSION = "social-ai-policy-runtime-v1.3.1-six-main-sections";
const SECTION_KEYS = new Set([
  "social-youtube", "social-instagram", "social-tiktok", "social-facebook",
  "social-wechat", "social-weibo",
]);

const DEFAULT_PREFERRED_TOPICS = Object.freeze([
  "music", "travel", "tourism", "beauty", "health", "wellness",
  "education", "learning", "art", "culture", "nature", "family", "lifestyle", "entertainment", "food", "museum",
  "음악", "여행", "관광", "뷰티", "건강", "교육", "학습", "예술", "문화", "자연", "가족", "오락", "음식",
  "音乐", "音樂", "旅游", "旅遊", "文化", "美食", "艺术", "藝術", "自然", "娱乐", "娛樂", "健康", "教育"
]);
const DEFAULT_BLOCKED_TOPICS = Object.freeze([
  "political campaign", "politics", "election", "partisan", "extremism",
  "political propaganda", "state propaganda", "territorial dispute", "military conflict",
  "misinformation", "disinformation", "false information",
  "graphic violence", "violence", "gore", "explicit sexual", "porn", "adult sexual",
  "gambling", "casino",
  "정치", "선거", "정당", "극단주의", "정치선전", "국가선전", "영토분쟁", "군사분쟁", "허위정보", "왜곡정보",
  "폭력", "잔혹", "음란", "성인물", "도박", "카지노",
  "政治", "选举", "選舉", "政党", "政黨", "政治宣传", "政治宣傳", "军事冲突", "軍事衝突",
  "领土争端", "領土爭端", "虚假信息", "虛假信息"
]);

function text(v) { return v == null ? "" : String(v).trim(); }
function normalizeSpeechTerms(v) {
  return text(v)
    .replace(/임플란트/gi, "인플루언서")
    .replace(/인풀루언서|인플루언스|인풀루언스|인플런서/gi, "인플루언서")
    .replace(/섬네일/gi, "썸네일");
}
function list(v) {
  return Array.from(new Set((Array.isArray(v) ? v : text(v).split(/[,\n]/))
    .map(text).filter(Boolean))).slice(0, 40);
}
function clamp(n, lo, hi, fallback) {
  n = Number(n);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
function normalize(input) {
  const p = input && typeof input === "object" ? input : {};
  const sectionKey = SECTION_KEYS.has(text(p.sectionKey)) ? text(p.sectionKey) : "";
  return {
    version: VERSION,
    scopeType: /^(global|section|collector|content|influencer)$/.test(text(p.scopeType).toLowerCase())
      ? text(p.scopeType).toLowerCase() : "global",
    sectionKey,
    instructions: normalizeSpeechTerms(p.instructions).slice(0, 4000),
    includeTopics: list(p.includeTopics),
    excludeTopics: list(p.excludeTopics),
    preferredCreatorTraits: list(p.preferredCreatorTraits),
    blockedCreatorTraits: list(p.blockedCreatorTraits),
    freshnessDays: clamp(p.freshnessDays, 1, 365, 30),
    requireThumbnail: p.requireThumbnail !== false,
    replaceDeadUrls: p.replaceDeadUrls !== false,
    minSafetyScore: clamp(p.minSafetyScore, 0, 100, 65),
    minTrustScore: clamp(p.minTrustScore, 0, 100, 50),
    notes: list(p.notes),
    defaultPreferredTopics: DEFAULT_PREFERRED_TOPICS.slice(),
    defaultBlockedTopics: DEFAULT_BLOCKED_TOPICS.slice(),
  };
}
function haystack(row) {
  const raw = row && row.raw && typeof row.raw === "object" ? row.raw : {};
  return [
    row && row.title, row && row.name, row && row.description, row && row.summary,
    row && row.category, row && row.creatorName, row && row.channelName,
    raw.title, raw.description, raw.category, raw.creatorName, raw.channelName,
  ].map(text).join(" ").toLowerCase();
}
function containsAny(value, terms) {
  const h = text(value).toLowerCase();
  return list(terms).some((term) => h.includes(term.toLowerCase()));
}
function evaluate(row, input) {
  const p = normalize(input);
  const h = haystack(row);
  const blocked = DEFAULT_BLOCKED_TOPICS.concat(p.excludeTopics, p.blockedCreatorTraits);
  if (blocked.length && containsAny(h, blocked)) return { ok: false, reason: "safe_policy_excluded_term", scoreAdjustment: -1000 };
  let scoreAdjustment = 0;
  if (containsAny(h, DEFAULT_PREFERRED_TOPICS)) scoreAdjustment += 12;
  if (p.includeTopics.length && containsAny(h, p.includeTopics)) scoreAdjustment += 30;
  if (p.preferredCreatorTraits.length && containsAny(h, p.preferredCreatorTraits)) scoreAdjustment += 18;
  return { ok: true, reason: "passed", scoreAdjustment };
}
function querySuffix(input) {
  const p = normalize(input);
  const explicit = p.includeTopics.slice(0, 8);
  const parts = [(explicit.length ? explicit : DEFAULT_PREFERRED_TOPICS.slice(0, 8)).join(" ")];
  const ins = p.instructions.toLowerCase();
  const hints = [
    [/인플루언서|influencer|creator/, "active creator official profile latest public post"],
    [/프로필|페이지|profile|page/, "official profile public page"],
    [/썸네일|thumbnail|preview/, "thumbnail preview image"],
    [/최신|새 게시물|recent|latest|fresh/, "latest recent active"],
    [/인기|조회수|좋아요|참여|popular|views|likes|engagement/, "popular high engagement"],
  ];
  hints.forEach(([rx, value]) => { if (rx.test(ins)) parts.push(value); });
  return Array.from(new Set(parts.join(" ").split(/\s+/).filter(Boolean))).join(" ").slice(0, 420);
}
module.exports = {
  VERSION, SECTION_KEYS, DEFAULT_PREFERRED_TOPICS, DEFAULT_BLOCKED_TOPICS,
  normalize, evaluate, querySuffix, normalizeSpeechTerms, text, list
};
