// feed-network.js (NETWORK HUB RIGHT PANEL - FINAL)

import fs from "fs/promises";
import path from "path";

// ================= CONFIG =================
const SNAPSHOT_NAME = "networkhub-snapshot.json";
const DEFAULT_LIMIT = 100;

// ================= CORS =================
function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function ok(body) {
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

// ================= DUMMY =================
function makeDummyItems(limit) {
  const out = [];

  for (let i = 1; i <= limit; i++) {
    out.push({
      id: "net-dummy-" + i,
      title: "Sample " + i,
      meta: "Network Hub",
      url: "#",
      thumb: "/assets/sample/placeholder.jpg"
    });
  }

  return out;
}

// ================= SNAPSHOT =================
function extractItems(snapshot) {

  // ✅ 정상 구조
  if (Array.isArray(snapshot?.items)) {
    return snapshot.items;
  }

  return [];
}

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
    path.join(dir, "data", SNAPSHOT_NAME),
    path.join(dir, "..", "data", SNAPSHOT_NAME),
    path.join(dir, "..", "..", "data", SNAPSHOT_NAME)
  ];
}

function siteBaseUrl() {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  );
}

async function fetchSnapshotHttp() {
  const base = siteBaseUrl();

  const urls = [];

  // 1) Netlify 환경 URL
  if (base) {
    urls.push(`${base.replace(/\/$/, "")}/data/networkhub-snapshot.json`);
    urls.push(`${base.replace(/\/$/, "")}/data/${SNAPSHOT_NAME}`);
  }

  // 2) 상대경로
  urls.push(`/data/networkhub-snapshot.json`);
  urls.push(`/data/${SNAPSHOT_NAME}`);

  // 3) 루트 직접 시도 (일부 빌드 대응)
  urls.push(`/networkhub-snapshot.json`);

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch (e) {}
  }

  console.warn('[FEED-NETWORK] snapshot not found (http)');
  return null;
}

async function loadSnapshot() {

  for (const p of fsCandidatePaths()) {
    const json = await readJsonIfExists(p);
    if (json) return json;
  }

  return await fetchSnapshotHttp();
}

// ================= HANDLER =================
export async function handler(event) {

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: ""
    };
  }

  const qs = event.queryStringParameters || {};

  const limitRaw = parseInt(qs.limit || DEFAULT_LIMIT, 10);

  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(1000, limitRaw))
    : DEFAULT_LIMIT;

  const snapshot = await loadSnapshot();

  // ✅ 스냅샷 없으면 → 더미
  if (!snapshot) {
    return ok({
      items: makeDummyItems(limit)
    });
  }

  const items = extractItems(snapshot);

  // ✅ 실데이터 없으면 → 더미
  if (!Array.isArray(items) || items.length === 0) {
    return ok({
      items: makeDummyItems(limit)
    });
  }

  // ✅ 실데이터 있으면 그대로
  return ok({
    items: items.slice(0, limit)
  });
}