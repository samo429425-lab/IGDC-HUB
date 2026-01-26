/**
 * maru-search.js — v1.5 (1차 업그레이드 완성본)
 * General-purpose Search Engine (Future-ready)
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

function loadSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {
    return { items: [], sections: [] };
  }
}

function normalizeItem(raw = {}) {
  return {
    id: raw.id || null,
    type: raw.type || "text",
    title: raw.title || "",
    summary: raw.summary || "",
    url: raw.url || "",
    provider: raw.provider || "internal",
    tags: raw.tags || [],
    score: 0
  };
}

function scoreItem(item, query) {
  const q = query.toLowerCase();
  let s = 0;
  if (item.title.toLowerCase().includes(q)) s += 5;
  if (item.summary.toLowerCase().includes(q)) s += 3;
  (item.tags || []).forEach(t => {
    if (String(t).toLowerCase().includes(q)) s += 1;
  });
  return s;
}

exports.handler = async (event) => {
  const q = (event.queryStringParameters?.q || "").trim();
  if (!q) {
    return { statusCode: 200, body: JSON.stringify({ items: [] }) };
  }

  const snapshot = loadSnapshot();
  const baseItems = [
    ...(snapshot.items || []),
    ...((snapshot.sections || []).flatMap(s => s.items || []))
  ];

  const results = baseItems
    .map(normalizeItem)
    .map(item => ({ ...item, score: scoreItem(item, q) }))
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      meta: { engine: "maru-search", version: "1.5", query: q, count: results.length },
      items: results
    })
  };
};
