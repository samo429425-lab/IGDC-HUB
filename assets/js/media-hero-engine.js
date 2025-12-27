/**
 * media-hero-engine.js (v2 - stable)
 * - Renders hero for: [data-psom-key="media-hero"]
 * - Uses feed.js (window.PSOM.fetchJSON or window.FeedAPI.get)
 * - Provides:
 *    - video/image auto render
 *    - autoplay/mute/loop (mobile-safe via muted + playsInline)
 *    - thumbnail strip selection (if multiple items)
 *    - like / recommend (localStorage persistence)
 *    - payment CTA (navigates to /index.html#payment OR emits event)
 *
 * Safety:
 *  - idempotent (won't double-init)
 *  - hard null checks
 *  - quiet fail on missing data
 */
(function () {
  if (window.__MEDIA_HERO_V2_LOADED__) return;
  window.__MEDIA_HERO_V2_LOADED__ = true;

  const HERO_KEY = "media-hero";
  const STORE_PREFIX = "psom:";
  const DEFAULT_CTA = {
    en: "Support",
    ko: "후원하기",
    ja: "支援する",
    zh: "支持",
    vi: "Ủng hộ",
    th: "สนับสนุน",
    ru: "Поддержать",
    de: "Unterstützen",
    fr: "Soutenir",
    es: "Apoyar",
    pt: "Apoiar",
    id: "Dukung",
    tr: "Destekle",
  };

  function getLang() {
    const l = (document.documentElement && document.documentElement.lang) || (navigator.language || "en");
    return (l || "en").toLowerCase().slice(0, 2);
  }

  function safeText(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }

  function pickThumb(item) {
    return item.thumb || item.thumbnail || item.image || item.poster || "";
  }

  function pickId(item) {
    return item.id || item.slug || item.url || item.video || item.image || item.title || JSON.stringify(item).slice(0, 80);
  }

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (_) {}
  }

  function cssOnce() {
    if (document.getElementById("media-hero-v2-style")) return;
    const s = document.createElement("style");
    s.id = "media-hero-v2-style";
    s.textContent = `
      .media-hero-wrapper{position:relative;overflow:hidden;border-radius:16px;min-height:240px}
      .media-hero-video,.media-hero-image{width:100%;height:100%;display:block;object-fit:cover;max-height:520px}
      .media-hero-overlay{position:absolute;left:0;right:0;bottom:0;padding:14px 14px 12px;
        background:linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0));
        color:#fff}
      .media-hero-overlay h2{margin:0 0 6px;font-size:20px;line-height:1.2}
      .media-hero-overlay p{margin:0 0 10px;font-size:14px;opacity:.92;max-width:900px}
      .media-hero-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .media-hero-actions button{border:0;border-radius:999px;padding:8px 12px;cursor:pointer}
      .media-hero-actions button.active{outline:2px solid rgba(255,255,255,.75)}
      .media-hero-thumbs{display:flex;gap:8px;overflow:auto;padding:10px 2px 0}
      .media-hero-thumbs img{width:72px;height:44px;object-fit:cover;border-radius:10px;cursor:pointer;opacity:.85}
      .media-hero-thumbs img.active{opacity:1;outline:2px solid rgba(0,0,0,.25)}
      @media (max-width:768px){
        .media-hero-video,.media-hero-image{max-height:360px}
        .media-hero-overlay h2{font-size:18px}
      }
    `;
    document.head.appendChild(s);
  }

  async function fetchHeroData() {
    const loader = (window.PSOM && typeof window.PSOM.fetchJSON === "function")
      ? window.PSOM.fetchJSON
      : (window.FeedAPI && typeof window.FeedAPI.get === "function")
        ? window.FeedAPI.get
        : null;

    if (!loader) throw new Error("feed.js loader missing");
    return loader(HERO_KEY);
  }

  function buildButton(label, onClick, isActive) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (isActive) b.classList.add("active");
    b.addEventListener("click", onClick);
    return b;
  }

  function renderItem(hero, item, stateKeyBase) {
    hero.innerHTML = "";
    hero.classList.add("media-hero-active");

    const wrapper = document.createElement("div");
    wrapper.className = "media-hero-wrapper";

    // Media
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "media-hero-media";

    if (item.video) {
      const v = document.createElement("video");
      v.className = "media-hero-video";
      v.src = item.video;
      v.muted = true;
      v.autoplay = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.controls = false;

      // Attempt play quietly; ignore failures (mobile policies)
      setTimeout(() => { try { v.play && v.play().catch(() => {}); } catch (_) {} }, 0);

      // If user taps video, toggle mute
      v.addEventListener("click", () => {
        v.muted = !v.muted;
        try { v.play && v.play().catch(() => {}); } catch (_) {}
      });

      mediaWrap.appendChild(v);
    } else if (item.image) {
      const img = document.createElement("img");
      img.className = "media-hero-image";
      img.src = item.image;
      img.alt = safeText(item.title);
      mediaWrap.appendChild(img);
    }

    wrapper.appendChild(mediaWrap);

    // Overlay
    const overlay = document.createElement("div");
    overlay.className = "media-hero-overlay";

    const title = document.createElement("h2");
    title.textContent = safeText(item.title);
    overlay.appendChild(title);

    if (item.description) {
      const p = document.createElement("p");
      p.textContent = safeText(item.description);
      overlay.appendChild(p);
    }

    const actions = document.createElement("div");
    actions.className = "media-hero-actions";

    // Like / Recommend persistence
    const lang = getLang();
    const itemId = pickId(item);
    const likeKey = STORE_PREFIX + "like:" + stateKeyBase + ":" + itemId;
    const recKey  = STORE_PREFIX + "rec:"  + stateKeyBase + ":" + itemId;

    const likeOn = lsGet(likeKey) === "1";
    const recOn  = lsGet(recKey) === "1";

    const likeBtn = buildButton("❤️ " + (lang === "ko" ? "좋아요" : "Like"), () => {
      const nowOn = !(lsGet(likeKey) === "1");
      lsSet(likeKey, nowOn ? "1" : "0");
      likeBtn.classList.toggle("active", nowOn);
      document.dispatchEvent(new CustomEvent("psom:like", { detail: { key: HERO_KEY, item } }));
    }, likeOn);

    const recBtn = buildButton("⭐ " + (lang === "ko" ? "추천" : "Recommend"), () => {
      const nowOn = !(lsGet(recKey) === "1");
      lsSet(recKey, nowOn ? "1" : "0");
      recBtn.classList.toggle("active", nowOn);
      document.dispatchEvent(new CustomEvent("psom:recommend", { detail: { key: HERO_KEY, item } }));
    }, recOn);

    actions.appendChild(likeBtn);
    actions.appendChild(recBtn);

    // Payment CTA
    const paymentDisabled = item.payment === false || item.pay === false;
    if (!paymentDisabled) {
      const cta = safeText(item.cta) || DEFAULT_CTA[lang] || DEFAULT_CTA.en;
      const payBtn = buildButton("💳 " + cta, () => {
        // Prefer event-based flow (index can listen and open modal/route)
        document.dispatchEvent(new CustomEvent("psom:payment", { detail: { source: "hero", item, key: HERO_KEY } }));
        document.dispatchEvent(new CustomEvent("open-payment", { detail: item }));

        // Route fallback
        const target = "/index.html#payment";
        if (window.location.pathname.endsWith("index.html") || window.location.pathname === "/") {
          // already on index; no forced navigation
          return;
        }
        window.location.href = target;
      }, false);
      actions.appendChild(payBtn);
    }

    overlay.appendChild(actions);
    wrapper.appendChild(overlay);
    hero.appendChild(wrapper);
  }

  function renderThumbs(root, items, onPick) {
    if (!items || items.length <= 1) return null;
    const strip = document.createElement("div");
    strip.className = "media-hero-thumbs";
    const thumbs = [];

    items.forEach((it, idx) => {
      const src = pickThumb(it);
      if (!src) return;
      const img = document.createElement("img");
      img.src = src;
      img.alt = safeText(it.title) || ("thumb-" + idx);
      img.addEventListener("click", () => onPick(idx));
      thumbs.push(img);
      strip.appendChild(img);
    });

    root.appendChild(strip);
    return thumbs;
  }

  function initOnce() {
    const hero = document.querySelector('[data-psom-key="' + HERO_KEY + '"]');
    if (!hero) return;
    if (hero.__mediaHeroInited) return;
    hero.__mediaHeroInited = true;

    cssOnce();

    fetchHeroData()
      .then(({ items }) => {
        if (!items || !items.length) return;

        let current = 0;
        const stateKeyBase = "media";

        // Render first
        renderItem(hero, items[current], stateKeyBase);

        // Thumbnails
        const thumbs = renderThumbs(hero, items, (idx) => {
          current = idx;
          renderItem(hero, items[current], stateKeyBase);
          // re-add thumbs after rerender
          const newThumbs = renderThumbs(hero, items, (i) => {
            current = i;
            renderItem(hero, items[current], stateKeyBase);
          });
          if (newThumbs) {
            newThumbs.forEach((t, i) => t.classList.toggle("active", i === current));
          }
        });

        if (thumbs) thumbs.forEach((t, i) => t.classList.toggle("active", i === current));
      })
      .catch(() => {
        // fail quietly (hero stays as-is)
      });
  }

  if (document.readyState !== "loading") initOnce();
  else document.addEventListener("DOMContentLoaded", initOnce);
})();
