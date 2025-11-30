// /.netlify/functions/wallets
// 지갑/거래소 ENV 가 제대로 올라왔는지만 가볍게 체크하는 헬스 체크용 엔드포인트

exports.handler = async function (event, context) {
  function has(val) { return !!(val && String(val).trim()); }

  const env = process.env || {};
  const checks = {
    LBANK_API_KEY: has(env.LBANK_API_KEY),
    LBANK_API_SECRET: has(env.LBANK_API_SECRET),
    LBANK_UID: has(env.LBANK_UID),
    // 필요하면 여기에 다른 지갑/거래소 키도 계속 추가
  };

  const missing = Object.keys(checks).filter(k => !checks[k]);
  const ok = missing.length === 0;

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      endpoint: "/api/wallets",
      ok,
      missing,
      note: ok
        ? "모든 지갑/거래소 ENV 가 로딩되었습니다."
        : "일부 지갑/거래소 ENV 가 비어 있습니다. (missing 목록 참고)"
    })
  };
};
