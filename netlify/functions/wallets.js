// netlify/functions/wallets.js
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트
//
// - Netlify ENV(process.env) + api-key.json / API 키.json / api-key.env / API 키.env 에 들어 있는
//   지갑 주소들을 읽어서 /api/wallets 요청 시 JSON으로 반환합니다.
// - 실제 on-chain 잔액/트랜잭션 조회는 나중에 별도의 함수에서 처리합니다.

const fs = require("fs");
const path = require("path");

// ─────────────────────────────
// 1. 설정 로딩 (JSON + .env 스타일)
// ─────────────────────────────
function loadConfig() {
  const cfg  = {};
  const base = __dirname;      // 함수 파일이 실제 위치한 폴더
  const root = process.cwd();  // 함수 번들 루트 (사이트 루트에 해당)

  // 1) JSON 파일 후보들 (영문/한글 이름 + 여러 위치)
  const jsonCandidates = [
    // 함수 파일과 같은 폴더
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    // 한 단계 위
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),
    // 프로젝트 루트
    path.join(root, "api-key.json"),
    path.join(root, "API 키.json"),
    // netlify/functions 아래
    path.join(root, "netlify", "functions", "api-key.json"),
    path.join(root, "netlify", "functions", "API 키.json")
  ];

  for (const p of jsonCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw  = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      if (json && typeof json === "object") {
        Object.assign(cfg, json);
      }
    } catch (e) {
      console.error("[wallets] api-key.json 읽기 오류:", p, e);
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
      console.error("[wallets] api-key.env 읽기 오류:", p, e);
    }
  }

  return cfg;
}

// ─────────────────────────────
// 2. config / ENV 에서 값 가져오기
// ─────────────────────────────
function getVal(cfg, key) {
  // 1순위: Netlify ENV
  if (process.env && Object.prototype.hasOwnProperty.call(process.env, key)) {
    return process.env[key];
  }
  // 2순위: JSON / env 로부터 읽어온 값
  if (cfg) {
    if (Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key]) {
      return cfg[key];
    }
    // {secrets:{...}}, {WALLETS:{...}} 구조도 지원
    if (cfg.secrets && cfg.secrets[key]) return cfg.secrets[key];
    if (cfg.WALLETS && cfg.WALLETS[key]) return cfg.WALLETS[key];
  }
  return "";
}

// ─────────────────────────────
// 3. 메인 handler
// ─────────────────────────────
exports.handler = async () => {
  const cfg = loadConfig();
  const wallets = [];

  function addWallet(hasValue, data) {
    if (!hasValue) return;
    wallets.push({
      chain: data.chain,         // 'btc', 'eth', 'trx', 'xrp', ...
      network: data.network,     // 'Bitcoin mainnet' 등
      address: data.address,     // 전체 주소 문자열 (공개 가능 주소만)
      tokens: data.tokens || [], // ['BTC'], ['ETH','USDT'] 등
      watch_only: true           // 현재는 전부 watch-only
    });
  }

  // ─────────────────────────────────────
  // 1) 12개 지갑 주소 매핑 (ENV + api-key.* 기준)
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

  // 2) 대표 공개 주소 하나만 별도 관리하고 싶을 때 (옵션)
  const pub = getVal(cfg, "WALLET_PUBLIC_ADDRESS");
  if (pub && !wallets.length) {
    addWallet(true, {
      chain: "multi",
      network: "Multi-chain",
      address: pub,
      tokens: []
    });
  }

  // 3) LBank (CEX) 존재 여부만 표시 (API 키 존재 여부만 확인, 주소는 노출하지 않음)
  const hasLbankKey =
    !!getVal(cfg, "LBANK_API_KEY") && !!getVal(cfg, "LBANK_API_SECRET");

  if (hasLbankKey) {
    addWallet(true, {
      chain: "lbank",
      network: "LBank (centralized exchange)",
      address: "[API key configured – deposit addresses managed in exchange]",
      tokens: ["USDT", "BTC", "ETH"]
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
