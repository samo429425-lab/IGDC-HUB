// feed-tour.js (TOUR HUB FEED - PRODUCTION)
// - Right panel + mobile rail common feed
// - Reads snapshot via:
//   1) local FS (multi-path)
//   2) HTTP fetch fallback from deployed site (/data/tour-snapshot.json)
// - CORS enabled
// - OPTIONS preflight supported

import fs from "fs/promises";
import path from "path";

const SNAPSHOT_NAME = "tour-snapshot.json";

// ---- CORS ----
function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function ok(bodyObj) {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(bodyObj) };
}

function err(statusCode, code, extra = {}) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ error: code, ...extra })
  };
}

// ---- 1) FS read (multi-path) ----
async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fsCandidatePaths() {
  const cwd = process.cwd();
  const dir = typeof __dirname === "string" ? __dirname : cwd;

  return [
    path.join(cwd, "data", SNAPSHOT_NAME),
    path.join(cwd, "netlify", "functions", "data", SNAPSHOT_NAME),
    path.join(dir, "data", SNAPSHOT_NAME),
    path.join(dir, "..", "data", SNAPSHOT_NAME),
    path.join(dir, "..", "..", "data", SNAPSHOT_NAME),
    path.join(dir, "functions", "data", SNAPSHOT_NAME)
  ];
}

// ---- 2) HTTP fetch fallback ----
function guessSiteBaseUrl() {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  );
}

async function fetchSnapshotOverHttp() {
  const base = guessSiteBaseUrl();
  const urls = [];
  if (base) urls.push(`${base.replace(/\/$/, "")}/data/${SNAPSHOT_NAME}`);
  urls.push(`/data/${SNAPSHOT_NAME}`);

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // ignore
    }
  }
  return null;
}

async function loadSnapshot() {
  for (const p of fsCandidatePaths()) {
    const json = await readJsonIfExists(p);
    if (json) return json;
  }
  return await fetchSnapshotOverHttp();
}

// ---- item normalize/validate ----
function pick(it, keys) {
  for (const k of keys) {
    const v = it && it[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalizeItems(raw, limit) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const it of arr) {
    const thumb = pick(it, ["thumb", "image", "thumbnail", "img", "photo", "cover"]);
    const title = pick(it, ["title", "name", "label"]);
    const link = pick(it, ["link", "url", "href"]) || "#";
    const id = pick(it, ["id", "pid", "productId"]);

    // ✅ 최종 운영 안전 규칙: thumb+title 없으면 drop (빈 슬롯 방지)
    if (!thumb || !title) continue;

    out.push({ id, title, thumb, link });
    if (out.length >= limit) break;
  }
  return out;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const limit = Math.max(1, Math.min(500, parseInt(qs.limit || "100", 10) || 100));

  const snapshot = await loadSnapshot();
  if (!snapshot) {
    return err(500, "SNAPSHOT_NOT_FOUND", {
      hint: "Put /data/tour-snapshot.json in site root AND/OR include snapshot accessible to function."
    });
  }

  // ✅ hub strict check
  const hub = snapshot?.meta?.hub;
  if (hub !== "tour") {
    return err(500, "HUB_MISMATCH", { expected: "tour", got: hub || "" });
  }

  const rawItems = snapshot?.items;
  const items = normalizeItems(rawItems, limit);

  // 운영형: UI가 죽지 않게 200 empty로 반환
  return ok({ items });
}