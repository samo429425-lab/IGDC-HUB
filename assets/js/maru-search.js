(function(global){
  'use strict';
  var ENDPOINT = '/.netlify/functions/maru-search';
  function params(obj){
    var sp = new URLSearchParams();
    Object.keys(obj || {}).forEach(function(k){
      var v = obj[k];
      if(v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    return sp.toString();
  }
  async function search(q, options){
    var opts = Object.assign({}, options || {}, { q:q || (options && options.query) || '' });
    var url = ENDPOINT + '?' + params(opts);
    var r = await fetch(url, { cache:'no-store' });
    if(!r.ok) throw new Error('Maru Search failed: ' + r.status);
    return await r.json();
  }
  function warm(q, options){
    return search(q || '', Object.assign({ action:'resident-boot', naturalFlow:1 }, options || {})).catch(function(){ return null; });
  }
  global.MaruSearchClient = global.MaruSearchClient || { endpoint:ENDPOINT, search:search, warm:warm };
  global.MaruSearch = global.MaruSearch || global.MaruSearchClient;
})(window);
