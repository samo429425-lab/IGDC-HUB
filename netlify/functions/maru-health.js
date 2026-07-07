/**
 * 적용 위치: assets/js/maru-health.js 전용 파일
 * 주의: netlify/functions/maru-health.js 에 덮어쓰지 마세요.
 * 기능: 관리자 우측 패널의 수익 · 썸네일 · 상품 맵핑 JSON 다운로드 + 수익 정산 정밀 점검 버튼.
 * 적용: assets/js/maru-health.js 전용. functions/maru-health.js에는 적용하지 마세요.
 */

/**
 * assets/js/maru-health.js
 * ------------------------------------------------------------
 * MARU HEALTH FRONT — Slot / Delivery / Front Render / Revenue Line Audit
 *
 * Target card:
 * - Existing Admin right panel card: "수익 · 썸네일 · 상품 맵핑"
 *
 * Checks:
 * 1) Designed slots from Search Bank Snapshot
 * 2) Delivered data from Search Bank Engine, fallback to Snapshot
 * 3) Front page render/card signals by loading the 8 front pages in hidden iframes
 * 4) Revenue/payment/settlement/link tracking line health by item/page/section
 *
 * Safe:
 * - Does not replace existing Site/API/ENV/Backend/Device/Browser/UX checks.
 * - Reuses the existing card.
 * - No duplicate panel.
 */

(function(global, document){
  "use strict";

  if(!global || !document) return;

  var VERSION = "front-slot-revenue-final-v1.2.4-settlement-card-between-ux-and-health";
  var MODAL_ID = "maru-health-final-slot-modal";
  var STYLE_ID = "maru-health-final-slot-style";
  var TARGET_TEXTS = ["수익", "썸네일", "상품", "맵핑"];
  var LAST_RESULT = null;
  var LAST_SETTLEMENT_RESULT = null;
  var RUNNING = false;
  var SETTLEMENT_RUNNING = false;
  var TIMEOUT = 8000;

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

  function safeTimestamp(ts){
    var d = ts ? new Date(ts) : new Date();
    if(!isFinite(d.getTime())) d = new Date();
    function p(n){ return String(n).padStart(2, "0"); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function downloadJsonReport(result){
    result = result || LAST_RESULT;
    if(!result){
      alert("다운로드할 점검 결과가 아직 없습니다. 먼저 점검을 실행하세요.");
      return false;
    }

    var payload = {
      reportType:"igdc-revenue-thumbnail-product-mapping",
      version:VERSION,
      generatedAt:new Date().toISOString(),
      source:{
        href:s(location && location.href),
        origin:s(location && location.origin),
        host:s(location && location.host),
        pathname:s(location && location.pathname),
        userAgent:s(navigator && navigator.userAgent)
      },
      result:result
    };

    try{
      var blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json;charset=utf-8"});
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "IGDC_REVENUE_MAPPING_REPORT_pre-product_" + safeTimestamp(result.ts) + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){
        try{ URL.revokeObjectURL(url); }catch(_){}
        if(a && a.parentNode) a.parentNode.removeChild(a);
      }, 120);
    }catch(e){
      console.warn("[MARU_HEALTH] JSON report download failed:", e);
      alert("JSON 다운로드 중 오류가 발생했습니다: " + shortError(e));
    }

    return false;
  }



  function downloadSettlementJsonReport(result){
    result = result || LAST_SETTLEMENT_RESULT;
    if(!result){
      alert("다운로드할 수익 정산 점검 결과가 아직 없습니다. 먼저 점검을 실행하세요.");
      return false;
    }

    var payload = {
      reportType:"igdc-revenue-settlement-diagnostic",
      version:VERSION,
      generatedAt:new Date().toISOString(),
      source:{
        href:s(location && location.href),
        origin:s(location && location.origin),
        host:s(location && location.host),
        pathname:s(location && location.pathname),
        userAgent:s(navigator && navigator.userAgent)
      },
      result:result
    };

    try{
      var blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json;charset=utf-8"});
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "IGDC_REVENUE_SETTLEMENT_AUDIT_pre-product_" + safeTimestamp(result.ts) + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){
        try{ URL.revokeObjectURL(url); }catch(_){}
        if(a && a.parentNode) a.parentNode.removeChild(a);
      }, 120);
    }catch(e){
      console.warn("[MARU_HEALTH] settlement JSON report download failed:", e);
      alert("JSON 다운로드 중 오류가 발생했습니다: " + shortError(e));
    }

    return false;
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
      ".mhf-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.44);display:flex;align-items:center;justify-content:center;z-index:99999;}" +
      ".mhf-modal{width:min(1180px,96vw);max-height:92vh;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.34);display:flex;flex-direction:column;overflow:hidden;border:1px solid #e5e7eb;}" +
      ".mhf-head{padding:14px 16px;background:linear-gradient(180deg,#fffaf0,#ffffff);border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:12px;}" +
      ".mhf-title{font-size:16px;font-weight:900;color:#5a3c19;}" +
      ".mhf-sub{font-size:11px;color:#8a6d3b;margin-top:3px;}" +
      ".mhf-actions{display:flex;align-items:center;gap:6px;margin-left:auto;}" +
      ".mhf-json-download{border:1px solid #f5b7c8;background:#fff0f5;color:#8a2444;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:800;}" +
      ".mhf-json-download:hover{background:#ffe4ee;border-color:#ec8faf;}" +
      ".mhf-settlement-card{background:linear-gradient(180deg,#f0fff7,#eef8ff)!important;border-color:#b7e4c7!important;}" +
      ".mhf-settlement-card:hover{background:linear-gradient(180deg,#eafff2,#e4f4ff)!important;border-color:#80cfa2!important;}" +
      ".mhf-settle-download{border:1px solid #9bd3c2;background:#f0fff7;color:#065f46;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:800;}" +
      ".mhf-settle-download:hover{background:#dcfce7;border-color:#68bd9c;}" +
      ".mhf-close{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:700;}" +
      ".mhf-body{padding:14px 16px;overflow:auto;font-size:12px;color:#333;}" +
      ".mhf-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:12px;}" +
      ".mhf-metric{border:1px solid #edf0f5;border-radius:12px;background:#fbfdff;padding:10px;min-height:66px;}" +
      ".mhf-metric .k{font-size:11px;color:#64748b;font-weight:800;margin-bottom:6px;}" +
      ".mhf-metric .v{font-size:18px;font-weight:900;color:#0f172a;}" +
      ".mhf-metric .n{font-size:11px;color:#64748b;margin-top:4px;}" +
      ".mhf-section{border:1px solid #eef2f7;border-radius:12px;background:#fff;margin:10px 0;overflow:hidden;}" +
      ".mhf-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;background:#f8fafc;border-bottom:1px solid #eef2f7;}" +
      ".mhf-section-title{font-weight:900;color:#334155;font-size:13px;}" +
      ".mhf-badge{font-size:11px;font-weight:900;border-radius:999px;padding:2px 8px;border:1px solid #e5e7eb;background:#fff;}" +
      ".mhf-badge.ok{color:#047857;border-color:#bbf7d0;background:#f0fdf4;}" +
      ".mhf-badge.warn{color:#a16207;border-color:#fde68a;background:#fffbeb;}" +
      ".mhf-badge.error{color:#b91c1c;border-color:#fecaca;background:#fef2f2;}" +
      ".mhf-table{width:100%;border-collapse:collapse;font-size:12px;}" +
      ".mhf-table th,.mhf-table td{border-bottom:1px solid #eef2f7;padding:7px 8px;text-align:left;vertical-align:top;}" +
      ".mhf-table th{background:#fff;color:#475569;font-size:11px;position:sticky;top:0;z-index:1;}" +
      ".mhf-note{font-size:11px;color:#64748b;line-height:1.5;padding:9px 11px;}" +
      ".mhf-json{background:#0f172a;color:#e5e7eb;border-radius:10px;padding:10px;white-space:pre-wrap;overflow:auto;font-size:11px;max-height:260px;}" +
      ".mhf-scroll{max-height:380px;overflow:auto;}" +
      ".mhf-mini{font-size:11px;color:#64748b;}" +
      "@media(max-width:940px){.mhf-grid{grid-template-columns:repeat(3,minmax(0,1fr));}.mhf-modal{width:97vw;}}" +
      "@media(max-width:640px){.mhf-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}";
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
    card.dataset.maruHealthFinalSlot = "1";
    card.dataset.maruHealthStatus = st;
    card.style.cursor = "pointer";
  }

  function hookCard(card){
    if(!card || card.__maruFinalSlotHooked) return;
    card.__maruFinalSlotHooked = true;
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
      if(btn.__maruFinalSlotRunHooked) return;
      var text = low(btn.textContent || btn.value || "");
      var id = low(btn.id || "");
      var cls = low(btn.className || "");
      var looks =
        (text.indexOf("전체") >= 0 && (text.indexOf("헬스") >= 0 || text.indexOf("체크") >= 0 || text.indexOf("실행") >= 0)) ||
        id.indexOf("health") >= 0 ||
        cls.indexOf("igdc-sc-run") >= 0;
      if(!looks) return;
      btn.__maruFinalSlotRunHooked = true;
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

  async function loadDesignSnapshot(){
    var endpoints = ["/data/search-bank.snapshot.json", "/search-bank.snapshot.json"];
    var attempts = [];

    for(var i=0;i<endpoints.length;i++){
      var ep = endpoints[i];
      try{
        var r = await fetchText(ep, 6500);
        var items = extractItems(r.json);
        attempts.push({ endpoint:ep, ok:r.ok, status:r.status, elapsed:r.elapsed, count:items.length });
        if(r.ok && items.length) return { ok:true, endpoint:ep, elapsed:r.elapsed, items:items, raw:r.json, attempts:attempts };
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
      }
    }

    return { ok:false, endpoint:null, elapsed:null, items:[], raw:null, attempts:attempts };
  }

  async function loadDeliveredData(){
    var endpoints = [
      "/.netlify/functions/search-bank-engine?limit=5000&external=off&noExternal=1&disableExternal=1",
      "/.netlify/functions/search-bank-engine?q=&limit=5000&external=off&noExternal=1&disableExternal=1",
      "/data/search-bank.snapshot.json"
    ];
    var attempts = [];

    for(var i=0;i<endpoints.length;i++){
      var ep = endpoints[i];
      try{
        var r = await fetchText(ep, ep.indexOf("functions") >= 0 ? 9500 : 6500);
        var items = extractItems(r.json);
        attempts.push({ endpoint:ep, ok:r.ok, status:r.status, elapsed:r.elapsed, count:items.length });
        if(r.ok && items.length) return { ok:true, endpoint:ep, elapsed:r.elapsed, items:items, raw:r.json, attempts:attempts };
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
      }
    }

    return { ok:false, endpoint:null, elapsed:null, items:[], raw:null, attempts:attempts };
  }

  function normText(it){
    it = it || {};
    var bind = (it.bind && typeof it.bind === "object") ? it.bind : {};
    var ext = (it.extension && typeof it.extension === "object") ? it.extension : {};
    var src = (it.source && typeof it.source === "object") ? it.source : {};
    return low([
      it.id, it.title, it.summary, it.description, it.url, it.link, it.href,
      it.thumb, it.thumbnail, it.image, it.source, src.name, src.platform,
      it.type, it.mediaType, it.platform,
      it.channel, it.section, it.page, it.route, it.psom_key,
      bind.page, bind.section, bind.psom_key, bind.route,
      ext.platform, ext.placeholder && ext.placeholder.group, ext.placeholder && ext.placeholder.section,
      Array.isArray(it.tags) ? it.tags.join(" ") : ""
    ].join(" "));
  }

  function inferPage(it){
    var txt = normText(it);
    var id = low(it && it.id);
    var bind = (it && it.bind && typeof it.bind === "object") ? it.bind : {};
    var section = low(it && it.section);
    var channel = low(it && it.channel);
    var bindPage = low(bind.page);
    var route = low((it && it.route) || bind.route);

    if(bindPage === "social" || channel === "social" || route.indexOf("social.") === 0 ||
       section.indexOf("social-") === 0 || section === "rightpanel" ||
       txt.indexOf(" social ") >= 0 || txt.indexOf("social-") >= 0 || txt.indexOf("sns") >= 0 ||
       txt.indexOf("instagram") >= 0 || txt.indexOf("youtube rank") >= 0 || txt.indexOf("tiktok") >= 0 ||
       txt.indexOf("facebook") >= 0 || txt.indexOf("wechat") >= 0 || txt.indexOf("weibo") >= 0 ||
       txt.indexOf("pinterest") >= 0 || txt.indexOf("reddit") >= 0 || txt.indexOf("twitter") >= 0) return "socialnetwork";

    if(txt.indexOf("literature") >= 0 || txt.indexOf("academic") >= 0 || txt.indexOf("학술") >= 0 || txt.indexOf("문학") >= 0) return "literature_academic";
    if(txt.indexOf("donation") >= 0 || txt.indexOf("donate") >= 0 || txt.indexOf("ngo") >= 0 || txt.indexOf("후원") >= 0) return "donation";
    if(txt.indexOf("distribution") >= 0 || txt.indexOf("commerce") >= 0 || txt.indexOf("유통") >= 0 || txt.indexOf("supplier") >= 0) return "distributionhub";
    if(txt.indexOf("tour") >= 0 || txt.indexOf("travel") >= 0 || txt.indexOf("tourism") >= 0 || txt.indexOf("관광") >= 0 || txt.indexOf("여행") >= 0) return "tour";
    if(txt.indexOf("networkhub") >= 0 || txt.indexOf("network-right") >= 0 || /^net-\d+/.test(id)) return "networkhub";
    if(txt.indexOf("home") >= 0 || txt.indexOf("frontpage") >= 0 || /^home[-_]/.test(id)) return "home";
    if(txt.indexOf("media") >= 0 || txt.indexOf("video") >= 0 || txt.indexOf("movie") >= 0 || txt.indexOf("drama") >= 0 || txt.indexOf("미디어") >= 0) return "mediahub";
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

  function pageUrl(key){
    var m = {
      home:"/home.html",
      networkhub:"/networkhub.html",
      distributionhub:"/distributionhub.html",
      socialnetwork:"/socialnetwork.html",
      mediahub:"/mediahub.html",
      tour:"/tour.html",
      donation:"/donation.html",
      literature_academic:"/literature_academic.html"
    };
    return m[key] || "";
  }

  function pageKeys(){
    return ["home","networkhub","distributionhub","socialnetwork","mediahub","tour","donation","literature_academic"];
  }

  function sectionName(it){
    it = it || {};
    var bind = (it.bind && typeof it.bind === "object") ? it.bind : {};
    return s(bind.section || bind.psom_key || it.section || it.psom_key || bind.route || it.route || bind.page || it.page || it.channel || "unknown").trim() || "unknown";
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

  function lineResult(line, ok, warn, message, severity){
    return { line:line, ok:!!ok, warn:!!warn, message:message || "", severity:severity || (ok ? "ok" : (warn ? "warn" : "error")) };
  }

  function validateRevenueLines(it, isSample){
    it = it || {};
    var lines = [];

    var mon = it.monetization || {};
    if(mon.impression && mon.impression.enabled){
      lines.push(lineResult("ad/impression", !!(mon.impression.provider && mon.impression.trackId), isSample, "provider/trackId"));
    }
    if(mon.engagement && mon.engagement.enabled){
      lines.push(lineResult("engagement", !!(mon.engagement.minSeconds != null && mon.engagement.rewardType), false, "minSeconds/rewardType"));
    }
    if(mon.referral && mon.referral.enabled){
      lines.push(lineResult("referral", !!(mon.referral.trackCode && mon.referral.partner), !mon.referral.commission, "trackCode/partner/commission"));
    }

    if(it.linkRevenue && it.linkRevenue.enabled){
      var lr = it.linkRevenue;
      var ok = !!(lr.trackId && lr.providers && lr.providers.length && (validUrl(it.url || it.link) || isSample));
      var warn = isSample || !validUrl(it.url || it.link) || !lr.conversionTrack;
      lines.push(lineResult("linkRevenue", ok, warn, "trackId/providers/url/conversionTrack", ok && !warn ? "ok" : "warn"));
    }

    if(it.revenue && it.revenue.track){
      var rv = it.revenue;
      var rok = !!(rv.partner && rv.settle);
      var rwarn = !rv.commission || Number(rv.commission) === 0;
      lines.push(lineResult("affiliateRevenue", rok, rwarn, "partner/commission/settle", rok && !rwarn ? "ok" : "warn"));
    }

    if(it.revenueDestination){
      var rd = it.revenueDestination;
      var accounts = rd.bank && rd.bank.accounts;
      var settlement = rd.settlement || {};
      var okDest = !!(rd.entity && rd.entity.nameKo && rd.bank && accounts && (accounts.krw || accounts.usd) && settlement.ledger);
      var warnDest = settlement.status && settlement.status !== "ready";
      lines.push(lineResult("settlementDestination", okDest, warnDest, "entity/bank/accounts/ledger/status", okDest && !warnDest ? "ok" : "warn"));
    }

    if(it.directSale && it.directSale.enabled){
      var ds = it.directSale;
      var dsOk = !!(ds.price != null && ds.currency && ds.pgProvider && ds.productSku);
      lines.push(lineResult("directSale", dsOk, false, "price/currency/pgProvider/productSku", dsOk ? "ok" : "error"));
    }

    if(it.blockchainPayment && it.blockchainPayment.enabled){
      var bp = it.blockchainPayment;
      var bpOk = !!(bp.walletAddress && bp.supportedChains && bp.supportedChains.length);
      lines.push(lineResult("blockchainPayment", bpOk, false, "walletAddress/supportedChains", bpOk ? "ok" : "error"));
    }

    if(!lines.length){
      // Placeholder/sample slots are design placeholders.
      // Missing revenue/payment fields on placeholders should be WARN, not ERROR.
      // ERROR is reserved for real product/content items with missing required revenue/payment lines.
      var hasProduct = hasProductCommerceSignal(it);
      if (isSample) {
        lines.push(lineResult("none", false, true, hasProduct ? "샘플 상품 슬롯: 수익 라인 준비중" : "샘플 콘텐츠 슬롯: 수익 라인 준비중", "warn"));
      } else {
        lines.push(lineResult("none", false, !hasProduct, "실제 상품/콘텐츠 수익 구조 필드 없음", hasProduct ? "error" : "warn"));
      }
    }

    var severity = "ok";
    var okCount = 0, warnCount = 0, errorCount = 0;
    lines.forEach(function(x){
      if(x.severity === "error") errorCount++;
      else if(x.severity === "warn") warnCount++;
      else okCount++;
    });
    if(errorCount) severity = "error";
    else if(warnCount) severity = "warn";

    return { severity:severity, ok:okCount, warn:warnCount, error:errorCount, lines:lines };
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
      productSignal:0,
      revenueStructure:0,
      revenueOk:0,
      revenueWarn:0,
      revenueError:0,
      frontRendered:0,
      frontImages:0,
      frontSections:0,
      frontStatus:"not_checked",
      sections:{}
    };
  }

  function analyzeItems(items){
    items = Array.isArray(items) ? items : [];

    var pages = {};
    var sectionRows = [];
    var totals = emptyStats("total","전체");

    function ensurePage(key){
      if(!pages[key]) pages[key] = emptyStats(key, pageLabel(key));
      return pages[key];
    }

    items.forEach(function(it){
      var page = inferPage(it);
      var sec = sectionName(it);
      var p = ensurePage(page);
      var sample = isSampleOrPlaceholder(it);
      var real = !sample;
      var thumb = hasThumb(it);
      var prod = hasProductCommerceSignal(it);
      var rev = validateRevenueLines(it, sample);
      var hasRevenue = rev.lines.some(function(x){ return x.line !== "none"; });

      [p, totals].forEach(function(t){
        inc(t,"slots");
        if(real) inc(t,"real"); else inc(t,"sample");
        if(thumb) inc(t,"thumb");
        if(prod) inc(t,"productSignal");
        if(hasRevenue) inc(t,"revenueStructure");
        if(rev.severity === "ok") inc(t,"revenueOk");
        else if(rev.severity === "warn") inc(t,"revenueWarn");
        else inc(t,"revenueError");
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
          productSignal:0,
          revenueStructure:0,
          revenueOk:0,
          revenueWarn:0,
          revenueError:0
        };
      }

      var r = p.sections[sec];
      inc(r,"slots");
      if(real) inc(r,"real"); else inc(r,"sample");
      if(thumb) inc(r,"thumb");
      if(prod) inc(r,"productSignal");
      if(hasRevenue) inc(r,"revenueStructure");
      if(rev.severity === "ok") inc(r,"revenueOk");
      else if(rev.severity === "warn") inc(r,"revenueWarn");
      else inc(r,"revenueError");
    });

    pageKeys().concat(["unknown"]).forEach(function(k){ ensurePage(k); });

    Object.keys(pages).forEach(function(k){
      Object.keys(pages[k].sections).forEach(function(sec){
        sectionRows.push(pages[k].sections[sec]);
      });
    });

    var order = pageKeys().concat(["unknown"]);
    var pageRows = order.map(function(k){ return pages[k] || emptyStats(k, pageLabel(k)); });

    sectionRows.sort(function(a,b){
      var ai = order.indexOf(a.page);
      var bi = order.indexOf(b.page);
      if(ai !== bi) return ai - bi;
      return s(a.section).localeCompare(s(b.section));
    });

    var fillRate = totals.slots ? Math.round((totals.real / totals.slots) * 1000) / 10 : 0;
    var sampleRate = totals.slots ? Math.round((totals.sample / totals.slots) * 1000) / 10 : 0;

    return { totals:totals, pageRows:pageRows, sectionRows:sectionRows, fillRate:fillRate, sampleRate:sampleRate, sourceCount:items.length };
  }

  function unique(arr){
    var seen = {};
    var out = [];
    (Array.isArray(arr) ? arr : []).forEach(function(v){
      v = s(v).trim();
      if(!v) return;
      var k = v.toLowerCase();
      if(seen[k]) return;
      seen[k] = true;
      out.push(v);
    });
    return out;
  }

  function countDomSignals(doc){
    if(!doc) return { renderedCards:0, images:0, sections:0, mediaRefs:0 };

    var cardSelectors = [
      ".card", ".product-card", ".media-card", ".tour-card", ".donation-card",
      ".network-card", ".distribution-card", ".social-card", ".maru-card",
      ".slot-card", ".thumbnail-card", ".item-card",
      "[data-slot]", "[data-card]", "[data-item]", "[data-thumb]", "[data-image]",
      "[data-section]"
    ];

    var nodes = [];
    cardSelectors.forEach(function(sel){
      try{
        Array.prototype.slice.call(doc.querySelectorAll(sel)).forEach(function(el){ nodes.push(el); });
      }catch(_){}
    });

    var imgs = unique(Array.prototype.slice.call(doc.querySelectorAll("img")).map(function(img){
      return img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-original") || "";
    }));

    var bgRefs = [];
    Array.prototype.slice.call(doc.querySelectorAll("[style]")).forEach(function(el){
      var st = s(el.getAttribute("style"));
      var re = /url\((['"]?)(.*?)\1\)/ig;
      var m;
      while((m = re.exec(st))){
        if(m[2]) bgRefs.push(m[2]);
      }
    });

    var sections = unique(Array.prototype.slice.call(doc.querySelectorAll("section,[data-section],.section")).map(function(el, idx){
      return el.id || el.getAttribute("data-section") || el.className || ("section-" + idx);
    }));

    return {
      renderedCards: unique(nodes.map(function(el, idx){
        return el.id || el.getAttribute("data-slot") || el.getAttribute("data-card") || el.getAttribute("data-item") || el.className || ("card-" + idx);
      })).length,
      images: imgs.length + unique(bgRefs).length,
      sections: sections.length,
      mediaRefs: unique(imgs.concat(bgRefs)).length
    };
  }

  async function auditPageRuntime(pageKey){
    var url = pageUrl(pageKey);
    var started = now();

    if(!url) return { key:pageKey, label:pageLabel(pageKey), ok:false, renderedCards:0, images:0, sections:0, mediaRefs:0, error:"no_url" };

    var iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-20000px";
    iframe.style.top = "0";
    iframe.style.width = "1200px";
    iframe.style.height = "900px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.setAttribute("aria-hidden","true");

    var done = false;

    function cleanup(){
      try{ if(iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe); }catch(_){}
    }

    try{
      var promise = new Promise(function(resolve){
        var timer = setTimeout(function(){
          if(done) return;
          done = true;
          resolve({ timeout:true });
        }, 4200);

        iframe.onload = function(){
          setTimeout(function(){
            if(done) return;
            done = true;
            clearTimeout(timer);
            resolve({ timeout:false });
          }, 1300);
        };
      });

      iframe.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "maruHealthProbe=1";
      document.body.appendChild(iframe);
      await promise;

      var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      var sig = countDomSignals(doc);

      cleanup();
      return {
        key:pageKey,
        label:pageLabel(pageKey),
        url:url,
        ok:true,
        mode:"iframe-runtime",
        elapsed:now()-started,
        renderedCards:sig.renderedCards,
        images:sig.images,
        sections:sig.sections,
        mediaRefs:sig.mediaRefs
      };
    }catch(e){
      cleanup();
      try{
        var r = await fetchText(url, 5000);
        var parser = new DOMParser();
        var doc = parser.parseFromString(r.text || "", "text/html");
        var sig = countDomSignals(doc);
        return {
          key:pageKey,
          label:pageLabel(pageKey),
          url:url,
          ok:r.ok,
          mode:"static-html",
          elapsed:r.elapsed,
          renderedCards:sig.renderedCards,
          images:sig.images,
          sections:sig.sections,
          mediaRefs:sig.mediaRefs,
          error: r.ok ? "" : ("HTTP " + r.status)
        };
      }catch(ex){
        return {
          key:pageKey,
          label:pageLabel(pageKey),
          url:url,
          ok:false,
          mode:"failed",
          elapsed:now()-started,
          renderedCards:0,
          images:0,
          sections:0,
          mediaRefs:0,
          error:shortError(ex)
        };
      }
    }
  }

  async function auditFrontend(){
    var keys = pageKeys();
    var rows = [];
    for(var i=0;i<keys.length;i++){
      rows.push(await auditPageRuntime(keys[i]));
    }

    var totals = rows.reduce(function(acc,r){
      acc.renderedCards += Number(r.renderedCards || 0);
      acc.images += Number(r.images || 0);
      acc.sections += Number(r.sections || 0);
      acc.mediaRefs += Number(r.mediaRefs || 0);
      if(r.ok) acc.okPages++;
      return acc;
    }, { renderedCards:0, images:0, sections:0, mediaRefs:0, okPages:0 });

    return { rows:rows, totals:totals };
  }

  async function mediaProbe(){
    var endpoints = [
      "/.netlify/functions/maru-search?q=media&limit=20&type=image&external=off&noExternal=1&disableExternal=1&probe=1&audit=1&fast=1&diagnostic=front-slot-revenue&noRevenue=1&noAnalytics=1",
      "/.netlify/functions/maru-search?q=video&limit=20&type=video&external=off&noExternal=1&disableExternal=1&probe=1&audit=1&fast=1&diagnostic=front-slot-revenue&noRevenue=1&noAnalytics=1"
    ];
    var attempts = [];
    for(var i=0;i<endpoints.length;i++){
      var ep = endpoints[i];
      try{
        var r = await fetchText(ep, 6500);
        var items = extractItems(r.json);
        attempts.push({ endpoint:ep, ok:r.ok, status:r.status, elapsed:r.elapsed, count:items.length });
        if(r.ok){
          return { ok:true, endpoint:ep, elapsed:r.elapsed, count:items.length, withThumb:items.filter(hasThumb).length, attempts:attempts };
        }
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
      }
    }
    return { ok:false, count:0, withThumb:0, attempts:attempts };
  }

  async function revenueProbe(){
    var endpoints = [
      "/.netlify/functions/maru-revenue-engine?action=report&fast=1&probe=1&audit=1&summary=1&limit=50",
      "/.netlify/functions/maru-revenue-engine?mode=health",
      "/api/igdc/income/summary"
    ];
    var attempts = [];
    for(var i=0;i<endpoints.length;i++){
      var ep = endpoints[i];
      try{
        var r = await fetchText(ep, 6500);
        attempts.push({ endpoint:ep, ok:r.ok, status:r.status, elapsed:r.elapsed, count:extractItems(r.json).length });
        if(r.ok) return { ok:true, endpoint:ep, elapsed:r.elapsed, raw:r.json, attempts:attempts };
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
      }
    }
    return { ok:false, attempts:attempts };
  }



  function normalizeAttempt(endpoint, r, count){
    return {
      endpoint:endpoint,
      ok:!!(r && r.ok),
      status:r && r.status,
      elapsed:r && r.elapsed,
      count:Number(count || 0)
    };
  }

  function revenueSummaryFromReport(json){
    json = json || {};
    var summary = json.summary || {};
    var income = json.income || {};
    var lineHealth = json.lineHealth || {};
    var ledgerRows = Array.isArray(json.ledgerRows) ? json.ledgerRows : [];
    var items = extractItems(json);

    return {
      ok:!!json.ok,
      engine:json.engine || "-",
      version:json.version || "-",
      mode:json.mode || json.reportMode || "-",
      pgExecution:json.pgExecution === true,
      pgStatus:json.pgStatus || (json.pgExecution ? "active" : "dry-run/read-only"),
      totalRevenueKrw:Number(json.totalRevenue || (income.summary && income.summary.total) || 0),
      totalRevenueUsd:Number(json.totalRevenueUsd || summary.totalUsd || 0),
      summaryCount:Number(summary.count || json.snapshot && json.snapshot.count || items.length || 0),
      lineOk:Number(lineHealth.ok || summary.ok || 0),
      lineWarn:Number(lineHealth.warn || summary.warn || 0),
      lineError:Number(lineHealth.error || summary.error || 0),
      ledgerRows:ledgerRows.length,
      incomeRows:Array.isArray(income.rows) ? income.rows.length : (Array.isArray(income.items) ? income.items.length : 0),
      byComponent:summary.byComponent || json.breakdown || {},
      byPage:summary.byPage || json.byPage || {},
      raw:json
    };
  }

  function revenueHealthSummary(json){
    json = json || {};
    var features = json.features || {};
    var featureRows = Object.keys(features).sort().map(function(k){
      return { key:k, value:features[k] };
    });
    var config = json.config || {};
    return {
      ok:!!json.ok,
      engine:json.engine || "-",
      version:json.version || "-",
      pgExecution:features.pgExecution === true,
      pgStatus:features.pgStatus || (features.pgExecution ? "active" : "pending_pg_approval"),
      weeklyBatchSettlement:features.weeklyBatchSettlement === true,
      ledgerRowsEstimated:features.ledgerRowsEstimated === true,
      featureRows:featureRows,
      config:config,
      raw:json
    };
  }

  function ledgerSummary(json){
    json = json || {};
    var rows = [];
    if(Array.isArray(json.rows)) rows = json.rows;
    else if(Array.isArray(json.items)) rows = json.items;
    else if(Array.isArray(json.wallets)) rows = json.wallets;
    return {
      ok:!!json.ok,
      mode:json.mode || json.status || "-",
      rows:rows.length,
      sample:rows.slice(0, 20),
      raw:json
    };
  }

  async function settlementProbe(){
    var started = now();
    var attempts = [];

    async function call(ep, timeout){
      try{
        var r = await fetchText(ep, timeout || 8000);
        var cnt = extractItems(r.json).length;
        if(!cnt && r.json && Array.isArray(r.json.ledgerRows)) cnt = r.json.ledgerRows.length;
        if(!cnt && r.json && Array.isArray(r.json.rows)) cnt = r.json.rows.length;
        attempts.push(normalizeAttempt(ep, r, cnt));
        return { ok:r.ok, endpoint:ep, elapsed:r.elapsed, json:r.json, status:r.status };
      }catch(e){
        attempts.push({ endpoint:ep, ok:false, error:shortError(e), count:0 });
        return { ok:false, endpoint:ep, error:shortError(e), json:null };
      }
    }

    var health = await call("/.netlify/functions/maru-revenue-engine?mode=health&probe=1&audit=1&dryRun=1&noWrite=1", 7000);
    var report = await call("/.netlify/functions/maru-revenue-engine?action=report&fast=1&probe=1&audit=1&summary=1&dryRun=1&noWrite=1&limit=200&ledgerLimit=200", 9000);
    var ledger = await call("/.netlify/functions/ledger?audit=1&probe=1&dryRun=1&noWrite=1&limit=50", 7000);
    var income = await call("/api/igdc/income/summary?audit=1&probe=1&dryRun=1&noWrite=1", 7000);

    var h = revenueHealthSummary(health.json || {});
    var rsum = revenueSummaryFromReport(report.json || {});
    var lsum = ledgerSummary(ledger.json || {});
    var incomeJson = income.json || {};

    var status = "ok";
    var notes = [];
    if(!health.ok && !report.ok){
      status = "error";
      notes.push("수익 엔진 health/report 양쪽 응답 실패");
    }else if(!health.ok || !report.ok || !ledger.ok || !income.ok || rsum.lineError > 0){
      status = "warn";
      if(!health.ok) notes.push("수익 엔진 health 응답 확인 필요");
      if(!report.ok) notes.push("수익 report 요약 응답 확인 필요");
      if(!ledger.ok) notes.push("ledger 조회 경로 확인 필요");
      if(!income.ok) notes.push("income summary 조회 경로 확인 필요");
      if(rsum.lineError > 0) notes.push("수익 라인 error 항목 존재");
    }
    if(rsum.totalRevenueKrw === 0 && rsum.totalRevenueUsd === 0){
      if(status === "ok") status = "warn";
      notes.push("실수익 데이터 투입 전 또는 현재 집계 금액 0");
    }
    if(!h.pgExecution){
      notes.push("PG/지급 실행 없음: read-only 점검 상태");
    }

    return {
      version:"revenue-settlement-diagnostic-v1-readonly",
      status:status,
      ts:new Date().toISOString(),
      elapsed:now() - started,
      noWrite:true,
      dryRun:true,
      settlementExecution:false,
      payoutExecution:false,
      health:h,
      report:rsum,
      ledger:lsum,
      income:{ ok:!!income.ok, status:income.status, endpoint:income.endpoint, raw:incomeJson },
      attempts:attempts,
      notes:notes
    };
  }

  function featureTable(rows){
    rows = rows || [];
    if(!rows.length) return '<div class="mhf-note">feature 정보가 없습니다.</div>';
    return '<div class="mhf-scroll"><table class="mhf-table"><thead><tr><th>기능</th><th>상태</th></tr></thead><tbody>' +
      rows.map(function(r){ return '<tr><td>' + escapeHtml(r.key) + '</td><td>' + escapeHtml(r.value === true ? 'ON' : r.value === false ? 'OFF' : r.value) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function componentTable(map){
    map = map || {};
    var rows = Object.keys(map).sort().map(function(k){ return { key:k, value:map[k] }; });
    if(!rows.length) return '<div class="mhf-note">수익 component 집계가 아직 없습니다.</div>';
    return '<div class="mhf-scroll"><table class="mhf-table"><thead><tr><th>수익 component</th><th>금액/값</th></tr></thead><tbody>' +
      rows.map(function(r){ return '<tr><td>' + escapeHtml(r.key) + '</td><td>' + escapeHtml(r.value) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function openSettlementModal(result){
    closeSettlementModal();
    if(!result){
      result = LAST_SETTLEMENT_RESULT || { status:"pending", ts:new Date().toISOString(), attempts:[], notes:["아직 점검 전입니다."] };
    }
    var backdrop = document.createElement("div");
    backdrop.id = "maru-revenue-settlement-modal";
    backdrop.className = "mhf-backdrop";
    var h = result.health || {};
    var rp = result.report || {};
    var ledger = result.ledger || {};
    var notes = result.notes || [];
    var lite = {
      version:result.version,
      ts:result.ts,
      status:result.status,
      noWrite:result.noWrite,
      dryRun:result.dryRun,
      settlementExecution:result.settlementExecution,
      payoutExecution:result.payoutExecution,
      health:{ ok:h.ok, version:h.version, pgExecution:h.pgExecution, pgStatus:h.pgStatus, weeklyBatchSettlement:h.weeklyBatchSettlement, ledgerRowsEstimated:h.ledgerRowsEstimated },
      report:{ totalRevenueKrw:rp.totalRevenueKrw, totalRevenueUsd:rp.totalRevenueUsd, summaryCount:rp.summaryCount, lineHealth:rp.lineOk + '/' + rp.lineWarn + '/' + rp.lineError, ledgerRows:rp.ledgerRows, incomeRows:rp.incomeRows },
      ledger:{ ok:ledger.ok, mode:ledger.mode, rows:ledger.rows },
      notes:notes
    };

    backdrop.innerHTML =
      '<div class="mhf-modal" role="dialog" aria-modal="true">' +
        '<div class="mhf-head">' +
          '<div>' +
            '<div class="mhf-title">수익 정산 정밀 점검</div>' +
            '<div class="mhf-sub">정산 실행 없이 read-only/dry-run으로 수익 엔진, ledger, income summary를 확인합니다. · ' + escapeHtml(result.ts || '') + '</div>' +
          '</div>' +
          '<div class="mhf-actions">' +
            '<button type="button" class="mhf-settle-download">JSON 다운로드</button>' +
            '<button type="button" class="mhf-close">닫기</button>' +
          '</div>' +
        '</div>' +
        '<div class="mhf-body">' +
          '<div class="mhf-grid">' +
            metric('전체 상태', statusKo(result.status), '최종 판정') +
            metric('수익 엔진', h.ok ? 'OK' : '확인필요', h.version || '-') +
            metric('정산 실행', result.settlementExecution ? 'ON' : 'OFF', 'read-only/dry-run') +
            metric('지급 실행', result.payoutExecution ? 'ON' : 'OFF', 'no-write') +
            metric('총 수익 KRW', Math.round(Number(rp.totalRevenueKrw || 0)), '요약 집계') +
            metric('라인 OK/W/E', (rp.lineOk||0) + '/' + (rp.lineWarn||0) + '/' + (rp.lineError||0), '수익 라인') +
          '</div>' +
          '<div class="mhf-section"><div class="mhf-section-head"><div class="mhf-section-title">정산 점검 요약</div>' + badge(result.status) + '</div>' +
            '<div class="mhf-note">' + escapeHtml(notes.join(' · ') || '특이사항 없음') + '</div></div>' +
          '<div class="mhf-section"><div class="mhf-section-head"><div class="mhf-section-title">수익 엔진 기능 플래그</div>' + badge(h.ok ? 'ok' : 'warn') + '</div>' + featureTable(h.featureRows || []) + '</div>' +
          '<div class="mhf-section"><div class="mhf-section-head"><div class="mhf-section-title">수익 component / 분배 후보 집계</div>' + badge(rp.lineError ? 'warn' : 'ok') + '</div>' + componentTable(rp.byComponent || {}) + '</div>' +
          attemptsTable('수익 정산 Probe 경로', result.attempts || [], result.status === 'error' ? 'error' : result.status) +
          '<div class="mhf-section"><div class="mhf-section-head"><div class="mhf-section-title">점검 원칙</div>' + badge('ok') + '</div>' +
            '<div class="mhf-note">이 버튼은 실제 정산·지급·PG 실행을 하지 않습니다. 수익 엔진 health, 요약 report, ledger/income 연결 상태만 읽어서 판단합니다. 실제 지급 실행 버튼이 아닙니다.</div></div>' +
          '<div class="mhf-section"><div class="mhf-section-head"><div class="mhf-section-title">요약 JSON</div><span class="mhf-badge ok">DEBUG</span></div>' +
            '<div style="padding:10px;"><div class="mhf-json">' + escapeHtml(JSON.stringify(lite, null, 2)) + '</div></div></div>' +
        '</div>' +
      '</div>';

    backdrop.addEventListener("click", function(ev){
      if(ev.target === backdrop) closeSettlementModal();
    });
    var dl = backdrop.querySelector(".mhf-settle-download");
    if(dl) dl.addEventListener("click", function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      downloadSettlementJsonReport(result);
      return false;
    });
    var close = backdrop.querySelector(".mhf-close");
    if(close) close.addEventListener("click", closeSettlementModal);
    document.body.appendChild(backdrop);
  }

  function closeSettlementModal(){
    var m = byId("maru-revenue-settlement-modal");
    if(m && m.parentNode) m.parentNode.removeChild(m);
  }

  function findSettlementCard(){
    return byId("maru-revenue-settlement-card") || document.querySelector("[data-maru-revenue-settlement-card='1']");
  }

  function findRightPanelCardByWords(words){
    var host = byId("igdc-site-control") || document.querySelector(".igdc-site-control");
    if(!host) return null;
    words = words || [];

    // IMPORTANT:
    // Do not return broad container divs whose text merely contains all card titles.
    // Returning the panel/grid container makes insertBefore() place the settlement card
    // at the very top of the right panel. Only real card elements are valid anchors.
    var nodes = Array.prototype.slice.call(host.querySelectorAll(".igdc-sc-card, [data-card], button"));
    for(var i=0;i<nodes.length;i++){
      var el = nodes[i];
      var card = (el.classList && el.classList.contains("igdc-sc-card")) ? el : (el.closest && el.closest(".igdc-sc-card"));
      if(!card || card === findSettlementCard()) continue;
      var text = s(card.textContent).replace(/\s+/g," ").trim();
      if(!text) continue;
      var ok = words.every(function(k){ return text.indexOf(k) >= 0; });
      if(ok) return card;
    }
    return null;
  }

  function findUxCard(){
    return findRightPanelCardByWords(["기기/브라우저", "UX"]);
  }

  function findSystemHealthCard(){
    return findRightPanelCardByWords(["시스템", "헬스체크"]) ||
      findRightPanelCardByWords(["엔진", "헬스체크"]) ||
      findRightPanelCardByWords(["시스템", "점검"]);
  }

  function setSettlementCard(st, body){
    var card = findSettlementCard();
    if(!card) return;
    var p = cardParts(card);
    if(p.status){
      p.status.textContent = statusLabel(st);
      p.status.className = "igdc-sc-card-status " + statusClass(st);
    }
    if(p.body) p.body.textContent = body || "";
    card.dataset.maruSettlementStatus = st;
  }

  async function runSettlementCheck(opts){
    opts = opts || {};
    if(SETTLEMENT_RUNNING) return LAST_SETTLEMENT_RESULT;
    SETTLEMENT_RUNNING = true;
    setSettlementCard("pending", "수익 정산 read-only 점검 중…");
    try{
      var result = await settlementProbe();
      LAST_SETTLEMENT_RESULT = result;
      if(result.status === "ok") setSettlementCard("ok", "정산 엔진/ledger/income summary 연결 정상");
      else if(result.status === "warn") setSettlementCard("warn", "정산 실행 없이 준비 상태 확인 · 일부 경로 주의");
      else setSettlementCard("error", "수익 정산 점검 경로 확인 필요");
      if(opts.open !== false) openSettlementModal(result);
      return result;
    }catch(e){
      var fail = { version:"revenue-settlement-diagnostic-v1-readonly", status:"error", ts:new Date().toISOString(), noWrite:true, dryRun:true, settlementExecution:false, payoutExecution:false, error:shortError(e), attempts:[], notes:[shortError(e)] };
      LAST_SETTLEMENT_RESULT = fail;
      setSettlementCard("error", "수익 정산 점검 실패: " + shortError(e));
      if(opts.open !== false) openSettlementModal(fail);
      return fail;
    }finally{
      SETTLEMENT_RUNNING = false;
    }
  }

  function placeSettlementCard(card, referenceCard){
    var host = byId("igdc-site-control") || document.querySelector(".igdc-site-control");
    if(!host || !card) return;

    var systemCard = findSystemHealthCard();
    var uxCard = findUxCard();
    var grid = host.querySelector(".igdc-sc-grid") || host;

    // Fixed ADMIN right-panel order:
    // 기기/브라우저 · UX
    // ↓
    // 수익 정산 정밀 점검
    // ↓
    // 시스템 점검 / 엔진 헬스체크
    // Other existing cards/functions are not touched.
    if(uxCard && systemCard && uxCard !== card && systemCard !== card && uxCard.parentNode === systemCard.parentNode){
      systemCard.parentNode.insertBefore(card, systemCard);
      return;
    }

    if(uxCard && uxCard !== card && uxCard.parentNode){
      uxCard.parentNode.insertBefore(card, uxCard.nextSibling);
      return;
    }

    if(systemCard && systemCard !== card && systemCard.parentNode){
      systemCard.parentNode.insertBefore(card, systemCard);
      return;
    }

    if(referenceCard && referenceCard !== card && referenceCard.parentNode){
      referenceCard.parentNode.insertBefore(card, referenceCard.nextSibling);
      return;
    }

    grid.appendChild(card);
  }

  function insertSettlementCard(referenceCard){
    var host = byId("igdc-site-control") || document.querySelector(".igdc-site-control");
    if(!host) return null;

    var existing = findSettlementCard();
    if(existing){
      placeSettlementCard(existing, referenceCard);
      return existing;
    }

    var card = document.createElement("div");
    card.id = "maru-revenue-settlement-card";
    card.className = "igdc-sc-card mhf-settlement-card";
    card.setAttribute("data-maru-revenue-settlement-card", "1");
    card.innerHTML =
      '<div class="igdc-sc-card-header">' +
        '<span class="igdc-sc-card-title">수익 정산 정밀 점검</span>' +
        '<span class="igdc-sc-card-status">-</span>' +
      '</div>' +
      '<div class="igdc-sc-card-body">정산 실행 없이 수익 엔진·ledger·income summary를 read-only로 점검합니다.</div>';
    card.addEventListener("click", function(ev){
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){}
      if(!LAST_SETTLEMENT_RESULT){
        runSettlementCheck({manual:true, open:true});
      }else{
        openSettlementModal(LAST_SETTLEMENT_RESULT);
      }
      return false;
    }, true);

    placeSettlementCard(card, referenceCard);
    setSettlementCard("pending", "정산 실행 없는 read-only 점검 대기");
    return card;
  }

  function mergePageViews(designAnalysis, deliveryAnalysis, frontend){
    var frontByKey = {};
    (frontend.rows || []).forEach(function(r){ frontByKey[r.key] = r; });

    var delByKey = {};
    (deliveryAnalysis.pageRows || []).forEach(function(r){ delByKey[r.key] = r; });

    var rows = (designAnalysis.pageRows || []).filter(function(r){ return r.key !== "unknown"; }).map(function(d){
      var del = delByKey[d.key] || emptyStats(d.key, d.label);
      var fr = frontByKey[d.key] || {};
      return {
        key:d.key,
        label:d.label,
        designed:d.slots || 0,
        delivered:del.slots || 0,
        real:del.real || 0,
        sample:del.sample || 0,
        thumb:del.thumb || 0,
        productSignal:del.productSignal || 0,
        revenueStructure:del.revenueStructure || 0,
        revenueOk:del.revenueOk || 0,
        revenueWarn:del.revenueWarn || 0,
        revenueError:del.revenueError || 0,
        frontRendered:fr.renderedCards || 0,
        frontImages:fr.images || 0,
        frontSections:fr.sections || 0,
        frontMode:fr.mode || "-",
        frontOk:!!fr.ok,
        frontError:fr.error || ""
      };
    });

    return rows;
  }

  function globalStatus(design, delivery, frontend, revenue){
    if(!design || !design.ok) return "error";
    if(!delivery || !delivery.ok) return "warn";

    var t = delivery.analysis && delivery.analysis.totals || {};
    // ERROR only means actual real content has broken revenue/payment lines.
    // When all items are sample/placeholder, the expected state is WARN/준비중.
    if((t.real || 0) > 0 && (t.revenueError || 0) > 0) return "error";
    if((t.real || 0) === 0 || (delivery.analysis.sampleRate || 0) > 50 || !revenue.ok || (t.revenueWarn || 0) > 0) return "warn";
    return "ok";
  }

  async function runCheck(options){
    options = options || {};
    if(RUNNING) return LAST_RESULT;
    RUNNING = true;

    var card = findTargetCard();
    if(card){
      hookCard(card);
      setCard(card, "pending", "슬롯·데이터·프론트·수익 라인 점검 중…");
    }

    try{
      var started = now();
      var packs = await Promise.allSettled([
        loadDesignSnapshot(),
        loadDeliveredData(),
        auditFrontend(),
        mediaProbe(),
        revenueProbe()
      ]);

      var designPack = packs[0].status === "fulfilled" ? packs[0].value : { ok:false, items:[], attempts:[{error:shortError(packs[0].reason)}] };
      var deliveryPack = packs[1].status === "fulfilled" ? packs[1].value : { ok:false, items:[], attempts:[{error:shortError(packs[1].reason)}] };
      var frontend = packs[2].status === "fulfilled" ? packs[2].value : { rows:[], totals:{}, error:shortError(packs[2].reason) };
      var media = packs[3].status === "fulfilled" ? packs[3].value : { ok:false, error:shortError(packs[3].reason) };
      var revenue = packs[4].status === "fulfilled" ? packs[4].value : { ok:false, error:shortError(packs[4].reason) };

      var designAnalysis = analyzeItems(designPack.items || []);
      var deliveryAnalysis = analyzeItems(deliveryPack.items && deliveryPack.items.length ? deliveryPack.items : designPack.items || []);
      var pageRows = mergePageViews(designAnalysis, deliveryAnalysis, frontend);

      var result = {
        version:VERSION,
        ts:new Date().toISOString(),
        elapsed:now()-started,
        design:{ ok:designPack.ok, endpoint:designPack.endpoint, elapsed:designPack.elapsed, attempts:designPack.attempts, analysis:designAnalysis },
        delivery:{ ok:deliveryPack.ok, endpoint:deliveryPack.endpoint, elapsed:deliveryPack.elapsed, attempts:deliveryPack.attempts, analysis:deliveryAnalysis },
        frontend:frontend,
        mediaProbe:media,
        revenueProbe:revenue,
        pageRows:pageRows
      };

      result.status = globalStatus(result.design, result.delivery, result.frontend, revenue);
      LAST_RESULT = result;

      var dTot = designAnalysis.totals || {};
      var delTot = deliveryAnalysis.totals || {};
      var frTot = frontend.totals || {};
      var body = "설계 " + (dTot.slots || 0) +
        " · 내려감 " + (delTot.slots || 0) +
        " · 실제 " + (delTot.real || 0) +
        " · 프론트 " + (frTot.renderedCards || 0) +
        " · 수익오류 " + (delTot.revenueError || 0);

      card = findTargetCard();
      if(card){
        hookCard(card);
        setCard(card, result.status, body);
      }

      try{ global.dispatchEvent(new CustomEvent("MARU_HEALTH_FINAL_SLOT_DONE", { detail:result })); }catch(_){}
      return result;
    }finally{
      RUNNING = false;
    }
  }

  function metric(k,v,n){
    return '<div class="mhf-metric"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(v) + '</div><div class="n">' + escapeHtml(n || "") + '</div></div>';
  }

  function badge(st){
    return '<span class="mhf-badge ' + escapeHtml(st || "warn") + '">' + escapeHtml(statusKo(st || "warn")) + '</span>';
  }

  function pct(a,b){
    if(!b) return "0%";
    return (Math.round((a/b)*1000)/10) + "%";
  }

  function pageTable(rows){
    rows = Array.isArray(rows) ? rows : [];
    var html = rows.map(function(r){
      var state = r.key === "literature_academic" && !r.real ? "준비중" : (r.real ? "실데이터" : "샘플");
      return '<tr>' +
        '<td>' + escapeHtml(r.label) + '</td>' +
        '<td>' + escapeHtml(state) + '</td>' +
        '<td>' + escapeHtml(r.designed) + '</td>' +
        '<td>' + escapeHtml(r.delivered) + '</td>' +
        '<td>' + escapeHtml(r.real) + '</td>' +
        '<td>' + escapeHtml(r.sample) + '</td>' +
        '<td>' + escapeHtml(r.frontRendered) + '</td>' +
        '<td>' + escapeHtml(r.frontImages) + '</td>' +
        '<td>' + escapeHtml(r.revenueStructure) + '</td>' +
        '<td>' + escapeHtml(r.revenueOk + "/" + r.revenueWarn + "/" + r.revenueError) + '</td>' +
        '<td>' + escapeHtml(pct(r.real, r.designed)) + '</td>' +
      '</tr>';
    }).join("");

    return '<div class="mhf-section">' +
      '<div class="mhf-section-head"><div class="mhf-section-title">페이지별 설계 슬롯 / 내려간 데이터 / 프론트 구현 / 수익 라인</div>' + badge("ok") + '</div>' +
      '<div class="mhf-note">프론트 구현 수는 숨김 iframe으로 각 페이지를 열어 카드/슬롯 DOM 신호를 계산합니다. JS 렌더링 지연이나 표시 cap이 있으면 실제 화면 노출 수와 차이가 날 수 있습니다.</div>' +
      '<div class="mhf-scroll"><table class="mhf-table">' +
      '<thead><tr><th>페이지</th><th>상태</th><th>설계</th><th>내려감</th><th>실제</th><th>샘플</th><th>프론트카드</th><th>프론트이미지</th><th>수익구조</th><th>수익 OK/W/E</th><th>채움률</th></tr></thead>' +
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
        '<td>' + escapeHtml(r.productSignal) + '</td>' +
        '<td>' + escapeHtml(r.revenueStructure) + '</td>' +
        '<td>' + escapeHtml(r.revenueOk) + '</td>' +
        '<td>' + escapeHtml(r.revenueWarn) + '</td>' +
        '<td>' + escapeHtml(r.revenueError) + '</td>' +
      '</tr>';
    }).join("");

    return '<div class="mhf-section">' +
      '<div class="mhf-section-head"><div class="mhf-section-title">섹션별 데이터·상품·수익 라인 상세</div>' + badge("ok") + '</div>' +
      '<div class="mhf-scroll"><table class="mhf-table">' +
      '<thead><tr><th>페이지</th><th>섹션</th><th>내려감</th><th>실제</th><th>샘플</th><th>썸네일</th><th>상품신호</th><th>수익구조</th><th>수익OK</th><th>수익WARN</th><th>수익ERR</th></tr></thead>' +
      '<tbody>' + html + '</tbody></table></div></div>';
  }

  function frontTable(frontend){
    var rows = frontend && Array.isArray(frontend.rows) ? frontend.rows : [];
    var html = rows.map(function(r){
      return '<tr>' +
        '<td>' + escapeHtml(r.label) + '</td>' +
        '<td>' + escapeHtml(r.ok ? "OK" : "WARN") + '</td>' +
        '<td>' + escapeHtml(r.mode || "-") + '</td>' +
        '<td>' + escapeHtml(r.renderedCards || 0) + '</td>' +
        '<td>' + escapeHtml(r.images || 0) + '</td>' +
        '<td>' + escapeHtml(r.sections || 0) + '</td>' +
        '<td>' + escapeHtml(r.elapsed == null ? "-" : r.elapsed + "ms") + '</td>' +
        '<td>' + escapeHtml(r.error || "") + '</td>' +
      '</tr>';
    }).join("");

    return '<div class="mhf-section">' +
      '<div class="mhf-section-head"><div class="mhf-section-title">프론트 페이지 실제 구현 Probe</div>' + badge("warn") + '</div>' +
      '<div class="mhf-note">이 값은 각 프론트 페이지를 숨김 iframe으로 열어서 DOM 카드/이미지/섹션 신호를 본 것입니다. 페이지가 동적으로 늦게 꽂히면 낮게 잡힐 수 있습니다.</div>' +
      '<table class="mhf-table"><thead><tr><th>페이지</th><th>상태</th><th>방식</th><th>카드</th><th>이미지</th><th>섹션</th><th>응답</th><th>메모</th></tr></thead><tbody>' + html + '</tbody></table>' +
      '</div>';
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

    return '<div class="mhf-section">' +
      '<div class="mhf-section-head"><div class="mhf-section-title">' + escapeHtml(title) + '</div>' + badge(st || "warn") + '</div>' +
      '<table class="mhf-table"><thead><tr><th>Endpoint</th><th>상태</th><th>응답</th><th>건수</th><th>메모</th></tr></thead><tbody>' + html + '</tbody></table>' +
      '</div>';
  }

  function openModal(result){
    injectStyle();
    closeModal();

    result = result || LAST_RESULT;
    if(!result) return;

    var design = result.design || {};
    var delivery = result.delivery || {};
    var dA = design.analysis || {};
    var delA = delivery.analysis || {};
    var dTot = dA.totals || {};
    var delTot = delA.totals || {};
    var frTot = result.frontend && result.frontend.totals || {};
    var media = result.mediaProbe || {};
    var revenue = result.revenueProbe || {};

    var lite = {
      version:result.version,
      ts:result.ts,
      status:result.status,
      design:{ endpoint:design.endpoint, slots:dTot.slots },
      delivery:{
        endpoint:delivery.endpoint,
        slots:delTot.slots,
        real:delTot.real,
        sample:delTot.sample,
        productSignal:delTot.productSignal,
        revenueStructure:delTot.revenueStructure,
        revenueOk:delTot.revenueOk,
        revenueWarn:delTot.revenueWarn,
        revenueError:delTot.revenueError
      },
      frontend:frTot,
      mediaProbe:{ ok:media.ok, count:media.count, withThumb:media.withThumb, endpoint:media.endpoint },
      revenueProbe:{ ok:revenue.ok, endpoint:revenue.endpoint }
    };

    var backdrop = document.createElement("div");
    backdrop.id = MODAL_ID;
    backdrop.className = "mhf-backdrop";
    backdrop.innerHTML =
      '<div class="mhf-modal" role="dialog" aria-modal="true">' +
        '<div class="mhf-head">' +
          '<div>' +
            '<div class="mhf-title">수익 · 썸네일 · 상품 맵핑 상세 점검</div>' +
            '<div class="mhf-sub">설계 슬롯, 내려간 데이터, 프론트 구현, 수익 라인을 함께 점검합니다. · ' + escapeHtml(result.ts || "") + '</div>' +
          '</div>' +
          '<div class="mhf-actions">' +
            '<button type="button" class="mhf-json-download">JSON 다운로드</button>' +
            '<button type="button" class="mhf-close">닫기</button>' +
          '</div>' +
        '</div>' +
        '<div class="mhf-body">' +
          '<div class="mhf-grid">' +
            metric("전체 상태", statusKo(result.status), "최종 판정") +
            metric("설계 슬롯", dTot.slots || 0, "Snapshot 기준") +
            metric("내려간 데이터", delTot.slots || 0, "Search Bank 기준") +
            metric("실제 콘텐츠", delTot.real || 0, "채움률 " + (delA.fillRate || 0) + "%") +
            metric("프론트 카드", frTot.renderedCards || 0, "iframe/DOM probe") +
            metric("수익 오류", delTot.revenueError || 0, "WARN " + (delTot.revenueWarn || 0)) +
          '</div>' +
          pageTable(result.pageRows || []) +
          sectionTable(delA.sectionRows || []) +
          frontTable(result.frontend || {}) +
          attemptsTable("설계 Snapshot 로드 경로", design.attempts || [], design.ok ? "ok" : "error") +
          attemptsTable("Search Bank 내려간 데이터 경로", delivery.attempts || [], delivery.ok ? "ok" : "warn") +
          attemptsTable("검색 미디어 후보 Probe", media.attempts || [], media.ok ? "ok" : "warn") +
          attemptsTable("수익 엔진 Probe", revenue.attempts || [], revenue.ok ? "ok" : "warn") +
          '<div class="mhf-section">' +
            '<div class="mhf-section-head"><div class="mhf-section-title">수익 라인 판정 기준</div>' + badge(result.status) + '</div>' +
            '<div class="mhf-note">' +
              '금액은 수익 대시보드에서 확인하고, 여기서는 연결 상태만 봅니다. ' +
              '광고/impression, engagement, referral, linkRevenue, affiliateRevenue, settlementDestination, directSale, blockchainPayment 라인을 검사합니다. ' +
              '샘플 슬롯의 url=# 및 수익 라인 미장착은 오류가 아니라 WARN/준비중으로 분리하고, 실제 콘텐츠에서 결제/링크/정산 필수값이 없을 때만 ERROR로 봅니다.' +
            '</div>' +
          '</div>' +
          '<div class="mhf-section">' +
            '<div class="mhf-section-head"><div class="mhf-section-title">요약 JSON</div><span class="mhf-badge ok">DEBUG</span></div>' +
            '<div style="padding:10px;"><div class="mhf-json">' + escapeHtml(JSON.stringify(lite, null, 2)) + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    backdrop.addEventListener("click", function(ev){
      if(ev.target === backdrop) closeModal();
    });
    var dl = backdrop.querySelector(".mhf-json-download");
    if(dl) dl.addEventListener("click", function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      downloadJsonReport(result);
      return false;
    });

    var close = backdrop.querySelector(".mhf-close");
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
      insertSettlementCard(card);
      setCard(card, "pending", "전체 헬스체크 실행 시 슬롯·수익 라인을 점검합니다.");
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
      var card = findTargetCard();
      if(card) insertSettlementCard(card);
      hookRunButton();
      var flag = (location.search || "") + " " + (location.hash || "");
      if(/health=1|health-run|maru-health/i.test(flag)){
        runCheck({auto:true, reason:"url-flag"});
      }
    }, 900);

    // The right panel may be re-rendered after this script loads. Re-place only the
    // settlement card a few times so it lands between UX and engine health check.
    [1300, 2200, 3500].forEach(function(delay){
      setTimeout(function(){
        var settlement = findSettlementCard();
        if(settlement) placeSettlementCard(settlement, findTargetCard());
      }, delay);
    });
  }

  global.MaruHealth = global.MaruHealth || {};
  global.MaruHealth.finalSlotRevenueVersion = VERSION;
  global.MaruHealth.runFinalSlotRevenueCheck = runCheck;
  global.MaruHealth.openFinalSlotRevenueModal = function(){ openModal(LAST_RESULT); };
  global.MaruHealth.downloadFinalSlotRevenueJson = function(){ return downloadJsonReport(LAST_RESULT); };
  global.MaruHealth.runRevenueSettlementCheck = runSettlementCheck;
  global.MaruHealth.openRevenueSettlementModal = function(){ openSettlementModal(LAST_SETTLEMENT_RESULT); };
  global.MaruHealth.downloadRevenueSettlementJson = function(){ return downloadSettlementJsonReport(LAST_SETTLEMENT_RESULT); };

  global.IGDC_HEALTH = global.IGDC_HEALTH || {};
  global.IGDC_HEALTH.runFinalSlotRevenueCheck = runCheck;
  global.IGDC_HEALTH.runRevenueSettlementCheck = runSettlementCheck;

  global.runMaruFinalSlotRevenueHealth = runCheck;
  global.runMaruRevenueSettlementHealth = runSettlementCheck;

  ready(init);

})(window, document);
