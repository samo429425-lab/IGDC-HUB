// netlify/functions/wallets.js
// IGDC 관리자 대시보드: "🪙 지갑 현황 (watch-only)" 엔드포인트
//
// - ENV + api-key.json / API 키.json / api-key.env / API 키.env 에 들어 있는
//   지갑 주소들을 읽어서 /api/wallets 요청 시 JSON으로 반환합니다.

const fs = require("fs");
const path = require("path");

// 설정 로딩: JSON + .env 스타일 (status.js 와 동일한 방식)
function loadConfig() {
  const cfg  = {};
  const base = __dirname;
  const cwd  = process.cwd();

  // 1) JSON 파일 후보들
  const jsonCandidates = [
    path.join(base, "api-key.json"),
    path.join(base, "API 키.json"),
    path.join(base, "..", "api-key.json"),
    path.join(base, "..", "API 키.json"),
    path.join(cwd, "api-key.json"),
    path.join(cwd, "API 키.json"),
    path.join(cwd, "netlify", "functions", "api-key.json"),
    path.join(cwd, "netlify", "functions", "API 키.json")
  ];

  for (const p of jsonCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw  = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      Object.assign(cfg, json);
      break;
    } catch (e) {
      console.error("[wallets] api-key.json 읽기 오류:", p, e);
    }
  }

  // 2) env 스타일 파일 후보들
  const envCandidates = [
    path.join(base, "api-key.env"),
    path.join(base, "API 키.env"),
    path.join(base, "..", "api-key.env"),
    path.join(base, "..", "API 키.env"),
    path.join(cwd, "api-key.env"),
    path.join(cwd, "API 키.env"),
    path.join(cwd, "netlify", "functions", "api-key.env"),
    path.join(cwd, "netlify", "functions", "API 키.env")
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
        if (key && !cfg[key]) cfg[key] = val;
      });
      break;
    } catch (e) {
      console.error("[wallets] api-key.env 읽기 오류:", p, e);
    }
  }

  return cfg;
}

// config / 중첩 객체 / ENV 에서 순서대로 값 가져오기
function getVal(cfg, key) {
  if (cfg) {
    if (Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key]) {
      return cfg[key];
    }
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

  // 1) 메인 체인 지갑들
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
    network: "XRP Ledger mainnet",
    address: xrp,
    tokens: ["XRP"]
  });

  const bnb = getVal(cfg, "BNB_ADDRESS");
  addWallet(!!bnb, {
    chain: "bsc",
    network: "BNB Smart Chain mainnet",
    address: bnb,
    tokens: ["BNB"]
  });

  const xlm = getVal(cfg, "XLM_ADDRESS");
  addWallet(!!xlm, {
    chain: "xlm",
    network: "Stellar mainnet",
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

  // 2) 스테이블·토큰들
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

  // 3) LBank (거래소 계정) – 주소 대신 "계정" 단위로 표기
  const lbankKey = getVal(cfg, "LBANK_API_KEY");
  if (lbankKey) {
    wallets.push({
      chain: "cex",
      network: "LBank (account)",
      address: "(API key configured; 주소는 거래소 내 계정으로 관리)",
      tokens: ["various"],
      watch_only: true
    });
  }

  const ok = true; // HTTP 200 이고, 엔드포인트 자체는 정상

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
