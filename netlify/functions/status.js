// /.netlify/functions/status
// IGDC 관리자 대시보드 상태 엔드포인트
//
// - process.env + api-key.json / API 키.json / api-key.env / API 키.env 를 모두 읽어서
//   주요 키들의 존재 여부(envFlags)와, 모든 키의 마스킹된 값(env_detail)을 내려줍니다.
// - admin 화면에서는 env.google / env.naver_id / env.naver_secret / env.openai 등을 사용합니다.

const fs = require("fs");
const path = require("path");

// 값 마스킹: 앞 4글자 + 뒤 4글자만 보이고 나머지는 *
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

// 설정 파일(JSON / .env 스타일) 읽기
function loadConfig() {
  const cfg = {};
  const base = __dirname;
  const cwd  = process.cwd();

  // 1) JSON 파일 우선: api-key.json / API 키.json
  const jsonCandidates = [
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),
    path.join(cwd, "netlify", "functions", "api-key.json"),
    path.join(cwd, "netlify", "functions", "API 키.json")
  ];

  for (const p of jsonCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      Object.assign(cfg, json);
      break; // 하나만 있으면 충분
    } catch (e) {
      console.error("[status] api-key.json 읽기 오류:", p, e);
    }
  }

  // 2) env 스타일 파일 (KEY=VALUE)
  const envCandidates = [
    path.join(base, "api-key.env"),
    path.join(base, "API 키.env"),
    path.join(base, "..", "api-key.env"),
    path.join(cwd, "netlify", "functions", "api-key.env"),
    path.join(cwd, "netlify", "functions", "API 키.env")
  ];

  for (const p of envCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/i);
        if (m) {
          const key = m[1];
          const val = m[2];
          if (!cfg[key]) cfg[key] = val;
        }
      });
      break;
    } catch (e) {
      console.error("[status] api-key.env 읽기 오류:", p, e);
    }
  }

  return cfg;
}

// process.env / cfg 에서 값 가져오기
function getVal(cfg, key) {
  return process.env[key] || cfg[key] || "";
}

// 여러 키 중 하나라도 있으면 true
function anyPresent(cfg, keys) {
  return keys.some((k) => !!getVal(cfg, k));
}

// psom.json 에서 free-access 윈도우 읽기 (선택)
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

exports.handler = async function (event, context) {
  try {
    const cfg = loadConfig();

    // ─────────────────────────────
    // 1) 주요 플래그 (admin / index 에서 사용)
    // ─────────────────────────────
    const envFlags = {
      // admin 백엔드 상태 카드에서 직접 쓰는 값들
      google: anyPresent(cfg, ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"]),
      naver_id: anyPresent(cfg, ["NAVER_CLIENT_ID", "NAVER_API_KEY"]),
      naver_secret: !!getVal(cfg, "NAVER_CLIENT_SECRET"),
      openai: !!getVal(cfg, "OPENAI_API_KEY"),

      // 추가 플래그들 (필요시 다른 뷰에서 활용)
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

    // ─────────────────────────────
    // 2) env_detail: JSON/ENV 안에 있는 모든 키를 자동으로 포함
    // ─────────────────────────────
    const envDetail = {};
    const detailKeys = Object.keys(cfg).sort();

    for (const key of detailKeys) {
      const raw = getVal(cfg, key);
      envDetail[key] = {
        exists: !!raw,
        value: mask(raw)
      };
    }

    // ─────────────────────────────
    // 3) 결제/후원 요약 플래그
    // ─────────────────────────────
    const payments = {
      card: envFlags.stripe || envFlags.paypal, // Stripe / PayPal
      crypto: envFlags.wallets_any || envFlags.lbank,
      affiliate: envFlags.coupang_partners,
      bank_transfer: envFlags.supabase_service || envFlags.database_url
    };

    const free = loadFreeWindow();

    const resp = {
      ok: true,
      ts: new Date().toISOString(),
      env: envFlags,        // admin index 에서 직접 사용하는 간단 플래그들
      env_detail: envDetail, // JSON/ENV 에 있는 개별 키 상태(마스킹된 값)
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
