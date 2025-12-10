// traffic-dashboard.js
// IGDC Admin: 유입 현황(지역/연령) 미니 카드 + 전체 모달 대시보드
// - window.IGDC_TRAFFIC.setData(payload) 로 데이터 주입
// - payload 예시:
//   {
//     regions: [
//       {
//         key: 'east_asia',
//         label: '동아시아',
//         ages: { '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0 }
//       },
//       ...
//     ]
//   }
(function(){
  if (window.IGDC_TRAFFIC) return; // 중복 방지

  // --- 1. 버킷 정의(대륙/지역 + 연령대) ---
  var REGION_ORDER = [
    { key: 'east_asia',   label: '동아시아' },
    { key: 'southeast_asia', label: '동남아시아' },
    { key: 'southwest_asia', label: '서남아시아' },
    { key: 'central_asia',   label: '중앙아시아' },
    { key: 'middle_east',    label: '중동' },
    { key: 'africa_north',   label: '북아프리카' },
    { key: 'africa_east',    label: '동아프리카' },
    { key: 'africa_west',    label: '서아프리카' },
    { key: 'africa_south',   label: '남아프리카' },
    { key: 'europe_north',   label: '북유럽' },
    { key: 'europe_west',    label: '서유럽' },
    { key: 'europe_east',    label: '동유럽' },
    { key: 'americas_north', label: '북미·호주' },
    { key: 'americas_south', label: '남미' },
    { key: 'russia',         label: '러시아' }
  ];

  var AGE_ORDER = [
    { key: '10s', label: '10대' },
    { key: '20s', label: '20대' },
    { key: '30s', label: '30대' },
    { key: '40s', label: '40대' },
    { key: '50s', label: '50대' },
    { key: '60s', label: '60대+' }
  ];

  // 내부 상태
  var state = {
    regions: REGION_ORDER.map(function(r){
      return {
        key: r.key,
        label: r.label,
        ages: {
          '10s': 0, '20s': 0, '30s': 0, '40s': 0, '50s': 0, '60s': 0
        }
      };
    })
  };

  var miniCard, miniList, modalBackdrop, modalSheet;
  var barChart, doughnutChart;

  function getTotalForRegion(region){
    var sum = 0;
    if (!region || !region.ages) return 0;
    AGE_ORDER.forEach(function(a){
      sum += Number(region.ages[a.key] || 0);
    });
    return sum;
  }

  function getTotalsByAge(){
    var totals = {};
    AGE_ORDER.forEach(function(a){ totals[a.key] = 0; });
    state.regions.forEach(function(r){
      AGE_ORDER.forEach(function(a){
        totals[a.key] += Number((r.ages && r.ages[a.key]) || 0);
      });
    });
    return totals;
  }

  function hasAnyData(){
    return state.regions.some(function(r){ return getTotalForRegion(r) > 0; });
  }

  // --- 2. 미니 카드 렌더링(우측 패널) ---
  function ensureMiniCard(){
    if (miniCard) return miniCard;

    // 우측 패널 그리드(이미 OpenAI 사이트 점검 카드가 있는 곳)를 찾아본다.
    var grid = document.querySelector('.igdc-site-control .igdc-sc-grid');
    var host;

    if (grid) {
      host = grid;
    } else {
      // 폴백: main-content 아래에 작은 상자 하나 추가
      var main = document.querySelector('.main-content') || document.body;
      host = document.createElement('div');
      host.className = 'igdc-site-control';
      main.parentNode && main.parentNode.appendChild(host);
    }

    miniCard = document.createElement('div');
    miniCard.className = 'igdc-sc-card';
    miniCard.setAttribute('id', 'igdc-traffic-mini-card');
    miniCard.innerHTML = ''
      + '<div class="igdc-sc-card-header">'
      + '  <div class="igdc-sc-card-title">유입 현황(지역/연령)</div>'
      + '  <div class="igdc-sc-card-status" id="igdc-traffic-mini-status">준비됨</div>'
      + '</div>'
      + '<div class="igdc-sc-card-body">'
      + '  <div id="igdc-traffic-mini-list" style="display:flex;flex-direction:column;gap:2px;"></div>'
      + '  <div style="margin-top:4px;font-size:10px;color:#8a6d3b;">클릭하면 전체 대시보드를 팝업으로 엽니다.</div>'
      + '</div>';

    if (host) host.insertAdjacentElement('beforeend', miniCard);

    miniList = miniCard.querySelector('#igdc-traffic-mini-list');
    miniCard.addEventListener('click', openModal);

    return miniCard;
  }

  function renderMini(){
    ensureMiniCard();
    if (!miniList) return;

    var html = [];
    state.regions.forEach(function(r){
      var total = getTotalForRegion(r);
      html.push(
        '<div style="display:flex;justify-content:space-between;gap:6px;">'
        + '<span>' + r.label + '</span>'
        + '<span style="font-family:monospace;">' + (total || 0) + '</span>'
        + '</div>'
      );
    });
    miniList.innerHTML = html.join('');

    var st = document.getElementById('igdc-traffic-mini-status');
    if (st) {
      st.textContent = hasAnyData() ? '실시간 수집 중' : '대기(데이터 없음)';
      st.style.color = hasAnyData() ? '#008800' : '#c08700';
    }
  }

  // --- 3. 모달(전체 대시보드) ---
  function ensureModal(){
    if (modalBackdrop && modalSheet) return;

    modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'igdc-sc-modal-backdrop';
    modalBackdrop.style.display = 'none';

    modalSheet = document.createElement('div');
    modalSheet.className = 'igdc-sc-modal';

    modalSheet.innerHTML = ''
      + '<div class="igdc-sc-modal-header">'
      + '  <div class="igdc-sc-modal-title">유입 대시보드 (지역/연령)</div>'
      + '  <button class="igdc-sc-modal-close" type="button">&times;</button>'
      + '</div>'
      + '<div class="igdc-sc-modal-body">'
      + '  <p style="margin:4px 0 8px;font-size:11px;color:#555;">'
      + '    GA4 및 백엔드 지표를 기반으로 지역·연령별 유입 현황을 보여줍니다. 현재는 0 기준으로 준비 상태입니다.'
      + '  </p>'
      + '  <div id="igdc-traffic-modal-charts" '
      + '       style="display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;">'
      + '    <div style="flex:1 1 320px;min-height:260px;">'
      + '      <h4 style="margin:4px 0 4px;font-size:12px;">연령대별 합계(막대그래프)</h4>'
      + '      <div style="position:relative;width:100%;height:220px;">'
      + '        <canvas id="igdc-traffic-age-bar"></canvas>'
      + '      </div>'
      + '    </div>'
      + '    <div style="flex:1 1 320px;min-height:260px;">'
      + '      <h4 style="margin:4px 0 4px;font-size:12px;">지역별 합계(도넛)</h4>'
      + '      <div style="position:relative;width:100%;height:220px;">'
      + '        <canvas id="igdc-traffic-region-donut"></canvas>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div>'
      + '<div class="igdc-sc-modal-footer">'
      + '  <button type="button" id="igdc-traffic-refresh">데이터 새로고침</button>'
      + '  <button type="button" class="igdc-sc-modal-close">닫기</button>'
      + '</div>';

    modalBackdrop.appendChild(modalSheet);
    document.body.appendChild(modalBackdrop);

    modalBackdrop.addEventListener('click', function(e){
      if (e.target === modalBackdrop) closeModal();
    });
    Array.prototype.forEach.call(
      modalSheet.querySelectorAll('.igdc-sc-modal-close'),
      function(btn){ btn.addEventListener('click', closeModal); }
    );

    var refreshBtn = modalSheet.querySelector('#igdc-traffic-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function(){
        try{
          if (window.IGDC_TRAFFIC && typeof window.IGDC_TRAFFIC.refresh === 'function') {
            window.IGDC_TRAFFIC.refresh();
          }
        }catch(e){ console && console.warn && console.warn('IGDC_TRAFFIC.refresh error:', e); }
      });
    }
  }

  function openModal(){
    ensureModal();
    if (!modalBackdrop) return;
    modalBackdrop.style.display = 'flex';
    document.addEventListener('keydown', escHandler);
    renderCharts();
  }

  function closeModal(){
    if (!modalBackdrop) return;
    modalBackdrop.style.display = 'none';
    document.removeEventListener('keydown', escHandler);
  }

  function escHandler(e){
    if (e.key === 'Escape') closeModal();
  }

  // --- 4. Chart.js 렌더링 ---
  function renderCharts(){
    if (typeof Chart === 'undefined') {
      console.warn('[IGDC_TRAFFIC] Chart.js not found. Charts skipped.');
      return;
    }

    var barCanvas = document.getElementById('igdc-traffic-age-bar');
    var donutCanvas = document.getElementById('igdc-traffic-region-donut');
    if (!barCanvas || !donutCanvas) return;

    var ageTotals = getTotalsByAge();
    var ageLabels = AGE_ORDER.map(function(a){ return a.label; });
    var ageData   = AGE_ORDER.map(function(a){ return ageTotals[a.key] || 0; });

    var regionLabels = state.regions.map(function(r){ return r.label; });
    var regionData   = state.regions.map(getTotalForRegion);

    if (barChart) {
      barChart.data.labels = ageLabels;
      barChart.data.datasets[0].data = ageData;
      barChart.update();
    } else {
      barChart = new Chart(barCanvas, {
        type: 'bar',
        data: {
          labels: ageLabels,
          datasets: [{
            label: '인원 수',
            data: ageData
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    if (doughnutChart) {
      doughnutChart.data.labels = regionLabels;
      doughnutChart.data.datasets[0].data = regionData;
      doughnutChart.update();
    } else {
      doughnutChart = new Chart(donutCanvas, {
        type: 'doughnut',
        data: {
          labels: regionLabels,
          datasets: [{
            label: '인원 수',
            data: regionData
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { boxWidth: 12 }
            }
          }
        }
      });
    }
  }

  // --- 5. 데이터 주입 API ---
  function applyPayload(payload){
    if (!payload || !Array.isArray(payload.regions)) return;

    var map = {};
    state.regions.forEach(function(r){ map[r.key] = r; });

    payload.regions.forEach(function(incoming){
      if (!incoming || !incoming.key) return;
      var target = map[incoming.key];
      if (!target) return;
      target.label = incoming.label || target.label;
      target.ages  = target.ages || {};
      AGE_ORDER.forEach(function(a){
        var v = incoming.ages && incoming.ages[a.key];
        if (typeof v === 'number') {
          target.ages[a.key] = v;
        }
      });
    });

    renderMini();
  }

  // --- 6. public API ---
  window.IGDC_TRAFFIC = {
    setData: function(payload){
      try{
        applyPayload(payload || {});
      }catch(e){
        console && console.warn && console.warn('[IGDC_TRAFFIC.setData] error:', e);
      }
    },
    refresh: function(){
      // Netlify Functions /api/analytics-* 와 결합 예정일 때 확장
      try{
        if (window.IGDCAnalyticsLoader && typeof window.IGDCAnalyticsLoader.refresh === 'function'){
          window.IGDCAnalyticsLoader.refresh();
        }
      }catch(e){
        console && console.warn && console.warn('[IGDC_TRAFFIC.refresh] error:', e);
      }
    }
  };

  // --- 7. 초기 렌더링(항목만 먼저) ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMini);
  } else {
    renderMini();
  }
})();