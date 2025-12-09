// /.netlify/functions/analytics-region.js
exports.handler = async (event, context) => {
  try {
    // TODO: GA4 Reporting API에서 region 데이터 fetch
    // 현재는 기본 라벨 + 0 값으로만 반환합니다.
    const payload = {
      regions: [
        { code: 'east_asia',       label: '동아시아',     ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'southeast_asia',  label: '동남아시아',   ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'central_asia',    label: '중앙아시아',   ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'southwest_asia',  label: '서남아시아',   ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'middle_east',     label: '중동',         ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'europe_north',    label: '북유럽',       ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'europe_west',     label: '서유럽',       ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'europe_east',     label: '동유럽',       ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'north_africa',    label: '북아프리카',   ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'west_africa',     label: '서아프리카',   ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'east_africa',     label: '동아프리카',   ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'south_africa',    label: '남아프리카',   ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'north_america_au',label: '북미+호주',    ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'south_america',   label: '남미',         ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } },
        { code: 'russia',          label: '러시아',       ages: { '20s': 0, '30s': 0, '40s': 0, '50s': 0 } }
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
