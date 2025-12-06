// netlify/functions/ledger.js
// IGDC 관리자 대시보드용 "백엔드 유입 상황 / 도네이션 요약" 공용 엔드포인트 (v2)
//
// - 공통 레저(ledger) 엔드포인트: /api/ledger
// - 역할:
//   1) Supabase inflow_ledger 테이블에서 최근 데이터 실시간 조회 (env 세팅 시)
//   2) env 미설정 또는 오류 시, 형식이 맞는 데모 rows 반환 (기존 대시보드와 호환)
//
// ◆ 필요 ENV (실데이터 모드)
//   - SUPABASE_URL                예) https://xxxxxx.supabase.co
//   - SUPABASE_SERVICE_ROLE_KEY   Service Role 키 (서버 전용, Netlify env 에만 보관)
//   - (선택) LEDGER_TABLE              기본값: inflow_ledger
//   - (선택) LEDGER_TIME_WINDOW_HOURS  기본값: 720 (최근 30일치)
//
// ◆ inflow_ledger 테이블 컬럼 가이드 (Supabase):
//   - ts       : timestamptz (ISO 문자열로 반환)
//   - source   : text   (wallet / donation / coupang / stripe / ads / youtube / backend_other ...)
//   - kind     : text   (donation / sale / payout / other ...)
//   - amount   : numeric 또는 double precision
//   - ccy      : text   (KRW / USD / BTC / USDT ...)
//   - channel  : text   (card / affiliate / adsense / settlement ...)
//   - note     : text   (메모)
//
// 프론트엔드(admin.html)에서는 rows 를 공통으로 받아
//  - 도네이션 모달: kind === "donation" 위주로 필터/그룹
//  - 백엔드 유입 모달: 전체 rows 또는 일부 source 필터
// 와 같이 용도별로 나누어 사용합니다.

const TABLE_NAME = process.env.LEGER_TABLE || process.env.LEDGER_TABLE || "inflow_ledger";
const DEFAULT_WINDOW_HOURS = Number(process.env.LEDGER_TIME_WINDOW_HOURS || "720"); // 30일

// Netlify Node 18 런타임에서는 fetch 가 전역 제공됩니다.

exports.handler = async (event, context) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  let ok = true;
  let mode = "demo";
  let error = null;
  let rows = [];

  try {
    // (1) Supabase 환경이 세팅되어 있으면 실데이터 모드
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      mode = "supabase";

      const windowHours =
        Number(process.env.LEDGER_TIME_WINDOW_HOURS || DEFAULT_WINDOW_HOURS) || DEFAULT_WINDOW_HOURS;
      const fromTs = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

      const baseUrl = SUPABASE_URL.replace(/\/+$/, "");
      const url =
        baseUrl +
        `/rest/v1/${encodeURIComponent(TABLE_NAME)}?` +
        [
          "select=ts,source,kind,amount,ccy,channel,note",
          // ts >= fromTs 인 데이터만
          `ts=gte.${encodeURIComponent(fromTs)}`,
          "order=ts.desc"
        ].join("&");

      const res = await fetch(url, {
        method: "GET",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        ok = false;
        error = `Supabase HTTP ${res.status}`;
        rows = [];
      } else {
        const data = await res.json();
        rows = (Array.isArray(data) ? data : []).map((r) => ({
          ts: r.ts,
          source: r.source || null,
          kind: r.kind || null,
          amount:
            typeof r.amount === "number"
              ? r.amount
              : r.amount != null
              ? Number(r.amount)
              : 0,
          ccy: r.ccy || null,
          channel: r.channel || null,
          note: r.note || null
        }));
      }
    } else {
      // (2) Supabase env 가 없으면 기존처럼 데모 rows 반환
      mode = "demo";
      const now = Date.now();

      function ts(offsetMs) {
        return new Date(now - offsetMs).toISOString();
      }

      rows = [
        {
          ts: ts(1 * 60 * 60 * 1000), // 1시간 전
          source: "wallet", // wallet / donation / coupang / stripe / ads / youtube ...
          kind: "donation", // donation / deposit / sale / payout ...
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
          note: "쿠팡 파트너스 수익"
        },
        {
          ts: ts(5 * 60 * 60 * 1000),
          source: "youtube",
          kind: "payout",
          amount: 17.32,
          ccy: "USD",
          channel: "adsense",
          note: "유튜브 광고 정산"
        },
        {
          ts: ts(6 * 60 * 60 * 1000),
          source: "backend",
          kind: "other",
          amount: 210000,
          ccy: "KRW",
          channel: "settlement",
          note: "기타 백엔드 수익(정산)"
        }
      ];
    }
  } catch (e) {
    ok = false;
    error = e && e.message ? e.message : String(e);
    // rows 가 이미 채워져 있으면 그대로 두고, 아니면 빈 배열
    if (!Array.isArray(rows)) {
      rows = [];
    }
  }

  const body = {
    endpoint: "/api/ledger",
    ok,
    rows,
    mode
  };

  if (error) {
    body.error = error;
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate"
    },
    body: JSON.stringify(body, null, 2)
  };
};
