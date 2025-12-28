
/**
 * home-products-automap.v3.4.js
 * - Built-in i18n placeholder (no external script)
 * - Main 5 sections + right panel
 * - Auto replace when real data arrives
 */

(function () {
  'use strict';
  if (window.__HOME_AUTOMAP_V33__) return;
  window.__HOME_AUTOMAP_V33__ = true;

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

  function lang() {
    return (document.documentElement.lang || navigator.language || "en")
      .toLowerCase()
      .slice(0, 2);
  }

  function t() {
    return LANG_MAP[lang()] || LANG_MAP.en;
  }

  const FEED_TRIES = [
    "/.netlify/functions/feed?page=homeproducts",
    "/.netlify/functions/feed?category=homeproducts",
    "/.netlify/functions/feed?category=home-shop-1"
  ];

  async function loadFeed() {
    for (const url of FEED_TRIES) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) return await r.json();
      } catch (_) {}
    }
    return { sections: [], rows: [], items: [] };
  }

  function isValid(item) {
    return !!(item && (item.thumb || item.photo || item.image) && item.id);
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
        <div style="font-size:20px;margin-bottom:6px;">📦</div>
        <div>${t()}</div>
      </div>`;
  }

  function cardHTML(c) {
    const img = c.thumb || c.photo || c.image || "";
    const title = (c.title || "").replace(/"/g, "");
    const href = (c.url || c.detailUrl || c.checkoutUrl || ("/product.html?id=" + encodeURIComponent(c.id))).trim();
    // Use both classes to match legacy CSS rules across pages
    return `
      <a class="thumb-card product-card" href="${href}" data-product-id="${c.id}" data-href="${href}" target="_blank" rel="noopener">
        <div class="thumb">
          <img loading="lazy" decoding="async" src="${img}" alt="${title}">
        </div>
        <div class="meta">
          <div class="t">${title || " "}</div>
        </div>
      </a>`;
  }


  function ensure(container, items) {
    if (!container) return;

    const valid = (items || []).filter(isValid);

    if (!valid.length) {
      if (!container.querySelector(".maru-empty")) {
        container.insertAdjacentHTML("beforeend", placeholderHTML());
      }
      return;
    }

    container.innerHTML = "";
    valid.forEach(it => container.insertAdjacentHTML("beforeend", cardHTML(it)));
  }

  async function init() {
    const feed = await loadFeed();

    const map = {};
    (feed.sections || feed.rows || []).forEach(s => {
      const k = (s.id || s.sectionId || "").toLowerCase();
      if (k) map[k] = s.items || s.cards || [];
    });

    if ((!feed.sections && !feed.rows) && Array.isArray(feed.items)) {
      map["home_1"] = feed.items;
      map["home-1"] = feed.items;
    }

    for (let i = 1; i <= 5; i++) {
      const key = `home_${i}`;
      const el =
        document.querySelector(`.thumb-grid[data-psom-key="${key}"]`) ||
        document.querySelector(`#shopRow${i}`) ||
        document.querySelector(`#shopScroller${i} .thumb-grid`);

      if (!el) continue;

      const items =
        map[key] ||
        map[`home-${i}`] ||
        map[`home_${i}`] ||
        [];

      ensure(el, items);
    }
  }

  window.addEventListener("load", () => {
    setTimeout(init, 80);
    setTimeout(init, 300);
  });
})();
