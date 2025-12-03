// /.netlify/functions/metrics
// 간단한 서버/사이트 메트릭 더미. 일단은 헬스 체크용으로 200만 돌려줌.

exports.handler = async function (event, context) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      endpoint: "/api/metrics",
      ok: true,
      metrics: {
        uptime: "demo",        // 추후 실제 값으로 교체 가능
        version: "v0.1",
        ts: new Date().toISOString()
      }
    })
  };
};
