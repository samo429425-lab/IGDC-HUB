"use strict";

/**
 * Optional Social AI policy envelope used only before SearchBank publication.
 * No snapshot/front/rightPanel mutation occurs here.
 */
const VERSION = "social-ai-policy-runtime-v1.1.0-safe-preference";
const SECTION_KEYS = new Set([
  "social-youtube", "social-instagram", "social-tiktok", "social-facebook",
  "social-wechat", "social-weibo", "social-pinterest", "social-reddit", "social-twitter",
]);

const DEFAULT_PREFERRED_TOPICS = Object.freeze([
  "music", "travel", "tourism", "beauty", "health", "wellness",
  "education", "learning", "art", "culture", "nature", "family", "lifestyle",
  "음악", "여행", "관광", "뷰티", "건강", "교육", "학습", "예술", "문화", "자연", "가족"
]);
const DEFAULT_BLOCKED_TOPICS = Object.freeze([
  "political campaign", "politics", "election", "partisan", "extremism",
  "graphic violence", "violence", "gore", "explicit sexual", "porn", "adult sexual",
  "gambling", "casino",
  "정치", "선거", "정당", "극단주의", "폭력", "잔혹", "음란", "성인물", "도박", "카지노"
]);

function text(v) { return v == null ? "" : String(v).trim(); }
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
    instructions: text(p.instructions).slice(0, 4000),
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
  return (explicit.length ? explicit : DEFAULT_PREFERRED_TOPICS.slice(0, 8)).join(" ");
}
module.exports = {
  VERSION, SECTION_KEYS, DEFAULT_PREFERRED_TOPICS, DEFAULT_BLOCKED_TOPICS,
  normalize, evaluate, querySuffix, text, list
};
