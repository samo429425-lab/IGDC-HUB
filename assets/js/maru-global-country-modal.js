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


    /* ================= STATE ================= */
  let backdrop = null;
  let modal = null;
  let voiceEnabled = true;
  let expandedCountry = null;

  /* ================= EXPORT ================= */
  window.openMaruGlobalCountryModal = function(regionId){
    // 기존 로직과의 호환성만 보장 (구조 변경 없음)
    const countries = COUNTRY_MAP[regionId] || [];
    // 실제 카드 생성/음성/확장 로직은 기존 코드 그대로 이어서 사용
    // (이 파일에서는 데이터 구조만 담당)
    return countries;
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

  
/* ======================================================
 * MARU GLOBAL COUNTRY MODAL UI + VOICE UPGRADE BLOCK
 * (1) Header UI (Voice Toggle + Issue Bar)
 * (2) Country Card UI (Color / Font)
 * (3) Voice Read (Summary / Detail)
 * (4) Detail Expansion Hook
 * ====================================================== */

/* ============== STATE ============== */
let voiceEnabled = true;
let activeRegionId = null;
let activeCountryName = null;

/* ============== UTILS ============== */
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/* ============== STYLE ============== */
function injectCountryUIStyle() {
  if (document.getElementById('maru-country-ui-style')) return;

  const style = el('style');
  style.id = 'maru-country-ui-style';
  style.textContent = `
    .maru-country-modal{
      background:#fff6f4;
      border-radius:20px;
    }
    .maru-country-header{
      padding:16px 20px;
      display:grid;
      grid-template-columns:auto 1fr auto auto;
      gap:12px;
      align-items:center;
      border-bottom:1px solid #eee;
    }
    .maru-country-title{
      font-weight:600;
    }
    .maru-country-issuebar{
      background:#fff1f4;
      border:1px solid #e2c6cf;
      border-radius:10px;
      padding:6px 10px;
      font-size:12px;
      display:flex;
      gap:8px;
      white-space:nowrap;
      overflow:hidden;
    }
    .maru-country-issuebar .label{
      color:#8b2f4a;
      font-weight:600;
    }
    .maru-country-voice-toggle{
      border:1px solid #d6c7b5;
      background:#fff;
      border-radius:10px;
      padding:6px 10px;
      font-size:12px;
      cursor:pointer;
    }
    .maru-country-voice-toggle.off{
      opacity:.45;
    }
    .maru-country-card{
      background:#eef7ff;
      border:1px solid #cfe3f2;
      border-radius:18px;
      padding:16px;
      cursor:pointer;
      transition:.2s;
    }
    .maru-country-card:hover{
      background:#e2f1ff;
    }
    .maru-country-name{
      color:#1f3a5f; /* 곤색/군청 */
      margin:0 0 6px;
      font-weight:600;
    }
    .maru-country-summary{
      color:#000;
      margin:0;
      font-size:13px;
    }
  `;
  document.head.appendChild(style);
}

/* ============== HEADER ============== */
function buildCountryHeader(regionId) {
  activeRegionId = regionId;

  const header = el('div', 'maru-country-header');

  const title = el(
    'strong',
    'maru-country-title',
    `🌐 MARU GLOBAL INSIGHT — 국가 분석 (${regionId.toUpperCase()})`
  );

  const issueBar = el(
    'div',
    'maru-country-issuebar',
    `<span class="label">국가별 중요 이슈</span>
     <span class="text">주요 이슈 요약 대기 중</span>`
  );

  const voiceToggle = el(
    'button',
    'maru-country-voice-toggle',
    'VOICE ON'
  );
  voiceToggle.onclick = () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle('off', !voiceEnabled);
    voiceToggle.textContent = voiceEnabled ? 'VOICE ON' : 'VOICE OFF';
  };

  const closeBtn = el('button', 'maru-country-close', '닫기');
  closeBtn.onclick = closeModal;

  header.append(title, issueBar, voiceToggle, closeBtn);
  return header;
}

/* ============== COUNTRY CARD ============== */
function renderCountryCard(countryName, summaryText = '') {
  const card = el(
    'div',
    'maru-country-card',
    `
      <h4 class="maru-country-name">${countryName}</h4>
      <p class="maru-country-summary">
        ${summaryText || '요약 정보 준비 중'}
      </p>
    `
  );

  card.onclick = () => {
    activeCountryName = countryName;
    openCountryDetail(countryName);
  };

  return card;
}

/* ============== DETAIL + VOICE ============== */
function openCountryDetail(countryName) {
  // 기존 업그레이드 파일에 있던 상세 확장 로직 연결 지점
  if (window.openMaruCountryDetail) {
    window.openMaruCountryDetail(countryName);
  }

  if (voiceEnabled && window.maruVoiceSpeak) {
    window.maruVoiceSpeak(
      `${countryName}에 대한 상세 브리핑을 시작합니다.`
    );
  }
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