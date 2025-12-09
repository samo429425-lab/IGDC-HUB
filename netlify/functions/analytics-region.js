// /.netlify/functions/analytics-region.js
exports.handler = async (event, context) => {
  try {

    // TODO: GA4 Reporting API 연동 (지금은 기본값/0값으로 응답)
    const payload = {
      regions: [
        // 동아시아 / 동남아시아 / 서남아시아 / 중앙아시아 / 중동
        { key: 'east_asia',       label: '동아시아',     ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'southeast_asia',  label: '동남아시아',   ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'southwest_asia',  label: '서남아시아',   ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'central_asia',    label: '중앙아시아',   ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'middle_east',     label: '중동',         ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },

        // 아프리카 (북/동/서/남)
        { key: 'africa_north',    label: '북아프리카',   ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'africa_east',     label: '동아프리카',   ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'africa_west',     label: '서아프리카',   ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'africa_south',    label: '남아프리카',   ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },

        // 유럽 (북/서/동)
        { key: 'europe_north',    label: '북유럽',       ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'europe_west',     label: '서유럽',       ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'europe_east',     label: '동유럽',       ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },

        // 미주 (북미·호주) / 남미
        { key: 'americas_north',  label: '북미·호주',    ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },
        { key: 'americas_south',  label: '남미',         ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } },

        // 러시아
        { key: 'russia',          label: '러시아',       ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 } }
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
