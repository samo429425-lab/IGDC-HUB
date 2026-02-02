/**
 * media-feed.v3.js
 * Media feed engine — FRONT KEY CANONICAL VERSION
 * Purpose:
 *  - Force sectionKey to FRONT PAGE canonical keys
 *  - Output snapshot-compatible structure: sections[]
 *  - Preserve maru-search pipeline (NO REGRESSION)
 *
 * Generated: 2026-02-02
 */

import { maruSearch } from './maru-search.js';

/* ===============================
 * 1. FRONT CANONICAL SECTION KEYS
 * =============================== */
const FRONT_SECTION_KEYS = [
  'media-trending',
  'media-movie',
  'media-drama',
  'media-documentary',
  'media-animation',
  'media-music',
  'media-education'
];

/* 빠른 검증용 Set */
const FRONT_KEY_SET = new Set(FRONT_SECTION_KEYS);

/* ===============================
 * 2. HERO SCORE (기존 로직 유지)
 * =============================== */
function calcHeroScore(item) {
  const now = Date.now();
  const published = item.publishedAt
    ? new Date(item.publishedAt).getTime()
    : now;

  const days = Math.max(1, (now - published) / (1000 * 60 * 60 * 24));
  const recencyScore = Math.max(0, 100 - days);

  const watch = item.metrics?.watch?.views || 0;
  const like = item.metrics?.like || 0;
  const recommend = item.metrics?.recommend || 0;

  return (
    recencyScore * 0.4 +
    Math.log10(watch + 1) * 30 +
    like * 0.2 +
    recommend * 0.3
  );
}

/* ===============================
 * 3. NORMALIZE ITEM (보존)
 * =============================== */
function normalizeItem(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || '',
    summary: item.summary || '',
    thumbnail: item.thumbnail || '',
    poster: item.poster || item.thumbnail || '',
    video: item.video || '',
    duration: item.duration || 0,
    publishedAt: item.publishedAt || null,
    license: { type: item.license || 'public-domain' },
    metrics: {
      like: item.metrics?.like || 0,
      recommend: item.metrics?.recommend || 0,
      watch: {
        views: item.metrics?.watch?.views || 0,
        totalSeconds: item.metrics?.watch?.totalSeconds || 0,
        avgSeconds: item.metrics?.watch?.avgSeconds || 0
      }
    },
    tags: Array.isArray(item.tags) ? item.tags : []
  };
}

/* ===============================
 * 4. BUILD MEDIA FEED (CORE)
 * =============================== */
export async function buildMediaFeed(options = {}) {
  const results = await maruSearch({
    type: 'media',
    ...options
  });

  /* 프론트 기준 섹션 컨테이너 초기화 */
  const sectionBuckets = {};
  FRONT_SECTION_KEYS.forEach(k => {
    sectionBuckets[k] = [];
  });

  const allItems = [];

  /* ===== ITEM DISTRIBUTION ===== */
  results.forEach(item => {
    if (!item || !item.thumbnail) return;

    const license = item.license || 'public-domain';
    if (!['public-domain', 'cc0', 'cc-by'].includes(license)) return;

    const sectionKey = item.sectionKey;

    /* ❌ 프론트에 없는 키는 폐기 */
    if (!FRONT_KEY_SET.has(sectionKey)) return;

    const normalized = normalizeItem(item);

    sectionBuckets[sectionKey].push(normalized);
    allItems.push(normalized);
  });

  /* ===============================
   * 5. HERO SELECTION
   * =============================== */
  const heroItems = allItems
    .map(it => ({ ...it, __score: calcHeroScore(it) }))
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 5)
    .map(({ __score, ...rest }) => rest);

  /* ===============================
   * 6. SNAPSHOT-COMPATIBLE OUTPUT
   * =============================== */
  const sections = FRONT_SECTION_KEYS.map(key => ({
    key,
    items: sectionBuckets[key]
  }));

  return {
    meta: {
      type: 'media-snapshot',
      version: 'v1',
      generatedAt: new Date().toISOString()
    },
    hero: {
      source: 'derived',
      rule: 'front-canonical-score',
      items: heroItems
    },
    sections
  };
}
