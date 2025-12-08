// netlify/functions/wallets.js
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트

const fs = require("fs");
const path = require("path");

// ─────────────────────────────
// 설정 로더: status.js 와 동일한 방식
//  - api-key.json / API 키.json (여러 위치)
//  - api-key.env / API 키.env (여러 위치)
//  - 나중에 Netlify ENV 로 옮겨도 getVal 이 자동 처리
// ─────────────────────────────
function loadConfig() {
  const base = __dirname;
  const root = process.cwd();
  const cfg = {};

  // 1) JSON 파일 우선 (한글/영문 파일명 + 여러 위치)
  const jsonCandidates = [
    // 함수 파일 근처
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),
    // 사이트 루트
    path.join(root, "api-key.json"),
    path.join(root, "API 키.json"),
    // netlify/functions 밑에 따로 둔 경우
    path.join(root, "netlify", "functions", "api-key.json"),
    path.join(root, "netlify", "functions", "API 키.json"),
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
      console.error("[wallets] api-key.json 읽기 오류:", p, e);
    }
  }

  // 2) env 스타일 파일 (KEY=VALUE) – 선택
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
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/i);
        if (!m) return;
        const k = m[1];
        const v = m[2];
        if (!cfg[k]) {
          cfg[k] = v;
        }
      });
    } catch (e) {
      console.error("[wallets] api-key.env 읽기 오류:", p, e);
    }
  }

  return cfg;
}

// config + process.env 에서 키 값 가져오기
function getVal(cfg, key) {
  if (
    process.env &&
    Object.prototype.hasOwnProperty.call(process.env, key) &&
    process.env[key]
  ) {
    return process.env[key];
  }
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key]) {
    return cfg[key];
  }
  if (cfg && cfg.secrets && cfg.secrets[key]) {
    return cfg.secrets[key];
  }
  if (cfg && cfg.WALLETS && cfg.WALLETS[key]) {
    return cfg.WALLETS[key];
  }
  return "";
}

// ─────────────────────────────
// /api/wallets 핸들러
// ─────────────────────────────
exports.handler = async () => {
  const cfg = loadConfig();

  const wallets = [];

  function addWallet({ id, label, chain, symbol, key, network }) {
    const address = getVal(cfg, key);
    if (!address) return;
    wallets.push({
      id,
      label,     // 화면용 이름
      chain,     // 블록체인 이름
      symbol,    // 대표 심볼
      address,   // 실제 공개주소
      network: network || "mainnet",
    });
  }

  // 비트코인 / 이더리움 / 등등 – API 키.json 내 정의 기준
  // (이미 JSON 안에 값이 들어있는 것 확인됨) :contentReference[oaicite:7]{index=7}
  addWallet({
    id: "btc",
    label: "BTC (Bitcoin)",
    chain: "Bitcoin",
    symbol: "BTC",
    key: "BTC_ADDRESS",
  });
  addWallet({
    id: "eth",
    label: "ETH (Ethereum)",
    chain: "Ethereum",
    symbol: "ETH",
    key: "ETH_ADDRESS",
  });
  addWallet({
    id: "xrp",
    label: "XRP (Ripple)",
    chain: "XRP Ledger",
    symbol: "XRP",
    key: "XRP_ADDRESS",
  });
  addWallet({
    id: "bnb",
    label: "BNB (BSC)",
    chain: "BNB Chain",
    symbol: "BNB",
    key: "BNB_ADDRESS",
  });
  addWallet({
    id: "xlm",
    label: "XLM (Stellar)",
    chain: "Stellar",
    symbol: "XLM",
    key: "XLM_ADDRESS",
  });
  addWallet({
    id: "trx",
    label: "TRX (Tron)",
    chain: "TRON",
    symbol: "TRX",
    key: "TRX_ADDRESS",
  });
  addWallet({
    id: "usdt_eth",
    label: "USDT (Ethereum)",
    chain: "Ethereum",
    symbol: "USDT",
    key: "USDT_ETH_ADDRESS",
  });
  addWallet({
    id: "usdt_trx",
    label: "USDT (Tron)",
    chain: "TRON",
    symbol: "USDT",
    key: "USDT_TRX_ADDRESS",
  });
  addWallet({
    id: "usdc",
    label: "USDC (Stellar/기타)",
    chain: "Multi-chain",
    symbol: "USDC",
    key: "USDC_ADDRESS",
  });
  addWallet({
    id: "usdc_trx",
    label: "USDC (Tron)",
    chain: "TRON",
    symbol: "USDC",
    key: "USDC_TRX_ADDRESS",
  });
  addWallet({
    id: "ankr_matic",
    label: "ANKR-MATIC",
    chain: "Polygon",
    symbol: "ANKR-MATIC",
    key: "ANKRMATIC_ADDRESS",
  });
  addWallet({
    id: "dai",
    label: "DAI (Ethereum)",
    chain: "Ethereum",
    symbol: "DAI",
    key: "DAI_ADDRESS",
  });

  // 중앙화 거래소(LBank) – 주소 대신 “있다/없다” 정도만 표시용
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
