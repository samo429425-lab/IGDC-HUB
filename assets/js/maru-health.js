/**
 * assets/js/maru-health.js
 * ------------------------------------------------------------
 * MARU HEALTH FRONT PATCH — Snapshot Slot / Revenue Mapping Audit
 *
 * Target:
 * - Existing Admin site-control card: "수익 · 썸네일 · 상품 맵핑"
 *
 * What this version checks:
 * - Search Bank Snapshot slot design count
 * - Real content count vs sample/placeholder count
 * - Page/section-level slot fill status
 * - Revenue/monetization structure signal
 * - Direct sale / product / commerce mapping signal
 * - Search media probe is kept as a supplemental check only
 *
 * Safe:
 * - Existing Site/API/ENV/Backend/Device/Browser/UX checks are not modified.
 * - Existing card is reused. No duplicate panel is created.
 */

(function(global, document){
  "use strict";

  if(!global || !document) return;

  var VERSION = "snapshot-slot-revenue-audit-v1.0";
  var MODAL_ID = "maru-health-snapshot-slot-modal";
  var STYLE_ID = "maru-health-snapshot-slot-style";
  var TARGET_TEXTS = ["수익", "썸네일", "상품", "맵핑"];
  var LAST_RESULT = null;
  var RUNNING = false;
  var TIMEOUT = 7000;

  function s(v){ return String(v == null ? "" : v); }
  function low(v){ return s(v).trim().toLowerCase(); }
  function now(){ return Date.now(); }
  function byId(id){ return document.getElementById(id); }

  function ready(fn){
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function escapeHtml(v){
    return s(v)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function shortError(e){
    return s((e && (e.message || e.statusText)) || e || "unknown_error").slice(0, 220);
  }

  function statusLabel(st){
    if(st === "ok") return "OK";
    if(st === "warn") return "부분확인";
    if(st === "pending") return "-";
    return "ERROR";
  }

  function statusKo(st){
    if(st === "ok") return "정상";
    if(st === "warn") return "주의";
    if(st === "pending") return "대기";
    return "오류";
  }

  function statusClass(st){
    if(st === "ok") return "igdc-sc-badge-ok";
    if(st === "warn") return "igdc-sc-badge-warn";
    if(st === "pending") return "";
    return "igdc-sc-badge-error";
  }

  function injectStyle(){
    if(byId(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".mh-slot-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;z-index:99999;}" +
      ".mh-slot-modal{width:min(1120px,95vw);max-height:91vh;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;border:1px solid #e5e7eb;}" +
      ".mh-slot-head{padding:14px 16px;background:linear-gradient(180deg,#fffaf0,#ffffff);border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:12px;}" +
      ".mh-slot-title{font-size:16px;font-weight:900;color:#5a3c19;}" +
      ".mh-slot-sub{font-size:11px;color:#8a6d3b;margin-top:3px;}" +
      ".mh-slot-close{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:700;}" +
      ".mh-slot-body{padding:14px 16px;overflow:auto;font-size:12px;color:#333;}" +
      ".mh-slot-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px;}" +
      ".mh-slot-metric{border:1px solid #edf0f5;border-radius:12px;background:#fbfdff;padding:10px;min-height:64px;}" +
      ".mh-slot-metric .k{font-size:11px;color:#64748b;font-weight:800;margin-bottom:6px;}" +
      ".mh-slot-metric .v{font-size:18px;font-weight:900;color:#0f172a;}" +
      ".mh-slot-metric .n{font-size:11px;color:#64748b;margin-top:4px;}" +
      ".mh-slot-section{border:1px solid #eef2f7;border-radius:12px;background:#fff;margin:10px 0;overflow:hidden;}" +
      ".mh-slot-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;background:#f8fafc;border-bottom:1px solid #eef2f7;}" +
      ".mh-slot-section-title{font-weight:900;color:#334155;font-size:13px;}" +
      ".mh-slot-badge{font-size:11px;font-weight:900;border-radius:999px;padding:2px 8px;border:1px solid #e5e7eb;background:#fff;}" +
      ".mh-slot-badge.ok{color:#047857;border-color:#bbf7d0;background:#f0fdf4;}" +
      ".mh-slot-badge.warn{color:#a16207;border-color:#fde68a;background:#fffbeb;}" +
      ".mh-slot-badge.error{color:#b91c1c;border-color:#fecaca;background:#fef2f2;}" +
      ".mh-slot-table{width:100%;border-collapse:collapse;font-size:12px;}" +
      ".mh-slot-table th,.mh-slot-table td{border-bottom:1px solid #eef2f7;padding:7px 8px;text-align:left;vertical-align:top;}" +
      ".mh-slot-table th{background:#fff;color:#475569;font-size:11px;position:sticky;top:0;}" +
      ".mh-slot-note{font-size:11px;color:#64748b;line-height:1.5;padding:9px 11px;}" +
      ".mh-slot-json{background:#0f172a;color:#e5e7eb;border-radius:10px;padding:10px;white-space:pre-wrap;overflow:auto;font-size:11px;max-height:260px;}" +
      ".mh-slot-scroll{max-height:360px;overflow:auto;}" +
      "@media(max-width:820px){.mh-slot-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.mh-slot-modal{width:96vw;}}";
    document.head.appendChild(style);
  }

  function findTargetCard(){
    var host = byId("igdc-site-control") || document.querySelector(".igdc-site-control");
    if(!host) return null;

    var cards = Array.prototype.slice.call(host.querySelectorAll(".igdc-sc-card, [data-card], section, div, button"));
    var best = null;

    for(var i=0;i<cards.length;i++){
      var el = cards[i];
      var text = s(el.textContent).replace(/\s+/g," ").trim();
      if(!text) continue;
      var hit = TARGET_TEXTS.every(function(k){ return text.indexOf(k) >= 0; });
      if(!hit) continue;
      if(el.classList && el.classList.contains("igdc-sc-card")) return el;
      var parent = el.closest && el.closest(".igdc-sc-card");
      if(parent) return parent;
      if(!best) best = el;
    }
    return best;
  }

  function cardParts(card){
    return {
      status: card && (card.querySelector(".igdc-sc-card-status") || card.querySelector("[data-status]")),
      body: card && (card.querySelector(".igdc-sc-card-body") || card.querySelector("[data-body]"))
    };
  }

  function setCard(card, st, body){
    if(!card) return;
    var p = cardParts(card);
    if(p.status){
      p.status.textContent = statusLabel(st);
      p.status.className = "igdc-sc-card-status " + statusClass(st);
    }
    if(p.body) p.body.textContent = body || "";
    card.dataset.maruHealthSnapshotSlot = "1";
    card.dataset.maruHealthStatus = st;
    card.style.cursor = "pointer";
  }

  function hookCard(card){
    if(!card || card.__maruSnapshotSlotHooked) return;
    card.__maruSnapshotSlotHooked = true;
    card.addEventListener("click", function(ev){
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){}
      if(!LAST_RESULT){
        runCheck({manual:true}).then(function(){ openModal(LAST_RESULT); });
      }else{
        openModal(LAST_RESULT);
      }
      return false;
    }, true);
  }

  function hookRunButton(){
    var host = byId("igdc-site-control") || document.querySelector(".igdc-site-control") || document;
    var nodes = Array.prototype.slice.call(host.querySelectorAll("button,a"));
    nodes.forEach(function(btn){
      if(btn.__maruSnapshotRunHooked) return;
      var text = low(btn.textContent || btn.value || "");
      var id = low(btn.id || "");
      var cls = low(btn.className || "");
      var looks =
        (text.indexOf("전체") >= 0 && (text.indexOf("헬스") >= 0 || text.indexOf("체크") >= 0 || text.indexOf("실행") >= 0)) ||
        id.indexOf("health") >= 0 ||
        cls.indexOf("igdc-sc-run") >= 0;
      if(!looks) return;
      btn.__maruSnapshotRunHooked = true;
      btn.addEventListener("click", function(){
        setTimeout(function(){ runCheck({source:"existing-run"}); }, 350);
      });
    });
  }

  async function fetchText(url, timeout){
    var started = now();
    var ctrl = global.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function(){ try{ ctrl.abort(); }catch(_){} }, timeout || TIMEOUT) : null;

    try{
      var res = await fetch(url, {
        method:"GET",
        cache:"no-store",
        credentials:"same-origin",
        signal: ctrl ? ctrl.signal : undefined
      });
      var text = await res.text();
      var json = null;
      try{ json = text ? JSON.parse(text) : null; }catch(_){}
      return { ok:!!res.ok, status:res.status, endpoint:url, elapsed:now()-started, text:text, json:json };
    }finally{
      if(timer) clearTimeout(timer);
    }
  }

  function extractItems(json){
    if(!json) return [];
    if(Array.isArray(json)) return json;
    if(Array.isArray(json.items)) return json.items;
    if(Array.isArray(json.results)) return json.results;
    if(json.data && Array.isArray(json.data.items)) return json.data.items;
    if(json.data && Array.isArray(json.data.results)) return json.data.results;
    if(json.baseResult && Array.isArray(json.baseResult.items)) return json.baseResult.items;
    if(json.baseResult && json.baseResult.data && Array.isArray(json.baseResult.data.items)) return json.baseResult.data.items;
    return [];
  }

  async function loadSnapshot(){
    var endpoints = [
      "/data/search-bank.snapshot.json",
      "/search-bank.snapshot.json",
      "/.netlify/functions/search-bank-engine?limit=5000&external=off&noExternal=1&disableExternal=1"
    ];
    var attempts = [];

    for(var i=0;i<endpoints.length;i++){
      var ep = endpoints[i];
      try{
        var r = await fetchText(ep, ep.indexOf("functions") >= 0 ? 9000 : 6500);
        var items = extractItems(r.json);
        attempts.push({ endpoint:ep, ok:r.ok, status:r.status, elapsed:r.elapsed, count:items.length });
        if(r.ok && items.length){
          return { ok:true, endpoint:ep, elapsed:r.elapsed, items:items, raw:r.json, attempts:attempts };
        }
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
      }
    }

    return { ok:false, endpoint:null, elapsed:null, items:[], raw:null, attempts:attempts };
  }

  function normText(it){
    it = it || {};
    return low([
      it.id, it.title, it.summary, it.description, it.url, it.link, it.href,
      it.thumb, it.thumbnail, it.image, it.source, it.type, it.mediaType,
      it.channel, it.section, it.page, it.route, it.psom_key,
      Array.isArray(it.tags) ? it.tags.join(" ") : ""
    ].join(" "));
  }

  function inferPage(it){
    var txt = normText(it);
    var id = low(it && it.id);

    if(txt.indexOf("literature") >= 0 || txt.indexOf("academic") >= 0 || txt.indexOf("학술") >= 0 || txt.indexOf("문학") >= 0) return "literature_academic";
    if(txt.indexOf("donation") >= 0 || txt.indexOf("donate") >= 0 || txt.indexOf("ngo") >= 0 || txt.indexOf("후원") >= 0) return "donation";
    if(txt.indexOf("media") >= 0 || txt.indexOf("video") >= 0 || txt.indexOf("movie") >= 0 || txt.indexOf("drama") >= 0 || txt.indexOf("미디어") >= 0) return "mediahub";
    if(txt.indexOf("social") >= 0 || txt.indexOf("sns") >= 0 || txt.indexOf("instagram") >= 0 || txt.indexOf("youtube") >= 0 || txt.indexOf("tiktok") >= 0) return "socialnetwork";
    if(txt.indexOf("distribution") >= 0 || txt.indexOf("commerce") >= 0 || txt.indexOf("유통") >= 0 || txt.indexOf("supplier") >= 0) return "distributionhub";
    if(txt.indexOf("tour") >= 0 || txt.indexOf("travel") >= 0 || txt.indexOf("tourism") >= 0 || txt.indexOf("관광") >= 0 || txt.indexOf("여행") >= 0) return "tour";
    if(txt.indexOf("networkhub") >= 0 || txt.indexOf("network-right") >= 0 || /^net-\d+/.test(id)) return "networkhub";
    if(txt.indexOf("home") >= 0 || txt.indexOf("frontpage") >= 0 || /^home[-_]/.test(id)) return "home";
    return "unknown";
  }

  function pageLabel(key){
    var m = {
      home:"홈",
      networkhub:"마켓/네트워크",
      distributionhub:"유통허브",
      socialnetwork:"소셜 네트워크",
      mediahub:"미디어 허브",
      tour:"여행·관광·숙박",
      donation:"후원",
      literature_academic:"문학·학술교류",
      unknown:"미분류"
    };
    return m[key] || key;
  }

  function sectionName(it){
    it = it || {};
    return s(it.section || it.psom_key || it.route || it.page || it.channel || "unknown").trim() || "unknown";
  }

  function validUrl(u){
    var v = s(u).trim();
    if(!v) return false;
    var l = v.toLowerCase();
    if(l === "#" || l === "/" || l.indexOf("javascript:") === 0) return false;
    return true;
  }

  function isSampleOrPlaceholder(it){
    it = it || {};
    var txt = normText(it);
    var title = low(it.title);

    if(it.placeholder === true) return true;
    if(it.extension && it.extension.placeholder === true) return true;
    if(!validUrl(it.url || it.link || it.href)) return true;
    if(txt.indexOf("/assets/sample/") >= 0) return true;
    if(txt.indexOf("placeholder") >= 0 || txt.indexOf("sample") >= 0 || txt.indexOf("seed") >= 0) return true;
    if(/^(network|home|distribution|social|media|donation|tour)\s+item\s+\d+/.test(title)) return true;
    if(/^(network|home|distribution|social|media|donation|tour)[-_]?\d+/.test(low(it.id)) && !s(it.summary || it.description).trim()) return true;

    return false;
  }

  function hasThumb(it){
    it = it || {};
    return !!(
      it.thumbnail || it.thumb || it.image || it.image_url || it.og_image ||
      (Array.isArray(it.imageSet) && it.imageSet.length) ||
      (it.media && it.media.preview && (it.media.preview.poster || it.media.preview.mp4 || it.media.preview.webm))
    );
  }

  function hasRevenueStructure(it){
    it = it || {};
    return !!(
      it.monetization ||
      it.revenueDestination ||
      it.linkRevenue ||
      it.revenue ||
      it.blockchainPayment ||
      it.directSale
    );
  }

  function hasActiveRevenueTrack(it){
    it = it || {};
    return !!(
      (it.monetization && (
        (it.monetization.impression && it.monetization.impression.enabled) ||
        (it.monetization.referral && it.monetization.referral.enabled) ||
        (it.monetization.engagement && it.monetization.engagement.enabled)
      )) ||
      (it.linkRevenue && it.linkRevenue.enabled) ||
      (it.revenue && it.revenue.track) ||
      (it.directSale && it.directSale.enabled) ||
      (it.blockchainPayment && it.blockchainPayment.enabled)
    );
  }

  function hasProductCommerceSignal(it){
    it = it || {};
    var txt = normText(it) + " " + low(JSON.stringify({
      commerce:it.commerce,
      directSale:it.directSale,
      productSku:it.productSku,
      price:it.price,
      cta:it.cta
    }));
    return !!(
      it.commerce ||
      it.directSale ||
      it.price ||
      /commerce|shopping|product|상품|쇼핑|구매|판매|유통|distribution|merchant|supplier/.test(txt)
    );
  }

  function inc(obj, key, n){
    obj[key] = (obj[key] || 0) + (n == null ? 1 : n);
  }

  function emptyStats(key, label){
    return {
      key:key,
      label:label || pageLabel(key),
      slots:0,
      real:0,
      sample:0,
      thumb:0,
      revenueStructure:0,
      revenueActive:0,
      productSignal:0,
      sections:{}
    };
  }

  function analyzeSnapshot(items){
    items = Array.isArray(items) ? items : [];

    var pages = {};
    var sectionRows = [];
    var totals = emptyStats("total", "전체");

    function ensurePage(key){
      if(!pages[key]) pages[key] = emptyStats(key, pageLabel(key));
      return pages[key];
    }

    items.forEach(function(it){
      var page = inferPage(it);
      var sec = sectionName(it);
      var p = ensurePage(page);
      var isSample = isSampleOrPlaceholder(it);
      var real = !isSample;
      var thumb = hasThumb(it);
      var rev = hasRevenueStructure(it);
      var revActive = hasActiveRevenueTrack(it);
      var prod = hasProductCommerceSignal(it);

      [p, totals].forEach(function(t){
        inc(t, "slots");
        if(real) inc(t, "real");
        else inc(t, "sample");
        if(thumb) inc(t, "thumb");
        if(rev) inc(t, "revenueStructure");
        if(revActive) inc(t, "revenueActive");
        if(prod) inc(t, "productSignal");
      });

      if(!p.sections[sec]){
        p.sections[sec] = {
          page:page,
          pageLabel:p.label,
          section:sec,
          slots:0,
          real:0,
          sample:0,
          thumb:0,
          revenueStructure:0,
          revenueActive:0,
          productSignal:0
        };
      }

      var r = p.sections[sec];
      inc(r, "slots");
      if(real) inc(r, "real");
      else inc(r, "sample");
      if(thumb) inc(r, "thumb");
      if(rev) inc(r, "revenueStructure");
      if(revActive) inc(r, "revenueActive");
      if(prod) inc(r, "productSignal");
    });

    Object.keys(pages).forEach(function(k){
      Object.keys(pages[k].sections).forEach(function(sec){
        sectionRows.push(pages[k].sections[sec]);
      });
    });

    var order = ["home","networkhub","distributionhub","socialnetwork","mediahub","tour","donation","literature_academic","unknown"];
    var pageRows = order.map(function(k){
      return pages[k] || emptyStats(k, pageLabel(k));
    }).filter(function(row){
      return row.slots || row.key !== "unknown";
    });

    sectionRows.sort(function(a,b){
      var ai = order.indexOf(a.page);
      var bi = order.indexOf(b.page);
      if(ai !== bi) return ai - bi;
      return s(a.section).localeCompare(s(b.section));
    });

    var fillRate = totals.slots ? Math.round((totals.real / totals.slots) * 1000) / 10 : 0;
    var sampleRate = totals.slots ? Math.round((totals.sample / totals.slots) * 1000) / 10 : 0;

    return {
      totals:totals,
      pageRows:pageRows,
      sectionRows:sectionRows,
      fillRate:fillRate,
      sampleRate:sampleRate,
      sourceCount:items.length
    };
  }

  async function mediaProbe(){
    var endpoints = [
      "/.netlify/functions/maru-search?q=media&limit=20&type=image&external=off",
      "/.netlify/functions/maru-search?q=video&limit=20&type=video&external=off"
    ];
    var attempts = [];
    for(var i=0;i<endpoints.length;i++){
      var ep = endpoints[i];
      try{
        var r = await fetchText(ep, 6500);
        var items = extractItems(r.json);
        attempts.push({ endpoint:ep, ok:r.ok, status:r.status, elapsed:r.elapsed, count:items.length });
        if(r.ok){
          return {
            ok:true,
            endpoint:ep,
            elapsed:r.elapsed,
            count:items.length,
            withThumb:items.filter(hasThumb).length,
            attempts:attempts
          };
        }
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
      }
    }
    return { ok:false, count:0, withThumb:0, attempts:attempts };
  }

  async function revenueProbe(){
    var endpoints = [
      "/.netlify/functions/maru-revenue-engine?action=report",
      "/.netlify/functions/maru-revenue-engine?mode=health",
      "/api/igdc/income/summary"
    ];
    var attempts = [];
    for(var i=0;i<endpoints.length;i++){
      var ep = endpoints[i];
      try{
        var r = await fetchText(ep, 6500);
        attempts.push({ endpoint:ep, ok:r.ok, status:r.status, elapsed:r.elapsed, count:extractItems(r.json).length });
        if(r.ok){
          return { ok:true, endpoint:ep, elapsed:r.elapsed, raw:r.json, attempts:attempts };
        }
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
      }
    }
    return { ok:false, attempts:attempts };
  }

  async function runCheck(options){
    options = options || {};
    if(RUNNING) return LAST_RESULT;
    RUNNING = true;

    var card = findTargetCard();
    if(card){
      hookCard(card);
      setCard(card, "pending", "Search Bank 스냅샷 슬롯 점검 중…");
    }

    try{
      var started = now();
      var snapPack = await loadSnapshot();
      var analysis = analyzeSnapshot(snapPack.items || []);
      var probes = await Promise.allSettled([mediaProbe(), revenueProbe()]);
      var media = probes[0].status === "fulfilled" ? probes[0].value : { ok:false, error:shortError(probes[0].reason) };
      var revenue = probes[1].status === "fulfilled" ? probes[1].value : { ok:false, error:shortError(probes[1].reason) };

      var totals = analysis.totals;
      var status = "ok";
      if(!snapPack.ok || !totals.slots) status = "error";
      else if(totals.real === 0 || analysis.sampleRate > 50 || !revenue.ok) status = "warn";

      LAST_RESULT = {
        version:VERSION,
        ts:new Date().toISOString(),
        elapsed:now()-started,
        status:status,
        snapshot:snapPack,
        analysis:analysis,
        mediaProbe:media,
        revenueProbe:revenue
      };

      var body = snapPack.ok
        ? ("슬롯 " + totals.slots + " · 실제 " + totals.real + " · 샘플 " + totals.sample + " · 수익구조 " + totals.revenueStructure)
        : "Search Bank 스냅샷 확인 실패";

      card = findTargetCard();
      if(card){
        hookCard(card);
        setCard(card, status, body);
      }

      try{
        global.dispatchEvent(new CustomEvent("MARU_HEALTH_SNAPSHOT_SLOT_DONE", { detail:LAST_RESULT }));
      }catch(_){}

      return LAST_RESULT;
    }finally{
      RUNNING = false;
    }
  }

  function metric(k,v,n){
    return '<div class="mh-slot-metric"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(v) + '</div><div class="n">' + escapeHtml(n || "") + '</div></div>';
  }

  function badge(st){
    return '<span class="mh-slot-badge ' + escapeHtml(st || "warn") + '">' + escapeHtml(statusKo(st || "warn")) + '</span>';
  }

  function pct(a,b){
    if(!b) return "0%";
    return (Math.round((a/b)*1000)/10) + "%";
  }

  function pageTable(rows){
    rows = Array.isArray(rows) ? rows : [];
    var html = rows.map(function(r){
      var st = r.key === "literature_academic" && !r.real ? "준비중" : (r.real ? "채움" : "샘플");
      return '<tr>' +
        '<td>' + escapeHtml(r.label) + '</td>' +
        '<td>' + escapeHtml(st) + '</td>' +
        '<td>' + escapeHtml(r.slots) + '</td>' +
        '<td>' + escapeHtml(r.real) + '</td>' +
        '<td>' + escapeHtml(r.sample) + '</td>' +
        '<td>' + escapeHtml(r.thumb) + '</td>' +
        '<td>' + escapeHtml(r.revenueStructure) + '</td>' +
        '<td>' + escapeHtml(r.productSignal) + '</td>' +
        '<td>' + escapeHtml(pct(r.real, r.slots)) + '</td>' +
      '</tr>';
    }).join("");

    return '<div class="mh-slot-section">' +
      '<div class="mh-slot-section-head"><div class="mh-slot-section-title">페이지별 슬롯 설계 / 실제 콘텐츠 / 샘플</div>' + badge("ok") + '</div>' +
      '<div class="mh-slot-note">스냅샷 JSON의 item 수를 슬롯 설계 수로 보고, url·title·sample 이미지 등을 기준으로 실제 콘텐츠와 샘플 슬롯을 분리합니다.</div>' +
      '<div class="mh-slot-scroll"><table class="mh-slot-table">' +
      '<thead><tr><th>페이지</th><th>상태</th><th>설계 슬롯</th><th>실제 콘텐츠</th><th>샘플/빈 슬롯</th><th>썸네일</th><th>수익구조</th><th>상품신호</th><th>채움률</th></tr></thead>' +
      '<tbody>' + html + '</tbody></table></div></div>';
  }

  function sectionTable(rows){
    rows = Array.isArray(rows) ? rows : [];
    var html = rows.map(function(r){
      return '<tr>' +
        '<td>' + escapeHtml(r.pageLabel) + '</td>' +
        '<td>' + escapeHtml(r.section) + '</td>' +
        '<td>' + escapeHtml(r.slots) + '</td>' +
        '<td>' + escapeHtml(r.real) + '</td>' +
        '<td>' + escapeHtml(r.sample) + '</td>' +
        '<td>' + escapeHtml(r.thumb) + '</td>' +
        '<td>' + escapeHtml(r.revenueStructure) + '</td>' +
        '<td>' + escapeHtml(r.revenueActive) + '</td>' +
        '<td>' + escapeHtml(r.productSignal) + '</td>' +
      '</tr>';
    }).join("");

    return '<div class="mh-slot-section">' +
      '<div class="mh-slot-section-head"><div class="mh-slot-section-title">섹션별 상세 슬롯 현황</div>' + badge("ok") + '</div>' +
      '<div class="mh-slot-scroll"><table class="mh-slot-table">' +
      '<thead><tr><th>페이지</th><th>섹션</th><th>설계 슬롯</th><th>실제</th><th>샘플</th><th>썸네일</th><th>수익구조</th><th>수익활성</th><th>상품신호</th></tr></thead>' +
      '<tbody>' + html + '</tbody></table></div></div>';
  }

  function attemptsTable(title, attempts, st){
    attempts = Array.isArray(attempts) ? attempts : [];
    var html = attempts.map(function(a){
      return '<tr>' +
        '<td>' + escapeHtml(a.endpoint || "-") + '</td>' +
        '<td>' + escapeHtml(a.ok ? "OK" : (a.status ? "HTTP " + a.status : "FAIL")) + '</td>' +
        '<td>' + escapeHtml(a.elapsed == null ? "-" : a.elapsed + "ms") + '</td>' +
        '<td>' + escapeHtml(a.count == null ? "-" : a.count) + '</td>' +
        '<td>' + escapeHtml(a.error || "") + '</td>' +
      '</tr>';
    }).join("");

    return '<div class="mh-slot-section">' +
      '<div class="mh-slot-section-head"><div class="mh-slot-section-title">' + escapeHtml(title) + '</div>' + badge(st || "warn") + '</div>' +
      '<table class="mh-slot-table"><thead><tr><th>Endpoint</th><th>상태</th><th>응답</th><th>건수</th><th>메모</th></tr></thead><tbody>' + html + '</tbody></table>' +
      '</div>';
  }

  function openModal(result){
    injectStyle();
    closeModal();

    result = result || LAST_RESULT;
    if(!result) return;

    var analysis = result.analysis || {};
    var totals = analysis.totals || {};
    var snap = result.snapshot || {};
    var media = result.mediaProbe || {};
    var revenue = result.revenueProbe || {};
    var st = result.status || "warn";

    var lite = {
      version:result.version,
      ts:result.ts,
      source:snap.endpoint,
      elapsed:result.elapsed,
      totals:{
        slots:totals.slots,
        real:totals.real,
        sample:totals.sample,
        thumb:totals.thumb,
        revenueStructure:totals.revenueStructure,
        revenueActive:totals.revenueActive,
        productSignal:totals.productSignal,
        fillRate:analysis.fillRate,
        sampleRate:analysis.sampleRate
      },
      mediaProbe:{
        ok:media.ok,
        count:media.count,
        withThumb:media.withThumb,
        endpoint:media.endpoint
      },
      revenueProbe:{
        ok:revenue.ok,
        endpoint:revenue.endpoint
      }
    };

    var backdrop = document.createElement("div");
    backdrop.id = MODAL_ID;
    backdrop.className = "mh-slot-backdrop";
    backdrop.innerHTML =
      '<div class="mh-slot-modal" role="dialog" aria-modal="true">' +
        '<div class="mh-slot-head">' +
          '<div>' +
            '<div class="mh-slot-title">수익 · 썸네일 · 상품 맵핑 상세 점검</div>' +
            '<div class="mh-slot-sub">Search Bank Snapshot 기준 슬롯 설계 수와 실제 콘텐츠/샘플/수익구조를 분리 점검합니다. · ' + escapeHtml(result.ts || "") + '</div>' +
          '</div>' +
          '<button type="button" class="mh-slot-close">닫기</button>' +
        '</div>' +
        '<div class="mh-slot-body">' +
          '<div class="mh-slot-grid">' +
            metric("전체 상태", statusKo(st), "스냅샷 " + (snap.ok ? "확인" : "실패")) +
            metric("설계 슬롯", totals.slots || 0, "Snapshot item total") +
            metric("실제 콘텐츠", totals.real || 0, "채움률 " + (analysis.fillRate || 0) + "%") +
            metric("샘플/빈 슬롯", totals.sample || 0, "샘플률 " + (analysis.sampleRate || 0) + "%") +
            metric("수익 구조", totals.revenueStructure || 0, "활성 신호 " + (totals.revenueActive || 0)) +
          '</div>' +
          pageTable(analysis.pageRows || []) +
          sectionTable(analysis.sectionRows || []) +
          attemptsTable("Search Bank Snapshot 로드 경로", snap.attempts || [], snap.ok ? "ok" : "error") +
          attemptsTable("검색 미디어 후보 Probe", media.attempts || [], media.ok ? "ok" : "warn") +
          attemptsTable("수익 엔진 Probe", revenue.attempts || [], revenue.ok ? "ok" : "warn") +
          '<div class="mh-slot-section">' +
            '<div class="mh-slot-section-head"><div class="mh-slot-section-title">판정 기준</div>' + badge(st) + '</div>' +
            '<div class="mh-slot-note">' +
              '설계 슬롯은 Snapshot JSON에 존재하는 item 수입니다. 실제 콘텐츠는 유효 URL과 비샘플 제목/이미지 기준으로 분리합니다. ' +
              'url=#, /assets/sample/, Network Item 같은 항목은 샘플/placeholder로 계산합니다. ' +
              '수익 구조는 monetization, linkRevenue, revenue, revenueDestination, directSale, blockchainPayment 필드를 기준으로 계산합니다.' +
            '</div>' +
          '</div>' +
          '<div class="mh-slot-section">' +
            '<div class="mh-slot-section-head"><div class="mh-slot-section-title">요약 JSON</div><span class="mh-slot-badge ok">DEBUG</span></div>' +
            '<div style="padding:10px;"><div class="mh-slot-json">' + escapeHtml(JSON.stringify(lite, null, 2)) + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    backdrop.addEventListener("click", function(ev){
      if(ev.target === backdrop) closeModal();
    });
    var close = backdrop.querySelector(".mh-slot-close");
    if(close) close.addEventListener("click", closeModal);
    document.body.appendChild(backdrop);
  }

  function closeModal(){
    var m = byId(MODAL_ID);
    if(m && m.parentNode) m.parentNode.removeChild(m);
  }

  function waitCard(n){
    n = n || 0;
    var card = findTargetCard();
    if(card){
      hookCard(card);
      setCard(card, "pending", "전체 헬스체크 실행 시 스냅샷 슬롯을 점검합니다.");
      hookRunButton();
      return true;
    }
    if(n < 100) setTimeout(function(){ waitCard(n+1); }, 250);
    return false;
  }

  function init(){
    injectStyle();
    waitCard(0);
    setTimeout(function(){
      hookRunButton();
      var flag = (location.search || "") + " " + (location.hash || "");
      if(/health=1|health-run|maru-health/i.test(flag)){
        runCheck({auto:true, reason:"url-flag"});
      }
    }, 900);
  }

  global.MaruHealth = global.MaruHealth || {};
  global.MaruHealth.snapshotSlotVersion = VERSION;
  global.MaruHealth.runSnapshotSlotCheck = runCheck;
  global.MaruHealth.openSnapshotSlotModal = function(){ openModal(LAST_RESULT); };

  global.IGDC_HEALTH = global.IGDC_HEALTH || {};
  global.IGDC_HEALTH.runSnapshotSlotCheck = runCheck;

  global.runMaruSnapshotSlotHealth = runCheck;

  ready(init);

})(window, document);
