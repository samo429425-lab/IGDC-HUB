const fs = require("fs");
const path = require("path");

/**
 * feed.home.js
 * HOME snapshot compiler (non-destructive)
 * - Only handles ?page=homeproducts
 * - Reads snapshot.internal.v1.json
 * - Other routes remain untouched when you merge manually
 */

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function normalizeSectionItems(section) {
  if (!section) return [];
  if (Array.isArray(section.items)) return section.items;
  if (Array.isArray(section.cards)) return section.cards;
  return [];
}

exports.handler = async function (event) {
  const qs = event.queryStringParameters || {};
  const page = String(qs.page || "").toLowerCase();

  // ===============================
  // HOME SNAPSHOT COMPILER
  // ===============================
  if (page === "homeproducts") {
    const snapshot = safeReadJSON(SNAPSHOT_PATH) || {};
    const sections = [];

    if (Array.isArray(snapshot.sections)) {
      for (const sec of snapshot.sections) {
        const id = String(sec.id || "").trim();
        if (!id) continue;

        sections.push({
          id,
          items: normalizeSectionItems(sec)
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
          compiled: true
        },
        sections
      })
    };
  }

  // fallback (leave existing behavior intact)
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({})
  };
};
