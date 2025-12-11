// netlify/functions/feed.js
// IGDC 통합 오토매핑용 feed API
// ?page=home | distribution | social | network | tourpage | donation | media

const fs = require("fs");
const path = require("path");

/**
 * 안전하게 JSON 파일을 읽는 헬퍼
 */
function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[feed] Failed to read JSON: ${filePath}`, err);
    return fallback;
  }
}

/**
 * pages.json 정본 위치
 * (이미 정리해 두신 pages.json을 이 위치에 복사해 두셨다고 가정)
 */
const PAGES_JSON_PATH = path.join(__dirname, "pages.json");

/**
 * 카드 데이터 저장 폴더
 * 예: netlify/functions/data/home.json, social.json, ...
 * - overrides: 관리자 고정 카드
 * - auto:      AI 오토매핑 카드
 */
const DATA_DIR = path.join(__dirname, "data");

/**
 * pageKey에 해당하는 페이지 설정 가져오기
 */
function getPageConfig(pageKey) {
  const pagesConfig = safeReadJson(PAGES_JSON_PATH, {});
  if (!pagesConfig || typeof pagesConfig !== "object") return null;
  return pagesConfig[pageKey] || null;
}

/**
 * pageKey에 해당하는 카드 데이터 로드
 * 구조 예시 (data/home.json):
 * {
 *   "overrides": {
 *     "main-1": [ { ...card }, ... ],
 *     "ad-top": [ { ...card } ]
 *   },
 *   "auto": {
 *     "main-1": [ { ...card }, ... ],
 *     "ad-top": [ { ...card }, ... ]
 *   }
 * }
 */
function loadPageCards(pageKey) {
  const filePath = path.join(DATA_DIR, `${pageKey}.json`);
  const fallback = { overrides: {}, auto: {} };
  const data = safeReadJson(filePath, fallback);

  // 필드 안전 보정
  return {
    overrides: data.overrides && typeof data.overrides === "object" ? data.overrides : {},
    auto: data.auto && typeof data.auto === "object" ? data.auto : {}
  };
}

/**
 * 섹션별 카드 목록 병합
 * - override 카드가 항상 상단에 오고
 * - 그 뒤에 auto 카드가 이어 붙음
 */
function buildSections(pageKey, pageConfig) {
  const { sections = [] } = pageConfig;
  const pageCards = loadPageCards(pageKey);

  return sections.map((section) => {
    const sectionId = section.id;
    const sectionTitle = section.title || "";

    const overrideCards = pageCards.overrides[sectionId] || [];
    const autoCards = pageCards.auto[sectionId] || [];

    // override 먼저, 그 다음 auto
    const mergedCards = [...overrideCards, ...autoCards];

    return {
      id: sectionId,
      title: sectionTitle,
      items: mergedCards
    };
  });
}

/**
 * Netlify Function Handler
 */
exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const rawPage = (qs.page || "home").toString().trim().toLowerCase();

    // page 키 통일 (pages.json 키와 맞춰야 함)
    const pageKey = rawPage;

    const pageConfig = getPageConfig(pageKey);
    if (!pageConfig) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          ok: false,
          error: "PAGE_NOT_FOUND",
          message: `Unknown page key: ${pageKey}`
        })
      };
    }

    const sections = buildSections(pageKey, pageConfig);

    const responsePayload = {
      ok: true,
      page: pageKey,
      title: pageConfig.title || "",
      sections,
      updatedAt: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(responsePayload)
    };
  } catch (err) {
    console.error("[feed] Unhandled error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        error: "INTERNAL_ERROR",
        message: "Unexpected error in feed function"
      })
    };
  }
};
