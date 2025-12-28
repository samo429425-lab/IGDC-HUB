
const fs = require("fs");
const path = require("path");

/**
 * feed.js (patched: homeproducts underscore-normalized)
 * - Keeps original structure
 * - Only adjusts HOME branch
 * - Normalizes section id to underscore
 */

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function normalizeId(id) {
  if (!id) return "";
  return String(id).trim().replace(/-/g, "_");
}

function normalizeItems(section) {
  if (!section) return [];
  if (Array.isArray(section.items)) return section.items;
  if (Array.isArray(section.cards)) return section.cards;
  return [];
}

exports.handler = async function (event) {
  const qs = event.queryStringParameters || {};
  const page = String(qs.page || "").toLowerCase();

  // === HOME PRODUCTS PATCH (SAFE EXTENSION) ===
  if (page === "homeproducts") {
    const snapshot = safeReadJSON(SNAPSHOT_PATH) || {};
    const sections = [];

    if (Array.isArray(snapshot.sections)) {
      for (const sec of snapshot.sections) {
        const rawId = sec.id || "";
        const id = normalizeId(rawId);
        if (!id) continue;

        sections.push({
          id,
          items: normalizeItems(sec)
        });
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        meta: {
          page: "homeproducts",
          source: "snapshot",
          normalized: true
        },
        sections
      })
    };
  }

  // fallback – keep existing behavior
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({})
  };
};
