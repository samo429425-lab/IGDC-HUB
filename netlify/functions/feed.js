// netlify/functions/feed.js
// MARU Unified Feed (재설계본 - 2025-12-24)
// 목표: HTML(정본) 기준 key를 그대로 받아, data 폴더의 JSON을 안정적으로 매핑/집계하여 반환
// - 우선순위: {key}_front.json -> {key}.json -> (alias) 하이픈/언더바 치환 -> (aggregate) {key}-*.json / {key}_*.json
// - 내부 json.key 값은 신뢰하지 않고, items만 사용(현재 데이터가 파일명/키와 다를 수 있음)
// - 파일이 존재하나 items가 비어 있으면(0) 다음 후보를 계속 탐색 (front 껍데기 문제 대응)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 가능한 DATA_DIR 후보(배포/로컬 환경 차이 대응)
const DATA_DIR_CANDIDATES = [
  // 정석
  path.join(__dirname, "data"),
  // 프로젝트 루트 기준
  path.resolve("netlify/functions/data"),
  path.resolve("./netlify/functions/data"),
  // Netlify 런타임에서 cwd가 functions로 잡히는 경우
  path.resolve("./data"),
];

function firstExistingDir(dirs) {
  for (const d of dirs) {
    try {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) return d;
    } catch (_) {}
  }
  // 마지막 fallback: 첫 후보를 반환(읽기 시도는 하되, 없으면 null 처리)
  return dirs[0];
}

const DATA_DIR = firstExistingDir(DATA_DIR_CANDIDATES);

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function extractItems(json) {
  if (!json) return null;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json)) return json;
  return null;
}

function normalizeKey(k) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function keyAliases(key) {
  const aliases = new Set();
  aliases.add(key);

  // 언더바/하이픈 상호 치환
  aliases.add(key.replace(/_/g, "-"));
  aliases.add(key.replace(/-/g, "_"));

  // 일부 환경에서 URL encoding 영향 제거(안전)
  aliases.add(decodeURIComponent(key));

  return Array.from(aliases).filter(Boolean);
}

function candidateFilesForKey(key) {
  const files = [];
  const aliases = keyAliases(key);

  for (const k of aliases) {
    files.push(`${k}_front.json`);
    files.push(`${k}.json`);
  }
  return Array.from(new Set(files));
}

function listFilesSafe() {
  try {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR).filter((n) => n.toLowerCase().endsWith(".json"));
  } catch (_) {
    return [];
  }
}

function aggregateByPrefix(prefix) {
  const files = listFilesSafe();
  // prefix-*.json 또는 prefix_*.json
  const rx = new RegExp(`^${escapeRegExp(prefix)}[-_].+\\.json$`, "i");
  const matched = files.filter((f) => rx.test(f)).sort((a, b) => a.localeCompare(b));
  if (!matched.length) return null;

  const items = [];
  for (const f of matched) {
    const j = readJsonSafe(path.join(DATA_DIR, f));
    const arr = extractItems(j);
    if (Array.isArray(arr) && arr.length) items.push(...arr);
  }
  return items;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        body: JSON.stringify({ ok: false, key: "", count: 0, items: [], error: "no key provided" }),
      };
    }

    // 1) 직접 후보 파일 탐색(존재 + items non-empty 우선)
    const candidates = candidateFilesForKey(key);

    let best = null;
    let bestSource = null;

    for (const f of candidates) {
      const fp = path.join(DATA_DIR, f);
      const j = readJsonSafe(fp);
      const items = extractItems(j);
      if (Array.isArray(items) && items.length) {
        best = items;
        bestSource = f;
        break;
      }
      // items가 0이라도 “파일은 존재”했다면 source는 기억(디버깅용)
      if (j && !bestSource) bestSource = f;
    }

    // 2) 후보에서 못 찾았거나 모두 빈값이면 prefix 집계 시도
    if (!best) {
      // key alias 기준으로도 prefix 집계
      const prefixes = keyAliases(key);
      for (const p of prefixes) {
        const agg = aggregateByPrefix(p);
        if (Array.isArray(agg) && agg.length) {
          best = agg;
          bestSource = `${p}[-_]*.json (aggregate)`;
          break;
        }
      }
    }

    // 3) 그래도 없으면 빈 반환(에러 없음)
    const itemsOut = Array.isArray(best) ? best : [];

    // 옵션: limit
    const limit = Number(params.limit || 0);
    const sliced = limit > 0 ? itemsOut.slice(0, limit) : itemsOut;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        key,
        data_dir: DATA_DIR,
        source: bestSource || "(none)",
        count: sliced.length,
        items: sliced,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
}
