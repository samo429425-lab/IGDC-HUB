// feed-social.js (SOCIAL FEED - PRODUCTION SAFE)
// - Mirrors feed-distribution.js behavior
// - Reads snapshot via:
//   1) local FS (multiple candidate paths)
//   2) HTTP fetch from deployed site (/data/social.snapshot.json)
// - CORS enabled
// - OPTIONS preflight supported

import fs from "fs/promises";
import path from "path";

const SNAPSHOT_NAME = "social.snapshot.json";

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

function extractSections(snapshot) {
  // ✅ latest: social.snapshot.json uses placeholder_cards
  if (snapshot?.placeholder_cards && typeof snapshot.placeholder_cards === "object") {
    return snapshot.placeholder_cards;
  }

  // compat: snapshot.pages.social.placeholder_cards
  if (snapshot?.pages?.social?.placeholder_cards) {
    return snapshot.pages.social.placeholder_cards;
  }

  // legacy: snapshot.pages.social.sections
  return snapshot?.pages?.social?.sections || snapshot?.sections || null;
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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const key = (qs.key || qs.section || "").trim();

  const snapshot = await loadSnapshot();
  if (!snapshot) {
    return err(500, "SNAPSHOT_NOT_FOUND", {
      hint: "Put /data/social.snapshot.json in site root AND/OR make it accessible to the function."
    });
  }

  const sections = extractSections(snapshot);
  if (!sections) {
    return err(500, "INVALID_SNAPSHOT_STRUCTURE", {
      hint: "Need snapshot.pages.social.sections OR snapshot.sections"
    });
  }

  // Section specific request
  if (key) {
    const items = sections[key];
    if (!Array.isArray(items) || items.length === 0) {
      return ok({ items: [] });
    }
    return ok({ items });
  }

  // All sections
  return ok({ sections });
}
