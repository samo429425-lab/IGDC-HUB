// netlify/functions/feed.js
// MARU Auto-Mapping Feed (정본)
// 역할: pageKey를 받아 functions/data/*_front.json을 안전하게 매핑하여 반환

import fs from "fs";
import path from "path";

// 1. pageKey → data file key alias 테이블
const PAGE_ALIAS = {
  // hub 계열
  distributionhub: "distribution",
  mediahub: "media",
  networkhub: "network",
  socialnetwork: "social",

  // 기본
  home: "home",
  donation: "donation",
  tour: "tour",
};

function resolveDataKey(pageKey = "") {
  const key = String(pageKey).toLowerCase();
  return PAGE_ALIAS[key] || key;
}

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const pageKey = params.page || params.key || "home";

    const dataKey = resolveDataKey(pageKey);
    const dataDir = path.resolve("netlify/functions/data");
    const filePath = path.join(dataDir, `${dataKey}_front.json`);

    if (!fs.existsSync(filePath)) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          page: pageKey,
          resolved: dataKey,
          count: 0,
          items: [],
          error: `data file not found: ${dataKey}_front.json`,
        }),
      };
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);

    const items = Array.isArray(json.items)
      ? json.items
      : Array.isArray(json)
      ? json
      : [];

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        page: pageKey,
        resolved: dataKey,
        count: items.length,
        items,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: err.message || String(err),
      }),
    };
  }
}
