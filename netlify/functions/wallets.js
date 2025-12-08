// netlify/functions/wallets.js
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트

const fs   = require("fs");
const path = require("path");

// ────────────────────────
// 1. 설정 파일 로더
// ────────────────────────
function loadConfig() {
  const cfg  = {};
  const base = __dirname;
  const root = process.cwd();

  // Netlify ENV에 설정해 둔 경로 (디렉터리 or 파일)
  const serverEnvPath =
    process.env.SERVER_ENV_PATH ||
    process.env.SERVER_ENV_PATCH ||
    "";

  const jsonCandidates = [];

  // 1) SERVER_ENV_PATH가 지정된 경우
  if (serverEnvPath) {
    // 만약 값 자체가 파일 경로라면 그대로 시도
    jsonCandidates.push(serverEnvPath);
    // 디렉터리일 경우를 대비해서 하위 파일들도 시도
    jsonCandidates.push(
      path.join(serverEnvPath, "API 키.json"),
      path.join(serverEnvPath, "api-key.json")
    );
  }

  // 2) 기존 후보들 (status.js / secureEnvBridge 와 동일 계열)
  jsonCandidates.push(
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),
    path.join(root, "api-key.json"),
    path.join(root, "API 키.json"),
    path.join(root, "netlify", "functions", "api-key.json"),
    path.join(root, "netlify", "functions", "API 키.json")
  );

  // JSON 파일 로딩
  for (const p of jsonCandidates) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      const raw  = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      if (json && typeof json === "object") {
        Object.assign(cfg, json);
      }
    } catch (e) {
      console.error("[wallets] JSON load error:", p, e.message);
    }
  }

  // 3) .env 스타일 파일 후보들
  const envCandidates = [];

  if (serverEnvPath) {
    envCandidates.push(
      path.join(serverEnvPath, "API 키.env"),
      path.join(serverEnvPath, "api-key.env")
    );
  }

  envCandidates.push(
    path.join(base, "api-key.env"),
    path.join(base, "API 키.env"),
    path.join(base, "..", "api-key.env"),
    path.join(base, "..", "API 키.env"),
    path.join(root, "api-key.env"),
    path.join(root, "API 키.env"),
    path.join(root, "netlify", "functions", "api-key.env"),
    path.join(root, "netlify", "functions", "API 키.env")
  );

  for (const p of envCandidates) {
    try {
      if (!p || !fs.existsSync(p)) continue;
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
      console.error("[wallets] ENV-style load error:", p, e.message);
    }
  }

  return cfg;
}

// ────────────────────────
// 2. ENV + JSON 통합 조회
// ────────────────────────
function getVal(cfg, key) {
  // 1순위: Netlify ENV
  if (
    typeof process !== "undefined" &&
    process.env &&
    Object.prototype.hasOwnProperty.call(process.env, key) &&
    process.env[key]
  ) {
    return process.env[key];
  }

  // 2순위: JSON / .env에서 평평하게 읽힌 키
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key]) {
    return cfg[key];
  }

  // 3순위: 중첩 구조(secrets / WALLETS) 지원
  if (cfg && cfg.secrets && Object.prototype.hasOwnProperty.call(cfg.secrets, key)) {
    return cfg.secrets[key];
  }
  if (cfg && cfg.WALLETS && Object.prototype.hasOwnProperty.call(cfg.WALLETS, key)) {
    return cfg.WALLETS[key];
  }

  return "";
}

// ────────────────────────
// 3. 메인 핸들러
// ────────────────────────
exports.handler = async () => {
  const cfg     = loadConfig();
  const wallets = [];

  function addWallet(options) {
    const address = getVal(cfg, options.key);
    if (!address) return;
    wallets.push({
      chain:      options.chain,
      network:    options.network,
      symbol:     options.symbol,
      address,
      label:      options.label || "",
      watch_only: true,
    });
  }

  // 각 체인별 지갑
  addWallet({ key: "BTC_ADDRESS",        chain: "btc",     network: "Bitcoin mainnet",             symbol: "BTC",        label: "BTC (Bitcoin)" });
  addWallet({ key: "ETH_ADDRESS",        chain: "eth",     network: "Ethereum mainnet",            symbol: "ETH",        label: "ETH (Ethereum)" });
  addWallet({ key: "XRP_ADDRESS",        chain: "xrp",     network: "XRP Ledger",                  symbol: "XRP",        label: "XRP (Ripple)" });
  addWallet({ key: "BNB_ADDRESS",        chain: "bsc",     network: "BNB Smart Chain",             symbol: "BNB",        label: "BNB (BSC)" });
  addWallet({ key: "XLM_ADDRESS",        chain: "xlm",     network: "Stellar",                     symbol: "XLM",        label: "XLM (Stellar)" });
  addWallet({ key: "TRX_ADDRESS",        chain: "trx",     network: "TRON mainnet",                symbol: "TRX",        label: "TRX (TRON)" });
  addWallet({ key: "USDT_ETH_ADDRESS",   chain: "eth",     network: "Ethereum mainnet",            symbol: "USDT",       label: "USDT (Ethereum)" });
  addWallet({ key: "USDT_TRX_ADDRESS",   chain: "trx",     network: "TRON mainnet",                symbol: "USDT",       label: "USDT (TRON)" });
  addWallet({ key: "USDC_ADDRESS",       chain: "multi",   network: "Ethereum/Stellar (mixed)",    symbol: "USDC",       label: "USDC" });
  addWallet({ key: "USDC_TRX_ADDRESS",   chain: "trx",     network: "TRON mainnet",                symbol: "USDC",       label: "USDC (TRON)" });
  addWallet({ key: "ANKRMATIC_ADDRESS",  chain: "polygon", network: "Polygon",                     symbol: "ANKR/MATIC", label: "ANKR-MATIC (Polygon)" });
  addWallet({ key: "DAI_ADDRESS",        chain: "eth",     network: "Ethereum mainnet",            symbol: "DAI",        label: "DAI (Ethereum)" });

  // 대표 공개 주소
  const publicAddr = getVal(cfg, "WALLET_PUBLIC_ADDRESS");
  if (publicAddr) {
    wallets.push({
      chain: "multi",
      network: "Multi-chain",
      symbol: "WALLET",
      address: publicAddr,
      label: "대표 공개 지갑",
      watch_only: true,
    });
  }

  // LBank 연동 여부
  const hasLbank =
    !!getVal(cfg, "LBANK_API_KEY") || !!getVal(cfg, "LBANK_API_SECRET");

  const body = {
    endpoint: "/api/wallets",
    ok: wallets.length > 0 || hasLbank,
    wallets,
    cex: { lbank: hasLbank },
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body, null, 2),
  };
};
