// /assets/js/igdc-site-control.js
// IGTC / IGDC 사이트 관리 창 (우측 패널) 실전 버전

(function(){
  const container = document.getElementById('igdc-site-control');
  if(!container) return;

  const FRONT_PATHS = [
    'home.html',
    'distributionhub.html',
    'socialnetwork.html',
    'mediahub.html',
    'tour.html',
    'literature_academic.html',
    'donation.html',
    'admin.html'
  ];

  const API_PATHS = [
    '/api/status',
    '/api/wallets',
    '/api/metrics',
    '/api/selfcheck'
  ];

  const lastReport = {
    ts: null,
    front: [],
    api: [],
    env: { groups: [], summary: null, notes: [] },
    device: null
  };

  function el(tag, className, text){
    const $e = document.createElement(tag);
    if(className) $e.className = className;
    if(text != null) $e.textContent = text;
    return $e;
  }

  function openModal(title, htmlContent){
    const backdrop = el('div', 'igdc-sc-modal-backdrop');
    const modal = el('div', 'igdc-sc-modal');

    const header = el('div', 'igdc-sc-modal-header');
    const hTitle = el('div', 'igdc-sc-modal-title', title);
    const btnClose = el('button', 'igdc-sc-modal-close', '✕');
    btnClose.addEventListener('click', close);
    header.appendChild(hTitle);
    header.appendChild(btnClose);

    const body = el('div', 'igdc-sc-modal-body');
    body.innerHTML = htmlContent;

    const footer = el('div', 'igdc-sc-modal-footer');
    const btnPrint = el('button', '', '이 화면 인쇄');
    btnPrint.addEventListener('click', function(){
      printHtml('<h3>'+escapeHtml(title)+'</h3>'+body.innerHTML);
    });
    const btnClose2 = el('button', '', '닫기');
    btnClose2.addEventListener('click', close);
    footer.appendChild(btnPrint);
    footer.appendChild(btnClose2);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    function close(){
      if(backdrop && backdrop.parentNode){
        backdrop.parentNode.removeChild(backdrop);
      }
    }
  }

  function printHtml(html){
    const w = window.open('', 'IGDC_SITE_REPORT');
    if(!w) return;
    w.document.write('<html><head><title>IGDC Report</title></head><body>'+html+'</body></html>');
    w.document.close();
    w.focus();
    w.print();
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, function(s){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s]) || s;
    });
  }

  function getDeviceInfo(){
    const ua = navigator.userAgent || '';
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    let type = 'desktop';
    if(width <= 900) type = 'mobile';
    else if(width <= 1200) type = 'tablet';

    let os = 'unknown';
    if(/Android/i.test(ua)) os = 'Android';
    else if(/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if(/Windows/i.test(ua)) os = 'Windows';
    else if(/Mac OS X/i.test(ua)) os = 'macOS';

    let browser = 'unknown';
    if(/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
    else if(/Edg\//i.test(ua)) browser = 'Edge';
    else if(/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
    else if(/Firefox\//i.test(ua)) browser = 'Firefox';

    return {
      type,
      os,
      browser,
      width,
      height,
      dpr: window.devicePixelRatio || 1
    };
  }

  async function checkFront(){
    const results = [];
    for(const path of FRONT_PATHS){
      const started = Date.now();
      try{
        const res = await fetch(path, { method:'HEAD' });
        const ms = Date.now() - started;
        let status = 'warn';
        let note = '';
        if(res.ok){
          status = 'ok';
        }else{
          status = 'error';
          note = 'HTTP '+res.status;
        }
        results.push({ path, status, note, ms });
      }catch(e){
        results.push({ path, status:'error', note:(e.name||'ERR'), ms: Date.now()-started });
      }
    }
    return results;
  }

  async function checkApi(){
    const results = [];
    for(const path of API_PATHS){
      const started = Date.now();
      try{
        const res = await fetch(path, { method:'GET' });
        const ms = Date.now() - started;
        let status = 'warn';
        let note = '';
        if(res.ok){
          status = 'ok';
        }else{
          status = 'error';
          note = 'HTTP '+res.status;
        }
        results.push({ path, status, note, ms });
      }catch(e){
        results.push({ path, status:'error', note:(e.name||'ERR'), ms: Date.now()-started });
      }
    }
    return results;
  }

  async function checkEnv(){
    try{
      const res = await fetch('/api/selfcheck', { method:'GET' });
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      return {
        groups: data.groups || [],
        summary: data.summary || null,
        notes: data.notes || []
      };
    }catch(e){
      return {
        groups: [{
          id:'env',
          label:'ENV / selfcheck',
          status:'error',
          missing:[],
          present:[],
          error: e.message
        }],
        summary: null,
        notes: ['selfcheck 호출 실패: '+e.message]
      };
    }
  }

  function summarizeStatus(list){
    let ok=0, warn=0, error=0;
    list.forEach(r => {
      if(r.status === 'ok') ok++;
      else if(r.status === 'warn') warn++;
      else if(r.status === 'error') error++;
    });
    return { ok, warn, error };
  }

  function buildFrontSummaryHtml(front){
    if(!front || !front.length) return '<p>아직 프론트 헬스체크를 실행하지 않았습니다.</p>';
    const s = summarizeStatus(front);
    let html = '<p>총 '+front.length+'개 경로 · OK='+s.ok+', WARN='+s.warn+', ERROR='+s.error+'</p>';
    html += '<table border="1" cellspacing="0" cellpadding="3" style="border-collapse:collapse;font-size:11px;width:100%">';
    html += '<tr><th>경로</th><th>상태</th><th>응답(ms)</th><th>메모</th></tr>';
    front.forEach(r => {
      html += '<tr>' +
        '<td>'+escapeHtml(r.path)+'</td>' +
        '<td>'+escapeHtml(r.status.toUpperCase())+'</td>' +
        '<td>'+(r.ms||'-')+'</td>' +
        '<td>'+escapeHtml(r.note||'')+'</td>' +
      '</tr>';
    });
    html += '</table>';
    return html;
  }

  function buildApiSummaryHtml(api){
    if(!api || !api.length) return '<p>아직 API 헬스체크를 실행하지 않았습니다.</p>';
    const s = summarizeStatus(api);
    let html = '<p>총 '+api.length+'개 엔드포인트 · OK='+s.ok+', WARN='+s.warn+', ERROR='+s.error+'</p>';
    html += '<table border="1" cellspacing="0" cellpadding="3" style="border-collapse:collapse;font-size:11px;width:100%">';
    html += '<tr><th>엔드포인트</th><th>상태</th><th>응답(ms)</th><th>메모</th></tr>';
    api.forEach(r => {
      html += '<tr>' +
        '<td>'+escapeHtml(r.path)+'</td>' +
        '<td>'+escapeHtml(r.status.toUpperCase())+'</td>' +
        '<td>'+(r.ms||'-')+'</td>' +
        '<td>'+escapeHtml(r.note||'')+'</td>' +
      '</tr>';
    });
    html += '</table>';
    return html;
  }

  function buildEnvSummaryHtml(env){
    if(!env || !env.groups || !env.groups.length){
      return '<p>아직 ENV / 백엔드 헬스체크를 실행하지 않았습니다.</p>';
    }
    const s = env.summary;
    let html = '';
    if(s){
      html += '<p>그룹 수='+s.totalChecks+' · OK='+s.ok+', WARN='+s.warn+', ERROR='+s.error+'</p>';
    }
    html += '<table border="1" cellspacing="0" cellpadding="3" style="border-collapse:collapse;font-size:11px;width:100%">';
    html += '<tr><th>그룹</th><th>상태</th><th>누락 항목</th></tr>';
    env.groups.forEach(g => {
      const missing = (g.missing && g.missing.length) ? g.missing.join(', ') : '';
      html += '<tr>' +
        '<td>'+escapeHtml(g.label || g.id || '')+'</td>' +
        '<td>'+escapeHtml((g.status||'').toUpperCase())+'</td>' +
        '<td>'+escapeHtml(missing)+'</td>' +
      '</tr>';
    });
    html += '</table>';
    if(env.notes && env.notes.length){
      html += '<p><strong>비고:</strong> '+escapeHtml(env.notes.join(' / '))+'</p>';
    }
    return html;
  }

  function buildDeviceSummaryHtml(device){
    if(!device) return '<p>아직 디바이스 정보를 수집하지 않았습니다.</p>';
    let html = '<ul style="font-size:12px;">';
    html += '<li>타입: '+escapeHtml(device.type)+'</li>';
    html += '<li>OS: '+escapeHtml(device.os)+'</li>';
    html += '<li>브라우저: '+escapeHtml(device.browser)+'</li>';
    html += '<li>해상도: '+device.width+' x '+device.height+'</li>';
    html += '<li>픽셀 비율(DPR): '+device.dpr+'</li>';
    html += '</ul>';
    html += '<p>※ 이 정보는 현재 접속 중인 기기 기준입니다.</p>';
    return html;
  }

  function buildAiHelperDefaultText(){
    const d = lastReport.device;
    const ts = lastReport.ts || new Date().toISOString();
    const lines = [];
    lines.push('[IGDC 사이트 관리 질문 템플릿]');
    lines.push('time='+ts);
    if(d){
      lines.push('device='+d.type+', os='+d.os+', browser='+d.browser+', size='+d.width+'x'+d.height+', dpr='+d.dpr);
    }
    lines.push('요청내용: (여기에 궁금한 점을 적어주세요)');
    lines.push('');
    lines.push('※ 이 텍스트를 복사해서 ChatGPT 대화창에 붙여넣으면, 현재 상태를 설명하는 기본 골격으로 사용할 수 있습니다.');
    return lines.join('\n');
  }

  function statusLabel(summary){
    if(summary.error > 0) return { text:'ERROR', cls:'igdc-sc-badge-error' };
    if(summary.warn > 0) return { text:'WARN', cls:'igdc-sc-badge-warn' };
    if(summary.ok > 0) return { text:'OK', cls:'igdc-sc-badge-ok' };
    return { text:'-', cls:'' };
  }

  function renderPanel(){
    container.innerHTML = '';

    const header = el('div', 'igdc-sc-header');
    const title = el('h2', 'igdc-sc-title', '사이트 관리 창');
    const btnRunAll = el('button', 'igdc-sc-run', '전체 헬스체크 실행');
    header.appendChild(title);
    header.appendChild(btnRunAll);

    const grid = el('div', 'igdc-sc-grid');

    const cardFront = makeCard('사이트 상태 (7개 페이지)', '사이트 주요 페이지의 응답 상태와 속도를 점검합니다.', function(){
      openModal('사이트 상태 (7개 페이지)', buildFrontSummaryHtml(lastReport.front));
    });

    const cardApi = makeCard('API · ENV / 백엔드', '백엔드 API 및 ENV 설정 상태를 확인합니다.', function(){
      openModal('API · ENV / 백엔드', buildApiSummaryHtml(lastReport.api) + '<hr/>' + buildEnvSummaryHtml(lastReport.env));
    });

    const cardBiz = makeCard('수익 · 썸네일 · 상품 맵핑', '썸네일/상품 매핑 점검(1차 버전: 구조 확장용 자리).', function(){
      const html = '<p>※ 현재 버전에서는 기본 구조만 마련되어 있습니다.</p>' +
        '<p>향후 썸네일/상품 매핑 JSON과 실제 DOM을 비교하여, 누락·에러를 자동 검출하는 로직을 이 영역에 추가할 수 있습니다.</p>';
      openModal('수익 · 썸네일 · 상품 맵핑', html);
    });

    const cardDevice = makeCard('기기/브라우저 · UX', '현재 접속 기기와 브라우저 정보를 요약합니다.', function(){
      openModal('기기/브라우저 · UX', buildDeviceSummaryHtml(lastReport.device));
    });

    grid.appendChild(cardFront);
    grid.appendChild(cardApi);
    grid.appendChild(cardBiz);
    grid.appendChild(cardDevice);

    // [STABILIZE] AI 질문 보조/요약 영역(renderAiBox) 제거
    container.appendChild(header);
    container.appendChild(grid);
    container.appendChild(renderMaruGlobalInsightPanel());


/* =========================================================
 * MARU GLOBAL INSIGHT BLOCK — IGDC SITE CONTROL (FINAL)
 * 역할 요약
 * 1. 요약 카드 클릭 → 글로벌 레기온 모달 오픈
 * 2. AI 글로벌 인사이트 실행 → 애드온에 1차 데이터 수집 신호
 * 3. 실시간 이슈 → 애드온에 실시간 이슈 요청 신호
 * 4. 복사 → 요약 카드 텍스트 복사
 * ========================================================= */

function renderMaruGlobalInsightPanel() {
  const box = document.createElement('div');
  box.className = 'igdc-sc-ai maru-global-insight';

  /* ---------- TITLE ---------- */
  const title = document.createElement('p');
  title.className = 'igdc-sc-ai-title';
  title.textContent = 'MARU Global Insight';
  box.appendChild(title);

/* ---------- SUMMARY (CARD) ---------- */

// === GLOBAL SUMMARY INJECTOR (for MaruAddon) ===
window.renderSummary = function(text){
  const el = document.querySelector('#maru-global-summary-text');
  if(!el) return;
  el.value =
    typeof text === 'string'
      ? text
      : JSON.stringify(text, null, 2);
};

// === Summary Textarea ===
const textarea = document.createElement('textarea');
textarea.id = 'maru-global-summary-text';        // ★ 핵심
textarea.className = 'igdc-sc-ai-textarea';
textarea.readOnly = true;
textarea.value =
`MARU 엔진 기반 글로벌 인사이트 요약 영역입니다.

이 요약 카드를 클릭하면
권역별(Region) 상세 분석 모달이 열립니다.

• AI 글로벌 인사이트 실행 :
  전 세계 1차 데이터 전체 수집

• 실시간 이슈 :
  현재 시점 글로벌 이슈 요약`;

box.appendChild(textarea);

  /* ---------- ACTION BUTTONS ---------- */
  const actions = document.createElement('div');
  actions.className = 'igdc-sc-ai-actions';

  const btnRealtime = document.createElement('button');
  btnRealtime.textContent = '실시간 이슈';

  const btnCopy = document.createElement('button');
  btnCopy.textContent = '텍스트 복사';

  const btnRun = document.createElement('button');
  btnRun.textContent = 'AI 글로벌 인사이트 실행';
  btnRun.style.marginLeft = 'auto';

  actions.appendChild(btnRealtime);
  actions.appendChild(btnCopy);
  actions.appendChild(btnRun);
  box.appendChild(actions);

/* =====================================================
   EVENTS — FINAL FIX (NO CONFLICT)
   ===================================================== */

// 1) 요약 카드 클릭 → 레기온 모달
textarea.addEventListener('click', function (e) {
  e.preventDefault();
  e.stopPropagation();

  if (typeof window.openMaruGlobalRegionModal === 'function') {
    window.openMaruGlobalRegionModal();
  }
});

// 2) AI 글로벌 인사이트 실행
btnRun.addEventListener('click', function (e) {
  e.preventDefault();
  e.stopPropagation();

  textarea.value = '전 세계 1차 데이터를 취합 중입니다…';

  if (window.MaruAddon && typeof window.MaruAddon.bootstrapGlobalInsight === 'function') {
    window.MaruAddon.bootstrapGlobalInsight();
  }
});

// 3) 실시간 이슈
btnRealtime.addEventListener('click', function (e) {
  e.preventDefault();
  e.stopPropagation();

  textarea.value = '실시간 글로벌 이슈를 취합 중입니다…';

  if (window.MaruAddon && typeof window.MaruAddon.requestInsight === 'function') {
    window.MaruAddon.requestInsight({
      source: 'panel',
      mode: 'realtime-global'
    });
  }
});

// 4) 텍스트 복사
btnCopy.addEventListener('click', function (e) {
  e.preventDefault();
  e.stopPropagation();

  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  document.execCommand('copy');
});


  // 2️⃣ AI 글로벌 인사이트 실행 → 애드온에 1차 전체 데이터 수집 신호
  btnRun.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    textarea.value = '전 세계 1차 데이터를 취합 중입니다…';

    if (window.MaruAddon && typeof window.MaruAddon.bootstrapGlobalInsight === 'function') {
      window.MaruAddon.bootstrapGlobalInsight();
    } else {
      console.warn('[MARU] MaruAddon.bootstrapGlobalInsight not ready');
    }
  });

  // 3️⃣ 실시간 이슈 → 애드온에 실시간 이슈 요청 신호
  btnRealtime.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    textarea.value = '실시간 글로벌 이슈를 취합 중입니다…';

    if (window.MaruAddon && typeof window.MaruAddon.requestInsight === 'function') {
      window.MaruAddon.requestInsight({
        mode: 'realtime-global',
        source: 'panel'
      });
    } else {
      console.warn('[MARU] MaruAddon.requestInsight not ready');
    }
  });

  // 4️⃣ 텍스트 복사 (요약 카드 내용)
  btnCopy.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    document.execCommand('copy');
  });

  return box;
}




    btnRunAll.addEventListener('click', runAllChecks);
  }

  function makeCard(title, desc, onClick){
    const card = el('div', 'igdc-sc-card');
    const header = el('div', 'igdc-sc-card-header');
    const hTitle = el('div', 'igdc-sc-card-title', title);
    const hStatus = el('div', 'igdc-sc-card-status', '-');
    header.appendChild(hTitle);
    header.appendChild(hStatus);
    const body = el('div', 'igdc-sc-card-body', desc);
    card.appendChild(header);
    card.appendChild(body);
    card.addEventListener('click', function(e){
      onClick && onClick();
      e.stopPropagation();
    });
    card.__statusEl = hStatus;
    return card;
  }


function renderMaruGlobalInsightBox(){
    const box = el('div', 'igdc-sc-ai');

    const title = el('p', 'igdc-sc-ai-title', '글로벌 상황 · 성향 분석');
    const hint  = el('p', 'igdc-sc-ai-hint', 'MARU Global Insight · 전세계 권역·국가 흐름 요약');

    const textarea = el('textarea', 'igdc-sc-ai-textarea');
    textarea.readOnly = true;
    textarea.value =
`전세계 유통·미디어·소비 트렌드를
마루 엔진 기반으로 요약합니다.

AI 글로벌 인사이트 실행을 통해
권역별 → 국가별 분석을 확인할 수 있습니다.`;

    const actions = el('div', 'igdc-sc-ai-actions');
    const btnRun = el('button', '', 'AI 글로벌 인사이트 실행');
    btnRun.id = 'btnMaruGlobalInsight';
    actions.appendChild(btnRun);

    box.appendChild(title);
    box.appendChild(textarea);
    box.appendChild(actions);
    box.appendChild(hint);

    return box;
}


  async function runAllChecks(){
    lastReport.device = getDeviceInfo();

    const [front, api, env] = await Promise.all([
      checkFront(),
      checkApi(),
      checkEnv()
    ]);
    lastReport.front = front;
    lastReport.api = api;
    lastReport.env = env;
    lastReport.ts = new Date().toISOString();

    const cards = container.querySelectorAll('.igdc-sc-card');
    if(cards.length >= 1){
      const sFront = summarizeStatus(front);
      applyCardStatus(cards[0], sFront);
    }
    if(cards.length >= 2){
      const sApi = summarizeStatus(api);
      const sEnv = env.summary || { ok:0,warn:0,error:0 };
      const combined = {
        ok: (sApi.ok + sEnv.ok),
        warn: (sApi.warn + sEnv.warn),
        error: (sApi.error + sEnv.error)
      };
      applyCardStatus(cards[1], combined);
    }
    if(cards.length >= 3){
      applyCardStatus(cards[2], { ok:0, warn:0, error:0 });
    }
    if(cards.length >= 4){
      applyCardStatus(cards[3], { ok:1, warn:0, error:0 });
    }
  }

  function applyCardStatus(card, summary){
    const st = statusLabel(summary);
    const elStatus = card.__statusEl;
    if(!elStatus) return;
    elStatus.textContent = st.text;
    elStatus.className = 'igdc-sc-card-status '+(st.cls||'');
  }

  renderPanel();
})();


/* =========================================================
 * MARU GLOBAL INSIGHT — POST-RENDER TRIGGER FIX
 * (Do not change existing DOM / layout)
 * ========================================================= */
(function () {
  try {
    const root = document.getElementById('igdc-site-control');
    if (!root) return;

    // Find MARU card & body
    const maruCard =
      root.querySelector('.igdc-maru-card') ||
      root.querySelector('[data-maru="global-insight"]') ||
      root.querySelector('.maru-global-insight');

    if (!maruCard) return;

    const body =
      maruCard.querySelector('.igdc-maru-card-body') ||
      maruCard.querySelector('.igdc-side-card-body') ||
      maruCard.querySelector('textarea') ||
      maruCard;


    // 2) Buttons mapping
    const btns = maruCard.querySelectorAll('button');
    let btnRun=null, btnRealtime=null, btnCopy=null;

    btns.forEach(b=>{
      const t=(b.textContent||'').trim();
      if (t.includes('AI 글로벌') || t.includes('글로벌 인사이트 실행')) btnRun=b;
      else if (t.includes('실시간')) btnRealtime=b;
      else if (t.includes('복사')) btnCopy=b;
    });


    // 5) Copy
    if (btnCopy) {
      btnCopy.onclick = function(e){
        e.stopPropagation();
        if (!body) return;
        const text = body.value || body.textContent || '';
        navigator.clipboard.writeText(text);
      }
    }
  } catch (e) {}
})();


