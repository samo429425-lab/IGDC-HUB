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

  /* Social main slots: desktop two-stage viewer; mobile directly asks for fullscreen. */
  var vs={open:false,pushed:false,last:null,wasFullscreen:false,ignoreEscapeUntil:0,closing:false};
  function viewerRoot(){
    var root=document.getElementById('snfvRoot');if(root)return root;
    root=document.createElement('div');root.id='snfvRoot';root.className='snfv';root.setAttribute('aria-hidden','true');
    root.innerHTML='<div class="snfv-panel" tabindex="-1"><button type="button" class="snfv-close" aria-label="Close">✕</button><div class="snfv-media" id="snfvMedia"></div><div class="snfv-meta"><div class="snfv-text"><div class="snfv-title" id="snfvTitle"></div><div class="snfv-desc" id="snfvDesc"></div></div><div class="snfv-actions"><button type="button" id="snfvFullscreenBtn" class="snfv-btn">⛶</button><a id="snfvOpenBtn" class="snfv-btn" href="#" target="_blank" rel="noopener"></a></div></div></div>';
    document.body.appendChild(root);q('.snfv-close',root).addEventListener('click',closeViewerRequest);root.addEventListener('click',function(e){if(e.target===root)closeViewerRequest();});q('#snfvFullscreenBtn',root).addEventListener('click',requestFullscreen);return root;
  }
  function bg(el){if(!el)return'';var m=(getComputedStyle(el).backgroundImage||'').match(/url\(["']?(.*?)["']?\)/);return m&&m[1]?m[1]:'';}
  function cardData(card){var pic=q('.pic',card),im=q('img',card),vid=q('video',card);return{title:t((q('.title',card)||{}).textContent).trim(),desc:t((q('.desc',card)||{}).textContent).trim(),href:t(card.getAttribute('href')).trim(),img:im&&im.src||'',video:vid&&(vid.currentSrc||vid.src)||'',poster:vid&&vid.poster||'',bg:bg(pic)}}
  function openViewer(card){
    var root=viewerRoot(),d=cardData(card),c=copy(),media=q('#snfvMedia',root),open=q('#snfvOpenBtn',root);media.innerHTML='';q('#snfvTitle',root).textContent=d.title||'SNS';q('#snfvDesc',root).textContent=d.desc||'';q('#snfvFullscreenBtn',root).title=c[2];q('#snfvFullscreenBtn',root).setAttribute('aria-label',c[2]);open.textContent=c[3];
    if(d.video){var v=document.createElement('video');v.src=d.video;if(d.poster)v.poster=d.poster;v.controls=true;v.autoplay=true;v.playsInline=true;media.appendChild(v);}else if(d.img||d.bg){var im=document.createElement('img');im.src=d.img||d.bg;im.alt=d.title||'SNS';media.appendChild(im);}else{var fb=document.createElement('div');fb.className='snfv-fallback';fb.textContent=d.title||'SNS';media.appendChild(fb);}
    if(!pending(d.href)){open.href=d.href;open.style.display='inline-flex';}else{open.href='#';open.style.display='none';}
    vs.last=document.activeElement;root.classList.add('open');root.setAttribute('aria-hidden','false');vs.open=true;if(!vs.pushed){try{history.pushState({igdcSocialViewer:Date.now()},'',location.href);vs.pushed=true;}catch(_){vs.pushed=false;}}var panel=q('.snfv-panel',root);if(panel){try{panel.focus({preventScroll:true});}catch(_){}}if(mobile())requestFullscreen();
  }
  function requestFullscreen(){if(!vs.open||document.fullscreenElement)return;var p=q('#snfvRoot .snfv-panel');if(p&&p.requestFullscreen)p.requestFullscreen().catch(function(){});}
  function finishViewer(){var r=document.getElementById('snfvRoot');if(r){r.classList.remove('open');r.setAttribute('aria-hidden','true');}var f=vs.last;vs.open=false;vs.pushed=false;vs.wasFullscreen=false;vs.ignoreEscapeUntil=0;vs.closing=false;if(f&&f.focus){try{f.focus({preventScroll:true});}catch(_){}}}
  function closeViewerRequest(){if(!vs.open)return;vs.closing=true;if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(function(){});if(vs.pushed){try{history.back();return;}catch(_){}}finishViewer();}
  document.addEventListener('fullscreenchange',function(){if(!vs.open)return;var p=q('#snfvRoot .snfv-panel');if(document.fullscreenElement===p){vs.wasFullscreen=true;return;}if(vs.wasFullscreen){vs.wasFullscreen=false;vs.ignoreEscapeUntil=Date.now()+650;if(mobile()&&!vs.closing)closeViewerRequest();}});
  window.addEventListener('popstate',function(){if(ps.open){closePending();return;}if(vs.open){if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(function(){});finishViewer();}});
  document.addEventListener('keydown',function(e){if(!vs.open)return;if(e.key==='Enter'&&!e.repeat&&!document.fullscreenElement){var tag=(e.target&&e.target.tagName||'').toLowerCase();if(tag!=='input'&&tag!=='textarea'&&tag!=='select'){e.preventDefault();requestFullscreen();}return;}if(e.key==='Escape'){if(document.fullscreenElement){e.preventDefault();vs.ignoreEscapeUntil=Date.now()+650;if(document.exitFullscreen)document.exitFullscreen().catch(function(){});return;}if(Date.now()<vs.ignoreEscapeUntil){e.preventDefault();return;}e.preventDefault();closeViewerRequest();}},true);
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest&&e.target.closest('#rightAutoPanel a,#rpMobileGrid a');
    if(a&&pending(a.getAttribute('href'))){e.preventDefault();e.stopPropagation();openPending(a);return;}
    var card=e.target&&e.target.closest&&e.target.closest('.thumb-grid[data-psom-key] a.card');if(!card)return;var grid=card.closest('.thumb-grid[data-psom-key]'),key=grid&&grid.getAttribute('data-psom-key')||'';if(!key||key==='rightPanel')return;e.preventDefault();openViewer(card);
  },true);
})();
