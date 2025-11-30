// IGDC Member Admin integration for Seller Modal
// assets/js/member-admin-modal.js
(function(){
  'use strict';

  var API = {
    listUsers: '/api/listusers',        // Netlify Functions: listusers.js
    listRoles: '/api/listroles',        // Netlify Functions: listroles.js
    assignRole: '/api/assignowner'   // OS0 롤 부여/변경 함수
  };

  var loaded = false;
  var rootId = 'igdc-review-panel';

  function $(sel, root){
    return (root||document).querySelector(sel);
  }
  function $all(sel, root){
    return Array.prototype.slice.call((root||document).querySelectorAll(sel));
  }

  function log(msg, type){
    var logBox = $('#igdc-review-log');
    if (!logBox) return;
    var now = new Date().toLocaleTimeString();
    logBox.textContent = '['+now+'] ' + msg;
    logBox.className = 'igdc-review-log' + (type ? (' ' + type) : '');
  }

  function fetchJson(url, options){
    return fetch(url, options||{}).then(function(res){
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function ensurePanel(){
    var right = $('#igdc-seller-right');
    if (!right) return null;

    var panel = $('#'+rootId);
    if (panel) return panel;

    // 기존 공지 영역을 나중에 토글하기 위해 저장
    var stash = right.__noticeNodes;
    if (!stash){
      stash = $all(':scope > *', right);
      right.__noticeNodes = stash;
    }

    panel = document.createElement('div');
    panel.id = rootId;
    panel.style.display = 'none';
    panel.innerHTML = ''
      + '<div class="igdc-review-title">회원 / 롤 검토</div>'
      + '<div class="igdc-review-grid">'
      + '  <div class="igdc-review-left">'
      + '    <div class="igdc-review-toolbar">'
      + '      <input id="igdc-review-search" class="igdc-review-input" placeholder="이름·이메일 검색">'
      + '      <button id="igdc-review-refresh" class="igdc-review-btn small">새로고침</button>'
      + '    </div>'
      + '    <div class="igdc-review-table-wrap">'
      + '      <table class="igdc-review-table">'
      + '        <thead><tr><th>이름</th><th>이메일</th><th>상태</th><th>롤</th></tr></thead>'
      + '        <tbody id="igdc-review-tbody"></tbody>'
      + '      </table>'
      + '      <div id="igdc-review-empty" class="igdc-review-empty">회원 데이터가 없습니다.</div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="igdc-review-right">'
      + '    <div id="igdc-review-selected" class="igdc-review-selected">선택된 회원 없음</div>'
      + '    <div id="igdc-review-roles" class="igdc-review-roles"></div>'
      + '    <div class="igdc-review-actions">'
      + '      <button id="igdc-review-save" class="igdc-review-btn primary">승인 / 롤 저장</button>'
      + '      <button id="igdc-review-reject" class="igdc-review-btn">반려</button>'
      + '      <button id="igdc-review-remove" class="igdc-review-btn danger">퇴출</button>'
      + '    </div>'
      + '    <div id="igdc-review-log" class="igdc-review-log"></div>'
      + '  </div>'
      + '</div>';

    right.appendChild(panel);
    injectCSS();
    bindPanelEvents(panel);
    return panel;
  }

  function injectCSS(){
    var tag = document.getElementById('igdc-member-admin-css');
    if (tag) return;
    tag = document.createElement('style');
    tag.id = 'igdc-member-admin-css';
    tag.textContent = ''
      + '#'+rootId+'{font-family:inherit;display:none;}'
      + '#'+rootId+' .igdc-review-title{font-weight:700;margin-bottom:8px;}'
      + '#'+rootId+' .igdc-review-grid{display:grid;grid-template-columns:50% 50%;gap:12px;align-items:stretch;}'
      + '#'+rootId+' .igdc-review-left,#'+rootId+' .igdc-review-right{border:1px solid #eee;border-radius:10px;padding:10px 12px;box-sizing:border-box;min-height:260px;}'
      + '#'+rootId+' .igdc-review-toolbar{display:flex;gap:6px;margin-bottom:8px;}'
      + '#'+rootId+' .igdc-review-input{flex:1 1 auto;padding:6px 8px;border-radius:8px;border:1px solid #ddd;font:inherit;}'
      + '#'+rootId+' .igdc-review-btn{padding:8px 12px;border-radius:8px;border:1px solid #d0d7de;background:#fff;cursor:pointer;font:inherit;}'
      + '#'+rootId+' .igdc-review-btn.primary{background:#111;color:#fff;border-color:#111;}'
      + '#'+rootId+' .igdc-review-btn.danger{color:#b42318;border-color:#fda29b;background:#fff5f5;}'
      + '#'+rootId+' .igdc-review-table-wrap{max-height:260px;overflow:auto;border:1px solid #eee;border-radius:10px;}'
      + '#'+rootId+' table{width:100%;border-collapse:collapse;font-size:13px;}'
      + '#'+rootId+' th,#'+rootId+' td{padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:left;white-space:nowrap;}'
      + '#'+rootId+' tr.selected{background:#fff5e6;}'
      + '#'+rootId+' .igdc-review-empty{padding:12px;font-size:12px;color:#888;text-align:center;}'
      + '#'+rootId+' .igdc-review-selected{font-weight:600;margin-bottom:8px;}'
      + '#'+rootId+' .igdc-review-roles{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;max-height:160px;overflow:auto;}'
      + '#'+rootId+' .igdc-role-item{display:flex;align-items:center;gap:6px;font-size:13px;}'
      + '#'+rootId+' .igdc-role-item small{color:#777;}'
      + '#'+rootId+' .igdc-review-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:4px;}'
      + '#'+rootId+' .igdc-review-log{margin-top:6px;font-size:12px;color:#555;}'
      ;
    document.head.appendChild(tag);
  }

  var state = {
    users: [],
    roles: [],
    selectedUserId: null
  };

  function renderUsers(){
    var tbody = $('#igdc-review-tbody');
    var empty = $('#igdc-review-empty');
    if (!tbody || !empty) return;
    tbody.innerHTML = '';
    if (!state.users || !state.users.length){
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    state.users.forEach(function(u){
      var tr = document.createElement('tr');
      var id = u.id || u.user_id || u.sub || '';
      tr.dataset.userId = id;
      tr.dataset.email = u.email || '';
      tr.dataset.name = u.name || u.nickname || '';
      tr.dataset.status = u.status || u.state || '대기';
      var roles = (u.roles || u.app_roles || []);
      tr.dataset.roles = roles.join(',');
      tr.innerHTML = ''
        + '<td>' + (tr.dataset.name || '(이름 없음)') + '</td>'
        + '<td>' + (tr.dataset.email || '') + '</td>'
        + '<td>' + tr.dataset.status + '</td>'
        + '<td>' + (roles.length ? roles.join(', ') : '-') + '</td>';
      tr.addEventListener('click', function(){
        selectUser(tr);
      });
      tbody.appendChild(tr);
    });
  }

  function renderRoles(){
    var box = $('#igdc-review-roles');
    if (!box) return;
    box.innerHTML = '';
    if (!state.roles || !state.roles.length){
      box.textContent = '등록된 롤이 없습니다.';
      return;
    }
    state.roles.forEach(function(r){
      var val = r.id || r.name;
      var id = 'igdc-role-' + val;
      var wrap = document.createElement('label');
      wrap.className = 'igdc-role-item';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = val;
      cb.id = id;
      var span = document.createElement('span');
      span.textContent = r.name || r.id;
      wrap.appendChild(cb);
      wrap.appendChild(span);
      if (r.description){
        var sm = document.createElement('small');
        sm.textContent = ' - ' + r.description;
        wrap.appendChild(sm);
      }
      box.appendChild(wrap);
    });
  }

  function applySearch(){
    var qEl = $('#igdc-review-search');
    var tbody = $('#igdc-review-tbody');
    if (!qEl || !tbody) return;
    var q = qEl.value.trim().toLowerCase();
    $all('tr', tbody).forEach(function(tr){
      var name = (tr.dataset.name || '').toLowerCase();
      var email = (tr.dataset.email || '').toLowerCase();
      var show = !q || name.indexOf(q) >= 0 || email.indexOf(q) >= 0;
      tr.style.display = show ? '' : 'none';
    });
  }

  function selectUser(tr){
    var tbody = $('#igdc-review-tbody');
    if (tbody){
      $all('tr', tbody).forEach(function(row){
        row.classList.toggle('selected', row === tr);
      });
    }
    state.selectedUserId = tr.dataset.userId;
    var label = $('#igdc-review-selected');
    if (label){
      label.textContent = (tr.dataset.name || '(이름 없음)') + ' <' + (tr.dataset.email || '') + '>';
    }
    var roles = (tr.dataset.roles || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    var roleBox = $('#igdc-review-roles');
    if (roleBox){
      $all('input[type=checkbox]', roleBox).forEach(function(cb){
        cb.checked = roles.indexOf(cb.value) >= 0;
      });
    }
    log('선택된 회원: ' + (tr.dataset.email || tr.dataset.userId));
  }

  function bindPanelEvents(panel){
    var search = $('#igdc-review-search', panel);
    var refresh = $('#igdc-review-refresh', panel);
    var save = $('#igdc-review-save', panel);
    var reject = $('#igdc-review-reject', panel);
    var remove = $('#igdc-review-remove', panel);

    if (search){
      search.addEventListener('input', applySearch);
    }
    if (refresh){
      refresh.addEventListener('click', function(){
        loadUsers(true);
      });
    }
    if (save){
      save.addEventListener('click', function(){
        saveRoles('approve');
      });
    }
    if (reject){
      reject.addEventListener('click', function(){
        saveRoles('reject');
      });
    }
    if (remove){
      remove.addEventListener('click', function(){
        saveRoles('remove');
      });
    }
  }

  function loadUsers(force){
    if (!force && state.users && state.users.length) return Promise.resolve();
    log('회원 목록을 불러오는 중...');
    return fetchJson(API.listUsers).then(function(data){
      state.users = data.users || data || [];
      renderUsers();
      log('회원 목록 로딩 완료 (' + state.users.length + '명)');
    }).catch(function(e){
      console.error(e);
      log('회원 목록 로딩 실패: ' + e.message, 'error');
    });
  }

  function loadRoles(force){
    if (!force && state.roles && state.roles.length) return Promise.resolve();
    log('롤 목록을 불러오는 중...');
    return fetchJson(API.listRoles).then(function(data){
      state.roles = data.roles || data || [];
      renderRoles();
      log('롤 목록 로딩 완료 (' + state.roles.length + '개)');
    }).catch(function(e){
      console.error(e);
      log('롤 목록 로딩 실패: ' + e.message, 'error');
    });
  }

  function saveRoles(action){
    if (!state.selectedUserId){
      log('먼저 회원을 선택해 주세요.', 'error');
      return;
    }
    var box = $('#igdc-review-roles');
    if (!box) return;
    var roles = $all('input[type=checkbox]:checked', box).map(function(cb){ return cb.value; });
    var payload = {
      userId: state.selectedUserId,
      roles: roles,
      action: action || 'approve'
    };
    log('롤 저장 중...');
    fetchJson(API.assignRole, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res){
      log('롤 저장 완료: ' + (res.message || 'success'));
      // 저장 후 목록 갱신
      return loadUsers(true);
    }).catch(function(e){
      console.error(e);
      log('롤 저장 실패: ' + e.message, 'error');
    });
  }

  function showReviewPanel(){
    var right = $('#igdc-seller-right');
    if (!right) return;
    var panel = ensurePanel();
    if (!panel) return;
    var stash = right.__noticeNodes || [];
    stash.forEach(function(node){
      node.style.display = 'none';
    });
    panel.style.display = 'block';
    if (!loaded){
      loaded = true;
      // 최초 진입 시 한 번 로딩
      Promise.all([loadUsers(true), loadRoles(true)]).then(function(){});
    }
  }

  function showNoticePanel(){
    var right = $('#igdc-seller-right');
    if (!right) return;
    var panel = $('#'+rootId);
    if (panel) panel.style.display = 'none';
    var stash = right.__noticeNodes || [];
    stash.forEach(function(node){
      node.style.display = '';
    });
  }

  function syncTabView(){
    var head = $('#igdc-seller-head');
    if (!head) return;
    var active = head.querySelector('.tab.active');
    var tab = active && active.dataset.tab;
    if (tab === 'review'){
      showReviewPanel();
    }else{
      showNoticePanel();
    }
  }

  function watchTabs(){
    // 탭 클릭 후 view를 동기화
    document.addEventListener('click', function(e){
      var t = e.target && e.target.closest && e.target.closest('#igdc-seller-head .tab');
      if (!t) return;
      // seller-modal의 setActiveTab가 먼저 실행된 후에 반영되도록 약간 지연
      setTimeout(syncTabView, 0);
    }, true);

    // 모달이 열릴 때도 한 번 동기화
    document.addEventListener('igdc:seller-modal-open', function(){
      setTimeout(syncTabView, 50);
    });
  }

  function observeModal(){
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(function(muts){
      var hasModal = !!$('#igdc-seller-modal');
      if (hasModal){
        // 모달 등장 시 한 번만 동기화 시도
        setTimeout(syncTabView, 50);
      }
    });
    obs.observe(document.documentElement, {childList:true,subtree:true});
  }

  function init(){
    watchTabs();
    observeModal();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }

})();