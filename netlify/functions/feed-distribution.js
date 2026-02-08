// feed-distribution.js (DISTRIBUTION FEED - PRODUCTION)
// - Reads snapshot via:
//   1) local FS (multiple candidate paths)
//   2) HTTP fetch from deployed site (/data/distribution.snapshot.json)
// - CORS enabled
// - OPTIONS preflight supported

import fs from "fs/promises";
import path from "path";

const SNAPSHOT_NAME = "distribution.snapshot.json";

// ---- CORS (allow secret/incognito too) ----
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

function extractSections(snapshot) {
  return snapshot?.pages?.distribution?.sections || snapshot?.sections || null;
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
  // Netlify functions run from a bundled directory; cwd/dirname differ by build.
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
  // Netlify provides these in most deploys
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "" // if empty, we will try relative fetch as last attempt
  );
}

async function fetchSnapshotOverHttp() {
  const base = guessSiteBaseUrl();

  // Try absolute first, then relative
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
  // FS candidates
  for (const p of fsCandidatePaths()) {
    const json = await readJsonIfExists(p);
    if (json) return json;
  }
  // HTTP fallback
  return await fetchSnapshotOverHttp();
}

export async function handler(event) {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const key = (qs.key || qs.section || "").trim();

  const snapshot = await loadSnapshot();
  if (!snapshot) {
    return err(500, "SNAPSHOT_NOT_FOUND", {
      hint: "Put /data/distribution.snapshot.json in site root AND/OR include snapshot accessible to function."
    });
  }

  const sections = extractSections(snapshot);
  if (!sections) {
    return err(500, "INVALID_SNAPSHOT_STRUCTURE", {
      hint: "Need snapshot.pages.distribution.sections"
    });
  }

  // Section specific request
  if (key) {
    const items = sections[key];
    if (!Array.isArray(items) || items.length === 0) {
      // 운영형: 404 대신 200 empty로 돌려서 UI가 죽지 않게
      return ok({ items: [] });
    }
    return ok({ items });
  }

  // All sections
  return ok({ sections });
}
