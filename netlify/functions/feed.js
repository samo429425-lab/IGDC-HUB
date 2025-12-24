// netlify/functions/feed.js
// MARU Unified Feed (정본)
// 역할:
// 1) 우측 패널용: {page}_front.json 유지
// 2) 메인 섹션용: data-psom-key 그대로 {key}.json 매핑
// 규칙:
// - 프론트에서 전달된 key 값을 그대로 사용
// - *_front.json 이 존재하면 우선 사용
// - 없으면 {key}.json 시도
// - 둘 다 없으면 빈 items 반환 (에러 없음)

import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("netlify/functions/data");

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function normalizeItems(json) {
  if (!json) return [];
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json)) return json;
  return [];
}

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const key = (params.key || params.page || "").toLowerCase();

    if (!key) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          key: "",
          count: 0,
          items: [],
          error: "no key provided",
        }),
      };
    }

    // 1) 우측 패널용 *_front.json 시도
    const frontPath = path.join(DATA_DIR, `${key}_front.json`);
    let json = readJsonSafe(frontPath);
    let source = `${key}_front.json`;

    // 2) 없으면 개별 PSOM 키 json 시도
    if (!json) {
      const directPath = path.join(DATA_DIR, `${key}.json`);
      json = readJsonSafe(directPath);
      source = `${key}.json`;
    }

    const items = normalizeItems(json);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        key,
        source,
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
