/*
 * IGDC / MARU MediaHub playback controller v2
 * ---------------------------------------------------------------
 * Replaces only the MediaHub card transition contract.
 * It does not change the list layout, create an inner scroller, or display
 * accounting-only watch time.  The existing document remains the only
 * vertical scroll container.
 */
(function(global, document){
  'use strict';
  if(global.__IGDC_MEDIAHUB_PLAYBACK_V2__) return;
  global.__IGDC_MEDIAHUB_PLAYBACK_V2__ = true;

  var state = { open:false, detail:null, stage:null, card:null, restore:[], scrollY:0 };
  var COPY = {
    ko:{back:'← 목록으로 돌아가기',fullscreen:'전체 화면',exitFullscreen:'전체 화면 나가기',like:'좋아요',recommend:'추천',views:'조회',preparing:'콘텐츠를 준비 중입니다.',unavailable:'이 콘텐츠의 재생 소스가 아직 연결되지 않았습니다.'},
    en:{back:'← Back to list',fullscreen:'Fullscreen',exitFullscreen:'Exit fullscreen',like:'Like',recommend:'Recommend',views:'Views',preparing:'Content is being prepared.',unavailable:'A playable source has not been connected yet.'},
    de:{back:'← Zurück zur Liste',fullscreen:'Vollbild',exitFullscreen:'Vollbild beenden',like:'Gefällt mir',recommend:'Empfehlen',views:'Aufrufe',preparing:'Der Inhalt wird vorbereitet.',unavailable:'Eine abspielbare Quelle ist noch nicht verbunden.'},
    es:{back:'← Volver a la lista',fullscreen:'Pantalla completa',exitFullscreen:'Salir de pantalla completa',like:'Me gusta',recommend:'Recomendar',views:'Vistas',preparing:'El contenido se está preparando.',unavailable:'Todavía no se ha conectado una fuente reproducible.'},
    fr:{back:'← Retour à la liste',fullscreen:'Plein écran',exitFullscreen:'Quitter le plein écran',like:'J’aime',recommend:'Recommander',views:'Vues',preparing:'Le contenu est en cours de préparation.',unavailable:'Aucune source de lecture n’est encore connectée.'},
    it:{back:'← Torna all’elenco',fullscreen:'Schermo intero',exitFullscreen:'Esci da schermo intero',like:'Mi piace',recommend:'Consiglia',views:'Visualizzazioni',preparing:'Il contenuto è in preparazione.',unavailable:'Non è ancora collegata una fonte riproducibile.'},
    pt:{back:'← Voltar à lista',fullscreen:'Tela cheia',exitFullscreen:'Sair da tela cheia',like:'Curtir',recommend:'Recomendar',views:'Visualizações',preparing:'O conteúdo está sendo preparado.',unavailable:'Ainda não há uma fonte reproduzível conectada.'},
    nl:{back:'← Terug naar lijst',fullscreen:'Volledig scherm',exitFullscreen:'Volledig scherm afsluiten',like:'Leuk',recommend:'Aanbevelen',views:'Weergaven',preparing:'De inhoud wordt voorbereid.',unavailable:'Er is nog geen afspeelbare bron gekoppeld.'},
    pl:{back:'← Wróć do listy',fullscreen:'Pełny ekran',exitFullscreen:'Zamknij pełny ekran',like:'Lubię to',recommend:'Poleć',views:'Wyświetlenia',preparing:'Treść jest przygotowywana.',unavailable:'Nie podłączono jeszcze źródła odtwarzania.'},
    sv:{back:'← Tillbaka till listan',fullscreen:'Helskärm',exitFullscreen:'Avsluta helskärm',like:'Gilla',recommend:'Rekommendera',views:'Visningar',preparing:'Innehållet förbereds.',unavailable:'Ingen spelbar källa är ansluten ännu.'},
    hu:{back:'← Vissza a listához',fullscreen:'Teljes képernyő',exitFullscreen:'Kilépés a teljes képernyőből',like:'Tetszik',recommend:'Ajánlom',views:'Megtekintések',preparing:'A tartalom előkészítés alatt áll.',unavailable:'Még nincs lejátszható forrás csatlakoztatva.'},
    tr:{back:'← Listeye dön',fullscreen:'Tam ekran',exitFullscreen:'Tam ekrandan çık',like:'Beğen',recommend:'Öner',views:'Görüntülemeler',preparing:'İçerik hazırlanıyor.',unavailable:'Henüz oynatılabilir bir kaynak bağlanmadı.'},
    ru:{back:'← Вернуться к списку',fullscreen:'Полный экран',exitFullscreen:'Выйти из полноэкранного режима',like:'Нравится',recommend:'Рекомендовать',views:'Просмотры',preparing:'Контент готовится.',unavailable:'Источник воспроизведения ещё не подключён.'},
    uk:{back:'← Повернутися до списку',fullscreen:'На весь екран',exitFullscreen:'Вийти з повноекранного режиму',like:'Подобається',recommend:'Рекомендувати',views:'Перегляди',preparing:'Вміст готується.',unavailable:'Джерело відтворення ще не підключено.'},
    ja:{back:'← 一覧に戻る',fullscreen:'全画面',exitFullscreen:'全画面を終了',like:'いいね',recommend:'おすすめ',views:'視聴回数',preparing:'コンテンツを準備中です。',unavailable:'このコンテンツには再生ソースがまだ接続されていません。'},
    zh:{back:'← 返回列表',fullscreen:'全屏',exitFullscreen:'退出全屏',like:'喜欢',recommend:'推荐',views:'观看次数',preparing:'内容正在准备中。',unavailable:'此内容尚未连接可播放来源。'},
    zht:{back:'← 返回清單',fullscreen:'全螢幕',exitFullscreen:'離開全螢幕',like:'喜歡',recommend:'推薦',views:'觀看次數',preparing:'內容準備中。',unavailable:'此內容尚未連接可播放來源。'},
    ar:{back:'→ العودة إلى القائمة',fullscreen:'ملء الشاشة',exitFullscreen:'إنهاء ملء الشاشة',like:'إعجاب',recommend:'توصية',views:'المشاهدات',preparing:'يجري تجهيز المحتوى.',unavailable:'لم يتم بعد ربط مصدر قابل للتشغيل.'},
    fa:{back:'← بازگشت به فهرست',fullscreen:'تمام‌صفحه',exitFullscreen:'خروج از تمام‌صفحه',like:'پسندیدن',recommend:'پیشنهاد',views:'بازدیدها',preparing:'محتوا در حال آماده‌سازی است.',unavailable:'منبع قابل پخش هنوز متصل نشده است.'},
    ur:{back:'→ فہرست پر واپس جائیں',fullscreen:'فل اسکرین',exitFullscreen:'فل اسکرین سے باہر نکلیں',like:'پسند',recommend:'تجویز',views:'دیکھنے',preparing:'مواد تیار کیا جا رہا ہے۔',unavailable:'قابلِ پلے ذریعہ ابھی منسلک نہیں ہے۔'},
    hi:{back:'← सूची पर वापस जाएँ',fullscreen:'पूर्ण स्क्रीन',exitFullscreen:'पूर्ण स्क्रीन से बाहर निकलें',like:'पसंद',recommend:'सिफारिश',views:'दृश्य',preparing:'सामग्री तैयार की जा रही है।',unavailable:'चलाने योग्य स्रोत अभी जुड़ा नहीं है।'},
    bn:{back:'← তালিকায় ফিরে যান',fullscreen:'পূর্ণ পর্দা',exitFullscreen:'পূর্ণ পর্দা থেকে বের হন',like:'পছন্দ',recommend:'সুপারিশ',views:'দেখা',preparing:'কনটেন্ট প্রস্তুত হচ্ছে।',unavailable:'চালানোর উৎস এখনও সংযুক্ত নয়।'},
    ta:{back:'← பட்டியலுக்கு திரும்பு',fullscreen:'முழுத்திரை',exitFullscreen:'முழுத்திரையிலிருந்து வெளியேறு',like:'விருப்பம்',recommend:'பரிந்துரை',views:'பார்வைகள்',preparing:'உள்ளடக்கம் தயாராகிறது.',unavailable:'இயக்கக்கூடிய மூலம் இன்னும் இணைக்கப்படவில்லை.'},
    th:{back:'← กลับสู่รายการ',fullscreen:'เต็มหน้าจอ',exitFullscreen:'ออกจากเต็มหน้าจอ',like:'ถูกใจ',recommend:'แนะนำ',views:'การดู',preparing:'กำลังเตรียมเนื้อหา',unavailable:'ยังไม่ได้เชื่อมต่อแหล่งที่เล่นได้'},
    id:{back:'← Kembali ke daftar',fullscreen:'Layar penuh',exitFullscreen:'Keluar dari layar penuh',like:'Suka',recommend:'Rekomendasikan',views:'Tayangan',preparing:'Konten sedang disiapkan.',unavailable:'Sumber yang dapat diputar belum tersambung.'},
    ms:{back:'← Kembali ke senarai',fullscreen:'Skrin penuh',exitFullscreen:'Keluar skrin penuh',like:'Suka',recommend:'Cadangkan',views:'Tontonan',preparing:'Kandungan sedang disediakan.',unavailable:'Sumber yang boleh dimainkan belum disambungkan.'},
    sw:{back:'← Rudi kwenye orodha',fullscreen:'Skrini nzima',exitFullscreen:'Toka skrini nzima',like:'Penda',recommend:'Pendekeza',views:'Mionekano',preparing:'Maudhui yanaandaliwa.',unavailable:'Chanzo kinachoweza kucheza bado hakijaunganishwa.'},
    vi:{back:'← Quay lại danh sách',fullscreen:'Toàn màn hình',exitFullscreen:'Thoát toàn màn hình',like:'Thích',recommend:'Đề xuất',views:'Lượt xem',preparing:'Nội dung đang được chuẩn bị.',unavailable:'Nguồn phát chưa được kết nối.'},
    tl:{back:'← Bumalik sa listahan',fullscreen:'Buong screen',exitFullscreen:'Lumabas sa buong screen',like:'Like',recommend:'Irekomenda',views:'Mga panonood',preparing:'Inihahanda ang nilalaman.',unavailable:'Wala pang nakakonektang mapaglarong source.'},
    uz:{back:'← Ro‘yxatga qaytish',fullscreen:'To‘liq ekran',exitFullscreen:'To‘liq ekrandan chiqish',like:'Yoqadi',recommend:'Tavsiya',views:'Ko‘rishlar',preparing:'Kontent tayyorlanmoqda.',unavailable:'Ijro manbasi hali ulanmagan.'}
  };

  function copy(){
    var lang = String((document.documentElement && document.documentElement.lang) || 'ko').toLowerCase().split('-')[0];
    return COPY[lang] || COPY.en;
  }
  function text(v){ return v == null ? '' : String(v).trim(); }
  function number(v){ var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function create(tag, className, content){ var el = document.createElement(tag); if(className) el.className = className; if(content != null) el.textContent = content; return el; }
  function fullEl(){ return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function sourceFor(card){ return text(card && card.dataset && card.dataset.mediaSource); }
  function titleFor(card){ return text(card && card.dataset && (card.dataset.mediaTitle || card.dataset.title)) || text(card && card.querySelector('.meta') && card.querySelector('.meta').textContent) || 'Media'; }
  function descriptionFor(card){ return text(card && card.dataset && card.dataset.mediaDescription); }
  function contentIdFor(card){ return text(card && card.dataset && (card.dataset.igdcContentId || card.dataset.contentId || card.dataset.itemId)); }
  function imageFor(card){ var image = card && card.querySelector && card.querySelector('img'); return image && image.currentSrc || image && image.src || ''; }
  function directVideo(source){ return /\.(mp4|webm|ogv|ogg|m4v)(?:[?#].*)?$/i.test(source); }
  function youtubeId(source){
    var m = source.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
    return m ? m[1] : '';
  }
  function isEditable(target){ return target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'); }
  function isMediaCard(node){ return node && node.closest && node.closest('.thumb-line[data-psom-key^="media-"] a.card'); }
  function notifyFrameHeight(){
    try{
      if(global.parent === global || !global.parent.postMessage) return;
      var de = document.documentElement, body = document.body;
      var height = Math.max(de ? de.scrollHeight : 0, body ? body.scrollHeight : 0, de ? de.offsetHeight : 0, body ? body.offsetHeight : 0);
      global.parent.postMessage({ type:'igdcFrameHeight', height:height, page:global.location.pathname }, '*');
    }catch(_){}
  }
  function injectStyle(){
    if(document.getElementById('igdc-mediahub-playback-v2-style')) return;
    var style = document.createElement('style'); style.id = 'igdc-mediahub-playback-v2-style';
    style.textContent = [
      '#igdc-media-detail-view{display:block;width:100%;min-height:100vh;background:#0d1118;color:#eef3fb;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#igdc-media-detail-view *{box-sizing:border-box}',
      '.igdc-media-detail-header{display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 16px;background:#151d29;border-bottom:1px solid rgba(255,255,255,.12)}',
      '.igdc-media-detail-back,.igdc-media-detail-fullscreen,.igdc-media-reaction{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:#202b3d;color:#fff;padding:8px 12px;font:inherit;cursor:pointer}',
      '.igdc-media-detail-back:hover,.igdc-media-detail-fullscreen:hover,.igdc-media-reaction:hover{background:#2c3c57}',
      '.igdc-media-detail-back:focus-visible,.igdc-media-detail-fullscreen:focus-visible,.igdc-media-reaction:focus-visible{outline:3px solid #8eb3ff;outline-offset:2px}',
      '.igdc-media-detail-title{flex:1;min-width:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.igdc-media-detail-stage{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:16/9;min-height:320px;background:#05070b;outline:none}',
      '.igdc-media-detail-stage:fullscreen{width:100vw;height:100vh;aspect-ratio:auto;min-height:100vh}',
      '.igdc-media-detail-stage video,.igdc-media-detail-stage iframe{display:block;width:100%;height:100%;border:0;background:#000;object-fit:contain}',
      '.igdc-media-detail-pending{position:relative;display:grid;place-items:center;width:100%;height:100%;overflow:hidden;background:#0e1521}',
      '.igdc-media-detail-pending img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.24;filter:blur(1px)}',
      '.igdc-media-detail-pending-panel{position:relative;max-width:620px;margin:24px;padding:22px 24px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(7,11,17,.88);text-align:center;line-height:1.55}',
      '.igdc-media-detail-pending-panel strong{display:block;margin-bottom:6px}',
      '.igdc-media-detail-meta{max-width:1320px;margin:0 auto;padding:18px 20px 36px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}',
      '.igdc-media-view-count{margin-right:auto;color:#b6c4dd;font-size:.94rem}',
      '.igdc-media-reaction[disabled]{opacity:.48;cursor:not-allowed}',
      '@media(max-width:700px){.igdc-media-detail-header{padding:8px 10px;gap:8px}.igdc-media-detail-back,.igdc-media-detail-fullscreen,.igdc-media-reaction{padding:7px 9px;font-size:.86rem}.igdc-media-detail-stage{min-height:56vw}.igdc-media-detail-meta{padding:14px 12px 26px}.igdc-media-view-count{width:100%;margin-right:0}}'
    ].join('');
    document.head.appendChild(style);
  }
  function hideListRoots(card){
    var roots = [];
    function add(node){ if(node && roots.indexOf(node) < 0) roots.push(node); }
    add(document.getElementById('hero'));
    add(card && card.closest('.layout'));
    add(document.querySelector('.hero-overlay'));
    add(document.querySelector('footer'));
    add(document.getElementById('providers-drawer-left'));
    add(document.getElementById('providers-backdrop-left'));
    add(document.getElementById('providers-tab-left'));
    add(document.getElementById('providers-banner'));
    state.restore = roots.map(function(node){ return { node:node, display:node.style.display, ariaHidden:node.getAttribute('aria-hidden') }; });
    state.restore.forEach(function(entry){ entry.node.style.display = 'none'; entry.node.setAttribute('aria-hidden','true'); });
  }
  function restoreListRoots(){
    state.restore.forEach(function(entry){
      entry.node.style.display = entry.display;
      if(entry.ariaHidden == null) entry.node.removeAttribute('aria-hidden'); else entry.node.setAttribute('aria-hidden', entry.ariaHidden);
    });
    state.restore = [];
  }
  function itemFor(card){
    return { itemId:contentIdFor(card) || null, contentId:contentIdFor(card) || null, url:sourceFor(card) || null, title:titleFor(card) || null, section:text(card.dataset && card.dataset.mediaSection) || null, psomKey:text(card.dataset && card.dataset.psomKey) || null, mediaType:'video' };
  }
  function callTracker(name, item, extra){
    try{ var tracker = global.MaruRevenueTracker; if(tracker && typeof tracker[name] === 'function') tracker[name](item, extra || {}); }catch(_){}
  }
  function bindWatch(video, item){
    try{
      var tracker = global.MaruRevenueTracker;
      if(tracker && typeof tracker.bindMedia === 'function') tracker.bindMedia(video, item, { pageType:'media', service:'mediahub-playback-controller-v2', revenueLine:'media_watchtime' });
    }catch(_){}
  }
  function player(stage, card){
    var c = copy(), source = sourceFor(card), yt = youtubeId(source), item = itemFor(card);
    if(yt){
      var frame = document.createElement('iframe'); frame.title = item.title || 'Media'; frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(yt) + '?autoplay=1&rel=0'; frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'; frame.setAttribute('allowfullscreen',''); stage.appendChild(frame); return;
    }
    if(directVideo(source)){
      var video = document.createElement('video'); video.src = source; video.controls = true; video.autoplay = true; video.playsInline = true; video.preload = 'metadata'; video.setAttribute('aria-label', item.title || 'Media'); stage.appendChild(video); bindWatch(video, item); return;
    }
    var pending = create('div', 'igdc-media-detail-pending');
    var image = imageFor(card);
    if(image){ var preview = document.createElement('img'); preview.src = image; preview.alt = ''; pending.appendChild(preview); }
    var panel = create('div', 'igdc-media-detail-pending-panel'); panel.appendChild(create('strong','',c.preparing)); panel.appendChild(create('div','',c.unavailable)); pending.appendChild(panel); stage.appendChild(pending);
  }
  function updateFullscreenButton(){
    if(!state.detail) return;
    var btn = state.detail.querySelector('.igdc-media-detail-fullscreen');
    if(btn) btn.textContent = fullEl() ? copy().exitFullscreen : copy().fullscreen;
  }
  function leaveFullscreen(){
    try{
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if(fullEl() && exit){ var result = exit.call(document); if(result && result.catch) result.catch(function(){}); }
    }catch(_){}
  }
  function toggleFullscreen(){
    if(!state.stage) return;
    if(fullEl()){
      leaveFullscreen();
    } else {
      try{ var request = state.stage.requestFullscreen || state.stage.webkitRequestFullscreen; if(request){ var result = request.call(state.stage); if(result && result.catch) result.catch(function(){}); } }catch(_){}
    }
  }
  function summaryCounts(summary, card){
    var counts = summary && (summary.counts || summary.totals) || {};
    return {
      views: number(counts.views != null ? counts.views : (counts.view != null ? counts.view : card.dataset.views)),
      likes: number(counts.likes != null ? counts.likes : (counts.like != null ? counts.like : card.dataset.likes)),
      recommends: number(counts.recommendations != null ? counts.recommendations : (counts.recommend != null ? counts.recommend : card.dataset.recommends)),
      viewer: summary && summary.viewer || {}
    };
  }
  function applySummary(detail, summary, card){
    if(!detail || !state.open) return;
    var c = copy(), values = summaryCounts(summary, card);
    var viewNode = detail.querySelector('.igdc-media-view-count'); if(viewNode) viewNode.textContent = c.views + ' ' + values.views;
    [['like', values.likes, !!values.viewer.liked], ['recommend', values.recommends, !!values.viewer.recommended]].forEach(function(row){
      var button = detail.querySelector('[data-igdc-reaction="' + row[0] + '"]');
      if(button){ button.textContent = (row[0] === 'like' ? c.like : c.recommend) + ' ' + row[1]; button.classList.toggle('active', row[2]); button.setAttribute('aria-pressed', row[2] ? 'true' : 'false'); }
    });
  }
  function setupEngagement(detail, card){
    var id = contentIdFor(card);
    var controls = detail.querySelectorAll('[data-igdc-reaction]');
    if(!id || !global.IGDCEngagement){ controls.forEach(function(button){ button.disabled = true; button.setAttribute('aria-disabled','true'); }); return; }
    var bridge = global.IGDCEngagement;
    function refresh(){ if(bridge.summary) bridge.summary(id).then(function(summary){ applySummary(detail, summary, card); }).catch(function(){}); }
    if(bridge.recordView) bridge.recordView(id).then(function(summary){ applySummary(detail, summary, card); }).catch(refresh); else refresh();
    controls.forEach(function(button){
      button.addEventListener('click', function(){
        if(!bridge.toggle || button.dataset.busy === '1') return;
        button.dataset.busy = '1';
        var type = button.dataset.igdcReaction;
        var enabled = button.getAttribute('aria-pressed') !== 'true';
        bridge.toggle(id, type, enabled).then(function(summary){ applySummary(detail, summary, card); callTracker('track', itemFor(card), { eventType:type === 'like' ? 'like' : 'recommend', pageType:'media', service:'mediahub-playback-controller-v2' }); }).catch(function(){}).finally(function(){ delete button.dataset.busy; });
      });
    });
  }
  function open(card){
    if(!card || state.open) return;
    injectStyle(); state.open = true; state.card = card; state.scrollY = global.scrollY || global.pageYOffset || 0;
    hideListRoots(card);
    var c = copy(), detail = create('section', ''); detail.id = 'igdc-media-detail-view'; detail.setAttribute('aria-label', titleFor(card));
    var header = create('header', 'igdc-media-detail-header');
    var back = create('button', 'igdc-media-detail-back', c.back); back.type = 'button';
    var title = create('div', 'igdc-media-detail-title', titleFor(card));
    var fullscreen = create('button', 'igdc-media-detail-fullscreen', c.fullscreen); fullscreen.type = 'button';
    header.appendChild(back); header.appendChild(title); header.appendChild(fullscreen);
    var stage = create('div','igdc-media-detail-stage'); stage.tabIndex = -1; player(stage, card);
    var meta = create('div','igdc-media-detail-meta');
    var views = create('div','igdc-media-view-count', c.views + ' ' + number(card.dataset.views));
    var like = create('button','igdc-media-reaction',c.like + ' ' + number(card.dataset.likes)); like.type='button'; like.dataset.igdcReaction='like'; like.setAttribute('aria-pressed','false');
    var reco = create('button','igdc-media-reaction',c.recommend + ' ' + number(card.dataset.recommends)); reco.type='button'; reco.dataset.igdcReaction='recommend'; reco.setAttribute('aria-pressed','false');
    meta.appendChild(views); meta.appendChild(like); meta.appendChild(reco);
    detail.appendChild(header); detail.appendChild(stage); detail.appendChild(meta); document.body.appendChild(detail);
    state.detail = detail; state.stage = stage;
    back.addEventListener('click', close); fullscreen.addEventListener('click', toggleFullscreen);
    setupEngagement(detail, card);
    var openedItem = itemFor(card);
    if(openedItem.itemId || openedItem.url) callTracker('trackClick', openedItem, { eventType:'media_click', pageType:'media', service:'mediahub-playback-controller-v2' });
    global.requestAnimationFrame(function(){ global.scrollTo(0,0); stage.focus({ preventScroll:true }); notifyFrameHeight(); });
  }
  function close(){
    if(!state.open) return;
    if(fullEl()) leaveFullscreen();
    if(state.detail) state.detail.remove();
    restoreListRoots();
    var restoreY = state.scrollY; state.open=false; state.detail=null; state.stage=null; state.card=null;
    global.requestAnimationFrame(function(){ global.scrollTo(0, restoreY); notifyFrameHeight(); });
  }
  document.addEventListener('click', function(event){
    var card = isMediaCard(event.target);
    if(!card || state.open) return;
    event.preventDefault(); event.stopImmediatePropagation(); open(card);
  }, true);
  document.addEventListener('keydown', function(event){
    if(!state.open || isEditable(event.target)) return;
    if(event.key === 'Enter') { event.preventDefault(); toggleFullscreen(); return; }
    if(event.key === 'Escape' && fullEl()) { event.preventDefault(); leaveFullscreen(); }
    /* Escape never closes the detail view; it exits fullscreen only. */
  }, true);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  global.IGDCMediaHubPlayback = { open:open, close:close, VERSION:'2.0.0' };
})(window, document);
