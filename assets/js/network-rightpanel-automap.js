/**
 * network-rightpanel-automap.v3.js (NETWORK CANON)
 *
 * Rule:
 * - Use feed?page=network
 * - Bind only: right-network-100
 * - NEVER clear if no data
 * - Desktop / Mobile unified
 */

(function(){

  "use strict";

  if(window.__NETWORK_AUTOMAP_V3__) return;
  window.__NETWORK_AUTOMAP_V3__ = true;

  const FEED_URL = "/.netlify/functions/feed?page=network";
  const KEY = "right-network-100";


  function qs(sel,root){
    return (root||document).querySelector(sel);
  }

  function createCard(it){

    const a = document.createElement("a");
    a.className = "ad-box";
    a.href = it.url || "#";
    a.target = "_blank";
    a.rel = "noopener";

    const img = document.createElement("img");
    img.src = it.thumb || "";
    img.alt = it.title || "";
    img.loading = "lazy";
    img.decoding = "async";

    a.appendChild(img);

    return a;
  }


  async function loadFeed(){

    try{

      const r = await fetch(FEED_URL,{ cache:"no-store" });
      if(!r.ok) return null;

      return await r.json();

    }catch(e){
      return null;
    }
  }


  async function run(){

    // find psom target
    const list = qs('[data-psom-key="right-network-100"]');
    if(!list) return;

    const data = await loadFeed();
    if(!data || !Array.isArray(data.sections)) return;

    const sec = data.sections.find(s=>s.id===KEY);
    const items = sec?.items || [];

    // IMPORTANT: keep dummy if no data
    if(!items.length) return;

    // replace only if valid
    const buf = [];

    for(const it of items){
      if(it && it.url && it.thumb){
        buf.push(createCard(it));
      }
    }

    if(!buf.length) return;

    // safe replace
    list.innerHTML = "";

    const frag = document.createDocumentFragment();
    buf.forEach(n=>frag.appendChild(n));
    list.appendChild(frag);

  }


  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",run,{ once:true });
  }else{
    run();
  }

})();
