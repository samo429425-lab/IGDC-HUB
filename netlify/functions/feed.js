// netlify/functions/feed.js
// Purpose: Serve home products feed for home-products-automap.v2.js (expects arrays per section key).
// - Reads snapshot.internal.v1.json first (if present)
// - Fallback: reads /data/home_1..5.json and /data/home_right_*.json
// - Normalizes: if a section file is {meta, items:[...]} -> returns items array
// - Output shape: { home_1:[...], ..., home_right_top:[...], home_right_middle:[...], home_right_bottom:[...] }

const fs = require('fs');
const path = require('path');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function toItemsArray(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.items)) return obj.items;
  if (obj.data && Array.isArray(obj.data.items)) return obj.data.items;
  if (obj.payload && Array.isArray(obj.payload.items)) return obj.payload.items;
  return [];
}

function indexFromSnapshot(snapshot) {
  const out = {};
  if (!snapshot) return out;

  if (Array.isArray(snapshot.sections)) {
    for (const s of snapshot.sections) {
      if (!s) continue;
      const id = (s.id || s.key || s.section || s.category || '').toString().trim();
      if (!id) continue;
      const items = toItemsArray(s.items || s);
      if (items.length) out[id] = items;
    }
  }

  for (const k of Object.keys(snapshot)) {
    if (k === 'sections' || k === 'meta') continue;
    const items = toItemsArray(snapshot[k]);
    if (items.length) out[k] = items;
  }

  return out;
}

function normalizeKeys(map) {
  const want = [
    'home_1','home_2','home_3','home_4','home_5',
    'home_right_top','home_right_middle','home_right_bottom'
  ];
  const out = {};

  for (const k of want) {
    if (Array.isArray(map[k]) && map[k].length) { out[k] = map[k]; continue; }

    const hy = k.replace(/_/g, '-');
    if (Array.isArray(map[hy]) && map[hy].length) { out[k] = map[hy]; continue; }

    if (k.startsWith('home_')) {
      const legacy = k.replace('home_', 'home-shop-');
      if (Array.isArray(map[legacy]) && map[legacy].length) { out[k] = map[legacy]; continue; }
    }
    if (k.startsWith('home_right_')) {
      const legacy = k.replace('home_right_', 'home-right-');
      if (Array.isArray(map[legacy]) && map[legacy].length) { out[k] = map[legacy]; continue; }
    }

    out[k] = [];
  }

  return out;
}

exports.handler = async function handler(event) {
  try {
    const page = (event.queryStringParameters && event.queryStringParameters.page) || '';
    if (page && page !== 'homeproducts') {
      return { statusCode: 404, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'unknown page' }) };
    }

    const dataDir = path.join(__dirname, 'data');

    const snapshot = readJsonSafe(path.join(dataDir, 'snapshot.internal.v1.json'));
    const snapMap = indexFromSnapshot(snapshot);

    const fileMap = {};
    const fallbackFiles = [
      ['home_1', 'home_1.json'],
      ['home_2', 'home_2.json'],
      ['home_3', 'home_3.json'],
      ['home_4', 'home_4.json'],
      ['home_5', 'home_5.json'],
      ['home_right_top', 'home_right_top.json'],
      ['home_right_middle', 'home_right_middle.json'],
      ['home_right_bottom', 'home_right_bottom.json'],
    ];

    for (const [key, fname] of fallbackFiles) {
      const already =
        (Array.isArray(snapMap[key]) && snapMap[key].length) ||
        (Array.isArray(snapMap[key.replace(/_/g, '-')]) && snapMap[key.replace(/_/g, '-')].length) ||
        (key.startsWith('home_') && Array.isArray(snapMap[key.replace('home_', 'home-shop-')]) && snapMap[key.replace('home_', 'home-shop-')].length) ||
        (key.startsWith('home_right_') && Array.isArray(snapMap[key.replace('home_right_', 'home-right-')]) && snapMap[key.replace('home_right_', 'home-right-')].length);

      if (already) continue;

      const j = readJsonSafe(path.join(dataDir, fname));
      const items = toItemsArray(j);
      if (items.length) fileMap[key] = items;
    }

    const merged = Object.assign({}, snapMap, fileMap);
    const out = normalizeKeys(merged);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify(out),
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: String(e && e.message ? e.message : e) }) };
  }
};
