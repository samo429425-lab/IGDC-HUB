/**
 * assets/js/maru-revenue-tracker.js
 * ------------------------------------------------------------
 * IGDC / MARU Revenue Tracker v2.1 snapshot-aware
 *
 * Browser-side live-event tracker for:
 * search / front slots / ads / products / affiliate / media watch time /
 * likes / recommends / shares / save / comments / posts / reviews /
 * donation / tour / social / networkhub / distribution / future culture-art.
 *
 * It does not execute PG payment, settlement, payout, or maru-search changes.
 */
(function(global){
  "use strict";

  var VERSION = "maru-revenue-tracker-v2.1.0-snapshot-aware";
  var DEFAULT_ENDPOINTS = [
    "/.netlify/functions/maru-revenue-track-bridge",
    "/.netlify/functions/maru-revenue-engine?action=track",
    "/.netlify/functions/revenue-engine?action=track"
  ];

  var EVENT = {
    SEARCH_SUBMIT:"search_submit",
    SEARCH_RESULT_IMPRESSION:"search_result_impression",
    SEARCH_RESULT_CLICK:"search_result_click",
    SLOT_IMPRESSION:"slot_impression",
    SLOT_CLICK:"slot_click",
    AD_IMPRESSION:"ad_impression",
    AD_CLICK:"ad_click",
    PRODUCT_IMPRESSION:"product_impression",
    PRODUCT_CLICK:"product_click",
    AFFILIATE_CLICK:"affiliate_click",
    MEDIA_IMPRESSION:"media_impression",
    MEDIA_CLICK:"media_click",
    MEDIA_WATCH_TIME:"media_watch_time",
    MEDIA_DWELL:"media_dwell",
    MEDIA_COMPLETE:"media_complete",
    SPATIAL_INTERACTION:"spatial_interaction",
    LIKE:"like",
    RECOMMEND:"recommend",
    SHARE:"share",
    SAVE:"save",
    COMMENT_CREATE:"comment_create",
    POST_CREATE:"post_create",
    REVIEW_CREATE:"review_create",
    RATING:"rating",
    DONATION_ENTRY:"donation_entry",
    DONATION_CTA_CLICK:"donation_cta_click",
    DONATION_MODAL_OPEN:"donation_modal_open",
    DONATION_INTENT:"donation_intent",
    TOUR_IMPRESSION:"tour_impression",
    TOUR_CLICK:"tour_click",
    TOUR_BOOKING_INTENT:"tour_booking_intent",
    CULTURE_ART_IMPRESSION:"culture_art_impression",
    CULTURE_ART_CLICK:"culture_art_click",
    CULTURE_ARTIST_CLICK:"culture_artist_click",
    CULTURE_EVENT_CLICK:"culture_event_click",
    CULTURE_TICKET_CLICK:"culture_ticket_click",
    CULTURE_SPONSOR_CLICK:"culture_sponsor_click",
    CULTURE_DONATION_INTENT:"culture_donation_intent"
  };

  var LINE = {
    SEARCH_CLICK:"search_click",
    SEARCH_AD:"search_ad",
    DISPLAY_AD:"display_ad",
    PRODUCT_AFFILIATE:"product_affiliate",
    COMMERCE_DIRECT:"commerce_direct",
    MEDIA_WATCHTIME:"media_watchtime",
    MEDIA_ENGAGEMENT:"media_engagement",
    DONATION_INTENT:"donation_intent",
    SPONSOR_CLICK:"sponsor_click",
    TOUR_COMMISSION:"tour_commission",
    COMMENT_REWARD:"comment_reward",
    POST_REWARD:"post_reward",
    LIKE_REWARD:"like_reward",
    RECOMMEND_REWARD:"recommend_reward",
    SHARE_REWARD:"share_reward",
    SAVE_REWARD:"save_reward",
    CULTURE_SPONSOR:"culture_sponsor",
    CULTURE_TICKET:"culture_ticket",
    CULTURE_DONATION:"culture_donation"
  };

  var POINTS = {
    search_submit:0,
    search_result_impression:0.001,
    search_result_click:0.010,
    slot_impression:0.001,
    slot_click:0.010,
    ad_impression:0.002,
    ad_click:0.030,
    product_impression:0.001,
    product_click:0.015,
    affiliate_click:0.030,
    media_impression:0.001,
    media_click:0.010,
    media_watch_time:0.0005,
    media_dwell:0.0003,
    media_complete:0.020,
    spatial_interaction:0.002,
    like:0.003,
    recommend:0.005,
    share:0.008,
    save:0.004,
    comment_create:0.010,
    post_create:0.015,
    review_create:0.015,
    rating:0.004,
    donation_entry:0.003,
    donation_cta_click:0.020,
    donation_modal_open:0.020,
    donation_intent:0.050,
    tour_impression:0.001,
    tour_click:0.015,
    tour_booking_intent:0.040,
    culture_art_impression:0.001,
    culture_art_click:0.010,
    culture_artist_click:0.010,
    culture_event_click:0.010,
    culture_ticket_click:0.030,
    culture_sponsor_click:0.030,
    culture_donation_intent:0.050
  };

  var config = {
    enabled:true,
    debug:false,
    endpoints:DEFAULT_ENDPOINTS.slice(),
    service:"front",
    pageType:null,
    batchSize:12,
    flushIntervalMs:4500,
    queueKey:"__MARU_REVENUE_TRACKER_V21_QUEUE__",
    sessionKey:"__MARU_REVENUE_SESSION__",
    anonKey:"__MARU_REVENUE_ANON__",
    impressionOncePerSession:true,
    clickThrottleMs:700,
    points:Object.assign({}, POINTS),
    privacy:{ sendFullText:false, maxTextLength:0 }
  };

  var state = {
    queue:[],
    seenImpressions:{},
    lastClicks:{},
    mediaSessions:new WeakMap(),
    timer:null,
    inFlight:false,
    installed:false
  };

  function s(v){ return v == null ? "" : String(v); }
  function low(v){ return s(v).trim().toLowerCase(); }
  function n(v,d){ var x = Number(v); return Number.isFinite(x) ? x : (d || 0); }
  function nowIso(){ return new Date().toISOString(); }
  function nowMs(){ return Date.now(); }
  function first(){
    for(var i=0;i<arguments.length;i++){
      var v = arguments[i];
      if(v === undefined || v === null) continue;
      if(typeof v === "string" && !v.trim()) continue;
      return v;
    }
    return "";
  }
  function domainOf(url){ try { return new URL(url, location.href).hostname.replace(/^www\./,""); } catch(e){ return ""; } }
  function rand(prefix){ return (prefix || "evt") + "-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(36); }
  function hash32(str){
    str = s(str);
    var h = 2166136261;
    for(var i=0;i<str.length;i++){
      h ^= str.charCodeAt(i);
      h += (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24);
    }
    return (h >>> 0).toString(16);
  }
  function sessionId(){
    try{
      var id = sessionStorage.getItem(config.sessionKey);
      if(!id){
        id = "mrs-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(36);
        sessionStorage.setItem(config.sessionKey, id);
      }
      return id;
    }catch(e){ return "mrs-memory-" + Date.now().toString(36); }
  }
  function anonId(){
    try{
      var id = localStorage.getItem(config.anonKey);
      if(!id){
        id = "mru-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(36);
        localStorage.setItem(config.anonKey, id);
      }
      return id;
    }catch(e){ return null; }
  }
  function inferPageType(){
    var p = low(location.pathname);
    if(p.indexOf("search") >= 0) return "search";
    if(p.indexOf("donation") >= 0 || p.indexOf("donate") >= 0) return "donation";
    if(p.indexOf("culture") >= 0 || p.indexOf("art") >= 0) return "culture_art";
    if(p.indexOf("media") >= 0) return "media";
    if(p.indexOf("admin") >= 0) return "admin_insight";
    if(p.indexOf("tour") >= 0 || p.indexOf("travel") >= 0) return "tour";
    if(p.indexOf("distribution") >= 0 || p.indexOf("commerce") >= 0 || p.indexOf("shop") >= 0 || p.indexOf("market") >= 0) return "distribution";
    if(p.indexOf("social") >= 0 || p.indexOf("sns") >= 0) return "social";
    if(p.indexOf("network") >= 0) return "networkhub";
    return "front";
  }
  function textPayload(text){
    var t = s(text || "");
    if(!t) return null;
    if(config.privacy.sendFullText){
      var max = n(config.privacy.maxTextLength, 0);
      return max ? t.slice(0, max) : t;
    }
    return { length:t.length, hash:hash32(t) };
  }
  function getPath(obj, path){
    var cur = obj;
    var parts = path.split(".");
    for(var i=0;i<parts.length;i++){
      if(!cur || typeof cur !== "object") return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function compactItem(raw){
    raw = raw && typeof raw === "object" ? raw : {};
    var url = first(raw.url, raw.link, raw.href, raw.checkoutUrl, getPath(raw,"link.url"), getPath(raw,"donation.checkout_url"));
    var trackId = first(
      raw.trackId, raw.track_id, getPath(raw,"track.track_id"),
      getPath(raw,"monetization.impression.trackId"),
      getPath(raw,"monetization.click.trackId"),
      getPath(raw,"monetization.referral.trackCode"),
      getPath(raw,"linkRevenue.trackId")
    );
    var itemId = first(raw.id, raw.uid, raw.item_id, raw.contentId, raw.content_id, raw.productId, raw.product_id, raw.sku, raw.slotId, trackId);
    var provider = first(
      raw.provider, raw.provider_id, raw.seller, raw.merchant, raw.producerId, raw.creatorId,
      getPath(raw,"source.platform"), getPath(raw,"source.name"),
      getPath(raw,"commerce.provider"), getPath(raw,"linkRevenue.providers.0"),
      domainOf(url)
    );
    return {
      itemId:itemId || null,
      contentId:first(raw.contentId, raw.content_id, raw.uid) || null,
      productId:first(raw.productId, raw.product_id, raw.sku, getPath(raw,"directSale.productSku")) || null,
      slotId:first(raw.slotId, raw.slot_id, trackId) || null,
      campaignId:first(raw.campaignId, raw.campaign_id, getPath(raw,"donation.campaign_id"), getPath(raw,"monetization.campaignId")) || null,
      providerId:provider || null,
      producerId:first(raw.producerId, raw.creatorId, raw.seller, provider) || null,
      affiliateId:first(raw.affiliateId, getPath(raw,"monetization.referral.partner"), getPath(raw,"linkRevenue.providers.0")) || null,
      sellerId:first(raw.sellerId, raw.seller, getPath(raw,"commerce.seller")) || null,
      psomKey:first(raw.psom_key, raw.psomKey, raw.section, getPath(raw,"bind.section")) || null,
      trackId:trackId || null,
      title:first(raw.title, raw.name, raw.label) || null,
      url:url || null,
      domain:domainOf(url) || null,
      itemType:first(raw.kind, raw.type, getPath(raw,"commerce.kind")) || null,
      mediaType:first(raw.mediaType, getPath(raw,"media.kind"), getPath(raw,"media.type")) || null,
      category:first(raw.category, raw.section, raw.psom_key, raw.page, getPath(raw,"commerce.category")) || null,
      page:first(raw.page, raw.channel, raw._snapshotPage, getPath(raw,"bind.page")) || null,
      section:first(raw.section, raw.psom_key, raw._snapshotSection, getPath(raw,"bind.section")) || null,
      price:n(first(raw.price, raw.amount, getPath(raw,"directSale.price"), getPath(raw,"commerce.price"), getPath(raw,"payment.price"), getPath(raw,"donation.min_amount")),0),
      currency:first(raw.currency, raw.ccy, getPath(raw,"directSale.currency"), getPath(raw,"commerce.currency"), getPath(raw,"payment.currency"), getPath(raw,"donation.currency"), "USD") || "USD",
      revenueLine:first(raw.revenueLine, raw.revenue_line, getPath(raw,"monetization.revenueLine"), getPath(raw,"revenue.line")) || null,
      snapshotSource:first(raw.snapshotSource, raw._snapshotSource, getPath(raw,"bank_ref.source")) || null,
      snapshotRecordId:first(raw.snapshotRecordId, getPath(raw,"bank_ref.record_id")) || null
    };
  }

  function itemFromElement(el){
    var d = (el && el.dataset) || {};
    return {
      id:first(d.itemId, d.id, el && el.id),
      uid:d.uid,
      contentId:d.contentId,
      productId:d.productId,
      sku:d.sku,
      slotId:d.slotId,
      campaignId:d.campaignId,
      provider:first(d.providerId, d.provider, d.source),
      producerId:d.producerId,
      affiliateId:d.affiliateId,
      sellerId:d.sellerId,
      psom_key:d.psomKey,
      trackId:d.trackId,
      title:first(d.title, el && el.getAttribute && el.getAttribute("title"), el && el.textContent && el.textContent.trim().slice(0,160)),
      url:first(d.url, el && el.getAttribute && (el.getAttribute("href") || el.getAttribute("src"))),
      kind:d.kind,
      type:d.itemType || d.type,
      mediaType:d.mediaType,
      category:d.category,
      page:d.page,
      section:d.section,
      price:d.price,
      currency:d.currency,
      revenueLine:d.revenueLine || d.revenue,
      snapshotSource:d.snapshotSource,
      snapshotRecordId:d.snapshotRecordId
    };
  }

  function inferLine(eventType, item){
    item = item || {};
    if(item.revenueLine) return item.revenueLine;
    var t = low(first(item.itemType, item.mediaType, item.category, item.page, item.section));
    if(eventType === EVENT.AD_IMPRESSION || eventType === EVENT.AD_CLICK || t === "ad" || t.indexOf("sponsor") >= 0) return LINE.DISPLAY_AD;
    if(eventType === EVENT.SEARCH_RESULT_CLICK || eventType === EVENT.SEARCH_SUBMIT) return LINE.SEARCH_CLICK;
    if(eventType === EVENT.AFFILIATE_CLICK) return LINE.PRODUCT_AFFILIATE;
    if(eventType === EVENT.PRODUCT_CLICK || eventType === EVENT.PRODUCT_IMPRESSION || t.indexOf("product") >= 0 || t.indexOf("commerce") >= 0) return LINE.PRODUCT_AFFILIATE;
    if(eventType.indexOf("media_") === 0 || ["video","audio","live","xr","vr","ar","hologram","3d","spatial","volumetric","metaverse"].indexOf(t) >= 0) return eventType === EVENT.MEDIA_WATCH_TIME ? LINE.MEDIA_WATCHTIME : LINE.MEDIA_ENGAGEMENT;
    if(eventType.indexOf("donation_") === 0 || t.indexOf("donation") >= 0) return LINE.DONATION_INTENT;
    if(eventType.indexOf("tour_") === 0 || t.indexOf("tour") >= 0 || t.indexOf("travel") >= 0) return LINE.TOUR_COMMISSION;
    if(eventType === EVENT.LIKE) return LINE.LIKE_REWARD;
    if(eventType === EVENT.RECOMMEND) return LINE.RECOMMEND_REWARD;
    if(eventType === EVENT.SHARE) return LINE.SHARE_REWARD;
    if(eventType === EVENT.SAVE) return LINE.SAVE_REWARD;
    if(eventType === EVENT.COMMENT_CREATE) return LINE.COMMENT_REWARD;
    if(eventType === EVENT.POST_CREATE || eventType === EVENT.REVIEW_CREATE) return LINE.POST_REWARD;
    if(eventType === EVENT.CULTURE_SPONSOR_CLICK) return LINE.CULTURE_SPONSOR;
    if(eventType === EVENT.CULTURE_TICKET_CLICK) return LINE.CULTURE_TICKET;
    if(eventType === EVENT.CULTURE_DONATION_INTENT) return LINE.CULTURE_DONATION;
    if(eventType.indexOf("culture_") === 0) return LINE.SPONSOR_CLICK;
    return null;
  }

  function engineType(eventType, item){
    var line = inferLine(eventType, item);
    if(eventType === EVENT.SEARCH_SUBMIT) return "search";
    if(eventType === EVENT.SEARCH_RESULT_CLICK) return "search";
    if(eventType === EVENT.AD_IMPRESSION) return "ad";
    if(eventType === EVENT.AD_CLICK) return "ad";
    if(line === LINE.PRODUCT_AFFILIATE) return "product";
    if(line === LINE.MEDIA_WATCHTIME || line === LINE.MEDIA_ENGAGEMENT) return "media";
    if(line === LINE.DONATION_INTENT) return "donation";
    if(line === LINE.TOUR_COMMISSION) return "tour";
    if(line && line.indexOf("culture_") === 0) return "culture";
    if([EVENT.LIKE,EVENT.RECOMMEND,EVENT.SHARE,EVENT.SAVE,EVENT.COMMENT_CREATE,EVENT.POST_CREATE,EVENT.REVIEW_CREATE,EVENT.RATING].indexOf(eventType) >= 0){
      return item && item.mediaType ? "media" : "engagement";
    }
    return eventType;
  }

  function metricsFor(eventType, ctx){
    ctx = ctx || {};
    var m = Object.assign({}, ctx.metrics || {});
    if(eventType === EVENT.SEARCH_RESULT_CLICK) m.searchClick = n(m.searchClick,0) + 1;
    if(eventType === EVENT.AD_IMPRESSION) m.adImpression = n(m.adImpression,0) + 1;
    if(eventType === EVENT.AD_CLICK) m.adClick = n(m.adClick,0) + 1;
    if([EVENT.PRODUCT_CLICK, EVENT.AFFILIATE_CLICK, EVENT.SLOT_CLICK, EVENT.TOUR_CLICK, EVENT.TOUR_BOOKING_INTENT].indexOf(eventType) >= 0) m.click = n(m.click,0) + 1;
    if(eventType === EVENT.MEDIA_CLICK) m.click = n(m.click,0) + 1;
    if(eventType === EVENT.MEDIA_IMPRESSION) m.view = n(m.view,0) + 1;
    if(eventType === EVENT.MEDIA_WATCH_TIME) m.watchTimeSec = n(ctx.seconds || ctx.watchTimeSec || m.watchTimeSec,0);
    if(eventType === EVENT.MEDIA_DWELL) m.dwellTimeSec = n(ctx.seconds || ctx.dwellTimeSec || m.dwellTimeSec,0);
    if(eventType === EVENT.SPATIAL_INTERACTION) m.spatialInteraction = n(ctx.count || ctx.spatialInteraction || m.spatialInteraction,0) + 1;
    if(eventType === EVENT.LIKE) m.like = n(m.like,0) + 1;
    if(eventType === EVENT.RECOMMEND) m.recommend = n(m.recommend,0) + 1;
    if(eventType === EVENT.SHARE) m.share = n(m.share,0) + 1;
    if(eventType === EVENT.SAVE) m.save = n(m.save,0) + 1;
    if(eventType === EVENT.COMMENT_CREATE) m.comment = n(m.comment,0) + 1;
    if(eventType === EVENT.POST_CREATE) m.post = n(m.post,0) + 1;
    if(eventType === EVENT.REVIEW_CREATE) m.review = n(m.review,0) + 1;
    if(eventType === EVENT.RATING) m.rating = n(ctx.rating || m.rating,0);
    return m;
  }

  function pointsFor(eventType, ctx){
    var base = n(config.points[eventType],0);
    if(eventType === EVENT.MEDIA_WATCH_TIME || eventType === EVENT.MEDIA_DWELL){
      return Number((base * Math.max(0, n(ctx && (ctx.seconds || ctx.watchTimeSec || ctx.dwellTimeSec),0))).toFixed(6));
    }
    return base;
  }

  function makePayload(eventType, rawItem, ctx){
    ctx = ctx && typeof ctx === "object" ? ctx : {};
    var item = Object.assign({}, compactItem(rawItem), ctx.itemFields || {});
    var revenueLine = ctx.revenueLine || inferLine(eventType, item);
    var pageType = ctx.pageType || item.page || config.pageType || inferPageType();
    var service = ctx.service || config.service || pageType;
    var sourceRef = ctx.sourceRef || item.snapshotRecordId || item.trackId || item.slotId || item.itemId || null;
    var bucket = ctx.bucket || (eventType.indexOf("impression") >= 0 ? "session" : Math.floor(nowMs()/1000));
    var idemBase = [eventType, service, pageType, item.itemId || item.slotId || item.url || "unknown", sourceRef || "", bucket].join("|");
    var idempotencyKey = ctx.idempotencyKey || "idem-" + hash32(idemBase);
    var price = ctx.price != null ? n(ctx.price,0) : n(item.price,0);
    var currency = ctx.currency || item.currency || "USD";

    return {
      action:"track",
      event:{
        event_id:ctx.eventId || rand("evt"),
        idempotency_key:idempotencyKey,
        timestamp:nowIso(),
        type:ctx.engineType || engineType(eventType, item),
        original_type:eventType,
        source:{
          service:service,
          page:pageType,
          section:ctx.section || item.section || null,
          route:ctx.route || location.pathname,
          url:location.href,
          referrer:document.referrer || null,
          source_type:"live_event",
          snapshot_source:item.snapshotSource || ctx.snapshotSource || null,
          snapshot_record_id:item.snapshotRecordId || ctx.snapshotRecordId || null
        },
        user:{
          session_id:ctx.sessionId || sessionId(),
          anon_id:ctx.anonUserId || anonId()
        },
        content:{
          item_id:item.itemId || ctx.eventId || null,
          content_id:item.contentId || null,
          product_id:item.productId || null,
          slot_id:item.slotId || null,
          campaign_id:item.campaignId || null,
          provider_id:item.providerId || null,
          producer_id:item.producerId || null,
          affiliate_id:item.affiliateId || null,
          seller_id:item.sellerId || null,
          psom_key:item.psomKey || null,
          track_id:item.trackId || null,
          category:item.category || revenueLine || eventType,
          item_type:item.itemType || null,
          media_type:item.mediaType || null,
          title:item.title ? s(item.title).slice(0,160) : null,
          url:item.url || null,
          domain:item.domain || null,
          revenue_line:revenueLine,
          text:ctx.text ? textPayload(ctx.text) : undefined
        },
        transaction:{
          price:price,
          gross_amount:ctx.grossAmount != null ? n(ctx.grossAmount,0) : price,
          currency:currency
        },
        metrics:metricsFor(eventType, ctx),
        tracker:{
          version:VERSION,
          points:ctx.points != null ? n(ctx.points,0) : pointsFor(eventType, ctx),
          point_unit:"signal_point",
          status:"estimated_signal",
          settlement_status:"pending",
          source_type:"live_event",
          duplicate_policy:"idempotency_key"
        }
      }
    };
  }

  function enqueue(payload){
    if(!config.enabled) return null;
    state.queue.push(payload);
    if(config.debug) console.log("[MARU RevenueTracker]", payload);
    if(state.queue.length >= config.batchSize) flush();
    else scheduleFlush();
    return payload;
  }

  function track(eventType, item, ctx){ return enqueue(makePayload(eventType, item || {}, ctx || {})); }

  function inferImpressionEvent(item, ctx){
    var compact = Object.assign({}, compactItem(item), ctx || {});
    var line = inferLine("impression", compact);
    var t = low(first(compact.itemType, compact.mediaType, compact.category, compact.page));
    if(line === LINE.DISPLAY_AD) return EVENT.AD_IMPRESSION;
    if(line === LINE.PRODUCT_AFFILIATE || t.indexOf("product") >= 0) return EVENT.PRODUCT_IMPRESSION;
    if(line === LINE.MEDIA_ENGAGEMENT || line === LINE.MEDIA_WATCHTIME) return EVENT.MEDIA_IMPRESSION;
    if(line === LINE.TOUR_COMMISSION) return EVENT.TOUR_IMPRESSION;
    if(t.indexOf("culture") >= 0) return EVENT.CULTURE_ART_IMPRESSION;
    return EVENT.SLOT_IMPRESSION;
  }

  function trackImpression(item, ctx){
    var payload = makePayload((ctx && ctx.eventType) || inferImpressionEvent(item, ctx), item || {}, Object.assign({ bucket:"session" }, ctx || {}));
    var e = payload.event;
    var key = [e.original_type, e.source.service, e.source.page, e.content.item_id || e.content.slot_id || e.content.url, e.content.revenue_line].join("::");
    if(config.impressionOncePerSession && state.seenImpressions[key]) return null;
    state.seenImpressions[key] = true;
    return enqueue(payload);
  }

  function inferClickEvent(item, ctx){
    var compact = Object.assign({}, compactItem(item), ctx || {});
    var line = inferLine("click", compact);
    var t = low(first(compact.itemType, compact.mediaType, compact.category, compact.page));
    if(line === LINE.DISPLAY_AD) return EVENT.AD_CLICK;
    if(line === LINE.PRODUCT_AFFILIATE) return EVENT.AFFILIATE_CLICK;
    if(t.indexOf("product") >= 0 || t.indexOf("commerce") >= 0) return EVENT.PRODUCT_CLICK;
    if(line === LINE.MEDIA_ENGAGEMENT || line === LINE.MEDIA_WATCHTIME) return EVENT.MEDIA_CLICK;
    if(line === LINE.TOUR_COMMISSION) return EVENT.TOUR_CLICK;
    if(line === LINE.DONATION_INTENT) return EVENT.DONATION_CTA_CLICK;
    if(t.indexOf("culture") >= 0) return EVENT.CULTURE_ART_CLICK;
    return EVENT.SEARCH_RESULT_CLICK;
  }

  function trackClick(item, ctx){
    var eventType = (ctx && ctx.eventType) || inferClickEvent(item, ctx);
    var payload = makePayload(eventType, item || {}, ctx || {});
    var e = payload.event;
    var key = [e.original_type, e.content.item_id || e.content.slot_id || e.content.url || e.event_id].join("::");
    var last = state.lastClicks[key] || 0;
    if(nowMs() - last < config.clickThrottleMs) return null;
    state.lastClicks[key] = nowMs();
    return enqueue(payload);
  }

  function trackEngagement(action, item, ctx){
    var map = {
      like:EVENT.LIKE,
      recommend:EVENT.RECOMMEND,
      recommendation:EVENT.RECOMMEND,
      share:EVENT.SHARE,
      save:EVENT.SAVE,
      comment:EVENT.COMMENT_CREATE,
      comment_create:EVENT.COMMENT_CREATE,
      post:EVENT.POST_CREATE,
      post_create:EVENT.POST_CREATE,
      review:EVENT.REVIEW_CREATE,
      review_create:EVENT.REVIEW_CREATE,
      rating:EVENT.RATING
    };
    return track(map[low(action)] || s(action), item || {}, ctx || {});
  }

  function trackDonation(action, ctx){
    var map = { entry:EVENT.DONATION_ENTRY, cta:EVENT.DONATION_CTA_CLICK, click:EVENT.DONATION_CTA_CLICK, modal:EVENT.DONATION_MODAL_OPEN, intent:EVENT.DONATION_INTENT };
    return track(map[low(action)] || EVENT.DONATION_ENTRY, {}, Object.assign({ pageType:"donation", revenueLine:LINE.DONATION_INTENT }, ctx || {}));
  }

  function trackCulture(action, item, ctx){
    var map = { impression:EVENT.CULTURE_ART_IMPRESSION, click:EVENT.CULTURE_ART_CLICK, artist:EVENT.CULTURE_ARTIST_CLICK, event:EVENT.CULTURE_EVENT_CLICK, ticket:EVENT.CULTURE_TICKET_CLICK, sponsor:EVENT.CULTURE_SPONSOR_CLICK, donation:EVENT.CULTURE_DONATION_INTENT };
    return track(map[low(action)] || EVENT.CULTURE_ART_CLICK, item || {}, Object.assign({ pageType:"culture_art" }, ctx || {}));
  }

  function bindMedia(mediaEl, item, ctx){
    if(!mediaEl) return null;
    var base = Object.assign({ pageType:"media" }, ctx || {});
    var session = { lastTime:0, accumulated:0, reported:0, completed:false };
    state.mediaSessions.set(mediaEl, session);

    function report(force){
      var cur = n(mediaEl.currentTime,0);
      if(session.lastTime && cur > session.lastTime) session.accumulated += cur - session.lastTime;
      session.lastTime = cur;
      var delta = session.accumulated - session.reported;
      if(force || delta >= 10){
        var seconds = Math.max(0, Math.round(delta));
        if(seconds > 0){
          session.reported = session.accumulated;
          track(EVENT.MEDIA_WATCH_TIME, item || {}, Object.assign({}, base, { seconds:seconds, watchTimeSec:seconds }));
        }
      }
    }

    mediaEl.addEventListener("play", function(){
      session.lastTime = n(mediaEl.currentTime,0);
      track(EVENT.MEDIA_CLICK, item || {}, base);
    }, { passive:true });
    mediaEl.addEventListener("timeupdate", function(){ report(false); }, { passive:true });
    mediaEl.addEventListener("pause", function(){ report(true); }, { passive:true });
    mediaEl.addEventListener("ended", function(){
      report(true);
      if(!session.completed){
        session.completed = true;
        track(EVENT.MEDIA_COMPLETE, item || {}, base);
      }
    }, { passive:true });
    return session;
  }

  function bindContainer(container, options){
    var root = typeof container === "string" ? document.querySelector(container) : container;
    if(!root) return false;
    var base = options || {};

    root.addEventListener("click", function(ev){
      var target = ev.target && ev.target.closest && ev.target.closest("[data-maru-revenue], [data-revenue-line], [data-track-id], [data-item-id], a, button");
      if(!target || !root.contains(target)) return;
      var item = itemFromElement(target);
      if(!item.id && !item.url && !item.title && !item.trackId) return;
      trackClick(item, base);
    }, true);

    if("IntersectionObserver" in global){
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(!entry.isIntersecting) return;
          var el = entry.target;
          var item = itemFromElement(el);
          if(item.id || item.url || item.title || item.trackId) trackImpression(item, base);
          io.unobserve(el);
        });
      }, { threshold:0.35 });

      root.querySelectorAll("[data-maru-revenue], [data-revenue-line], [data-track-id], [data-item-id], .card, article").forEach(function(el){ io.observe(el); });
      root.__maruRevenueObserver = io;
    }
    return true;
  }

  function bindSearch(inputSelector, resultContainerSelector, options){
    options = options || {};
    var input = document.querySelector(inputSelector || "#searchInput");
    var btn = document.querySelector(options.buttonSelector || "#searchBtn");
    var resultRoot = document.querySelector(resultContainerSelector || "#searchResults");

    function ctx(){
      return {
        pageType:"search",
        service:"search.js",
        text:input ? input.value || "" : "",
        queryLength:input ? s(input.value || "").length : 0,
        revenueLine:LINE.SEARCH_CLICK
      };
    }

    if(btn && input) btn.addEventListener("click", function(){ track(EVENT.SEARCH_SUBMIT, {}, ctx()); }, true);
    if(input) input.addEventListener("keydown", function(e){ if(e.key === "Enter") track(EVENT.SEARCH_SUBMIT, {}, ctx()); }, true);
    if(resultRoot) bindContainer(resultRoot, Object.assign({ pageType:"search", service:"search.js" }, options));
    return true;
  }

  function saveQueue(){ try { localStorage.setItem(config.queueKey, JSON.stringify(state.queue.slice(-250))); } catch(e){} }
  function loadQueue(){
    try{
      var q = JSON.parse(localStorage.getItem(config.queueKey) || "[]");
      if(Array.isArray(q) && q.length) state.queue = q.concat(state.queue).slice(-250);
      localStorage.removeItem(config.queueKey);
    }catch(e){}
  }
  function beacon(url, body){
    try{
      if(!navigator.sendBeacon) return false;
      return navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type:"application/json" }));
    }catch(e){ return false; }
  }
  function post(url, body){
    return fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(body), keepalive:true, credentials:"same-origin" })
      .then(function(res){ return !!(res && res.ok); })
      .catch(function(){ return false; });
  }

  async function sendBatch(batch){
    if(!batch.length) return true;

    var bridgeBody = {
      action:"track_batch",
      tracker:VERSION,
      batch:true,
      events:batch.map(function(x){ return x.event || x; })
    };

    if(beacon(config.endpoints[0], bridgeBody)) return true;
    if(await post(config.endpoints[0], bridgeBody)) return true;

    for(var i=0;i<batch.length;i++){
      var single = { action:"track", tracker:VERSION, event:batch[i].event || batch[i] };
      var ok = false;
      for(var j=1;j<config.endpoints.length;j++){
        if(beacon(config.endpoints[j], single) || await post(config.endpoints[j], single)){
          ok = true;
          break;
        }
      }
      if(!ok) return false;
    }
    return true;
  }

  async function flush(){
    if(!config.enabled || state.inFlight || !state.queue.length) return false;
    state.inFlight = true;
    var batch = state.queue.splice(0, Math.max(1, config.batchSize));
    try{
      var ok = await sendBatch(batch);
      if(!ok) state.queue = batch.concat(state.queue).slice(-250);
      saveQueue();
      return ok;
    }finally{
      state.inFlight = false;
    }
  }

  function scheduleFlush(){
    if(state.timer) return;
    state.timer = setTimeout(function(){ state.timer = null; flush(); }, Math.max(500, config.flushIntervalMs));
  }

  function configure(next){
    next = next || {};
    if(Array.isArray(next.endpoints) && next.endpoints.length) config.endpoints = next.endpoints.slice();
    if(next.points && typeof next.points === "object") config.points = Object.assign({}, config.points, next.points);
    Object.keys(next).forEach(function(k){
      if(k !== "points" && k !== "endpoints") config[k] = next[k];
    });
    return api;
  }

  function install(options){
    configure(options || {});
    if(state.installed) return api;
    state.installed = true;
    loadQueue();

    global.addEventListener("beforeunload", function(){
      if(state.queue.length){
        var batch = state.queue.splice(0, config.batchSize);
        sendBatch(batch);
        saveQueue();
      }
    });
    document.addEventListener("visibilitychange", function(){
      if(document.visibilityState === "hidden" && state.queue.length){
        var batch = state.queue.splice(0, config.batchSize);
        sendBatch(batch);
        saveQueue();
      }
    });
    scheduleFlush();
    return api;
  }

  var api = {
    VERSION:VERSION,
    EVENT:EVENT,
    REVENUE_LINE:LINE,
    DEFAULT_POINTS:POINTS,
    install:install,
    config:configure,
    track:track,
    flush:flush,
    trackImpression:trackImpression,
    trackClick:trackClick,
    trackEngagement:trackEngagement,
    trackDonation:trackDonation,
    trackCulture:trackCulture,
    bindMedia:bindMedia,
    bindContainer:bindContainer,
    bindSearch:bindSearch,
    _state:state
  };

  global.MaruRevenueTracker = global.MaruRevenueTracker || api;
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){ api.install(); }, { once:true });
  }else{
    api.install();
  }
})(window);
