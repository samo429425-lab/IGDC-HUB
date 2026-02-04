/**
 * media-feed.js (Netlify Function) — Search Bank FOLLOW version
 * 목적:
 *  - search-bank.snapshot.json을 직접 읽어서 media snapshot(sections[])을 생성
 *  - maruSearch 의존 제거 (Bank를 "정본"으로 간주)
 *  - 프론트 canonical 섹션키 유지
 *  - 데이터가 없으면 빈 배열로 반환(더미 유지) — "빈 문자열 아이템 25개" 생성 금지
 *
 * NOTE:
 *  - 이 함수는 "응답(JSON)"을 반환합니다. (Netlify 런타임 파일시스템에 쓰기 X)
 */

import fs from "fs/promises";
import path from "path";

/* ===============================
 * 1) FRONT CANONICAL SECTION KEYS
 * =============================== */
const FRONT_SECTION_KEYS = [
  "media-trending",
  "media-movie",
  "media-drama",
  "media-documentary",
  "media-animation",
  "media-music",
  "media-education",
];

/* ===============================
 * 2) FILE LOCATOR
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
    // 1) site root public/data (권장)
    path.join(cwd, "data", "search-bank.snapshot.json"),
    // 2) netlify/functions/data (정이사장님 구조)
    path.join(cwd, "netlify", "functions", "data", "search-bank.snapshot.json"),
    // 3) functions/data (프로젝트에 따라)
    path.join(cwd, "functions", "data", "search-bank.snapshot.json"),
    // 4) fallback: repo root
    path.join(cwd, "search-bank.snapshot.json"),
  ];
}

/* ===============================
 * 3) NORMALIZE (Bank item -> Snapshot item)
 * =============================== */
function normalizeFromBankItem(it) {
  const license =
    it?.rights?.license ||
    it?.license ||
    "public-domain";

  const publishedAt = it?.published_at || it?.publishedAt || null;

  const duration =
    (it?.media && typeof it.media.duration === "number") ? it.media.duration :
    (typeof it?.duration === "number" ? it.duration : 0);

  const url = it?.url || it?.video || "";

  return {
    id: it?.id || crypto.randomUUID(),
    title: it?.title || "",
    summary: it?.summary || "",
    thumbnail: it?.thumbnail || "",
    poster: it?.thumbnail || "",
    video: url,
    duration,
    publishedAt,
    license: { type: license },
    metrics: {
      like: 0,
      recommend: 0,
      watch: { views: 0, totalSeconds: 0, avgSeconds: 0 },
    },
    tags: Array.isArray(it?.tags) ? it.tags : [],
  };
}

/* ===============================
 * 4) BUILD MEDIA FEED FROM BANK
 * =============================== */
export async function buildMediaFeedFromBank() {
  const { data: bank, path: loadedPath } = await readJsonFirstHit(
    bankCandidatePaths()
  );

  const itemList = Array.isArray(bank?.items) ? bank.items : [];
  const itemById = new Map(itemList.map((x) => [x.id, x]));

  // 섹션별 id 목록(정본)
  const bySection = bank?.index?.by_section || {};
  const byChannel = bank?.index?.by_channel || {};

  // media channel ids (있으면 활용)
  const mediaIds = Array.isArray(byChannel?.media) ? byChannel.media : [];

  // 섹션 버킷
  const sectionBuckets = {};
  FRONT_SECTION_KEYS.forEach((k) => (sectionBuckets[k] = []));

  // 1) by_section 우선
  FRONT_SECTION_KEYS.forEach((k) => {
    const ids = Array.isArray(bySection?.[k]) ? bySection[k] : [];
    ids.forEach((id) => {
      const it = itemById.get(id);
      if (!it) return;
      // media 스냅샷은 video/thumbnail 중심
      const n = normalizeFromBankItem(it);
      // 최소 조건: thumbnail 또는 title 또는 video 중 하나는 있어야 의미 있음
      if (!(n.thumbnail || n.title || n.video)) return;
      sectionBuckets[k].push(n);
    });
  });

  // 2) 섹션에 아무것도 없고 mediaIds가 있으면 분배(보정)
  const hasAny =
    FRONT_SECTION_KEYS.some((k) => sectionBuckets[k].length > 0);

  if (!hasAny && mediaIds.length > 0) {
    let cursor = 0;
    mediaIds.forEach((id) => {
      const it = itemById.get(id);
      if (!it) return;
      const n = normalizeFromBankItem(it);
      if (!(n.thumbnail || n.title || n.video)) return;
      const key = FRONT_SECTION_KEYS[cursor % FRONT_SECTION_KEYS.length];
      sectionBuckets[key].push(n);
      cursor++;
    });
  }

  // HERO: 전체에서 간단 추출(최대 5)
  const all = FRONT_SECTION_KEYS.flatMap((k) => sectionBuckets[k]);
  const heroItems = all.slice(0, 5);

  const sections = FRONT_SECTION_KEYS.map((key) => ({
    key,
    title: key,
    policy: { maxItems: 25, autoRotate: true },
    items: sectionBuckets[key].slice(0, 25),
  }));

  return {
    meta: {
      type: "media-snapshot",
      version: "v1",
      generatedAt: new Date().toISOString(),
      source: "search-bank",
      bankPath: loadedPath,
      counts: {
        bankItems: itemList.length,
        mediaChannelIds: mediaIds.length,
        totalMediaItems: all.length,
      },
    },
    hero: {
      source: "derived",
      rule: "bank-first",
      items: heroItems,
    },
    sections,
  };
}

/* ===============================
 * 5) NETLIFY HANDLER
 * =============================== */
export const handler = async () => {
  try {
    const snapshot = await buildMediaFeedFromBank();
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body: JSON.stringify(snapshot),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "media-feed failed",
        message: e?.message || String(e),
      }),
    };
  }
};
