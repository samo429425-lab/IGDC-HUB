// feed-network.js (NETWORK HUB FEED - PRODUCTION)
// - Right panel only (no main sections)
// - Reads snapshot via:
//   1) local FS (multi-path)
//   2) HTTP fetch fallback from deployed site (/data/networkhub-snapshot.json)
// - CORS enabled
// - OPTIONS preflight supported

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

function extractItems(snapshot) {
  // Network hub snapshot is expected to be { type, items: [...] }
  const items = snapshot?.items;
  return Array.isArray(items) ? items : [];
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const key = String(qs.key || "rightpanel").trim();
  const limit = Math.max(1, Math.min(500, parseInt(qs.limit || "100", 10) || 100));

  const snapshot = await loadSnapshot();
  if (!snapshot) {
    return err(500, "SNAPSHOT_NOT_FOUND", {
      hint: "Put /data/networkhub-snapshot.json in site root AND/OR include snapshot accessible to function."
    });
  }

  const items = extractItems(snapshot).slice(0, limit);

  // Right panel only
  if (key) {
    // 운영형: 404 대신 200 empty로 돌려서 UI가 죽지 않게
    return ok({ items });
  }

  return ok({ sections: { rightpanel: items } });
}
