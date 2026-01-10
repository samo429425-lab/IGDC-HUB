/* =========================================================
 * MARU GLOBAL COUNTRY MODAL (v1.0 – ADMIN ONLY) — STABLE
 * - Reopen safe (no stuck modal)
 * - Inherit Region voice ON (MARU_AUTO_VOICE_ON)
 * - Keep voice ON across closes (no forced reset)
 * ========================================================= */

(function () {
  'use strict';

  const API_ENDPOINT = '/api/ai-diagnose';

  const REGION_COUNTRY_MAP = {
    asia: [
      '대한민국 (Korea)','일본 (Japan)','중국 (China)','타이완 (Taiwan)','필리핀 (Philippines)',
      '말레이시아 (Malaysia)','싱가포르 (Singapore)','방글라데시 (Bangladesh)','파키스탄 (Pakistan)',
      '아프가니스탄 (Afghanistan)','스리랑카 (Sri Lanka)','캄보디아 (Cambodia)','베트남 (Vietnam)',
      '태국 (Thailand)','인도네시아 (Indonesia)','인도 (India)','네팔 (Nepal)'
    ],
    europe: [
      '독일 (Germany)','프랑스 (France)','영국 (United Kingdom)','스페인 (Spain)','포르투갈 (Portugal)',
      '이탈리아 (Italy)','네덜란드 (Netherlands)','스웨덴 (Sweden)','노르웨이 (Norway)',
      '스위스 (Switzerland)','오스트리아 (Austria)','폴란드 (Poland)','헝가리 (Hungary)',
      '체코 (Czech Republic)','슬로바키아 (Slovakia)'
    ],
    middle_east: [
      '이란 (Iran)','이라크 (Iraq)','이스라엘 (Israel)','사우디아라비아 (Saudi Arabia)',
      '튀르키예 (Turkey)','카타르 (Qatar)','요르단 (Jordan)','시리아 (Syria)',
      '레바논 (Lebanon)','예멘 (Yemen)','오만 (Oman)','쿠웨이트 (Kuwait)','바레인 (Bahrain)'
    ],
    africa: [
      '남아프리카공화국 (South Africa)','나이지리아 (Nigeria)','케냐 (Kenya)','탄자니아 (Tanzania)',
      '우간다 (Uganda)','이집트 (Egypt)','리비아 (Libya)','가나 (Ghana)',
      '콩고민주공화국 (DR Congo)','에티오피아 (Ethiopia)','모로코 (Morocco)',
      '알제리 (Algeria)','튀니지 (Tunisia)','세네갈 (Senegal)'
    ],
    north_america: [
      '미국 (United States)','캐나다 (Canada)','멕시코 (Mexico)','호주 (Australia)','과테말라 (Guatemala)'
    ],
    south_america: [
      '브라질 (Brazil)','아르헨티나 (Argentina)','칠레 (Chile)','페루 (Peru)','콜롬비아 (Colombia)',
      '베네수엘라 (Venezuela)','우루과이 (Uruguay)','파라과이 (Paraguay)','볼리비아 (Bolivia)',
      '엘살바도르 (El Salvador)','온두라스 (Honduras)','코스타리카 (Costa Rica)'
    ],
    eurasia: [
      '러시아 (Russia)','카자흐스탄 (Kazakhstan)','우즈베키스탄 (Uzbekistan)',
      '투르크메니스탄 (Turkmenistan)','키르기스스탄 (Kyrgyzstan)','타지키스탄 (Tajikistan)',
      '몽골 (Mongolia)','아제르바이잔 (Azerbaijan)','조지아 (Georgia)',
      '아르메니아 (Armenia)','벨라루스 (Belarus)','우크라이나 (Ukraine)'
    ]
  };

  let backdrop = null;
  let modal = null;

  let activeRegionId = null;
  let activeCountryName = null;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function closeModal() {
    try {
      window.MARU_COUNTRY_VOICE_READY = false;
      if (modal) modal.remove();
      if (backdrop) backdrop.remove();
    } catch (e) {
      console.warn('[COUNTRY] closeModal error', e);
    } finally {
      modal = null;
      backdrop = null;
      // NOTE: do NOT force voice OFF here (per your policy: keep ON across closes)
    }
  }

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

  (function injectMaruCountryStyle(){
    if (document.getElementById('maru-country-style')) return;

    const style = document.createElement('style');
    style.id = 'maru-country-style';
    style.textContent = `
      .maru-country-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000}
      .maru-country-modal{position:fixed;inset:8%;background:#fff7f2;border-radius:16px;z-index:100001;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35)}
      .maru-country-header{padding:18px 22px;border-bottom:1px solid #eee;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:10px}
      .maru-country-header strong{font-size:18px;color:#1f3a5f}
      .maru-country-issuebar{display:flex;align-items:center;justify-content:center;gap:6px;background:#fff1f4;border:1px solid #e2c6cf;border-radius:10px;padding:4px 10px;font-size:12px;line-height:1.2;height:22px;white-space:nowrap;overflow:hidden}
      .maru-country-issuebar .text{overflow:hidden;text-overflow:ellipsis}
      .maru-country-voice-toggle{border:1px solid #d6c7b5;background:#fff;border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer}
      .maru-country-voice-toggle.off{opacity:.45}
      .maru-country-close{border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}
      .maru-country-body{padding:20px;overflow:auto;display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
      .maru-country-card{background:#e9f4ff;border:1px solid #cfe6ff;border-radius:14px;padding:14px;cursor:pointer}
      .maru-country-card.expanded{grid-column:1 / -1}
      .maru-country-card h4{margin:0 0 6px;font-weight:700;color:#1f2f5c}
      .maru-country-card p{font-size:13px;line-height:1.45;margin:4px 0;color:#000}
      .maru-country-video{margin:16px 20px;display:none}
      .maru-country-video.active{display:block}
      .maru-country-video iframe{width:100%;height:360px;border:0;border-radius:12px}
      .maru-input-bar{position:sticky;bottom:0;width:100%;padding:6px 10px;background:#fff9f4;border-top:1px solid #e6dcd3;box-sizing:border-box;z-index:5}
      .maru-input-bar.hidden{display:none}
      .maru-input-text{width:100%;height:30px;padding:4px 10px;font-size:12px;line-height:1.2;border-radius:6px;border:1px solid #ccc;outline:none;box-sizing:border-box}
      @media (max-width: 640px){.maru-input-text{height:32px;font-size:13px}}
      .maru-country-detail{position:fixed;inset:8%;background:#ffffff;border-radius:22px;z-index:100002;box-shadow:0 40px 90px rgba(0,0,0,.45);padding:28px;overflow:auto}
      .maru-country-detail h2{margin:0 0 14px;font-size:20px;color:#1f3a5f}
      .maru-country-detail p{font-size:14px;line-height:1.8;color:#000}
      .maru-country-detail-close{position:absolute;top:18px;right:18px;border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}
      .maru-video-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:100003;display:flex;align-items:center;justify-content:center}
      .maru-video-player{width:80%;max-width:960px;background:#000;border-radius:12px;overflow:hidden;position:relative}
      .maru-video-player video,.maru-video-player iframe{width:100%;height:540px}
      .maru-video-close{position:absolute;top:8px;right:12px;background:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;z-index:1}
      .maru-country-video-section{margin-top:20px;padding-top:14px;border-top:1px solid #ddd}
      .maru-country-video-list{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
      .maru-country-video-card{border:1px solid #ccc;border-radius:12px;overflow:hidden;cursor:pointer;background:#fff}
      .maru-country-video-card img{width:100%;display:block}
      .maru-country-video-card h5{margin:8px;font-size:13px}
    `;
    document.head.appendChild(style);
  })();

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

  function openCountryDetail(countryName) {
    if (window.openMaruCountryDetail) {
      window.openMaruCountryDetail(countryName);
    }
    if (window.maruVoiceSpeak) {
      try { window.maruVoiceSpeak(`${countryName}에 대한 상세 브리핑을 시작합니다.`); } catch (_) {}
    }
  }

  // VIDEO injection
  let countryVideos = [];
  let activeVideoIndex = null;

  window.injectMaruCountryVideos = function(payload){
    if (!payload || !Array.isArray(payload.videos)) return;
    countryVideos = payload.videos.slice(0,4);
    activeVideoIndex = null;
    renderCountryVideoList();
  };

  function renderCountryVideoList(){
    const m = document.querySelector('.maru-country-modal');
    if (!m) return;

    let section = m.querySelector('.maru-country-video-section');
    if (!section) {
      section = document.createElement('div');
      section.className = 'maru-country-video-section';
      m.appendChild(section);
    }

    section.innerHTML = `<h4>관련 영상 자료</h4><div class="maru-country-video-list"></div>`;
    const list = section.querySelector('.maru-country-video-list');

    countryVideos.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'maru-country-video-card';
      card.innerHTML = `<img src="${v.thumbnail || ''}" alt=""><h5>${String.fromCharCode(65+i)}. ${v.title || ''}</h5>`;
      card.onclick = () => openCountryVideo(i);
      list.appendChild(card);
    });
  }

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

    if ((v.src || '').includes('youtube') || (v.src || '').includes('iframe')) {
      player.innerHTML += `<iframe src="${v.src}" frameborder="0" allowfullscreen></iframe>`;
    } else {
      player.innerHTML += `<video src="${v.src}" controls autoplay></video>`;
    }

    overlay.appendChild(player);
    document.body.appendChild(overlay);
  }

  // Country voice hub (internal enabled)
  window.MaruCountryVoice = (function () {
    let enabled = false;

    function enable() { enabled = true; }
    function disable() { enabled = false; }
    function toggle() { enabled = !enabled; }
    function isEnabled() { return enabled; }

    function readCountry(countryKey) {
      if (!enabled) return null;
      if (typeof openCountryDetail === 'function') openCountryDetail(countryKey);

      const e = document.querySelector(`.maru-country-card[data-country="${countryKey}"] .maru-country-brief`);
      return e ? e.textContent.trim() : null;
    }

    function readExpanded() {
      if (!enabled || !window.expandedCountry) return null;
      const e = document.querySelector(`.maru-country-card[data-country="${window.expandedCountry}"] .maru-country-brief`);
      return e ? e.textContent.trim() : null;
    }

    function readCriticalIssue() {
      if (!enabled) return null;
      const e = document.querySelector('.maru-country-issuebar .text');
      const text = e ? e.textContent.trim() : '';
      return text || '현재 유의미한 분석 자료가 준비되지 않았습니다.';
    }

    function requestDetail(countryKey) { return { type: 'country-detail', country: countryKey }; }
    function requestVideo(countryKey, topic = null) { return { type: 'country-video', country: countryKey, topic }; }
    function requestTopic(countryKey, topic, depth = 'summary') { return { type: 'country-topic', country: countryKey, topic, depth }; }

    return {
      enable, disable, toggle, isEnabled,
      readCountry, readExpanded, readCriticalIssue,
      requestDetail, requestVideo, requestTopic
    };
  })();

  // Critical overlay (uses MaruAddon snapshot if present)
  let countryDetailOverlay = null;

  function openCountryCriticalOverlay(countryName) {
    if (countryDetailOverlay) countryDetailOverlay.remove();

    const crit =
      window.MaruAddon &&
      window.MaruAddon.snapshot &&
      window.MaruAddon.snapshot.view &&
      window.MaruAddon.snapshot.view.critical &&
      window.MaruAddon.snapshot.view.critical.countries &&
      window.MaruAddon.snapshot.view.critical.countries[countryName];

    const text = crit
      ? (crit.detail || crit.summary || '상세 이슈 정보가 없습니다.')
      : '현재 해당 국가에 대한 중요 이슈 데이터가 없습니다.';

    countryDetailOverlay = document.createElement('div');
    countryDetailOverlay.className = 'maru-country-detail';
    countryDetailOverlay.innerHTML = `
      <button class="maru-country-detail-close">닫기</button>
      <h2>${countryName} — 중요 이슈 상세</h2>
      <p>${text}</p>
    `;

    countryDetailOverlay.querySelector('.maru-country-detail-close').onclick = () => countryDetailOverlay.remove();
    countryDetailOverlay.addEventListener('click', e => {
      if (e.target === countryDetailOverlay) countryDetailOverlay.remove();
    });

    document.body.appendChild(countryDetailOverlay);
  }

  async function open(regionId) {
    // Reopen safe guard
    if (modal && document.body.contains(modal)) return;
    if (modal && !document.body.contains(modal)) modal = null;

    activeRegionId = regionId;
    activeCountryName = null;

    backdrop = el('div', 'maru-country-backdrop');
    backdrop.onclick = closeModal;

    modal = el('div', 'maru-country-modal');

    const header = el('div', 'maru-country-header');
    const title = el('strong', null, `🌐 MARU GLOBAL INSIGHT — 국가 분석 (${regionId})`);
    const issueBar = el('div', 'maru-country-issuebar', '<span class="text">국가별 중요 이슈 요약 대기 중…</span>');

    const voiceToggle = el('label', 'maru-country-voice-toggle');
    voiceToggle.innerHTML = `<input type="checkbox" id="maruCountryVoiceToggle" /><span>음성</span>`;
    const countryVoiceCheckbox = voiceToggle.querySelector('#maruCountryVoiceToggle');

    const closeBtn = el('button', 'maru-country-close', '닫기');
    closeBtn.id = 'maruCountryClose';

    header.appendChild(title);
    header.appendChild(issueBar);
    header.appendChild(voiceToggle);
    header.appendChild(closeBtn);

    issueBar.style.cursor = 'pointer';
    issueBar.addEventListener('click', () => {
      if (!activeCountryName) return;

      if (window.MaruAddon && typeof window.MaruAddon.criticalDetail === 'function') {
        window.MaruAddon.criticalDetail('country', activeCountryName);
      }
      openCountryCriticalOverlay(activeCountryName);
    });

    const body = el('div', 'maru-country-body', '<p>국가별 글로벌 인사이트 수집 중…</p>');

    modal.appendChild(header);

    const inputBar = document.createElement('div');
    inputBar.className = 'maru-input-bar hidden';
    inputBar.innerHTML = `<input type="text" class="maru-input-text" placeholder="질문을 입력하세요… (Enter)" />`;
    modal.appendChild(inputBar);

    modal.appendChild(body);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    window.MARU_COUNTRY_VOICE_READY = true;

    document.getElementById('maruCountryClose').onclick = closeModal;

    // Inherit Region voice ON
    if (window.MARU_AUTO_VOICE_ON === true) {
      countryVoiceCheckbox.checked = true;
      window.MaruCountryVoice?.enable?.();
      if (typeof window.startMaruMic === 'function') {
        try { window.startMaruMic(); } catch (_) {}
      }
    }

    countryVoiceCheckbox.addEventListener('change', () => {
      const enabled = countryVoiceCheckbox.checked;

      if (enabled) {
        window.MaruCountryVoice?.enable?.();
        if (typeof window.startMaruMic === 'function') window.startMaruMic();
      } else {
        window.MaruCountryVoice?.disable?.();
        if (typeof window.stopMaruMic === 'function') window.stopMaruMic();
      }
    });

    const apiData = await fetchCountryInsight(regionId);
    const countries = REGION_COUNTRY_MAP[regionId] || [];
    const countryData = apiData?.countries || {};

    body.innerHTML = countries.map(c => renderCountryCard(c, countryData[c])).join('');

    document.querySelectorAll('.maru-country-card').forEach(card => {
      card.addEventListener('click', () => {
        activeCountryName = card.dataset.country;
        openCountryDetail(activeCountryName);
      });
    });

    // expose overlay opener (compat)
    window.openCountryCriticalOverlay = openCountryCriticalOverlay;

    // keep ready flag
    window.MARU_COUNTRY_VOICE_READY = true;
  }

  window.openMaruGlobalCountryModal = open;

})();
