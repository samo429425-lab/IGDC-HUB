/**
 * mediahub-automap.v3.js (PRODUCTION SAFE / SINGLE VERSION)
 * ------------------------------------------------------------
 * 목적:
 *  - MediaHub 메인 10섹션(data-psom-key="media-*")에 "미디어 콘텐츠"를 슬롯-우선(slot-first)으로 꽂는다.
 *  - 우선순위: /data/media.snapshot*.json 단일 경로(feed-media legacy fallback 비활성)
 *  - 데이터 없으면 HTML 더미(placeholder) 유지 (파괴/삭제 금지)
 *  - 모든 섹션 카드 수: 50 고정(부족하면 placeholder 추가)
 *  - 우측 패널 없음(처리하지 않음)
 *  - Hero는 snapshot.hero.rotateFrom 순서로 1개 썸네일을 골라 img src에 적용(가능한 경우)
 */
(function () {
  'use strict';

  if (window.__MEDIAHUB_AUTOMAP_V3_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V3_PROD__ = true;

  const D = document;

  const LIMIT = 50;
  const SAMPLE_IMAGE = '/assets/images/media-sample-card.png';

  // Legacy feed-media fallback is disabled.
  // Keep the original snapshot -> automap -> front sample/real-content rendering process unchanged.
  const ENABLE_FEED_MEDIA_FALLBACK = false;

  const SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/data/media.snapshot.v6.keys.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json'
  ];

  const KEY_ALIAS = {
    'trending_now': 'media-trending',
    'latest_movie': 'media-movie',
    'latest_drama': 'media-drama',
    'section_1': 'media-thriller',
    'section_2': 'media-romance',
    'section_3': 'media-variety',
    'section_4': 'media-documentary',
    'section_5': 'media-animation',
    'section_6': 'media-music',
    'section_7': 'media-shorts'
  };

  function q(sel, root){ return (root||D).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root||D).querySelectorAll(sel)); }

  function canonKey(k){
    if(!k) return '';
    if(k.indexOf('media-') === 0) return k;
    return KEY_ALIAS[k] || k;
  }

  async function fetchJson(url){
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(()=>controller.abort(), 2200) : 0;
    try{
      const r = await fetch(url, { cache: 'default', credentials: 'same-origin', signal: controller ? controller.signal : undefined });
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { if(timer) clearTimeout(timer); }
  }

  async function loadSnapshotAny(){
    for (const url of SNAPSHOT_URLS){
      try { return await fetchJson(url); } catch(e){ /* continue */ }
    }
    return null;
  }

  function normalizeSectionMap(snapshot){
    const map = {};
    if(!snapshot) return map;

    // object sections
    if(snapshot.sections && !Array.isArray(snapshot.sections) && typeof snapshot.sections === 'object'){
      Object.keys(snapshot.sections).forEach((k)=>{
        map[canonKey(k)] = snapshot.sections[k] || {};
      });
      return map;
    }

    // array sections
    if(Array.isArray(snapshot.sections)){
      snapshot.sections.forEach((s)=>{
        if(!s) return;
        map[canonKey(s.key || '')] = s;
      });
    }
    return map;
  }

  function slotsToItems(section){
    const slots = section && Array.isArray(section.slots) ? section.slots : [];
    return slots.map((slot)=>Object.assign({}, slot || {}, {
      title: (slot && slot.title) || '',
      thumbnail: (slot && (slot.thumbnail || slot.thumb)) || '',
      url: (slot && (slot.url || slot.video || slot.link)) || '',
      video: (slot && slot.video) || '',
      provider: (slot && slot.provider) || ''
    }));
  }

  function extractItems(section){
    if(!section) return [];
    if(Array.isArray(section.items)) return section.items;
    if(Array.isArray(section.slots)) return slotsToItems(section);
    return [];
  }

  async function loadFeedItems(key){
    if(!ENABLE_FEED_MEDIA_FALLBACK) return [];
    const url = `/.netlify/functions/feed-media?key=${encodeURIComponent(key)}&limit=500`;
    try{
      const data = await fetchJson(url);
      if(data && Array.isArray(data.items)) return data.items;
      if(data && Array.isArray(data.sections)){
        const found = data.sections.find(s => s && canonKey(s.key) === key);
        if(found && Array.isArray(found.items)) return found.items;
      }
    }catch(e){ /* ignore */ }
    return [];
  }

  function makePlaceholder(){
    const a = D.createElement('a');
    a.className = 'card media-card';
    a.setAttribute('data-placeholder','true');
    a.href = 'javascript:void(0)';
    const thumb = D.createElement('div');
    thumb.className = 'thumb ph';
    const img = D.createElement('img');
    img.src = SAMPLE_IMAGE;
    img.alt = 'Media Sample';
    img.loading = 'lazy';
    thumb.appendChild(img);
    const meta = D.createElement('div');
    meta.className = 'meta';
    meta.textContent = 'Sample';
    a.appendChild(thumb);
    a.appendChild(meta);
    return a;
  }

  function getContainer(line){
    // Some pages wrap cards in .scroll-content. If not, cards are directly inside .thumb-line.
    return q('.scroll-content', line) || line;
  }

  function ensurePlaceholders(line){
    const container = getContainer(line);

    // collect existing placeholders (preferred)
    let ph = qa('a[data-placeholder="true"]', container);

    // mark empty anchors as placeholders (non-destructive)
    if(ph.length === 0){
      const anchors = qa('a.card', container);
      anchors.forEach((a)=>{
        const hasImg = !!q('img', a);
        const hasText = (a.textContent || '').trim().length > 0;
        if(!hasImg && !hasText) a.setAttribute('data-placeholder','true');
      });
      ph = qa('a[data-placeholder="true"]', container);
    }

    // add up to LIMIT
    if(ph.length < LIMIT){
      const frag = D.createDocumentFragment();
      for(let i=ph.length;i<LIMIT;i++){
        frag.appendChild(makePlaceholder());
      }
      container.appendChild(frag);
      ph = qa('a[data-placeholder="true"]', container);
    }

    // if too many, keep first LIMIT as fill targets
    if(ph.length > LIMIT) ph = ph.slice(0, LIMIT);

    return ph;
  }

  
 function ensureContentId(item){
  if(!item) return '';

  const hasRealContent =
    !!(item.title || item.name || item.text || item.thumbnail || item.thumb || item.image || item.imageUrl || item.thumbnailUrl || item.url || item.video || item.link || item.href);

  if(!hasRealContent) return '';

  return (
    item.id ||
    item._id ||
    item.contentId ||
    item.videoId ||
    item.slug ||
    (item.url ? btoa(item.url).replace(/=/g,'') : '')
  );
}

  const AUTO_THUMB_TARGETS = [1, 3, 6, 10];
  const autoThumbQueue = [];
  let autoThumbBusy = false;
  let autoThumbObserver = null;
  const thumbQuarantine = window.__IGDC_MEDIA_THUMBNAIL_QUARANTINE__ = window.__IGDC_MEDIA_THUMBNAIL_QUARANTINE__ || [];

  function youtubeIdForThumb(value){
    const m = String(value || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,20})/i);
    return m ? m[1] : '';
  }
  function mediaSourceForThumb(item){
    if(!item) return '';
    return String(item.video || item.streamUrl || item.mediaUrl || item.playbackUrl || item.sourceUrl || item.embedUrl || item.url || item.link || '');
  }
  function rawThumbnail(item){
    return String(item && (item.thumbnail || item.thumb || item.image || item.imageUrl || item.thumbnailUrl || '') || '').trim();
  }
  function isPlaceholderThumb(value){
    const v=String(value||'').trim().toLowerCase();
    if(!v||v==='#')return true;
    return v.indexOf('media-sample-card.png')>=0||v.indexOf('placeholder')>=0||v.indexOf('placehold.co')>=0||v.indexOf('placehold.it')>=0;
  }
  function isSyntheticSampleItem(item){
    if(!item)return false;
    const thumb=rawThumbnail(item).toLowerCase();
    if(thumb.indexOf('media-sample-card.png')>=0)return true;
    const title=String(item.title||item.name||'').trim();
    const cid=String(item.contentId||item.id||'').trim();
    const provider=item.provider&&typeof item.provider==='object'?String(item.provider.name||''):String(item.provider||'');
    return /^sample(?:\s+\d+)?$/i.test(title)&&(/^media-[a-z0-9-]+:\d+$/i.test(cid)||/^seed$/i.test(provider));
  }
  function safeFrontThumbnail(value){
    const v=String(value||'').trim();
    if(isPlaceholderThumb(v))return '';
    if(/^https:\/\//i.test(v)||/^\/[^/]/.test(v)||/^data:image\/(?:jpeg|png|webp);base64,/i.test(v))return v;
    return '';
  }
  function providerThumbnailCandidates(item){
    if(isSyntheticSampleItem(item))return [];
    const id = youtubeIdForThumb(mediaSourceForThumb(item));
    if(!id)return [];
    const enc=encodeURIComponent(id);
    return [
      'https://i.ytimg.com/vi/'+enc+'/hqdefault.jpg',
      'https://i.ytimg.com/vi/'+enc+'/mqdefault.jpg',
      'https://i.ytimg.com/vi/'+enc+'/default.jpg'
    ];
  }
  function directVideoForThumb(source){
    return /\.(mp4|webm|ogv|ogg|m4v)(?:[?#].*)?$/i.test(String(source || ''));
  }
  function frameLooksUsable(ctx,w,h){
    try{
      const data=ctx.getImageData(0,0,w,h).data;
      let count=0,sum=0,sum2=0;
      const step=Math.max(4,Math.floor((w*h)/1400))*4;
      for(let i=0;i<data.length;i+=step){
        const y=(data[i]*.2126)+(data[i+1]*.7152)+(data[i+2]*.0722);
        sum+=y;sum2+=y*y;count++;
      }
      if(!count)return false;
      const mean=sum/count,variance=(sum2/count)-(mean*mean);
      return mean>10&&mean<246&&variance>18;
    }catch(_e){ return false; }
  }
  function captureVisibleVideoFrame(source){
    return new Promise((resolve)=>{
      const video=D.createElement('video');
      let targetIndex=0,done=false;
      const timeout=setTimeout(()=>finish(''),3800);
      function clean(){clearTimeout(timeout);try{video.pause();video.removeAttribute('src');video.load();video.remove();}catch(_e){}}
      function finish(value){if(done)return;done=true;clean();resolve(value||'');}
      function seekNext(){
        if(targetIndex>=AUTO_THUMB_TARGETS.length){finish('');return;}
        let t=AUTO_THUMB_TARGETS[targetIndex++];
        const d=Number(video.duration);if(isFinite(d)&&d>0)t=Math.min(t,Math.max(.15,d-.2));
        try{video.currentTime=Math.max(.05,t);}catch(_e){finish('');}
      }
      video.onloadedmetadata=seekNext;
      video.onseeked=function(){
        if(!video.videoWidth||!video.videoHeight){seekNext();return;}
        try{
          const c=D.createElement('canvas'),ctx=c.getContext('2d',{alpha:false});
          if(!ctx){finish('');return;}
          c.width=480;c.height=270;
          const r=Math.max(c.width/video.videoWidth,c.height/video.videoHeight);
          const sw=c.width/r,sh=c.height/r,sx=(video.videoWidth-sw)/2,sy=(video.videoHeight-sh)/2;
          ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
          if(!frameLooksUsable(ctx,c.width,c.height)){seekNext();return;}
          finish(c.toDataURL('image/jpeg',.78));
        }catch(_e){finish('');}
      };
      video.onerror=function(){finish('');};
      video.crossOrigin='anonymous';video.muted=true;video.playsInline=true;video.preload='metadata';
      video.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px';
      (D.body||D.documentElement).appendChild(video);video.src=source;video.load();
    });
  }
  function preflightImage(url, timeoutMs){
    return new Promise((resolve)=>{
      if(!safeFrontThumbnail(url)){resolve(false);return;}
      const probe=new Image();let done=false;
      const timer=setTimeout(()=>finish(false),Math.max(700,Number(timeoutMs)||1600));
      function finish(ok){if(done)return;done=true;clearTimeout(timer);probe.onload=null;probe.onerror=null;resolve(!!ok);}
      probe.onload=function(){finish(probe.naturalWidth>=120&&probe.naturalHeight>=68);};
      probe.onerror=function(){finish(false);};
      probe.decoding='async';probe.src=url;
    });
  }
  function clearMediaDataset(a){
    ['provider','mediaTitle','igdcContentId','contentId','mediaSource','captions','windowsPlayerUrl','androidPlayerUrl','maruAppUrl','thumbPending','thumbRecovery','autoThumbQueued','autoThumbSource'].forEach((key)=>{try{delete a.dataset[key];}catch(_e){}});
  }
  function resetAnchorToPlaceholder(a, reason){
    if(!a)return;
    a.setAttribute('data-placeholder','true');
    a.href='javascript:void(0)';a.removeAttribute('target');a.removeAttribute('rel');a.onclick=null;
    clearMediaDataset(a);
    const thumbBox=q('.thumb',a)||D.createElement('div');
    if(!thumbBox.parentNode){thumbBox.className='thumb ph';a.insertBefore(thumbBox,a.firstChild);}else thumbBox.classList.add('ph');
    let img=q('img',thumbBox);if(!img){img=D.createElement('img');thumbBox.appendChild(img);}
    img.onload=null;img.onerror=null;img.src=SAMPLE_IMAGE;img.alt='Media Sample';img.loading='lazy';img.decoding='async';
    const meta=q('.meta',a)||D.createElement('div');if(!meta.parentNode){meta.className='meta';a.appendChild(meta);}meta.textContent='Sample';
    if(reason)a.dataset.thumbQuarantineReason=reason;else delete a.dataset.thumbQuarantineReason;
  }
  function quarantineItem(a,item,reason){
    resetAnchorToPlaceholder(a,reason||'thumbnail_unavailable');
    const record={
      contentId:ensureContentId(item),title:String(item&&item.title||''),source:mediaSourceForThumb(item),reason:reason||'thumbnail_unavailable',at:new Date().toISOString()
    };
    if(!thumbQuarantine.some((r)=>r.contentId&&r.contentId===record.contentId))thumbQuarantine.push(record);
    try{D.dispatchEvent(new CustomEvent('igdc:media-thumbnail-quarantine',{detail:record}));}catch(_e){}
  }
  function bindItemToAnchor(a,item,thumbOverride){
    const title = (item && (item.title || item.name || item.text || '')) || '';
    const thumb = safeFrontThumbnail(thumbOverride || rawThumbnail(item));
    if(!thumb){quarantineItem(a,item,'thumbnail_missing');return false;}
    const url = (item && (item.url || item.video || item.link || item.href || '#')) || '#';
    const videoId = ensureContentId(item);
    if(!videoId){quarantineItem(a,item,'content_id_missing');return false;}

    // The MARU/IGDC playback controller is the single playback entry point.
    // Keeping href inert also prevents a mobile tap race from falling through
    // to the legacy watch page before delegated listeners can intercept it.
    a.href = 'javascript:void(0)';
    a.removeAttribute('target');a.removeAttribute('rel');
    a.onclick = function(event){
      try {
        if(event){event.preventDefault();event.stopPropagation();}
        const player = window.IGDCMediaHubPlayback;
        if(player && typeof player.open === 'function'){
          player.open(a,{autoPlay:true,autoFullscreen:true});
          return false;
        }
        // Very short startup race only: retry locally, never navigate away.
        let tries=0;
        const timer=setInterval(function(){
          tries+=1;
          const latePlayer=window.IGDCMediaHubPlayback;
          if(latePlayer && typeof latePlayer.open==='function'){
            clearInterval(timer);
            latePlayer.open(a,{autoPlay:true,autoFullscreen:true});
          }else if(tries>=20){
            clearInterval(timer);
          }
        },50);
      } catch(_e){}
      return false;
    };
    delete a.dataset.thumbQuarantineReason;
    a.__igdcMediaItem=item;
    if(item && item.provider) a.dataset.provider = typeof item.provider==='object' ? String(item.provider.name||item.provider.platform||'') : item.provider;
    if(title) a.dataset.mediaTitle = title;
    a.dataset.igdcContentId = String(videoId);a.dataset.contentId = String(videoId);
    if(item){
      const directUrl = /\.(mp4|webm|ogv|ogg|m4v)(?:[?#].*)?$/i.test(String(item.url || '')) || /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/)/i.test(String(item.url || '')) ? item.url : '';
      const mediaSource = item.video || item.streamUrl || item.mediaUrl || item.playbackUrl || item.sourceUrl || item.embedUrl || directUrl || '';
      if(mediaSource) a.dataset.mediaSource = String(mediaSource);
      const captions = item.captions || item.subtitleTracks || item.subtitles;
      if(Array.isArray(captions) && captions.length){try { a.dataset.captions = JSON.stringify(captions); } catch(_e){}}
      if(item.windowsPlayerUrl) a.dataset.windowsPlayerUrl = String(item.windowsPlayerUrl);
      if(item.androidPlayerUrl) a.dataset.androidPlayerUrl = String(item.androidPlayerUrl);
      if(item.maruAppUrl) a.dataset.maruAppUrl = String(item.maruAppUrl);
    }

    let thumbBox=q('.thumb',a);if(!thumbBox){thumbBox=D.createElement('div');thumbBox.className='thumb ph';a.insertBefore(thumbBox,a.firstChild);}else thumbBox.classList.add('ph');
    let img=q('img',thumbBox);if(!img){img=D.createElement('img');thumbBox.appendChild(img);}
    let meta=q('.meta',a);if(!meta){meta=D.createElement('div');meta.className='meta';a.appendChild(meta);}meta.textContent='Sample';
    a.setAttribute('data-placeholder','true');
    img.alt=title||'';img.loading='lazy';img.decoding='async';img.dataset.autoThumbResolved='1';
    // Keep the blue MEDIA SAMPLE artwork visible until a real thumbnail has
    // actually loaded and passed validation. Off-screen cards do not start
    // network thumbnail work at all; this avoids large request bursts at boot.
    let settled=false,slowTimer=0,watcher=null,loader=null,loadStarted=false;
    function stopWatch(){if(slowTimer)clearTimeout(slowTimer);slowTimer=0;if(watcher){try{watcher.disconnect();}catch(_e){}watcher=null;}}
    function activate(){if(settled||!a.isConnected)return;settled=true;stopWatch();img.src=thumb;thumbBox.classList.remove('ph');meta.textContent=title;a.removeAttribute('data-placeholder');delete a.dataset.thumbPending;delete a.dataset.thumbQuarantineReason;}
    function fail(reason){if(settled)return;settled=true;stopWatch();if(loader){try{loader.onload=null;loader.onerror=null;}catch(_e){}loader=null;}if(a.dataset.thumbRecovery==='1'){quarantineItem(a,item,reason||'thumbnail_recovery_failed');return;}resetAnchorToPlaceholder(a,reason||'thumbnail_load_failed');recoverThumbnail(a,item);}
    function beginLoad(){
      if(settled||loadStarted||!a.isConnected)return;loadStarted=true;
      loader=new Image();loader.decoding='async';
      slowTimer=setTimeout(()=>{if(!settled)fail('thumbnail_slow');},2600);
      loader.onload=function(){if(settled)return;if(loader.naturalWidth>=120&&loader.naturalHeight>=68)activate();else fail('thumbnail_too_small');};
      loader.onerror=function(){fail('thumbnail_load_failed');};
      loader.src=thumb;
      if(loader.complete){if(loader.naturalWidth>=120&&loader.naturalHeight>=68)activate();else if(loader.naturalWidth===0)fail('thumbnail_load_failed');}
    }
    if('IntersectionObserver' in window){watcher=new IntersectionObserver((entries)=>{for(const entry of entries){if(entry.isIntersecting){watcher.disconnect();watcher=null;beginLoad();break;}}},{root:null,rootMargin:'260px 320px',threshold:.01});watcher.observe(a);}else setTimeout(beginLoad,0);
    return true;
  }
  function runAutoThumbQueue(){
    if(autoThumbBusy||!autoThumbQueue.length)return;
    autoThumbBusy=true;
    const job=autoThumbQueue.shift();
    captureVisibleVideoFrame(job.source).then((dataUrl)=>{
      if(dataUrl&&job.card&&job.card.isConnected){job.card.dataset.thumbRecovery='1';bindItemToAnchor(job.card,job.item,dataUrl);}
      else if(job.card&&job.card.isConnected)quarantineItem(job.card,job.item,'thumbnail_capture_failed');
    }).finally(()=>{autoThumbBusy=false;setTimeout(runAutoThumbQueue,0);});
  }
  function enqueueAutoThumb(card,item,source){
    if(!card||!source||card.dataset.autoThumbQueued==='1')return;
    card.dataset.autoThumbQueued='1';autoThumbQueue.push({card,item,source});runAutoThumbQueue();
  }
  function scheduleDirectCapture(card,item,source){
    if(!card||!source)return;
    if('IntersectionObserver' in window){
      if(!autoThumbObserver)autoThumbObserver=new IntersectionObserver((entries)=>{
        entries.forEach((entry)=>{if(!entry.isIntersecting)return;const el=entry.target;autoThumbObserver.unobserve(el);enqueueAutoThumb(el,el.__igdcThumbItem,el.dataset.autoThumbSource||'');});
      },{root:null,rootMargin:'160px 0px',threshold:.01});
      card.__igdcThumbItem=item;card.dataset.autoThumbSource=source;autoThumbObserver.observe(card);
    }else setTimeout(()=>enqueueAutoThumb(card,item,source),0);
  }
  const recoveryQueue=[];let recoveryBusy=false;let recoveryObserver=null;
  function enqueueRecovery(card,item){if(!card||!item||card.dataset.thumbRecoveryQueued==='1')return;card.dataset.thumbRecoveryQueued='1';recoveryQueue.push({card,item});runRecoveryQueue();}
  async function runRecoveryQueue(){
    if(recoveryBusy||!recoveryQueue.length)return;recoveryBusy=true;
    const job=recoveryQueue.shift(),card=job.card,item=job.item;
    try{
      if(!card||!card.isConnected||isSyntheticSampleItem(item)){if(card&&card.isConnected)resetAnchorToPlaceholder(card,'sample_slot');return;}
      const providerCandidates=providerThumbnailCandidates(item);
      for(const candidate of providerCandidates){if(await preflightImage(candidate,1200)){if(card.isConnected)bindItemToAnchor(card,item,candidate);return;}}
      const source=mediaSourceForThumb(item);
      if(directVideoForThumb(source)){
        const dataUrl=await captureVisibleVideoFrame(source);
        if(dataUrl&&card.isConnected){card.dataset.thumbRecovery='1';bindItemToAnchor(card,item,dataUrl);return;}
        if(card.isConnected)quarantineItem(card,item,'thumbnail_capture_failed');return;
      }
      if(card.isConnected)quarantineItem(card,item,'thumbnail_unavailable');
    } finally {recoveryBusy=false;setTimeout(runRecoveryQueue,0);}
  }
  function recoverThumbnail(card,item){
    if(!card||!item)return;
    if(isSyntheticSampleItem(item)){resetAnchorToPlaceholder(card,'sample_slot');return;}
    card.dataset.thumbPending='1';card.dataset.thumbRecovery='1';
    if('IntersectionObserver' in window){
      if(!recoveryObserver)recoveryObserver=new IntersectionObserver((entries)=>{entries.forEach((entry)=>{if(!entry.isIntersecting)return;const el=entry.target;recoveryObserver.unobserve(el);enqueueRecovery(el,el.__igdcRecoveryItem);});},{root:null,rootMargin:'220px 0px',threshold:.01});
      card.__igdcRecoveryItem=item;recoveryObserver.observe(card);
    }else setTimeout(()=>enqueueRecovery(card,item),0);
  }
  function playbackMarkedUnavailable(item){
    if(!item)return true;
    if(item.playbackReady===false||item.frontPlaybackReady===false||item.sourceReady===false||item.playable===false)return true;
    const status=String(item.playbackStatus||item.sourceStatus||item.playabilityStatus||'').trim().toLowerCase();
    return /(?:slow|timeout|failed|unplayable|unavailable|blocked|broken)/.test(status);
  }
  function isFrontCandidate(item){
    if(!item||isSyntheticSampleItem(item)||playbackMarkedUnavailable(item))return false;
    const title=String(item.title||item.name||item.text||'').trim();
    const source=mediaSourceForThumb(item);
    const id=ensureContentId(item);
    return !!(title&&source&&id);
  }

  function fillAnchor(a,item){
    return bindItemToAnchor(a,item,safeFrontThumbnail(rawThumbnail(item)));
  }

  function applyLine(line, items){
    if(!Array.isArray(items) || items.length === 0) return;
    const ph=ensurePlaceholders(line);
    const immediate=[],pending=[];
    for(const item of items){
      if(isSyntheticSampleItem(item))continue;
      if(!isFrontCandidate(item))continue;
      const thumb=safeFrontThumbnail(rawThumbnail(item));
      if(thumb)immediate.push({item,thumb});
      else if(providerThumbnailCandidates(item).length||directVideoForThumb(mediaSourceForThumb(item)))pending.push(item);
      if(immediate.length+pending.length>=LIMIT)break;
    }
    let slot=0;
    for(const entry of immediate){if(slot>=ph.length||slot>=LIMIT)break;bindItemToAnchor(ph[slot++],entry.item,entry.thumb);}
    for(const item of pending){if(slot>=ph.length||slot>=LIMIT)break;const card=ph[slot++];resetAnchorToPlaceholder(card,'thumbnail_pending');recoverThumbnail(card,item);}
  }

  async function applyHero(heroRotateKeys, sectionMap){
    const heroImg = q('.hero img');
    if(!heroImg) return;

    const keys = Array.isArray(heroRotateKeys) ? heroRotateKeys.map(canonKey) : [];
    if(keys.length === 0) return;

    // snapshot first
    for(const k of keys){
      const items = extractItems(sectionMap[k]);
      const first = items && items[0];
      const thumb = first && safeFrontThumbnail(rawThumbnail(first));
      if(thumb){
        heroImg.src = thumb;
        return;
      }
    }

    // fallback feed (best-effort)
    for(const k of keys){
      const items = await loadFeedItems(k);
      const first = items && items[0];
      const thumb = first && safeFrontThumbnail(rawThumbnail(first));
      if(thumb){
        heroImg.src = thumb;
        return;
      }
    }
  }

  D.addEventListener('igdc:media-source-failed',(event)=>{
    const detail=event&&event.detail||{};
    let card=detail.card&&detail.card.closest?detail.card.closest('a.card'):detail.card;
    if(!card&&detail.contentId){
      const wanted=String(detail.contentId);
      card=qa('a.card[data-content-id],a.card[data-igdc-content-id]').find((el)=>
        String(el.dataset.contentId||el.dataset.igdcContentId||'')===wanted
      )||null;
    }
    if(!card||card.getAttribute('data-placeholder')==='true')return;
    const item=card.__igdcMediaItem||{contentId:detail.contentId,title:card.dataset.mediaTitle||'',url:card.dataset.mediaSource||''};
    quarantineItem(card,item,'playback_'+String(detail.reason||'source_failed'));
    try{D.dispatchEvent(new CustomEvent('igdc:media-playback-quarantine',{detail:{contentId:detail.contentId||ensureContentId(item),reason:detail.reason||'source_failed'}}));}catch(_e){}
  });

  async function main(){
    const lines = qa('.thumb-line[data-psom-key]');
    if(lines.length === 0) return;

    // stabilize layout first
    lines.forEach(ensurePlaceholders);

    const snapshot = await loadSnapshotAny();
    const sectionMap = normalizeSectionMap(snapshot);
	
// ===== MEDIA TRENDING BALANCED AUTO-COMBINE =====
(function(){
  if(!sectionMap)return;
  const existing=extractItems(sectionMap['media-trending']).filter(isFrontCandidate);

  const sourceKeys=['media-movie','media-drama','media-variety','media-music'];
  function recency(item){
    const t=item&&(item.publishedAt||item.releaseDate||item.createdAt||item.date);
    if(!t)return 0;
    const time=new Date(t).getTime();if(!Number.isFinite(time))return 0;
    const days=Math.max(0,(Date.now()-time)/86400000);
    return Math.max(0,1-(days/45));
  }
  function score(item){
    const views=Number(item&&(item.views||item.viewCount)||0);
    const popularity=Number(item&&(item.popularity||item.score||item.rankingScore)||0);
    const rating=Number(item&&(item.rating||item.voteAverage)||0);
    return (views*.5)+(popularity*.25)+(rating*.1)+(recency(item)*100*.15);
  }
  function dedupeKey(item){return String(item&&(item.contentId||item.id||item.video||item.url||item.link)||JSON.stringify(item||{}));}
  const seen=new Set(),lanes={};
  sourceKeys.forEach((key)=>{
    const list=extractItems(sectionMap[key]).filter(isFrontCandidate).map((item)=>Object.assign({},item,{_sectionKey:key}));
    list.sort((a,b)=>score(b)-score(a));
    lanes[key]=list.filter((item)=>{const id=dedupeKey(item);if(!id||seen.has(key+'|'+id))return false;seen.add(key+'|'+id);return true;});
  });

  // Movie and drama alternate at the front; variety/music are inserted regularly.
  // This prevents a high-score movie batch from monopolising the "latest" row.
  const pattern=['media-movie','media-drama','media-movie','media-drama','media-variety','media-music'];
  const cursors=Object.fromEntries(sourceKeys.map((key)=>[key,0]));
  const used=new Set(),mixed=[];
  let safety=0;
  while(mixed.length<50&&safety++<400){
    let progressed=false;
    for(const key of pattern){
      const lane=lanes[key]||[];
      while(cursors[key]<lane.length){
        const item=lane[cursors[key]++],id=dedupeKey(item);
        if(used.has(id))continue;
        used.add(id);mixed.push(item);progressed=true;break;
      }
      if(mixed.length>=50)break;
    }
    if(!progressed)break;
  }
  // Keep curated/latest items too, but only after the balanced movie/drama lead.
  // When movie+drama lanes exist, the first row can no longer collapse into movies only.
  for(const item of existing){
    const id=dedupeKey(item);
    if(!id||used.has(id))continue;
    used.add(id);mixed.push(item);
    if(mixed.length>=50)break;
  }
  // If the category lanes are temporarily empty, preserve an existing curated trending list.
  if(!mixed.length&&existing.length)mixed.push(...existing.slice(0,50));
  sectionMap['media-trending']={items:mixed.slice(0,50)};
})();

    // hero
    const heroRotateFrom = snapshot && snapshot.hero && (snapshot.hero.rotateFrom || snapshot.hero.source);
    await applyHero(heroRotateFrom, sectionMap);

    // sections
    for(const line of lines){
      const key = canonKey(line.getAttribute('data-psom-key') || '');
      if(!key || key.indexOf('media-') !== 0) continue;

      let items = extractItems(sectionMap[key]);
      if(!items || items.length === 0){
        items = await loadFeedItems(key);
      }
      applyLine(line, items);
    }
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', main);
  else main();

  window.__IGDC_MEDIAHUB_AUTOMAP_VERSION__='3.3.2-fast-deferred-thumb-sample-lock-playback-quarantine';
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
