// /assets/js/analytics-loader.js
// Netlify Functions(analytics-region)을 호출해서
// admin 우측 유입 차트(IGDC_TRAFFIC)에 데이터를 주입

(function(){
  async function loadRegionTraffic(){
    try {
      // IGDC_TRAFFIC 준비 안 되었으면 조금 뒤에 재시도
      if (!window.IGDC_TRAFFIC || typeof window.IGDC_TRAFFIC.setData !== 'function') {
        setTimeout(loadRegionTraffic, 700);
        return;
      }

      const res = await fetch('/.netlify/functions/analytics-region', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        console.error('analytics-region 호출 실패:', res.status);
        return;
      }

      const data = await res.json();
      // data: { regions: [ { key, label, ages: {...} }, ... ] }
      window.IGDC_TRAFFIC.setData(data);
    } catch (e) {
      console.error('analytics-region 로딩 중 오류:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    loadRegionTraffic();
  });

  // IGDC_TRAFFIC.refresh()에서 사용할 수 있도록 공개
  window.IGDCAnalyticsLoader = {
    refresh: loadRegionTraffic
  };
})();
