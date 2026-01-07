/* =========================================================
 * MARU GLOBAL COUNTRY MODAL (v1.0 – ADMIN ONLY)
 * 2차 팝업: 권역 → 국가 단계
 * - maru-global-region-modal.js 에서 호출
 * - 6개 권역 전체를 단일 파일에서 처리
 * - 소규모 국가는 '기타'로 자동 묶음 처리
 * - OpenAI / MARU 엔진 기반 서술형 인사이트
 * ========================================================= */

(function () {
  'use strict';

  /* ================= CONFIG ================= */
  const API_ENDPOINT = '/api/ai-diagnose'; // 추후 /api/maru-global-insight?level=country

  // 권역별 국가 기본 맵 (확장 가능)
  const REGION_COUNTRY_MAP = {
    asia: [
      '대한민국','일본','중국','인도','인도네시아','베트남','태국','필리핀','말레이시아',
      '싱가포르','대만','홍콩','파키스탄','방글라데시','기타'
    ],
    north_america: [
      '미국','캐나다','멕시코','기타'
    ],
    south_america: [
      '브라질','아르헨티나','칠레','콜롬비아','페루','기타'
    ],
    europe: [
      '독일','프랑스','영국','이탈리아','스페인','네덜란드','스웨덴','폴란드','기타'
    ],
    eurasia: [
	   '러시아','우크라이나'
	],   
    middle_east: [
      '사우디아라비아','아랍에미리트','이스라엘','이란','카타르','터키','기타'
    ],
    africa: [
      '남아프리카공화국','나이지리아','이집트','케냐','모로코','기타'
    ]
  };

  let backdrop = null;
  let modal = null;

  /* ================= UTILS ================= */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function closeModal() {
    if (modal) modal.remove();
    if (backdrop) backdrop.remove();
    modal = backdrop = null;
  }

  /* ================= API ================= */
  async function fetchCountryInsight(regionId) {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          level: 'country',
          region: regionId,
          countries: REGION_COUNTRY_MAP[regionId] || []
        })
      });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      console.warn('[MARU][COUNTRY] API fallback', e);
      return {};
    }
  }

  /* ================= STYLE ================= */
  function injectStyle() {
    if (document.getElementById('maru-country-style')) return;
    const style = el('style');
    style.id = 'maru-country-style';
    style.textContent = `
      .maru-country-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000}
      .maru-country-modal{position:fixed;inset:8%;background:#fff;border-radius:14px;
        z-index:100001;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)}
      .maru-country-header{padding:14px 20px;border-bottom:1px solid #eee;
        display:flex;justify-content:space-between;align-items:center}
      .maru-country-body{padding:20px;overflow:auto;display:grid;
        grid-template-columns:repeat(2,1fr);gap:18px}
      .maru-country-card{border:1px solid #ddd;border-radius:12px;padding:14px}
      .maru-country-card h4{margin:0 0 6px}
      .maru-country-card p{font-size:13px;line-height:1.45;margin:4px 0}
      .maru-country-card .risk{color:#b00020}
      .maru-country-card .opportunity{color:#00695c}
    `;
    document.head.appendChild(style);
  }

  /* ================= RENDER ================= */
  function renderCountryCard(country, data) {
    const d = data || {};
    return `
      <div class="maru-country-card">
        <h4>${country}</h4>
        <p><strong>유입 흐름</strong>: ${d.flow || '분석 중'}</p>
        <p><strong>트렌드</strong>: ${d.trend || '확인 중'}</p>
        <p class="risk"><strong>주의</strong>: ${d.risk || '특이사항 없음'}</p>
        <p class="opportunity"><strong>기회</strong>: ${d.opportunity || '관망'}</p>
        <p><em>${d.comment || 'MARU 코멘트 대기 중'}</em></p>
      </div>`;
  }

  /* ================= OPEN ================= */
  async function open(regionId) {
    if (modal) return;

    injectStyle();

    backdrop = el('div', 'maru-country-backdrop');
    backdrop.onclick = closeModal;

    modal = el('div', 'maru-country-modal');

    const header = el('div', 'maru-country-header', `
      <strong>🌐 MARU GLOBAL INSIGHT — 국가 분석 (${regionId})</strong>
      <button id="maruCountryClose">닫기</button>
    `);

    const body = el('div', 'maru-country-body', '<p>국가별 글로벌 인사이트 수집 중…</p>');

    modal.appendChild(header);
    modal.appendChild(body);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    document.getElementById('maruCountryClose').onclick = closeModal;

    const apiData = await fetchCountryInsight(regionId);
    const countries = REGION_COUNTRY_MAP[regionId] || [];
    const countryData = apiData?.countries || {};

    body.innerHTML = countries
      .map(c => renderCountryCard(c, countryData[c]))
      .join('');
  }

  /* ================= EXPOSE ================= */
  window.openMaruGlobalCountryModal = open;
})();