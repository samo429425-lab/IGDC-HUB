/* =========================================================
 * MARU GLOBAL COUNTRY MODAL — FINAL MASTER EDITION (STABLE)
 * ---------------------------------------------------------
 * Status: FINAL / STABLE / READY FOR REGION INTEGRATION
 * ---------------------------------------------------------
 * Philosophy:
 *  - Country modal is an INTERACTIVE DETAIL VIEWER
 *  - Voice and Click MUST lead to the same UI state
 *  - No auto voice playback (READY state only)
 *  - Expansion = UI expansion + voice expansion
 *  - Video supported (addon-driven only)
 *
 * Responsibilities:
 *  - Display ONLY (no engine calls)
 *  - State sync between UI and voice
 * ========================================================= */

(function () {
  'use strict';

  /* ================= REGIONS & COUNTRIES ================= */
  const REGION_COUNTRIES = {
    asia: [
      { key:'KR', label:'대한민국 (Korea)' },
      { key:'JP', label:'일본 (Japan)' },
      { key:'CN', label:'중국 (China)' },
      { key:'IN', label:'인도 (India)' },
      { key:'TH', label:'태국 (Thailand)' },
      { key:'VN', label:'베트남 (Vietnam)' },
      { key:'ID', label:'인도네시아 (Indonesia)' },
      { key:'MM', label:'미얀마 (Myanmar)' }
	  { key:'PH', label:'필리핀 (Philippines)' },
      { key:'MY', label:'말레이시아 (Malaysia)' },
      { key:'BD', label:'방글라데시 (Bangladesh)' },
	  { key:'SG', label:'싱가포르 (Singapore)' },
      { key:'LK', label:'스리랑카 (Sri Lanka)' },
	  { key:'KH', label:'캄보디아 (Cambodia)' },
	  { key:'LA', label:'라오스 (Laos)' },
	  { key:'PK', label:'파키스탄 (Pakistan)' }, // Asia > South Asia
	  { key:'AF', label:'아프가니스탄 (Afghanistan)' }, // Asia > South / Central Asia
    ],
    europe: [
      { key:'DE', label:'독일 (Germany)' },
      { key:'FR', label:'프랑스 (France)' },
      { key:'UK', label:'영국 (United Kingdom)' },
      { key:'ES', label:'스페인 (Spain)' },
      { key:'PT', label:'포르투갈 (Portugal)' },
      { key:'DK', label:'덴마크 (Denmark)' },
      { key:'IT', label:'이탈리아 (Italy)' },
      { key:'PL', label:'폴란드 (Poland)' }
	  { key:'NL', label:'네덜란드 (Netherlands)' },   // EU 금융·물류·기업 허브
      { key:'SE', label:'스웨덴 (Sweden)' },           // 북유럽 핵심, 기술·안보
      { key:'NO', label:'노르웨이 (Norway)' },         // 에너지·북극·안보
      { key:'CH', label:'스위스 (Switzerland)' },      // 금융·중립국·국제기구
      { key:'AT', label:'오스트리아 (Austria)' },      // 중부유럽 관문
      { key:'HU', label:'헝가리 (Hungary)' },      
    ],
    north_america: [
      { key:'US', label:'미국 (United States)' },
      { key:'CA', label:'캐나다 (Canada)' },
      { key:'MX', label:'멕시코 (Mexico)' }
	  { key:'AU', label:'호주 (Australia)' },
	  { key:'GT', label:'과테말라 (Guatemala)' }
    ],
    central_south_america: [
      { key:'PA', label:'파나마 (Panama)' },
      { key:'BR', label:'브라질 (Brazil)' },
      { key:'AR', label:'아르헨티나 (Argentina)' },
      { key:'CL', label:'칠레 (Chile)' },
      { key:'PE', label:'페루 (Peru)' },
      { key:'CO', label:'콜롬비아 (Colombia)' },
      { key:'VE', label:'베네수엘라 (Venezuela)' }
	  { key:'UY', label:'우루과이 (Uruguay)' },     // 남미 금융·안정 국가
      { key:'BO', label:'볼리비아 (Bolivia)' },     // 자원·내륙 지정학
      { key:'PY', label:'파라과이 (Paraguay)' },    // 브라질·아르헨티나 사이 핵심 완충
      { key:'SV', label:'엘살바도르 (El Salvador)' }, // 비트코인·치안·이민 이슈
      { key:'HN', label:'온두라스 (Honduras)' },     // 이민·치안·도네이션 핵심
      { key:'CR', label:'코스타리카 (Costa Rica)' }, // 안정·환경·중재
    ],
    middle_east: [
      { key:'IL', label:'이스라엘 (Israel)' },
      { key:'SA', label:'사우디아라비아 (Saudi Arabia)' },
      { key:'IR', label:'이란 (Iran)' },
      { key:'IQ', label:'이라크 (Iraq)' },
      { key:'AE', label:'아랍에미리트 (UAE)' }
	  { key:'TR', label:'튀르키예 (Turkey)' },      // 나토·유럽–중동 관문
      { key:'QA', label:'카타르 (Qatar)' },          // 가스·외교 중재 핵심
      { key:'JO', label:'요르단 (Jordan)' },         // 이스라엘 인접 완충축
      { key:'SY', label:'시리아 (Syria)' },          // 장기 분쟁·강대국 개입
      { key:'LB', label:'레바논 (Lebanon)' },        // 이스라엘–이란 접점
      { key:'YE', label:'예멘 (Yemen)' },             // 홍해·사우디 안보
      { key:'OM', label:'오만 (Oman)' },              // 호르무즈 해협 중재
      { key:'KW', label:'쿠웨이트 (Kuwait)' },       // 걸프 안보·에너지
      { key:'BH', label:'바레인 (Bahrain)' },         // 미 해군·걸프 금융
    ],
    africa: [
      { key:'NG', label:'나이지리아 (Nigeria)' },
      { key:'ZA', label:'남아프리카공화국 (South Africa)' },
      { key:'KE', label:'케냐 (Kenya)' },
      { key:'TZ', label:'탄자니아 (Tanzania)' },
      { key:'UG', label:'우간다 (Uganda)' },
      { key:'EG', label:'이집트 (Egypt)' },
      { key:'LY', label:'리비아 (Libya)' }
	  { key:'GH', label:'가나 (Ghana)' },                 // 서아프리카 안정·금융·정치
      { key:'CD', label:'콩고민주공화국 (DR Congo)' },    // 중앙아프리카 최대국·자원·분쟁
      { key:'ET', label:'에티오피아 (Ethiopia)' },        // 동아프리카 인구대국·지정학
	  { key:'MA', label:'모로코 (Morocco)' },              // 북아프리카·유럽 연결
      { key:'SN', label:'세네갈 (Senegal)' },              // 서아프리카 정치 안정
      { key:'CM', label:'카메룬 (Cameroon)' },             // 중앙–서아프리카 연결축
    ],
    eurasia: [
      { key:'RU', label:'러시아 (Russia)' },
	  { key:'BY', label:'벨라루스 (Belarus)' },  // 러시아–유럽 연결축
      { key:'UA', label:'우크라이나 (Ukraine)' },// 유라시아 안보 핵심
      { key:'KZ', label:'카자흐스탄 (Kazakhstan)' },
      { key:'UZ', label:'우즈베키스탄 (Uzbekistan)' },
      { key:'TM', label:'투르크메니스탄 (Turkmenistan)' },
      { key:'KG', label:'키르기스스탄 (Kyrgyzstan)' },
      { key:'TJ', label:'타지키스탄 (Tajikistan)' },
      { key:'MN', label:'몽골 (Mongolia)' }
	  { key:'AZ', label:'아제르바이잔 (Azerbaijan)' }, // 코카서스·에너지
      { key:'GE', label:'조지아 (Georgia)' },    // 흑해·러시아-유럽 완충
      { key:'AM', label:'아르메니아 (Armenia)' },// 코카서스 분쟁 축
    ]
  };

  /* ================= STATE ================= */
  let backdrop = null;
  let modal = null;
  let voiceEnabled = true;
  let expandedCountry = null;

  /* ================= UTIL ================= */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ================= STYLE ================= */
  function injectStyle() {
    if (document.getElementById('maru-country-style')) return;
    const style = el('style');
    style.id = 'maru-country-style';
    style.textContent = `
      .maru-country-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998}
      .maru-country-modal{position:fixed;inset:4%;background:#fff6f8;border-radius:20px;z-index:99999;box-shadow:0 30px 80px rgba(0,0,0,.4);display:flex;flex-direction:column;overflow:hidden}
      .maru-country-header{padding:18px 22px;border-bottom:1px solid #eee;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px}
      .maru-country-header strong{font-size:18px;color:#1f3a5f}
      .maru-country-issuebar{display:flex;align-items:center;gap:8px;background:#fff1f4;border:1px solid #e2c6cf;border-radius:10px;padding:6px 10px;font-size:12px;white-space:nowrap;overflow:hidden}
      .maru-country-issuebar .label{font-weight:600;color:#8b2f4a}
      .maru-country-issuebar .text{text-overflow:ellipsis;overflow:hidden}
      .maru-country-voice-toggle{border:1px solid #d6c7b5;background:#fff;border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer}
      .maru-country-voice-toggle.off{opacity:.45}
      .maru-country-close{border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}
      .maru-country-body{flex:1;overflow:auto;padding:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
      @media(max-width:900px){.maru-country-body{grid-template-columns:1fr}}
      .maru-country-card{border:1px solid #cfe3f2;border-radius:18px;padding:16px;background:#eef7ff;cursor:pointer;display:flex;flex-direction:column;transition:.2s}
      .maru-country-card:hover{background:#e2f1ff}
      .maru-country-card h3{margin:0 0 8px;font-size:15px;color:#1f3a5f}
      .maru-country-brief{font-size:13px;line-height:1.6;color:#000;white-space:pre-line}
      .maru-country-empty{font-size:12px;color:#777;font-style:italic}
      .maru-country-card.expanded{grid-column:1 / -1;background:#ffffff;border:2px solid #7aaad9}
      .maru-country-card.expanded h3{font-size:18px}
      .maru-country-video{display:none;grid-column:1 / -1;min-height:420px;border-radius:18px;border:1px solid #ddd;background:#000}
      .maru-country-video.active{display:block}
      .maru-country-video iframe{width:100%;height:100%;border:0;border-radius:18px}
    `;
    document.head.appendChild(style);
  }

  /* ================= CORE ================= */
  function close() {
    if (modal) modal.remove();
    if (backdrop) backdrop.remove();
    modal = backdrop = null;
    expandedCountry = null;
    window.MARU_COUNTRY_VOICE_READY = false;
  }

  function expandCountry(countryKey) {
    expandedCountry = countryKey;
    document.querySelectorAll('.maru-country-card').forEach(card => {
      card.classList.toggle('expanded', card.dataset.country === countryKey);
    });
  }

  function open(region) {
    if (modal) return;
    injectStyle();
    window.MARU_COUNTRY_VOICE_READY = true;

    backdrop = el('div', 'maru-country-backdrop');
    backdrop.addEventListener('click', close);

    modal = el('div', 'maru-country-modal');

    const header = el('div', 'maru-country-header');
    const title = el('strong', null, '🌐 MARU GLOBAL COUNTRY INSIGHT');
    const issueBar = el('div', 'maru-country-issuebar', '<span class="label">국가 중요 이슈</span><span class="text">현재 중요 이슈 없음</span>');
    const voiceBtn = el('button', 'maru-country-voice-toggle', 'VOICE ON');
    voiceBtn.addEventListener('click', () => {
      voiceEnabled = !voiceEnabled;
      voiceBtn.classList.toggle('off', !voiceEnabled);
      voiceBtn.textContent = voiceEnabled ? 'VOICE ON' : 'VOICE OFF';
    });
    const closeBtn = el('button', 'maru-country-close', '닫기');
    closeBtn.addEventListener('click', close);

    header.append(title, issueBar, voiceBtn, closeBtn);

    const body = el('div', 'maru-country-body');
    const videoZone = el('div', 'maru-country-video');
    body.appendChild(videoZone);

    (REGION_COUNTRIES[region] || []).forEach(c => {
      const card = el('div', 'maru-country-card');
      card.dataset.country = c.key;
      card.innerHTML = `<h3>${c.label}</h3><div class="maru-country-brief"><div class="maru-country-empty">아직 올라온 데이터가 없습니다.</div></div>`;
      card.addEventListener('click', () => expandCountry(c.key));
      body.appendChild(card);
    });

    modal.append(header, body);
    document.body.append(backdrop, modal);
  }

  /* ================= PUBLIC API ================= */
  window.openMaruGlobalCountryModal = open;

  window.MaruCountryDisplay = {
    expand: expandCountry,
    showVideo: function ({ src }) {
      const zone = document.querySelector('.maru-country-video');
      if (!zone) return;
      zone.innerHTML = `<iframe src="${src}" allowfullscreen></iframe>`;
      zone.classList.add('active');
    },
    hideVideo: function () {
      const zone = document.querySelector('.maru-country-video');
      if (!zone) return;
      zone.classList.remove('active');
      zone.innerHTML = '';
    }
  };

  /* ================= VOICE BRIDGE ================= */
  window.MaruCountryVoice = {
    read: function (countryKey) {
      if (!voiceEnabled) return null;
      const card = document.querySelector(`.maru-country-card[data-country="${countryKey}"] .maru-country-brief`);
      return card ? card.textContent.trim() : null;
    },
    readExpanded: function () {
      if (!voiceEnabled || !expandedCountry) return null;
      const card = document.querySelector(`.maru-country-card[data-country="${expandedCountry}"] .maru-country-brief`);
      return card ? card.textContent.trim() : null;
    },
    readCritical: function () {
      if (!voiceEnabled) return null;
      const el = document.querySelector('.maru-country-issuebar .text');
      return el ? el.textContent.trim() : null;
    },
    requestVideo: function (countryKey) {
      return { type: 'country-video', country: countryKey };
    }
  };

})();