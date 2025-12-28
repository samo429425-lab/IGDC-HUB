/**
 * netlify/functions/feed.js — v7 (SNAPSHOT-FIRST, HOME PRODUCTS SUPPORT)
 * - Reads ./data/snapshot.internal.v1.json
 * - If page/homeproducts requested: returns sections home-1..home-5 (and any matching home_* keys)
 * - If category=<id>: returns { meta, items } for that section
 * - Optional maru-search fallback with proper absolute URL (no localhost)
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");
const MARU_FN_PATH = "/.netlify/functions/maru-search";

function readJsonSafe(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (_) {}
  return null;
}

function normKey(k) {
  return String(k || "").trim();
}

function keyVariants(key) {
  const k = String(key || "").toLowerCase();
  const vars = new Set([k, k.replace(/_/g, "-"), k.replace(/-/g, "_")]);
  // common aliases
  if (k === "homeproducts") {
    vars.add("home-1"); vars.add("home_1"); vars.add("main-1"); vars.add("main_1");
  }
  return vars;
}

function getSectionItems(snapshot, sectionId) {
  if (!snapshot) return [];
  const vars = keyVariants(sectionId);
  // sections preferred
  if (Array.isArray(snapshot.sections)) {
    for (const sec of snapshot.sections) {
      const sid = String((sec && (sec.id || sec.sectionId) || "")).toLowerCase();
      if (!sid) continue;
      if (vars.has(sid)) {
        const arr = Array.isArray(sec.items) ? sec.items : (Array.isArray(sec.cards) ? sec.cards : []);
        return arr || [];
      }
    }
  }
  // legacy
  if (Array.isArray(snapshot.items)) return snapshot.items;
  return [];
}

function getHomeProductsPayload(snapshot) {
  // return 5 main rows as sections so automap can map them
  const out = { meta: { page: "homeproducts", source: "snapshot" }, sections: [] };
  for (let i = 1; i <= 5; i++) {
    // try home_1, home-1, main-1 etc.
    const items =
      getSectionItems(snapshot, `home_${i}`) ||
      getSectionItems(snapshot, `home-${i}`) ||
      [];
    out.sections.push({ id: `home_${i}`, items: items || [] });
  }
  // also include anything that already matches right panel keys if present in snapshot
  // (harmless if empty)
  ["home-right-top","home-right-middle","home-right-bottom"].forEach(id=>{
    const items = getSectionItems(snapshot, id);
    if (items && items.length) out.sections.push({ id, items });
  });
  return out;
}

async function fetchMaru(host, proto, domainKey) {
  try {
    const base = `${proto}://${host}`;
    const u = new URL(MARU_FN_PATH, base);
    u.searchParams.set("domain", domainKey);
    const r = await fetch(u.toString(), { headers: { "cache-control": "no-store" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

exports.handler = async function (event) {
  const qs = event.queryStringParameters || {};
  const page = normKey(qs.page);
  const category = normKey(qs.category);
  const key = category || page || "homeproducts";

  const snapshot = readJsonSafe(SNAPSHOT_PATH);

  // HOME PRODUCTS special: return 5 sections
  if ((page && page.toLowerCase() === "homeproducts") || key.toLowerCase() === "homeproducts") {
    const payload = getHomeProductsPayload(snapshot);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(payload)
    };
  }

  // Single category/section
  const items = getSectionItems(snapshot, key);
  if (items && items.length) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({ meta: { category: key, source: "snapshot" }, items })
    };
  }

  // Optional maru fallback (only if host is available)
  const host = (event.headers && (event.headers["x-forwarded-host"] || event.headers.host)) || "";
  const proto = (event.headers && (event.headers["x-forwarded-proto"])) || "https";
  if (host) {
    const maru = await fetchMaru(host, proto, key);
    if (maru && Array.isArray(maru.items) && maru.items.length) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({ meta: { category: key, source: "maru" }, items: maru.items })
      };
    }
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({ meta: { category: key, empty: true }, items: [] })
  };
};
