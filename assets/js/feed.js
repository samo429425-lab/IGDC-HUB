(function(global){
  'use strict';
  async function load(url){
    try{ var r = await fetch(url, { cache:'no-store' }); return r.ok ? await r.json() : null; }catch(e){ return null; }
  }
  global.MaruFeed = global.MaruFeed || { load:load };
})(window);
