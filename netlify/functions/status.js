// /.netlify/functions/status
// IGDC 관리자 대시보드 상태 엔드포인트
//
// - 결제/후원 파이프라인이 어떤 키를 가지고 있는지 요약
// - 주요 ENV / api-key.json 키들이 존재하는지만 true/false 로 표시
// - 실제 값은 마스킹해서만 내려보냄 (admin 화면에서 OK/MISSING 용도)
//
// 주의: 여기서는 process.env(네틀리파이 ENV)와
//       api-key.json / api-key.env(로컬/백엔드 설정 파일)을
//       같이 읽어서 "있다/없다"만 판단합니다.

const fs = require("fs");
const path = require("path");

// ─────────────────────────────
// 유틸: 값 마스킹 (앞 4글자 + 마지막 4글자만 노출)
// ─────────────────────────────
function mask(val) {
  if (!val) return false;
  const s = String(val);
  if (!s) return false;
  if (s.length <= 8) return true;
  return s.slice(0, 4) + "••••" + s.slice(-4);
}

// ─────────────────────────────
// api-key.json / api-key.env 로부터 설정 로드
// ─────────────────────────────
function loadConfig() {
  const base = __dirname;
  const cfg = {};

  // 1) JSON 파일 우선
  const jsonCandidates = [
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json")
  ];

  for (const p of jsonCandidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        Object.assign(cfg, JSON.parse(raw));
        return cfg;
      }
    } catch (e) {
      console.error("[status] api-key.json 읽기 오류:", p, e);
    }
  }

  // 2) env 스타일 파일 (KEY=VALUE)
  const envCandidates = [
    path.join(base, "api-key.env"),
    path.join(base, "API 키.env"),
    path.join(base, "..", "api-key.env")
  ];

  for (const p of envCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/i);
        if (m) {
          cfg[m[1]] = m[2];
        }
      });
      return cfg;
    } catch (e) {
      console.error("[status] api-key.env 읽기 오류:", p, e);
    }
  }

  return cfg;
}

// config + process.env 에서 키 값 가져오기
function getVal(cfg, key) {
  if (process.env && Object.prototype.hasOwnProperty.call(process.env, key)) {
    return process.env[key];
  }
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, key)) {
    return cfg[key];
  }
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
  for (const key of keys) {
    const v = getVal(cfg, key);
    if (v) return true;
  }
  return false;
}

// ─────────────────────────────
// psom.json 에서 free-access 윈도우 읽기 (선택 사항)
// ─────────────────────────────
function loadFreeWindow() {
  const base = process.cwd();
  const candidates = [
    path.join(base, "assets", "hero", "psom.json"),
    path.join(base, "psom.json")
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
  const cfg = loadConfig();
  const free = loadFreeWindow();

  // 1) admin 화면에서 직접 쓰는 핵심 플래그 (google/naver/openai)
  const envFlags = {
    // index/admin 에서 env.google / env.naver_id / env.naver_secret / env.openai 를 봅니다.
    google: anyPresent(cfg, ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"]),
    naver_id: anyPresent(cfg, ["NAVER_CLIENT_ID", "NAVER_API_KEY"]),
    naver_secret: !!getVal(cfg, "NAVER_CLIENT_SECRET"),
    openai: !!getVal(cfg, "OPENAI_API_KEY"),

    // ─ 추가 플래그들 (필요시 admin 다른 뷰에서 사용 가능) ─
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
      "AUTH0_M2M_CLIENT_SECRET"
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

  // 2) 상세 정보 (마스킹된 값) - 필요한 키들만 선별
  const detailKeys = [
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_SERVICE_ACCOUNT_JSON",

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
    "NAVER_API_KEY",
    "NAVER_CLIENT_ID",
    "NAVER_CLIENT_SECRET",

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
  ];

  const envDetail = {};
  for (const key of detailKeys) {
    const v = getVal(cfg, key);
    if (v) {
      envDetail[key] = mask(v);
    } else {
      envDetail[key] = false;
    }
  }

  // 3) 결제/후원 요약 플래그
  const payments = {
    card: envFlags.stripe || envFlags.paypal,   // 카드/간편결제 (나중에 Toss/KakaoPay 추가)
    crypto: envFlags.wallets_any || envFlags.lbank,
    affiliate: envFlags.coupang_partners,
    bank_transfer: envFlags.supabase_service || envFlags.database_url
  };

  const resp = {
    ok: true,
    ts: new Date().toISOString(),
    env: envFlags,        // admin index에서 직접 쓰는 간단 플래그들
    env_detail: envDetail,// 필요하면 다른 뷰에서 참고용으로 사용
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
};
