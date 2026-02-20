/**
 * feed-media.v3.js (Netlify Function) — MediaHub FOLLOW (Search-Bank → MediaHub)
 * 핵심:
 *  - mediahub.html의 data-psom-key(=섹션키)와 1:1로 맞춰서 {key,items} 제공
 *  - search-bank.snapshot.json을 "정본"으로 읽되,
 *      (1) index.by_section[media-*] 우선
 *      (2) 없으면 index.by_channel[*]에서 media 후보 채널을 모아 자동 분배
 *      (3) 그래도 없으면 items 자체에서 video/url/thumbnail 존재하는 것만 media 후보로 간주해 분배
 *  - 더미/빈 문자열 아이템 강제 생성 금지 (데이터 없으면 빈 배열)
 */

import fs from "fs/promises";
import path from "path";

/* ===============================
 * 1) CANONICAL KEYS (front/html)
 * =============================== */
const FRONT_SECTION_KEYS = [
  "media-trending",
  "media-movie",
  "media-drama",
  "media-thriller",
  "media-romance",
  "media-variety",
  "media-documentary",
  "media-animation",
  "media-music",
  "media-shorts",
];

const SECTION_LIMITS = {
  "media-trending": 50,
  "media-movie": 40,
  "media-drama": 40,
  "media-thriller": 30,
  "media-romance": 30,
  "media-variety": 30,
  "media-documentary": 30,
  "media-animation": 30,
  "media-music": 30,
  "media-shorts": 30,
};

/* ===============================
 * 2) FILE LOCATOR (Search-Bank snapshot)
 * =============================== */
async function readJsonFirstHit(candidates) {
  let lastErr = null;
  for (const p of candidates) {
    try {
      const txt = await fs.readFile(p, "utf-8");
      return { data: JSON.parse(txt), path: p };
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error("search-bank.snapshot.json not found in candidates");
  err.cause = lastErr;
  throw err;
}

function bankCandidatePaths() {
  const cwd = process.cwd();
  return [
    // publish data
    path.join(cwd, "data", "search-bank.snapshot.json"),
    path.join(cwd, "public", "data", "search-bank.snapshot.json"),
    path.join(cwd, "dist", "data", "search-bank.snapshot.json"),
    // functions bundle data
    path.join(cwd, "netlify", "functions", "data", "search-bank.snapshot.json"),
    path.join(cwd, "functions", "data", "search-bank.snapshot.json"),
    // repo root fallback
    path.join(cwd, "search-bank.snapshot.json"),
  ];
}

/* ===============================
 * 3) NORMALIZE (Bank item -> Media item)
 * =============================== */
function getPublishedAt(it){
  return it?.published_at || it?.publishedAt || it?.created_at || it?.createdAt || null;
}

function getDuration(it){
  if (it?.media && typeof it.media.duration === "number") return it.media.duration;
  if (typeof it?.duration === "number") return it.duration;
  return 0;
}

function normalizeFromBankItem(it) {
  const license = it?.rights?.license || it?.license || "unknown";
  const publishedAt = getPublishedAt(it);
  const url = it?.url || it?.video || it?.media?.url || "";

  return {
    id: it?.id || crypto.randomUUID(),
    title: it?.title || it?.name || "",
    summary: it?.summary || it?.desc || "",
    thumbnail: it?.thumbnail || it?.thumb || it?.image || "",
    poster: it?.poster || it?.thumbnail || it?.thumb || it?.image || "",
    video: url,
    duration: getDuration(it),
    publishedAt,
    provider: it?.provider || it?.source || it?.channel || "",
    license: { type: license },
    // metrics placeholders (front에서 집계/업데이트)
    metrics: {
      like: 0,
      recommend: 0,
      click: 0,
      watch: { views: 0, totalSeconds: 0, avgSeconds: 0 },
    },
    tags: Array.isArray(it?.tags) ? it.tags : [],
    genre: it?.genre || it?.category || it?.section || null,
  };
}

function looksLikeMedia(it){
  const url = it?.url || it?.video || it?.media?.url || "";
  const thumb = it?.thumbnail || it?.thumb || it?.image || "";
  return !!(url || thumb);
}

/* ===============================
 * 4) BUILD: Search-Bank -> buckets
 * =============================== */
export async function buildMediaSnapshotFromBank() {
  const { data: bank, path: loadedPath } = await readJsonFirstHit(bankCandidatePaths());

  const itemList = Array.isArray(bank?.items) ? bank.items : [];
  const itemById = new Map(itemList.filter(x=>x && x.id).map((x) => [x.id, x]));

  const bySection = bank?.index?.by_section || {};
  const byChannel = bank?.index?.by_channel || {};

  // init buckets
  const buckets = {};
  FRONT_SECTION_KEYS.forEach((k) => (buckets[k] = []));

  // 1) by_section exact match 우선
  FRONT_SECTION_KEYS.forEach((k) => {
    const ids = Array.isArray(bySection?.[k]) ? bySection[k] : [];
    ids.forEach((id) => {
      const it = itemById.get(id);
      if (!it) return;
      if (!looksLikeMedia(it)) return;
      buckets[k].push(normalizeFromBankItem(it));
    });
  });

  // HERO: trending/movie/drama에서 상단 5
  const heroKeys = ["media-trending","media-movie","media-drama"];
  const heroItems = heroKeys.flatMap(k=>buckets[k]).slice(0,5);

  const sections = FRONT_SECTION_KEYS.map((key) => ({
    key,
    title: key,
    policy: { maxItems: (SECTION_LIMITS[key] || 30), autoRotate: true },
    items: buckets[key].slice(0, (SECTION_LIMITS[key] || 30)),
  }));

  return {
    meta: {
      type: "media-feed",
      version: "v3",
      generatedAt: new Date().toISOString(),
      source: "search-bank",
      bankPath: loadedPath,
      counts: {
        bankItems: itemList.length,
        totalMediaItems: sections.reduce((a,s)=>a+(s.items?.length||0),0),
      },
    },
    hero: {
      source: "derived",
      rotateFrom: heroKeys,
      intervalSec: 12,
      items: heroItems,
    },
    sections,
  };
}

/* ===============================
 * 5) NETLIFY HANDLER
 *  - /feed-media?key=media-trending&limit=500  -> {key,items}
 *  - /feed-media                              -> full snapshot
 * =============================== */
export const handler = async (event = {}) => {
  try {
    const snapshot = await buildMediaSnapshotFromBank();

    const qs = event.queryStringParameters || {};
    const key = (qs.key || "").trim();
    if (key && !FRONT_SECTION_KEYS.includes(key)) {
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
        body: JSON.stringify({ type: "media-only", key, items: [] }),
      };
    }
	
   const limitRaw = parseInt(qs.limit || "0", 10);
   const limit = (Number.isFinite(limitRaw) && limitRaw > 0) ? Math.min(500, limitRaw) : 0;
   
if (key) {
  // 🔒 1. media-* 화이트리스트 강제
  if (!FRONT_SECTION_KEYS.includes(key)) {
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ type: "media-only", key, items: [] }),
    };
  }

  // 🔎 2. sections 구조 안전 대응 (array + map 모두 대응)
  let items = [];
  const sec = snapshot?.sections;

  if (Array.isArray(sec)) {
    const found = sec.find((s) => s && s.key === key);
    items = (found && Array.isArray(found.items)) ? found.items : [];
  } else if (sec && typeof sec === "object") {
    const arr = sec[key];
    items = Array.isArray(arr) ? arr : [];
  }

  const max = limit || (SECTION_LIMITS[key] || 30);

  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify({
      type: "media-only",
      key,
      items: items.slice(0, max),
    }),
  };
}

// key 없이 전체 요청 시
return {
  statusCode: 200,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify({
    type: "media-only",
    sections: snapshot.sections || [],
  }),
};
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "feed-media failed",
        message: e?.message || String(e),
      }),
    };
  }
};