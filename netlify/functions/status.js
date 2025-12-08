// /.netlify/functions/status
// IGDC 관리자 대시보드 상태 엔드포인트
//
// - process.env(네틀리파이 ENV) + api-key.json / API 키.json / api-key.env / API 키.env 를 모두 읽어서
//   admin 하단 "🔐 백엔드 상태" 박스를 위한 OK / MISSING 정보를 제공합니다.
// - 실제 키 값은 그대로 노출하지 않고, 마스킹된 값만 env_detail 로 내려보냅니다.

const fs = require("fs");
const path = require("path");

// ─────────────────────────────
// 유틸: 값 마스킹 (앞 4글자 + 마지막 4글자만 노출)
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

// ─────────────────────────────
// 설정 파일 로딩 (JSON / .env 스타일)
// ─────────────────────────────
function loadConfig() {
  const cfg = {};
  const base = __dirname;       // 함수 파일이 실제로 위치한 폴더
  const root = process.cwd();   // 함수 번들의 루트 (대부분 사이트 루트에 가깝게 매핑됨)

  // 1) JSON 파일 후보들 (한글/영문 이름 + 여러 위치)
  const jsonCandidates = [
    // 함수 파일과 같은 폴더
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    // 한 단계 위
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),
    // 프로젝트 루트 쪽 (drag&drop 구조 대비)
    path.join(root, "api-key.json"),
    path.join(root, "API 키.json"),
    // netlify/functions 폴더 바로 아래
    path.join(root, "netlify", "functions", "api-key.json"),
    path.join(root, "netlify", "functions", "API 키.json")
  ];

  for (const p of jsonCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      if (json && typeof json === "object") {
        Object.assign(cfg, json);
      }
    } catch (e) {
      console.error("[status] api-key.json 읽기 오류:", p, e);
    }
  }

  // 2) .env 스타일 파일 후보들 (KEY=VALUE)
  const envCandidates = [
    path.join(base, "api-key.env"),
    path.join(base, "API 키.env"),
    path.join(base, "..", "api-key.env"),
    path.join(base, "..", "API 키.env"),
    path.join(root, "api-key.env"),
    path.join(root, "API 키.env"),
    path.join(root, "netlify", "functions", "api-key.env"),
    path.join(root, "netlify", "functions", "API 키.env")
  ];

  for (const p of envCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/i);
        if (!m) return;
        const key = m[1];
        const val = m[2];
        if (!cfg[key]) {
          cfg[key] = val;
        }
      });
    } catch (e) {
      console.error("[status] api-key.env 읽기 오류:", p, e);
    }
  }

  return cfg;
}

// ─────────────────────────────
// config + process.env 에서 키 값 가져오기
// ─────────────────────────────
function getVal(cfg, key) {
  // 1순위: Netlify ENV
  if (process.env && Object.prototype.hasOwnProperty.call(process.env, key)) {
    return process.env[key];
  }
  // 2순위: JSON / env 에서 읽어온 평평한 키들
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, key)) {
    return cfg[key];
  }
  // 3순위: JSON 구조 안의 중첩(secrets / WALLETS) 지원
  if (cfg && cfg.secrets && Object.prototype.hasOwnProperty.call(cfg.secrets, key)) {
    return cfg.secrets[key];
  }
  if (cfg && cfg.WALLETS && Object.prototype.hasOwnProperty.call(cfg.WALLETS, key)) {
    return cfg.WALLETS[key];
  }
  return "";
}

// 여러 키 중 하나라도 값이 있으면 true
function anyPresent(cfg, keys) {
  return keys.some((k) => !!getVal(cfg, k));
}

// ─────────────────────────────
// psom.json 에서 free-access 윈도우 읽기 (선택 사항)
// ─────────────────────────────
function loadFreeWindow() {
  const root = process.cwd();
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
// 메인 handler
// ─────────────────────────────
exports.handler = async () => {
  try {
    const cfg  = loadConfig();
    const free = loadFreeWindow();

    // 1) admin 화면에서 직접 쓰는 핵심 플래그 (google/naver/openai)
    const envFlags = {
      // admin.html 의 renderStatus 가 여기 네 개를 씁니다.
      google: anyPresent(cfg, ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"]),
      naver_id: anyPresent(cfg, ["NAVER_CLIENT_ID", "NAVER_API_KEY"]),
      naver_secret: !!getVal(cfg, "NAVER_CLIENT_SECRET"),
      openai: !!getVal(cfg, "OPENAI_API_KEY"),

      // ─ 추가 플래그들 (필요시 다른 뷰에서 재사용 가능) ─
      google_oauth: anyPresent(cfg, [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET"
      ]),
      google_service_account: !!getVal(cfg, "GOOGLE_SERVICE_ACCOUNT_JSON"),

      auth0_main: anyPresent(cfg, [
        "AUTH0_DOMAIN",
        "AUTH0_CLIENT_ID",
        "AUTH0_CLIENT_SECRET"
      ]),
      auth0_m2m: anyPresent(cfg, [
        "AUTH0_M2M_DOMAIN",
        "AUTH0_M2M_CLIENT_ID",
        "AUTH0_M2M_CLIENT_SECRET",
        "AUTH0_M2M_AUDIENCE"
      ]),

      facebook: anyPresent(cfg, ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]),
      kakao: anyPresent(cfg, ["KAKAO_APP_ID", "KAKAO_CLIENT_SECRET"]),
      coupang_partners: anyPresent(cfg, [
        "COUPANG_PARTNERS_API_KEY",
        "COUPANG_PARTNERS_SECRET"
      ]),

      stripe: !!getVal(cfg, "STRIPE_SECRET_KEY"),
      paypal: !!getVal(cfg, "PAYPAL_CLIENT_ID"),

      lbank: anyPresent(cfg, ["LBANK_API_KEY", "LBANK_API_SECRET"]),

      supabase_url: !!getVal(cfg, "SUPABASE_URL"),
      supabase_anon: !!getVal(cfg, "SUPABASE_ANON_KEY"),
      supabase_service: !!getVal(cfg, "SUPABASE_SERVICE_ROLE_KEY"),
      database_url: !!getVal(cfg, "DATABASE_URL"),

      sendgrid: !!getVal(cfg, "SENDGRID_API_KEY"),
      ga: !!getVal(cfg, "GA_TRACKING_ID"),

      wallets_any: anyPresent(cfg, [
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

    // 2) env_detail – JSON/ENV 안에 있는 모든 주요 키들의 상태 + 마스킹된 값
    const detailKeys = new Set([
      // JSON 에 직접 들어 있는 키들
      ...Object.keys(cfg || {}),
      // 추가로 ENV에서만 있을 수 있는 주요 키들
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
    Array.from(detailKeys)
      .sort()
      .forEach((key) => {
        const v = getVal(cfg, key);
        if (v) {
          envDetail[key] = mask(v);
        } else {
          envDetail[key] = false;
        }
      });

    // 3) 결제/후원 파이프라인 요약
    const payments = {
      card: envFlags.stripe || envFlags.paypal,
      crypto: envFlags.wallets_any || envFlags.lbank,
      affiliate: envFlags.coupang_partners,
      bank_transfer: envFlags.supabase_service || envFlags.database_url
    };

    const resp = {
      ok: true,
      ts: new Date().toISOString(),
      env: envFlags,         // admin 백엔드 상태 카드가 직접 쓰는 단순 플래그
      env_detail: envDetail, // 필요시 admin 다른 뷰에서 확장 사용 가능
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

    // 에러가 나더라도 admin 블럭이 통째로 사라지지 않도록, 500 대신 ok:false 로 내려줌
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
            openai: !!(process.env && process.env.OPENAI_API_KEY)
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
