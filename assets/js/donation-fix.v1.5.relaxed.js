/**
 * donation-fix.v1.9.relaxed.snapshot.js
 * RELAXED + SNAPSHOT-AWARE
 *
 * RULES (UNCHANGED CORE PHILOSOPHY)
 * 1) NEVER deletes real cards
 * 2) Shows placeholder only when NO real data
 * 3) Auto-removes placeholder when snapshot data arrives
 * 4) Does NOT render cards itself (fix layer only)
 *
 * SNAPSHOT HOOK
 * - Observes front.snapshot.json (donation scope)
 * - If snapshot.sections has any item, placeholder auto clears
 */

(function () {
  'use strict';
  if (window.__DON_FIX_V19__) return;
  window.__DON_FIX_V19__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';

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
  function t(){ return LANG_MAP[lang()] || LANG_MAP.en; }

  function hasRealCard(el) {
    return !!el.querySelector(
      "a.product-card, .thumb-card, .card, img[src]:not([src^='data:'])"
    );
  }

  function placeholderHTML() {
    return (
      '<div class="maru-empty" style="' +
      'padding:18px;border-radius:12px;background:#f7f7f7;text-align:center;' +
      'color:#666;font-size:14px;line-height:1.6;">' +
      '<div style="font-size:20px;margin-bottom:8px;">📦</div>' +
      '<div>' + t() + '</div></div>'
    );
  }

  function ensure(el) {
    if (!el) return;
    if (hasRealCard(el)) {
      const p = el.querySelector('.maru-empty');
      if (p) p.remove();
      return;
    }
    if (!el.querySelector('.maru-empty')) {
      el.insertAdjacentHTML('beforeend', placeholderHTML());
    }
  }

  function scan() {
    document.querySelectorAll(
      ".thumb-grid, .row-grid, .cards-row, .shopping-row, .shop-row, .hot-section, .media-grid"
    ).forEach(ensure);
  }

  async function snapshotHasData(){
    try{
      const r = await fetch(SNAPSHOT_URL, { cache:'no-store' });
      if (!r.ok) return false;
      const snap = await r.json();
      const secs = snap?.pages?.donation?.sections || {};
      return Object.keys(secs).some(k => Array.isArray(secs[k]) && secs[k].length);
    }catch(e){
      return false;
    }
  }

  async function snapshotGuard(){
    const ok = await snapshotHasData();
    if (ok) {
      document.querySelectorAll('.maru-empty').forEach(p => p.remove());
    }
  }

  function observe() {
    const mo = new MutationObserver(() => {
      clearTimeout(window.__don_fix_timer);
      window.__don_fix_timer = setTimeout(scan, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    scan();
    observe();
    snapshotGuard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();