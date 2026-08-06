(function () {
  'use strict';

  // Change to false when the notice should be hidden temporarily.
  var ENABLED = true;

  var NOTICE_ID = 'igdc-site-preparation-notice';
  var STYLE_ID = 'igdc-site-preparation-notice-style';
  var RTL_LANGS = { ar: true, fa: true, ur: true };

  var MESSAGES = {
    ko: '현재 사이트를 준비 중입니다.',
    en: 'This site is currently under preparation.',
    zh: '本网站目前正在准备中。',
    zht: '本網站目前正在準備中。',
    ja: '現在、サイトを準備中です。',
    es: 'Este sitio se encuentra actualmente en preparación.',
    fr: 'Ce site est actuellement en préparation.',
    de: 'Diese Website wird derzeit vorbereitet.',
    ru: 'Сайт в настоящее время готовится к запуску.',
    pt: 'Este site está atualmente em preparação.',
    it: 'Questo sito è attualmente in fase di preparazione.',
    ar: 'هذا الموقع قيد الإعداد حاليًا.',
    vi: 'Trang web này hiện đang được chuẩn bị.',
    th: 'เว็บไซต์นี้กำลังอยู่ระหว่างการจัดเตรียม',
    id: 'Situs ini sedang dalam persiapan.',
    hi: 'यह साइट अभी तैयार की जा रही है।',
    tr: 'Bu site şu anda hazırlanmaktadır.',
    fa: 'این وب‌سایت در حال آماده‌سازی است.',
    bn: 'এই সাইটটি বর্তমানে প্রস্তুত করা হচ্ছে।',
    ur: 'یہ ویب سائٹ فی الحال تیار کی جا رہی ہے۔',
    sw: 'Tovuti hii inaandaliwa kwa sasa.',
    ta: 'இந்தத் தளம் தற்போது தயாராகி வருகிறது.',
    hu: 'Ez a webhely jelenleg előkészítés alatt áll.',
    ms: 'Laman ini sedang dalam persediaan.',
    nl: 'Deze site wordt momenteel voorbereid.',
    pl: 'Ta strona jest obecnie przygotowywana.',
    sv: 'Den här webbplatsen förbereds för närvarande.',
    tl: 'Kasalukuyang inihahanda ang site na ito.',
    uk: 'Цей сайт зараз готується до запуску.',
    uz: 'Ushbu sayt hozirda tayyorlanmoqda.'
  };

  function normalizeLanguage(value) {
    var lang = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (!lang) return 'ko';
    if (lang === 'kr' || lang.indexOf('ko-') === 0) return 'ko';
    if (lang === 'zh-hant' || lang === 'zh-tw' || lang === 'zh-hk' || lang === 'zht') return 'zht';
    if (lang.indexOf('zh-') === 0) return 'zh';
    lang = lang.split('-')[0];
    return Object.prototype.hasOwnProperty.call(MESSAGES, lang) ? lang : 'en';
  }

  function currentLanguage() {
    var picker = document.querySelector('select.language-select');
    if (picker && picker.value) return normalizeLanguage(picker.value);

    var htmlLang = document.documentElement.getAttribute('lang');
    if (htmlLang) return normalizeLanguage(htmlLang);

    try {
      var saved = localStorage.getItem('igdc_lang');
      if (saved) return normalizeLanguage(saved);
    } catch (_) {}

    return normalizeLanguage(navigator.language || 'ko');
  }

  function isExcludedPage() {
    var parts = String(location.pathname || '/')
      .toLowerCase()
      .split('/')
      .filter(Boolean);

    var blocked = {
      help: true,
      support: true,
      terms: true,
      privacy: true,
      refund: true,
      admin: true,
      'support.html': true,
      'admin.html': true,
      'maru-windows-terms.html': true,
      'maru-windows-privacy.html': true,
      'maru-windows-refund.html': true
    };

    for (var i = 0; i < parts.length; i += 1) {
      if (blocked[parts[i]]) return true;
    }
    return false;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '#' + NOTICE_ID + '{box-sizing:border-box;width:100%;padding:9px 48px;' +
      'background:#fff3a6;color:#5c4700;border-top:1px solid #ead36b;' +
      'border-bottom:1px solid #d8bd48;text-align:center;font-size:15px;' +
      'font-weight:700;line-height:1.45;letter-spacing:.01em;}' +
      '#' + NOTICE_ID + '[dir="rtl"]{direction:rtl;unicode-bidi:plaintext;}' +
      '@media(max-width:700px){#' + NOTICE_ID + '{padding:8px 14px;font-size:14px;}}';
    document.head.appendChild(style);
  }

  function ensureNotice() {
    var notice = document.getElementById(NOTICE_ID);
    if (notice) return notice;

    notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.hidden = true;

    var header = document.querySelector('body > header') || document.querySelector('header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(notice, header.nextSibling);
    } else {
      document.body.insertBefore(notice, document.body.firstChild);
    }
    return notice;
  }

  function render() {
    if (!document.body) return;

    ensureStyle();
    var notice = ensureNotice();
    var show = ENABLED && !isExcludedPage();
    notice.hidden = !show;
    if (!show) return;

    var lang = currentLanguage();
    notice.textContent = MESSAGES[lang] || MESSAGES.en;
    notice.lang = lang === 'zht' ? 'zh-Hant' : lang;
    notice.dir = RTL_LANGS[lang] ? 'rtl' : 'ltr';
  }

  function watchHistory(methodName) {
    var original = history[methodName];
    if (typeof original !== 'function' || original.__igdcNoticeWrapped) return;

    function wrapped() {
      var result = original.apply(this, arguments);
      setTimeout(render, 0);
      return result;
    }
    wrapped.__igdcNoticeWrapped = true;
    history[methodName] = wrapped;
  }

  function start() {
    render();

    var picker = document.querySelector('select.language-select');
    // The index navigation uses this same language selector. Rendering here,
    // without a timer, changes the notice in the very same selection event.
    if (picker) picker.addEventListener('change', render);

    window.addEventListener('popstate', render);
    window.addEventListener('pageshow', render);
    window.addEventListener('igdc:langchange', render);
    watchHistory('pushState');
    watchHistory('replaceState');

    if (window.MutationObserver) {
      new MutationObserver(render).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['lang']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
