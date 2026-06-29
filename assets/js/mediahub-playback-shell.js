/*
 * IGDC / MARU MediaHub Playback Shell v1.0.0
 * ------------------------------------------------------------------
 * MediaHub-only interaction contract:
 *   slot -> in-browser detail/playback shell -> Enter/fullscreen ->
 *   Escape exits fullscreen only -> Back returns to the slot list.
 *
 * The shell preserves the card and automap data contract. It does not
 * manufacture playback sources or local counters: direct HTML5 media is
 * bound to MaruRevenueTracker when available, while displayed statistics
 * come only from the media snapshot/card dataset.
 */
(function (global, document) {
  'use strict';

  if (global.IGDCMediaPlaybackShell) return;

  var VERSION = 'igdc-media-playback-shell-v1.0.0';
  var state = {
    root: null,
    stage: null,
    card: null,
    historyToken: null,
    historyActive: false,
    closeByHistory: false,
    focusBeforeOpen: null
  };

  var COPY = {
    ko: { back:'목록으로 돌아가기', fullscreen:'전체 화면', exitFullscreen:'전체 화면 나가기', preparing:'콘텐츠를 준비 중입니다.', unavailable:'이 콘텐츠의 재생 소스가 아직 연결되지 않았습니다.', views:'조회', watchTime:'시청 시간', recommendations:'추천 콘텐츠', noRecommendations:'현재 표시할 추천 콘텐츠가 없습니다.', play:'재생' },
    en: { back:'Back to list', fullscreen:'Fullscreen', exitFullscreen:'Exit fullscreen', preparing:'Content is being prepared.', unavailable:'A playable source has not been connected for this content yet.', views:'Views', watchTime:'Watch time', recommendations:'Recommended content', noRecommendations:'No related content is available yet.', play:'Play' },
    de: { back:'Zurück zur Liste', fullscreen:'Vollbild', exitFullscreen:'Vollbild beenden', preparing:'Der Inhalt wird vorbereitet.', unavailable:'Für diesen Inhalt ist noch keine abspielbare Quelle verbunden.', views:'Aufrufe', watchTime:'Wiedergabezeit', recommendations:'Empfohlene Inhalte', noRecommendations:'Derzeit sind keine verwandten Inhalte verfügbar.', play:'Wiedergabe' },
    es: { back:'Volver a la lista', fullscreen:'Pantalla completa', exitFullscreen:'Pantalla completa beenden', preparing:'El contenido se está preparando.', unavailable:'Todavía no se ha conectado una fuente reproducible para este contenido.', views:'Visualizaciones', watchTime:'Tiempo de reproducción', recommendations:'Contenido recomendado', noRecommendations:'Aún no hay contenido relacionado disponible.', play:'Reproducir' },
    fr: { back:'Retour à la liste', fullscreen:'Plein écran', exitFullscreen:'Quitter le plein écran', preparing:'Le contenu est en cours de préparation.', unavailable:'Aucune source de lecture n’est encore connectée pour ce contenu.', views:'Vues', watchTime:'Durée de visionnage', recommendations:'Contenu recommandé', noRecommendations:'Aucun contenu associé n’est disponible pour le moment.', play:'Lire' },
    it: { back:'Torna all’elenco', fullscreen:'Schermo intero', exitFullscreen:'Esci da schermo intero', preparing:'Il contenuto è in preparazione.', unavailable:'Per questo contenuto non è ancora collegata una fonte riproducibile.', views:'Visualizzazioni', watchTime:'Tempo di visione', recommendations:'Contenuti consigliati', noRecommendations:'Al momento non sono disponibili contenuti correlati.', play:'Riproduci' },
    pt: { back:'Voltar à lista', fullscreen:'Tela cheia', exitFullscreen:'Sair da tela cheia', preparing:'O conteúdo está sendo preparado.', unavailable:'Ainda não há uma fonte reproduzível conectada para este conteúdo.', views:'Visualizações', watchTime:'Tempo de exibição', recommendations:'Conteúdo recomendado', noRecommendations:'Ainda não há conteúdo relacionado disponível.', play:'Reproduzir' },
    nl: { back:'Terug naar lijst', fullscreen:'Volledig scherm', exitFullscreen:'Volledig scherm afsluiten', preparing:'De inhoud wordt voorbereid.', unavailable:'Voor deze inhoud is nog geen afspeelbare bron gekoppeld.', views:'Weergaven', watchTime:'Kijktijd', recommendations:'Aanbevolen inhoud', noRecommendations:'Er is nog geen gerelateerde inhoud beschikbaar.', play:'Afspelen' },
    pl: { back:'Wróć do listy', fullscreen:'Pełny ekran', exitFullscreen:'Zamknij pełny ekran', preparing:'Treść jest przygotowywana.', unavailable:'Dla tej treści nie podłączono jeszcze źródła odtwarzania.', views:'Wyświetlenia', watchTime:'Czas oglądania', recommendations:'Polecane treści', noRecommendations:'Brak powiązanych treści do wyświetlenia.', play:'Odtwórz' },
    sv: { back:'Tillbaka till listan', fullscreen:'Helskärm', exitFullscreen:'Avsluta helskärm', preparing:'Innehållet förbereds.', unavailable:'Ingen spelbar källa är ännu ansluten för detta innehåll.', views:'Visningar', watchTime:'Tittartid', recommendations:'Rekommenderat innehåll', noRecommendations:'Inget relaterat innehåll finns ännu.', play:'Spela upp' },
    hu: { back:'Vissza a listához', fullscreen:'Teljes képernyő', exitFullscreen:'Kilépés a teljes képernyőből', preparing:'A tartalom előkészítés alatt áll.', unavailable:'Ehhez a tartalomhoz még nincs lejátszható forrás csatlakoztatva.', views:'Megtekintések', watchTime:'Nézési idő', recommendations:'Ajánlott tartalom', noRecommendations:'Jelenleg nincs kapcsolódó tartalom.', play:'Lejátszás' },
    tr: { back:'Listeye dön', fullscreen:'Tam ekran', exitFullscreen:'Tam ekrandan çık', preparing:'İçerik hazırlanıyor.', unavailable:'Bu içerik için henüz oynatılabilir bir kaynak bağlanmadı.', views:'Görüntüleme', watchTime:'İzleme süresi', recommendations:'Önerilen içerikler', noRecommendations:'Henüz ilgili içerik yok.', play:'Oynat' },
    ru: { back:'Вернуться к списку', fullscreen:'Полный экран', exitFullscreen:'Выйти из полноэкранного режима', preparing:'Контент готовится.', unavailable:'Для этого контента пока не подключён источник воспроизведения.', views:'Просмотры', watchTime:'Время просмотра', recommendations:'Рекомендуемый контент', noRecommendations:'Связанный контент пока недоступен.', play:'Воспроизвести' },
    uk: { back:'Повернутися до списку', fullscreen:'На весь екран', exitFullscreen:'Вийти з повного екрана', preparing:'Вміст готується.', unavailable:'Для цього вмісту ще не підключено джерело відтворення.', views:'Перегляди', watchTime:'Час перегляду', recommendations:'Рекомендований вміст', noRecommendations:'Пов’язаного вмісту поки немає.', play:'Відтворити' },
    ja: { back:'一覧に戻る', fullscreen:'全画面', exitFullscreen:'全画面を終了', preparing:'コンテンツを準備中です。', unavailable:'このコンテンツには再生ソースがまだ接続されていません。', views:'視聴回数', watchTime:'視聴時間', recommendations:'おすすめコンテンツ', noRecommendations:'現在表示できる関連コンテンツはありません。', play:'再生' },
    zh: { back:'返回列表', fullscreen:'全屏', exitFullscreen:'退出全屏', preparing:'内容正在准备中。', unavailable:'此内容尚未连接可播放的来源。', views:'观看次数', watchTime:'观看时长', recommendations:'推荐内容', noRecommendations:'暂时没有可显示的相关内容。', play:'播放' },
    zht: { back:'返回清單', fullscreen:'全螢幕', exitFullscreen:'離開全螢幕', preparing:'內容準備中。', unavailable:'此內容尚未連接可播放來源。', views:'觀看次數', watchTime:'觀看時間', recommendations:'推薦內容', noRecommendations:'目前沒有可顯示的相關內容。', play:'播放' },
    ar: { back:'العودة إلى القائمة', fullscreen:'ملء الشاشة', exitFullscreen:'إنهاء ملء الشاشة', preparing:'يجري تجهيز المحتوى.', unavailable:'لم يتم بعد ربط مصدر قابل للتشغيل لهذا المحتوى.', views:'المشاهدات', watchTime:'وقت المشاهدة', recommendations:'محتوى موصى به', noRecommendations:'لا يوجد محتوى ذي صلة للعرض حالياً.', play:'تشغيل' },
    fa: { back:'بازگشت به فهرست', fullscreen:'تمام‌صفحه', exitFullscreen:'خروج از تمام‌صفحه', preparing:'محتوا در حال آماده‌سازی است.', unavailable:'هنوز منبع قابل پخشی برای این محتوا متصل نشده است.', views:'بازدیدها', watchTime:'زمان تماشا', recommendations:'محتوای پیشنهادی', noRecommendations:'فعلاً محتوای مرتبطی موجود نیست.', play:'پخش' },
    ur: { back:'فہرست پر واپس جائیں', fullscreen:'فل اسکرین', exitFullscreen:'فل اسکرین سے باہر نکلیں', preparing:'مواد تیار کیا جا رہا ہے۔', unavailable:'اس مواد کے لیے ابھی قابلِ پلے ذریعہ منسلک نہیں ہے۔', views:'مشاہدات', watchTime:'دیکھنے کا وقت', recommendations:'تجویز کردہ مواد', noRecommendations:'فی الحال متعلقہ مواد دستیاب نہیں ہے۔', play:'چلائیں' },
    hi: { back:'सूची पर वापस जाएँ', fullscreen:'पूर्ण स्क्रीन', exitFullscreen:'पूर्ण स्क्रीन से बाहर निकलें', preparing:'सामग्री तैयार की जा रही है।', unavailable:'इस सामग्री के लिए अभी चलाने योग्य स्रोत नहीं जुड़ा है।', views:'देखे जाने की संख्या', watchTime:'देखने का समय', recommendations:'अनुशंसित सामग्री', noRecommendations:'अभी कोई संबंधित सामग्री उपलब्ध नहीं है।', play:'चलाएँ' },
    bn: { back:'তালিকায় ফিরে যান', fullscreen:'পূর্ণ পর্দা', exitFullscreen:'পূর্ণ পর্দা থেকে বের হন', preparing:'কনটেন্ট প্রস্তুত করা হচ্ছে।', unavailable:'এই কনটেন্টের জন্য এখনও চালানো যায় এমন উৎস সংযুক্ত হয়নি।', views:'দেখা হয়েছে', watchTime:'দেখার সময়', recommendations:'প্রস্তাবিত কনটেন্ট', noRecommendations:'এখনও কোনো সম্পর্কিত কনটেন্ট নেই।', play:'চালান' },
    ta: { back:'பட்டியலுக்கு திரும்பு', fullscreen:'முழுத்திரை', exitFullscreen:'முழுத்திரையிலிருந்து வெளியேறு', preparing:'உள்ளடக்கம் தயாராகிறது.', unavailable:'இந்த உள்ளடக்கத்திற்கு இயக்கக்கூடிய மூலம் இன்னும் இணைக்கப்படவில்லை.', views:'பார்வைகள்', watchTime:'பார்வை நேரம்', recommendations:'பரிந்துரைக்கப்பட்ட உள்ளடக்கம்', noRecommendations:'தற்போது தொடர்புடைய உள்ளடக்கம் இல்லை.', play:'இயக்கு' },
    th: { back:'กลับสู่รายการ', fullscreen:'เต็มหน้าจอ', exitFullscreen:'ออกจากเต็มหน้าจอ', preparing:'กำลังเตรียมเนื้อหา', unavailable:'ยังไม่ได้เชื่อมต่อแหล่งที่เล่นได้สำหรับเนื้อหานี้', views:'การรับชม', watchTime:'เวลารับชม', recommendations:'เนื้อหาแนะนำ', noRecommendations:'ยังไม่มีเนื้อหาที่เกี่ยวข้อง', play:'เล่น' },
    id: { back:'Kembali ke daftar', fullscreen:'Layar penuh', exitFullscreen:'Keluar dari layar penuh', preparing:'Konten sedang disiapkan.', unavailable:'Sumber yang dapat diputar belum terhubung untuk konten ini.', views:'Tayangan', watchTime:'Waktu tonton', recommendations:'Konten rekomendasi', noRecommendations:'Belum ada konten terkait yang tersedia.', play:'Putar' },
    ms: { back:'Kembali ke senarai', fullscreen:'Skrin penuh', exitFullscreen:'Keluar skrin penuh', preparing:'Kandungan sedang disediakan.', unavailable:'Sumber boleh main belum disambungkan untuk kandungan ini.', views:'Tontonan', watchTime:'Masa tontonan', recommendations:'Kandungan disyorkan', noRecommendations:'Tiada kandungan berkaitan buat masa ini.', play:'Main' },
    tl: { back:'Bumalik sa listahan', fullscreen:'Buong screen', exitFullscreen:'Lumabas sa buong screen', preparing:'Inihahanda ang nilalaman.', unavailable:'Wala pang nakakonektang mapapatugtog na pinagmulan para sa nilalamang ito.', views:'Mga panonood', watchTime:'Oras ng panonood', recommendations:'Inirerekomendang nilalaman', noRecommendations:'Wala pang kaugnay na nilalaman.', play:'I-play' },
    sw: { back:'Rudi kwenye orodha', fullscreen:'Skrini nzima', exitFullscreen:'Toka skrini nzima', preparing:'Maudhui yanaandaliwa.', unavailable:'Chanzo kinachoweza kuchezwa bado hakijaunganishwa kwa maudhui haya.', views:'Mionekano', watchTime:'Muda wa kutazama', recommendations:'Maudhui yanayopendekezwa', noRecommendations:'Bado hakuna maudhui yanayohusiana.', play:'Cheza' },
    vi: { back:'Quay lại danh sách', fullscreen:'Toàn màn hình', exitFullscreen:'Thoát toàn màn hình', preparing:'Nội dung đang được chuẩn bị.', unavailable:'Nguồn có thể phát chưa được kết nối cho nội dung này.', views:'Lượt xem', watchTime:'Thời gian xem', recommendations:'Nội dung đề xuất', noRecommendations:'Chưa có nội dung liên quan.', play:'Phát' },
    uz: { back:'Ro‘yxatga qaytish', fullscreen:'To‘liq ekran', exitFullscreen:'To‘liq ekrandan chiqish', preparing:'Kontent tayyorlanmoqda.', unavailable:'Bu kontent uchun ijro manbasi hali ulanmagan.', views:'Ko‘rishlar', watchTime:'Tomosha vaqti', recommendations:'Tavsiya etilgan kontent', noRecommendations:'Hozircha tegishli kontent yo‘q.', play:'Ijro etish' }
  };

  function language() {
    var raw = (document.documentElement.getAttribute('lang') || 'en').toLowerCase().replace('_', '-');
    if (raw === 'zh-hant' || raw === 'zh-tw' || raw === 'zh-hk') return 'zht';
    return raw.split('-')[0] || 'en';
  }

  function copy() { return COPY[language()] || COPY.en; }
  function text(v) { return v == null ? '' : String(v).trim(); }
  function number(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function safeUrl(v) {
    var value = text(v);
    if (!value || /^javascript:/i.test(value) || value === '#' || value === 'about:blank') return '';
    return value;
  }
  function create(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }
  function button(label, className, aria) {
    var node = create('button', className, label);
    node.type = 'button';
    if (aria) node.setAttribute('aria-label', aria);
    return node;
  }

  function cardFrom(node) {
    if (!node || !node.closest) return null;
    var card = node.closest('a.card, .media-card, .thumbnail-card, .media-card');
    if (!card) return null;
    var line = card.closest && card.closest('.thumb-line[data-psom-key^="media-"]');
    return line ? card : null;
  }

  function titleFrom(card) {
    return text(card.dataset.mediaTitle || card.dataset.title || (card.querySelector('.meta, .title, .caption, h3, h4') || {}).textContent) || copy().play;
  }

  function imageFrom(card) {
    var img = card.querySelector && card.querySelector('img');
    if (img && safeUrl(img.currentSrc || img.src)) return safeUrl(img.currentSrc || img.src);
    var thumb = card.querySelector && card.querySelector('.thumb');
    if (thumb) {
      var bg = global.getComputedStyle ? global.getComputedStyle(thumb).backgroundImage : '';
      var match = text(bg).match(/url\(["']?(.*?)["']?\)/i);
      if (match && safeUrl(match[1])) return safeUrl(match[1]);
    }
    return '';
  }

  function sourceFrom(card) {
    var source = safeUrl(card.dataset.mediaSource || card.dataset.src || card.dataset.video || card.dataset.mediaUrl || card.getAttribute('data-src'));
    if (source) return source;
    var yt = text(card.dataset.yt || card.dataset.mediaYt || card.getAttribute('data-yt'));
    if (yt) return 'youtube:' + yt;
    var href = safeUrl(card.getAttribute('href'));
    if (/^(https?:)?\/\//i.test(href) || /^\/\//.test(href)) return href;
    return '';
  }

  function youtubeId(source) {
    if (!source) return '';
    if (source.indexOf('youtube:') === 0) return source.slice(8);
    try {
      var url = new URL(source, global.location.href);
      if (/(^|\.)youtu\.be$/i.test(url.hostname)) return url.pathname.split('/').filter(Boolean)[0] || '';
      if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
        if (url.searchParams.get('v')) return url.searchParams.get('v');
        var parts = url.pathname.split('/').filter(Boolean);
        var at = parts.indexOf('embed');
        if (at >= 0 && parts[at + 1]) return parts[at + 1];
        at = parts.indexOf('shorts');
        if (at >= 0 && parts[at + 1]) return parts[at + 1];
      }
    } catch (_) {}
    return '';
  }

  function isDirectVideo(source) {
    return /\.(mp4|webm|ogv|ogg|m3u8)(?:[?#].*)?$/i.test(source || '');
  }

  function itemFrom(card) {
    var line = card.closest('.thumb-line[data-psom-key^="media-"]');
    var id = text(card.dataset.mediaId || card.dataset.contentId || card.dataset.itemId || card.dataset.productId || card.getAttribute('data-media-id'));
    var source = sourceFrom(card);
    return {
      id: id || null,
      itemId: id || null,
      contentId: text(card.dataset.contentId || card.dataset.mediaId) || null,
      title: titleFrom(card),
      url: source || null,
      provider: text(card.dataset.provider) || null,
      psomKey: line ? text(line.getAttribute('data-psom-key')) : null,
      section: line ? text(line.getAttribute('data-psom-key')) : null,
      itemType: 'media',
      mediaType: 'video',
      revenueLine: 'media_watchtime'
    };
  }

  function metricsFrom(card) {
    return {
      views: number(card.dataset.mediaViews || card.dataset.views || card.dataset.viewCount || card.dataset.mediaClicks || card.dataset.clicks),
      watchSeconds: number(card.dataset.mediaWatchSeconds || card.dataset.watchSeconds || card.dataset.watchTime)
    };
  }

  function formatNumber(value) {
    try { return new Intl.NumberFormat(document.documentElement.lang || 'en').format(number(value)); }
    catch (_) { return String(number(value)); }
  }

  function formatWatchTime(seconds) {
    var total = Math.max(0, Math.floor(number(seconds)));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }

  function addStyles() {
    if (document.getElementById('igdc-media-playback-shell-style')) return;
    var style = document.createElement('style');
    style.id = 'igdc-media-playback-shell-style';
    style.textContent = [
      '#igdc-media-playback-shell{position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;background:#0b0e13;color:#f4f7fb;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}',
      '#igdc-media-playback-shell *{box-sizing:border-box}',
      '.igdc-media-shell-head{height:58px;min-height:58px;display:flex;align-items:center;gap:12px;padding:0 16px;background:#121722;border-bottom:1px solid rgba(255,255,255,.11)}',
      '.igdc-media-shell-back,.igdc-media-shell-fullscreen{border:1px solid rgba(255,255,255,.22);background:#1d2737;color:#fff;border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer}',
      '.igdc-media-shell-back:hover,.igdc-media-shell-fullscreen:hover{background:#2b3a52}',
      '.igdc-media-shell-back:focus-visible,.igdc-media-shell-fullscreen:focus-visible,.igdc-media-related-card:focus-visible{outline:3px solid #85a8ff;outline-offset:2px}',
      '.igdc-media-shell-title{min-width:0;flex:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.igdc-media-shell-main{flex:1;min-height:0;overflow:auto;background:#0b0e13}',
      '.igdc-media-player-stage{position:relative;display:grid;place-items:center;width:100%;min-height:min(72vh,760px);background:#000;outline:none}',
      '.igdc-media-player-stage:fullscreen{width:100vw;height:100vh;max-width:none;min-height:100vh}',
      '.igdc-media-player-stage video,.igdc-media-player-stage iframe{display:block;width:min(100%,1320px);height:min(72vh,760px);border:0;background:#000}',
      '.igdc-media-player-stage video{object-fit:contain}',
      '.igdc-media-unavailable{position:relative;display:grid;place-items:center;width:min(100%,1320px);height:min(72vh,760px);overflow:hidden;background:#0e141f}',
      '.igdc-media-unavailable img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.34;filter:blur(1px)}',
      '.igdc-media-unavailable-panel{position:relative;z-index:1;max-width:600px;margin:24px;padding:22px 24px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(8,12,19,.84);text-align:center;line-height:1.55}',
      '.igdc-media-shell-info{max-width:1320px;margin:0 auto;padding:18px 20px 32px;display:grid;gap:16px}',
      '.igdc-media-shell-stats{display:flex;flex-wrap:wrap;gap:12px;margin:0;padding:0;list-style:none}',
      '.igdc-media-shell-stats li{min-width:130px;padding:9px 12px;border-radius:9px;background:#151d2a;color:#dfe7f6}',
      '.igdc-media-shell-stats b{display:block;margin-bottom:2px;color:#8fa8d3;font-size:.78rem;font-weight:700}',
      '.igdc-media-related{display:grid;gap:10px}',
      '.igdc-media-related h3{margin:0;font-size:1rem}',
      '.igdc-media-related-list{display:flex;gap:10px;overflow:auto;padding-bottom:4px}',
      '.igdc-media-related-card{flex:0 0 180px;border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:0;overflow:hidden;background:#151d2a;color:#fff;text-align:left;cursor:pointer}',
      '.igdc-media-related-card img{display:block;width:100%;height:101px;object-fit:cover;background:#222}',
      '.igdc-media-related-card span{display:block;padding:8px;font-size:.82rem;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.igdc-media-shell-toast{position:absolute;left:50%;bottom:18px;z-index:2;max-width:calc(100% - 32px);transform:translateX(-50%);padding:10px 14px;border-radius:999px;background:rgba(6,10,16,.92);border:1px solid rgba(255,255,255,.22);box-shadow:0 10px 28px rgba(0,0,0,.42);font-size:.92rem}',
      '@media (max-width:700px){.igdc-media-shell-head{height:54px;min-height:54px;padding:0 10px;gap:8px}.igdc-media-shell-back,.igdc-media-shell-fullscreen{padding:7px 9px;font-size:.86rem}.igdc-media-player-stage,.igdc-media-unavailable{min-height:56vw}.igdc-media-player-stage video,.igdc-media-player-stage iframe,.igdc-media-unavailable{height:56vw;max-height:none}.igdc-media-shell-info{padding:14px 12px 24px}.igdc-media-related-card{flex-basis:156px}.igdc-media-related-card img{height:88px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function sourceKind(source) {
    if (youtubeId(source)) return 'youtube';
    if (isDirectVideo(source)) return 'video';
    return source ? 'external' : 'none';
  }

  function playerFor(card, stage) {
    var source = sourceFrom(card);
    var kind = sourceKind(source);
    var c = copy();
    var item = itemFrom(card);

    if (kind === 'youtube') {
      var frame = document.createElement('iframe');
      var id = youtubeId(source);
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0&enablejsapi=1';
      frame.title = item.title;
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      frame.setAttribute('allowfullscreen', '');
      stage.appendChild(frame);
      return { playable:true, element:frame, kind:kind };
    }

    if (kind === 'video') {
      var video = document.createElement('video');
      video.src = source;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', item.title);
      stage.appendChild(video);
      bindWatchTime(video, item);
      return { playable:true, element:video, kind:kind };
    }

    var unavailable = create('div', 'igdc-media-unavailable');
    var image = imageFrom(card);
    if (image) {
      var preview = document.createElement('img');
      preview.src = image;
      preview.alt = '';
      unavailable.appendChild(preview);
    }
    var panel = create('div', 'igdc-media-unavailable-panel');
    panel.appendChild(create('strong', '', c.preparing));
    panel.appendChild(create('div', '', c.unavailable));
    unavailable.appendChild(panel);
    stage.appendChild(unavailable);
    return { playable:false, element:unavailable, kind:kind };
  }

  function bindWatchTime(video, item) {
    try {
      if (global.MaruRevenueTracker && typeof global.MaruRevenueTracker.bindMedia === 'function') {
        global.MaruRevenueTracker.bindMedia(video, item, {
          pageType:'media',
          service:'mediahub-playback-shell',
          revenueLine:'media_watchtime'
        });
      }
    } catch (_) {}
  }

  function trackOpen(card) {
    var item = itemFrom(card);
    try {
      if (global.MaruRevenueTracker && typeof global.MaruRevenueTracker.trackClick === 'function') {
        global.MaruRevenueTracker.trackClick(item, {
          eventType:'media_click',
          pageType:'media',
          service:'mediahub-playback-shell',
          revenueLine:'media_watchtime'
        });
        return;
      }
      if (global.IGDC && typeof global.IGDC.log === 'function') {
        global.IGDC.log({ event:'click', itemId:item.itemId || '', type:'media' });
      }
    } catch (_) {}
  }

  function relatedCards(card) {
    var all = Array.prototype.slice.call(document.querySelectorAll('.thumb-line[data-psom-key^="media-"] a.card'));
    return all.filter(function (candidate) {
      if (candidate === card || candidate.hasAttribute('data-placeholder')) return false;
      return !!sourceFrom(candidate) || !!text(candidate.dataset.mediaId || candidate.dataset.contentId);
    }).slice(0, 8);
  }

  function setFullscreenLabel(btn, active) {
    if (!btn) return;
    btn.textContent = active ? copy().exitFullscreen : copy().fullscreen;
  }

  function activeFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function requestFullscreen(stage) {
    if (!stage) return;
    try {
      var request = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (request) {
        var result = request.call(stage);
        if (result && typeof result.catch === 'function') result.catch(function () {});
      }
    } catch (_) {}
  }

  function exitFullscreen() {
    try {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (activeFullscreenElement() && exit) {
        var result = exit.call(document);
        if (result && typeof result.catch === 'function') result.catch(function () {});
      }
    } catch (_) {}
  }

  function historyStateFor(token) {
    var current = (history && history.state && typeof history.state === 'object') ? history.state : {};
    var next = {};
    Object.keys(current).forEach(function (key) { next[key] = current[key]; });
    next.__igdcMediaPlayback = token;
    return next;
  }

  function pushHistory() {
    try {
      var token = 'igdc-media-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      history.pushState(historyStateFor(token), '', global.location.href);
      state.historyToken = token;
      state.historyActive = true;
    } catch (_) {
      state.historyToken = null;
      state.historyActive = false;
    }
  }

  function clearShell(options) {
    var preserveHistory = !!(options && options.preserveHistory);
    exitFullscreen();
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    if (!preserveHistory && state.focusBeforeOpen && typeof state.focusBeforeOpen.focus === 'function') {
      try { state.focusBeforeOpen.focus({ preventScroll:true }); } catch (_) { try { state.focusBeforeOpen.focus(); } catch (_) {} }
    }
    state.root = null;
    state.stage = null;
    state.card = null;
    if (!preserveHistory) {
      state.historyToken = null;
      state.historyActive = false;
      state.closeByHistory = false;
      state.focusBeforeOpen = null;
    }
  }

  function backToList() {
    if (!state.root) return;
    if (state.historyActive) {
      state.closeByHistory = true;
      try { history.back(); return; } catch (_) {}
    }
    clearShell();
  }

  function buildRelated(card, replace) {
    var related = relatedCards(card);
    if (!related.length) return null;
    var section = create('section', 'igdc-media-related');
    section.appendChild(create('h3', '', copy().recommendations));
    var list = create('div', 'igdc-media-related-list');
    related.forEach(function (candidate) {
      var entry = button('', 'igdc-media-related-card', titleFrom(candidate));
      var image = imageFrom(candidate);
      if (image) {
        var img = document.createElement('img');
        img.src = image;
        img.alt = '';
        entry.appendChild(img);
      }
      entry.appendChild(create('span', '', titleFrom(candidate)));
      entry.addEventListener('click', function () { openDetail(candidate, true); });
      list.appendChild(entry);
    });
    section.appendChild(list);
    return section;
  }

  function openDetail(card, replace) {
    if (!card) return;
    addStyles();

    var preserveHistory = !!replace && state.historyActive;
    if (state.root) clearShell({ preserveHistory:preserveHistory });
    if (!replace) {
      state.focusBeforeOpen = document.activeElement;
      pushHistory();
    }

    var c = copy();
    var root = create('section', 'igdc-media-playback-shell');
    root.id = 'igdc-media-playback-shell';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', titleFrom(card));
    root.tabIndex = -1;

    var header = create('header', 'igdc-media-shell-head');
    var back = button('← ' + c.back, 'igdc-media-shell-back', c.back);
    var title = create('div', 'igdc-media-shell-title', titleFrom(card));
    header.appendChild(back);
    header.appendChild(title);

    var main = create('main', 'igdc-media-shell-main');
    var stage = create('div', 'igdc-media-player-stage');
    stage.tabIndex = -1;
    var result = playerFor(card, stage);
    var full = button(c.fullscreen, 'igdc-media-shell-fullscreen', c.fullscreen);
    if (!result.playable) {
      full.disabled = true;
      full.hidden = true;
    }
    header.appendChild(full);

    var info = create('section', 'igdc-media-shell-info');
    var metrics = metricsFrom(card);
    var stats = create('ul', 'igdc-media-shell-stats');
    var views = create('li');
    views.appendChild(create('b', '', c.views));
    views.appendChild(create('span', '', formatNumber(metrics.views)));
    var watch = create('li');
    watch.appendChild(create('b', '', c.watchTime));
    watch.appendChild(create('span', '', formatWatchTime(metrics.watchSeconds)));
    stats.appendChild(views);
    stats.appendChild(watch);
    info.appendChild(stats);
    var related = buildRelated(card, replace);
    if (related) info.appendChild(related);

    main.appendChild(stage);
    main.appendChild(info);
    root.appendChild(header);
    root.appendChild(main);
    document.body.appendChild(root);

    state.root = root;
    state.stage = stage;
    state.card = card;

    back.addEventListener('click', backToList);
    full.addEventListener('click', function () {
      if (activeFullscreenElement()) exitFullscreen();
      else requestFullscreen(stage);
    });
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    trackOpen(card);

    global.setTimeout(function () { try { root.focus({ preventScroll:true }); } catch (_) { root.focus(); } }, 0);
  }

  function onFullscreenChange() {
    if (!state.root) return;
    var active = activeFullscreenElement() === state.stage;
    var full = state.root.querySelector('.igdc-media-shell-fullscreen');
    setFullscreenLabel(full, active);
  }

  function handleKeydown(event) {
    if (!state.root) return;
    var target = event.target;
    var writing = target && /^(input|textarea|select)$/i.test(target.tagName || '') || (target && target.isContentEditable);
    if (event.key === 'Enter' && !writing && state.stage && !activeFullscreenElement()) {
      var buttonNode = state.root.querySelector('.igdc-media-shell-fullscreen');
      if (buttonNode && !buttonNode.disabled) {
        event.preventDefault();
        requestFullscreen(state.stage);
      }
      return;
    }
    if (event.key === 'Escape' && !activeFullscreenElement()) {
      // Escape deliberately does not leave the in-browser detail screen.
      // Native fullscreen handles Escape before this branch when fullscreen is active.
      event.preventDefault();
    }
  }

  function handleCardClick(event) {
    if (event.defaultPrevented || event.button && event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var card = cardFrom(event.target);
    if (!card || card.closest('#igdc-media-playback-shell')) return;
    if (event.target.closest && event.target.closest('button,input,textarea,select,[data-media-ui-control]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    openDetail(card, false);
  }

  document.addEventListener('click', handleCardClick, true);
  document.addEventListener('keydown', handleKeydown, true);
  global.addEventListener('popstate', function () {
    if (!state.root) return;
    clearShell();
  });

  global.IGDCMediaPlaybackShell = {
    VERSION: VERSION,
    open: function (card) { openDetail(card, false); },
    close: backToList,
    getState: function () { return { open:!!state.root, title:state.card ? titleFrom(state.card) : null }; }
  };
})(window, document);
