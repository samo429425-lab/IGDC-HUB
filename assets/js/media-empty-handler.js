/**
 * media-empty-handler.js
 * 역할:
 * 1) data-psom-key 섹션에 '준비중' 메시지 표시
 * 2) 데이터가 있으면 자동 제거
 * 3) 기존 automap / renderCards 로직과 충돌 없음
 */

(function () {
  function ensureEmptyState(container) {
    if (!container.querySelector(".empty-state")) {
      const el = document.createElement("div");
      el.className = "empty-state";
      el.textContent = "콘텐츠를 준비 중입니다.";
      el.style.padding = "20px";
      el.style.textAlign = "center";
      el.style.color = "#999";
      el.style.fontSize = "14px";
      container.appendChild(el);
    }
  }

  function removeEmptyState(container) {
    const el = container.querySelector(".empty-state");
    if (el) el.remove();
  }

  async function handle(container) {
    const key = container.dataset.psomKey;
    if (!key) return;

    ensureEmptyState(container);

    try {
      const res = await fetch(`/.netlify/functions/feed?category=${key}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.items || data.items.length === 0) return;

      removeEmptyState(container);

      if (window.renderCards) {
        window.renderCards(container, data.items);
      }
    } catch (e) {
      console.warn("media empty handler error:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document
      .querySelectorAll("[data-psom-key]")
      .forEach(handle);
  });
})();