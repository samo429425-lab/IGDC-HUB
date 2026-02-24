// feed-network.js (NETWORK HUB RIGHT PANEL FEED - PRODUCTION)
// 목적: "중개기"만 수행
// - networkhub-snapshot.json 을 그대로 읽어 { items: [...] } 형태로 반환
// - 절대 더미/생성/자동 채움 없음 (스냅샷이 비면 items:[])
// - CORS + OPTIONS 지원
//
// Endpoint:
//   /.netlify/functions/feed-network?limit=100
// Response:
//   { items:[...] }

import fs from "fs/promises";
import path from "path";

const SNAPSHOT_NAME = "networkhub-snapshot.json";

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

function extractItems(snapshot) {
  // networkhub-snapshot.json canonical: { items:[...] }
  if (Array.isArray(snapshot?.items)) return snapshot.items;

  // fallback shapes (optional)
  const sections = snapshot?.pages?.network?.sections || snapshot?.sections || null;
  if (sections && Array.isArray(sections["right-network-100"])) return sections["right-network-100"];

  return null;
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
    path.join(cwd, "netlify", "functions", "data", SNAPSHOT_NAME),
    path.join(dir, "data", SNAPSHOT_NAME),
    path.join(dir, "..", "data", SNAPSHOT_NAME),
    path.join(dir, "..", "..", "data", SNAPSHOT_NAME),
    path.join(dir, "functions", "data", SNAPSHOT_NAME)
  ];
}

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

export async function handler(event) {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const limitRaw = parseInt((qs.limit || "100").trim(), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.min(1000, limitRaw)) : 100;

  const snapshot = await loadSnapshot();
  if (!snapshot) {
    // 운영: UI/오토맵이 죽지 않게 200 empty
    return ok({ items: [] });
  }

  // ===== fallback dummy 생성 =====
function makeDummyItems(limit){
  const out = [];
  for(let i=1;i<=limit;i++){
    out.push({
      id: "net-dummy-" + i,
      title: "Sample " + i,
      url: "#",
      thumb: "/assets/sample/placeholder.jpg"
    });
  }
  return out;
}

// ==============================

if (!Array.isArray(items) || items.length === 0) {

  // snapshot에 샘플도 없으면 더미 생성
  const limit = Number(qs.limit || 100);

  return ok({
    items: makeDummyItems(limit)
  });
}

  return ok({ items: items.slice(0, limit) });
}
