// /.netlify/functions/status
// IGDC 관리자 대시보드 상태 엔드포인트
//
// - OPENAI / GOOGLE / NAVER / 기타 키들을 ENV + JSON 에서 모두 읽어서
//   OK / MISSING 플래그와 마스킹된 값 목록을 내려줍니다.

const path = require("path");

// 1) JSON 파일을 require 로 직접 불러오기
//    (status.js 와 같은 폴더에 API 키.json 또는 api-key.json 이 있어야 함)
function loadSecrets() {
  try {
    // 한글 파일명 우선
    return require("./API 키.json");
  } catch (e1) {
    try {
      // 영문 파일명 fallback
      return require("./api-key.json");
    } catch (e2) {
      console.error("[status] API 키.json / api-key.json 을 찾지 못했습니다.");
      return {};
    }
  }
}

const secrets = loadSecrets();

// 값 마스킹: 앞 4글자 + 뒤 4글자만 노출
function mask(val) {
  if (!val) return "";
  const s = String(val);
  if (s.length <= 8) return s.replace(/.(?=.{4})/g, "*");
  const head = s.slice(0, 4);
  const tail = s.slice(-4);
  return head + "..." + tail;
}

// ENV + JSON 을 모두 보는 getter
function getVal(key) {
  return process.env[key] || secrets[key] || "";
}

// 여러 키 중 하나라도 값이 있으면 true
function anyPresent(keys) {
  return keys.some((k) => !!getVal(k));
}

// psom.json (미디어 무료 개방 기간) – 선택
function loadFreeWindow() {
  const base = process.cwd();
  const candidates = [
    path.join(base, "assets", "hero", "psom.json"),
    path.join(base, "psom.json")
  ];

  for (const p of candidates) {
    try {
      const fs = require("fs");
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

exports.handler = async function (event, context) {
  try {
    // 1) admin 에서 직접 쓰는 플래그들
    const envFlags = {
      // admin.html 의 renderStatus 에서 사용하는 4개
      google: anyPresent(["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"]),
      naver_id: anyPresent(["NAVER_CLIENT_ID", "NAVER_API_KEY"]),
      naver_secret: !!getVal("NAVER_CLIENT_SECRET"),
      openai: !!getVal("OPENAI_API_KEY"),

      // 확장 플래그들 (필요하면 나중에 써도 됨)
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

    // 2) env_detail – JSON 에 있는 모든 키 + 주요 ENV 키들
    const detailSet = new Set(Object.keys(secrets));
    [
      "OPENAI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_MAPS_API_KEY",
      "NAVER_CLIENT_ID",
      "NAVER_API_KEY",
      "NAVER_CLIENT_SECRET"
    ].forEach((k) => detailSet.add(k));

    const envDetail = {};
    Array.from(detailSet)
      .sort()
      .forEach((key) => {
        const raw = getVal(key);
        if (!raw) return;
        envDetail[key] = {
          exists: true,
          value: mask(raw)
        };
      });

    // 3) 결제/후원 파이프라인 요약
    const payments = {
      card: envFlags.stripe || envFlags.paypal,
      crypto: envFlags.wallets_any || envFlags.lbank,
      affiliate: envFlags.coupang_partners,
      bank_transfer: envFlags.supabase_service || envFlags.database_url
    };

    const free = loadFreeWindow();

    const resp = {
      ok: true,
      ts: new Date().toISOString(),
      env: envFlags,
      env_detail: envDetail,
      payments,
      media: {
        freeAccess: {
          enabled: free.enabled,
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
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        error: "status-failed",
        message: err && err.message ? err.message : String(err)
      })
    };
  }
};
