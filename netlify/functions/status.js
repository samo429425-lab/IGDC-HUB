// /.netlify/functions/status
// IGDC 관리자 대시보드용 상태 체크 엔드포인트
//
// - 결제/도네이션 관련 플래그
// - 미디어 free-access 창
// - 주요 ENV 키 존재 여부 (admin.html 이 원하는 형태 포함)

const fs = require("fs");
const path = require("path");

function mask(val) {
  if (!val) return false;
  const s = String(val);
  if (s.length <= 8) return true;
  return s.slice(0, 4) + "••••" + s.slice(-4);
}

// 선택: psom.json 에서 free-access 기간 읽기 (없으면 비활성)
function loadFreeWindow() {
  try {
    const base = process.cwd();
    const candidates = [
      path.join(base, "assets", "hero", "psom.json"),
      path.join(base, "psom.json")
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      return {
        enabled: !!json.freeAccess,
        until: json.freeAccess_until || null
      };
    }
  } catch (e) {
    console.error("status: psom.json load error:", e);
  }
  return { enabled: false, until: null };
}

exports.handler = async () => {
  const env = process.env;
  const free = loadFreeWindow();

  // ★ admin.html 이 직접 쓰는 플래그 (이 네 개가 있어야 MISSING 이 사라짐)
  const envFlags = {
    google: !!env.GOOGLE_API_KEY,
    naver_id: !!env.NAVER_CLIENT_ID,
    naver_secret: !!env.NAVER_CLIENT_SECRET,
    openai: !!env.OPENAI_API_KEY
  };

  // 추가 상세 정보 (필요하면 다른 뷰에서 사용할 수 있음)
  const envDetail = {
    GOOGLE_API_KEY: mask(env.GOOGLE_API_KEY),
    NAVER_CLIENT_ID: mask(env.NAVER_CLIENT_ID),
    NAVER_CLIENT_SECRET: mask(env.NAVER_CLIENT_SECRET),
    OPENAI_API_KEY: mask(env.OPENAI_API_KEY),

    IG_OEMBED_TOKEN: mask(env.IG_OEMBED_TOKEN),
    STRIPE_SECRET_KEY: mask(env.STRIPE_SECRET_KEY),
    TOSS_PAYMENTS_SECRET: mask(env.TOSS_PAYMENTS_SECRET),
    KAKAOPAY_APP_KEY: mask(env.KAKAOPAY_APP_KEY),
    SUPABASE_URL: !!env.SUPABASE_URL,
    SUPABASE_ANON_KEY: mask(env.SUPABASE_ANON_KEY)
  };

  const payments = {
    card:
      !!env.STRIPE_SECRET_KEY ||
      !!env.TOSS_PAYMENTS_SECRET ||
      !!env.KAKAOPAY_APP_KEY,
    gift: !!env.SUPABASE_SERVICE_ROLE_KEY || !!env.DATABASE_URL,
    crypto:
      !!env.BTC_ADDRESS ||
      !!env.ETH_ADDRESS ||
      !!env.TRX_ADDRESS ||
      !!env.XRP_ADDRESS ||
      !!env.USDT_ETH_ADDRESS ||
      !!env.USDT_TRX_ADDRESS
  };

  const resp = {
    ok: true,
    env: envFlags,         // ← admin.html 이 보는 부분
    env_detail: envDetail, // ← 나중에 확장용
    payments,
    media: {
      freeAccess: {
        enabled: !!free.enabled,
        until: free.until || null
      }
    }
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(resp, null, 2)
  };
};
