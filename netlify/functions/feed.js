
/**
 * feed.js — v6 FINAL (SNAPSHOT + MARU HYBRID)
 * Purpose:
 * 1) Serve snapshot.internal.v1.json FIRST (guaranteed data)
 * 2) Fallback to maru-search if snapshot empty
 * 3) Always return { sections, items }
 */

const path = require("path");
const fs = require("fs");

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");
const MARU_ENDPOINT = "/.netlify/functions/maru-search";

function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

function normalizeFromSnapshot(snapshot, key) {
  if (!snapshot) return { meta: { category: key }, items: [] };

  if (Array.isArray(snapshot.sections)) {
    const found = snapshot.sections.find(
      s => (s.id || "").toLowerCase() === key.toLowerCase()
    );
    if (found && Array.isArray(found.items)) {
      return { meta: { category: key }, items: found.items };
    }
  }

  if (Array.isArray(snapshot.items)) {
    return { meta: { category: key }, items: snapshot.items };
  }

  return { meta: { category: key }, items: [] };
}

async function fetchMaru(event, key) {
  try {
    const url = new URL(MARU_ENDPOINT, "http://localhost");
    url.searchParams.set("domain", key);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

exports.handler = async function (event) {
  const key =
    event.queryStringParameters?.category ||
    event.queryStringParameters?.page ||
    "home-1";

  // 1️⃣ SNAPSHOT FIRST (authoritative)
  const snapshot = loadSnapshot();
  const snapResult = normalizeFromSnapshot(snapshot, key);

  if (snapResult.items && snapResult.items.length > 0) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapResult)
    };
  }

  // 2️⃣ MARU SEARCH FALLBACK
  const maru = await fetchMaru(event, key);
  if (maru && Array.isArray(maru.items) && maru.items.length) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meta: { category: key, source: "maru" },
        items: maru.items
      })
    };
  }

  // 3️⃣ EMPTY SAFE RESPONSE
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meta: { category: key, empty: true },
      items: []
    })
  };
};
