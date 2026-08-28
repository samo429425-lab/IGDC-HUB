/**
 * mediahub-automap.v3.js (PRODUCTION SAFE / SINGLE VERSION)
 * ------------------------------------------------------------
 * 목적:
 *  - MediaHub 메인 10섹션(data-psom-key="media-*")에 "미디어 콘텐츠"를 슬롯-우선(slot-first)으로 꽂는다.
 *  - 우선순위: /data/media.snapshot*.json 단일 경로(feed-media legacy fallback 비활성)
 *  - 데이터 없으면 HTML 더미(placeholder) 유지 (파괴/삭제 금지)
 *  - 모든 섹션 카드 수: 50 고정(부족하면 placeholder 추가)
 *  - 우측 패널 없음(처리하지 않음)
 *  - Hero는 프론트에 실제 렌더링된 영화/드라마 카드 1개의 고화질 대표 이미지만 사용한다.
 *  - 저해상도 카드 썸네일 확대는 금지하며, 실제 1280x720+ 이미지 또는 원본 HD 영상의 선명한 프레임만 허용한다.
 */
(function () {
  'use strict';

  if (window.__MEDIAHUB_AUTOMAP_V3_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V3_PROD__ = true;

  const D = document;

  const LIMIT = 50;
  const SAMPLE_IMAGE = '/assets/images/media-sample-card.png';
  const HERO_MIN_WIDTH = 1280;
  const HERO_MIN_HEIGHT = 720;
  const HERO_ROTATE_WINDOW_DAYS = 3;
  const HERO_ROTATE_TOP_POOL = 3;
  const HERO_MIN_EDGE_MEAN = 4.8;
  const HERO_MIN_EDGE_P90 = 15;
  const HERO_CAPTURE_TARGET_LIMIT = 8;

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
    // Never abort the front snapshot because it is merely slow. A slow snapshot
    // must be allowed to finish; only an actual HTTP/network failure falls
    // through to the next snapshot candidate.
    const r = await fetch(url, { cache: 'default', credentials: 'same-origin' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
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
    if(Array.isArray(section)) return section;
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
      // Queue-yield only: a slow source is deferred, never rejected.
      const timeout=setTimeout(()=>finish(null),8000);
      function clean(){clearTimeout(timeout);try{video.pause();video.removeAttribute('src');video.load();video.remove();}catch(_e){}}
      function finish(value){if(done)return;done=true;clean();resolve(value);}
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
      // This timer only yields the recovery queue. null means "still pending";
      // it is never treated as a rejection or permanent failure.
      const timer=setTimeout(()=>finish(null),Math.max(5000,Number(timeoutMs)||5000));
      function finish(ok){if(done)return;done=true;clearTimeout(timer);probe.onload=null;probe.onerror=null;resolve(ok);}
      probe.onload=function(){finish(probe.naturalWidth>=120&&probe.naturalHeight>=68);};
      probe.onerror=function(){finish(false);};
      probe.decoding='async';probe.src=url;
    });
  }
  function clearMediaDataset(a){
    ['provider','mediaTitle','igdcContentId','contentId','mediaSource','captions','windowsPlayerUrl','androidPlayerUrl','maruAppUrl','thumbPending','thumbRecovery','autoThumbQueued','autoThumbSource','thumbPendingKind','frontOrder','frontPriority','thumbEager'].forEach((key)=>{try{delete a.dataset[key];}catch(_e){}});
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
    scheduleCompact(a);
  }
  function deferThumbnail(a,item,reason){
    if(!a||!item)return;
    resetAnchorToPlaceholder(a,reason||'thumbnail_pending');
    a.__igdcRecoveryItem=item;
    a.dataset.thumbPending='1';
    a.dataset.thumbPendingKind='deferred';
    a.dataset.thumbRecovery='1';
    scheduleCompact(a);
    // Do not loop aggressively. Retry later without turning elapsed time into
    // an eligibility gate. A later success promotes the card automatically.
    setTimeout(()=>{
      if(!a.isConnected||a.getAttribute('data-placeholder')!=='true')return;
      delete a.dataset.thumbRecoveryQueued;
      recoverThumbnail(a,item);
    },12000);
  }

  function quarantineItem(a,item,reason){
    resetAnchorToPlaceholder(a,reason||'thumbnail_unavailable');
    const record={
      contentId:ensureContentId(item),title:String(item&&item.title||''),source:mediaSourceForThumb(item),reason:reason||'thumbnail_unavailable',at:new Date().toISOString()
    };
    if(!thumbQuarantine.some((r)=>r.contentId&&r.contentId===record.contentId))thumbQuarantine.push(record);
    try{D.dispatchEvent(new CustomEvent('igdc:media-thumbnail-quarantine',{detail:record}));}catch(_e){}
    // If a high-ranked thumbnail is explicitly broken, immediately try
    // the next already-ranked real-thumbnail candidate instead of leaving a
    // Sample hole in the visible front group.
    setTimeout(()=>{ if(a&&a.isConnected&&a.getAttribute('data-placeholder')==='true') refillFromReserve(a); },0);
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
    try { a.dataset.frontPriority = String(Math.round(frontPriority(item))); } catch(_e) {}
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
    a.dataset.thumbPending='1';a.dataset.thumbPendingKind='ready';
    img.alt=title||'';img.loading='lazy';img.decoding='async';img.dataset.autoThumbResolved='1';
    // Keep the blue MEDIA SAMPLE artwork visible until a real thumbnail has
    // actually loaded and passed validation. Off-screen cards do not start
    // network thumbnail work at all; this avoids large request bursts at boot.
    let settled=false,watcher=null,loader=null,loadStarted=false;
    function stopWatch(){if(watcher){try{watcher.disconnect();}catch(_e){}watcher=null;}}
    function activate(){if(settled||!a.isConnected)return;settled=true;stopWatch();img.src=thumb;thumbBox.classList.remove('ph');meta.textContent=title;a.removeAttribute('data-placeholder');delete a.dataset.thumbPending;delete a.dataset.thumbPendingKind;delete a.dataset.thumbRecovery;delete a.dataset.thumbQuarantineReason;scheduleCompact(a);try{D.dispatchEvent(new CustomEvent('igdc:media-thumbnail-ready',{detail:{card:a,item:item}}));}catch(_e){}}
    function fail(reason){if(settled)return;settled=true;stopWatch();if(loader){try{loader.onload=null;loader.onerror=null;}catch(_e){}loader=null;}if(a.dataset.thumbRecovery==='1'){quarantineItem(a,item,reason||'thumbnail_recovery_failed');return;}resetAnchorToPlaceholder(a,reason||'thumbnail_load_failed');recoverThumbnail(a,item);}
    function beginLoad(){
      if(settled||loadStarted||!a.isConnected)return;loadStarted=true;
      loader=new Image();loader.decoding='async';
      try{if(a.dataset.thumbEager==='1'&&'fetchPriority' in loader)loader.fetchPriority='high';}catch(_e){}
      loader.onload=function(){if(settled)return;if(loader.naturalWidth>=120&&loader.naturalHeight>=68)activate();else fail('thumbnail_too_small');};
      loader.onerror=function(){fail('thumbnail_load_failed');};
      loader.src=thumb;
      if(loader.complete){if(loader.naturalWidth>=120&&loader.naturalHeight>=68)activate();else if(loader.naturalWidth===0)fail('thumbnail_load_failed');}
    }
    if(a.dataset.thumbEager==='1'){
      // First-screen cards should start immediately instead of waiting for the
      // next IntersectionObserver turn. This improves perceived front render
      // without waking every off-screen thumbnail request.
      if(typeof requestAnimationFrame==='function') requestAnimationFrame(beginLoad); else setTimeout(beginLoad,0);
    }else if('IntersectionObserver' in window){
      // Pre-warm only cards that are close vertically AND horizontally. The
      // larger vertical margin prepares the next rows while horizontal margin
      // keeps request bursts bounded to the first visible cards in each rail.
      watcher=new IntersectionObserver((entries)=>{for(const entry of entries){if(entry.isIntersecting){watcher.disconnect();watcher=null;beginLoad();break;}}},{root:null,rootMargin:'900px 360px',threshold:.01});watcher.observe(a);
    }else setTimeout(beginLoad,0);
    return true;
  }
  function runAutoThumbQueue(){
    if(autoThumbBusy||!autoThumbQueue.length)return;
    autoThumbBusy=true;
    const job=autoThumbQueue.shift();
    captureVisibleVideoFrame(job.source).then((dataUrl)=>{
      if(dataUrl&&job.card&&job.card.isConnected){job.card.dataset.thumbRecovery='1';bindItemToAnchor(job.card,job.item,dataUrl);}
      else if(dataUrl===null&&job.card&&job.card.isConnected)deferThumbnail(job.card,job.item,'thumbnail_capture_deferred');
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
      const raw=safeFrontThumbnail(rawThumbnail(item));
      if(raw){
        const rawState=await preflightImage(raw,5000);
        if(rawState===true){if(card.isConnected)bindItemToAnchor(card,item,raw);return;}
        if(rawState===null){if(card.isConnected)deferThumbnail(card,item,'thumbnail_load_deferred');return;}
      }
      const providerCandidates=providerThumbnailCandidates(item);
      let providerDeferred=false;
      for(const candidate of providerCandidates){
        const providerState=await preflightImage(candidate,5000);
        if(providerState===true){if(card.isConnected)bindItemToAnchor(card,item,candidate);return;}
        if(providerState===null)providerDeferred=true;
      }
      if(providerDeferred){if(card.isConnected)deferThumbnail(card,item,'provider_thumbnail_deferred');return;}
      const source=mediaSourceForThumb(item);
      if(directVideoForThumb(source)){
        const dataUrl=await captureVisibleVideoFrame(source);
        if(dataUrl&&card.isConnected){card.dataset.thumbRecovery='1';bindItemToAnchor(card,item,dataUrl);return;}
        if(dataUrl===null&&card.isConnected){deferThumbnail(card,item,'thumbnail_capture_deferred');return;}
        if(card.isConnected)quarantineItem(card,item,'thumbnail_capture_failed');return;
      }
      if(card.isConnected)quarantineItem(card,item,'thumbnail_unavailable');
    } finally {recoveryBusy=false;setTimeout(runRecoveryQueue,0);}
  }
  function recoverThumbnail(card,item){
    if(!card||!item)return;
    if(isSyntheticSampleItem(item)){resetAnchorToPlaceholder(card,'sample_slot');return;}
    card.dataset.thumbPending='1';card.dataset.thumbPendingKind='recovery';card.dataset.thumbRecovery='1';
    if('IntersectionObserver' in window){
      if(!recoveryObserver)recoveryObserver=new IntersectionObserver((entries)=>{entries.forEach((entry)=>{if(!entry.isIntersecting)return;const el=entry.target;recoveryObserver.unobserve(el);enqueueRecovery(el,el.__igdcRecoveryItem);});},{root:null,rootMargin:'220px 0px',threshold:.01});
      card.__igdcRecoveryItem=item;recoveryObserver.observe(card);
    }else setTimeout(()=>enqueueRecovery(card,item),0);
  }
  function playbackMarkedUnavailable(item){
    if(!item)return true;
    const status=String(item.playbackStatus||item.sourceStatus||item.playabilityStatus||'').trim().toLowerCase();
    // Only explicit hard failures are excluded. "slow", "timeout", "pending"
    // and false-ready flags remain candidates and are simply ranked later.
    return /(?:failed|unplayable|unavailable|blocked|broken|invalid|error|denied|forbidden)/.test(status);
  }
  function isFrontCandidate(item){
    if(!item||isSyntheticSampleItem(item)||playbackMarkedUnavailable(item))return false;
    const title=String(item.title||item.name||item.text||'').trim();
    const source=mediaSourceForThumb(item);
    const id=ensureContentId(item);
    return !!(title&&source&&id);
  }

  function numeric(item, keys){
    for(const key of keys){
      const value=Number(item&&item[key]);
      if(Number.isFinite(value))return value;
    }
    return 0;
  }
  function thumbnailReadyScore(item){
    const thumb=safeFrontThumbnail(rawThumbnail(item));
    if(!thumb)return 0;
    let score=700;
    if(item&&(item.thumbnailVerified===true||item.thumbVerified===true||item.thumbnailReady===true||item.frontThumbnailReady===true))score+=220;
    const status=String(item&&(item.thumbnailStatus||item.thumbStatus||item.imageStatus)||'').toLowerCase();
    if(/(?:verified|ready|approved|valid|ok)/.test(status))score+=140;
    if(/(?:failed|invalid|broken|blocked|error)/.test(status))score-=900;
    else if(/(?:slow|timeout|pending|processing|queued)/.test(status))score-=70;
    const w=numeric(item,['thumbnailWidth','thumbWidth','imageWidth']);
    const h=numeric(item,['thumbnailHeight','thumbHeight','imageHeight']);
    if(w>=640&&h>=360)score+=100; else if(w>=320&&h>=180)score+=50;
    return score;
  }
  function playbackReadyScore(item){
    if(playbackMarkedUnavailable(item))return -3000;
    let score=300;
    if(item&&(item.playbackReady===true||item.frontPlaybackReady===true||item.sourceReady===true||item.playable===true))score+=180;
    const latency=numeric(item,['playbackLatencyMs','probeLatencyMs','latencyMs','loadLatencyMs']);
    if(latency>0){if(latency<=1200)score+=120;else if(latency<=2500)score+=60;else if(latency>5000)score-=70;}
    const status=String(item&&(item.playbackStatus||item.sourceStatus||item.playabilityStatus)||'').toLowerCase();
    if(/(?:ready|verified|approved|playable|ok)/.test(status))score+=100;
    else if(/(?:slow|timeout|pending|processing|queued)/.test(status))score-=45;
    return score;
  }
  function recencyScore(item){
    const raw=item&&(item.publishedAt||item.releaseDate||item.createdAt||item.updatedAt||item.date);
    if(!raw)return 0;
    const time=new Date(raw).getTime();if(!Number.isFinite(time))return 0;
    const days=Math.max(0,(Date.now()-time)/86400000);
    return Math.max(0,160-(days*3));
  }
  function engagementScore(item){
    const views=numeric(item,['views','viewCount']);
    const popularity=numeric(item,['popularity','score','rankingScore','qualityScore']);
    const rating=numeric(item,['rating','voteAverage']);
    const metrics=item&&item.metrics&&typeof item.metrics==='object'?item.metrics:{};
    const watch=Number(metrics.watchTime||0), likes=Number(metrics.like||0), recommends=Number(metrics.recommend||0);
    return Math.min(220,Math.log10(Math.max(1,views))*28)+Math.min(160,popularity*2)+Math.min(90,rating*9)+Math.min(90,Math.log10(Math.max(1,watch+likes+recommends))*18);
  }
  function frontPriority(item){
    return thumbnailReadyScore(item)+playbackReadyScore(item)+recencyScore(item)+engagementScore(item);
  }

  function renderedHeroThumbnail(item){
    const wanted=String(ensureContentId(item)||'');
    if(!wanted)return '';
    const card=qa('a.card.media-card[data-content-id],a.card.media-card[data-igdc-content-id]').find((el)=>
      String(el.dataset.contentId||el.dataset.igdcContentId||'')===wanted && el.getAttribute('data-placeholder')!=='true'
    );
    const img=card&&q('img',card);
    if(!img||!img.naturalWidth||!img.naturalHeight)return '';
    return safeFrontThumbnail(img.currentSrc||img.src||'');
  }
  function heroImageCandidates(item){
    if(!item||isSyntheticSampleItem(item))return [];
    const values=[
      item.heroImage,item.heroImageUrl,item.heroThumbnail,item.heroThumb,
      item.backdrop,item.backdropUrl,item.backdropImage,item.backdropPath,
      item.highResThumbnail,item.thumbnailHigh,item.thumbnailHD,item.hdThumbnail,
      item.maxresThumbnail,item.largeThumbnail,item.thumbnailLarge,
      item.image1920,item.image1280,item.coverImage,item.coverUrl,
      renderedHeroThumbnail(item),rawThumbnail(item)
    ];
    const source=mediaSourceForThumb(item),yt=youtubeIdForThumb(source)||youtubeIdForThumb(rawThumbnail(item));
    if(yt){
      const enc=encodeURIComponent(yt);
      // Hero only: try the high-resolution provider assets first. These are
      // dimension-checked before use, so YouTube's tiny fallback placeholder
      // can never be blown up into the hero.
      values.push(
        'https://i.ytimg.com/vi/'+enc+'/maxresdefault.jpg',
        'https://i.ytimg.com/vi/'+enc+'/sddefault.jpg',
        'https://i.ytimg.com/vi/'+enc+'/hqdefault.jpg'
      );
    }
    const seen=new Set(),out=[];
    for(const value of values){
      const url=safeFrontThumbnail(value);
      if(!url||seen.has(url))continue;
      seen.add(url);out.push(url);
    }
    return out;
  }
  function heroRankScore(item){
    // Hero ranking is intentionally independent from rail order. It combines
    // front readiness, popularity/ranking, recency and quality so the hero is
    // never just "the first card in a section".
    let score=frontPriority(item);
    const rank=numeric(item,['heroScore','rankingScore','qualityScore','score','popularity']);
    const views=numeric(item,['views','viewCount']);
    const rating=numeric(item,['rating','voteAverage']);
    const w=numeric(item,['heroWidth','backdropWidth','thumbnailWidth','thumbWidth','imageWidth']);
    const h=numeric(item,['heroHeight','backdropHeight','thumbnailHeight','thumbHeight','imageHeight']);
    const hasDedicatedHero=!!(item&&(item.heroImage||item.heroImageUrl||item.heroThumbnail||item.heroThumb||item.backdrop||item.backdropUrl||item.backdropImage||item.highResThumbnail||item.thumbnailHD||item.hdThumbnail||item.maxresThumbnail||item.image1920||item.image1280));
    score+=Math.min(560,rank*4.5)+Math.min(220,Math.log10(Math.max(1,views))*30)+Math.min(110,rating*11)+(hasDedicatedHero?520:0);
    if(w>=1920&&h>=1080)score+=420;
    else if(w>=1280&&h>=720)score+=280;
    else if(w>=960&&h>=540)score+=150;
    return score;
  }
  function heroResolutionTier(w,h){
    w=Number(w||0);h=Number(h||0);
    if(w>=1920&&h>=1080)return 3;
    if(w>=1280&&h>=720)return 2;
    if(w>=960&&h>=540)return 1;
    return 0;
  }

  // V50 hero policy: select only from movie/drama content already rendered
  // successfully on the front rails. Priority: 1) freshness, 2) ranking/hotness,
  // 3) verified image quality. Hero image floor is a hard 1280x720.
  function heroFreshnessDay(item){
    if(!item)return 0;
    const raw=item.publishedAt||item.published_at||item.releaseDate||item.release_date||item.createdAt||item.created_at||item.updatedAt||item.updated_at||item.premiereDate||item.premieredAt||item.date;
    if(raw===undefined||raw===null||raw==='')return 0;
    let t=0;
    if(typeof raw==='number'&&Number.isFinite(raw)){
      t=raw<100000000000?raw*1000:raw;
    }else{
      const parsed=new Date(raw).getTime();
      if(Number.isFinite(parsed))t=parsed;
    }
    return t>0?Math.floor(t/86400000):0;
  }
  function heroPopularityMetric(item){
    if(!item)return 0;
    const score=numeric(item,['heroScore','rankingScore','rankScore','popularity','score','qualityScore','trendScore','hotScore']);
    const position=numeric(item,['rank','ranking','rankPosition','position']);
    const views=numeric(item,['views','viewCount']);
    const rating=numeric(item,['rating','voteAverage']);
    const metrics=item.metrics&&typeof item.metrics==='object'?item.metrics:{};
    const likes=Number(metrics.like||metrics.likes||item.likes||item.likeCount||0);
    const recommends=Number(metrics.recommend||metrics.recommends||item.recommendCount||0);
    const watch=Number(metrics.watchTime||item.watchTime||0);
    const rankPositionBonus=position>0?Math.max(0,12000-(Math.min(position,1200)*10)):0;
    return (score*1000)+rankPositionBonus+(Math.log10(Math.max(1,views))*260)+(rating*80)+(Math.log10(Math.max(1,likes+recommends+watch))*120);
  }
  function heroQualityMetric(w,h,visual){
    w=Number(w||0);h=Number(h||0);
    if(w<HERO_MIN_WIDTH||h<HERO_MIN_HEIGHT)return -1;
    const base=Math.min(40000000,w*h);
    const edge=visual&&Number.isFinite(Number(visual.edgeMean))?Number(visual.edgeMean):0;
    const p90=visual&&Number.isFinite(Number(visual.edgeP90))?Number(visual.edgeP90):0;
    return base+(edge*160000)+(p90*30000);
  }
  function heroVisualQualityFromPixels(data,w,h){
    try{
      if(!data||!data.length||!w||!h)return null;
      const lum=new Float32Array(w*h);let sum=0,sum2=0;
      for(let i=0,p=0;i<data.length;i+=4,p++){
        const y=(data[i]*.2126)+(data[i+1]*.7152)+(data[i+2]*.0722);
        lum[p]=y;sum+=y;sum2+=y*y;
      }
      const count=lum.length;if(!count)return null;
      const mean=sum/count,variance=Math.max(0,(sum2/count)-(mean*mean));
      let edgeSum=0,edgeCount=0;const edgeSamples=[];
      for(let y=1;y<h;y+=2){
        const row=y*w,prev=(y-1)*w;
        for(let x=1;x<w;x+=2){
          const v=lum[row+x];
          const e=(Math.abs(v-lum[row+x-1])+Math.abs(v-lum[prev+x]))*.5;
          edgeSum+=e;edgeCount++;
          if(edgeSamples.length<5000)edgeSamples.push(e);
        }
      }
      edgeSamples.sort((a,b)=>a-b);
      const p90=edgeSamples.length?edgeSamples[Math.min(edgeSamples.length-1,Math.floor(edgeSamples.length*.90))]:0;
      const edgeMean=edgeCount?edgeSum/edgeCount:0;
      const usable=mean>12&&mean<244&&variance>120;
      const sharp=usable&&(edgeMean>=HERO_MIN_EDGE_MEAN||p90>=HERO_MIN_EDGE_P90);
      return{mean,variance,edgeMean,edgeP90:p90,usable,sharp};
    }catch(_e){return null;}
  }
  function heroVisualQualityFromCanvas(ctx,w,h){
    try{
      const SW=320,SH=180,sample=D.createElement('canvas'),sx=sample.getContext('2d',{alpha:false});
      if(!sx)return null;sample.width=SW;sample.height=SH;
      sx.drawImage(ctx.canvas,0,0,w,h,0,0,SW,SH);
      return heroVisualQualityFromPixels(sx.getImageData(0,0,SW,SH).data,SW,SH);
    }catch(_e){return null;}
  }
  function heroVisualQualityFromImage(img){
    try{
      const SW=320,SH=180,c=D.createElement('canvas'),ctx=c.getContext('2d',{alpha:false});
      if(!ctx)return null;c.width=SW;c.height=SH;
      const iw=Number(img.naturalWidth||0),ih=Number(img.naturalHeight||0);
      if(iw<HERO_MIN_WIDTH||ih<HERO_MIN_HEIGHT)return null;
      const r=Math.max(SW/iw,SH/ih),sw=SW/r,sh=SH/r,sx=(iw-sw)/2,sy=(ih-sh)/2;
      ctx.drawImage(img,sx,sy,sw,sh,0,0,SW,SH);
      return heroVisualQualityFromPixels(ctx.getImageData(0,0,SW,SH).data,SW,SH);
    }catch(_e){return null;}
  }
  function heroPreProbeCompare(a,b){
    const ar=heroPopularityMetric(a&&a.item),br=heroPopularityMetric(b&&b.item);
    if(ar!==br)return br-ar;
    const ad=heroFreshnessDay(a&&a.item),bd=heroFreshnessDay(b&&b.item);
    if(ad!==bd)return bd-ad;
    const ah=Number(a&&a.hint||0),bh=Number(b&&b.hint||0);
    if(ah!==bh)return bh-ah;
    return Number(b&&b.score||0)-Number(a&&a.score||0);
  }
  function heroResolvedCompare(a,b){
    const ar=Number(a&&a.popularityMetric||heroPopularityMetric(a&&a.item)),br=Number(b&&b.popularityMetric||heroPopularityMetric(b&&b.item));
    if(ar!==br)return br-ar;
    const ad=Number(a&&a.freshnessDay||heroFreshnessDay(a&&a.item)),bd=Number(b&&b.freshnessDay||heroFreshnessDay(b&&b.item));
    if(ad!==bd)return bd-ad;
    const aq=Number(a&&a.qualityMetric||heroQualityMetric(a&&a.w,a&&a.h,a&&a.visual)),bq=Number(b&&b.qualityMetric||heroQualityMetric(b&&b.w,b&&b.h,b&&b.visual));
    if(aq!==bq)return bq-aq;
    return Number(b&&b.finalScore||0)-Number(a&&a.finalScore||0);
  }
  function heroResolutionHint(item,url,index){
    const w=numeric(item,['heroWidth','backdropWidth','thumbnailWidth','thumbWidth','imageWidth']);
    const h=numeric(item,['heroHeight','backdropHeight','thumbnailHeight','thumbHeight','imageHeight']);
    const heroUrl=String(item&&(item.heroImage||item.heroImageUrl||item.heroThumbnail||item.heroThumb)||'');
    if(item&&item.heroSharpVerified===true&&heroUrl&&String(url||'')===heroUrl&&w>=HERO_MIN_WIDTH&&h>=HERO_MIN_HEIGHT)return 3;
    const tier=heroResolutionTier(w,h);
    if(tier)return tier;
    const text=String(url||'').toLowerCase();
    if(/(?:maxres|1920|1080|fullhd|full-hd)/.test(text)||item.image1920||item.maxresThumbnail)return 3;
    if(/(?:1280|720|hd|sddefault)/.test(text)||item.image1280||item.thumbnailHD||item.hdThumbnail||item.highResThumbnail)return 2;
    if(index===0&&(item.heroImage||item.heroImageUrl||item.backdrop||item.backdropUrl||item.backdropImage))return 2;
    return 1;
  }
  function heroPlaybackCard(item,heroImg){
    const wanted=String(ensureContentId(item)||'');
    if(wanted){
      const existing=qa('a.card.media-card[data-content-id],a.card.media-card[data-igdc-content-id]').find((card)=>
        String(card.dataset.contentId||card.dataset.igdcContentId||'')===wanted && card.getAttribute('data-placeholder')!=='true'
      );
      if(existing)return existing;
    }
    const card=D.createElement('a');
    card.className='card media-card igdc-hero-playback-card';
    card.href='javascript:void(0)';
    card.dataset.mediaTitle=String(item&&((item.title||item.name||item.text)||'')||'');
    if(wanted){card.dataset.contentId=wanted;card.dataset.igdcContentId=wanted;}
    const source=mediaSourceForThumb(item);
    if(source)card.dataset.mediaSource=String(source);
    if(item&&item.provider)card.dataset.provider=typeof item.provider==='object'?String(item.provider.name||item.provider.platform||''):String(item.provider);
    if(item){
      const captions=item.captions||item.subtitleTracks||item.subtitles;
      if(Array.isArray(captions)&&captions.length){try{card.dataset.captions=JSON.stringify(captions);}catch(_e){}}
      if(item.windowsPlayerUrl)card.dataset.windowsPlayerUrl=String(item.windowsPlayerUrl);
      if(item.androidPlayerUrl)card.dataset.androidPlayerUrl=String(item.androidPlayerUrl);
      if(item.maruAppUrl)card.dataset.maruAppUrl=String(item.maruAppUrl);
    }
    const image=D.createElement('img');
    image.src=String(heroImg&&heroImg.currentSrc||heroImg&&heroImg.src||rawThumbnail(item)||'');
    image.alt=card.dataset.mediaTitle||'';
    card.appendChild(image);
    card.__igdcMediaItem=item;
    return card;
  }
  function heroCaptionText(item){
    const title=String(item&&((item.title||item.name||item.text)||'')||'').trim();
    const provider=item&&item.provider?(typeof item.provider==='object'?String(item.provider.name||item.provider.platform||''):String(item.provider)):'';
    const rawDate=item&&(item.publishedAt||item.releaseDate||item.premiereDate||item.date||'');
    let dateText='';
    if(rawDate){
      const d=new Date(rawDate);
      if(Number.isFinite(d.getTime()))dateText=String(d.getFullYear());
    }
    const detail=[provider.trim(),dateText].filter(Boolean).join(' · ');
    return{title,detail};
  }
  function updateHeroCaption(hero,item){
    if(!hero||!item)return;
    let caption=q('.igdc-media-hero-caption',hero);
    if(!caption){
      caption=D.createElement('div');
      caption.className='igdc-media-hero-caption';
      caption.setAttribute('aria-hidden','true');
      caption.setAttribute('dir','auto');
      caption.style.cssText='position:absolute;left:0;right:0;bottom:0;z-index:3;padding:28px 24px 18px;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.78));color:#fff;pointer-events:none;box-sizing:border-box;text-align:start;';
      const title=D.createElement('div');title.className='igdc-media-hero-title';title.style.cssText='font-size:clamp(18px,2.2vw,32px);font-weight:800;line-height:1.15;text-shadow:0 1px 3px rgba(0,0,0,.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      const detail=D.createElement('div');detail.className='igdc-media-hero-detail';detail.style.cssText='margin-top:6px;font-size:clamp(12px,1.1vw,15px);font-weight:600;opacity:.92;text-shadow:0 1px 2px rgba(0,0,0,.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      caption.appendChild(title);caption.appendChild(detail);hero.appendChild(caption);
    }
    const text=heroCaptionText(item);
    const titleEl=q('.igdc-media-hero-title',caption),detailEl=q('.igdc-media-hero-detail',caption);
    if(titleEl)titleEl.textContent=text.title;
    if(detailEl){detailEl.textContent=text.detail;detailEl.style.display=text.detail?'block':'none';}
  }
  function bindHeroPlayback(heroImg,item){
    if(!heroImg||!item)return;
    const hero=heroImg.closest&&heroImg.closest('.hero');
    const title=String(item.title||item.name||item.text||'').trim();
    const target=hero||heroImg;
    target.setAttribute('role','button');
    target.setAttribute('tabindex','0');
    target.setAttribute('aria-label',title||'Media');
    target.style.cursor='pointer';
    target.dataset.igdcHeroPlayable='true';
    heroImg.dataset.igdcHeroPlayable='true';
    updateHeroCaption(hero,item);
    function play(event){
      if(event){event.preventDefault();event.stopPropagation();}
      const card=heroPlaybackCard(item,heroImg);
      // When the same content is already rendered in Movie/Drama, route the hero
      // through the exact card click handler. This keeps web/mobile/OTT behavior
      // identical to tapping the rail card itself.
      if(card&&card.isConnected&&!card.classList.contains('igdc-hero-playback-card')&&typeof card.click==='function'){
        card.click();
        return false;
      }
      const player=window.IGDCMediaHubPlayback;
      if(!player||typeof player.open!=='function')return false;
      player.open(card,{autoPlay:true,autoFullscreen:true});
      return false;
    }
    target.onclick=play;
    target.onkeydown=function(event){
      if(event&&(event.key==='Enter'||event.key===' '||event.code==='Space')){event.preventDefault();play(event);}
    };
  }
  function captureHeroFrameForItem(item){
    if(!item)return Promise.resolve(null);
    const source=mediaSourceForThumb(item);
    if(!directVideoForThumb(source))return Promise.resolve(null);
    const key=heroItemKey(item)||source;
    if(heroRuntime.frameCaptureCache.has(key))return heroRuntime.frameCaptureCache.get(key);
    const promise=new Promise((resolve)=>{
      const video=D.createElement('video');let done=false,targetIndex=0,best=null,targets=[];
      const timer=setTimeout(()=>finish(best),14000);
      function clean(){clearTimeout(timer);try{video.pause();video.removeAttribute('src');video.load();video.remove();}catch(_e){}}
      function finish(value){if(done)return;done=true;clean();resolve(value&&value.visual&&value.visual.sharp?value:null);}
      function buildTargets(){
        const d=Number(video.duration),raw=[3,10];
        if(Number.isFinite(d)&&d>12)raw.push(d*.12,d*.28,d*.45,d*.62,d*.78,d*.88);
        const seen=new Set();targets=raw.map((t)=>Number(t)).filter((t)=>Number.isFinite(t)&&t>=.05).map((t)=>Number.isFinite(d)&&d>0?Math.min(t,Math.max(.2,d-.25)):t).filter((t)=>{const k=t.toFixed(2);if(seen.has(k))return false;seen.add(k);return true;}).slice(0,HERO_CAPTURE_TARGET_LIMIT);
      }
      function seekNext(){
        if(targetIndex>=targets.length){finish(best);return;}
        const t=targets[targetIndex++];
        try{video.currentTime=Math.max(.05,t);}catch(_e){finish(best);}
      }
      video.onloadedmetadata=function(){
        // Never turn an SD source into a fake HD hero by upscaling the canvas.
        if(Number(video.videoWidth||0)<HERO_MIN_WIDTH||Number(video.videoHeight||0)<HERO_MIN_HEIGHT){finish(null);return;}
        buildTargets();seekNext();
      };
      video.onseeked=function(){
        if(Number(video.videoWidth||0)<HERO_MIN_WIDTH||Number(video.videoHeight||0)<HERO_MIN_HEIGHT){finish(null);return;}
        try{
          const c=D.createElement('canvas'),ctx=c.getContext('2d',{alpha:false});
          if(!ctx){finish(best);return;}
          const CW=1280,CH=720;c.width=CW;c.height=CH;
          const r=Math.max(CW/video.videoWidth,CH/video.videoHeight);
          const sw=CW/r,sh=CH/r,sx=(video.videoWidth-sw)/2,sy=(video.videoHeight-sh)/2;
          ctx.imageSmoothingEnabled=true;if('imageSmoothingQuality' in ctx)ctx.imageSmoothingQuality='high';
          ctx.drawImage(video,sx,sy,sw,sh,0,0,CW,CH);
          const visual=heroVisualQualityFromCanvas(ctx,CW,CH);
          if(visual&&visual.usable){
            const score=(Number(visual.edgeMean||0)*10)+Number(visual.edgeP90||0)+(Math.sqrt(Math.max(0,Number(visual.variance||0)))*.12);
            if(!best||score>best.score){best={url:c.toDataURL('image/jpeg',.94),w:CW,h:CH,visual,score,sourceWidth:Number(video.videoWidth||0),sourceHeight:Number(video.videoHeight||0)};}
          }
        }catch(_e){}
        seekNext();
      };
      video.onerror=function(){finish(best);};
      video.crossOrigin='anonymous';video.muted=true;video.playsInline=true;video.preload='metadata';
      video.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px';
      (D.body||D.documentElement).appendChild(video);video.src=source;video.load();
    });
    heroRuntime.frameCaptureCache.set(key,promise);
    return promise;
  }
  function probeHeroImage(url, timeoutMs){
    return new Promise((resolve)=>{
      if(!safeFrontThumbnail(url)){resolve(null);return;}
      const img=new Image();let done=false;
      const timer=setTimeout(()=>finish(null),Math.max(900,Number(timeoutMs)||4500));
      function finish(value){if(done)return;done=true;clearTimeout(timer);img.onload=null;img.onerror=null;resolve(value);}
      img.onload=function(){
        const w=Number(img.naturalWidth||0),h=Number(img.naturalHeight||0);
        if(w<HERO_MIN_WIDTH||h<HERO_MIN_HEIGHT){finish(null);return;}
        const visual=heroVisualQualityFromImage(img);
        finish({url,w,h,visual});
      };
      img.onerror=function(){finish(null);};
      img.decoding='async';
      try{if('fetchPriority' in img)img.fetchPriority='low';}catch(_e){}
      img.src=url;
      if(img.complete&&img.naturalWidth){img.onload();}
    });
  }
  function thumbnailExplicitlyPending(item){
    if(!item)return false;
    if(item.thumbnailReady===false||item.thumbReady===false||item.frontThumbnailReady===false)return true;
    const status=String(item.thumbnailStatus||item.thumbStatus||item.imageStatus||'').trim().toLowerCase();
    return /(?:pending|generating|processing|queued|recovering|capture|creating)/.test(status);
  }
  function isTrendingReadyCandidate(item){
    return isFrontCandidate(item)&&!thumbnailExplicitlyPending(item)&&thumbnailReadyScore(item)>0&&playbackReadyScore(item)>0;
  }
  function compactLine(line){
    if(!line)return;
    const container=getContainer(line);
    const cards=qa('a.card',container);
    if(cards.length<2)return;
    const ranked=cards.map((card,index)=>({card,index})).sort((A,B)=>{
      const a=A.card,b=B.card;
      // Hard rule: a card is front-eligible only after a real thumbnail has
      // actually loaded and data-placeholder has been removed. Every Sample,
      // pending thumbnail, recovery item and quarantine slot stays behind all
      // verified/rendered cards.
      const pa=a.getAttribute('data-placeholder')==='true'?1:0;
      const pb=b.getAttribute('data-placeholder')==='true'?1:0;
      if(pa!==pb)return pa-pb;
      if(pa===0){
        const qaScore=Number(a.dataset.frontPriority||0),qbScore=Number(b.dataset.frontPriority||0);
        if(Number.isFinite(qaScore)&&Number.isFinite(qbScore)&&qaScore!==qbScore)return qbScore-qaScore;
      }
      const oa=Number(a.dataset.frontOrder),ob=Number(b.dataset.frontOrder);
      if(Number.isFinite(oa)&&Number.isFinite(ob)&&oa!==ob)return oa-ob;
      if(Number.isFinite(oa)&&!Number.isFinite(ob))return -1;
      if(!Number.isFinite(oa)&&Number.isFinite(ob))return 1;
      // Stable final tie-breaker so repeated compaction never oscillates.
      return A.index-B.index;
    }).map((row)=>row.card);
    let changed=false;for(let i=0;i<cards.length;i++){if(cards[i]!==ranked[i]){changed=true;break;}}
    if(!changed)return;
    ranked.forEach((card)=>container.appendChild(card));
  }
  function scheduleCompactLine(line){
    if(!line||line.__igdcCompactQueued)return;
    line.__igdcCompactQueued=true;
    requestAnimationFrame(()=>{line.__igdcCompactQueued=false;compactLine(line);});
  }
  function scheduleCompact(a){
    const line=a&&a.matches&&a.matches('.thumb-line[data-psom-key]')?a:(a&&a.closest&&a.closest('.thumb-line[data-psom-key]'));
    scheduleCompactLine(line);
  }
  function installReadyFirstCompactionWatch(){
    if(window.__IGDC_MEDIA_READY_FIRST_OBSERVER__)return;
    const observer=new MutationObserver((records)=>{
      const lines=new Set();
      for(const record of records){
        let node=record.target;
        if(node&&node.nodeType===1){
          const line=node.matches&&node.matches('.thumb-line[data-psom-key]')?node:(node.closest&&node.closest('.thumb-line[data-psom-key]'));
          if(line)lines.add(line);
        }
        if(record.addedNodes){
          record.addedNodes.forEach((added)=>{
            if(!added||added.nodeType!==1)return;
            const line=added.matches&&added.matches('.thumb-line[data-psom-key]')?added:(added.closest&&added.closest('.thumb-line[data-psom-key]'));
            if(line)lines.add(line);
          });
        }
      }
      lines.forEach(scheduleCompactLine);
    });
    observer.observe(D.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-placeholder','data-thumb-pending','data-thumb-pending-kind','data-thumb-recovery','data-front-priority','data-front-order']});
    window.__IGDC_MEDIA_READY_FIRST_OBSERVER__=observer;
  }

  function fillAnchor(a,item){
    return bindItemToAnchor(a,item,safeFrontThumbnail(rawThumbnail(item)));
  }

  function refillFromReserve(a){
    const line=a&&a.closest&&a.closest('.thumb-line[data-psom-key]');
    const queue=line&&line.__igdcFrontReserveQueue;
    if(!queue||!queue.length)return false;
    while(queue.length){
      const entry=queue.shift();
      if(!entry||!entry.item||!entry.thumb)continue;
      a.dataset.frontOrder=String(entry.order);
      bindItemToAnchor(a,entry.item,entry.thumb);
      return true;
    }
    return false;
  }

  function applyLine(line, items){
    if(!Array.isArray(items) || items.length === 0) return;
    const ph=ensurePlaceholders(line);
    const ranked=items.filter(isFrontCandidate).slice().sort((a,b)=>frontPriority(b)-frontPriority(a));
    const immediate=[],pending=[];
    const scanLimit=Math.max(LIMIT*3,LIMIT);
    for(const item of ranked){
      if(isSyntheticSampleItem(item))continue;
      const thumb=safeFrontThumbnail(rawThumbnail(item));
      // A URL by itself is not enough when the snapshot explicitly says the
      // thumbnail is still pending/generating. Such items stay behind the
      // already-renderable group until their thumbnail is actually ready.
      if(thumb&&!thumbnailExplicitlyPending(item))immediate.push({item,thumb});
      else if(thumb||providerThumbnailCandidates(item).length||directVideoForThumb(mediaSourceForThumb(item)))pending.push(item);
      if(immediate.length+pending.length>=scanLimit)break;
    }
    // Keep extra pre-ranked items with real thumbnail URLs as a reserve. A slot
    // whose thumbnail fails is refilled from here immediately, so valid content
    // behind it is never stranded behind a blue Sample card.
    line.__igdcFrontReserveQueue=immediate.slice(LIMIT).map((entry,index)=>({item:entry.item,thumb:entry.thumb,order:LIMIT+index}));
    let slot=0;
    const lineKey=canonKey(line.getAttribute('data-psom-key')||'');
    // Only the first visible cards of the first three rails are eager. All
    // other cards remain lazy/pre-warmed, preventing the old all-at-once burst.
    const eagerLimit=lineKey==='media-trending'?6:(lineKey==='media-movie'||lineKey==='media-drama'?4:0);
    for(const entry of immediate.slice(0,LIMIT)){
      if(slot>=ph.length||slot>=LIMIT)break;
      const card=ph[slot];
      card.dataset.frontOrder=String(slot);
      if(slot<eagerLimit)card.dataset.thumbEager='1';else delete card.dataset.thumbEager;
      bindItemToAnchor(card,entry.item,entry.thumb);
      slot++;
    }
    // Thumbnail-generation/recovery candidates are allowed only after every
    // ready-thumbnail candidate. They remain Sample placeholders until recovery
    // actually succeeds; compaction then promotes them ahead of all Samples.
    for(const item of pending){
      if(slot>=ph.length||slot>=LIMIT)break;
      const card=ph[slot];
      resetAnchorToPlaceholder(card,'thumbnail_pending');
      card.dataset.frontOrder=String(slot);
      recoverThumbnail(card,item);
      slot++;
    }
    compactLine(line);
  }

  function heroPendingPenalty(item){
    return thumbnailExplicitlyPending(item)?260:0;
  }

  // Hero is the expanded playback surface for an actual movie/drama card.
  // Trending is deliberately excluded because that rail also mixes variety/music.
  const HERO_ALLOWED_SECTIONS=new Set(['media-movie','media-drama']);
  const heroRuntime={
    rotateKeys:[],sectionMap:null,timer:null,running:false,rerun:false,
    currentItem:null,currentUrl:'',currentTier:-1,currentScore:-Infinity,
    failedUrls:new Set(),frameCaptureCache:new Map()
  };

  function heroItemKey(item){
    if(!item)return '';
    return String(ensureContentId(item)||mediaSourceForThumb(item)||rawThumbnail(item)||'').trim();
  }

  function heroPlayableSourceExists(item,card){
    if(card&&card.getAttribute&&card.getAttribute('data-placeholder')!=='true')return true;
    return !!mediaSourceForThumb(item);
  }

  function heroItemHasImage(item,card){
    if(card&&q('img',card))return true;
    const values=[
      item&&item.heroImage,item&&item.heroImageUrl,item&&item.heroThumbnail,item&&item.heroThumb,
      item&&item.backdrop,item&&item.backdropUrl,item&&item.backdropImage,item&&item.highResThumbnail,
      item&&item.thumbnailHD,item&&item.hdThumbnail,item&&item.maxresThumbnail,item&&item.image1920,
      item&&item.image1280,rawThumbnail(item)
    ];
    if(values.some((value)=>!!safeFrontThumbnail(value)))return true;
    return !!youtubeIdForThumb(mediaSourceForThumb(item));
  }

  function heroItemEligible(item,card){
    if(!item||isSyntheticSampleItem(item)||playbackMarkedUnavailable(item))return false;
    const title=String(item.title||item.name||item.text||(card&&card.dataset&&card.dataset.mediaTitle)||'').trim();
    const id=heroItemKey(item)||(card&&String(card.dataset.contentId||card.dataset.igdcContentId||''));
    if(!title||!id||!heroPlayableSourceExists(item,card))return false;
    return heroItemHasImage(item,card);
  }

  function renderedHeroRows(preferred){
    const rows=[];
    qa('a.card.media-card').forEach((card)=>{
      if(!card||card.getAttribute('data-placeholder')==='true')return;
      const line=card.closest&&card.closest('[data-psom-key^="media-"]');
      const section=canonKey(line&&line.getAttribute('data-psom-key')||'');
      if(!HERO_ALLOWED_SECTIONS.has(section))return;
      const img=q('img',card);
      if(!img||!img.naturalWidth||!img.naturalHeight)return;
      let item=card.__igdcMediaItem;
      if(!item){
        item={
          contentId:card.dataset.contentId||card.dataset.igdcContentId||'',
          title:card.dataset.mediaTitle||img.alt||'',
          video:card.dataset.mediaSource||'',
          thumbnail:img.currentSrc||img.src||''
        };
      }
      if(!heroItemEligible(item,card))return;
      rows.push({item,card,section,preferred:preferred.has(section),pending:false,domReady:true,
        renderedUrl:safeFrontThumbnail(img.currentSrc||img.src||''),renderedW:Number(img.naturalWidth||0),renderedH:Number(img.naturalHeight||0)});
    });
    return rows;
  }

  function snapshotHeroRows(preferred,sectionMap){
    const rows=[];
    const sectionKeys=Object.keys(sectionMap||{}).map(canonKey).filter((key)=>/^media-/.test(key));
    for(const key of sectionKeys){
      if(!HERO_ALLOWED_SECTIONS.has(key))continue;
      const items=extractItems(sectionMap[key]);
      for(const item of items.slice(0,120)){
        if(!heroItemEligible(item,null))continue;
        rows.push({item,card:null,section:key,preferred:preferred.has(key),pending:thumbnailExplicitlyPending(item),domReady:false,
          renderedUrl:'',renderedW:0,renderedH:0});
      }
    }
    return rows;
  }

  function mergeHeroRows(preferred,sectionMap){
    const merged=[],byKey=new Map();
    // Hero may only use cards that the Automap has already rendered successfully.
    // Snapshot-only rows are intentionally excluded so the hero itself can never
    // hide a broken rail mapping or bypass the normal front render path.
    for(const row of renderedHeroRows(preferred)){
      const key=heroItemKey(row.item)||(row.card&&String(row.card.dataset.contentId||row.card.dataset.igdcContentId||''));
      if(!key||byKey.has(key))continue;
      byKey.set(key,row);merged.push(row);
    }
    return merged;
  }

  function commitHeroChoice(heroImg,best){
    if(!heroImg||!best||!best.item||!best.url)return false;
    const tier=Number(best.tier||0);
    const provisional=best.provisional===true;
    if(tier<2&&!provisional)return false;
    const currentItem=heroRuntime.currentItem;
    if(currentItem&&heroRuntime.currentUrl){
      const currentTier=Number(heroRuntime.currentTier||0);
      // A low-resolution card fallback is temporary: any verified HD movie/drama
      // candidate may replace it. Once HD is installed, never downgrade to fallback.
      if(currentTier>=2&&tier<2)return false;
      if(!(currentTier<2&&tier>=2)){
        const current={
          item:currentItem,
          freshnessDay:Number(heroImg.dataset.igdcHeroFreshnessDay||heroFreshnessDay(currentItem)),
          popularityMetric:Number(heroImg.dataset.igdcHeroPopularityMetric||heroPopularityMetric(currentItem)),
          qualityMetric:Number(heroImg.dataset.igdcHeroQualityMetric||heroQualityMetric(heroImg.dataset.igdcHeroSourceWidth,heroImg.dataset.igdcHeroSourceHeight)),
          finalScore:Number(heroImg.dataset.igdcHeroFinalScore||heroRuntime.currentScore||0),
          w:Number(heroImg.dataset.igdcHeroSourceWidth||0),h:Number(heroImg.dataset.igdcHeroSourceHeight||0)
        };
        if(heroResolvedCompare(best,current)>=0)return false;
      }
    }
    heroImg.loading='eager';heroImg.decoding='async';
    try{heroImg.fetchPriority='high';}catch(_e){}
    const selectedUrl=best.url;
    heroImg.dataset.igdcHeroAttemptUrl=selectedUrl;
    heroImg.onerror=function(){
      if(heroImg.dataset.igdcHeroAttemptUrl!==selectedUrl)return;
      try{heroRuntime.failedUrls.add(selectedUrl);}catch(_e){}
      heroImg.removeAttribute('data-igdc-hero-resolution-tier');
      heroImg.removeAttribute('data-igdc-hero-final-score');
      heroRuntime.currentItem=null;heroRuntime.currentUrl='';heroRuntime.currentTier=-1;heroRuntime.currentScore=-Infinity;
      requestHeroRefresh(80);
    };
    heroImg.onload=function(){if(heroImg.dataset.igdcHeroAttemptUrl===selectedUrl)heroImg.dataset.igdcHeroLoaded='true';};
    heroImg.src=selectedUrl;
    heroImg.alt=String(best.item.title||best.item.name||best.item.text||'Featured media');
    heroImg.dataset.igdcHeroContentId=String(ensureContentId(best.item)||'');
    heroImg.dataset.igdcHeroSourceWidth=String(best.w||'');
    heroImg.dataset.igdcHeroSourceHeight=String(best.h||'');
    heroImg.dataset.igdcHeroResolutionTier=String(tier);
    heroImg.dataset.igdcHeroFinalScore=String(best.finalScore||0);
    heroImg.dataset.igdcHeroFreshnessDay=String(best.freshnessDay||heroFreshnessDay(best.item)||0);
    heroImg.dataset.igdcHeroPopularityMetric=String(best.popularityMetric||heroPopularityMetric(best.item)||0);
    heroImg.dataset.igdcHeroQualityMetric=String(best.qualityMetric!==undefined?best.qualityMetric:heroQualityMetric(best.w,best.h));
    heroImg.dataset.igdcHeroQuality=tier>=3?'verified-fullhd-or-better':'verified-hd-sharp';
    bindHeroPlayback(heroImg,best.item);
    heroRuntime.currentItem=best.item;heroRuntime.currentUrl=selectedUrl;
    heroRuntime.currentTier=tier;heroRuntime.currentScore=best.finalScore||0;
    return true;
  }

  async function applyHero(heroRotateKeys, sectionMap){
    const heroImg=q('.hero img');
    if(!heroImg)return false;

    const preferred=new Set((Array.isArray(heroRotateKeys)?heroRotateKeys:[]).map(canonKey).filter((key)=>HERO_ALLOWED_SECTIONS.has(key)));
    HERO_ALLOWED_SECTIONS.forEach((key)=>preferred.add(key));
    const pool=mergeHeroRows(preferred,sectionMap);
    if(!pool.length)return false;

    pool.sort((a,b)=>{
      // Requested hero policy: hot/ranked movie/drama first, then recency,
      // then verified image quality. A usable hero starts at 1280x720.
      const ar=heroPopularityMetric(a.item),br=heroPopularityMetric(b.item);
      if(ar!==br)return br-ar;
      const ad=heroFreshnessDay(a.item),bd=heroFreshnessDay(b.item);
      if(ad!==bd)return bd-ad;
      const aq=heroResolutionTier(a.renderedW,a.renderedH),bq=heroResolutionTier(b.renderedW,b.renderedH);
      if(aq!==bq)return bq-aq;
      const as=heroRankScore(a.item)+(a.preferred?80:0)+(a.domReady?140:0)-heroPendingPenalty(a.item);
      const bs=heroRankScore(b.item)+(b.preferred?80:0)+(b.domReady?140:0)-heroPendingPenalty(b.item);
      return bs-as;
    });

    // V54: never enlarge a rail thumbnail into the hero. Keep the existing hero image
    // until a genuinely qualified HD source is verified.

    const candidates=[],seenUrls=new Set();
    for(const row of pool.slice(0,64)){
      const item=row.item;
      const base=heroRankScore(item)+(row.preferred?80:0)+(row.domReady?140:0)-heroPendingPenalty(item);
      const urls=heroImageCandidates(item);
      // If the exact front thumbnail has already loaded, preserve its known
      // natural dimensions so a real 1280x720/1920x1080 card can be committed
      // immediately without another network round-trip.
      if(row.renderedUrl&&!seenUrls.has(row.renderedUrl)){
        seenUrls.add(row.renderedUrl);
        candidates.push({url:row.renderedUrl,item,card:row.card,score:base+130,hint:heroResolutionTier(row.renderedW,row.renderedH),
          knownW:row.renderedW,knownH:row.renderedH,domReady:true});
      }
      urls.slice(0,6).forEach((url,index)=>{
        if(!url||seenUrls.has(url)||heroRuntime.failedUrls.has(url))return;
        seenUrls.add(url);
        candidates.push({url,item,card:row.card,score:base+(120-(index*16)),hint:heroResolutionHint(item,url,index),knownW:0,knownH:0,domReady:row.domReady});
      });
    }
    if(!candidates.length)return !!heroRuntime.currentItem;

    function resolveKnown(candidate){
      const w=Number(candidate.knownW||0),h=Number(candidate.knownH||0),item=candidate&&candidate.item;
      const tier=heroResolutionTier(w,h);
      if(tier<2)return null;
      const visual=(item&&item.heroSharpVerified===true)?{sharp:true,edgeMean:Number(item.heroEdgeMean||0)||HERO_MIN_EDGE_MEAN,edgeP90:Number(item.heroEdgeP90||0)||HERO_MIN_EDGE_P90}:null;
      const qualityMetric=heroQualityMetric(w,h,visual);
      return Object.assign({},candidate,{w,h,tier,visual,qualityMetric,
        freshnessDay:heroFreshnessDay(candidate.item),popularityMetric:heroPopularityMetric(candidate.item),
        finalScore:candidate.score+(tier>=3?900:620)+(visual&&visual.sharp?180:60)});
    }
    function heroRotationBucket(){
      const now=Date.now();
      const day=Math.max(1,Number(HERO_ROTATE_WINDOW_DAYS)||1)*86400000;
      return Math.floor(now/day);
    }
    function chooseBest(rows){
      const valid=rows.filter((row)=>row&&row.tier>=2).slice().sort(heroResolvedCompare);
      if(!valid.length)return null;
      const poolSize=Math.max(1,Math.min(valid.length,Number(HERO_ROTATE_TOP_POOL)||1));
      const pick=heroRotationBucket()%poolSize;
      return valid[pick]||valid[0]||null;
    }
    async function checkedCandidate(candidate,timeoutMs){
      const known=resolveKnown(candidate);if(known)return known;
      const probe=await probeHeroImage(candidate.url,timeoutMs);
      if(!probe)return null;
      const tier=heroResolutionTier(probe.w,probe.h);
      if(tier<2)return null;
      // If pixel inspection is possible, reject soft/upscaled hero art. When
      // CORS blocks inspection, trust real 1280x720+ images that already rendered
      // on the front or come from an explicit HD source hint.
      const visual=probe.visual;
      const pixelPassed=!!(visual&&visual.sharp);
      const trustedUninspected=!visual&&(tier>=2&&(candidate.domReady||Number(candidate.hint||0)>=2));
      if(!pixelPassed&&!trustedUninspected)return null;
      const qualityMetric=heroQualityMetric(probe.w,probe.h,visual);
      const dimBonus=tier===3?900:620;
      return Object.assign({},candidate,probe,{tier,visual,qualityMetric,
        freshnessDay:heroFreshnessDay(candidate.item),popularityMetric:heroPopularityMetric(candidate.item),
        finalScore:candidate.score+dimBonus+(pixelPassed?180:0)});
    }

    // Fast path: a rail thumbnail that is already proven to be 720p/1080p can
    // fill the hero immediately. This is the path V46 lacked in production.
    const knownBest=chooseBest(candidates.map(resolveKnown));
    if(knownBest)commitHeroChoice(heroImg,knownBest);

    // Probe likely HD sources. Candidate timeouts are per-attempt only; they do
    // not reject the item. Thumbnail-ready events and scheduled refreshes retry
    // the same content later, so slow image generation can never permanently
    // empty the hero.
    const highHint=candidates.filter((row)=>row.hint>=2).sort(heroPreProbeCompare);
    const probeSet=[];
    for(const candidate of highHint.concat(candidates.slice().sort(heroPreProbeCompare))){
      if(probeSet.length>=28)break;
      if(probeSet.indexOf(candidate)>=0)continue;
      probeSet.push(candidate);
    }
    const checked=await Promise.all(probeSet.map((candidate)=>checkedCandidate(candidate,3600)));
    let best=chooseBest(checked);

    // If provider/backdrop assets are not HD, try a real 1280x720 frame from the
    // top-ranked direct movie/drama video. This is a genuine frame capture; low-res
    // sources are never upscaled and cross-origin failures simply fall back safely.
    if(!best){
      for(const row of pool.slice(0,18)){
        const captured=await captureHeroFrameForItem(row.item);
        if(!captured)continue;
        const tier=heroResolutionTier(captured.w,captured.h);
        if(tier<2)continue;
        best={url:captured.url,item:row.item,card:row.card,w:captured.w,h:captured.h,tier,
          visual:captured.visual,qualityMetric:heroQualityMetric(captured.w,captured.h,captured.visual),freshnessDay:heroFreshnessDay(row.item),
          popularityMetric:heroPopularityMetric(row.item),finalScore:heroRankScore(row.item)+(row.preferred?80:0)+(row.domReady?140:0)+520};
        break;
      }
    }
    if(!best)return !!knownBest||!!heroRuntime.currentItem;
    return commitHeroChoice(heroImg,best)||!!knownBest||!!heroRuntime.currentItem;
  }

  function requestHeroRefresh(delay){
    if(!heroRuntime.sectionMap)return;
    if(heroRuntime.timer){clearTimeout(heroRuntime.timer);heroRuntime.timer=null;}
    heroRuntime.timer=setTimeout(async()=>{
      heroRuntime.timer=null;
      if(heroRuntime.running){heroRuntime.rerun=true;return;}
      heroRuntime.running=true;
      try{await applyHero(heroRuntime.rotateKeys,heroRuntime.sectionMap);}catch(_e){}
      finally{
        heroRuntime.running=false;
        if(heroRuntime.rerun){heroRuntime.rerun=false;requestHeroRefresh(80);}
      }
    },Math.max(0,Number(delay)||0));
  }

  function scheduleHeroRefresh(heroRotateKeys,sectionMap){
    heroRuntime.rotateKeys=Array.isArray(heroRotateKeys)?heroRotateKeys.slice():[];
    heroRuntime.sectionMap=sectionMap||{};
    requestHeroRefresh(0);
    [700,1800,4200,9000,18000].forEach((delay)=>setTimeout(()=>requestHeroRefresh(0),delay));
  }

  D.addEventListener('igdc:media-thumbnail-ready',()=>requestHeroRefresh(90));


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
    const reason=String(detail.reason||'source_failed').toLowerCase();
    if(/(?:slow|timeout|stall|stalled|waiting|pending)/.test(reason))return;
    const item=card.__igdcMediaItem||{contentId:detail.contentId,title:card.dataset.mediaTitle||'',url:card.dataset.mediaSource||''};
    quarantineItem(card,item,'playback_'+reason);
    try{D.dispatchEvent(new CustomEvent('igdc:media-playback-quarantine',{detail:{contentId:detail.contentId||ensureContentId(item),reason:detail.reason||'source_failed'}}));}catch(_e){}
  });

  async function main(){
    const lines = qa('.thumb-line[data-psom-key]');
    if(lines.length === 0) return;
    installReadyFirstCompactionWatch();

    // stabilize layout first
    lines.forEach(ensurePlaceholders);

    const snapshot = await loadSnapshotAny();
    const sectionMap = normalizeSectionMap(snapshot);
	
// ===== MEDIA TRENDING BALANCED AUTO-COMBINE =====
(function(){
  if(!sectionMap)return;
  const existing=extractItems(sectionMap['media-trending']).filter(isTrendingReadyCandidate);

  const sourceKeys=['media-movie','media-drama','media-variety','media-music'];
  function recency(item){
    const t=item&&(item.publishedAt||item.releaseDate||item.createdAt||item.date);
    if(!t)return 0;
    const time=new Date(t).getTime();if(!Number.isFinite(time))return 0;
    const days=Math.max(0,(Date.now()-time)/86400000);
    return Math.max(0,1-(days/45));
  }
  function score(item){
    // "지금 뜨는 콘텐츠"는 단순 최신순이 아니라 실제 재생 가능성,
    // 정상 썸네일, 콘텐츠 품질/반응, 최신성을 함께 본다.
    return frontPriority(item)+(recency(item)*140);
  }
  function dedupeKey(item){return String(item&&(item.contentId||item.id||item.video||item.url||item.link)||JSON.stringify(item||{}));}
  const seen=new Set(),lanes={};
  sourceKeys.forEach((key)=>{
    const list=extractItems(sectionMap[key]).filter(isTrendingReadyCandidate).map((item)=>Object.assign({},item,{_sectionKey:key}));
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

    // Apply every snapshot-backed rail immediately. Any optional feed fallback
    // is scheduled independently instead of serially blocking the following
    // sections. (Fallback is currently disabled in production.)
    const fallbackJobs=[];
    for(const line of lines){
      const key=canonKey(line.getAttribute('data-psom-key')||'');
      if(!key||key.indexOf('media-')!==0)continue;
      const items=extractItems(sectionMap[key]);
      if(items&&items.length){
        applyLine(line,items);
      }else if(ENABLE_FEED_MEDIA_FALLBACK){
        fallbackJobs.push(loadFeedItems(key).then((feedItems)=>{if(feedItems&&feedItems.length)applyLine(line,feedItems);}));
      }
    }
    if(fallbackJobs.length)Promise.allSettled(fallbackJobs).then(()=>lines.forEach(compactLine));

    // Start hero selection only after the rail bind pass. The hero is therefore
    // guaranteed to be an expansion of a successfully rendered movie/drama card.
    const heroRotateFrom=snapshot&&snapshot.hero&&(snapshot.hero.rotateFrom||snapshot.hero.source);
    scheduleHeroRefresh(heroRotateFrom,sectionMap);

    // Async image decode/recovery and any later renderer must not be allowed to
    // reintroduce Sample/real interleaving. Re-compact a few times after the
    // initial mapping as an additional deterministic safety net.
    [0,120,420,1100,2600].forEach((delay)=>setTimeout(()=>lines.forEach(compactLine),delay));
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', main);
  else main();

  window.__IGDC_MEDIAHUB_AUTOMAP_VERSION__='5.4.2-hero-hd-1280x720-ranked-rotate';
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
