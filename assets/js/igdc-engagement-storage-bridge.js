/*
 * IGDC server engagement bridge
 * --------------------------------------------------------------------------
 * One browser-local anonymous token identifies a viewer only for toggle state.
 * Counts and review/reaction events are read from the server, so they survive
 * reloads and appear on other users' screens. This module never handles PG,
 * payment, order, seller, inventory, or settlement data.
 */
(function(global){
  'use strict';
  if(global.__IGDC_ENGAGEMENT_STORAGE_BRIDGE_V1__) return;
  global.__IGDC_ENGAGEMENT_STORAGE_BRIDGE_V1__ = true;

  var ENDPOINT = '/api/feedback';
  var VIEWER_KEY = '__IGDC_ENGAGEMENT_VIEWER_V1__';

  function text(v){ return v == null ? '' : String(v); }
  function clean(v, max){ return text(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 240); }
  function randomToken(){
    try{
      if(global.crypto && global.crypto.getRandomValues){
        var bytes = new Uint8Array(16); global.crypto.getRandomValues(bytes);
        return Array.prototype.map.call(bytes, function(b){ return b.toString(16).padStart(2, '0'); }).join('');
      }
    }catch(_){}
    return String(Date.now().toString(36)) + Math.random().toString(36).slice(2, 18);
  }
  function viewerId(){
    try{
      var value = clean(global.localStorage && global.localStorage.getItem(VIEWER_KEY), 120);
      if(value) return value;
      value = 'v-' + randomToken();
      global.localStorage && global.localStorage.setItem(VIEWER_KEY, value);
      return value;
    }catch(_){ return 'v-' + randomToken(); }
  }
  function parse(res){
    return res.text().then(function(raw){
      var data = {};
      try{ data = raw ? JSON.parse(raw) : {}; }catch(_){ data = { ok:false, error:raw || ('HTTP ' + res.status) }; }
      if(!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    });
  }
  function request(url, init){ return global.fetch(url, init).then(parse); }
  function emit(detail){
    try{ global.document.dispatchEvent(new CustomEvent('igdc:engagement:updated', { detail:detail || null })); }catch(_){}
  }
  function summary(itemId){
    itemId = clean(itemId, 240);
    if(!itemId) return Promise.reject(new Error('Missing item id'));
    var query = '?action=summary&id=' + encodeURIComponent(itemId) + '&viewer_id=' + encodeURIComponent(viewerId());
    return request(ENDPOINT + query, { method:'GET', credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json' } })
      .then(function(payload){ return payload.summary || {}; });
  }
  function toggle(itemId, type, enabled){
    itemId = clean(itemId, 240);
    type = clean(type, 40).toLowerCase();
    if(!itemId) return Promise.reject(new Error('Missing item id'));
    if(type !== 'like' && type !== 'recommend') return Promise.reject(new Error('Unsupported engagement type'));
    var body = {
      id:itemId,
      type:type,
      state:enabled === false ? 'off' : 'on',
      viewer_id:viewerId(),
      page:(global.location && global.location.pathname) || '/',
      source:'igdc-engagement-storage-bridge'
    };
    return request(ENDPOINT, { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify(body) })
      .then(function(payload){
        var result = payload.summary || {};
        emit({ item_id:itemId, type:type, state:body.state === 'on', summary:result });
        return result;
      });
  }
  function recordView(itemId){
    itemId = clean(itemId, 240);
    if(!itemId) return Promise.resolve(null);
    return request(ENDPOINT, {
      method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json', Accept:'application/json' },
      body:JSON.stringify({ id:itemId, type:'view', viewer_id:viewerId(), page:(global.location && global.location.pathname) || '/', source:'igdc-engagement-storage-bridge' })
    }).then(function(payload){
      var result = payload.summary || {};
      emit({ item_id:itemId, type:'view', state:true, summary:result });
      return result;
    });
  }

  global.IGDCEngagement = global.IGDCEngagement || {};
  global.IGDCEngagement.viewerId = viewerId;
  global.IGDCEngagement.summary = summary;
  global.IGDCEngagement.toggle = toggle;
  global.IGDCEngagement.recordView = recordView;
})(window);
