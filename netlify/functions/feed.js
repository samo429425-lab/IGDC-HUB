// netlify/functions/feed.js
// Minimal, stable feed function for thumbnail-loader.compat
// - Returns JSON with { items: [...] } (loader supports this schema)
// - Reads functions/data/{page}_front.json first, then functions/data/{page}.json
// - No PSOM filtering (prevents accidental empty results)

import fs from "fs";
import path from "path";

// HTML page keys -> data file keys
const PAGE_ALIAS = {
  // keep tour as-is (loader calls page=tour)
  tour: "tour",
  // optional: accept tourpage too, map it to tour
  tourpage: "tour",
};

const DATA_ROOT = path.join(process.cwd(), "functions", "data");

function resolveKey(raw = "") {
  const k = String(raw || "").trim().toLowerCase();
  return PAGE_ALIAS[k] || k;
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function loadItems(pageKey) {
  const p1 = path.join(DATA_ROOT, `${pageKey}_front.json`);
  const j1 = readJson(p1);
  if (j1) return Array.isArray(j1) ? j1 : (Array.isArray(j1.items) ? j1.items : []);

  const p2 = path.join(DATA_ROOT, `${pageKey}.json`);
  const j2 = readJson(p2);
  if (j2) return Array.isArray(j2) ? j2 : (Array.isArray(j2.items) ? j2.items : []);

  return [];
}

export async function handler(event) {
  const q = event.queryStringParameters || {};
  const raw = q.page || q.key || "";
  const pageKey = resolveKey(raw);

  const items = loadItems(pageKey);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      page: raw,
      resolvedPage: pageKey,
      count: items.length,
      items,
    }),
  };
}
