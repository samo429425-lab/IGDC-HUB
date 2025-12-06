// netlify/functions/wallets.js
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트
//
// - api-key.json 또는 api-key.env 에 들어 있는 지갑 주소들을 읽어서
//   /api/wallets 요청 시 JSON으로 반환합니다.
// - 실제 on-chain 잔액/트랜잭션 조회는 나중에 별도의 함수에서 처리할 수 있습니다.

const fs = require("fs");
const path = require("path");

// api-key.json 또는 api-key.env 로부터 설정 로드
function loadConfig() {
  const base = __dirname;
  // 1) api-key.json 먼저 시도
  try {
    const jsonPath = path.join(base, "api-key.json");
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("wallets: api-key.json load error:", e);
  }

  // 2) api-key.env 형식 (KEY=VALUE 줄들)
  try {
    const envPath = path.join(base, "api-key.env");
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, "utf8");
      const cfg = {};
      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) return;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key) cfg[key] = val;
      });
      return cfg;
    }
  } catch (e) {
    console.error("wallets: api-key.env load error:", e);
  }

  // 3) 아무것도 없으면 빈 객체
  return {};
}

// config 객체 / 중첩 객체 / Netlify ENV 에서 순서대로 값 가져오기
function getVal(cfg, key) {
  if (cfg) {
    if (Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key]) {
      return cfg[key];
    }
    // 혹시 {secrets:{...}}, {WALLETS:{...}} 같은 구조일 수도 있으니 대비
    if (cfg.secrets && cfg.secrets[key]) return cfg.secrets[key];
    if (cfg.WALLETS && cfg.WALLETS[key]) return cfg.WALLETS[key];
  }
  if (process.env && process.env[key]) {
    return process.env[key];
  }
  return "";
}

exports.handler = async () => {
  const cfg = loadConfig();
  const wallets = [];

  function addWallet(hasValue, data) {
    if (!hasValue) return;
    wallets.push({
      chain: data.chain,        // 'btc', 'eth', 'trx', 'xrp', ...
      network: data.network,    // 'Bitcoin mainnet' 등
      address: data.address,    // 전체 주소 문자열 (공개 가능 주소만)
      tokens: data.tokens || [],// ['BTC'], ['ETH','USDT'] 등
      watch_only: true          // 현재는 전부 watch-only
    });
  }

  // ─────────────────────────────────────
  // 12개 지갑 주소 매핑 (api-key.* / ENV 기준)
  // ─────────────────────────────────────

  const btc = getVal(cfg, "BTC_ADDRESS");
  addWallet(!!btc, {
    chain: "btc",
    network: "Bitcoin mainnet",
    address: btc,
    tokens: ["BTC"]
  });

  const eth = getVal(cfg, "ETH_ADDRESS");
  addWallet(!!eth, {
    chain: "eth",
    network: "Ethereum mainnet",
    address: eth,
    tokens: ["ETH"]
  });

  const xrp = getVal(cfg, "XRP_ADDRESS");
  addWallet(!!xrp, {
    chain: "xrp",
    network: "XRP Ledger",
    address: xrp,
    tokens: ["XRP"]
  });

  const bnb = getVal(cfg, "BNB_ADDRESS");
  addWallet(!!bnb, {
    chain: "bsc",
    network: "BNB Smart Chain (BEP-20)",
    address: bnb,
    tokens: ["BNB"]
  });

  const xlm = getVal(cfg, "XLM_ADDRESS");
  addWallet(!!xlm, {
    chain: "xlm",
    network: "Stellar",
    address: xlm,
    tokens: ["XLM"]
  });

  const trx = getVal(cfg, "TRX_ADDRESS");
  addWallet(!!trx, {
    chain: "trx",
    network: "TRON mainnet",
    address: trx,
    tokens: ["TRX"]
  });

  const usdtEth = getVal(cfg, "USDT_ETH_ADDRESS");
  addWallet(!!usdtEth, {
    chain: "eth",
    network: "Ethereum mainnet",
    address: usdtEth,
    tokens: ["USDT"]
  });

  const usdtTrx = getVal(cfg, "USDT_TRX_ADDRESS");
  addWallet(!!usdtTrx, {
    chain: "trx",
    network: "TRON mainnet",
    address: usdtTrx,
    tokens: ["USDT"]
  });

  const usdcEth = getVal(cfg, "USDC_ADDRESS");
  addWallet(!!usdcEth, {
    chain: "eth",
    network: "Ethereum mainnet",
    address: usdcEth,
    tokens: ["USDC"]
  });

  const usdcTrx = getVal(cfg, "USDC_TRX_ADDRESS");
  addWallet(!!usdcTrx, {
    chain: "trx",
    network: "TRON mainnet",
    address: usdcTrx,
    tokens: ["USDC"]
  });

  const ankrMatic = getVal(cfg, "ANKRMATIC_ADDRESS");
  addWallet(!!ankrMatic, {
    chain: "polygon",
    network: "Polygon mainnet",
    address: ankrMatic,
    tokens: ["ANKR", "MATIC"]
  });

  const dai = getVal(cfg, "DAI_ADDRESS");
  addWallet(!!dai, {
    chain: "eth",
    network: "Ethereum mainnet",
    address: dai,
    tokens: ["DAI"]
  });

  // 선택: 대표 공개 주소 하나만 별도 관리하고 싶을 때
  const pub = getVal(cfg, "WALLET_PUBLIC_ADDRESS");
  if (pub && !wallets.length) {
    addWallet(true, {
      chain: "multi",
      network: "Multi-chain",
      address: pub,
      tokens: []
    });
  }

  // ─────────────────────────────────────
  // LBank (CEX) 존재 여부만 표시 (키 값 자체는 절대 노출 X)
  // ─────────────────────────────────────
  const hasLbankKey =
    !!getVal(cfg, "LBANK_API_KEY") && !!getVal(cfg, "LBANK_API_SECRET");

  if (hasLbankKey) {
    addWallet(true, {
      chain: "lbank",
      network: "LBank (centralized exchange)",
      // 실제 입금 주소는 계정 내부에서 관리되므로 여기서는 노출하지 않음
      address: "[API key configured – deposit addresses managed in exchange]",
      tokens: ["USDT", "BTC", "ETH"],
    });
  }

  const ok = wallets.length > 0 || hasLbankKey;

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
