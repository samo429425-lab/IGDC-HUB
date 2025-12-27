// admin-pay-toggle.js
// Admin sidebar toggle controller for payment / donation settings
// UI-only controller (no business logic)

const PAY_CONFIG_ENDPOINT = "/.netlify/functions/update-pay-config";
const PAY_STATUS_ENDPOINT = "/.netlify/functions/status";

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("pay-control-link");
  if (!btn) return;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    openPayControlModal();
  });
});

async function openPayControlModal() {
  if (document.getElementById("pay-control-modal")) return;

  let state = {
    enabled: false,
    features: {
      commerce: false,
      donation: false,
      affiliate: false
    }
  };

  try {
    const res = await fetch(PAY_STATUS_ENDPOINT);
    if (res.ok) {
      const json = await res.json();
      state.enabled = !!json.enabled;
      state.features = {
        commerce: !!json.features?.commerce,
        donation: !!json.features?.donation,
        affiliate: !!json.features?.affiliate
      };
    }
  } catch (e) {
    console.warn("status load failed", e);
  }

  const modal = document.createElement("div");
  modal.id = "pay-control-modal";
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.45);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  modal.innerHTML = `
    <div style="
      background:#fff;
      padding:20px;
      border-radius:10px;
      width:340px;
      max-width:90%;
      box-shadow:0 10px 30px rgba(0,0,0,.25);
      font-size:14px;
    ">
      <h3 style="margin-top:0">결제 / 도네이션 설정</h3>

      <label><input type="checkbox" id="toggle-enabled"> 전체 활성화</label><br><br>
      <label><input type="checkbox" id="toggle-commerce"> 결제 허용</label><br>
      <label><input type="checkbox" id="toggle-donation"> 도네이션 허용</label><br>
      <label><input type="checkbox" id="toggle-affiliate"> 제휴 허용</label>

      <div style="margin-top:16px;text-align:right;">
        <button id="save-pay-toggle">저장</button>
        <button id="close-pay-toggle" style="margin-left:6px;">닫기</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("toggle-enabled").checked = state.enabled;
  document.getElementById("toggle-commerce").checked = state.features.commerce;
  document.getElementById("toggle-donation").checked = state.features.donation;
  document.getElementById("toggle-affiliate").checked = state.features.affiliate;

  document.getElementById("close-pay-toggle").onclick = () => modal.remove();

  document.getElementById("save-pay-toggle").onclick = async () => {
    const payload = {
      enabled: document.getElementById("toggle-enabled").checked,
      features: {
        commerce: document.getElementById("toggle-commerce").checked,
        donation: document.getElementById("toggle-donation").checked,
        affiliate: document.getElementById("toggle-affiliate").checked
      }
    };

    try {
      const res = await fetch(PAY_CONFIG_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("save failed");

      alert("설정이 저장되었습니다.");
      modal.remove();
    } catch (err) {
      alert("저장 실패: 서버 연결을 확인하세요.");
      console.error(err);
    }
  };
}
