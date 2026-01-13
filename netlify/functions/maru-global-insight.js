/**
 * Netlify Function: maru-global-insight.js
 * -------------------------------------------------
 * ROLE
 *  - Execute MARU Global Insight on explicit request
 *  - Server-side engine endpoint for Add-on
 *
 * METHOD
 *  - POST only
 *
 * INPUT (JSON body)
 * {
 *   context: 'global-insight',
 *   scope: 'global' | 'region' | 'country',
 *   timeline: ['year','month','week','today','integrated'],
 *   include: ['summary','regions','countries','critical','videos','voice'],
 *   locale: 'ko-KR'
 * }
 *
 * OUTPUT (JSON)
 * {
 *   today,
 *   globalSummary,
 *   regions: [{ id, today, critical }],
 *   countries: [{ code, today, critical }],
 *   meta: { ts, request_id }
 * }
 * -------------------------------------------------
 */

const { nowIso, requestId } = require('../maru/core');

exports.handler = async (event) => {
  const rid = requestId();

  if (event.httpMethod !== 'POST') {
    return json(405, {
      ok: false,
      meta: { ts: nowIso(), request_id: rid },
      error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' }
    });
  }

  let order = {};
  try {
    order = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, {
      ok: false,
      meta: { ts: nowIso(), request_id: rid },
      error: { code: 'BAD_JSON', message: 'Invalid JSON body' }
    });
  }

  if (order.context !== 'global-insight') {
    return json(400, {
      ok: false,
      meta: { ts: nowIso(), request_id: rid },
      error: { code: 'BAD_CONTEXT', message: 'Invalid context' }
    });
  }

  // -------------------------------------------------
  // PLACEHOLDER ENGINE LOGIC
  // (Replace later with OpenAI / crawler / pipeline)
  // -------------------------------------------------

  const todaySummary =
    '현재 전 세계 주요 이슈는 경제 불확실성, 지정학적 긴장, 기술 패권 경쟁을 중심으로 전개되고 있습니다.';

  const regions = [
    { id: 'asia', today: '아시아는 반도체·AI 산업 중심의 경쟁이 심화되고 있습니다.' },
    { id: 'europe', today: '유럽은 에너지 전환과 경기 둔화 대응에 집중하고 있습니다.' },
    { id: 'north_america', today: '북미는 금리 정책과 기술 규제 이슈가 핵심입니다.' },
    { id: 'middle_east', today: '중동은 지정학적 리스크와 에너지 시장 변동성이 큽니다.' },
    { id: 'africa', today: '아프리카는 인프라 투자와 정치 안정성이 주요 변수입니다.' }
  ];

  const countries = [
    { code: 'KR', today: '한국은 반도체 수출 회복과 내수 부진이 동시에 나타나고 있습니다.' },
    { code: 'US', today: '미국은 금리 정책과 대선 국면이 경제에 영향을 주고 있습니다.' },
    { code: 'CN', today: '중국은 성장 둔화 속에서 내수 진작 정책을 강화하고 있습니다.' },
    { code: 'JP', today: '일본은 엔화 약세와 통화 정책 정상화가 이슈입니다.' }
  ];

  return json(200, {
    today: todaySummary,
    globalSummary: todaySummary,
    regions,
    countries,
    meta: {
      ts: nowIso(),
      request_id: rid
    }
  });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}
