/*
 * Donation topic-panel engagement adapter
 * Keeps the existing article/editor UI intact while replacing only the
 * local-only reaction counters with the server-backed engagement bridge.
 */
(function(global, doc){
  'use strict';
  if(global.__IGDC_DONATION_ENGAGEMENT_V1__) return;
  global.__IGDC_DONATION_ENGAGEMENT_V1__ = true;

  var SELECTOR = '.right .topic-panel .list .item, .mobile-news-clone .topic-panel .list .item';
  var hydrated = new WeakSet();
  var viewSent = new Set();

  function text(v){ return v == null ? '' : String(v); }
  function idFor(item){
    if(!item) return '';
    if(item.dataset && item.dataset.igdcEngagementId) return item.dataset.igdcEngagementId;
    var title = text((item.querySelector('.h-title') || item.querySelector('.title') || {}).textContent).trim();
    var meta = text((item.querySelector('.h-time') || item.querySelector('.meta') || {}).textContent).trim();
    var key = (title + '|' + meta).toLowerCase();
    var h = 0;
    for(var i = 0; i < key.length; i += 1){ h = ((h << 5) - h) + key.charCodeAt(i); h |= 0; }
    var id = 'news:' + h;
    try{ item.dataset.igdcEngagementId = id; }catch(_){}
    return id;
  }
  function count(node, value){ if(node) node.textContent = String(Math.max(0, Number(value) || 0)); }
  function apply(item, summary){
    if(!item || !summary) return;
    var counts = summary.counts || summary.totals || {};
    var viewer = summary.viewer || {};
    count(item.querySelector('.stat-views .n'), counts.views != null ? counts.views : counts.view);
    count(item.querySelector('.action-reco .n'), counts.recommendations != null ? counts.recommendations : counts.recommend);
    count(item.querySelector('.action-like .n'), counts.likes != null ? counts.likes : counts.like);
    var reco = item.querySelector('.action-reco');
    var like = item.querySelector('.action-like');
    if(reco){ reco.classList.toggle('active', !!viewer.recommended); reco.setAttribute('aria-pressed', viewer.recommended ? 'true' : 'false'); }
    if(like){ like.classList.toggle('active', !!viewer.liked); like.setAttribute('aria-pressed', viewer.liked ? 'true' : 'false'); }
  }
  function hydrate(item){
    if(!item || !global.IGDCEngagement || typeof global.IGDCEngagement.summary !== 'function') return;
    var id = idFor(item);
    if(!id) return;
    hydrated.add(item);
    global.IGDCEngagement.summary(id).then(function(summary){ apply(item, summary); }).catch(function(){});
  }
  function hydrateAll(root){
    var scope = root && root.querySelectorAll ? root : doc;
    Array.prototype.forEach.call(scope.querySelectorAll ? scope.querySelectorAll(SELECTOR) : [], hydrate);
  }
  function itemFor(target){ return target && target.closest ? target.closest(SELECTOR) : null; }
  function enabledFor(target){ return !target.classList.contains('active'); }

  // Register in capture phase before the legacy localStorage handlers.
  doc.addEventListener('click', function(event){
    var action = event.target && event.target.closest ? event.target.closest('.action-reco, .action-like') : null;
    if(action){
      var item = itemFor(action);
      if(!item || !global.IGDCEngagement || typeof global.IGDCEngagement.toggle !== 'function') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(action.dataset.igdcEngagementBusy === '1') return;
      action.dataset.igdcEngagementBusy = '1';
      var type = action.classList.contains('action-reco') ? 'recommend' : 'like';
      var id = idFor(item);
      var next = enabledFor(action);
      global.IGDCEngagement.toggle(id, type, next).then(function(summary){ apply(item, summary); }).catch(function(){}).finally(function(){
        delete action.dataset.igdcEngagementBusy;
      });
      return;
    }

    var clicked = itemFor(event.target);
    if(!clicked || !global.IGDCEngagement || typeof global.IGDCEngagement.recordView !== 'function') return;
    if(event.target.closest && event.target.closest('.delete-post, .btn-edit, button, a, input, textarea, select, label')) return;
    var itemId = idFor(clicked);
    if(!itemId || viewSent.has(itemId)) return;
    viewSent.add(itemId);
    global.IGDCEngagement.recordView(itemId).then(function(summary){ apply(clicked, summary); }).catch(function(){});
  }, true);

  function start(){
    global.setTimeout(function(){ hydrateAll(doc); }, 0);
    try{
      var observer = new MutationObserver(function(records){
        records.forEach(function(record){
          Array.prototype.forEach.call(record.addedNodes || [], function(node){
            if(!node || node.nodeType !== 1) return;
            if(node.matches && node.matches(SELECTOR)) hydrate(node);
            hydrateAll(node);
          });
        });
      });
      observer.observe(doc.documentElement || doc.body, { childList:true, subtree:true });
    }catch(_){}
  }
  if(doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once:true }); else start();
})(window, document);
