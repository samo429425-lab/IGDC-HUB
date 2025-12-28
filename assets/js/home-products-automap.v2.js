// home-automap-thumbnail-addon.js
(function () {
  if (window.__HOME_AUTOMAP_THUMB_PATCH__) return;
  window.__HOME_AUTOMAP_THUMB_PATCH__ = true;

  const FEED_URL = "/.netlify/functions/feed?page=homeproducts";

  const KEYS = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  function normalize(item) {
    return {
      title: item?.title || item?.name || "",
      url: item?.url || item?.link || "#",
      thumb: item?.thumb || item?.image || item?.photo || ""
    };
  }

  function applyToSlot(container, items) {
    if (!container || !items || !items.length) return;

    const cards = Array.from(container.querySelectorAll(".shop-card"));
    if (!cards.length) return;

    cards.forEach((card, i) => {
      const data = items[i];
      if (!data) return;

      const item = normalize(data);

      const link = card.tagName === "A" ? card : card.querySelector("a");
      if (link) link.href = item.url;

      const img = card.querySelector("img");
      if (img && item.thumb) img.src = item.thumb;
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
      applyToSlot(el, map[key] || map[key.replace(/_/g, "-")] || []);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();