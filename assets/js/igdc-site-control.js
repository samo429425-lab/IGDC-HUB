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

    const aiBox = renderAiBox();

    container.appendChild(header);
    container.appendChild(grid);
    container.appendChild(aiBox);

// === MARU GLOBAL INSIGHT (DESIGN-SAFE, CLONED FROM AI BOX) ===
(function(){
  // clone AI box to preserve identical design tokens/classes
  const maruBox = aiBox.cloneNode(true);

  // title
  const title = maruBox.querySelector('.igdc-sc-ai-title');
  if(title) title.textContent = '🧭 MARU GLOBAL INSIGHT';

  // textarea
  const ta = maruBox.querySelector('textarea');
  if(ta){
    ta.readOnly = true;
    ta.value =
      'MARU 엔진을 통해 전세계 권역·국가별 흐름, 트렌드, 이슈를 요약 표시합니다.\n' +
      'AI 글로벌 인사이트 실행을 누르면 최신 분석이 반영됩니다.';
  }

  // actions: keep layout, replace main button label
  const btns = maruBox.querySelectorAll('button');
  btns.forEach(function(b){
    if(b.textContent && b.textContent.indexOf('AI 자동 진단 실행')>-1){
      b.textContent = 'AI 글로벌 인사이트 실행';
      b.onclick = async function(){
        try{
          b.disabled = true;
          b.textContent = '분석 중...';
          const res = await fetch('/api/ai-diagnose', { method:'POST' });
          const data = await res.json();
          if(ta){
            ta.value = data.summary || JSON.stringify(data, null, 2);
          }
        }catch(e){
          if(ta) ta.value = '글로벌 인사이트 호출 오류: ' + e.message;
        }finally{
          b.disabled = false;
          b.textContent = 'AI 글로벌 인사이트 실행';
        }
      };
    }
  });

  container.appendChild(maruBox);
})();
// === END MARU GLOBAL INSIGHT ===





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

  function renderAiBox(){
    const box = el('div', 'igdc-sc-ai');
    const title = el('p', 'igdc-sc-ai-title', 'AI 질문 보조 / 요약 영역');
    const textarea = el('textarea', 'igdc-sc-ai-textarea');
    textarea.id = 'igdc-sc-ai-input';
    textarea.value = buildAiHelperDefaultText();

    const actions = el('div', 'igdc-sc-ai-actions');
    const btnReset = el('button', '', '실시간 이슈');
    const btnCopy = el('button', '', '텍스트 복사');
    const btnAi = el('button', '', 'AI 자동 진단 실행(β)');
    actions.appendChild(btnReset);
    actions.appendChild(btnCopy);
    actions.appendChild(btnAi);

    const hint = el('p', 'igdc-sc-ai-hint', '※ 이 텍스트를 복사해서 ChatGPT 대화창에 붙여넣고, 추가로 궁금한 내용을 덧붙이면 분석·상담에 활용할 수 있습니다.');

    btnReset.addEventListener('click', function(){
      textarea.value = buildAiHelperDefaultText();
    });

    btnCopy.addEventListener('click', function(){
      try{
        textarea.select();
        document.execCommand('copy');
      }catch(e){}
    });


    btnAi.addEventListener('click', async function(){
      try{
        btnAi.disabled = true;
        btnAi.textContent = 'AI 진단 실행 중...';
        const res = await fetch('/api/ai-diagnose', { method: 'POST' });
        if(!res.ok){
          throw new Error('HTTP '+res.status);
        }
        const data = await res.json();
        if(data && data.summary){
          textarea.value = data.summary;
        }else if(data && data.raw){
          textarea.value = JSON.stringify(data.raw, null, 2);
        }else{
          textarea.value = 'AI 진단 응답을 받았지만, 요약 내용을 찾을 수 없습니다.\n'+JSON.stringify(data, null, 2);
        }
      }catch(e){
        alert('AI 진단 호출 중 오류가 발생했습니다: '+ (e && e.message ? e.message : String(e)));
      }finally{
        btnAi.disabled = false;
        btnAi.textContent = 'AI 자동 진단 실행(β)';
      }
    });

    box.appendChild(title);
    box.appendChild(textarea);
    box.appendChild(actions);
    box.appendChild(hint);
    return box;
  }

function renderMaruGlobalInsightBox() {
  // === 외곽 카드 (AI 질문 보조 요약 영역과 동일한 디자인 계열) ===
  const panel = document.createElement('div');
  panel.className = 'igdc-side-card';

  // === 헤더 ===
  const header = document.createElement('div');
  header.className = 'igdc-side-card-header';

  header.textContent = 'MARU Global Insights';

  // === 바디 ===
  const body = document.createElement('div');
  body.className = 'igdc-side-card-body';
  // === 요약 카드 (※ 이 카드 자체가 레기온 모달 트리거) ===
  const card = el('div', 'igdc-maru-card');

  const cardTitle = el(
    'div',
    'igdc-maru-card-title',
    '글로벌 상황 · 성향 분석'
  );

  const cardBody = el('div', 'igdc-maru-card-body');
  cardBody.style.whiteSpace = 'pre-wrap';
  cardBody.style.fontSize = '13px';
  cardBody.style.color = '#1f2f5c';
  cardBody.style.lineHeight = '1.6';

  cardBody.textContent =
`AI 글로벌 인사이트 실행을 누르면
전 세계 데이터를 취합하여
글로벌 정세를 요약 표시합니다.

이 요약 영역을 클릭하면
권역별 상세 분석 화면이 열립니다.`;

  card.appendChild(cardTitle);
  card.appendChild(cardBody);

  // 🔹 요약 카드 클릭 = 마루 글로벌 레기온 모달
  card.addEventListener('click', function () {
    if (typeof window.openMaruGlobalRegionModal === 'function') {
      window.openMaruGlobalRegionModal();
    }
  });

  // === 버튼 영역 ===
  const actions = el('div', 'igdc-sc-ai-actions');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

  const btnRealtime = el('button', '', '실시간 이슈');
  const btnCopy = el('button', '', '텍스트 복사');
  const btnRun = el('button', '', 'AI 글로벌 인사이트 실행');

  // 실행 버튼 우측 정렬
  btnRun.style.marginLeft = 'auto';

  // 🔹 AI 글로벌 인사이트 실행 = MARU 엔진 실행
  btnRun.addEventListener('click', async function (e) {
    e.stopPropagation();
    cardBody.textContent = '전 세계 데이터를 취합 중입니다...';

    try {
      const res = await fetch('/api/maru-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'global-full' })
      });
      const data = await res.json();

      // 1) 우측 패널 요약 표시
      cardBody.textContent =
        data.summary ||
        '글로벌 인사이트 요약 데이터를 받지 못했습니다.';

      // 2) 전역 데이터 저장 (레기온/컨트리 모달 공용)
      window.MARU_GLOBAL_DATA = data;

      // 3) 레기온 / 컨트리 모달에 데이터 주입
      if (typeof window.injectMaruGlobalRegionData === 'function') {
        window.injectMaruGlobalRegionData(data);
      }
      if (typeof window.injectMaruGlobalCountryData === 'function') {
        window.injectMaruGlobalCountryData(data);
      }

    } catch (err) {
      cardBody.textContent =
        '글로벌 인사이트 취합 중 오류가 발생했습니다.';
    }
  });

  // 🔹 실시간 이슈 = 전세계 동향 요약
  btnRealtime.addEventListener('click', async function (e) {
    e.stopPropagation();
    cardBody.textContent = '실시간 글로벌 이슈를 취합 중...';

    try {
      const res = await fetch('/api/maru-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'realtime-global' })
      });
      const data = await res.json();
      cardBody.textContent =
        data.summary || '실시간 이슈가 없습니다.';
    } catch (err) {
      cardBody.textContent =
        '실시간 이슈 취합 중 오류가 발생했습니다.';
    }
  });

  // 🔹 텍스트 복사
  btnCopy.addEventListener('click', function (e) {
    e.stopPropagation();
    navigator.clipboard.writeText(cardBody.textContent || '');
  });

  actions.appendChild(btnRealtime);
  actions.appendChild(btnCopy);
  actions.appendChild(btnRun);

  body.appendChild(card);
  body.appendChild(actions);

  panel.appendChild(header);
  panel.appendChild(body);

  return panel;
}
