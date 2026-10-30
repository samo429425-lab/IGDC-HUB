// socialnetwork-automap.v3.fixed.js
// build: 20261030-five-platform-reddit-manual-native-v1
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
  const MAIN_ROWS = 3;
  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 12; // first-screen content first; remaining slots are painted without geometry changes
  const RIGHT_LIMIT = 100;
  const RIGHT_BATCH = 12;
  const MANAGED_MAIN_KEYS = new Set([
    "social-youtube",
    "social-instagram",
    "social-tiktok",
  ]);
  const mainRenderTokens = new WeakMap();
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
  const MAIN_FAST_CACHE = "igdc.social.mainRelease.v5.reddit";
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
        releaseId: current.pipeline.releaseId || null
      }));
    } catch (_) { /* storage disabled or quota: online flow remains intact */ }
  }

  async function loadCurrentSnapshot() {
    try {
      const res = await fetch(
        CURRENT_SNAPSHOT_URL + "?view=front",
        { cache: "default", credentials: "same-origin" },
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

  const COMPACT_MAIN_KEYS = new Set(['social-youtube','social-instagram','social-tiktok']);
  function mainCtaLabel(gridEl) {
    const existing = qs('a.card .cta', gridEl);
    return safeText(existing && existing.textContent).trim() || 'Open';
  }
  function mainCardMarkup(gridEl) {
    const compact = COMPACT_MAIN_KEYS.has(gridEl && gridEl.getAttribute('data-psom-key'));
    if (!compact) {
      const label = mainCtaLabel(gridEl).replace(/[&<>"']/g, function (ch) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
      });
      return '<div class="pic"></div><div class="meta"><div class="title"></div><div class="desc"></div>' +
        '<div class="sn-card-stats" aria-label=""></div>' +
        '<div class="sn-card-actions"><span class="sn-card-action" data-sn-action="recommend" role="button" tabindex="-1"></span><span class="sn-card-action" data-sn-action="share" role="button" tabindex="-1"></span></div>' +
        '<div class="cta">' + label + '</div></div>';
    }
    return '<div class="pic"></div><div class="meta"><div class="title"></div><div class="desc"></div>' +
      '<div class="sn-card-stats" aria-hidden="true"></div><div class="sn-card-actions"></div></div>';
  }

  // Metrics are optional. Only data carried by a published content record is
  // displayed; never invent platform counts, engagement or timestamps.
  function socialMetric(it, fieldNames) {
    const sources = [it, it && it.metrics, it && it.stats,
      it && it.engagement, it && it.social, it && it.social && it.social.metrics];
    for (const obj of sources) {
      if (!obj || typeof obj !== 'object') continue;
      for (const key of fieldNames) {
        const raw = obj[key];
        if (raw == null || raw === '') continue;
        const value = String(raw).trim().replace(/[,_\s]/g, '');
        const suffix = value.match(/^(\d+(?:\.\d+)?)([kmb])$/i);
        const normalized = typeof raw === 'number' ? raw : suffix
          ? Number(suffix[1]) * ({k:1e3,m:1e6,b:1e9}[suffix[2].toLowerCase()])
          : Number(value);
        if (Number.isFinite(normalized) && normalized >= 0) return normalized;
      }
    }
    return null;
  }

  function socialNumber(value) {
    const rawLang = document.documentElement && document.documentElement.lang || 'en';
    const lang = rawLang === 'zht' ? 'zh-TW' : rawLang;
    try {
      return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    } catch (_e) { return String(value); }
  }

  function paintSocialStats(card, it) {
    // Provider likes and IGDC click counts are not interchangeable.
    // Do not fabricate absent values or label provider video views as IGDC clicks.
    const grid = card.closest('.thumb-grid[data-psom-key]');
    if (!grid || !COMPACT_MAIN_KEYS.has(grid.getAttribute('data-psom-key'))) {
      const statsEl = qs('.sn-card-stats', card);
      if (!statsEl) return;
      const views = socialMetric(it, ['viewCount', 'view_count', 'views', 'videoViews', 'playCount', 'play_count']);
      const likes = socialMetric(it, ['likeCount', 'like_count', 'likes', 'heartCount']);
      const recommends = socialMetric(it, ['recommendCount', 'recommend_count', 'recommendationCount', 'recommendation_count', 'recommendations', 'upvoteCount', 'upvote_count', 'upvotes']);
      const parts = [];
      if (views !== null) parts.push('▶ ' + socialNumber(views));
      if (likes !== null) parts.push('♥ ' + socialNumber(likes));
      if (recommends !== null) parts.push('★ ' + socialNumber(recommends));
      statsEl.textContent = parts.join('  ·  ');
      statsEl.setAttribute('aria-label', parts.join(', '));
      return;
    }
    const likes = socialMetric(it, ['likeCount', 'like_count', 'likes', 'heartCount']);
    const clicks = socialMetric(it, ['clickCount', 'click_count', 'outboundClickCount', 'outbound_click_count', 'cardClickCount', 'card_click_count']);
    if (likes === null) delete card.dataset.snLikes;
    else card.dataset.snLikes = String(likes);
    if (clicks === null) delete card.dataset.snClicks;
    else card.dataset.snClicks = String(clicks);
    const statsEl = qs('.sn-card-stats', card);
    if (statsEl) { statsEl.textContent = ''; statsEl.setAttribute('aria-hidden', 'true'); }
    refreshCardMetricValues(card);
  }

  // Social cards reuse the viewer's existing per-user IGDC recommendation state.
  // This is NOT a platform endorsement or a globally aggregated vote count.
  const SOCIAL_REACTION_STORAGE = 'IGDC_SOCIAL_REACTIONS_V1';
  const SOCIAL_SHARE_LABELS = {
    ko:['추천','전달하기','콘텐츠 전달하기','URL 주소','링크 복사','복사됨','닫기','기기에서 공유'],
    en:['Recommend','Share','Share this content','Content URL','Copy link','Copied','Close','Share via device'],
    ja:['おすすめ','共有','コンテンツを共有','コンテンツURL','リンクをコピー','コピーしました','閉じる','デバイスで共有'],
    zh:['推荐','分享','分享此内容','内容链接','复制链接','已复制','关闭','通过设备分享'],
    zht:['推薦','分享','分享此內容','內容連結','複製連結','已複製','關閉','使用裝置分享'],
    de:['Empfehlen','Teilen','Inhalt teilen','Inhaltslink','Link kopieren','Kopiert','Schließen','Über Gerät teilen'],
    fr:['Recommander','Partager','Partager ce contenu','Lien du contenu','Copier le lien','Copié','Fermer','Partager via l’appareil'],
    es:['Recomendar','Compartir','Compartir contenido','URL del contenido','Copiar enlace','Copiado','Cerrar','Compartir desde el dispositivo'],
    pt:['Recomendar','Partilhar','Partilhar conteúdo','URL do conteúdo','Copiar ligação','Copiado','Fechar','Partilhar no dispositivo'],
    ru:['Рекомендовать','Поделиться','Поделиться контентом','Ссылка','Копировать ссылку','Скопировано','Закрыть','Поделиться с устройства'],
    it:['Consiglia','Condividi','Condividi contenuto','URL contenuto','Copia link','Copiato','Chiudi','Condividi dal dispositivo'],
    nl:['Aanbevelen','Delen','Inhoud delen','Inhoudslink','Link kopiëren','Gekopieerd','Sluiten','Delen via apparaat'],
    sv:['Rekommendera','Dela','Dela innehåll','Innehållslänk','Kopiera länk','Kopierad','Stäng','Dela via enhet'],
    pl:['Poleć','Udostępnij','Udostępnij treść','Adres treści','Kopiuj link','Skopiowano','Zamknij','Udostępnij z urządzenia'],
    tr:['Öner','Paylaş','İçeriği paylaş','İçerik bağlantısı','Bağlantıyı kopyala','Kopyalandı','Kapat','Cihazla paylaş'],
    ar:['توصية','مشاركة','مشاركة المحتوى','رابط المحتوى','نسخ الرابط','تم النسخ','إغلاق','المشاركة عبر الجهاز'],
    th:['แนะนำ','แชร์','แชร์เนื้อหา','ลิงก์เนื้อหา','คัดลอกลิงก์','คัดลอกแล้ว','ปิด','แชร์ผ่านอุปกรณ์'],
    vi:['Đề xuất','Chia sẻ','Chia sẻ nội dung','Liên kết nội dung','Sao chép liên kết','Đã sao chép','Đóng','Chia sẻ qua thiết bị'],
    bn:['সুপারিশ','শেয়ার','কনটেন্ট শেয়ার','কনটেন্ট লিংক','লিংক কপি','কপি হয়েছে','বন্ধ করুন','ডিভাইস থেকে শেয়ার'],
    fa:['پیشنهاد','اشتراک‌گذاری','اشتراک‌گذاری محتوا','پیوند محتوا','کپی پیوند','کپی شد','بستن','اشتراک‌گذاری با دستگاه'],
    hi:['सिफारिश','साझा करें','सामग्री साझा करें','सामग्री लिंक','लिंक कॉपी करें','कॉपी हुआ','बंद करें','डिवाइस से साझा करें'],
    hu:['Ajánlás','Megosztás','Tartalom megosztása','Tartalom URL','Hivatkozás másolása','Másolva','Bezárás','Megosztás eszközről'],
    id:['Rekomendasikan','Bagikan','Bagikan konten','Tautan konten','Salin tautan','Disalin','Tutup','Bagikan lewat perangkat'],
    ms:['Syorkan','Kongsi','Kongsi kandungan','Pautan kandungan','Salin pautan','Disalin','Tutup','Kongsi melalui peranti'],
    sw:['Pendekeza','Shiriki','Shiriki maudhui','Kiungo cha maudhui','Nakili kiungo','Imenakiliwa','Funga','Shiriki kwa kifaa'],
    ta:['பரிந்துரை','பகிர்','உள்ளடக்கத்தைப் பகிர்','உள்ளடக்க இணைப்பு','இணைப்பை நகலெடு','நகலெடுக்கப்பட்டது','மூடு','சாதனத்தில் பகிர்'],
    tl:['Irekomenda','Ibahagi','Ibahagi ang nilalaman','Link ng nilalaman','Kopyahin ang link','Nakopya','Isara','Ibahagi sa device'],
    uk:['Рекомендувати','Поділитися','Поділитися вмістом','Посилання','Копіювати посилання','Скопійовано','Закрити','Поділитися з пристрою'],
    ur:['تجویز','شیئر کریں','مواد شیئر کریں','مواد کا لنک','لنک کاپی کریں','کاپی ہو گیا','بند کریں','ڈیوائس سے شیئر کریں'],
    uz:['Tavsiya','Ulashish','Kontentni ulashish','Kontent havolasi','Havolani nusxalash','Nusxalandi','Yopish','Qurilmadan ulashish']
  };
  function socialUiLabels() {
    let code = safeText(document.documentElement.lang || 'en').toLowerCase().replace(/_/g, '-');
    if (code === 'zh-tw' || code === 'zh-hk' || code === 'zh-hant') code = 'zht';
    else code = code.split('-')[0];
    const x = SOCIAL_SHARE_LABELS[code] || SOCIAL_SHARE_LABELS.en;
    return { recommend:x[0], share:x[1], title:x[2], url:x[3], copy:x[4], copied:x[5], close:x[6], device:x[7] };
  }
  const SOCIAL_METRIC_LABELS = {
    ko:['좋아요','클릭수','URL'],en:['Likes','Clicks','URL'],ja:['いいね','クリック数','URL'],
    zh:['点赞','点击量','链接'],zht:['讚','點擊數','連結'],de:['Likes','Klicks','URL'],
    fr:['J’aime','Clics','URL'],es:['Me gusta','Clics','URL'],pt:['Gostos','Cliques','URL'],
    ru:['Нравится','Клики','Ссылка'],it:['Mi piace','Clic','URL'],nl:['Likes','Klikken','URL'],
    sv:['Gilla','Klick','URL'],pl:['Polubienia','Kliknięcia','URL'],tr:['Beğeni','Tıklama','URL'],
    ar:['الإعجابات','النقرات','الرابط'],th:['ถูกใจ','คลิก','ลิงก์'],vi:['Thích','Lượt nhấp','URL'],
    bn:['পছন্দ','ক্লিক','লিংক'],fa:['پسند','کلیک','پیوند'],hi:['पसंद','क्लिक','लिंक'],
    hu:['Kedvelés','Kattintás','URL'],id:['Suka','Klik','URL'],ms:['Suka','Klik','URL'],
    sw:['Kupenda','Mibofyo','Kiungo'],ta:['விருப்பம்','கிளிக்','இணைப்பு'],tl:['Like','Click','Link'],
    uk:['Вподобання','Кліки','URL'],ur:['پسند','کلکس','لنک'],uz:['Yoqtirish','Bosish','Havola']
  };
  function socialMetricLabels() {
    let code = safeText(document.documentElement.lang || 'en').toLowerCase().replace(/_/g, '-');
    if (['zh-tw','zh-hk','zh-hant'].includes(code)) code = 'zht';
    else code = code.split('-')[0];
    const list = SOCIAL_METRIC_LABELS[code] || SOCIAL_METRIC_LABELS.en;
    return { likes:list[0], clicks:list[1], url:list[2] };
  }
  function refreshCardMetricValues(card) {
    const labels = socialMetricLabels();
    for (const name of ['likes','clicks']) {
      const el = qs('.sn-card-metric[data-sn-metric="' + name + '"]', card);
      if (!el) continue;
      const raw = name === 'likes' ? card.dataset.snLikes : card.dataset.snClicks;
      const number = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? socialNumber(Number(raw)) : '–';
      el.textContent = (name === 'likes' ? '♥ ' : '◉ ') + number;
      el.setAttribute('aria-label', (name === 'likes' ? labels.likes : labels.clicks) + ': ' + (number === '–' ? '—' : number));
      el.title = name === 'likes' ? labels.likes : labels.clicks;
    }
  }
  function validContentShareUrl(raw) {
    try {
      const u = new URL(safeText(raw).trim(), window.location.href);
      return (u.protocol === 'https:' || u.protocol === 'http:') && /^https?:\/\//i.test(safeText(raw).trim()) ? u.href : '';
    } catch (_e) { return ''; }
  }
  function activeLocalRecommendation(url) {
    try {
      const rows = JSON.parse(localStorage.getItem(SOCIAL_REACTION_STORAGE) || '{}');
      return !!(rows && rows[url] && rows[url].recommend);
    } catch (_e) { return false; }
  }
  function changeLocalRecommendation(url, platform) {
    if (!validContentShareUrl(url)) return null;
    try {
      const rows = JSON.parse(localStorage.getItem(SOCIAL_REACTION_STORAGE) || '{}');
      const data = rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
      const item = data[url] && typeof data[url] === 'object' ? data[url] : {};
      item.recommend = !item.recommend;
      item.updatedAt = new Date().toISOString();
      data[url] = item;
      localStorage.setItem(SOCIAL_REACTION_STORAGE, JSON.stringify(data));
      window.dispatchEvent(new CustomEvent('igdc:social-reaction', {
        detail: { url:url, type:'recommend', active:!!item.recommend, platform:platform }
      }));
      return !!item.recommend;
    } catch (_e) { return null; }
  }
  function ensureCardActions(card) {
    const meta = qs('.meta', card);
    if (!meta) return null;
    const grid = card.closest('.thumb-grid[data-psom-key]');
    if (!grid || !COMPACT_MAIN_KEYS.has(grid.getAttribute('data-psom-key'))) return null;
    let bar = qs('.sn-card-actions', meta);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sn-card-actions';
      meta.appendChild(bar);
    }
    // No faux Like, Recommend, Subscribe, or Share controls. The originating
    // provider owns those actions in its official embed/original post.
    bar.replaceChildren();
    const name = grid.getAttribute('data-psom-key').slice(7);
    const label = document.createElement('span');
    label.className = 'sn-native-provider-name';
    label.textContent = ({ youtube:'YouTube', instagram:'Instagram', tiktok:'TikTok', facebook:'Facebook', reddit:'Reddit' })[name] || name;
    bar.appendChild(label);
    return bar;
  }
  function createShareDialog() {
    let overlay = document.getElementById('igdc-social-share-overlay');
    if (overlay) return overlay;
    const css = document.createElement('style');
    css.id = 'igdc-social-share-dialog-style-v1';
    css.textContent = `
#igdc-social-share-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(8,16,28,.68);z-index:2147483647;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
#igdc-social-share-overlay[hidden]{display:none!important}
#igdc-social-share-overlay .sn-share-panel{box-sizing:border-box;width:min(440px,100%);max-height:90dvh;overflow:auto;padding:18px;background:#fff;color:#172233;border-radius:14px;box-shadow:0 14px 48px rgba(0,0,0,.25);font-size:13px;text-align:start}
#igdc-social-share-overlay .sn-share-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:12px}
#igdc-social-share-overlay h2{font-size:18px;font-weight:700;margin:0;line-height:1.4;color:#142034}
#igdc-social-share-overlay button,#igdc-social-share-overlay a{font:inherit;cursor:pointer}
#igdc-social-share-overlay .sn-share-close{background:transparent;color:#25334a;border:1px solid #dbe2ec;border-radius:8px;padding:4px 9px}
#igdc-social-share-overlay label{display:block;margin:0 0 6px;font-weight:600}
#igdc-social-share-overlay .sn-share-url-row{display:flex;gap:7px;margin-bottom:14px;align-items:center}
#igdc-social-share-overlay .sn-share-url{box-sizing:border-box;flex:1;min-width:0;font-size:12px;padding:9px 8px;border:1px solid #cdd9e5;border-radius:8px;direction:ltr;text-align:left}
#igdc-social-share-overlay .sn-share-copy,#igdc-social-share-overlay .sn-share-native{border:1px solid #bad0e6;background:#edf5fd;color:#174a79;border-radius:8px;padding:9px 11px;white-space:nowrap}
#igdc-social-share-overlay .sn-share-options{display:flex;flex-wrap:wrap;gap:8px}
#igdc-social-share-overlay .sn-share-options a{display:inline-flex;align-items:center;justify-content:center;min-width:80px;border:1px solid #d7e0ea;border-radius:8px;padding:9px 12px;text-decoration:none;color:#17324d;background:#f8fafc}
#igdc-social-share-overlay .sn-share-native{margin-bottom:12px;width:100%}
#igdc-social-share-overlay :focus-visible{outline:2px solid #2563eb;outline-offset:2px}`;
    document.head.appendChild(css);
    overlay = document.createElement('div');
    overlay.id = 'igdc-social-share-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = '<div class="sn-share-panel" role="dialog" aria-modal="true" aria-labelledby="igdc-social-share-title">' +
      '<div class="sn-share-head"><h2 id="igdc-social-share-title"></h2><button class="sn-share-close" type="button"></button></div>' +
      '<label for="igdc-social-share-url"></label><div class="sn-share-url-row"><input id="igdc-social-share-url" class="sn-share-url" type="url" readonly/><button class="sn-share-copy" type="button"></button></div>' +
      '<button class="sn-share-native" type="button"></button><div class="sn-share-options"></div></div>';
    document.body.appendChild(overlay);
    const close = function () {
      overlay.hidden = true;
      if (overlay.__previousFocus && overlay.__previousFocus.focus) overlay.__previousFocus.focus();
    };
    overlay.__close = close;
    qs('.sn-share-close', overlay).addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    // The in-page viewer also has an ESC shortcut; consume it before its handler.
    window.addEventListener('keydown', function (e) {
      if (!overlay.hidden && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }, true);
    const input = qs('.sn-share-url', overlay);
    input.addEventListener('click', function () { input.select(); });
    qs('.sn-share-copy', overlay).addEventListener('click', async function () {
      const val = input.value;
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(val);
          ok = true;
        }
      } catch (_e) {}
      if (!ok) {
        input.focus(); input.select();
        try { ok = !!document.execCommand('copy'); } catch (_e) {}
      }
      if (ok) qs('.sn-share-copy', overlay).textContent = socialUiLabels().copied;
      else input.select(); // user can still manually copy the visible URL
    });
    qs('.sn-share-native', overlay).addEventListener('click', function () {
      if (!navigator.share) return;
      navigator.share({ title:overlay.__title, url:input.value }).then(close).catch(function () {});
    });
    return overlay;
  }
  function openSocialShare(title, rawUrl, mode) {
    const url = validContentShareUrl(rawUrl);
    if (!url) return false;
    const overlay = createShareDialog();
    const labels = socialUiLabels();
    overlay.__previousFocus = document.activeElement;
    overlay.__title = safeText(title).trim() || document.title;
    overlay.dir = document.documentElement.dir || 'ltr';
    const urlOnly = mode === 'url';
    qs('h2', overlay).textContent = urlOnly ? labels.url : labels.title;
    qs('.sn-share-close', overlay).textContent = labels.close + ' ×';
    qs('label', overlay).textContent = labels.url;
    qs('.sn-share-url', overlay).value = url;
    qs('.sn-share-copy', overlay).textContent = labels.copy;
    const native = qs('.sn-share-native', overlay);
    native.hidden = urlOnly || typeof navigator.share !== 'function';
    native.textContent = labels.device;
    const targets = [
      ['X', 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(overlay.__title)],
      ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)],
      ['Reddit', 'https://www.reddit.com/submit?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(overlay.__title)],
      ['WhatsApp', 'https://api.whatsapp.com/send?text=' + encodeURIComponent(overlay.__title + ' ' + url)],
      ['Telegram', 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(overlay.__title)],
      ['Email', 'mailto:?subject=' + encodeURIComponent(overlay.__title) + '&body=' + encodeURIComponent(url)]
    ];
    const options = qs('.sn-share-options', overlay);
    options.textContent = '';
    options.hidden = urlOnly;
    for (const [name, href] of (urlOnly ? [] : targets)) {
      const a = document.createElement('a');
      a.textContent = name;
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      options.appendChild(a);
    }
    overlay.hidden = false;
    qs('.sn-share-close', overlay).focus();
    return true;
  }
  // Existing YouTube / Instagram / TikTok / Facebook viewer share buttons
  // call this same dialog; no new <script> tags or locale HTML changes needed.
  window.IGDCSocialShareDialog = { open:openSocialShare, labels:socialUiLabels };

  // Capture at WINDOW, before the viewer bridge's document-level click capture.
  // No card navigation or in-site playback occurs when using a card action.
  function handleSocialCardAction(e) {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const action = e.target && e.target.closest && e.target.closest('.sn-card-action[data-sn-action]');
    if (!action) return;
    const card = action.closest('a.card');
    if (!card || card.dataset.sample === '1') return;
    const grid = card.closest('.thumb-grid[data-psom-key]');
    if (!grid || !['social-youtube','social-instagram','social-tiktok'].includes(grid.getAttribute('data-psom-key'))) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const url = validContentShareUrl(card.dataset.latestContentUrl || card.dataset.contentUrl || card.href);
    if (!url) return;
    if (action.dataset.snAction === 'share') {
      openSocialShare(qs('.title',card) && qs('.title',card).textContent, url);
    } else if (action.dataset.snAction === 'url') {
      openSocialShare(qs('.title',card) && qs('.title',card).textContent, url, 'url');
    } else if (action.dataset.snAction === 'recommend') {
      const platform = grid.getAttribute('data-psom-key').slice(7);
      const active = changeLocalRecommendation(url, platform);
      if (active !== null) action.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }
  window.addEventListener('click', handleSocialCardAction, true);
  window.addEventListener('keydown', handleSocialCardAction, true);
  function syncRecommendationControls() {
    qsa('.thumb-grid[data-psom-key^="social-"] .sn-card-action[data-sn-action="recommend"]').forEach(function (action) {
      const card = action.closest('a.card');
      if (!card || card.dataset.sample === '1') return;
      action.setAttribute('aria-pressed', activeLocalRecommendation(card.dataset.latestContentUrl || card.dataset.contentUrl) ? 'true' : 'false');
    });
  }
  window.addEventListener('igdc:social-reaction', syncRecommendationControls);
  window.addEventListener('storage', function (e) { if (e.key === SOCIAL_REACTION_STORAGE) syncRecommendationControls(); });

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
.thumb-grid[data-psom-key="social-reddit"] a.card[data-sample="1"] .pic{background:linear-gradient(135deg,#fff0e7,#fff7f1 60%,#fce8df)!important}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .meta{min-height:0;color:#6a7585}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .title{display:block!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap!important;color:#66778d;font-size:11px!important;font-weight:550!important;line-height:1.4!important}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .cta{background:#e9eff7!important;color:#647996!important;font-weight:600!important;font-size:11px!important;letter-spacing:.01em}
.thumb-grid[data-psom-key^="social-"] a.card:not([data-sample="1"]) .pic[data-social-thumb-loading="1"]{position:relative;background:linear-gradient(120deg,#e8eef7,#f4f7fb,#e8eef7)!important;overflow:hidden}
.thumb-grid[data-psom-key^="social-"] a.card:not([data-sample="1"]) .pic[data-social-thumb-loading="1"]::after{content:"";position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%);border:1px solid #c8d5e6;border-radius:50%;background:rgba(255,255,255,.8);pointer-events:none}
.thumb-grid[data-psom-key^="social-"] a.card:not([data-sample="1"]) .pic[data-social-thumb-failed="1"]{font-size:12px!important;color:#718198;background:#f0f4f9!important}
`;
    document.head.appendChild(style);
    ensurePlatformCardCss();
  }

  function ensurePlatformCardCss() {
    const styleId = "igdc-social-native-platform-cards-v1";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
/* IGDC original-aspect social cards: YouTube 16:9, Instagram post 4:5,
   Instagram Reels and TikTok 9:16; Facebook varies by content type.
   A published image can refine the media box to its known native ratio.
   Footer remains independent; neither the right panel nor other SNS change. */
.thumb-grid[data-psom-key="social-youtube"],
.thumb-grid[data-psom-key="social-instagram"],
.thumb-grid[data-psom-key="social-tiktok"],
.thumb-grid[data-psom-key="social-facebook"]{grid-auto-flow:column!important;grid-template-rows:1fr!important;grid-template-columns:none!important;gap:12px!important;align-items:stretch!important;}
.thumb-grid[data-psom-key="social-facebook"]{grid-auto-columns:minmax(215px,250px)!important;}
.thumb-grid[data-psom-key="social-youtube"]{grid-auto-columns: minmax(271px,330px)!important;}
.thumb-grid[data-psom-key="social-instagram"],
.thumb-grid[data-psom-key="social-tiktok"]{grid-auto-columns: minmax(219px,255px)!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card,
.thumb-grid[data-psom-key="social-instagram"] a.card,
.thumb-grid[data-psom-key="social-tiktok"] a.card,
.thumb-grid[data-psom-key="social-facebook"] a.card{box-sizing:border-box!important;width:100%!important;max-width:none!important;min-width:0!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;align-self:stretch!important;border-radius:12px!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .pic,
.thumb-grid[data-psom-key="social-instagram"] a.card .pic,
.thumb-grid[data-psom-key="social-tiktok"] a.card .pic,
.thumb-grid[data-psom-key="social-facebook"] a.card .pic{box-sizing:border-box!important;flex:0 0 auto!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;display:flex!important;align-items:center!important;justify-content:center!important;overflow:hidden!important;position:relative!important;background:#101318!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .pic{aspect-ratio:16 / 9!important;}
.thumb-grid[data-psom-key="social-facebook"] a.card .pic,
.thumb-grid[data-psom-key="social-instagram"] a.card .pic{aspect-ratio:4 / 5!important;}
.thumb-grid[data-psom-key="social-tiktok"] a.card .pic{aspect-ratio:9 / 16!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .pic{aspect-ratio:16 / 9!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .pic img,
.thumb-grid[data-psom-key="social-instagram"] a.card .pic img,
.thumb-grid[data-psom-key="social-tiktok"] a.card .pic img,
.thumb-grid[data-psom-key="social-facebook"] a.card .pic img,
.thumb-grid[data-psom-key="social-youtube"] a.card .pic video,
.thumb-grid[data-psom-key="social-instagram"] a.card .pic video,
.thumb-grid[data-psom-key="social-tiktok"] a.card .pic video,
.thumb-grid[data-psom-key="social-facebook"] a.card .pic video,
.thumb-grid[data-psom-key="social-youtube"] a.card .pic iframe,
.thumb-grid[data-psom-key="social-instagram"] a.card .pic iframe,
.thumb-grid[data-psom-key="social-tiktok"] a.card .pic iframe,
.thumb-grid[data-psom-key="social-facebook"] a.card .pic iframe{box-sizing:border-box!important;display:block!important;width:100%!important;height:100%!important;max-width:100%!important;min-width:0!important;max-height:100%!important;object-fit:contain!important;object-position:center!important;border:0!important;}
/* Image covers the native media rectangle; video/iframe content is never cropped. */
.thumb-grid[data-psom-key="social-youtube"] a.card .pic img,
.thumb-grid[data-psom-key="social-instagram"] a.card .pic img,
.thumb-grid[data-psom-key="social-tiktok"] a.card .pic img,
.thumb-grid[data-psom-key="social-facebook"] a.card .pic img{object-fit:cover!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .meta,
.thumb-grid[data-psom-key="social-instagram"] a.card .meta,
.thumb-grid[data-psom-key="social-tiktok"] a.card .meta,
.thumb-grid[data-psom-key="social-facebook"] a.card .meta{box-sizing:border-box!important;padding:9px 11px 11px!important;display:flex!important;flex-direction:column!important;gap:5px!important;min-height:0!important;flex:1 0 auto!important;background:#fff!important;text-align:start!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .title,
.thumb-grid[data-psom-key="social-instagram"] a.card .title,
.thumb-grid[data-psom-key="social-tiktok"] a.card .title,
.thumb-grid[data-psom-key="social-facebook"] a.card .title{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:3!important;line-clamp:3!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:normal!important;overflow-wrap:anywhere!important;font-size:13px!important;font-weight:650!important;line-height:1.36!important;height:calc(3 * 1.36em)!important;max-height:calc(3 * 1.36em)!important;min-height:calc(3 * 1.36em)!important;color:#1d2530!important;}
.thumb-grid[data-psom-key="social-tiktok"] a.card .title,
.thumb-grid[data-psom-key="social-tiktok"] a.card[data-sample="1"] .title{-webkit-line-clamp:2!important;line-clamp:2!important;height:calc(2 * 1.36em)!important;min-height:calc(2 * 1.36em)!important;max-height:calc(2 * 1.36em)!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .desc,
.thumb-grid[data-psom-key="social-instagram"] a.card .desc,
.thumb-grid[data-psom-key="social-tiktok"] a.card .desc,
.thumb-grid[data-psom-key="social-facebook"] a.card .desc{display:block!important;min-height:1.4em!important;height:1.4em!important;font-size:11px!important;font-weight:500!important;line-height:1.4!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;color:#66717e!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-stats,
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-stats,
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-stats,
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-stats{display:block!important;min-height:1.4em!important;height:1.4em!important;font-size:11px!important;line-height:1.4!important;color:#647484!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}
/* IGDC recommend + content-share controls never navigate the video card. */
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-actions{display:flex!important;flex-direction:row!important;gap:6px!important;align-items:center!important;justify-content:space-between!important;min-height:29px!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-action,
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-action,
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-action,
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-action{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:26px;padding:4px 7px;border-radius:7px;border:1px solid #d5dfea;background:#f6f9fd;color:#284561;font-size:11px;font-weight:650;line-height:1.3;white-space:nowrap;cursor:pointer;user-select:none;}
.thumb-grid[data-psom-key^="social-"] a.card .sn-card-action[aria-pressed="true"]{color:#174d9a;background:#e8f1ff;border-color:#8fb7ee}
.thumb-grid[data-psom-key^="social-"] a.card .sn-card-action:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"] .sn-card-action{visibility:hidden!important;pointer-events:none!important}
.thumb-grid[data-psom-key="social-youtube"] a.card .cta,
.thumb-grid[data-psom-key="social-instagram"] a.card .cta,
.thumb-grid[data-psom-key="social-tiktok"] a.card .cta,
.thumb-grid[data-psom-key="social-facebook"] a.card .cta{margin-top:auto!important;padding:5px 8px!important;line-height:1.3!important;font-size:11px!important;border-radius:7px!important;}
/* A sample and a published item occupy the exact same media and metadata box. */
.thumb-grid[data-psom-key="social-youtube"] a.card[data-sample="1"] .title,
.thumb-grid[data-psom-key="social-instagram"] a.card[data-sample="1"] .title,
.thumb-grid[data-psom-key="social-tiktok"] a.card[data-sample="1"] .title,
.thumb-grid[data-psom-key="social-facebook"] a.card[data-sample="1"] .title{display:-webkit-box!important;-webkit-line-clamp:3!important;white-space:normal!important;font-size:13px!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card[data-sample="1"] .pic,
.thumb-grid[data-psom-key="social-instagram"] a.card[data-sample="1"] .pic,
.thumb-grid[data-psom-key="social-tiktok"] a.card[data-sample="1"] .pic,
.thumb-grid[data-psom-key="social-facebook"] a.card[data-sample="1"] .pic{font-size:12px!important;line-height:1.3!important;}
@media(max-width:768px) and (orientation:portrait){
 .thumb-grid[data-psom-key="social-youtube"],
 .thumb-grid[data-psom-key="social-instagram"],
 .thumb-grid[data-psom-key="social-tiktok"],
 .thumb-grid[data-psom-key="social-facebook"]{grid-auto-columns:100%!important;width:100%!important;}
 .thumb-grid[data-psom-key="social-youtube"] a.card,
 .thumb-grid[data-psom-key="social-instagram"] a.card,
 .thumb-grid[data-psom-key="social-tiktok"] a.card,
 .thumb-grid[data-psom-key="social-facebook"] a.card{width:100%!important;min-width:0!important;max-width:none!important;}
}

/* Visual familiarity only: IGDC actions are not third-party native controls. */
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-action{border-radius:15px!important;background:#f2f2f2!important;color:#242424!important;border-color:#e5e5e5!important;}
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-action{border-radius:9px!important;background:#fff!important;color:#29222c!important;border-color:#e3dce6!important;}
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-action{border-radius:7px!important;background:#f3f5f6!important;color:#1e242a!important;border-color:#dbe1e5!important;}
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-action{border-radius:7px!important;background:#eff4fc!important;color:#20549c!important;border-color:#d4e2f6!important;}


/* Reddit: official post/video preview uses original-aspect image when available. */
.thumb-grid[data-psom-key="social-reddit"] a.card{box-sizing:border-box!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .pic{position:relative!important;overflow:hidden!important;box-sizing:border-box!important;background:#101318!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .pic img{display:block!important;width:100%!important;height:100%!important;object-fit:contain!important;object-position:center!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .title{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:3!important;line-clamp:3!important;overflow:hidden!important;white-space:normal!important;font-size:13px!important;line-height:1.36!important;height:calc(3 * 1.36em)!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .desc{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:1!important;overflow:hidden!important;white-space:nowrap!important;text-overflow:ellipsis!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .cta{display:none!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .sn-card-action{border-radius:16px!important;background:#fff2e9!important;color:#e04a13!important;border-color:#f4d0be!important;}

/* Equal compact information footer for the five active SNS cards. */
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-stats,
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-stats,
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-stats,
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-stats{display:none!important;height:0!important;min-height:0!important;margin:0!important;padding:0!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .cta,
.thumb-grid[data-psom-key="social-instagram"] a.card .cta,
.thumb-grid[data-psom-key="social-tiktok"] a.card .cta,
.thumb-grid[data-psom-key="social-facebook"] a.card .cta{display:none!important;}
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-actions{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr) repeat(3,26px)!important;align-items:center!important;gap:3px!important;width:100%!important;min-height:25px!important;margin-top:0!important;direction:inherit!important;}
.thumb-grid[data-psom-key^="social-"] a.card .sn-card-metric{font-size:10px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:#647484;text-align:center;unicode-bidi:plaintext;}
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-action,
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-action,
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-action,
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-action{min-height:24px!important;padding:3px!important;font-size:12px!important;font-weight:650!important;}
.thumb-grid[data-psom-key="social-facebook"] a.card .meta{min-height:0!important;}
.thumb-grid[data-psom-key="social-facebook"] a.card .title{margin:0!important;}
 .thumb-grid[data-psom-key="social-facebook"] a.card .desc{margin:0!important;}
/* Native interactions only: this footer identifies the provider, not a fake
   reaction meter. Equal footer baseline; never touch data-psom-key=rightPanel. */
.thumb-grid[data-psom-key="social-youtube"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-instagram"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-tiktok"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-facebook"] a.card .sn-card-actions,
.thumb-grid[data-psom-key="social-reddit"] a.card .sn-card-actions{display:flex!important;align-items:center!important;justify-content:flex-start!important;min-height:24px!important;height:24px!important;margin-top:auto!important;padding-top:2px!important;box-sizing:border-box!important;}
.thumb-grid[data-psom-key^="social-"] a.card .sn-native-provider-name{font-size:11px;font-weight:650;color:#526477;line-height:1.35;}
.thumb-grid[data-psom-key="social-facebook"] a.card .pic{aspect-ratio:4 / 5!important;background:#101318!important;}
.thumb-grid[data-psom-key="social-facebook"] a.card .pic img{object-fit:contain!important;}
.thumb-grid[data-psom-key="social-reddit"]{grid-auto-flow:column!important;grid-template-rows:1fr!important;grid-auto-columns:minmax(215px,250px)!important;align-items:stretch!important;gap:12px!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card{box-sizing:border-box!important;width:100%!important;min-width:0!important;display:flex!important;flex-direction:column!important;align-self:stretch!important;overflow:hidden!important;border-radius:12px!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .pic{aspect-ratio:4 / 5!important;min-height:0!important;flex:0 0 auto!important;display:flex!important;align-items:center!important;justify-content:center!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .meta{display:flex!important;flex:1 0 auto!important;flex-direction:column!important;gap:5px!important;box-sizing:border-box!important;padding:9px 11px 11px!important;text-align:start!important;background:#fff!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .title{height:calc(3 * 1.36em)!important;min-height:calc(3 * 1.36em)!important;max-height:calc(3 * 1.36em)!important;}
.thumb-grid[data-psom-key="social-reddit"] a.card .desc{height:1.4em!important;min-height:1.4em!important;}
@media(max-width:767px){.thumb-grid[data-psom-key="social-reddit"]{grid-auto-columns:100%!important;}}
`;
    document.head.appendChild(style);
  }

  function sampleLabelForSection(key) {
    const labels = {
      "social-youtube": "YouTube",
      "social-instagram": "Instagram",
      "social-tiktok": "TikTok",
      "social-facebook": "Facebook",
      "social-reddit": "Reddit",
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
      metaDesc.textContent = label;
      metaDesc.style.display = "";
    }
    const stats = qs('.sn-card-stats', card);
    if (stats) stats.textContent = '';
    delete card.dataset.snLikes;
    delete card.dataset.snClicks;
    ensureCardActions(card);
    if (pic) {
      setOriginalMediaRatio(pic, "");
      delete pic.dataset.snMediaRatio; delete pic.dataset.snMediaUrl; delete pic.dataset.snMediaPlatform;
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

  function isProviderUiThumbnail(platform, thumb) {
    if (!thumb) return false;
    if (platform === "tiktok" && /(?:sf-i18n-resources\.|tiktok-webarch-solution-i18n)/i.test(thumb)) return true;
    if (platform === "facebook" && /(?:static\.[^/]*fbcdn\.net\/|\/rsrc\.php)/i.test(thumb)) return true;
    return false;
  }

  function thumbnailRenderUrl(platform, contentUrl, thumb) {
    if (["instagram", "tiktok", "facebook"].indexOf(platform) < 0) return thumb || "";
    // A stored blank/expired/brand image must not prevent runtime lookup of
    // a real cover from the exact, already-published post URL.
    if (!contentUrl || !/^https:\/\//i.test(contentUrl)) return "";
    var q = new URLSearchParams({ platform: platform, url: contentUrl, thumb: isProviderUiThumbnail(platform, thumb) ? "" : (thumb || "") });
    return "/.netlify/functions/social-thumbnail-proxy?" + q.toString();
  }

  // TikTok covers can expire even while their underlying videos remain public.
  // In that case use the first-party video player as a visual fallback for the
  // SAME real video; never substitute another creator's image or a sample card.
  function tiktokPlayerUrl(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) return "";
      const m = u.pathname.match(/\/video\/(\d{12,24})(?:\/|$)/);
      return m ? "https://www.tiktok.com/player/v1/" + m[1] + "?autoplay=0&controls=0&description=0&music_info=0" : "";
    } catch (_error) { return ""; }
  }
  function paintTikTokPlayerFallback(pic, contentUrl) {
    const playerUrl = tiktokPlayerUrl(contentUrl);
    if (!playerUrl) return false;
    const iframe = document.createElement("iframe");
    iframe.title = "TikTok video preview";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.setAttribute("allow", "encrypted-media; fullscreen");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    iframe.tabIndex = -1;
    iframe.style.cssText = "display:block;width:100%;height:100%;border:0;pointer-events:none;";
    iframe.src = playerUrl;
    pic.appendChild(iframe);
    // If the provider blocks embeds, the real video's clickable card URL
    // remains unchanged, and the card retains its text title.
    return true;
  }
  function paintRedditTextPost(pic) {
    // A text-based Reddit post has no image by design. Show a readable, clearly
    // labeled post surface rather than a fake thumbnail or an empty grey box.
    var parentCard = pic && pic.closest && pic.closest('a.card');
    var label = parentCard && parentCard.querySelector('.title');
    var title = safeText(label && label.textContent) || 'Reddit post';
    var wrap = document.createElement('div');
    wrap.className = 'igdc-reddit-text-post';
    wrap.style.cssText = 'box-sizing:border-box;width:100%;height:100%;padding:20px 15px;display:flex;flex-direction:column;justify-content:center;gap:18px;background:#fff;color:#20252c;text-align:left;';
    var provider = document.createElement('strong');
    provider.textContent = 'Reddit · Post';
    provider.style.cssText = 'color:#ff4500;font-size:13px;font-weight:750;';
    var heading = document.createElement('div');
    heading.textContent = title;
    heading.style.cssText = 'font-size:15px;line-height:1.43;font-weight:650;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:7;overflow:hidden;overflow-wrap:anywhere;';
    wrap.appendChild(provider); wrap.appendChild(heading);
    pic.appendChild(wrap);
  }
  function paintFacebookOfficialPreview(pic, contentUrl) {
    // Provider's own post/video frame is the fallback; not another social
    // user's photo, a fabricated cover, or a generic Facebook logo.
    try {
      var u = new URL(contentUrl);
      if (!/^(?:www\.|m\.|web\.)?facebook\.com$/i.test(u.hostname) &&
          !/^fb\.watch$/i.test(u.hostname)) return false;
      var path = u.pathname || '';
      var isIndividual = /^\/reel\/[\w-]+/i.test(path) ||
        /\/(?:posts|videos|photos)\/[\w-]+/i.test(path) ||
        (path === '/watch' && !!u.searchParams.get('v')) ||
        /\/(?:story|permalink)\.php$/i.test(path) && !!u.searchParams.get('story_fbid');
      if (!isIndividual) return false;
      var isVideo = /\/(?:videos|reel)\//i.test(path) || (path === '/watch' && !!u.searchParams.get('v'));
      var url = new URL(isVideo ? 'https://www.facebook.com/plugins/video.php' : 'https://www.facebook.com/plugins/post.php');
      url.searchParams.set('href', contentUrl);
      url.searchParams.set('show_text', 'true');
      url.searchParams.set('width', '400');
      if (isVideo) url.searchParams.set('autoplay', 'false');
      var iframe = document.createElement('iframe');
      iframe.title = 'Facebook original post preview';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.setAttribute('allow', 'encrypted-media; fullscreen');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      iframe.tabIndex = -1;
      iframe.style.cssText = 'display:block;width:100%;height:100%;border:0;pointer-events:none;background:#fff;';
      iframe.src = url.toString();
      pic.appendChild(iframe);
      return true;
    } catch (_error) { return false; }
  }
  function paintThumb(pic, platform, contentUrl, thumb, eager) {
    if (!pic) return;
    pic.style.backgroundImage = "";
    pic.style.backgroundSize = "";
    pic.style.backgroundPosition = "";
    while (pic.firstChild) pic.removeChild(pic.firstChild);
    var safeThumb = isProviderUiThumbnail(platform, thumb) ? "" : thumb;
    var proxied = thumbnailRenderUrl(platform, contentUrl, safeThumb);
    if (!proxied) {
      delete pic.dataset.socialThumbLoading;
      pic.dataset.socialThumbFailed = '1';
      if (platform === "tiktok" && paintTikTokPlayerFallback(pic, contentUrl)) return;
      if (platform === "facebook" && paintFacebookOfficialPreview(pic, contentUrl)) return;
      if (platform === "reddit") { paintRedditTextPost(pic); return; }
      pic.textContent = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "•";
      return;
    }
    pic.dataset.socialThumbLoading = '1';
    delete pic.dataset.socialThumbFailed;
    var img = document.createElement("img");
    img.alt = "";
    img.style.opacity = "0";
    img.addEventListener("load", function () {
      if (img.parentNode !== pic) return;
      delete pic.dataset.socialThumbLoading;
      // Only static IG/FB posts adapt to the real photo ratio; player video
      // ratios must not be inferred from a cropped 16:9 oEmbed poster.
      const currentPlatform = pic.dataset.snMediaPlatform;
      const currentUrl = pic.dataset.snMediaUrl || '';
      if ((currentPlatform === 'instagram' && !/\/(reel|reels)\//i.test(currentUrl)) ||
          currentPlatform === 'reddit') {
        const native = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0;
        if (native >= .5 && native <= 2.2) {
          const value = nearestNativeRatio(currentPlatform, native);
          setOriginalMediaRatio(pic, value);
          pic.dataset.snMediaRatio = value;
        }
      }
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
    img.dataset.directThumb = safeThumb;
    img.addEventListener("error", function () {
      if (safeThumb && img.dataset.triedDirect !== "1" && proxied !== safeThumb) {
        img.dataset.triedDirect = "1";
        img.src = safeThumb;
        return;
      }
      if (img.parentNode === pic) pic.removeChild(img);
      delete pic.dataset.socialThumbLoading;
      pic.dataset.socialThumbFailed = '1';
      if (platform === "tiktok" && paintTikTokPlayerFallback(pic, contentUrl)) return;
      if (platform === "facebook" && paintFacebookOfficialPreview(pic, contentUrl)) return;
      if (platform === "reddit") { paintRedditTextPost(pic); return; }
      pic.textContent = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "•";
    });
    pic.appendChild(img);
    img.src = proxied;
  }

  // Original-media shapes: do not force every Instagram/Facebook post into
  // a video rectangle. Metadata wins; media image natural ratio is fallback.
  function originalMediaRatio(platform, url, item) {
    const textValue = (v) => safeText(v).toLowerCase();
    const kind = textValue(item && (item.mediaType || item.contentType || item.postType ||
      (item.social && (item.social.mediaType || item.social.contentType))));
    const candidate = textValue(url);
    if (platform === 'youtube') return '16 / 9';
    if (platform === 'reddit') return '';
    if (platform === 'tiktok') return '9 / 16';
    if (platform === 'instagram' && (/\/(reel|reels)\//i.test(candidate) || /reel|story/.test(kind))) return '9 / 16';
    if (platform === 'facebook' && (/\/(videos|watch)\b/i.test(candidate) || /video|reel/.test(kind))) return '16 / 9';
    const meta = item && (item.aspectRatio || item.aspect_ratio || item.mediaAspectRatio ||
      (item.social && item.social.aspectRatio));
    const asNum = typeof meta === 'number' ? meta : (/^\d+(?:\.\d+)?$/.test(textValue(meta)) ? Number(meta) : NaN);
    const split = textValue(meta).match(/^(\d+(?:\.\d+)?)\s*[:\/]\s*(\d+(?:\.\d+)?)$/);
    const ratio = split ? Number(split[1]) / Number(split[2]) : asNum;
    if (Number.isFinite(ratio) && ratio >= .5 && ratio <= 2.2) return nearestNativeRatio(platform, ratio);
    return '4 / 5';
  }
  function nearestNativeRatio(platform, value) {
    const options = platform === 'facebook'
      ? [[9,16],[3,4],[4,5],[1,1],[16,9]]
      : [[9,16],[3,4],[4,5],[1,1],[16,9]];
    let best = options[0], error = Infinity;
    options.forEach(pair => {
      const e = Math.abs(Math.log(value / (pair[0] / pair[1])));
      if (e < error) { error = e; best = pair; }
    });
    return best[0] + ' / ' + best[1];
  }
  function setOriginalMediaRatio(pic, ratio) {
    if (!pic) return;
    if (ratio) pic.style.setProperty('aspect-ratio', ratio, 'important');
    else pic.style.removeProperty('aspect-ratio');
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
    const platform = safeText(it && (it.platform || (it.social && it.social.platform) || (it.source && it.source.platform))).toLowerCase().replace(/^social-/, "");
    const title = cleanCardTitle(it, platform);
    const desc = COMPACT_MAIN_KEYS.has('social-' + platform)
      ? (pickCreator(it) || safeText(it && (it.publisher || it.channelName || it.author || (it.source && it.source.publisher))) || (platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Social"))
      : cardIdentity(it);
    const thumb = pickThumb(it);
    const originalRatio = platform === 'facebook' ? '4 / 5' :
      (COMPACT_MAIN_KEYS.has('social-' + platform) ? originalMediaRatio(platform, url, it) : '');

    const latestContentUrl = safeText(it && (it.latestContentUrl || it.latest_content_url || (it.social && it.social.latestContentUrl)));
    const viewerUrl = safeText(it && (it.viewerUrl || it.permalink || it.href || it.link));
    const embedUrl = safeText(it && (it.embedUrl || it.embed_url));

    card.href = url || "#";
    card.dataset.contentUrl = url || "#";
    card.dataset.socialUrl = url || "#";
    card.dataset.latestContentUrl = latestContentUrl || url || "";
    card.dataset.viewerUrl = viewerUrl || url || "";
    // The contained SNS viewer must not reuse a poisoned provider UI image.
    // If the relay recovers a cover, it can read the rendered <img> instead.
    card.dataset.thumbnailUrl = isProviderUiThumbnail(platform, thumb) ? "" : (thumb || "");
    card.dataset.embedUrl = embedUrl;
    card.dataset.profileFallback = it && it.social && it.social.profileFallback ? "1" : "0";
    // Viewer bridge intercepts normal clicks. _blank remains only as a fail-safe
    // when the bridge itself is unavailable, so a real video/post is never dead.
    card.target = url && url !== "#" ? "_blank" : "_self";
    card.rel = "noopener";
    card.removeAttribute("data-dummy");

    const pic = qs(".pic", card);
    setOriginalMediaRatio(pic, originalRatio);
    if (pic) { pic.dataset.snMediaRatio = originalRatio; pic.dataset.snMediaPlatform = platform; pic.dataset.snMediaUrl = url; }
    const metaTitle = qs(".title", card);
    const metaDesc = qs(".desc", card);

    if (metaTitle) {
      metaTitle.textContent = title;
      metaTitle.style.display = "-webkit-box";
      metaTitle.style.webkitBoxOrient = "vertical";
      metaTitle.style.webkitLineClamp = platform === "tiktok" ? "2" : "3";
      metaTitle.style.overflow = "hidden";
      metaTitle.style.whiteSpace = "normal";
      metaTitle.style.lineHeight = "1.35";
    }
    if (metaDesc) {
      // Keep the description/creator text accessible to the existing SNS
      // viewer bridge, while showing a single metadata line in the card.
      metaDesc.textContent = desc;
      metaDesc.style.display = '';
    }
    ensureCardActions(card);
    paintSocialStats(card, it);

    const slotIndex = Number(card.dataset.socialSlotNo || 0);
    const rowRect = card.getBoundingClientRect && card.getBoundingClientRect();
    const eagerThumb = slotIndex > 0 && slotIndex <= 4 && rowRect &&
      rowRect.bottom > -80 && rowRect.top < (window.innerHeight || 800) + 360;
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
      if (['social-youtube','social-instagram','social-tiktok'].includes(key)) {
        existing.forEach(function(card) {
          if (!qs('.meta', card)) return;
          if (key === 'social-facebook') {
            const descEl = qs('.desc', card);
            if (descEl && /^\s*false\s*[·:|\-]/i.test(descEl.textContent || '')) {
              descEl.textContent = descEl.textContent.replace(/^\s*false\s*[·:|\-]\s*/i, '');
            }
          }
          ensureCardActions(card);
        });
      }
      if (existing.length >= MAIN_LIMIT) return;
      const fragment = document.createDocumentFragment();
      const cardMarkup = mainCardMarkup(grid);
      for (let i = existing.length; i < MAIN_LIMIT; i++) {
        const card = document.createElement('a');
        card.className = 'card';
        card.href = '#';
        card.dataset.sample = '1';
        card.dataset.snapshotSample = '1';
        card.dataset.socialSlotNo = String(i + 1).padStart(3, '0');
        card.dataset.socialRenderSignature = 'sample';
        card.setAttribute('aria-label', label + ' SAMPLE ' + card.dataset.socialSlotNo);
        card.innerHTML = cardMarkup;
        const pic = qs('.pic', card);
        if (pic) { pic.dataset.sampleSlot = card.dataset.socialSlotNo; pic.textContent = label; }
        const title = qs('.title', card);
        if (title) title.textContent = label + ' · ' + card.dataset.socialSlotNo;
        const desc = qs('.desc', card);
        if (desc) { desc.textContent = label; desc.style.display = ''; }
        ensureCardActions(card);
        fragment.appendChild(card);
      }
      // Existing slot and scroll-button geometry is preserved unchanged.
      grid.appendChild(fragment);
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
          safeText(item.embedUrl || item.embed_url),
          socialMetric(item, ['viewCount','view_count','views','videoViews','playCount','play_count']),
          socialMetric(item, ['likeCount','like_count','likes','heartCount']),
          socialMetric(item, ['clickCount','click_count','outboundClickCount','outbound_click_count','cardClickCount','card_click_count'])].join('\u001f');
        if (card.dataset.socialRenderSignature !== signature || card.dataset.sample === '1') {
          paintMainCard(card, item);
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
        saveFastMain(current);
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

  document.addEventListener('click', function (event) {
    const card = event.target && event.target.closest &&
      event.target.closest('.thumb-grid[data-psom-key^="social-"] a.card[data-sample="1"]');
    if (card) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);

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
