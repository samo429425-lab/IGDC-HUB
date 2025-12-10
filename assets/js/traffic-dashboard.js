// traffic-dashboard.js
// IGDC Admin: 유입 현황(지역/연령) 미니 카드 + 전체 모달 대시보드
// - window.IGDC_TRAFFIC.setData(payload) 로 데이터 주입
//   payload 예:
//   {
//     regions: [
//       { code: 'east_asia', label: '동아시아', ages: { '10s': 0, '20s': 0, ... } },
//       ...
//     ]
//   }

(function () {
  if (window.IGDC_TRAFFIC) return; // 중복 방지

  // ------------------------------
  // 0. 상수 정의
  // ------------------------------
  var REGION_ORDER = [
    'east_asia',       // 동아시아
    'southeast_asia',  // 동남아시아
    'southwest_asia',  // 서남아시아
    'central_asia',    // 중앙아시아
    'middle_east',     // 중동
    'africa_north',    // 북아프리카
    'africa_east',     // 동아프리카
    'africa_west',     // 서아프리카
    'africa_south',    // 남아프리카
    'europe_north',    // 북유럽
    'europe_west',     // 서유럽
    'europe_east',     // 동유럽
    'americas_north',  // 북미·호주
    'americas_south',  // 남미
    'russia'           // 러시아
  ];

  var REGION_LABELS = {
    east_asia:      '동아시아',
    southeast_asia: '동남아시아',
    southwest_asia: '서남아시아',
    central_asia:   '중앙아시아',
    middle_east:    '중동',
    africa_north:   '북아프리카',
    africa_east:    '동아프리카',
    africa_west:    '서아프리카',
    africa_south:   '남아프리카',
    europe_north:   '북유럽',
    europe_west:    '서유럽',
    europe_east:    '동유럽',
    americas_north: '북미·호주',
    americas_south: '남미',
    russia:         '러시아'
  };

  var AGE_BUCKETS = ['10s', '20s', '30s', '40s', '50s', '60s+'];
  var AGE_LABELS  = {
    '10s':  '10대',
    '20s':  '20대',
    '30s':  '30대',
    '40s':  '40대',
    '50s':  '50대',
    '60s+': '60대+'
  };

  // ------------------------------
  // 1. 내부 상태
  // ------------------------------
  var state = {
    regions: []   // { code, label, ages: {10s,20s,...} }[]
  };

  var miniCard      = null;
  var miniStatusEl  = null;
  var miniListEl    = null;

  var backdropEl    = null;
  var modalEl       = null;
  var barCanvas     = null;
  var donutCanvas   = null;
  var barChart      = null;
  var donutChart    = null;

  // ------------------------------
  // 2. Payload 정규화
  // ------------------------------
  function normalizePayload(payload) {
    var src = (payload && payload.regions) || [];
    var byCode = {};

    src.forEach(function (r) {
      var code = r.code || r.key;
      if (!code) return;
      byCode[code] = r;
    });

    var regions = REGION_ORDER.map(function (code) {
      var found = byCode[code] || {};
      var ages = found.ages || {};
      var normAges = {};

      AGE_BUCKETS.forEach(function (bucket) {
        var v = ages[bucket];
        var n = (typeof v === 'number' && isFinite(v)) ? v : 0;
        normAges[bucket] = n;
      });

      return {
        code:  code,
        label: found.label || REGION_LABELS[code] || code,
        ages:  normAges
      };
    });

    return { regions: regions };
  }

  function buildDefaultState() {
    return normalizePayload({ regions: [] });
  }

  function getTotalForRegion(r) {
    var sum = 0;
    AGE_BUCKETS.forEach(function (b) {
      sum += r.ages[b] || 0;
    });
    return sum;
  }

  function getTotalAll() {
    var total = 0;
    state.regions.forEach(function (r) {
      total += getTotalForRegion(r);
    });
    return total;
  }

  // ------------------------------
  // 3. 미니 카드 DOM + 위치 보정
  // ------------------------------
  function createMiniCard() {
    if (miniCard) return;

    miniCard = document.createElement('section');
    miniCard.className = 'igdc-sc-card igdc-traffic-mini-card';
    miniCard.setAttribute('aria-label', '유입 현황(지역/연령)');

    miniCard.innerHTML =
      '<div class="igdc-sc-card-header" ' +
      '     style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '  <div>' +
      '    <div style="font-weight:bold;font-size:13px;">유입 현황(지역/연령)</div>' +
      '    <div style="font-size:11px;color:#a07040;">대륙·지역별 방문자 추이를 간단히 봅니다.</div>' +
      '  </div>' +
      '  <div id="igdc-traffic-mini-status" ' +
      '       style="font-size:11px;color:#aa0000;white-space:nowrap;">대기(데이터 없음)</div>' +
      '</div>' +
      '<div class="igdc-traffic-mini-body" ' +
      '     style="max-height:200px;overflow:auto;font-size:11px;line-height:1.4;' +
      '            border-top:1px dashed #ead1a5;padding-top:4px;">' +
      '  <div id="igdc-traffic-mini-list" aria-label="지역별 유입 합계"></div>' +
      '  <div style="margin-top:4px;color:#777;">클릭하면 전체 대시보드를 팝업으로 엽니다.</div>' +
      '</div>';

    miniStatusEl = miniCard.querySelector('#igdc-traffic-mini-status');
    miniListEl   = miniCard.querySelector('#igdc-traffic-mini-list');

    miniCard.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });
  }

  // 실제로 어디에 붙일지 결정 (항상 AI 질문보조 영역 .igdc-sc-ai 바로 아래가 1순위)
  function mountMiniCard() {
    if (!miniCard) return;

    var panel    = document.getElementById('igdc-site-control') ||
                   document.querySelector('.igdc-site-control');
    if (!panel) return;

    var aiSection = panel.querySelector('.igdc-sc-ai');
    var grid      = panel.querySelector('.igdc-sc-grid');

    if (aiSection && aiSection.parentNode) {
      var parent = aiSection.parentNode;
      var after  = aiSection.nextSibling;

      if (miniCard.parentNode !== parent) {
        parent.insertBefore(miniCard, after);
      } else if (miniCard.previousElementSibling !== aiSection) {
        parent.insertBefore(miniCard, after);
      }
      return;
    }

    // AI 영역이 아직 없다면: 우측 카드 그리드 맨 아래
    if (grid) {
      if (miniCard.parentNode !== grid) {
        grid.appendChild(miniCard);
      }
      return;
    }

    // 최후의 수단: 패널 맨 아래
    if (miniCard.parentNode !== panel) {
      panel.appendChild(miniCard);
    }
  }

  // DOM 초기 렌더 이후, 우측 패널이 늦게 그려지는 상황을 대비해서
  // 몇 초 동안 주기적으로 위치를 다시 잡아줌
  function scheduleMount() {
    var tries = 0;
    function tick() {
      tries++;
      mountMiniCard();
      if (tries < 40) { // 약 10초 정도 재시도
        setTimeout(tick, 250);
      }
    }
    tick();
  }

  function ensureMiniCard() {
    createMiniCard();
    mountMiniCard();
  }

  function renderMini() {
    ensureMiniCard();
    if (!miniCard || !miniListEl || !miniStatusEl) return;

    var totalAll = getTotalAll();

    if (totalAll <= 0) {
      miniStatusEl.textContent = '대기(데이터 없음)';
      miniStatusEl.style.color = '#aa0000';
    } else {
      miniStatusEl.textContent = '실시간 반영 중';
      miniStatusEl.style.color = '#0a7';
    }

    var html = [];
    state.regions.forEach(function (r) {
      var total = getTotalForRegion(r);
      html.push(
        '<div style="display:flex;justify-content:space-between;gap:6px;">' +
        '  <span>' + r.label + '</span>' +
        '  <span>' + total + '</span>' +
        '</div>'
      );
    });

    if (!html.length) {
      html.push('<div style="color:#777;">아직 유입 데이터가 없습니다.</div>');
    }

    miniListEl.innerHTML = html.join('');
  }

  // ------------------------------
  // 4. 모달 DOM
  // ------------------------------
  function ensureModal() {
    if (modalEl && backdropEl && barCanvas && donutCanvas) return;

    backdropEl = document.getElementById('igdc-traffic-backdrop');
    modalEl    = document.getElementById('igdc-traffic-modal');

    if (!backdropEl) {
      backdropEl = document.createElement('div');
      backdropEl.id = 'igdc-traffic-backdrop';
      backdropEl.className = 'igdc-traffic-backdrop';
      backdropEl.style.position = 'fixed';
      backdropEl.style.inset = '0';
      backdropEl.style.background = 'rgba(0,0,0,.35)';
      backdropEl.style.display = 'none';
      backdropEl.style.zIndex = '9998';
      document.body.appendChild(backdropEl);
    }

    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'igdc-traffic-modal';
      modalEl.className = 'igdc-traffic-modal';
      modalEl.style.position = 'fixed';
      modalEl.style.left = '50%';
      modalEl.style.top = '50%';
      modalEl.style.transform = 'translate(-50%, -50%)';
      modalEl.style.zIndex = '9999';
      modalEl.style.display = 'none';
      modalEl.style.maxWidth = '960px';
      modalEl.style.width = '96%';
      modalEl.style.maxHeight = '90vh';
      modalEl.style.background = '#fffdf7';
      modalEl.style.borderRadius = '10px';
      modalEl.style.boxShadow = '0 10px 30px rgba(0,0,0,.28)';
      modalEl.style.overflow = 'hidden';

      modalEl.innerHTML =
        '<div class="igdc-traffic-modal-inner" style="display:flex;flex-direction:column;height:100%;">' +
        '  <header style="padding:12px 16px;border-bottom:1px solid #ecd7aa;' +
        '                 display:flex;justify-content:space-between;align-items:center;">' +
        '    <div>' +
        '      <div style="font-weight:bold;font-size:14px;">유입 대시보드 (지역/연령)</div>' +
        '      <div style="font-size:11px;color:#a07040;">' +
        '        GA4 및 백엔드 지표를 기반으로 지역·연령별 유입 현황을 보여줍니다. ' +
        '        현재는 0 기준으로 준비 상태입니다.' +
        '      </div>' +
        '    </div>' +
        '    <button type="button" id="igdc-traffic-modal-close" ' +
        '            style="border:none;background:none;font-size:16px;cursor:pointer;">✕</button>' +
        '  </header>' +
        '  <section style="padding:10px 16px;flex:1 1 auto;overflow:auto;">' +
        '    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;min-height:260px;">' +
        '      <div>' +
        '        <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">연령대별 합계(막대그래프)</div>' +
        '        <canvas id="igdc-traffic-bar"></canvas>' +
        '      </div>' +
        '      <div>' +
        '        <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">지역별 합계(도넛)</div>' +
        '        <canvas id="igdc-traffic-donut"></canvas>' +
        '      </div>' +
        '    </div>' +
        '  </section>' +
        '  <footer style="padding:8px 16px;border-top:1px solid #ecd7aa;' +
        '                 display:flex;justify-content:flex-end;gap:8px;font-size:12px;">' +
        '    <button type="button" id="igdc-traffic-refresh" ' +
        '            style="border:1px solid #d29e5a;background:#fff7e3;' +
        '                   padding:4px 10px;border-radius:4px;cursor:pointer;">데이터 새로고침</button>' +
        '    <button type="button" id="igdc-traffic-close2" ' +
        '            style="border:1px solid #ccc;background:#f5f5f5;' +
        '                   padding:4px 10px;border-radius:4px;cursor:pointer;">닫기</button>' +
        '  </footer>' +
        '</div>';

      document.body.appendChild(modalEl);
    }

    barCanvas   = modalEl.querySelector('#igdc-traffic-bar');
    donutCanvas = modalEl.querySelector('#igdc-traffic-donut');

    backdropEl.onclick = closeModal;

    var closeBtn   = modalEl.querySelector('#igdc-traffic-modal-close');
    var closeBtn2  = modalEl.querySelector('#igdc-traffic-close2');
    var refreshBtn = modalEl.querySelector('#igdc-traffic-refresh');

    if (closeBtn)  closeBtn.onclick  = closeModal;
    if (closeBtn2) closeBtn2.onclick = closeModal;
    if (refreshBtn) {
      refreshBtn.onclick = function () {
        try {
          if (window.IGDCAnalyticsLoader &&
              typeof window.IGDCAnalyticsLoader.refresh === 'function') {
            window.IGDCAnalyticsLoader.refresh();
          }
        } catch (e) {
          console && console.warn &&
          console.warn('[IGDC_TRAFFIC refresh] error:', e);
        }
      };
    }
  }

  // ------------------------------
  // 5. Chart.js 렌더링
  // ------------------------------
  function buildCharts() {
    if (!window.Chart || !barCanvas || !donutCanvas) return;

    var ageTotals = AGE_BUCKETS.map(function (b) {
      var sum = 0;
      state.regions.forEach(function (r) {
        sum += r.ages[b] || 0;
      });
      return sum;
    });

    if (barChart) {
      barChart.destroy();
    }
    barChart = new Chart(barCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: AGE_BUCKETS.map(function (b) { return AGE_LABELS[b]; }),
        datasets: [
          {
            label: '전체 합계',
            data: ageTotals
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });

    var regionLabels = state.regions.map(function (r) { return r.label; });
    var regionTotals = state.regions.map(function (r) { return getTotalForRegion(r); });

    if (donutChart) {
      donutChart.destroy();
    }
    donutChart = new Chart(donutCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: regionLabels,
        datasets: [
          {
            label: '지역별 합계',
            data: regionTotals
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }

  // ------------------------------
  // 6. 모달 열기/닫기
  // ------------------------------
  function openModal() {
    ensureModal();
    if (!backdropEl || !modalEl) return;
    backdropEl.style.display = 'block';
    modalEl.style.display = 'block';
    buildCharts();
  }

  function closeModal() {
    if (!backdropEl || !modalEl) return;
    backdropEl.style.display = 'none';
    modalEl.style.display = 'none';
  }

  // ------------------------------
  // 7. 전역 API
  // ------------------------------
  window.IGDC_TRAFFIC = {
    setData: function (payload) {
      try {
        state = normalizePayload(payload);
        renderMini();
        if (modalEl && modalEl.style.display !== 'none') {
          buildCharts();
        }
      } catch (e) {
        console && console.warn &&
        console.warn('[IGDC_TRAFFIC.setData] error:', e);
      }
    },
    getState: function () {
      return JSON.parse(JSON.stringify(state));
    },
    open: function () { openModal(); },
    close: function () { closeModal(); },
    refresh: function () {
      try {
        if (window.IGDCAnalyticsLoader &&
            typeof window.IGDCAnalyticsLoader.refresh === 'function') {
          window.IGDCAnalyticsLoader.refresh();
        }
      } catch (e) {
        console && console.warn &&
        console.warn('[IGDC_TRAFFIC.refresh] error:', e);
      }
    }
  };

  // ------------------------------
  // 8. 초기 렌더링
  // ------------------------------
  function init() {
    state = buildDefaultState();
    renderMini();
    scheduleMount(); // 우측 패널이 늦게 그려질 때 위치 재보정
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
