/**
 * /netlify/functions/social-feed.js
 * Social Snapshot → Feed Adapter v1
 */

"use strict";

const fs = require("fs");
const path = require("path");

// snapshot 위치 (환경에 맞게 조정 가능)
const SNAPSHOT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "social.snapshot.v1.json"
);

function loadSnapshot() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

exports.handler = async function (event) {
  try {
    const snapshot = loadSnapshot();

    if (!snapshot || !snapshot.items) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          status: "error",
          message: "SNAPSHOT_NOT_FOUND",
        }),
      };
    }

    const qs = event.queryStringParameters || {};
    const section = qs.section || null;
    const limit = parseInt(qs.limit || "100", 10);

    let items = snapshot.items;

    // 섹션 필터
    if (section) {
      items = items.filter((it) => it.section === section);
    }

    // 제한
    items = items.slice(0, limit);

    // UI용 feed 포맷
    const feed = {
      status: "ok",
      engine: "social-feed",
      version: "v1",
      generated_at: new Date().toISOString(),
      section: section,
      count: items.length,

      grid: {
        sections: snapshot.index.by_section || {},
      },

      items: items.map((it) => ({
        id: it.id,
        title: it.title,
        summary: it.summary,
        url: it.url,
        thumbnail: it.thumbnail,
        platform: it.source?.platform || null,
        account: it.extension?.account || null,
        score: it.quality?.rank || 0,
        lang: it.lang || "en",
      })),
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(feed),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        status: "error",
        message: e.message,
      }),
    };
  }
};
