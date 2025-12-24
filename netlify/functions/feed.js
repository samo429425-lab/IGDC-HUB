/**
 * feed.js (Netlify Functions, CJS)
 * 단일 오토매팅 피드 (안정판)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'functions', 'data');

function readJSONSafe(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return null;
  }
}

function extractItems(json) {
  if (!json) return [];
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.sections)) {
    return json.sections.flatMap(s => Array.isArray(s.items) ? s.items : []);
  }
  if (Array.isArray(json)) return json;
  return [];
}

exports.handler = async function (event) {
  try {
    const q = event.queryStringParameters || {};
    const key = String(q.key || '').trim().toLowerCase();
    const limit = Number(q.limit || 0);

    if (!key) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'missing key' })
      };
    }

    const fp = path.join(DATA_DIR, `${key}.json`);
    const json = readJSONSafe(fp);

    if (!json) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, key, source: null, count: 0, items: [] })
      };
    }

    let items = extractItems(json).filter(it => it && typeof it === 'object');
    if (limit > 0) items = items.slice(0, limit);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        key,
        source: `${key}.json`,
        count: items.length,
        items
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message || String(err) })
    };
  }
};
