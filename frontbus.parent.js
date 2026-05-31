(function(global){
  'use strict';
  var api = global.FrontBusParent || {};
  api.handlers = api.handlers || [];
  api.on = api.on || function(fn){ if(typeof fn === 'function') api.handlers.push(fn); };
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if(!data || data.source !== 'igdc-frontbus-child') return;
    api.handlers.forEach(function(fn){ try{ fn(data, ev); }catch(e){} });
  });
  global.FrontBusParent = api;
})(window);
