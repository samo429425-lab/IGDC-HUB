/**
 * home-products-automap.v2.js
 * SAFE FINAL VERSION
 *
 * ✔ 기존 썸네일 절대 삭제 안 함
 * ✔ 데이터 있을 때만 append
 * ✔ 우측 패널 전용 로직 분리
 * ✔ 안내문 유지
 * ✔ 13개 언어 지원
 */

(function () {
  if (window.__HOME_AUTOMAP_SAFE__) return;
  window.__HOME_AUTOMAP_SAFE__ = true;

  const FEED_URL = "/.netlify/functions/feed?page=homeproducts";

  const MAIN_KEYS = ["home_1", "home_2", "home_3", "home_4", "home_5"];
  const RIGHT_KEYS = ["home_right_top", "home_right_middle", "home_right_bottom"];

  const MAIN_BATCH = 7;
  const RIGHT_BATCH = 5;

  const LANG = {
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
    vi: "Nội dung đang được chuẩn bị.",
    id: "Konten sedang disiapkan."
  };

  function getLang() {
    const v =
      localStorage.getItem("igdc_lang") ||
      document.documentElement.lang ||
      navigator.language ||
      "en";
    const k = v.toLowerCase().split("-")[0];
    return LANG[k] ? k : "en";
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
        "#"
    };
  }

  function indexSections(payload) {
    if (!payload) return {};
    if (payload.sections) return payload.sections;
    if (payload.itemsByKey) return payload.itemsByKey;
    return {};
  }

  function ensurePlaceholder(anchor) {
    if (anchor.querySelector(".psom-placeholder")) return;

    const div = document.createElement("div");
    div.className = "psom-placeholder";
    div.textContent = LANG[getLang()] || LANG.en;
    div.style.padding = "12px";
    div.style.textAlign = "center";
    div.style.background = "#f7f7f7";
    div.style.borderRadius = "10px";
    div.style.color = "#666";

    anchor.appendChild(div);
  }

  function hidePlaceholder(anchor) {
    const p = anchor.querySelector(".psom-placeholder");
    if (p) p.style.display = "none";
  }

  /* ================= MAIN ================= */

  function appendMain(anchor, items) {
    const scroller = anchor.closest(".shop-scroller");
    if (!scroller) return;

    const row = scroller.querySelector(".shop-row");
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

      added++;
      if (added >= MAIN_BATCH) break;
    }
  }

  /* ================= RIGHT ================= */

  function appendRight(anchor, items) {
    const section = anchor.closest(".ad-section");
    if (!section) return;

    const list = section.querySelector(".ad-list");
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

      const thumb = document.createElement("div");
      thumb.className = "thumb";
      thumb.style.background = `center/cover no-repeat url("${it.thumb}")`;

      a.appendChild(thumb);
      list.appendChild(a);

      added++;
      if (added >= RIGHT_BATCH) break;
    }
  }

  async function boot() {
    let data;
    try {
      const res = await fetch(FEED_URL, { cache: "no-store" });
      data = await res.json();
    } catch (e) {
      return;
    }

    const sections = indexSections(data);

    MAIN_KEYS.forEach(key => {
      const anchor = document.querySelector(`[data-psom-key="${key}"]`);
      if (!anchor) return;
      const items = (sections[key] || []).map(normalize);
      if (!items.length) {
        ensurePlaceholder(anchor);
        return;
      }
      appendMain(anchor, items);
    });

    RIGHT_KEYS.forEach(key => {
      const anchor = document.querySelector(`[data-psom-key="${key}"]`);
      if (!anchor) return;
      const items = (sections[key] || []).map(normalize);
      appendRight(anchor, items);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
