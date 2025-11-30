
// /.netlify/functions/status
// Returns flags for payment methods and free media access window.
// Also checks presence of selected environment variables (masked).
const fs = require('fs');
const path = require('path');

function mask(val) {
  if (!val) return false;
  const s = String(val);
  if (s.length <= 8) return true;
  return s.slice(0, 4) + "••••" + s.slice(-4);
}

exports.handler = async () => {
  // Read psom.json if available (assuming deployed to /assets/hero/psom.json or root)
  const candidates = [
    path.join(process.cwd(), "assets", "hero", "psom.json"),
    path.join(process.cwd(), "psom.json"),
  ];
  let psom = {};
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        psom = JSON.parse(fs.readFileSync(p, "utf-8"));
        break;
      }
    } catch {}
  }

  const policy = (psom && psom.policy) || {};
  const free = policy.freeMediaAccess || { enabled: false };
  const env = process.env;

  const resp = {
    ok: true,
    ts: new Date().toISOString(),
    payment: {
      card: !!env.STRIPE_SECRET_KEY || !!env.TOSS_PAYMENTS_SECRET || !!env.IMP_REST_KEY,
      mobile: !!env.KAKAOPAY_APP_KEY || !!env.NAVER_PAY_CLIENT_ID || !!env.TOSS_PAYMENTS_SECRET,
      gift: !!env.SUPABASE_SERVICE_ROLE_KEY || !!env.DATABASE_URL,
      crypto: !!env.CRYPTO_WALLET_ADDR || !!env.CRYPTO_PROVIDER_KEY,
    },
    media: {
      freeAccess: {
        enabled: !!free.enabled,
        until: free.until || null,
      }
    },
    env: {
      IG_OEMBED_TOKEN: mask(env.IG_OEMBED_TOKEN),
      STRIPE_SECRET_KEY: mask(env.STRIPE_SECRET_KEY),
      TOSS_PAYMENTS_SECRET: mask(env.TOSS_PAYMENTS_SECRET),
      KAKAOPAY_APP_KEY: mask(env.KAKAOPAY_APP_KEY),
      SUPABASE_URL: !!env.SUPABASE_URL,
      SUPABASE_ANON_KEY: mask(env.SUPABASE_ANON_KEY),
    }
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(resp)
  };
};
