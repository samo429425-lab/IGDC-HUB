/* IGDC Social Network interaction bridge. Loaded before the former immediate
 * fullscreen handler. It changes only social main-card and right-panel entry.
 */
(function(){
  'use strict';
  if(window.__IGDC_SOCIAL_SNS_INTERACTION_V1__)return;
  window.__IGDC_SOCIAL_SNS_INTERACTION_V1__=true;
  // Stop the old script from taking over the first click with native fullscreen.
  window.__SOCIAL_MAIN_FULLSCREEN_READY__=true;
  function q(s,r){return(r||document).querySelector(s);}
  function t(v){return v==null?'':String(v);}
  function lang(){var x=t(document.documentElement.lang||'en').toLowerCase().replace('_','-');if(x==='ko-kr')return'ko';if(x==='zh-cn')return'zh';if(x==='zh-tw'||x==='zh-hk')return'zht';return x.split('-')[0]||'en';}
  var L={
    ko:['상품 정보 준비 중','실제 상품 정보가 등록되면 이 자리에서 바로 상세 페이지로 연결됩니다.','전체 화면','열기'],
    en:['Product information is being prepared','When the actual product is registered, this same place will open its detail page.','Fullscreen','Open'],
    ar:['يتم إعداد معلومات المنتج','عند تسجيل المنتج الفعلي، سيفتح هذا المكان صفحة التفاصيل مباشرة.','ملء الشاشة','فتح'],
    bn:['পণ্যের তথ্য প্রস্তুত করা হচ্ছে','প্রকৃত পণ্য নিবন্ধিত হলে এখান থেকেই বিস্তারিত পৃষ্ঠা খুলবে।','পূর্ণ পর্দা','খুলুন'],
    de:['Produktinformationen werden vorbereitet','Sobald das tatsächliche Produkt registriert ist, öffnet sich hier direkt die Detailseite.','Vollbild','Öffnen'],
    es:['La información del producto se está preparando','Cuando se registre el producto real, este mismo lugar abrirá su página de detalles.','Pantalla completa','Abrir'],
    fa:['اطلاعات محصول در حال آماده‌سازی است','پس از ثبت محصول واقعی، صفحه جزئیات از همین‌جا باز می‌شود.','تمام‌صفحه','باز کردن'],
    fr:['Les informations sur le produit sont en préparation','Lorsque le produit réel sera enregistré, cette même zone ouvrira sa page de détail.','Plein écran','Ouvrir'],
    hi:['उत्पाद जानकारी तैयार की जा रही है','वास्तविक उत्पाद दर्ज होने पर यहीं से उसका विवरण पृष्ठ खुलेगा।','पूर्ण स्क्रीन','खोलें'],
    hu:['A termékinformáció előkészítés alatt áll','Amikor a tényleges termék regisztrálva lesz, innen közvetlenül megnyílik a részletező oldala.','Teljes képernyő','Megnyitás'],
    id:['Informasi produk sedang disiapkan','Saat produk sebenarnya terdaftar, halaman detailnya akan terbuka dari tempat yang sama.','Layar penuh','Buka'],
    it:['Le informazioni sul prodotto sono in preparazione','Quando il prodotto reale sarà registrato, da qui si aprirà direttamente la pagina dei dettagli.','Schermo intero','Apri'],
    ja:['商品情報を準備中です','実際の商品が登録されると、この場所から詳細ページが開きます。','全画面','開く'],
    ms:['Maklumat produk sedang disediakan','Apabila produk sebenar didaftarkan, halaman butirannya akan dibuka dari tempat yang sama.','Skrin penuh','Buka'],
    nl:['Productinformatie wordt voorbereid','Wanneer het daadwerkelijke product is geregistreerd, opent hier de detailpagina.','Volledig scherm','Openen'],
    pl:['Informacje o produkcie są przygotowywane','Gdy właściwy produkt zostanie zarejestrowany, w tym miejscu otworzy się jego strona szczegółów.','Pełny ekran','Otwórz'],
    pt:['As informações do produto estão sendo preparadas','Quando o produto real for registrado, esta mesma área abrirá a página de detalhes.','Tela cheia','Abrir'],
    ru:['Информация о товаре готовится','Когда фактический товар будет зарегистрирован, здесь откроется его страница с подробностями.','На весь экран','Открыть'],
    sv:['Produktinformationen förbereds','När den verkliga produkten är registrerad öppnas dess detaljsida här.','Helskärm','Öppna'],
    sw:['Maelezo ya bidhaa yanaandaliwa','Bidhaa halisi itakaposajiliwa, ukurasa wake wa maelezo utafunguka hapa.','Skrini nzima','Fungua'],
    ta:['தயாரிப்பு தகவல் தயாராகிக் கொண்டிருக்கிறது','உண்மையான தயாரிப்பு பதிவு செய்யப்பட்டவுடன், இதே இடத்தில் விவரப் பக்கம் திறக்கும்.','முழுத்திரை','திற'],
    th:['กำลังเตรียมข้อมูลสินค้า','เมื่อมีการลงทะเบียนสินค้าจริง หน้านี้จะเปิดรายละเอียดสินค้าในตำแหน่งเดิม','เต็มหน้าจอ','เปิด'],
    tl:['Inihahanda ang impormasyon ng produkto','Kapag nairehistro ang aktuwal na produkto, bubuksan dito ang pahina ng detalye nito.','Buong screen','Buksan'],
    tr:['Ürün bilgileri hazırlanıyor','Gerçek ürün kaydedildiğinde ayrıntı sayfası aynı yerden açılır.','Tam ekran','Aç'],
    uk:['Інформація про товар готується','Коли фактичний товар буде зареєстровано, тут відкриється його сторінка з деталями.','На весь екран','Відкрити'],
    ur:['مصنوعات کی معلومات تیار کی جا رہی ہیں','اصل مصنوعہ درج ہونے پر اسی جگہ سے تفصیلی صفحہ کھل جائے گا۔','مکمل اسکرین','کھولیں'],
    uz:['Mahsulot ma’lumoti tayyorlanmoqda','Haqiqiy mahsulot ro‘yxatdan o‘tganda, shu joydan uning batafsil sahifasi ochiladi.','To‘liq ekran','Ochish'],
    vi:['Thông tin sản phẩm đang được chuẩn bị','Khi sản phẩm thực được đăng ký, trang chi tiết sẽ mở ngay tại đây.','Toàn màn hình','Mở'],
    zh:['商品信息正在准备中','实际商品登记后，将从此处直接打开详情页。','全屏','打开'],
    zht:['商品資訊準備中','實際商品登錄後，將從這裡直接開啟詳細頁面。','全螢幕','開啟']
  };
  function copy(){return L[lang()]||L.en;}
  function pending(v){v=t(v).trim();return !v||v==='#'||/^javascript:/i.test(v)||/\/pages\/coming-soon\.html/i.test(v)||/(?:^|\.)example\.com(?:[/:?#]|$)/i.test(v);}
  function mobile(){return matchMedia('(max-width:768px), (hover:none) and (pointer:coarse) and (max-width:1024px)').matches;}

  /* Social right panel: use the same pending-detail entry when no real target exists. */
  var ps={open:false,pushed:false,last:null};
  function pendingRoot(){
    var root=document.getElementById('igdcSocialPendingEntry');if(root)return root;
    var st=document.createElement('style');st.id='igdcSocialPendingEntryStyle';st.textContent=''
      +'#igdcSocialPendingEntry{position:fixed;inset:0;z-index:2147483550;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.48)}'
      +'#igdcSocialPendingEntry.open{display:flex}'
      +'#igdcSocialPendingEntry .igdc-pending-sheet{width:min(680px,96vw);max-height:min(76vh,720px);overflow:auto;background:#0b0c0f;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 18px 46px rgba(0,0,0,.55)}'
      +'#igdcSocialPendingEntry header{padding:15px 17px;border-bottom:1px solid rgba(255,255,255,.12)}'
      +'#igdcSocialPendingEntry h3{margin:0;font-size:18px;line-height:1.35}'
      +'#igdcSocialPendingEntry .igdc-pending-body{padding:20px 17px;line-height:1.65}'
      +'#igdcSocialPendingEntry .igdc-pending-state{font-weight:800;font-size:1.05rem;margin-bottom:8px}';
    (document.head||document.documentElement).appendChild(st);
    root=document.createElement('div');root.id='igdcSocialPendingEntry';root.setAttribute('aria-hidden','true');
    root.innerHTML='<section class="igdc-pending-sheet" role="dialog" aria-modal="true" aria-labelledby="igdcSocialPendingTitle"><header><h3 id="igdcSocialPendingTitle"></h3></header><div class="igdc-pending-body"><div class="igdc-pending-state"></div><div class="igdc-pending-copy"></div></div></section>';
    document.body.appendChild(root);return root;
  }
  function openPending(a){var root=pendingRoot(),c=copy(),box=a.closest('.ad-box')||a,title=t(a.dataset.productTitle||box.dataset.productTitle||a.textContent).trim()||c[0];q('#igdcSocialPendingTitle',root).textContent=title;q('.igdc-pending-state',root).textContent=c[0];q('.igdc-pending-copy',root).textContent=c[1];ps.last=document.activeElement;root.classList.add('open');root.setAttribute('aria-hidden','false');if(!ps.open){ps.open=true;try{history.pushState({igdcPendingSocial:Date.now()},'',location.href);ps.pushed=true;}catch(_){ps.pushed=false;}}}
  function closePending(){var root=document.getElementById('igdcSocialPendingEntry');if(root){root.classList.remove('open');root.setAttribute('aria-hidden','true');}var f=ps.last;ps.open=false;ps.pushed=false;if(f&&f.focus){try{f.focus({preventScroll:true});}catch(_){}}}

  /* Social main/right-panel slots: all nine SNS stay inside the IGDC viewer. */
  var vs={open:false,pushed:false,last:null,wasFullscreen:false,closing:false};
  function viewerStyle(){
    if(document.getElementById('snfvStyleV2'))return;
    var st=document.createElement('style');st.id='snfvStyleV2';st.textContent=''
      +'#snfvRoot{position:fixed;inset:0;z-index:2147483560;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:12px}'
      +'#snfvRoot.open{display:flex}'
      +'#snfvRoot .snfv-panel{position:relative;width:min(1180px,98vw);height:min(86vh,860px);display:grid;grid-template-rows:minmax(0,1fr) auto;background:#07080a;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:16px;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,.58)}'
      +'#snfvRoot .snfv-close{position:absolute;right:10px;top:10px;z-index:8;width:38px;height:38px;border:0;border-radius:999px;background:rgba(0,0,0,.66);color:#fff;font-size:19px;cursor:pointer}'
      +'#snfvRoot .snfv-media{min-height:0;display:grid;place-items:center;background:#000;overflow:hidden}'
      +'#snfvRoot .snfv-media iframe,#snfvRoot .snfv-media video,#snfvRoot .snfv-media img{width:100%;height:100%;border:0;object-fit:contain;background:#000}'
      +'#snfvRoot .snfv-fallback{width:100%;height:100%;display:grid;place-items:center;text-align:center;padding:32px;background:#0d0f13;color:#e8e8e8}'
      +'#snfvRoot .snfv-meta{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;background:#0b0c0f;border-top:1px solid rgba(255,255,255,.12)}'
      +'#snfvRoot .snfv-title{font-weight:800;line-height:1.35}#snfvRoot .snfv-desc{margin-top:4px;opacity:.8;font-size:13px;line-height:1.45}'
      +'#snfvRoot .snfv-actions{display:flex;gap:8px;flex:0 0 auto}#snfvRoot .snfv-btn{min-width:42px;height:38px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#151820;color:#fff;cursor:pointer}'
      +'#snfvRoot .snfv-provider-note{font-size:13px;line-height:1.55;opacity:.88;max-width:620px}'
      +'#snfvRoot .snfv-panel:fullscreen{width:100vw;height:100vh;border:0;border-radius:0}'
      +'@media(max-width:768px){#snfvRoot{padding:0}#snfvRoot .snfv-panel{width:100vw;height:100dvh;border-radius:0;border:0}#snfvRoot .snfv-meta{padding:10px}.snfv-desc{display:none}}';
    (document.head||document.documentElement).appendChild(st);
  }
  function viewerRoot(){
    viewerStyle();
    var root=document.getElementById('snfvRoot');if(root)return root;
    root=document.createElement('div');root.id='snfvRoot';root.className='snfv';root.setAttribute('aria-hidden','true');
    root.innerHTML='<div class="snfv-panel" tabindex="-1"><button type="button" class="snfv-close" aria-label="Close">✕</button><div class="snfv-media" id="snfvMedia"></div><div class="snfv-meta"><div class="snfv-text"><div class="snfv-title" id="snfvTitle"></div><div class="snfv-desc" id="snfvDesc"></div></div><div class="snfv-actions"><button type="button" id="snfvFullscreenBtn" class="snfv-btn">⛶</button></div></div></div>';
    document.body.appendChild(root);q('.snfv-close',root).addEventListener('click',closeViewerRequest);root.addEventListener('click',function(e){if(e.target===root)closeViewerRequest();});q('#snfvFullscreenBtn',root).addEventListener('click',requestFullscreen);return root;
  }
  function bg(el){if(!el)return'';var m=(getComputedStyle(el).backgroundImage||'').match(/url\(["']?(.*?)["']?\)/);return m&&m[1]?m[1]:'';}
  function platformOf(url,hint){
    var p=t(hint).trim().toLowerCase();if(p==='x')p='twitter';
    if(/^(youtube|instagram|tiktok|facebook|wechat|weibo|pinterest|reddit|twitter)$/.test(p))return p;
    try{var h=new URL(url,location.href).hostname.toLowerCase().replace(/^www\./,'');
      if(h==='youtu.be'||/(^|\.)youtube(?:-nocookie)?\.com$/.test(h))return'youtube';
      if(/(^|\.)instagram\.com$/.test(h))return'instagram';
      if(/(^|\.)tiktok\.com$/.test(h))return'tiktok';
      if(/(^|\.)facebook\.com$/.test(h)||/(^|\.)fb\.watch$/.test(h))return'facebook';
      if(/(^|\.)mp\.weixin\.qq\.com$/.test(h))return'wechat';
      if(/(^|\.)weibo\.(?:com|cn)$/.test(h)||h==='m.weibo.cn')return'weibo';
      if(/(^|\.)pinterest\.(?:com|co\.kr)$/.test(h)||h==='pin.it')return'pinterest';
      if(/(^|\.)reddit\.com$/.test(h)||h==='redd.it')return'reddit';
      if(/(^|\.)(?:x|twitter)\.com$/.test(h))return'twitter';
    }catch(_){ }return'';
  }
  function youtubeId(value){
    value=t(value);var m=value.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/))([A-Za-z0-9_-]{6,})/i);
    if(!m)m=value.match(/(?:i|img)\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\//i);
    return m&&m[1]||'';
  }
  function embedFor(url,hint,thumb){
    var p=platformOf(url,hint),u,m,path,id;
    if(p==='youtube'){id=youtubeId(url)||youtubeId(thumb);return{platform:p,url:id?'https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id)+'?autoplay=1&rel=0&playsinline=1':'',raw:false};}
    try{u=new URL(url,location.href);path=u.pathname||'/';}catch(_){return{platform:p,url:'',raw:false};}
    if(p==='instagram'){m=path.match(/^\/(p|reel|reels|tv)\/([^/?#]+)/i);return{platform:p,url:m?'https://www.instagram.com/'+(m[1].toLowerCase()==='reels'?'reel':m[1].toLowerCase())+'/'+encodeURIComponent(m[2])+'/embed/':'',raw:false};}
    if(p==='tiktok'){m=path.match(/\/video\/(\d+)/i);return{platform:p,url:m?'https://www.tiktok.com/player/v1/'+encodeURIComponent(m[1])+'?autoplay=1&loop=0':'',raw:false};}
    if(p==='facebook'){var ep=(/\/(?:reel|watch|videos)\//i.test(path)||/\/videos\//i.test(path)||/watch\/?.*v=/i.test(url))?'video.php':'post.php';return{platform:p,url:'https://www.facebook.com/plugins/'+ep+'?href='+encodeURIComponent(url)+(ep==='video.php'?'&show_text=false&autoplay=true':'&show_text=true'),raw:false};}
    if(p==='pinterest'){m=path.match(/\/pin\/(\d+)/i);return{platform:p,url:m?'https://assets.pinterest.com/ext/embed.html?id='+encodeURIComponent(m[1]):url,raw:!m};}
    if(p==='reddit'){return{platform:p,url:/\/comments\//i.test(path)?'https://www.redditmedia.com'+path.replace(/\/?$/,'/')+'?ref_source=embed&ref=share&embed=true':url,raw:!/\/comments\//i.test(path)};}
    if(p==='twitter'){m=path.match(/\/status\/(\d+)/i);return{platform:p,url:m?'https://platform.twitter.com/embed/Tweet.html?id='+encodeURIComponent(m[1])+'&dnt=true':url,raw:!m};}
    // WeChat/Weibo do not provide a stable universal embed endpoint. Keep the
    // actual public page inside the IGDC frame instead of navigating away.
    if((p==='wechat'||p==='weibo')&&/^https:\/\//i.test(url))return{platform:p,url:url,raw:true};
    return{platform:p,url:'',raw:false};
  }
  function sectionPlatform(card){
    var grid=card&&card.closest&&card.closest('.thumb-grid[data-psom-key]'),key=t(grid&&grid.getAttribute('data-psom-key')).toLowerCase();
    return key.indexOf('social-')===0?key.slice(7):'';
  }
  function firstCardUrl(card){
    if(!card)return'';var d=card.dataset||{},vals=[d.socialUrl,d.latestContentUrl,d.sourceUrl,d.contentUrl,d.permalink,d.url,d.href,d.productLink,card.getAttribute&&card.getAttribute('href')];
    for(var i=0;i<vals.length;i++){var v=t(vals[i]).trim();if(v&&!pending(v))return v;}return'';
  }
  function cardData(card){
    var pic=q('.pic',card),im=q('img',card),vid=q('video',card),d=card.dataset||{},href=firstCardUrl(card),thumb=(im&&im.src)||t(d.thumbnailUrl)||bg(pic),platform=platformOf(href,d.platform||sectionPlatform(card));
    return{title:t((q('.title',card)||{}).textContent||d.title).trim(),desc:t((q('.desc',card)||{}).textContent||d.description).trim(),href:href,img:im&&im.src||t(d.thumbnailUrl),video:vid&&(vid.currentSrc||vid.src)||'',poster:vid&&vid.poster||'',bg:bg(pic),thumb:thumb,platform:platform,embed:t(d.embedUrl||d.embed).trim()};
  }
  function appendFallback(media,d,platform){
    var fb=document.createElement('div');fb.className='snfv-fallback';
    fb.innerHTML='<div><strong>'+((d.title||platform||'SNS').replace(/[<&]/g,function(x){return x==='<'?'&lt;':'&amp;';}))+'</strong><div class="snfv-provider-note">실제 SNS 콘텐츠 주소를 확인할 수 없어 재생을 시작하지 못했습니다. 이 카드는 외부 사이트로 이동하지 않습니다.</div></div>';media.appendChild(fb);
  }
  function openViewer(card){
    var root=viewerRoot(),d=cardData(card),c=copy(),media=q('#snfvMedia',root),resolved=embedFor(d.href,d.platform,d.thumb),src=d.embed||resolved.url;media.innerHTML='';q('#snfvTitle',root).textContent=d.title||resolved.platform||'SNS';q('#snfvDesc',root).textContent=d.desc||'';q('#snfvFullscreenBtn',root).title=c[2];q('#snfvFullscreenBtn',root).setAttribute('aria-label',c[2]);
    if(d.video){var v=document.createElement('video');v.src=d.video;if(d.poster)v.poster=d.poster;v.controls=true;v.autoplay=true;v.playsInline=true;media.appendChild(v);}
    else if(src){var f=document.createElement('iframe');f.src=src;f.title=d.title||resolved.platform||'SNS';f.loading='eager';f.referrerPolicy='strict-origin-when-cross-origin';f.allow='autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share';f.setAttribute('allowfullscreen','');f.setAttribute('data-platform',resolved.platform||d.platform||'');media.appendChild(f);}
    else appendFallback(media,d,resolved.platform||d.platform);
    vs.last=document.activeElement;root.classList.add('open');root.setAttribute('aria-hidden','false');vs.open=true;vs.closing=false;if(!vs.pushed){try{history.pushState({igdcSocialViewer:Date.now(),href:d.href},'',location.href);vs.pushed=true;}catch(_){vs.pushed=false;}}var panel=q('.snfv-panel',root);if(panel){try{panel.focus({preventScroll:true});}catch(_){}}if(mobile())requestFullscreen();
  }
  function requestFullscreen(){if(!vs.open||document.fullscreenElement)return;var p=q('#snfvRoot .snfv-panel');if(p&&p.requestFullscreen)p.requestFullscreen().catch(function(){});}
  function finishViewer(){var r=document.getElementById('snfvRoot');if(r){r.classList.remove('open');r.setAttribute('aria-hidden','true');var m=q('#snfvMedia',r);if(m)m.innerHTML='';}var f=vs.last;vs.open=false;vs.pushed=false;vs.wasFullscreen=false;vs.closing=false;if(f&&f.focus){try{f.focus({preventScroll:true});}catch(_){}}}
  function closeViewerRequest(){if(!vs.open)return;vs.closing=true;if(document.fullscreenElement&&document.exitFullscreen){document.exitFullscreen().catch(function(){});}if(vs.pushed){try{history.back();return;}catch(_){}}finishViewer();}
  document.addEventListener('fullscreenchange',function(){if(!vs.open)return;var panel=q('#snfvRoot .snfv-panel');if(document.fullscreenElement===panel){vs.wasFullscreen=true;return;}if(vs.wasFullscreen&&!vs.closing){vs.wasFullscreen=false;closeViewerRequest();}});
  window.addEventListener('popstate',function(){if(ps.open){closePending();return;}if(vs.open){vs.closing=true;if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(function(){});finishViewer();}});
  document.addEventListener('keydown',function(e){if(!vs.open)return;if(e.key==='Enter'&&!e.repeat&&!document.fullscreenElement){var tag=(e.target&&e.target.tagName||'').toLowerCase();if(tag!=='input'&&tag!=='textarea'&&tag!=='select'){e.preventDefault();requestFullscreen();}return;}if(e.key==='Escape'&&!document.fullscreenElement){e.preventDefault();closeViewerRequest();}},true);
  document.addEventListener('click',function(e){
    var card=e.target&&e.target.closest&&e.target.closest('.thumb-grid[data-psom-key] a.card,#rightAutoPanel a,#rpMobileGrid a');if(!card)return;
    var href=firstCardUrl(card),hint=t((card.dataset||{}).platform||sectionPlatform(card));
    if(!href){e.preventDefault();e.stopImmediatePropagation();openPending(card);return;}
    if(!platformOf(href,hint))return;
    e.preventDefault();e.stopImmediatePropagation();openViewer(card);
  },true);
})();
