/**
 * home-products-automap.v2.js
 * FINAL – append only / right panel fixed
 */

(function () {
  if (window.__HOME_AUTOMAP_FIXED__) return;
  window.__HOME_AUTOMAP_FIXED__ = true;

  const FEED_URL = "/.netlify/functions/feed?page=homeproducts";

  const MAIN_KEYS = ["home_1","home_2","home_3","home_4","home_5"];
  const RIGHT_KEYS = ["home_right_top","home_right_middle","home_right_bottom"];

  const MAIN_BATCH = 7;
  const RIGHT_BATCH = 5;

  const LANG = {
    ko:"콘텐츠 준비 중입니다.", en:"Content is being prepared.",
    ja:"コンテンツ準備中です。", zh:"内容正在准备中。",
    fr:"Contenu en cours de préparation.", es:"El contenido se está preparando.",
    de:"Inhalt wird vorbereitet.", pt:"Conteúdo em preparação.",
    ru:"Контент готовится.", th:"กำลังเตรียมเนื้อหาอยู่",
    tr:"İçerik hazırlanıyor.", vi:"Nội dung đang được chuẩn bị.",
    id:"Konten sedang disiapkan."
  };

  const getLang = () => {
    const v = localStorage.getItem("igdc_lang") || document.documentElement.lang || navigator.language || "en";
    const k = v.toLowerCase().split("-")[0];
    return LANG[k] ? k : "en";
  };

  const normalize = (it) => ({
    title: it.title || it.name || it.label || "",
    thumb: it.thumb || it.image || it.image_url || it.thumbnail || it.cover || "",
    url: it.url || it.href || it.link || "#"
  });

  const indexSections = (p) => p?.sections || p?.itemsByKey || {};

  const ensurePlaceholder = (host) => {
    if (host.querySelector(".psom-placeholder")) return;
    const d = document.createElement("div");
    d.className = "psom-placeholder";
    d.textContent = LANG[getLang()];
    d.style.cssText = "padding:12px;text-align:center;background:#f7f7f7;border-radius:10px;color:#666;";
    host.appendChild(d);
  };

  const hidePlaceholder = (host) => {
    const p = host.querySelector(".psom-placeholder");
    if (p) p.style.display = "none";
  };

  // MAIN: append only to .shop-row
  const appendMain = (anchor, items) => {
    const scroller = anchor.closest(".shop-scroller");
    const row = scroller && scroller.querySelector(".shop-row");
    if (!row) return;

    let added = 0;
    for (const it of items) {
      if (!it.thumb) continue;
      if (row.querySelector(`[data-url="${it.url}"]`)) continue;

      const a = document.createElement("a");
      a.className = "shop-card";
      a.dataset.url = it.url;
      a.href = it.url;
      a.style.background = `center/cover no-repeat url("${it.thumb}")`;

      const cap = document.createElement("div");
      cap.className = "shop-card-cap";
      cap.textContent = it.title;

      a.appendChild(cap);
      row.appendChild(a);

      if (++added >= MAIN_BATCH) break;
    }
  };

  // RIGHT: append only to .ad-section .ad-list (핵심 수정)
  const appendRight = (anchor, items) => {
    const section = anchor.closest(".ad-section");
    const list = section && section.querySelector(".ad-list");
    if (!list) return;

    if (!items.length) {
      ensurePlaceholder(anchor);
      return;
    }

    hidePlaceholder(anchor);

    let added = 0;
    for (const it of items) {
      if (!it.thumb) continue;
      if (list.querySelector(`[data-url="${it.url}"]`)) continue;

      const a = document.createElement("a");
      a.className = "ad-box";
      a.dataset.url = it.url;
      a.href = it.url;

      const t = document.createElement("div");
      t.className = "thumb";
      t.style.background = `center/cover no-repeat url("${it.thumb}")`;

      a.appendChild(t);
      list.appendChild(a);

      if (++added >= RIGHT_BATCH) break;
    }
  };

  async function boot() {
    let data;
    try {
      const r = await fetch(FEED_URL, { cache: "no-store" });
      data = await r.json();
    } catch { return; }

    const sections = indexSections(data);

    MAIN_KEYS.forEach(k => {
      const a = document.querySelector(`[data-psom-key="${k}"]`);
      if (!a) return;
      const items = (sections[k] || []).map(normalize);
      if (!items.length) { ensurePlaceholder(a); return; }
      appendMain(a, items);
    });

    RIGHT_KEYS.forEach(k => {
      const a = document.querySelector(`[data-psom-key="${k}"]`);
      if (!a) return;
      const items = (sections[k] || []).map(normalize);
      appendRight(a, items);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
