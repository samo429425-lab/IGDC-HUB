// netlify/functions/wallets.js (debug 버전)
// 지갑 주소를 못 읽는 원인을 찾기 위해, 어떤 경로들을 탐색했는지 / 어떤 키를 발견했는지
// debug 필드에 같이 내려줍니다.

const fs = require("fs");
const path = require("path");

function loadConfigWithDebug() {
  const cfg = {};
  const base = __dirname;
  const root = process.cwd();

  const debug = {
    jsonCandidates: [],
    jsonFound: [],
    envCandidates: [],
    envFound: [],
    walletKeysFromJson: {},
    walletKeysFromEnv: {}
  };

  const jsonCandidates = [];

  // 1) SERVER_ENV_PATH 우선 사용 (있다면)
  const envPath = process.env.SERVER_ENV_PATH;
  if (envPath) {
    try {
      const stat = fs.existsSync(envPath) ? fs.statSync(envPath) : null;
      if (stat && stat.isFile()) {
        jsonCandidates.push(envPath);
      } else {
        jsonCandidates.push(path.join(envPath, "api-key.json"));
        jsonCandidates.push(path.join(envPath, "API 키.json"));
      }
    } catch (e) {
      // 무시
    }
  }

  // 2) secureEnvBridge 와 동일한 경로
  jsonCandidates.push(path.join(root, "netlify", "functions", "API 키.json"));
  jsonCandidates.push(path.join(root, "netlify", "functions", "api-key.json"));

  // 3) 함수 폴더 / 루트 주변의 일반적인 위치들
  jsonCandidates.push(path.join(base, "api-key.json"));
  jsonCandidates.push(path.join(base, "API 키.json"));
  jsonCandidates.push(path.join(base, "..", "api-key.json"));
  jsonCandidates.push(path.join(base, "..", "API 키.json"));
  jsonCandidates.push(path.join(root, "api-key.json"));
  jsonCandidates.push(path.join(root, "API 키.json"));

  for (const p of jsonCandidates) {
    debug.jsonCandidates.push(p);
    const exists = fs.existsSync(p);
    debug.jsonFound.push(exists);
    if (!exists) continue;
    try {
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      if (json && typeof json === "object") {
        Object.assign(cfg, json);
      }
    } catch (e) {
      // JSON 파싱 오류는 디버그용이므로 조용히 무시
    }
  }

  // .env 스타일 보조 파일들
  const envCandidates = [];
  if (envPath) {
    envCandidates.push(path.join(envPath, "api-key.env"));
    envCandidates.push(path.join(envPath, "API 키.env"));
  }
  envCandidates.push(path.join(base, "api-key.env"));
  envCandidates.push(path.join(base, "API 키.env"));
  envCandidates.push(path.join(base, "..", "api-key.env"));
  envCandidates.push(path.join(base, "..", "API 키.env"));
  envCandidates.push(path.join(root, "api-key.env"));
  envCandidates.push(path.join(root, "API 키.env"));
  envCandidates.push(path.join(root, "netlify", "functions", "api-key.env"));
  envCandidates.push(path.join(root, "netlify", "functions", "API 키.env"));

  for (const p of envCandidates) {
    debug.envCandidates.push(p);
    const exists = fs.existsSync(p);
    debug.envFound.push(exists);
    if (!exists) continue;
    try {
      const raw = fs.readFileSync(p, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) return;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key && !cfg[key]) {
          cfg[key] = val;
        }
      });
    } catch (e) {
      // 무시
    }
  }

  // 어떤 키들이 JSON/ENV 에서 보였는지 플래그만 기록
  const walletKeys = [
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
    "WALLET_PUBLIC_ADDRESS",
    "LBANK_API_KEY",
    "LBANK_API_SECRET"
  ];
  for (const k of walletKeys) {
    debug.walletKeysFromJson[k] = Object.prototype.hasOwnProperty.call(cfg, k);
    debug.walletKeysFromEnv[k] = !!process.env[k];
  }

  return { cfg, debug };
}

function getVal(cfg, key) {
  if (process.env && Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key]) {
    return process.env[key];
  }
  if (cfg) {
    if (Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key]) {
      return cfg[key];
    }
    if (cfg.secrets && cfg.secrets[key]) return cfg.secrets[key];
    if (cfg.WALLETS && cfg.WALLETS[key]) return cfg.WALLETS[key];
  }
  return "";
}

exports.handler = async () => {
  const { cfg, debug } = loadConfigWithDebug();
  const wallets = [];

  function addWallet(addressKey, meta) {
    const addr = getVal(cfg, addressKey);
    if (!addr) return;
    wallets.push({
      chain: meta.chain,
      network: meta.network,
      address: addr,
      tokens: meta.tokens || [],
      watch_only: true
    });
  }

  // 온체인/토큰 지갑들
  addWallet("BTC_ADDRESS",       { chain: "btc",     network: "Bitcoin mainnet",                       tokens: ["BTC"] });
  addWallet("ETH_ADDRESS",       { chain: "eth",     network: "Ethereum mainnet",                      tokens: ["ETH"] });
  addWallet("XRP_ADDRESS",       { chain: "xrp",     network: "XRP Ledger",                            tokens: ["XRP"] });
  addWallet("BNB_ADDRESS",       { chain: "bsc",     network: "BNB Smart Chain (BEP-20)",              tokens: ["BNB"] });
  addWallet("XLM_ADDRESS",       { chain: "xlm",     network: "Stellar",                               tokens: ["XLM"] });
  addWallet("TRX_ADDRESS",       { chain: "trx",     network: "TRON mainnet",                          tokens: ["TRX"] });
  addWallet("USDT_ETH_ADDRESS",  { chain: "eth",     network: "Ethereum mainnet",                      tokens: ["USDT"] });
  addWallet("USDT_TRX_ADDRESS",  { chain: "trx",     network: "TRON mainnet",                          tokens: ["USDT"] });
  addWallet("USDC_ADDRESS",      { chain: "eth",     network: "Ethereum mainnet / Stellar (mixed)",    tokens: ["USDC"] });
  addWallet("USDC_TRX_ADDRESS",  { chain: "trx",     network: "TRON mainnet",                          tokens: ["USDC"] });
  addWallet("ANKRMATIC_ADDRESS", { chain: "polygon", network: "Polygon mainnet (ANKR/MATIC 공유 주소)", tokens: ["ANKR", "MATIC"] });
  addWallet("DAI_ADDRESS",       { chain: "eth",     network: "Ethereum mainnet",                      tokens: ["DAI"] });

  // 대표 공개 주소 (옵션)
  const pub = getVal(cfg, "WALLET_PUBLIC_ADDRESS");
  if (pub && !wallets.length) {
    wallets.push({
      chain: "multi",
      network: "Multi-chain",
      address: pub,
      tokens: [],
      watch_only: true
    });
  }

  // LBank (CEX)
  const hasLbank =
    !!getVal(cfg, "LBANK_API_KEY") &&
    !!getVal(cfg, "LBANK_API_SECRET");

  if (hasLbank) {
    wallets.push({
      chain: "lbank",
      network: "LBank (centralized exchange)",
      address: "[LBank 계정/API 연동됨 – 입금 주소는 거래소에서 확인]",
      tokens: ["USDT", "BTC", "ETH"],
      watch_only: true
    });
  }

  const ok = wallets.length > 0 || hasLbank;

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(
      {
        endpoint: "/api/wallets",
        ok,
        wallets,
        debug
      },
      null,
      2
    )
  };
};
