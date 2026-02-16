/* =========================================================
 * MARU Site Control Addon — FIXED (v7.0)
 * ---------------------------------------------------------
 * Goals (per 운영 규칙):
 * 1) Addon is the ONLY owner of voice + conversation routing.
 * 2) Voice toggle is SINGLE state, mirrored across Region/Country.
 * 3) Region/Country modal open/close MUST NOT auto-disable voice.
 * 4) Extension Window (확장창) is DEFAULT OPEN:
 *    - Opens on Voice ON, Voice/Text input, and after engine response.
 *    - It may be temporarily hidden ONLY when Region/Country dashboard has data.
 * 5) Minimal regressions: keep existing global buttons (AI 글로벌 인사이트 / 실시간 이슈) working.
 * ========================================================= */

(function () {
  'use strict';

  // ---------- Idempotent hard replace ----------
  try { if (window.MaruAddon && window.MaruAddon.__MARU_ADDON_VER__) { /* allow overwrite */ } } catch(_) {}

  // ---------- STATE ----------
  let VOICE_ENABLED = false;          // single source of truth
  let MEDIA_PLAYING = false;          // block TTS when media playing
  let INPUT_MODE = 'realtime';        // 'realtime' | 'confirm' (kept for compatibility)
  const ENGINE_DEBOUNCE_DELAY = 250;
  let ENGINE_DEBOUNCE_TIMER = null;

  const STATE = {
    lastRequest: null,
    lastResponse: null,
    commandHistory: []
  };

  // ---------- UTIL ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function safe(fn){ try { fn && fn(); } catch(_){} }

  function normalizeContext(ctx){
    if (!ctx || typeof ctx !== 'object') return null;
    if (!ctx.level) return null;
    return { level: ctx.level, id: (ctx.id != null ? ctx.id : null) };
  }
  function getBestContext(){
    const g = normalizeContext(window.__MARU_CONTEXT__);
    if (g) return g;
    if (window.activeCountryName) return { level:'country', id: window.activeCountryName };
    if (window.activeRegionId) return { level:'region', id: window.activeRegionId };
    return { level:'global', id: null };
  }

  // ---------- EXTENSION WINDOW (DEFAULT OPEN) ----------
  const EXT = {
    backdrop: null,
    modal: null,
    body: null,
    title: null,
    visible: false,
    lockUntil: 0,
    lockReason: ''
  };

  function injectExtensionStyle(){
    if (document.getElementById('maru-ext-style')) return;
    const st = document.createElement('style');
    st.id = 'maru-ext-style';
    st.textContent = `
      .maru-ext-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:900000;display:none}
      .maru-ext-modal{
        position:fixed;
        /* geometry is set by JS (dock-based) */
        background:#ffffff;
        border-radius:22px;
        box-shadow:0 40px 90px rgba(0,0,0,.45);
        z-index:900001;
        display:flex; flex-direction:column;
        overflow:hidden;
      }
      .maru-ext-header{
        display:flex; align-items:center; gap:10px;
        padding:14px 18px;
        border-bottom:1px solid #eee;
      }
      .maru-ext-header strong{font-size:16px;color:#1f3a5f;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .maru-ext-close{border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}
      .maru-ext-body{flex:1;overflow:auto;padding:16px 18px;font-size:14px;line-height:1.7;color:#000;white-space:pre-wrap}
      .maru-ext-hidden{display:none !important}
      .maru-ext-msg{margin:0 0 10px}
      .maru-ext-msg .role{font-weight:700;margin-right:6px;color:#1f3a5f}
      .maru-ext-msg.user .role{color:#6b3a1f}
      .maru-ext-sep{height:1px;background:#f0f0f0;margin:12px 0}

      /* Voice toggle ON indicator (country) */
      .maru-country-voice-toggle.voice-live{
        box-shadow:0 0 0 2px #22c55e inset;
      }
      .maru-country-voice-toggle.voice-live::after{
        content:'';
        width:8px;height:8px;border-radius:50%;
        background:#22c55e;
        display:inline-block;
        margin-left:6px;
        vertical-align:middle;
      }

`;
    document.head.appendChild(st);
  }

  function ensureExtension(){
    injectExtensionStyle();

    // ===== SINGLETON GUARANTEE =====
    // Reuse existing nodes if they already exist in DOM (prevents duplicate windows)
    const existingBackdrop = document.getElementById('maru-ext-backdrop');
    const existingModal = document.getElementById('maru-ext-modal');

    if (existingBackdrop && existingModal) {
      EXT.backdrop = existingBackdrop;
      EXT.modal = existingModal;
      EXT.body = existingModal.querySelector('.maru-ext-body') || null;
      EXT.title = existingModal.querySelector('.maru-ext-header strong') || null;
      applyExtensionSize();
      return;
    }

    // If old nodes exist partially, remove them to avoid duplicates
    try { document.querySelectorAll('#maru-ext-backdrop, #maru-ext-modal, .maru-ext-backdrop, .maru-ext-modal').forEach(n => n.remove()); } catch(_){}

    EXT.backdrop = document.createElement('div');
    EXT.backdrop.id = 'maru-ext-backdrop';
    EXT.backdrop.className = 'maru-ext-backdrop';

    EXT.modal = document.createElement('div');
    EXT.modal.id = 'maru-ext-modal';
    EXT.modal.className = 'maru-ext-modal';

    const header = document.createElement('div');
    header.className = 'maru-ext-header';

    EXT.title = document.createElement('strong');
    EXT.title.textContent = 'MARU 확장창';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'maru-ext-close';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', function(e){
      e.preventDefault();
      // Close = destroy (so it won't spawn another window while open; will recreate only if absent)
      destroyExtension(true);
    });

    header.appendChild(EXT.title);
    header.appendChild(closeBtn);

    EXT.body = document.createElement('div');
    EXT.body.className = 'maru-ext-body';
    EXT.body.textContent = '';

    EXT.modal.appendChild(header);
    EXT.modal.appendChild(EXT.body);

    document.body.appendChild(EXT.backdrop);
    document.body.appendChild(EXT.modal);

    // click backdrop -> no-op (do not close automatically)
    EXT.backdrop.addEventListener('click', function(){ /* no-op */ });
  }

  // ---------- EXTENSION SIZE (DOCK-BASED, FORCE) ----------
  function applyExtensionSize(){
    // Ensure nodes exist
    const modal = document.getElementById('maru-ext-modal') || EXT.modal;
    const dock = document.getElementById('maru-conversation-dock');
    if(!modal || !dock) return;

    const d = dock.getBoundingClientRect();
    const m = Math.round(d.height); // unit = dock height

    // Spec: shrink all four sides by dock height
    modal.style.setProperty('left', (m * 1.8) + 'px', 'important');
    modal.style.setProperty('right', (m * 2.5) + 'px', 'important');
    modal.style.setProperty('top', (m * 2) + 'px', 'important');
    // bottom should leave dock + extra dock-height gap (dock itself + 1 more dock height)
    modal.style.setProperty('bottom', (m * 2.2) + 'px', 'important');

    // Keep within viewport
    modal.style.setProperty('max-height', 'calc(100vh - ' + (m * 3) + 'px)', 'important');
  }

function showExtension(){
    ensureExtension();
    applyExtensionSize();
    EXT.backdrop.style.display = 'block';
    EXT.modal.classList.remove('maru-ext-hidden');
    EXT.visible = true;
  }

  function hideExtension(userInitiated){
    // Hide only (keeps singleton instance)
    if (!EXT.modal) return;
    EXT.backdrop.style.display = 'none';
    EXT.modal.classList.add('maru-ext-hidden');
    EXT.visible = false;
    if (userInitiated) {
      // User intent wins: clear lock so future auto-open works cleanly
      EXT.lockUntil = 0;
      EXT.lockReason = '';
    }
  }

  function destroyExtension(userInitiated){
    // Destroy nodes (no instance). Next showExtension() will recreate.
    if (userInitiated) {
      EXT.lockUntil = 0;
      EXT.lockReason = '';
    }
    try { EXT.backdrop && EXT.backdrop.remove(); } catch(_){}
    try { EXT.modal && EXT.modal.remove(); } catch(_){}
    EXT.backdrop = null;
    EXT.modal = null;
    EXT.body = null;
    EXT.title = null;
    EXT.visible = false;
    if (userInitiated) { /* keep silent */ }
  }

  function clearExtension(){
    ensureExtension();
    EXT.body.textContent = '';
  }

  function appendExt(role, text){
    if (!text) return;
    ensureExtension();
    const wrap = document.createElement('div');
    wrap.className = 'maru-ext-msg ' + (role === 'user' ? 'user' : 'assistant');
    const r = document.createElement('span');
    r.className = 'role';
    r.textContent = (role === 'user') ? 'USER:' : 'MARU:';
    const t = document.createElement('span');
    t.className = 'text';
    t.textContent = String(text);
    wrap.appendChild(r);
    wrap.appendChild(t);
    EXT.body.appendChild(wrap);
    EXT.body.scrollTop = EXT.body.scrollHeight;
  }

  // Hide extension only when dashboard has meaningful data
  function isPlaceholderText(t){
    if (!t) return true;
    const s = String(t).trim();
    if (!s) return true;

    // common placeholders (KR/EN)
    return (
      /(분석\s*중|준비\s*중|불러오는\s*중|데이터가\s*없|없습니다|없음|로딩\s*중|loading|n\/?a|not\s*available|coming\s*soon|tbd|\.{2,}|^-+$)/i
        .test(s)
    );
  }

  function dashboardHasData(){
    // If a region modal is open and at least one region card has non-placeholder summary => data exists
    const rModal = $('.maru-region-modal');
    if (rModal) {
      const briefs = $$('.maru-region-brief', rModal);
      for (const b of briefs) {
        const tx = (b.textContent || '').trim();
        if (tx && !isPlaceholderText(tx)) return true;
      }
      return false;
    }

    const cModal = $('.maru-country-modal');
    if (cModal) {
      const briefs = $$('.maru-country-brief', cModal);
      for (const b of briefs) {
        const tx = (b.textContent || '').trim();
        if (tx && !isPlaceholderText(tx)) return true;
      }
      return false;
    }

    return false;
  }

  
  // ---------- OVERLAP / DATA CHECK (Region/Country Board) ----------
  function getOpenModalKind(){
    const hasCountry = !!document.querySelector('.maru-country-modal.open');
    const hasRegion  = !!document.querySelector('.maru-region-modal.open');
    if (hasCountry) return 'country';
    if (hasRegion) return 'region';
    return null;
  }

  function getCountryItemsFromDom(){
    const cards = $$('.maru-country-card[data-country]');
    const set = new Set();
    cards.forEach(c => {
      const raw = String(c.getAttribute('data-country') || '').trim();
      if (!raw) return;
      set.add(raw);
      const k = raw.split('(')[0].trim();
      if (k) set.add(k);
    });
    return set;
  }

  function getRegionItemsFromDom(){
    const cards = $$('.maru-region-card[data-region]');
    const set = new Set();
    cards.forEach(c => {
      const id = String(c.getAttribute('data-region') || '').trim();
      if (id) set.add(id);
    });
    // aliases
    [
      ['유럽','europe'], ['아시아','asia'], ['중동','middle_east'], ['아프리카','africa'],
      ['북미','north_america'], ['남미','south_america'], ['중남미','south_america'],
      ['유라시아','eurasia'], ['러시아','eurasia'], ['중앙아시아','eurasia']
    ].forEach(pair => { set.add(pair[0]); set.add(pair[1]); });
    return set;
  }

  function findMentionedCountry(text){
    const items = getCountryItemsFromDom();
    if (!items.size) return null;
    const q = String(text || '');
    for (const it of items) {
      if (!it || it.length < 2) continue;
      if (q.includes(it)) return it;
    }
    return null;
  }

  function findMentionedRegion(text){
    const q = String(text || '');
    const map = [
      ['유럽','europe'], ['아시아','asia'], ['중동','middle_east'], ['아프리카','africa'],
      ['북미','north_america'], ['남미','south_america'], ['중남미','south_america'],
      ['유라시아','eurasia'], ['러시아','eurasia'], ['중앙아시아','eurasia'],
      ['europe','europe'], ['asia','asia'], ['africa','africa'], ['middle east','middle_east'],
      ['north america','north_america'], ['south america','south_america'], ['eurasia','eurasia']
    ];
    for (const [k,id] of map) {
      if (q.toLowerCase().includes(String(k).toLowerCase())) return id;
    }
    return null;
  }

  function hasDataForCountry(countryKey){
    if (!countryKey) return false;
    const cards = $$('.maru-country-card[data-country]');
    for (const c of cards) {
      const raw = String(c.getAttribute('data-country') || '').trim();
      const k = raw.split('(')[0].trim();
      if (raw === countryKey || k === countryKey) {
        const brief = c.querySelector('.maru-country-brief');
        const tx = (brief && brief.textContent) ? String(brief.textContent).trim() : '';
        if (!tx) return false;
        if (isPlaceholderText(tx)) return false;
        return true;
      }
    }
    return false;
  }

  function hasDataForRegion(regionId){
    if (!regionId) return false;
    const card = document.querySelector('.maru-region-card[data-region="'+regionId+'"]');
    if (!card) return false;
    const brief = card.querySelector('.maru-region-brief');
    const tx = (brief && brief.textContent) ? String(brief.textContent).trim() : '';
    if (!tx) return false;
    if (isPlaceholderText(tx)) return false;
    return true;
  }

  // 확장창 오픈 여부 (정본)
  function shouldOpenExtension(req){
    const kind = getOpenModalKind();

    // When no modal is open, extension is the main conversation surface.
    if (!kind) return true;

    const intent = req && req.intent ? String(req.intent) : 'summary';
    const q = String(req && req.text ? req.text : '').trim();

    // Force extension for detail/research, realtime, and any media/audio/news clip requests.
    if (intent === 'expand' || intent === 'detail' || intent === 'realtime' || intent === 'media' || intent === 'audio') {
      return true;
    }

    if (kind === 'country') {
      const mentioned = findMentionedCountry(q);
      // No explicit country mention → 자유질문/비주제 → 확장창
      if (!mentioned) return true;
      // Mentioned but no card data → 확장창
      if (!hasDataForCountry(mentioned)) return true;
      // Mentioned + has data → 카드 읽기(확장창 불필요)
      return false;
    }

    if (kind === 'region') {
      const regionId = findMentionedRegion(q);
      // No explicit region mention → 자유질문/비주제 → 확장창
      if (!regionId) return true;
      // Mentioned but no card data → 확장창
      if (!hasDataForRegion(regionId)) return true;
      return false;
    }

    return true;
  }

function reconcileExtensionVisibility(){
    if (!EXT.modal) return;

    // If locked by routing decision, keep it on top.
    if (EXT.lockUntil && Date.now() < EXT.lockUntil) {
      showExtension();
      return;
    }

    // When dashboards have meaningful data, keep extension hidden unless user opens it manually.
    if (dashboardHasData()) {
      hideExtension(false);
      return;
    }

    // Default: do not auto-show. (Only show when routing decides to open.)
    // Keep current state.
  }


  // ---------- VOICE ----------
  function syncVoiceToggleUi(){
    const btns = $$('.maru-region-voice-toggle, .maru-country-voice-toggle');
    btns.forEach(btn => {
      btn.classList.toggle('on', VOICE_ENABLED);
      btn.classList.toggle('off', !VOICE_ENABLED);
            btn.classList.toggle('voice-live', VOICE_ENABLED); // 🔔 green indicator
// Keep existing label if present; else set
      const hasKorean = /음성/.test(btn.textContent || '');
      if (!hasKorean) {
        btn.textContent = VOICE_ENABLED ? '🎙 음성 ON' : '🎙 음성 OFF';
      } else {
        // normalize only if empty
        if (!btn.textContent.trim()) btn.textContent = VOICE_ENABLED ? '🎙 음성 ON' : '🎙 음성 OFF';
      }
      btn.style.opacity = VOICE_ENABLED ? '1' : '.45';
    });
    window.__MARU_VOICE_TOGGLE__ = VOICE_ENABLED;
  }

  function startMic(){
    safe(() => { if (typeof window.startMaruMic === 'function') window.startMaruMic(); });
  }
  function stopMic(){
    safe(() => { if (typeof window.stopMaruMic === 'function') window.stopMaruMic(); });
  }

  function setVoiceEnabled(on, reason){
    VOICE_ENABLED = !!on;

    if (VOICE_ENABLED) startMic();
    else stopMic();

    syncVoiceToggleUi();
    syncInputModeUi();   // ← 이 줄 딱 1줄 추가


    // 음성 ON이면 실시간 타이핑을 위해 Conversation Dock 표시
    try { window.MaruConversationDock?.show?.(); } catch(_) {}
  }

  function ttsSpeak(text){
    if (!text) return;
    if (!VOICE_ENABLED) return;
    if (MEDIA_PLAYING) return;
    if (typeof window.maruVoiceSpeak !== 'function') return;
    safe(() => window.maruVoiceSpeak(String(text)));
  }

// ==============================
// INPUT MODE (Realtime / Confirm) — RESTORED
// ==============================
/*
 * Installs "입력 표시: 실시간 / 확정" selector into Region/Country modals.
 * Layout rule (per 운영 요청):
 *   - 닫기 버튼 = 모달 우측 상단 (VOICE 토글 옆)
 *   - 입력 표시 토글 = 타이틀 아래 줄(상단 좌측)
 * Disabled when VOICE is OFF.
 */
function injectInputModeStyle(){
  if (document.getElementById('maru-inputmode-style')) return;
  const st = document.createElement('style');
  st.id = 'maru-inputmode-style';
  st.textContent = `
    .maru-header-controls{display:flex;align-items:center;gap:8px;margin-left:auto;white-space:nowrap}
    .maru-inputmode-row{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;padding:6px 18px 10px 18px}
  `;
  document.head.appendChild(st);
}

function ensureModalHeaderLayout(header, kind){
  if (!header) return null;
  injectInputModeStyle();

  const modal = header.closest(kind === 'country' ? '.maru-country-modal' : '.maru-region-modal');
  if (!modal) return null;

  // --- ensure top-right controls box inside header ---
  let controls = header.querySelector('.maru-header-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'maru-header-controls';
    header.appendChild(controls);
  }

  // move VOICE toggle into controls
  const vtSel = (kind === 'country') ? '.maru-country-voice-toggle' : '.maru-region-voice-toggle';
  const vt = modal.querySelector(vtSel) || header.querySelector(vtSel);
  if (vt && vt.parentNode !== controls) controls.appendChild(vt);

  // move CLOSE button into controls (top-right)
  const closeSel = (kind === 'country') ? '.maru-country-close' : '.maru-region-close';
  const closeBtn = modal.querySelector(closeSel) || header.querySelector(closeSel);
  if (closeBtn && closeBtn.parentNode !== controls) controls.appendChild(closeBtn);

  // --- ensure input-mode row right under header ---
  let row = modal.querySelector('[data-maru-inputmode-row]');
  if (!row) {
    row = document.createElement('div');
    row.className = 'maru-inputmode-row';
    row.setAttribute('data-maru-inputmode-row','1');
    // insert right after header
    if (header.nextSibling) modal.insertBefore(row, header.nextSibling);
    else modal.appendChild(row);
  } else {
    // keep it right after header
    if (row.previousSibling !== header) {
      try { modal.insertBefore(row, header.nextSibling); } catch(_){}
    }
  }

  return row;
}

function installInputModeSelector(){
  const rh = document.querySelector('.maru-region-header');
  const ch = document.querySelector('.maru-country-header');

  [
    { h: rh, kind: 'region', radioName: 'maru-inputmode-region' },
    { h: ch, kind: 'country', radioName: 'maru-inputmode-country' }
  ].forEach(cfg => {
    const h = cfg.h;
    if (!h) return;

    const row = ensureModalHeaderLayout(h, cfg.kind);
    if (!row) return;

    // Use the row itself as the singleton mount
    if (row.getAttribute('data-maru-inputmode') === '1') return;
    row.setAttribute('data-maru-inputmode','1');

    const label = document.createElement('span');
    label.textContent = '입력 표시:';
    label.style.cssText = 'color:#6e5a32;font-weight:600;';

    const opt1 = document.createElement('label');
    opt1.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
    const r1 = document.createElement('input');
    r1.type = 'radio'; r1.name = cfg.radioName; r1.value = 'realtime';
    const t1 = document.createElement('span'); t1.textContent = '실시간';

    const opt2 = document.createElement('label');
    opt2.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
    const r2 = document.createElement('input');
    r2.type = 'radio'; r2.name = cfg.radioName; r2.value = 'confirm';
    const t2 = document.createElement('span'); t2.textContent = '확정';

    opt1.appendChild(r1); opt1.appendChild(t1);
    opt2.appendChild(r2); opt2.appendChild(t2);

    row.innerHTML = '';
    row.appendChild(label);
    row.appendChild(opt1);
    row.appendChild(opt2);

    function syncRadios(){
      r1.checked = (INPUT_MODE === 'realtime');
      r2.checked = (INPUT_MODE === 'confirm');
      r1.disabled = !VOICE_ENABLED;
      r2.disabled = !VOICE_ENABLED;
      row.style.opacity = VOICE_ENABLED ? '1' : '.45';

      if (VOICE_ENABLED && INPUT_MODE === 'realtime') { t1.style.fontWeight='800'; t1.style.color='#1f3a5f'; }
      else { t1.style.fontWeight='600'; t1.style.color=''; }

      if (VOICE_ENABLED && INPUT_MODE === 'confirm') { t2.style.fontWeight='800'; t2.style.color='#1f3a5f'; }
      else { t2.style.fontWeight='600'; t2.style.color=''; }
    }

    r1.addEventListener('change', function(){ if (r1.checked) setInputMode('realtime'); });
    r2.addEventListener('change', function(){ if (r2.checked) setInputMode('confirm'); });

    syncRadios();
    row.__syncRadios = syncRadios;
  });
}

function syncInputModeUi(){
  const blocks = Array.prototype.slice.call(document.querySelectorAll('[data-maru-inputmode-row]'));
  blocks.forEach(b => { try { b.__syncRadios && b.__syncRadios(); } catch(_){} });
}

function setInputMode(mode){
  INPUT_MODE = (mode === 'confirm') ? 'confirm' : 'realtime';
  syncInputModeUi();
}


// ---------- ENGINE ----------
  function detectIntent(text){
    const t = String(text || '').trim();

    // Media intent (video/audio/news clip) → handled via extension + engine routing
    if (/(뉴스\s*클립|클립|영상|동영상|비디오|video|clip)/i.test(t)) return 'media';
    if (/(오디오|음성\s*파일|나레이션|낭독|audio|narration|tts)/i.test(t)) return 'audio';

    // Detail / research intent → force extension
    if (/(자세|상세|구체|심층|디테일|더\s*자세|리서치|조사|분석|근거|통계|전망|추세|보고서|리포트|출처|비교)/.test(t)) return 'expand';

    // Realtime issues
    if (/(실시간|이슈|속보|브리핑)/.test(t)) return 'realtime';

    return 'summary';
  }

  function normalizeRequest(input, text, context){
    const ctx = normalizeContext(context) || getBestContext();

    let scope = 'global';
    let target = null;
    if (ctx.level === 'region') { scope = 'region'; target = ctx.id || null; }
    else if (ctx.level === 'country') { scope = 'country'; target = ctx.id || null; }

    return {
      source: 'user',
      input,
      text,
      scope,
      target,
      intent: detectIntent(text),
      voiceWanted: (input === 'voice')
    };
  }

function callInsightEngine(req){
  if (window.MaruGlobalInsight && typeof window.MaruGlobalInsight.dispatch === 'function') {
    return window.MaruGlobalInsight.dispatch({
      q: req.text,
      scope: req.scope,
      target: req.target,
      intent: req.intent,
      source: 'addon'
    });
  }

  return Promise.reject(new Error('MaruGlobalInsight not available'));
}


  function dispatch(req){
	  
    // === [PATCH v10] FIRST TURN EXTENSION PRE-OPEN ===
    if (shouldOpenExtension(req)) {
        EXT.lockUntil = Date.now() + 3600 * 1000;
        EXT.lockReason = 'pre-open';
        showExtension();
    }
    STATE.lastRequest = req;
    STATE.commandHistory.push({ role:'user', text: req.text });

    if (ENGINE_DEBOUNCE_TIMER) clearTimeout(ENGINE_DEBOUNCE_TIMER);
    ENGINE_DEBOUNCE_TIMER = setTimeout(() => {
      callInsightEngine(req)
        .then(raw => {
          const res = normalizeEngineResponse(raw);
          STATE.lastResponse = res;
          STATE.commandHistory.push({ role:'assistant', text: res.text || '' });
          routeResponse(req, res);
        })
        .catch(err => {
          appendExt('assistant', '엔진 호출 실패');
          ttsSpeak('엔진 호출 실패');
          console.error('[MaruAddon] engine error', err);
        });
    }, ENGINE_DEBOUNCE_DELAY);
  }

  function normalizeEngineResponse(raw){
    const d = (raw && raw.data && typeof raw.data === 'object') ? raw.data : {};
    return {
      ok: raw && (raw.ok === true || raw.status === 'ok' || raw.status === 'OK'),
      text: raw?.text ?? raw?.summary ?? raw?.message ?? '',
      mode: raw?.mode ?? raw?.depth ?? 'summary',
      data: {
        ...d,
        issues: d?.issues ?? null,
        videos: Array.isArray(d?.videos) ? d.videos : []
      },
      raw
    };
  }

  function routeResponse(req, res){
    const headline = res.text || '준비된 자료가 없습니다.';

    // 확장창 오픈 여부 판단 (정본)
    // - 질문은 Conversation Dock에만 존재 (확장창에 USER 질문 표시 금지)
    // - 확장창은 Region/Country 게시판에 "겹치지 않거나", "데이터 없음", "상세(2차) 요청"일 때만 오픈
    const openExt = shouldOpenExtension(req);

    if (openExt) {
      // Lock extension open until user closes it (prevents auto-hide on first turn)
      try {
        EXT.lockUntil = Date.now() + 3600 * 1000; // 1h safety lock
        EXT.lockReason = 'auto-open';
      } catch(_) {}
      showExtension();
      appendExt('assistant', headline);
    }


    // Distribute to dashboards if available (non-blocking)
    if (req.scope === 'global') {
      safe(() => {
        if (typeof window.renderSummary === 'function') window.renderSummary(headline);
      });
      safe(() => {
        if (typeof window.injectMaruGlobalRegionData === 'function') {
          window.injectMaruGlobalRegionData(res.data?.regions || res.data || []);
        }
      });
      safe(() => {
        if (typeof window.injectMaruGlobalCountryData === 'function') {
          window.injectMaruGlobalCountryData(res.data?.countries || res.data || []);
        }
      });
    }

    if (req.scope === 'region') {
      safe(() => {
        if (typeof window.injectRegionContextResult === 'function') {
          window.injectRegionContextResult(req.target, {
            summary: headline,
            issues: res.data?.issues || null,
            raw: res
          });
        }
      });
    }

    if (req.scope === 'country') {
      safe(() => {
        if (typeof window.injectCountryContextResult === 'function') {
          window.injectCountryContextResult(req.target, {
            summary: headline,
            issues: res.data?.issues || null,
            videos: res.data?.videos || null,
            raw: res
          });
        }
      });

      // Videos injection if present
      if (Array.isArray(res.data?.videos) && typeof window.injectMaruCountryVideos === 'function') {
        safe(() => window.injectMaruCountryVideos({ country: req.target, videos: res.data.videos }));
      }
    }

    // Speak (primary)
    if (VOICE_ENABLED) {
      ttsSpeak(headline);
    }

    // After distributing, decide whether to temporarily hide extension
  }

  // ---------- PUBLIC API ----------
  const MaruAddon = {
    __MARU_ADDON_VER__: 'v8.0-final',
    // buttons
    bootstrapGlobalInsight: function(){
      dispatch({
        source:'panel',
        input:'system',
        text:'글로벌 인사이트 전체 수집',
        scope:'global',
        target:null,
        intent:'summary',
        voiceWanted: VOICE_ENABLED
      });
    },
    requestInsight: function(){
      dispatch({
        source:'panel',
        input:'system',
        text:'실시간 글로벌 이슈',
        scope:'global',
        target:null,
        intent:'realtime',
        voiceWanted: VOICE_ENABLED
      });
    },

    // voice/text inbound
    previewVoice: function(text, context){
      // interim STT typing → 항상 Conversation Dock 입력창에만 반영
      if (!text) return;

      try {
        if (window.MaruConversationDock && typeof window.MaruConversationDock.show === 'function') {
          window.MaruConversationDock.show();
        }
        if (window.MaruConversationDock && typeof window.MaruConversationDock.setText === 'function') {
          window.MaruConversationDock.setText(String(text));
        }
      } catch (_) {}
    },
    handleTextQuery: function(payload, context){
      const text = (typeof payload === 'string') ? payload : (payload && payload.text) || '';
      const ctx = (payload && payload.context) || context || null;
      const raw = String(text || '').trim();
      if (!raw) return;

      // 질문은 항상 Conversation Dock 입력창에서만 처리
      try {
        if (window.MaruConversationDock && typeof window.MaruConversationDock.show === 'function') window.MaruConversationDock.show();
        if (window.MaruConversationDock && typeof window.MaruConversationDock.setText === 'function') window.MaruConversationDock.setText(raw);
      } catch (_) {}

      const req = normalizeRequest('text', raw, ctx);
      dispatch(req);
    },
    handleVoiceQuery: function(payload, context){
      const text = (typeof payload === 'string') ? payload : (payload && payload.text) || '';
      const ctx = (payload && payload.context) || context || null;
      const raw = String(text || '').trim();
      if (!raw) return;

      // 질문은 항상 Conversation Dock 입력창에서만 처리
      try {
        if (window.MaruConversationDock && typeof window.MaruConversationDock.show === 'function') window.MaruConversationDock.show();
        if (window.MaruConversationDock && typeof window.MaruConversationDock.setText === 'function') window.MaruConversationDock.setText(raw);
      } catch (_) {}

      if (INPUT_MODE === 'confirm') return;

      const req = normalizeRequest('voice', raw, ctx);
      dispatch(req);
    },

    // voice control
    setVoiceEnabled: function(on){ setVoiceEnabled(!!on, 'api'); },
    isVoiceEnabled: function(){ return VOICE_ENABLED; },

    // media control
    setMediaState: function(kind, on){
      if (kind === 'video' || kind === 'music' || kind === 'narration') {
        MEDIA_PLAYING = !!on;
      }
    },
    setMediaPlaying: function(on){ MEDIA_PLAYING = !!on; },

    // input mode (compat)
    setInputDisplayMode: setInputMode,
    getInputDisplayMode: function(){ return INPUT_MODE; }
  };

  window.MaruAddon = MaruAddon;

  // ---------- UI BINDINGS ----------
  function bindGlobalButtons(){
    // Keep existing button ids or label-based search
    const runBtn = document.getElementById('btnMaruGlobalInsight') ||
      $$('button').find(b => (b.textContent || '').includes('AI 글로벌 인사이트'));
    if (runBtn && !runBtn.dataset.maruBound) {
      runBtn.dataset.maruBound = '1';
      runBtn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        MaruAddon.bootstrapGlobalInsight();
      }, true);
    }

    const issueBtn = document.getElementById('btnMaruRealtimeIssue') ||
      $$('button').find(b => (b.textContent || '').includes('실시간') && (b.textContent || '').includes('이슈'));
    if (issueBtn && !issueBtn.dataset.maruBound) {
      issueBtn.dataset.maruBound = '1';
      issueBtn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        MaruAddon.requestInsight();
      }, true);
    }
  }

  // Single delegated toggle handler (Region + Country)
  document.addEventListener('click', function(e){
    const t = e.target;
    if (!t) return;
    const btn = t.closest && t.closest('.maru-region-voice-toggle, .maru-country-voice-toggle');
    if (!btn) return;
    e.preventDefault();
    setVoiceEnabled(!VOICE_ENABLED, 'ui');
  }, true);

  // DO NOT auto-disable voice on modal close/open; only reconcile extension visibility
  document.addEventListener('click', function(e){
    const t = e.target;
    if (!t) return;

    const isClose = t.closest && t.closest('.maru-region-close, .maru-country-close');
    const isBackdrop = t.classList && (t.classList.contains('maru-region-backdrop') || t.classList.contains('maru-country-backdrop'));

  if (isClose || isBackdrop) {

  // === 전체 상태 초기화 ===
  setVoiceEnabled(false, 'modal-close');

  // 확장창 상태 재정렬
  setTimeout(reconcileExtensionVisibility, 50);

}
}, true);

  // Keep extension visible by default when modals are not showing data
    const obs = new MutationObserver(function(){
    bindGlobalButtons();
    syncVoiceToggleUi();

    installInputModeSelector(); // ← 추가 ① (모달 DOM 생기면 토글 붙이기)
    syncInputModeUi();          // ← 추가 ② (상태 즉시 반영)
});

  obs.observe(document.body, { childList:true, subtree:true });

  // Init
  bindGlobalButtons();
  syncVoiceToggleUi();
  try { installInputModeSelector(); syncInputModeUi(); } catch(_) {}
  // sizing init
  setTimeout(applyExtensionSize, 0);
  window.addEventListener('resize', applyExtensionSize);
  // NOTE: 확장창은 조건 충족 시에만 오픈 (기본 자동 오픈 금지)

})();
