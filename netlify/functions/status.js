// netlify/functions/status.js
// 공개지갑 주소 유무 + 주요 공개키 존재여부 요약 (CommonJS)

"use strict";

// 번들에 '지갑주소 전용 파일'만 포함
exports.config = {
  includedFiles: [
    "netlify/functions/wallets.env",
    "netlify/functions/wallets.json"
  ]
};

const fs = require("fs");
const path = require("path");

function readText(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
}
function readJson(p) {
  const raw = readText(p);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function parseDotEnv(text) {
  const out = {};
  if (!text) return out;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i === -1) continue;
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function loadPublicWalletConfig() {
  const cfg = {};
  const base = __dirname;
  const j = readJson(path.join(base, "wallets.json"));
  if (j && typeof j === "object") Object.assign(cfg, j);
  Object.assign(cfg, parseDotEnv(readText(path.join(base, "wallets.env"))));
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && v !== "") cfg[k] = v;
  }
  return cfg;
}

exports.handler = async () => {
  const now = new Date().toISOString();
  const cfg = loadPublicWalletConfig();

  const walletKeys = [
    "BTC_ADDRESS","ETH_ADDRESS","XRP_ADDRESS","BNB_ADDRESS","XLM_ADDRESS","TRX_ADDRESS",
    "USDT_ETH_ADDRESS","USDT_TRX_ADDRESS","USDC_ADDRESS","USDC_TRX_ADDRESS","DAI_ADDRESS","ANKRMATIC_ADDRESS",
    "WALLET_PUBLIC_ADDRESS"
  ];
  const envDetail = Object.fromEntries(
    walletKeys.map(k => [k, !!cfg[k]])
  );

  // 공개 키(노출돼도 무방한 것)만 간단 요약
  const env = {
    google:            !!process.env.GOOGLE_API_KEY,
    naver_id:          !!process.env.NAVER_API_KEY,
    naver_secret:      !!process.env.NAVER_CLIENT_SECRET, // 표시만 true/false
    openai:            !!process.env.OPENAI_API_KEY,
    supabase_url:      !!process.env.SUPABASE_URL,
    supabase_anon:     !!process.env.SUPABASE_ANON_KEY,
    wallets_any:       walletKeys.some(k => !!cfg[k])
  };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: true,
      ts: now,
      env,
      env_detail: envDetail,
      payments: { card: false, crypto: env.wallets_any, affiliate: false, bank_transfer: false },
      media: { freeAccess: { enabled: false, until: null } }
    })
  };
};
