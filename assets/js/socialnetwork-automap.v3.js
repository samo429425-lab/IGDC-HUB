
// socialnetwork-automap.v4.STABLE.js
// FINAL STABLE VERSION
// - Desktop → #rightAutoPanel
// - Mobile  → #rpMobileGrid
// - No duplication
// - No cloning
// - No fallback bleed
// - Strict key isolation

(function(){

if(window.__SOCIAL_AUTOMAP_V4__) return;
window.__SOCIAL_AUTOMAP_V4__ = true;

const SNAPSHOT_URL = "/data/social.snapshot.json";
const MAIN_LIMIT = 100;
const RIGHT_LIMIT = 80;
const MOBILE_BREAKPOINT = 1024;

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

function createCard(item){
  const el = document.createElement("div");
  el.className = "thumb-card";

  const img = item.thumb || "";
  const title = item.title || "";
  const meta = item.meta || "";

  el.innerHTML =
    '<div class="thumb-img" style="background-image:url(\'' + img + '\')"></div>' +
    '<div class="thumb-title">' + title + '</div>' +
    '<div class="thumb-meta">' + meta + '</div>';

  if(item.url){
    el.style.cursor = "pointer";
    el.onclick = function(){ location.href = item.url; };
  }

  return el;
}

async function loadSnapshot(){
  const res = await fetch(SNAPSHOT_URL, { cache: "no-store" });
  if(!res.ok) throw new Error("SNAPSHOT_LOAD_FAIL");
  return res.json();
}

function renderMainSections(sections){
  MAIN_KEYS.forEach(function(key){
    const selector = '[data-psom-key="' + key + '"]';
    const box = document.querySelector(selector);
    if(!box) return;

    const list = Array.isArray(sections[key]) ? sections[key] : [];
    box.innerHTML = "";

    list.slice(0, MAIN_LIMIT).forEach(function(item){
      box.appendChild(createCard(item));
    });
  });
}

function renderRight(sections){

  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;

  const target = isMobile
    ? document.querySelector("#rpMobileGrid")
    : document.querySelector("#rightAutoPanel");

  if(!target) return;

  target.innerHTML = "";

  const list = Array.isArray(sections["socialnetwork"])
    ? sections["socialnetwork"]
    : [];

  list.slice(0, RIGHT_LIMIT).forEach(function(item){
    target.appendChild(createCard(item));
  });
}

window.addEventListener("resize", function(){
  if(window.__SOCIAL_SECTIONS_CACHE__){
    renderRight(window.__SOCIAL_SECTIONS_CACHE__);
  }
});

(async function(){
  try{
    const snapshot = await loadSnapshot();
    const sections = snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections;
    window.__SOCIAL_SECTIONS_CACHE__ = sections || {};
    renderMainSections(window.__SOCIAL_SECTIONS_CACHE__);
    renderRight(window.__SOCIAL_SECTIONS_CACHE__);
  }catch(e){
    console.error("SOCIAL AUTOMAP ERROR:", e);
  }
})();

})();