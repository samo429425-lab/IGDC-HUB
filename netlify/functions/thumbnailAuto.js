// netlify/functions/thumbnailAuto.js
// MARU Engine – Thumbnail Auto Generation (OpenAI-ready)
// 역할: psom.json을 기준으로 페이지별 썸네일 카드 메타 자동 생성

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

// === CONFIG ===
const OUTPUT_DIR = path.join(__dirname, 'data');

// OpenAI 사용 시 환경변수로 키 주입 (확장용)
// process.env.OPENAI_API_KEY

// === UTIL ===
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(p, fallback) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function groupByPage(psom) {
  return psom.reduce((acc, item) => {
    const page = item.page || 'unknown';
    if (!acc[page]) acc[page] = [];
    acc[page].push(item);
    return acc;
  }, {});
}

function generateThumbnailCard(item) {
  return {
    id: item.id,
    title: item.title,
    description: `${item.title} related content`,
    category: item.category,
    url: item.url,
    image: `/assets/images/thumbnails/${item.page}/${item.id}.jpg`,
    keywords: item.keywords || [],
    weight: item.weight || 1,
    generatedAt: new Date().toISOString()
  };
}

exports.handler = async () => {
  try {
    // 로컬/배포 환경 공통 접근
    const psomPath = path.join(process.cwd(), 'assets/hero/psom.json');
    const psom = readJsonSafe(psomPath, []);

    if (!Array.isArray(psom) || psom.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, message: 'psom.json not found or empty' })
      };
    }

    ensureDir(OUTPUT_DIR);

    const byPage = groupByPage(psom);
    const results = {};

    Object.keys(byPage).forEach(page => {
      const cards = byPage[page].map(generateThumbnailCard);
      const outPath = path.join(OUTPUT_DIR, `${page}_feed.json`);
      fs.writeFileSync(outPath, JSON.stringify({ page, cards }, null, 2));
      results[page] = { count: cards.length, file: `${page}_feed.json` };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: 'Thumbnail feed generated',
        results
      })
    };

  } catch (err) {
    console.error('thumbnailAuto error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
