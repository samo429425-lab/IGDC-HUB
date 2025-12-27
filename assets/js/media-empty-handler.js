/**
 * media-empty-handler.js (i18n)
 * 다국어 "콘텐츠 준비중" 자동 처리
 * 지원 언어: DE, EN, ES, FR, ID, JA, PT, RU, TH, TR, VI, ZH (+ KO)
 */
(function () {
  const EMPTY_TEXT_MAP = {
    ko: "콘텐츠를 준비 중입니다.",
    en: "Content is being prepared.",
    de: "Inhalte werden vorbereitet.",
    es: "El contenido se está preparando.",
    fr: "Le contenu est en cours de préparation.",
    id: "Konten sedang dipersiapkan.",
    ja: "コンテンツを準備しています。",
    pt: "O conteúdo está sendo preparado.",
    ru: "Контент готовится.",
    th: "กำลังเตรียมเนื้อหาอยู่",
    tr: "İçerik hazırlanıyor.",
    vi: "Nội dung đang được chuẩn bị.",
    zh: "内容正在准备中。"
  };

  function getLang() {
    const raw =
      (document.documentElement && document.documentElement.lang) ||
      (document.body && document.body.getAttribute("lang")) ||
      "";

    if (raw) return raw.toLowerCase().split("-")[0].trim();

    const m = (location.pathname || "").toLowerCase().match(/[_-]([a-z]{2})(?:\.\w+)?$/);
    if (m && m[1]) return m[1];

    return "en";
  }

  function getEmptyText() {
    const lang = getLang();
    return EMPTY_TEXT_MAP[lang] || EMPTY_TEXT_MAP.en;
  }

  function ensureEmptyState(container) {
    if (!container.querySelector(".empty-state")) {
      const el = document.createElement("div");
      el.className = "empty-state";
      el.textContent = getEmptyText();
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
      const res = await fetch(`/.netlify/functions/feed?category=${encodeURIComponent(key)}`);
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
    document.querySelectorAll("[data-psom-key]").forEach(handle);
  });
})();