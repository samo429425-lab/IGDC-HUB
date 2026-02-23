/* feed-network.FINAL.js */
/* Network Hub Feed - Snapshot Pass-Through / No Generate / No Dummy */

import fs from "fs/promises";
import path from "path";

const SNAPSHOT_NAME = "networkhub-snapshot.json";
const SECTION_KEY = "network-right";

/* CORS */
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

function err(code, hint) {
  return {
    statusCode: 500,
    headers: corsHeaders(),
    body: JSON.stringify({ error: code, hint })
  };
}

/* Snapshot extract */
function extractSections(snapshot) {
  return (
    snapshot?.pages?.network?.sections ||
    snapshot?.sections ||
    null
  );
}

/* FS paths */
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

async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* HTTP fallback */
function guessBaseUrl() {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  );
}

async function fetchSnapshotHttp() {

  const base = guessBaseUrl();
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

/* Loader */
async function loadSnapshot() {

  for (const p of fsCandidatePaths()) {
    const json = await readJsonIfExists(p);
    if (json) return json;
  }

  return await fetchSnapshotHttp();
}

/* Handler */
export async function handler(event) {

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: ""
    };
  }

  const snapshot = await loadSnapshot();

  if (!snapshot) {
    return err("SNAPSHOT_NOT_FOUND", "Put /data/networkhub-snapshot.json");
  }

  const sections = extractSections(snapshot);

  if (!sections) {
    return err("INVALID_SNAPSHOT_STRUCTURE", "Need pages.network.sections");
  }

  const items = sections[SECTION_KEY];

  /* Pass-through only */
  if (!Array.isArray(items) || items.length === 0) {
    return ok({ items: [] });
  }

  return ok({ items });
}
