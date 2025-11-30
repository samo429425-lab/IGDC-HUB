// /.netlify/functions/selfcheck
// status + wallets + secureEnvBridge 를 한 번에 묶어서 보는 종합 self-check 엔드포인트
// Netlify Node 18+ 런타임의 내장 fetch 를 사용하며, 각 부분 엔드포인트의 상태를 한 번에 확인한다.

async function call(path) {
  // 같은 사이트 안에서 돌기 때문에 BASE_URL 은 Netlify 가 넣어주는 URL 사용
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  const url = base.replace(/\/+$/,"") + path;

  try {
    // 2초 타임아웃
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      // JSON 이 아니면 그대로 text 로 둔다
    }

    return {
      path,
      status: res.status,
      ok: res.ok,
      body: json || text,
    };
  } catch (e) {
    return {
      path,
      status: 0,
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
  }
}

exports.handler = async function () {
  // 기본 status / wallets 는 필수, secureEnvBridge 는 선택(없어도 전체 ok 로 간주 가능)
  const [statusRes, walletsRes, envRes] = await Promise.all([
    call("/api/status"),
    call("/api/wallets"),
    // secureEnvBridge 가 없거나 404 인 경우를 위해 try/catch 래핑
    call("/.netlify/functions/secureEnvBridge").catch((e) => ({
      path: "/.netlify/functions/secureEnvBridge",
      status: 0,
      ok: false,
      error: e && e.message ? e.message : String(e),
    })),
  ]);

  const allOk =
    statusRes.ok &&
    walletsRes.ok &&
    (!envRes || envRes.ok);

  return {
    statusCode: allOk ? 200 : 500,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      endpoint: "/api/selfcheck",
      ok: allOk,
      parts: { statusRes, walletsRes, envRes },
    }),
  };
};
