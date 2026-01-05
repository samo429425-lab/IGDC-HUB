const fs = require("fs");
const path = require("path");

/**
 * feed.js (HOME compiler - unified sections)
 * - Handles: ?page=homeproducts
 * - Reads snapshot.internal.v1.json
 * - Merges main + right panels into ONE sections array
 * - Ensures 1:1 automap compatibility
 */

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  const page = event.queryStringParameters?.page;

  if (page !== "homeproducts") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({})
    };
  }

  const snapshot = safeReadJSON(SNAPSHOT_PATH);
  if (!snapshot || !Array.isArray(snapshot.sections)) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "snapshot missing or invalid" })
    };
  }

  const mainSections = [];
  const rightSections = [];

  for (const sec of snapshot.sections) {
    if (!sec || !sec.id) continue;

    // normalize id
    const id = sec.id.replace(/-/g, "_");

    // classify
    if (id.startsWith("home_right_")) {
      rightSections.push({ ...sec, id });
    } else if (id.startsWith("home_")) {
      mainSections.push({ ...sec, id });
    }
  }

  // ✅ 핵심: 모두 하나의 sections 배열로 합침
  const mergedSections = [
    ...mainSections,
    ...rightSections
  ];

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      meta: {
        page: "homeproducts",
        source: "snapshot.internal.v1",
        merged: true,
        total: mergedSections.length
      },
      sections: mergedSections
    })
  };
};
