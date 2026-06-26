(function(global){
  'use strict';
  var api = global.FrontBusChild || {};
  api.post = api.post || function(type, payload){ try{ parent.postMessage({ source:'igdc-frontbus-child', type:type, payload:payload || null }, '*'); }catch(e){} };
  api.ready = api.ready || function(){ api.post('ready', { href: location.href }); };
  global.FrontBusChild = api;
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.ready); else api.ready();
})(window);
(function loadIGDCQnaStorageBridge(){
  if (window.__IGDC_QA_STORAGE_BRIDGE_LOADER_V1__) return;
  window.__IGDC_QA_STORAGE_BRIDGE_LOADER_V1__ = true;
  var id = 'igdc-qna-storage-bridge';
  if (document.getElementById(id)) return;
  var script = document.createElement('script');
  script.id = id;
  script.src = '/assets/js/igdc-qna-storage-bridge.js?v=20260626qa1';
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
})();
