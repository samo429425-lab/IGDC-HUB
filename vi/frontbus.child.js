(function(global){
  'use strict';
  var api = global.FrontBusChild || {};
  api.post = api.post || function(type, payload){ try{ parent.postMessage({ source:'igdc-frontbus-child', type:type, payload:payload || null }, '*'); }catch(e){} };
  api.ready = api.ready || function(){ api.post('ready', { href: location.href }); };
  global.FrontBusChild = api;
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.ready); else api.ready();
})(window);
