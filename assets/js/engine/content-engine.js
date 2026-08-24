// content-engine.js
// MARU IGDC Content Engine — snapshot-aware product/content one-page resolver
// - Keeps /data/{id}.json direct item loading
// - Falls back to front/network/tour/distribution/social/media snapshots
// - Preserves item commerce/revenue/payment fields and exposes external purchase/visit URL only inside the one-page.

(function(){
  'use strict';

  const DIRECT_DATA_PREFIX = '/data/';
  const SNAPSHOT_SOURCES = [
    { name:'front',        url:'/data/front.snapshot.json',          defaultType:'commerce' },
    { name:'networkhub',   url:'/data/networkhub-snapshot.json',     defaultType:'commerce' },
    { name:'tour',         url:'/data/tour-snapshot.json',           defaultType:'commerce' },
    { name:'distribution', url:'/data/distribution.snapshot.json',   defaultType:'commerce' },
    { name:'social',       url:'/data/social.snapshot.json',         defaultType:'commerce' },
    { name:'media',        url:'/data/media.snapshot.json',          defaultType:'media' }
  ];


  // 30-language localized guidance for the shared IGDC content one-page.
  // Detection is non-invasive: query string -> referring language page -> saved language -> document/browser language.
  const CONTENT_I18N = {"ko":{"pageTitle":"상품 상세 정보 | IGDC","descriptionReady":"상품 상세 정보가 준비 중입니다.","details":"자세히 보기","imageReady":"이미지 준비 중","connectionReady":"연결 준비 중","note":"이 화면은 IGDC 내부 상품 원페이지입니다. 실제 판매처·결제·제휴 링크가 연결되면 이 원페이지 안에서 구매/방문 버튼으로 이어집니다.","notFound":"콘텐츠를 찾지 못했습니다.","requestId":"요청 ID","notFoundDetail":"개별 데이터 파일과 현재 스냅샷들을 확인했지만 매칭되는 상품/콘텐츠가 없습니다."},"en":{"pageTitle":"Product Details | IGDC","descriptionReady":"Product details are being prepared.","details":"View details","imageReady":"Image coming soon","connectionReady":"Connection coming soon","note":"This is an IGDC internal product one-page. Once the actual seller, payment, or affiliate link is connected, the purchase/visit button on this page will take you there.","notFound":"Content not found.","requestId":"Request ID","notFoundDetail":"We checked the individual data file and the current snapshots, but no matching product or content was found."},"zh":{"pageTitle":"商品详情 | IGDC","descriptionReady":"商品详细信息正在准备中。","details":"查看详情","imageReady":"图片准备中","connectionReady":"连接准备中","note":"这是 IGDC 内部商品单页。实际销售方、支付或联盟链接接入后，可通过本页的购买/访问按钮前往。","notFound":"未找到内容。","requestId":"请求 ID","notFoundDetail":"已检查单独的数据文件和当前快照，但未找到匹配的商品或内容。"},"zht":{"pageTitle":"商品詳情 | IGDC","descriptionReady":"商品詳細資訊正在準備中。","details":"查看詳情","imageReady":"圖片準備中","connectionReady":"連結準備中","note":"這是 IGDC 內部商品單頁。實際銷售方、付款或聯盟連結接入後，可透過本頁的購買/造訪按鈕前往。","notFound":"找不到內容。","requestId":"請求 ID","notFoundDetail":"已檢查個別資料檔案與目前快照，但找不到相符的商品或內容。"},"ja":{"pageTitle":"商品詳細 | IGDC","descriptionReady":"商品詳細情報を準備中です。","details":"詳細を見る","imageReady":"画像を準備中","connectionReady":"接続準備中","note":"この画面は IGDC 内部の商品ワンページです。実際の販売先・決済・提携リンクが接続されると、このページ内の購入／訪問ボタンから移動できます。","notFound":"コンテンツが見つかりません。","requestId":"リクエスト ID","notFoundDetail":"個別データファイルと現在のスナップショットを確認しましたが、一致する商品／コンテンツは見つかりませんでした。"},"es":{"pageTitle":"Detalles del producto | IGDC","descriptionReady":"La información detallada del producto está en preparación.","details":"Ver detalles","imageReady":"Imagen en preparación","connectionReady":"Conexión en preparación","note":"Esta es una página interna de producto de IGDC. Cuando se conecte el enlace real del vendedor, pago o afiliado, el botón de compra/visita de esta página lo llevará allí.","notFound":"No se encontró el contenido.","requestId":"ID de solicitud","notFoundDetail":"Se revisaron el archivo de datos individual y las instantáneas actuales, pero no se encontró ningún producto o contenido coincidente."},"fr":{"pageTitle":"Détails du produit | IGDC","descriptionReady":"Les informations détaillées sur le produit sont en cours de préparation.","details":"Voir les détails","imageReady":"Image en préparation","connectionReady":"Connexion en préparation","note":"Cette page est une fiche produit interne d’IGDC. Une fois le lien réel du vendeur, de paiement ou d’affiliation connecté, le bouton Acheter/Visiter de cette page permettra d’y accéder.","notFound":"Contenu introuvable.","requestId":"ID de la demande","notFoundDetail":"Le fichier de données individuel et les instantanés actuels ont été vérifiés, mais aucun produit ou contenu correspondant n’a été trouvé."},"de":{"pageTitle":"Produktdetails | IGDC","descriptionReady":"Die ausführlichen Produktinformationen werden vorbereitet.","details":"Details ansehen","imageReady":"Bild wird vorbereitet","connectionReady":"Verbindung wird vorbereitet","note":"Dies ist eine interne IGDC-Produktseite. Sobald der tatsächliche Verkäufer-, Zahlungs- oder Affiliate-Link verbunden ist, führt die Schaltfläche Kaufen/Besuchen auf dieser Seite dorthin.","notFound":"Inhalt nicht gefunden.","requestId":"Anfrage-ID","notFoundDetail":"Die einzelne Datendatei und die aktuellen Snapshots wurden geprüft, aber es wurde kein passendes Produkt bzw. kein passender Inhalt gefunden."},"ru":{"pageTitle":"Информация о товаре | IGDC","descriptionReady":"Подробная информация о товаре готовится.","details":"Подробнее","imageReady":"Изображение готовится","connectionReady":"Подключение готовится","note":"Это внутренняя одностраничная карточка товара IGDC. После подключения фактической ссылки продавца, оплаты или партнёра кнопка «Купить/Посетить» на этой странице приведёт по ней.","notFound":"Контент не найден.","requestId":"ID запроса","notFoundDetail":"Мы проверили отдельный файл данных и текущие снимки, но подходящий товар или контент не найден."},"pt":{"pageTitle":"Detalhes do produto | IGDC","descriptionReady":"As informações detalhadas do produto estão sendo preparadas.","details":"Ver detalhes","imageReady":"Imagem em preparação","connectionReady":"Conexão em preparação","note":"Esta é uma página interna de produto da IGDC. Quando o link real do vendedor, pagamento ou afiliado for conectado, o botão Comprar/Visitar desta página levará até ele.","notFound":"Conteúdo não encontrado.","requestId":"ID da solicitação","notFoundDetail":"O arquivo de dados individual e os snapshots atuais foram verificados, mas nenhum produto ou conteúdo correspondente foi encontrado."},"it":{"pageTitle":"Dettagli del prodotto | IGDC","descriptionReady":"Le informazioni dettagliate sul prodotto sono in preparazione.","details":"Vedi dettagli","imageReady":"Immagine in preparazione","connectionReady":"Collegamento in preparazione","note":"Questa è una pagina prodotto interna di IGDC. Quando sarà collegato il link effettivo del venditore, del pagamento o dell’affiliazione, il pulsante Acquista/Visita di questa pagina condurrà a tale destinazione.","notFound":"Contenuto non trovato.","requestId":"ID richiesta","notFoundDetail":"Sono stati controllati il file dati individuale e gli snapshot correnti, ma non è stato trovato alcun prodotto o contenuto corrispondente."},"ar":{"pageTitle":"تفاصيل المنتج | IGDC","descriptionReady":"يجري إعداد المعلومات التفصيلية للمنتج.","details":"عرض التفاصيل","imageReady":"يجري إعداد الصورة","connectionReady":"يجري إعداد الاتصال","note":"هذه صفحة منتج داخلية تابعة لـ IGDC. عند ربط رابط البائع أو الدفع أو الشراكة الفعلي، سينقلك زر الشراء/الزيارة في هذه الصفحة إليه.","notFound":"لم يتم العثور على المحتوى.","requestId":"معرّف الطلب","notFoundDetail":"تم فحص ملف البيانات الفردي واللقطات الحالية، ولكن لم يتم العثور على منتج أو محتوى مطابق."},"vi":{"pageTitle":"Chi tiết sản phẩm | IGDC","descriptionReady":"Thông tin chi tiết về sản phẩm đang được chuẩn bị.","details":"Xem chi tiết","imageReady":"Hình ảnh đang được chuẩn bị","connectionReady":"Kết nối đang được chuẩn bị","note":"Đây là trang sản phẩm nội bộ của IGDC. Khi liên kết người bán, thanh toán hoặc liên kết tiếp thị thực tế được kết nối, nút Mua/Truy cập trên trang này sẽ đưa bạn đến đó.","notFound":"Không tìm thấy nội dung.","requestId":"ID yêu cầu","notFoundDetail":"Đã kiểm tra tệp dữ liệu riêng lẻ và các bản chụp hiện tại nhưng không tìm thấy sản phẩm hoặc nội dung phù hợp."},"th":{"pageTitle":"รายละเอียดสินค้า | IGDC","descriptionReady":"กำลังจัดเตรียมข้อมูลรายละเอียดสินค้า","details":"ดูรายละเอียด","imageReady":"กำลังจัดเตรียมรูปภาพ","connectionReady":"กำลังจัดเตรียมการเชื่อมต่อ","note":"หน้านี้เป็นหน้าสินค้าภายในของ IGDC เมื่อเชื่อมต่อลิงก์ผู้ขาย การชำระเงิน หรือพันธมิตรจริงแล้ว ปุ่มซื้อ/เยี่ยมชมในหน้านี้จะนำไปยังลิงก์ดังกล่าว","notFound":"ไม่พบเนื้อหา","requestId":"รหัสคำขอ","notFoundDetail":"ตรวจสอบไฟล์ข้อมูลรายรายการและสแนปช็อตปัจจุบันแล้ว แต่ไม่พบสินค้าหรือเนื้อหาที่ตรงกัน"},"id":{"pageTitle":"Detail produk | IGDC","descriptionReady":"Informasi detail produk sedang disiapkan.","details":"Lihat detail","imageReady":"Gambar sedang disiapkan","connectionReady":"Koneksi sedang disiapkan","note":"Ini adalah halaman produk internal IGDC. Setelah tautan penjual, pembayaran, atau afiliasi yang sebenarnya tersambung, tombol Beli/Kunjungi pada halaman ini akan mengarah ke sana.","notFound":"Konten tidak ditemukan.","requestId":"ID permintaan","notFoundDetail":"Berkas data individual dan snapshot saat ini telah diperiksa, tetapi tidak ditemukan produk atau konten yang cocok."},"hi":{"pageTitle":"उत्पाद विवरण | IGDC","descriptionReady":"उत्पाद की विस्तृत जानकारी तैयार की जा रही है।","details":"विवरण देखें","imageReady":"चित्र तैयार किया जा रहा है","connectionReady":"कनेक्शन तैयार किया जा रहा है","note":"यह IGDC का आंतरिक उत्पाद वन-पेज है। वास्तविक विक्रेता, भुगतान या संबद्ध लिंक जुड़ने पर इस पेज का खरीदें/देखें बटन आपको वहाँ ले जाएगा।","notFound":"सामग्री नहीं मिली।","requestId":"अनुरोध ID","notFoundDetail":"व्यक्तिगत डेटा फ़ाइल और मौजूदा स्नैपशॉट की जाँच की गई, लेकिन कोई मेल खाता उत्पाद या सामग्री नहीं मिली।"},"tr":{"pageTitle":"Ürün ayrıntıları | IGDC","descriptionReady":"Ürün ayrıntıları hazırlanıyor.","details":"Ayrıntıları görüntüle","imageReady":"Görsel hazırlanıyor","connectionReady":"Bağlantı hazırlanıyor","note":"Bu, IGDC’nin dahili ürün tek sayfasıdır. Gerçek satıcı, ödeme veya iş ortaklığı bağlantısı bağlandığında bu sayfadaki Satın Al/Ziyaret Et düğmesi sizi ilgili bağlantıya yönlendirecektir.","notFound":"İçerik bulunamadı.","requestId":"İstek kimliği","notFoundDetail":"Tekil veri dosyası ve mevcut anlık görüntüler kontrol edildi, ancak eşleşen ürün veya içerik bulunamadı."},"fa":{"pageTitle":"جزئیات محصول | IGDC","descriptionReady":"اطلاعات کامل محصول در حال آماده‌سازی است.","details":"مشاهده جزئیات","imageReady":"تصویر در حال آماده‌سازی است","connectionReady":"اتصال در حال آماده‌سازی است","note":"این صفحه، صفحه داخلی محصول IGDC است. پس از اتصال لینک واقعی فروشنده، پرداخت یا همکاری، دکمه خرید/بازدید در این صفحه شما را به آن هدایت می‌کند.","notFound":"محتوا پیدا نشد.","requestId":"شناسه درخواست","notFoundDetail":"فایل داده جداگانه و اسنپ‌شات‌های فعلی بررسی شدند، اما محصول یا محتوای منطبق پیدا نشد."},"bn":{"pageTitle":"পণ্যের বিস্তারিত | IGDC","descriptionReady":"পণ্যের বিস্তারিত তথ্য প্রস্তুত করা হচ্ছে।","details":"বিস্তারিত দেখুন","imageReady":"ছবি প্রস্তুত করা হচ্ছে","connectionReady":"সংযোগ প্রস্তুত করা হচ্ছে","note":"এটি IGDC-এর অভ্যন্তরীণ পণ্য এক-পৃষ্ঠা। প্রকৃত বিক্রেতা, পেমেন্ট বা অ্যাফিলিয়েট লিংক সংযুক্ত হলে এই পৃষ্ঠার ক্রয়/ভিজিট বোতামটি সেখানে নিয়ে যাবে।","notFound":"কনটেন্ট পাওয়া যায়নি।","requestId":"অনুরোধ ID","notFoundDetail":"আলাদা ডেটা ফাইল ও বর্তমান স্ন্যাপশট পরীক্ষা করা হয়েছে, কিন্তু মিল থাকা কোনো পণ্য বা কনটেন্ট পাওয়া যায়নি।"},"ur":{"pageTitle":"مصنوعات کی تفصیل | IGDC","descriptionReady":"مصنوعات کی تفصیلی معلومات تیار کی جا رہی ہیں۔","details":"تفصیل دیکھیں","imageReady":"تصویر تیار کی جا رہی ہے","connectionReady":"رابطہ تیار کیا جا رہا ہے","note":"یہ IGDC کا داخلی پروڈکٹ ون پیج ہے۔ اصل فروخت کنندہ، ادائیگی یا افیلی ایٹ لنک منسلک ہونے کے بعد اس صفحے کا خریدیں/ملاحظہ کریں بٹن آپ کو وہاں لے جائے گا۔","notFound":"مواد نہیں ملا۔","requestId":"درخواست ID","notFoundDetail":"انفرادی ڈیٹا فائل اور موجودہ اسنیپ شاٹس کی جانچ کی گئی، لیکن کوئی مماثل پروڈکٹ یا مواد نہیں ملا۔"},"sw":{"pageTitle":"Maelezo ya bidhaa | IGDC","descriptionReady":"Maelezo ya kina ya bidhaa yanaandaliwa.","details":"Tazama maelezo","imageReady":"Picha inaandaliwa","connectionReady":"Muunganisho unaandaliwa","note":"Huu ni ukurasa wa ndani wa bidhaa wa IGDC. Kiungo halisi cha muuzaji, malipo au ushirika kitakapounganishwa, kitufe cha Nunua/Tembelea kwenye ukurasa huu kitakupeleka huko.","notFound":"Maudhui hayajapatikana.","requestId":"Kitambulisho cha ombi","notFoundDetail":"Faili binafsi ya data na picha za sasa zilikaguliwa, lakini hakuna bidhaa au maudhui yanayolingana yaliyopatikana."},"ta":{"pageTitle":"தயாரிப்பு விவரங்கள் | IGDC","descriptionReady":"தயாரிப்பின் விரிவான தகவல் தயாராகிக் கொண்டிருக்கிறது.","details":"விவரங்களைப் பார்க்க","imageReady":"படம் தயாராகிக் கொண்டிருக்கிறது","connectionReady":"இணைப்பு தயாராகிக் கொண்டிருக்கிறது","note":"இது IGDC-யின் உள்துறை தயாரிப்பு ஒரே பக்கம். உண்மையான விற்பனையாளர், கட்டணம் அல்லது இணைப்பு கூட்டாளர் தொடுப்பு இணைக்கப்பட்டதும், இந்தப் பக்கத்தின் வாங்கு/பார் பொத்தான் அங்கு அழைத்துச் செல்லும்.","notFound":"உள்ளடக்கம் கிடைக்கவில்லை.","requestId":"கோரிக்கை ID","notFoundDetail":"தனிப்பட்ட தரவு கோப்பும் தற்போதைய ஸ்னாப்ஷாட்களும் சரிபார்க்கப்பட்டன; பொருந்தும் தயாரிப்பு அல்லது உள்ளடக்கம் எதுவும் கிடைக்கவில்லை."},"hu":{"pageTitle":"Termékadatok | IGDC","descriptionReady":"A termék részletes adatai előkészítés alatt állnak.","details":"Részletek megtekintése","imageReady":"A kép előkészítés alatt","connectionReady":"A kapcsolat előkészítés alatt","note":"Ez az IGDC belső termékoldala. A tényleges eladói, fizetési vagy partnerlink csatlakoztatása után az ezen az oldalon található Vásárlás/Látogatás gomb oda vezet.","notFound":"A tartalom nem található.","requestId":"Kérésazonosító","notFoundDetail":"Az egyedi adatfájlt és az aktuális pillanatképeket ellenőriztük, de nem találtunk egyező terméket vagy tartalmat."},"ms":{"pageTitle":"Butiran produk | IGDC","descriptionReady":"Maklumat terperinci produk sedang disediakan.","details":"Lihat butiran","imageReady":"Imej sedang disediakan","connectionReady":"Sambungan sedang disediakan","note":"Ini ialah halaman produk dalaman IGDC. Apabila pautan penjual, pembayaran atau afiliasi sebenar disambungkan, butang Beli/Lawati pada halaman ini akan membawa anda ke sana.","notFound":"Kandungan tidak ditemui.","requestId":"ID permintaan","notFoundDetail":"Fail data individu dan snapshot semasa telah diperiksa, tetapi tiada produk atau kandungan yang sepadan ditemui."},"nl":{"pageTitle":"Productdetails | IGDC","descriptionReady":"De gedetailleerde productinformatie wordt voorbereid.","details":"Details bekijken","imageReady":"Afbeelding wordt voorbereid","connectionReady":"Verbinding wordt voorbereid","note":"Dit is een interne IGDC-productpagina. Zodra de daadwerkelijke verkopers-, betaal- of affiliatelink is verbonden, brengt de knop Kopen/Bezoeken op deze pagina u daarheen.","notFound":"Inhoud niet gevonden.","requestId":"Aanvraag-ID","notFoundDetail":"Het afzonderlijke gegevensbestand en de huidige snapshots zijn gecontroleerd, maar er is geen overeenkomend product of inhoud gevonden."},"pl":{"pageTitle":"Szczegóły produktu | IGDC","descriptionReady":"Szczegółowe informacje o produkcie są przygotowywane.","details":"Zobacz szczegóły","imageReady":"Obraz jest przygotowywany","connectionReady":"Połączenie jest przygotowywane","note":"To jest wewnętrzna strona produktu IGDC. Po podłączeniu właściwego linku sprzedawcy, płatności lub programu partnerskiego przycisk Kup/Odwiedź na tej stronie przeniesie do niego.","notFound":"Nie znaleziono treści.","requestId":"Identyfikator żądania","notFoundDetail":"Sprawdzono indywidualny plik danych i bieżące migawki, ale nie znaleziono pasującego produktu ani treści."},"sv":{"pageTitle":"Produktinformation | IGDC","descriptionReady":"Detaljerad produktinformation förbereds.","details":"Visa detaljer","imageReady":"Bilden förbereds","connectionReady":"Anslutningen förbereds","note":"Detta är en intern IGDC-produktsida. När den faktiska säljar-, betalnings- eller affiliatelänken är ansluten tar knappen Köp/Besök på den här sidan dig dit.","notFound":"Innehållet hittades inte.","requestId":"Begärande-ID","notFoundDetail":"Den enskilda datafilen och de aktuella ögonblicksbilderna kontrollerades, men ingen matchande produkt eller något matchande innehåll hittades."},"tl":{"pageTitle":"Detalye ng produkto | IGDC","descriptionReady":"Inihahanda ang detalyadong impormasyon ng produkto.","details":"Tingnan ang detalye","imageReady":"Inihahanda ang larawan","connectionReady":"Inihahanda ang koneksyon","note":"Ito ay panloob na one-page ng produkto ng IGDC. Kapag nakakonekta na ang aktuwal na link ng nagbebenta, pagbabayad, o affiliate, dadalhin ka roon ng button na Bumili/Bumisita sa pahinang ito.","notFound":"Hindi nahanap ang nilalaman.","requestId":"Request ID","notFoundDetail":"Sinuri ang hiwalay na data file at mga kasalukuyang snapshot, ngunit walang nakitang tumutugmang produkto o nilalaman."},"uk":{"pageTitle":"Відомості про товар | IGDC","descriptionReady":"Детальна інформація про товар готується.","details":"Переглянути деталі","imageReady":"Зображення готується","connectionReady":"Підключення готується","note":"Це внутрішня односторінкова картка товару IGDC. Після підключення фактичного посилання продавця, оплати або партнера кнопка «Купити/Відвідати» на цій сторінці переведе за ним.","notFound":"Вміст не знайдено.","requestId":"ID запиту","notFoundDetail":"Ми перевірили окремий файл даних і поточні знімки, але відповідного товару чи вмісту не знайдено."},"uz":{"pageTitle":"Mahsulot tafsilotlari | IGDC","descriptionReady":"Mahsulotning batafsil ma’lumotlari tayyorlanmoqda.","details":"Tafsilotlarni ko‘rish","imageReady":"Rasm tayyorlanmoqda","connectionReady":"Ulanish tayyorlanmoqda","note":"Bu IGDC ichki mahsulot sahifasi. Haqiqiy sotuvchi, to‘lov yoki hamkorlik havolasi ulangach, ushbu sahifadagi Xarid qilish/Tashrif buyurish tugmasi sizni o‘sha manzilga olib boradi.","notFound":"Kontent topilmadi.","requestId":"So‘rov ID","notFoundDetail":"Alohida ma’lumot fayli va joriy suratlar tekshirildi, biroq mos mahsulot yoki kontent topilmadi."}};
  const RTL_LANGS = new Set(['ar','fa','ur']);

  function normalizeLang(raw){
    let s = String(raw || '').trim().toLowerCase().replace(/_/g,'-');
    if (!s) return '';
    if (s === 'zh-tw' || s === 'zh-hk' || s === 'zh-mo' || s === 'zh-hant' || s === 'zht') return 'zht';
    if (s === 'fil' || s.indexOf('fil-') === 0) return 'tl';
    if (CONTENT_I18N[s]) return s;
    const base = s.split('-')[0];
    return CONTENT_I18N[base] ? base : '';
  }

  function langFromReferrer(){
    try {
      if (!document.referrer) return '';
      const path = new URL(document.referrer, window.location.href).pathname.toLowerCase();
      const dirMatch = path.match(/\/(ar|bn|de|en|es|fa|fr|hi|hu|id|it|ja|ms|nl|pl|pt|ru|sv|sw|ta|th|tl|tr|uk|ur|uz|vi|zh|zht)\//);
      if (dirMatch) return normalizeLang(dirMatch[1]);
      const fileMatch = path.match(/_([a-z]{2,3})\.html$/);
      if (fileMatch) return normalizeLang(fileMatch[1]);
      if (/\/(?:home|networkhub|distributionhub|tour|social|media|donation)\.html$/.test(path)) return 'ko';
    } catch(e) {}
    return '';
  }

  function detectContentLang(){
    let saved = '';
    try { saved = localStorage.getItem('igdc_lang') || localStorage.getItem('igtc_lang') || ''; } catch(e) {}
    return normalizeLang(getParam('lang'))
      || langFromReferrer()
      || normalizeLang(window.IGTC_CURRENT_LANG)
      || normalizeLang(saved)
      || normalizeLang(document.documentElement && document.documentElement.lang)
      || normalizeLang(navigator.language)
      || 'ko';
  }

  const CONTENT_LANG = detectContentLang();
  function tr(key){
    const table = CONTENT_I18N[CONTENT_LANG] || CONTENT_I18N.ko;
    return table[key] || CONTENT_I18N.ko[key] || '';
  }

  function applyContentLanguage(){
    try {
      document.documentElement.lang = CONTENT_LANG === 'zht' ? 'zh-Hant' : CONTENT_LANG;
      document.documentElement.dir = RTL_LANGS.has(CONTENT_LANG) ? 'rtl' : 'ltr';
      document.title = tr('pageTitle');
    } catch(e) {}
  }

  function getParam(name){
    try { return new URL(window.location.href).searchParams.get(name); }
    catch(e){ return null; }
  }

  function rootEl(){ return document.getElementById('content-root') || document.body; }

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function pick(obj, keys){
    for (const k of keys){
      const v = obj && obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return '';
  }

  function pad3(n){
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '001';
    return String(Math.floor(x)).padStart(3, '0');
  }

  function isBadUrl(url){
    const u = String(url || '').trim();
    if (!u) return true;
    if (u === '#') return true;
    if (/^javascript:/i.test(u)) return true;
    if (/^about:blank$/i.test(u)) return true;
    return false;
  }

  function isExampleUrl(url){
    const u = String(url || '').trim();
    if (!u) return false;
    try {
      const parsed = new URL(u, window.location.origin);
      return /(^|\.)example\.(com|org|net)$/i.test(parsed.hostname);
    } catch(e) {
      return /example\.(com|org|net)/i.test(u);
    }
  }

  function usableUrl(url){
    const u = String(url || '').trim();
    if (isBadUrl(u) || isExampleUrl(u)) return '';
    return u;
  }

  function lastNumberFromUrl(url){
    try {
      const parsed = new URL(url, window.location.origin);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      const m = last.match(/(\d+)/);
      return m ? Number(m[1]) : null;
    } catch(e){
      const m = String(url || '').match(/(\d+)(?!.*\d)/);
      return m ? Number(m[1]) : null;
    }
  }

  function stableIdForItem(item, ctx, index){
    const explicit = pick(item, ['id','contentId','productId','itemId','sku','code','pid']);
    if (explicit) return explicit;

    const section = (ctx && ctx.section) || pick(item, ['section','key','slot']) || '';
    const page = (ctx && ctx.page) || pick(item, ['page','hub']) || '';
    const base = section || page || 'content';
    const n = Number(item && (item.priority || item.order || item.rank)) || lastNumberFromUrl(item && (item.url || item.link || item.href)) || (Number(index) + 1) || 1;
    return base + '-' + pad3(n);
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' @ ' + url);
    return await res.json();
  }

  async function tryDirect(id){
    try {
      const data = await fetchJson(DIRECT_DATA_PREFIX + encodeURIComponent(id) + '.json');
      return normalizeContent(data, { source:'direct', page:data && data.page, section:data && data.section, matchedId:id }, 0);
    } catch(e){
      return null;
    }
  }

  function addCandidate(out, item, ctx, index){
    if (!item || typeof item !== 'object') return;
    const ids = new Set();
    const explicit = pick(item, ['id','contentId','productId','itemId','sku','code','pid']);
    if (explicit) ids.add(explicit);
    ids.add(stableIdForItem(item, ctx, index));

    for (const id of ids){
      if (!id) continue;
      out.push({ id:String(id), item, ctx, index });
    }
  }

  function collectCandidates(data, sourceName){
    const out = [];

    function walk(value, ctx){
      if (!value) return;

      if (Array.isArray(value)){
        value.forEach((item, idx) => {
          if (item && typeof item === 'object') addCandidate(out, item, ctx || {}, idx);
        });
        return;
      }

      if (typeof value !== 'object') return;

      if (value.pages && typeof value.pages === 'object'){
        for (const [pageName, pageObj] of Object.entries(value.pages)){
          const sections = pageObj && pageObj.sections;
          if (sections && typeof sections === 'object'){
            for (const [sectionName, list] of Object.entries(sections)){
              walk(list, { source:sourceName, page:pageName, section:sectionName });
            }
          }
        }
      }

      if (Array.isArray(value.items)) walk(value.items, { source:sourceName, page:value.page || sourceName, section:value.key || 'items' });
      if (Array.isArray(value.slots)) walk(value.slots, { source:sourceName, page:value.page || sourceName, section:'slots' });

      if (value.sections && typeof value.sections === 'object'){
        for (const [sectionName, list] of Object.entries(value.sections)){
          walk(list, { source:sourceName, page:value.page || sourceName, section:sectionName });
        }
      }

      if (value.layers && typeof value.layers === 'object'){
        for (const [layerName, layerVal] of Object.entries(value.layers)){
          if (layerVal && typeof layerVal === 'object'){
            if (Array.isArray(layerVal.items)) walk(layerVal.items, { source:sourceName, page:value.page || sourceName, section:layerName });
            if (Array.isArray(layerVal.slots)) walk(layerVal.slots, { source:sourceName, page:value.page || sourceName, section:layerName });
          }
        }
      }
    }

    walk(data, { source:sourceName, page:sourceName, section:'' });
    return out;
  }

  function inferType(item, ctx, fallback){
    const raw = String((item && item.type) || '').toLowerCase();
    if (raw === 'media' || raw === 'video') return 'media';
    if (raw === 'commerce' || raw === 'product' || raw === 'shop') return 'commerce';
    const page = String((ctx && ctx.page) || '').toLowerCase();
    if (page.indexOf('media') >= 0) return 'media';
    return fallback || 'commerce';
  }

  function normalizeContent(item, ctx, index, fallbackType){
    const id = (ctx && ctx.matchedId) || stableIdForItem(item || {}, ctx || {}, index || 0);
    const title = pick(item, ['title','name','label','caption']) || id;
    const image = pick(item, ['image','thumb','thumbnail','img','photo','cover','coverUrl','thumbnailUrl']);
    const video = pick(item, ['video','videoUrl','mediaUrl','src']);
    const rawDescription = pick(item, ['description','summary','desc','body','content']);
    const description = (!rawDescription || rawDescription === '상품 상세 정보가 준비 중입니다.') ? tr('descriptionReady') : rawDescription;
    const price = pick(item, ['price','salePrice','amount']);
    const currency = pick(item, ['currency']) || '';
    const rawCta = pick(item, ['cta','buttonText']);
    const cta = (!rawCta || rawCta === '자세히 보기') ? tr('details') : rawCta;
    // A provider-approved affiliate route wins only when snapshot generation
    // has already verified the explicit non-PG contract. Ordinary seller URLs
    // keep their original visit behavior and are never converted by default.
    const affiliateOutboundUrl = usableUrl(pick(item, ['affiliateOutboundUrl','affiliate_outbound_url']));
    const externalUrl = affiliateOutboundUrl || usableUrl(
      pick(item, ['checkoutUrl','paymentUrl','productUrl','purchaseUrl','orderUrl','detailUrl','contentUrl','pageUrl','url','href','link']) ||
      (item && item.detail && pick(item.detail, ['detailUrl','url'])) ||
      ''
    );

    return {
      id,
      type: inferType(item, ctx, fallbackType),
      title,
      image,
      video,
      description,
      price,
      currency,
      cta,
      externalUrl,
      affiliateOutbound: !!affiliateOutboundUrl,
      affiliateProviderId: item && item.affiliate && item.affiliate.providerId ? String(item.affiliate.providerId) : '',
      page: (ctx && ctx.page) || pick(item, ['page','hub']) || '',
      section: (ctx && ctx.section) || pick(item, ['section','key']) || '',
      raw: item || {}
    };
  }

  async function findInSnapshots(id){
    const target = String(id || '').trim();
    if (!target) return null;

    for (const source of SNAPSHOT_SOURCES){
      try {
        const data = await fetchJson(source.url);
        const candidates = collectCandidates(data, source.name);
        for (const c of candidates){
          if (String(c.id) === target){
            c.ctx = c.ctx || {};
            c.ctx.matchedId = target;
            return normalizeContent(c.item, c.ctx, c.index, source.defaultType);
          }
        }
      } catch(e){
        // Continue to next snapshot. Missing optional snapshots must not break content page.
      }
    }
    return null;
  }

  function installBaseStyle(){
    if (document.getElementById('igdc-content-engine-style')) return;
    const style = document.createElement('style');
    style.id = 'igdc-content-engine-style';
    style.textContent = `
      body{ margin:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f7fb; color:#172033; }
      .igdc-content-page{ max-width:1120px; margin:0 auto; padding:28px 18px 42px; }
      .igdc-content-card{ background:#fff; border:1px solid #e5e8ef; border-radius:18px; box-shadow:0 8px 24px rgba(12,24,48,.08); overflow:hidden; }
      .igdc-content-hero{ display:grid; grid-template-columns:minmax(260px,420px) 1fr; gap:28px; padding:28px; }
      .igdc-content-media{ min-height:280px; border-radius:14px; background:#eef1f6; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      .igdc-content-media img,.igdc-content-media video{ width:100%; height:100%; max-height:480px; object-fit:cover; display:block; }
      .igdc-content-placeholder{ color:#7a8498; font-weight:700; text-align:center; padding:24px; }
      .igdc-content-title{ margin:0 0 12px; font-size:clamp(24px,3vw,38px); line-height:1.2; color:#10182d; }
      .igdc-content-meta{ display:flex; flex-wrap:wrap; gap:8px; margin:0 0 18px; }
      .igdc-pill{ display:inline-flex; align-items:center; border:1px solid #d8deea; background:#f8faff; color:#526078; border-radius:999px; padding:5px 10px; font-size:13px; font-weight:700; }
      .igdc-content-desc{ color:#364155; font-size:16px; line-height:1.75; white-space:pre-wrap; }
      .igdc-price{ font-size:22px; font-weight:900; color:#0c4da2; margin:18px 0 0; }
      .igdc-actions{ display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; }
      .igdc-btn{ display:inline-flex; align-items:center; justify-content:center; min-height:42px; padding:0 18px; border-radius:10px; font-weight:800; text-decoration:none; border:1px solid #0c4da2; background:#0c4da2; color:#fff; }
      .igdc-btn.secondary{ background:#fff; color:#0c4da2; }
      .igdc-content-note{ border-top:1px solid #edf0f5; padding:18px 28px; color:#6b7588; font-size:14px; line-height:1.6; }
      .igdc-content-error{ max-width:720px; margin:40px auto; padding:24px; border-radius:14px; background:#fff; border:1px solid #e5e8ef; color:#26324a; }
      @media(max-width:760px){ .igdc-content-hero{ grid-template-columns:1fr; padding:18px; } .igdc-content-media{ min-height:220px; } .igdc-content-note{ padding:16px 18px; } }
    `;
    document.head.appendChild(style);
  }

  function isPreparationOnlyContent(data){
    const raw = data && data.raw && typeof data.raw === 'object' ? data.raw : {};
    const marker = [
      raw.placeholder, raw.isPlaceholder, raw.replaceableSlot, raw.isLayerPointer,
      raw.type, raw.kind, raw.title, raw.name, raw.summary, raw.description,
      raw.url, raw.href, raw.link
    ].map(function(v){ return String(v == null ? '' : v); }).join(' ').toLowerCase();

    if (raw.placeholder === true || raw.isPlaceholder === true || raw.replaceableSlot === true || raw.isLayerPointer === true) return true;
    if (/(^|\W)(sample|placeholder|dummy|seed\s*slot|replaceable-front-slot)(\W|$)/i.test(marker)) return true;
    if (/example\.(com|org|net|edu)/i.test(marker)) return true;
    if (/준비\s*중|prepar(?:ing|ation)|coming\s*soon/i.test(marker) && !data.externalUrl) return true;
    return !data.externalUrl;
  }

  function armProductEscapeReturn(){
    try{
      if (!window.parent || window.parent === window) return;
      const p = window.parent;
      const pd = p.document;
      const frame = pd && pd.getElementById ? pd.getElementById('mainFrame') : null;
      if (!frame || frame.contentWindow !== window) return;

      let state = p.__IGDC_PRODUCT_ESCAPE_RETURN__;
      if (!state || typeof state !== 'object'){
        state = p.__IGDC_PRODUCT_ESCAPE_RETURN__ = {
          active:false,
          installed:false,
          returning:false,
          returnHref:'',
          frame:null,
          sentinel:null,
          focusTimer:0
        };
      }

      state.active = true;
      state.returning = false;
      state.returnHref = document.referrer || state.returnHref || '';
      state.frame = frame;

      function ensureSentinel(){
        let s = pd.getElementById('igdcProductEscapeSentinel');
        if (!s){
          s = pd.createElement('button');
          s.id = 'igdcProductEscapeSentinel';
          s.type = 'button';
          s.tabIndex = -1;
          s.setAttribute('aria-hidden','true');
          s.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0;';
          (pd.body || pd.documentElement).appendChild(s);
        }
        state.sentinel = s;
        return s;
      }

      function stopFocusGuard(){
        if (state.focusTimer){
          try{ p.clearInterval(state.focusTimer); }catch(_){}
          state.focusTimer = 0;
        }
      }

      function focusParentShell(){
        if (!state.active || state.returning) return;
        try{
          if (typeof pd.hasFocus === 'function' && !pd.hasFocus()) return;
        }catch(_){}
        try{
          const s = ensureSentinel();
          if (pd.activeElement === state.frame || pd.activeElement === pd.body || !pd.activeElement){
            if (s && s.focus) s.focus({preventScroll:true});
          }
        }catch(_){}
      }

      function startFocusGuard(){
        stopFocusGuard();
        state.focusTimer = p.setInterval(function(){
          if (!state.active || state.returning){
            stopFocusGuard();
            return;
          }
          try{
            if (pd.activeElement === state.frame) focusParentShell();
          }catch(_){}
        }, 100);
      }

      function goBackLikeBrowser(){
        if (!state.active || state.returning) return;
        state.returning = true;
        state.active = false;
        stopFocusGuard();

        // Use the joint browser history. This is the same navigation action
        // as clicking the browser's upper-left Back arrow.
        let moved = false;
        try{
          if (p.history && typeof p.history.back === 'function'){
            p.history.back();
            moved = true;
          }
        }catch(_){}

        // Fallback only when browser history cannot be used.
        if (!moved && state.frame && state.returnHref){
          try{ state.frame.src = state.returnHref; }catch(_){}
        }

        p.setTimeout(function(){
          state.returning = false;
        }, 500);
      }

      if (!state.installed){
        state.installed = true;

        p.addEventListener('keydown', function(ev){
          if (!state.active || state.returning || ev.key !== 'Escape') return;
          try{ ev.preventDefault(); }catch(_){}
          try{ ev.stopPropagation(); }catch(_){}
          goBackLikeBrowser();
        }, true);

        // A cross-origin seller page inside mainFrame owns keyboard focus after
        // navigation/clicks. Reclaim only keyboard focus (not mouse behavior)
        // so Escape always reaches the IGDC shell.
        p.addEventListener('blur', function(){
          if (!state.active || state.returning) return;
          p.setTimeout(focusParentShell, 0);
          p.setTimeout(focusParentShell, 60);
        }, true);

        pd.addEventListener('focusout', function(){
          if (!state.active || state.returning) return;
          p.setTimeout(focusParentShell, 0);
        }, true);

        frame.addEventListener('load', function(){
          if (!state.active || state.returning) return;

          // If the frame is readable and is back on an IGDC page, the return
          // has completed; disable the Escape guard.
          try{
            const href = frame.contentWindow && frame.contentWindow.location
              ? String(frame.contentWindow.location.href || '')
              : '';
            if (href && !/\/content\.html(?:[?#]|$)/i.test(href)){
              const u = new URL(href, p.location.href);
              if (u.origin === p.location.origin){
                state.active = false;
                stopFocusGuard();
                return;
              }
            }
          }catch(_){
            // Cross-origin seller page: keep the Escape guard active.
          }

          p.setTimeout(focusParentShell, 0);
          p.setTimeout(focusParentShell, 80);
          p.setTimeout(focusParentShell, 250);
          startFocusGuard();
        }, true);
      }

      // Arm the guard before content.html is replaced by the seller page.
      p.setTimeout(focusParentShell, 0);
      startFocusGuard();
    }catch(_){}
  }

  function openResolvedOriginalInsideIgdc(data){
    if (!data || !data.externalUrl || isPreparationOnlyContent(data)) return false;
    try {
      const target = new URL(String(data.externalUrl), window.location.href);
      if (!/^https?:$/.test(target.protocol)) return false;
      // Arm one-step Escape return before content.html is replaced by the seller page.
      armProductEscapeReturn();
      // content.html itself is loaded in the IGDC mainFrame. Replacing THIS frame
      // preserves the IGDC shell/header and removes the preparation-page hop.
      window.location.replace(target.href);
      return true;
    } catch(e) {
      return false;
    }
  }

  function renderContent(data){
    if (openResolvedOriginalInsideIgdc(data)) return;
    installBaseStyle();
    const root = rootEl();
    const img = data.image ? `<img src="${esc(data.image)}" alt="${esc(data.title)}" loading="lazy" decoding="async">` : '';
    const video = data.video ? `<video controls playsinline><source src="${esc(data.video)}"></video>` : '';
    const media = video || img || `<div class="igdc-content-placeholder">${esc(tr('imageReady'))}</div>`;
    const price = data.price ? `<div class="igdc-price">${esc(data.price)} ${esc(data.currency)}</div>` : '';
    const visit = data.externalUrl
      ? `<a class="igdc-btn" href="${esc(data.externalUrl)}" target="_self" rel="noopener" data-igdc-external="frame" data-maru-revenue="1" data-item-id="${esc(data.id)}" data-revenue-line="${data.affiliateOutbound ? 'product_affiliate' : 'content_visit'}"${data.affiliateOutbound ? ' data-affiliate-outbound="1"' : ''}${data.affiliateProviderId ? ' data-affiliate-provider="' + esc(data.affiliateProviderId) + '"' : ''}>${esc(data.cta || tr('details'))}</a>`
      : `<span class="igdc-btn secondary" aria-disabled="true">${esc(tr('connectionReady'))}</span>`;

    root.innerHTML = `
      <main class="igdc-content-page" data-content-id="${esc(data.id)}" data-content-page="${esc(data.page)}" data-content-section="${esc(data.section)}">
        <article class="igdc-content-card">
          <section class="igdc-content-hero">
            <div class="igdc-content-media">${media}</div>
            <div>
              <h1 class="igdc-content-title">${esc(data.title)}</h1>
              <div class="igdc-content-meta">
                <span class="igdc-pill">${esc(data.page || 'IGDC')}</span>
                ${data.section ? `<span class="igdc-pill">${esc(data.section)}</span>` : ''}
                <span class="igdc-pill">ID: ${esc(data.id)}</span>
              </div>
              <div class="igdc-content-desc">${esc(data.description)}</div>
              ${price}
              <div class="igdc-actions">${visit}</div>
            </div>
          </section>
          <div class="igdc-content-note">
            ${esc(tr('note'))}
          </div>
        </article>
      </main>
    `;
  }

  function renderMissing(id){
    installBaseStyle();
    rootEl().innerHTML = `
      <div class="igdc-content-error">
        <h1>${esc(tr('notFound'))}</h1>
        <p>${esc(tr('requestId'))}: <strong>${esc(id || '')}</strong></p>
        <p>${esc(tr('notFoundDetail'))}</p>
      </div>
    `;
  }

  async function init(){
    applyContentLanguage();
    const id = getParam('id');
    if (!id){
      renderMissing('');
      return;
    }

    let data = await tryDirect(id);
    if (!data) data = await findInSnapshots(id);

    if (!data){
      renderMissing(id);
      return;
    }

    renderContent(data);

    try {
      if (window.ActivityEngine && typeof window.ActivityEngine.recordView === 'function') {
        window.ActivityEngine.recordView(id);
      }
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();
