/**
 * pay-config.js (Netlify Functions shared config)
 * 목적: (1) Admin on/off 제어, (2) Donation 구조를 "코드(J S)"로 고정
 * 배치: netlify/functions/data/pay-config.js
 *
 * 보안: 비밀키 금지 (env에만 저장)
 * 우선순위 권장: env > 이 config
 */

module.exports = {
  // ---------- 1) Master switches ----------
  enabled: true,          // 전체 결제/수익 엔진 ON/OFF
  maintenance: false,     // 긴급 차단(모든 결제/도네이션/리다이렉트 차단)
  features: {
    commerce: true,       // 내부 결제 흐름(현재는 mock, PG 연결 시 실결제)
    donation: true,       // 도네이션 흐름
    affiliate: true,      // 제휴/외부 리다이렉트
    tracking: true,       // 서버측 트래킹(로그/DB 파이프라인 훅)
    crypto: false         // 코인(향후)
  },

  // ---------- 2) Commerce (종합상사) ----------
  commerce: {
    accountLabel: "IGDC 종합상사",
    // 실제 계좌번호/정산정보는 Admin/서버(비공개 영역)에서 관리 권장
    note: "운영 계좌(관리자 설정/비공개 영역)"
  },

  // ---------- 3) Donation (재단/봉사단) ----------
  donation: {
    // 기본 타깃
    defaultTarget: "mission", // "mission" | "doctrine"

    // 도네이션 대상(표시용 라벨/노트)
    targets: {
      mission: {
        label: "선교재단",
        note: "도네이션(선교)"
      },
      doctrine: {
        label: "교리봉사단",
        note: "도네이션(봉사)"
      }
    },

    // 도네이션 전용 페이지가 있으면 redirect로 통일 가능(선택)
    // 예: "/donation.html" 또는 "https://donate.example.com"
    redirectUrl: "",

    // 표시용 문구(다국어는 프론트 i18n에서 처리 권장)
    ui: {
      title: "도네이션",
      message: "도네이션 안내(표시용). 실제 입금/정산은 운영 정책에 따라 처리됩니다."
    }
  },

  // ---------- 4) Affiliate / UTM Defaults ----------
  affiliate: {
    utmDefaults: {
      utm_source: "igdc",
      utm_medium: "referral",
      utm_campaign: "hub"
    },
    // 일부 파트너는 tag 파라미터 사용(예: Amazon)
    tagParam: "tag"
  },

  // ---------- 5) Policy / Limits ----------
  policy: {
    // 과도 요청 방지(서버에서 clamp)
    maxAmount: 1_000_000_000,
    // 화폐 기본값
    defaultCurrency: "KRW",
    // 허용 목적(purpose)
    purposes: ["commerce", "donation", "affiliate", "tracking"]
  }
};
