/**
 * assets/js/maru-health.js
 * ------------------------------------------------------------
 * MARU HEALTH FRONT PATCH — revenue / thumbnail / product mapping
 *
 * Target:
 * - Existing Admin site-control card: "수익 · 썸네일 · 상품 맵핑"
 *
 * Safe policy:
 * - Does not replace the existing Site/API/ENV/Backend/Device/Browser/UX checks.
 * - Does not add a duplicate health panel.
 * - Finds the existing target card, fills its status/body, and opens a richer modal on click.
 * - If the existing card is not ready yet, it waits and retries quietly.
 */

(function (global, document) {
  "use strict";

  if (!global || !document) return;

  var VERSION = "asset-js-target-card-v1.1";
  var MODAL_ID = "maru-health-revenue-map-modal";
  var STYLE_ID = "maru-health-revenue-map-style";
  var TARGET_TEXTS = ["수익", "썸네일", "상품", "맵핑"];
  var LAST_RESULT = null;
  var RUNNING = false;
  var DEFAULT_TIMEOUT = 5500;

  function s(v) { return String(v == null ? "" : v); }
  function low(v) { return s(v).trim().toLowerCase(); }
  function now() { return Date.now(); }
  function byId(id) { return document.getElementById(id); }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function escapeHtml(v) {
    return s(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortError(e) {
    return s((e && (e.message || e.statusText)) || e || "unknown_error").slice(0, 220);
  }

  function injectStyle() {
    if (byId(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".maru-health-rich-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;z-index:99999;}" +
      ".maru-health-rich-modal{width:min(980px,94vw);max-height:90vh;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;border:1px solid #e5e7eb;}" +
      ".maru-health-rich-head{padding:14px 16px;background:linear-gradient(180deg,#fffaf0,#ffffff);border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:12px;}" +
      ".maru-health-rich-title{font-size:16px;font-weight:900;color:#5a3c19;}" +
      ".maru-health-rich-sub{font-size:11px;color:#8a6d3b;margin-top:3px;}" +
      ".maru-health-rich-close{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:700;}" +
      ".maru-health-rich-body{padding:14px 16px;overflow:auto;font-size:12px;color:#333;}" +
      ".maru-health-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px;}" +
      ".maru-health-metric{border:1px solid #edf0f5;border-radius:12px;background:#fbfdff;padding:10px;min-height:64px;}" +
      ".maru-health-metric .k{font-size:11px;color:#64748b;font-weight:800;margin-bottom:6px;}" +
      ".maru-health-metric .v{font-size:18px;font-weight:900;color:#0f172a;}" +
      ".maru-health-metric .n{font-size:11px;color:#64748b;margin-top:4px;}" +
      ".maru-health-section{border:1px solid #eef2f7;border-radius:12px;background:#fff;margin:10px 0;overflow:hidden;}" +
      ".maru-health-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;background:#f8fafc;border-bottom:1px solid #eef2f7;}" +
      ".maru-health-section-title{font-weight:900;color:#334155;font-size:13px;}" +
      ".maru-health-badge{font-size:11px;font-weight:900;border-radius:999px;padding:2px 8px;border:1px solid #e5e7eb;background:#fff;}" +
      ".maru-health-badge.ok{color:#047857;border-color:#bbf7d0;background:#f0fdf4;}" +
      ".maru-health-badge.warn{color:#a16207;border-color:#fde68a;background:#fffbeb;}" +
      ".maru-health-badge.error{color:#b91c1c;border-color:#fecaca;background:#fef2f2;}" +
      ".maru-health-table{width:100%;border-collapse:collapse;font-size:12px;}" +
      ".maru-health-table th,.maru-health-table td{border-bottom:1px solid #eef2f7;padding:7px 8px;text-align:left;vertical-align:top;}" +
      ".maru-health-table th{background:#fff;color:#475569;font-size:11px;}" +
      ".maru-health-note{font-size:11px;color:#64748b;line-height:1.5;padding:9px 11px;}" +
      ".maru-health-json{background:#0f172a;color:#e5e7eb;border-radius:10px;padding:10px;white-space:pre-wrap;overflow:auto;font-size:11px;max-height:280px;}" +
      "@media(max-width:720px){.maru-health-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.maru-health-rich-modal{width:96vw;}}";

    document.head.appendChild(style);
  }

  function statusLabel(status) {
    if (status === "ok") return "OK";
    if (status === "warn") return "WARN";
    return "ERROR";
  }

  function statusKo(status) {
    if (status === "ok") return "정상";
    if (status === "warn") return "주의";
    return "오류";
  }

  function statusClass(status) {
    if (status === "ok") return "igdc-sc-badge-ok";
    if (status === "warn") return "igdc-sc-badge-warn";
    return "igdc-sc-badge-error";
  }

  function readyText(value, fallback) {
    if (value == null || value === "") return fallback || "-";
    return value;
  }

  function findTargetCard() {
    var host = byId("igdc-site-control") || document.querySelector(".igdc-site-control");
    if (!host) return null;

    var cards = Array.prototype.slice.call(host.querySelectorAll(".igdc-sc-card, [data-card], section, div, button"));
    var best = null;

    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var text = s(el.textContent).replace(/\s+/g, " ").trim();
      if (!text) continue;

      var hit = TARGET_TEXTS.every(function (k) { return text.indexOf(k) >= 0; });
      if (!hit) continue;

      if (el.classList && el.classList.contains("igdc-sc-card")) return el;

      var parentCard = el.closest && el.closest(".igdc-sc-card");
      if (parentCard) return parentCard;

      if (!best) best = el;
    }

    return best;
  }

  function targetParts(card) {
    if (!card) return {};
    return {
      title: card.querySelector(".igdc-sc-card-title") || card.querySelector("[data-title]"),
      status: card.querySelector(".igdc-sc-card-status") || card.querySelector("[data-status]"),
      body: card.querySelector(".igdc-sc-card-body") || card.querySelector("[data-body]")
    };
  }

  function setCardState(card, status, body) {
    if (!card) return;

    var p = targetParts(card);

    if (p.status) {
      p.status.textContent = statusLabel(status);
      p.status.className = "igdc-sc-card-status " + statusClass(status);
    }

    if (p.body) {
      p.body.textContent = body || "";
    } else {
      card.setAttribute("title", body || "");
    }

    card.dataset.maruHealthReady = "1";
    card.dataset.maruHealthStatus = status;

    card.style.cursor = "pointer";
  }

  function hookTargetCard(card) {
    if (!card || card.__maruRevenueMapHooked) return;
    card.__maruRevenueMapHooked = true;

    card.addEventListener("click", function (ev) {
      try { ev.preventDefault(); ev.stopPropagation(); } catch (_) {}
      if (!LAST_RESULT) {
        runTargetCheck({ manual: true }).then(function () { openModal(LAST_RESULT); });
      } else {
        openModal(LAST_RESULT);
      }
      return false;
    }, true);
  }

  function hookExistingRunButton() {
    var host = byId("igdc-site-control") || document.querySelector(".igdc-site-control") || document;
    var buttons = Array.prototype.slice.call(host.querySelectorAll("button, a"));

    buttons.forEach(function (btn) {
      if (btn.__maruRevenueMapRunHooked) return;

      var text = low(btn.textContent || btn.value || "");
      var id = low(btn.id || "");
      var cls = low(btn.className || "");

      var looksLikeRun =
        text.indexOf("전체") >= 0 && (text.indexOf("헬스") >= 0 || text.indexOf("체크") >= 0 || text.indexOf("실행") >= 0) ||
        id.indexOf("health") >= 0 ||
        cls.indexOf("igdc-sc-run") >= 0;

      if (!looksLikeRun) return;

      btn.__maruRevenueMapRunHooked = true;
      btn.addEventListener("click", function () {
        setTimeout(function () { runTargetCheck({ source: "existing-run" }); }, 350);
      });
    });
  }

  async function fetchJson(endpoint, options) {
    options = options || {};
    var started = now();
    var ctrl = global.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () {
      try { ctrl.abort(); } catch (_) {}
    }, options.timeout || DEFAULT_TIMEOUT) : null;

    try {
      var res = await fetch(endpoint, {
        method: options.method || "GET",
        cache: "no-store",
        credentials: options.credentials || "same-origin",
        headers: options.headers || undefined,
        signal: ctrl ? ctrl.signal : undefined
      });

      var text = await res.text();
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}

      return {
        endpoint: endpoint,
        ok: !!res.ok,
        status: res.status,
        elapsed: now() - started,
        json: json,
        text: text
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function extractItems(json) {
    if (!json) return [];
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.results)) return json.results;
    if (json.data && Array.isArray(json.data.items)) return json.data.items;
    if (json.data && Array.isArray(json.data.results)) return json.data.results;
    if (json.baseResult && Array.isArray(json.baseResult.items)) return json.baseResult.items;
    if (json.baseResult && json.baseResult.data && Array.isArray(json.baseResult.data.items)) return json.baseResult.data.items;
    if (Array.isArray(json.rows)) return json.rows;
    return [];
  }

  function hasImage(it) {
    if (!it || typeof it !== "object") return false;
    return !!(
      it.thumbnail || it.thumb || it.image ||
      (Array.isArray(it.imageSet) && it.imageSet.length) ||
      (it.media && it.media.preview && (it.media.preview.poster || it.media.preview.mp4 || it.media.preview.webm))
    );
  }

  function hasCommerceSignal(it) {
    var text = low([
      it && it.id,
      it && it.type,
      it && it.mediaType,
      it && it.channel,
      it && it.section,
      it && it.source,
      it && it.url,
      it && it.title,
      Array.isArray(it && it.tags) ? it.tags.join(" ") : "",
      JSON.stringify((it && (it.commerce || it.directSale || it.linkRevenue || it.revenue || it.monetization)) || {})
    ].join(" "));

    return /commerce|shopping|product|distribution|market|상품|쇼핑|유통|판매|directsale|revenue|monetization/.test(text);
  }

  function hasMappingSignal(it) {
    if (!it || typeof it !== "object") return false;
    return !!(
      it.section || it.channel || it.page || it.route || it.psom_key || it.bind ||
      (Array.isArray(it.tags) && it.tags.length) ||
      it.linkRevenue || it.revenue || it.monetization || it.directSale
    );
  }

  async function probeFirst(endpoints) {
    var attempts = [];

    for (var i = 0; i < endpoints.length; i++) {
      var ep = endpoints[i];
      try {
        var r = await fetchJson(ep);
        attempts.push({
          endpoint: ep,
          ok: r.ok,
          status: r.status,
          elapsed: r.elapsed,
          count: extractItems(r.json).length,
          json: r.json
        });
        if (r.ok) return { ok: true, response: r, attempts: attempts };
      } catch (e) {
        attempts.push({ endpoint: ep, ok: false, error: shortError(e) });
      }
    }

    return { ok: false, response: null, attempts: attempts };
  }

  async function checkRevenue() {
    var endpoints = [
      "/.netlify/functions/maru-revenue-engine?action=report",
      "/.netlify/functions/maru-revenue-engine?mode=health",
      "/api/igdc/income/summary"
    ];

    var pack = await probeFirst(endpoints);
    if (!pack.ok) {
      return {
        status: "warn",
        label: "수익",
        message: "수익 endpoint 미응답 또는 미배포",
        count: 0,
        endpoint: endpoints[0],
        attempts: pack.attempts,
        raw: null
      };
    }

    var j = pack.response.json || {};
    var count = 0;
    var total = 0;

    if (j.breakdown && typeof j.breakdown === "object") {
      count = Object.keys(j.breakdown).length;
      Object.keys(j.breakdown).forEach(function (k) {
        var n = Number(j.breakdown[k]);
        if (isFinite(n)) total += n;
      });
    } else if (j.summary && typeof j.summary === "object") {
      count = Object.keys(j.summary).length;
      Object.keys(j.summary).forEach(function (k) {
        var row = j.summary[k] || {};
        var n = Number(row.total || row.month || row.day || 0);
        if (isFinite(n)) total += n;
      });
    } else if (Array.isArray(j.items)) {
      count = j.items.length;
    }

    return {
      status: "ok",
      label: "수익",
      message: "수익/정산 응답 확인",
      count: count,
      total: total,
      endpoint: pack.response.endpoint,
      elapsed: pack.response.elapsed,
      attempts: pack.attempts,
      raw: j
    };
  }

  async function checkThumbnail() {
    var endpoints = [
      "/.netlify/functions/maru-search?q=media&limit=20&type=image&external=off",
      "/.netlify/functions/maru-search?q=video&limit=20&type=video&external=off",
      "/.netlify/functions/search-bank-engine?q=media&limit=20&external=off"
    ];

    var pack = await probeFirst(endpoints);
    if (!pack.ok) {
      return {
        status: "warn",
        label: "썸네일",
        message: "썸네일 후보 endpoint 확인 불가",
        count: 0,
        withImage: 0,
        attempts: pack.attempts,
        raw: null
      };
    }

    var items = extractItems(pack.response.json);
    var withImage = items.filter(hasImage).length;
    var status = items.length && withImage ? "ok" : "warn";

    return {
      status: status,
      label: "썸네일",
      message: withImage ? "이미지/영상 썸네일 후보 확인" : "응답은 있으나 썸네일 후보 부족",
      count: items.length,
      withImage: withImage,
      endpoint: pack.response.endpoint,
      elapsed: pack.response.elapsed,
      attempts: pack.attempts,
      raw: pack.response.json
    };
  }

  async function checkProductMapping() {
    var endpoints = [
      "/.netlify/functions/search-bank-engine?q=shopping&limit=30&type=shopping&external=off",
      "/.netlify/functions/search-bank-engine?q=commerce&limit=30&channel=commerce&external=off",
      "/.netlify/functions/maru-search?q=shopping&limit=30&type=shopping&external=off"
    ];

    var pack = await probeFirst(endpoints);
    if (!pack.ok) {
      return {
        status: "warn",
        label: "상품 맵핑",
        message: "상품/커머스 맵핑 endpoint 확인 불가",
        count: 0,
        mapped: 0,
        commerce: 0,
        attempts: pack.attempts,
        raw: null
      };
    }

    var items = extractItems(pack.response.json);
    var mapped = items.filter(hasMappingSignal).length;
    var commerce = items.filter(hasCommerceSignal).length;
    var status = items.length && (mapped || commerce) ? "ok" : "warn";

    return {
      status: status,
      label: "상품 맵핑",
      message: status === "ok" ? "상품/커머스 맵핑 신호 확인" : "응답은 있으나 맵핑 신호 부족",
      count: items.length,
      mapped: mapped,
      commerce: commerce,
      endpoint: pack.response.endpoint,
      elapsed: pack.response.elapsed,
      attempts: pack.attempts,
      raw: pack.response.json
    };
  }

  function summarizeResult(result) {
    var parts = result && result.parts ? result.parts : [];
    var errors = parts.filter(function (p) { return p.status === "error"; }).length;
    var warns = parts.filter(function (p) { return p.status === "warn"; }).length;
    var oks = parts.filter(function (p) { return p.status === "ok"; }).length;

    var status = errors ? "error" : (warns ? "warn" : "ok");

    var thumb = result.thumbnail || {};
    var prod = result.product || {};
    var rev = result.revenue || {};

    var body = [
      "수익 " + statusKo(rev.status || "warn"),
      "썸네일 " + readyText(thumb.withImage, 0) + "/" + readyText(thumb.count, 0),
      "상품맵 " + readyText(prod.mapped, 0) + "/" + readyText(prod.count, 0)
    ].join(" · ");

    return { status: status, body: body, okCount: oks, warnCount: warns, errorCount: errors };
  }

  async function runTargetCheck(options) {
    options = options || {};
    if (RUNNING) return LAST_RESULT;
    RUNNING = true;

    var card = findTargetCard();
    if (card) {
      hookTargetCard(card);
      setCardState(card, "warn", "수익·썸네일·상품 맵핑 점검 중…");
    }

    var started = now();

    try {
      var settled = await Promise.allSettled([
        checkRevenue(),
        checkThumbnail(),
        checkProductMapping()
      ]);

      var revenue = settled[0].status === "fulfilled" ? settled[0].value : { status: "error", label: "수익", message: shortError(settled[0].reason) };
      var thumbnail = settled[1].status === "fulfilled" ? settled[1].value : { status: "error", label: "썸네일", message: shortError(settled[1].reason) };
      var product = settled[2].status === "fulfilled" ? settled[2].value : { status: "error", label: "상품 맵핑", message: shortError(settled[2].reason) };

      LAST_RESULT = {
        version: VERSION,
        ts: new Date().toISOString(),
        elapsed: now() - started,
        revenue: revenue,
        thumbnail: thumbnail,
        product: product,
        parts: [revenue, thumbnail, product]
      };

      var summary = summarizeResult(LAST_RESULT);
      LAST_RESULT.summary = summary;

      card = findTargetCard();
      if (card) {
        hookTargetCard(card);
        setCardState(card, summary.status, summary.body);
      }

      try {
        global.dispatchEvent(new CustomEvent("MARU_HEALTH_REVENUE_MAP_DONE", { detail: LAST_RESULT }));
      } catch (_) {}

      return LAST_RESULT;
    } finally {
      RUNNING = false;
    }
  }

  function metricBox(k, v, note) {
    return '<div class="maru-health-metric">' +
      '<div class="k">' + escapeHtml(k) + '</div>' +
      '<div class="v">' + escapeHtml(v) + '</div>' +
      '<div class="n">' + escapeHtml(note || "") + '</div>' +
    '</div>';
  }

  function badge(status) {
    return '<span class="maru-health-badge ' + escapeHtml(status || "warn") + '">' + escapeHtml(statusKo(status || "warn")) + '</span>';
  }

  function endpointRows(part) {
    var attempts = Array.isArray(part && part.attempts) ? part.attempts : [];
    if (!attempts.length && part && part.endpoint) {
      attempts = [{ endpoint: part.endpoint, ok: part.status === "ok", status: part.status, elapsed: part.elapsed, count: part.count }];
    }

    return attempts.map(function (a) {
      return '<tr>' +
        '<td>' + escapeHtml(a.endpoint || "-") + '</td>' +
        '<td>' + escapeHtml(a.ok ? "OK" : (a.status ? "HTTP " + a.status : "FAIL")) + '</td>' +
        '<td>' + escapeHtml(a.elapsed == null ? "-" : a.elapsed + "ms") + '</td>' +
        '<td>' + escapeHtml(a.count == null ? "-" : a.count) + '</td>' +
        '<td>' + escapeHtml(a.error || "") + '</td>' +
      '</tr>';
    }).join("");
  }

  function section(part) {
    part = part || {};
    return '<div class="maru-health-section">' +
      '<div class="maru-health-section-head">' +
        '<div class="maru-health-section-title">' + escapeHtml(part.label || "항목") + '</div>' +
        badge(part.status || "warn") +
      '</div>' +
      '<div class="maru-health-note">' + escapeHtml(part.message || "") + '</div>' +
      '<table class="maru-health-table">' +
        '<thead><tr><th>Endpoint</th><th>상태</th><th>응답</th><th>건수</th><th>메모</th></tr></thead>' +
        '<tbody>' + endpointRows(part) + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function openModal(result) {
    injectStyle();
    closeModal();

    result = result || LAST_RESULT || {};
    var summary = result.summary || summarizeResult(result);
    var rev = result.revenue || {};
    var th = result.thumbnail || {};
    var pr = result.product || {};

    var backdrop = document.createElement("div");
    backdrop.id = MODAL_ID;
    backdrop.className = "maru-health-rich-backdrop";

    var rawLite = {
      version: result.version,
      ts: result.ts,
      elapsed: result.elapsed,
      summary: summary,
      revenue: {
        status: rev.status,
        count: rev.count,
        total: rev.total,
        endpoint: rev.endpoint,
        message: rev.message
      },
      thumbnail: {
        status: th.status,
        count: th.count,
        withImage: th.withImage,
        endpoint: th.endpoint,
        message: th.message
      },
      product: {
        status: pr.status,
        count: pr.count,
        mapped: pr.mapped,
        commerce: pr.commerce,
        endpoint: pr.endpoint,
        message: pr.message
      }
    };

    backdrop.innerHTML =
      '<div class="maru-health-rich-modal" role="dialog" aria-modal="true">' +
        '<div class="maru-health-rich-head">' +
          '<div>' +
            '<div class="maru-health-rich-title">수익 · 썸네일 · 상품 맵핑 상세 점검</div>' +
            '<div class="maru-health-rich-sub">기존 헬스 체크는 유지하고, 이 카드의 확장 항목만 점검합니다. · ' + escapeHtml(result.ts || "") + '</div>' +
          '</div>' +
          '<button type="button" class="maru-health-rich-close">닫기</button>' +
        '</div>' +
        '<div class="maru-health-rich-body">' +
          '<div class="maru-health-summary-grid">' +
            metricBox("전체 상태", statusKo(summary.status), "OK " + (summary.okCount || 0) + " · WARN " + (summary.warnCount || 0) + " · ERROR " + (summary.errorCount || 0)) +
            metricBox("수익", statusKo(rev.status || "warn"), "항목 " + readyText(rev.count, 0) + " · 합계 " + readyText(rev.total, 0)) +
            metricBox("썸네일", readyText(th.withImage, 0) + "/" + readyText(th.count, 0), "이미지/영상 후보") +
            metricBox("상품 맵핑", readyText(pr.mapped, 0) + "/" + readyText(pr.count, 0), "커머스 신호 " + readyText(pr.commerce, 0)) +
          '</div>' +
          section(rev) +
          section(th) +
          section(pr) +
          '<div class="maru-health-section">' +
            '<div class="maru-health-section-head"><div class="maru-health-section-title">판정 요약</div>' + badge(summary.status) + '</div>' +
            '<div class="maru-health-note">' +
              '이 모달은 실제 수익 정산, 썸네일 후보, 상품/커머스 맵핑 신호를 프론트에서 안전하게 확인하는 보조 진단입니다. ' +
              'endpoint가 없거나 미배포된 항목은 오류가 아니라 WARN으로 표시됩니다.' +
            '</div>' +
          '</div>' +
          '<div class="maru-health-section">' +
            '<div class="maru-health-section-head"><div class="maru-health-section-title">요약 JSON</div><span class="maru-health-badge ok">DEBUG</span></div>' +
            '<div style="padding:10px;"><div class="maru-health-json">' + escapeHtml(JSON.stringify(rawLite, null, 2)) + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    backdrop.addEventListener("click", function (ev) {
      if (ev.target === backdrop) closeModal();
    });

    var close = backdrop.querySelector(".maru-health-rich-close");
    if (close) close.addEventListener("click", closeModal);

    document.body.appendChild(backdrop);
  }

  function closeModal() {
    var m = byId(MODAL_ID);
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function waitForTargetCard(tries) {
    tries = tries || 0;

    var card = findTargetCard();
    if (card) {
      hookTargetCard(card);
      setCardState(card, "warn", "수익·썸네일·상품 맵핑 대기 중");
      hookExistingRunButton();
      return true;
    }

    if (tries < 80) {
      setTimeout(function () { waitForTargetCard(tries + 1); }, 250);
    }

    return false;
  }

  function init() {
    injectStyle();
    waitForTargetCard(0);

    setTimeout(function () {
      hookExistingRunButton();

      var card = findTargetCard();
      if (card) {
        hookTargetCard(card);
        runTargetCheck({ auto: true, reason: "initial-hydrate" });
      }
    }, 900);
  }

  global.MaruHealth = global.MaruHealth || {};
  global.MaruHealth.revenueMapVersion = VERSION;
  global.MaruHealth.runRevenueMapCheck = runTargetCheck;
  global.MaruHealth.openRevenueMapModal = function () { openModal(LAST_RESULT); };

  global.IGDC_HEALTH = global.IGDC_HEALTH || {};
  global.IGDC_HEALTH.runRevenueMapCheck = runTargetCheck;

  global.runMaruRevenueMapHealth = runTargetCheck;

  ready(init);

})(window, document);
