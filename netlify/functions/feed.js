/**
 * feed.js — HOME mapping enabled (safe additive version)
 * Only handles ?page=homeproducts
 * Other pages fall through with empty payload
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.json");

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return {};
  }
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  return [];
}

function getSection(snapshot, id) {
  if (!snapshot) return [];
  if (Array.isArray(snapshot.sections)) {
    const s = snapshot.sections.find(x => String(x.id) === id);
    if (s) return toArray(s.items);
  }
  return [];
}

exports.handler = async function(event) {
  const qs = event.queryStringParameters || {};
  const page = String(qs.page || "").toLowerCase();

  // === HOME ONLY ===
  if (page === "homeproducts") {
    const snapshot = readJsonSafe(SNAPSHOT_PATH);

    const keys = [
      "home_1",
      "home_2",
      "home_3",
      "home_4",
      "home_5",
      "home_right_top",
      "home_right_middle",
      "home_right_bottom"
    ];

    const sections = keys.map(id => ({
      id,
      items: getSection(snapshot, id)
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        meta: { page: "homeproducts", source: "snapshot" },
        sections
      })
    };
  }

  // fallback (do not break other logic)
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  };
};
