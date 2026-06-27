/*
 * MARU Revenue AutoHook — non-cash front signal bridge.
 *
 * This file turns existing, explicitly marked automap cards into click and
 * impression signals for MaruRevenueTracker. It does not create a payment,
 * estimate cash, or change a card destination.
 */
(function(global){
  "use strict";
  if(global.MaruRevenueAutoHook) return;

  var MARKER = [
    "[data-maru-revenue]",
    "[data-affiliate-outbound]",
    "[data-igdc-content-id]",
    "[data-product-id]",
    "[data-item-id]",
    "[data-track-id]",
    "[data-revenue-line]"
  ].join(",");

  var installed = false;
  var observer = null;
  var mutation = null;
  var observed = new WeakSet();

  function text(v){ return v == null ? "" : String(v).trim(); }
  function bool(v){ return !!text(v) && !["0","false","no","off","disabled"].includes(text(v).toLowerCase()); }
  function bad(el){
    if(!el) return true;
    if(el.closest && el.closest("[data-igdc-disabled], [aria-disabled=\"true\"], [data-placeholder], [data-dummy], [data-igdc-revenue-manual]") ) return true;
    return false;
  }
  function closestMarked(node){
    if(!node || !node.closest) return null;
    return node.closest(MARKER);
  }
  function dataset(el, key){ return el && el.dataset ? text(el.dataset[key]) : ""; }
  function attr(el, name){ return el ? text(el.getAttribute(name)) : ""; }
  function pageType(){
    var p = text(location.pathname).toLowerCase();
    if(p.indexOf("distribution") >= 0) return "distribution";
    if(p.indexOf("tour") >= 0) return "tour";
    if(p.indexOf("media") >= 0) return "media";
    if(p.indexOf("network") >= 0) return "networkhub";
    if(p.indexOf("social") >= 0) return "social";
    if(p.indexOf("donation") >= 0) return "donation";
    if(p.indexOf("search") >= 0) return "search";
    return "front";
  }
  function itemFrom(el){
    var anchor = el && el.closest ? el.closest("a,button") : null;
    var href = text(dataset(el,"url") || dataset(el,"productUrl") || dataset(el,"productLink") || dataset(el,"externalUrl") || (anchor && anchor.getAttribute("href")) || attr(el,"href"));
    var affiliate = bool(dataset(el,"affiliateOutbound")) || /\/\.netlify\/functions\/affiliate-outbound\b/.test(href);
    var id = text(
      dataset(el,"itemId") || dataset(el,"productId") || dataset(el,"igdcContentId") ||
      dataset(el,"contentId") || dataset(el,"trackId") || attr(el,"data-item-id") || attr(el,"data-product-id")
    );
    var title = text(dataset(el,"title") || dataset(el,"productTitle") || attr(el,"aria-label") || (anchor && anchor.textContent) || el.textContent).slice(0,160);
    var line = text(dataset(el,"revenueLine") || (affiliate ? "product_affiliate" : ""));
    return {
      id:id || null,
      itemId:id || null,
      productId:text(dataset(el,"productId")) || null,
      contentId:text(dataset(el,"igdcContentId") || dataset(el,"contentId")) || null,
      trackId:text(dataset(el,"trackId")) || null,
      title:title || null,
      url:href || null,
      page:pageType(),
      section:text(dataset(el,"section") || dataset(el,"psomKey")) || null,
      revenueLine:line || null,
      affiliateId: affiliate ? text(dataset(el,"affiliateProvider") || "approved_affiliate") : null,
      itemType: affiliate ? "product" : text(dataset(el,"itemType")) || null
    };
  }
  function context(el, extra){
    var href = text(dataset(el,"url") || dataset(el,"productUrl") || dataset(el,"productLink") || attr(el,"href"));
    var affiliate = bool(dataset(el,"affiliateOutbound")) || /\/\.netlify\/functions\/affiliate-outbound\b/.test(href);
    return Object.assign({
      service:"maru-revenue-autohook",
      pageType:pageType(),
      revenueLine: affiliate ? "product_affiliate" : (text(dataset(el,"revenueLine")) || ""),
      affiliate:affiliate,
      // This marker is deliberately non-cash; provider confirmation/settlement
      // remains the only way to create a confirmed ledger row.
      sourceType:"front_signal"
    }, extra || {});
  }
  function trackClick(el){
    var tracker = global.MaruRevenueTracker;
    if(!tracker || typeof tracker.trackClick !== "function" || bad(el)) return;
    var item = itemFrom(el);
    if(!item.itemId && !item.url && !item.trackId) return;
    tracker.trackClick(item, context(el));
  }
  function trackImpression(el){
    var tracker = global.MaruRevenueTracker;
    if(!tracker || typeof tracker.trackImpression !== "function" || bad(el)) return;
    var item = itemFrom(el);
    if(!item.itemId && !item.url && !item.trackId) return;
    tracker.trackImpression(item, context(el));
  }
  function observe(el){
    if(!observer || !el || observed.has(el) || bad(el)) return;
    observed.add(el);
    observer.observe(el);
  }
  function scan(root){
    var host = root && root.querySelectorAll ? root : document;
    if(root && root.matches && root.matches(MARKER)) observe(root);
    host.querySelectorAll(MARKER).forEach(observe);
  }
  function install(options){
    var tracker = global.MaruRevenueTracker;
    if(!tracker || typeof tracker.install !== "function") return false;
    tracker.install(options || {});

    if(!installed){
      installed = true;
      document.addEventListener("click", function(event){
        var el = closestMarked(event.target);
        if(el) trackClick(el);
      }, true);

      if("IntersectionObserver" in global){
        observer = new IntersectionObserver(function(entries){
          entries.forEach(function(entry){
            if(!entry.isIntersecting) return;
            trackImpression(entry.target);
            observer.unobserve(entry.target);
          });
        }, { threshold:0.35 });
      }

      if("MutationObserver" in global){
        mutation = new MutationObserver(function(records){
          records.forEach(function(record){
            record.addedNodes.forEach(function(node){
              if(node && node.nodeType === 1) scan(node);
            });
          });
        });
        mutation.observe(document.documentElement || document.body, { childList:true, subtree:true });
      }
    }
    scan(document);
    return true;
  }

  global.MaruRevenueAutoHook = { VERSION:"maru-revenue-autohook-v1.0.0", install:install, scan:scan };
})(window);
