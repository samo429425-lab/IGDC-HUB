// tour-rightpanel-automap FINAL STABLE
// - HTML에 이미 존재하는 .ad-box 100개에 데이터만 주입
// - DOM 새로 생성하지 않음
// - 모바일 레일 제거
// - innerHTML 사용 안 함
// - 20~30년 장기 안정 구조

(function () {
  "use strict";

  if (window.__TOUR_AUTOMAP_STABLE__) return;
  window.__TOUR_AUTOMAP_STABLE__ = true;

  const HUB = "tour";
  const SNAPSHOT_URL = "/data/tour-snapshot.json";
  const FEED_URL = "/.netlify/functions/feed-tour?limit=100";
  const RIGHT_PANEL_ID = "rightAutoPanel";
  const PLACEHOLDER_IMG = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

  function byId(id) { return document.getElementById(id); }

  function pick(it, keys) {
    for (const k of keys) {
      const v = it && it[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function normalizeItems(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr) {
      const title = pick(it, ["title", "name", "label"]);
      const thumb = pick(it, ["thumb", "image", "thumbnail", "img", "photo", "cover"]);
      const link = pick(it, ["link", "url", "href"]) || "#";
      if (!title || !thumb) continue;
      out.push({ title, thumb, link });
    }
    return out;
  }

  async function fetchJson(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  function renderRightPanel(items) {
    const panel = byId(RIGHT_PANEL_ID);
    if (!panel) return;

    const slots = panel.querySelectorAll(".ad-box");
    if (!slots.length) return;

    slots.forEach((slot, i) => {
      const it = items[i];

      const a = slot.querySelector("a");
      const img = slot.querySelector("img");
      const cap = slot.querySelector(".tour-card-title");

      if (it) {
        if (img) img.src = it.thumb || PLACEHOLDER_IMG;
        if (cap) cap.textContent = it.title || "";
        if (a) {
          a.href = it.link || "#";
          if (it.link && it.link !== "#") {
            a.target = "_blank";
            a.rel = "noopener";
          } else {
            a.removeAttribute("target");
            a.removeAttribute("rel");
          }
        }
      } else {
        // 데이터 없으면 더미 유지 (HTML 기본 구조 유지)
        if (img) img.src = PLACEHOLDER_IMG;
        if (cap) cap.textContent = "";
        if (a) a.href = "#";
      }
    });
  }

  async function run() {
    let items = [];

    // 1) snapshot 우선
    const snap = await fetchJson(SNAPSHOT_URL);
    if (snap && snap.meta && snap.meta.hub === HUB && Array.isArray(snap.items)) {
      items = normalizeItems(snap.items);
    }

    // 2) feed fallback
    if (!items.length) {
      const feed = await fetchJson(FEED_URL);
      items = feed && Array.isArray(feed.items)
        ? normalizeItems(feed.items)
        : [];
    }

    renderRightPanel(items);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(run, 0);
  } else {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    window.addEventListener("load", run, { once: true });
  }
})();