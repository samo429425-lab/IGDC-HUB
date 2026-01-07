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
 /* ---------------- ASIA ---------------- */
    asia: [
      '대한민국 (Korea)','일본 (Japan)','중국 (China)','타이완 (Taiwan)','필리핀 (Philippines)',
      '말레이시아 (Malaysia)','싱가포르 (Singapore)','방글라데시 (Bangladesh)','파키스탄 (Pakistan)',
      '아프가니스탄 (Afghanistan)','스리랑카 (Sri Lanka)','캄보디아 (Cambodia)','베트남 (Vietnam)',
      '태국 (Thailand)','인도네시아 (Indonesia)','인도 (India)','네팔 (Nepal)'
    ],

    /* ---------------- EUROPE ---------------- */
    europe: [
      '독일 (Germany)','프랑스 (France)','영국 (United Kingdom)','스페인 (Spain)','포르투갈 (Portugal)',
      '이탈리아 (Italy)','네덜란드 (Netherlands)','스웨덴 (Sweden)','노르웨이 (Norway)',
      '스위스 (Switzerland)','오스트리아 (Austria)','폴란드 (Poland)','헝가리 (Hungary)',
      '체코 (Czech Republic)','슬로바키아 (Slovakia)'
    ],

    /* ---------------- MIDDLE EAST ---------------- */
    middle_east: [
      '이란 (Iran)','이라크 (Iraq)','이스라엘 (Israel)','사우디아라비아 (Saudi Arabia)',
      '튀르키예 (Turkey)','카타르 (Qatar)','요르단 (Jordan)','시리아 (Syria)',
      '레바논 (Lebanon)','예멘 (Yemen)','오만 (Oman)','쿠웨이트 (Kuwait)','바레인 (Bahrain)'
    ],

    /* ---------------- AFRICA ---------------- */
    africa: [
      '남아프리카공화국 (South Africa)','나이지리아 (Nigeria)','케냐 (Kenya)','탄자니아 (Tanzania)',
      '우간다 (Uganda)','이집트 (Egypt)','리비아 (Libya)','가나 (Ghana)',
      '콩고민주공화국 (DR Congo)','에티오피아 (Ethiopia)','모로코 (Morocco)',
      '알제리 (Algeria)','튀니지 (Tunisia)','세네갈 (Senegal)'
    ],

    /* ---------------- NORTH AMERICA ---------------- */
    north_america: [
      '미국 (United States)','캐나다 (Canada)','멕시코 (Mexico)','호주 (Australia)','과테말라 (Guatemala)'
    ],

    /* ---------------- SOUTH AMERICA ---------------- */
    south_america: [
      '브라질 (Brazil)','아르헨티나 (Argentina)','칠레 (Chile)','페루 (Peru)','콜롬비아 (Colombia)',
      '베네수엘라 (Venezuela)','우루과이 (Uruguay)','파라과이 (Paraguay)','볼리비아 (Bolivia)',
      '엘살바도르 (El Salvador)','온두라스 (Honduras)','코스타리카 (Costa Rica)'
    ],

    /* ---------------- EURASIA ---------------- */
    eurasia: [
      '러시아 (Russia)','카자흐스탄 (Kazakhstan)','우즈베키스탄 (Uzbekistan)',
      '투르크메니스탄 (Turkmenistan)','키르기스스탄 (Kyrgyzstan)','타지키스탄 (Tajikistan)',
      '몽골 (Mongolia)','아제르바이잔 (Azerbaijan)','조지아 (Georgia)',
      '아르메니아 (Armenia)','벨라루스 (Belarus)','우크라이나 (Ukraine)'
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