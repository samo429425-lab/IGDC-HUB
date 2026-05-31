(function(global){
  'use strict';
  var ENDPOINT = '/.netlify/functions/maru-searchbank-sync';
  function qs(obj){
    var sp = new URLSearchParams();
    Object.keys(obj || {}).forEach(function(k){ var v=obj[k]; if(v!==undefined && v!==null && v!=='') sp.set(k,String(v)); });
    return sp.toString();
  }
  async function sync(options){
    var url = ENDPOINT + '?' + qs(options || {});
    var r = await fetch(url, { cache:'no-store' });
    if(!r.ok) return { status:'error', code:r.status, items:[] };
    return await r.json();
  }
  global.MaruSearchBankSync = global.MaruSearchBankSync || { endpoint:ENDPOINT, sync:sync };
})(window);
