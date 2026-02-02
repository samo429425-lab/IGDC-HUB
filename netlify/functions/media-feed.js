
/**
 * media-feed.v2.js
 * Media feed engine with HERO candidate selection
 * 기준: 글로벌 미디어 플랫폼 표준
 * Generated: 2026-02-02T04:59:10.649520Z
 */

import { maruSearch } from './maru-search.js';

/**
 * HERO SCORE 계산
 * 가중치:
 * - 최신성 40%
 * - 시청수(log) 30%
 * - 좋아요 20%
 * - 추천 30%
 */
function calcHeroScore(item) {
  const now = Date.now();
  const published = item.publishedAt ? new Date(item.publishedAt).getTime() : now;
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

export async function buildMediaFeed(options = {}) {
  const results = await maruSearch({
    type: 'media',
    ...options
  });

  const sections = {};
  const allItems = [];

  results.forEach(item => {
    if (!item || !item.thumbnail) return;

    const license = item.license || 'public-domain';
    if (!['public-domain','cc0','cc-by'].includes(license)) return;

    const normalized = {
      id: item.id || crypto.randomUUID(),
      title: item.title || '',
      summary: item.summary || '',
      thumbnail: item.thumbnail,
      poster: item.poster || item.thumbnail,
      video: item.video || '',
      duration: item.duration || 0,
      publishedAt: item.publishedAt || null,
      license: { type: license },
      metrics: {
        like: item.metrics?.like || 0,
        recommend: item.metrics?.recommend || 0,
        watch: {
          views: item.metrics?.watch?.views || 0,
          totalSeconds: item.metrics?.watch?.totalSeconds || 0,
          avgSeconds: item.metrics?.watch?.avgSeconds || 0
        }
      }
    };

    const sectionKey = item.sectionKey || 'media-recommended';
    sections[sectionKey] = sections[sectionKey] || [];
    sections[sectionKey].push(normalized);
    allItems.push(normalized);
  });

  // HERO 후보 선정
  const heroItems = allItems
    .map(item => ({ ...item, __score: calcHeroScore(item) }))
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 5)
    .map(item => {
      const { __score, ...rest } = item;
      return rest;
    });

  return {
    hero: {
      source: 'derived',
      rule: 'global-standard-score',
      items: heroItems
    },
    sections
  };
}
