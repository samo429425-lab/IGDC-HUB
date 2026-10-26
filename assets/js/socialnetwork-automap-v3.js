// socialnetwork-automap.v3.fixed.js
// build: 20261026-seven-main-fast-first-paint-v3
// 목적:
// 1) Social 메인 6섹션은 최신 저장 Social Release만 읽는다. Distribution Snapshot을 fallback으로 쓰지 않는다.
// 2) rightPanel은 Home/Distribution/Network/Tour와 같은 Canonical Distribution/IP 경로만 읽어 표시한다.
// 3) 메인 Social과 rightPanel의 fetch/render/state를 완전히 분리해 어느 한쪽 지연/실패가 다른 쪽을 막지 않는다.
// 4) Social runtime readback은 rightPanel/social-maru를 절대 읽거나 덮지 않는다.

(function () {
  "use strict";

  // --- bootstrap guard ---
  if (window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__ === true) return;
  window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__ = true;

  // --- config ---
  const RIGHT_SNAPSHOT_URL = "/data/social.snapshot.json"; // Edge-routed Canonical Distribution/IP snapshot; rightPanel only
  const CURRENT_SNAPSHOT_URL = "/.netlify/functions/social-snapshot-current";
  const COUNTRY_ROUTE_URL = "/.netlify/functions/social-country-route";
  const MAIN_ROWS = 7;
  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 12; // first-screen content first; remaining slots are painted without geometry changes
  const RIGHT_LIMIT = 100;
  const RIGHT_BATCH = 12;
  const MANAGED_MAIN_KEYS = new Set([
    "social-youtube",
    "social-instagram",
    "social-tiktok",
    "social-facebook",
    "social-snapchat",
    "social-bilibili",
    "social-douyin",
  ]);
  const mainRenderTokens = new WeakMap();
  const mainSlotCache = new WeakMap();
  const rightRenderTokens = new WeakMap();
  let mainSampleSlotsReady = false;

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }
  function safeText(v) {
    return v == null ? "" : String(v);
  }
  function pickTitle(it) {
    return safeText(it && (it.title || it.name || it.text || it.label));
  }

  function pickUrl(it) {
    return (
      safeText(
        it &&
          (it.latestContentUrl ||
            it.latest_content_url ||
            it.sourceContentUrl ||
            it.source_content_url ||
            (it.social && it.social.latestContentUrl) ||
            it.viewerUrl ||
            it.permalink ||
            it.sourceUrl ||
            it.source_url ||
            it.affiliateOutboundUrl ||
            it.affiliate_outbound_url ||
            it.externalOutboundUrl ||
            it.external_outbound_url ||
            it.checkoutUrl ||
            it.paymentUrl ||
            it.contentUrl ||
            it.pageUrl ||
            it.internalUrl ||
            it.productUrl ||
            it.productLink ||
            it.detailUrl ||
            it.redirectUrl ||
            it.permalink ||
            it.path ||
            it.url ||
            it.href ||
            it.link ||
            ""),
      ) || "#"
    );
  }

  function pickThumb(it) {
    return safeText(
      it &&
        (it.thumb ||
          it.image ||
          it.thumbnail ||
          it.imageUrl ||
          it.thumbnailUrl ||
          it.imageOriginalUrl ||
          it.thumbnail_url),
    );
  }

  function pickDesc(it) {
    return safeText(
      it &&
        (it.description ||
          it.summary ||
          (it.source &&
            (it.source.platform || it.source.site || it.source.provider)) ||
          ""),
    );
  }

  function pickCreator(it) {
    return safeText(
      it &&
        (it.creatorName ||
          it.creator_name ||
          it.creator ||
          it.creatorHandle ||
          it.creator_handle ||
          it.author ||
          it.channelName ||
          it.publisher ||
          ""),
    ).trim();
  }

  function cardIdentity(it) {
    var creator = pickCreator(it);
    var desc = pickDesc(it).trim();
    var platform = safeText(it && (it.platform || (it.source && it.source.platform))).trim();
    var parts = [];
    if (creator) parts.push(creator);
    if (desc && desc.toLowerCase() !== creator.toLowerCase() && desc.toLowerCase() !== platform.toLowerCase()) {
      parts.push(desc);
    }
    return parts.join(" · ") || platform;
  }

  function pickProductId(it) {
    return safeText(
      it &&
        (it.productId ||
          it.product_id ||
          it.contentId ||
          it.content_id ||
          it.itemId ||
          it.item_id ||
          it.sku ||
          it.code ||
          it.id ||
          ""),
    ).trim();
  }

  function dedupeMainItems(items) {
    const seenIds = new Set();
    const seenUrls = new Set();
    const out = [];
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it) return;
      const id = pickProductId(it).toLowerCase();
      const url = pickUrl(it).trim().toLowerCase();
      const sample = isPlaceholderItem(it);
      if (!sample) {
        if (id && seenIds.has(id)) return;
        if (url && url !== "#" && seenUrls.has(url)) return;
      }
      if (id) seenIds.add(id);
      if (url && url !== "#") seenUrls.add(url);
      out.push(it);
    });
    return out;
  }

  function isExternalUrl(url) {
    return /^https?:\/\//i.test(safeText(url).trim());
  }

  function isInternalUrl(url) {
    url = safeText(url).trim();
    return (
      !!url &&
      (url.charAt(0) === "/" ||
        url.startsWith("./") ||
        url.startsWith("../") ||
        /^[^?#]+\.html(?:$|[?#])/i.test(url))
    );
  }

  function isBadPlaceholderUrl(url) {
    url = safeText(url).trim();
    if (!url || url === "#") return true;
    if (/^javascript:/i.test(url)) return true;
    if (/\/pages\/coming-soon\.html/i.test(url)) return true;
    if (/(?:^|\.)example\.com(?:[\/:?#]|$)/i.test(url)) return true;
    return false;
  }

  function isValidSecondUrl(url) {
    url = safeText(url).trim();
    if (isBadPlaceholderUrl(url)) return false;
    return isExternalUrl(url) || isInternalUrl(url);
  }

  function isPlaceholderItem(it) {
    if (!it) return true;

    const title = pickTitle(it).trim();
    const url = pickUrl(it).trim();
    const id = pickProductId(it);
    const type = safeText(it.type).trim().toLowerCase();
    const sourcePlatform = safeText(it && it.source && it.source.platform)
      .trim()
      .toLowerCase();

    if (type === "placeholder") return true;
    if (sourcePlatform === "placeholder") return true;
    if (/^ph_/i.test(id)) return true;
    if (
      title === "Loading…" ||
      title === "Loading..." ||
      title === "Loading" ||
      title === "RIGHT SAMPLE"
    )
      return true;
    if (isBadPlaceholderUrl(url) && !pickThumb(it).trim()) return true;

    return false;
  }

  function resolveItemUrl(it) {
    if (!it || isPlaceholderItem(it)) return "";

    const id = pickProductId(it);
    const explicitInternal = safeText(
      it &&
        (it.contentUrl ||
          it.pageUrl ||
          it.internalUrl ||
          it.detailPage ||
          it.detailUrl ||
          it.path ||
          ""),
    ).trim();

    if (
      isInternalUrl(explicitInternal) &&
      !isBadPlaceholderUrl(explicitInternal)
    ) {
      return explicitInternal;
    }

    // 우측 상품/콘텐츠 슬롯의 원칙: 실 ID가 있으면 IGDC 내부 원페이지를 우선 사용한다.
    if (id && !/^ph_/i.test(id)) {
      return "/content.html?id=" + encodeURIComponent(id);
    }

    const raw = pickUrl(it).trim();
    if (isValidSecondUrl(raw)) return raw;

    return "";
  }

  function resolveRightItemUrl(it) {
    if (!it || isPlaceholderItem(it)) return "";
    // Commercial right rail follows the administrator-verified product URL,
    // not a synthetic /content.html id that may not exist in the public snapshot.
    const direct = safeText(it && (
      it.affiliateOutboundUrl || it.affiliate_outbound_url ||
      it.externalOutboundUrl || it.external_outbound_url ||
      it.externalProductUrl || it.officialProductUrl || it.productUrl ||
      it.productPageUrl || it.detailUrl || it.checkoutUrl ||
      it.purchaseUrl || it.orderUrl || it.productLink || it.displayUrl ||
      it.sourceUrl || it.url || it.href || it.link || ""
    )).trim();
    if (isValidSecondUrl(direct)) return direct;
    const id = pickProductId(it);
    return id && !/^ph_/i.test(id) ? "/content.html?id=" + encodeURIComponent(id) : "";
  }

  function isRealItem(it) {
    return !!it;
  }

  function getSections(snapshot) {
    if (!snapshot) return null;

    const sec = snapshot?.pages?.social?.sections || snapshot?.sections || null;

    if (!sec) return null;

    return sec;
  }

  function languageKey(value) {
    var raw = safeText(value).replace(/_/g, "-").toLowerCase();
    if (raw === "zh-hans" || raw === "zh-cn" || raw === "zh-sg") return "zh";
    if (
      raw === "zh-hant" ||
      raw === "zh-tw" ||
      raw === "zh-hk" ||
      raw === "zh-mo"
    )
      return "zht";
    if (raw === "fil") return "tl";
    return raw.split("-")[0];
  }
  function routeFallback() {
    var lang =
      languageKey(
        (navigator.languages && navigator.languages[0]) ||
          navigator.language ||
          "en",
      ) || "en";
    return {
      countryCode: null,
      languages: [lang, "en"],
      source: "browser_language_fallback",
      ipStored: false,
    };
  }
  async function loadCountryRoute() {
    try {
      var res = await fetch(COUNTRY_ROUTE_URL, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("route");
      var data = await res.json();
      return data && data.ok === true ? data : routeFallback();
    } catch (_e) {
      return routeFallback();
    }
  }
  function listValue(value) {
    return Array.isArray(value)
      ? value
      : !value
        ? []
        : safeText(value).split(",");
  }
  function routeScore(item, route) {
    var social = (item && item.social) || {},
      countries = listValue(social.countryScopes || item.countryScopes).map(
        function (v) {
          return safeText(v).toUpperCase();
        },
      ),
      langs = listValue(
        social.languageScopes || item.languageScopes || item.language,
      ).map(languageKey),
      wanted = ((route && route.languages) || []).map(languageKey),
      country = safeText(route && route.countryCode).toUpperCase(),
      score = 0;
    if (country && countries.indexOf(country) >= 0) score += 120;
    else if (countries.length) score -= 60;
    var pos = -1;
    langs.some(function (lang) {
      pos = wanted.indexOf(lang);
      return pos >= 0;
    });
    if (pos >= 0) score += 16 - pos * 2;
    score +=
      Number((item && item.signals && item.signals.rotation_score) || 0) * 2 +
      Number((item && item.signals && item.signals.quality_score) || 0);
    return score;
  }
  function routedItems(snapshot, key, route) {
    var pool =
        snapshot &&
        snapshot.pages &&
        snapshot.pages.social &&
        snapshot.pages.social.candidatePool,
      list = Array.isArray(pool && pool[key]) ? pool[key] : [];
    if (!list.length) return null;
    return list
      .slice()
      .sort(function (a, b) {
        return (
          routeScore(b, route) - routeScore(a, route) ||
          safeText(a && a.id).localeCompare(safeText(b && b.id))
        );
      })
      .slice(0, MAIN_LIMIT);
  }

  async function fetchRightPanelSnapshot() {
    try {
      const res = await fetch(RIGHT_SNAPSHOT_URL, { cache: "no-store", priority: "high" });
      if (!res.ok) return null;
      return await res.json();
    } catch (_e) {
      return null;
    }
  }

  // Same load behavior as Network/Tour right panels: start the Canonical/IP
  // request immediately, share one in-flight promise, and never impose a
  // client-side timeout. A real HTTP/network failure may be retried later.
  let initialRightSnapshotPromise = null;
  function getInitialRightSnapshotPromise() {
    if (!initialRightSnapshotPromise) {
      initialRightSnapshotPromise = fetchRightPanelSnapshot();
    }
    return initialRightSnapshotPromise;
  }

  // Public Social main release only. Session-local projection avoids repeat
  // network/DB gating when a user reopens or refreshes the page; the current
  // release is still fetched asynchronously and wins on successful readback.
  const MAIN_FAST_CACHE = "igdc.social.mainRelease.v7";
  function readFastMain() {
    try {
      const raw = sessionStorage.getItem(MAIN_FAST_CACHE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.at || Date.now() - data.at > 20 * 60 * 1000) return null;
      if (!data.snapshot || !data.snapshot.pages || !data.snapshot.pages.social) return null;
      return data;
    } catch (_) { return null; }
  }
  function saveFastMain(current) {
    try {
      if (!current || !current.snapshot || !current.pipeline) return;
      sessionStorage.setItem(MAIN_FAST_CACHE, JSON.stringify({
        at: Date.now(), snapshot: current.snapshot,
        route: current.pipeline.route || {},
        releaseId: current.pipeline.releaseId || null,
        hash: current.pipeline.hash || null
      }));
    } catch (_) { /* storage disabled or quota: online flow remains intact */ }
  }

  async function loadCurrentSnapshot() {
    try {
      const res = await fetch(
        CURRENT_SNAPSHOT_URL + "?view=front&_=" + Date.now(),
        { cache: "no-store", credentials: "same-origin" },
      );
      if (!res.ok) return null;
      const payload = await res.json();
      if (!payload || payload.ok !== true || !payload.snapshot) return null;
      if (payload.hashVerified === false) return null;
      return {
        snapshot: payload.snapshot,
        pipeline: {
          source: "stored_release_current",
          status: "front_readback_passed",
          releaseId: payload.releaseId || null,
          hash: payload.hash || null,
          publicSlots: payload.publicSlots || null,
          route: payload.route || null,
          loadedAt: new Date().toISOString(),
        },
      };
    } catch (_e) {
      return null;
    }
  }

  function getMainSlots(gridEl) {
    if (!gridEl) return [];
    const cached = mainSlotCache.get(gridEl);
    if (cached && cached.length === MAIN_LIMIT && cached[0].isConnected) return cached;
    const cards = qsa("a.card", gridEl);
    if (cards.length >= MAIN_LIMIT) mainSlotCache.set(gridEl, cards);
    return cards;
  }

  function mainCtaLabel(gridEl) {
    const existing = qs("a.card .cta", gridEl);
    return safeText(existing && existing.textContent).trim() || "Open";
  }

  function mainCardMarkup(gridEl) {
    const label = mainCtaLabel(gridEl);
    return (
      '<div class="pic"></div>' +
      '<div class="meta">' +
      '<div class="title"></div>' +
      '<div class="desc"></div>' +
      '<div class="cta">' + label.replace(/[&<>"']/g, function (ch) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
      }) + '</div>' +
      '</div>'
    );
  }

  function normalizeMainCardLayout(gridEl) {
    if (!gridEl) return;
    // Performance policy: card geometry is owned by the existing CSS
    // (16:9 media + bounded 3-line title/meta). Do not read layout metrics
    // and write heights for every card: that forces synchronous reflow across
    // all six SNS rows and delays first paint on slower devices.
  }

  // Scoped to Social MAIN only. This never styles Distribution's rightPanel.
  // Cards keep the same number, dimensions and scroll positions as before.
  function ensureMainSampleCss() {
    const styleId = "igdc-social-main-sample-refined-v2";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"]{border-color:#e1e7ef;background:#fff;cursor:default;box-shadow:0 1px 4px rgba(20,35,60,.04)}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .pic{position:relative;isolation:isolate;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:8px;background:linear-gradient(135deg,#e9f1fa 0%,#f4f7fb 54%,#e8edf6 100%)!important;color:#586981!important;font-size:12px!important;font-weight:650;line-height:1.2!important;letter-spacing:.015em;text-align:center;overflow:hidden}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .pic::before{content:"▶";display:grid;place-items:center;width:39px;height:39px;border-radius:50%;font-size:13px;line-height:1;color:#718aa7;background:rgba(255,255,255,.82);border:1px solid rgba(130,155,188,.25);box-shadow:0 3px 12px rgba(35,62,98,.07);padding-left:2px;box-sizing:border-box}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .pic::after{content:"PREVIEW  ·  " attr(data-sample-slot);position:absolute;top:8px;left:10px;white-space:nowrap;color:#8390a2;letter-spacing:.10em;font-size:9px;font-weight:600}
.thumb-grid[data-psom-key="social-youtube"] a.card[data-sample="1"] .pic{background:linear-gradient(135deg,#f8ecec,#fbf7f7 60%,#f4e9ed)!important}
.thumb-grid[data-psom-key="social-instagram"] a.card[data-sample="1"] .pic{background:linear-gradient(135deg,#f5edf9,#f9f4f9 60%,#f4edf0)!important}
.thumb-grid[data-psom-key="social-tiktok"] a.card[data-sample="1"] .pic{background:linear-gradient(135deg,#e7f3f3,#f2f6f8 60%,#e9eef5)!important}
.thumb-grid[data-psom-key="social-snapchat"] a.card[data-sample="1"] .pic{background:linear-gradient(135deg,#f9f6e8,#fbfaf4 60%,#f4f1e5)!important}
.thumb-grid[data-psom-key="social-bilibili"] a.card[data-sample="1"] .pic{background:linear-gradient(135deg,#eaf3f9,#f4f8fb 60%,#e9f0f7)!important}
.thumb-grid[data-psom-key="social-douyin"] a.card[data-sample="1"] .pic{background:linear-gradient(135deg,#e9edf4,#f5f6f9 60%,#e9edf2)!important}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .meta{min-height:0;color:#6a7585}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .title{display:block!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap!important;color:#66778d;font-size:11px!important;font-weight:550!important;line-height:1.4!important}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .cta{background:#e9eff7!important;color:#647996!important;font-weight:600!important;font-size:11px!important;letter-spacing:.01em}
.thumb-grid[data-psom-key^="social-"] a.card:not([data-sample="1"]) .pic[data-social-thumb-loading="1"]{position:relative;background:linear-gradient(120deg,#e8eef7,#f4f7fb,#e8eef7)!important;overflow:hidden}
.thumb-grid[data-psom-key^="social-"] a.card:not([data-sample="1"]) .pic[data-social-thumb-loading="1"]::after{content:"";position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%);border:1px solid #c8d5e6;border-radius:50%;background:rgba(255,255,255,.8);pointer-events:none}
.thumb-grid[data-psom-key^="social-"] a.card:not([data-sample="1"]) .pic[data-social-thumb-failed="1"]{font-size:12px!important;color:#718198;background:#f0f4f9!important}
.thumb-grid[data-psom-key="social-tiktok"] a.card:not([data-sample="1"]) .pic[data-social-thumb-failed="1"]{display:flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;flex-direction:column!important;gap:7px!important;padding:28px 8px 8px!important;box-sizing:border-box!important;font-size:11px!important;letter-spacing:.02em!important;line-height:1.3!important;color:#d9e7ee!important;background:linear-gradient(125deg,#17212f 0%,#173642 50%,#20273c 100%)!important;position:relative;overflow:hidden}
.thumb-grid[data-psom-key="social-tiktok"] a.card:not([data-sample="1"]) .pic[data-social-thumb-failed="1"]::before{content:"▶";position:absolute;top:22%;left:50%;transform:translateX(-50%);display:grid;place-items:center;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.10);color:#f3f8fc;font-size:13px;padding-left:2px;box-sizing:border-box}

`;
    document.head.appendChild(style);
  }

  function sampleLabelForSection(key) {
    const labels = {
      "social-youtube": "YouTube",
      "social-instagram": "Instagram",
      "social-tiktok": "TikTok",
      "social-facebook": "Facebook",
      "social-snapchat": "Snapchat",
      "social-bilibili": "Bilibili",
      "social-douyin": "Douyin",
    };
    return labels[safeText(key)] || "SNS";
  }

  function snapshotSampleNumber(it, card) {
    // The 700 prebuilt cards already have stable numbers; avoid a full-grid
    // query + indexOf on every SAMPLE repaint (quadratic work on slow phones).
    if (card && card.dataset && card.dataset.socialSlotNo) {
      return card.dataset.socialSlotNo;
    }
    const id = pickProductId(it);
    const m = String(id || "").match(/(?:_|:)(\d{1,3})$/);
    if (m) return String(Number(m[1]) || 1).padStart(3, "0");
    try {
      const grid = card && card.closest && card.closest("[data-psom-key]");
      const idx = grid ? getMainSlots(grid).indexOf(card) : -1;
      return String((idx >= 0 ? idx : 0) + 1).padStart(3, "0");
    } catch (_e) {
      return "001";
    }
  }

  function paintSnapshotSampleCard(card, it) {
    if (!card || !it) return;
    const grid = card.closest && card.closest("[data-psom-key]");
    const key = safeText(grid && grid.getAttribute("data-psom-key"));
    const label = sampleLabelForSection(key);
    const number = snapshotSampleNumber(it, card);

    card.href = "#";
    card.target = "_self";
    card.rel = "noopener";
    card.dataset.sample = "1";
    card.dataset.snapshotSample = "1";
    card.removeAttribute("data-dummy");

    const pic = qs(".pic", card);
    const metaTitle = qs(".title", card);
    const metaDesc = qs(".desc", card);
    if (metaTitle) metaTitle.textContent = label + " · SAMPLE " + number;
    if (metaDesc) {
      metaDesc.textContent = pickDesc(it) || "Snapshot sample slot";
      metaDesc.style.display = "none";
    }
    if (pic) {
      delete pic.dataset.socialThumbLoading;
      delete pic.dataset.socialThumbFailed;
      pic.style.backgroundImage = "";
      pic.style.backgroundSize = "";
      pic.style.backgroundPosition = "";
      while (pic.firstChild) pic.removeChild(pic.firstChild);
      pic.dataset.sampleSlot = number;
      pic.textContent = label;
    }
  }

  function cleanCardTitle(it, platform) {
    var title = pickTitle(it).trim();
    var desc = safeText(it && (it.description || it.summary)).trim();
    if (/^(instagram|instagram\s*[·-]\s*reel|tiktok|tiktok\s*[·-]\s*video|facebook|facebook\s*[·-]\s*post)$/i.test(title)) {
      title = safeText(it && (it.creatorName || it.creator || it.creatorHandle)).trim() || title;
    }
    // Search/oEmbed providers sometimes prefix a useful title with metrics.
    title = title.replace(/^\s*[\d,.]+\s*[kmb]?\s*likes?\s*,\s*[\d,.]+\s*comments?\s*[-–—:]\s*/i, "");
    if (!title && desc) title = desc.replace(/^\s*[\d,.]+\s*[kmb]?\s*likes?[^:]*:\s*/i, "");
    if (!title) title = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Social";
    return title.replace(/\s+/g, " ").trim();
  }

  function invalidTikTokCover(value) {
    if (!value) return true;
    try {
      const uri = new URL(value);
      return /(?:\/slardar(?:-web)?\/|\/sdk-web\/|\/plugins?(?:\/|$)|\/tiktok-web-common[^/]*\/)/i.test(uri.pathname);
    } catch (_) { return true; }
  }

  function publicTikTokVideoUrl(value) {
    try {
      const uri = new URL(value);
      if (uri.protocol !== "https:") return false;
      const host = uri.hostname.toLowerCase();
      if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return true;
      if (!/(^|\.)tiktok\.com$/i.test(host)) return false;
      return /^\/@[^/]+\/video\/\d+\/?$/i.test(uri.pathname) ||
        /^\/(?:video|v|t)\/[^/]+/i.test(uri.pathname);
    } catch (_) { return false; }
  }

  function thumbnailRenderUrl(platform, contentUrl, thumb) {
    // Existing relay can resolve the original TikTok video by oEmbed/public
    // metadata even when a legacy Release has no usable thumbnail URL.
    if (!thumb && !(platform === "tiktok" && publicTikTokVideoUrl(contentUrl))) return "";
    if (["instagram", "tiktok", "facebook", "snapchat", "bilibili", "douyin"].indexOf(platform) < 0) return thumb;
    var q = new URLSearchParams({ platform: platform, url: contentUrl || "", thumb: thumb || "" });
    return "/.netlify/functions/social-thumbnail-proxy?" + q.toString();
  }

  function paintThumb(pic, platform, contentUrl, thumb, eager) {
    if (!pic) return;
    pic.style.backgroundImage = "";
    pic.style.backgroundSize = "";
    pic.style.backgroundPosition = "";
    while (pic.firstChild) pic.removeChild(pic.firstChild);
    const sourceThumb = platform === "tiktok" && invalidTikTokCover(thumb) ? "" : thumb;
    const proxied = thumbnailRenderUrl(platform, contentUrl, sourceThumb);
    function unavailable() {
      delete pic.dataset.socialThumbLoading;
      pic.dataset.socialThumbFailed = "1";
      // A clearly labelled graphic placeholder remains if the provider denies
      // preview metadata. Do not invent video artwork or block a valid link.
      if (platform === "tiktok") {
        const card = pic.closest('a.card');
        const titleText = safeText(card && card.querySelector('.title') && card.querySelector('.title').textContent).trim();
        pic.textContent = '';
        const play = document.createElement('span');
        play.textContent = '▶';
        play.style.cssText = 'font-size:20px;color:#a6ecf2;line-height:1';
        const cap = document.createElement('span');
        cap.textContent = (titleText || '공개 동영상').slice(0, 65);
        cap.style.cssText = 'font-size:11px;line-height:1.45;max-width:92%;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden';
        const note = document.createElement('span');
        note.textContent = 'TikTok · 영상 미리보기 확인 중';
        note.style.cssText = 'font-size:9px;opacity:.70';
        pic.append(play,cap,note);
      } else {
        pic.textContent = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : '•';
      }
    }
    if (!sourceThumb && !proxied) { unavailable(); return; }
    pic.dataset.socialThumbLoading = '1';
    delete pic.dataset.socialThumbFailed;
    var img = document.createElement("img");
    img.alt = "";
    img.style.opacity = "0";
    img.addEventListener("load", function () {
      if (img.parentNode !== pic) return;
      delete pic.dataset.socialThumbLoading;
      img.style.opacity = "1";
    });
    // Only first on-screen cards receive eager network priority. Every other
    // thumbnail remains lazy, avoiding a 700-image request storm.
    img.loading = eager ? "eager" : "lazy";
    if (eager) { try { img.fetchPriority = "high"; } catch (_e) {} }
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.display = "block";
    img.style.objectFit = "cover";
    img.style.objectPosition = "center";
    img.addEventListener("error", function () {
      // Retry only a genuine image URL. Never fall back to the TikTok telemetry
      // SDK/plugin file or to an empty URL (which can reload the page itself).
      if (sourceThumb && img.dataset.triedDirect !== "1" && proxied !== sourceThumb) {
        img.dataset.triedDirect = "1";
        img.src = sourceThumb;
        return;
      }
      if (img.parentNode === pic) pic.removeChild(img);
      unavailable();
    });
    pic.appendChild(img);
    img.src = proxied || sourceThumb;
  }

  function paintMainCard(card, it, eagerThumb) {
    if (!card || !it) return;

    // SAMPLE ownership is upstream. Automap never creates sample rows; it only
    // renders a sample when that row actually arrived in the Social snapshot.
    if (isPlaceholderItem(it)) {
      paintSnapshotSampleCard(card, it);
      return;
    }

    card.removeAttribute("data-sample");
    card.removeAttribute("data-snapshot-sample");

    const url = pickUrl(it);
    const platform = safeText(it && (it.platform || (it.social && it.social.platform) || (it.source && it.source.platform))).toLowerCase().replace(/^social-/, "");
    const title = cleanCardTitle(it, platform);
    const desc = cardIdentity(it) || " ";
    const rawThumb = pickThumb(it);
    const thumb = platform === "tiktok" && invalidTikTokCover(rawThumb) ? "" : rawThumb;

    const latestContentUrl = safeText(it && (it.latestContentUrl || it.latest_content_url || (it.social && it.social.latestContentUrl)));
    const viewerUrl = safeText(it && (it.viewerUrl || it.permalink || it.href || it.link));
    const embedUrl = safeText(it && (it.embedUrl || it.embed_url));

    card.href = url || "#";
    card.dataset.contentUrl = url || "#";
    card.dataset.socialUrl = url || "#";
    card.dataset.latestContentUrl = latestContentUrl || url || "";
    card.dataset.viewerUrl = viewerUrl || url || "";
    card.dataset.thumbnailUrl = thumb || "";
    card.dataset.embedUrl = embedUrl;
    card.dataset.profileFallback = it && it.social && it.social.profileFallback ? "1" : "0";
    // Viewer bridge intercepts normal clicks. _blank remains only as a fail-safe
    // when the bridge itself is unavailable, so a real video/post is never dead.
    card.target = url && url !== "#" ? "_blank" : "_self";
    card.rel = "noopener";
    card.removeAttribute("data-dummy");

    const pic = qs(".pic", card);
    const metaTitle = qs(".title", card);
    const metaDesc = qs(".desc", card);

    if (metaTitle) {
      metaTitle.textContent = title;
      metaTitle.style.display = "-webkit-box";
      metaTitle.style.webkitBoxOrient = "vertical";
      metaTitle.style.webkitLineClamp = "2";
      metaTitle.style.overflow = "hidden";
      metaTitle.style.whiteSpace = "normal";
      metaTitle.style.lineHeight = "1.35";
    }
    if (metaDesc) {
      // Grid cards stay clean and YouTube-like: thumbnail + concise title only.
      // The full provider description remains available inside the contained viewer.
      metaDesc.textContent = desc;
      metaDesc.style.display = "none";
    }

    // First-screen visibility is measured once per row in mountMainRow.
    // Reading getBoundingClientRect() for every real card caused forced reflows.
    paintThumb(pic, platform, url, thumb, !!eagerThumb);
  }


  // The main seven rows are permanent: 100 inexpensive SAMPLE cards per SNS.
  // This runs before any public Release/network/thumbnail response. Cards never
  // appear/disappear as the user scrolls: only their visible contents change.
  // The Distribution-owned right panel is not accessed by this code.
  function ensureMainSampleSlots() {
    if (mainSampleSlotsReady) return;
    ensureMainSampleCss();
    const grids = qsa('.thumb-grid[data-psom-key^="social-"]');
    if (!grids.length) return;
    grids.forEach(function (grid) {
      const key = grid.getAttribute('data-psom-key');
      if (!MANAGED_MAIN_KEYS.has(key)) return;
      const label = sampleLabelForSection(key);
      const existing = getMainSlots(grid);
      if (existing.length >= MAIN_LIMIT) return;
      // Parse one static fragment per row instead of creating/querying and
      // mutating each of the 700 cards individually on the critical first paint.
      const escapeSample = function (value) {
        return safeText(value).replace(/[&<>"']/g, function (ch) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
      };
      const safeLabel = escapeSample(label);
      const cardMarkup = mainCardMarkup(grid);
      const html = [];
      for (let i = existing.length; i < MAIN_LIMIT; i++) {
        const number = String(i + 1).padStart(3, '0');
        html.push('<a class="card" href="#" data-sample="1" data-snapshot-sample="1" ' +
          'data-social-slot-no="' + number + '" data-social-render-signature="sample" ' +
          'aria-label="' + safeLabel + ' SAMPLE ' + number + '">' +
          cardMarkup.replace('<div class="pic"></div>',
            '<div class="pic" data-sample-slot="' + number + '">' + safeLabel + '</div>')
          .replace('<div class="title"></div>',
            '<div class="title">' + safeLabel + ' · ' + number + '</div>')
          .replace('<div class="desc"></div>',
            '<div class="desc" style="display:none"></div>') + '</a>');
      }
      // Existing slot and scroll-button geometry is preserved unchanged.
      grid.insertAdjacentHTML('beforeend', html.join(''));
      mainSlotCache.set(grid, qsa('a.card', grid));
    });
    mainSampleSlotsReady = grids.filter(function (g) {
      return MANAGED_MAIN_KEYS.has(g.getAttribute('data-psom-key'));
    }).every(function (g) { return getMainSlots(g).length >= MAIN_LIMIT; });
  }

  function mountMainRow(gridEl, items) {
    if (!gridEl) return;
    ensureMainSampleSlots();
    const displayItems = (Array.isArray(items) ? items.filter(Boolean) : []).slice(0, MAIN_LIMIT);
    const cards = getMainSlots(gridEl);
    const scrollHost = gridEl.closest('.row-scroller') || gridEl;
    const key = gridEl.getAttribute('data-psom-key');
    const label = sampleLabelForSection(key);
    // One geometry read per row instead of a layout read for every content card.
    const rowRect = scrollHost.getBoundingClientRect && scrollHost.getBoundingClientRect();
    const rowNearScreen = !!(rowRect && rowRect.bottom > -80 &&
      rowRect.top < (window.innerHeight || 800) + 360);
    const job = { grid: gridEl, cards: cards, items: displayItems, painted: new Set(), offset: 0 };
    mainRenderTokens.set(scrollHost, job);

    function repaint(index) {
      if (index < 0 || index >= MAIN_LIMIT || job.painted.has(index)) return;
      const card = cards[index];
      if (!card) return;
      const item = displayItems[index];
      if (!item || isPlaceholderItem(item)) {
        if (card.dataset.sample !== '1') {
          paintSnapshotSampleCard(card, item || {
            type: 'placeholder', id: 'ph_' + (index + 1), title: label + ' SAMPLE',
            source: { platform: 'placeholder' }
          });
          card.dataset.socialRenderSignature = 'sample';
          card.removeAttribute('data-content-url');
          card.removeAttribute('data-social-url');
          card.removeAttribute('data-latest-content-url');
          card.removeAttribute('data-viewer-url');
          card.removeAttribute('data-thumbnail-url');
          card.removeAttribute('data-embed-url');
          card.setAttribute('aria-label', label + ' SAMPLE ' + (index + 1));
        }
      } else {
        // ID alone is insufficient: published thumbnail/title changes must paint.
        const signature = [pickProductId(item), pickUrl(item), pickTitle(item),
          pickThumb(item), pickDesc(item), pickCreator(item),
          safeText(item.embedUrl || item.embed_url)].join('\u001f');
        if (card.dataset.socialRenderSignature !== signature || card.dataset.sample === '1') {
          paintMainCard(card, item, rowNearScreen && index < 4);
          card.dataset.socialRenderSignature = signature;
          card.setAttribute('aria-label', pickTitle(item) || label);
        }
      }
      job.painted.add(index);
    }

    function visiblePriority() {
      const width = cards[0] && cards[0].offsetWidth || scrollHost.clientWidth || 240;
      const gap = 14;
      const first = Math.max(0, Math.floor(scrollHost.scrollLeft / (width + gap)) - 2);
      const count = Math.min(16, Math.ceil((scrollHost.clientWidth || width) / (width + gap)) + 5);
      for (let i = first; i < Math.min(MAIN_LIMIT, first + count); i++) repaint(i);
    }
    // Paint only the first visible contents synchronously; all 100 card slots
    // already exist, so deferred work cannot open/collapse an SNS section.
    visiblePriority();
    for (let i = 0; i < Math.min(MAIN_BATCH, MAIN_LIMIT); i++) repaint(i);

    function paintRest() {
      if (mainRenderTokens.get(scrollHost) !== job) return;
      // The 100 slot nodes already exist, so this pass only changes content.
      // Do not defer to requestIdleCallback (which may wait hundreds of ms).
      for (let n = 0; n < 20 && job.offset < MAIN_LIMIT; n++) repaint(job.offset++);
      if (job.offset < MAIN_LIMIT) scheduleMore();
    }
    function scheduleMore() {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(paintRest);
      } else {
        setTimeout(paintRest, 0);
      }
    }
    scheduleMore();

    if (scrollHost.dataset.igdcSocialBatchBound !== '1') {
      scrollHost.dataset.igdcSocialBatchBound = '1';
      scrollHost.addEventListener('scroll', function () {
        const active = mainRenderTokens.get(scrollHost);
        if (active && typeof active.paintVisible === 'function') active.paintVisible();
      }, { passive: true });
    }
    job.paintVisible = visiblePriority;
  }

  function ensureRightCardCss() {
    const id = "igdc-social-right-card-render-v2";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
[data-psom-key="rightPanel"] .ad-box.product-card{position:relative;line-height:normal!important;overflow:hidden!important;background:#fff!important;}
[data-psom-key="rightPanel"] .ad-box.product-card > a{position:relative;display:flex!important;flex-direction:column!important;width:100%;height:100%;line-height:normal!important;overflow:hidden;border-radius:inherit;text-decoration:none!important;background:#fff!important;}
[data-psom-key="rightPanel"] .ad-box.product-card > a > img.social-right-card-thumb{display:block;width:100%;height:auto!important;flex:1 1 auto!important;min-height:0!important;object-fit:contain;object-position:center;background:#fff;}
[data-psom-key="rightPanel"] .ad-box.product-card > a > .social-right-card-title{position:static!important;flex:0 0 auto!important;box-sizing:border-box;min-height:42px;max-height:52px;padding:7px 9px;color:#222!important;font-weight:600;font-size:.88rem;line-height:1.3;text-align:left;background:#fff!important;text-shadow:none!important;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
`;
    document.head.appendChild(style);
  }

  function getRightPanels() {
    return qsa('[data-psom-key="rightPanel"]');
  }

  function rightUsableItems(items) {
    return (Array.isArray(items) ? items : []).filter(function (it) {
      if (!it || isPlaceholderItem(it)) return false;
      return !!(pickTitle(it).trim() && pickThumb(it).trim() && resolveRightItemUrl(it));
    }).slice(0, RIGHT_LIMIT);
  }

  function makeRightCard() {
    const box = document.createElement("div");
    box.className = "ad-box product-card";
    const a = document.createElement("a");
    box.appendChild(a);
    return box;
  }

  // SOCIAL RIGHT RAIL ONLY: the same contained seller-detail viewer already
  // used by Distribution/Network. Never navigate the parent/top IGDC page.
  // Load lazily so the seven SNS content sections and their first paint stay
  // independent of the commercial right-panel viewer.
  const SOCIAL_RIGHT_VIEWER_SRC = '/assets/js/igdc-contained-external-viewer.js?v=20261011-commerce-contained-v2';
  const SOCIAL_RIGHT_VIEWER_ID = 'igdc-social-right-commerce-viewer-loader-v1';
  let socialRightViewerPromise = null;

  function ensureSocialRightViewer() {
    if (window.IGDCContainedViewer && Number(window.IGDCContainedViewer.version || 0) >= 10 &&
        typeof window.IGDCContainedViewer.open === 'function') {
      return Promise.resolve(window.IGDCContainedViewer);
    }
    if (socialRightViewerPromise) return socialRightViewerPromise;
    socialRightViewerPromise = new Promise(function (resolve, reject) {
      let script = document.getElementById(SOCIAL_RIGHT_VIEWER_ID);
      const finish = function () {
        const viewer = window.IGDCContainedViewer;
        if (viewer && Number(viewer.version || 0) >= 10 && typeof viewer.open === 'function') resolve(viewer);
        else reject(new Error('IGDC product detail viewer unavailable'));
      };
      if (script) {
        if (script.dataset.loaded === '1') { finish(); return; }
        script.addEventListener('load', finish, { once: true });
        script.addEventListener('error', function () { reject(new Error('IGDC product detail viewer load failed')); }, { once: true });
        return;
      }
      script = document.createElement('script');
      script.id = SOCIAL_RIGHT_VIEWER_ID;
      script.src = SOCIAL_RIGHT_VIEWER_SRC;
      script.async = true;
      script.addEventListener('load', function () { script.dataset.loaded = '1'; finish(); }, { once: true });
      script.addEventListener('error', function () { reject(new Error('IGDC product detail viewer load failed')); }, { once: true });
      (document.head || document.documentElement).appendChild(script);
    }).catch(function (error) {
      socialRightViewerPromise = null; // allow a later click to retry
      throw error;
    });
    return socialRightViewerPromise;
  }

  function openSocialRightProduct(url, label) {
    return ensureSocialRightViewer().then(function (viewer) {
      // A failed frame-policy check uses the existing IGDC contained relay;
      // external checkout sites retain their exact verified product URL.
      return viewer.open(url, { label: label, kind: 'commerce-product', pushHistory: true });
    }).catch(function (error) {
      try { console.warn('[IGDC][Social right] internal product viewer failed:', error); } catch (_) {}
      // Fail CLOSED for navigation: no _top, location.assign or automatic external tab.
      // An explicit retry remains possible without losing the IGDC social page.
      const id = 'igdc-social-right-viewer-notice';
      let notice = document.getElementById(id);
      if (!notice) {
        notice = document.createElement('div');
        notice.id = id;
        notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;z-index:2147483201;left:16px;right:16px;bottom:16px;max-width:540px;margin:auto;padding:12px 16px;background:#fff4d2;color:#17324d;border:1px solid #b58b3a;border-radius:8px;box-shadow:0 4px 22px #0003;font:14px system-ui';
        (document.body || document.documentElement).appendChild(notice);
      }
      notice.textContent = '상품 상세 화면을 열지 못했습니다. IGDC 페이지는 유지됩니다. 잠시 후 다시 선택해 주세요.';
      return false;
    });
  }

  function paintRightCard(box, it, index) {
    if (!box || !it) return;
    const title = pickTitle(it) || "Item";
    const url = resolveRightItemUrl(it);
    const productId = pickProductId(it);
    const thumb = pickThumb(it).trim();
    if (!url || !thumb) return;

    ensureRightCardCss();
    box.className = "ad-box product-card";
    box.removeAttribute("data-dummy");
    box.dataset.productId = productId;
    box.dataset.productTitle = title;
    box.dataset.productLink = url;
    box.dataset.productUrl = url;
    box.dataset.detailUrl = url;
    box.dataset.href = url;

    let a = qs("a", box);
    if (!a) {
      a = document.createElement("a");
      box.textContent = "";
      box.appendChild(a);
    }
    a.textContent = "";
    a.href = url;
    // Both real desktop and mobile right-rail cards must stay in the IGDC page.
    // The verified product destination is kept as href for accessibility and
    // intentional Ctrl/Cmd-click, but ordinary clicks open the contained viewer.
    a.target = "_self";
    a.rel = "noopener";
    a.removeAttribute("data-igdc-external");
    if (isExternalUrl(url)) {
      a.setAttribute('data-igdc-contained-product', '1');
      a.addEventListener('click', function (event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
            event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        openSocialRightProduct(url, title);
      }, false);
    } else {
      a.removeAttribute('data-igdc-contained-product');
    }
    a.dataset.productId = productId;
    a.dataset.productTitle = title;
    a.dataset.productLink = url;

    const img = document.createElement("img");
    img.className = "social-right-card-thumb";
    img.src = thumb;
    img.alt = title;
    const firstView = Number(index) >= 0 && Number(index) < 8;
    img.loading = firstView ? "eager" : "lazy";
    img.decoding = "async";
    if (firstView) {
      try { img.fetchPriority = "high"; } catch (_e) {}
    }
    a.appendChild(img);

    const cap = document.createElement("div");
    cap.className = "social-right-card-title";
    cap.textContent = title;
    a.appendChild(cap);
  }

  function rightScrollHost(panel) {
    if (!panel) return null;
    if (panel.id === "rpMobileGrid") return panel.closest("#rpMobileScroller") || panel.parentElement || panel;
    return panel;
  }

  function armRightObserver(job) {
    if (!job || !('IntersectionObserver' in window) || job.offset >= Math.min(RIGHT_LIMIT, job.items.length)) return;
    if (job.observer) job.observer.disconnect();
    const last = job.panel.lastElementChild;
    if (!last) return;
    job.observer = new IntersectionObserver(function (entries) {
      if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
      job.observer.disconnect();
      renderRightMore(job);
    }, { root: null, rootMargin: '600px', threshold: 0.01 });
    job.observer.observe(last);
  }

  function renderRightMore(job) {
    if (!job || rightRenderTokens.get(job.scrollHost) !== job) return;
    if (job.offset >= job.items.length || job.offset >= RIGHT_LIMIT) return;
    const end = Math.min(job.offset + RIGHT_BATCH, RIGHT_LIMIT, job.items.length);
    const frag = document.createDocumentFragment();
    for (let index = job.offset; index < end; index++) {
      const box = makeRightCard();
      paintRightCard(box, job.items[index], index);
      frag.appendChild(box);
    }
    job.panel.appendChild(frag);
    job.offset = end;
    armRightObserver(job);
  }

  function mountRightPanel(panel, items) {
    if (!panel) return;
    const usable = rightUsableItems(items);

    // Match Network/Tour right-panel behavior. Once the Canonical/IP snapshot
    // has answered, stale "Loading" shells are not kept. No generic/global
    // product feed is substituted here.
    panel.innerHTML = "";
    if (!usable.length) return;

    const scrollHost = rightScrollHost(panel);
    if (!scrollHost) return;
    const job = { panel: panel, scrollHost: scrollHost, items: usable, offset: 0 };
    rightRenderTokens.set(scrollHost, job);
    renderRightMore(job);

    if (scrollHost.dataset.igdcSocialRightBatchBound === "1") return;
    scrollHost.dataset.igdcSocialRightBatchBound = "1";
    scrollHost.addEventListener("scroll", function () {
      const current = rightRenderTokens.get(scrollHost);
      if (!current || current.offset >= Math.min(RIGHT_LIMIT, current.items.length)) return;
      const horizontal = scrollHost.scrollWidth > scrollHost.clientWidth + 2;
      const nearEnd = horizontal
        ? scrollHost.scrollLeft + scrollHost.clientWidth >= scrollHost.scrollWidth - 60
        : scrollHost.scrollTop + scrollHost.clientHeight >= scrollHost.scrollHeight - 60;
      if (nearEnd) renderRightMore(current);
    }, { passive: true });
  }

  let lastMainSnapshot = null;
  let lastRoute = routeFallback();
  let mainRunInFlight = null;
  let rightRunInFlight = null;
  let rightApplied = false;

  function renderMainSnapshot(snap, route) {
    const sections = getSections(snap);
    if (!sections) return false;

    const grids = document.querySelectorAll("[data-psom-key]");
    grids.forEach(function (grid) {
      const key = grid.getAttribute("data-psom-key");
      if (!key || !MANAGED_MAIN_KEYS.has(key)) return;

      // Front rendering consumes the Snapshot Engine's published section slots
      // exactly. candidatePool is administrative reserve/ranking context and must
      // never bypass the real+SAMPLE replacement state already decided upstream.
      const raw = sections[key];
      const sourceItems = Array.isArray(raw)
        ? raw
        : Array.isArray(raw && raw.items)
          ? raw.items
          : [];
      const items = dedupeMainItems(sourceItems);
      // Do not filter SAMPLE rows here. If Snapshot Engine sends a sample slot,
      // render it; if it sends nothing, clear the row. This makes SAMPLE slots
      // a real end-to-end pipeline diagnostic instead of a browser fallback.
      mountMainRow(grid, items.filter(Boolean));
    });

    window.__SOCIALNETWORK_AUTOMAP_V3_DONE__ = true;
    window.__IGDC_SOCIAL_COUNTRY_ROUTE__ = {
      countryCode: route.countryCode || null,
      languages: route.languages || [],
      source: route.source || "fallback",
    };
    return true;
  }

  function renderRightPanelSnapshot(snap) {
    // Strict ownership boundary: read ONLY rightPanel from the Edge-routed
    // Canonical Distribution/IP document. Social main rows in that document,
    // if present structurally, are deliberately ignored.
    const sections = getSections(snap);
    if (!sections) return false;
    const rightRaw = Array.isArray(sections.rightPanel)
      ? sections.rightPanel
      : Array.isArray(sections.rightPanel && sections.rightPanel.items)
        ? sections.rightPanel.items
        : Array.isArray(sections.rightPanel && sections.rightPanel.slots)
          ? sections.rightPanel.slots
          : [];
    getRightPanels().forEach(function (panel) { mountRightPanel(panel, rightRaw); });
    window.__IGDC_SOCIAL_RIGHTPANEL_PIPELINE__ = {
      source: RIGHT_SNAPSHOT_URL,
      owner: "distribution",
      scope: "canonical-ip-routed",
      loadedAt: new Date().toISOString(),
    };
    return true;
  }

  function runRightPanel() {
    if (rightApplied) return Promise.resolve(true);
    if (rightRunInFlight) return rightRunInFlight;

    rightRunInFlight = (async function () {
      const snap = await getInitialRightSnapshotPromise();
      if (!snap) {
        initialRightSnapshotPromise = null;
        return false;
      }
      renderRightPanelSnapshot(snap);
      rightApplied = true;
      return true;
    })().finally(function () {
      rightRunInFlight = null;
    });
    return rightRunInFlight;
  }

  function runMain() {
    if (mainRunInFlight) return mainRunInFlight;
    // Start the live Release fetch immediately, overlapping its network latency
    // with the initial 700 SAMPLE nodes and session-cache painting.
    const liveReleasePromise = loadCurrentSnapshot();
    ensureMainSampleSlots(); // independent of DB, country routing, and snapshots

    // One front read is enough. social-snapshot-current already resolves the
    // request country, so waiting for social-country-route as a second serverless
    // dependency only delays the six main rows. Browser language remains the
    // lightweight fallback for language ranking.
    const warm = readFastMain();
    if (warm) {
      const fallback = routeFallback();
      lastRoute = Object.assign({}, fallback, warm.route || {}, { source: "session_public_release_fast_path" });
      lastMainSnapshot = warm.snapshot;
      window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = {
        source: "session_public_release_fast_path", releaseId: warm.releaseId, status: "cached_repaint_then_verify"
      };
      renderMainSnapshot(warm.snapshot, lastRoute);
    }
    mainRunInFlight = liveReleasePromise
      .then(function (current) {
        const fallbackRoute = routeFallback();
        const releaseRoute = current && current.pipeline && current.pipeline.route || {};
        lastRoute = Object.assign({}, fallbackRoute, {
          countryCode: releaseRoute.countryCode || fallbackRoute.countryCode || null,
          worldRegion: releaseRoute.worldRegion || fallbackRoute.worldRegion || null,
          source: "stored_release_current_route"
        });

        // Prefer the durable stored Social release. If it is temporarily
        // unavailable, reuse the canonical snapshot request that the independent
        // Distribution-owned right panel already started. Never start a duplicate
        // multi-megabyte snapshot fetch from the Social main path.
        if (!(current && current.snapshot)) {
          // No Social Release: keep the 700 visible SAMPLE slots (or verified
          // session cache). Never wait for, or render Social main from, the
          // Distribution-owned right-panel request.
          window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = {
            source: warm && warm.snapshot ? 'session_public_release_fast_path' : 'main_sample_slots',
            status: 'front_release_unavailable_preserve_slots',
            loadedAt: new Date().toISOString()
          };
          return !!(warm && warm.snapshot);
        }

        lastMainSnapshot = current.snapshot;
        window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = current.pipeline;
        // If the verified stored release is identical to the session-painted
        // release in the same route, skip a second 700-card reconciliation.
        const releaseUnchanged = !!(warm && warm.hash && current.pipeline.hash &&
          warm.hash === current.pipeline.hash &&
          warm.releaseId === current.pipeline.releaseId &&
          safeText(warm.route && warm.route.countryCode) === safeText(releaseRoute.countryCode) &&
          safeText(warm.route && warm.route.worldRegion) === safeText(releaseRoute.worldRegion));
        if (releaseUnchanged) return true;
        const applied = renderMainSnapshot(lastMainSnapshot, lastRoute);
        // Persist after the visible card update; large JSON serialization before
        // painting used to block the browser main thread on each fresh release.
        if (applied) setTimeout(function () { saveFastMain(current); }, 0);
        return applied;
      })
      .catch(function (e) {
        console.error("[social-main-automap] fail", e);
        return false;
      })
      .finally(function () {
        mainRunInFlight = null;
      });

    return mainRunInFlight;
  }

  function boot() {
    // Start the Distribution/IP right-panel request first and independently,
    // exactly like Network/Tour. Social release lookup runs in parallel and can
    // neither delay nor overwrite the right panel.
    runRightPanel();
    runMain();
  }

  document.addEventListener('click', function (event) {
    const card = event.target && event.target.closest &&
      event.target.closest('.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"]');
    if (card) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);

  // A Social publication is a live Supabase Release, not a new HTML build.
  // Keep an already-open Social main page current when the administrator
  // publishes in another same-origin tab. This never refreshes the right panel.
  const SOCIAL_RELEASE_SIGNAL = "igdc.social.frontReleasePublished";
  let lastMainVisibilityCheck = 0;
  function refreshVisibleSocialMain(force) {
    if (document.visibilityState === "hidden") return;
    const now = Date.now();
    if (!force && now - lastMainVisibilityCheck < 15000) return;
    lastMainVisibilityCheck = now;
    runMain();
  }
  window.addEventListener("storage", function (event) {
    if (event.key === SOCIAL_RELEASE_SIGNAL && event.newValue) {
      lastMainVisibilityCheck = 0;
      refreshVisibleSocialMain(true);
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshVisibleSocialMain(false);
  });
  window.addEventListener("focus", function () { refreshVisibleSocialMain(false); });

  window.addEventListener("igdc:rightpanel:refresh", function () {
    rightApplied = false;
    initialRightSnapshotPromise = null;
    runRightPanel();
  });

  // Start the canonical right-panel request immediately; DOM events reuse it.
  getInitialRightSnapshotPromise();
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 0);
  } else {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    window.addEventListener("load", boot, { once: true });
  }
})();

/* ------------------------------------------------------------------
 * MARU Revenue AutoHook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Then load /assets/js/maru-revenue-autohook.js
 * - Do not change this automap's original rendering pipeline.
 * ------------------------------------------------------------------ */
(function loadMaruRevenueAutoHookForAutomap() {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function installIfReady() {
    try {
      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "front-automap",
        });
      }
    } catch (e) {
      console.warn("[MARU Revenue] autohook install skipped:", e);
    }
  }

  function loadScriptOnce(src, id, globalName, done) {
    var existing = document.getElementById(id);

    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    if (existing) {
      existing.addEventListener(
        "load",
        function () {
          if (typeof done === "function") done();
        },
        { once: true },
      );
      existing.addEventListener(
        "error",
        function () {
          console.warn("[MARU Revenue] failed to load:", src);
        },
        { once: true },
      );
      return;
    }

    var script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onload = function () {
      if (typeof done === "function") done();
    };
    script.onerror = function () {
      console.warn("[MARU Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(script);
  }

  if (window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__) {
    installIfReady();
    return;
  }

  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__ = true;

  loadScriptOnce(
    "/assets/js/maru-revenue-tracker.js",
    "maruRevenueTrackerScript",
    "MaruRevenueTracker",
    function () {
      loadScriptOnce(
        "/assets/js/maru-revenue-autohook.js",
        "maruRevenueAutoHookScript",
        "MaruRevenueAutoHook",
        installIfReady,
      );
    },
  );
})();
