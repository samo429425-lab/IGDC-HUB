// netlify/functions/wallets.js
// Reads wallet keys from: process.env, *.env, *.json (function folder)
// Caches on first call to reduce cold-start overhead (CommonJS export)

"use strict";
const fs = require("fs");
const path = require("path");

let CACHE = null;

function readText(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; }
  catch { return null; }
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

  // 1) JSON candidates (specific → general)
  const jsonCandidates = [
    path.join(base, "wallets.json"),
    path.join(base, "API 키.json"),
    path.join(base, "api-key.json"),
  ];
  for (const p of jsonCandidates) {
    const j = readJson(p);
    if (j && typeof j === "object") Object.assign(cfg, j);
  }

  // 2) .env candidates (KEY=VALUE)
  const envCandidates = [
    path.join(base, "wallets.env"),
    path.join(base, "API 키.env"),
    path.join(base, "api-key.env"),
  ];
  for (const p of envCandidates) {
    const t = readText(p);
    if (t) Object.assign(cfg, parseDotEnv(t));
  }

  // 3) Netlify ENV overrides
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
  addWallet(out, { chain: "USDT(ETH)",   symbol: "USDT", address: cfg.USDT_ETH_ADDRESS,  note: "ERC-20" });
  addWallet(out, { chain: "USDT(TRX)",   symbol: "USDT", address: cfg.USDT_TRX_ADDRESS,  note: "TRC-20" });
  addWallet(out, { chain: "USDC",        symbol: "USDC", address: cfg.USDC_ADDRESS });
  addWallet(out, { chain: "USDC(TRX)",   symbol: "USDC", address: cfg.USDC_TRX_ADDRESS,  note: "TRC-20" });
  addWallet(out, { chain: "DAI",         symbol: "DAI",  address: cfg.DAI_ADDRESS });
  addWallet(out, { chain: "ANKR(MATIC)", symbol: "ANKR", address: cfg.ANKRMATIC_ADDRESS, note: "Polygon" });
  addWallet(out, { chain: "Public",      symbol: "WALLET", address: cfg.WALLET_PUBLIC_ADDRESS });
  return out;
}
function readOnce() {
  if (CACHE) return CACHE;
  const cfg = loadConfig();
  const wallets = buildWallets(cfg);
  CACHE = { cfg, wallets };
  return CACHE;
}

exports.handler = async () => {
  try {
    const { cfg, wallets } = readOnce();
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: true,
        n: wallets.length,
        wallets,
        env: {
          has_env_file:
            !!readText(path.join(__dirname, "wallets.env")) ||
            !!readText(path.join(__dirname, "API 키.env")) ||
            !!readText(path.join(__dirname, "api-key.env")),
          has_api_json:
            !!readText(path.join(__dirname, "wallets.json")) ||
            !!readText(path.join(__dirname, "API 키.json")) ||
            !!readText(path.join(__dirname, "api-key.json")),
          has_process: !!(process.env && Object.keys(process.env).length),
        },
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
