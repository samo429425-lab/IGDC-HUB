// /.netlify/functions/wallets
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트
//
// 이 버전은 최대한 코드 용량을 줄이고,
// netlify/functions 폴더 안에 두는 1개의 .env 파일만 읽어서 지갑 정보를 구성합니다.
//
// - SERVER_ENV_PATH / API 키.json 은 더 이상 사용하지 않습니다.
// - 같은 폴더에 있는 wallets.env 또는 "API 키.env" 파일만 읽습니다.
// - 필요하면 Netlify Environment variables(process.env) 값으로도 override 할 수 있습니다.

const fs   = require("fs");
const path = require("path");

// 1) wallets.env / "API 키.env" 에서 KEY=VALUE 형식 로드
function loadWalletEnv() {
  const cfg  = {};
  const base = __dirname;

  const candidates = [
    path.join(base, "wallets.env"),
    path.join(base, "API 키.env")
  ];

  for (const p of candidates) {
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
      // 첫 번째로 발견된 파일만 사용
      break;
    } catch (e) {
      console.error("[wallets] env 파일 로드 오류:", p, e);
    }
  }

  return cfg;
}

// 2) ENV + 파일 통합 조회 (process.env 가 우선)
function getVal(cfg, key) {
  if (
    typeof process !== "undefined" &&
    process.env &&
    Object.prototype.hasOwnProperty.call(process.env, key) &&
    process.env[key]
  ) {
    return process.env[key];
  }
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key]) {
    return cfg[key];
  }
  return "";
}

// 3) 메인 handler
exports.handler = async () => {
  const cfg     = loadWalletEnv();
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
      watch_only: true
    });
  }

  // ─ 온체인 지갑 카드 ─
  addWallet({
    key: "BTC_ADDRESS",
    chain: "btc",
    network: "Bitcoin mainnet",
    symbol: "BTC",
    label: "BTC (Bitcoin)"
  });

  addWallet({
    key: "ETH_ADDRESS",
    chain: "eth",
    network: "Ethereum mainnet",
    symbol: "ETH",
    label: "ETH (Ethereum)"
  });

  addWallet({
    key: "XRP_ADDRESS",
    chain: "xrp",
    network: "XRP Ledger",
    symbol: "XRP",
    label: "XRP (Ripple)"
  });

  addWallet({
    key: "BNB_ADDRESS",
    chain: "bsc",
    network: "BNB Smart Chain",
    symbol: "BNB",
    label: "BNB (BSC)"
  });

  addWallet({
    key: "XLM_ADDRESS",
    chain: "xlm",
    network: "Stellar",
    symbol: "XLM",
    label: "XLM (Stellar)"
  });

  addWallet({
    key: "TRX_ADDRESS",
    chain: "trx",
    network: "TRON mainnet",
    symbol: "TRX",
    label: "TRX (TRON)"
  });

  addWallet({
    key: "USDT_ETH_ADDRESS",
    chain: "eth",
    network: "Ethereum mainnet",
    symbol: "USDT",
    label: "USDT (Ethereum)"
  });

  addWallet({
    key: "USDT_TRX_ADDRESS",
    chain: "trx",
    network: "TRON mainnet",
    symbol: "USDT",
    label: "USDT (TRON)"
  });

  addWallet({
    key: "USDC_ADDRESS",
    chain: "multi",
    network: "Ethereum/Stellar (mixed)",
    symbol: "USDC",
    label: "USDC"
  });

  addWallet({
    key: "USDC_TRX_ADDRESS",
    chain: "trx",
    network: "TRON mainnet",
    symbol: "USDC",
    label: "USDC (TRON)"
  });

  addWallet({
    key: "ANKRMATIC_ADDRESS",
    chain: "polygon",
    network: "Polygon",
    symbol: "ANKR/MATIC",
    label: "ANKR-MATIC (Polygon)"
  });

  addWallet({
    key: "DAI_ADDRESS",
    chain: "eth",
    network: "Ethereum mainnet",
    symbol: "DAI",
    label: "DAI (Ethereum)"
  });

  // 대표 공개 주소
  const publicAddr = getVal(cfg, "WALLET_PUBLIC_ADDRESS");
  if (publicAddr) {
    wallets.push({
      chain:   "multi",
      network: "Multi-chain",
      symbol:  "WALLET",
      address: publicAddr,
      label:   "대표 공개 지갑",
      watch_only: true
    });
  }

  // LBank 존재 여부 (키 값 자체는 노출하지 않음)
  const hasLbank =
    !!getVal(cfg, "LBANK_API_KEY") ||
    !!getVal(cfg, "LBANK_API_SECRET");

  const body = {
    endpoint: "/api/wallets",
    ok: wallets.length > 0 || hasLbank,
    wallets,
    cex: {
      lbank: hasLbank
    }
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body, null, 2)
  };
};
