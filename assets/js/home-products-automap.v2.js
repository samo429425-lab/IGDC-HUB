/**
 * home-products-automap.v2.js
 * FINAL MERGED VERSION
 * - Single file
 * - Handles:
 *   1) multilingual "content preparing" placeholder
 *   2) thumbnail injection into existing cards
 *   3) safe coexistence with existing automap logic
 */

(function () {
  if (window.__HOME_AUTOMAP_MERGED__) return;
  window.__HOME_AUTOMAP_MERGED__ = true;

  const FEED_URL = "/.netlify/functions/feed?page=homeproducts";

  const KEYS = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  const PLACEHOLDER_I18N = {
    ko: "콘텐츠 준비 중입니다.",
    en: "Content is being prepared.",
    ja: "コンテンツ準備中です。",
    zh: "内容正在准备中。",
    fr: "Contenu en cours de préparation.",
    de: "Inhalt wird vorbereitet.",
    es: "Contenido en preparación.",
    pt: "Conteúdo em preparação.",
    ru: "Контент готовится.",
    th: "กำลังเตรียมเนื้อหา",
    vi: "Nội dung đang được chuẩn bị.",
    tr: "İçerik hazırlanıyor.",
    id: "Konten sedang disiapkan."
  };

  function lang() {
    const l = (navigator.language || "en").toLowerCase().split("-")[0];
    return PLACEHOLDER_I18N[l] ? l : "en";
  }

  function placeholderText() {
    return PLACEHOLDER_I18N[lang()];
  }

  function normalize(item) {
    if (!item) return null;
    return {
      title: item.title || item.name || "",
      url: item.url || item.link || "#",
      thumb: item.thumb || item.image || item.photo || ""
    };
  }

  function applyThumbs(container, items) {
    if (!container) return;

    const cards = Array.from(container.querySelectorAll(".shop-card"));

    // If cards exist → just inject
    if (cards.length) {
      cards.forEach((card, i) => {
        const data = items[i];
        if (!data) return;

        const item = normalize(data);

        const link = card.tagName === "A" ? card : card.querySelector("a");
        if (link) link.href = item.url;

        const img = card.querySelector("img");
        if (img && item.thumb) img.src = item.thumb;
      });
      return;
    }

    // If no cards and no data → placeholder
    if (!items || !items.length) {
      if (!container.querySelector(".maru-empty")) {
        const empty = document.createElement("div");
        empty.className = "maru-empty";
        empty.textContent = placeholderText();
        container.appendChild(empty);
      }
      return;
    }

    // Fallback: generate minimal cards
    items.forEach(item => {
      const a = document.createElement("a");
      a.className = "shop-card";
      a.href = item.url || "#";

      const img = document.createElement("img");
      if (item.thumb) img.src = item.thumb;

      a.appendChild(img);
      container.appendChild(a);
    });
  }

  async function run() {
    let data;
    try {
      const res = await fetch(FEED_URL, { cache: "no-store" });
      data = await res.json();
    } catch (e) {
      return;
    }

    if (!data || !Array.isArray(data.sections)) return;

    const map = {};
    data.sections.forEach(sec => {
      if (sec?.id && Array.isArray(sec.items)) {
        map[String(sec.id)] = sec.items;
      }
    });

    KEYS.forEach(key => {
      const el = document.querySelector(`[data-psom-key="${key}"]`);
      if (!el) return;
      applyThumbs(el, map[key] || map[key.replace(/_/g, "-")] || []);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
