// socialnetwork-automap.v3.fixed.js
// 목적:
// 1) social.snapshot.json 실데이터가 있으면 메인 9섹션 + 우측 패널에 꽂는다.
// 2) 실데이터가 없으면 기존 HTML/더미를 절대 지우지 않는다.
// 3) key는 하드코딩 최소화: HTML의 data-psom-key를 그대로 읽는다.
// 4) 우측 패널도 실데이터가 있을 때만 기존 더미를 밀어내고 교체한다.

(function () {
  "use strict";

  // --- bootstrap guard ---
  if (window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__ === true) return;
  window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__ = true;

  // --- config ---
  const SNAPSHOT_URL = "/data/social.snapshot.json";
  const CURRENT_SNAPSHOT_URL = "/.netlify/functions/social-snapshot-current";
  const COUNTRY_ROUTE_URL = "/.netlify/functions/social-country-route";
  const MAIN_ROWS = 9;
  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 20;
  const RIGHT_LIMIT = 100;
  const RIGHT_BATCH = 20;
  const RIGHT_SECTION_KEY = "rightPanel";
  const mainRenderTokens = new WeakMap();
  const rightRenderTokens = new WeakMap();

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

  function thumbCandidates(it) {
    if (!it || typeof it !== "object") return [];

    const card =
      it.productCard && typeof it.productCard === "object"
        ? it.productCard
        : {};
    const mapping =
      it.productMapping && typeof it.productMapping === "object"
        ? it.productMapping
        : {};

    const values = [
      it.thumb,
      it.image,
      it.thumbnail,
      it.imageUrl,
      it.thumbnailUrl,
      it.image_url,
      it.thumbnail_url,
      it.imageOriginalUrl,
      it.image_original_url,
      it.productImage,
      it.product_image,
      it.productImageUrl,
      it.product_image_url,
      card.thumb,
      card.image,
      card.thumbnail,
      card.imageUrl,
      card.thumbnailUrl,
      card.image_url,
      card.thumbnail_url,
      mapping.thumb,
      mapping.image,
      mapping.thumbnail,
      mapping.imageUrl,
      mapping.thumbnailUrl,
      mapping.image_url,
      mapping.thumbnail_url,
    ];

    const seen = new Set();
    return values
      .map(function (value) {
        return safeText(value).trim();
      })
      .filter(function (value) {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function pickThumb(it) {
    const values = thumbCandidates(it);
    return values.length ? values[0] : "";
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

  function resolveElementUrl(el) {
    if (!el) return "";

    return safeText(
      (el.dataset &&
        (el.dataset.checkoutUrl ||
          el.dataset.paymentUrl ||
          el.dataset.contentUrl ||
          el.dataset.pageUrl ||
          el.dataset.internalUrl ||
          el.dataset.productUrl ||
          el.dataset.productLink ||
          el.dataset.detailUrl ||
          el.dataset.href ||
          el.dataset.url)) ||
        el.getAttribute("data-checkout-url") ||
        el.getAttribute("data-payment-url") ||
        el.getAttribute("data-content-url") ||
        el.getAttribute("data-page-url") ||
        el.getAttribute("data-internal-url") ||
        el.getAttribute("data-product-url") ||
        el.getAttribute("data-product-link") ||
        el.getAttribute("data-detail-url") ||
        el.getAttribute("data-href") ||
        el.getAttribute("href") ||
        "",
    ).trim();
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

  async function loadCurrentSnapshot() {
    try {
      const current = await fetch(
        CURRENT_SNAPSHOT_URL + "?_=" + encodeURIComponent(Date.now()),
        {
        cache: "no-store",
        credentials: "same-origin",
        },
      );
      if (current.ok) {
        const payload = await current.json();
        if (payload && payload.ok === true && payload.snapshot) {
          return {
            snapshot: payload.snapshot,
            pipeline: {
              source: "stored_release_current",
              status: "front_readback_passed",
              releaseId: payload.releaseId || null,
              hash: payload.hash || null,
              documentHash: payload.documentHash || null,
              hashVerified: payload.hashVerified === true,
              publicSlots: payload.publicSlots || null,
              route: payload.route || null,
              loadedAt: new Date().toISOString(),
            },
          };
        }
      }
    } catch (_e) {
      /* 정적 스냅샷을 이미 별도로 요청 중이다. */
    }
    return null;
  }

  async function loadStaticSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("snapshot_load_failed:" + res.status);
    return res.json();
  }

  function getMainSlots(gridEl) {
    if (!gridEl) return [];
    return qsa("a.card", gridEl);
  }

  function paintMainCard(card, it) {
    if (!card) return;

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
    if (metaDesc) metaDesc.textContent = desc;

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

  function resetMainCardToDummy(card) {
    if (!card) return;

    card.href = "#";
    card.target = "_self";
    card.rel = "noopener";
    card.dataset.dummy = "1";

    const pic = qs(".pic", card);
    const metaTitle = qs(".title", card);
    const metaDesc = qs(".desc", card);

    if (metaTitle) metaTitle.textContent = "Loading";
    if (metaDesc) metaDesc.textContent = "Preparing";

    if (pic) {
      pic.style.backgroundImage = "";
      pic.textContent = "";
    }
  }

  function mountMainRow(gridEl, items) {
    if (!gridEl) return;

    const raw = Array.isArray(items) ? items : [];
    const displayItems = raw.slice(0, MAIN_LIMIT);
    while (displayItems.length < MAIN_LIMIT) displayItems.push(null);

    // A new approved snapshot starts from one visible batch. Later cards are
    // created only when the user reaches the end of this row.
    let cards = getMainSlots(gridEl);
    for (let i = MAIN_BATCH; i < cards.length; i++) {
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

        a.innerHTML = `
        <div class="pic"></div>
        <div class="meta">
          <div class="title"></div>
          <div class="desc"></div>
        </div>
      `;
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
        else resetMainCardToDummy(cards[i]);
      }
      job.offset = end;
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
        a.innerHTML = '<div class="pic"></div><div class="meta"><div class="title"></div><div class="desc"></div></div>';
        frag.appendChild(a);
      }
      gridEl.appendChild(frag);
      cards = getMainSlots(gridEl);
    }
    for (let i = job.offset; i < end; i++) {
      const it = displayItems[i] || null;
      if (it) paintMainCard(cards[i], it);
      else resetMainCardToDummy(cards[i]);
    }
    job.offset = end;
  }

  function ensureRightCardCss() {
    const id = "igdc-social-right-card-thumb-v1";
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

  function getRightCards(panel, required) {
    if (!panel) return [];

    let cards = qsa(".ad-box", panel);
    const wanted = Math.min(RIGHT_LIMIT, Math.max(0, required == null ? RIGHT_LIMIT : required));
    if (cards.length < wanted) {
      const frag = document.createDocumentFragment();
      for (let i = cards.length; i < wanted; i++) {
        const box = document.createElement("div");
        box.className = "ad-box product-card";
        box.dataset.dummy = "1";
        box.dataset.productId = "";
        box.dataset.productTitle = "RIGHT SAMPLE";
        box.dataset.productLink = "";
        box.dataset.productUrl = "";
        box.dataset.detailUrl = "";
        box.dataset.href = "";
        box.innerHTML =
          '<a href="javascript:void(0)" aria-disabled="true" data-product-id="" data-product-title="RIGHT SAMPLE" data-product-link="">RIGHT SAMPLE</a>';
        frag.appendChild(box);
      }

      panel.appendChild(frag);
      cards = qsa(".ad-box", panel);
    }

    return cards;
  }

  function paintRightCard(box, it) {
    if (!box) return;

    if (isPlaceholderItem(it)) {
      resetRightCardToDummy(box);
      return;
    }

    const url = resolveItemUrl(it);
    const title = pickTitle(it) || "Item";
    const productId = pickProductId(it);
    const rawUrl = pickUrl(it).trim();
    const externalUrl =
      rawUrl && isExternalUrl(rawUrl) && !isBadPlaceholderUrl(rawUrl)
        ? rawUrl
        : "";

    box.className = "ad-box product-card";
    box.removeAttribute("data-dummy");
    box.dataset.productId = productId;
    box.dataset.productTitle = title;
    box.dataset.productLink = url;
    box.dataset.productUrl = url;
    box.dataset.detailUrl = url;
    box.dataset.href = url;
    if (externalUrl) box.dataset.externalUrl = externalUrl;
    else delete box.dataset.externalUrl;

    let a = qs("a", box);
    if (!a) {
      box.innerHTML = "";
      a = document.createElement("a");
      box.appendChild(a);
    }

    a.href = url || "javascript:void(0)";
    a.target = url ? (isExternalUrl(url) ? "_blank" : "_self") : "_self";
    a.rel = "noopener";

    // Right-panel cards used to be thumbnail cards. Rebuilding the anchor with
    // textContent erased the existing <img> node and left title-only rows.
    // Restore the thumbnail + caption contract without touching Social main.
    ensureRightCardCss();
    a.textContent = "";
    const thumbs = thumbCandidates(it);
    if (thumbs.length) {
      const img = document.createElement("img");
      img.className = "social-right-card-thumb";
      img.alt = title;
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.dataset.thumbIndex = "0";
      img.addEventListener("error", function () {
        const current = Number(img.dataset.thumbIndex || "0");
        const next = current + 1;
        if (next >= thumbs.length) return;
        img.dataset.thumbIndex = String(next);
        img.src = thumbs[next];
      });
      img.src = thumbs[0];
      a.appendChild(img);
    }
    const cap = document.createElement("div");
    cap.className = "social-right-card-title";
    cap.textContent = title;
    a.appendChild(cap);

    a.dataset.productId = productId;
    a.dataset.productTitle = title;
    a.dataset.productLink = url;
    a.dataset.productUrl = url;
    a.dataset.detailUrl = url;
    if (it && it.affiliateOutboundUrl) a.dataset.affiliateOutbound = "1";
    if (it && it.externalOutboundUrl) a.dataset.externalOutbound = "1";
    a.dataset.href = url;
    if (externalUrl) a.dataset.externalUrl = externalUrl;
    else delete a.dataset.externalUrl;

    if (url) {
      a.removeAttribute("aria-disabled");
    } else {
      a.setAttribute("aria-disabled", "true");
    }
  }

  function resetRightCardToDummy(box) {
    if (!box) return;

    box.className = "ad-box product-card";
    box.dataset.dummy = "1";
    box.dataset.productId = "";
    box.dataset.productTitle = "RIGHT SAMPLE";
    box.dataset.productLink = "";
    box.dataset.productUrl = "";
    box.dataset.detailUrl = "";
    box.dataset.href = "";
    delete box.dataset.externalUrl;

    let a = qs("a", box);
    if (!a) {
      box.innerHTML = "";
      a = document.createElement("a");
      box.appendChild(a);
    }

    a.href = "javascript:void(0)";
    a.target = "_self";
    a.rel = "noopener";
    a.textContent = "RIGHT SAMPLE";
    a.dataset.productId = "";
    a.dataset.productTitle = "RIGHT SAMPLE";
    a.dataset.productLink = "";
    a.dataset.productUrl = "";
    a.dataset.detailUrl = "";
    a.dataset.href = "";
    delete a.dataset.externalUrl;
    a.setAttribute("aria-disabled", "true");
  }

  function installRightPanelClickRouter() {
    if (window.__SOCIAL_RIGHTPANEL_CLICK_ROUTER_READY__) return;
    window.__SOCIAL_RIGHTPANEL_CLICK_ROUTER_READY__ = true;

    document.addEventListener(
      "click",
      function (e) {
        if (e.defaultPrevented) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
        if (e.target && e.target.closest && e.target.closest(".rscroll"))
          return;

        const hit =
          e.target &&
          e.target.closest &&
          e.target.closest(
            '[data-psom-key="rightPanel"] [data-checkout], ' +
              '[data-psom-key="rightPanel"] .product-card, ' +
              '[data-psom-key="rightPanel"] .ad-box, ' +
              '[data-psom-key="rightPanel"] a[href]',
          );

        if (!hit) return;

        // 결제 훅은 기존 IGTC checkout 로직에 맡긴다.
        if (hit.closest && hit.closest("[data-checkout]")) return;

        const box = hit.closest
          ? hit.closest(".product-card, .ad-box") || hit
          : hit;
        const a =
          hit.matches && hit.matches("a[href]")
            ? hit
            : box.querySelector
              ? box.querySelector("a[href]")
              : null;

        const url = resolveElementUrl(box) || resolveElementUrl(a);

        if (!isValidSecondUrl(url)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (isExternalUrl(url)) {
          window.open(url, "_blank", "noopener");
        } else {
          window.location.assign(url);
        }
      },
      true,
    );
  }

  function installRightPanelRenderOverride() {
    if (window.__SOCIAL_RIGHTPANEL_RENDER_OVERRIDE_READY__) return;
    window.__SOCIAL_RIGHTPANEL_RENDER_OVERRIDE_READY__ = true;

    window.__IGDC_RIGHTPANEL_RENDER = function (items) {
      lastRightPanelItems = Array.isArray(items) ? items.slice(0, RIGHT_LIMIT) : [];
      const rightPanels = getRightPanels();
      rightPanels.forEach(function (panel) {
        mountRightPanel(panel, lastRightPanelItems);
      });
    };
  }

  function mountRightPanel(panel, items) {
    if (!panel) return;

    const raw = Array.isArray(items) ? items : [];

    const usable = raw.filter(function (it) {
      if (!it) return false;
      if (isPlaceholderItem(it)) return false;

      const title = pickTitle(it).trim();
      const url = resolveItemUrl(it);
      const thumb = pickThumb(it).trim();

      return !!(title && thumb && url);
    });

    const displayItems = usable.slice(0, RIGHT_LIMIT);

    while (displayItems.length < RIGHT_LIMIT) {
      displayItems.push(null);
    }

    let cards = getRightCards(panel, RIGHT_BATCH);
    for (let i = RIGHT_BATCH; i < cards.length; i++) {
      if (cards[i].parentNode) cards[i].parentNode.removeChild(cards[i]);
    }

    const scrollHost = panel.closest("#rpMobileScroller") || panel;
    const job = { panel: panel, items: displayItems, offset: 0 };
    rightRenderTokens.set(scrollHost, job);

    function renderMore() {
      if (rightRenderTokens.get(scrollHost) !== job) return;
      const end = Math.min(job.offset + RIGHT_BATCH, RIGHT_LIMIT, job.items.length);
      cards = getRightCards(panel, end);
      for (let i = job.offset; i < end; i++) {
        const it = job.items[i];
        if (it) paintRightCard(cards[i], it);
        else resetRightCardToDummy(cards[i]);
      }
      job.offset = end;
    }

    renderMore();
    if (scrollHost.dataset.igdcSocialRightBatchBound === "1") return;
    scrollHost.dataset.igdcSocialRightBatchBound = "1";
    scrollHost.addEventListener("scroll", function () {
      const current = rightRenderTokens.get(scrollHost);
      if (!current || current.offset >= Math.min(RIGHT_LIMIT, current.items.length)) return;
      const nearX = scrollHost.scrollWidth > scrollHost.clientWidth + 2 &&
        scrollHost.scrollLeft + scrollHost.clientWidth >= scrollHost.scrollWidth - 40;
      const nearY = scrollHost.scrollHeight > scrollHost.clientHeight + 2 &&
        scrollHost.scrollTop + scrollHost.clientHeight >= scrollHost.scrollHeight - 40;
      if (!nearX && !nearY) return;
      const end = Math.min(current.offset + RIGHT_BATCH, RIGHT_LIMIT, current.items.length);
      const activeCards = getRightCards(current.panel, end);
      for (let i = current.offset; i < end; i++) {
        const it = current.items[i];
        if (it) paintRightCard(activeCards[i], it);
        else resetRightCardToDummy(activeCards[i]);
      }
      current.offset = end;
    }, { passive: true });
  }

  let lastSnapshot = null;
  let lastRightPanelSnapshot = null;
  let lastRoute = routeFallback();
  let lastRightPanelItems = [];
  let rightPanelRepairTimer = 0;
  let runInFlight = null;

  function renderSnapshot(snap, route, rightPanelSnapshot) {
    const sections = getSections(snap);
    if (!sections) return false;
    // Social's 9 channel sections and the commercial right panel have different
    // authorities. The latest stored Social release owns the 9 SNS rows, while
    // /data/social.snapshot.json is Edge-routed to the verified country-scoped
    // commerce snapshot that owns rightPanel. Never let a stored Social release
    // replace that scoped commercial panel with its preserved placeholder copy.
    const rightSections = getSections(rightPanelSnapshot) || sections;

    const grids = document.querySelectorAll("[data-psom-key]");

    grids.forEach((grid) => {
      const key = grid.getAttribute("data-psom-key");
      if (!key) return;

      if (key === "rightPanel") return;
      if (key === "social-maru") return;

      const raw = routedItems(snap, key, route) || sections[key];

      const items = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.items)
          ? raw.items
          : [];

      const finalItems =
        items.length > 0
          ? items
          : [
              {
                title: key + " SAMPLE",
                url: "#",
                thumbnail: "",
              },
            ];

      mountMainRow(grid, finalItems);
    });

    const rightPanels = getRightPanels();

    if (rightPanels.length) {
      const raw = Array.isArray(rightSections.rightPanel)
        ? rightSections.rightPanel
        : Array.isArray(rightSections.rightPanel?.items)
          ? rightSections.rightPanel.items
          : [];

      const finalItems = raw.length > 0 ? raw : [];
      lastRightPanelItems = finalItems.slice(0, RIGHT_LIMIT);

      rightPanels.forEach(function (panel) {
        mountRightPanel(panel, lastRightPanelItems);
      });
    }

    window.__SOCIALNETWORK_AUTOMAP_V3_DONE__ = true;
    window.__IGDC_SOCIAL_COUNTRY_ROUTE__ = {
      countryCode: route.countryCode || null,
      languages: route.languages || [],
      source: route.source || "fallback",
    };
    return true;
  }

  function rightPanelNeedsThumbnailRepair(panel) {
    if (!panel || !lastRightPanelItems.length) return false;
    const cards = qsa(".ad-box.product-card", panel);
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (card.getAttribute("data-dummy") === "1") continue;
      const title = safeText(
        card.dataset.productTitle ||
          (qs("a", card) && qs("a", card).dataset.productTitle) ||
          card.textContent ||
          "",
      ).trim();
      if (!title || title === "RIGHT SAMPLE" || /^불러오는 중/.test(title)) continue;
      if (!qs("img.social-right-card-thumb", card)) return true;
    }
    return false;
  }

  function scheduleRightPanelThumbnailRepair() {
    if (rightPanelRepairTimer) return;
    rightPanelRepairTimer = window.setTimeout(function () {
      rightPanelRepairTimer = 0;
      if (!lastRightPanelItems.length) return;
      getRightPanels().forEach(function (panel) {
        if (rightPanelNeedsThumbnailRepair(panel)) {
          mountRightPanel(panel, lastRightPanelItems);
        }
      });
    }, 0);
  }

  function installRightPanelThumbnailRepairObserver() {
    if (window.__IGDC_SOCIAL_RIGHTPANEL_THUMB_REPAIR_READY__) return;
    window.__IGDC_SOCIAL_RIGHTPANEL_THUMB_REPAIR_READY__ = true;
    try {
      const observer = new MutationObserver(function (mutations) {
        for (let i = 0; i < mutations.length; i++) {
          const target = mutations[i] && mutations[i].target;
          if (target && target.closest && target.closest('[data-psom-key="rightPanel"]')) {
            scheduleRightPanelThumbnailRepair();
            return;
          }
        }
      });
      getRightPanels().forEach(function (panel) {
        observer.observe(panel, { childList: true, subtree: true });
      });
      window.__IGDC_SOCIAL_RIGHTPANEL_THUMB_REPAIR_OBSERVER__ = observer;
    } catch (_e) {
      /* The normal renderer remains authoritative when MutationObserver is unavailable. */
    }
  }

  function run() {
    if (runInFlight) return runInFlight;

    const staticPromise = loadStaticSnapshot();
    const currentPromise = loadCurrentSnapshot();
    const routePromise = loadCountryRoute();
    let finalApplied = false;

    const earlyStatic = staticPromise
      .then(function (snap) {
        // Always retain the Edge-routed static snapshot as the commercial
        // right-panel authority, even when the stored Social release responds
        // first. Only the early whole-page paint is skipped after final apply.
        lastRightPanelSnapshot = snap;
        if (!finalApplied) {
          lastSnapshot = snap;
          window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = {
            source: "static_snapshot_early",
            status: "stored_release_current_pending",
            rightPanelSource: "country_scoped_static_snapshot",
            loadedAt: new Date().toISOString(),
          };
          renderSnapshot(snap, lastRoute, lastRightPanelSnapshot);
        }
        return snap;
      })
      .catch(function () {
        return null;
      });

    runInFlight = Promise.all([currentPromise, routePromise])
      .then(async function (results) {
        const current = results[0];
        lastRoute = results[1] || routeFallback();
        finalApplied = true;

        // The Social release endpoint and the IP-scoped commercial snapshot are
        // parallel sources. Wait for the static scope once so whichever request
        // wins the race, rightPanel still comes from the verified country path.
        const scopedStatic = await earlyStatic;
        if (scopedStatic) lastRightPanelSnapshot = scopedStatic;

        if (current && current.snapshot) {
          lastSnapshot = current.snapshot;
          window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = Object.assign(
            {},
            current.pipeline || {},
            {
              rightPanelSource: lastRightPanelSnapshot
                ? "country_scoped_static_snapshot"
                : "stored_social_release_fallback",
            },
          );
        } else {
          lastSnapshot = scopedStatic;
          if (!lastSnapshot) throw new Error("snapshot_load_failed");
          window.__IGDC_SOCIAL_SNAPSHOT_PIPELINE__ = {
            source: "static_snapshot_fallback",
            status: "stored_release_current_unavailable",
            rightPanelSource: "country_scoped_static_snapshot",
            loadedAt: new Date().toISOString(),
          };
        }
        if (!lastRightPanelSnapshot) lastRightPanelSnapshot = lastSnapshot;
        renderSnapshot(lastSnapshot, lastRoute, lastRightPanelSnapshot);
      })
      .catch(function (e) {
        console.error("[social-automap-fixed] fail", e);
      })
      .finally(function () {
        runInFlight = null;
      });

    return runInFlight;
  }

  function boot() {
    installRightPanelClickRouter();
    installRightPanelRenderOverride();
    installRightPanelThumbnailRepairObserver();
    window.__IGDC_SOCIAL_RIGHTPANEL_THUMBNAIL_RESTORE__ = "20260814-r3";
    run();
  }
  window.addEventListener("igdc:rightpanel:refresh", function () {
    if (lastSnapshot)
      renderSnapshot(
        lastSnapshot,
        lastRoute,
        lastRightPanelSnapshot || lastSnapshot,
      );
  });
  boot();
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
