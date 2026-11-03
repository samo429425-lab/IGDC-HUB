/* IGDC commerce safety notice — Home + Distribution, 30 locales.
 * This presentation-only script does not alter product links, country/IP routing,
 * PSOM, snapshots, commerce approval, or shopping/checkout behavior.
 * Loaded by the two hub-specific shared scripts; no localized HTML changes.
 */
(function () {
  'use strict';
  var NOTICE_ID = 'igdc-commerce-safety-notice';

  var path = String(window.location.pathname || '').toLowerCase();
  var home = /(?:^|\/)home(?:_[a-z]+)?(?:\.html)?\/?$/.test(path);
  var distribution = /(?:^|\/)distributionhub(?:_[a-z]+)?(?:\.html)?\/?$/.test(path);
  if (!home && !distribution) return;

  // Each value is [heading, short explanation]. Never say that shoppers bear
  // all liability, or that this notice eliminates IGDC's legal duties.
  var i18n = {
    ko: ['안전거래 안내', 'IGDC는 상품의 광고·홍보 및 판매처 연결 서비스를 제공하며, 직접 판매하거나 결제·배송을 처리하지 않습니다. 상품 구매 시 판매업체의 신뢰성과 배송·교환·환불 조건을 충분히 확인하시기 바랍니다.'],
    en: ['Safe shopping notice', 'IGDC promotes products and links to sellers; it does not sell, process payments or ship goods directly. Sellers handle sales, delivery, returns, refunds and after-sales service. Please check the seller and terms before buying.'],
    ar: ['تنبيه للتسوق الآمن', 'تروّج IGDC للمنتجات وتوفّر روابط للبائعين، ولا تبيع المنتجات أو تعالج المدفوعات أو تشحنها مباشرةً. يتولى البائعون البيع والتوصيل والإرجاع والاسترداد وخدمة ما بعد البيع. يُرجى التحقق من البائع وشروط المعاملة قبل الشراء.'],
    bn: ['নিরাপদ কেনাকাটার বিজ্ঞপ্তি', 'IGDC পণ্যের প্রচার করে এবং বিক্রেতার সঙ্গে সংযোগ করিয়ে দেয়; সরাসরি বিক্রয়, অর্থ গ্রহণ বা পণ্য পাঠায় না। বিক্রয়, সরবরাহ, ফেরত, অর্থ ফেরত ও বিক্রয়োত্তর সেবার দায়িত্ব বিক্রেতার। কেনার আগে বিক্রেতা ও শর্ত যাচাই করুন।'],
    de: ['Hinweis zum sicheren Einkauf', 'IGDC bewirbt Produkte und verlinkt auf Anbieter; IGDC verkauft, kassiert und versendet nicht selbst. Verkauf, Lieferung, Rückgabe, Erstattung und Kundendienst liegen beim Anbieter. Bitte prüfen Sie Anbieter und Bedingungen vor dem Kauf.'],
    es: ['Aviso de compra segura', 'IGDC promociona productos y enlaza con vendedores; no vende, cobra ni envía productos directamente. La venta, entrega, devolución, reembolso y atención posventa corresponden al vendedor. Compruebe el vendedor y las condiciones antes de comprar.'],
    fa: ['راهنمای خرید ایمن', 'IGDC محصولات را معرفی می‌کند و به فروشندگان پیوند می‌دهد؛ خود مستقیماً فروش، پرداخت یا ارسال انجام نمی‌دهد. مسئولیت فروش، تحویل، مرجوعی، بازپرداخت و خدمات پس از فروش با فروشنده است. پیش از خرید، فروشنده و شرایط معامله را بررسی کنید.'],
    fr: ['Avis de sécurité des achats', 'IGDC fait la promotion de produits et oriente vers les vendeurs, sans vendre, encaisser ni expédier directement. Le vendeur gère la vente, la livraison, les retours, les remboursements et le service après-vente. Vérifiez le vendeur et ses conditions avant tout achat.'],
    hi: ['सुरक्षित खरीदारी सूचना', 'IGDC उत्पादों का प्रचार कर विक्रेताओं से जोड़ता है; यह सीधे बिक्री, भुगतान या डिलीवरी नहीं करता। बिक्री, डिलीवरी, वापसी, धनवापसी और बिक्री के बाद सेवा की ज़िम्मेदारी विक्रेता की है। खरीदने से पहले विक्रेता और शर्तों की जाँच करें।'],
    hu: ['Biztonságos vásárlási tájékoztató', 'Az IGDC termékeket népszerűsít és eladókhoz irányít; közvetlenül nem értékesít, nem kezel fizetést és nem szállít. Az eladás, szállítás, visszaküldés, visszatérítés és ügyfélszolgálat az eladó feladata. Vásárlás előtt ellenőrizze az eladót és a feltételeket.'],
    id: ['Pemberitahuan belanja aman', 'IGDC mempromosikan produk dan menghubungkan Anda ke penjual; IGDC tidak menjual, memproses pembayaran, atau mengirim barang secara langsung. Penjual menangani penjualan, pengiriman, retur, pengembalian dana, dan layanan purnajual. Periksa penjual dan ketentuannya sebelum membeli.'],
    it: ['Avviso per acquisti sicuri', 'IGDC promuove prodotti e rimanda ai venditori; non vende, incassa pagamenti né spedisce direttamente. Vendita, consegna, resi, rimborsi e assistenza post-vendita sono gestiti dal venditore. Verifica il venditore e le condizioni prima di acquistare.'],
    ja: ['安全なお取引について', 'IGDCは商品の広告・紹介と販売店への案内を行い、直接の販売・決済・配送は行いません。販売・配送・返品・返金・アフターサービスは各販売店が対応します。購入前に販売店と取引条件をご確認ください。'],
    ms: ['Notis pembelian selamat', 'IGDC mempromosikan produk dan menghubungkan pengguna kepada penjual; IGDC tidak menjual, memproses bayaran atau menghantar barang secara langsung. Penjual mengurus jualan, penghantaran, pemulangan, bayaran balik dan khidmat selepas jualan. Semak penjual dan syarat sebelum membeli.'],
    nl: ['Mededeling veilig winkelen', 'IGDC promoot producten en verwijst naar verkopers; IGDC verkoopt, verwerkt betalingen en verzendt niet zelf. De verkoper verzorgt verkoop, levering, retouren, terugbetalingen en service na verkoop. Controleer de verkoper en voorwaarden vóór aankoop.'],
    pl: ['Informacja o bezpiecznych zakupach', 'IGDC promuje produkty i kieruje do sprzedawców; nie prowadzi bezpośredniej sprzedaży, płatności ani wysyłki. Za sprzedaż, dostawę, zwroty, refundacje i obsługę posprzedażową odpowiada sprzedawca. Przed zakupem sprawdź sprzedawcę i warunki transakcji.'],
    pt: ['Aviso de compra segura', 'A IGDC divulga produtos e encaminha aos vendedores; não vende, processa pagamentos nem envia produtos diretamente. O vendedor é responsável pela venda, entrega, devoluções, reembolsos e assistência pós-venda. Verifique o vendedor e as condições antes de comprar.'],
    ru: ['Информация о безопасных покупках', 'IGDC рекламирует товары и направляет к продавцам, но не продаёт, не принимает оплату и не доставляет товары напрямую. Продажа, доставка, возврат, возмещение и послепродажное обслуживание осуществляются продавцом. Перед покупкой проверьте продавца и условия сделки.'],
    sv: ['Information om trygga köp', 'IGDC marknadsför produkter och länkar till säljare; IGDC säljer, tar betalt eller levererar inte varor direkt. Säljaren ansvarar för försäljning, leverans, returer, återbetalningar och kundservice. Kontrollera säljaren och villkoren före köp.'],
    sw: ['Taarifa ya ununuzi salama', 'IGDC hutangaza bidhaa na kuwaunganisha wanunuzi na wauzaji; haiuzi, haichakati malipo wala kusafirisha bidhaa moja kwa moja. Muuzaji hushughulikia mauzo, usafirishaji, marejesho, kurejesha pesa na huduma baada ya mauzo. Hakiki muuzaji na masharti kabla ya kununua.'],
    ta: ['பாதுகாப்பான கொள்முதல் அறிவிப்பு', 'IGDC பொருட்களை விளம்பரப்படுத்தி விற்பனையாளர்களுடன் இணைக்கிறது; நேரடியாக விற்பனை, பணப்பரிவர்த்தனை அல்லது விநியோகம் செய்வதில்லை. விற்பனை, விநியோகம், திருப்பி அளித்தல், பணத்தைத் திரும்பப் பெறுதல் மற்றும் விற்பனைக்குப் பிந்தைய சேவைக்கு விற்பனையாளரே பொறுப்பு. வாங்குமுன் விற்பனையாளரையும் விதிமுறைகளையும் சரிபார்க்கவும்.'],
    th: ['ประกาศการซื้อขายอย่างปลอดภัย', 'IGDC ประชาสัมพันธ์สินค้าและเชื่อมโยงไปยังผู้ขาย โดยไม่ได้ขาย รับชำระเงิน หรือจัดส่งสินค้าโดยตรง ผู้ขายรับผิดชอบการขาย การจัดส่ง การคืนสินค้า การคืนเงิน และบริการหลังการขาย โปรดตรวจสอบผู้ขายและเงื่อนไขก่อนซื้อ'],
    tl: ['Paunawa sa ligtas na pamimili', 'Nagpo-promote ang IGDC ng mga produkto at nag-uugnay sa mga nagbebenta; hindi ito direktang nagbebenta, tumatanggap ng bayad o naghahatid ng produkto. Ang nagbebenta ang namamahala sa bentahan, paghahatid, pagbabalik, refund at after-sales service. Suriin ang nagbebenta at mga tuntunin bago bumili.'],
    tr: ['Güvenli alışveriş bilgilendirmesi', 'IGDC ürünleri tanıtır ve satıcılara yönlendirir; doğrudan satış, ödeme veya teslimat yapmaz. Satış, teslimat, iade, para iadesi ve satış sonrası hizmetlerden satıcı sorumludur. Satın almadan önce satıcıyı ve koşulları kontrol edin.'],
    uk: ['Повідомлення про безпечні покупки', 'IGDC рекламує товари та спрямовує до продавців, але не продає, не приймає оплату й не доставляє товари безпосередньо. Продавець відповідає за продаж, доставку, повернення, відшкодування та післяпродажне обслуговування. Перед покупкою перевірте продавця й умови.'],
    ur: ['محفوظ خریداری کی اطلاع', 'IGDC مصنوعات کی تشہیر کرتا ہے اور فروخت کنندگان سے رابطہ فراہم کرتا ہے؛ خود براہِ راست فروخت، ادائیگی یا ترسیل نہیں کرتا۔ فروخت، ترسیل، واپسی، رقم کی واپسی اور بعد از فروخت خدمات فروخت کنندہ کی ذمہ داری ہیں۔ خریداری سے پہلے فروخت کنندہ اور شرائط کی جانچ کریں۔'],
    uz: ['Xavfsiz xarid haqida eslatma', 'IGDC mahsulotlarni targ‘ib qiladi va sotuvchilarga yo‘naltiradi; o‘zi bevosita sotmaydi, to‘lovlarni qabul qilmaydi yoki yetkazib bermaydi. Sotish, yetkazish, qaytarish, pulni qaytarish va sotuvdan keyingi xizmat uchun sotuvchi javobgar. Xariddan oldin sotuvchi va shartlarni tekshiring.'],
    vi: ['Thông báo giao dịch an toàn', 'IGDC quảng bá sản phẩm và liên kết đến người bán; không trực tiếp bán hàng, xử lý thanh toán hoặc giao hàng. Người bán chịu trách nhiệm bán hàng, giao hàng, đổi trả, hoàn tiền và dịch vụ sau bán hàng. Hãy kiểm tra người bán và điều khoản trước khi mua.'],
    zh: ['安全交易提示', 'IGDC提供商品推广及卖家链接服务，不直接销售商品、处理付款或配送。销售、配送、退换货、退款及售后服务由相应卖家负责。购买前请核实卖家及交易条款。'],
    zht: ['安全交易提醒', 'IGDC提供商品推廣及賣家連結服務，不直接銷售商品、處理付款或配送。銷售、配送、退換貨、退款及售後服務由相關賣家負責。購買前請確認賣家及交易條款。']
  };

  // This notice must track every language selection, including language changes
  // made without a full iframe/page reload. Keep the 30 translations in this
  // one file; the localized HTML pages do not need to be edited.
  var selectedLocale = '';
  var routeAtSelection = '';

  function normalizeLanguage(code) {
    var lang = String(code || '').trim().toLowerCase().replace(/_/g, '-');
    if (lang === 'kr' || lang.indexOf('ko-') === 0) return 'ko';
    if (lang === 'zh-hant' || lang === 'zh-tw' || lang === 'zh-hk') return 'zht';
    if (lang === 'zh-hans' || lang === 'zh-cn') return 'zh';
    if (lang.indexOf('-') !== -1) lang = lang.split('-')[0];
    return Object.prototype.hasOwnProperty.call(i18n, lang) ? lang : '';
  }

  function currentLanguage() {
    var currentPath = String(window.location.pathname || '').toLowerCase();
    if (selectedLocale && routeAtSelection === currentPath) return selectedLocale;
    selectedLocale = '';

    // Use the hub's own language picker if the selector lives in this document.
    var picker = document.querySelector('select.language-select');
    var fromPicker = normalizeLanguage(picker && picker.value);
    if (fromPicker) return fromPicker;

    // Language-selecting public routes can pass ?lang=xx, while translated
    // iframe documents already carry the language in their filename/directory.
    var queryLang = '';
    try { queryLang = normalizeLanguage(new URL(window.location.href).searchParams.get('lang')); }
    catch (_) {}
    if (queryLang) return queryLang;

    var match = currentPath.match(/(?:^|\/)([a-z]+)\/(?:home|distributionhub)_[a-z]+\.html$/);
    var routeLang = normalizeLanguage(match && match[1]);
    if (routeLang) return routeLang;

    var htmlLang = normalizeLanguage(document.documentElement.getAttribute('lang'));
    if (htmlLang) return htmlLang;
    try {
      var storedLang = normalizeLanguage(window.localStorage.getItem('igdc_lang'));
      if (storedLang) return storedLang;
    } catch (_) {}
    return normalizeLanguage(navigator.language) || 'ko';
  }

  function ensureStyle() {
    if (document.getElementById('igdc-commerce-safety-notice-css')) return;
    var style = document.createElement('style');
    style.id = 'igdc-commerce-safety-notice-css';
    // The notice occupies the vacant area to the RIGHT of the existing title.
    // No full-width banner, modal, and no changes to product/AutoMap markup.
    style.textContent = [
      '.igdc-commerce-notice-row{display:flex;align-items:center;gap:14px;min-width:0;max-width:100%;box-sizing:border-box;}',
      '.igdc-commerce-notice-row--home{margin:0 0 12px 0;}',
      '.igdc-commerce-notice-row--distribution{margin:0 0 20px 0;}',
      '.igdc-commerce-notice-row>.shopping-title,.igdc-commerce-notice-row>.page-title{flex:0 0 auto;margin:0!important;white-space:nowrap;}',
      '#igdc-commerce-safety-notice{box-sizing:border-box;min-width:0;flex:1 1 auto;display:flex;align-items:baseline;justify-content:flex-end;gap:0 6px;padding:4px 8px;max-width:100%;background:#f7f9fc;border:1px solid #e8edf3;border-radius:5px;color:#4c596a;font-size:12px;line-height:1.4;text-align:right;overflow-wrap:anywhere;}',
      '#igdc-commerce-safety-notice[dir="rtl"]{direction:rtl;text-align:right;unicode-bidi:plaintext;}',
      '#igdc-commerce-safety-notice .igdc-commerce-safety-notice-title{font-weight:700;white-space:nowrap;color:#32445b;}',
      '#igdc-commerce-safety-notice .igdc-commerce-safety-notice-body{min-width:0;}',
      '@media(max-width:820px){.igdc-commerce-notice-row{flex-wrap:wrap;gap:4px;}.igdc-commerce-notice-row>.shopping-title,.igdc-commerce-notice-row>.page-title{flex-basis:100%;}#igdc-commerce-safety-notice{font-size:12px;padding:4px 7px;text-align:start;justify-content:flex-start;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureNotice() {
    var section = document.getElementById(NOTICE_ID);
    if (section) return section;
    var title = home
      ? document.querySelector('section.shopping-section > h3.shopping-title')
      : document.querySelector('.main-content > h1.page-title');
    if (!title || !title.parentNode) return null;

    var row = document.createElement('div');
    row.className = 'igdc-commerce-notice-row igdc-commerce-notice-row--' + (home ? 'home' : 'distribution');
    title.parentNode.insertBefore(row, title);
    row.appendChild(title); // Retain the original translated title element.

    section = document.createElement('aside');
    section.id = NOTICE_ID;
    section.className = 'igdc-commerce-safety-notice';
    section.setAttribute('role', 'note');

    var heading = document.createElement('strong');
    heading.className = 'igdc-commerce-safety-notice-title';
    var detail = document.createElement('span');
    detail.className = 'igdc-commerce-safety-notice-body';
    section.appendChild(heading);
    section.appendChild(detail);
    row.appendChild(section);
    return section;
  }

  function render() {
    var section = ensureNotice();
    if (!section) return;
    ensureStyle();
    var locale = currentLanguage();
    var words = i18n[locale] || i18n.en;
    section.setAttribute('lang', locale === 'zht' ? 'zh-Hant' : locale);
    section.setAttribute('dir', /^(ar|fa|ur)$/.test(locale) ? 'rtl' : 'ltr');
    var title = section.querySelector('.igdc-commerce-safety-notice-title');
    var detail = section.querySelector('.igdc-commerce-safety-notice-body');
    if (title && title.textContent !== words[0]) title.textContent = words[0];
    if (detail && detail.textContent !== words[1]) detail.textContent = words[1];
  }

  function selectLanguage(value) {
    var locale = normalizeLanguage(value);
    if (!locale) return;
    selectedLocale = locale;
    routeAtSelection = String(window.location.pathname || '').toLowerCase();
    render();
  }

  function start() {
    render();
    // The language selector may be in a shared shell or be inserted later.
    // Delegation covers selectors added after this script has initialized.
    document.addEventListener('change', function (event) {
      var picker = event && event.target;
      if (picker && picker.matches && picker.matches('select.language-select')) {
        selectLanguage(picker.value);
      }
    }, true);
    // igdc-core emits this event when changeLanguage(...) is called.
    window.addEventListener('igdc:langchange', function (event) {
      var value = event && event.detail && event.detail.lang;
      if (normalizeLanguage(value)) selectLanguage(value);
      else render();
    });
    // Restore the right translation after browser back/forward and frame restore.
    window.addEventListener('popstate', function () { selectedLocale = ''; render(); });
    window.addEventListener('pageshow', render);
    // Any in-place change to the document's language must update the notice.
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function () {
        var lang = normalizeLanguage(document.documentElement.getAttribute('lang'));
        if (lang) selectLanguage(lang);
        else render();
      }).observe(document.documentElement, {attributes:true,attributeFilter:['lang']});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once:true});
  } else {
    start();
  }

})();
