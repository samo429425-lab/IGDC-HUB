// netlify/functions/wallets.js
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트
//
// - Netlify ENV + api-key.json / API 키.json 에 들어 있는 지갑·거래소 정보를 읽어서
//   /api/wallets 요청 시 JSON으로 반환합니다.
// - 실제 on-chain 잔액/트랜잭션 조회는 별도 함수에서 처리합니다.

const fs = require("fs");
const path = require("path");

// 설정 파일 로드 (status.js / secureEnvBridge.js 와 비슷한 패턴)
function loadConfig() {
  const cfg = {};

  const base = __dirname;
  const root = process.cwd();

  // 1) JSON 파일 후보 (한글/영문 파일명 + 여러 위치)
  const jsonCandidates = [
    // 함수 빌드 폴더 주변
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),

    // Netlify deploy 루트 기준 (secureEnvBridge 와 동일)
    path.join(root, "netlify", "functions", "api-key.json"),
    path.join(root, "netlify", "functions", "API 키.json"),

    // 루트 바로 아래
    path.join(root, "api-key.json"),
    path.join(root, "API 키.json"),
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
      console.error("[wallets] JSON load error:", p, e.message);
    }
  }

  // 2) env 스타일 파일 (선택 사항)
  const envCandidates = [
    path.join(base, "api-key.env"),
    path.join(base, "API 키.env"),
    path.join(base, "..", "api-key.env"),
    path.join(base, "..", "API 키.env"),
    path.join(root, "api-key.env"),
    path.join(root, "API 키.env"),
    path.join(root, "netlify", "functions", "api-key.env"),
    path.join(root, "netlify", "functions", "API 키.env"),
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
      console.error("[wallets] ENV-style load error:", p, e.message);
    }
  }

  return cfg;
}

// ENV + JSON 통합 조회
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
  if (cfg && cfg.secrets && Object.prototype.hasOwnProperty.call(cfg.secrets, key)) {
    return cfg.secrets[key];
  }
  if (cfg && cfg.WALLETS && Object.prototype.hasOwnProperty.call(cfg.WALLETS, key)) {
    return cfg.WALLETS[key];
  }
  return "";
}

exports.handler = async () => {
  const cfg = loadConfig();
  const wallets = [];

  function addWallet(options) {
    const address = getVal(cfg, options.key);
    if (!address) return;
    wallets.push({
      chain: options.chain,       // "btc", "eth" 등
      network: options.network,   // "Bitcoin mainnet" 등
      symbol: options.symbol,     // "BTC", "ETH" 등
      address,
      label: options.label || "", // 카드 제목
      watch_only: true,
    });
  }

  // 온체인 지갑들 (API 키.json 키 이름 기준)

  addWallet({
    key: "BTC_ADDRESS",
    chain: "btc",
    network: "Bitcoin mainnet",
    symbol: "BTC",
    label: "BTC (Bitcoin)",
  });

  addWallet({
    key: "ETH_ADDRESS",
    chain: "eth",
    network: "Ethereum mainnet",
    symbol: "ETH",
    label: "ETH (Ethereum)",
  });

  addWallet({
    key: "XRP_ADDRESS",
    chain: "xrp",
    network: "XRP Ledger",
    symbol: "XRP",
    label: "XRP (Ripple)",
  });

  addWallet({
    key: "BNB_ADDRESS",
    chain: "bsc",
    network: "BNB Smart Chain",
    symbol: "BNB",
    label: "BNB (BSC)",
  });

  addWallet({
    key: "XLM_ADDRESS",
    chain: "xlm",
    network: "Stellar",
    symbol: "XLM",
    label: "XLM (Stellar)",
  });

  addWallet({
    key: "TRX_ADDRESS",
    chain: "trx",
    network: "TRON mainnet",
    symbol: "TRX",
    label: "TRX (TRON)",
  });

  addWallet({
    key: "USDT_ETH_ADDRESS",
    chain: "eth",
    network: "Ethereum mainnet",
    symbol: "USDT",
    label: "USDT (Ethereum)",
  });

  addWallet({
    key: "USDT_TRX_ADDRESS",
    chain: "trx",
    network: "TRON mainnet",
    symbol: "USDT",
    label: "USDT (TRON)",
  });

  addWallet({
    key: "USDC_ADDRESS",
    chain: "multi",
    network: "Ethereum/Stellar (mixed)",
    symbol: "USDC",
    label: "USDC",
  });

  addWallet({
    key: "USDC_TRX_ADDRESS",
    chain: "trx",
    network: "TRON mainnet",
    symbol: "USDC",
    label: "USDC (TRON)",
  });

  addWallet({
    key: "ANKRMATIC_ADDRESS",
    chain: "polygon",
    network: "Polygon",
    symbol: "ANKR/MATIC",
    label: "ANKR-MATIC (Polygon)",
  });

  addWallet({
    key: "DAI_ADDRESS",
    chain: "eth",
    network: "Ethereum mainnet",
    symbol: "DAI",
    label: "DAI (Ethereum)",
  });

  // 대표 공개 주소 (여러 체인 공용)
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

  // LBank 존재 여부만 별도 플래그로
  const hasLbank =
    !!getVal(cfg, "LBANK_API_KEY") || !!getVal(cfg, "LBANK_API_SECRET");

  const body = {
    endpoint: "/api/wallets",
    ok: wallets.length > 0 || hasLbank,
    wallets,
    cex: {
      lbank: hasLbank,
    },
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
