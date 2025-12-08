// netlify/functions/wallets.js
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트
//
// - Netlify ENV(process.env) + api-key.json / API 키.json / api-key.env / API 키.env 에 들어 있는
//   지갑 주소들을 읽어서 /api/wallets 요청 시 JSON으로 반환합니다.
// - 실제 on-chain 잔액/트랜잭션 조회는 나중에 별도의 함수에서 처리합니다.

const fs = require("fs");
const path = require("path");

// 1. 설정 로딩 (JSON + .env 스타일)
function loadConfig() {
  const cfg = {};
  const base = __dirname;      // 함수 파일이 위치한 폴더
  const root = process.cwd();  // 함수 번들 루트

  // 1) JSON 파일 후보들 (영문/한글 이름 + 여러 위치)
  const jsonCandidates = [
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),
    path.join(root, "api-key.json"),
    path.join(root, "API 키.json"),
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
      console.error("[wallets] api-key.json 읽기 오류:", e);
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
      console.error("[wallets] api-key.env 읽기 오류:", e);
    }
  }

  return cfg;
}

// 2. config / ENV 에서 값 가져오기
function getVal(cfg, key) {
  // 1순위: Netlify ENV
  if (process.env && Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key]) {
    return process.env[key];
  }
  // 2순위: JSON / env
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
  const cfg = loadConfig();
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

  // 주요 온체인/토큰 지갑들
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

  // 중앙화 거래소(LBank) – API 키가 있으면 존재만 표시 (구체 주소는 거래소에서 관리)
  const hasLbank = !!getVal(cfg, "LBANK_API_KEY") && !!getVal(cfg, "LBANK_API_SECRET");
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
        wallets
      },
      null,
      2
    )
  };
};
