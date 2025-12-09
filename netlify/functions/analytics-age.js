// /.netlify/functions/analytics-age.js
exports.handler = async (event, context) => {
  try {
    // TODO: GA4 Reporting API에서 연령대별 데이터 fetch
    // 현재는 기본 라벨 + 0 값으로만 반환합니다.
    const payload = {
      ages: [
        { age: '10s', count: 0 },
        { age: '20s', count: 0 },
        { age: '30s', count: 0 },
        { age: '40s', count: 0 },
        { age: '50s', count: 0 },
        { age: '60s+', count: 0 }
      ]
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err) })
    };
  }
};
