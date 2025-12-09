// /.netlify/functions/analytics-category.js
exports.handler = async (event, context) => {
  try {
    // TODO: GA4 Reporting API에서 카테고리/페이지/유입경로 데이터 fetch
    // 현재는 기본 라벨 + 0 값으로만 반환합니다.
    const payload = {
      categories: [
        { code: 'home',         label: '홈',        count: 0 },
        { code: 'distribution', label: '유통',      count: 0 },
        { code: 'media',        label: '미디어',    count: 0 },
        { code: 'social',       label: '소셜',      count: 0 },
        { code: 'tour',         label: '투어',      count: 0 },
        { code: 'donation',     label: '도네이션',  count: 0 },
        { code: 'etc',          label: '기타',      count: 0 }
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
