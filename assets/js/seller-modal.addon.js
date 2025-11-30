/* IGDC Seller Modal Addon — FULL SET (merged)
   - One file to open and render Members-Only modal + notices/admin actions
   - Modal open guarantee (multi-path + fallback container)
   - Footer action bar INSIDE modal (공지/승인/취소/퇴출)
   - Role-gated, live-synced (auth/role events)
   - De-dup + safe with MemberModal bundle (shim if absent)
*/

(function(){
  'use strict';

  // =======================================================================
  // 0) Utils
  // =======================================================================
  var $  = function(s, r){ return (r||document).querySelector(s); };
  var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }
  function lower(s){ return String(s||'').trim().toLowerCase(); }
  function uniq(arr){
    var seen={}; var out=[];
    arr.forEach(function(x){ x=lower(x); if(x && !seen[x]){ seen[x]=1; out.push(x); } });
    return out;
  }

  // =======================================================================
  // 1) i18n (ko/en/zh/ru/es) — KO fallback to EN if global says so
  // =======================================================================
  function getLang(){
    try {
      var raw = (window.currentLang || document.documentElement.lang || (navigator.language||'en')).toLowerCase();
      if (raw.startsWith('zh')) return 'zh';
      if (raw.startsWith('ru')) return 'ru';
      if (raw.startsWith('es')) return 'es';
      if (raw.startsWith('ko')) return 'ko'; // we keep ko; UI strings below include ko
      return 'en';
    } catch(e){ return 'en'; }
  }
  var T = {
    en:{
      nav:"🔒 Members", apply:"Apply", review:"Review", notice:"Notices",
      name:"Name", email:"Email", phone:"Phone", company:"Company / Business", memo:"Note",
      addFile:"Add File", submit:"Submit", loginNeed:"Please log in to continue.",
      buyerNeed:"Buyer registration required.", submitted:"Your application has been submitted.",
      submitFail:"Submission failed. Please try again later.", notices:"Notices", noNotices:"No notices",
      approve:"Approve", reject:"Reject", close:"Close", saveNotice:"Save Notice", formTitle:"Membership Application",
      writeNotice:"Write Notice"
    },
    zh:{
      nav:"🔒 会员专用", apply:"申请", review:"审核", notice:"公告",
      name:"姓名", email:"邮箱", phone:"联系电话", company:"公司/商户", memo:"备注",
      addFile:"添加文件", submit:"提交", loginNeed:"请先登录。",
      buyerNeed:"需要先完成买家注册。", submitted:"申请已提交。",
      submitFail:"提交失败，请稍后重试。", notices:"公告", noNotices:"暂无公告",
      approve:"通过", reject:"拒绝", close:"关闭", saveNotice:"保存公告", formTitle:"会员申请",
      writeNotice:"发布公告"
    },
    ru:{
      nav:"🔒 Для участников", apply:"Заявка", review:"Проверка", notice:"Объявления",
      name:"Имя", email:"Email", phone:"Телефон", company:"Компания / Бизнес", memo:"Примечание",
      addFile:"Добавить файл", submit:"Отправить", loginNeed:"Пожалуйста, войдите в систему.",
      buyerNeed:"Требуется регистрация покупателя.", submitted:"Ваша заявка отправлена.",
      submitFail:"Не удалось отправить. Попробуйте позже.", notices:"Объявления", noNotices:"Нет объявлений",
      approve:"Одобрить", reject:"Отклонить", close:"Закрыть", saveNotice:"Сохранить объявление", formTitle:"Заявка на членство",
      writeNotice:"Создать объявление"
    },
    es:{
      nav:"🔒 Solo miembros", apply:"Solicitud", review:"Revisión", notice:"Anuncios",
      name:"Nombre", email:"Email", phone:"Teléfono", company:"Empresa / Negocio", memo:"Nota",
      addFile:"Añadir archivo", submit:"Enviar", loginNeed:"Inicia sesión primero.",
      buyerNeed:"Se requiere registro de comprador.", submitted:"Tu solicitud ha sido enviada.",
      submitFail:"Error al enviar. Inténtalo de nuevo.", notices:"Anuncios", noNotices:"No hay anuncios",
      approve:"Aprobar", reject:"Rechazar", close:"Cerrar", saveNotice:"Guardar anuncio", formTitle:"Solicitud de membresía",
      writeNotice:"Escribir anuncio"
    },
    ko:{
      nav:"🔒 회원전용", apply:"신청", review:"검토", notice:"공지",
      name:"이름", email:"이메일", phone:"전화번호", company:"회사 / 사업자", memo:"메모",
      addFile:"파일 추가", submit:"제출", loginNeed:"먼저 로그인하세요.",
      buyerNeed:"구매자 등록이 필요합니다.", submitted:"신청이 접수되었습니다.",
      submitFail:"전송 실패. 다시 시도하세요.", notices:"공지사항", noNotices:"공지 없음",
      approve:"승인", reject:"반려", close:"닫기", saveNotice:"공지 저장", formTitle:"회원 신청",
      writeNotice:"공지 올리기"
    }
  };
  function t(k){ var lang=getLang(); return (T[lang] && T[lang][k]) || (T.en[k]||k); }

  // =======================================================================
  // 2) Roles / Auth (union of idToken + globals + storage), site scopes
  // =======================================================================
  var KMAP = {'홈':'home','home':'home','네트워크':'network','network':'network','소셜':'social','소셜네트워크':'social','social':'social','유통':'distribution','distribution':'distribution','미디어':'media','media':'media','투어':'tour','tour':'tour','도네이션':'donation','후원':'donation','donation':'donation'};
  var SITES = new Set(['home','network','social','distribution','media','tour','donation']);

  function rolesFromIdToken(){
    try{
      var p = window.osAuth && osAuth.getIdTokenPayload && osAuth.getIdTokenPayload();
      var r = p && (p.app_metadata && p.app_metadata.roles || p.roles || p["https://example.com/roles"]) || [];
      r = Array.isArray(r) ? r : String(r||'').split(/[ ,]/);
      return r.map(lower);
    }catch(e){ return []; }
  }
  function rolesFromGlobals(){
    try{
      var out = [];
      if (window.IGDC && Array.isArray(window.IGDC.roles)) out = out.concat(window.IGDC.roles);
      if (window.__osauth && Array.isArray(window.__osauth.roles)) out = out.concat(window.__osauth.roles);
      return out.map(lower);
    }catch(e){ return []; }
  }
  function rolesFromStorage(){
    try{
      var keys = ['igdc.roles','osauth.roles','os:lastRoles','roles'];
      for (var i=0;i<keys.length;i++){
        var v = localStorage.getItem(keys[i]);
        if (!v) continue;
        try{
          var j = JSON.parse(v);
          if (Array.isArray(j)) return j.map(lower);
          if (j && Array.isArray(j.roles)) return j.roles.map(lower);
        }catch(_){
          return String(v).split(/[ ,]/).map(lower);
        }
      }
    }catch(e){}
    return [];
  }
  function allRoles(){
    return uniq([].concat(rolesFromIdToken(), rolesFromGlobals(), rolesFromStorage()));
  }
  function detectSiteKey(role){
    var m = role.match(/site[ _-]?manager(?:[:/_\-\s]+([a-z]+))?/i);
    if (m && m[1] && SITES.has(m[1])) return m[1];
    for (var k in KMAP){ if (role.indexOf(String(k).toLowerCase())>-1) return KMAP[k]; }
    return null;
  }
  function authInfo(){
    var rs = allRoles();
    var isAdmin = rs.includes('admin');
    var isDirector = rs.includes('director');
    var isSiteDirector = (rs.includes('site_director') || rs.includes('site-director'));
    var siteScopes = new Set();
    rs.forEach(function(r){ var k=detectSiteKey(r); if(k) siteScopes.add(k); });
    return { isAdmin:isAdmin, isDirector:isDirector, isSiteDirector:isSiteDirector, siteScopes:siteScopes, canSee: (isAdmin || isDirector || isSiteDirector || siteScopes.size>0) };
  }
  function getAuthTokens(){
    try{
      var p = window.osAuth && osAuth.getIdTokenPayload && osAuth.getIdTokenPayload();
      var at = window.osAuth && osAuth.getAccessToken && osAuth.getAccessToken();
      return { payload:p||null, at:at||null };
    }catch(e){ return {payload:null, at:null}; }
  }

  // =======================================================================
  // 3) CSS inject (scoped)
  // =======================================================================
  function injectCSS(){
    var tag = $('#igdc-seller-css');
    if (!tag){ tag = document.createElement('style'); tag.id='igdc-seller-css'; document.head.appendChild(tag); }
    tag.textContent = [
      '#igdc-seller-mask{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;z-index:99990}',
      '#igdc-seller-modal{position:fixed;z-index:99991;top:60px;left:0;width:min(1280px,92vw);max-width:100%;height:calc(100vh - 80px);background:#fff;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.25);display:none;overflow:hidden}',
      '#igdc-seller-head{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee;background:#fff8f0}',
      '#igdc-seller-head .title{display:flex;gap:.5rem;align-items:center;font-weight:700}',
      '#igdc-seller-head .tabs{display:flex;gap:8px;flex-wrap:wrap}',
      '#igdc-seller-head .tab{padding:8px 10px;border-radius:8px;cursor:pointer}',
      '#igdc-seller-head .tab.active{background:#ffe6cc;color:#ff8c1a}',
      '#igdc-seller-wrap{display:grid;grid-template-columns:42% 58%;height:100%;min-width:840px}',
      '#igdc-seller-left{padding:16px 18px;overflow:auto;min-width:420px;box-sizing:border-box}',
      '#igdc-seller-right{border-left:1px solid #eee;padding:12px 14px;overflow:auto;background:#fff;box-sizing:border-box}',
      '.igdc-field{display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:center;margin:10px 0}',
      '.igdc-field label{font-weight:600;color:#333}',
      '.igdc-field input,.igdc-field textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font:inherit;box-sizing:border-box}',
      '.igdc-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}',
      '.igdc-btn{padding:10px 14px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer}',
      '.igdc-btn.primary{background:#111;color:#fff;border-color:#111}',
      '.igdc-notice-title{font-weight:bold;margin:8px 0}',
      '.igdc-notice-item{border:1px solid #eee;border-radius:10px;padding:10px 12px;margin:8px 0;background:#fff}',
      '.igdc-notice-empty{color:#888;margin:12px 0}',
      '.igdc-notice-editor{display:none;margin-top:10px}',
      '.igdc-notice-editor textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:10px}',
      '.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;border-top:1px solid #e9ecef;padding-top:10px}',
      '@media (max-width: 960px){#igdc-seller-modal{top:0;left:0;width:100vw;height:100vh;border-radius:0}#igdc-seller-wrap{grid-template-columns:1fr;grid-auto-rows:auto;height:100%;min-width:auto}#igdc-seller-right{border-left:none;border-top:1px solid #eee}.igdc-field{grid-template-columns:1fr}}'
    ].join('');
  }

  // =======================================================================
  // 4) Modal Template (kept internal, no external HTML dependency)
  // =======================================================================
  function injectModal(){
    var mask = $('#igdc-seller-mask');
    var box  = $('#igdc-seller-modal');
    if (mask && box) return;

    mask = document.createElement('div'); mask.id='igdc-seller-mask';
    box  = document.createElement('div'); box.id='igdc-seller-modal';
    box.innerHTML = ''
      + '<div id="igdc-seller-head">'
      + '  <div class="title"><span style="font-size:18px">🔒</span><span>'+t('formTitle')+'</span></div>'
      + '  <div class="tabs">'
      + '    <div class="tab" data-tab="apply">'+t('apply')+'</div>'
      + '    <div class="tab" data-tab="review">'+t('review')+'</div>'
      + '    <div class="tab" data-tab="notice">'+t('notice')+'</div>'
      + '  </div>'
      + '  <button class="igdc-btn" id="igdc-seller-close">✕</button>'
      + '</div>'
      + '<div id="igdc-seller-wrap">'
      + '  <div id="igdc-seller-left">'
      + '    <div class="igdc-field"><label>'+t('name')+'</label><input id="sa_name" placeholder=""></div>'
      + '    <div class="igdc-field"><label>'+t('email')+'</label><input id="sa_email" placeholder=""></div>'
      + '    <div class="igdc-field"><label>'+t('phone')+'</label><input id="sa_phone" placeholder=""></div>'
      + '    <div class="igdc-field"><label>'+t('company')+'</label><input id="sa_company" placeholder=""></div>'
      + '    <div class="igdc-field"><label>'+t('memo')+'</label><textarea id="sa_note" rows="4" placeholder=""></textarea></div>'
      + '    <div id="sa_files">'
      + '      <div class="igdc-filebox"><input type="file" name="file0"><button class="igdc-btn" id="sa_addfile">'+t('addFile')+'</button></div>'
      + '    </div>'
      + '    <div class="igdc-actions"><button class="igdc-btn primary" id="sa_submit">'+t('submit')+'</button></div>'
      + '  </div>'
      + '  <div id="igdc-seller-right">'
      + '    <div class="igdc-notice-title">'+t('notices')+'</div>'
      + '    <div id="igdc-notice-list" class="igdc-notice-empty">'+t('noNotices')+'</div>'
      + '    <div class="igdc-notice-editor" id="igdc-notice-editor">'
      + '      <textarea id="igdc-notice-text" rows="6" placeholder="'+t('saveNotice')+'"></textarea>'
      + '      <div class="igdc-actions"><button class="igdc-btn primary" id="igdc-notice-save">'+t('saveNotice')+'</button></div>'
      + '    </div>'
      + '    <div class="modal-actions" id="notice-actions-slot"></div>'
      + '    <div class="modal-actions" id="notice-actions-slot"></div>'
      + '  </div>'
      + '</div>';
    document.body.append(mask, box);

    on(mask, 'click', closeModal);
    on($('#igdc-seller-close'), 'click', closeModal);
    on($('#sa_addfile'), 'click', function(e){
      e.preventDefault();
      var wrap = $('#sa_files');
      var idx = $$('.igdc-filebox', wrap).length;
      var row = document.createElement('div'); row.className='igdc-filebox';
      row.innerHTML = '<input type="file" name="file'+idx+'"><button class="igdc-btn">-</button>';
      on(row.querySelector('button'),'click', function(ev){ ev.preventDefault(); row.remove(); });
      wrap.appendChild(row);
    });
    on($('#sa_submit'),'click', submitApplication);

    $$('#igdc-seller-head .tab').forEach(function(tab){ on(tab,'click', function(){ setActiveTab(tab.dataset.tab); }); });

    setupRoleUI();
  }

  function setActiveTab(which){
    var tabs = $$('#igdc-seller-head .tab');
    tabs.forEach(function(x){ x.classList.remove('active'); });
    (tabs.find(function(x){return x.dataset.tab===which;}) || tabs[0]).classList.add('active');
  }

  function closeModal(){
    var m=$('#igdc-seller-modal'), k=$('#igdc-seller-mask');
    if (m) m.style.display='none';
    if (k) k.style.display='none';
    document.body.style.overflow='';
  }

  function openModal(defaultTab){
    injectCSS(); injectModal();
    $('#igdc-seller-mask').style.display='block';
    $('#igdc-seller-modal').style.display='block';
    document.body.style.overflow='hidden';

    // Tabs visibility by role
    var roleAuth = authInfo();
    var tabs = $$('#igdc-seller-head .tab');
    var applyTab  = tabs.find(function(x){return x.dataset.tab==='apply';});
    var reviewTab = tabs.find(function(x){return x.dataset.tab==='review';});
    var noticeTab = tabs.find(function(x){return x.dataset.tab==='notice';});
    var reviewer = (roleAuth.isAdmin || roleAuth.isDirector || roleAuth.isSiteDirector || roleAuth.siteScopes.size>0);
    if (reviewTab) reviewTab.style.display = reviewer ? '' : 'none';
    if (applyTab)  applyTab.style.display  = '' ;
    if (noticeTab) noticeTab.style.display = '' ;
    setActiveTab(defaultTab || (reviewer ? 'review' : 'apply'));

    // Render footer buttons according to role (after open)
    ensureFooterButtons();
  }

  // =======================================================================
  // 5) Footer action bar INSIDE modal (공지/승인/취소/퇴출)
  // =======================================================================
  function ensureFooterButtons(){
    var modal = $('#igdc-seller-modal'); if (!modal) return;
    var footer = modal.querySelector('#notice-actions-slot') || modal.querySelector('.modal-actions') || modal;
    if (!footer) return;
    // de-dup
    if (footer.__igdcInjected) return;
    footer.__igdcInjected = true;

    var auth = authInfo();
    var show = auth.canSee ? 'inline-flex' : 'none';

    function mk(id, label, klass){
      var b = document.createElement('button');
      b.id = id; b.type='button'; b.className = klass||'igdc-btn';
      b.textContent = label;
      b.style.cssText = 'padding:10px 14px;border-radius:8px;border:1px solid #d0d7de;background:#fff;display:'+show+';';
      return b;
    }
    var write = mk('notice-write-btn', t('writeNotice'), 'igdc-btn primary');
    var appr  = mk('member-approve-btn', t('approve'),   'igdc-btn');
    var rej   = mk('member-reject-btn',  t('reject'),    'igdc-btn');
    var ban   = mk('member-ban-btn',     '퇴출',          'igdc-btn');

    write.addEventListener('click', function(e){
      e.preventDefault();
      var internal = document.getElementById('mmv2-write');
      if (internal) { internal.click(); return; }
      document.dispatchEvent(new CustomEvent('notice:open', {detail:{actorRoles:[].concat(Array.from(auth.siteScopes)), isAdmin:auth.isAdmin, isDirector:auth.isDirector, isSiteDirector:auth.isSiteDirector}}));
    });
    function bind(btn, evt){
      btn.addEventListener('click', function(e){
        e.preventDefault();
        document.dispatchEvent(new CustomEvent(evt, {detail:{siteScopes:[].concat(Array.from(auth.siteScopes)), isAdmin:auth.isAdmin, isDirector:auth.isDirector, isSiteDirector:auth.isSiteDirector}}));
      });
    }
    bind(appr,'member:approve'); bind(rej,'member:reject'); bind(ban,'member:ban');

    footer.appendChild(write);
    footer.appendChild(appr);
    footer.appendChild(rej);
    footer.appendChild(ban);
  }

  // =======================================================================
  // 6) Notice editor visibility by role + save mock
  // =======================================================================
  function setupRoleUI(){
    var editor = $('#igdc-notice-editor'); if (!editor) return;
    var a = authInfo();
    var reviewer = (a.isAdmin || a.isDirector || a.isSiteDirector || a.siteScopes.size>0);
    editor.style.display = reviewer ? 'block' : 'none';

    // Restore simple in-page notice state (can be swapped with real API later)
    var view = $('#igdc-notice-list');
    if (window.__IGDC_NOTICE_TEXT__){
      view.classList.remove('igdc-notice-empty');
      view.textContent = window.__IGDC_NOTICE_TEXT__;
    }
    var saveBtn = $('#igdc-notice-save');
    if (saveBtn && !saveBtn.__bound){
      saveBtn.__bound = true;
      on(saveBtn,'click', function(){
        var txt = String($('#igdc-notice-text').value||'').trim();
        window.__IGDC_NOTICE_TEXT__ = txt || t('noNotices');
        view.classList.remove('igdc-notice-empty');
        view.textContent = window.__IGDC_NOTICE_TEXT__;
        alert(t('saveNotice'));
      });
    }
  }

  // =======================================================================
  // 7) Application submit (placeholder; keeps previous behavior)
  // =======================================================================
  async function submitApplication(){
    var tokens = getAuthTokens();
    var payload = tokens.payload, at = tokens.at;
    if (!payload){ alert(t('loginNeed')); return; }
    // Buyer check optional; keep loose
    var files = $$('#sa_files input[type=file]').map(function(inp){ return inp.files && inp.files[0]; }).filter(Boolean);
    var data = new FormData();
    data.append('sub', payload.sub || '');
    data.append('email', $('#sa_email').value || payload.email || '');
    data.append('name',  $('#sa_name').value  || payload.name  || '');
    data.append('phone', $('#sa_phone').value || '');
    data.append('company', $('#sa_company').value || '');
    data.append('note', $('#sa_note').value || '');
    files.forEach(function(f,i){ data.append('file'+i, f, f.name); });
    try{
      var res = await fetch('/api/seller/applications', {
        method:'POST',
        headers: Object.assign({}, at?{'Authorization':'Bearer '+at}:{ }),
        body: data,
        credentials:'include'
      });
      if (res.ok){ alert(t('submitted')); closeModal(); }
      else { alert(t('submitFail')); }
    }catch(e){ alert(t('submitFail')); }
  }

  // =======================================================================
  // 8) Open guarantees + triggers + role-sync
  // =======================================================================
  // MemberModal shim (if bundle missing)
  if (!window.MemberModal) window.MemberModal = {};
  if (typeof window.MemberModal.mount !== 'function'){
    window.MemberModal.mount = function(opts){ console.warn('[MemberModal] shim active; bundle not loaded.', opts); };
  }

  function tryOpenModal(){
    // If project exposes openers, prefer them
    if (typeof window.openSellerModal === 'function'){ try{ return window.openSellerModal(); }catch(_){ } }
    if (typeof window.openModal === 'function'){ try{ return window.openModal(); }catch(_){ } }

    // Try shimming via MemberModal
    try{
      MemberModal.mount({ modalSelector:'#igdc-seller-modal', triggerSelector:'#mo-btn,.js-seller-modal-trigger,.js-member-modal-trigger,#member-btn' });
    }catch(_){}

    // Fallback: our own modal container
    openModal('apply');
  }

  var TRIG = '#mo-btn, .js-seller-modal-trigger, .js-member-modal-trigger, #member-btn';

  document.addEventListener('click', function(e){
    var tEl = e.target && e.target.closest && e.target.closest(TRIG);
    if (!tEl) return;
    if (tEl.tagName === 'A'){ e.preventDefault(); e.stopPropagation(); }
    tryOpenModal();
  }, {capture:true});

  document.addEventListener('DOMContentLoaded', function(){
    injectCSS();
    // role sync on boot
    setTimeout(function(){ setupRoleUI(); ensureFooterButtons(); }, 250);
  });

  // Role/Auth change events
  ['osauth:ready','osauth:login','osauth:logout','igdc:roles:updated','osauth:token:changed'].forEach(function(evt){
    window.addEventListener(evt, function(){ setTimeout(function(){ setupRoleUI(); ensureFooterButtons(); }, 120); });
    document.addEventListener(evt, function(){ setTimeout(function(){ setupRoleUI(); ensureFooterButtons(); }, 120); });
  });

  // Debug flag
  window.__sellerModalAddonFullSet = true;
})();

/* === [MERGED] Footer action buttons (공지/승인/취소/퇴출) with role-gating & events === */
(function(){
  'use strict';
  const TRIG = '#mo-btn, .js-seller-modal-trigger, .js-member-modal-trigger, #member-btn';
  const KMAP = {'홈':'home','home':'home','네트워크':'network','network':'network','소셜':'social','소셜네트워크':'social','social':'social','유통':'distribution','distribution':'distribution','미디어':'media','media':'media','투어':'tour','tour':'tour','도네이션':'donation','후원':'donation','donation':'donation'};
  const SITES = new Set(['home','network','social','distribution','media','tour','donation']);

  function roles(){
    try{
      const p = window.osAuth && osAuth.getIdTokenPayload && osAuth.getIdTokenPayload();
      let r = (p && (p.app_metadata && p.app_metadata.roles)) || (p && p.roles) || (p && p['https://example.com/roles']) || [];
      r = Array.isArray(r) ? r : String(r||'').split(/[ ,]/);
      return r.map(x => String(x).trim().toLowerCase());
    }catch(e){ return []; }
  }
  function detectSiteKey(role){
    const m = role.match(/site[ _-]?manager(?:[:/_\-\s]+([a-z]+))?/i);
    if (m && m[1] && SITES.has(m[1])) return m[1];
    for (const [k,v] of Object.entries(KMAP)){ if (role.includes(String(k).toLowerCase())) return v; }
    return null;
  }
  function authInfo(){
    const rs = roles();
    const isAdmin = rs.includes('admin');
    const isDirector = rs.includes('director');
    const isSiteDirector = rs.includes('site_director') || rs.includes('site-director');
    const siteScopes = new Set();
    rs.forEach(r => { const k = detectSiteKey(r); if (k) siteScopes.add(k); });
    return { isAdmin, isDirector, isSiteDirector, siteScopes: [...siteScopes], canSee: isAdmin || isDirector || isSiteDirector || siteScopes.size > 0 };
  }
  function visibleModal(){
    const L = [...document.querySelectorAll('#igdc-seller-modal,[role=\"dialog\"],.os-modal')]
      .filter(el => getComputedStyle(el).display !== 'none' && el.id !== 'os-modal');
    L.sort((a,b)=>(+getComputedStyle(b).zIndex||0)-(+getComputedStyle(a).zIndex||0));
    return L[0] || null;
  }
  function footerSlot(m){
    return m && (m.querySelector('#notice-actions-slot') || m.querySelector('.modal-actions'));
  }
  function injectButtons(){
    const m = visibleModal(); if (!m) return;
    const slot = footerSlot(m); if (!slot || slot.__noticeButtonsInjected) return;
    slot.__noticeButtonsInjected = true;

    const a = authInfo();
    const show = a.canSee ? 'inline-flex' : 'none';

    function mk(id, label, cls){
      const b = document.createElement('button');
      b.id = id; b.type = 'button'; b.className = cls || 'igdc-btn';
      b.textContent = label;
      b.style.cssText = 'margin-left:8px;padding:10px 14px;border-radius:8px;border:1px solid #d0d7de;background:#fff;display:'+show+';';
      return b;
    }
    const write = mk('notice-write-btn','공지 올리기','igdc-btn primary');
    const appr  = mk('member-approve-btn','승인','igdc-btn');
    const rej   = mk('member-reject-btn','취소','igdc-btn');
    const ban   = mk('member-ban-btn','퇴출','igdc-btn');

    write.addEventListener('click',()=>{
      const i = document.getElementById('mmv2-write');
      if (i) { i.click(); return; }
      document.dispatchEvent(new CustomEvent('notice:open', {detail:{actorRoles:a.siteScopes, isAdmin:a.isAdmin, isDirector:a.isDirector, isSiteDirector:a.isSiteDirector}}));
    });
    function bind(btn, evt){
      btn.addEventListener('click',()=>{
        document.dispatchEvent(new CustomEvent(evt, {detail:{siteScopes:a.siteScopes, isAdmin:a.isAdmin, isDirector:a.isDirector, isSiteDirector:a.isSiteDirector}}));
      });
    }
    bind(appr,'member:approve'); bind(rej,'member:reject'); bind(ban,'member:ban');

    slot.appendChild(write);
    slot.appendChild(appr);
    slot.appendChild(rej);
    slot.appendChild(ban);
  }

  document.addEventListener('click', e=>{
    const t = e.target.closest(TRIG);
    if (!t) return;
    if (t.tagName === 'A'){ e.preventDefault(); e.stopPropagation(); }
    // ensure modal UI
    setTimeout(injectButtons, 180);
  });
  window.addEventListener('osauth:ready',()=>setTimeout(injectButtons,200));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(injectButtons,300));
})();

/* === [MERGED] MemberModal.mount shim (safe) === */
(function(){
  if (!window.MemberModal) window.MemberModal = {};
  if (typeof window.MemberModal.mount !== 'function'){
    window.MemberModal.mount = function(opts){
      console.warn('[MemberModal] mount shim active; load real bundle before this if available.', opts);
    };
  }
})();
