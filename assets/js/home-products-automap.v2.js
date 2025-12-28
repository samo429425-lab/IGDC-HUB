
/**
 * home-products-automap.v2.js
 * FINAL – safe DOM-binding automap
 * - Uses existing HTML card structure if present
 * - Never breaks layout
 * - Works with snapshot + feed.js
 */

(function () {
  if (window.__HOME_AUTOMAP_FINAL__) return;
  window.__HOME_AUTOMAP_FINAL__ = true;

  const FEED_URL = "/.netlify/functions/feed?page=homeproducts";

  const SLOT_KEYS = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  function normalize(item){
    if (!item) return null;
    return {
      title: item.title || item.name || "",
      url: item.url || item.link || item.href || "#",
      thumb: item.thumb || item.image || item.photo || ""
    };
  }

  function fillCard(card, item){
    if (!card || !item) return;

    // link
    if (card.tagName === "A") {
      card.href = item.url || "#";
    } else {
      const a = card.querySelector("a");
      if (a) a.href = item.url || "#";
    }

    // image
    let img = card.querySelector("img");
    if (img && item.thumb) {
      img.src = item.thumb;
      img.alt = item.title || "";
    }

    // title text
    const titleNode =
      card.querySelector(".title, .name, .product-title, .card-title");
    if (titleNode && item.title) {
      titleNode.textContent = item.title;
    }
  }

  function makeFallbackCard(item){
    const a = document.createElement("a");
    a.className = "shop-card";
    a.href = item.url || "#";

    const img = document.createElement("img");
    img.loading = "lazy";
    if (item.thumb) img.src = item.thumb;
    a.appendChild(img);

    return a;
  }

  function renderSlot(container, items){
    if (!container) return;

    const cards = $all(".shop-card", container);

    // If cards already exist → bind
    if (cards.length > 0) {
      cards.forEach((card, i) => {
        if (!items[i]) return;
        fillCard(card, items[i]);
      });
      return;
    }

    // Otherwise try cloning first child as template
    const first = container.children[0];
    if (first) {
      container.innerHTML = "";
      items.forEach(item => {
        const clone = first.cloneNode(true);
        fillCard(clone, item);
        container.appendChild(clone);
      });
      return;
    }

    // Absolute fallback: generate minimal cards
    container.innerHTML = "";
    items.forEach(item => {
      const node = makeFallbackCard(item);
      container.appendChild(node);
    });

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "maru-empty";
      empty.textContent = "콘텐츠 준비 중입니다.";
      container.appendChild(empty);
    }
  }

  async function load(){
    let data;
    try {
      const res = await fetch(FEED_URL, { cache: "no-store" });
      data = await res.json();
    } catch(e){
      return;
    }

    if (!data || !Array.isArray(data.sections)) return;

    const map = {};
    data.sections.forEach(sec => {
      if (!sec || !sec.id) return;
      map[String(sec.id)] = Array.isArray(sec.items) ? sec.items : [];
    });

    SLOT_KEYS.forEach(key => {
      const el = document.querySelector(`[data-psom-key="${key}"]`);
      if (!el) return;
      renderSlot(el, map[key] || map[key.replace(/_/g,"-")] || []);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
