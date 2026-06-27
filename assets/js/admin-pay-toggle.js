// admin-pay-toggle.js
// Read-only PG status panel. Runtime writes are intentionally disabled because
// deployed Netlify function files are not a persistent payment configuration store.

(function () {
  "use strict";

  const PAY_STATUS_ENDPOINT = "/.netlify/functions/status";

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("pay-control-link");
    if (!button) return;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      openPayControlModal();
    });
  });

  async function loadStatus() {
    try {
      const response = await fetch(PAY_STATUS_ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error("status_load_failed");
      return await response.json();
    } catch (_) {
      return {
        ok: false,
        pg: { status: "status_unavailable", executionEnabled: false },
        payment: {},
        features: {}
      };
    }
  }

  function statusText(pg) {
    const map = {
      pending_pg_approval: "PG 승인 대기",
      provider_unconfigured: "승인 후 PG 사업자 설정 필요",
      execution_not_enabled: "PG 실행 승인 대기",
      provider_adapter_unconfigured: "PG 연결 어댑터 설정 필요",
      maintenance: "결제 점검 중",
      ready: "결제 연결 준비 완료",
      status_unavailable: "상태 확인 불가"
    };
    return map[pg?.status] || "결제 준비 상태";
  }

  async function openPayControlModal() {
    if (document.getElementById("pay-control-modal")) return;

    const status = await loadStatus();
    const pg = status.pg || {};
    const features = status.features || {};
    const payment = status.payment || {};

    const modal = document.createElement("div");
    modal.id = "pay-control-modal";
    modal.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(0,0,0,.45)",
      "z-index:99999",
      "display:flex",
      "align-items:center",
      "justify-content:center"
    ].join(";");

    modal.innerHTML = `
      <div style="background:#fff;padding:20px;border-radius:10px;width:360px;max-width:90%;box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:14px;">
        <h3 style="margin-top:0">결제 / 도네이션 상태</h3>
        <div style="padding:10px 12px;border:1px solid #d9e6f5;background:#f6fbff;border-radius:8px;line-height:1.55;margin-bottom:14px;">
          <strong>${statusText(pg)}</strong><br/>
          PG 직접 결제: ${payment.card ? "사용 가능" : "승인 전 차단"}<br/>
          도네이션 기능: ${features.donation ? "콘텐츠·안내 운영" : "비활성"}<br/>
          제휴 연결: ${features.affiliate ? "운영" : "비활성"}
        </div>
        <div style="font-size:12px;color:#555;line-height:1.55;margin-bottom:16px;">
          이 화면에서는 결제 설정을 직접 저장하지 않습니다. 실제 PG 실행은 승인된 PG 사업자 계약과 보호된 배포 환경설정이 완료된 뒤에만 활성화됩니다.
        </div>
        <div style="text-align:right;">
          <button id="close-pay-toggle" type="button">닫기</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById("close-pay-toggle").onclick = () => modal.remove();
  }
})();
