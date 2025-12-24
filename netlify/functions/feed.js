// netlify/functions/feed.js
// MARU Unified Feed (정정본 - 2025-12-24)
// 목적: HTML key(정본)를 받아 data 폴더 JSON을 안정적으로 반환
// - 기본: {key}.json 우선
// - 보조: {key}_front.json (단, key가 이미 *_front 인 경우 중복 front 방지)
// - key가 *_front / *-front 로 들어오면 suffix를 제거한 base도 함께 탐색
// - JSON 구조: items / sections(내부 items) 모두 지원
// - 비어 있어도 정상 반환 (에러 없음)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR_CANDIDATES = [
  path.join(__dirname, "data"),
  path.resolve("netlify/functions/data"),
  path.resolve("./netlify/functions/data"),
  path.resolve("./data"),
];

function resolveDataDir() {
  for (const d of DATA_DIR_CANDIDATES) {
    try {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) return d;
    } catch {}
  }
  return DATA_DIR_CANDIDATES[0];
}

const DATA_DIR = resolveDataDir();

function readJsonSafe(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

function extractItems(json) {
  if (!json) return [];
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.sections)) {
    const out = [];
    for (const s of json.sections) {
      if (s && Array.isArray(s.items)) out.push(...s.items);
    }
    return out;
  }
  if (Array.isArray(json)) return json;
  return [];
}

function normalizeKey(k) {
  return String(k || "").trim().toLowerCase();
}

function stripFrontSuffix(key) {
  if (key.endsWith("_front")) return { base: key.slice(0, -6), had: true };
  if (key.endsWith("-front")) return { base: key.slice(0, -6), had: true };
  return { base: key, had: false };
}

function candidateFiles(key) {
  const files = [];
  const k = normalizeKey(key);
  const { base, had } = stripFrontSuffix(k);

  // 1) {key}.json 우선 (tour.json 같은 케이스)
  files.push(`${k}.json`);

  // 2) {key}_front.json (단, 이미 *_front면 중복 방지)
  if (!had) files.push(`${k}_front.json`);

  // 3) key가 *_front로 들어온 경우: base도 탐색
  if (had && base) {
    files.push(`${base}.json`);
    files.push(`${base}_front.json`);
  }

  // 중복 제거
  return Array.from(new Set(files));
}

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const rawKey = params.key ?? params.page ?? "";
    const key = normalizeKey(rawKey);

    if (!key) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, key: "", source: null, count: 0, items: [] }),
      };
    }

    let source = null;
    let items = [];

    for (const f of candidateFiles(key)) {
      const fp = path.join(DATA_DIR, f);
      const json = readJsonSafe(fp);
      if (json) {
        source = f;
        items = extractItems(json);
        break;
      }
    }

    // 옵션: limit
    const limit = Number(params.limit || 0);
    const out = limit > 0 ? items.slice(0, limit) : items;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, key, source, count: out.length, items: out }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
}
