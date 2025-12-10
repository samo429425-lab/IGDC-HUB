// traffic-dashboard.js
// IGDC Admin: 유입 현황(지역/연령) 미니 카드 + 전체 모달 대시보드
// window.IGDC_TRAFFIC.setData(payload) 로 데이터 주입

(function () {
  if (window.IGDC_TRAFFIC) return; // 중복 방지

  // -----------------------------------------------------------
  // 상수
  // -----------------------------------------------------------
  var REGION_ORDER = [
    'east_asia','southeast_asia','south_asia','central_asia','middle_east',
    'africa_north','africa_east','africa_west','africa_south',
    'europe_north','europe_west','europe_east',
    'americas_north','americas_south','russia'
  ];
  var REGION_LABELS = {
    east_asia:'동아시아',southeast_asia:'동남아시아',south_asia:'남아시아',central_asia:'중앙아시아',middle_east:'중동',
    africa_north:'북아프리카',africa_east:'동아프리카',africa_west:'서아프리카',africa_south:'남아프리카',
    europe_north:'북유럽',europe_west:'서유럽',europe_east:'동유럽',
    americas_north:'북미·호주',americas_south:'남미',russia:'러시아'
  };
  var AGE_BUCKETS = ['10s','20s','30s','40s','50s','60s','70s','80s_plus'];
  var AGE_LABELS = {
    '10s':'10대','20s':'20대','30s':'30대','40s':'40대',
    '50s':'50대','60s':'60대','70s':'70대','80s_plus':'80대 이상'
  };

  // -----------------------------------------------------------
  // 내부 상태
  // -----------------------------------------------------------
  var state = { regions: [] };

  var miniCard     = null;
  var miniStatusEl = null;
  var miniListEl   = null;

  var backdropEl   = null;
  var modalEl      = null;
  var barCanvas    = null;
  var donutCanvas  = null;
  var barChart     = null;
  var donutChart   = null;
  var barEmptyEl   = null;
  var donutEmptyEl = null;

  var lastDataSignature = null;
  var lastBuildAt       = 0;
  var BUILD_THROTTLE_MS = 1500;

  // -----------------------------------------------------------
  // payload 정규화
  // -----------------------------------------------------------
  function normalizePayload(payload) {
    var src = (payload && payload.regions) || [];
    var map = {};
    src.forEach(function (r) {
      var code = r.code || r.key;
      if (!code) return;
      map[code] = r;
    });

    var regions = REGION_ORDER.map(function (code) {
      var f    = map[code] || {};
      var ages = f.ages || {};
      var norm = {};
      AGE_BUCKETS.forEach(function (b) {
        var v = ages[b];
        norm[b] = (typeof v === 'number' && isFinite(v)) ? v : 0;
      });
      return {
        code:  code,
        label: f.label || REGION_LABELS[code] || code,
        ages:  norm
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

  // -----------------------------------------------------------
  // 미니 카드 (우측 패널 맨 아래)
  // -----------------------------------------------------------
  function ensureMiniCard() {
    if (miniCard) return;

    // 여기서 우측 패널 전체 컨테이너를 1순위로 잡습니다.
    // (header, 그리드, AI 실문보조, 점검영역 등 모든 블록의 맨 아래에 오게)
    var host =
      document.querySelector('#igdc-site-control') ||
      document.querySelector('.igdc-site-control') ||
      document.querySelector('#igdc-site-control .igdc-sc-grid');

    if (!host) return;

    miniCard = document.createElement('section');
    miniCard.className = 'igdc-sc-card igdc-traffic-mini-card';
    // flex 컨테이너에서 항상 맨 끝으로 보내기
    miniCard.style.order = '999';

    miniCard.innerHTML =
      '<div class="igdc-sc-card-header" '+
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
      '  <div id="igdc-traffic-mini-list"></div>' +
      '  <div style="margin-top:4px;color:#777;">클릭하면 전체 대시보드를 팝업으로 엽니다.</div>' +
      '</div>';

    miniStatusEl = miniCard.querySelector('#igdc-traffic-mini-status');
    miniListEl   = miniCard.querySelector('#igdc-traffic-mini-list');

    miniCard.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });

    // 우측 패널 컨테이너의 자식들 중 항상 마지막으로 추가
    host.appendChild(miniCard);
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
        '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">' +
        '  <span>' + (r.label || r.code) + '</span>' +
        '  <span style="font-weight:bold;">' + total + '</span>' +
        '</div>'
      );
    });

    if (!html.length) {
      html.push('<div style="color:#777;">아직 유입 데이터가 없습니다.</div>');
    }

    miniListEl.innerHTML = html.join('');
  }

  // -----------------------------------------------------------
  // 모달
  // -----------------------------------------------------------
  function ensureModal() {
    if (modalEl && backdropEl && barCanvas && donutCanvas) return;

    backdropEl = document.getElementById('igdc-traffic-backdrop');
    modalEl    = document.getElementById('igdc-traffic-modal');

    if (!backdropEl) {
      backdropEl = document.createElement('div');
      backdropEl.id = 'igdc-traffic-backdrop';
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
        '<div style="display:flex;flex-direction:column;height:100%;">' +
        '  <header style="padding:12px 16px;border-bottom:1px solid #e5e5e5;' +
        '                  display:flex;justify-content:space-between;align-items:center;">' +
        '    <div>' +
        '      <div style="font-weight:bold;font-size:14px;">유입 대시보드 (지역/연령)</div>' +
        '      <div style="font-size:11px;color:#a07040;">유입 현황을 보여줍니다.</div>' +
        '    </div>' +
        '    <button id="igdc-traffic-modal-close" ' +
        '            style="border:none;background:none;font-size:16px;cursor:pointer;">✕</button>' +
        '  </header>' +
        '  <section style="padding:10px 16px;flex:1;overflow:auto;">' +
        '    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;">' +
        '      <div>' +
        '        <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">연령대별 합계(막대)</div>' +
        '        <div style="position:relative;height:260px;border:1px solid #f0e4c5;' +
        '                    border-radius:6px;padding:6px;background:#fff7e8;">' +
        '          <canvas id="igdc-traffic-bar" style="width:100%;height:100%;"></canvas>' +
        '          <div id="igdc-traffic-bar-empty" ' +
        '               style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
        '                      font-size:12px;color:#777;">아직 집계된 유입 데이터가 없습니다.</div>' +
        '        </div>' +
        '      </div>' +
        '      <div>' +
        '        <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">지역별 합계(도넛)</div>' +
        '        <div style="position:relative;height:260px;border:1px solid #f0e4c5;' +
        '                    border-radius:6px;padding:6px;background:#fff7e8;">' +
        '          <canvas id="igdc-traffic-donut" style="width:100%;height:100%;"></canvas>' +
        '          <div id="igdc-traffic-donut-empty" ' +
        '               style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
        '                      font-size:12px;color:#777;">아직 집계된 유입 데이터가 없습니다.</div>' +
        '        </div>' +
        '      </div>' +
        '    </div>' +
        '  </section>' +
        '  <footer style="padding:8px 16px;border-top:1px solid #eee;' +
        '                  display:flex;justify-content:flex-end;gap:8px;font-size:12px;">' +
        '    <button id="igdc-traffic-refresh" ' +
        '            style="border:1px solid #d9b37c;background:#fffaf1;color:#a07040;' +
        '                   padding:4px 10px;border-radius:4px;cursor:pointer;">데이터 새로고침</button>' +
        '    <button id="igdc-traffic-close2" ' +
        '            style="border:1px solid #ccc;background:#f5f5f5;' +
        '                   padding:4px 10px;border-radius:4px;cursor:pointer;">닫기</button>' +
        '  </footer>' +
        '</div>';

      document.body.appendChild(modalEl);
    }

    barCanvas    = modalEl.querySelector('#igdc-traffic-bar');
    donutCanvas  = modalEl.querySelector('#igdc-traffic-donut');
    barEmptyEl   = modalEl.querySelector('#igdc-traffic-bar-empty');
    donutEmptyEl = modalEl.querySelector('#igdc-traffic-donut-empty');

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
        } catch (e) {}
      };
    }
  }

  // -----------------------------------------------------------
  // 차트
  // -----------------------------------------------------------
  function buildCharts() {
    if (!window.Chart || !barCanvas || !donutCanvas) return;

    lastBuildAt = Date.now();
    var totalAll = getTotalAll();

    if (barEmptyEl && donutEmptyEl) {
      if (totalAll <= 0) {
        barEmptyEl.style.display   = 'flex';
        donutEmptyEl.style.display = 'flex';
      } else {
        barEmptyEl.style.display   = 'none';
        donutEmptyEl.style.display = 'none';
      }
    }

    // 연령대별 합계
    var ageTotals = AGE_BUCKETS.map(function (b) {
      var s = 0;
      state.regions.forEach(function (r) {
        s += r.ages[b] || 0;
      });
      return s;
    });

    if (barChart) barChart.destroy();
    barChart = new Chart(barCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: AGE_BUCKETS.map(function (b) { return AGE_LABELS[b] || b; }),
        datasets: [
          {
            label: '연령대별 합계',
            data:  ageTotals
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });

    // 지역별 합계
    var regionLabels = state.regions.map(function (r) { return r.label; });
    var regionTotals = state.regions.map(function (r) { return getTotalForRegion(r); });

    if (donutChart) donutChart.destroy();
    donutChart = new Chart(donutCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: regionLabels,
        datasets: [
          {
            label: '지역별 합계',
            data:  regionTotals
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }

  // -----------------------------------------------------------
  // 모달 열고 닫기
  // -----------------------------------------------------------
  function openModal() {
    ensureModal();
    backdropEl.style.display = 'block';
    modalEl.style.display    = 'block';
    buildCharts();
  }

  function closeModal() {
    if (backdropEl) backdropEl.style.display = 'none';
    if (modalEl)    modalEl.style.display    = 'none';
  }

  // -----------------------------------------------------------
  // 전역 API
  // -----------------------------------------------------------
  window.IGDC_TRAFFIC = {
    setData: function (payload) {
      try {
        var next = normalizePayload(payload);
        var sign;
        try { sign = JSON.stringify(next); } catch (e) { sign = null; }

        var changed = sign ? (sign !== lastDataSignature) : true;
        state = next;
        if (sign) lastDataSignature = sign;

        renderMini();

        if (modalEl && modalEl.style.display !== 'none' && changed) {
          var now = Date.now();
          if (!lastBuildAt || (now - lastBuildAt) >= BUILD_THROTTLE_MS) {
            buildCharts();
          }
        }
      } catch (e) {}
    },
    getState: function () {
      return JSON.parse(JSON.stringify(state));
    },
    open: function () {
      openModal();
    },
    close: function () {
      closeModal();
    },
    refresh: function () {
      try {
        if (window.IGDCAnalyticsLoader &&
            typeof window.IGDCAnalyticsLoader.refresh === 'function') {
          window.IGDCAnalyticsLoader.refresh();
        }
      } catch (e) {}
    }
  };

  // -----------------------------------------------------------
  // 초기화
  // -----------------------------------------------------------
  function init() {
    state = buildDefaultState();
    renderMini();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
