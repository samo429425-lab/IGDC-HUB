/**
 * mediahub-automap-v3.js
 * Persistent single-pass renderer.
 * - Front capacity: 100 cards per media section.
 * - Real content atomically replaces its sample; never overlays it.
 * - Media Snapshot sample/fallbackSample stays available in memory and is restored on media/thumbnail failure.
 * - One DocumentFragment commit per section to avoid observer-driven render storms.
 */
(function () {
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V3_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V3_PROD__ = true;

  const D = document;
  const LIMIT = 100;
  const EAGER_BUDGET = 8;
  let eagerIssued = 0;
  const SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/data/media.snapshot.v6.keys.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json'
  ];
  const KEY_ALIAS = {
    trending_now:'media-trending', latest_movie:'media-movie', latest_drama:'media-drama',
    section_1:'media-thriller', section_2:'media-romance', section_3:'media-variety',
    section_4:'media-documentary', section_5:'media-animation', section_6:'media-music', section_7:'media-shorts'
  };
  const fallbackRegistry = new Map();

  function q(sel,root){ return (root||D).querySelector(sel); }
  function qa(sel,root){ return Array.prototype.slice.call((root||D).querySelectorAll(sel)); }
  function text(v){ return v==null?'':String(v).trim(); }
  function canonKey(k){ k=text(k); return k.indexOf('media-')===0?k:(KEY_ALIAS[k]||k); }
  function cloneData(v){ try{return JSON.parse(JSON.stringify(v||{}));}catch(_e){return{};} }
  function usableUrl(v){ const s=text(v); return /^https?:\/\//i.test(s); }
  function imageOf(x){ return text(x&&(x.thumbnail||x.thumb||x.image||x.imageUrl||x.thumbnailUrl||x.poster)); }
  function imageCandidates(x){
    const out=[];function add(v){v=text(v);if(usableUrl(v)&&!out.includes(v))out.push(v);}
    if(!x||typeof x!=='object')return out;
    ['thumbnail','thumb','thumb_url','image','imageUrl','thumbnailUrl','poster'].forEach(k=>add(x[k]));
    const raw=x.raw&&typeof x.raw==='object'?x.raw:{};const sm=raw.sourceMetadata&&typeof raw.sourceMetadata==='object'?raw.sourceMetadata:(x.sourceMetadata&&typeof x.sourceMetadata==='object'?x.sourceMetadata:{});
    ['thumbnail','thumb','thumb_url','image','imageUrl','thumbnailUrl','poster'].forEach(k=>{add(raw[k]);add(sm[k]);});
    const ident=text(sm.identifier||x.identifier||(idOf(x).match(/^ia:(.+)$/i)||[])[1]);if(ident)add('https://archive.org/services/img/'+encodeURIComponent(ident));
    const src=[x.url,x.sourceUrl,x.video,x.videoUrl,x.embedUrl,raw.url,raw.source_url,raw.video_url,raw.embed_url].map(text).join(' ');
    const ym=src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,20})/i);if(ym)add('https://i.ytimg.com/vi/'+encodeURIComponent(ym[1])+'/hqdefault.jpg');
    const fb=x.fallbackSample&&typeof x.fallbackSample==='object'?x.fallbackSample:null;if(fb)['thumbnail','thumb','image','imageUrl','thumbnailUrl','poster'].forEach(k=>add(fb[k]));
    return out;
  }
  function tuneImage(img,index){const eager=eagerIssued<EAGER_BUDGET&&index<8;if(eager)eagerIssued++;img.loading=eager?'eager':'lazy';img.decoding='async';if(!eager)try{img.fetchPriority='low';}catch(_e){}}
  function urlOf(x){ return text(x&&(x.url||x.link||x.href||x.video||x.videoUrl||x.embedUrl)); }
  function idOf(x){ return text(x&&(x.contentId||x.id||x._id||x.videoId||x.slug)); }
  function getContainer(line){ return q(':scope > .scroll-content',line)||line; }

  async function fetchJson(url){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),2600);
    try{const r=await fetch(url,{cache:'default',signal:controller.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}
    finally{clearTimeout(timer);}
  }
  async function loadSnapshotAny(){
    for(const url of SNAPSHOT_URLS){try{return await fetchJson(url);}catch(_e){}}
    return null;
  }
  function normalizeSectionMap(snapshot){
    const map={}; if(!snapshot)return map;
    const sections=snapshot.sections;
    if(sections&&!Array.isArray(sections)&&typeof sections==='object')Object.keys(sections).forEach(k=>map[canonKey(k)]=sections[k]||{});
    else if(Array.isArray(sections))sections.forEach(s=>{if(s)map[canonKey(s.key||s.section||'')]=s;});
    return map;
  }
  function slotsOf(section){
    if(!section)return[];
    if(Array.isArray(section.slots))return section.slots;
    if(Array.isArray(section.items))return section.items;
    if(Array.isArray(section))return section;
    return[];
  }
  function sampleLike(item){
    if(!item||typeof item!=='object')return true;
    if(item.sample===true||item.isSample===true||item.placeholder===true||item.replaceableSlot===true||item.candidateOnly===true||item.seedContent===true)return true;
    const source=typeof item.source==='object'?item.source.name:item.source;
    if(text(source).toLowerCase()==='seed'||(item.extension&&item.extension.placeholder))return true;
    if(item.managedBy==='media-snapshot-publish')return false;
    const title=text(item.title||item.name),url=urlOf(item),img=imageOf(item).toLowerCase();
    if(/^media\s+(?:item|slot)\s+\d+$/i.test(title))return true;
    if(img.includes('/assets/sample/')||img.includes('placeholder'))return true;
    if(!usableUrl(url)&&!idOf(item))return true;
    return false;
  }
  function realItem(item){
    if(!item||sampleLike(item))return false;
    if(item.managedBy==='media-snapshot-publish')return true;
    return !!(idOf(item)&&(usableUrl(urlOf(item))||usableUrl(text(item.video||item.mediaSource)))&&usableUrl(imageOf(item)));
  }
  function staticTemplates(line){
    const container=getContainer(line);
    return qa(':scope > a.card',container).slice(0,LIMIT).map(card=>card.cloneNode(true));
  }
  function genericSample(){
    const a=D.createElement('a');a.className='card media-card';a.dataset.placeholder='true';a.href='javascript:void(0)';
    const thumb=D.createElement('div');thumb.className='thumb ph';
    const meta=D.createElement('div');meta.className='meta';meta.textContent='Coming Soon';a.append(thumb,meta);return a;
  }
  function makeSampleCard(sample,template,index){
    const data=sample&&typeof sample==='object'?sample:{};
    if((!data||!Object.keys(data).length)&&template){const clone=template.cloneNode(true);clone.dataset.placeholder='true';return clone;}
    const title=text(data.title||data.name)||'Coming Soon',imgUrl=imageOf(data);
    if(!title&&!imgUrl&&template){const clone=template.cloneNode(true);clone.dataset.placeholder='true';return clone;}
    const a=D.createElement('a');a.className='card media-card';a.dataset.placeholder='true';a.dataset.mediaSlot=String(Number(data.slotId)||index+1);a.href='javascript:void(0)';
    const thumb=D.createElement('div');thumb.className='thumb';
    if(usableUrl(imgUrl)){const img=D.createElement('img');img.src=imgUrl;img.alt=title;tuneImage(img,index);thumb.appendChild(img);}else thumb.classList.add('ph');
    const meta=D.createElement('div');meta.className='meta';meta.textContent=title;a.append(thumb,meta);return a;
  }
  function fallbackData(item){
    return item&&item.fallbackSample&&typeof item.fallbackSample==='object'?cloneData(item.fallbackSample):null;
  }
  function cardKey(sectionKey,index){return sectionKey+':'+index;}
  function makeRealCard(item,sectionKey,index,template){
    const title=text(item.title||item.name||item.text)||'Media',thumbUrl=imageOf(item),id=idOf(item),slotId=Number(item.slotId)||index+1;
    const a=D.createElement('a');a.className='card media-card';a.dataset.mediaSlot=String(slotId);a.dataset.mediaSection=sectionKey;
    if(id){a.dataset.igdcContentId=id;a.dataset.contentId=id;a.href='/media/watch.html?id='+encodeURIComponent(id);}else a.href=urlOf(item)||'#';
    a.dataset.mediaTitle=title;if(item.provider)a.dataset.provider=text(item.provider);
    const direct=/\.(mp4|webm|ogv|ogg|m4v)(?:[?#].*)?$/i.test(urlOf(item))?urlOf(item):'';
    const source=text(item.video||item.streamUrl||item.mediaUrl||item.playbackUrl||item.sourceUrl||direct);
    if(source)a.dataset.mediaSource=source;
    const captions=item.captions||item.subtitleTracks||item.subtitles;if(Array.isArray(captions)&&captions.length)try{a.dataset.captions=JSON.stringify(captions);}catch(_e){}
    ['windowsPlayerUrl','androidPlayerUrl','maruAppUrl'].forEach(k=>{if(item[k])a.dataset[k]=text(item[k]);});
    const thumb=D.createElement('div');thumb.className='thumb';
    const img=D.createElement('img');img.alt=title;tuneImage(img,index);
    const candidates=imageCandidates(item);let thumbAttempt=0;
    function tryNextThumb(){
      if(thumbAttempt<candidates.length){img.src=candidates[thumbAttempt++];return;}
      restoreCard(a,'thumbnail_error');
    }
    img.addEventListener('error',tryNextThumb);
    if(candidates.length)tryNextThumb();else img.removeAttribute('src');thumb.appendChild(img);
    const meta=D.createElement('div');meta.className='meta';meta.textContent=title;a.append(thumb,meta);
    const key=cardKey(sectionKey,index),fallback=fallbackData(item);
    fallbackRegistry.set(key,{sample:fallback,template:template?template.cloneNode(true):null,index,sectionKey});
    a.dataset.mediaFallbackKey=key;
    if(!candidates.length)queueMicrotask(()=>restoreCard(a,'thumbnail_missing'));
    return a;
  }
  function restoreCard(card,reason){
    if(!card||!card.parentNode)return false;
    const key=text(card.dataset&&card.dataset.mediaFallbackKey),rec=fallbackRegistry.get(key);if(!rec)return false;
    const replacement=makeSampleCard(rec.sample,rec.template,rec.index);replacement.dataset.mediaFallbackReason=reason||'source_failure';
    card.replaceWith(replacement);return true;
  }
  function renderLine(line,sectionKey,section){
    const container=getContainer(line),templates=staticTemplates(line),slots=slotsOf(section),frag=D.createDocumentFragment();
    for(let i=0;i<LIMIT;i++){
      const item=slots[i]&&typeof slots[i]==='object'?slots[i]:null,template=templates[i]||null;
      if(item&&realItem(item))frag.appendChild(makeRealCard(item,sectionKey,i,template));
      else frag.appendChild(makeSampleCard(item,template,i));
    }
    container.replaceChildren(frag);
  }
  function score(item){
    const views=Number(item&& (item.views||item.viewCount)||0),rank=Number(item&&(item.rankingScore||item.score||item.popularity)||0),rating=Number(item&&(item.rating||item.voteAverage)||0);
    const time=Date.parse(text(item&&(item.publishedAt||item.releaseDate||item.createdAt||item.date)));const rec=Number.isFinite(time)?Math.max(0,1-(Date.now()-time)/(30*86400000)):0;
    return views*.5+rank*.2+rating*.1+rec*20;
  }
  function buildTrending(sectionMap){
    if(slotsOf(sectionMap['media-trending']).some(realItem))return;
    const merged=[];['media-movie','media-drama','media-variety','media-music'].forEach(k=>slotsOf(sectionMap[k]).forEach(item=>{if(realItem(item))merged.push(item);}));
    const seen=new Set(),items=merged.sort((a,b)=>score(b)-score(a)).filter(item=>{const k=idOf(item)||urlOf(item);if(!k||seen.has(k))return false;seen.add(k);return true;}).slice(0,LIMIT);
    sectionMap['media-trending']={key:'media-trending',slots:items};
  }
  function applyHero(snapshot,sectionMap){
    const img=q('.hero img');if(!img)return;const keys=((snapshot&&snapshot.hero&&(snapshot.hero.rotateFrom||snapshot.hero.source))||[]);const list=Array.isArray(keys)?keys.map(canonKey):[];
    for(const key of list){const first=slotsOf(sectionMap[key]).find(realItem);if(first&&usableUrl(imageOf(first))){img.src=imageOf(first);break;}}
  }
  async function main(){
    const lines=qa('.thumb-line[data-psom-key]');if(!lines.length)return;
    const snapshot=await loadSnapshotAny();if(!snapshot)return; // keep committed HTML samples untouched if snapshot is unavailable
    eagerIssued=0;const sectionMap=normalizeSectionMap(snapshot);buildTrending(sectionMap);
    lines.forEach(line=>{const key=canonKey(line.getAttribute('data-psom-key'));if(key&&key.indexOf('media-')===0)renderLine(line,key,sectionMap[key]);});
    applyHero(snapshot,sectionMap);
    D.dispatchEvent(new CustomEvent('igdc:media-render-complete',{detail:{sections:lines.length,capacity:LIMIT}}));
  }
  window.IGDCMediaFallback={restoreCard,restoreByContentId:function(contentId,reason){const card=q('a.card[data-content-id="'+CSS.escape(text(contentId))+'"]');return restoreCard(card,reason);}};
  D.addEventListener('igdc:media-source-failed',function(event){const d=event&&event.detail||{};if(d.card)restoreCard(d.card,d.reason||'media_source_failed');else if(d.contentId)window.IGDCMediaFallback.restoreByContentId(d.contentId,d.reason);});
  if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',main,{once:true});else main();
})();

/* ------------------------------------------------------------------
 * MARU Revenue AutoHook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Then load /assets/js/maru-revenue-autohook.js
 * - Do not change this automap's original rendering pipeline.
 * ------------------------------------------------------------------ */
(function loadMaruRevenueAutoHookForAutomap(){
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function installIfReady(){
    try {
      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "front-automap"
        });
      }
    } catch (e) {
      console.warn("[MARU Revenue] autohook install skipped:", e);
    }
  }

  function loadScriptOnce(src, id, globalName, done){
    var existing = document.getElementById(id);

    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    if (existing) {
      existing.addEventListener("load", function(){
        if (typeof done === "function") done();
      }, { once:true });
      existing.addEventListener("error", function(){
        console.warn("[MARU Revenue] failed to load:", src);
      }, { once:true });
      return;
    }

    var script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onload = function(){
      if (typeof done === "function") done();
    };
    script.onerror = function(){
      console.warn("[MARU Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(script);
  }

  if (window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__) {
    installIfReady();
    return;
  }

  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__ = true;

  loadScriptOnce(
    "/assets/js/maru-revenue-tracker.js",
    "maruRevenueTrackerScript",
    "MaruRevenueTracker",
    function(){
      loadScriptOnce(
        "/assets/js/maru-revenue-autohook.js",
        "maruRevenueAutoHookScript",
        "MaruRevenueAutoHook",
        installIfReady
      );
    }
  );
})();
