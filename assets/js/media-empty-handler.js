
/**
 * media-empty-handler.v1.2.i18n.js
 * - Multilingual placeholder (13 langs)
 * - Fallback to English for all others
 * - Safe: never removes real content
 * - Auto updates when media loads
 */

(function () {
  'use strict';

  if (window.__MEDIA_EMPTY_I18N__) return;
  window.__MEDIA_EMPTY_I18N__ = true;

  const LANG_MAP = {
    en: "Content coming soon.",
    de: "Inhalt folgt in Kürze.",
    es: "Contenido disponible próximamente.",
    fr: "Contenu disponible prochainement.",
    id: "Konten akan segera tersedia.",
    ja: "コンテンツは準備中です。",
    pt: "Conteúdo em breve.",
    ru: "Контент скоро появится.",
    th: "เนื้อหาจะพร้อมใช้งานเร็ว ๆ นี้",
    tr: "İçerik yakında hazır olacak.",
    vi: "Nội dung sẽ sớm được cập nhật.",
    zh: "内容正在准备中。",
    ko: "콘텐츠 준비 중입니다."
  };

  function getLang() {
    return (
      document.documentElement.lang ||
      navigator.language ||
      "en"
    ).toLowerCase().slice(0, 2);
  }

  function text() {
    return LANG_MAP[getLang()] || LANG_MAP.en;
  }

  function hasRealContent(el) {
    return !!el.querySelector(
      "a, img[src]:not([src^='data:']), video, iframe"
    );
  }

  function placeholderHTML() {
    return `
      <div class="maru-empty" style="
        padding:20px;
        border-radius:12px;
        background:#f7f7f7;
        text-align:center;
        color:#666;
        font-size:14px;
        line-height:1.6;">
        <div style="font-size:20px;margin-bottom:8px;">📦</div>
        <div>${text()}</div>
      </div>
    `;
  }

  function ensure(container) {
    if (!container) return;

    if (hasRealContent(container)) {
      const p = container.querySelector(".maru-empty");
      if (p) p.remove();
      return;
    }

    if (!container.querySelector(".maru-empty")) {
      container.insertAdjacentHTML("beforeend", placeholderHTML());
    }
  }

  function scan() {
    document.querySelectorAll(
      ".media-grid, .media-list, .media-wrap, .video-grid, .gallery, .content-grid"
    ).forEach(ensure);
  }

  function observe() {
    const mo = new MutationObserver(() => {
      clearTimeout(window.__media_i18n_timer);
      window.__media_i18n_timer = setTimeout(scan, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    scan();
    observe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
