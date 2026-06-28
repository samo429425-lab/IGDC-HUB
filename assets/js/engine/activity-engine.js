/*
 * ActivityEngine — shared content-template reaction adapter.
 * Like/recommend actions are sent to the existing /api/feedback route.
 * They are non-cash engagement signals only; no payment or settlement is executed.
 */
(function(global){
  'use strict';
  var ENDPOINT = '/api/feedback';
  var PREFIX = '__IGDC_FEEDBACK_DONE__:';

  function text(v){ return v == null ? '' : String(v); }
  function clean(v, max){ return text(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 240); }
  function key(type, id){ return PREFIX + type + ':' + id; }
  function remembered(type, id){
    try { return global.localStorage && global.localStorage.getItem(key(type, id)) === '1'; }
    catch(_) { return false; }
  }
  function remember(type, id){
    try { if(global.localStorage) global.localStorage.setItem(key(type, id), '1'); }
    catch(_) {}
  }
  function post(type, id){
    id = clean(id, 240);
    if(!id) return Promise.resolve({ ok:false, error:'Missing item id' });
    if(remembered(type, id)) return Promise.resolve({ ok:true, status:'already_recorded', item_id:id, type:type });

    return global.fetch(ENDPOINT, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
      credentials:'same-origin',
      body:JSON.stringify({
        id:id,
        type:type,
        page:(global.location && global.location.pathname) || '/',
        source:'activity-engine'
      })
    }).then(function(res){
      return res.text().then(function(raw){
        var payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch(_) { payload = { ok:false, error:raw || ('HTTP ' + res.status) }; }
        if(!res.ok || !payload.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        remember(type, id);
        return payload;
      });
    });
  }

  var api = global.ActivityEngine || {};
  api.recordView = api.recordView || function(id){
    try { global.console && global.console.debug && global.console.debug('view', id); } catch(_) {}
  };
  api.like = function(id){ return post('like', id); };
  api.recommend = function(id){ return post('recommend', id); };
  global.ActivityEngine = api;
})(window);
