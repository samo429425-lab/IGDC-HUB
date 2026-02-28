// feed-tour.js (TOUR HUB FEED - FINAL / ISOLATED)
// - Hard-lock: ONLY reads /data/tour-snapshot.json (FS multi-path + HTTP fallback)
// - Hard-lock: meta.hub must be "tour" (else stop)
// - Returns ONLY { items: [...] }  (no other hub, no other sections)
// - CORS + OPTIONS supported

import fs from "fs/promises";
import path from "path";

const SNAPSHOT_NAME = "tour-snapshot.json";
const EXPECTED_HUB = "tour";

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
    const title = pick(it, ["title", "name", "label"]);
    const thumb = pick(it, ["thumb", "image", "thumbnail", "img", "photo", "cover"]);
    const link = pick(it, ["link", "url", "href"]) || "#";
    const id = pick(it, ["id", "pid", "productId"]);

    // 운영 안전: title/thumb 없으면 스킵 (오토맵에서 더미로 채움)
    if (!title || !thumb) continue;

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
    return err(500, "SNAPSHOT_NOT_FOUND", { hint: "Need /data/tour-snapshot.json" });
  }

  // ✅ HUB HARD LOCK (남의집 손님 차단)
  const gotHub = snapshot?.meta?.hub;
  if (gotHub !== EXPECTED_HUB) {
    return err(500, "HUB_MISMATCH", { expected: EXPECTED_HUB, got: gotHub || "" });
  }

  const items = normalizeItems(snapshot?.items, limit);
  return ok({ items });
}