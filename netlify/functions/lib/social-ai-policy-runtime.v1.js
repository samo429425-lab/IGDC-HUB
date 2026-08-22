"use strict";

/**
 * Optional Social AI policy envelope used only before SearchBank publication.
 * No snapshot/front/rightPanel mutation occurs here.
 */
const VERSION = "social-ai-policy-runtime-v1.0.0";
const SECTION_KEYS = new Set([
  "social-youtube", "social-instagram", "social-tiktok", "social-facebook",
  "social-wechat", "social-weibo", "social-pinterest", "social-reddit", "social-twitter",
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
  const blocked = p.excludeTopics.concat(p.blockedCreatorTraits);
  if (blocked.length && containsAny(h, blocked)) return { ok: false, reason: "ai_policy_excluded_term", scoreAdjustment: -1000 };
  let scoreAdjustment = 0;
  if (p.includeTopics.length && containsAny(h, p.includeTopics)) scoreAdjustment += 30;
  if (p.preferredCreatorTraits.length && containsAny(h, p.preferredCreatorTraits)) scoreAdjustment += 18;
  return { ok: true, reason: "passed", scoreAdjustment };
}
function querySuffix(input) {
  const p = normalize(input);
  return p.includeTopics.slice(0, 8).join(" ");
}
module.exports = { VERSION, SECTION_KEYS, normalize, evaluate, querySuffix, text, list };
