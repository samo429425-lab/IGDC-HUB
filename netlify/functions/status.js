// /.netlify/functions/status
// IGDC 관리자 대시보드 상태 엔드포인트
//
// - process.env(네틀리파이 ENV) + API 키.json / api-key.json 에 들어 있는 키들을 읽어서
//   admin 하단의 "백엔드 상태" 박스에 OK / MISSING 정보를 제공합니다.
// - JSON 쪽은 "함수 파일과 같은 폴더"에 두는 것을 기본 전제로 합니다.
//
//   응답 형태 예시:
//   {
//     ok: true,
//     ts: "...",
//     env: {
//       google: true/false,
//       naver_id: true/false,
//       naver_secret: true/false,
//       openai: true/false,
//       ... (추가 플래그)
//     },
//     env_detail: {
//       GOOGLE_API_KEY: "abcd...wxyz", // 마스킹된 값 또는 false
//       NAVER_API_KEY: "****...1234",
//       ...
//     },
//     payments: { ... },
//     media: { freeAccess: { enabled: bool, until: "..." } }
//   }

const path = require("path");

// ─────────────────────────────
// 1. JSON 설정 불러오기 (require 기반, 경로 최소화)
// ─────────────────────────────

function loadSecrets() {
  // status.js 기준 상대 경로
  const candidates = [
    "./API 키.json",
    "./api-key.json",
    "../API 키.json",
    "../api-key.json"
  ];

  for (const rel of candidates) {
    try {
      // require 는 번들 기준 상대 경로로 처리되므로,
      // 같은 폴더(또는 한 단계 위)에 JSON 이 있으면 자동으로 포함됩니다.
      // (JSON 이 없으면 에러를 무시하고 다음 후보로 넘어감)
      const secrets = require(rel);
      if (secrets && typeof secrets === "object") {
        return secrets;
      }
    } catch (e) {
      // 찾지 못하면 조용히 넘어감
    }
  }

  return {};
}

const secrets = loadSecrets();

// ─────────────────────────────
// 2. 유틸: 값 마스킹 (앞 4글자 + 마지막 4글자만 노출)
// ─────────────────────────────

function mask(val) {
  if (!val) return "";
  const s = String(val);
  if (s.length <= 8) {
    return s.replace(/.(?=.{4})/g, "*");
  }
  const head = s.slice(0, 4);
  const tail = s.slice(-4);
  return head + "..." + tail;
}

// ENV + JSON(secrets) 을 모두 보는 getter
function getVal(key) {
  if (process.env && Object.prototype.hasOwnProperty.call(process.env, key)) {
    return process.env[key];
  }
  if (secrets && Object.prototype.hasOwnProperty.call(secrets, key)) {
    return secrets[key];
  }
  // secrets.secrets / secrets.WALLETS 구조도 지원
  if (secrets && secrets.secrets && Object.prototype.hasOwnProperty.call(secrets.secrets, key)) {
    return secrets.secrets[key];
  }
  if (secrets && secrets.WALLETS && Object.prototype.hasOwnProperty.call(secrets.WALLETS, key)) {
    return secrets.WALLETS[key];
  }
  return "";
}

// 여러 키 중 하나라도 값이 있으면 true
function anyPresent(keys) {
  return keys.some((k) => !!getVal(k));
}

// ─────────────────────────────
// 3. psom.json 에서 free-access 윈도우 읽기 (선택)
// ─────────────────────────────

function loadFreeWindow() {
  const root = process.cwd();
  const fs = require("fs");
  const candidates = [
    path.join(root, "assets", "hero", "psom.json"),
    path.join(root, "psom.json")
  ];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      return {
        enabled: !!json.freeAccess,
        until: json.freeAccess_until || null
      };
    } catch (e) {
      console.error("[status] psom.json 읽기 오류:", e);
    }
  }

  return { enabled: false, until: null };
}

// ─────────────────────────────
// 4. 메인 handler
// ─────────────────────────────

exports.handler = async () => {
  try {
    const free = loadFreeWindow();

    // 4-1) admin 화면에서 직접 쓰는 핵심 플래그
    const envFlags = {
      // admin.html 의 renderStatus 에서 사용하는 4개
      google: anyPresent(["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"]),
      naver_id: anyPresent(["NAVER_CLIENT_ID", "NAVER_API_KEY"]),
      naver_secret: !!getVal("NAVER_CLIENT_SECRET"),
      openai: !!getVal("OPENAI_API_KEY"),

      // 확장 플래그들 (필요시 admin 다른 뷰에서 활용)
      google_oauth: anyPresent([
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET"
      ]),
      google_service_account: !!getVal("GOOGLE_SERVICE_ACCOUNT_JSON"),

      auth0_main: anyPresent([
        "AUTH0_DOMAIN",
        "AUTH0_CLIENT_ID",
        "AUTH0_CLIENT_SECRET"
      ]),
      auth0_m2m: anyPresent([
        "AUTH0_M2M_DOMAIN",
        "AUTH0_M2M_CLIENT_ID",
        "AUTH0_M2M_CLIENT_SECRET",
        "AUTH0_M2M_AUDIENCE"
      ]),

      facebook: anyPresent(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]),
      kakao: anyPresent(["KAKAO_APP_ID", "KAKAO_CLIENT_SECRET"]),
      coupang_partners: anyPresent([
        "COUPANG_PARTNERS_API_KEY",
        "COUPANG_PARTNERS_SECRET"
      ]),

      stripe: !!getVal("STRIPE_SECRET_KEY"),
      paypal: !!getVal("PAYPAL_CLIENT_ID"),

      lbank: anyPresent(["LBANK_API_KEY", "LBANK_API_SECRET"]),

      supabase_url: !!getVal("SUPABASE_URL"),
      supabase_anon: !!getVal("SUPABASE_ANON_KEY"),
      supabase_service: !!getVal("SUPABASE_SERVICE_ROLE_KEY"),
      database_url: !!getVal("DATABASE_URL"),

      sendgrid: !!getVal("SENDGRID_API_KEY"),
      ga: !!getVal("GA_TRACKING_ID"),

      wallets_any: anyPresent([
        "BTC_ADDRESS",
        "ETH_ADDRESS",
        "XRP_ADDRESS",
        "BNB_ADDRESS",
        "XLM_ADDRESS",
        "TRX_ADDRESS",
        "USDT_ETH_ADDRESS",
        "USDT_TRX_ADDRESS",
        "USDC_ADDRESS",
        "USDC_TRX_ADDRESS",
        "ANKRMATIC_ADDRESS",
        "DAI_ADDRESS"
      ])
    };

    // 4-2) env_detail – JSON 안에 있는 모든 키 + 주요 ENV 키들
    const detailSet = new Set([
      // JSON 에 실제로 들어 있는 키들
      ...Object.keys(secrets || {}),
      // 추가로 꼭 보고 싶은 키들 (ENV 전용일 수도 있으니)
      "OPENAI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_MAPS_API_KEY",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "NAVER_API_KEY",
      "NAVER_CLIENT_ID",
      "NAVER_CLIENT_SECRET",
      "AUTH0_DOMAIN",
      "AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_SECRET",
      "AUTH0_M2M_DOMAIN",
      "AUTH0_M2M_CLIENT_ID",
      "AUTH0_M2M_CLIENT_SECRET",
      "AUTH0_M2M_AUDIENCE",
      "FACEBOOK_APP_ID",
      "FACEBOOK_APP_SECRET",
      "KAKAO_APP_ID",
      "KAKAO_CLIENT_SECRET",
      "COUPANG_PARTNERS_API_KEY",
      "COUPANG_PARTNERS_SECRET",
      "STRIPE_SECRET_KEY",
      "PAYPAL_CLIENT_ID",
      "LBANK_API_KEY",
      "LBANK_API_SECRET",
      "BTC_ADDRESS",
      "ETH_ADDRESS",
      "XRP_ADDRESS",
      "BNB_ADDRESS",
      "XLM_ADDRESS",
      "TRX_ADDRESS",
      "USDT_ETH_ADDRESS",
      "USDT_TRX_ADDRESS",
      "USDC_ADDRESS",
      "USDC_TRX_ADDRESS",
      "ANKRMATIC_ADDRESS",
      "DAI_ADDRESS",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATABASE_URL",
      "SENDGRID_API_KEY",
      "GA_TRACKING_ID"
    ]);

    const envDetail = {};
    Array.from(detailSet)
      .sort()
      .forEach((key) => {
        const v = getVal(key);
        if (v) {
          envDetail[key] = mask(v);
        } else {
          envDetail[key] = false;
        }
      });

    // 4-3) 결제/후원 파이프라인 요약
    const payments = {
      card: envFlags.stripe || envFlags.paypal,
      crypto: envFlags.wallets_any || envFlags.lbank,
      affiliate: envFlags.coupang_partners,
      bank_transfer: envFlags.supabase_service || envFlags.database_url
    };

    const resp = {
      ok: true,
      ts: new Date().toISOString(),
      env: envFlags,
      env_detail: envDetail,
      payments,
      media: {
        freeAccess: {
          enabled: !!free.enabled,
          until: free.until
        }
      }
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(resp, null, 2)
    };
  } catch (err) {
    console.error("[status] handler error:", err);
    // 에러가 나더라도 500 대신 200 + ok:false 로 내려줘서
    // admin 블록이 통째로 사라지지 않도록 방어
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(
        {
          ok: false,
          ts: new Date().toISOString(),
          env: {
            google: false,
            naver_id: false,
            naver_secret: false,
            openai: !!getVal("OPENAI_API_KEY")
          },
          env_detail: {},
          payments: {
            card: false,
            crypto: false,
            affiliate: false,
            bank_transfer: false
          },
          error: "status_failed",
          message: err && err.message ? err.message : String(err)
        },
        null,
        2
      )
    };
  }
};
