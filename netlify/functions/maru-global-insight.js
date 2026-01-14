/**
 * MARU GLOBAL INSIGHT — STEP 4 STABLE
 * ---------------------------------
 * 역할:
 * - MARU 엔진 결과를 프론트가 바로 쓸 수 있는 형태로 정규화
 * - 확장 여부 판단을 서버에서 명시적으로 결정
 *
 * 핵심:
 * - mode: summary | expand | general
 * - 프론트(애드온)는 mode만 보고 실행
 */

const { nowIso, requestId } = require('../maru/core');

exports.handler = async (event) => {
  const rid = requestId();

  if (event.httpMethod !== 'POST') {
    return json(405, {
      ok: false,
      meta: meta(rid),
      error: 'POST_ONLY'
    });
  }

  let req = {};
  try {
    req = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, {
      ok: false,
      meta: meta(rid),
      error: 'BAD_JSON'
    });
  }

  const {
    text = '',
    scope = 'global',
    depth = 'summary' // summary | expand
  } = req;

  // -------------------------------
  // STEP 4: 서버 단 판단 규칙
  // -------------------------------
  let mode = 'summary';

  if (depth === 'expand') {
    mode = 'expand';
  } else if (text.length > 120) {
    mode = 'expand';
  }

  // -------------------------------
  // PLACEHOLDER: MARU ENGINE CALL
  // (실제 엔진 연결 시 이 부분 교체)
  // -------------------------------
  const engineResult = mockEngine(text, scope, mode);

  // -------------------------------
  // STEP 4: 응답 정규화 (항상 동일 shape)
  // -------------------------------
  const response = {
    ok: true,
    mode,
    scope,
    speech: engineResult.speech || '',
    text: engineResult.text || '',
    data: engineResult.data || {},
    meta: meta(rid)
  };

  return json(200, response);
};

// -------------------------------
// Helpers
// -------------------------------
function meta(rid) {
  return {
    ts: nowIso(),
    request_id: rid
  };
}

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

// -------------------------------
// Mock Engine (교체 대상)
// -------------------------------
function mockEngine(text, scope, mode) {
  if (mode === 'expand') {
    return {
      speech: `확장 주제에 대한 상세 설명입니다: ${text}`,
      text: `확장 분석 (${scope})\n\n${text}`,
      data: {}
    };
  }

  return {
    speech: `요약입니다: ${text}`,
    text: `요약 (${scope}): ${text}`,
    data: {}
  };
}
