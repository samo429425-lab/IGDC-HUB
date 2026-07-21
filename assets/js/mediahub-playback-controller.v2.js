/*
 * IGDC / MARU MediaHub playback controller v2.3
 * Device-aware inline player shell with safe native-app handoff hooks.
 *
 * Preserves the original Media Hub document, scroll restoration, OTT gate,
 * fullscreen flow, and existing card renderer. Adds previous/next navigation,
 * play/pause, subtitle on/off, browser-history back restoration, and a paid
 * subtitle-translation entry point that remains disabled until PG execution
 * and a secure entitlement-aware translation bridge are both live.
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
    nativeAttempted: false
  };

  var COPY = {
    ko: {back:'← 목록으로 돌아가기',previous:'이전',play:'재생',pause:'일시정지',next:'다음',captionsOn:'자막 켜기',captionsOff:'자막 끄기',translate:'자막 번역',fullscreen:'전체 화면',exitFullscreen:'전체 화면 나가기',preparing:'콘텐츠를 준비 중입니다.',unavailable:'이 콘텐츠의 재생 소스가 아직 연결되지 않았습니다.',translationPending:'자막 번역은 유료 서비스입니다. PG 승인과 안전한 이용권 확인 연결이 완료된 뒤 활성화됩니다.',translationUnavailable:'현재 선택된 자막이 없거나 번역 가능한 자막이 연결되지 않았습니다.'},
    en: {back:'← Back to list',previous:'Previous',play:'Play',pause:'Pause',next:'Next',captionsOn:'Captions on',captionsOff:'Captions off',translate:'Translate captions',fullscreen:'Fullscreen',exitFullscreen:'Exit fullscreen',preparing:'Content is being prepared.',unavailable:'A playable source has not been connected yet.',translationPending:'Caption translation is a paid service. It will be enabled after PG approval and secure entitlement verification are connected.',translationUnavailable:'No selected or translatable caption track is currently connected.'},
    de: {back:'← Zurück zur Liste',previous:'Zurück',play:'Wiedergabe',pause:'Pause',next:'Weiter',captionsOn:'Untertitel ein',captionsOff:'Untertitel aus',translate:'Untertitel übersetzen',fullscreen:'Vollbild',exitFullscreen:'Vollbild beenden',preparing:'Inhalt wird vorbereitet.',unavailable:'Für diesen Inhalt ist noch keine Wiedergabequelle verbunden.',translationPending:'Die Untertitelübersetzung ist kostenpflichtig und wird nach PG-Freigabe und sicherer Berechtigungsprüfung aktiviert.',translationUnavailable:'Es ist keine ausgewählte oder übersetzbare Untertitelspur verbunden.'},
    es: {back:'← Volver a la lista',previous:'Anterior',play:'Reproducir',pause:'Pausar',next:'Siguiente',captionsOn:'Subtítulos activados',captionsOff:'Subtítulos desactivados',translate:'Traducir subtítulos',fullscreen:'Pantalla completa',exitFullscreen:'Salir de pantalla completa',preparing:'Preparando el contenido.',unavailable:'Aún no hay una fuente de reproducción conectada.',translationPending:'La traducción de subtítulos es un servicio de pago y se activará tras la aprobación de PG y la verificación segura del acceso.',translationUnavailable:'No hay una pista de subtítulos seleccionada o traducible.'},
    fr: {back:'← Retour à la liste',previous:'Précédent',play:'Lire',pause:'Pause',next:'Suivant',captionsOn:'Sous-titres activés',captionsOff:'Sous-titres désactivés',translate:'Traduire les sous-titres',fullscreen:'Plein écran',exitFullscreen:'Quitter le plein écran',preparing:'Préparation du contenu.',unavailable:'Aucune source de lecture n’est encore connectée.',translationPending:'La traduction des sous-titres est un service payant, activé après approbation PG et vérification sécurisée des droits.',translationUnavailable:'Aucune piste de sous-titres sélectionnée ou traduisible n’est connectée.'},
    it: {back:'← Torna all’elenco',previous:'Precedente',play:'Riproduci',pause:'Pausa',next:'Successivo',captionsOn:'Sottotitoli attivi',captionsOff:'Sottotitoli disattivi',translate:'Traduci sottotitoli',fullscreen:'Schermo intero',exitFullscreen:'Esci da schermo intero',preparing:'Preparazione del contenuto.',unavailable:'Non è ancora collegata una sorgente riproducibile.',translationPending:'La traduzione dei sottotitoli è un servizio a pagamento e sarà attivata dopo l’approvazione PG e la verifica sicura dell’accesso.',translationUnavailable:'Non è collegata alcuna traccia sottotitoli selezionata o traducibile.'},
    pt: {back:'← Voltar à lista',previous:'Anterior',play:'Reproduzir',pause:'Pausar',next:'Seguinte',captionsOn:'Legendas ligadas',captionsOff:'Legendas desligadas',translate:'Traduzir legendas',fullscreen:'Ecrã inteiro',exitFullscreen:'Sair do ecrã inteiro',preparing:'A preparar o conteúdo.',unavailable:'Ainda não existe uma fonte de reprodução ligada.',translationPending:'A tradução de legendas é um serviço pago e será ativada após aprovação PG e verificação segura do acesso.',translationUnavailable:'Não existe uma faixa de legendas selecionada ou traduzível.'},
    nl: {back:'← Terug naar lijst',previous:'Vorige',play:'Afspelen',pause:'Pauzeren',next:'Volgende',captionsOn:'Ondertitels aan',captionsOff:'Ondertitels uit',translate:'Ondertitels vertalen',fullscreen:'Volledig scherm',exitFullscreen:'Volledig scherm sluiten',preparing:'Inhoud wordt voorbereid.',unavailable:'Er is nog geen afspeelbare bron gekoppeld.',translationPending:'Ondertitelvertaling is een betaalde dienst en wordt geactiveerd na PG-goedkeuring en veilige toegangscontrole.',translationUnavailable:'Er is geen geselecteerde of vertaalbare ondertiteltrack gekoppeld.'},
    pl: {back:'← Wróć do listy',previous:'Poprzedni',play:'Odtwórz',pause:'Pauza',next:'Następny',captionsOn:'Napisy włączone',captionsOff:'Napisy wyłączone',translate:'Tłumacz napisy',fullscreen:'Pełny ekran',exitFullscreen:'Wyjdź z pełnego ekranu',preparing:'Przygotowywanie treści.',unavailable:'Nie podłączono jeszcze źródła odtwarzania.',translationPending:'Tłumaczenie napisów jest usługą płatną i zostanie aktywowane po zatwierdzeniu PG oraz bezpiecznej weryfikacji uprawnień.',translationUnavailable:'Nie podłączono wybranej ani możliwej do tłumaczenia ścieżki napisów.'},
    sv: {back:'← Tillbaka till listan',previous:'Föregående',play:'Spela',pause:'Pausa',next:'Nästa',captionsOn:'Undertexter på',captionsOff:'Undertexter av',translate:'Översätt undertexter',fullscreen:'Helskärm',exitFullscreen:'Avsluta helskärm',preparing:'Innehållet förbereds.',unavailable:'Ingen spelbar källa är ansluten ännu.',translationPending:'Översättning av undertexter är en betaltjänst och aktiveras efter PG-godkännande och säker behörighetskontroll.',translationUnavailable:'Ingen vald eller översättningsbar undertext är ansluten.'},
    hu: {back:'← Vissza a listához',previous:'Előző',play:'Lejátszás',pause:'Szünet',next:'Következő',captionsOn:'Felirat be',captionsOff:'Felirat ki',translate:'Felirat fordítása',fullscreen:'Teljes képernyő',exitFullscreen:'Kilépés a teljes képernyőből',preparing:'A tartalom előkészítése folyamatban.',unavailable:'Még nincs csatlakoztatva lejátszható forrás.',translationPending:'A feliratfordítás fizetős szolgáltatás, amely PG-jóváhagyás és biztonságos jogosultság-ellenőrzés után aktiválódik.',translationUnavailable:'Nincs kiválasztott vagy fordítható feliratsáv.'},
    ru: {back:'← Назад к списку',previous:'Предыдущее',play:'Воспроизвести',pause:'Пауза',next:'Следующее',captionsOn:'Субтитры вкл.',captionsOff:'Субтитры выкл.',translate:'Перевести субтитры',fullscreen:'Полный экран',exitFullscreen:'Выйти из полного экрана',preparing:'Подготовка контента.',unavailable:'Источник воспроизведения ещё не подключён.',translationPending:'Перевод субтитров — платная услуга. Она будет включена после одобрения PG и безопасной проверки прав доступа.',translationUnavailable:'Нет выбранной или доступной для перевода дорожки субтитров.'},
    uk: {back:'← Назад до списку',previous:'Попереднє',play:'Відтворити',pause:'Пауза',next:'Наступне',captionsOn:'Субтитри увімкнено',captionsOff:'Субтитри вимкнено',translate:'Перекласти субтитри',fullscreen:'На весь екран',exitFullscreen:'Вийти з повного екрана',preparing:'Підготовка вмісту.',unavailable:'Джерело відтворення ще не підключено.',translationPending:'Переклад субтитрів є платною послугою й буде активований після схвалення PG та безпечної перевірки прав.',translationUnavailable:'Немає вибраної або придатної для перекладу доріжки субтитрів.'},
    tr: {back:'← Listeye dön',previous:'Önceki',play:'Oynat',pause:'Duraklat',next:'Sonraki',captionsOn:'Altyazı açık',captionsOff:'Altyazı kapalı',translate:'Altyazıyı çevir',fullscreen:'Tam ekran',exitFullscreen:'Tam ekrandan çık',preparing:'İçerik hazırlanıyor.',unavailable:'Henüz oynatılabilir bir kaynak bağlanmadı.',translationPending:'Altyazı çevirisi ücretli bir hizmettir; PG onayı ve güvenli yetki doğrulamasından sonra etkinleştirilir.',translationUnavailable:'Seçili veya çevrilebilir bir altyazı parçası bağlı değil.'},
    ar: {back:'← العودة إلى القائمة',previous:'السابق',play:'تشغيل',pause:'إيقاف مؤقت',next:'التالي',captionsOn:'تشغيل الترجمة',captionsOff:'إيقاف الترجمة',translate:'ترجمة النصوص',fullscreen:'ملء الشاشة',exitFullscreen:'الخروج من ملء الشاشة',preparing:'جارٍ تجهيز المحتوى.',unavailable:'لم يتم ربط مصدر تشغيل بعد.',translationPending:'ترجمة النصوص خدمة مدفوعة وستُفعّل بعد موافقة PG والتحقق الآمن من صلاحية الاستخدام.',translationUnavailable:'لا يوجد مسار نصوص محدد أو قابل للترجمة.'},
    fa: {back:'← بازگشت به فهرست',previous:'قبلی',play:'پخش',pause:'مکث',next:'بعدی',captionsOn:'زیرنویس روشن',captionsOff:'زیرنویس خاموش',translate:'ترجمه زیرنویس',fullscreen:'تمام‌صفحه',exitFullscreen:'خروج از تمام‌صفحه',preparing:'محتوا در حال آماده‌سازی است.',unavailable:'هنوز منبع قابل پخشی متصل نشده است.',translationPending:'ترجمه زیرنویس یک خدمت پولی است و پس از تأیید PG و بررسی امن مجوز فعال می‌شود.',translationUnavailable:'هیچ زیرنویس انتخاب‌شده یا قابل ترجمه‌ای متصل نیست.'},
    ur: {back:'← فہرست پر واپس جائیں',previous:'پچھلا',play:'چلائیں',pause:'روکیں',next:'اگلا',captionsOn:'سب ٹائٹل آن',captionsOff:'سب ٹائٹل آف',translate:'سب ٹائٹل ترجمہ کریں',fullscreen:'مکمل اسکرین',exitFullscreen:'مکمل اسکرین سے باہر',preparing:'مواد تیار کیا جا رہا ہے۔',unavailable:'ابھی کوئی قابلِ پلے ذریعہ منسلک نہیں ہے۔',translationPending:'سب ٹائٹل ترجمہ ایک بامعاوضہ خدمت ہے اور PG منظوری اور محفوظ اجازت کی تصدیق کے بعد فعال ہوگا۔',translationUnavailable:'کوئی منتخب یا قابلِ ترجمہ سب ٹائٹل ٹریک منسلک نہیں ہے۔'},
    hi: {back:'← सूची पर वापस जाएँ',previous:'पिछला',play:'चलाएँ',pause:'रोकें',next:'अगला',captionsOn:'उपशीर्षक चालू',captionsOff:'उपशीर्षक बंद',translate:'उपशीर्षक अनुवाद',fullscreen:'पूर्ण स्क्रीन',exitFullscreen:'पूर्ण स्क्रीन से बाहर',preparing:'सामग्री तैयार की जा रही है।',unavailable:'अभी कोई चलाने योग्य स्रोत जुड़ा नहीं है।',translationPending:'उपशीर्षक अनुवाद एक सशुल्क सेवा है और PG स्वीकृति व सुरक्षित अधिकार जाँच के बाद सक्रिय होगा।',translationUnavailable:'कोई चयनित या अनुवाद योग्य उपशीर्षक ट्रैक जुड़ा नहीं है।'},
    bn: {back:'← তালিকায় ফিরুন',previous:'আগেরটি',play:'চালান',pause:'বিরতি',next:'পরেরটি',captionsOn:'সাবটাইটেল চালু',captionsOff:'সাবটাইটেল বন্ধ',translate:'সাবটাইটেল অনুবাদ',fullscreen:'পূর্ণ পর্দা',exitFullscreen:'পূর্ণ পর্দা থেকে বের হন',preparing:'কনটেন্ট প্রস্তুত করা হচ্ছে।',unavailable:'এখনও কোনো চালানোযোগ্য উৎস যুক্ত নেই।',translationPending:'সাবটাইটেল অনুবাদ একটি পেইড সেবা; PG অনুমোদন ও নিরাপদ অধিকার যাচাইয়ের পর সক্রিয় হবে।',translationUnavailable:'কোনো নির্বাচিত বা অনুবাদযোগ্য সাবটাইটেল ট্র্যাক যুক্ত নেই।'},
    ta: {back:'← பட்டியலுக்குத் திரும்பு',previous:'முந்தையது',play:'இயக்கு',pause:'இடைநிறுத்து',next:'அடுத்தது',captionsOn:'வசனம் இயக்கு',captionsOff:'வசனம் அணை',translate:'வசனம் மொழிபெயர்',fullscreen:'முழுத் திரை',exitFullscreen:'முழுத் திரையிலிருந்து வெளியேறு',preparing:'உள்ளடக்கம் தயாராகிறது.',unavailable:'இயக்கக்கூடிய மூலம் இன்னும் இணைக்கப்படவில்லை.',translationPending:'வசன மொழிபெயர்ப்பு கட்டண சேவையாகும்; PG ஒப்புதல் மற்றும் பாதுகாப்பான உரிமைச் சரிபார்ப்புக்குப் பிறகு செயல்படும்.',translationUnavailable:'தேர்ந்தெடுக்கப்பட்ட அல்லது மொழிபெயர்க்கக்கூடிய வசன தடம் இல்லை.'},
    th: {back:'← กลับไปยังรายการ',previous:'ก่อนหน้า',play:'เล่น',pause:'หยุดชั่วคราว',next:'ถัดไป',captionsOn:'เปิดคำบรรยาย',captionsOff:'ปิดคำบรรยาย',translate:'แปลคำบรรยาย',fullscreen:'เต็มหน้าจอ',exitFullscreen:'ออกจากเต็มหน้าจอ',preparing:'กำลังเตรียมเนื้อหา',unavailable:'ยังไม่ได้เชื่อมต่อแหล่งเล่นที่ใช้ได้',translationPending:'การแปลคำบรรยายเป็นบริการแบบชำระเงิน และจะเปิดใช้หลังการอนุมัติ PG และการตรวจสอบสิทธิ์อย่างปลอดภัย',translationUnavailable:'ไม่มีแทร็กคำบรรยายที่เลือกหรือแปลได้'},
    vi: {back:'← Quay lại danh sách',previous:'Trước',play:'Phát',pause:'Tạm dừng',next:'Tiếp',captionsOn:'Bật phụ đề',captionsOff:'Tắt phụ đề',translate:'Dịch phụ đề',fullscreen:'Toàn màn hình',exitFullscreen:'Thoát toàn màn hình',preparing:'Đang chuẩn bị nội dung.',unavailable:'Chưa kết nối nguồn phát có thể sử dụng.',translationPending:'Dịch phụ đề là dịch vụ trả phí và sẽ được bật sau khi PG được phê duyệt và quyền sử dụng được xác minh an toàn.',translationUnavailable:'Không có bản phụ đề đã chọn hoặc có thể dịch.'},
    id: {back:'← Kembali ke daftar',previous:'Sebelumnya',play:'Putar',pause:'Jeda',next:'Berikutnya',captionsOn:'Subtitel aktif',captionsOff:'Subtitel nonaktif',translate:'Terjemahkan subtitel',fullscreen:'Layar penuh',exitFullscreen:'Keluar dari layar penuh',preparing:'Konten sedang disiapkan.',unavailable:'Sumber pemutaran belum terhubung.',translationPending:'Terjemahan subtitel adalah layanan berbayar dan akan diaktifkan setelah persetujuan PG serta verifikasi hak akses yang aman.',translationUnavailable:'Tidak ada trek subtitel yang dipilih atau dapat diterjemahkan.'},
    ms: {back:'← Kembali ke senarai',previous:'Sebelumnya',play:'Main',pause:'Jeda',next:'Seterusnya',captionsOn:'Sari kata hidup',captionsOff:'Sari kata mati',translate:'Terjemah sari kata',fullscreen:'Skrin penuh',exitFullscreen:'Keluar skrin penuh',preparing:'Kandungan sedang disediakan.',unavailable:'Sumber main balik belum disambungkan.',translationPending:'Terjemahan sari kata ialah perkhidmatan berbayar dan akan diaktifkan selepas kelulusan PG serta pengesahan hak yang selamat.',translationUnavailable:'Tiada trek sari kata dipilih atau boleh diterjemah.'},
    tl: {back:'← Bumalik sa listahan',previous:'Nakaraan',play:'I-play',pause:'I-pause',next:'Susunod',captionsOn:'Bukas ang subtitle',captionsOff:'Patay ang subtitle',translate:'Isalin ang subtitle',fullscreen:'Buong screen',exitFullscreen:'Lumabas sa buong screen',preparing:'Inihahanda ang nilalaman.',unavailable:'Wala pang nakakabit na mapapatugtog na source.',translationPending:'Bayad na serbisyo ang pagsasalin ng subtitle at ia-activate pagkatapos ng PG approval at ligtas na pag-verify ng karapatan.',translationUnavailable:'Walang napili o maisasaling subtitle track.'},
    sw: {back:'← Rudi kwenye orodha',previous:'Iliyotangulia',play:'Cheza',pause:'Sitisha',next:'Inayofuata',captionsOn:'Manukuu yamewashwa',captionsOff:'Manukuu yamezimwa',translate:'Tafsiri manukuu',fullscreen:'Skrini nzima',exitFullscreen:'Toka skrini nzima',preparing:'Maudhui yanaandaliwa.',unavailable:'Bado hakuna chanzo cha kucheza kilichounganishwa.',translationPending:'Tafsiri ya manukuu ni huduma ya kulipia na itawezeshwa baada ya idhini ya PG na uthibitishaji salama wa ruhusa.',translationUnavailable:'Hakuna wimbo wa manukuu uliochaguliwa au unaoweza kutafsiriwa.'},
    uz: {back:'← Ro‘yxatga qaytish',previous:'Oldingi',play:'Ijro',pause:'Pauza',next:'Keyingi',captionsOn:'Subtitr yoqilgan',captionsOff:'Subtitr o‘chirilgan',translate:'Subtitrni tarjima qilish',fullscreen:'To‘liq ekran',exitFullscreen:'To‘liq ekrandan chiqish',preparing:'Kontent tayyorlanmoqda.',unavailable:'Hali ijro manbasi ulanmagan.',translationPending:'Subtitr tarjimasi pullik xizmat bo‘lib, PG tasdig‘i va xavfsiz huquq tekshiruvidan so‘ng faollashadi.',translationUnavailable:'Tanlangan yoki tarjima qilinadigan subtitr yo‘li ulanmagan.'},
    ja: {back:'← 一覧に戻る',previous:'前へ',play:'再生',pause:'一時停止',next:'次へ',captionsOn:'字幕オン',captionsOff:'字幕オフ',translate:'字幕を翻訳',fullscreen:'全画面',exitFullscreen:'全画面を終了',preparing:'コンテンツを準備しています。',unavailable:'再生ソースがまだ接続されていません。',translationPending:'字幕翻訳は有料サービスです。PG承認と安全な利用権確認の接続後に有効になります。',translationUnavailable:'選択中または翻訳可能な字幕トラックがありません。'},
    zh: {back:'← 返回列表',previous:'上一个',play:'播放',pause:'暂停',next:'下一个',captionsOn:'开启字幕',captionsOff:'关闭字幕',translate:'翻译字幕',fullscreen:'全屏',exitFullscreen:'退出全屏',preparing:'正在准备内容。',unavailable:'尚未连接可播放的来源。',translationPending:'字幕翻译是付费服务，将在 PG 审批和安全权限验证完成后启用。',translationUnavailable:'当前没有已选择或可翻译的字幕轨道。'},
    zht: {back:'← 返回清單',previous:'上一個',play:'播放',pause:'暫停',next:'下一個',captionsOn:'開啟字幕',captionsOff:'關閉字幕',translate:'翻譯字幕',fullscreen:'全螢幕',exitFullscreen:'結束全螢幕',preparing:'正在準備內容。',unavailable:'尚未連接可播放的來源。',translationPending:'字幕翻譯是付費服務，將於 PG 核准及安全權限驗證完成後啟用。',translationUnavailable:'目前沒有已選取或可翻譯的字幕軌。'}
  };

  function copy() {
    var lang = String((document.documentElement && document.documentElement.lang) || 'ko').toLowerCase();
    if (lang === 'zh-hant' || lang === 'zh-tw' || lang === 'zh-hk') lang = 'zht';
    lang = lang.split('-')[0];
    return COPY[lang] || COPY.en;
  }
  function text(value) { return value == null ? '' : String(value).trim(); }
  function create(tag, className, content) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (content != null) element.textContent = content;
    return element;
  }
  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function isMediaCard(node) { return node && node.closest && node.closest('.thumb-line[data-psom-key^="media-"] a.card'); }
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

  function injectStyle() {
    if (document.getElementById('igdc-mediahub-playback-v2-style')) return;
    var style = document.createElement('style');
    style.id = 'igdc-mediahub-playback-v2-style';
    style.textContent = [
      '#igdc-media-detail-view{display:block;width:100%;min-height:100vh;background:#0d1118;color:#eef3fb;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#igdc-media-detail-view *{box-sizing:border-box}',
      '.igdc-media-detail-header{display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 16px;background:#151d29;border-bottom:1px solid rgba(255,255,255,.12)}',
      '.igdc-media-detail-button{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:#202b3d;color:#fff;padding:8px 12px;font:inherit;cursor:pointer}',
      '.igdc-media-detail-button:hover{background:#2c3c57}',
      '.igdc-media-detail-button:disabled{opacity:.42;cursor:not-allowed}',
      '.igdc-media-detail-button:focus-visible{outline:3px solid #8eb3ff;outline-offset:2px}',
      '.igdc-media-detail-title{flex:1;min-width:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.igdc-media-detail-stage{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:16/9;min-height:320px;background:#05070b;outline:none}',
      '.igdc-media-detail-stage:fullscreen{width:100vw;height:100vh;aspect-ratio:auto;min-height:100vh}',
      '.igdc-media-detail-stage video,.igdc-media-detail-stage iframe{display:block;width:100%;height:100%;border:0;background:#000;object-fit:contain}',
      '.igdc-media-controlbar{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;padding:11px 12px;background:#111925;border-top:1px solid rgba(255,255,255,.1)}',
      '.igdc-media-controlbar .igdc-media-detail-button{min-width:78px}',
      '.igdc-media-detail-notice{display:none;margin:0;padding:10px 16px;background:#172235;border-top:1px solid rgba(255,255,255,.1);line-height:1.5;text-align:center}',
      '.igdc-media-detail-notice[data-open="true"]{display:block}',
      '.igdc-media-detail-pending{position:relative;display:grid;place-items:center;width:100%;height:100%;overflow:hidden;background:#0e1521}',
      '.igdc-media-detail-pending img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.24;filter:blur(1px)}',
      '.igdc-media-detail-pending-panel{position:relative;max-width:620px;margin:24px;padding:22px 24px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(7,11,17,.88);text-align:center;line-height:1.55}',
      '.igdc-media-detail-pending-panel strong{display:block;margin-bottom:6px}',
      '@media(max-width:700px){.igdc-media-detail-header{padding:8px 10px;gap:8px}.igdc-media-detail-header .igdc-media-detail-button{padding:7px 9px;font-size:.86rem}.igdc-media-detail-stage{min-height:56vw}.igdc-media-controlbar{position:sticky;bottom:0;z-index:3;padding:8px 6px}.igdc-media-controlbar .igdc-media-detail-button{min-width:66px;padding:8px 9px;font-size:.82rem}}'
    ].join('');
    document.head.appendChild(style);
  }

  function hideList(card) {
    var roots = [];
    function add(node) { if (node && roots.indexOf(node) < 0) roots.push(node); }
    add(document.getElementById('hero'));
    add(card && card.closest('.layout'));
    add(document.querySelector('.hero-overlay'));
    add(document.querySelector('footer'));
    add(document.getElementById('providers-drawer-left'));
    add(document.getElementById('providers-backdrop-left'));
    add(document.getElementById('providers-tab-left'));
    add(document.getElementById('providers-banner'));
    state.restore = roots.map(function (node) { return { node: node, display: node.style.display, ariaHidden: node.getAttribute('aria-hidden') }; });
    state.restore.forEach(function (entry) { entry.node.style.display = 'none'; entry.node.setAttribute('aria-hidden', 'true'); });
  }
  function restoreList() {
    state.restore.forEach(function (entry) {
      entry.node.style.display = entry.display;
      if (entry.ariaHidden == null) entry.node.removeAttribute('aria-hidden');
      else entry.node.setAttribute('aria-hidden', entry.ariaHidden);
    });
    state.restore = [];
  }

  function appendLegacyPlayer(stage, card) {
    var c = copy(), source = sourceFor(card), youtube = youtubeId(source);
    if (youtube) {
      var frame = document.createElement('iframe');
      frame.title = titleFor(card);
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(youtube) + '?autoplay=1&rel=0';
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      frame.setAttribute('allowfullscreen', '');
      stage.appendChild(frame);
      return;
    }
    if (directVideo(source)) {
      var video = document.createElement('video');
      video.src = source;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', titleFor(card));
      appendCardTracks(video, card);
      stage.appendChild(video);
      return;
    }
    var pending = create('div', 'igdc-media-detail-pending');
    var image = imageFor(card);
    if (image) { var preview = document.createElement('img'); preview.src = image; preview.alt = ''; pending.appendChild(preview); }
    var panel = create('div', 'igdc-media-detail-pending-panel');
    panel.appendChild(create('strong', '', c.preparing));
    panel.appendChild(create('div', '', c.unavailable));
    pending.appendChild(panel);
    stage.appendChild(pending);
  }
  function appendCardTracks(video, card) {
    var raw = text(card && card.dataset && (card.dataset.captions || card.dataset.subtitleTracks));
    if (!raw) return;
    try {
      var tracks = JSON.parse(raw);
      if (!Array.isArray(tracks)) return;
      tracks.forEach(function (item, index) {
        if (!item || !item.src) return;
        var track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = item.src;
        track.srclang = item.language || item.srclang || 'und';
        track.label = item.label || track.srclang;
        if (item.default || index === 0) track.default = true;
        video.appendChild(track);
      });
    } catch (_) {}
  }
  function appendPlayer(stage, card) {
    var ott = global.IGDCMediaHubOTTInline;
    if (ott && typeof ott.mount === 'function') {
      try { if (ott.mount(stage, card, { legacyMount: appendLegacyPlayer })) return; } catch (_) {}
    }
    appendLegacyPlayer(stage, card);
  }

  function currentVideo() { return state.stage && state.stage.querySelector('video'); }
  function currentCaptionSelect() { return state.stage && state.stage.querySelector('.igdc-ott-caption-select'); }
  function syncButtons() {
    if (!state.detail) return;
    var c = copy(), video = currentVideo();
    var play = state.detail.querySelector('[data-media-action="play"]');
    var previous = state.detail.querySelector('[data-media-action="previous"]');
    var next = state.detail.querySelector('[data-media-action="next"]');
    var captions = state.detail.querySelector('[data-media-action="captions"]');
    if (play) { play.disabled = !video; play.textContent = video && !video.paused ? c.pause : c.play; }
    if (previous) previous.disabled = !adjacentCard(-1);
    if (next) next.disabled = !adjacentCard(1);
    if (captions) {
      var enabled = captionsEnabled();
      captions.disabled = !video || !hasCaptions(video);
      captions.textContent = enabled ? c.captionsOff : c.captionsOn;
    }
  }
  function observeStage() {
    if (state.mutationObserver) state.mutationObserver.disconnect();
    if (!state.stage || !global.MutationObserver) return;
    state.mutationObserver = new MutationObserver(function () {
      var video = currentVideo();
      if (video && !video.__igdcMediaBound) {
        video.__igdcMediaBound = true;
        ['play', 'pause', 'ended', 'loadedmetadata', 'emptied'].forEach(function (name) { video.addEventListener(name, syncButtons); });
        try {
          var tracker = global.MaruRevenueTracker;
          if (tracker && typeof tracker.bindMedia === 'function') {
            tracker.bindMedia(video, {
              id: contentIdFor(state.card),
              contentId: contentIdFor(state.card),
              title: titleFor(state.card),
              mediaType: 'video',
              url: sourceFor(state.card)
            }, { service: 'mediahub-playback', pageType: 'media', revenueLine: 'media_watchtime' });
          }
        } catch (_) {}
      }
      syncButtons();
    });
    state.mutationObserver.observe(state.stage, { childList: true, subtree: true });
    syncButtons();
  }
  function hasCaptions(video) {
    var select = currentCaptionSelect();
    if (select && select.options && select.options.length > 1) return true;
    return Boolean(video && video.textTracks && video.textTracks.length);
  }
  function captionsEnabled() {
    var select = currentCaptionSelect();
    if (select) return select.value && select.value !== 'off';
    var video = currentVideo();
    if (!video || !video.textTracks) return false;
    for (var i = 0; i < video.textTracks.length; i += 1) if (video.textTracks[i].mode === 'showing') return true;
    return false;
  }
  function toggleCaptions() {
    var select = currentCaptionSelect();
    if (select) {
      if (select.value && select.value !== 'off') { state.lastCaptionValue = select.value; select.value = 'off'; }
      else {
        var desired = state.lastCaptionValue;
        if (!desired || !Array.prototype.some.call(select.options, function (option) { return option.value === desired; })) {
          desired = select.options.length > 1 ? select.options[1].value : 'off';
        }
        select.value = desired;
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncButtons();
      return;
    }
    var video = currentVideo();
    if (!video || !video.textTracks || !video.textTracks.length) return;
    var turnOn = !captionsEnabled();
    for (var i = 0; i < video.textTracks.length; i += 1) video.textTracks[i].mode = turnOn && i === 0 ? 'showing' : 'disabled';
    syncButtons();
  }
  function togglePlay() {
    var video = currentVideo();
    if (!video) return;
    if (video.paused) { var result = video.play(); if (result && result.catch) result.catch(function () {}); }
    else video.pause();
    syncButtons();
  }
  function showNotice(message) {
    var notice = state.detail && state.detail.querySelector('.igdc-media-detail-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.setAttribute('data-open', 'true');
    global.clearTimeout(notice.__igdcTimer);
    notice.__igdcTimer = global.setTimeout(function () { notice.removeAttribute('data-open'); }, 6500);
  }
  function requestTranslation() {
    var c = copy(), video = currentVideo();
    if (!video || !hasCaptions(video) || !captionsEnabled()) { showNotice(c.translationUnavailable); return; }
    global.fetch('/.netlify/functions/status', { cache: 'no-store', credentials: 'same-origin' }).then(function (response) {
      return response.ok ? response.json() : null;
    }).then(function (status) {
      var bridge = global.IGDCMediaHubSubtitleTranslation;
      if (!status || !status.pg || status.pg.executionEnabled !== true || !bridge || typeof bridge.request !== 'function') {
        showNotice(c.translationPending);
        return;
      }
      bridge.request({ card: state.card, stage: state.stage, video: video, contentId: contentIdFor(state.card) });
    }).catch(function () { showNotice(c.translationPending); });
  }

  function leaveFullscreen() {
    try {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (fullscreenElement() && exit) { var result = exit.call(document); if (result && result.catch) result.catch(function () {}); }
    } catch (_) {}
  }
  function updateFullscreenButton() {
    if (!state.detail) return;
    var button = state.detail.querySelector('[data-media-action="fullscreen"]');
    if (button) button.textContent = fullscreenElement() ? copy().exitFullscreen : copy().fullscreen;
  }
  function toggleFullscreen() {
    if (!state.stage) return;
    if (fullscreenElement()) { leaveFullscreen(); return; }
    try {
      var request = state.stage.requestFullscreen || state.stage.webkitRequestFullscreen;
      if (request) { var result = request.call(state.stage); if (result && result.catch) result.catch(function () {}); }
    } catch (_) {}
  }
  function disposeStage() {
    try {
      if (state.stage && global.IGDCMediaHubOTTInline && typeof global.IGDCMediaHubOTTInline.dispose === 'function') global.IGDCMediaHubOTTInline.dispose(state.stage);
    } catch (_) {}
    if (state.mutationObserver) { state.mutationObserver.disconnect(); state.mutationObserver = null; }
  }
  function close(options) {
    options = options || {};
    if (!state.open) return;
    if (!options.fromHistory && state.historyToken && global.history && global.history.state && global.history.state.igdcMediaToken === state.historyToken) {
      global.history.back();
      return;
    }
    if (fullscreenElement()) leaveFullscreen();
    disposeStage();
    if (state.detail) state.detail.remove();
    restoreList();
    var restoreY = state.scrollY;
    state.open = false; state.detail = null; state.stage = null; state.card = null; state.historyToken = ''; state.lastCaptionValue = '';
    global.requestAnimationFrame(function () { global.scrollTo(0, restoreY); frameHeight(); });
  }
  function switchCard(card) {
    if (!card || !state.open || card === state.card) return;
    disposeStage();
    state.card = card;
    state.lastCaptionValue = '';
    var title = state.detail.querySelector('.igdc-media-detail-title');
    if (title) title.textContent = titleFor(card);
    state.detail.setAttribute('aria-label', titleFor(card));
    state.stage.textContent = '';
    appendPlayer(state.stage, card);
    observeStage();
    global.scrollTo(0, 0);
    syncButtons();
  }
  function move(direction) { var card = adjacentCard(direction); if (card) switchCard(card); }
  function button(action, label) {
    var node = create('button', 'igdc-media-detail-button', label);
    node.type = 'button'; node.setAttribute('data-media-action', action); return node;
  }
  function open(card, options) {
    options = options || {};
    if (!card) return;
    if (state.open) { switchCard(card); return; }
    injectStyle();
    attemptNativePlayer(card);
    state.open = true; state.card = card; state.scrollY = global.scrollY || global.pageYOffset || 0;
    hideList(card);
    var c = copy(), detail = create('section', '');
    detail.id = 'igdc-media-detail-view'; detail.setAttribute('aria-label', titleFor(card));
    var header = create('header', 'igdc-media-detail-header');
    var back = button('back', c.back), title = create('div', 'igdc-media-detail-title', titleFor(card)), fullscreen = button('fullscreen', c.fullscreen);
    header.appendChild(back); header.appendChild(title); header.appendChild(fullscreen);
    var stage = create('div', 'igdc-media-detail-stage'); stage.tabIndex = -1;
    var controls = create('div', 'igdc-media-controlbar');
    controls.appendChild(button('previous', c.previous)); controls.appendChild(button('play', c.play)); controls.appendChild(button('next', c.next));
    controls.appendChild(button('captions', c.captionsOn)); controls.appendChild(button('translate', c.translate));
    var notice = create('p', 'igdc-media-detail-notice'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    detail.appendChild(header); detail.appendChild(stage); detail.appendChild(controls); detail.appendChild(notice); document.body.appendChild(detail);
    state.detail = detail; state.stage = stage;
    appendPlayer(stage, card); observeStage();
    detail.addEventListener('click', function (event) {
      var action = event.target && event.target.getAttribute && event.target.getAttribute('data-media-action');
      if (!action) return;
      if (action === 'back') close(); else if (action === 'fullscreen') toggleFullscreen(); else if (action === 'previous') move(-1);
      else if (action === 'next') move(1); else if (action === 'play') togglePlay(); else if (action === 'captions') toggleCaptions(); else if (action === 'translate') requestTranslation();
    });
    if (!options.fromHistory && global.history && global.history.pushState) {
      state.historyToken = 'media-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      try { global.history.pushState({ igdcMedia: true, igdcMediaToken: state.historyToken }, '', global.location.href); } catch (_) { state.historyToken = ''; }
    }
    global.requestAnimationFrame(function () { global.scrollTo(0, 0); stage.focus({ preventScroll: true }); frameHeight(); syncButtons(); });
  }

  document.addEventListener('click', function (event) {
    var card = isMediaCard(event.target);
    if (!card || state.open || card.getAttribute('data-placeholder') === 'true') return;
    event.preventDefault(); event.stopImmediatePropagation(); open(card);
  }, true);
  document.addEventListener('keydown', function (event) {
    if (!state.open) return;
    var tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.key === 'Enter') { event.preventDefault(); toggleFullscreen(); }
    else if (event.key === 'Escape' && fullscreenElement()) { event.preventDefault(); leaveFullscreen(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    else if (event.key === ' ' || event.code === 'Space') { event.preventDefault(); togglePlay(); }
  }, true);
  global.addEventListener('popstate', function () { if (state.open) close({ fromHistory: true }); });
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

  global.IGDCMediaHubPlayback = { open: open, close: close, previous: function () { move(-1); }, next: function () { move(1); }, VERSION: '2.3.0-30-language-device-parity' };
})(window, document);
