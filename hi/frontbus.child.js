(function(global){
  'use strict';
  var api = global.FrontBusChild || {};
  api.post = api.post || function(type, payload){ try{ parent.postMessage({ source:'igdc-frontbus-child', type:type, payload:payload || null }, '*'); }catch(e){} };
  api.ready = api.ready || function(){ api.post('ready', { href: location.href }); };
  global.FrontBusChild = api;
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.ready); else api.ready();
})(window);

(function loadIGDCQnaStorageBridge(){
  if (window.__IGDC_QA_STORAGE_BRIDGE_LOADER_V2__) return;
  window.__IGDC_QA_STORAGE_BRIDGE_LOADER_V2__ = true;
  var id = 'igdc-qna-storage-bridge';
  if (document.getElementById(id)) return;
  var script = document.createElement('script');
  script.id = id;
  script.src = '/assets/js/igdc-qna-storage-bridge.js?v=20260629qa4-final8';
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
})();

(function loadIGDCEngagementStorageBridge(){
  if (window.__IGDC_ENGAGEMENT_STORAGE_BRIDGE_LOADER_V1__) return;
  window.__IGDC_ENGAGEMENT_STORAGE_BRIDGE_LOADER_V1__ = true;
  var id = 'igdc-engagement-storage-bridge';
  if (document.getElementById(id)) return;
  var script = document.createElement('script');
  script.id = id;
  script.src = '/assets/js/igdc-engagement-storage-bridge.js?v=20260629eng1-final8';
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
})();
/* Q&A header-anchor position bridge: geometry only; no modal/event/storage changes. */
(function installIGDCQnaHeaderAnchor(){
  'use strict';
  if (window.__IGDC_QNA_HEADER_ANCHOR_CSS_V1__) return;
  window.__IGDC_QNA_HEADER_ANCHOR_CSS_V1__ = true;
  var id = 'igdc-qna-header-anchor-bridge-style';
  if (document.getElementById(id)) return;
  var style = document.createElement('style');
  style.id = id;
  style.textContent = ''
    + '.igdc-qa-modal .igdc-qa-panel,.igdc-qa-panel{top:16px !important;bottom:auto !important;}'
    + '@media (max-width:900px){.igdc-qa-modal .igdc-qa-panel,.igdc-qa-panel{top:12px !important;bottom:auto !important;left:12px !important;right:auto !important;width:min(92vw,560px) !important;}}';
  (document.head || document.documentElement).appendChild(style);
})();

(function loadIGDCContainedExternalViewer(){
  if (window.__IGDC_CONTAINED_EXTERNAL_VIEWER_LOADER_V1__) return;
  window.__IGDC_CONTAINED_EXTERNAL_VIEWER_LOADER_V1__ = true;
  var id = 'igdc-contained-external-viewer-script';
  if (document.getElementById(id)) return;
  var script = document.createElement('script');
  script.id = id;
  script.src = '/assets/js/igdc-contained-external-viewer.js?v=20260908-contained-v2';
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
})();
