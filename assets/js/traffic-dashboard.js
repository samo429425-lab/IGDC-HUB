// traffic-dashboard.js
// ======================================================
// IGDC 유입 분석 - 팝업 + MiniCard + 차트 렌더 전체 통합 스크립트
// 버전: 2025-12-10 (Chart destroy + 0-value rendering 안정화)
// ======================================================

// ------------------------------------------------------
// Chart 인스턴스 전역
// ------------------------------------------------------
let IGDC_chart_age = null;
let IGDC_chart_region = null;


// ------------------------------------------------------
// 기본 더미 데이터 (0이어도 항목은 그대로)
// ------------------------------------------------------

window.IGDC_TRAFFIC = {
  // region/age 기본 목록
  regions: [
    { key: 'east_asia', label: '동아시아', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'southeast_asia', label: '동남아시아', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'south_asia', label: '서남아시아', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'central_asia', label: '중앙아시아', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'middle_east', label: '중동', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'north_africa', label: '북아프리카', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'east_africa', label: '동아프리카', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'west_africa', label: '서아프리카', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'south_africa', label: '남아프리카', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'east_europe', label: '동유럽', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'west_europe', label: '서유럽', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'north_america', label: '북미·호주', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'latam', label: '남미', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } },
    { key: 'russia', label: '러시아', ages: { '10대': 0, '20대': 0, '30대': 0, '40대': 0, '50대': 0 } }
  ],

  getData(){
    return { regions: this.regions };
  }
};


// ------------------------------------------------------
// MiniCard (우측 패널) 영역 생성
// ------------------------------------------------------
function IGDC_buildMiniCard(host){
  if(!host) return;

  // 기존 카드 제거
  const old = host.querySelector('.igdc-mini-card');
  if(old) old.remove();

  const card = document.createElement('div');
  card.className = 'igdc-mini-card';
  card.style.cursor = 'pointer';
  card.style.marginTop = '10px';

  const data = window.IGDC_TRAFFIC.getData();

  card.innerHTML = `
    <div style="font-weight:600; font-size:14px; margin-bottom:8px;">
      유입 현황(지역/연령)
      <span style="font-size:12px; color:#b33;"> 대기(데이터 없음)</span>
    </div>
    ${data.regions.map(r=>`${r.label} <span style="float:right">${0}</span>`).join('<br>')}
    <div style="margin-top:8px; font-size:11px; color:#666;">
      클릭하면 전체 대시보드를 팝업으로 엽니다.
    </div>
  `;

  card.addEventListener('click', ()=> IGDC_openModal() );
  host.appendChild(card);
}


// ------------------------------------------------------
// Modal 오픈
// ------------------------------------------------------
function IGDC_openModal(){
  let modal = document.getElementById('igdc-traffic-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'igdc-traffic-modal';
    modal.className = 'igdc-traffic-modal';

    modal.innerHTML = `
      <div class="igdc-modal-backdrop"></div>
      <div class="igdc-modal-content">
        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
          <h3 style="margin:0;">유입 대시보드 (지역/연령)</h3>
          <button id="igdc-close-btn" style="border:none;background:none;font-size:20px;cursor:pointer;">×</button>
        </div>
        <div style="margin-bottom:10px; color:#666; font-size:13px;">
          GA4 및 백엔드 지표를 기반으로 지역·연령별 유입 현황을 보여줍니다.
          현재는 0 기준으로 준비 상태입니다.
        </div>

        <div style="display:flex; gap:20px; flex-wrap:wrap;">
          <div style="flex:1; min-width:300px;">
            <p style="margin-bottom:6px;">연령대별 합계(막대그래프)</p>
            <canvas id="igdc-age-chart"></canvas>
          </div>
          <div style="flex:1; min-width:300px;">
            <p style="margin-bottom:6px;">지역별 합계(도넛)</p>
            <canvas id="igdc-region-chart"></canvas>
          </div>
        </div>

        <div style="margin-top:15px; text-align:right;">
          <button style="padding:6px 12px; border:1px solid #888;background:#fff;cursor:pointer;" onclick="IGDC_forceReload()">데이터 새로고침</button>
          <button style="padding:6px 12px; border:1px solid #888;background:#fff;cursor:pointer;" id="igdc-close-bottom">닫기</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 닫기 버튼
    modal.querySelector('#igdc-close-btn').onclick = ()=> modal.style.display='none';
    modal.querySelector('#igdc-close-bottom').onclick = ()=> modal.style.display='none';
  }

  modal.style.display='block';
  IGDC_renderCharts();
}


// ------------------------------------------------------
// Chart 렌더링
// ------------------------------------------------------
function IGDC_renderCharts(){
  const { regions } = window.IGDC_TRAFFIC.getData();

  const ageCtx = document.getElementById('igdc-age-chart');
  const regionCtx = document.getElementById('igdc-region-chart');

  if(!ageCtx || !regionCtx) return;

  if(IGDC_chart_age) IGDC_chart_age.destroy();
  if(IGDC_chart_region) IGDC_chart_region.destroy();

  const ageLabels = ['10대','20대','30대','40대','50대'];
  const ageTotals = ageLabels.map(lbl=>{
    return regions.reduce((sum,r)=> sum + (r.ages[lbl]||0),0 );
  });

  IGDC_chart_age = new Chart(ageCtx.getContext('2d'), {
    type:'bar',
    data:{
      labels:ageLabels,
      datasets:[
        { label:'전체 합계', data: ageTotals, backgroundColor:'#a3c4f3' }
      ]
    }
  });

  const regionLabels = regions.map(r=>r.label);
  const regionTotals = regions.map(r=> Object.values(r.ages).reduce((a,b)=>a+b,0) );

  IGDC_chart_region = new Chart(regionCtx.getContext('2d'), {
    type:'doughnut',
    data:{
      labels:regionLabels,
      datasets:[
        {
          data:regionTotals,
          backgroundColor: [
            '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948',
            '#b07aa1','#ff9da7','#9c755f','#bab0ab','#4e79a7','#f28e2b',
            '#edc948','#59a14f','#bab0ab'
          ]
        }
      ]
    }
  });
}


// ------------------------------------------------------
// Dummy "새로고침" (지금은 단순 rerender)
// ------------------------------------------------------
function IGDC_forceReload(){
  IGDC_renderCharts();
}


// ------------------------------------------------------
// DOM Ready
// ------------------------------------------------------
document.addEventListener('DOMContentLoaded', ()=>{
  const host = document.getElementById('igdc-traffic-panel');
  IGDC_buildMiniCard(host);
});
