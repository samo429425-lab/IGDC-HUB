/**
 * IGDC Member Admin Modal
 * 정본 교체용 (index 의존 제거 / 단일 책임)
 * - 트리거: .js-seller-modal-trigger 또는 #mo-btn
 * - 권한 판단: IGDC_ROLE_PERM + getUserRole
 * - index.html 수정 불필요
 */
(function () {
  'use strict';

  if (!window.IGDC_ROLE_PERM || !window.getUserRole) {
    console.error('[IGDC] Role engine missing');
    return;
  }

  let modal = null;

  const role = () => window.getUserRole();
  const has = (perm) =>
    window.IGDC_ROLE_PERM.hasPermission(
      role(),
      window.IGDC_ROLE_PERM.PERMISSIONS[perm]
    );

  function buildModal() {
    return `
<div id="igdc-member-modal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:none">
  <div style="width:90%;max-width:1100px;height:80%;margin:5% auto;background:#111;color:#fff;display:flex">
    <div style="width:40%;padding:20px;border-right:1px solid #333">
      <h3>회원 서비스</h3>
      ${has('APPLY_STANDARD') ? `<button data-act="apply-standard">스탠다드 신청</button>` : ``}
      ${has('APPLY_PREMIUM') ? `<button data-act="apply-premium">프리미엄 결제</button>` : ``}
      ${has('APPLY_COMMERCE') ? `<button data-act="apply-commerce">커머스 신청</button>` : ``}
    </div>
    <div style="flex:1;padding:20px">
      <h3>공지사항</h3>
      <div>공지 목록</div>
      ${has('WRITE_NOTICE') ? `<textarea></textarea><button data-act="write-notice">등록</button>` : ``}
      ${has('APPROVE_MEMBERS') ? `<h3>검토</h3><div>검토 큐</div>` : ``}
    </div>
  </div>
</div>`;
  }

  function init() {
    if (modal) return;
    document.body.insertAdjacentHTML('beforeend', buildModal());
    modal = document.getElementById('igdc-member-modal');
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
  }

  function open() {
    init();
    modal.style.display = 'block';
  }

  function close() {
    if (modal) modal.style.display = 'none';
  }

  window.openMemberAdminModal = open;
  window.closeMemberAdminModal = close;

  document.addEventListener('click', function (e) {
    const trigger = e.target.closest('.js-seller-modal-trigger, #mo-btn');
    if (!trigger) return;
    e.preventDefault();
    open();
  });
})();
