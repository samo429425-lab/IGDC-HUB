/**
 * feed.js
 * Unified thumbnail feed resolver for Netlify Functions
 * Fixed alias handling (tour -> tourpage)
 * Safe, minimal, deterministic implementation
 */

import fs from "fs";
import path from "path";

const __dirname = new URL('.', import.meta.url).pathname;

// ================= CONFIG =================

// Page key aliases (HTML key -> data source key)
const PAGE_ALIAS = {
  home: "homeproducts",
  network: "networkhub",
  networkhub: "networkhub",
  media: "mediahub",
  mediahub: "mediahub",
  distribution: "distributionhub",
  distributionhub: "distributionhub",
  tour: "tourpage", // ★ FIXED
};

// Data paths
const DATA_ROOT = path.join(process.cwd(), "functions", "data");
const PSOM_PATH = path.join(process.cwd(), "assets", "hero", "psom.json");

// ================= HELPERS =================

function resolvePageKey(rawKey = "") {
  const key = String(rawKey).toLowerCase().trim();
  return PAGE_ALIAS[key] || key;
}

function readJSONSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function loadPageData(pageKey) {
  // Prefer *_front.json
  let p = path.join(DATA_ROOT, `${pageKey}_front.json`);
  let data = readJSONSafe(p);
  if (data) return data;

  // Fallback: pageKey.json
  p = path.join(DATA_ROOT, `${pageKey}.json`);
  data = readJSONSafe(p);
  if (data) return data;

  return [];
}

function filterByPSOM(items, pageKey) {
  const psom = readJSONSafe(PSOM_PATH);
  if (!Array.isArray(psom)) return items;

  const allowed = new Set(
    psom.filter(p => p.page === pageKey).map(p => p.id)
  );

  if (!allowed.size) return items;
  return items.filter(it => allowed.has(it.id));
}

// ================= HANDLER =================

export async function handler(event) {
  const q = event.queryStringParameters || {};
  const rawKey = q.page || q.key || "";
  const pageKey = resolvePageKey(rawKey);

  let items = loadPageData(pageKey);
  if (!Array.isArray(items)) items = [];

  items = filterByPSOM(items, pageKey);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      page: rawKey,
      resolvedPage: pageKey,
      count: items.length,
      items,
    }),
  };
}
