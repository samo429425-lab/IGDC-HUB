/**
 * home-products-automap.v2.js (HOME + RIGHT PANEL DOM-fit)
 * Goals:
 *  - Do NOT modify home.html
 *  - When real items exist: hide placeholder blocks (shop-row / ad-box) and show real cards with image
 *  - When items missing: show localized "컨텐츠 준비 중입니다" (12 langs), else fallback to EN
 *  - Keys (home.html data-psom-key): home_1..home_5, home_right_top/middle/bottom
 *
 * Data source:
 *  - /.netlify/functions/feed?page=homeproducts   -> { itemsByKey: { home_1:[...], ... } } OR flat map
 *  - Fallback: /.netlify/functions/feed?page=<key> for each key
 */
(function () {
  "use strict";
  if (window.__HOME_AUTOMAP_V2__) return;
  window.__HOME_AUTOMAP_V2__ = true;

  const FEED_BULK = "/.netlify/functions/feed?page=homeproducts";
  const FEED_ONE = (key) => "/.netlify/functions/feed?page=" + encodeURIComponent(key);

  const MAIN_KEYS = ["home_1","home_2","home_3","home_4","home_5"];
  const RIGHT_KEYS = ["home_right_top","home_right_middle","home_right_bottom"];
  const ALL_KEYS = MAIN_KEYS.concat(RIGHT_KEYS);

  const EMPTY_I18N = {
    DE: "Inhalt wird vorbereitet.",
    EN: "Content is being prepared.",
    ES: "El contenido está en preparación.",
    FR: "Le contenu est en préparation.",
    ID: "Konten sedang dipersiapkan.",
    JA: "コンテンツを準備中です。",
    KO: "컨텐츠 준비 중입니다.",
    PT: "O conteúdo está sendo preparado.",
    RU: "Контент готовится.",
    TH: "กำลังเตรียมเนื้อหาอยู่",
    TR: "İçerik hazırlanıyor.",
    VI: "Nội dung đang được chuẩn bị.",
    ZH: "内容正在准备中。"
  };

  function guessLang() {
    try {
      const l = (document.documentElement.getAttribute("lang") || "").trim();
      if (l) return l;
    } catch (_) {}
    // index.html might set window.__IGDC_LANG or similar
    try {
      const w = (window.__IGDC_LANG || window.IGDC_LANG || "").trim();
      if (w) return w;
    } catch (_) {}
    return "ko";
  }

  function emptyText() {
    const raw = String(guessLang() || "en").toUpperCase();
    // normalize (e.g., "ko-KR" -> "KO")
    const k = raw.split("-")[0];
    if (EMPTY_I18N[k]) return EMPTY_I18N[k];
    // for "other 8 languages" rule -> EN
    return EMPTY_I18N.EN;
  }

  function safeText(s) {
    return (s == null ? "" : String(s))
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function pick(o, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = o && o[keys[i]];
      if (v != null && String(v).trim() !== "") return v;
    }
    return "";
  }

  function normalizeItem(x) {
    if (!x || typeof x !== "object") return null;
    const title = safeText(pick(x, ["title","name","label"]));
    const href  = String(pick(x, ["url","href","link"]) || "#").trim() || "#";
    const img   = String(pick(x, ["image","img","thumb","thumbnail","photo"]) || "").trim();
    const price = safeText(pick(x, ["price","amount"]));
    const cur   = safeText(pick(x, ["currency"]) || "");
    const cta   = safeText(pick(x, ["cta","buttonText"]) || "");
    return { title, href, img, price, cur, cta };
  }

  function buildCard(it) {
    const img = it.img
      ? '<div class="thumb-img"><img loading="lazy" decoding="async" src="' + it.img + '" alt=""/></div>'
      : '<div class="thumb-img thumb-img--empty"></div>';
    const price = it.price ? '<div class="thumb-price">' + it.price + (it.cur ? " " + it.cur : "") + "</div>" : "";
    const cta = it.cta ? '<div class="thumb-cta">' + it.cta + "</div>" : "";
    return (
      '<a class="thumb-card" href="' + it.href + '" target="_blank" rel="noopener noreferrer">' +
        img +
        '<div class="thumb-meta">' +
          '<div class="thumb-title">' + (it.title || "") + "</div>" +
          price +
          cta +
        "</div>" +
      "</a>"
    );
  }

  function buildEmptyBlock() {
    return '<div class="thumb-empty" role="note">' + safeText(emptyText()) + "</div>";
  }

  function normalizeFeedPayload(json) {
    // Accept:
    // 1) { itemsByKey: { home_1:[...], ... } }
    // 2) { home_1:[...], home_2:[...] }
    // 3) { data: { itemsByKey: ... } }
    if (!json) return {};
    if (json.data && typeof json.data === "object") json = json.data;

    if (json.itemsByKey && typeof json.itemsByKey === "object") return json.itemsByKey;
    if (json.sections && typeof json.sections === "object") return json.sections;

    // direct map heuristic
    const out = {};
    for (const k of ALL_KEYS) {
      if (Array.isArray(json[k])) out[k] = json[k];
    }
    return out;
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store", credentials: "omit" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP_" + r.status);
        return r.json();
      });
  }

  function fetchBulk() {
    return fetchJson(FEED_BULK)
      .then(normalizeFeedPayload)
      .catch(() => ({}));
  }

  function fetchOne(key) {
    return fetchJson(FEED_ONE(key))
      .then((j) => {
        // accept array or {items:[]}
        if (Array.isArray(j)) return j;
        if (j && Array.isArray(j.items)) return j.items;
        if (j && j.data && Array.isArray(j.data.items)) return j.data.items;
        return [];
      })
      .catch(() => []);
  }

  // --- DOM helpers (HOME MAIN) ---
  function findMainWrapByKey(key) {
    const host = document.querySelector('[data-psom-key="' + key + '"]');
    if (!host) return null;
    const wrap = host.closest(".shop-row-wrap");
    if (!wrap) return null;
    const row = wrap.querySelector(".shop-row");
    return { host, wrap, row };
  }

  // --- DOM helpers (RIGHT PANEL) ---
  function findRightWrapByKey(key) {
    const host = document.querySelector('[data-psom-key="' + key + '"]');
    if (!host) return null;
    const section = host.closest(".ad-section");
    const list = host.closest(".ad-list") || (section ? section.querySelector(".ad-list") : null);
    const boxes = list ? Array.prototype.slice.call(list.querySelectorAll(".ad-box")) : [];
    return { host, section, list, boxes };
  }

  function hideEl(el) { if (el) el.style.display = "none"; }
  function showEl(el) { if (el) el.style.display = ""; }

  function renderIntoHost(host, items) {
    if (!host) return;
    const norm = Array.isArray(items) ? items.map(normalizeItem).filter(Boolean) : [];
    if (norm.length === 0) {
      host.innerHTML = buildEmptyBlock();
      return;
    }
    host.innerHTML = norm.map(buildCard).join("");
  }

  function applyMain(key, items) {
    const ref = findMainWrapByKey(key);
    if (!ref) return;

    const has = Array.isArray(items) && items.length > 0;

    // Placeholder row exists in HTML; ensure real data "wins"
    if (ref.row) {
      if (has) hideEl(ref.row);
      else showEl(ref.row);
    }

    // Render real cards (or empty message) into host
    renderIntoHost(ref.host, items);
  }

  function applyRight(key, items) {
    const ref = findRightWrapByKey(key);
    if (!ref) return;

    const has = Array.isArray(items) && items.length > 0;

    // Right panel uses .ad-box placeholders.
// - If real data exists: hide placeholders (so cards are not duplicated)
// - If data missing: hide placeholders too and show the localized empty message (avoid gray blanks)
    if (ref.boxes && ref.boxes.length) {
      for (const b of ref.boxes) {
        hideEl(b);
      }
    }

    renderIntoHost(ref.host, items);
  }

  function applyAll(map) {
    for (const k of MAIN_KEYS) applyMain(k, map[k] || []);
    for (const k of RIGHT_KEYS) applyRight(k, map[k] || []);
  }

  function load() {
    // 1) Try bulk
    fetchBulk().then((map) => {
      // if bulk missing some keys, backfill with per-key fetch
      const missing = ALL_KEYS.filter((k) => !Array.isArray(map[k]));
      if (missing.length === 0) {
        applyAll(map);
        return;
      }
      const tasks = missing.map((k) => fetchOne(k).then((arr) => (map[k] = arr)));
      Promise.all(tasks).then(() => applyAll(map));
    });
  }

  function boot() {
    load();

    // Re-apply on lang changes or DOM updates
    const mo = new MutationObserver(() => {
      clearTimeout(window.__home_automap_t);
      window.__home_automap_t = setTimeout(load, 250);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // If a global language switcher fires a custom event, listen
    window.addEventListener("IGDC_LANG_CHANGED", () => load());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
