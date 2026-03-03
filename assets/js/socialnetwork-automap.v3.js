
// socialnetwork-automap.DISTRIBUTION-STANDARD.js
// Long-term production architecture
// Structure:
//  - social.snapshot.json  → Main 9 SNS sections
//  - distribution.snapshot.json → Right panel products

(function(){

if(window.__SOCIAL_AUTOMAP_DISTRIBUTION_STD__) return;
window.__SOCIAL_AUTOMAP_DISTRIBUTION_STD__ = true;

const SOCIAL_SNAPSHOT = "/data/social.snapshot.json";
const DISTRIBUTION_SNAPSHOT = "/data/distribution.snapshot.json";

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

const RIGHT_KEY = "distribution-right";

const MAIN_LIMIT = 100;
const RIGHT_LIMIT = 100;

let HAS_RENDERED = false;

function resolveSections(snapshot){
  if(snapshot?.pages?.social?.sections) return snapshot.pages.social.sections;
  if(snapshot?.sections) return snapshot.sections;
  return {};
}

function resolveDistributionSections(snapshot){
  if(snapshot?.pages?.distribution?.sections) return snapshot.pages.distribution.sections;
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

function pick(item, keys){
  for(const k of keys){
    if(item && typeof item[k]==="string" && item[k].trim()) return item[k].trim();
  }
  return "";
}

function createCard(item){
  const el = document.createElement("div");
  el.className = "thumb-card";

  const img = document.createElement("div");
  img.className = "thumb-img";
  const src = pick(item,["thumb","image","thumbnail","img","photo"]);
  if(src){
    img.style.backgroundImage = "url('"+src.replace(/'/g,"%27")+"')";
    img.style.backgroundSize = "cover";
    img.style.backgroundPosition = "center";
  }

  const title = document.createElement("div");
  title.className = "thumb-title";
  title.textContent = pick(item,["title","name","label"]) || "Item";

  el.appendChild(img);
  el.appendChild(title);

  const url = pick(item,["url","href","link"]);
  if(url){
    el.style.cursor="pointer";
    el.onclick=function(){location.href=url;};
  }

  return el;
}

function renderMain(sections){
  MAIN_KEYS.forEach(function(key){
    const container = document.querySelector('[data-psom-key="'+key+'"]');
    if(!container) return;
    container.innerHTML = "";
    const list = resolveList(sections[key]).slice(0, MAIN_LIMIT);
    list.forEach(function(item){
      container.appendChild(createCard(item));
    });
  });
}

function renderRight(sections){
  const container = document.querySelector('[data-psom-key="socialnetwork"]');
  if(!container) return;
  container.innerHTML = "";
  const list = resolveList(sections[RIGHT_KEY]).slice(0, RIGHT_LIMIT);
  list.forEach(function(item){
    container.appendChild(createCard(item));
  });
}

async function loadSnapshots(){
  try{
    const [socialRes, distRes] = await Promise.all([
      fetch(SOCIAL_SNAPSHOT,{cache:"no-store"}),
      fetch(DISTRIBUTION_SNAPSHOT,{cache:"no-store"})
    ]);

    if(!socialRes.ok || !distRes.ok) return;

    const socialJson = await socialRes.json();
    const distJson = await distRes.json();

    const socialSections = resolveSections(socialJson);
    const distSections = resolveDistributionSections(distJson);

    renderMain(socialSections);
    renderRight(distSections);

    HAS_RENDERED = true;

  }catch(e){
    console.error("SOCIAL DISTRIBUTION STD ERROR:", e);
  }
}

document.addEventListener("DOMContentLoaded", function(){
  if(!HAS_RENDERED) loadSnapshots();
});

})();