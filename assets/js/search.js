// IGDC Search.js — FULL SEARCH PIPELINE PATCH
// PATCH: fast balanced vertical tabs v1 + naver-like adaptive media cards + stable display groups
// - collector first
// - collector search pipeline
// - silent error prevention
// - same-tab navigation
// - block pagination

(function () {
  'use strict';

  function ready(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

ready(function () {
  const p = location.pathname || '';
  const isSearchPage =
    p.endsWith('/search.html') ||
    p.endsWith('/search') ||
    p.endsWith('/search/');

  // 🔥 홈에서도 search.js 동작 허용 (핵심 수정)
  const hasSearchUI =
    document.getElementById('searchInput') ||
    document.getElementById('globalSearchInput');

  if (!isSearchPage && !hasSearchUI) return;

    const input   = document.getElementById('searchInput');
    const btn     = document.getElementById('searchBtn');
    const status  = document.getElementById('searchStatus');
    const results = document.getElementById('searchResults');
        
    if (!input || !btn) return;

    const PAGE_SIZE = 15;
    const BLOCK_SIZE = 10;
    const FETCH_LIMIT = 1000;

    let allItems = [];
    let currentPage = 1;
    let currentBlock = 0;
    let activeType = 'all';
    let lastQuery = '';
    let lastType = 'all';
    const pageImageEnrichCache = new Set();
    const itemImageEnrichCache = new Map();
    const expandedDisplayGroups = new Set();

const params = new URLSearchParams(location.search);
const q0 = (params.get('q') || '').trim();
const from0 = (params.get('from') || '').trim();

const RTL_SEARCH_LANGS = new Set(['ar','fa','ur']);

const SEARCH_TAB_KEYS = [
  'all','image','news','map','knowledge','tour','video','sns','blog','cafe','book','shopping','sports','finance','webtoon'
];

const SEARCH_I18N = {
  ko: {
    name: '한국어',
    tabs: { all:'전체', image:'이미지', news:'뉴스', map:'지도', knowledge:'지식', tour:'관광', video:'영상', sns:'소셜', blog:'블로그', cafe:'카페', book:'도서', shopping:'쇼핑', sports:'스포츠', finance:'증권', webtoon:'웹툰' },
    groups: { authority:'공식/권위', news:'뉴스', local_tour:'지도/관광/지역', media:'이미지/영상', social:'소셜', community:'블로그/카페/커뮤니티', knowledge:'지식/도서', shopping:'쇼핑', sports:'스포츠', finance:'금융', webtoon:'웹툰', web:'웹' },
    strings: { pageTitle:'IGDC 글로벌 검색', brand:'IGDC 글로벌 검색', placeholder:'전 세계를 검색하세요…', searchButton:'검색', searching:'"{q}"에 대한 {type} 검색 중...', noResults:'"{q}"에 대한 결과가 없습니다', results:'"{q}"에 대한 {count}개 결과 · {type}', count:'{count}개', showMore:'{label} {count}개 더보기', collapse:'접기', noTitle:'(제목 없음)', poweredBy:'Powered by IGDC · 글로벌 통합 검색' }
  },
  en: {
    name: 'English',
    tabs: { all:'All', image:'Images', news:'News', map:'Maps', knowledge:'Knowledge', tour:'Travel', video:'Videos', sns:'Social', blog:'Blogs', cafe:'Forums', book:'Books', shopping:'Shopping', sports:'Sports', finance:'Finance', webtoon:'Webtoons' },
    groups: { authority:'Official/Authority', news:'News', local_tour:'Maps/Travel/Local', media:'Images/Videos', social:'Social', community:'Blogs/Forums', knowledge:'Knowledge/Books', shopping:'Shopping', sports:'Sports', finance:'Finance', webtoon:'Webtoons', web:'Web' },
    strings: { pageTitle:'IGDC Global Search', brand:'IGDC Global Search', placeholder:'Search the world…', searchButton:'Search', searching:'Searching {type} for "{q}"...', noResults:'No results for "{q}"', results:'{count} results for "{q}" · {type}', count:'{count}', showMore:'Show {count} more in {label}', collapse:'Collapse', noTitle:'(no title)', poweredBy:'Powered by IGDC · Global Unified Search' }
  },
  de: {
    name: 'Deutsch',
    tabs: { all:'Alle', image:'Bilder', news:'Nachrichten', map:'Karten', knowledge:'Wissen', tour:'Reisen', video:'Videos', sns:'Sozial', blog:'Blogs', cafe:'Foren', book:'Bücher', shopping:'Shopping', sports:'Sport', finance:'Finanzen', webtoon:'Webtoons' },
    groups: { authority:'Offiziell/Autorität', news:'Nachrichten', local_tour:'Karten/Reisen/Lokal', media:'Bilder/Videos', social:'Sozial', community:'Blogs/Foren', knowledge:'Wissen/Bücher', shopping:'Shopping', sports:'Sport', finance:'Finanzen', webtoon:'Webtoons', web:'Web' },
    strings: { pageTitle:'IGDC Globale Suche', brand:'IGDC Globale Suche', placeholder:'Die Welt durchsuchen…', searchButton:'Suchen', searching:'Suche {type} nach „{q}“...', noResults:'Keine Ergebnisse für „{q}“', results:'{count} Ergebnisse für „{q}“ · {type}', count:'{count}', showMore:'{count} weitere in {label} anzeigen', collapse:'Einklappen', noTitle:'(kein Titel)', poweredBy:'Powered by IGDC · Globale Einheitssuche' }
  },
  bn: {
    name: 'বাংলা',
    tabs: { all:'সব', image:'ছবি', news:'সংবাদ', map:'মানচিত্র', knowledge:'জ্ঞান', tour:'ভ্রমণ', video:'ভিডিও', sns:'সোশ্যাল', blog:'ব্লগ', cafe:'ফোরাম', book:'বই', shopping:'শপিং', sports:'খেলা', finance:'অর্থ', webtoon:'ওয়েবটুন' },
    groups: { authority:'অফিসিয়াল/প্রামাণিক', news:'সংবাদ', local_tour:'মানচিত্র/ভ্রমণ/স্থানীয়', media:'ছবি/ভিডিও', social:'সোশ্যাল', community:'ব্লগ/ফোরাম', knowledge:'জ্ঞান/বই', shopping:'শপিং', sports:'খেলা', finance:'অর্থ', webtoon:'ওয়েবটুন', web:'ওয়েব' },
    strings: { pageTitle:'IGDC গ্লোবাল সার্চ', brand:'IGDC গ্লোবাল সার্চ', placeholder:'বিশ্বজুড়ে অনুসন্ধান করুন…', searchButton:'অনুসন্ধান', searching:'"{q}"-এর জন্য {type} অনুসন্ধান চলছে...', noResults:'"{q}"-এর জন্য কোনো ফল নেই', results:'"{q}"-এর জন্য {count}টি ফলাফল · {type}', count:'{count}টি', showMore:'{label}-এ আরও {count}টি দেখুন', collapse:'গুটিয়ে নিন', noTitle:'(শিরোনাম নেই)', poweredBy:'Powered by IGDC · গ্লোবাল ইউনিফাইড সার্চ' }
  },
  ar: {
    name: 'العربية',
    tabs: { all:'الكل', image:'الصور', news:'الأخبار', map:'الخرائط', knowledge:'المعرفة', tour:'السفر', video:'الفيديو', sns:'التواصل', blog:'المدونات', cafe:'المنتديات', book:'الكتب', shopping:'التسوق', sports:'الرياضة', finance:'المال', webtoon:'ويبتون' },
    groups: { authority:'رسمي/موثوق', news:'الأخبار', local_tour:'خرائط/سفر/محلي', media:'صور/فيديو', social:'التواصل', community:'مدونات/منتديات', knowledge:'معرفة/كتب', shopping:'تسوق', sports:'رياضة', finance:'مال', webtoon:'ويبتون', web:'الويب' },
    strings: { pageTitle:'بحث IGDC العالمي', brand:'بحث IGDC العالمي', placeholder:'ابحث في العالم…', searchButton:'بحث', searching:'جارٍ البحث في {type} عن "{q}"...', noResults:'لا توجد نتائج لـ "{q}"', results:'{count} نتيجة لـ "{q}" · {type}', count:'{count}', showMore:'عرض {count} المزيد في {label}', collapse:'طي', noTitle:'(بدون عنوان)', poweredBy:'Powered by IGDC · البحث العالمي الموحد' }
  },
  pl: {
    name:'Polski',
    tabs:{ all:'Wszystko', image:'Obrazy', news:'Wiadomości', map:'Mapy', knowledge:'Wiedza', tour:'Podróże', video:'Wideo', sns:'Społeczności', blog:'Blogi', cafe:'Fora', book:'Książki', shopping:'Zakupy', sports:'Sport', finance:'Finanse', webtoon:'Webtoony' },
    groups:{ authority:'Oficjalne/Autorytet', news:'Wiadomości', local_tour:'Mapy/Podróże/Lokalne', media:'Obrazy/Wideo', social:'Społeczności', community:'Blogi/Fora', knowledge:'Wiedza/Książki', shopping:'Zakupy', sports:'Sport', finance:'Finanse', webtoon:'Webtoony', web:'Sieć' },
    strings:{ pageTitle:'Globalne wyszukiwanie IGDC', brand:'Globalne wyszukiwanie IGDC', placeholder:'Szukaj na świecie…', searchButton:'Szukaj', searching:'Wyszukiwanie {type} dla „{q}”...', noResults:'Brak wyników dla „{q}”', results:'{count} wyników dla „{q}” · {type}', count:'{count}', showMore:'Pokaż jeszcze {count} w {label}', collapse:'Zwiń', noTitle:'(brak tytułu)', poweredBy:'Powered by IGDC · Globalne wyszukiwanie zunifikowane' }
  },
  pt: {
    name:'Português',
    tabs:{ all:'Tudo', image:'Imagens', news:'Notícias', map:'Mapas', knowledge:'Conhecimento', tour:'Turismo', video:'Vídeos', sns:'Social', blog:'Blogs', cafe:'Fóruns', book:'Livros', shopping:'Compras', sports:'Esportes', finance:'Finanças', webtoon:'Webtoons' },
    groups:{ authority:'Oficial/Autoridade', news:'Notícias', local_tour:'Mapas/Turismo/Local', media:'Imagens/Vídeos', social:'Social', community:'Blogs/Fóruns', knowledge:'Conhecimento/Livros', shopping:'Compras', sports:'Esportes', finance:'Finanças', webtoon:'Webtoons', web:'Web' },
    strings:{ pageTitle:'Busca Global IGDC', brand:'Busca Global IGDC', placeholder:'Pesquise no mundo…', searchButton:'Buscar', searching:'Buscando {type} por "{q}"...', noResults:'Nenhum resultado para "{q}"', results:'{count} resultados para "{q}" · {type}', count:'{count}', showMore:'Mostrar mais {count} em {label}', collapse:'Recolher', noTitle:'(sem título)', poweredBy:'Powered by IGDC · Busca Global Unificada' }
  },
  ru: {
    name:'Русский',
    tabs:{ all:'Все', image:'Изображения', news:'Новости', map:'Карты', knowledge:'Знания', tour:'Туризм', video:'Видео', sns:'Соцсети', blog:'Блоги', cafe:'Форумы', book:'Книги', shopping:'Покупки', sports:'Спорт', finance:'Финансы', webtoon:'Вебтуны' },
    groups:{ authority:'Официальное/Авторитетное', news:'Новости', local_tour:'Карты/Туризм/Местное', media:'Изображения/Видео', social:'Соцсети', community:'Блоги/Форумы', knowledge:'Знания/Книги', shopping:'Покупки', sports:'Спорт', finance:'Финансы', webtoon:'Вебтуны', web:'Веб' },
    strings:{ pageTitle:'Глобальный поиск IGDC', brand:'Глобальный поиск IGDC', placeholder:'Искать по миру…', searchButton:'Поиск', searching:'Поиск {type} по запросу «{q}»...', noResults:'Нет результатов для «{q}»', results:'{count} результатов для «{q}» · {type}', count:'{count}', showMore:'Показать еще {count} в {label}', collapse:'Свернуть', noTitle:'(без названия)', poweredBy:'Powered by IGDC · Глобальный единый поиск' }
  },
  sv: {
    name:'Svenska',
    tabs:{ all:'Alla', image:'Bilder', news:'Nyheter', map:'Kartor', knowledge:'Kunskap', tour:'Resor', video:'Videor', sns:'Socialt', blog:'Bloggar', cafe:'Forum', book:'Böcker', shopping:'Shopping', sports:'Sport', finance:'Finans', webtoon:'Webtoons' },
    groups:{ authority:'Officiellt/Auktoritet', news:'Nyheter', local_tour:'Kartor/Resor/Lokalt', media:'Bilder/Videor', social:'Socialt', community:'Bloggar/Forum', knowledge:'Kunskap/Böcker', shopping:'Shopping', sports:'Sport', finance:'Finans', webtoon:'Webtoons', web:'Webb' },
    strings:{ pageTitle:'IGDC Global sökning', brand:'IGDC Global sökning', placeholder:'Sök i världen…', searchButton:'Sök', searching:'Söker {type} efter ”{q}”...', noResults:'Inga resultat för ”{q}”', results:'{count} resultat för ”{q}” · {type}', count:'{count}', showMore:'Visa {count} fler i {label}', collapse:'Fäll ihop', noTitle:'(ingen titel)', poweredBy:'Powered by IGDC · Global enhetlig sökning' }
  },
  sw: {
    name:'Kiswahili',
    tabs:{ all:'Zote', image:'Picha', news:'Habari', map:'Ramani', knowledge:'Maarifa', tour:'Utalii', video:'Video', sns:'Mitandao', blog:'Blogu', cafe:'Majukwaa', book:'Vitabu', shopping:'Ununuzi', sports:'Michezo', finance:'Fedha', webtoon:'Webtoon' },
    groups:{ authority:'Rasmi/Mamlaka', news:'Habari', local_tour:'Ramani/Utalii/Eneo', media:'Picha/Video', social:'Mitandao', community:'Blogu/Majukwaa', knowledge:'Maarifa/Vitabu', shopping:'Ununuzi', sports:'Michezo', finance:'Fedha', webtoon:'Webtoon', web:'Wavuti' },
    strings:{ pageTitle:'Utafutaji wa Kimataifa wa IGDC', brand:'Utafutaji wa Kimataifa wa IGDC', placeholder:'Tafuta duniani…', searchButton:'Tafuta', searching:'Inatafuta {type} kwa "{q}"...', noResults:'Hakuna matokeo kwa "{q}"', results:'Matokeo {count} kwa "{q}" · {type}', count:'{count}', showMore:'Onyesha {count} zaidi katika {label}', collapse:'Kunja', noTitle:'(hakuna kichwa)', poweredBy:'Powered by IGDC · Utafutaji wa Kimataifa uliounganishwa' }
  },
  ta: {
    name:'தமிழ்',
    tabs:{ all:'அனைத்தும்', image:'படங்கள்', news:'செய்திகள்', map:'வரைபடங்கள்', knowledge:'அறிவு', tour:'சுற்றுலா', video:'வீடியோக்கள்', sns:'சமூக', blog:'வலைப்பதிவுகள்', cafe:'மன்றங்கள்', book:'நூல்கள்', shopping:'வாங்குதல்', sports:'விளையாட்டு', finance:'நிதி', webtoon:'வெப்டூன்' },
    groups:{ authority:'அதிகாரப்பூர்வம்/நம்பகமானது', news:'செய்திகள்', local_tour:'வரைபடங்கள்/சுற்றுலா/உள்ளூர்', media:'படங்கள்/வீடியோக்கள்', social:'சமூக', community:'வலைப்பதிவுகள்/மன்றங்கள்', knowledge:'அறிவு/நூல்கள்', shopping:'வாங்குதல்', sports:'விளையாட்டு', finance:'நிதி', webtoon:'வெப்டூன்', web:'வலை' },
    strings:{ pageTitle:'IGDC உலகளாவிய தேடல்', brand:'IGDC உலகளாவிய தேடல்', placeholder:'உலகம் முழுவதும் தேடுங்கள்…', searchButton:'தேடு', searching:'"{q}" க்கான {type} தேடப்படுகிறது...', noResults:'"{q}" க்கான முடிவுகள் இல்லை', results:'"{q}" க்கான {count} முடிவுகள் · {type}', count:'{count}', showMore:'{label} இல் மேலும் {count} காண்க', collapse:'சுருக்கு', noTitle:'(தலைப்பு இல்லை)', poweredBy:'Powered by IGDC · உலகளாவிய ஒருங்கிணைந்த தேடல்' }
  },
  th: {
    name:'ไทย',
    tabs:{ all:'ทั้งหมด', image:'รูปภาพ', news:'ข่าว', map:'แผนที่', knowledge:'ความรู้', tour:'ท่องเที่ยว', video:'วิดีโอ', sns:'โซเชียล', blog:'บล็อก', cafe:'ฟอรัม', book:'หนังสือ', shopping:'ช้อปปิ้ง', sports:'กีฬา', finance:'การเงิน', webtoon:'เว็บตูน' },
    groups:{ authority:'ทางการ/เชื่อถือได้', news:'ข่าว', local_tour:'แผนที่/ท่องเที่ยว/ท้องถิ่น', media:'รูปภาพ/วิดีโอ', social:'โซเชียล', community:'บล็อก/ฟอรัม', knowledge:'ความรู้/หนังสือ', shopping:'ช้อปปิ้ง', sports:'กีฬา', finance:'การเงิน', webtoon:'เว็บตูน', web:'เว็บ' },
    strings:{ pageTitle:'ค้นหาทั่วโลก IGDC', brand:'ค้นหาทั่วโลก IGDC', placeholder:'ค้นหาทั่วโลก…', searchButton:'ค้นหา', searching:'กำลังค้นหา {type} สำหรับ "{q}"...', noResults:'ไม่พบผลลัพธ์สำหรับ "{q}"', results:'{count} ผลลัพธ์สำหรับ "{q}" · {type}', count:'{count}', showMore:'แสดงเพิ่มอีก {count} ใน {label}', collapse:'ยุบ', noTitle:'(ไม่มีชื่อ)', poweredBy:'Powered by IGDC · การค้นหารวมทั่วโลก' }
  },
  tl: {
    name:'Tagalog',
    tabs:{ all:'Lahat', image:'Mga Larawan', news:'Balita', map:'Mapa', knowledge:'Kaalaman', tour:'Paglalakbay', video:'Video', sns:'Social', blog:'Blog', cafe:'Forum', book:'Aklat', shopping:'Shopping', sports:'Sports', finance:'Pananalapi', webtoon:'Webtoon' },
    groups:{ authority:'Opisyal/Awtoridad', news:'Balita', local_tour:'Mapa/Paglalakbay/Lokal', media:'Larawan/Video', social:'Social', community:'Blog/Forum', knowledge:'Kaalaman/Aklat', shopping:'Shopping', sports:'Sports', finance:'Pananalapi', webtoon:'Webtoon', web:'Web' },
    strings:{ pageTitle:'IGDC Global Search', brand:'IGDC Global Search', placeholder:'Maghanap sa buong mundo…', searchButton:'Hanapin', searching:'Hinahanap ang {type} para sa "{q}"...', noResults:'Walang resulta para sa "{q}"', results:'{count} resulta para sa "{q}" · {type}', count:'{count}', showMore:'Ipakita pa ang {count} sa {label}', collapse:'Isara', noTitle:'(walang pamagat)', poweredBy:'Powered by IGDC · Global Unified Search' }
  },
  tr: {
    name:'Türkçe',
    tabs:{ all:'Tümü', image:'Görseller', news:'Haberler', map:'Haritalar', knowledge:'Bilgi', tour:'Seyahat', video:'Videolar', sns:'Sosyal', blog:'Bloglar', cafe:'Forumlar', book:'Kitaplar', shopping:'Alışveriş', sports:'Spor', finance:'Finans', webtoon:'Webtoon' },
    groups:{ authority:'Resmi/Otorite', news:'Haberler', local_tour:'Harita/Seyahat/Yerel', media:'Görsel/Video', social:'Sosyal', community:'Blog/Forum', knowledge:'Bilgi/Kitap', shopping:'Alışveriş', sports:'Spor', finance:'Finans', webtoon:'Webtoon', web:'Web' },
    strings:{ pageTitle:'IGDC Küresel Arama', brand:'IGDC Küresel Arama', placeholder:'Dünyada ara…', searchButton:'Ara', searching:'"{q}" için {type} aranıyor...', noResults:'"{q}" için sonuç yok', results:'"{q}" için {count} sonuç · {type}', count:'{count}', showMore:'{label} içinde {count} tane daha göster', collapse:'Daralt', noTitle:'(başlıksız)', poweredBy:'Powered by IGDC · Küresel Birleşik Arama' }
  },
  uk: {
    name:'Українська',
    tabs:{ all:'Усе', image:'Зображення', news:'Новини', map:'Карти', knowledge:'Знання', tour:'Туризм', video:'Відео', sns:'Соцмережі', blog:'Блоги', cafe:'Форуми', book:'Книги', shopping:'Покупки', sports:'Спорт', finance:'Фінанси', webtoon:'Вебтуни' },
    groups:{ authority:'Офіційне/Авторитетне', news:'Новини', local_tour:'Карти/Туризм/Місцеве', media:'Зображення/Відео', social:'Соцмережі', community:'Блоги/Форуми', knowledge:'Знання/Книги', shopping:'Покупки', sports:'Спорт', finance:'Фінанси', webtoon:'Вебтуни', web:'Веб' },
    strings:{ pageTitle:'Глобальний пошук IGDC', brand:'Глобальний пошук IGDC', placeholder:'Шукайте у світі…', searchButton:'Пошук', searching:'Пошук {type} для «{q}»...', noResults:'Немає результатів для «{q}»', results:'{count} результатів для «{q}» · {type}', count:'{count}', showMore:'Показати ще {count} у {label}', collapse:'Згорнути', noTitle:'(без назви)', poweredBy:'Powered by IGDC · Глобальний єдиний пошук' }
  },
  ur: {
    name:'اردو',
    tabs:{ all:'سب', image:'تصاویر', news:'خبریں', map:'نقشے', knowledge:'علم', tour:'سفر', video:'ویڈیوز', sns:'سوشل', blog:'بلاگز', cafe:'فورمز', book:'کتابیں', shopping:'خریداری', sports:'کھیل', finance:'مالیات', webtoon:'ویب ٹون' },
    groups:{ authority:'سرکاری/مستند', news:'خبریں', local_tour:'نقشے/سفر/مقامی', media:'تصاویر/ویڈیوز', social:'سوشل', community:'بلاگز/فورمز', knowledge:'علم/کتابیں', shopping:'خریداری', sports:'کھیل', finance:'مالیات', webtoon:'ویب ٹون', web:'ویب' },
    strings:{ pageTitle:'IGDC عالمی تلاش', brand:'IGDC عالمی تلاش', placeholder:'دنیا بھر میں تلاش کریں…', searchButton:'تلاش', searching:'"{q}" کے لیے {type} تلاش ہو رہی ہے...', noResults:'"{q}" کے لیے کوئی نتیجہ نہیں', results:'"{q}" کے لیے {count} نتائج · {type}', count:'{count}', showMore:'{label} میں مزید {count} دکھائیں', collapse:'بند کریں', noTitle:'(بلا عنوان)', poweredBy:'Powered by IGDC · عالمی متحد تلاش' }
  },
  uz: {
    name:'O‘zbekcha',
    tabs:{ all:'Barchasi', image:'Rasmlar', news:'Yangiliklar', map:'Xaritalar', knowledge:'Bilim', tour:'Sayohat', video:'Videolar', sns:'Ijtimoiy', blog:'Bloglar', cafe:'Forumlar', book:'Kitoblar', shopping:'Xaridlar', sports:'Sport', finance:'Moliya', webtoon:'Vebtun' },
    groups:{ authority:'Rasmiy/Ishonchli', news:'Yangiliklar', local_tour:'Xarita/Sayohat/Mahalliy', media:'Rasm/Video', social:'Ijtimoiy', community:'Blog/Forum', knowledge:'Bilim/Kitob', shopping:'Xaridlar', sports:'Sport', finance:'Moliya', webtoon:'Vebtun', web:'Veb' },
    strings:{ pageTitle:'IGDC global qidiruv', brand:'IGDC global qidiruv', placeholder:'Dunyo bo‘yicha qidiring…', searchButton:'Qidirish', searching:'"{q}" uchun {type} qidirilmoqda...', noResults:'"{q}" uchun natija yo‘q', results:'"{q}" uchun {count} ta natija · {type}', count:'{count} ta', showMore:'{label} bo‘yicha yana {count} ta ko‘rsatish', collapse:'Yopish', noTitle:'(sarlavhasiz)', poweredBy:'Powered by IGDC · Global yagona qidiruv' }
  },
  vi: {
    name:'Tiếng Việt',
    tabs:{ all:'Tất cả', image:'Hình ảnh', news:'Tin tức', map:'Bản đồ', knowledge:'Tri thức', tour:'Du lịch', video:'Video', sns:'Mạng xã hội', blog:'Blog', cafe:'Diễn đàn', book:'Sách', shopping:'Mua sắm', sports:'Thể thao', finance:'Tài chính', webtoon:'Webtoon' },
    groups:{ authority:'Chính thức/Uy tín', news:'Tin tức', local_tour:'Bản đồ/Du lịch/Địa phương', media:'Hình ảnh/Video', social:'Mạng xã hội', community:'Blog/Diễn đàn', knowledge:'Tri thức/Sách', shopping:'Mua sắm', sports:'Thể thao', finance:'Tài chính', webtoon:'Webtoon', web:'Web' },
    strings:{ pageTitle:'Tìm kiếm toàn cầu IGDC', brand:'Tìm kiếm toàn cầu IGDC', placeholder:'Tìm kiếm khắp thế giới…', searchButton:'Tìm kiếm', searching:'Đang tìm {type} cho "{q}"...', noResults:'Không có kết quả cho "{q}"', results:'{count} kết quả cho "{q}" · {type}', count:'{count}', showMore:'Hiển thị thêm {count} trong {label}', collapse:'Thu gọn', noTitle:'(không có tiêu đề)', poweredBy:'Powered by IGDC · Tìm kiếm hợp nhất toàn cầu' }
  },
  zh: {
    name:'简体中文',
    tabs:{ all:'全部', image:'图片', news:'新闻', map:'地图', knowledge:'知识', tour:'旅游', video:'视频', sns:'社交', blog:'博客', cafe:'论坛', book:'图书', shopping:'购物', sports:'体育', finance:'财经', webtoon:'网漫' },
    groups:{ authority:'官方/权威', news:'新闻', local_tour:'地图/旅游/本地', media:'图片/视频', social:'社交', community:'博客/论坛', knowledge:'知识/图书', shopping:'购物', sports:'体育', finance:'财经', webtoon:'网漫', web:'网页' },
    strings:{ pageTitle:'IGDC 全球搜索', brand:'IGDC 全球搜索', placeholder:'搜索全世界…', searchButton:'搜索', searching:'正在搜索“{q}”的{type}...', noResults:'没有找到“{q}”的结果', results:'“{q}”的 {count} 条结果 · {type}', count:'{count}条', showMore:'在{label}中查看更多 {count} 条', collapse:'收起', noTitle:'（无标题）', poweredBy:'Powered by IGDC · 全球统一搜索' }
  },
  'zh-Hant': {
    name:'繁體中文',
    tabs:{ all:'全部', image:'圖片', news:'新聞', map:'地圖', knowledge:'知識', tour:'旅遊', video:'影片', sns:'社群', blog:'部落格', cafe:'論壇', book:'書籍', shopping:'購物', sports:'體育', finance:'財經', webtoon:'網漫' },
    groups:{ authority:'官方/權威', news:'新聞', local_tour:'地圖/旅遊/在地', media:'圖片/影片', social:'社群', community:'部落格/論壇', knowledge:'知識/書籍', shopping:'購物', sports:'體育', finance:'財經', webtoon:'網漫', web:'網頁' },
    strings:{ pageTitle:'IGDC 全球搜尋', brand:'IGDC 全球搜尋', placeholder:'搜尋全世界…', searchButton:'搜尋', searching:'正在搜尋「{q}」的{type}...', noResults:'找不到「{q}」的結果', results:'「{q}」的 {count} 筆結果 · {type}', count:'{count}筆', showMore:'在{label}中查看更多 {count} 筆', collapse:'收合', noTitle:'（無標題）', poweredBy:'Powered by IGDC · 全球統一搜尋' }
  },
  fa: {
    name:'فارسی',
    tabs:{ all:'همه', image:'تصاویر', news:'اخبار', map:'نقشه‌ها', knowledge:'دانش', tour:'سفر', video:'ویدیوها', sns:'اجتماعی', blog:'وبلاگ‌ها', cafe:'انجمن‌ها', book:'کتاب‌ها', shopping:'خرید', sports:'ورزش', finance:'مالی', webtoon:'وب‌تون' },
    groups:{ authority:'رسمی/معتبر', news:'اخبار', local_tour:'نقشه/سفر/محلی', media:'تصاویر/ویدیوها', social:'اجتماعی', community:'وبلاگ/انجمن', knowledge:'دانش/کتاب', shopping:'خرید', sports:'ورزش', finance:'مالی', webtoon:'وب‌تون', web:'وب' },
    strings:{ pageTitle:'جستجوی جهانی IGDC', brand:'جستجوی جهانی IGDC', placeholder:'در جهان جستجو کنید…', searchButton:'جستجو', searching:'در حال جستجوی {type} برای «{q}»...', noResults:'نتیجه‌ای برای «{q}» یافت نشد', results:'{count} نتیجه برای «{q}» · {type}', count:'{count}', showMore:'نمایش {count} مورد بیشتر در {label}', collapse:'بستن', noTitle:'(بدون عنوان)', poweredBy:'Powered by IGDC · جستجوی یکپارچه جهانی' }
  },
  fr: {
    name:'Français',
    tabs:{ all:'Tout', image:'Images', news:'Actualités', map:'Cartes', knowledge:'Savoir', tour:'Voyage', video:'Vidéos', sns:'Social', blog:'Blogs', cafe:'Forums', book:'Livres', shopping:'Shopping', sports:'Sports', finance:'Finance', webtoon:'Webtoons' },
    groups:{ authority:'Officiel/Autorité', news:'Actualités', local_tour:'Cartes/Voyage/Local', media:'Images/Vidéos', social:'Social', community:'Blogs/Forums', knowledge:'Savoir/Livres', shopping:'Shopping', sports:'Sports', finance:'Finance', webtoon:'Webtoons', web:'Web' },
    strings:{ pageTitle:'Recherche mondiale IGDC', brand:'Recherche mondiale IGDC', placeholder:'Rechercher dans le monde…', searchButton:'Rechercher', searching:'Recherche {type} pour « {q} »...', noResults:'Aucun résultat pour « {q} »', results:'{count} résultats pour « {q} » · {type}', count:'{count}', showMore:'Afficher {count} de plus dans {label}', collapse:'Réduire', noTitle:'(sans titre)', poweredBy:'Powered by IGDC · Recherche mondiale unifiée' }
  },
  hi: {
    name:'हिन्दी',
    tabs:{ all:'सभी', image:'चित्र', news:'समाचार', map:'मानचित्र', knowledge:'ज्ञान', tour:'पर्यटन', video:'वीडियो', sns:'सोशल', blog:'ब्लॉग', cafe:'फ़ोरम', book:'पुस्तकें', shopping:'खरीदारी', sports:'खेल', finance:'वित्त', webtoon:'वेबटून' },
    groups:{ authority:'आधिकारिक/प्रामाणिक', news:'समाचार', local_tour:'मानचित्र/पर्यटन/स्थानीय', media:'चित्र/वीडियो', social:'सोशल', community:'ब्लॉग/फ़ोरम', knowledge:'ज्ञान/पुस्तकें', shopping:'खरीदारी', sports:'खेल', finance:'वित्त', webtoon:'वेबटून', web:'वेब' },
    strings:{ pageTitle:'IGDC वैश्विक खोज', brand:'IGDC वैश्विक खोज', placeholder:'दुनिया में खोजें…', searchButton:'खोजें', searching:'"{q}" के लिए {type} खोजा जा रहा है...', noResults:'"{q}" के लिए कोई परिणाम नहीं', results:'"{q}" के लिए {count} परिणाम · {type}', count:'{count}', showMore:'{label} में {count} और दिखाएँ', collapse:'समेटें', noTitle:'(शीर्षक नहीं)', poweredBy:'Powered by IGDC · वैश्विक एकीकृत खोज' }
  },
  hu: {
    name:'Magyar',
    tabs:{ all:'Összes', image:'Képek', news:'Hírek', map:'Térképek', knowledge:'Tudás', tour:'Utazás', video:'Videók', sns:'Közösségi', blog:'Blogok', cafe:'Fórumok', book:'Könyvek', shopping:'Vásárlás', sports:'Sport', finance:'Pénzügy', webtoon:'Webtoonok' },
    groups:{ authority:'Hivatalos/Hiteles', news:'Hírek', local_tour:'Térképek/Utazás/Helyi', media:'Képek/Videók', social:'Közösségi', community:'Blogok/Fórumok', knowledge:'Tudás/Könyvek', shopping:'Vásárlás', sports:'Sport', finance:'Pénzügy', webtoon:'Webtoonok', web:'Web' },
    strings:{ pageTitle:'IGDC globális keresés', brand:'IGDC globális keresés', placeholder:'Keressen a világban…', searchButton:'Keresés', searching:'{type} keresése erre: „{q}”...', noResults:'Nincs találat erre: „{q}”', results:'{count} találat erre: „{q}” · {type}', count:'{count}', showMore:'További {count} megjelenítése itt: {label}', collapse:'Összecsukás', noTitle:'(nincs cím)', poweredBy:'Powered by IGDC · Globális egységes keresés' }
  },
  es: {
    name:'Español',
    tabs:{ all:'Todo', image:'Imágenes', news:'Noticias', map:'Mapas', knowledge:'Conocimiento', tour:'Viajes', video:'Videos', sns:'Social', blog:'Blogs', cafe:'Foros', book:'Libros', shopping:'Compras', sports:'Deportes', finance:'Finanzas', webtoon:'Webtoons' },
    groups:{ authority:'Oficial/Autoridad', news:'Noticias', local_tour:'Mapas/Viajes/Local', media:'Imágenes/Videos', social:'Social', community:'Blogs/Foros', knowledge:'Conocimiento/Libros', shopping:'Compras', sports:'Deportes', finance:'Finanzas', webtoon:'Webtoons', web:'Web' },
    strings:{ pageTitle:'Búsqueda global IGDC', brand:'Búsqueda global IGDC', placeholder:'Busca en el mundo…', searchButton:'Buscar', searching:'Buscando {type} para "{q}"...', noResults:'No hay resultados para "{q}"', results:'{count} resultados para "{q}" · {type}', count:'{count}', showMore:'Mostrar {count} más en {label}', collapse:'Contraer', noTitle:'(sin título)', poweredBy:'Powered by IGDC · Búsqueda global unificada' }
  },
  id: {
    name:'Indonesia',
    tabs:{ all:'Semua', image:'Gambar', news:'Berita', map:'Peta', knowledge:'Pengetahuan', tour:'Wisata', video:'Video', sns:'Sosial', blog:'Blog', cafe:'Forum', book:'Buku', shopping:'Belanja', sports:'Olahraga', finance:'Keuangan', webtoon:'Webtoon' },
    groups:{ authority:'Resmi/Otoritatif', news:'Berita', local_tour:'Peta/Wisata/Lokal', media:'Gambar/Video', social:'Sosial', community:'Blog/Forum', knowledge:'Pengetahuan/Buku', shopping:'Belanja', sports:'Olahraga', finance:'Keuangan', webtoon:'Webtoon', web:'Web' },
    strings:{ pageTitle:'Pencarian Global IGDC', brand:'Pencarian Global IGDC', placeholder:'Cari di seluruh dunia…', searchButton:'Cari', searching:'Mencari {type} untuk "{q}"...', noResults:'Tidak ada hasil untuk "{q}"', results:'{count} hasil untuk "{q}" · {type}', count:'{count}', showMore:'Tampilkan {count} lagi di {label}', collapse:'Ciutkan', noTitle:'(tanpa judul)', poweredBy:'Powered by IGDC · Pencarian Global Terpadu' }
  },
  it: {
    name:'Italiano',
    tabs:{ all:'Tutto', image:'Immagini', news:'Notizie', map:'Mappe', knowledge:'Conoscenza', tour:'Viaggi', video:'Video', sns:'Social', blog:'Blog', cafe:'Forum', book:'Libri', shopping:'Shopping', sports:'Sport', finance:'Finanza', webtoon:'Webtoon' },
    groups:{ authority:'Ufficiale/Autorevole', news:'Notizie', local_tour:'Mappe/Viaggi/Locale', media:'Immagini/Video', social:'Social', community:'Blog/Forum', knowledge:'Conoscenza/Libri', shopping:'Shopping', sports:'Sport', finance:'Finanza', webtoon:'Webtoon', web:'Web' },
    strings:{ pageTitle:'Ricerca globale IGDC', brand:'Ricerca globale IGDC', placeholder:'Cerca nel mondo…', searchButton:'Cerca', searching:'Ricerca {type} per "{q}"...', noResults:'Nessun risultato per "{q}"', results:'{count} risultati per "{q}" · {type}', count:'{count}', showMore:'Mostra altri {count} in {label}', collapse:'Comprimi', noTitle:'(senza titolo)', poweredBy:'Powered by IGDC · Ricerca globale unificata' }
  },
  ja: {
    name:'日本語',
    tabs:{ all:'すべて', image:'画像', news:'ニュース', map:'地図', knowledge:'知識', tour:'旅行', video:'動画', sns:'ソーシャル', blog:'ブログ', cafe:'フォーラム', book:'書籍', shopping:'ショッピング', sports:'スポーツ', finance:'金融', webtoon:'ウェブトゥーン' },
    groups:{ authority:'公式/権威', news:'ニュース', local_tour:'地図/旅行/地域', media:'画像/動画', social:'ソーシャル', community:'ブログ/フォーラム', knowledge:'知識/書籍', shopping:'ショッピング', sports:'スポーツ', finance:'金融', webtoon:'ウェブトゥーン', web:'ウェブ' },
    strings:{ pageTitle:'IGDC グローバル検索', brand:'IGDC グローバル検索', placeholder:'世界を検索…', searchButton:'検索', searching:'「{q}」の{type}を検索中...', noResults:'「{q}」の結果はありません', results:'「{q}」の {count} 件の結果 · {type}', count:'{count}件', showMore:'{label}でさらに{count}件表示', collapse:'閉じる', noTitle:'（タイトルなし）', poweredBy:'Powered by IGDC · グローバル統合検索' }
  },
  nl: {
    name:'Nederlands',
    tabs:{ all:'Alles', image:'Afbeeldingen', news:'Nieuws', map:'Kaarten', knowledge:'Kennis', tour:'Reizen', video:'Video’s', sns:'Sociaal', blog:'Blogs', cafe:'Forums', book:'Boeken', shopping:'Winkelen', sports:'Sport', finance:'Financiën', webtoon:'Webtoons' },
    groups:{ authority:'Officieel/Autoriteit', news:'Nieuws', local_tour:'Kaarten/Reizen/Lokaal', media:'Afbeeldingen/Video’s', social:'Sociaal', community:'Blogs/Forums', knowledge:'Kennis/Boeken', shopping:'Winkelen', sports:'Sport', finance:'Financiën', webtoon:'Webtoons', web:'Web' },
    strings:{ pageTitle:'IGDC Wereldwijde zoekfunctie', brand:'IGDC Wereldwijde zoekfunctie', placeholder:'Zoek wereldwijd…', searchButton:'Zoeken', searching:'Zoeken naar {type} voor "{q}"...', noResults:'Geen resultaten voor "{q}"', results:'{count} resultaten voor "{q}" · {type}', count:'{count}', showMore:'Toon nog {count} in {label}', collapse:'Inklappen', noTitle:'(geen titel)', poweredBy:'Powered by IGDC · Wereldwijde uniforme zoekfunctie' }
  },
  ms: {
    name:'Bahasa Melayu',
    tabs:{ all:'Semua', image:'Imej', news:'Berita', map:'Peta', knowledge:'Pengetahuan', tour:'Pelancongan', video:'Video', sns:'Sosial', blog:'Blog', cafe:'Forum', book:'Buku', shopping:'Beli-belah', sports:'Sukan', finance:'Kewangan', webtoon:'Webtoon' },
    groups:{ authority:'Rasmi/Berautoriti', news:'Berita', local_tour:'Peta/Pelancongan/Tempatan', media:'Imej/Video', social:'Sosial', community:'Blog/Forum', knowledge:'Pengetahuan/Buku', shopping:'Beli-belah', sports:'Sukan', finance:'Kewangan', webtoon:'Webtoon', web:'Web' },
    strings:{ pageTitle:'Carian Global IGDC', brand:'Carian Global IGDC', placeholder:'Cari di seluruh dunia…', searchButton:'Cari', searching:'Mencari {type} untuk "{q}"...', noResults:'Tiada hasil untuk "{q}"', results:'{count} hasil untuk "{q}" · {type}', count:'{count}', showMore:'Tunjukkan {count} lagi dalam {label}', collapse:'Runtuhkan', noTitle:'(tiada tajuk)', poweredBy:'Powered by IGDC · Carian Global Bersepadu' }
  }
};

const SEARCH_LANG_ALIASES = {
  kr:'ko', kor:'ko', korean:'ko',
  en:'en', eng:'en',
  de:'de', ger:'de', deu:'de',
  bn:'bn', ar:'ar', pl:'pl', pt:'pt', ru:'ru', sv:'sv', sw:'sw', ta:'ta', th:'th', tl:'tl', tr:'tr', uk:'uk', ur:'ur', uz:'uz', vi:'vi', fa:'fa', fr:'fr', hi:'hi', hu:'hu',
  zh:'zh', cn:'zh', 'zh-cn':'zh', zhs:'zh', 'zh-hans':'zh',
  zht:'zh-Hant', tw:'zh-Hant', 'zh-tw':'zh-Hant', 'zh-hk':'zh-Hant', 'zh-hant':'zh-Hant',
  es:'es', id:'id', it:'it', ja:'ja', jp:'ja', nl:'nl', ms:'ms'
};

function normalizeUiLang(v){
  const raw = String(v || '').trim();
  if(!raw) return '';
  const low = raw.replace('_','-').toLowerCase();
  const base = low.split('-')[0];
  return SEARCH_LANG_ALIASES[low] || SEARCH_LANG_ALIASES[base] || (SEARCH_I18N[raw] ? raw : (SEARCH_I18N[low] ? low : ''));
}

function inferLangFromPath(pathname){
  const raw = String(pathname || '').trim();
  if(!raw) return '';

  let path = raw;
  try{ path = new URL(raw, location.origin).pathname; }catch(e){}
  try{ path = decodeURIComponent(path); }catch(e){}
  path = path.replace(/\\/g, '/');

  const parts = path.split('/').filter(Boolean);
  const file = parts.length ? parts[parts.length - 1] : '';

  const fileLang = file.match(/_([a-z]{2,3}|zh[-_]?hant)(?:\.html)?$/i);
  if(fileLang){
    const hit = normalizeUiLang(fileLang[1]);
    if(hit) return hit;
  }

  for(let i = parts.length - 1; i >= 0; i--){
    const seg = String(parts[i] || '').replace(/\.html$/i, '');
    const hit = normalizeUiLang(seg);
    if(hit) return hit;
  }

  if(/^home\.html$/i.test(file)) return 'ko';
  return '';
}

function inferLangFromFromParam(){
  const from = (params.get('from') || '').trim();
  if(!from) return '';
  return inferLangFromPath(from);
}

function inferLangFromReferrer(){
  try{
    if(!document.referrer) return '';
    const u = new URL(document.referrer);
    if(u.origin !== location.origin) return '';
    return inferLangFromPath(u.pathname);
  }catch(e){
    return '';
  }
}

function detectUiLang(){
  const urlLang = normalizeUiLang(params.get('lang') || params.get('locale') || params.get('ui'));
  const fromLang = inferLangFromFromParam();
  const refLang = inferLangFromReferrer();
  const pathLang = inferLangFromPath(location.pathname);
  const docLang = normalizeUiLang(document.documentElement.getAttribute('lang') || '');
  const bridgeLang = normalizeUiLang(window.IGTC_CURRENT_LANG || window.IGDC_CURRENT_LANG || '');
  let stored = '';
  try{ stored = normalizeUiLang(localStorage.getItem('igdc_lang') || ''); }catch(e){}

  if(urlLang) return urlLang;

  if(isSearchPage){
    if(fromLang) return fromLang;
    if(refLang) return refLang;
    if(pathLang) return pathLang;
    if(bridgeLang) return bridgeLang;
    if(docLang && docLang !== 'ko') return docLang;
    if(stored) return stored;
    return 'ko';
  }

  if(pathLang) return pathLang;
  if(docLang) return docLang;
  if(bridgeLang) return bridgeLang;
  if(stored) return stored;
  return 'ko';
}

function langForUrl(lang){
  const v = normalizeUiLang(lang || detectUiLang()) || 'ko';
  return v === 'zh-Hant' ? 'zht' : v;
}

const UI_LANG = detectUiLang();
const UI = SEARCH_I18N[UI_LANG] || SEARCH_I18N.ko;
// Do not write the search UI language back to localStorage here.
// The search page must not lock future visits into a previously used language.

function tr(key, vars){
  const dict = (UI && UI.strings) || {};
  const base = SEARCH_I18N.ko.strings || {};
  const template = String(dict[key] || base[key] || key);
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    return vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '';
  });
}

function tabLabel(type){
  return (UI.tabs && UI.tabs[type]) || SEARCH_I18N.ko.tabs[type] || type;
}

function groupLabel(group){
  return (UI.groups && UI.groups[group]) || SEARCH_I18N.ko.groups[group] || group || tabLabel('all');
}

function formatCount(count){
  return tr('count', { count });
}

function formatShowMore(label, count){
  return tr('showMore', { label, count });
}

function applySearchUiLanguage(){
  const langForHtml = UI_LANG === 'zh-Hant' ? 'zh-Hant' : UI_LANG;
  const isRtl = RTL_SEARCH_LANGS.has(UI_LANG);
  const dir = isRtl ? 'rtl' : 'ltr';

  document.documentElement.setAttribute('lang', langForHtml);
  // Keep the search page layout in its original position.
  // RTL is scoped to the search input/tabs/status/results area only.
  document.documentElement.removeAttribute('dir');
  if(document.body){
    document.body.removeAttribute('dir');
    document.body.classList.toggle('igdc-search-rtl', isRtl);
  }
  if(isSearchPage) document.title = tr('pageTitle');

  if(!document.getElementById('igdc-search-rtl-scope-style')){
    const rtlStyle = document.createElement('style');
    rtlStyle.id = 'igdc-search-rtl-scope-style';
    rtlStyle.textContent = `
      body.igdc-search-rtl #searchInput { direction: rtl; text-align: right; }
      body.igdc-search-rtl #maru-search-tabs,
      body.igdc-search-rtl #searchStatus,
      body.igdc-search-rtl #searchResults { direction: rtl; text-align: right; }
      body.igdc-search-rtl #maru-search-tabs { justify-content: flex-start; }
      body.igdc-search-rtl #maru-page-controls { direction: ltr; text-align: center; }
      body.igdc-search-rtl .maru-search-card-body { direction: rtl; }
      body.igdc-search-rtl .maru-card-media { direction: ltr; }
    `;
    document.head.appendChild(rtlStyle);
  }

  const brand = document.querySelector('.brand');
  if(brand) brand.textContent = tr('brand');

  if(input){
    input.placeholder = tr('placeholder');
    input.setAttribute('aria-label', tr('placeholder'));
    input.dir = dir;
    input.style.textAlign = isRtl ? 'right' : '';
  }
  if(btn) btn.textContent = tr('searchButton');
  if(status){ status.dir = dir; status.style.textAlign = isRtl ? 'right' : ''; }
  if(results){ results.dir = dir; results.style.textAlign = isRtl ? 'right' : ''; }

  const footer = document.querySelector('footer');
  if(footer) footer.textContent = tr('poweredBy');
}

const SEARCH_TABS = SEARCH_TAB_KEYS.map(type => [type, tabLabel(type)]);

function normalizeSearchType(v){
  const raw = String(v || '').trim().toLowerCase();
  const allowed = new Set(SEARCH_TABS.map(x => x[0]));
  const alias = { books: 'book', 도서: 'book', 책: 'book', sns: 'sns', social: 'sns' };
  return allowed.has(raw) ? raw : (alias[raw] || 'all');
}

function getTypeLabel(type){
  const hit = SEARCH_TABS.find(x => x[0] === normalizeSearchType(type));
  return hit ? hit[1] : tabLabel('all');
}


function ensureSearchCardMediaStyle(){
  if (document.getElementById('maru-search-media-style')) return;

  const style = document.createElement('style');
  style.id = 'maru-search-media-style';
  style.textContent = `
    .maru-search-card-body {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      width: 100%;
    }
    .maru-search-card-text {
      min-width: 0;
      flex: 1 1 auto;
    }
    .maru-card-media {
      flex: 0 0 280px;
      width: 280px;
      max-width: 42%;
      margin-top: 0 !important;
      display: grid;
      gap: 7px;
      overflow: hidden;
      align-self: flex-start;
    }
    .maru-card-media img {
      display: block;
      width: 100%;
      height: 168px;
      object-fit: cover;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #eef2f7;
    }
    .maru-card-media[data-count="1"] {
      grid-template-columns: 1fr;
      flex-basis: 280px;
      width: 280px;
    }
    .maru-card-media[data-count="2"] {
      grid-template-columns: 1fr 1fr;
      flex-basis: 310px;
      width: 310px;
    }
    .maru-card-media[data-count="2"] img {
      height: 154px;
    }
    .maru-card-media[data-count="3"] {
      grid-template-columns: 1.35fr 1fr;
      grid-template-rows: 1fr 1fr;
      flex-basis: 330px;
      width: 330px;
    }
    .maru-card-media[data-count="3"] img:first-child {
      grid-row: 1 / span 2;
      height: 206px;
    }
    .maru-card-media[data-count="3"] img:not(:first-child) {
      height: 99px;
    }

    /* Book / webtoon / shopping-like vertical cover cards */
    .maru-card-media[data-kind="poster"] {
      flex-basis: 150px;
      width: 150px;
      max-width: 24%;
    }
    .maru-card-media[data-kind="poster"] img {
      height: 210px;
      object-fit: cover;
    }

    /* News / article-like cards: slightly wide, readable image */
    .maru-card-media[data-kind="article"] {
      flex-basis: 280px;
      width: 280px;
    }

    /* Image/search-gallery style cards */
    .maru-card-media[data-kind="gallery"] {
      flex-basis: 330px;
      width: 330px;
    }

    .maru-display-section {
      margin: 0 0 12px 0;
      padding: 0;
      border: 1px solid #eef2f7;
      border-radius: 14px;
      background: #ffffff;
      overflow: hidden;
    }
    .maru-display-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      background: linear-gradient(180deg, #ffffff, #f8fafc);
    }
    .maru-display-section-title {
      font-size: 14px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.01em;
    }
    .maru-display-section-meta {
      font-size: 12px;
      font-weight: 700;
      color: #64748b;
      white-space: nowrap;
    }
    .maru-display-section-body {
      padding: 8px 10px 10px;
    }
    .maru-display-section-body > .card {
      margin: 8px 0;
    }
    .maru-display-more {
      width: 100%;
      margin: 8px 0 2px;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
      background: #f8fafc;
      color: #334155;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
    }
    .maru-display-more:hover {
      background: #eef2ff;
      border-color: #c7d2fe;
    }

    @media (max-width: 720px) {
      .maru-search-card-body {
        display: block;
      }
      .maru-card-media {
        width: 100%;
        max-width: 100%;
        margin-top: 10px !important;
      }
      .maru-card-media img {
        height: 190px;
      }
    }
  `;
  document.head.appendChild(style);
}

ensureSearchCardMediaStyle();
applySearchUiLanguage();


const type0 = normalizeSearchType(params.get('type') || 'all');
activeType = type0;

function getSafeReturnUrl() {
  try {
    const from = (new URLSearchParams(location.search).get('from') || '').trim();
    if (!from) return '';
    const u = new URL(from, location.origin);
    if (u.origin !== location.origin) return '';
    return u.pathname + u.search + u.hash;
  } catch (e) {
    return '';
  }
}

function buildSearchUrl(q) {
  const u = new URL('/search.html', location.origin);
  u.searchParams.set('q', q);
  u.searchParams.set('lang', langForUrl(detectUiLang()));
  if (activeType && activeType !== 'all') {
    u.searchParams.set('type', activeType);
  }

  const currentFrom = getSafeReturnUrl();
  if (currentFrom) {
    u.searchParams.set('from', currentFrom);
  } else if (!isSearchPage) {
    const fallbackFrom = location.pathname + location.search + location.hash;
    u.searchParams.set('from', fallbackFrom);
  }

  return u.pathname + u.search + u.hash;
}

function ensureSearchHistoryBridge() {
  if (!isSearchPage) return;

  const returnUrl = getSafeReturnUrl();
  if (!returnUrl) return;

  const state = history.state || {};
  if (state && state.__searchBridgeInstalled) return;

  history.replaceState(
    {
      ...(state || {}),
      __searchBridgeInstalled: true,
      __searchEntry: true,
      q: q0 || '',
      from: returnUrl
    },
    '',
    location.href
  );

  history.pushState(
    {
      __searchBridgeMarker: true,
      from: returnUrl
    },
    '',
    location.href
  );
}

function syncSearchFromUrl(run = true) {
  const sp = new URLSearchParams(location.search);
  const qp = (sp.get('q') || '').trim();
  const pageParam = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const blockParam = Math.max(0, parseInt(sp.get('block') || '0', 10) || 0);
  activeType = normalizeSearchType(sp.get('type') || 'all');
  updateSearchTabsActive();

  input.value = qp;

  if (run && qp) {
    runSearch(qp, activeType).then(() => {
      currentPage = pageParam;
      currentBlock = blockParam;
      renderPage(currentPage);
    });
  } else if (run && !qp) {
    allItems = [];
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
  }
}

window.addEventListener('popstate', (e) => {
  if (!isSearchPage) return;

  const state = e.state || {};

  // 1️⃣ 검색 진입 이전 페이지로 복귀
  if (state.__searchEntry && state.from) {
    location.href = state.from;
    return;
  }

  // 2️⃣ URL 기준으로 항상 복원 (state 의존 제거)
  const sp = new URLSearchParams(location.search);

  const page = Math.max(
    1,
    parseInt(sp.get('page') || state.page || '1', 10) || 1
  );

  const block = Math.max(
    0,
    parseInt(sp.get('block') || state.block || '0', 10) || 0
  );

  const q = (sp.get('q') || state.q || '').trim();
  const nextType = normalizeSearchType(sp.get('type') || state.type || 'all');
  activeType = nextType;
  updateSearchTabsActive();

  // 3️⃣ 검색어 동기화
  if (q && input.value !== q) {
    input.value = q;
  }

  // 4️⃣ 데이터 없거나 검색어/탭이 바뀌면 다시 검색
  if (!allItems || !allItems.length || q !== lastQuery || nextType !== lastType) {
    runSearch(q, nextType).then(() => {
      currentPage = page;
      currentBlock = block;
      renderPage(currentPage);
    });
    return;
  }

  // 5️⃣ 바로 페이지 복원
  currentPage = page;
  currentBlock = block;
  renderPage(currentPage);
});

if (q0) {
  input.value = q0;
}

ensureSearchTabs();
updateSearchTabsActive();

if (q0) {
  syncSearchFromUrl(true);
} else {
  status.textContent = '';
}

btn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  const q = input.value.trim();
  if (!q) return;

  if (isSearchPage) {
    const currentQ = (new URLSearchParams(location.search).get('q') || '').trim();

    if (currentQ === q) {
      runSearch(q, activeType);
      return;
    }

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.set('lang', langForUrl(UI_LANG));
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
    else u.searchParams.delete('type');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: activeType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, activeType);
    return;
  }

  window.location.assign(buildSearchUrl(q));
});

input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;

  e.preventDefault();
  e.stopPropagation();

  const q = input.value.trim();
  if (!q) return;

  if (isSearchPage) {
    const currentQ = (new URLSearchParams(location.search).get('q') || '').trim();

    if (currentQ === q) {
      runSearch(q, activeType);
      return;
    }

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.set('lang', langForUrl(UI_LANG));
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
    else u.searchParams.delete('type');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: activeType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, activeType);
    return;
  }

  window.location.assign(buildSearchUrl(q));
});

function unwrap(x){
  if (!x) return {};
  if (x.data && Array.isArray(x.data.items)) return x.data;
  if (x.baseResult && Array.isArray(x.baseResult.items)) return x.baseResult;
  if (x.baseResult && x.baseResult.data && Array.isArray(x.baseResult.data.items)) return x.baseResult.data;
  return x;
}

function normalizeItems(payload){

  if (!payload) return [];

  if (Array.isArray(payload.items)) return payload.items;

  if (payload.data && Array.isArray(payload.data)) return payload.data;

  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;

  if (Array.isArray(payload.results)) return payload.results;

  if (payload.baseResult && Array.isArray(payload.baseResult.items)) {
    return payload.baseResult.items;
  }

  if (payload.baseResult && payload.baseResult.data && Array.isArray(payload.baseResult.data.items)) {
    return payload.baseResult.data.items;
  }

  const d = unwrap(payload) || {};

  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.results)) return d.results;

  return [];
}

    function safeText(v){
      return String(v || '').toLowerCase();
    }

    function matchesBankItem(it, q){
      const qq = safeText(q);
      const haystack = [
        it.title,
        it.summary,
        it.description,
        it.url,
        it.link,
        it.channel,
        it.section,
        it.lang,
        it.source?.name,
        it.source?.platform,
        it.bind?.page,
        it.bind?.section,
        it.bind?.psom_key,
        Array.isArray(it.tags) ? it.tags.join(' ') : '',
        it.producer?.name,
        it.geo?.country,
        it.geo?.state,
        it.geo?.city
      ].map(safeText).join(' ');
      return haystack.includes(qq);
    }

   function dedupeItems(items){
  const out = [];
  const seen = new Set();

  for (const it of Array.isArray(items) ? items : []) {
    const rawUrl = String(it?.url || it?.link || '').trim();
    const normUrl = rawUrl.toLowerCase();

    const isPlaceholderUrl =
      !rawUrl ||
      rawUrl === '#' ||
      rawUrl === '/' ||
      normUrl === 'javascript:void(0)' ||
      normUrl.startsWith('javascript:');

    const key = (
      !isPlaceholderUrl
        ? rawUrl
        : (String(it?.id || '').trim() ||
           ((String(it?.title || '').trim()) + '|' + String(it?.source?.name || it?.source || '').trim()))
    ).toLowerCase();

    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }

  return out;
}

async function fetchSearch(q, type = activeType){
  const safeType = normalizeSearchType(type);
  const url = `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=${FETCH_LIMIT}&type=${encodeURIComponent(safeType)}&tab=${encodeURIComponent(safeType)}&lang=${encodeURIComponent(langForUrl(UI_LANG))}`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return [];

    const json = await r.json();
    if (!json) return [];
    if (json.status === 'error') return [];
    if (json.status === 'blocked') return [];

    return normalizeItems(json);
  } catch (e) {
    console.error('fetchSearch failed:', e);
    return [];
  }
}

    function renderSkeleton(count = 6){
      results.innerHTML = '';
      for (let i = 0; i < count; i++){
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div style="padding:12px 0">
            <div style="height:14px;width:60%;background:#eee;margin-bottom:6px"></div>
            <div style="height:11px;width:40%;background:#f0f0f0;margin-bottom:6px"></div>
            <div style="height:12px;width:90%;background:#f5f5f5"></div>
          </div>
        `;
        results.appendChild(card);
      }
    }


    function ensureSearchTabs(){
      if (!isSearchPage) return null;
      let bar = document.getElementById('maru-search-tabs');
      if (bar) return bar;

      bar = document.createElement('div');
      bar.id = 'maru-search-tabs';
      bar.style.display = 'flex';
      bar.style.alignItems = 'center';
      bar.style.gap = '8px';
      bar.style.overflowX = 'auto';
      bar.style.whiteSpace = 'nowrap';
      bar.style.padding = '10px 24px 8px';
      bar.style.borderBottom = '1px solid #eef2f7';
      bar.style.background = '#fff';
      bar.style.position = 'sticky';
      bar.style.top = '65px';
      bar.style.zIndex = '90';

      SEARCH_TABS.forEach(([type, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.type = type;
        b.textContent = label;
        b.style.padding = '8px 13px';
        b.style.borderRadius = '999px';
        b.style.border = '1px solid #e5e7eb';
        b.style.background = '#f8fafc';
        b.style.color = '#111827';
        b.style.fontSize = '14px';
        b.style.fontWeight = '600';
        b.style.cursor = 'pointer';
        b.onclick = () => switchSearchType(type);
        bar.appendChild(b);
      });

      status.parentNode.insertBefore(bar, status);
      return bar;
    }

    function updateSearchTabsActive(){
      const bar = document.getElementById('maru-search-tabs');
      if (!bar) return;
      const type = normalizeSearchType(activeType);
      Array.from(bar.querySelectorAll('button[data-type]')).forEach(btn => {
        const on = btn.dataset.type === type;
        btn.style.background = on ? '#4f46e5' : '#f8fafc';
        btn.style.color = on ? '#fff' : '#111827';
        btn.style.borderColor = on ? '#4f46e5' : '#e5e7eb';
      });
    }

    function switchSearchType(type){
      activeType = normalizeSearchType(type);
      updateSearchTabsActive();

      const q = input.value.trim() || (new URLSearchParams(location.search).get('q') || '').trim();
      if (!q) return;

      const u = new URL(location.href);
      u.searchParams.set('q', q);
      u.searchParams.set('lang', langForUrl(UI_LANG));
      u.searchParams.set('page', '1');
      u.searchParams.set('block', '0');
      if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
      else u.searchParams.delete('type');

      history.pushState({ q, type: activeType, page: 1, block: 0 }, '', u.toString());
      runSearch(q, activeType);
    }

    function clearPager(){
      const bar = document.getElementById('maru-page-controls');
      if (bar) bar.remove();
    }

    function ensurePager(){
      let bar = document.getElementById('maru-page-controls');
      if (!bar){
        bar = document.createElement('div');
        bar.id = 'maru-page-controls';
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
        bar.style.justifyContent = 'center';
        bar.style.gap = '6px';
        bar.style.margin = '8px 0 14px';
        status.parentNode.insertBefore(bar, status.nextSibling);
      }
      return bar;
    }

    function domainOf(url){
      try { return new URL(url).hostname.replace(/^www\./,''); }
      catch(e){ return ''; }
    }

    function faviconOf(url){
      const d = domainOf(url);
      return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : '';
    }


    function isHardRejectImageUrlClient(imageUrl){
      const s = String(imageUrl || '').toLowerCase();
      if(!s) return true;

      const hardBad = [
        'google.com/s2/favicons',
        'favicon',
        'apple-touch-icon',
        '.ico',
        'placeholder',
        'noimage',
        'no_image',
        'no-img',
        'default-image',
        'default_img',
        'sprite',
        'spacer',
        'blank.gif',
        'blank.png',
        'transparent',
        '1x1',
        'pixel',
        'tracking',
        'analytics',
        'captcha'
      ];

      if(hardBad.some(k => s.includes(k))) return true;
      if(/\.(ico)(\?|#|$)/i.test(s)) return true;
      if(/\.(svg)(\?|#|$)/i.test(s) && /(logo|symbol|icon|emblem|brand|ci|bi)/i.test(s)) return true;

      return false;
    }

    function isLikelyMeaninglessImageUrlClient(imageUrl){
      // Conservative filter: reject only clear non-content images.
      // Do not reject provider thumbnails just because their URL contains
      // brand/banner/thumb/small, since many real news/tour/company images do.
      return isHardRejectImageUrlClient(imageUrl);
    }

    function isGenericGovOfficialItemClient(it){
      // Official/government pages often have valid representative images.
      // Do not block them on the client; maru-search already filters hard rejects.
      return false;
    }

    function isMeaningfulImageForItemClient(imageUrl, it){
      const s = String(imageUrl || '').trim();
      if(!s) return false;
      if(!/^https?:\/\//i.test(s) && !s.startsWith('/')) return false;
      if(isHardRejectImageUrlClient(s)) return false;
      return true;
    }


    function collectNaturalImages(it){
      const sourceText = String((it && it.source) || '').toLowerCase();
      const raw = []
        .concat(it && it.thumbnail ? [it.thumbnail] : [])
        .concat(it && it.thumb ? [it.thumb] : [])
        .concat(it && it.image ? [it.image] : [])
        .concat(Array.isArray(it && it.imageSet) ? it.imageSet : []);

      const out = [];
      const seen = new Set();

      raw.forEach(v => {
        const s = String(v || '').trim();
        if (!s) return;

        const low = s.toLowerCase();
        const isFaviconLike =
          low.includes('google.com/s2/favicons') ||
          low.includes('favicon') ||
          low.endsWith('.ico');

        if (isFaviconLike) return;
        if (!/^https?:\/\//i.test(s) && !s.startsWith('/')) return;
        if (!isMeaningfulImageForItemClient(s, it)) return;

        let key = s.split('#')[0].toLowerCase();
        try {
          const u = new URL(s, location.origin);
          key = (u.origin + u.pathname).toLowerCase();
        } catch(e) {}

        if (seen.has(key)) return;

        seen.add(key);
        out.push(s);
      });

      // Naver image API item is one image result; thumbnail/original often look duplicated.
      if (sourceText.includes('naver_image') && out.length > 1) {
        return out.slice(0, 1);
      }

      return out.slice(0, 3);
    }


    function classifyVisualKindClient(it){
      const source = String((it && it.source) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const summary = String((it && (it.summary || it.description)) || '').toLowerCase();
      const text = `${source} ${type} ${mediaType} ${title} ${summary}`;

      if (
        source.includes('book') ||
        type === 'book' ||
        text.includes('도서') ||
        text.includes('책 ') ||
        text.includes('웹툰') ||
        text.includes('만화') ||
        text.includes('shopping') ||
        text.includes('쇼핑')
      ) {
        return 'poster';
      }

      if (
        source.includes('image') ||
        mediaType === 'image' ||
        type === 'image'
      ) {
        return 'gallery';
      }

      return 'article';
    }


    function displayGroupOfItem(it){
      return String((it && it.displayGroup) || '').trim() || inferDisplayGroupClient(it);
    }

    function inferDisplayGroupClient(it){
      const source = String((it && it.source) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const summary = String((it && (it.summary || it.description)) || '').toLowerCase();
      const url = String((it && (it.url || it.link)) || '').toLowerCase();
      const host = domainOf(url).toLowerCase();
      const text = `${source} ${type} ${mediaType} ${title} ${summary} ${host}`;

      if (source.includes('news') || type === 'news' || text.includes('뉴스') || text.includes('속보') || text.includes('latest') || text.includes('breaking')) return 'news';
      if (mediaType === 'image' || type === 'image' || mediaType === 'video' || type === 'video' || source.includes('image') || source.includes('youtube')) return 'media';
      if (source.includes('local') || source.includes('map') || text.includes('관광') || text.includes('여행') || text.includes('지도') || text.includes('맛집') || text.includes('공원') || text.includes('landmark') || text.includes('tour')) return 'local_tour';
      if (source.includes('blog') || source.includes('cafe') || text.includes('블로그') || text.includes('카페')) return 'community';
      if (host.includes('instagram.') || host.includes('facebook.') || host.includes('tiktok.') || host.includes('x.com') || host.includes('twitter.') || source.includes('sns') || source.includes('social')) return 'social';
      if (source.includes('encyc') || source.includes('kin') || source.includes('book') || text.includes('지식') || text.includes('도서') || text.includes('책 ')) return 'knowledge';
      if (host.includes('.go.kr') || host.endsWith('.gov') || host.includes('.gov.') || host.includes('korea.kr')) return 'authority';
      return 'web';
    }

    function displayGroupLabel(group, sample){
      const fallback = sample && sample.displayGroupLabel;
      return fallback || groupLabel(group);
    }

    function displayGroupPreviewLimit(group, sample){
      const n = parseInt(sample && sample.displayGroupPreviewLimit, 10);
      if (n > 0) return n;

      const limits = {
        authority: 3,
        news: 4,
        local_tour: 4,
        media: 4,
        social: 3,
        community: 3,
        knowledge: 3,
        shopping: 3,
        sports: 3,
        finance: 3,
        webtoon: 3,
        web: 15
      };
      return limits[group] || 3;
    }

    function shouldUseDisplayGroups(slice){
      if (!Array.isArray(slice) || !slice.length) return false;
      if (normalizeSearchType(activeType) !== 'all') return false;
      return slice.some(it => it && (it.displayGroup || it.displayGroupLabel));
    }

    function groupSliceForDisplay(slice){
      const order = ['authority','news','local_tour','media','social','community','knowledge','shopping','sports','finance','webtoon','web'];
      const orderIndex = new Map(order.map((g, i) => [g, i]));
      const groups = new Map();

      (Array.isArray(slice) ? slice : []).forEach((it, idx) => {
        const group = displayGroupOfItem(it);
        if (!groups.has(group)) {
          groups.set(group, {
            group,
            label: displayGroupLabel(group, it),
            previewLimit: displayGroupPreviewLimit(group, it),
            items: [],
            firstIndex: idx
          });
        }
        groups.get(group).items.push(it);
      });

      return Array.from(groups.values()).sort((a, b) => {
        const ao = orderIndex.has(a.group) ? orderIndex.get(a.group) : 999;
        const bo = orderIndex.has(b.group) ? orderIndex.get(b.group) : 999;
        return (ao - bo) || (a.firstIndex - b.firstIndex);
      });
    }

    function renderGroupedSlice(slice, page){
      const groups = groupSliceForDisplay(slice);
      groups.forEach(groupInfo => {
        const section = document.createElement('section');
        section.className = 'maru-display-section';
        section.dataset.group = groupInfo.group;

        const head = document.createElement('div');
        head.className = 'maru-display-section-head';

        const title = document.createElement('div');
        title.className = 'maru-display-section-title';
        title.textContent = groupInfo.label;

        const meta = document.createElement('div');
        meta.className = 'maru-display-section-meta';
        meta.textContent = formatCount(groupInfo.items.length);

        head.appendChild(title);
        head.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'maru-display-section-body';

        const stateKey = `${lastQuery || input.value || ''}::${activeType || 'all'}::${page}::${groupInfo.group}`;
        const expanded = expandedDisplayGroups.has(stateKey);
        const limit = Math.max(1, groupInfo.previewLimit || 3);

        groupInfo.items.forEach((it, idx) => {
          const card = renderItem(it, body);
          if (!expanded && idx >= limit) {
            card.style.display = 'none';
            card.dataset.maruCollapsed = '1';
          }
        });

        const hiddenCount = Math.max(0, groupInfo.items.length - limit);
        if (hiddenCount > 0) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'maru-display-more';
          more.textContent = expanded ? tr('collapse') : formatShowMore(groupInfo.label, hiddenCount);
          more.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const willExpand = !expandedDisplayGroups.has(stateKey);
            if (willExpand) expandedDisplayGroups.add(stateKey);
            else expandedDisplayGroups.delete(stateKey);

            Array.from(body.querySelectorAll('[data-maru-collapsed="1"]')).forEach(card => {
              card.style.display = willExpand ? '' : 'none';
            });
            more.textContent = willExpand ? tr('collapse') : formatShowMore(groupInfo.label, hiddenCount);
          });
          body.appendChild(more);
        }

        section.appendChild(head);
        section.appendChild(body);
        results.appendChild(section);
      });
    }


    function renderItem(it, mountTarget){
      const url = it.url || it.link || '';
      const domain = domainOf(url);

      const card = document.createElement('div');
      card.className = 'card';

      if (url) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => { window.location.href = url; });
      }

      const body = document.createElement('div');
      body.className = 'maru-search-card-body';
      body.style.overflow = 'visible';

      const textCol = document.createElement('div');
      textCol.className = 'maru-search-card-text';

      const t = document.createElement('div');
      t.className = 'title';

      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_self';
        a.rel = 'noopener';
        a.textContent = (it.title || '').trim() || tr('noTitle');
        a.style.color = 'inherit';
        a.style.textDecoration = 'none';
        t.appendChild(a);
      } else {
        t.textContent = (it.title || '').trim() || tr('noTitle');
      }

      const l = document.createElement('div');
      l.className = 'link';

      const fav = document.createElement('img');
      fav.src = faviconOf(url);
      fav.style.width = '23px';
      fav.style.height = '23px';
      fav.style.verticalAlign = 'middle';
      fav.style.marginRight = '10px';
      fav.style.borderRadius = '6px';
      fav.style.background = '#ffffff';
      fav.style.border = '1px solid #d6e4ff';
      fav.style.boxShadow = '0 0 0 0 rgba(0,0,0,0)';
      fav.style.padding = '2px';
      fav.onerror = () => fav.remove();

      const span = document.createElement('span');
      span.textContent = domain || (it.source?.name || it.source || '');

      l.appendChild(fav);
      l.appendChild(span);

      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = (it.summary || it.description || '').trim();

  textCol.appendChild(t);

const risk = document.createElement('div');
risk.style.fontSize = '11px';
risk.style.fontWeight = '700';
risk.style.marginTop = '6px';

if (it.riskLabel === '⚠️ high-risk') {
  risk.textContent = it.riskLabel;
  risk.style.color = 'red';
  textCol.appendChild(risk);

} else if (it.riskLabel === '⚠️ medium-risk') {
  risk.textContent = it.riskLabel;
  risk.style.color = 'orange';
  textCol.appendChild(risk);

}
// 그 외는 아예 표시 안 함 (safe 제거)

      textCol.appendChild(risk);
      textCol.appendChild(l);
      if (d.textContent) textCol.appendChild(d);

      if (d && d.textContent) {
        d.style.display = '-webkit-box';
        d.style.webkitLineClamp = '3';
        d.style.webkitBoxOrient = 'vertical';
        d.style.overflow = 'hidden';
        d.style.textOverflow = 'ellipsis';
      }

      const hasImageSet = Array.isArray(it.imageSet) && it.imageSet.length > 0;

      const naturalImages = collectNaturalImages(it);
      const isRealThumb = naturalImages.length > 0;

      const hasVideoPreview =
        it.media &&
        ((it.media.type || it.media.kind) === 'video') &&
        it.media.preview &&
        (it.media.preview.mp4 || it.media.preview.webm || it.media.preview.poster);

      body.appendChild(textCol);

      if (isRealThumb) {
        const mediaWrap = document.createElement('div');
        mediaWrap.className = 'maru-card-media';
        const mediaCount = Math.min(naturalImages.length, 3);
        const mediaKind = classifyVisualKindClient(it);
        mediaWrap.dataset.count = String(mediaCount);
        mediaWrap.dataset.kind = mediaKind;
        body.dataset.mediaCount = String(mediaCount);
        body.dataset.mediaKind = mediaKind;
        body.style.minHeight =
          mediaKind === 'poster' ? '220px' :
          mediaCount >= 3 ? '214px' :
          mediaCount === 2 ? '164px' :
          '176px';

        naturalImages.forEach((src) => {
          const img = document.createElement('img');
          img.src = src;
          img.loading = 'lazy';
          img.alt = '';
          img.onerror = () => img.remove();
          mediaWrap.appendChild(img);
        });

        body.appendChild(mediaWrap);
      }

      if (hasVideoPreview) {
        const videoWrap = document.createElement('div');
        videoWrap.style.marginTop = '8px';
        videoWrap.style.maxHeight = '120px';
        videoWrap.style.overflow = 'hidden';
        videoWrap.style.borderRadius = '6px';

        const video = document.createElement('video');
        const hasPlayableSource = !!(it.media.preview.mp4 || it.media.preview.webm);

        if (!hasPlayableSource) {
          video.controls = false;
        }

        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'none';
        video.style.width = '100%';
        video.style.maxHeight = '120px';
        video.style.objectFit = 'cover';

        if (it.media.preview.poster) video.poster = it.media.preview.poster;

        if (it.media.preview.webm) {
          const s = document.createElement('source');
          s.src = it.media.preview.webm;
          s.type = 'video/webm';
          video.appendChild(s);
        }
        if (it.media.preview.mp4) {
          const s = document.createElement('source');
          s.src = it.media.preview.mp4;
          s.type = 'video/mp4';
          video.appendChild(s);
        }

        videoWrap.addEventListener('mouseenter', () => {
          if (hasPlayableSource) video.play().catch(()=>{});
        });
        videoWrap.addEventListener('mouseleave', () => {
          video.pause();
          video.currentTime = 0;
        });

        videoWrap.appendChild(video);
        body.appendChild(videoWrap);
      }

      // Natural media policy:
      // Do not render a separate imageSet gallery here.
      // The card uses one natural thumbnail when the result itself has one.
      // This prevents duplicate images and keeps card height natural.

      card.appendChild(body);
      (mountTarget || results).appendChild(card);
      return card;
    }


    function itemStableKey(it){
      return String(
        (it && (it.id || it.url || it.link || it.title)) || ''
      ).trim().toLowerCase();
    }

    function mergeEnrichedItems(baseItems, enrichedItems){
      const byKey = new Map();

      (Array.isArray(enrichedItems) ? enrichedItems : []).forEach(it => {
        const key = itemStableKey(it);
        if(key) byKey.set(key, it);
      });

      return (Array.isArray(baseItems) ? baseItems : []).map(it => {
        const key = itemStableKey(it);
        const hit = key ? byKey.get(key) : null;
        if(!hit) return it;

        const imgs = collectNaturalImages(hit);
        if(!imgs.length) return it;

        const merged = {
          ...it,
          thumbnail: hit.thumbnail || imgs[0] || it.thumbnail || '',
          thumb: hit.thumb || imgs[0] || it.thumb || '',
          image: hit.image || imgs[0] || it.image || '',
          imageSet: imgs
        };

        itemImageEnrichCache.set(key, merged);
        return merged;
      });
    }

    async function enrichRenderedPageImages(page, slice, startIndex){
      const q = (input.value || '').trim();
      if(!q || !Array.isArray(slice) || !slice.length) return;

      const cacheKey = [q, activeType || 'all', page].join('::');
      if(pageImageEnrichCache.has(cacheKey)) return;
      pageImageEnrichCache.add(cacheKey);

      const candidates = slice
        .map((it, idx) => ({ it, idx }))
        .filter(x => {
          const key = itemStableKey(x.it);
          if(key && itemImageEnrichCache.has(key)) return false;
          if(collectNaturalImages(x.it).length) return false;
          const url = String((x.it && (x.it.url || x.it.link)) || '').trim();
          return /^https?:\/\//i.test(url);
        })
        .slice(0, PAGE_SIZE);

      if(!candidates.length) return;

      try{
        const url =
          `/.netlify/functions/maru-search?action=enrich-images&q=${encodeURIComponent(q)}&type=${encodeURIComponent(activeType || 'all')}&lang=${encodeURIComponent(UI_LANG)}`;

        const res = await fetch(url, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q,
            type: activeType || 'all',
            items: candidates.map(x => x.it)
          })
        });

        if(!res.ok) return;

        const json = await res.json();
        const enriched = normalizeItems(json);
        if(!enriched.length) return;

        const updatedCandidates = mergeEnrichedItems(candidates.map(x => x.it), enriched);
        let changed = false;

        updatedCandidates.forEach((item, i) => {
          const globalIdx = startIndex + candidates[i].idx;
          if(globalIdx >= 0 && globalIdx < allItems.length && collectNaturalImages(item).length){
            allItems[globalIdx] = item;
            changed = true;
          }
        });

        if(changed && page === currentPage){
          renderPage(page, true);
        }
      }catch(e){
        console.warn('page image enrichment skipped:', e);
      }
    }


    function renderPage(page, skipEnrich = false){
      results.innerHTML = '';
      const start = (page - 1) * PAGE_SIZE;
      const slice = allItems.slice(start, start + PAGE_SIZE);

      if (shouldUseDisplayGroups(slice)) {
        renderGroupedSlice(slice, page);
      } else {
        slice.forEach(it => renderItem(it));
      }

      drawPager();

      if(!skipEnrich){
        enrichRenderedPageImages(page, slice, start);
      }
    }

function updateSearchPageHistory(page, block) {
  if (!isSearchPage) return;

  const u = new URL(location.href);
  u.searchParams.set('lang', langForUrl(UI_LANG));
  u.searchParams.set('page', String(page));
  u.searchParams.set('block', String(block));
  if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
  else u.searchParams.delete('type');

  const currentPageParam = (new URLSearchParams(location.search).get('page') || '1').trim();
  const currentBlockParam = (new URLSearchParams(location.search).get('block') || '0').trim();

  if (currentPageParam === String(page) && currentBlockParam === String(block)) return;

  const safeReturnUrl = getSafeReturnUrl();
  if (safeReturnUrl) {
    u.searchParams.set('from', safeReturnUrl);
  }

  history.pushState(
    {
      ...(history.state || {}),
      page,
      block,
      q: (new URLSearchParams(location.search).get('q') || '').trim(),
      type: activeType,
      from: safeReturnUrl || ''
    },
    '',
    u.toString()
  );
}

function drawPager(){
  const pages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  if (pages <= 1) { clearPager(); return; }

  const bar = ensurePager();
  bar.innerHTML = '';

  const blockStart = currentBlock * BLOCK_SIZE + 1;
  const blockEnd = Math.min(blockStart + BLOCK_SIZE - 1, pages);

  if (blockStart > 1){
    const left = document.createElement('button');
    left.textContent = '◀';
    left.onclick = () => {
      currentBlock = Math.max(0, currentBlock - 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      renderPage(currentPage);
    };
    bar.appendChild(left);
  }

  for (let p = blockStart; p <= blockEnd; p++){
    const b = document.createElement('button');
    b.textContent = String(p);
    b.style.opacity = (p === currentPage) ? '0.6' : '1';
    b.onclick = () => {
      currentPage = p;
      currentBlock = Math.floor((p - 1) / BLOCK_SIZE);
      updateSearchPageHistory(currentPage, currentBlock);
      renderPage(currentPage);
    };
    bar.appendChild(b);
  }

  if (blockEnd < pages){
    const right = document.createElement('button');
    right.textContent = '▶';
    right.onclick = () => {
      const maxBlock = Math.floor((pages - 1) / BLOCK_SIZE);
      currentBlock = Math.min(maxBlock, currentBlock + 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      renderPage(currentPage);
    };
    bar.appendChild(right);
  }
}

async function runSearch(q, type = activeType){
  const qq = (q || '').trim();
  activeType = normalizeSearchType(type);
  updateSearchTabsActive();
  if (!qq){
    allItems = [];
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
    return;
  }

  status.textContent = tr('searching', { type: getTypeLabel(activeType), q: qq });
  renderSkeleton();
  clearPager();

  try {
    const items = await fetchSearch(qq, activeType);
    allItems = dedupeItems([...(items || [])]);

    pageImageEnrichCache.clear();
    itemImageEnrichCache.clear();
    expandedDisplayGroups.clear();

    currentBlock = 0;
    currentPage = 1;
    lastQuery = qq;
    lastType = activeType;

    if (!allItems.length) {
      results.innerHTML = '';
      status.textContent = tr('noResults', { q: qq });
      return;
    }

    renderPage(1);
    status.textContent = tr('results', { count: allItems.length, q: qq, type: getTypeLabel(activeType) });

  } catch(e){
    console.error(e);
    allItems = [];
    results.innerHTML = '';
    clearPager();
    status.textContent = tr('noResults', { q: qq });
  }
}
  });
})();

(function () {
  function normalizeGlobalSearchLang(v){
    const raw = String(v || '').trim();
    if(!raw) return '';
    const low = raw.replace('_','-').toLowerCase();
    const base = low.split('-')[0];
    const aliases = {
      kr:'ko', kor:'ko', ko:'ko', en:'en', de:'de', bn:'bn', ar:'ar', pl:'pl', pt:'pt', ru:'ru', sv:'sv', sw:'sw', ta:'ta', th:'th', tl:'tl', tr:'tr', uk:'uk', ur:'ur', uz:'uz', vi:'vi', fa:'fa', fr:'fr', hi:'hi', hu:'hu',
      zh:'zh', cn:'zh', 'zh-cn':'zh', zhs:'zh', 'zh-hans':'zh', zht:'zh-Hant', tw:'zh-Hant', 'zh-tw':'zh-Hant', 'zh-hk':'zh-Hant', 'zh-hant':'zh-Hant',
      es:'es', id:'id', it:'it', ja:'ja', jp:'ja', nl:'nl', ms:'ms'
    };
    return aliases[low] || aliases[base] || base || 'ko';
  }

  function inferLangFromGlobalPath(pathname){
    const raw = String(pathname || '').trim();
    if(!raw) return '';
    let path = raw;
    try{ path = new URL(raw, location.origin).pathname; }catch(e){}
    try{ path = decodeURIComponent(path); }catch(e){}
    path = path.replace(/\\/g, '/');
    const parts = path.split('/').filter(Boolean);
    const file = parts.length ? parts[parts.length - 1] : '';
    const m = file.match(/_([a-z]{2,3}|zh[-_]?hant)(?:\.html)?$/i);
    if(m){
      const hit = normalizeGlobalSearchLang(m[1]);
      if(hit) return hit;
    }
    for(let i = parts.length - 1; i >= 0; i--){
      const hit = normalizeGlobalSearchLang(String(parts[i] || '').replace(/\.html$/i, ''));
      if(hit) return hit;
    }
    if(/^home\.html$/i.test(file)) return 'ko';
    return '';
  }

  function inferGlobalSearchLang(){
    const pathLang = inferLangFromGlobalPath(location.pathname);
    if(pathLang) return pathLang;

    const htmlLang = normalizeGlobalSearchLang(document.documentElement.getAttribute('lang') || '');
    if(htmlLang) return htmlLang;

    try{
      const bridgeLang = normalizeGlobalSearchLang(window.IGTC_CURRENT_LANG || window.IGDC_CURRENT_LANG || '');
      if(bridgeLang) return bridgeLang;
    }catch(e){}

    try{
      const stored = normalizeGlobalSearchLang(localStorage.getItem('igdc_lang') || '');
      if(stored) return stored;
    }catch(e){}
    return 'ko';
  }

  function runGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;

    const q = input.value.trim();
    if (!q) return;

    const u = new URL('/search.html', location.origin);
    u.searchParams.set('q', q);
    u.searchParams.set('lang', inferGlobalSearchLang());
    u.searchParams.set('from', location.pathname + location.search + location.hash);

    window.location.href = u.pathname + u.search + u.hash;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('globalSearchBtn');
    const input = document.getElementById('globalSearchInput');

    if (btn) btn.addEventListener('click', runGlobalSearch);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') runGlobalSearch();
      });
    }
  });
})();

