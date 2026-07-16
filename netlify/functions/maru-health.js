/**
 * MARU HEALTH — NETLIFY FUNCTIONS STABLE
 * ------------------------------------
 * 목적:
 * - 플랫폼 기본 헬스 체크
 * - Netlify Functions 독립 실행 보장
 * - 외부 의존성 없음
 *
 * 사용처:
 * - /.netlify/functions/maru-health
 * - IGDC Admin 상태 카드
 * - 외부 모니터링
 */

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify({
      ok: true,
      service: "maru-platform",
      env: process.env.CONTEXT || "unknown",
      ts: new Date().toISOString()
    })
  };
};
