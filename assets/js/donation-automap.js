/**
 * donation-automap.integrated.v8.4-native-homepage-link-no-html-patch.js
 * ------------------------------------------------------------
 * 목적:
 * - 기존 donation-automap.v7.enterprise.js 구조/역할 유지
 * - feed 없이도 동작하도록 builder/feed 역할을 오토맵에 흡수
 * - donation HTML + donation.snapshot.json + donation builder 구조 모두 대응
 * - data-psom-key 기반 DOM 매핑 유지
 * - snapshot.items 기반 groupBySection 유지
 * - slot_limit / bank-first / rank sorting / verify bonus 유지
 */

(async function(){
  'use strict';

  const RENDER_BATCH = 12;
  const sectionRenderJobs = new WeakMap();
  const donationProfileByUid = new Map();

  // The legacy Donation HTML still contains a DOMContentLoaded placeholder
  // generator with data-count=100 on every rail.  Cap only that first shell
  // pass, then restore the declared count before this automap reads the real
  // slot limit.  One shared JS change therefore protects every language page
  // without rewriting 30 separate HTML files.
  function capLegacyPlaceholderBurst(){
    const rows = Array.from(document.querySelectorAll('.feed-row[data-count]'));
    if(!rows.length) return;
    rows.forEach((row)=>{
      row.dataset.igdcOriginalCount = row.dataset.count || '';
      row.dataset.count = String(RENDER_BATCH);
    });
    document.addEventListener('DOMContentLoaded', ()=>{
      rows.forEach((row)=>{
        const original = row.dataset.igdcOriginalCount;
        if(original) row.dataset.count = original;
        else row.removeAttribute('data-count');
        delete row.dataset.igdcOriginalCount;
      });
    }, { once:true });
  }
  capLegacyPlaceholderBurst();

  const SNAPSHOT_PATHS = [
    // 1) direct builder (feed integrated)
    '/.netlify/functions/donation-snapshot-builder',
    '/netlify/functions/donation-snapshot-builder',

    // 2) legacy thin feed wrapper (still accepted if present)
    '/.netlify/functions/donation-feed',
    '/netlify/functions/donation-feed',

    // 3) static snapshot fallback
    '/data/donation.snapshot.json',
    '/netlify/functions/data/donation.snapshot.json'
  ];

  async function fetchJsonLoose(url){
    const r = await fetch(url, { cache:'no-store' });
    if(!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);

    let data;
    try{
      data = await r.json();
    }catch(e){
      throw new Error('INVALID_JSON @ ' + url);
    }

    // Netlify wrapper body support
    if(data && typeof data.body === 'string'){
      try{
        const parsed = JSON.parse(data.body);
        if(parsed) data = parsed;
      }catch(_e){}
    }

    return data;
  }

  function normalizeSections(rawSections){
    if(!rawSections) return [];

    // array form: [{ psom_key, slot_limit }]
    if(Array.isArray(rawSections)){
      return rawSections
        .filter(Boolean)
        .map((s)=>({
          psom_key: s.psom_key || s.key || s.section_key || s.id || '',
          slot_limit: Number(s.slot_limit || s.limit || s.count || 80)
        }))
        .filter((s)=>!!s.psom_key);
    }

    // object form: { donation-global:[...], donation-mission:[...] } or nested objects
    if(typeof rawSections === 'object'){
      return Object.keys(rawSections).map((key)=>{
        const sec = rawSections[key];

        if(sec && typeof sec === 'object' && !Array.isArray(sec)){
          return {
            psom_key: sec.psom_key || key,
            slot_limit: Number(sec.slot_limit || sec.limit || sec.count || 80)
          };
        }

        if(Array.isArray(sec)){
          return {
            psom_key: key,
            slot_limit: sec.length || 80
          };
        }

        return {
          psom_key: key,
          slot_limit: 80
        };
      }).filter((s)=>!!s.psom_key);
    }

    return [];
  }

  function normalizeItems(rawItems){
    const list = Array.isArray(rawItems) ? rawItems : [];

    return list.map((it)=>{
      it.__score = scoreItem(it);
      return it;
    });
  }

  function snapshotFromSectionsObject(raw){
    const sectionsArr = normalizeSections(raw);
    const items = [];

    Object.keys(raw || {}).forEach((key)=>{
      const sec = raw[key];
      const arr = Array.isArray(sec)
        ? sec
        : (Array.isArray(sec?.items) ? sec.items : []);

      arr.forEach((it)=>{
        if(!it || typeof it !== 'object') return;
        if(!it.psom_key) it.psom_key = key;
        items.push(it);
      });
    });

    return { sections: sectionsArr, items };
  }

  function normalizeSnapshot(data){
    if(!data || typeof data !== 'object') return null;

    // already correct shape
    if(data.sections && data.items){
      return {
        ...data,
        sections: normalizeSections(data.sections),
        items: Array.isArray(data.items) ? data.items : []
      };
    }

    // builder/page shape
    if(data.pages?.donation?.sections || data.pages?.donation?.items){
      const rawSections = data.pages.donation.sections || {};
      const rawItems = data.pages.donation.items || data.items || [];

      if(Array.isArray(rawItems) && rawItems.length){
        return {
          ...data,
          sections: normalizeSections(rawSections),
          items: rawItems
        };
      }

      return snapshotFromSectionsObject(rawSections);
    }

    // plain sections object with embedded arrays
    if(data.sections && typeof data.sections === 'object'){
      return snapshotFromSectionsObject(data.sections);
    }

    return null;
  }

  async function loadSnapshot(){
    let lastErr = null;

    for(const p of SNAPSHOT_PATHS){
      try{
        const data = await fetchJsonLoose(p);
        const snapshot = normalizeSnapshot(data);
        if(snapshot && snapshot.sections && snapshot.items){
          return snapshot;
        }
      }catch(e){
        lastErr = e;
      }
    }

    throw lastErr || new Error('Donation snapshot not found');
  }

  function buildSectionIndex(sections){
    const map = {};

    (Array.isArray(sections) ? sections : []).forEach((s)=>{
      if(!s || !s.psom_key) return;
      map[s.psom_key] = clampLimit(s.slot_limit || 80);
    });

    return map;
  }

  function scoreItem(it){
    let score = 0;

    // Bank priority
    if(it?.bank_ref && it.bank_ref.record_id){
      score += 1000000;
    }

    // Rank score
    if(it?.rank && typeof it.rank.score === 'number'){
      score += it.rank.score * 1000;
    }

    // Verification bonus
    if(it?.verify && it.verify.status === 'verified'){
      score += 500;
    }

    return score;
  }

function groupBySection(items){
  const map = {};
  let globalPlaceholderSkipped = false;

  (Array.isArray(items) ? items : []).forEach((it)=>{
    const k = it?.psom_key;
    if(!k) return;

    const title = String(it?.title || it?.org?.name || '').toLowerCase();
    const summary = String(it?.summary || it?.org?.legal_name || '').toLowerCase();

    const isExactGlobalPlaceholder =
      k === 'donation-global' &&
      !globalPlaceholderSkipped &&
      (
        title.includes('seed placeholder') ||
        summary.includes('seed placeholder')
      );

    if(isExactGlobalPlaceholder){
      globalPlaceholderSkipped = true;
      return;
    }

    if(!map[k]) map[k] = [];
    map[k].push(it);
  });

  return map;
}

  function isSeedItem(it){
    const source = String(it?.meta?.source || '').toLowerCase();
    const status = String(it?.verify?.status || '').toLowerCase();
    const hasBankRecord = !!(it?.bank_ref && it.bank_ref.record_id);
    return !hasBankRecord && (source === 'seed' || source === 'sample' || status === 'sample');
  }

  function seedOrdinal(it){
    // Builder seed UIDs can end in a hash. The front contract is the visible
    // placeholder number, so read title/name before UID/ID.
    for(const value of [it?.title, it?.org?.name]){
      const raw = String(value || '').trim();
      const match = raw.match(/(?:^|\s)(\d{1,3})\s*$/);
      if(match){
        const n = Number(match[1]);
        if(Number.isFinite(n) && n >= 1 && n <= 200) return n;
      }
    }

    // Static seed snapshot IDs use a zero-padded terminal ordinal.
    for(const value of [it?.uid, it?.id]){
      const raw = String(value || '').trim();
      const match = raw.match(/:(\d{1,6})$/);
      if(match){
        const n = Number(match[1]);
        if(Number.isFinite(n) && n >= 1 && n <= 200) return n;
      }
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function sortSection(items){
    return (Array.isArray(items) ? items : []).sort((a,b)=>{
      const aSeed = isSeedItem(a);
      const bSeed = isSeedItem(b);

      // Real SearchBank content always keeps the existing score/rank priority.
      if(aSeed !== bSeed) return aSeed ? 1 : -1;

      // Seed/sample cards are only placeholders: keep their visible slot order 1,2,3...
      if(aSeed && bSeed){
        const an = seedOrdinal(a);
        const bn = seedOrdinal(b);
        if(an !== bn) return an - bn;
      }

      if(!aSeed && !bSeed && String(a?.psom_key||'')!=='donation-global' && String(b?.psom_key||'')!=='donation-global'){
        if((b.__geoScore||0)!==(a.__geoScore||0)) return (b.__geoScore||0)-(a.__geoScore||0);
        if((b.__langScore||0)!==(a.__langScore||0)) return (b.__langScore||0)-(a.__langScore||0);
      }

      if(!aSeed && !bSeed && (String(a?.psom_key||'')==='donation-global' || String(b?.psom_key||'')==='donation-global')){
        const av=(String(a?.type||'').toLowerCase()==='video'||String(a?.media?.kind||'').toLowerCase()==='video'||String(a?.link?.mode||'').toLowerCase()==='content-video')?1:0;
        const bv=(String(b?.type||'').toLowerCase()==='video'||String(b?.media?.kind||'').toLowerCase()==='video'||String(b?.link?.mode||'').toLowerCase()==='content-video')?1:0;
        if(bv!==av) return bv-av;
      }

      if((b.__score || 0) !== (a.__score || 0)){
        return (b.__score || 0) - (a.__score || 0);
      }

      const ta = a?.meta?.updated_at || a?.updated_at || '';
      const tb = b?.meta?.updated_at || b?.updated_at || '';
      return String(tb).localeCompare(String(ta));
    });
  }

  function clampLimit(n){
    const x = Number(n);
    if(!Number.isFinite(x) || x <= 0) return 80;
    return Math.max(1, Math.min(200, Math.floor(x)));
  }

  function escHtml(s){
    const str = String(s ?? '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(s){
    return escHtml(String(s ?? '')).replace(/\s+/g, ' ').trim();
  }

  function safeUrl(u){
    const s = String(u ?? '').trim();
    if(!s) return '';
    if(/^javascript:/i.test(s)) return '';
    return s;
  }

  function safeExternalUrl(u){
    const s = safeUrl(u);
    if(!/^https:\/\//i.test(s)) return '';
    try{
      const parsed = new URL(s);
      return parsed.protocol === 'https:' ? parsed.href : '';
    }catch(_e){
      return '';
    }
  }

  const DONATION_GEO_ENDPOINT = '/igdc-country-geo';
  let donationGeoPromise = null;

  function normalizeCountryCode(value){
    const code=String(value||'').trim().toUpperCase();
    if(code==='UK') return 'GB';
    return /^[A-Z]{2}$/.test(code)?code:'';
  }

  function normalizeLanguageCode(value){
    return String(value||'').trim().toLowerCase().replace('_','-').split('-')[0];
  }

  const COUNTRY_DEFAULT_LANGS = {
    KR:['ko'],JP:['ja'],CN:['zh'],TW:['zh'],HK:['zh','en'],SG:['en','zh'],PH:['en','tl'],
    US:['en'],GB:['en'],CA:['en','fr'],AU:['en'],NZ:['en'],DE:['de'],FR:['fr'],ES:['es'],IT:['it'],PT:['pt'],
    BR:['pt'],MX:['es'],AR:['es'],CO:['es'],PE:['es'],CL:['es'],RU:['ru'],UA:['uk'],TR:['tr'],SA:['ar'],AE:['ar','en'],
    QA:['ar','en'],IL:['he','en'],IN:['hi','en'],PK:['ur','en'],BD:['bn','en'],ID:['id'],MY:['ms','en'],TH:['th'],VN:['vi']
  };

  function preferredLanguages(country){
    const out=[];
    (COUNTRY_DEFAULT_LANGS[country]||[]).forEach(function(v){if(v&&!out.includes(v))out.push(v);});
    [document.documentElement&&document.documentElement.lang,navigator.language].forEach(function(v){
      const lang=normalizeLanguageCode(v);if(lang&&!out.includes(lang))out.push(lang);
    });
    return out;
  }

  function countryFromUrl(value){
    const url=safeExternalUrl(value);if(!url)return '';
    try{
      const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
      const last=(host.split('.').pop()||'').toUpperCase();
      if(last==='UK')return 'GB';
      return /^[A-Z]{2}$/.test(last)?last:'';
    }catch(_e){return '';}
  }

  function itemCountry(it){
    const explicit=normalizeCountryCode(it?.org?.country||it?.registration?.country||it?.geo?.country||it?.country);
    if(explicit)return explicit;
    const title=String(it?.org?.name||it?.title||'');
    if(/(?:\bKorea\b|\bKorean\b|대한민국|한국|코리아)/i.test(title))return 'KR';
    return countryFromUrl(it?.org?.homepage||it?.link?.url||it?.url||'');
  }

  function itemLanguages(it){
    const raw=[];
    if(Array.isArray(it?.org?.languages))raw.push(...it.org.languages);
    if(Array.isArray(it?.languages))raw.push(...it.languages);
    if(it?.i18n?.lang)raw.push(it.i18n.lang);
    const unique=[];
    raw.forEach(function(v){const lang=normalizeLanguageCode(v);if(lang&&!unique.includes(lang))unique.push(lang);});
    return unique;
  }

  function inferredNetworkKey(it){
    const explicit=String(it?.org?.network||it?.network||'').trim().toLowerCase();
    if(explicit)return explicit;
    const blob=String(it?.org?.name||it?.title||'').toLowerCase();
    const aliases=[
      [/world\s*vision|월드비전/,'world-vision'],
      [/good\s*neighbors|굿네이버스/,'good-neighbors'],
      [/habitat\s*for\s*humanity|해비타트/,'habitat-for-humanity'],
      [/save\s*the\s*children|세이브더칠드런/,'save-the-children'],
      [/child\s*evangelism\s*fellowship|어린이전도협회/,'child-evangelism-fellowship'],
      [/campus\s*crusade|\bcru\b|\bkccc\b|대학생선교회/,'cru'],
      [/intervarsity|\bivf\b|기독학생회/,'intervarsity'],
      [/youth\s*with\s*a\s*mission|\bywam\b|예수전도단/,'ywam'],
      [/a\s*rocha|아로차/,'a-rocha'],
      [/\bwwf\b/,'wwf'],
      [/greenpeace|그린피스/,'greenpeace'],
      [/open\s*doors|오픈도어/,'open-doors'],
      [/prison\s*fellowship|기독교세진회/,'prison-fellowship']
    ];
    for(const pair of aliases){if(pair[0].test(blob))return pair[1];}
    return '';
  }

  async function loadDonationGeo(){
    if(donationGeoPromise)return donationGeoPromise;
    donationGeoPromise=(async function(){
      const controller=typeof AbortController==='function'?new AbortController():null;
      const timer=controller?setTimeout(function(){try{controller.abort();}catch(_e){}},1200):null;
      try{
        const res=await fetch(DONATION_GEO_ENDPOINT,{cache:'no-store',credentials:'same-origin',signal:controller?controller.signal:undefined});
        const data=res&&res.ok?await res.json():null;
        const country=normalizeCountryCode(data&&(data.country||data.detectedCountry));
        const geo={country:country,region:String(data&&data.region||'').trim().toUpperCase(),resolved:!!country,excluded:!!(data&&data.excluded)};
        window.__IGDC_DONATION_GEO__=geo;
        return geo;
      }catch(_e){
        const geo={country:'',region:'',resolved:false,excluded:false};
        window.__IGDC_DONATION_GEO__=geo;
        return geo;
      }finally{if(timer)clearTimeout(timer);}
    })();
    return donationGeoPromise;
  }

  function languageAffinity(it,preferred){
    const langs=itemLanguages(it);if(!langs.length)return 0;
    for(let i=0;i<preferred.length;i++){if(langs.includes(preferred[i]))return 100-i;}
    return 0;
  }

  function localizeInstitutionItems(items,sectionKey,geo){
    const list=(Array.isArray(items)?items:[]).slice();
    if(sectionKey==='donation-global'||!geo||!geo.country)return list;
    const preferred=preferredLanguages(geo.country);
    list.forEach(function(it){
      const country=itemCountry(it);
      it.__igdcCountry=country;
      it.__geoScore=country===geo.country?300:(country?0:100);
      it.__langScore=languageAffinity(it,preferred);
    });
    const networks=new Map();
    list.forEach(function(it){const key=inferredNetworkKey(it);if(!key)return;if(!networks.has(key))networks.set(key,[]);networks.get(key).push(it);});
    const remove=new Set();
    networks.forEach(function(group){
      if(group.length<2)return;
      const local=group.filter(function(it){return it.__igdcCountry===geo.country;});
      const globals=group.filter(function(it){return !it.__igdcCountry;});
      const pool=local.length?local:(globals.length?globals:[]);
      if(!pool.length)return;
      const best=pool.slice().sort(function(a,b){
        if((b.__langScore||0)!==(a.__langScore||0))return (b.__langScore||0)-(a.__langScore||0);
        return (b.__score||0)-(a.__score||0);
      })[0];
      group.forEach(function(it){if(it!==best)remove.add(it);});
    });
    return list.filter(function(it){return !remove.has(it);});
  }

  const CONTAINED_VIEWER_SRC = '/assets/js/igdc-contained-external-viewer.js?v=20260918-donation-speed-history-v9';
  const CONTAINED_VIEWER_SCRIPT_ID = 'igdc-contained-viewer-loader-donation-v1';

  function ensureContainedViewer(){
    if(window.IGDCContainedViewer && Number(window.IGDCContainedViewer.version || 0) >= 9 && typeof window.IGDCContainedViewer.open === 'function') {
      return Promise.resolve(window.IGDCContainedViewer);
    }
    if(window.__IGDC_DONATION_VIEWER_PROMISE__) return window.__IGDC_DONATION_VIEWER_PROMISE__;
    window.__IGDC_DONATION_VIEWER_PROMISE__ = new Promise(function(resolve,reject){
      let script=document.getElementById(CONTAINED_VIEWER_SCRIPT_ID);
      const finish=function(){
        if(window.IGDCContainedViewer && Number(window.IGDCContainedViewer.version || 0) >= 9 && typeof window.IGDCContainedViewer.open === 'function') resolve(window.IGDCContainedViewer);
        else reject(new Error('IGDC contained viewer unavailable'));
      };
      if(script){
        if(script.dataset.loaded==='1'){finish();return;}
        script.addEventListener('load',finish,{once:true});
        script.addEventListener('error',function(){reject(new Error('IGDC contained viewer load failed'));},{once:true});
        return;
      }
      script=document.createElement('script');
      script.id=CONTAINED_VIEWER_SCRIPT_ID;
      script.src=CONTAINED_VIEWER_SRC;
      script.async=true;
      script.addEventListener('load',function(){script.dataset.loaded='1';finish();},{once:true});
      script.addEventListener('error',function(){reject(new Error('IGDC contained viewer load failed'));},{once:true});
      (document.head||document.documentElement).appendChild(script);
    }).catch(function(err){ window.__IGDC_DONATION_VIEWER_PROMISE__=null; throw err; });
    return window.__IGDC_DONATION_VIEWER_PROMISE__;
  }

  function openContainedHomepage(url,label,options){
    const href=safeExternalUrl(url);
    if(!href) return Promise.resolve(false);
    options=options||{};
    return ensureContainedViewer().then(function(viewer){
      viewer.open(href,{label:String(label||'').trim()||new URL(href).hostname,kind:String(options.kind||'donation'),forceProxy:options.forceProxy!==false});
      return true;
    }).catch(function(err){
      console.warn('[IGDC][Donation] contained viewer unavailable:',err&&err.message?err.message:err);
      return false;
    });
  }

  const MEDIA_PLAYBACK_SRC = '/assets/js/mediahub-playback-controller.v2.js?v=20260918-donation-global-v1';
  const MEDIA_PLAYBACK_SCRIPT_ID = 'igdc-mediahub-playback-loader-donation-v1';

  function ensureDonationMediaPlayback(){
    if(window.IGDCMediaHubPlayback && typeof window.IGDCMediaHubPlayback.open === 'function') return Promise.resolve(window.IGDCMediaHubPlayback);
    if(window.__IGDC_DONATION_MEDIA_PROMISE__) return window.__IGDC_DONATION_MEDIA_PROMISE__;
    window.__IGDC_DONATION_MEDIA_PROMISE__ = new Promise(function(resolve,reject){
      let script=document.getElementById(MEDIA_PLAYBACK_SCRIPT_ID);
      const finish=function(){
        if(window.IGDCMediaHubPlayback && typeof window.IGDCMediaHubPlayback.open === 'function') resolve(window.IGDCMediaHubPlayback);
        else reject(new Error('IGDC media playback unavailable'));
      };
      if(script){
        if(script.dataset.loaded==='1'){finish();return;}
        script.addEventListener('load',finish,{once:true});
        script.addEventListener('error',function(){reject(new Error('IGDC media playback load failed'));},{once:true});
        return;
      }
      script=document.createElement('script');script.id=MEDIA_PLAYBACK_SCRIPT_ID;script.src=MEDIA_PLAYBACK_SRC;script.async=true;
      script.addEventListener('load',function(){script.dataset.loaded='1';finish();},{once:true});
      script.addEventListener('error',function(){reject(new Error('IGDC media playback load failed'));},{once:true});
      (document.head||document.documentElement).appendChild(script);
    }).catch(function(err){window.__IGDC_DONATION_MEDIA_PROMISE__=null;throw err;});
    return window.__IGDC_DONATION_MEDIA_PROMISE__;
  }

  function primeDonationInteractionEngines(){
    const run=function(){
      ensureContainedViewer().catch(function(){});
      ensureDonationMediaPlayback().catch(function(){});
      try{
        ['https://www.youtube-nocookie.com','https://i.ytimg.com'].forEach(function(href){
          if(document.querySelector('link[data-igdc-donation-preconnect="'+href+'"]')) return;
          const link=document.createElement('link');link.rel='preconnect';link.href=href;link.crossOrigin='anonymous';link.dataset.igdcDonationPreconnect=href;(document.head||document.documentElement).appendChild(link);
        });
      }catch(_e){}
    };
    if(typeof window.requestIdleCallback==='function') window.requestIdleCallback(run,{timeout:1200});
    else window.setTimeout(run,280);
  }

  function looksPlayableVideoUrl(value){
    const url=safeExternalUrl(value);if(!url)return false;
    return /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|\.(?:mp4|webm|ogv|ogg|m4v)(?:[?#]|$))/i.test(url);
  }

  function openDonationVideo(card){
    if(!card) return Promise.resolve(false);
    const source=safeExternalUrl(card.dataset.mediaSource||card.dataset.videoUrl||'');
    if(!source) return Promise.resolve(false);
    return ensureDonationMediaPlayback().then(function(player){player.open(card,{autoPlay:true});return true;}).catch(function(err){
      console.warn('[IGDC][Donation] media playback unavailable:',err&&err.message?err.message:err);
      return openContainedHomepage(source,card.querySelector?.('.card-title')?.textContent||'Global News',{kind:'donation-news'});
    });
  }

  function donationProfileForCard(card){
    const uid=String(card&&card.dataset&&card.dataset.uid||'');
    const row=donationProfileByUid.get(uid)||{};
    return row&&typeof row==='object'?row:{};
  }

  function supportMethodLabel(method){
    const key=String(method||'').toLowerCase();
    return ({card:'카드',bank_transfer:'계좌이체',mobile:'모바일 결제',paypal:'PayPal',crypto:'블록체인/가상자산'})[key]||String(method||'');
  }

  function ensureDonationSupportPanelStyle(){
    if(document.getElementById('igdc-donation-support-panel-style'))return;
    const style=document.createElement('style');style.id='igdc-donation-support-panel-style';
    style.textContent=[
      '#igdc-contained-external-viewer .igdc-donation-support-panel{position:absolute;z-index:8;top:58px;right:12px;width:min(360px,calc(100vw - 24px));max-height:calc(100% - 70px);overflow:auto;background:rgba(255,255,255,.98);border:1px solid #b7c9d8;border-radius:12px;box-shadow:0 10px 28px rgba(15,23,42,.20);padding:14px;color:#16365c;font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
      '#igdc-contained-external-viewer .igdc-donation-support-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px}',
      '#igdc-contained-external-viewer .igdc-donation-support-title{font-size:15px;font-weight:900;flex:1}',
      '#igdc-contained-external-viewer .igdc-donation-support-close{border:0;background:#eef3f7;color:#16365c;border-radius:8px;width:28px;height:28px;cursor:pointer;font-weight:900}',
      '#igdc-contained-external-viewer .igdc-donation-support-badges{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}',
      '#igdc-contained-external-viewer .igdc-donation-support-badge{background:#edf6df;border:1px solid #b9cf91;border-radius:999px;padding:3px 7px;font-size:11px;font-weight:700}',
      '#igdc-contained-external-viewer .igdc-donation-support-block{border-top:1px solid #e1e8ee;padding-top:9px;margin-top:9px}',
      '#igdc-contained-external-viewer .igdc-donation-support-row{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin:6px 0;word-break:break-word}',
      '#igdc-contained-external-viewer .igdc-donation-support-copy{margin-left:6px;border:1px solid #a9bfd0;background:#fff;color:#16365c;border-radius:6px;padding:2px 6px;cursor:pointer;font-size:11px}',
      '#igdc-contained-external-viewer .igdc-donation-support-source{display:inline-block;margin-top:7px;color:#0b5cab;text-decoration:underline;font-weight:700}',
      '#igdc-contained-external-viewer .igdc-donation-support-note{font-size:11px;color:#607080;margin-top:8px}',
      '@media(max-width:640px){#igdc-contained-external-viewer .igdc-donation-support-panel{top:auto;right:6px;left:6px;bottom:6px;width:auto;max-height:44%;padding:11px}}'
    ].join('');
    (document.head||document.documentElement).appendChild(style);
  }

  function showDonationSupportPanel(profile,label,homepage){
    const root=document.getElementById('igdc-contained-external-viewer');if(!root)return;
    const old=root.querySelector('.igdc-donation-support-panel');if(old)old.remove();
    profile=profile&&typeof profile==='object'?profile:{};
    const checkout=safeExternalUrl(profile.checkout_url||'');
    const source=safeExternalUrl(profile.source_url||checkout||'');
    const methods=Array.isArray(profile.methods)?profile.methods:[];
    const banks=(Array.isArray(profile.bank_accounts)?profile.bank_accounts:[]).filter(function(b){return b&&b.official_source===true&&b.account;});
    const wallets=(Array.isArray(profile.crypto_wallets)?profile.crypto_wallets:[]).filter(function(w){return w&&w.official_source===true&&w.address;});
    if(!checkout&&!banks.length&&!wallets.length)return;
    ensureDonationSupportPanelStyle();
    const panel=document.createElement('aside');panel.className='igdc-donation-support-panel';panel.setAttribute('aria-label','공식 후원 정보');
    const badges=methods.map(function(m){return '<span class="igdc-donation-support-badge">'+escHtml(supportMethodLabel(m))+'</span>';}).join('');
    const bankHtml=banks.map(function(b){
      const bank=escHtml(b.bank||'공식 후원계좌'),holder=escHtml(b.holder||''),account=escHtml(b.account||''),swift=escHtml(b.swift||'');
      return '<div class="igdc-donation-support-row"><strong>'+bank+'</strong><br>'+ (holder?'예금주/수취인: '+holder+'<br>':'') +'계좌: <span>'+account+'</span><button type="button" class="igdc-donation-support-copy" data-copy="'+escAttr(b.account||'')+'">복사</button>'+(swift?'<br>SWIFT/BIC: '+swift:'')+'</div>';
    }).join('');
    const walletHtml=wallets.map(function(w){return '<div class="igdc-donation-support-row"><strong>'+escHtml(w.asset||'Crypto')+'</strong><br><span>'+escHtml(w.address||'')+'</span><button type="button" class="igdc-donation-support-copy" data-copy="'+escAttr(w.address||'')+'">복사</button></div>';}).join('');
    panel.innerHTML='<div class="igdc-donation-support-head"><div class="igdc-donation-support-title">'+escHtml(label||'후원')+' · 공식 후원 정보</div><button type="button" class="igdc-donation-support-close" aria-label="후원 정보 닫기">×</button></div>'+
      (checkout?'<div><strong>공식 후원 페이지</strong><br><span style="font-size:11px;color:#52677a">현재 이 페이지를 우선 열었습니다.</span></div>':'')+
      (badges?'<div class="igdc-donation-support-badges">'+badges+'</div>':'')+
      (bankHtml?'<div class="igdc-donation-support-block"><strong>공식 계좌이체 정보</strong>'+bankHtml+'</div>':'')+
      (walletHtml?'<div class="igdc-donation-support-block"><strong>공식 블록체인 후원 정보</strong>'+walletHtml+'</div>':'')+
      (source?'<a class="igdc-donation-support-source" href="'+escAttr(source)+'" target="_blank" rel="noopener noreferrer">공식 출처 확인</a>':'')+
      '<div class="igdc-donation-support-note">기관의 공식 홈페이지 또는 그 홈페이지에서 직접 연결된 후원 페이지에서 확인된 정보만 표시합니다. 카드번호 등 결제정보는 IGDC가 입력받거나 저장하지 않습니다.</div>';
    root.appendChild(panel);
    panel.querySelector('.igdc-donation-support-close')?.addEventListener('click',function(){panel.remove();});
    panel.querySelectorAll('.igdc-donation-support-copy').forEach(function(btn){btn.addEventListener('click',function(){const value=String(btn.dataset.copy||'');if(!value)return;navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(value).then(function(){btn.textContent='복사됨';setTimeout(function(){btn.textContent='복사';},1200);}).catch(function(){}):null;});});
  }

  function openDonationCard(card,options){
    if(!card)return Promise.resolve(false);
    options=options||{};
    const homepage=safeExternalUrl(card.getAttribute('data-url'));
    if(!homepage)return Promise.resolve(false);
    if(card.dataset.donationVideo==='1')return openDonationVideo(card);
    const profile=donationProfileForCard(card);
    const checkout=safeExternalUrl(profile.checkout_url||'');
    const url=options.preferDonation&&checkout?checkout:homepage;
    const label=card.querySelector?.('.card-title')?.textContent||'';
    return openContainedHomepage(url,label,{kind:options.preferDonation?'donation-support':(card.dataset.section==='donation-global'?'donation-news':'donation')}).then(function(ok){
      if(ok&&options.preferDonation)window.setTimeout(function(){showDonationSupportPanel(profile,label,homepage);},0);
      return ok;
    });
  }


  function renderCard(it){
    const rawImg = safeUrl(it?.media?.thumb) || '';
    const title = escHtml(it?.org?.name || it?.title || '');
    const meta = escHtml(
      it?.org?.country ||
      it?.donation?.currency ||
      it?.category ||
      ''
    );
    const summary = escHtml(it?.summary || it?.org?.legal_name || '');
    const sectionKey = String(it?.psom_key || it?.section || it?.bind?.section || '').trim();
    const globalLane = sectionKey === 'donation-global';
    const mediaSource = globalLane ? (safeExternalUrl(it?.media?.src) || safeExternalUrl(it?.videoUrl) || (String(it?.link?.mode||'').toLowerCase()==='content-video'?safeExternalUrl(it?.link?.url):'') || (looksPlayableVideoUrl(it?.url)?safeExternalUrl(it?.url):'')) : '';
    const playableVideo = globalLane && !!mediaSource && (String(it?.media?.kind||it?.type||'').toLowerCase()==='video' || String(it?.link?.mode||'').toLowerCase()==='content-video' || looksPlayableVideoUrl(mediaSource));
    // Organization lanes open the verified homepage. Global News keeps its actual
    // article/video destination and uses the shared MediaHub player for videos.
    const url = globalLane ? (mediaSource || safeExternalUrl(it?.link?.url) || safeExternalUrl(it?.url) || '') : (safeExternalUrl(it?.org?.homepage) || safeExternalUrl(it?.link?.url) || safeExternalUrl(it?.url) || '');
    const uidRaw = String(it?.uid || it?.id || '');
    donationProfileByUid.set(uidRaw, it?.donation && typeof it.donation==='object' ? it.donation : {});
    const uid = escAttr(uidRaw);
    const sample = isSeedItem(it) || /(?:placeholder|sample)/i.test(rawImg);
    const img = sample ? '' : safeExternalUrl(rawImg);
    const neutralFallback = '<span class="donation-thumb-fallback" aria-hidden="true" style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;background:#e5e7eb;color:#9ca3af;font-size:24px">↗</span>';
    const thumbImage = img
      ? `<img class="donation-site-thumb" src="${escAttr(img)}" loading="lazy" alt="${title}"><span class="donation-thumb-fallback" aria-hidden="true" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;background:#e5e7eb;color:#9ca3af;font-size:24px">↗</span>`
      : neutralFallback;
    const thumbHtml = url
      ? `<a class="donation-thumb-link" href="${escAttr(url)}" target="_self" rel="noopener noreferrer" aria-label="${title}" style="display:block;width:100%;height:100%;cursor:pointer;position:relative;z-index:4;pointer-events:auto">${thumbImage}</a>`
      : thumbImage;

    return `
      <div class="card donation-card" data-uid="${uid}" data-url="${escAttr(url)}" data-section="${escAttr(sectionKey)}" data-donation-video="${playableVideo?'1':'0'}" data-media-source="${escAttr(mediaSource)}" data-media-title="${title}" data-content-id="${uid}" role="${url?'link':'group'}" ${url?'tabindex="0"':''} aria-label="${title}">
        <div class="thumb">${thumbHtml}</div>
        <div class="card-body">
          <div class="card-title">${title || '-'}</div>
          <div class="card-meta">${meta || '-'}</div>
          <div class="card-preview">${summary || ''}</div>
        </div>
      </div>
    `;
  }

  function wireThumbnailFailures(box){
    if(!box) return;
    box.querySelectorAll('img.donation-site-thumb').forEach((img)=>{
      if(img.dataset.donationThumbFailBound === '1') return;
      img.dataset.donationThumbFailBound = '1';
      const fail=()=>{
        img.style.display='none';
        const fallback=img.parentElement?.querySelector?.('.donation-thumb-fallback');
        if(fallback) fallback.style.display='flex';
      };
      img.addEventListener('error', fail, { once:true });
      if(img.complete && !img.naturalWidth) fail();
    });

    /* Keep the institution thumbnail as a native browser hyperlink.
       The legacy multilingual HTML attaches pointer capture to .row-track on
       pointerdown.  Stop only the live thumbnail's pointer events from bubbling
       to that drag handler; do not preventDefault(), so the anchor keeps normal
       browser navigation without touching any of the 30 language HTML files. */
    box.querySelectorAll('a.donation-thumb-link').forEach((a)=>{
      if(a.dataset.donationHomepageBound === '1') return;
      a.dataset.donationHomepageBound = '1';
      const stopDragBubble = (e)=>{
        if(!safeExternalUrl(a.getAttribute('href'))) return;
        e.stopPropagation();
      };
      a.addEventListener('pointerdown', stopDragBubble);
      a.addEventListener('pointerup', stopDragBubble);
      a.addEventListener('click', function(e){
        const url=safeExternalUrl(a.getAttribute('href'));
        if(!url) return;
        e.preventDefault();
        e.stopPropagation();
        if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation();
        const card=a.closest('.donation-card');
        const label=card&&card.querySelector('.card-title')?card.querySelector('.card-title').textContent:'';
        if(card)openDonationCard(card);
        else openContainedHomepage(url,label,{kind:'donation'});
      });
    });
  }

function mountSection(key, items, limit){
  const box = document.querySelector(`[data-psom-key="${key}"]`);
  if(!box) return;

  const row = box.closest?.('.feed-row');
  const htmlCount = row ? Number(row.dataset.count || 0) : 0;
  const finalLimit = clampLimit(htmlCount || limit || 80);

  function sampleLabel(sectionKey){
    switch(sectionKey){
      case 'donation-global': return 'Global News';
      case 'donation-ngo': return 'NGO';
      case 'donation-mission': return 'Mission';
      case 'donation-service': return 'Service';
      case 'donation-relief': return 'Relief';
      case 'donation-education': return 'Education';
      case 'donation-environment': return 'Environment';
      case 'donation-others': return 'Others';
      default: return 'Donation';
    }
  }

  function buildFallbackSamples(sectionKey, count, usedOrdinals){
    const label = sampleLabel(sectionKey);
    const out = [];
    const used = usedOrdinals instanceof Set ? new Set(usedOrdinals) : new Set();
    let ordinal = 1;

    while(out.length < count && ordinal <= 200){
      if(used.has(ordinal)){ ordinal += 1; continue; }
      used.add(ordinal);
      out.push({
        uid: `sample:${sectionKey}:${String(ordinal).padStart(3,'0')}`,
        id: `sample:${sectionKey}:${String(ordinal).padStart(3,'0')}`,
        psom_key: sectionKey,
        category: sectionKey.replace(/^donation-/, '') || 'donation',
        title: `${label} Partner ${ordinal}`,
        summary: 'Verified data will replace this sample automatically.',
        org: {
          name: `${label} Partner ${ordinal}`,
          country: '-',
          legal_name: ''
        },
        donation: {
          checkout_url: ''
        },
        link: {
          url: '#'
        },
        media: {
          thumb: '/assets/img/placeholder.png'
        },
        bank_ref: {
          record_id: null
        },
        verify: {
          status: 'sample'
        },
        meta: {
          source: 'automap-sample'
        }
      });
      ordinal += 1;
    }

    return out;
  }

  let list = (Array.isArray(items) ? items : []).filter(Boolean);

  // Builder normally returns a fully populated lane.  This is a second safety
  // net for partial/missing responses: every vacant front slot is restored with
  // a sample card, while real content remains first and existing sample numbers
  // are not duplicated.
  if(list.length < finalLimit){
    const usedSeedOrdinals = new Set(
      list.filter(isSeedItem).map(seedOrdinal).filter((n)=>Number.isFinite(n) && n >= 1 && n <= 200)
    );
    const fallback = buildFallbackSamples(key, finalLimit - list.length, usedSeedOrdinals);
    list = sortSection(list.concat(fallback));
  }

  box.innerHTML = '';

  const slice = list.slice(0, finalLimit);
  const job = { box, items:slice, offset:0 };
  sectionRenderJobs.set(box, job);

  function renderMore(current){
    if(!current || sectionRenderJobs.get(box) !== current) return;
    if(current.offset >= current.items.length) return;
    const end = Math.min(current.offset + RENDER_BATCH, current.items.length);
    const html = current.items.slice(current.offset, end).map(renderCard).join('');
    box.insertAdjacentHTML('beforeend', html);
    current.offset = end;
    wireThumbnailFailures(box);
  }

  renderMore(job);
  if(box.dataset.donationBatchBound === '1') return;
  box.dataset.donationBatchBound = '1';
  box.addEventListener('scroll', ()=>{
    const current = sectionRenderJobs.get(box);
    if(!current || current.offset >= current.items.length) return;
    const horizontal = box.scrollWidth > box.clientWidth + 2;
    const nearEnd = horizontal
      ? box.scrollLeft + box.clientWidth >= box.scrollWidth - 60
      : box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
    if(nearEnd) renderMore(current);
  }, { passive:true });
}

  async function main(){
    const results = await Promise.all([loadSnapshot(),loadDonationGeo()]);
    const snapshot = results[0], geo = results[1];

    if(!snapshot?.sections || !snapshot?.items){
      console.error('Invalid donation snapshot');
      return;
    }

    const limits = buildSectionIndex(snapshot.sections);
    const items = normalizeItems(snapshot.items);
    const groups = groupBySection(items);

    Object.keys(limits).forEach((key)=>{
      let list = groups[key] || [];
      list = localizeInstitutionItems(list,key,geo);
      list = sortSection(list);
      mountSection(key, list, limits[key]);
    });
  }

  function bindClicks(){
    document.addEventListener('click', (e)=>{
      if(e.target?.closest?.('a.donation-thumb-link')) return;
      const card = e.target?.closest?.('.donation-card');
      if(!card) return;
      const url = safeExternalUrl(card.getAttribute('data-url'));
      if(url){ e.preventDefault(); e.stopPropagation(); openDonationCard(card); }
    });

    document.addEventListener('keydown', (e)=>{
      if(e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target?.closest?.('.donation-card');
      if(!card) return;
      e.preventDefault();
      const url = safeExternalUrl(card.getAttribute('data-url'));
      if(url){openDonationCard(card);}
    });
  }

  function bindDonationMenuNavigation(){
    const sectionKeys=['donation-ngo','donation-mission','donation-service','donation-relief','donation-education','donation-environment','donation-others'];
    document.addEventListener('click',function(e){
      const btn=e.target&&e.target.closest?e.target.closest('#donationSectionMenuBackdrop .donation-section-orgs button'):null;
      if(!btn)return;
      const group=btn.closest('.donation-section-group');
      const groups=Array.from(document.querySelectorAll('#donationSectionMenuBody .donation-section-group'));
      const key=sectionKeys[Math.max(0,groups.indexOf(group))]||'';
      const title=String(btn.textContent||'').trim();
      const track=key?document.querySelector('[data-psom-key="'+key+'"]'):null;
      const card=track?Array.from(track.querySelectorAll('.donation-card')).find(function(node){
        return String(node.querySelector('.card-title')?.textContent||'').trim()===title;
      }):null;
      if(!card||!safeExternalUrl(card.getAttribute('data-url')))return;
      e.preventDefault();e.stopPropagation();if(typeof e.stopImmediatePropagation==='function')e.stopImmediatePropagation();
      const backdrop=document.getElementById('donationSectionMenuBackdrop');
      if(backdrop){backdrop.style.display='none';backdrop.setAttribute('aria-hidden','true');}
      openDonationCard(card,{preferDonation:true});
    },true);
  }

  function boot(){
    bindClicks();
    bindDonationMenuNavigation();
    primeDonationInteractionEngines();
  main();

    let reran = false;
    const mo = new MutationObserver(()=>{
      if(reran) return;
      const anyTrack = document.querySelector('[data-psom-key].row-track');
      if(anyTrack && anyTrack.querySelector('.card') && !anyTrack.querySelector('.donation-card')){
        reran = true;
        main();
        try{ mo.disconnect(); }catch(_e){}
      }
    });
    try{ mo.observe(document.documentElement, { childList:true, subtree:true }); }catch(_e){}
  }

  document.addEventListener('DOMContentLoaded', boot);
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
