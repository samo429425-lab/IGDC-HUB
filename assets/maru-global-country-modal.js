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

/* =========================================================
 * MARU GLOBAL COUNTRY MODAL — CLEAN & VERIFIED VERSION
 * FINAL SAFE BUILD (2026-01)
 * ========================================================= */

(function(){
  'use strict';

  const COUNTRY_MAP = {

    /* ---------------- ASIA ---------------- */
    asia: [
      { code:'KR', label:'대한민국 (Korea)' },
      { code:'JP', label:'일본 (Japan)' },
      { code:'CN', label:'중국 (China)' },
      { code:'TW', label:'타이완 (Taiwan)' },
      { code:'PH', label:'필리핀 (Philippines)' },
      { code:'MY', label:'말레이시아 (Malaysia)' },
      { code:'SG', label:'싱가포르 (Singapore)' },
      { code:'BD', label:'방글라데시 (Bangladesh)' },
      { code:'PK', label:'파키스탄 (Pakistan)' },
      { code:'AF', label:'아프가니스탄 (Afghanistan)' },
      { code:'LK', label:'스리랑카 (Sri Lanka)' },
      { code:'KH', label:'캄보디아 (Cambodia)' },
      { code:'VN', label:'베트남 (Vietnam)' },
      { code:'TH', label:'태국 (Thailand)' },
      { code:'ID', label:'인도네시아 (Indonesia)' },
      { code:'IN', label:'인도 (India)' },
      { code:'NP', label:'네팔 (Nepal)' }
    ],

    /* ---------------- EUROPE ---------------- */
    europe: [
      { code:'DE', label:'독일 (Germany)' },
      { code:'FR', label:'프랑스 (France)' },
      { code:'UK', label:'영국 (United Kingdom)' },
      { code:'ES', label:'스페인 (Spain)' },
      { code:'PT', label:'포르투갈 (Portugal)' },
      { code:'IT', label:'이탈리아 (Italy)' },
      { code:'NL', label:'네덜란드 (Netherlands)' },
      { code:'SE', label:'스웨덴 (Sweden)' },
      { code:'NO', label:'노르웨이 (Norway)' },
      { code:'CH', label:'스위스 (Switzerland)' },
      { code:'AT', label:'오스트리아 (Austria)' },
      { code:'PL', label:'폴란드 (Poland)' },
      { code:'HU', label:'헝가리 (Hungary)' },
      { code:'CZ', label:'체코 (Czech Republic)' },
      { code:'SK', label:'슬로바키아 (Slovakia)' }
    ],

    /* ---------------- MIDDLE EAST ---------------- */
    middle_east: [
      { code:'IR', label:'이란 (Iran)' },
      { code:'IQ', label:'이라크 (Iraq)' },
      { code:'IL', label:'이스라엘 (Israel)' },
      { code:'SA', label:'사우디아라비아 (Saudi Arabia)' },
      { code:'TR', label:'튀르키예 (Turkey)' },
      { code:'QA', label:'카타르 (Qatar)' },
      { code:'JO', label:'요르단 (Jordan)' },
      { code:'SY', label:'시리아 (Syria)' },
      { code:'LB', label:'레바논 (Lebanon)' },
      { code:'YE', label:'예멘 (Yemen)' },
      { code:'OM', label:'오만 (Oman)' },
      { code:'KW', label:'쿠웨이트 (Kuwait)' },
      { code:'BH', label:'바레인 (Bahrain)' }
    ],

    /* ---------------- AFRICA ---------------- */
    africa: [
      { code:'NG', label:'나이지리아 (Nigeria)' },
      { code:'ZA', label:'남아프리카공화국 (South Africa)' },
      { code:'KE', label:'케냐 (Kenya)' },
      { code:'TZ', label:'탄자니아 (Tanzania)' },
      { code:'UG', label:'우간다 (Uganda)' },
      { code:'EG', label:'이집트 (Egypt)' },
      { code:'LY', label:'리비아 (Libya)' },
      { code:'GH', label:'가나 (Ghana)' },
      { code:'CD', label:'콩고민주공화국 (DR Congo)' },
      { code:'ET', label:'에티오피아 (Ethiopia)' },
      { code:'MA', label:'모로코 (Morocco)' },
      { code:'DZ', label:'알제리 (Algeria)' },
      { code:'TN', label:'튀니지 (Tunisia)' },
      { code:'SN', label:'세네갈 (Senegal)' }
    ],

    /* ---------------- NORTH AMERICA ---------------- */
    north_america: [
      { code:'US', label:'미국 (United States)' },
      { code:'CA', label:'캐나다 (Canada)' },
      { code:'MX', label:'멕시코 (Mexico)' },
      { code:'AU', label:'호주 (Australia)' },
      { code:'GT', label:'과테말라 (Guatemala)' }
    ],

    /* ---------------- SOUTH AMERICA ---------------- */
    south_america: [
      { code:'BR', label:'브라질 (Brazil)' },
      { code:'AR', label:'아르헨티나 (Argentina)' },
      { code:'CL', label:'칠레 (Chile)' },
      { code:'PE', label:'페루 (Peru)' },
      { code:'CO', label:'콜롬비아 (Colombia)' },
      { code:'VE', label:'베네수엘라 (Venezuela)' },
      { code:'UY', label:'우루과이 (Uruguay)' },
      { code:'PY', label:'파라과이 (Paraguay)' },
      { code:'BO', label:'볼리비아 (Bolivia)' },
      { code:'SV', label:'엘살바도르 (El Salvador)' },
      { code:'HN', label:'온두라스 (Honduras)' },
      { code:'CR', label:'코스타리카 (Costa Rica)' }
    ],

    /* ---------------- EURASIA ---------------- */
    eurasia: [
      { code:'RU', label:'러시아 (Russia)' },
      { code:'KZ', label:'카자흐스탄 (Kazakhstan)' },
      { code:'UZ', label:'우즈베키스탄 (Uzbekistan)' },
      { code:'TM', label:'투르크메니스탄 (Turkmenistan)' },
      { code:'KG', label:'키르기스스탄 (Kyrgyzstan)' },
      { code:'TJ', label:'타지키스탄 (Tajikistan)' },
      { code:'MN', label:'몽골 (Mongolia)' },
      { code:'AZ', label:'아제르바이잔 (Azerbaijan)' },
      { code:'GE', label:'조지아 (Georgia)' },
      { code:'AM', label:'아르메니아 (Armenia)' },
      { code:'BY', label:'벨라루스 (Belarus)' },
      { code:'UA', label:'우크라이나 (Ukraine)' }
    ]
  };

  window.MARU_COUNTRY_MAP = COUNTRY_MAP;


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

  (COUNTRY_MAP[region] || []).forEach(c => {
  const card = el('div', 'maru-country-card');
  card.dataset.country = c.code;
  card.innerHTML = `
    <h3>${c.label}</h3>
    <div class="maru-country-brief">
      <div class="maru-country-empty">아직 올라온 데이터가 없습니다.</div>
    </div>
  `;
  card.addEventListener('click', () => expandCountry(c.code));
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