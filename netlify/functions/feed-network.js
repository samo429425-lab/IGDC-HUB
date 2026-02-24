// feed-network.js (NETWORK HUB RIGHT PANEL FEED - PATCHED)
// 역할: 중개기 전용
// - networkhub-snapshot.json에서 정확한 section을 찾아 반환
// - 생성 / 더미 / 자동채움 절대 없음
// - section 파라미터 지원

import fs from "fs/promises";
import path from "path";

const SNAPSHOT_NAME = "networkhub-snapshot.json";

function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function ok(body) {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) };
}

async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, "utf-8");
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

async function loadSnapshot() {
  for (const p of fsCandidatePaths()) {
    const json = await readJsonIfExists(p);
    if (json) return json;
  }
  return null;
}

function extractItems(snapshot, key) {

  // Flat snapshot: { items:[...] }
  if (Array.isArray(snapshot?.items)) return snapshot.items;

  // Sectioned snapshot
  const sections = snapshot?.pages?.network?.sections || snapshot?.sections || null;

  if (sections && key && Array.isArray(sections[key])) {
    return sections[key];
  }

  return [];
}

export async function handler(event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const section = (qs.section || "").trim();

  const snapshot = await loadSnapshot();
  if (!snapshot) return ok({ items: [] });

  const items = extractItems(snapshot, section);

  if (!Array.isArray(items) || items.length === 0) {
    return ok({ items: [] });
  }

  return ok({ items });
}
