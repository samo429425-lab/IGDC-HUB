/*
 * IGDC / MARU MediaHub playback controller v3.6.0 mobile single-entry three-state immersive/inline/list + resume restore
 * Device-aware inline player shell with safe native-app handoff hooks.
 *
 * Preserves the original Media Hub document, scroll restoration, OTT gate,
 * fullscreen flow, and existing card renderer. Adds previous/next navigation,
 * play/pause, subtitle on/off, browser-history back restoration, and a subtitle-translation entry point stays visible but returns a localized
 * service-preparation notice until the future translation service is intentionally enabled.
 */
(function (global, document) {
  'use strict';

  if (global.__IGDC_MEDIAHUB_PLAYBACK_V2__) return;
  global.__IGDC_MEDIAHUB_PLAYBACK_V2__ = true;

  var state = {
    open: false,
    detail: null,
    stage: null,
    card: null,
    restore: [],
    scrollY: 0,
    historyToken: '',
    mutationObserver: null,
    lastCaptionValue: '',
    nativeAttempted: false,
    fitMode: 'contain',
    speedIndex: 2,
    chromeTimer: 0,
    panel: '',
    clipRecorder: null,
    clipTimer: 0,
    clipCancelled: false,
    lastVolume: 1,
    mobileFullscreenIntent: false,
    mobileImmersiveActive: false,
    mobileSession: false,
    mobileViewMode: 'list',
    playRequested: false,
    orientationTimer: 0,
    fullscreenBodyOverflow: null,
    justExitedFullscreenAt: 0,
    orientationLocked: false,
    orientationChangingUntil: 0,
    nativeVideoFullscreen: false,
    resumeAppliedContentId: '',
    progressLastSavedAt: 0,
    youtubeFrame: null,
    youtubeCurrentTime: 0,
    youtubeDuration: 0,
    youtubeEnded: false,
    youtubePollTimer: 0
  };

  var COPY = {
    ko: {back:'← 목록으로 돌아가기',previous:'이전',play:'재생',pause:'일시정지',next:'다음',captionsOn:'자막 켜기',captionsOff:'자막 끄기',translate:'자막 번역',fullscreen:'전체 화면',exitFullscreen:'전체 화면 나가기',preparing:'콘텐츠를 준비 중입니다.',unavailable:'이 콘텐츠의 재생 소스가 아직 연결되지 않았습니다.',translationPending:'서비스 준비 중입니다.',translationUnavailable:'현재 선택된 자막이 없거나 번역 가능한 자막이 연결되지 않았습니다.'},
    en: {back:'← Back to list',previous:'Previous',play:'Play',pause:'Pause',next:'Next',captionsOn:'Captions on',captionsOff:'Captions off',translate:'Translate captions',fullscreen:'Fullscreen',exitFullscreen:'Exit fullscreen',preparing:'Content is being prepared.',unavailable:'A playable source has not been connected yet.',translationPending:'Service is being prepared.',translationUnavailable:'No selected or translatable caption track is currently connected.'},
    de: {back:'← Zurück zur Liste',previous:'Zurück',play:'Wiedergabe',pause:'Pause',next:'Weiter',captionsOn:'Untertitel ein',captionsOff:'Untertitel aus',translate:'Untertitel übersetzen',fullscreen:'Vollbild',exitFullscreen:'Vollbild beenden',preparing:'Inhalt wird vorbereitet.',unavailable:'Für diesen Inhalt ist noch keine Wiedergabequelle verbunden.',translationPending:'Der Dienst wird vorbereitet.',translationUnavailable:'Es ist keine ausgewählte oder übersetzbare Untertitelspur verbunden.'},
    es: {back:'← Volver a la lista',previous:'Anterior',play:'Reproducir',pause:'Pausar',next:'Siguiente',captionsOn:'Subtítulos activados',captionsOff:'Subtítulos desactivados',translate:'Traducir subtítulos',fullscreen:'Pantalla completa',exitFullscreen:'Salir de pantalla completa',preparing:'Preparando el contenido.',unavailable:'Aún no hay una fuente de reproducción conectada.',translationPending:'El servicio está en preparación.',translationUnavailable:'No hay una pista de subtítulos seleccionada o traducible.'},
    fr: {back:'← Retour à la liste',previous:'Précédent',play:'Lire',pause:'Pause',next:'Suivant',captionsOn:'Sous-titres activés',captionsOff:'Sous-titres désactivés',translate:'Traduire les sous-titres',fullscreen:'Plein écran',exitFullscreen:'Quitter le plein écran',preparing:'Préparation du contenu.',unavailable:'Aucune source de lecture n’est encore connectée.',translationPending:'Le service est en préparation.',translationUnavailable:'Aucune piste de sous-titres sélectionnée ou traduisible n’est connectée.'},
    it: {back:'← Torna all’elenco',previous:'Precedente',play:'Riproduci',pause:'Pausa',next:'Successivo',captionsOn:'Sottotitoli attivi',captionsOff:'Sottotitoli disattivi',translate:'Traduci sottotitoli',fullscreen:'Schermo intero',exitFullscreen:'Esci da schermo intero',preparing:'Preparazione del contenuto.',unavailable:'Non è ancora collegata una sorgente riproducibile.',translationPending:'Il servizio è in preparazione.',translationUnavailable:'Non è collegata alcuna traccia sottotitoli selezionata o traducibile.'},
    pt: {back:'← Voltar à lista',previous:'Anterior',play:'Reproduzir',pause:'Pausar',next:'Seguinte',captionsOn:'Legendas ligadas',captionsOff:'Legendas desligadas',translate:'Traduzir legendas',fullscreen:'Ecrã inteiro',exitFullscreen:'Sair do ecrã inteiro',preparing:'A preparar o conteúdo.',unavailable:'Ainda não existe uma fonte de reprodução ligada.',translationPending:'O serviço está em preparação.',translationUnavailable:'Não existe uma faixa de legendas selecionada ou traduzível.'},
    nl: {back:'← Terug naar lijst',previous:'Vorige',play:'Afspelen',pause:'Pauzeren',next:'Volgende',captionsOn:'Ondertitels aan',captionsOff:'Ondertitels uit',translate:'Ondertitels vertalen',fullscreen:'Volledig scherm',exitFullscreen:'Volledig scherm sluiten',preparing:'Inhoud wordt voorbereid.',unavailable:'Er is nog geen afspeelbare bron gekoppeld.',translationPending:'De dienst wordt voorbereid.',translationUnavailable:'Er is geen geselecteerde of vertaalbare ondertiteltrack gekoppeld.'},
    pl: {back:'← Wróć do listy',previous:'Poprzedni',play:'Odtwórz',pause:'Pauza',next:'Następny',captionsOn:'Napisy włączone',captionsOff:'Napisy wyłączone',translate:'Tłumacz napisy',fullscreen:'Pełny ekran',exitFullscreen:'Wyjdź z pełnego ekranu',preparing:'Przygotowywanie treści.',unavailable:'Nie podłączono jeszcze źródła odtwarzania.',translationPending:'Usługa jest w przygotowaniu.',translationUnavailable:'Nie podłączono wybranej ani możliwej do tłumaczenia ścieżki napisów.'},
    sv: {back:'← Tillbaka till listan',previous:'Föregående',play:'Spela',pause:'Pausa',next:'Nästa',captionsOn:'Undertexter på',captionsOff:'Undertexter av',translate:'Översätt undertexter',fullscreen:'Helskärm',exitFullscreen:'Avsluta helskärm',preparing:'Innehållet förbereds.',unavailable:'Ingen spelbar källa är ansluten ännu.',translationPending:'Tjänsten förbereds.',translationUnavailable:'Ingen vald eller översättningsbar undertext är ansluten.'},
    hu: {back:'← Vissza a listához',previous:'Előző',play:'Lejátszás',pause:'Szünet',next:'Következő',captionsOn:'Felirat be',captionsOff:'Felirat ki',translate:'Felirat fordítása',fullscreen:'Teljes képernyő',exitFullscreen:'Kilépés a teljes képernyőből',preparing:'A tartalom előkészítése folyamatban.',unavailable:'Még nincs csatlakoztatva lejátszható forrás.',translationPending:'A szolgáltatás előkészítés alatt áll.',translationUnavailable:'Nincs kiválasztott vagy fordítható feliratsáv.'},
    ru: {back:'← Назад к списку',previous:'Предыдущее',play:'Воспроизвести',pause:'Пауза',next:'Следующее',captionsOn:'Субтитры вкл.',captionsOff:'Субтитры выкл.',translate:'Перевести субтитры',fullscreen:'Полный экран',exitFullscreen:'Выйти из полного экрана',preparing:'Подготовка контента.',unavailable:'Источник воспроизведения ещё не подключён.',translationPending:'Сервис готовится к запуску.',translationUnavailable:'Нет выбранной или доступной для перевода дорожки субтитров.'},
    uk: {back:'← Назад до списку',previous:'Попереднє',play:'Відтворити',pause:'Пауза',next:'Наступне',captionsOn:'Субтитри увімкнено',captionsOff:'Субтитри вимкнено',translate:'Перекласти субтитри',fullscreen:'На весь екран',exitFullscreen:'Вийти з повного екрана',preparing:'Підготовка вмісту.',unavailable:'Джерело відтворення ще не підключено.',translationPending:'Сервіс готується до запуску.',translationUnavailable:'Немає вибраної або придатної для перекладу доріжки субтитрів.'},
    tr: {back:'← Listeye dön',previous:'Önceki',play:'Oynat',pause:'Duraklat',next:'Sonraki',captionsOn:'Altyazı açık',captionsOff:'Altyazı kapalı',translate:'Altyazıyı çevir',fullscreen:'Tam ekran',exitFullscreen:'Tam ekrandan çık',preparing:'İçerik hazırlanıyor.',unavailable:'Henüz oynatılabilir bir kaynak bağlanmadı.',translationPending:'Hizmet hazırlanıyor.',translationUnavailable:'Seçili veya çevrilebilir bir altyazı parçası bağlı değil.'},
    ar: {back:'← العودة إلى القائمة',previous:'السابق',play:'تشغيل',pause:'إيقاف مؤقت',next:'التالي',captionsOn:'تشغيل الترجمة',captionsOff:'إيقاف الترجمة',translate:'ترجمة النصوص',fullscreen:'ملء الشاشة',exitFullscreen:'الخروج من ملء الشاشة',preparing:'جارٍ تجهيز المحتوى.',unavailable:'لم يتم ربط مصدر تشغيل بعد.',translationPending:'الخدمة قيد الإعداد.',translationUnavailable:'لا يوجد مسار نصوص محدد أو قابل للترجمة.'},
    fa: {back:'← بازگشت به فهرست',previous:'قبلی',play:'پخش',pause:'مکث',next:'بعدی',captionsOn:'زیرنویس روشن',captionsOff:'زیرنویس خاموش',translate:'ترجمه زیرنویس',fullscreen:'تمام‌صفحه',exitFullscreen:'خروج از تمام‌صفحه',preparing:'محتوا در حال آماده‌سازی است.',unavailable:'هنوز منبع قابل پخشی متصل نشده است.',translationPending:'سرویس در حال آماده‌سازی است.',translationUnavailable:'هیچ زیرنویس انتخاب‌شده یا قابل ترجمه‌ای متصل نیست.'},
    ur: {back:'← فہرست پر واپس جائیں',previous:'پچھلا',play:'چلائیں',pause:'روکیں',next:'اگلا',captionsOn:'سب ٹائٹل آن',captionsOff:'سب ٹائٹل آف',translate:'سب ٹائٹل ترجمہ کریں',fullscreen:'مکمل اسکرین',exitFullscreen:'مکمل اسکرین سے باہر',preparing:'مواد تیار کیا جا رہا ہے۔',unavailable:'ابھی کوئی قابلِ پلے ذریعہ منسلک نہیں ہے۔',translationPending:'سروس تیاری میں ہے۔',translationUnavailable:'کوئی منتخب یا قابلِ ترجمہ سب ٹائٹل ٹریک منسلک نہیں ہے۔'},
    hi: {back:'← सूची पर वापस जाएँ',previous:'पिछला',play:'चलाएँ',pause:'रोकें',next:'अगला',captionsOn:'उपशीर्षक चालू',captionsOff:'उपशीर्षक बंद',translate:'उपशीर्षक अनुवाद',fullscreen:'पूर्ण स्क्रीन',exitFullscreen:'पूर्ण स्क्रीन से बाहर',preparing:'सामग्री तैयार की जा रही है।',unavailable:'अभी कोई चलाने योग्य स्रोत जुड़ा नहीं है।',translationPending:'सेवा तैयार की जा रही है।',translationUnavailable:'कोई चयनित या अनुवाद योग्य उपशीर्षक ट्रैक जुड़ा नहीं है।'},
    bn: {back:'← তালিকায় ফিরুন',previous:'আগেরটি',play:'চালান',pause:'বিরতি',next:'পরেরটি',captionsOn:'সাবটাইটেল চালু',captionsOff:'সাবটাইটেল বন্ধ',translate:'সাবটাইটেল অনুবাদ',fullscreen:'পূর্ণ পর্দা',exitFullscreen:'পূর্ণ পর্দা থেকে বের হন',preparing:'কনটেন্ট প্রস্তুত করা হচ্ছে।',unavailable:'এখনও কোনো চালানোযোগ্য উৎস যুক্ত নেই।',translationPending:'সেবাটি প্রস্তুত করা হচ্ছে।',translationUnavailable:'কোনো নির্বাচিত বা অনুবাদযোগ্য সাবটাইটেল ট্র্যাক যুক্ত নেই।'},
    ta: {back:'← பட்டியலுக்குத் திரும்பு',previous:'முந்தையது',play:'இயக்கு',pause:'இடைநிறுத்து',next:'அடுத்தது',captionsOn:'வசனம் இயக்கு',captionsOff:'வசனம் அணை',translate:'வசனம் மொழிபெயர்',fullscreen:'முழுத் திரை',exitFullscreen:'முழுத் திரையிலிருந்து வெளியேறு',preparing:'உள்ளடக்கம் தயாராகிறது.',unavailable:'இயக்கக்கூடிய மூலம் இன்னும் இணைக்கப்படவில்லை.',translationPending:'சேவை தயாராகி வருகிறது.',translationUnavailable:'தேர்ந்தெடுக்கப்பட்ட அல்லது மொழிபெயர்க்கக்கூடிய வசன தடம் இல்லை.'},
    th: {back:'← กลับไปยังรายการ',previous:'ก่อนหน้า',play:'เล่น',pause:'หยุดชั่วคราว',next:'ถัดไป',captionsOn:'เปิดคำบรรยาย',captionsOff:'ปิดคำบรรยาย',translate:'แปลคำบรรยาย',fullscreen:'เต็มหน้าจอ',exitFullscreen:'ออกจากเต็มหน้าจอ',preparing:'กำลังเตรียมเนื้อหา',unavailable:'ยังไม่ได้เชื่อมต่อแหล่งเล่นที่ใช้ได้',translationPending:'บริการกำลังอยู่ระหว่างการเตรียมพร้อม',translationUnavailable:'ไม่มีแทร็กคำบรรยายที่เลือกหรือแปลได้'},
    vi: {back:'← Quay lại danh sách',previous:'Trước',play:'Phát',pause:'Tạm dừng',next:'Tiếp',captionsOn:'Bật phụ đề',captionsOff:'Tắt phụ đề',translate:'Dịch phụ đề',fullscreen:'Toàn màn hình',exitFullscreen:'Thoát toàn màn hình',preparing:'Đang chuẩn bị nội dung.',unavailable:'Chưa kết nối nguồn phát có thể sử dụng.',translationPending:'Dịch vụ đang được chuẩn bị.',translationUnavailable:'Không có bản phụ đề đã chọn hoặc có thể dịch.'},
    id: {back:'← Kembali ke daftar',previous:'Sebelumnya',play:'Putar',pause:'Jeda',next:'Berikutnya',captionsOn:'Subtitel aktif',captionsOff:'Subtitel nonaktif',translate:'Terjemahkan subtitel',fullscreen:'Layar penuh',exitFullscreen:'Keluar dari layar penuh',preparing:'Konten sedang disiapkan.',unavailable:'Sumber pemutaran belum terhubung.',translationPending:'Layanan sedang dipersiapkan.',translationUnavailable:'Tidak ada trek subtitel yang dipilih atau dapat diterjemahkan.'},
    ms: {back:'← Kembali ke senarai',previous:'Sebelumnya',play:'Main',pause:'Jeda',next:'Seterusnya',captionsOn:'Sari kata hidup',captionsOff:'Sari kata mati',translate:'Terjemah sari kata',fullscreen:'Skrin penuh',exitFullscreen:'Keluar skrin penuh',preparing:'Kandungan sedang disediakan.',unavailable:'Sumber main balik belum disambungkan.',translationPending:'Perkhidmatan sedang disediakan.',translationUnavailable:'Tiada trek sari kata dipilih atau boleh diterjemah.'},
    tl: {back:'← Bumalik sa listahan',previous:'Nakaraan',play:'I-play',pause:'I-pause',next:'Susunod',captionsOn:'Bukas ang subtitle',captionsOff:'Patay ang subtitle',translate:'Isalin ang subtitle',fullscreen:'Buong screen',exitFullscreen:'Lumabas sa buong screen',preparing:'Inihahanda ang nilalaman.',unavailable:'Wala pang nakakabit na mapapatugtog na source.',translationPending:'Inihahanda pa ang serbisyo.',translationUnavailable:'Walang napili o maisasaling subtitle track.'},
    sw: {back:'← Rudi kwenye orodha',previous:'Iliyotangulia',play:'Cheza',pause:'Sitisha',next:'Inayofuata',captionsOn:'Manukuu yamewashwa',captionsOff:'Manukuu yamezimwa',translate:'Tafsiri manukuu',fullscreen:'Skrini nzima',exitFullscreen:'Toka skrini nzima',preparing:'Maudhui yanaandaliwa.',unavailable:'Bado hakuna chanzo cha kucheza kilichounganishwa.',translationPending:'Huduma inaandaliwa.',translationUnavailable:'Hakuna wimbo wa manukuu uliochaguliwa au unaoweza kutafsiriwa.'},
    uz: {back:'← Ro‘yxatga qaytish',previous:'Oldingi',play:'Ijro',pause:'Pauza',next:'Keyingi',captionsOn:'Subtitr yoqilgan',captionsOff:'Subtitr o‘chirilgan',translate:'Subtitrni tarjima qilish',fullscreen:'To‘liq ekran',exitFullscreen:'To‘liq ekrandan chiqish',preparing:'Kontent tayyorlanmoqda.',unavailable:'Hali ijro manbasi ulanmagan.',translationPending:'Xizmat tayyorlanmoqda.',translationUnavailable:'Tanlangan yoki tarjima qilinadigan subtitr yo‘li ulanmagan.'},
    ja: {back:'← 一覧に戻る',previous:'前へ',play:'再生',pause:'一時停止',next:'次へ',captionsOn:'字幕オン',captionsOff:'字幕オフ',translate:'字幕を翻訳',fullscreen:'全画面',exitFullscreen:'全画面を終了',preparing:'コンテンツを準備しています。',unavailable:'再生ソースがまだ接続されていません。',translationPending:'サービス準備中です。',translationUnavailable:'選択中または翻訳可能な字幕トラックがありません。'},
    zh: {back:'← 返回列表',previous:'上一个',play:'播放',pause:'暂停',next:'下一个',captionsOn:'开启字幕',captionsOff:'关闭字幕',translate:'翻译字幕',fullscreen:'全屏',exitFullscreen:'退出全屏',preparing:'正在准备内容。',unavailable:'尚未连接可播放的来源。',translationPending:'服务正在准备中。',translationUnavailable:'当前没有已选择或可翻译的字幕轨道。'},
    zht: {back:'← 返回清單',previous:'上一個',play:'播放',pause:'暫停',next:'下一個',captionsOn:'開啟字幕',captionsOff:'關閉字幕',translate:'翻譯字幕',fullscreen:'全螢幕',exitFullscreen:'結束全螢幕',preparing:'正在準備內容。',unavailable:'尚未連接可播放的來源。',translationPending:'服務準備中。',translationUnavailable:'目前沒有已選取或可翻譯的字幕軌。'}
  };

  var SERVICE_PREPARING = {
    ko:'서비스 준비 중입니다.',
    en:'Service is being prepared.',
    de:'Der Dienst wird vorbereitet.',
    es:'El servicio está en preparación.',
    fr:'Le service est en préparation.',
    it:'Il servizio è in preparazione.',
    pt:'O serviço está em preparação.',
    nl:'De dienst wordt voorbereid.',
    pl:'Usługa jest w przygotowaniu.',
    sv:'Tjänsten förbereds.',
    hu:'A szolgáltatás előkészítés alatt áll.',
    ru:'Сервис готовится к запуску.',
    uk:'Сервіс готується до запуску.',
    tr:'Hizmet hazırlanıyor.',
    ar:'الخدمة قيد الإعداد.',
    fa:'سرویس در حال آماده‌سازی است.',
    ur:'سروس تیاری میں ہے۔',
    hi:'सेवा तैयार की जा रही है।',
    bn:'সেবাটি প্রস্তুত করা হচ্ছে।',
    ta:'சேவை தயாராகி வருகிறது.',
    th:'บริการกำลังอยู่ระหว่างการเตรียมพร้อม',
    vi:'Dịch vụ đang được chuẩn bị.',
    id:'Layanan sedang dipersiapkan.',
    ms:'Perkhidmatan sedang disediakan.',
    tl:'Inihahanda pa ang serbisyo.',
    sw:'Huduma inaandaliwa.',
    uz:'Xizmat tayyorlanmoqda.',
    ja:'サービス準備中です。',
    zh:'服务正在准备中。',
    zht:'服務準備中。'
  };

  Object.keys(SERVICE_PREPARING).forEach(function (langKey) {
    if (COPY[langKey]) COPY[langKey].translationPending = SERVICE_PREPARING[langKey];
  });

  function copy() {
    var lang = String((document.documentElement && document.documentElement.lang) || 'ko').toLowerCase();
    if (lang === 'zh-hant' || lang === 'zh-tw' || lang === 'zh-hk') lang = 'zht';
    lang = lang.split('-')[0];
    return COPY[lang] || COPY.en;
  }
  function backLabel() { return String(copy().back || '').replace(/^\s*←\s*/, '').trim() || 'Back'; }
  function text(value) { return value == null ? '' : String(value).trim(); }
  function create(tag, className, content) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (content != null) element.textContent = content;
    return element;
  }
  function isMobilePlaybackDevice() {
    try {
      var nav=global.navigator||{};
      var ua=String(nav.userAgent||'');
      var mobileUa=/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini|SamsungBrowser/i.test(ua);
      var uaDataMobile=!!(nav.userAgentData&&nav.userAgentData.mobile);
      var touchPoints=Number(nav.maxTouchPoints||0);
      var ipadDesktop=/Macintosh/i.test(ua)&&touchPoints>1;
      var desktopUa=/Windows NT|CrOS|X11|Linux x86_64/i.test(ua)||(/Macintosh/i.test(ua)&&!ipadDesktop);
      var coarse=!!(global.matchMedia&&global.matchMedia('(pointer:coarse)').matches);
      var noHover=!!(global.matchMedia&&global.matchMedia('(hover:none)').matches);
      var touch=!!(touchPoints>0||('ontouchstart' in global));
      var viewport=Number(global.innerWidth||document.documentElement.clientWidth||99999);
      if(desktopUa&&!mobileUa&&!uaDataMobile&&!ipadDesktop)return false;
      return !!(mobileUa||uaDataMobile||ipadDesktop||((coarse||noHover||touch)&&viewport<=1366));
    } catch (_) { return false; }
  }
  function isMobileSession() { return !!(state.open && state.mobileSession); }
  function isMobileUiMode() { return !!(state.mobileSession || isMobilePlaybackDevice()); }
  function isMediaCard(node) {
    if(!node || !node.closest) return null;
    var card=node.closest('a.card.media-card, .thumb-line[data-psom-key^="media-"] a.card');
    if(!card) return null;
    // Restrict the broader selector to MediaHub cards only.
    var inMediaRow=!!(card.closest&&card.closest('.thumb-line[data-psom-key^="media-"]'));
    var marked=!!(card.classList&&card.classList.contains('media-card'));
    return (inMediaRow||marked)?card:null;
  }
  function titleFor(card) {
    return text(card && card.dataset && (card.dataset.mediaTitle || card.dataset.title)) ||
      text(card && card.querySelector && card.querySelector('.meta') && card.querySelector('.meta').textContent) || 'Media';
  }
  function sourceFor(card) {
    return text(card && card.dataset && (card.dataset.mediaSource || card.dataset.videoSource || card.dataset.videoUrl || card.dataset.mediaUrl));
  }
  function imageFor(card) {
    var image = card && card.querySelector && card.querySelector('img');
    return (image && (image.currentSrc || image.src)) || '';
  }
  function nativePlayerUrlFor(card) {
    if (!card || !card.dataset) return '';
    var ua = String(global.navigator && global.navigator.userAgent || '').toLowerCase();
    var platformUrl = /android/.test(ua) ? card.dataset.androidPlayerUrl : (/windows/.test(ua) ? card.dataset.windowsPlayerUrl : '');
    var raw = text(platformUrl || card.dataset.maruAppUrl);
    if (!raw || /^(?:javascript|data|file):/i.test(raw)) return '';
    return raw;
  }
  function attemptNativePlayer(card) {
    var url = nativePlayerUrlFor(card);
    if (!url) return false;
    // The catalog must supply a verified app link or registered protocol URL.
    // Launch is attempted only inside the user's click gesture. The inline web
    // player is still mounted immediately, so returning from or failing to open
    // the native app never strands the user on a blank page.
    try {
      var frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;visibility:hidden';
      frame.src = url;
      (document.body || document.documentElement).appendChild(frame);
      global.setTimeout(function () { if (frame.parentNode) frame.parentNode.removeChild(frame); }, 1600);
      return true;
    } catch (_) { return false; }
  }
  function directVideo(source) { return /\.(mp4|webm|ogv|ogg|m4v)(?:[?#].*)?$/i.test(source); }
  function youtubeId(source) {
    var match = String(source || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
    return match ? match[1] : '';
  }
  function realCards() {
    return Array.prototype.slice.call(document.querySelectorAll('.thumb-line[data-psom-key^="media-"] a.card')).filter(function (card) {
      return card && card.getAttribute('data-placeholder') !== 'true' && (sourceFor(card) || contentIdFor(card));
    });
  }
  function contentIdFor(card) {
    var id = text(card && card.dataset && (card.dataset.igdcContentId || card.dataset.contentId || card.dataset.itemId || card.dataset.mediaId));
    if (id) return id;
    try {
      var url = new URL(card && (card.getAttribute('href') || card.href) || '', global.location.href);
      return text(url.searchParams.get('id') || url.searchParams.get('contentId'));
    } catch (_) { return ''; }
  }
  function simpleHash(value) {
    var h=2166136261, str=String(value||'');
    for(var i=0;i<str.length;i+=1){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0).toString(36);
  }
  function decodeJwtSubject(token) {
    try {
      var parts=String(token||'').split('.'); if(parts.length<2)return '';
      var raw=parts[1].replace(/-/g,'+').replace(/_/g,'/'); while(raw.length%4)raw+='=';
      var obj=JSON.parse(decodeURIComponent(Array.prototype.map.call(atob(raw),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join('')));
      return text(obj&&((obj.user_id||obj.sub||obj.uid||obj.email)));
    } catch(_){ return ''; }
  }
  function findIdentity(value, depth) {
    if(depth>4||value==null)return '';
    if(typeof value==='string'){
      var sub=decodeJwtSubject(value); if(sub)return sub;
      try { var parsed=JSON.parse(value); return findIdentity(parsed,depth+1); } catch(_){ return ''; }
    }
    if(Array.isArray(value)){for(var i=0;i<value.length;i+=1){var found=findIdentity(value[i],depth+1);if(found)return found;}return '';}
    if(typeof value==='object'){
      var direct=text(value.user_id||value.userId||value.uid||value.sub||value.email||(value.user&&value.user.id)); if(direct)return direct;
      var keys=['user','session','currentUser','data','id_token','idToken','access_token','accessToken','token'];
      for(var k=0;k<keys.length;k+=1){if(value[keys[k]]!=null){var hit=findIdentity(value[keys[k]],depth+1);if(hit)return hit;}}
    }
    return '';
  }
  function playbackUserScope() {
    try {
      var direct=findIdentity(global.__IGDC_USER__||global.IGDC_USER||global.currentUser||null,0); if(direct)return 'u:'+simpleHash(direct);
    } catch(_){}
    try {
      for(var i=0;i<global.localStorage.length;i+=1){
        var key=global.localStorage.key(i); if(!key)continue;
        if(!/(auth|token|session|user|supabase|osauth|member)/i.test(key))continue;
        var val=global.localStorage.getItem(key), found=findIdentity(val,0); if(found)return 'u:'+simpleHash(found);
      }
    } catch(_){}
    return 'device';
  }
  function resumeKeyFor(card) {
    var id=contentIdFor(card)||sourceFor(card)||titleFor(card);
    return 'igdc.maru.resume.v1.'+playbackUserScope()+'.'+simpleHash(id);
  }
  function readResumePosition(card) {
    try {
      var raw=global.localStorage.getItem(resumeKeyFor(card)); if(!raw)return 0;
      var row=JSON.parse(raw),pos=Number(row&&row.position||0),duration=Number(row&&row.duration||0);
      if(!Number.isFinite(pos)||pos<7)return 0;
      if(duration>0&&duration-pos<8){global.localStorage.removeItem(resumeKeyFor(card));return 0;}
      return Math.max(0,pos-5);
    } catch(_){ return 0; }
  }
  function saveResumePosition(card, position, duration, force, ended) {
    if(!card)return;
    var now=Date.now(); if(!force&&now-state.progressLastSavedAt<1500)return;
    position=Number(position||0); duration=Number(duration||0);
    try {
      var key=resumeKeyFor(card);
      if(ended||(duration>0&&duration-position<5)){global.localStorage.removeItem(key);state.progressLastSavedAt=now;return;}
      if(!Number.isFinite(position)||position<2)return;
      global.localStorage.setItem(key,JSON.stringify({position:position,duration:Number.isFinite(duration)?duration:0,updatedAt:now}));
      state.progressLastSavedAt=now;
    } catch(_){}
  }
  function saveCurrentProgress(force) {
    if(!state.open||!state.card)return;
    var video=currentVideo();
    if(video){saveResumePosition(state.card,video.currentTime,video.duration,!!force,video.ended);return;}
    if(state.youtubeFrame){saveResumePosition(state.card,state.youtubeCurrentTime,state.youtubeDuration,!!force,!!state.youtubeEnded);}
  }

  function adjacentCard(direction) {
    var cards = realCards();
    var index = cards.indexOf(state.card);
    if (index < 0 || !cards.length) return null;
    var target = index + direction;
    return target >= 0 && target < cards.length ? cards[target] : null;
  }
  function frameHeight() {
    try {
      if (global.parent === global || !global.parent.postMessage) return;
      var de = document.documentElement, body = document.body;
      var height = Math.max(de ? de.scrollHeight : 0, body ? body.scrollHeight : 0, de ? de.offsetHeight : 0, body ? body.offsetHeight : 0);
      global.parent.postMessage({ type: 'igdcFrameHeight', height: height, page: global.location.pathname }, '*');
    } catch (_) {}
  }


  var EXTRA_COPY = {
    ko: {
      brand:'MARU Player', view:'화면', playback:'재생', subtitle:'자막', tools:'도구',
      back10:'10초 뒤로', forward10:'10초 앞으로', fit:'Fit', fill:'Fill', speed:'재생 속도', mute:'음소거', unmute:'소리 켜기',
      loopOn:'반복 켜기', loopOff:'반복 끄기', shot:'화면 캡처', settings:'설정', audio:'오디오', subtitleTrack:'자막 트랙',
      clipTitle:'짧은 클립 캡처', clip20:'20초 클립', clip30:'30초 클립', clip60:'1분 클립', clip120:'2분 클립',
      clipStarted:'클립 캡처를 시작했습니다.', clipSaved:'클립을 저장했습니다.', clipUnsupported:'이 영상/브라우저에서는 웹 클립 캡처를 사용할 수 없습니다.',
      clipBusy:'이미 클립을 캡처하고 있습니다.', shotSaved:'현재 프레임을 저장했습니다.', shotUnsupported:'이 영상은 브라우저 보안 제한 때문에 화면 캡처를 저장할 수 없습니다.',
      audioDefault:'기본 오디오', noAudioTracks:'브라우저에서 별도 오디오 트랙 선택을 지원하지 않습니다.',
      noSubtitleTracks:'사용 가능한 자막 트랙이 없습니다.', pip:'미니 화면', pipUnsupported:'이 브라우저에서는 미니 화면을 지원하지 않습니다.',
      controls:'컨트롤 표시', captureHint:'현재 위치부터 짧은 클립을 저장합니다. 웹 브라우저에서는 지원되는 직접 영상에 한해 실시간으로 캡처됩니다.'
    },
    en: {
      brand:'MARU Player', view:'View', playback:'Playback', subtitle:'Subtitle', tools:'Tools',
      back10:'Back 10s', forward10:'Forward 10s', fit:'Fit', fill:'Fill', speed:'Speed', mute:'Mute', unmute:'Unmute',
      loopOn:'Loop on', loopOff:'Loop off', shot:'Capture frame', settings:'Settings', audio:'Audio', subtitleTrack:'Subtitle track',
      clipTitle:'Quick Clip Capture', clip20:'20s Clip', clip30:'30s Clip', clip60:'1min Clip', clip120:'2min Clip',
      clipStarted:'Quick clip capture started.', clipSaved:'Quick clip saved.', clipUnsupported:'Web clip capture is not available for this media/browser.',
      clipBusy:'A clip is already being captured.', shotSaved:'Frame saved.', shotUnsupported:'This frame cannot be saved because of browser media security restrictions.',
      audioDefault:'Default audio', noAudioTracks:'Separate audio-track selection is not exposed by this browser.',
      noSubtitleTracks:'No subtitle tracks are available.', pip:'Mini view', pipUnsupported:'Picture-in-picture is not available in this browser.',
      controls:'Show controls', captureHint:'Saves a short clip from the current position. In browsers, supported direct video is captured in real time.'
    },
    ja: {
      brand:'MARU Player', view:'表示', playback:'再生', subtitle:'字幕', tools:'ツール', back10:'10秒戻る', forward10:'10秒進む', fit:'Fit', fill:'Fill', speed:'速度', mute:'ミュート', unmute:'音声オン', loopOn:'リピートON', loopOff:'リピートOFF', shot:'フレーム保存', settings:'設定', audio:'音声', subtitleTrack:'字幕トラック', clipTitle:'短いクリップ', clip20:'20秒クリップ', clip30:'30秒クリップ', clip60:'1分クリップ', clip120:'2分クリップ', clipStarted:'クリップ保存を開始しました。', clipSaved:'クリップを保存しました。', clipUnsupported:'この動画/ブラウザではクリップ保存を利用できません。', clipBusy:'クリップを保存中です。', shotSaved:'フレームを保存しました。', shotUnsupported:'ブラウザの制限によりフレームを保存できません。', audioDefault:'標準音声', noAudioTracks:'このブラウザでは音声トラック選択を利用できません。', noSubtitleTracks:'字幕トラックがありません。', pip:'ミニ表示', pipUnsupported:'このブラウザではミニ表示を利用できません。', controls:'コントロール表示', captureHint:'現在位置から短いクリップを保存します。' },
    zh: {
      brand:'MARU Player', view:'画面', playback:'播放', subtitle:'字幕', tools:'工具', back10:'后退10秒', forward10:'前进10秒', fit:'Fit', fill:'Fill', speed:'速度', mute:'静音', unmute:'开启声音', loopOn:'循环开启', loopOff:'循环关闭', shot:'截取画面', settings:'设置', audio:'音频', subtitleTrack:'字幕轨道', clipTitle:'短片截取', clip20:'20秒短片', clip30:'30秒短片', clip60:'1分钟短片', clip120:'2分钟短片', clipStarted:'开始截取短片。', clipSaved:'短片已保存。', clipUnsupported:'此视频/浏览器不支持网页短片截取。', clipBusy:'正在截取短片。', shotSaved:'画面已保存。', shotUnsupported:'由于浏览器安全限制，无法保存此画面。', audioDefault:'默认音频', noAudioTracks:'此浏览器未提供独立音轨选择。', noSubtitleTracks:'没有可用字幕轨道。', pip:'小窗', pipUnsupported:'此浏览器不支持小窗播放。', controls:'显示控制栏', captureHint:'从当前位置保存短片。' },
    zht: {
      brand:'MARU Player', view:'畫面', playback:'播放', subtitle:'字幕', tools:'工具', back10:'後退10秒', forward10:'前進10秒', fit:'Fit', fill:'Fill', speed:'速度', mute:'靜音', unmute:'開啟聲音', loopOn:'循環開啟', loopOff:'循環關閉', shot:'擷取畫面', settings:'設定', audio:'音訊', subtitleTrack:'字幕軌', clipTitle:'短片擷取', clip20:'20秒短片', clip30:'30秒短片', clip60:'1分鐘短片', clip120:'2分鐘短片', clipStarted:'開始擷取短片。', clipSaved:'短片已儲存。', clipUnsupported:'此影片/瀏覽器不支援網頁短片擷取。', clipBusy:'正在擷取短片。', shotSaved:'畫面已儲存。', shotUnsupported:'因瀏覽器安全限制，無法儲存此畫面。', audioDefault:'預設音訊', noAudioTracks:'此瀏覽器未提供獨立音軌選擇。', noSubtitleTracks:'沒有可用字幕軌。', pip:'小窗', pipUnsupported:'此瀏覽器不支援小窗播放。', controls:'顯示控制列', captureHint:'從目前位置儲存短片。' }
  };
  function extraCopy() {
    var lang = String((document.documentElement && document.documentElement.lang) || 'ko').toLowerCase();
    if (lang === 'zh-hant' || lang === 'zh-tw' || lang === 'zh-hk') lang = 'zht';
    lang = lang.split('-')[0];
    return EXTRA_COPY[lang] || EXTRA_COPY.en;
  }

  var SVG = {
    back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/><path d="M8 12h10"/></svg>',
    play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.5v13l11-6.5z"/></svg>',
    pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>',
    prev:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M18 6l-9 6 9 6z"/></svg>',
    next:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6v12M6 6l9 6-9 6z"/></svg>',
    volume:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9c1.4 1.8 1.4 4.2 0 6M18.5 6.5c3 3.1 3 7.9 0 11"/></svg>',
    mute:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    loop:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l-2-2M17 17H7l2 2"/><path d="M17 7c2 0 3 1.4 3 3M7 17c-2 0-3-1.4-3-3"/></svg>',
    camera:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h4l1.4-2h5.2L16 8h4v10H4z"/><circle cx="12" cy="13" r="3.2"/></svg>',
    gear:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/></svg>',
    fullscreen:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/></svg>',
    exit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H4V4M16 8h4V4M8 16H4v4M16 16h4v4"/></svg>',
    pip:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/></svg>'
  };

  function injectStyle() {
    if (document.getElementById('igdc-mediahub-playback-v2-style')) return;
    var style = document.createElement('style');
    style.id = 'igdc-mediahub-playback-v2-style';
    style.textContent = [
      '#igdc-media-detail-view{--maru-bg:#06080c;--maru-bar:rgba(13,17,23,.90);--maru-line:rgba(255,255,255,.11);--maru-text:#eef3f8;--maru-muted:#9ba8b8;--maru-accent:#61a9ff;position:relative!important;z-index:50;display:block;width:100%!important;height:var(--maru-inline-h,calc(100dvh - 1px))!important;min-height:320px!important;max-width:100%!important;overflow:hidden;background:var(--maru-bg);color:var(--maru-text);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;isolation:isolate}',
      '#igdc-media-detail-view *{box-sizing:border-box}',
      'body.igdc-media-player-only> :not(#igdc-media-detail-view):not(script):not(style):not(link){display:none!important}',
      'html.igdc-media-player-only,body.igdc-media-player-only{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important;overscroll-behavior:none!important}',
      'body.igdc-media-player-only #igdc-media-detail-view.igdc-mobile-inline-player{position:relative!important;inset:auto!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;z-index:50!important;width:100%!important;max-width:100%!important;margin:0!important;background:#000!important}',
      '#igdc-media-detail-view[data-mobile-view="immersive"] .igdc-media-detail-stage video,#igdc-media-detail-view[data-mobile-view="immersive"] .igdc-media-detail-stage iframe{object-fit:contain!important;background:#000!important}',
      '#igdc-media-detail-view:fullscreen,#igdc-media-detail-view:-webkit-full-screen,#igdc-media-detail-view.igdc-mobile-fullscreen-fallback{position:fixed!important;inset:0!important;left:0!important;top:0!important;right:0!important;bottom:0!important;z-index:2147483000!important;width:var(--maru-vw,100vw)!important;height:var(--maru-vh,100dvh)!important;min-width:var(--maru-vw,100vw)!important;min-height:var(--maru-vh,100dvh)!important;max-width:var(--maru-vw,100vw)!important;max-height:var(--maru-vh,100dvh)!important;margin:0!important;overflow:hidden!important;background:#000}',
      '.igdc-maru-topbar{position:absolute;top:0;left:0;right:0;height:54px;display:flex;align-items:center;gap:8px;padding:0 10px;background:linear-gradient(180deg,rgba(15,19,24,.94),rgba(15,19,24,.78));border-bottom:1px solid var(--maru-line);backdrop-filter:blur(14px);z-index:18}',
      '.igdc-maru-brand{font-weight:750;letter-spacing:.02em;white-space:nowrap;color:#f3f7fb}',
      '.igdc-maru-title{display:none!important}.igdc-maru-back-btn{width:auto!important;max-width:220px;padding:0 10px!important}.igdc-maru-back-btn span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.igdc-maru-menu{display:none!important}',
      '.igdc-maru-menu-btn,.igdc-maru-icon-btn,.igdc-maru-text-btn{appearance:none;border:0;outline:0;color:var(--maru-text);background:transparent;cursor:pointer;border-radius:9px;height:36px;display:inline-flex;align-items:center;justify-content:center;gap:6px;font:600 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:background .12s ease,color .12s ease,opacity .12s ease}',
      '.igdc-maru-menu-btn{padding:0 10px}.igdc-maru-icon-btn{width:40px;padding:0}.igdc-maru-text-btn{min-width:42px;padding:0 9px;background:rgba(255,255,255,.035)}',
      '.igdc-maru-menu-btn:hover,.igdc-maru-icon-btn:hover,.igdc-maru-text-btn:hover,.igdc-maru-icon-btn[data-active="true"],.igdc-maru-text-btn[data-active="true"]{background:rgba(97,169,255,.16);color:#fff}',
      '.igdc-maru-icon-btn:disabled,.igdc-maru-text-btn:disabled{opacity:.34;cursor:not-allowed;background:transparent}',
      '.igdc-maru-icon-btn svg,.igdc-maru-menu-btn svg,.igdc-maru-text-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.igdc-maru-icon-btn svg .fill,.igdc-maru-text-btn svg .fill{fill:currentColor;stroke:none}',
      '.igdc-media-detail-stage{position:absolute;inset:0;min-width:0;min-height:0;width:100%;height:100%;display:block;overflow:hidden;background:#000;outline:0}',
      '.igdc-media-detail-stage> :not(.igdc-media-detail-pending):not(.igdc-transport-overlay){width:100%!important;height:100%!important;min-width:100%!important;min-height:100%!important;max-width:none!important;max-height:none!important;margin:0!important}',
      '.igdc-media-detail-stage video,.igdc-media-detail-stage iframe{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-width:100%!important;min-height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;border:0;background:#000;object-fit:contain}',
      '#igdc-media-detail-view[data-fit="cover"] .igdc-media-detail-stage video{object-fit:cover}',
      '.igdc-maru-controlbar{position:absolute!important;left:0!important;right:0!important;bottom:0!important;top:auto!important;width:100%!important;min-height:112px;background:linear-gradient(180deg,rgba(11,14,18,.66),rgba(11,14,18,.96));border-top:1px solid var(--maru-line);padding:8px 12px 10px;z-index:28!important;backdrop-filter:blur(14px)}',
      '.igdc-maru-progress-row{display:grid;grid-template-columns:auto minmax(100px,1fr) auto;align-items:center;gap:9px;height:31px;position:relative;z-index:2}.igdc-maru-time{font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c6d0dc;min-width:46px;text-align:center}',
      '.igdc-maru-seek{width:100%;height:18px;accent-color:var(--maru-accent);cursor:pointer}',
      '.igdc-maru-controls-row{position:absolute;right:12px;bottom:10px;left:auto;display:flex;align-items:center;justify-content:flex-end;gap:6px;min-height:44px;max-width:44%;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;z-index:3}.igdc-maru-controls-row::-webkit-scrollbar{display:none}',
      '.igdc-maru-spacer{flex:1 1 auto;min-width:6px}.igdc-maru-volume{display:flex;align-items:center;gap:4px;min-width:116px}.igdc-maru-volume input{width:78px;accent-color:var(--maru-accent)}',
      '.igdc-maru-recording{display:none;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;background:rgba(200,45,55,.2);color:#ffb9bd;font-size:12px;font-weight:700}.igdc-maru-recording[data-open="true"]{display:inline-flex}.igdc-maru-record-dot{width:8px;height:8px;border-radius:50%;background:#ff4f59;box-shadow:0 0 0 4px rgba(255,79,89,.12)}',
      '.igdc-maru-panel{position:absolute;top:auto;bottom:88px;right:10px;z-index:20;width:min(360px,calc(100vw - 20px));max-height:calc(100% - 150px);overflow:auto;padding:12px;border:1px solid var(--maru-line);border-radius:14px;background:rgba(20,25,32,.98);box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(16px)}',
      '.igdc-maru-panel[hidden]{display:none}.igdc-maru-panel-title{font-size:14px;font-weight:750;margin:2px 2px 10px}.igdc-maru-panel-section{padding-top:10px;margin-top:10px;border-top:1px solid var(--maru-line)}.igdc-maru-panel-section:first-of-type{padding-top:0;margin-top:0;border-top:0}.igdc-maru-panel-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--maru-muted);margin:0 2px 7px}.igdc-maru-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.igdc-maru-panel-grid button{height:38px;border:0;border-radius:9px;background:rgba(255,255,255,.055);color:#eef3f8;font:600 12.5px/1.2 system-ui;cursor:pointer}.igdc-maru-panel-grid button:hover{background:rgba(97,169,255,.16)}.igdc-maru-panel-hint{margin-top:8px;color:var(--maru-muted);font-size:11.5px;line-height:1.45}',
      '.igdc-maru-track-list{display:flex;flex-direction:column;gap:6px}.igdc-maru-track-list button{width:100%;text-align:left;padding:9px 10px;border:0;border-radius:8px;background:rgba(255,255,255,.045);color:#e7edf4;cursor:pointer}.igdc-maru-track-list button[data-active="true"]{background:rgba(97,169,255,.18);color:#fff}',
      '.igdc-media-detail-notice{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);z-index:30;display:none;max-width:min(640px,90vw);padding:9px 13px;border-radius:9px;background:rgba(13,18,24,.94);border:1px solid rgba(255,255,255,.13);color:#f0f5fa;font-size:12.5px;line-height:1.4;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.36)}.igdc-media-detail-notice[data-open="true"]{display:block}',
      '.igdc-media-detail-pending{position:relative;display:grid;place-items:center;width:100%;height:100%;overflow:hidden;background:#0e1521}.igdc-media-detail-pending img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.22;filter:blur(1px)}.igdc-media-detail-pending-panel{position:relative;max-width:620px;margin:24px;padding:22px 24px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(7,11,17,.88);text-align:center;line-height:1.55}.igdc-media-detail-pending-panel strong{display:block;margin-bottom:6px}',
      '#igdc-media-detail-view:not(.igdc-chrome-visible) .igdc-maru-topbar,#igdc-media-detail-view:not(.igdc-chrome-visible) .igdc-maru-controlbar,#igdc-media-detail-view:not(.igdc-chrome-visible) .igdc-transport-overlay{opacity:0;visibility:hidden;pointer-events:none}',
      '#igdc-media-detail-view .igdc-maru-topbar,#igdc-media-detail-view .igdc-maru-controlbar,#igdc-media-detail-view .igdc-transport-overlay{transition:opacity .14s ease,visibility .14s ease,transform .14s ease}',
      '.igdc-transport-overlay{display:flex;position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:30;align-items:center;justify-content:center;gap:12px;pointer-events:none}.igdc-transport-overlay .igdc-maru-icon-btn,.igdc-transport-overlay .igdc-maru-text-btn{pointer-events:auto;width:60px;height:60px;background:rgba(8,12,17,.56);border:1px solid rgba(255,255,255,.16);border-radius:50%;box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(10px)}.igdc-transport-overlay [data-media-action="play"]{width:74px;height:74px}.igdc-transport-overlay [data-media-action="seek-back"],.igdc-transport-overlay [data-media-action="seek-forward"]{font-size:14px}.igdc-transport-overlay svg{width:27px!important;height:27px!important}',
      '@media(min-width:821px) and (pointer:fine){.igdc-maru-controls-row{right:14px;bottom:18px;gap:7px;min-height:46px;max-width:45%;align-items:center}.igdc-maru-controls-row .igdc-maru-icon-btn{width:44px;height:42px}.igdc-maru-controls-row .igdc-maru-text-btn{min-width:46px;height:42px;padding:0 10px;font-size:14px}.igdc-maru-controls-row .igdc-maru-icon-btn svg,.igdc-maru-controls-row .igdc-maru-text-btn svg{width:22px;height:22px}.igdc-maru-controls-row .igdc-maru-volume{min-width:124px}.igdc-maru-controls-row .igdc-maru-volume input{width:84px}}',
      '@media(max-width:1024px){.scroll-wrapper{box-sizing:border-box!important;width:100%!important;max-width:100%!important;margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;overflow:hidden!important}.thumb-line[data-psom-key^="media-"],.thumb-line[data-psom-key^="media-"]>.scroll-content{box-sizing:border-box!important;margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;gap:4px!important}}',
      '@media(max-width:1024px) and (orientation:portrait){html,body,.container,.layout,main,.main,.main-content,.content,.content-area{box-sizing:border-box!important;width:100%!important;max-width:100%!important;margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important}.thumb-line[data-psom-key^="media-"],.thumb-line[data-psom-key^="media-"].scroll-wrapper{box-sizing:border-box!important;width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;overflow:hidden!important}.thumb-line[data-psom-key^="media-"]>.scroll-content{box-sizing:border-box!important;display:flex!important;flex-wrap:nowrap!important;width:100%!important;min-width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;gap:4px!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important;scroll-snap-type:x proximity!important;scroll-behavior:auto!important;overscroll-behavior-x:contain!important}.thumb-line[data-psom-key^="media-"]>.scroll-content>a.card.media-card,.thumb-line[data-psom-key^="media-"]>a.card.media-card{box-sizing:border-box!important;width:100%!important;min-width:100%!important;max-width:100%!important;flex:0 0 100%!important;height:auto!important;min-height:0!important;max-height:none!important;aspect-ratio:16/9!important;margin:0!important;scroll-snap-align:start!important;scroll-snap-stop:normal!important}.thumb-line[data-psom-key^="media-"] a.card.media-card>.thumb{box-sizing:border-box!important;width:100%!important;min-width:100%!important;max-width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;aspect-ratio:16/9!important;margin:0!important}.thumb-line[data-psom-key^="media-"] a.card.media-card>.thumb>img{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important}}',
      '@media(max-width:1024px) and (orientation:landscape){.thumb-line[data-psom-key^="media-"]>.scroll-content{gap:4px!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important;scroll-snap-type:none!important;scroll-behavior:auto!important;overscroll-behavior-x:contain!important}.thumb-line[data-psom-key^="media-"] a.card.media-card{scroll-snap-align:none!important;scroll-snap-stop:normal!important}}',
      '@media(max-width:820px),(pointer:coarse){.igdc-maru-topbar{height:calc(50px + env(safe-area-inset-top));padding:env(safe-area-inset-top) max(6px,env(safe-area-inset-right)) 0 max(6px,env(safe-area-inset-left))}.igdc-maru-brand{font-size:13px}.igdc-maru-back-btn{max-width:150px;padding:0 7px!important;font-size:12px}.igdc-maru-menu{display:none!important}.igdc-maru-controlbar{min-height:84px!important;padding:6px 7px max(10px,env(safe-area-inset-bottom))!important}.igdc-maru-progress-row{height:32px;gap:7px;margin-bottom:4px}.igdc-maru-controls-row{position:absolute;right:max(7px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));left:auto;justify-content:flex-end;gap:7px;min-height:42px;max-width:100%}.igdc-maru-controls-row>[data-media-action]:not([data-mobile-inline="1"]){display:none!important}.igdc-maru-controls-row>.igdc-maru-spacer{display:none!important}.igdc-maru-icon-btn{width:44px;height:42px}.igdc-maru-text-btn{min-width:44px;height:42px;padding:0 7px;font-size:11.5px}.igdc-maru-volume{display:none}.igdc-maru-panel{top:auto;bottom:96px;right:max(7px,env(safe-area-inset-right));width:min(360px,calc(100vw - 14px));max-height:calc(100% - 150px);padding-bottom:max(12px,env(safe-area-inset-bottom))}.igdc-media-detail-notice{bottom:100px}.igdc-media-detail-stage{width:100%!important;height:100%!important;min-width:0!important;min-height:0!important}.igdc-media-detail-stage> :not(.igdc-media-detail-pending):not(.igdc-transport-overlay){width:100%!important;height:100%!important}.igdc-transport-overlay{left:50%;top:50%;bottom:auto;transform:translate(-50%,-50%);gap:14px}.igdc-transport-overlay .igdc-maru-icon-btn,.igdc-transport-overlay .igdc-maru-text-btn{width:62px;height:62px;background:rgba(5,8,12,.52)}.igdc-transport-overlay [data-media-action="play"]{width:88px;height:88px}.igdc-transport-overlay [data-media-action="seek-back"],.igdc-transport-overlay [data-media-action="seek-forward"]{width:68px;height:68px}.igdc-transport-overlay [data-media-action="previous"],.igdc-transport-overlay [data-media-action="next"]{width:60px;height:60px}}',
      '@media(max-height:520px) and (orientation:landscape){.igdc-maru-topbar{height:calc(44px + env(safe-area-inset-top))}.igdc-maru-controlbar{min-height:72px!important;padding-top:3px!important;padding-bottom:max(5px,env(safe-area-inset-bottom))!important}.igdc-maru-progress-row{height:27px}.igdc-maru-controls-row{bottom:max(5px,env(safe-area-inset-bottom));min-height:36px}.igdc-maru-icon-btn,.igdc-maru-text-btn{height:36px}.igdc-maru-panel{top:auto;bottom:82px;max-height:calc(100% - 126px)}.igdc-transport-overlay{top:50%;gap:12px}.igdc-transport-overlay [data-media-action="play"]{width:84px;height:84px}}'
    ].join('');
    document.head.appendChild(style);
  }

  // Mobile list geometry must be correct on the first paint, before any card is tapped.
  if (document.head) injectStyle();
  else document.addEventListener('DOMContentLoaded', injectStyle, { once:true });

  function hideList(card) {
    if(document.documentElement)document.documentElement.classList.add('igdc-media-player-only');
    if(document.body)document.body.classList.add('igdc-media-player-only');
    var roots = [];
    function add(node) { if (node && roots.indexOf(node) < 0) roots.push(node); }
    add(document.getElementById('hero'));
    add(document.querySelector('.layout'));
    add(card && card.closest('.layout'));
    add(document.querySelector('main'));
    add(document.querySelector('.hero-overlay'));
    add(document.querySelector('.section-blockchain'));
    add(document.querySelector('.content-area'));
    add(document.querySelector('.platform-line'));
    Array.prototype.forEach.call(document.querySelectorAll('.thumb-line[data-psom-key^="media-"], .section-title'), add);
    add(document.querySelector('footer'));
    add(document.getElementById('providers-drawer-left'));
    add(document.getElementById('providers-backdrop-left'));
    add(document.getElementById('providers-tab-left'));
    add(document.getElementById('providers-banner'));
    state.restore = roots.map(function (node) { return { node: node, display: node.style.display, ariaHidden: node.getAttribute('aria-hidden') }; });
    state.restore.forEach(function (entry) { entry.node.style.display = 'none'; entry.node.setAttribute('aria-hidden', 'true'); });
  }
  function restoreList() {
    if(document.documentElement)document.documentElement.classList.remove('igdc-media-player-only');
    if(document.body)document.body.classList.remove('igdc-media-player-only');
    state.restore.forEach(function (entry) {
      entry.node.style.display = entry.display;
      if (entry.ariaHidden == null) entry.node.removeAttribute('aria-hidden'); else entry.node.setAttribute('aria-hidden', entry.ariaHidden);
    });
    state.restore = [];
  }

  function notifySourceFailure(card, reason) {
    try { document.dispatchEvent(new CustomEvent('igdc:media-source-failed', { detail: { card: card, contentId: contentIdFor(card), reason: reason || 'media_source_failed' } })); } catch (_) {}
  }
  function appendLegacyPlayer(stage, card) {
    var c = copy(), source = sourceFor(card), youtube = youtubeId(source);
    stage.dataset.playerKind = '';
    if (youtube) {
      stage.dataset.playerKind = 'embed';
      var frame = document.createElement('iframe');
      frame.title = titleFor(card);
      var resumeAt=readResumePosition(card), origin='';
      try{origin=encodeURIComponent(global.location.origin||'');}catch(_origin){}
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(youtube) + '?autoplay=1&rel=0&playsinline=1&enablejsapi=1' + (origin?'&origin='+origin:'') + (resumeAt>0?'&start='+Math.floor(resumeAt):'');
      frame.allow = 'autoplay; picture-in-picture; encrypted-media';
      frame.dataset.igdcYoutube='1'; frame.dataset.igdcContentId=contentIdFor(card)||'';
      state.youtubeFrame=frame;state.youtubeCurrentTime=resumeAt||0;state.youtubeDuration=0;state.youtubeEnded=false;
      frame.addEventListener('load', function(){
        try{frame.contentWindow.postMessage(JSON.stringify({event:'listening',id:'igdc-mediahub'}),'*');}catch(_e){}
        clearInterval(state.youtubePollTimer);
        state.youtubePollTimer=setInterval(function(){
          if(!state.open||state.youtubeFrame!==frame||!frame.isConnected){clearInterval(state.youtubePollTimer);state.youtubePollTimer=0;return;}
          try{frame.contentWindow.postMessage(JSON.stringify({event:'command',func:'getCurrentTime',args:[]}),'*');}catch(_e){}
        },1200);
      }, { once:true });
      frame.addEventListener('error', function(){ notifySourceFailure(card, 'iframe_source_error'); }, { once:true });
      stage.appendChild(frame); return;
    }
    if (directVideo(source)) {
      stage.dataset.playerKind = 'video';
      var video = document.createElement('video');
      // Set mobile-inline policy before assigning src/autoplay so iOS/Android never
      // get a chance to promote the element into their native fullscreen player.
      video.controls = false; video.playsInline = true; video.preload = 'metadata';
      video.setAttribute('playsinline',''); video.setAttribute('webkit-playsinline',''); video.setAttribute('aria-label', titleFor(card));
      video.autoplay = true; video.src = source;
      video.addEventListener('error', function(){ notifySourceFailure(card, 'video_source_error'); }, { once:true });
      video.addEventListener('stalled', function(){ setTimeout(function(){ if(video.isConnected && !video.ended && video.readyState < 2) notifySourceFailure(card, 'video_stalled_before_playable'); }, 4000); }, { once:true });
      appendCardTracks(video, card); stage.appendChild(video); return;
    }
    stage.dataset.playerKind = 'pending';
    var pending = create('div', 'igdc-media-detail-pending');
    var image = imageFor(card); if (image) { var preview = document.createElement('img'); preview.src = image; preview.alt = ''; pending.appendChild(preview); }
    var panel = create('div', 'igdc-media-detail-pending-panel'); panel.appendChild(create('strong', '', c.preparing)); panel.appendChild(create('div', '', c.unavailable)); pending.appendChild(panel); stage.appendChild(pending);
    notifySourceFailure(card, 'playable_source_unavailable');
  }
  function appendCardTracks(video, card) {
    var raw = text(card && card.dataset && (card.dataset.captions || card.dataset.subtitleTracks));
    if (!raw) return;
    try {
      var tracks = JSON.parse(raw); if (!Array.isArray(tracks)) return;
      tracks.forEach(function (item, index) {
        if (!item || !item.src) return;
        var track = document.createElement('track'); track.kind = 'subtitles'; track.src = item.src; track.srclang = item.language || item.srclang || 'und'; track.label = item.label || track.srclang; if (item.default || index === 0) track.default = true; video.appendChild(track);
      });
    } catch (_) {}
  }
  function appendPlayer(stage, card) {
    var ott = global.IGDCMediaHubOTTInline;
    if (ott && typeof ott.mount === 'function') { try { if (ott.mount(stage, card, { legacyMount: appendLegacyPlayer })) return; } catch (_) {} }
    appendLegacyPlayer(stage, card);
  }

  function currentVideo() { return state.stage && state.stage.querySelector('video'); }
  function currentCaptionSelect() { return state.stage && state.stage.querySelector('.igdc-ott-caption-select'); }
  function formatTime(seconds) {
    seconds = Number(seconds); if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    return (h ? String(h).padStart(2,'0') + ':' : '') + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }
  function setButtonGraphic(button, iconName, textValue) {
    if (!button) return;
    button.innerHTML = '';
    if (iconName && SVG[iconName]) { var span = document.createElement('span'); span.innerHTML = SVG[iconName]; button.appendChild(span.firstChild); }
    if (textValue != null && textValue !== '') { var label = create('span','',textValue); button.appendChild(label); }
  }
  function setControlLabel(button, label) { if (button) { button.title = label; button.setAttribute('aria-label', label); } }
  function iconButton(action, iconName, label, textValue) {
    var node = create('button', textValue ? 'igdc-maru-text-btn' : 'igdc-maru-icon-btn'); node.type = 'button'; node.dataset.mediaAction = action; setButtonGraphic(node, iconName, textValue); setControlLabel(node,label); return node;
  }
  function menuButton(panelName, label) { var node = create('button','igdc-maru-menu-btn',label); node.type='button'; node.dataset.mediaPanel = panelName; return node; }
  function mobileInline(node) { if(node) node.dataset.mobileInline='1'; return node; }

  function hasCaptions(video) {
    var select = currentCaptionSelect(); if (select && select.options && select.options.length > 1) return true;
    return Boolean(video && video.textTracks && video.textTracks.length);
  }
  function captionsEnabled() {
    var select = currentCaptionSelect(); if (select) return !!(select.value && select.value !== 'off');
    var video = currentVideo(); if (!video || !video.textTracks) return false;
    for (var i=0;i<video.textTracks.length;i+=1) if (video.textTracks[i].mode === 'showing') return true;
    return false;
  }
  function toggleCaptions() {
    var select = currentCaptionSelect();
    if (select) {
      if (select.value && select.value !== 'off') { state.lastCaptionValue = select.value; select.value = 'off'; }
      else { var desired = state.lastCaptionValue; if (!desired || !Array.prototype.some.call(select.options,function(o){return o.value===desired;})) desired = select.options.length>1?select.options[1].value:'off'; select.value=desired; }
      select.dispatchEvent(new Event('change',{bubbles:true})); syncUi(); renderTrackPanel(); return;
    }
    var video=currentVideo(); if(!video||!video.textTracks||!video.textTracks.length)return;
    var turnOn=!captionsEnabled(); for(var i=0;i<video.textTracks.length;i+=1) video.textTracks[i].mode=turnOn&&i===0?'showing':'disabled'; syncUi(); renderTrackPanel();
  }
  function selectCaption(indexOrValue) {
    var select=currentCaptionSelect();
    if(select){ select.value=String(indexOrValue); select.dispatchEvent(new Event('change',{bubbles:true})); state.lastCaptionValue=select.value; syncUi(); renderTrackPanel(); return; }
    var video=currentVideo(); if(!video||!video.textTracks)return; var index=Number(indexOrValue);
    for(var i=0;i<video.textTracks.length;i+=1) video.textTracks[i].mode=(i===index?'showing':'disabled'); syncUi(); renderTrackPanel();
  }

  function togglePlay() { var video=currentVideo(); if(!video)return; if(video.paused){var p=video.play();if(p&&p.catch)p.catch(function(){});}else video.pause(); syncUi(); showChrome(3200); }
  function seekBy(delta) { var video=currentVideo(); if(!video||!Number.isFinite(video.duration))return; video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+delta)); updateTimeUi(); showChrome(2600); }
  function cycleSpeed() { var video=currentVideo(); if(!video)return; var speeds=[0.5,0.75,1,1.25,1.5,2]; var current=video.playbackRate||1, idx=speeds.indexOf(current); idx=(idx+1)%speeds.length; video.playbackRate=speeds[idx]; state.speedIndex=idx; syncUi(); }
  function toggleMute() { var video=currentVideo(); if(!video)return; if(video.muted || video.volume===0){video.muted=false;video.volume=state.lastVolume>0?state.lastVolume:1;}else{state.lastVolume=video.volume||1;video.muted=true;} syncUi(); }
  function setVolume(value) { var video=currentVideo(); if(!video)return; var v=Math.max(0,Math.min(1,Number(value))); video.volume=v; video.muted=v===0; if(v>0)state.lastVolume=v; syncUi(); }
  function toggleLoop() { var video=currentVideo(); if(!video)return; video.loop=!video.loop; syncUi(); }
  function setFit(mode) { state.fitMode=mode==='cover'?'cover':'contain'; if(state.detail)state.detail.dataset.fit=state.fitMode; syncUi(); }

  function showNotice(message, hold) {
    var notice=state.detail&&state.detail.querySelector('.igdc-media-detail-notice'); if(!notice)return; notice.textContent=message; notice.setAttribute('data-open','true'); clearTimeout(notice.__maruTimer); notice.__maruTimer=setTimeout(function(){notice.removeAttribute('data-open');},hold||4200);
  }
  function requestTranslation() {
    var lang=String((document.documentElement&&document.documentElement.lang)||'ko').toLowerCase();
    if(lang==='zh-hant'||lang==='zh-tw'||lang==='zh-hk')lang='zht';
    lang=lang.split('-')[0];
    showNotice(PAID_PREPARING[lang]||PAID_PREPARING.en,5200);
  }

  function safeName(value) { return String(value||'maru-media').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').trim().slice(0,90)||'maru-media'; }
  function downloadBlob(blob, filename) { var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;(document.body||document.documentElement).appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1800); }
  function captureFrame() {
    var e=extraCopy(),video=currentVideo(); if(!video||!video.videoWidth||!video.videoHeight){showNotice(e.shotUnsupported);return;}
    try {
      var canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false}); canvas.width=video.videoWidth; canvas.height=video.videoHeight; ctx.drawImage(video,0,0,canvas.width,canvas.height);
      canvas.toBlob(function(blob){if(!blob){showNotice(e.shotUnsupported);return;}downloadBlob(blob,safeName(titleFor(state.card))+'_'+formatTime(video.currentTime).replace(/:/g,'-')+'.png');showNotice(e.shotSaved);},'image/png');
    } catch(_){showNotice(e.shotUnsupported);}
  }
  function bestRecorderMime() {
    if(!global.MediaRecorder)return''; var types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
    for(var i=0;i<types.length;i+=1){try{if(!MediaRecorder.isTypeSupported||MediaRecorder.isTypeSupported(types[i]))return types[i];}catch(_){}}
    return '';
  }
  function setRecordingBadge(open, elapsed, total) {
    var badge=state.detail&&state.detail.querySelector('.igdc-maru-recording'); if(!badge)return; badge.dataset.open=open?'true':'false'; var t=badge.querySelector('[data-record-time]'); if(t)t.textContent=open?(formatTime(elapsed)+' / '+formatTime(total)):'';
  }
  function cancelClipCapture() {
    state.clipCancelled=true; clearInterval(state.clipTimer); state.clipTimer=0; if(state.clipRecorder&&state.clipRecorder.state!=='inactive'){try{state.clipRecorder.stop();}catch(_){}} state.clipRecorder=null; setRecordingBadge(false,0,0);
  }
  function captureClip(seconds) {
    var e=extraCopy(),video=currentVideo(); if(state.clipRecorder&&state.clipRecorder.state!=='inactive'){showNotice(e.clipBusy);return;}
    var capture=video&&(video.captureStream||video.mozCaptureStream); if(!video||!capture||!global.MediaRecorder){showNotice(e.clipUnsupported);return;}
    var stream,mime=bestRecorderMime();
    try{stream=capture.call(video);}catch(_){showNotice(e.clipUnsupported);return;}
    if(!stream||!stream.getTracks||!stream.getTracks().length){showNotice(e.clipUnsupported);return;}
    var chunks=[],recorder;
    try{recorder=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:6000000}:undefined);}catch(_e){try{recorder=new MediaRecorder(stream);}catch(_x){showNotice(e.clipUnsupported);return;}}
    state.clipRecorder=recorder; state.clipCancelled=false; var startedAt=Date.now(),target=Math.max(1,Number(seconds)||20),wasPaused=video.paused;
    recorder.ondataavailable=function(ev){if(ev.data&&ev.data.size)chunks.push(ev.data);};
    recorder.onerror=function(){clearInterval(state.clipTimer);state.clipTimer=0;state.clipRecorder=null;setRecordingBadge(false,0,0);showNotice(e.clipUnsupported);};
    recorder.onstop=function(){clearInterval(state.clipTimer);state.clipTimer=0;state.clipRecorder=null;setRecordingBadge(false,0,0);if(state.clipCancelled){state.clipCancelled=false;return;}if(!chunks.length){showNotice(e.clipUnsupported);return;}var type=(chunks[0]&&chunks[0].type)||mime||'video/webm',ext=/mp4/i.test(type)?'mp4':'webm';downloadBlob(new Blob(chunks,{type:type}),safeName(titleFor(state.card))+'_'+target+'s_'+formatTime(video.currentTime).replace(/:/g,'-')+'.'+ext);showNotice(e.clipSaved);if(wasPaused){try{video.pause();}catch(_){}}};
    try{recorder.start(1000);}catch(_){state.clipRecorder=null;showNotice(e.clipUnsupported);return;}
    if(video.paused){var p=video.play();if(p&&p.catch)p.catch(function(){});} showNotice(e.clipStarted); setRecordingBadge(true,0,target);
    state.clipTimer=setInterval(function(){var elapsed=(Date.now()-startedAt)/1000;setRecordingBadge(true,Math.min(elapsed,target),target);if(elapsed>=target||video.ended){clearInterval(state.clipTimer);state.clipTimer=0;if(recorder.state!=='inactive'){try{recorder.stop();}catch(_){}}}},250);
  }
  function togglePip() {
    var e=extraCopy(),video=currentVideo(); if(!video){showNotice(e.pipUnsupported);return;}
    try {
      if(document.pictureInPictureElement&&document.exitPictureInPicture){document.exitPictureInPicture();return;}
      if(video.requestPictureInPicture){var p=video.requestPictureInPicture();if(p&&p.catch)p.catch(function(){showNotice(e.pipUnsupported);});return;}
    } catch(_){} showNotice(e.pipUnsupported);
  }

  function mobileViewportSize() {
    var vv = global.visualViewport;
    var w = Math.max(1, Math.round((vv && vv.width) || global.innerWidth || document.documentElement.clientWidth || 1));
    var h = Math.max(1, Math.round((vv && vv.height) || global.innerHeight || document.documentElement.clientHeight || 1));
    return { width:w, height:h };
  }
  function normalizePlayerGeometry() {
    if (!state.detail || !state.stage) return;
    var size = mobileViewportSize();
    state.detail.style.setProperty('--maru-vw', size.width + 'px');
    state.detail.style.setProperty('--maru-vh', size.height + 'px');
    var full = isPlayerFullscreen();
    if (full) {
      state.detail.style.removeProperty('--maru-inline-h');
      state.detail.style.width = size.width + 'px';
      state.detail.style.height = size.height + 'px';
      state.detail.style.minWidth = size.width + 'px';
      state.detail.style.minHeight = size.height + 'px';
      state.detail.style.maxWidth = size.width + 'px';
      state.detail.style.maxHeight = size.height + 'px';
    } else {
      state.detail.style.width = '100%';
      state.detail.style.minWidth = '0';
      state.detail.style.maxWidth = '100%';
      var rect = state.detail.getBoundingClientRect();
      var top = Math.max(0, Math.round(rect.top));
      var available = Math.max(320, size.height - top);
      state.detail.style.setProperty('--maru-inline-h', available + 'px');
      state.detail.style.height = available + 'px';
      state.detail.style.minHeight = Math.min(available,320) + 'px';
      state.detail.style.maxHeight = available + 'px';
    }
    state.stage.style.width = '100%';
    state.stage.style.height = '100%';
    state.stage.style.minWidth = '0';
    state.stage.style.minHeight = '0';
    var medias = state.stage.querySelectorAll('video,iframe');
    Array.prototype.forEach.call(medias,function(media){
      var node = media.parentElement;
      while (node && node !== state.stage) {
        node.style.setProperty('position','absolute','important');
        node.style.setProperty('inset','0','important');
        node.style.setProperty('width','100%','important');
        node.style.setProperty('height','100%','important');
        node.style.setProperty('min-width','100%','important');
        node.style.setProperty('min-height','100%','important');
        node.style.setProperty('max-width','none','important');
        node.style.setProperty('max-height','none','important');
        node.style.setProperty('margin','0','important');
        node = node.parentElement;
      }
      media.style.setProperty('position','absolute','important');
      media.style.setProperty('inset','0','important');
      media.style.setProperty('width','100%','important');
      media.style.setProperty('height','100%','important');
      media.style.setProperty('min-width','100%','important');
      media.style.setProperty('min-height','100%','important');
      media.style.setProperty('max-width','none','important');
      media.style.setProperty('max-height','none','important');
      media.style.setProperty('margin','0','important');
      if (media.tagName === 'VIDEO') media.style.setProperty('object-fit', state.fitMode === 'cover' ? 'cover' : 'contain', 'important');
    });
  }
  function requestPlaybackFromGesture() {
    state.playRequested = true;
    var video = currentVideo();
    if (!video) return;
    try {
      var result = video.play();
      if (result && result.then) result.then(function(){ state.playRequested=false; syncUi(); }).catch(function(){});
      else state.playRequested=false;
    } catch (_) {}
  }
  function restoreFullscreenAfterViewportChange() {
    if (!state.open || !state.detail) return;
    normalizePlayerGeometry();
    if(isMobileSession()&&state.mobileViewMode==='immersive')applyMobileImmersiveGeometry(true);
    requestPlaybackFromGesture();
    if (isPlayerFullscreen()) lockMobileLandscape();
    global.requestAnimationFrame(function(){ normalizePlayerGeometry(); if(isMobileSession()&&state.mobileViewMode==='immersive')applyMobileImmersiveGeometry(true); syncUi(); });
  }
  function scheduleViewportRepair() {
    if (!state.open) return;
    clearTimeout(state.orientationTimer);
    normalizePlayerGeometry();
    state.orientationTimer = setTimeout(restoreFullscreenAfterViewportChange, 90);
    setTimeout(restoreFullscreenAfterViewportChange, 320);
  }
  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function currentVideoFullscreen() {
    var video=currentVideo();
    try { return !!(state.nativeVideoFullscreen || (video && video.webkitDisplayingFullscreen)); } catch(_) { return !!state.nativeVideoFullscreen; }
  }
  function lockMobileLandscape() {
    // Follow the user's current mobile orientation; never force landscape.
    state.orientationLocked=false;
  }
  function unlockMobileOrientation() { state.orientationLocked=false; }
  function fallbackFullscreenActive() { return !!((isMobileSession() && state.mobileViewMode==='immersive') || state.mobileImmersiveActive || (state.detail && state.detail.classList.contains('igdc-mobile-fullscreen-fallback'))); }
  function isPlayerFullscreen() {
    if(isMobileSession()) return state.mobileViewMode==='immersive';
    return !!fullscreenElement() || currentVideoFullscreen() || fallbackFullscreenActive();
  }
  function hideChromeNow() {
    if(!state.detail)return;
    clearTimeout(state.chromeTimer);
    state.detail.classList.remove('igdc-chrome-visible');
  }
  function markFullscreenUi(on) {
    if(!state.detail)return;
    state.detail.classList.toggle('igdc-player-fullscreen',!!on);
    if(on){
      document.body.style.overflow='hidden';
      normalizePlayerGeometry();
      if(isMobileSession()) hideChromeNow(); else showChrome(2600);
    }else{
      if(state.fullscreenBodyOverflow!==null)document.body.style.overflow=state.fullscreenBodyOverflow;
      unlockMobileOrientation();
      normalizePlayerGeometry();
      if(isMobileSession()) showChrome(4800); else hideChromeNow();
    }
    syncUi();
  }
  function applyMobileImmersiveGeometry(on) {
    if(!state.detail)return;
    var props=['position','inset','left','top','right','bottom','z-index','width','height','min-width','min-height','max-width','max-height','margin','overflow','background'];
    if(!on){
      props.forEach(function(prop){state.detail.style.removeProperty(prop);});
      return;
    }
    var size=mobileViewportSize();
    state.detail.style.setProperty('position','fixed','important');
    state.detail.style.setProperty('inset','0','important');
    state.detail.style.setProperty('left','0','important');
    state.detail.style.setProperty('top','0','important');
    state.detail.style.setProperty('right','0','important');
    state.detail.style.setProperty('bottom','0','important');
    state.detail.style.setProperty('z-index','2147483000','important');
    state.detail.style.setProperty('width',size.width+'px','important');
    state.detail.style.setProperty('height',size.height+'px','important');
    state.detail.style.setProperty('min-width',size.width+'px','important');
    state.detail.style.setProperty('min-height',size.height+'px','important');
    state.detail.style.setProperty('max-width',size.width+'px','important');
    state.detail.style.setProperty('max-height',size.height+'px','important');
    state.detail.style.setProperty('margin','0','important');
    state.detail.style.setProperty('overflow','hidden','important');
    state.detail.style.setProperty('background','#000','important');
  }
  function setMobileViewMode(mode) {
    if(!state.detail || !isMobileSession()) return;
    mode = mode === 'immersive' ? 'immersive' : 'inline';
    state.mobileViewMode = mode;
    state.mobileImmersiveActive = mode === 'immersive';
    state.mobileFullscreenIntent = mode === 'immersive';
    state.detail.dataset.mobileView = mode;
    state.detail.classList.toggle('igdc-mobile-fullscreen-fallback', mode === 'immersive');
    state.detail.classList.toggle('igdc-mobile-inline-player', mode === 'inline');
    if(mode === 'immersive') {
      applyMobileImmersiveGeometry(true);
      markFullscreenUi(true);
      normalizePlayerGeometry();
      hideChromeNow();
    } else {
      applyMobileImmersiveGeometry(false);
      markFullscreenUi(false);
      normalizePlayerGeometry();
      showChrome(4800);
    }
    requestPlaybackFromGesture();
    global.requestAnimationFrame(function(){
      if(!state.detail)return;
      if(state.mobileViewMode==='immersive')applyMobileImmersiveGeometry(true);
      normalizePlayerGeometry();
      syncUi();
    });
  }
  function activateFallbackFullscreen() {
    if(!state.detail)return;
    if(isMobileSession()) {
      setMobileViewMode('immersive');
      return;
    }
    state.mobileImmersiveActive=true;
    state.mobileFullscreenIntent=true;
    state.detail.classList.add('igdc-mobile-fullscreen-fallback');
    applyMobileImmersiveGeometry(true);
    markFullscreenUi(true);
    normalizePlayerGeometry();
  }
  function leaveFullscreen() {
    if(isMobileSession()) {
      state.justExitedFullscreenAt=Date.now();
      state.orientationChangingUntil=0;
      setMobileViewMode('inline');
      return;
    }
    state.mobileFullscreenIntent=false;
    state.mobileImmersiveActive=false;
    state.justExitedFullscreenAt=Date.now();
    state.orientationChangingUntil=0;
    try {
      if(state.detail)state.detail.classList.remove('igdc-mobile-fullscreen-fallback');
      state.nativeVideoFullscreen=false;
      var exit=document.exitFullscreen||document.webkitExitFullscreen;
      if(fullscreenElement()&&exit){var r=exit.call(document);if(r&&r.catch)r.catch(function(){});}
    } catch(_) {}
    markFullscreenUi(false);
    global.requestAnimationFrame(function(){normalizePlayerGeometry();requestPlaybackFromGesture();});
  }
  function enterPlayerFullscreen() {
    if(!state.detail)return;
    if(isMobileSession()) {
      // Mobile fullscreen is an IGDC-controlled immersive viewport state. It is
      // intentionally independent from the browser Fullscreen API so Android
      // and iOS use the same transition model and rotation never drops to list.
      setMobileViewMode('immersive');
      return;
    }
    normalizePlayerGeometry();
    if(isPlayerFullscreen()){markFullscreenUi(true);return;}
    var target=state.detail;
    try {
      var request=target.requestFullscreen||target.webkitRequestFullscreen;
      if(request){
        var result;
        try { result=request.call(target,{navigationUI:'hide'}); } catch(_arg) { result=request.call(target); }
        if(result&&result.then){
          result.then(function(){
            if(state.detail!==target)return;
            target.classList.remove('igdc-mobile-fullscreen-fallback');
            markFullscreenUi(true);normalizePlayerGeometry();
          }).catch(function(){
            if(state.detail!==target||fullscreenElement())return;
            activateFallbackFullscreen();
          });
        }else{
          markFullscreenUi(true);
          global.setTimeout(function(){
            if(state.detail===target&&!fullscreenElement()&&!currentVideoFullscreen())activateFallbackFullscreen();
          },180);
        }
        return;
      }
      activateFallbackFullscreen();
    } catch(_){activateFallbackFullscreen();}
  }
  function toggleFullscreen(){
    if(isMobileSession()){
      if(state.mobileViewMode==='immersive')setMobileViewMode('inline');
      else setMobileViewMode('immersive');
      return;
    }
    if(isPlayerFullscreen())leaveFullscreen();else enterPlayerFullscreen();
  }

  function showChrome(hold) {
    if(!state.detail)return; clearTimeout(state.chromeTimer); state.detail.classList.add('igdc-chrome-visible');
    var video=currentVideo(); if(!video||video.paused)return;
    state.chromeTimer=setTimeout(function(){if(state.detail&&currentVideo()&&!currentVideo().paused&&!state.panel)state.detail.classList.remove('igdc-chrome-visible');},hold||2600);
  }
  function toggleChrome() { if(!state.detail)return; if(state.detail.classList.contains('igdc-chrome-visible')&&currentVideo()&&!currentVideo().paused){hideChromeNow();}else showChrome(2600); }

  function updateTimeUi() {
    if(!state.detail)return; var video=currentVideo(),seek=state.detail.querySelector('[data-media-seek]'),now=state.detail.querySelector('[data-media-time-now]'),dur=state.detail.querySelector('[data-media-time-duration]');
    if(!video){if(seek){seek.value=0;seek.disabled=true;}if(now)now.textContent='00:00';if(dur)dur.textContent='00:00';return;}
    var duration=Number.isFinite(video.duration)?video.duration:0,current=Number.isFinite(video.currentTime)?video.currentTime:0; if(seek){seek.disabled=!duration;seek.value=duration?Math.round(current/duration*1000):0;}if(now)now.textContent=formatTime(current);if(dur)dur.textContent=formatTime(duration);
  }
  function syncUi() {
    if(!state.detail)return; var c=copy(),e=extraCopy(),video=currentVideo(),hasVideo=!!video;
    var backBtn=state.detail.querySelector('[data-media-action="back"]');if(backBtn){var backText=(isMobileSession()&&state.mobileViewMode==='immersive')?c.exitFullscreen:backLabel();setButtonGraphic(backBtn,'back',backText);setControlLabel(backBtn,backText);}
    var playButtons=state.detail.querySelectorAll('[data-media-action="play"]');Array.prototype.forEach.call(playButtons,function(play){play.disabled=!hasVideo;setButtonGraphic(play,hasVideo&&!video.paused?'pause':'play','');setControlLabel(play,hasVideo&&!video.paused?c.pause:c.play);});
    var prev=state.detail.querySelector('[data-media-action="previous"]');if(prev)prev.disabled=!adjacentCard(-1);var next=state.detail.querySelector('[data-media-action="next"]');if(next)next.disabled=!adjacentCard(1);
    var cc=state.detail.querySelector('[data-media-action="captions"]');if(cc){cc.disabled=!hasVideo||!hasCaptions(video);cc.dataset.active=captionsEnabled()?'true':'false';setControlLabel(cc,captionsEnabled()?c.captionsOff:c.captionsOn);}
    var speed=state.detail.querySelector('[data-media-action="speed"]');if(speed){speed.disabled=!hasVideo;speed.textContent=hasVideo?String(video.playbackRate||1).replace(/\.0$/,'')+'×':'1×';setControlLabel(speed,e.speed);}
    var mute=state.detail.querySelector('[data-media-action="mute"]');if(mute){mute.disabled=!hasVideo;setButtonGraphic(mute,hasVideo&&(video.muted||video.volume===0)?'mute':'volume','');setControlLabel(mute,hasVideo&&(video.muted||video.volume===0)?e.unmute:e.mute);}
    var loop=state.detail.querySelector('[data-media-action="loop"]');if(loop){loop.disabled=!hasVideo;loop.dataset.active=hasVideo&&video.loop?'true':'false';setControlLabel(loop,hasVideo&&video.loop?e.loopOff:e.loopOn);}
    var shot=state.detail.querySelector('[data-media-action="shot"]');if(shot)shot.disabled=!hasVideo;var fit=state.detail.querySelector('[data-media-action="fit"]');if(fit){fit.disabled=!hasVideo;fit.textContent=state.fitMode==='cover'?e.fill:e.fit;fit.dataset.active=state.fitMode==='cover'?'true':'false';}
    var vol=state.detail.querySelector('[data-media-volume]');if(vol){vol.disabled=!hasVideo;vol.value=hasVideo?(video.muted?0:Math.round(video.volume*100)):100;}
    var fsButtons=state.detail.querySelectorAll('[data-media-action="fullscreen"]');Array.prototype.forEach.call(fsButtons,function(btn){setButtonGraphic(btn,isPlayerFullscreen()?'exit':'fullscreen','');setControlLabel(btn,isPlayerFullscreen()?c.exitFullscreen:c.fullscreen);});
    updateTimeUi(); renderTrackPanel();
  }
  function bindVideo(video) {
    if(!video||video.__igdcMaruWebPlayerBound)return; video.__igdcMaruWebPlayerBound=true; try{video.controls=false;video.playsInline=true;video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.setAttribute('disablepictureinpicture','false');}catch(_){}
    function applyResumeOnce(){
      if(!state.card||video.__igdcResumeApplied)return; video.__igdcResumeApplied=true;
      var resumeAt=readResumePosition(state.card); if(resumeAt<=0)return;
      try{if(Number.isFinite(video.duration)&&video.duration>0)resumeAt=Math.min(resumeAt,Math.max(0,video.duration-6));video.currentTime=resumeAt;}catch(_){}
    }
    ['play','pause','ended','loadedmetadata','durationchange','ratechange','volumechange','emptied'].forEach(function(name){video.addEventListener(name,function(){
      if(name==='loadedmetadata')applyResumeOnce();
      if(name==='pause')saveResumePosition(state.card,video.currentTime,video.duration,true,false);
      if(name==='ended')saveResumePosition(state.card,video.currentTime,video.duration,true,true);
      syncUi();if(name==='play'){if(isMobileSession())hideChromeNow();else showChrome(2600);}else if(name==='pause'||name==='ended')showChrome();
    });});
    video.addEventListener('timeupdate',function(){updateTimeUi();saveResumePosition(state.card,video.currentTime,video.duration,false,false);}); video.addEventListener('error',function(){notifySourceFailure(state.card,'mounted_video_source_error');},{once:true});
    // iOS must stay inline inside the IGDC immersive shell. Native WebKit video fullscreen is not used.
    video.addEventListener('webkitbeginfullscreen',function(){try{if(isMobileSession()&&typeof video.webkitExitFullscreen==='function')video.webkitExitFullscreen();}catch(_){}state.nativeVideoFullscreen=false;});
    video.addEventListener('webkitendfullscreen',function(){state.nativeVideoFullscreen=false;global.requestAnimationFrame(normalizePlayerGeometry);});
    if(video.readyState>=1)applyResumeOnce();
    try { var tracker=global.MaruRevenueTracker;if(tracker&&typeof tracker.bindMedia==='function')tracker.bindMedia(video,{id:contentIdFor(state.card),contentId:contentIdFor(state.card),title:titleFor(state.card),mediaType:'video',url:sourceFor(state.card)},{service:'mediahub-playback',pageType:'media',revenueLine:'media_watchtime'}); } catch(_){}
    normalizePlayerGeometry();
    if(state.playRequested)requestPlaybackFromGesture();
    syncUi();
  }
  function observeStage() {
    if(state.mutationObserver)state.mutationObserver.disconnect(); if(!state.stage||!global.MutationObserver)return;
    state.mutationObserver=new MutationObserver(function(){bindVideo(currentVideo());syncUi();}); state.mutationObserver.observe(state.stage,{childList:true,subtree:true}); bindVideo(currentVideo()); syncUi();
  }

  function openPanel(name) {
    if(!state.detail)return; var panel=state.detail.querySelector('.igdc-maru-panel'); if(!panel)return;
    if(state.panel===name&&!panel.hidden){state.panel='';panel.hidden=true;showChrome(2200);return;}
    state.panel=name||'tools';panel.hidden=false;panel.dataset.panel=state.panel;renderPanel();showChrome(10000);
  }
  function renderTrackPanel() {
    if(!state.detail||state.panel!=='subtitle')return; renderPanel();
  }
  function renderPanel() {
    if(!state.detail)return; var panel=state.detail.querySelector('.igdc-maru-panel');if(!panel||panel.hidden)return; var c=copy(),e=extraCopy(),name=state.panel||'tools';panel.innerHTML='';
    panel.appendChild(create('div','igdc-maru-panel-title',name==='view'?e.view:name==='playback'?e.playback:name==='subtitle'?e.subtitle:e.tools));
    function section(label){var s=create('div','igdc-maru-panel-section');s.appendChild(create('div','igdc-maru-panel-label',label));panel.appendChild(s);return s;}
    function grid(sec,items){var g=create('div','igdc-maru-panel-grid');items.forEach(function(it){var b=create('button','',it.label);b.type='button';if(it.action)b.dataset.mediaAction=it.action;if(it.value!=null)b.dataset.mediaValue=String(it.value);g.appendChild(b);});sec.appendChild(g);}
    if(name==='view'){
      var s1=section(e.view);grid(s1,[{label:e.fit,action:'fit-contain'},{label:e.fill,action:'fit-cover'},{label:e.pip,action:'pip'},{label:isPlayerFullscreen()?c.exitFullscreen:c.fullscreen,action:'fullscreen'}]);
    } else if(name==='playback'){
      var s2=section(e.playback);grid(s2,[{label:c.previous,action:'previous'},{label:c.next,action:'next'},{label:e.back10,action:'seek-back'},{label:e.forward10,action:'seek-forward'},{label:e.loopOn,action:'loop'},{label:e.speed,action:'speed'}]);
    } else if(name==='subtitle'){
      var s3=section(e.subtitle);grid(s3,[{label:captionsEnabled()?c.captionsOff:c.captionsOn,action:'captions'},{label:c.translate,action:'translate'}]);
      var tracks=section(e.subtitleTrack),list=create('div','igdc-maru-track-list'),select=currentCaptionSelect(),video=currentVideo();
      if(select&&select.options&&select.options.length){Array.prototype.forEach.call(select.options,function(opt){if(opt.value==='off')return;var b=create('button','',opt.textContent||opt.label||opt.value);b.type='button';b.dataset.captionValue=opt.value;b.dataset.active=select.value===opt.value?'true':'false';list.appendChild(b);});}
      else if(video&&video.textTracks&&video.textTracks.length){for(var i=0;i<video.textTracks.length;i+=1){var tr=video.textTracks[i],bt=create('button','',tr.label||tr.language||('Track '+(i+1)));bt.type='button';bt.dataset.captionIndex=String(i);bt.dataset.active=tr.mode==='showing'?'true':'false';list.appendChild(bt);}}
      if(!list.children.length)list.appendChild(create('div','igdc-maru-panel-hint',e.noSubtitleTracks));tracks.appendChild(list);
    } else {
      if(isMobilePlaybackDevice()){
        var mobileMedia=section(e.subtitle);grid(mobileMedia,[{label:captionsEnabled()?c.captionsOff:c.captionsOn,action:'captions'},{label:e.subtitleTrack,action:'subtitle-panel'},{label:c.translate,action:'translate'},{label:e.audio,action:'audio'}]);
        var mobilePlayback=section(e.playback);grid(mobilePlayback,[{label:e.speed,action:'speed'},{label:e.loopOn,action:'loop'},{label:c.previous,action:'previous'},{label:c.next,action:'next'}]);
        var mobileView=section(e.view);grid(mobileView,[{label:e.fit,action:'fit-contain'},{label:e.fill,action:'fit-cover'},{label:e.pip,action:'pip'},{label:isPlayerFullscreen()?c.exitFullscreen:c.fullscreen,action:'fullscreen'}]);
        var mobileCapture=section(e.clipTitle);grid(mobileCapture,[{label:e.clip20,action:'clip',value:20},{label:e.clip30,action:'clip',value:30},{label:e.clip60,action:'clip',value:60},{label:e.clip120,action:'clip',value:120}]);mobileCapture.appendChild(create('div','igdc-maru-panel-hint',e.captureHint));
      }else{
        var shotSec=section(e.tools);grid(shotSec,[{label:e.shot,action:'shot'},{label:e.pip,action:'pip'}]);
        var clipSec=section(e.clipTitle);grid(clipSec,[{label:e.clip20,action:'clip',value:20},{label:e.clip30,action:'clip',value:30},{label:e.clip60,action:'clip',value:60},{label:e.clip120,action:'clip',value:120}]);clipSec.appendChild(create('div','igdc-maru-panel-hint',e.captureHint));
      }
    }
  }

  function disposeStage(){saveCurrentProgress(true);clearInterval(state.youtubePollTimer);state.youtubePollTimer=0;try{if(state.stage&&global.IGDCMediaHubOTTInline&&typeof global.IGDCMediaHubOTTInline.dispose==='function')global.IGDCMediaHubOTTInline.dispose(state.stage);}catch(_){}if(state.mutationObserver){state.mutationObserver.disconnect();state.mutationObserver=null;}state.youtubeFrame=null;}
  function close(options){options=options||{};if(!state.open)return;saveCurrentProgress(true);if(!options.fromHistory&&state.historyToken&&global.history&&global.history.state&&global.history.state.igdcMediaToken===state.historyToken){global.history.back();return;}cancelClipCapture();if(isPlayerFullscreen())leaveFullscreen();disposeStage();if(state.detail)state.detail.remove();restoreList();var y=state.scrollY;state.open=false;state.detail=null;state.stage=null;state.card=null;state.historyToken='';state.lastCaptionValue='';state.panel='';state.playRequested=false;state.mobileFullscreenIntent=false;state.mobileImmersiveActive=false;state.mobileSession=false;state.mobileViewMode='list';state.justExitedFullscreenAt=0;state.orientationChangingUntil=0;state.nativeVideoFullscreen=false;state.youtubeFrame=null;state.youtubeCurrentTime=0;state.youtubeDuration=0;state.youtubeEnded=false;unlockMobileOrientation();clearTimeout(state.chromeTimer);clearTimeout(state.orientationTimer);if(state.fullscreenBodyOverflow!==null){document.body.style.overflow=state.fullscreenBodyOverflow;state.fullscreenBodyOverflow=null;}global.requestAnimationFrame(function(){global.scrollTo(0,y);frameHeight();});}
  function switchCard(card){if(!card||!state.open||card===state.card)return;saveCurrentProgress(true);cancelClipCapture();disposeStage();state.youtubeFrame=null;state.youtubeCurrentTime=0;state.youtubeDuration=0;state.youtubeEnded=false;state.card=card;state.lastCaptionValue='';state.playRequested=isMobileSession();state.detail.setAttribute('aria-label',titleFor(card));state.stage.textContent='';appendPlayer(state.stage,card);observeStage();normalizePlayerGeometry();requestPlaybackFromGesture();global.scrollTo(0,0);syncUi();showChrome(3200);}
  function move(direction){var card=adjacentCard(direction);if(card)switchCard(card);}

  function buildPlayerShell(card) {
    var c=copy(),e=extraCopy(),detail=create('section','igdc-player-active');detail.id='igdc-media-detail-view';detail.setAttribute('aria-label',titleFor(card));detail.dataset.fit=state.fitMode;
    var top=create('header','igdc-maru-topbar');var back=iconButton('back','back',backLabel(),backLabel());back.classList.add('igdc-maru-back-btn');var brand=create('div','igdc-maru-brand',e.brand),menu=create('nav','igdc-maru-menu');
    menu.appendChild(menuButton('view',e.view));menu.appendChild(menuButton('playback',e.playback));menu.appendChild(menuButton('subtitle',e.subtitle));menu.appendChild(menuButton('tools',e.tools));
    var rec=create('div','igdc-maru-recording');rec.innerHTML='<span class="igdc-maru-record-dot"></span><span data-record-time></span>';var fsTop=iconButton('fullscreen','fullscreen',c.fullscreen,'');top.appendChild(back);top.appendChild(brand);top.appendChild(rec);top.appendChild(create('span','igdc-maru-spacer'));top.appendChild(fsTop);
    var panel=create('aside','igdc-maru-panel');panel.hidden=true;var stage=create('div','igdc-media-detail-stage');stage.tabIndex=-1;
    var center=create('div','igdc-transport-overlay');center.appendChild(iconButton('previous','prev',c.previous,''));center.appendChild(iconButton('seek-back','',e.back10,'−10'));center.appendChild(iconButton('play','play',c.play,''));center.appendChild(iconButton('seek-forward','',e.forward10,'+10'));center.appendChild(iconButton('next','next',c.next,''));
    var bar=create('div','igdc-maru-controlbar'),progress=create('div','igdc-maru-progress-row'),now=create('span','igdc-maru-time','00:00'),seek=document.createElement('input'),dur=create('span','igdc-maru-time','00:00');seek.type='range';seek.min='0';seek.max='1000';seek.value='0';seek.className='igdc-maru-seek';seek.dataset.mediaSeek='1';now.dataset.mediaTimeNow='1';dur.dataset.mediaTimeDuration='1';progress.appendChild(now);progress.appendChild(seek);progress.appendChild(dur);
    var row=create('div','igdc-maru-controls-row');row.appendChild(create('span','igdc-maru-spacer'));
    row.appendChild(iconButton('captions','',c.captionsOn,'CC'));row.appendChild(iconButton('subtitle-panel','',e.subtitleTrack,'Sub'));row.appendChild(iconButton('audio','',e.audio,'Audio'));row.appendChild(iconButton('speed','',e.speed,'1×'));row.appendChild(mobileInline(iconButton('mute','volume',e.mute,'')));
    var volume=create('label','igdc-maru-volume'),vr=document.createElement('input');vr.type='range';vr.min='0';vr.max='100';vr.value='100';vr.dataset.mediaVolume='1';volume.appendChild(vr);row.appendChild(volume);
    row.appendChild(iconButton('loop','loop',e.loopOn,''));row.appendChild(mobileInline(iconButton('shot','camera',e.shot,'')));row.appendChild(mobileInline(iconButton('tools-panel','gear',e.settings,'')));row.appendChild(mobileInline(iconButton('fullscreen','fullscreen',c.fullscreen,'')));
    bar.appendChild(progress);if(!isMobileUiMode())bar.appendChild(center);bar.appendChild(row);var notice=create('p','igdc-media-detail-notice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');detail.appendChild(top);detail.appendChild(panel);detail.appendChild(stage);if(isMobileUiMode())detail.appendChild(center);detail.appendChild(bar);detail.appendChild(notice);return{detail:detail,stage:stage};
  }

  function handleAction(action,value) {
    if(action==='back'){if(isMobileSession()&&state.mobileViewMode==='immersive')setMobileViewMode('inline');else close();}else if(action==='fullscreen')toggleFullscreen();else if(action==='previous')move(-1);else if(action==='next')move(1);else if(action==='play')togglePlay();else if(action==='seek-back')seekBy(-10);else if(action==='seek-forward')seekBy(10);else if(action==='captions')toggleCaptions();else if(action==='subtitle-panel')openPanel('subtitle');else if(action==='audio'){var video=currentVideo(),tracks=video&&video.audioTracks;if(tracks&&tracks.length>1){var active=0;for(var i=0;i<tracks.length;i+=1)if(tracks[i].enabled)active=i;var next=(active+1)%tracks.length;for(var j=0;j<tracks.length;j+=1)tracks[j].enabled=j===next;showNotice((tracks[next].label||tracks[next].language||extraCopy().audioDefault));}else showNotice(extraCopy().noAudioTracks);}else if(action==='speed')cycleSpeed();else if(action==='mute')toggleMute();else if(action==='loop')toggleLoop();else if(action==='fit')setFit(state.fitMode==='cover'?'contain':'cover');else if(action==='fit-contain')setFit('contain');else if(action==='fit-cover')setFit('cover');else if(action==='shot')captureFrame();else if(action==='clip')captureClip(Number(value)||20);else if(action==='pip')togglePip();else if(action==='tools-panel')openPanel('tools');else if(action==='translate')requestTranslation();
    syncUi();
  }

  function open(card,options){options=options||{};if(!card)return;if(state.open){switchCard(card);return;}injectStyle();var mobileMode=isMobilePlaybackDevice();if(!mobileMode)attemptNativePlayer(card);state.open=true;state.mobileSession=mobileMode;state.mobileViewMode=mobileMode?'inline':'list';state.card=card;state.scrollY=global.scrollY||global.pageYOffset||0;state.panel='';state.playRequested=!!options.autoPlay||mobileMode;state.mobileFullscreenIntent=false;state.mobileImmersiveActive=false;if(state.fullscreenBodyOverflow===null)state.fullscreenBodyOverflow=document.body.style.overflow||'';hideList(card);var shell=buildPlayerShell(card);state.detail=shell.detail;state.stage=shell.stage;document.body.appendChild(shell.detail);if(mobileMode)setMobileViewMode('immersive');else normalizePlayerGeometry();appendPlayer(state.stage,card);observeStage();normalizePlayerGeometry();if(mobileMode&&state.mobileViewMode==='immersive')applyMobileImmersiveGeometry(true);
    state.detail.addEventListener('click',function(event){var p=event.target.closest&&event.target.closest('[data-media-panel]');if(p){openPanel(p.dataset.mediaPanel);return;}var cap=event.target.closest&&event.target.closest('[data-caption-value],[data-caption-index]');if(cap){selectCaption(cap.dataset.captionValue!=null?cap.dataset.captionValue:cap.dataset.captionIndex);return;}var a=event.target.closest&&event.target.closest('[data-media-action]');if(a){handleAction(a.dataset.mediaAction,a.dataset.mediaValue);showChrome(2600);return;}if(event.target===state.stage||event.target===currentVideo()||(event.target.closest&&event.target.closest('.igdc-media-detail-stage'))){if(isMobileSession())toggleChrome();else togglePlay();}});
    var seek=state.detail.querySelector('[data-media-seek]');seek.addEventListener('input',function(){var video=currentVideo();if(video&&Number.isFinite(video.duration)){video.currentTime=video.duration*(Number(seek.value)||0)/1000;updateTimeUi();showChrome(2400);}});
    var vol=state.detail.querySelector('[data-media-volume]');vol.addEventListener('input',function(){setVolume((Number(vol.value)||0)/100);});
    state.detail.addEventListener('pointermove',function(ev){if(isMobileSession())return;var y=Number(ev.clientY);if(y<100||y>global.innerHeight-170)showChrome(2200);});
    if(options.autoPlay===true||isMobileSession())requestPlaybackFromGesture();
    if(!mobileMode&&options.autoFullscreen===true)enterPlayerFullscreen();
    if(!options.fromHistory&&global.history&&global.history.pushState){state.historyToken='media-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);try{global.history.pushState({igdcMedia:true,igdcMediaToken:state.historyToken},'',global.location.href);}catch(_){state.historyToken='';}}
    global.requestAnimationFrame(function(){global.scrollTo(0,0);state.stage.focus({preventScroll:true});frameHeight();syncUi();normalizePlayerGeometry();if(isMobileSession())hideChromeNow();else showChrome(2200);});
  }

  document.addEventListener('click',function(event){var card=isMediaCard(event.target);if(!card)return;if(state.open){event.preventDefault();event.stopImmediatePropagation();return;}if(card.getAttribute('data-placeholder')==='true')return;event.preventDefault();event.stopImmediatePropagation();open(card,{autoFullscreen:isMobilePlaybackDevice(),autoPlay:true});},true);
  (function bindMobileTapPlayback(){var touchCard=null,startX=0,startY=0,startAt=0,moved=false;function pointOf(event,changed){var list=changed?event.changedTouches:event.touches;return list&&list.length?list[0]:null;}document.addEventListener('touchstart',function(event){var card=isMediaCard(event.target),p=pointOf(event,false);touchCard=(card&&card.getAttribute('data-placeholder')!=='true')?card:null;moved=false;startAt=Date.now();if(p){startX=p.clientX;startY=p.clientY;}},{passive:true,capture:true});document.addEventListener('touchmove',function(event){if(!touchCard||moved)return;var p=pointOf(event,false);if(!p)return;if(Math.abs(p.clientX-startX)>12||Math.abs(p.clientY-startY)>12)moved=true;},{passive:true,capture:true});document.addEventListener('touchend',function(event){var card=touchCard,p=pointOf(event,true),elapsed=Date.now()-startAt;touchCard=null;if(!card||moved||elapsed>700)return;if(p&&(Math.abs(p.clientX-startX)>12||Math.abs(p.clientY-startY)>12))return;if(state.open)return;if(event.cancelable)event.preventDefault();event.stopImmediatePropagation();open(card,{autoFullscreen:true,autoPlay:true});},{passive:false,capture:true});document.addEventListener('touchcancel',function(){touchCard=null;moved=false;},{passive:true,capture:true});})();
  document.addEventListener('keydown',function(event){if(!state.open)return;var tag=event.target&&event.target.tagName;if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;if(event.key==='Escape'){if(state.panel){state.panel='';var p=state.detail&&state.detail.querySelector('.igdc-maru-panel');if(p)p.hidden=true;showChrome(2000);}else if(isPlayerFullscreen()){event.preventDefault();leaveFullscreen();}else close();}else if(event.key===' '||event.code==='Space'){event.preventDefault();togglePlay();}else if(event.key==='ArrowLeft'){event.preventDefault();seekBy(-10);}else if(event.key==='ArrowRight'){event.preventDefault();seekBy(10);}else if(event.key==='ArrowUp'){event.preventDefault();var v=currentVideo();if(v)setVolume(Math.min(1,(v.muted?0:v.volume)+.05));}else if(event.key==='ArrowDown'){event.preventDefault();var v2=currentVideo();if(v2)setVolume(Math.max(0,(v2.muted?0:v2.volume)-.05));}else if(event.key.toLowerCase()==='f'){event.preventDefault();toggleFullscreen();}else if(event.key.toLowerCase()==='m'){event.preventDefault();toggleMute();}else if(event.key.toLowerCase()==='c'){event.preventDefault();toggleCaptions();}},true);
  global.addEventListener('popstate',function(){if(!state.open)return;if((isMobileSession()&&state.mobileViewMode==='immersive')||(!isMobileSession()&&isPlayerFullscreen())){leaveFullscreen();if(global.history&&global.history.pushState){state.historyToken='media-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);try{global.history.pushState({igdcMedia:true,igdcMediaToken:state.historyToken},'',global.location.href);}catch(_){}}normalizePlayerGeometry();hideChromeNow();return;}close({fromHistory:true});});
  function fullscreenChanged(){
    if(!state.detail)return;
    // Mobile never uses browser/native fullscreen as a state source. Its view
    // mode is controlled only by the IGDC immersive <-> inline state machine.
    if(isMobileSession()){
      if(state.mobileViewMode==='immersive'){
        applyMobileImmersiveGeometry(true);
        state.detail.classList.add('igdc-mobile-fullscreen-fallback');
        markFullscreenUi(true);
      }else{
        state.detail.classList.remove('igdc-mobile-fullscreen-fallback');
        applyMobileImmersiveGeometry(false);
        markFullscreenUi(false);
      }
      return;
    }
    if(fullscreenElement()||currentVideoFullscreen()||fallbackFullscreenActive()){
      if(fullscreenElement()&&state.detail)state.detail.classList.remove('igdc-mobile-fullscreen-fallback');
      markFullscreenUi(true);normalizePlayerGeometry();lockMobileLandscape();return;
    }
    state.mobileFullscreenIntent=false;
    markFullscreenUi(false);
    requestPlaybackFromGesture();
    global.requestAnimationFrame(normalizePlayerGeometry);
  }
  function orientationViewportRepair(){
    if(isMobileSession()&&state.mobileViewMode==='immersive')state.orientationChangingUntil=Date.now()+1400;
    scheduleViewportRepair();
  }
  global.addEventListener('message',function(event){
    if(!state.open||!state.youtubeFrame||event.source!==state.youtubeFrame.contentWindow)return;
    if(!/youtube(?:-nocookie)?\.com$/i.test(String(event.origin||'').replace(/^https?:\/\//i,'')))return;
    var data=event.data;try{if(typeof data==='string')data=JSON.parse(data);}catch(_){return;}
    if(!data||typeof data!=='object')return;
    var info=data.info||{};
    if(Number.isFinite(Number(info.currentTime)))state.youtubeCurrentTime=Number(info.currentTime);
    if(Number.isFinite(Number(info.duration)))state.youtubeDuration=Number(info.duration);
    if(Number(info.playerState)===0||Number(data.info&&data.info.playerState)===0)state.youtubeEnded=true;
    saveResumePosition(state.card,state.youtubeCurrentTime,state.youtubeDuration,false,state.youtubeEnded);
  },false);
  global.addEventListener('pagehide',function(){saveCurrentProgress(true);},{capture:true});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')saveCurrentProgress(true);});

  document.addEventListener('fullscreenchange',fullscreenChanged);document.addEventListener('webkitfullscreenchange',fullscreenChanged);
  global.addEventListener('resize',scheduleViewportRepair,{passive:true});
  global.addEventListener('orientationchange',orientationViewportRepair,{passive:true});
  if(global.visualViewport)global.visualViewport.addEventListener('resize',scheduleViewportRepair,{passive:true});
  try{if(global.screen&&global.screen.orientation&&global.screen.orientation.addEventListener)global.screen.orientation.addEventListener('change',orientationViewportRepair,{passive:true});}catch(_){}

  global.__IGDC_MEDIAHUB_PLAYER_VERSION__='3.6.0-mobile-single-entry-three-state-immersive-inline-list-resume-5s';
  global.IGDCMediaHubPlayback={open:open,close:close,previous:function(){move(-1);},next:function(){move(1);},captureFrame:captureFrame,captureClip:captureClip,VERSION:'3.6.0-mobile-single-entry-three-state-immersive-inline-list-resume-5s'};
})(window, document);
