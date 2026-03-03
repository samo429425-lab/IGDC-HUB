
// socialnetwork-automap.PRODUCTION.js
(function(){

if(window.__SOCIAL_AUTOMAP_PROD__) return;
window.__SOCIAL_AUTOMAP_PROD__ = true;

const SNAPSHOT_URL = "/data/social.snapshot.json";
const MAIN_LIMIT = 100;
const RIGHT_LIMIT = 100;

const MAIN_KEYS = [
  "sns-instagram",
  "sns-tiktok",
  "sns-facebook",
  "sns-youtube",
  "sns-twitter",
  "sns-linkedin",
  "sns-pinterest",
  "sns-etc1",
  "sns-etc2"
];

function resolveSections(snapshot){
  if(snapshot?.pages?.social?.sections) return snapshot.pages.social.sections;
  if(snapshot?.pages?.socialnetwork?.sections) return snapshot.pages.socialnetwork.sections;
  if(snapshot?.sections) return snapshot.sections;
  return {};
}

function resolveList(section){
  if(Array.isArray(section)) return section;
  if(Array.isArray(section?.items)) return section.items;
  if(Array.isArray(section?.slots)) return section.slots;
  if(Array.isArray(section?.list)) return section.list;
  return [];
}

function createCard(item, simple){
  const el = document.createElement("div");
  el.className = "thumb-card";
  el.innerHTML =
    '<div class="thumb-img" style="background-image:url(\'' + (item.thumb||"") + '\')"></div>' +
    '<div class="thumb-title">' + (item.title||"") + '</div>' +
    (simple ? '' : '<div class="thumb-meta">' + (item.meta||"") + '</div>');
  if(item.url){
    el.style.cursor="pointer";
    el.onclick=function(){location.href=item.url;};
  }
  return el;
}

function renderMain(sections){
  MAIN_KEYS.forEach(function(key){
    const container = document.querySelector('[data-psom-key="'+key+'"]');
    if(!container) return;
    container.innerHTML="";
    const list = resolveList(sections[key]);
    list.slice(0, MAIN_LIMIT).forEach(function(item){
      container.appendChild(createCard(item,false));
    });
  });
}

function renderRight(sections){
  const target = document.querySelector('[data-psom-key="socialnetwork"]');
  if(!target) return;
  target.innerHTML="";
  const list = resolveList(sections["socialnetwork"]);
  list.slice(0, RIGHT_LIMIT).forEach(function(item){
    target.appendChild(createCard(item,true));
  });
}

async function init(){
  try{
    const res = await fetch(SNAPSHOT_URL,{cache:"no-store"});
    if(!res.ok) return;
    const snapshot = await res.json();
    const sections = resolveSections(snapshot);
    window.__SOCIAL_SECTIONS__ = sections;
    renderMain(sections);
    renderRight(sections);
  }catch(e){
    console.error("SOCIAL PROD ERROR:", e);
  }
}

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("resize", function(){
  if(window.__SOCIAL_SECTIONS__){
    renderRight(window.__SOCIAL_SECTIONS__);
  }
});

})();