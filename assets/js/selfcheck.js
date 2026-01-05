
// /.netlify/functions/selfcheck.js
// DEPLOY-LOG LEVEL SELF CHECK (FINAL)

async function call(path) {
  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    "";

  const url = base.replace(/\/+$/, "") + path;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    return {
      path,
      ok: res.ok,
      status: res.status,
      body: json || text
    };
  } catch (e) {
    return {
      path,
      ok: false,
      status: 0,
      error: e.message || String(e)
    };
  }
}

function tag(res, layer, hint) {
  return {
    layer,                // env | api | wallet | donation
    ok: res.ok,
    status: res.status,   // HTTP status
    endpoint: res.path,   // failing endpoint
    hint,                 // human readable summary
    error: res.error || null,
    raw: res.body || null
  };
}

exports.handler = async function () {
  const statusRes   = await call("/api/status");
  const walletsRes  = await call("/api/wallets");
  const donationRes = await call("/api/donation-summary");
  const envRes      = await call("/.netlify/functions/secureEnvBridge");

  const results = [
    tag(statusRes,   "api",      "백엔드 API 응답 실패"),
    tag(walletsRes,  "wallet",   "지갑 / 블록체인 연결"),
    tag(donationRes, "donation", "도네이션 모듈"),
    tag(envRes,      "env",      "ENV / API KEY")
  ];

  const ok = results.every(r => r.ok);

  return {
    statusCode: ok ? 200 : 500,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify({
      ok,
      timestamp: new Date().toISOString(),
      results
    })
  };
};
