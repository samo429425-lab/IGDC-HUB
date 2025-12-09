// netlify/functions/wallets.js
// PUBLIC 지갑주소만 파일/ENV에서 읽어 리스트 반환 (CommonJS)

"use strict";

// 번들에 '지갑주소 전용 파일'만 포함 (비밀 포함 파일 금지)
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

function loadConfig() {
  const cfg = {};
  const base = __dirname;

  // 1) JSON (공개 지갑주소 전용)
  const j = readJson(path.join(base, "wallets.json"));
  if (j && typeof j === "object") Object.assign(cfg, j);

  // 2) .env (공개 지갑주소 전용)
  const e = parseDotEnv(readText(path.join(base, "wallets.env")));
  Object.assign(cfg, e);

  // 3) Netlify ENV (process.env) — 최우선
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && v !== "") cfg[k] = v;
  }
  return cfg;
}

function addWallet(list, { chain, symbol, address, note }) {
  if (!address || String(address).trim() === "") return;
  list.push({ chain, symbol, address, note: note || null });
}
function buildWallets(cfg) {
  const out = [];
  addWallet(out, { chain: "Bitcoin",     symbol: "BTC",  address: cfg.BTC_ADDRESS });
  addWallet(out, { chain: "Ethereum",    symbol: "ETH",  address: cfg.ETH_ADDRESS });
  addWallet(out, { chain: "Ripple",      symbol: "XRP",  address: cfg.XRP_ADDRESS });
  addWallet(out, { chain: "BNB",         symbol: "BNB",  address: cfg.BNB_ADDRESS });
  addWallet(out, { chain: "Stellar",     symbol: "XLM",  address: cfg.XLM_ADDRESS });
  addWallet(out, { chain: "TRON",        symbol: "TRX",  address: cfg.TRX_ADDRESS });
  addWallet(out, { chain: "USDT(ETH)",   symbol: "USDT", address: cfg.USDT_ETH_ADDRESS, note: "ERC-20" });
  addWallet(out, { chain: "USDT(TRX)",   symbol: "USDT", address: cfg.USDT_TRX_ADDRESS, note: "TRC-20" });
  addWallet(out, { chain: "USDC",        symbol: "USDC", address: cfg.USDC_ADDRESS });
  addWallet(out, { chain: "USDC(TRX)",   symbol: "USDC", address: cfg.USDC_TRX_ADDRESS, note: "TRC-20" });
  addWallet(out, { chain: "DAI",         symbol: "DAI",  address: cfg.DAI_ADDRESS });
  addWallet(out, { chain: "ANKR(MATIC)", symbol: "ANKR", address: cfg.ANKRMATIC_ADDRESS, note: "Polygon" });
  addWallet(out, { chain: "Public",      symbol: "WALLET", address: cfg.WALLET_PUBLIC_ADDRESS });
  return out;
}

let CACHE = null;
function readOnce() {
  if (CACHE) return CACHE;
  const cfg = loadConfig();
  const wallets = buildWallets(cfg);
  CACHE = { cfg, wallets };
  return CACHE;
}

exports.handler = async () => {
  try {
    const base = __dirname;
    const hasEnvFile  = !!readText(path.join(base, "wallets.env"));
    const hasJsonFile = !!readText(path.join(base, "wallets.json"));
    const { wallets } = readOnce();
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: true,
        n: wallets.length,
        wallets,
        env: {
          has_env_file: hasEnvFile,
          has_api_json: hasJsonFile,
          has_process: !!(process.env && Object.keys(process.env).length)
        }
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
