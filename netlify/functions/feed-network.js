// feed-network.js (NETWORK HUB RIGHT PANEL FEED - FINAL)
// 역할: 중개기
// - networkhub-snapshot.json → items 추출
// - 실데이터 없으면 샘플(dummy) 생성
// - 오토맵이 그대로 받아 HTML에 꽂도록 전달

import fs from "fs/promises";
import path from "path";

// ================== CONFIG ==================
const SNAPSHOT_NAME = "networkhub-snapshot.json";
const DEFAULT_LIMIT = 100;

// ================== CORS ====================
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

// ================= SNAPSHOT =================
function extractItems(snapshot) {
  if (Array.isArray(snapshot?.items)) {
    return snapshot.items;
  }

  // 예비 구조 대응
  const sections =
    snapshot?.pages?.network?.sections ||
    snapshot?.sections ||
    null;

  if (sections && Array.isArray(sections["right-network-100"])) {
    return sections["right-network-100"];
  }

  return [];
}

function makeDummyItems(limit) {
  const out = [];
  for (let i = 1; i <= limit; i++) {
    out.push({
      id: `net-dummy-${i}`,
      title: `Sample ${i}`,
      meta: "Network Hub",
      url: "#",
      thumb: "/assets/sample/placeholder.jpg"
    });
  }
  return out;
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

  if (base) urls.push(`${base.replace(/\/$/, "")}/data/${SNAPSHOT_NAME}`);
  urls.push(`/data/${SNAPSHOT_NAME}`);

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch {}
  }
  return null;
}

async function loadSnapshot() {
  for (const p of fsCandidatePaths()) {
    const json = await readJsonIfExists(p);
    if (json) return json;
  }
  return await fetchSnapshotHttp();
}

// ================= HANDLER ==================
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const limitRaw = parseInt(qs.limit || DEFAULT_LIMIT, 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(1000, limitRaw))
    : DEFAULT_LIMIT;

  const snapshot = await loadSnapshot();

  // 스냅샷 자체가 없을 때도 샘플 제공
  if (!snapshot) {
    return ok({ items: makeDummyItems(limit) });
  }

  const items = extractItems(snapshot);

  // 실데이터 없으면 샘플
  if (!Array.isArray(items) || items.length === 0) {
    return ok({ items: makeDummyItems(limit) });
  }

  // 실데이터 있으면 그대로
  return ok({ items: items.slice(0, limit) });
}