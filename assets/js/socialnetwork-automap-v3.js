// socialnetwork-automap.v3.fixed.js
// 목적:
// 1) Social 메인 9섹션은 최신 저장 Social Release만 읽는다. Distribution Snapshot을 fallback으로 쓰지 않는다.
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
  const MAIN_ROWS = 9;
  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 20;
  const RIGHT_LIMIT = 100;
  const MANAGED_MAIN_KEYS = new Set([
    "social-youtube",
    "social-instagram",
    "social-tiktok",
    "social-facebook",
    "social-wechat",
    "social-weibo",
    "social-pinterest",
    "social-reddit",
    "social-twitter",
  ]);
  const mainRenderTokens = new WeakMap();

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
          (it.affiliateOutboundUrl ||
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
          it.thumbnailUrl),
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

  async function loadCurrentSnapshot() {
    try {
      const res = await fetch(
        CURRENT_SNAPSHOT_URL + "?_=" + encodeURIComponent(Date.now()),
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
    return qsa("a.card", gridEl);
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
    const cards = getMainSlots(gridEl);
    if (!cards.length) return;

    let maxTitleHeight = 0;
    cards.forEach(function (card) {
      const title = qs(".title", card);
      const desc = qs(".desc", card);
      const meta = qs(".meta", card);
      const cta = qs(".cta", card);

      if (desc) {
        // Keep the text in the DOM for the detail/full-screen viewer,
        // but do not expose supplier/production description on the front card.
        desc.style.display = "none";
      }
      if (meta) meta.style.flex = "1 1 auto";
      if (cta) cta.style.marginTop = "auto";
      if (title) {
        title.style.minHeight = "0px";
        maxTitleHeight = Math.max(maxTitleHeight, title.getBoundingClientRect().height);
      }
      card.style.minHeight = "0px";
    });

    if (maxTitleHeight > 0) {
      cards.forEach(function (card) {
        const title = qs(".title", card);
        if (title) title.style.minHeight = Math.ceil(maxTitleHeight) + "px";
      });
    }

    // Equalize the full card height within this SNS section so every CTA
    // sits on the same bottom line, based on that section's longest title.
    let maxCardHeight = 0;
    cards.forEach(function (card) {
      maxCardHeight = Math.max(maxCardHeight, card.getBoundingClientRect().height);
    });
    if (maxCardHeight > 0) {
      cards.forEach(function (card) {
        card.style.minHeight = Math.ceil(maxCardHeight) + "px";
      });
    }
  }

  function sampleLabelForSection(key) {
    const labels = {
      "social-youtube": "YouTube",
      "social-instagram": "Instagram",
      "social-tiktok": "TikTok",
      "social-facebook": "Facebook",
      "social-wechat": "WeChat",
      "social-weibo": "Weibo",
      "social-pinterest": "Pinterest",
      "social-reddit": "Reddit",
      "social-twitter": "X (Twitter)",
    };
    return labels[safeText(key)] || "SNS";
  }

  function snapshotSampleNumber(it, card) {
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
      pic.style.backgroundImage = "";
      pic.style.backgroundSize = "";
      pic.style.backgroundPosition = "";
      pic.textContent = label;
    }
  }

  function paintMainCard(card, it) {
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
    const title = pickTitle(it) || "Item";
    const desc = pickDesc(it) || " ";
    const thumb = pickThumb(it);

    card.href = url || "#";
    card.target = url && url !== "#" ? "_blank" : "_self";
    card.rel = "noopener";
    card.removeAttribute("data-dummy");

    const pic = qs(".pic", card);
    const metaTitle = qs(".title", card);
    const metaDesc = qs(".desc", card);

    if (metaTitle) metaTitle.textContent = title;
    if (metaDesc) {
      metaDesc.textContent = desc;
      metaDesc.style.display = "none";
    }

    if (pic) {
      if (thumb) {
        pic.textContent = "";
        pic.style.backgroundImage = "url('" + thumb.replace(/'/g, "%27") + "')";
        pic.style.backgroundSize = "cover";
        pic.style.backgroundPosition = "center";
      } else {
        pic.style.backgroundImage = "";
        pic.textContent = "•";
      }
    }
  }


  function mountMainRow(gridEl, items) {
    if (!gridEl) return;

    const raw = Array.isArray(items) ? items.filter(Boolean) : [];
    const displayItems = raw.slice(0, MAIN_LIMIT);

    // Snapshot is the sole owner of both real rows and SAMPLE rows. Trim stale
    // DOM cards to the exact snapshot length; never pad missing rows locally.
    let cards = getMainSlots(gridEl);
    for (let i = displayItems.length; i < cards.length; i++) {
      if (cards[i].parentNode) cards[i].parentNode.removeChild(cards[i]);
    }
    cards = getMainSlots(gridEl);

    function ensureCards(required) {
      cards = getMainSlots(gridEl);
      if (cards.length >= required) return cards;
      const frag = document.createDocumentFragment();
      for (let i = cards.length; i < required; i++) {
        const a = document.createElement("a");
        a.className = "card";
        a.href = "#";

        a.innerHTML = mainCardMarkup(gridEl);
        frag.appendChild(a);
      }
      gridEl.appendChild(frag);
      return getMainSlots(gridEl);
    }

    const scrollHost = gridEl.closest(".row-scroller") || gridEl;
    const job = { grid: gridEl, items: displayItems, offset: 0 };
    mainRenderTokens.set(scrollHost, job);

    function renderMore() {
      if (mainRenderTokens.get(scrollHost) !== job) return;
      const end = Math.min(job.offset + MAIN_BATCH, MAIN_LIMIT, job.items.length);
      cards = ensureCards(end);
      for (let i = job.offset; i < end; i++) {
        const it = job.items[i] || null;
        if (it) paintMainCard(cards[i], it);
      }
      job.offset = end;
      normalizeMainCardLayout(gridEl);
    }

    renderMore();
    if (scrollHost.dataset.igdcSocialBatchBound === "1") return;
    scrollHost.dataset.igdcSocialBatchBound = "1";
    scrollHost.addEventListener("scroll", function () {
      const current = mainRenderTokens.get(scrollHost);
      if (!current || current.offset >= Math.min(MAIN_LIMIT, current.items.length)) return;
      if (scrollHost.scrollLeft + scrollHost.clientWidth >= scrollHost.scrollWidth - 40) {
        const activeGrid = current.grid;
        const activeItems = current.items;
        mountMainRowContinue(activeGrid, activeItems, current, scrollHost);
      }
    }, { passive: true });
  }

  function mountMainRowContinue(gridEl, displayItems, job, scrollHost) {
    if (mainRenderTokens.get(scrollHost) !== job) return;
    const end = Math.min(job.offset + MAIN_BATCH, MAIN_LIMIT, displayItems.length);
    let cards = getMainSlots(gridEl);
    if (cards.length < end) {
      const frag = document.createDocumentFragment();
      for (let i = cards.length; i < end; i++) {
        const a = document.createElement("a");
        a.className = "card";
        a.href = "#";
        a.innerHTML = mainCardMarkup(gridEl);
        frag.appendChild(a);
      }
      gridEl.appendChild(frag);
      cards = getMainSlots(gridEl);
    }
    for (let i = job.offset; i < end; i++) {
      const it = displayItems[i] || null;
      if (it) paintMainCard(cards[i], it);
    }
    job.offset = end;
    normalizeMainCardLayout(gridEl);
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
      return !!(pickTitle(it).trim() && pickThumb(it).trim() && resolveItemUrl(it));
    }).slice(0, RIGHT_LIMIT);
  }

  function makeRightCard() {
    const box = document.createElement("div");
    box.className = "ad-box product-card";
    const a = document.createElement("a");
    box.appendChild(a);
    return box;
  }

  function paintRightCard(box, it, index) {
    if (!box || !it) return;
    const title = pickTitle(it) || "Item";
    const url = resolveItemUrl(it);
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
    a.target = isExternalUrl(url) ? "_top" : "_self";
    a.rel = "noopener";
    if (isExternalUrl(url)) a.setAttribute("data-igdc-external", "top");
    else a.removeAttribute("data-igdc-external");
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

  function mountRightPanel(panel, items) {
    if (!panel) return;
    const usable = rightUsableItems(items);

    // Match Network/Tour right-panel behavior. Once the Canonical/IP snapshot
    // has answered, stale "Loading" shells are not kept. No generic/global
    // product feed is substituted here.
    panel.innerHTML = "";
    if (!usable.length) return;

    const frag = document.createDocumentFragment();
    usable.forEach(function (it, index) {
      const box = makeRightCard();
      paintRightCard(box, it, index);
      frag.appendChild(box);
    });
    panel.appendChild(frag);
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
      const items = Array.isArray(raw)
        ? raw
        : Array.isArray(raw && raw.items)
          ? raw.items
          : [];
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

    mainRunInFlight = Promise.all([loadCurrentSnapshot(), loadCountryRoute()])
      .then(function (results) {
        const current = results[0];
        lastRoute = results[1] || routeFallback();

        // Prefer the durable stored Social release. If that readback is temporarily
        // unavailable, read the canonical Snapshot Engine output already published
        // at /data/social.snapshot.json. This is a read-only recovery path: it does
        // not create candidates, mutate SearchBank/Snapshot, or synthesize SAMPLE cards.
        if (!(current && current.snapshot)) {
          return fetchRightPanelSnapshot().then(function (canonicalSnapshot) {
            if (!canonicalSnapshot) {
              window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = {
                source: "stored_release_current+canonical_snapshot_engine_output",
                status: "both_readbacks_unavailable_preserve_existing_slots",
                loadedAt: new Date().toISOString(),
              };
              return false;
            }
            lastMainSnapshot = canonicalSnapshot;
            window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = {
              source: "canonical_snapshot_engine_output",
              status: "front_readback_recovered",
              url: RIGHT_SNAPSHOT_URL,
              loadedAt: new Date().toISOString(),
            };
            return renderMainSnapshot(lastMainSnapshot, lastRoute);
          });
        }

        lastMainSnapshot = current.snapshot;
        window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = current.pipeline;
        return renderMainSnapshot(lastMainSnapshot, lastRoute);
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
