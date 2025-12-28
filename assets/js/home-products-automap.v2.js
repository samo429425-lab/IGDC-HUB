
/**
 * home-products-automap.v2.right-final.js
 * FINAL VERSION
 *
 * Main: keeps existing behavior
 * Right panel: dedicated renderer
 * - shows placeholder if no data
 * - renders cards only when data exists
 */

(function () {
  if (window.__HOME_AUTOMAP_RIGHT_FINAL__) return;
  window.__HOME_AUTOMAP_RIGHT_FINAL__ = true;

  const FEED_URL = "/.netlify/functions/feed?page=homeproducts";

  const MAIN_KEYS = ["home_1","home_2","home_3","home_4","home_5"];
  const RIGHT_KEYS = ["home_right_top","home_right_middle","home_right_bottom"];

  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 7;
  const RIGHT_LIMIT = 80;
  const RIGHT_BATCH = 5;

  const LANG_TEXT = {
    ko: "콘텐츠 준비 중입니다.",
    en: "Content is being prepared.",
    ja: "コンテンツ準備中です。",
    zh: "内容正在准备中。",
    fr: "Contenu en cours de préparation.",
    es: "El contenido se está preparando.",
    de: "Inhalt wird vorbereitet.",
    pt: "Conteúdo em preparação.",
    ru: "Контент готовится.",
    th: "กำลังเตรียมเนื้อหาอยู่",
    tr: "İçerik hazırlanıyor.",
    vi: "Nội dung đang được chuẩn bị."
  };

  function getLang() {
    const v =
      localStorage.getItem("igdc_lang") ||
      document.documentElement.lang ||
      navigator.language ||
      "en";
    const k = v.toLowerCase().split("-")[0];
    return LANG_TEXT[k] ? k : "en";
  }

  function emptyText() {
    return LANG_TEXT[getLang()] || LANG_TEXT.en;
  }

  function normalize(item) {
    return {
      title: item.title || item.name || item.label || "",
      thumb:
        item.thumb ||
        item.image ||
        item.image_url ||
        item.thumbnail ||
        item.cover ||
        "",
      url:
        item.url ||
        item.href ||
        item.link ||
        item.path ||
        "#",
      priority:
        typeof item.priority === "number" ? item.priority : 999999
    };
  }

  function indexSections(payload) {
    const map = {};
    if (!payload || !Array.isArray(payload.sections)) return map;
    for (const sec of payload.sections) {
      const id = String(sec.id || "").trim();
      if (!id) continue;
      map[id] = Array.isArray(sec.items) ? sec.items : [];
    }
    return map;
  }

  function altKeys(key){
    const k = String(key || "").trim();
    if (!k) return [];
    const a = new Set([k]);
    a.add(k.replace(/_/g, "-"));
    a.add(k.replace(/-/g, "_"));
    return Array.from(a);
  }

  function pickItems(sections, key){
    const tries = altKeys(key);
    for (const t of tries){
      const items = sections && sections[t];
      if (Array.isArray(items) && items.length) return items;
    }
    // If nothing found, fall back to empty array (do NOT throw)
    return [];
  }

  /* ---------- MAIN (unchanged behavior) ---------- */
  function renderMain(key, items) {
    const anchor = document.querySelector(`[data-psom-key="${key}"]`);
    if (!anchor) return;

    const scroller = anchor.closest(".shop-scroller");
    const row = scroller && scroller.querySelector(".shop-row");
    if (!row) return;

    const list = items.map(normalize).filter(x => x.thumb);
    if (!list.length) return;

    row.innerHTML = "";
    let offset = 0;

    function renderMore() {
      const end = Math.min(offset + MAIN_BATCH, list.length, MAIN_LIMIT);
      for (let i = offset; i < end; i++) {
        const it = list[i];
        const a = document.createElement("a");
        a.className = "shop-card";
        a.href = it.url;
        a.style.background = `center/cover no-repeat url("${it.thumb}")`;

        const cap = document.createElement("div");
        cap.className = "shop-card-cap";
        cap.textContent = it.title;

        a.appendChild(cap);
        row.appendChild(a);
      }
      offset = end;
    }

    renderMore();

    scroller.addEventListener("scroll", () => {
      if (
        scroller.scrollLeft + scroller.clientWidth >=
        scroller.scrollWidth - 20
      ) {
        renderMore();
      }
    });
  }

  /* ---------- RIGHT PANEL (dedicated renderer) ---------- */
  function renderRight(key, items) {
    const anchor = document.querySelector(`[data-psom-key="${key}"]`);
    if (!anchor) return;

    const section = anchor.closest(".ad-section");
    if (!section) return;

    const listBox = section.querySelector(".ad-list");

    const list = items.map(normalize).filter(x => x.thumb);

    if (!list.length) {
      // show placeholder
      anchor.style.display = "block";
      anchor.textContent = emptyText();
      anchor.style.padding = "12px";
      anchor.style.background = "#f7f7f7";
      anchor.style.borderRadius = "12px";
      anchor.style.textAlign = "center";
      if (listBox) listBox.style.display = "none";
      return;
    }

    // hide placeholder
    anchor.style.display = "none";
    if (!listBox) return;

    listBox.style.display = "";
    listBox.innerHTML = "";

    let offset = 0;

    function renderMore() {
      const end = Math.min(offset + RIGHT_BATCH, list.length, RIGHT_LIMIT);
      for (let i = offset; i < end; i++) {
        const it = list[i];
        const a = document.createElement("a");
        a.className = "ad-box";
        a.href = it.url;

        const thumb = document.createElement("div");
        thumb.className = "thumb";
        thumb.style.background = `center/cover no-repeat url("${it.thumb}")`;

        a.appendChild(thumb);
        listBox.appendChild(a);
      }
      offset = end;
    }

    renderMore();

    listBox.addEventListener("scroll", () => {
      if (
        listBox.scrollTop + listBox.clientHeight >=
        listBox.scrollHeight - 20
      ) {
        renderMore();
      }
    });
  }

  async function boot() {
    try {
      const res = await fetch(FEED_URL, { cache: "no-store" });
      const data = await res.json();
      const sections = indexSections(data);

      MAIN_KEYS.forEach(k => renderMain(k, pickItems(sections, k)));
      RIGHT_KEYS.forEach(k => renderRight(k, pickItems(sections, k)));
    } catch (e) {
      // silent fail
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
