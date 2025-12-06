// netlify/functions/ledger.js
// IGDC 관리자 대시보드용 "백엔드 유입 상황 / 도네이션 요약" 공용 엔드포인트
//
// 1차 버전:
//  - 아직 DB/지갑/PG 연동 전이므로, 형식이 맞는 데모 rows 만 반환.
//  - 프론트엔드(admin.html)에서는 이 형식을 기준으로 표/요약/그래프를 구성.
// 2차 이후:
//  - Supabase 등 DB의 inflow_ledger 테이블과 연동하여 실제 데이터를 반환하도록 교체.

exports.handler = async (event, context) => {
  // TODO: 나중에 DB에서 읽어올 수 있도록 자릿값만 미리 잡아 둡니다.
  // 예: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 있으면 거기에서 SELECT 해오기

  // (1) 지금은 "형식이 맞는 데모 데이터"를 생성
  const now = Date.now();

  // 간단한 헬퍼: ms 오프셋으로 시간 만들기
  function ts(offsetMs) {
    return new Date(now - offsetMs).toISOString();
  }

  const rows = [
    {
      ts: ts(1 * 60 * 60 * 1000), // 1시간 전
      source: "wallet",           // wallet / donation / coupang / stripe / ads / youtube ...
      kind: "donation",           // donation / deposit / sale / payout ...
      amount: 0.015,
      ccy: "BTC",
      channel: "BTC",
      note: "메인 비트코인 지갑 후원"
    },
    {
      ts: ts(2 * 60 * 60 * 1000),
      source: "wallet",
      kind: "donation",
      amount: 120.5,
      ccy: "USDT",
      channel: "USDT_TRX",
      note: "TRON 기반 USDT 후원"
    },
    {
      ts: ts(3 * 60 * 60 * 1000),
      source: "donation",
      kind: "donation",
      amount: 50000,
      ccy: "KRW",
      channel: "card",
      note: "국내 카드 정기 후원"
    },
    {
      ts: ts(4 * 60 * 60 * 1000),
      source: "coupang",
      kind: "sale",
      amount: 8300,
      ccy: "KRW",
      channel: "affiliate",
      note: "쿠팡 파트너스 적립 예정"
    },
    {
      ts: ts(5 * 60 * 60 * 1000),
      source: "stripe",
      kind: "donation",
      amount: 25,
      ccy: "USD",
      channel: "stripe",
      note: "해외 카드 후원"
    },
    {
      ts: ts(6 * 60 * 60 * 1000),
      source: "ads",
      kind: "payout",
      amount: 17.34,
      ccy: "USD",
      channel: "youtube",
      note: "YouTube 광고 수익 정산분"
    }
  ];

  // NOTE:
  // 나중에 여기에 "if (SUPABASE_URL && SUPABASE_KEY) { ... 실제 SELECT ... }"
  // 형태로 DB 연동 코드를 추가하면 됩니다.

  const ok = true;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(
      {
        endpoint: "/api/ledger",
        ok,
        rows
      },
      null,
      2
    )
  };
};
