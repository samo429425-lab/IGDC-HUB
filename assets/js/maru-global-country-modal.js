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

 /* ================= STYLE (UNIFIED) ================= */
(function injectMaruCountryStyle(){
  if (document.getElementById('maru-country-style')) return;

  const style = document.createElement('style');
  style.id = 'maru-country-style';
  style.textContent = `
  /* backdrop */
  .maru-country-backdrop{
    position:fixed; inset:0;
    background:rgba(0,0,0,.45);
    z-index:100000
  }

  /* modal */
  .maru-country-modal{
    position:fixed; inset:8%;
    background:#fff7f2; /* 아이보리/연분홍 */
    border-radius:16px;
    z-index:100001;
    display:flex; flex-direction:column;
    box-shadow:0 20px 60px rgba(0,0,0,.35)
  }

  /* header */
  .maru-country-header{
    padding:14px 20px;
    border-bottom:1px solid #eadfd7;
    display:flex; align-items:center; gap:12px
  }
  .maru-country-header .title{
    font-weight:700
  }
  .maru-country-header .spacer{
    flex:1
  }
  .maru-country-header .voice-toggle{
    cursor:pointer;
    padding:6px 10px;
    border-radius:999px;
    border:1px solid #ccc;
    background:#fff
  }
  .maru-country-header .voice-toggle.off{
    opacity:.5
  }

  /* issue bar */
  .maru-country-issuebar{
    margin:0 20px 10px;
    padding:8px 12px;
    border-radius:10px;
    background:#fff;
    border:1px solid #e6d9cf;
    display:flex; align-items:center; gap:10px
  }
  .maru-country-issuebar .label{
    font-weight:600
  }
  .maru-country-issuebar .text{
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis
  }
  .maru-country-issuebar.expanded{
    white-space:normal
  }

  /* body */
  .maru-country-body{
    padding:20px;
    overflow:auto;
    display:grid;
    grid-template-columns:repeat(2,1fr);
    gap:18px
  }

  /* country card */
  .maru-country-card{
    background:#e9f4ff; /* 연한 하늘색 */
    border:1px solid #cfe6ff;
    border-radius:14px;
    padding:14px;
    cursor:pointer
  }
  .maru-country-card.expanded{
    grid-column:1 / -1
  }
  .maru-country-name{
    color:#1f2f5c; /* 곤/군청 */
    margin:0 0 6px;
    font-weight:700
  }
  .maru-country-card p{
    font-size:13px; line-height:1.45; margin:4px 0; color:#000
  }

  /* video zone */
  .maru-country-video{
    margin:16px 20px;
    display:none
  }
  .maru-country-video.active{
    display:block
  }
  .maru-country-video iframe{
    width:100%; height:360px; border:0; border-radius:12px
  }
  /* === COUNTRY HEADER LAYOUT FIX (SAFE) === */
.maru-country-header{
  display:grid !important;
  grid-template-columns:auto 1fr auto auto !important;
  align-items:center !important;
  gap:12px !important;
}

/* issue bar는 헤더에서 밀어내기 */
.maru-country-header .maru-country-issuebar{
  grid-column:1 / -1;
  margin-top:8px;
}

/* voice toggle / close 높이 맞춤 */
.maru-country-voice-toggle,
#maruCountryClose{
  height:32px;
  display:flex;
  align-items:center;
}

  `;
  document.head.appendChild(style);
})();


/* ======================================================
 * MARU GLOBAL COUNTRY MODAL UI + VOICE UPGRADE BLOCK
 * (1) Header UI (Voice Toggle + Issue Bar)
 * (2) Country Card UI (Color / Font)
 * (3) Voice Read (Summary / Detail)
 * (4) Detail Expansion Hook
 * ====================================================== */

/* ============== STATE ============== */
let activeRegionId = null;
let activeCountryName = null;
let voiceEnabled = true;

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



/* ======================================================
 * MARU COUNTRY MODAL – VIDEO CONTROL BLOCK
 * 역할:
 * 1. Add-on이 던져준 영상 데이터 수신
 * 2. 영상 리스트(3~4개) 표시
 * 3. 클릭/음성 선택
 * 4. 선택 영상 확대 표시
 * ====================================================== */

/* ============== VIDEO STATE ============== */
let countryVideos = [];
let activeVideoIndex = null;

/* ============== VIDEO STYLE ============== */
function injectCountryVideoStyle() {
  if (document.getElementById('maru-country-video-style')) return;

  const style = document.createElement('style');
  style.id = 'maru-country-video-style';
  style.textContent = `
    .maru-country-video-section{
      margin-top:20px;
      padding-top:14px;
      border-top:1px solid #ddd;
    }
    .maru-country-video-list{
      display:grid;
      grid-template-columns:repeat(2,1fr);
      gap:14px;
    }
    .maru-country-video-card{
      border:1px solid #ccc;
      border-radius:12px;
      overflow:hidden;
      cursor:pointer;
      background:#fff;
    }
    .maru-country-video-card img{
      width:100%;
      display:block;
    }
    .maru-country-video-card h5{
      margin:8px;
      font-size:13px;
    }
    .maru-video-overlay{
      position:fixed;
      inset:0;
      background:rgba(0,0,0,.8);
      z-index:100000;
      display:flex;
      align-items:center;
      justify-content:center;
    }
    .maru-video-player{
      width:80%;
      max-width:960px;
      background:#000;
      border-radius:12px;
      overflow:hidden;
      position:relative;
    }
    .maru-video-player video,
    .maru-video-player iframe{
      width:100%;
      height:540px;
    }
    .maru-video-close{
      position:absolute;
      top:8px;
      right:12px;
      background:#fff;
      border:none;
      border-radius:8px;
      padding:6px 10px;
      cursor:pointer;
      z-index:1;
    }
  `;
  document.head.appendChild(style);
}

/* ============== VIDEO INJECT (FROM ADD-ON) ============== */
/**
 * Add-on에서 호출:
 * window.injectMaruCountryVideos({
 *   country: '베트남',
 *   videos: [
 *     { title, thumbnail, src },
 *     ...
 *   ]
 * })
 */
window.injectMaruCountryVideos = function(payload){
  if (!payload || !Array.isArray(payload.videos)) return;

  countryVideos = payload.videos.slice(0,4);
  activeVideoIndex = null;

  injectCountryVideoStyle();
  renderCountryVideoList();
};

/* ============== VIDEO LIST RENDER ============== */
function renderCountryVideoList(){
  const modal = document.querySelector('.maru-country-modal');
  if (!modal) return;

  let section = modal.querySelector('.maru-country-video-section');
  if (!section) {
    section = document.createElement('div');
    section.className = 'maru-country-video-section';
    modal.appendChild(section);
  }

  section.innerHTML = `
    <h4>관련 영상 자료</h4>
    <div class="maru-country-video-list"></div>
  `;

  const list = section.querySelector('.maru-country-video-list');

  countryVideos.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'maru-country-video-card';
    card.innerHTML = `
      <img src="${v.thumbnail || ''}" alt="">
      <h5>${String.fromCharCode(65+i)}. ${v.title || ''}</h5>
    `;
    card.onclick = () => openCountryVideo(i);
    list.appendChild(card);
  });
}

/* ============== VIDEO OPEN (EXPAND) ============== */
function openCountryVideo(index){
  const v = countryVideos[index];
  if (!v) return;

  activeVideoIndex = index;

  const overlay = document.createElement('div');
  overlay.className = 'maru-video-overlay';

  const player = document.createElement('div');
  player.className = 'maru-video-player';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'maru-video-close';
  closeBtn.textContent = '닫기';
  closeBtn.onclick = () => overlay.remove();

  player.appendChild(closeBtn);

  // iframe or video
  if (v.src.includes('youtube') || v.src.includes('iframe')) {
    player.innerHTML += `<iframe src="${v.src}" frameborder="0" allowfullscreen></iframe>`;
  } else {
    player.innerHTML += `<video src="${v.src}" controls autoplay></video>`;
  }

  overlay.appendChild(player);
  document.body.appendChild(overlay);
}



  /* ================= RENDER ================= */
  function renderCountryCard(country, data) {
    const d = data || {};
    return `
      <div class="maru-country-card" data-country="${country}">
      <h4>${country}</h4>

      <div class="maru-country-brief">
        <p><strong>유입 흐름</strong>: ${d.flow || '분석 중'}</p>
        <p><strong>트렌드</strong>: ${d.trend || '확인 중'}</p>
        <p class="risk"><strong>주의</strong>: ${d.risk || '특이사항 없음'}</p>
        <p class="opportunity"><strong>기회</strong>: ${d.opportunity || '관망'}</p>
        <p><em>${d.comment || 'MARU 코멘트 대기 중'}</em></p>
      </div>
    </div>`;
  }

  /* ================= OPEN ================= */
  async function open(regionId) {
    if (modal) return;

window.MARU_COUNTRY_VOICE_READY = true;


    backdrop = el('div', 'maru-country-backdrop');
    backdrop.onclick = closeModal;

    modal = el('div', 'maru-country-modal');

 /* ================= HEADER + ISSUE + STYLE (INTEGRATED) ================= */


/* ---------- HEADER UI ---------- */
const header = el('div', 'maru-country-header');

header.innerHTML = `
  <strong>🌐 MARU GLOBAL INSIGHT — 국가 분석 (${regionId})</strong>

  <div class="maru-country-issuebar">
    <span class="text">국가별 중요 이슈 요약 대기 중…</span>
  </div>

  <label class="maru-country-voice-toggle">
    <input type="checkbox" id="maruCountryVoiceToggle" checked />
    <span>음성</span>
  </label>

  <button id="maruCountryClose">닫기</button>
`;

header.querySelector('#maruCountryVoiceToggle').onchange = (e)=>{
  voiceEnabled = e.target.checked;
};

/* ================= HEADER + ISSUE + BODY (UPGRADED) ================= */

const body = el(
  'div',
  'maru-country-body',
  '<p>국가별 글로벌 인사이트 수집 중…</p>'
);

/* header → issue bar → body 순서로 구성 */
modal.appendChild(header);

/* 국가별 중요 이슈 바 */
const issueBar = el(
  'div',
  'maru-country-issuebar',
  `<span class="label">국가별 중요 이슈</span>
   <span class="text">요약 정보 준비 중</span>`
);
modal.appendChild(issueBar);

modal.appendChild(body);

/* DOM 부착 */
document.body.appendChild(backdrop);
document.body.appendChild(modal);

/* 닫기 */
document.getElementById('maruCountryClose').onclick = closeModal;

/* 데이터 로딩 */
const apiData = await fetchCountryInsight(regionId);
const countries = REGION_COUNTRY_MAP[regionId] || [];
const countryData = apiData?.countries || {};

/* 카드 렌더 */
body.innerHTML = countries
  .map(c => renderCountryCard(c, countryData[c]))
  .join('');

/* 음성 대기 상태 보장 */
window.MARU_COUNTRY_VOICE_READY = true;
}


/* ================= VOICE HUB =================
 * Country Modal 전용 단일 음성 인터페이스
 * - UI / Add-on / Voice Engine 연결 허브
 * - 음성 판단 ❌, 읽기 대상 제공 ⭕
 * ============================================ */

window.MaruCountryVoice = (function () {
  let enabled = true;

  /* ---------- CONTROL ---------- */
  function enable() { enabled = true; }
  function disable() { enabled = false; }
  function toggle() { enabled = !enabled; }
  function isEnabled() { return enabled; }

  /* ---------- READ HELPERS ---------- */

  function readCountry(countryKey) {
    if (!enabled) return null;
    const el = document.querySelector(
      `.maru-country-card[data-country="${countryKey}"] .maru-country-brief`
    );
    return el ? el.textContent.trim() : null;
  }

  function readExpanded() {
    if (!enabled || !window.expandedCountry) return null;
    const el = document.querySelector(
      `.maru-country-card[data-country="${window.expandedCountry}"] .maru-country-brief`
    );
    return el ? el.textContent.trim() : null;
  }

  function readCriticalIssue() {
    if (!enabled) return null;
    const el = document.querySelector('.maru-country-issuebar .text');
    return el ? el.textContent.trim() : null;
  }

  /* ---------- REQUEST BUILDERS ---------- */
  // 👉 판단은 Add-on, 이건 요청 포맷만 만든다

  function requestDetail(countryKey) {
    return {
      type: 'country-detail',
      country: countryKey
    };
  }

  function requestVideo(countryKey, topic = null) {
    return {
      type: 'country-video',
      country: countryKey,
      topic
    };
  }

  function requestTopic(countryKey, topic, depth = 'summary') {
    return {
      type: 'country-topic',
      country: countryKey,
      topic,
      depth
    };
  }

  /* ---------- PUBLIC ---------- */
  return {
    enable,
    disable,
    toggle,
    isEnabled,

    // 읽기
    readCountry,
    readExpanded,
    readCriticalIssue,

    // Add-on 요청
    requestDetail,
    requestVideo,
    requestTopic
  };

})();

  /* ================= EXPOSE ================= */
  window.openMaruGlobalCountryModal = open;
})();