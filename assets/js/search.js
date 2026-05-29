// IGDC Search.js — FULL SEARCH PIPELINE PATCH
// PATCH: Sanmaru route-owned natural flow + page-lazy rendering + balanced vertical tabs
// PATCH: search-owned proxy viewer + continuous 4,500 intake + 30-language search UI labels
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
    document.getElementById('globalSearchInput') ||
    document.getElementById('homeSearchInput');

  if (!isSearchPage && !hasSearchUI) return;

    const input   = document.getElementById('searchInput') || document.getElementById('globalSearchInput') || document.getElementById('homeSearchInput');
    const btn     = document.getElementById('searchBtn') || document.getElementById('globalSearchBtn') || document.getElementById('homeSearchBtn');
    const statusEl = document.getElementById('searchStatus');
    const resultsEl = document.getElementById('searchResults');
    const status  = statusEl || { textContent: '' };
    const results = resultsEl || document.createElement('div');
        
    if (!input || !btn) return;

    const PAGE_SIZE = 25;
    const BLOCK_SIZE = 10;
    const MAX_PAGER_PAGES = 499;
    const INITIAL_PRELOAD_PAGES = 12;
    const INITIAL_PRELOAD_TARGET = PAGE_SIZE * INITIAL_PRELOAD_PAGES;
    const INITIAL_DOM_RENDER_TARGET = INITIAL_PRELOAD_TARGET;
    const INITIAL_PROGRESSIVE_PAGER_PAGES = 12;
    const MAX_PROGRESSIVE_PAGER_PAGES = 180;
    const MIN_SMOOTH_CANDIDATES = 120;
    const MAX_SMOOTH_CANDIDATES = PAGE_SIZE * MAX_PROGRESSIVE_PAGER_PAGES;
    const FETCH_LIMIT = MAX_SMOOTH_CANDIDATES;
    const INTAKE_CONCURRENCY = 5;
    const INTAKE_BURST_DELAY_MS = 10;
    // Search HTML should behave as an immediate receiver: once Sanmaru/MaruSearch
    // sends any real packet, open the follow-up faucet on the next short UI beat.
    // This is a handoff cadence, not a network timeout or a result cutoff.
    const FIRST_PIPE_HANDOFF_MS = 10;

    let allItems = [];
    let serverPagedMode = false;
    let serverTotalItems = 0;
    let authoritativeServerTotalItems = 0;
    let progressivePagerPages = INITIAL_PROGRESSIVE_PAGER_PAGES;
    let continuousIntakeSeq = 0;
    let continuousIntakeActive = false;
    const loadedServerPages = new Map();
    let currentPage = 1;
    let currentBlock = 0;
    let activeType = 'all';
    let lastQuery = '';
    let lastType = 'all';
    let lastSearchPayload = null;
    const pageImageEnrichCache = new Set();
    const itemImageEnrichCache = new Map();
    const expandedDisplayGroups = new Set();

    // SANMARU resident switch:
    // The first search signal warms/activates Sanmaru on the server. Later searches
    // should ask Maru Search to use Sanmaru resident supply first, not re-open every
    // provider from the browser flow. This is non-blocking for page navigation.
    const SANMARU_BOOT_URL = '/.netlify/functions/sanmaru_engine_v2';
    let sanmaruBootPromise = null;
    let sanmaruBootKey = '';

    function sanmaruSignalParams(q, type, reason){
      const sp = new URLSearchParams();
      sp.set('action', 'resident-boot');
      sp.set('reason', reason || 'search-ui');
      sp.set('residentSwitch', '1');
      sp.set('warm', '1');
      if (q) sp.set('q', q);
      if (type) sp.set('type', normalizeSearchType(type));
      return sp;
    }

    function bootSanmaruOnce(reason, q, type){
      const safeQ = String(q || '').trim();
      const safeType = normalizeSearchType(type || activeType || 'all');
      const key = [safeQ, safeType, reason || 'search-ui'].join('|');
      if (sanmaruBootPromise && sanmaruBootKey === key) return sanmaruBootPromise;
      sanmaruBootKey = key;
      try {
        const url = SANMARU_BOOT_URL + '?' + sanmaruSignalParams(safeQ, safeType, reason || 'search-ui').toString();
        sanmaruBootPromise = fetch(url, {
          method: 'GET',
          cache: 'no-store',
          keepalive: true
        }).catch(() => null);
      } catch(e) {
        sanmaruBootPromise = Promise.resolve(null);
      }
      return sanmaruBootPromise;
    }

    function signalSanmaruSearch(q, type, reason){
      bootSanmaruOnce(reason || 'search-signal', q, type);
    }

const params = new URLSearchParams(location.search);
const q0 = (params.get('q') || '').trim();
const from0 = (params.get('from') || '').trim();

const SEARCH_TAB_KEYS = [
  'all','map','knowledge','wiki','site','book','blog','cafe','shopping','news','image','video','sns','tour','public_data','academic','sports','finance','webtoon'
];
const SEARCH_TABS = SEARCH_TAB_KEYS.map(key => [key, key]);

const SEARCH_I18N = {
  ko:{home:'Home',globalSearchTitle:'Global Search',search:'Search',placeholder:'Search the world…',resultsFor:'results for',receiving:'receiving...',loadingPage:'Loading page',pageDataSupplying:'Page data is being supplied',noQuickResults:'No quick results',noResults:'No results',searchResultDetail:'검색 결과 상세',searchList:'검색 목록',sourcePage:'원문 보기',source:'출처',domain:'도메인',category:'분류',language:'언어',relatedSearch:'연관 검색',internalSource:'내부 원문',internalSourceHelp:'아래 원문은 IGDC 검색 화면 안에서 표시됩니다. 외부 이동은 원문 보기 버튼으로만 실행됩니다.',viewAll:'전체 보기',collapse:'접기',itemsSuffix:'개',sectionDefault:'일반 웹 결과',tabs:{all:'전체',map:'지도',knowledge:'지식',wiki:'위키',site:'사이트',book:'도서',blog:'블로그',cafe:'카페',shopping:'쇼핑',news:'뉴스',image:'이미지',video:'영상',sns:'소셜',tour:'관광',public_data:'공공자료',academic:'학술',sports:'스포츠',finance:'증권',webtoon:'웹툰'},groups:{authority:'주요 정보',public_data:'공공자료',local_tour:'지도/지역',knowledge:'지식/백과',wiki:'위키',academic:'학술/논문',site:'사이트/홈페이지',book:'도서',news:'뉴스',blog:'블로그',cafe:'카페',community:'커뮤니티',image:'이미지',video:'영상',media:'이미지/영상',social:'SNS',shopping:'쇼핑',sports:'스포츠',finance:'금융',webtoon:'웹툰',web:'일반 웹 결과'}},
  en:{home:'Home',globalSearchTitle:'Global Search',search:'Search',placeholder:'Search the world…',resultsFor:'results for',receiving:'receiving...',loadingPage:'Loading page',pageDataSupplying:'Page data is being supplied',noQuickResults:'No quick results',noResults:'No results',searchResultDetail:'Search result detail',searchList:'Search list',sourcePage:'Original page',source:'Source',domain:'Domain',category:'Category',language:'Language',relatedSearch:'Related searches',internalSource:'Internal original view',internalSourceHelp:'The original page is displayed inside IGDC Search. External navigation is allowed only through Original page.',viewAll:'View all',collapse:'Collapse',itemsSuffix:'',sectionDefault:'General web results',tabs:{all:'All',map:'Maps',knowledge:'Knowledge',wiki:'Wiki',site:'Sites',book:'Books',blog:'Blogs',cafe:'Cafes',shopping:'Shopping',news:'News',image:'Images',video:'Videos',sns:'Social',tour:'Travel',public_data:'Public data',academic:'Academic',sports:'Sports',finance:'Finance',webtoon:'Webtoons'},groups:{authority:'Key information',public_data:'Public data',local_tour:'Maps/Local',knowledge:'Knowledge/Encyclopedia',wiki:'Wiki',academic:'Academic/Papers',site:'Sites/Homepages',book:'Books',news:'News',blog:'Blogs',cafe:'Cafes',community:'Community',image:'Images',video:'Videos',media:'Images/Videos',social:'Social',shopping:'Shopping',sports:'Sports',finance:'Finance',webtoon:'Webtoons',web:'General web results'}},
  zh:{home:'首页',globalSearchTitle:'全球搜索',search:'搜索',placeholder:'搜索世界…',resultsFor:'条结果：',receiving:'接收中...',loadingPage:'正在加载第',pageDataSupplying:'页面数据正在供应',noQuickResults:'暂无快速结果',noResults:'无结果',searchResultDetail:'搜索结果详情',searchList:'返回列表',sourcePage:'原文页面',source:'来源',domain:'域名',category:'分类',language:'语言',relatedSearch:'相关搜索',internalSource:'内部原文',internalSourceHelp:'原文页面在 IGDC 搜索内显示。仅通过原文页面按钮外部打开。',viewAll:'查看全部',collapse:'收起',itemsSuffix:'项',sectionDefault:'普通网页结果',tabs:{all:'全部',map:'地图',knowledge:'知识',wiki:'维基',site:'网站',book:'图书',blog:'博客',cafe:'社群',shopping:'购物',news:'新闻',image:'图片',video:'视频',sns:'社交',tour:'旅游',public_data:'公共数据',academic:'学术',sports:'体育',finance:'财经',webtoon:'网漫'},groups:{authority:'主要信息',public_data:'公共数据',local_tour:'地图/地区',knowledge:'知识/百科',wiki:'维基',academic:'学术/论文',site:'网站/主页',book:'图书',news:'新闻',blog:'博客',cafe:'社群',community:'社区',image:'图片',video:'视频',media:'图片/视频',social:'社交',shopping:'购物',sports:'体育',finance:'财经',webtoon:'网漫',web:'普通网页结果'}},
  zht:{home:'首頁',globalSearchTitle:'全球搜尋',search:'搜尋',placeholder:'搜尋世界…',resultsFor:'筆結果：',receiving:'接收中...',loadingPage:'正在載入第',pageDataSupplying:'頁面資料正在供應',noQuickResults:'暫無快速結果',noResults:'沒有結果',searchResultDetail:'搜尋結果詳情',searchList:'返回列表',sourcePage:'原文頁面',source:'來源',domain:'網域',category:'分類',language:'語言',relatedSearch:'相關搜尋',internalSource:'內部原文',internalSourceHelp:'原文頁面會在 IGDC 搜尋內顯示。只有原文頁面按鈕會外部開啟。',viewAll:'查看全部',collapse:'收合',itemsSuffix:'項',sectionDefault:'一般網頁結果',tabs:{all:'全部',map:'地圖',knowledge:'知識',wiki:'維基',site:'網站',book:'圖書',blog:'部落格',cafe:'社群',shopping:'購物',news:'新聞',image:'圖片',video:'影片',sns:'社交',tour:'旅遊',public_data:'公共資料',academic:'學術',sports:'體育',finance:'財經',webtoon:'網漫'},groups:{authority:'主要資訊',public_data:'公共資料',local_tour:'地圖/地區',knowledge:'知識/百科',wiki:'維基',academic:'學術/論文',site:'網站/首頁',book:'圖書',news:'新聞',blog:'部落格',cafe:'社群',community:'社區',image:'圖片',video:'影片',media:'圖片/影片',social:'社交',shopping:'購物',sports:'體育',finance:'財經',webtoon:'網漫',web:'一般網頁結果'}},
  ja:{home:'ホーム',globalSearchTitle:'グローバル検索',search:'検索',placeholder:'世界を検索…',resultsFor:'件の結果：',receiving:'受信中...',loadingPage:'ページを読み込み中',pageDataSupplying:'ページデータを受信中',noQuickResults:'クイック結果なし',noResults:'結果なし',searchResultDetail:'検索結果詳細',searchList:'検索一覧',sourcePage:'元ページ',source:'出典',domain:'ドメイン',category:'カテゴリ',language:'言語',relatedSearch:'関連検索',internalSource:'内部原文表示',internalSourceHelp:'元ページは IGDC 検索内で表示されます。外部移動は元ページボタンのみです。',viewAll:'すべて表示',collapse:'閉じる',itemsSuffix:'件',sectionDefault:'一般ウェブ結果',tabs:{all:'すべて',map:'地図',knowledge:'知識',wiki:'ウィキ',site:'サイト',book:'本',blog:'ブログ',cafe:'カフェ',shopping:'ショッピング',news:'ニュース',image:'画像',video:'動画',sns:'ソーシャル',tour:'旅行',public_data:'公共データ',academic:'学術',sports:'スポーツ',finance:'金融',webtoon:'ウェブ漫画'},groups:{authority:'主要情報',public_data:'公共データ',local_tour:'地図/地域',knowledge:'知識/百科',wiki:'ウィキ',academic:'学術/論文',site:'サイト/ホームページ',book:'本',news:'ニュース',blog:'ブログ',cafe:'カフェ',community:'コミュニティ',image:'画像',video:'動画',media:'画像/動画',social:'ソーシャル',shopping:'ショッピング',sports:'スポーツ',finance:'金融',webtoon:'ウェブ漫画',web:'一般ウェブ結果'}},
  es:{home:'Inicio',globalSearchTitle:'Búsqueda global',search:'Buscar',placeholder:'Busca en el mundo…',resultsFor:'resultados para',receiving:'recibiendo...',searchResultDetail:'Detalle del resultado',searchList:'Lista de resultados',sourcePage:'Página original',source:'Fuente',domain:'Dominio',category:'Categoría',language:'Idioma',relatedSearch:'Búsquedas relacionadas',internalSource:'Vista interna original',internalSourceHelp:'La página original se muestra dentro de IGDC Search.',viewAll:'Ver todo',collapse:'Cerrar',itemsSuffix:'',sectionDefault:'Resultados web generales',tabs:{all:'Todo',map:'Mapas',knowledge:'Conocimiento',wiki:'Wiki',site:'Sitios',book:'Libros',blog:'Blogs',cafe:'Cafés',shopping:'Compras',news:'Noticias',image:'Imágenes',video:'Videos',sns:'Social',tour:'Viajes',public_data:'Datos públicos',academic:'Académico',sports:'Deportes',finance:'Finanzas',webtoon:'Webtoons'}},
  fr:{home:'Accueil',globalSearchTitle:'Recherche globale',search:'Rechercher',placeholder:'Rechercher dans le monde…',resultsFor:'résultats pour',receiving:'réception...',searchResultDetail:'Détail du résultat',searchList:'Liste des résultats',sourcePage:'Page originale',source:'Source',domain:'Domaine',category:'Catégorie',language:'Langue',relatedSearch:'Recherches associées',internalSource:'Vue interne originale',internalSourceHelp:'La page originale s’affiche dans IGDC Search.',viewAll:'Tout voir',collapse:'Fermer',itemsSuffix:'',sectionDefault:'Résultats web généraux',tabs:{all:'Tout',map:'Cartes',knowledge:'Connaissances',wiki:'Wiki',site:'Sites',book:'Livres',blog:'Blogs',cafe:'Cafés',shopping:'Shopping',news:'Actualités',image:'Images',video:'Vidéos',sns:'Social',tour:'Voyage',public_data:'Données publiques',academic:'Académique',sports:'Sports',finance:'Finance',webtoon:'Webtoons'}},
  de:{home:'Start',globalSearchTitle:'Globale Suche',search:'Suchen',placeholder:'Die Welt durchsuchen…',resultsFor:'Ergebnisse für',receiving:'empfange...',searchResultDetail:'Suchergebnis-Detail',searchList:'Ergebnisliste',sourcePage:'Originalseite',source:'Quelle',domain:'Domain',category:'Kategorie',language:'Sprache',relatedSearch:'Ähnliche Suchen',internalSource:'Interne Originalansicht',internalSourceHelp:'Die Originalseite wird in IGDC Search angezeigt.',viewAll:'Alle anzeigen',collapse:'Schließen',itemsSuffix:'',sectionDefault:'Allgemeine Webergebnisse',tabs:{all:'Alle',map:'Karten',knowledge:'Wissen',wiki:'Wiki',site:'Websites',book:'Bücher',blog:'Blogs',cafe:'Cafés',shopping:'Shopping',news:'Nachrichten',image:'Bilder',video:'Videos',sns:'Sozial',tour:'Reisen',public_data:'Öffentliche Daten',academic:'Wissenschaft',sports:'Sport',finance:'Finanzen',webtoon:'Webtoons'}},
  ru:{home:'Главная',globalSearchTitle:'Глобальный поиск',search:'Поиск',placeholder:'Искать по миру…',resultsFor:'результатов по',receiving:'получение...',searchResultDetail:'Детали результата',searchList:'Список результатов',sourcePage:'Оригинал',source:'Источник',domain:'Домен',category:'Категория',language:'Язык',relatedSearch:'Похожие запросы',internalSource:'Внутренний просмотр',internalSourceHelp:'Оригинальная страница отображается внутри IGDC Search.',viewAll:'Показать все',collapse:'Свернуть',itemsSuffix:'',sectionDefault:'Обычные веб-результаты',tabs:{all:'Все',map:'Карты',knowledge:'Знания',wiki:'Вики',site:'Сайты',book:'Книги',blog:'Блоги',cafe:'Кафе',shopping:'Покупки',news:'Новости',image:'Изображения',video:'Видео',sns:'Соцсети',tour:'Туризм',public_data:'Открытые данные',academic:'Наука',sports:'Спорт',finance:'Финансы',webtoon:'Вебтуны'}},
  pt:{home:'Início',globalSearchTitle:'Pesquisa global',search:'Pesquisar',placeholder:'Pesquise o mundo…',resultsFor:'resultados para',receiving:'recebendo...',searchResultDetail:'Detalhe do resultado',searchList:'Lista de resultados',sourcePage:'Página original',source:'Fonte',domain:'Domínio',category:'Categoria',language:'Idioma',relatedSearch:'Pesquisas relacionadas',internalSource:'Visualização interna',internalSourceHelp:'A página original é exibida dentro do IGDC Search.',viewAll:'Ver tudo',collapse:'Fechar',itemsSuffix:'',sectionDefault:'Resultados gerais da web',tabs:{all:'Tudo',map:'Mapas',knowledge:'Conhecimento',wiki:'Wiki',site:'Sites',book:'Livros',blog:'Blogs',cafe:'Cafés',shopping:'Compras',news:'Notícias',image:'Imagens',video:'Vídeos',sns:'Social',tour:'Viagem',public_data:'Dados públicos',academic:'Acadêmico',sports:'Esportes',finance:'Finanças',webtoon:'Webtoons'}},
  it:{home:'Home',globalSearchTitle:'Ricerca globale',search:'Cerca',placeholder:'Cerca nel mondo…',resultsFor:'risultati per',receiving:'ricezione...',searchResultDetail:'Dettaglio risultato',searchList:'Lista risultati',sourcePage:'Pagina originale',source:'Fonte',domain:'Dominio',category:'Categoria',language:'Lingua',relatedSearch:'Ricerche correlate',internalSource:'Vista interna',internalSourceHelp:'La pagina originale è mostrata dentro IGDC Search.',viewAll:'Vedi tutto',collapse:'Chiudi',itemsSuffix:'',sectionDefault:'Risultati web generali',tabs:{all:'Tutto',map:'Mappe',knowledge:'Conoscenza',wiki:'Wiki',site:'Siti',book:'Libri',blog:'Blog',cafe:'Caffè',shopping:'Shopping',news:'Notizie',image:'Immagini',video:'Video',sns:'Social',tour:'Viaggi',public_data:'Dati pubblici',academic:'Accademico',sports:'Sport',finance:'Finanza',webtoon:'Webtoon'}},
  ar:{home:'الرئيسية',globalSearchTitle:'بحث عالمي',search:'بحث',placeholder:'ابحث في العالم…',resultsFor:'نتائج عن',receiving:'جارٍ الاستقبال...',searchResultDetail:'تفاصيل النتيجة',searchList:'قائمة النتائج',sourcePage:'الصفحة الأصلية',source:'المصدر',domain:'النطاق',category:'الفئة',language:'اللغة',relatedSearch:'عمليات بحث ذات صلة',internalSource:'عرض داخلي',internalSourceHelp:'تُعرض الصفحة الأصلية داخل بحث IGDC.',viewAll:'عرض الكل',collapse:'إغلاق',itemsSuffix:'',sectionDefault:'نتائج ويب عامة',tabs:{all:'الكل',map:'خرائط',knowledge:'معرفة',wiki:'ويكي',site:'مواقع',book:'كتب',blog:'مدونات',cafe:'مقاهي',shopping:'تسوق',news:'أخبار',image:'صور',video:'فيديو',sns:'اجتماعي',tour:'سفر',public_data:'بيانات عامة',academic:'أكاديمي',sports:'رياضة',finance:'مال',webtoon:'ويبتون'}},
  vi:{home:'Trang chủ',globalSearchTitle:'Tìm kiếm toàn cầu',search:'Tìm kiếm',placeholder:'Tìm kiếm thế giới…',resultsFor:'kết quả cho',receiving:'đang nhận...',searchResultDetail:'Chi tiết kết quả',searchList:'Danh sách kết quả',sourcePage:'Trang gốc',source:'Nguồn',domain:'Miền',category:'Danh mục',language:'Ngôn ngữ',relatedSearch:'Tìm kiếm liên quan',internalSource:'Xem nội bộ',internalSourceHelp:'Trang gốc hiển thị trong IGDC Search.',viewAll:'Xem tất cả',collapse:'Thu gọn',itemsSuffix:'',sectionDefault:'Kết quả web chung',tabs:{all:'Tất cả',map:'Bản đồ',knowledge:'Tri thức',wiki:'Wiki',site:'Trang web',book:'Sách',blog:'Blog',cafe:'Cafe',shopping:'Mua sắm',news:'Tin tức',image:'Hình ảnh',video:'Video',sns:'Xã hội',tour:'Du lịch',public_data:'Dữ liệu công',academic:'Học thuật',sports:'Thể thao',finance:'Tài chính',webtoon:'Webtoon'}},
  th:{home:'หน้าแรก',globalSearchTitle:'ค้นหาทั่วโลก',search:'ค้นหา',placeholder:'ค้นหาทั่วโลก…',resultsFor:'ผลลัพธ์สำหรับ',receiving:'กำลังรับ...',searchResultDetail:'รายละเอียดผลลัพธ์',searchList:'รายการผลลัพธ์',sourcePage:'หน้าต้นฉบับ',source:'แหล่งที่มา',domain:'โดเมน',category:'หมวดหมู่',language:'ภาษา',relatedSearch:'การค้นหาที่เกี่ยวข้อง',internalSource:'มุมมองภายใน',internalSourceHelp:'หน้าต้นฉบับแสดงใน IGDC Search.',viewAll:'ดูทั้งหมด',collapse:'ปิด',itemsSuffix:'',sectionDefault:'ผลลัพธ์เว็บทั่วไป',tabs:{all:'ทั้งหมด',map:'แผนที่',knowledge:'ความรู้',wiki:'วิกิ',site:'เว็บไซต์',book:'หนังสือ',blog:'บล็อก',cafe:'คาเฟ่',shopping:'ช้อปปิ้ง',news:'ข่าว',image:'รูปภาพ',video:'วิดีโอ',sns:'โซเชียล',tour:'ท่องเที่ยว',public_data:'ข้อมูลสาธารณะ',academic:'วิชาการ',sports:'กีฬา',finance:'การเงิน',webtoon:'เว็บตูน'}},
  id:{home:'Beranda',globalSearchTitle:'Pencarian global',search:'Cari',placeholder:'Cari dunia…',resultsFor:'hasil untuk',receiving:'menerima...',searchResultDetail:'Detail hasil',searchList:'Daftar hasil',sourcePage:'Halaman asli',source:'Sumber',domain:'Domain',category:'Kategori',language:'Bahasa',relatedSearch:'Pencarian terkait',internalSource:'Tampilan internal',internalSourceHelp:'Halaman asli ditampilkan di dalam IGDC Search.',viewAll:'Lihat semua',collapse:'Tutup',itemsSuffix:'',sectionDefault:'Hasil web umum',tabs:{all:'Semua',map:'Peta',knowledge:'Pengetahuan',wiki:'Wiki',site:'Situs',book:'Buku',blog:'Blog',cafe:'Kafe',shopping:'Belanja',news:'Berita',image:'Gambar',video:'Video',sns:'Sosial',tour:'Wisata',public_data:'Data publik',academic:'Akademik',sports:'Olahraga',finance:'Keuangan',webtoon:'Webtoon'}},
  hi:{home:'होम',globalSearchTitle:'वैश्विक खोज',search:'खोजें',placeholder:'दुनिया खोजें…',resultsFor:'परिणाम',receiving:'प्राप्त हो रहा है...',searchResultDetail:'परिणाम विवरण',searchList:'परिणाम सूची',sourcePage:'मूल पेज',source:'स्रोत',domain:'डोमेन',category:'श्रेणी',language:'भाषा',relatedSearch:'संबंधित खोजें',internalSource:'आंतरिक दृश्य',internalSourceHelp:'मूल पेज IGDC Search के अंदर दिखता है।',viewAll:'सभी देखें',collapse:'बंद करें',itemsSuffix:'',sectionDefault:'सामान्य वेब परिणाम',tabs:{all:'सभी',map:'मानचित्र',knowledge:'ज्ञान',wiki:'विकी',site:'साइटें',book:'पुस्तकें',blog:'ब्लॉग',cafe:'कैफे',shopping:'खरीदारी',news:'समाचार',image:'छवियां',video:'वीडियो',sns:'सोशल',tour:'यात्रा',public_data:'सार्वजनिक डेटा',academic:'शैक्षणिक',sports:'खेल',finance:'वित्त',webtoon:'वेबटून'}},
  tr:{home:'Ana sayfa',globalSearchTitle:'Küresel arama',search:'Ara',placeholder:'Dünyada ara…',resultsFor:'sonuç:',receiving:'alınıyor...',searchResultDetail:'Sonuç detayı',searchList:'Sonuç listesi',sourcePage:'Orijinal sayfa',source:'Kaynak',domain:'Alan adı',category:'Kategori',language:'Dil',relatedSearch:'İlgili aramalar',internalSource:'Dahili görünüm',internalSourceHelp:'Orijinal sayfa IGDC Search içinde gösterilir.',viewAll:'Tümünü gör',collapse:'Kapat',itemsSuffix:'',sectionDefault:'Genel web sonuçları',tabs:{all:'Tümü',map:'Haritalar',knowledge:'Bilgi',wiki:'Wiki',site:'Siteler',book:'Kitaplar',blog:'Bloglar',cafe:'Kafeler',shopping:'Alışveriş',news:'Haberler',image:'Görseller',video:'Videolar',sns:'Sosyal',tour:'Seyahat',public_data:'Kamu verisi',academic:'Akademik',sports:'Spor',finance:'Finans',webtoon:'Webtoon'}},
  ta:{home:'முகப்பு',globalSearchTitle:'உலகளாவிய தேடல்',search:'தேடு',placeholder:'உலகத்தைத் தேடு…',resultsFor:'முடிவுகள்',receiving:'பெறுகிறது...',searchResultDetail:'முடிவு விவரம்',searchList:'முடிவு பட்டியல்',sourcePage:'அசல் பக்கம்',source:'மூலம்',domain:'டொமைன்',category:'வகை',language:'மொழி',relatedSearch:'தொடர்புடைய தேடல்கள்',internalSource:'உள் பார்வை',internalSourceHelp:'அசல் பக்கம் IGDC Search உள்ளே காட்டப்படும்.',viewAll:'அனைத்தையும் காட்டு',collapse:'மூடு',itemsSuffix:'',sectionDefault:'பொது வலை முடிவுகள்',tabs:{all:'அனைத்தும்',map:'வரைபடம்',knowledge:'அறிவு',wiki:'விக்கி',site:'தளங்கள்',book:'புத்தகங்கள்',blog:'வலைப்பதிவுகள்',cafe:'கஃபே',shopping:'ஷாப்பிங்',news:'செய்தி',image:'படங்கள்',video:'வீடியோ',sns:'சமூக',tour:'சுற்றுலா',public_data:'பொது தரவு',academic:'கல்வி',sports:'விளையாட்டு',finance:'நிதி',webtoon:'வெப்டூன்'}},
  sw:{home:'Nyumbani',globalSearchTitle:'Utafutaji wa kimataifa',search:'Tafuta',placeholder:'Tafuta dunia…',resultsFor:'matokeo ya',receiving:'inapokea...',searchResultDetail:'Maelezo ya matokeo',searchList:'Orodha ya matokeo',sourcePage:'Ukurasa asili',source:'Chanzo',domain:'Kikoa',category:'Kategoria',language:'Lugha',relatedSearch:'Utafutaji husika',internalSource:'Mwonekano wa ndani',internalSourceHelp:'Ukurasa asili unaonyeshwa ndani ya IGDC Search.',viewAll:'Ona yote',collapse:'Funga',itemsSuffix:'',sectionDefault:'Matokeo ya wavuti ya jumla',tabs:{all:'Yote',map:'Ramani',knowledge:'Maarifa',wiki:'Wiki',site:'Tovuti',book:'Vitabu',blog:'Blogu',cafe:'Kahawa',shopping:'Ununuzi',news:'Habari',image:'Picha',video:'Video',sns:'Jamii',tour:'Safari',public_data:'Data ya umma',academic:'Kitaaluma',sports:'Michezo',finance:'Fedha',webtoon:'Webtoon'}},
  ur:{home:'ہوم',globalSearchTitle:'عالمی تلاش',search:'تلاش',placeholder:'دنیا تلاش کریں…',resultsFor:'نتائج برائے',receiving:'موصول ہو رہا ہے...',searchResultDetail:'نتیجے کی تفصیل',searchList:'نتائج کی فہرست',sourcePage:'اصل صفحہ',source:'ماخذ',domain:'ڈومین',category:'زمرہ',language:'زبان',relatedSearch:'متعلقہ تلاشیں',internalSource:'اندرونی منظر',internalSourceHelp:'اصل صفحہ IGDC Search کے اندر دکھایا جاتا ہے۔',viewAll:'سب دیکھیں',collapse:'بند کریں',itemsSuffix:'',sectionDefault:'عام ویب نتائج',tabs:{all:'سب',map:'نقشے',knowledge:'علم',wiki:'ویکی',site:'سائٹس',book:'کتابیں',blog:'بلاگ',cafe:'کیفے',shopping:'خریداری',news:'خبریں',image:'تصاویر',video:'ویڈیو',sns:'سوشل',tour:'سفر',public_data:'عوامی ڈیٹا',academic:'علمی',sports:'کھیل',finance:'مالیات',webtoon:'ویب ٹون'}},
  bn:{home:'হোম',globalSearchTitle:'গ্লোবাল সার্চ',search:'অনুসন্ধান',placeholder:'বিশ্ব খুঁজুন…',resultsFor:'এর ফলাফল',receiving:'গ্রহণ হচ্ছে...',searchResultDetail:'ফলাফলের বিবরণ',searchList:'ফলাফলের তালিকা',sourcePage:'মূল পৃষ্ঠা',source:'উৎস',domain:'ডোমেইন',category:'বিভাগ',language:'ভাষা',relatedSearch:'সম্পর্কিত অনুসন্ধান',internalSource:'অভ্যন্তরীণ দৃশ্য',internalSourceHelp:'মূল পৃষ্ঠা IGDC Search-এর মধ্যে দেখানো হয়।',viewAll:'সব দেখুন',collapse:'বন্ধ',itemsSuffix:'',sectionDefault:'সাধারণ ওয়েব ফলাফল',tabs:{all:'সব',map:'মানচিত্র',knowledge:'জ্ঞান',wiki:'উইকি',site:'সাইট',book:'বই',blog:'ব্লগ',cafe:'ক্যাফে',shopping:'শপিং',news:'সংবাদ',image:'ছবি',video:'ভিডিও',sns:'সামাজিক',tour:'ভ্রমণ',public_data:'পাবলিক ডেটা',academic:'একাডেমিক',sports:'খেলা',finance:'অর্থনীতি',webtoon:'ওয়েবটুন'}},
  fa:{home:'خانه',globalSearchTitle:'جستجوی جهانی',search:'جستجو',placeholder:'جهان را جستجو کنید…',resultsFor:'نتیجه برای',receiving:'در حال دریافت...',searchResultDetail:'جزئیات نتیجه',searchList:'فهرست نتایج',sourcePage:'صفحه اصلی',source:'منبع',domain:'دامنه',category:'دسته',language:'زبان',relatedSearch:'جستجوهای مرتبط',internalSource:'نمایش داخلی',internalSourceHelp:'صفحه اصلی داخل IGDC Search نمایش داده می‌شود.',viewAll:'نمایش همه',collapse:'بستن',itemsSuffix:'',sectionDefault:'نتایج عمومی وب',tabs:{all:'همه',map:'نقشه',knowledge:'دانش',wiki:'ویکی',site:'سایت‌ها',book:'کتاب‌ها',blog:'وبلاگ‌ها',cafe:'کافه',shopping:'خرید',news:'اخبار',image:'تصاویر',video:'ویدئو',sns:'اجتماعی',tour:'سفر',public_data:'داده عمومی',academic:'علمی',sports:'ورزش',finance:'مالی',webtoon:'وبتون'}},
  hu:{home:'Kezdőlap',globalSearchTitle:'Globális keresés',search:'Keresés',placeholder:'Keresés a világban…',resultsFor:'találat erre:',receiving:'fogadás...',searchResultDetail:'Találat részletei',searchList:'Találati lista',sourcePage:'Eredeti oldal',source:'Forrás',domain:'Domain',category:'Kategória',language:'Nyelv',relatedSearch:'Kapcsolódó keresések',internalSource:'Belső nézet',internalSourceHelp:'Az eredeti oldal az IGDC Search-ben jelenik meg.',viewAll:'Összes',collapse:'Bezár',itemsSuffix:'',sectionDefault:'Általános webes találatok',tabs:{all:'Összes',map:'Térképek',knowledge:'Tudás',wiki:'Wiki',site:'Oldalak',book:'Könyvek',blog:'Blogok',cafe:'Kávézók',shopping:'Vásárlás',news:'Hírek',image:'Képek',video:'Videók',sns:'Közösségi',tour:'Utazás',public_data:'Közadatok',academic:'Akadémiai',sports:'Sport',finance:'Pénzügy',webtoon:'Webtoon'}},
  ms:{home:'Utama',globalSearchTitle:'Carian global',search:'Cari',placeholder:'Cari dunia…',resultsFor:'hasil untuk',receiving:'menerima...',searchResultDetail:'Butiran hasil',searchList:'Senarai hasil',sourcePage:'Halaman asal',source:'Sumber',domain:'Domain',category:'Kategori',language:'Bahasa',relatedSearch:'Carian berkaitan',internalSource:'Paparan dalaman',internalSourceHelp:'Halaman asal dipaparkan dalam IGDC Search.',viewAll:'Lihat semua',collapse:'Tutup',itemsSuffix:'',sectionDefault:'Hasil web umum',tabs:{all:'Semua',map:'Peta',knowledge:'Pengetahuan',wiki:'Wiki',site:'Laman',book:'Buku',blog:'Blog',cafe:'Kafe',shopping:'Beli-belah',news:'Berita',image:'Imej',video:'Video',sns:'Sosial',tour:'Pelancongan',public_data:'Data awam',academic:'Akademik',sports:'Sukan',finance:'Kewangan',webtoon:'Webtoon'}},
  nl:{home:'Home',globalSearchTitle:'Globaal zoeken',search:'Zoeken',placeholder:'Zoek de wereld…',resultsFor:'resultaten voor',receiving:'ontvangen...',searchResultDetail:'Resultaatdetails',searchList:'Resultatenlijst',sourcePage:'Originele pagina',source:'Bron',domain:'Domein',category:'Categorie',language:'Taal',relatedSearch:'Gerelateerde zoekopdrachten',internalSource:'Interne weergave',internalSourceHelp:'De originele pagina wordt binnen IGDC Search weergegeven.',viewAll:'Alles bekijken',collapse:'Sluiten',itemsSuffix:'',sectionDefault:'Algemene webresultaten',tabs:{all:'Alles',map:'Kaarten',knowledge:'Kennis',wiki:'Wiki',site:'Sites',book:'Boeken',blog:'Blogs',cafe:'Cafés',shopping:'Winkelen',news:'Nieuws',image:'Afbeeldingen',video:'Video’s',sns:'Sociaal',tour:'Reizen',public_data:'Openbare data',academic:'Academisch',sports:'Sport',finance:'Financiën',webtoon:'Webtoons'}},
  pl:{home:'Start',globalSearchTitle:'Wyszukiwanie globalne',search:'Szukaj',placeholder:'Przeszukaj świat…',resultsFor:'wyników dla',receiving:'odbieranie...',searchResultDetail:'Szczegóły wyniku',searchList:'Lista wyników',sourcePage:'Oryginalna strona',source:'Źródło',domain:'Domena',category:'Kategoria',language:'Język',relatedSearch:'Powiązane wyszukiwania',internalSource:'Widok wewnętrzny',internalSourceHelp:'Oryginalna strona jest wyświetlana w IGDC Search.',viewAll:'Zobacz wszystko',collapse:'Zamknij',itemsSuffix:'',sectionDefault:'Ogólne wyniki web',tabs:{all:'Wszystko',map:'Mapy',knowledge:'Wiedza',wiki:'Wiki',site:'Strony',book:'Książki',blog:'Blogi',cafe:'Kawiarnie',shopping:'Zakupy',news:'Wiadomości',image:'Obrazy',video:'Wideo',sns:'Społeczności',tour:'Podróże',public_data:'Dane publiczne',academic:'Akademickie',sports:'Sport',finance:'Finanse',webtoon:'Webtoony'}},
  sv:{home:'Hem',globalSearchTitle:'Global sökning',search:'Sök',placeholder:'Sök i världen…',resultsFor:'resultat för',receiving:'tar emot...',searchResultDetail:'Resultatdetalj',searchList:'Resultatlista',sourcePage:'Originalsida',source:'Källa',domain:'Domän',category:'Kategori',language:'Språk',relatedSearch:'Relaterade sökningar',internalSource:'Intern vy',internalSourceHelp:'Originalsidan visas inne i IGDC Search.',viewAll:'Visa alla',collapse:'Stäng',itemsSuffix:'',sectionDefault:'Allmänna webbresultat',tabs:{all:'Alla',map:'Kartor',knowledge:'Kunskap',wiki:'Wiki',site:'Webbplatser',book:'Böcker',blog:'Bloggar',cafe:'Kaféer',shopping:'Shopping',news:'Nyheter',image:'Bilder',video:'Videor',sns:'Socialt',tour:'Resor',public_data:'Offentlig data',academic:'Akademiskt',sports:'Sport',finance:'Finans',webtoon:'Webtoons'}},
  tl:{home:'Home',globalSearchTitle:'Pandaigdigang paghahanap',search:'Hanapin',placeholder:'Hanapin ang mundo…',resultsFor:'resulta para sa',receiving:'tumatanggap...',searchResultDetail:'Detalye ng resulta',searchList:'Listahan ng resulta',sourcePage:'Orihinal na pahina',source:'Pinagmulan',domain:'Domain',category:'Kategorya',language:'Wika',relatedSearch:'Kaugnay na paghahanap',internalSource:'Panloob na view',internalSourceHelp:'Ipinapakita ang orihinal na pahina sa loob ng IGDC Search.',viewAll:'Tingnan lahat',collapse:'Isara',itemsSuffix:'',sectionDefault:'Pangkalahatang resulta sa web',tabs:{all:'Lahat',map:'Mapa',knowledge:'Kaalaman',wiki:'Wiki',site:'Mga site',book:'Aklat',blog:'Blog',cafe:'Cafe',shopping:'Shopping',news:'Balita',image:'Larawan',video:'Video',sns:'Social',tour:'Paglalakbay',public_data:'Pampublikong data',academic:'Akademiko',sports:'Sports',finance:'Pananalapi',webtoon:'Webtoon'}},
  uk:{home:'Головна',globalSearchTitle:'Глобальний пошук',search:'Пошук',placeholder:'Шукати у світі…',resultsFor:'результатів для',receiving:'отримання...',searchResultDetail:'Деталі результату',searchList:'Список результатів',sourcePage:'Оригінальна сторінка',source:'Джерело',domain:'Домен',category:'Категорія',language:'Мова',relatedSearch:'Пов’язані пошуки',internalSource:'Внутрішній перегляд',internalSourceHelp:'Оригінальна сторінка відображається в IGDC Search.',viewAll:'Показати все',collapse:'Закрити',itemsSuffix:'',sectionDefault:'Загальні веб-результати',tabs:{all:'Усе',map:'Карти',knowledge:'Знання',wiki:'Вікі',site:'Сайти',book:'Книги',blog:'Блоги',cafe:'Кафе',shopping:'Покупки',news:'Новини',image:'Зображення',video:'Відео',sns:'Соцмережі',tour:'Подорожі',public_data:'Публічні дані',academic:'Наукове',sports:'Спорт',finance:'Фінанси',webtoon:'Вебтуни'}},
  uz:{home:'Bosh sahifa',globalSearchTitle:'Global qidiruv',search:'Qidirish',placeholder:'Dunyoni qidiring…',resultsFor:'natija:',receiving:'qabul qilinmoqda...',searchResultDetail:'Natija tafsiloti',searchList:'Natijalar ro‘yxati',sourcePage:'Asl sahifa',source:'Manba',domain:'Domen',category:'Turkum',language:'Til',relatedSearch:'Aloqador qidiruvlar',internalSource:'Ichki ko‘rinish',internalSourceHelp:'Asl sahifa IGDC Search ichida ko‘rsatiladi.',viewAll:'Hammasini ko‘rish',collapse:'Yopish',itemsSuffix:'',sectionDefault:'Umumiy veb natijalari',tabs:{all:'Barchasi',map:'Xaritalar',knowledge:'Bilim',wiki:'Viki',site:'Saytlar',book:'Kitoblar',blog:'Bloglar',cafe:'Kafelar',shopping:'Xarid',news:'Yangiliklar',image:'Rasmlar',video:'Videolar',sns:'Ijtimoiy',tour:'Sayohat',public_data:'Ochiq maʼlumot',academic:'Akademik',sports:'Sport',finance:'Moliya',webtoon:'Vebtun'}}
};

function normalizeUiLang(v){
  let s = String(v || '').trim().toLowerCase();
  if(!s) return 'ko';
  s = s.replace('_','-');
  if(s === 'kr' || s === 'ko-kr' || s === 'korean') return 'ko';
  if(s === 'zh-tw' || s === 'zh-hk' || s === 'zh-hant' || s === 'zht') return 'zht';
  if(s === 'zh-cn' || s === 'zh-hans') return 'zh';
  if(s.indexOf('-') > -1) s = s.split('-')[0];
  return SEARCH_I18N[s] ? s : 'en';
}

function getSearchUiLang(){
  try{
    const urlLang = (new URLSearchParams(location.search).get('lang') || '').trim();
    if(urlLang) return normalizeUiLang(urlLang);
  }catch(e){}
  try{
    if(window.IGTC && typeof window.IGTC.getLang === 'function') return normalizeUiLang(window.IGTC.getLang());
  }catch(e){}
  try{
    const saved = (localStorage.getItem('igdc_lang') || '').trim();
    if(saved) return normalizeUiLang(saved);
  }catch(e){}
  try{
    const docLang = (document.documentElement && document.documentElement.getAttribute('lang')) || '';
    if(docLang) return normalizeUiLang(docLang);
  }catch(e){}
  try{return normalizeUiLang(navigator.language || 'ko');}catch(e){return 'ko';}
}

function i18nDict(){
  const lang = getSearchUiLang();
  return SEARCH_I18N[lang] || SEARCH_I18N.en || SEARCH_I18N.ko;
}

function uiText(key, fallback){
  const d = i18nDict();
  return (d && d[key]) || (SEARCH_I18N.en && SEARCH_I18N.en[key]) || fallback || key;
}

function tabLabel(type){
  const t = normalizeSearchType(type);
  const d = i18nDict();
  return (d.tabs && d.tabs[t]) || (SEARCH_I18N.en.tabs && SEARCH_I18N.en.tabs[t]) || (SEARCH_I18N.ko.tabs && SEARCH_I18N.ko.tabs[t]) || t;
}

function groupLabel(group){
  const d = i18nDict();
  return (d.groups && d.groups[group]) || (SEARCH_I18N.en.groups && SEARCH_I18N.en.groups[group]) || (SEARCH_I18N.ko.groups && SEARCH_I18N.ko.groups[group]) || uiText('sectionDefault', 'General web results');
}

function itemCountText(n){
  const suffix = uiText('itemsSuffix', '');
  return suffix ? `${n}${suffix}` : String(n);
}

function statusResultsText(count, q, type, receiving){
  const suffix = receiving ? ` · ${uiText('receiving', 'receiving...')}` : '';
  return `${count} ${uiText('resultsFor', 'results for')} "${q}" · ${getTypeLabel(type)}${suffix}`;
}

function normalizeSearchType(v){
  const raw = String(v || '').trim().toLowerCase();
  const allowed = new Set(SEARCH_TAB_KEYS);
  const alias = { books: 'book', 도서: 'book', 책: 'book', sns: 'sns', social: 'sns', public: 'public_data', 공공자료: 'public_data', wiki: 'wiki', 위키: 'wiki', academic: 'academic', 학술: 'academic', site: 'site', 사이트: 'site' };
  return allowed.has(raw) ? raw : (alias[raw] || 'all');
}

function getTypeLabel(type){
  return tabLabel(normalizeSearchType(type));
}

function searchTabDef(type){
  const t = normalizeSearchType(type);
  return [t, tabLabel(t)];
}

function uniqueSearchTabs(types){
  const out = [];
  const seen = new Set();
  (Array.isArray(types) ? types : []).forEach(type => {
    const def = searchTabDef(type);
    const key = def[0];
    if(seen.has(key)) return;
    seen.add(key);
    out.push(def);
  });
  return out;
}

function queryTextForTabs(fallback){
  const fromInput = input && input.value ? input.value.trim() : '';
  const fromUrl = (new URLSearchParams(location.search).get('q') || '').trim();
  return String(fallback || fromInput || lastQuery || fromUrl || '').trim();
}

function maruIntentItemTextClient(it){
  if(!it || typeof it !== 'object') return '';
  function flat(v){
    if(v == null) return '';
    if(typeof v === 'string' || typeof v === 'number') return String(v);
    if(Array.isArray(v)) return v.slice(0, 12).map(flat).join(' ');
    if(typeof v === 'object') return Object.keys(v).slice(0, 24).map(k => flat(v[k])).join(' ');
    return '';
  }
  return [
    it.title, it.name, it.subtitle, it.summary, it.description, it.snippet,
    it.contentSnippet, it.excerpt, it.abstract, it.body, it.category, it.group,
    it.displayGroup, it.displayGroupLabel, it.type, it.kind, it.mediaType,
    it.domain, it.publisher, it.channel, it.provider, it.url, it.link,
    flat(it.source), flat(it.media), flat(it.displayCard), flat(it.payload), flat(it.data)
  ].filter(Boolean).join(' ');
}

function maruIntentEvidenceClient(items){
  const source = Array.isArray(items) ? items.slice(0, 180) : [];
  const counts = {};
  const textParts = [];
  source.forEach(it => {
    const itemText = maruIntentItemTextClient(it);
    if(itemText) textParts.push(itemText);
    try{
      const g = displayGroupOfItem(it);
      if(g) counts[g] = (counts[g] || 0) + 1;
    }catch(e){
      const raw = String((it && (it.displayGroup || it.group || it.category || it.type)) || '').toLowerCase();
      if(raw) counts[raw] = (counts[raw] || 0) + 1;
    }
  });
  return { text: textParts.join(' ').toLowerCase(), counts };
}

function inferMaruSearchIntentProfile(q, items){
  const query = String(q || '').trim();
  const low = query.toLowerCase();
  const compact = low.replace(/\s+/g, '');
  const ev = maruIntentEvidenceClient(items || allItems);
  const hay = `${low} ${ev.text}`.toLowerCase();
  const counts = ev.counts || {};

  const citySignal = /(서울|부산|대구|인천|광주|대전|울산|세종|제주|강남|홍대|명동|종로|여의도|수원|성남|고양|용인|청주|전주|천안|포항|창원|김해|평양|뉴욕|도쿄|오사카|파리|런던|로마|시카고|워싱턴|상하이|베이징|홍콩|싱가포르|하노이|호치민|방콕|city|seoul|busan|new\s*york|tokyo|osaka|paris|london|rome|chicago|washington|shanghai|beijing|hong\s*kong|singapore|hanoi|bangkok)/i.test(query);
  const countrySignal = /(대한민국|한국|미국|일본|중국|영국|프랑스|독일|러시아|인도|베트남|태국|인도네시아|필리핀|캐나다|호주|브라질|멕시코|이탈리아|스페인|네덜란드|스웨덴|노르웨이|핀란드|덴마크|폴란드|우크라이나|이스라엘|사우디|아랍에미리트|uae|korea|south\s*korea|usa|united\s*states|japan|china|uk|united\s*kingdom|france|germany|russia|india|vietnam|thailand|indonesia|philippines|canada|australia|brazil|mexico|italy|spain)/i.test(query);
  const localSignal = /(지도|주소|위치|길찾기|근처|맛집|호텔|숙소|관광|여행|축제|명소|교통|지하철|버스|공항|주변|방문|코스|map|maps|address|near|nearby|local|hotel|travel|tour|restaurant|attraction|airport|transit)/i.test(query);
  const companySignal = /(회사|기업|브랜드|그룹|재단|협회|법인|주식회사|상장|상장사|본사|지점|매장|영업점|대표이사|ceo|ir|실적|매출|채용|주가|삼성|현대|기아|엘지|lg|sk|네이버|카카오|롯데|포스코|한화|두산|cj|gs|쿠팡|배민|스타벅스|테슬라|애플|구글|마이크로소프트|아마존|메타|엔비디아|company|corporation|corp|inc|ltd|brand|enterprise|startup|headquarters|store|stock|earnings|revenue|recruit)/i.test(hay);
  const issueSignal = /(이슈|논란|사건|사고|속보|현안|정책|선거|후보|토론|전쟁|분쟁|시위|집회|파업|재판|수사|폭우|태풍|지진|화재|감염|위기|갈등|issue|breaking|controversy|election|policy|war|conflict|protest|strike|trial|investigation|crisis|disaster)/i.test(query);

  const personEvidence = /(프로필|인물|나이|키|학력|출생|소속사|배우|가수|연예인|아이돌|감독|작가|소설가|시인|교수|연구자|정치인|대통령|의원|후보|선수|축구선수|야구선수|출연|필모그래피|앨범|곡|작품|업적|수상|biography|profile|actor|actress|singer|celebrity|artist|filmography|discography|career|awards)/i.test(hay);
  const compactKoreanNameSignal = /^[가-힣]{2,4}$/.test(compact) && !citySignal && !countrySignal && !companySignal;
  const personSignal = (personEvidence || compactKoreanNameSignal) && !companySignal && !(citySignal || countrySignal || localSignal);

  const productSignal = /(상품|제품|가격|구매|쇼핑|브랜드|후기|리뷰|인삼|홍삼|화장품|폰|자동차|노트북|가전|의류|신발|product|price|buy|shopping|brand|review|spec|model)/i.test(query) && !companySignal;
  const academicSignal = /(논문|연구|학술|저널|대학|도서관|인용|학회|paper|research|scholar|academic|journal|university|library|citation)/i.test(query);
  const bookSignal = /(책|도서|출판|저자|소설|문학|book|author|novel|literature|publication)/i.test(query);
  const financeSignal = /(주식|증권|환율|금융|코인|가상화폐|경제|실적|매출|stock|finance|market|crypto|exchange\s*rate|earnings|revenue)/i.test(query);
  const sportsSignal = /(스포츠|축구|야구|농구|배구|골프|올림픽|월드컵|sports|football|baseball|basketball|golf|olympic|world\s*cup)/i.test(query);
  const webtoonSignal = /(웹툰|만화|애니|webtoon|comic|manga|anime)/i.test(query);
  const mediaSignal = /(영상|동영상|유튜브|영화|드라마|음악|뮤직|앨범|공연|콘서트|방송|예능|video|youtube|movie|drama|music|album|concert|show|clip)/i.test(query);
  const imageSignal = /(이미지|사진|포토|갤러리|화보|풍경|전경|야경|image|photo|picture|gallery|scenery|landscape)/i.test(query);
  const publicSignal = /(정부|공공|기관|시청|구청|도청|군청|공식|민원|행정|공공자료|공공데이터|통계청|법령|고시|open\s*data|government|official|public\s*data|administration|statistics)/i.test(query);

  // Returned evidence can override a vague query.  This is what prevents a
  // person name from staying on a city/nation category profile after results arrive.
  const returnedPersonProfile = personEvidence && ((counts.knowledge || 0) + (counts.wiki || 0) + (counts.news || 0) + (counts.video || 0) + (counts.image || 0) + (counts.social || 0) >= 2);
  if(personSignal || returnedPersonProfile) return 'person';
  if(companySignal) return 'company';
  if(issueSignal || (counts.news || 0) >= 4 && /(논란|사건|속보|issue|breaking|뉴스|보도)/i.test(hay)) return 'issue';
  if(productSignal) return 'product';
  if(academicSignal) return 'academic';
  if(bookSignal) return 'book';
  if(financeSignal) return 'finance';
  if(sportsSignal) return 'sports';
  if(webtoonSignal) return 'webtoon';
  if(countrySignal) return 'country';
  if(citySignal || localSignal) return 'place';
  if(mediaSignal) return 'media';
  if(imageSignal) return 'image';
  if(publicSignal) return 'public';
  return 'general';
}

function maruTabLeadForIntent(intent){
  const table = {
    person:  ['all','knowledge','wiki','news','video','image','sns','blog','site','book'],
    place:   ['all','map','tour','knowledge','wiki','site','public_data','news','image','video','blog','sns'],
    country: ['all','map','tour','knowledge','wiki','site','public_data','news','image','video','blog','sns'],
    company: ['all','site','knowledge','wiki','news','finance','map','image','video','blog','sns','shopping','public_data'],
    issue:   ['all','news','video','image','sns','blog','site','knowledge','wiki','public_data'],
    product: ['all','shopping','site','image','video','blog','cafe','news','knowledge','wiki'],
    academic:['all','academic','knowledge','wiki','book','site','news','image','video'],
    book:    ['all','book','knowledge','wiki','site','blog','news','image','shopping'],
    finance: ['all','finance','news','site','knowledge','blog','image','video'],
    sports:  ['all','sports','news','video','image','sns','blog','site','knowledge'],
    webtoon: ['all','webtoon','image','video','site','blog','sns','shopping','news'],
    media:   ['all','video','image','news','sns','blog','site','knowledge'],
    image:   ['all','image','video','site','news','blog','sns','knowledge'],
    public:  ['all','public_data','site','knowledge','wiki','news','map','image','video'],
    general: ['all','site','knowledge','wiki','news','image','video','blog','sns']
  };
  return table[intent] || table.general;
}

function inferSearchTabsForQuery(q, active){
  const intent = inferMaruSearchIntentProfile(q, allItems);
  const activeTypeForKeep = normalizeSearchType(active || activeType || 'all');
  const evidence = maruIntentEvidenceClient(allItems);
  const countByTab = {};
  const groupToTab = {
    authority:'site', local_tour:'map', public_data:'public_data', knowledge:'knowledge', wiki:'wiki',
    academic:'academic', site:'site', book:'book', news:'news', blog:'blog', cafe:'cafe',
    community:'cafe', image:'image', media:'image', video:'video', social:'sns', shopping:'shopping',
    sports:'sports', finance:'finance', webtoon:'webtoon', web:'site'
  };
  Object.keys(evidence.counts || {}).forEach(g => {
    const tab = groupToTab[g] || normalizeSearchType(g);
    if(tab && SEARCH_TAB_KEYS.includes(tab)) countByTab[tab] = (countByTab[tab] || 0) + evidence.counts[g];
  });

  const lead = maruTabLeadForIntent(intent).slice();
  if(activeTypeForKeep && activeTypeForKeep !== 'all' && !lead.includes(activeTypeForKeep)) lead.splice(1, 0, activeTypeForKeep);

  const out = [];
  const seen = new Set();
  function push(type){
    const t = normalizeSearchType(type);
    if(!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  }
  lead.forEach(push);

  // After the intent lead, categories that are actually present in the returned
  // pool move up, but low-relevance categories remain available later.
  SEARCH_TAB_KEYS
    .filter(k => !seen.has(k) && (countByTab[k] || 0) > 0)
    .sort((a,b) => (countByTab[b] || 0) - (countByTab[a] || 0))
    .forEach(push);

  SEARCH_TAB_KEYS.forEach(push);
  return uniqueSearchTabs(out);
}

function searchTabsProfileKey(q, active){
  const intent = inferMaruSearchIntentProfile(q, allItems);
  const tabs = inferSearchTabsForQuery(q, active).map(x => x[0]).join('|');
  const received = Array.isArray(allItems) ? allItems.length : 0;
  return intent + '::' + tabs + '::' + received + '::' + normalizeSearchType(active || activeType || 'all') + '::' + getSearchUiLang();
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

    /* Video results are shown as lightweight snapshots in the card, not as heavy embeds. */
    .maru-card-media[data-kind="video"] {
      position: relative;
      flex-basis: 310px;
      width: 310px;
    }
    .maru-card-media[data-kind="video"]::after {
      content: '▶ 영상';
      position: absolute;
      left: 10px;
      bottom: 10px;
      padding: 5px 9px;
      border-radius: 999px;
      background: rgba(15, 23, 42, .78);
      color: #fff;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: -0.01em;
    }

    .maru-display-section[data-group="image"] .maru-image-gallery-grid,
    .maru-display-section[data-group="media"] .maru-image-gallery-grid {
      margin: 6px 0 8px;
      grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
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
      color: #3730a3;
    }
    .maru-display-collapsed-card {
      display: none !important;
    }
    .maru-display-section[data-expanded="1"] .maru-display-collapsed-card {
      display: block !important;
    }
    .maru-display-hidden-wrap {
      margin-top: 6px;
    }
    .maru-display-hidden-wrap > .card {
      margin: 8px 0;
    }
    .maru-video-embed-wrap {
      flex: 0 0 360px;
      width: 360px;
      max-width: 46%;
      aspect-ratio: 16 / 9;
      border-radius: 12px;
      overflow: hidden;
      background: #0f172a;
      border: 1px solid #e5e7eb;
      align-self: flex-start;
    }
    .maru-video-embed-wrap iframe,
    .maru-video-embed-wrap video {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: #000;
      object-fit: cover;
    }

    .maru-map-preview {
      flex: 0 0 330px;
      width: 330px;
      max-width: 46%;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e5e7eb;
      background: #eef2f7;
      align-self: flex-start;
    }
    .maru-map-preview iframe {
      display: block;
      width: 100%;
      height: 190px;
      border: 0;
      background: #e5e7eb;
    }
    .maru-map-preview-caption {
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 800;
      color: #334155;
      background: #ffffff;
      border-top: 1px solid #e5e7eb;
    }

    .maru-video-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 3px 7px;
      border-radius: 999px;
      background: #eef2ff;
      color: #4338ca;
      font-size: 11px;
      font-weight: 800;
    }

    .maru-image-gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 10px;
      align-items: stretch;
      margin: 10px 0 18px;
    }
    .maru-image-tile {
      position: relative;
      min-height: 158px;
      border: 1px solid #e5e7eb;
      border-radius: 13px;
      overflow: hidden;
      background: #f8fafc;
      cursor: pointer;
    }
    .maru-image-tile img {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 158px;
      object-fit: cover;
      background: #f1f5f9;
    }
    .maru-image-tile[data-orientation="portrait"] { grid-row: span 2; }
    .maru-image-tile[data-orientation="portrait"] img { min-height: 326px; }
    .maru-image-gallery-pending .maru-image-tile-pending {
      cursor: default;
      background: linear-gradient(90deg, #f1f5f9 0%, #f8fafc 50%, #f1f5f9 100%);
    }
    .maru-image-gallery-pending .maru-image-tile-pending::after {
      content: '';
      position: absolute;
      left: 14px;
      right: 14px;
      bottom: 14px;
      height: 12px;
      border-radius: 999px;
      background: rgba(148, 163, 184, .28);
    }
    .maru-image-tile-caption {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 7px 9px;
      background: linear-gradient(180deg, rgba(15,23,42,0), rgba(15,23,42,.72));
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.25;
      text-shadow: 0 1px 2px rgba(0,0,0,.35);
    }
    .maru-result-viewer {
      margin: 10px 0 18px;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      overflow: hidden;
      background: #ffffff;
    }
    .maru-result-viewer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid #eef2f7;
      background: #f8fafc;
    }
    .maru-result-viewer-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #0f172a;
      font-size: 13px;
      font-weight: 800;
    }
    .maru-result-viewer-actions {
      display: flex;
      gap: 8px;
      flex: 0 0 auto;
    }
    .maru-result-viewer-actions button,
    .maru-result-viewer-actions a {
      border: 1px solid #dbe2ea;
      border-radius: 9px;
      background: #fff;
      color: #334155;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
    }
    .maru-result-viewer iframe {
      display: block;
      width: 100%;
      min-height: calc(100vh - 235px);
      border: 0;
      background: #fff;
    }


    .maru-search-home-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 9px;
      padding: 8px 17px;
      min-height: 38px;
      border-radius: 11px;
      border: 1px solid rgba(255, 166, 146, 0.92);
      background: linear-gradient(180deg, #ffe3da 0%, #ffcabc 100%);
      color: #2389bd;
      font-size: 20px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -0.02em;
      text-decoration: none;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(244, 140, 120, 0.20);
      vertical-align: middle;
    }
    .maru-search-home-link:hover {
      color: #156b99;
      background: linear-gradient(180deg, #ffd8cf 0%, #ffb9aa 100%);
      text-decoration: none;
      transform: translateY(-1px);
    }
    .maru-search-header-title {
      white-space: nowrap;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      gap: 0;
    }


    /* PATCH: image gallery layout is full-width visual grid, max 6 columns.
       This only affects gallery presentation and does not touch category tabs. */
    .maru-display-section[data-group="image"] .maru-display-section-body,
    .maru-display-section[data-group="media"] .maru-display-section-body {
      padding: 12px 12px 14px;
    }
    .maru-display-section[data-group="image"] .maru-image-gallery-grid,
    .maru-display-section[data-group="media"] .maru-image-gallery-grid,
    .maru-image-gallery-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      align-items: stretch;
      width: 100%;
      margin: 8px 0 12px;
    }
    .maru-image-tile {
      min-height: 0;
      display: flex;
      flex-direction: column;
      border: 1px solid #e5e7eb;
      border-radius: 13px;
      overflow: hidden;
      background: #ffffff;
      cursor: pointer;
    }
    .maru-image-tile img {
      width: 100%;
      height: 138px;
      min-height: 0;
      object-fit: cover;
      border: 0;
      border-radius: 0;
      background: #f1f5f9;
      flex: 0 0 auto;
    }
    .maru-image-tile[data-orientation="portrait"] { grid-row: auto; }
    .maru-image-tile[data-orientation="portrait"] img { min-height: 0; height: 138px; }
    .maru-image-tile-caption {
      position: static;
      padding: 8px 9px 3px;
      background: #ffffff;
      color: #111827;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.28;
      text-shadow: none;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .maru-image-tile-summary {
      padding: 0 9px 9px;
      color: #64748b;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    @media (max-width: 1340px) {
      .maru-display-section[data-group="image"] .maru-image-gallery-grid,
      .maru-display-section[data-group="media"] .maru-image-gallery-grid,
      .maru-image-gallery-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    }
    @media (max-width: 1120px) {
      .maru-display-section[data-group="image"] .maru-image-gallery-grid,
      .maru-display-section[data-group="media"] .maru-image-gallery-grid,
      .maru-image-gallery-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    @media (max-width: 900px) {
      .maru-display-section[data-group="image"] .maru-image-gallery-grid,
      .maru-display-section[data-group="media"] .maru-image-gallery-grid,
      .maru-image-gallery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .maru-display-section[data-group="image"] .maru-image-gallery-grid,
      .maru-display-section[data-group="media"] .maru-image-gallery-grid,
      .maru-image-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 420px) {
      .maru-display-section[data-group="image"] .maru-image-gallery-grid,
      .maru-display-section[data-group="media"] .maru-image-gallery-grid,
      .maru-image-gallery-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 720px) {
      .maru-search-home-link {
        min-height: 34px;
        padding: 7px 13px;
        font-size: 17px;
      }
    }

    @media (max-width: 720px) {
      .maru-search-card-body {
        display: block;
      }
      .maru-card-media,
      .maru-map-preview {
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

const SEARCH_PAGE_PROXY_URL = '/.netlify/functions/search-page-proxy';


function normalizeSourceViewUrl(raw){
  const value = String(raw || '').trim();
  if(!value) return '';
  try{
    const u = new URL(value, location.href);
    if(!/^https?:$/.test(u.protocol)) return value;
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = (u.pathname || '/').replace(/\/+/g, '/');

    // Seoul Archives search results often arrive as the bare domain.
    // The actually rendered public entry point is /main.  If we try the
    // bare root inside the viewer, it frequently returns a JS/redirect shell
    // and the IGDC source area stays blank.  Normalize before frame-check,
    // direct iframe and proxy fallback so it behaves like the original page.
    if(host === 'archives.seoul.go.kr'){
      if(path === '/' || path === '' || path.toLowerCase() === '/index.do' || path.toLowerCase() === '/index'){
        u.pathname = '/main';
        u.search = '';
        u.hash = '';
        return u.href;
      }
    }

    return u.href;
  }catch(e){
    return value;
  }
}

function isSkippableNavigationHref(href){
  const h = String(href || '').trim();
  return !h || h === '#' || h.charAt(0) === '#' || /^javascript:/i.test(h) || /^mailto:|^tel:/i.test(h);
}

function proxyUrlForResult(target, extraParams){
  const raw = normalizeSourceViewUrl(target);
  if(!raw) return '';
  try{
    const u = new URL(raw, location.href);
    if(!/^https?:$/.test(u.protocol)) return '';
    const sp = new URLSearchParams();
    sp.set('safe', '1');
    sp.set('embed', '1');
    sp.set('url', u.href);
    const extra = extraParams && typeof extraParams === 'object' ? extraParams : {};
    Object.keys(extra).forEach(k => {
      if(extra[k] != null && extra[k] !== '') sp.set(k, String(extra[k]));
    });
    return SEARCH_PAGE_PROXY_URL + '?' + sp.toString();
  }catch(e){
    return '';
  }
}




function sourceFrameCheckUrl(target){
  const raw = normalizeSourceViewUrl(target);
  if(!raw) return '';
  try{
    const u = new URL(raw, location.href);
    if(!/^https?:$/.test(u.protocol)) return '';
    const sp = new URLSearchParams();
    sp.set('action', 'frame-check');
    sp.set('url', u.href);
    return SEARCH_PAGE_PROXY_URL + '?' + sp.toString();
  }catch(e){ return ''; }
}

async function checkSourceFramePolicy(target){
  const url = sourceFrameCheckUrl(target);
  if(!url) return { ok:false, directAllowed:false, reason:'invalid-url' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try{ ctrl.abort(); }catch(e){} }, 4200);
  try{
    const r = await fetch(url, { cache:'no-store', credentials:'same-origin', signal:ctrl.signal });
    const json = await r.json().catch(() => null);
    clearTimeout(timer);
    if(!r.ok || !json) return { ok:false, directAllowed:true, reason:'check-failed' };
    return json;
  }catch(e){
    clearTimeout(timer);
    // If the checker is unavailable, try the real page directly rather than
    // replacing the viewer with an empty proxy page.
    return { ok:false, directAllowed:true, reason:'check-timeout' };
  }
}

function loadDirectSourceFrame(frame, target, loadingEl){
  if(!frame || !target) return;
  frame.classList.remove('maru-search-owned-proxy-frame');
  frame.classList.add('maru-search-owned-source-frame');
  frame.removeAttribute('srcdoc');
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-presentation';
  frame.dataset.viewerMode = 'direct';
  let blankLoaded = false;
  let done = false;
  const finish = () => {
    if(done) return;
    done = true;
    try{ if(loadingEl) loadingEl.remove(); }catch(e){}
  };
  frame.onload = () => {
    if(!blankLoaded){
      blankLoaded = true;
      try{ frame.contentWindow.location.replace(target); }
      catch(e){ try{ frame.src = target; }catch(e2){} }
      return;
    }
    setTimeout(finish, 600);
  };
  try{ frame.src = 'about:blank'; }
  catch(e){ try{ frame.src = target; }catch(e2){} }
  setTimeout(finish, 5200);
}

function loadStaticSourceProxyFrame(frame, target, proxyId, loadingEl){
  if(!frame || !target) return;
  const proxySrc = proxyUrlForResult(target, { mode:'static', proxyId });
  frame.classList.add('maru-search-owned-proxy-frame');
  frame.classList.remove('maru-search-owned-source-frame');
  frame.removeAttribute('srcdoc');
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  frame.sandbox = 'allow-forms allow-popups allow-presentation allow-downloads';
  frame.dataset.viewerMode = 'static-proxy';
  frame.onload = () => { try{ if(loadingEl) loadingEl.remove(); }catch(e){} };
  try{ frame.src = proxySrc; }catch(e){ loadProxyHtmlIntoFrame(frame, loadingEl, proxySrc, target); }
  setTimeout(() => { try{ if(loadingEl) loadingEl.remove(); }catch(e){} }, 3800);
}

async function mountOwnedSourceFrame(frame, loadingEl, target, proxyId){
  if(!frame || !target) return;
  if(loadingEl) loadingEl.textContent = uiText('receiving', 'receiving...');
  const policy = await checkSourceFramePolicy(target);
  if(policy && policy.directAllowed){
    loadDirectSourceFrame(frame, target, loadingEl);
    return;
  }
  loadStaticSourceProxyFrame(frame, target, proxyId, loadingEl);
}

function proxyFailSrcdoc(target, message){
  const safeTarget = String(target || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;color:#334155;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.wrap{padding:32px 20px}.url{font-size:13px;color:#64748b;word-break:break-all}</style></head><body><div class="wrap"><div class="url">' + safeTarget + '</div></div></body></html>';
}

async function loadProxyHtmlIntoFrame(frame, loadingEl, proxySrc, target){
  if(!frame || !proxySrc) return;
  let settled = false;

  const finish = () => {
    if(settled) return;
    settled = true;
    try{ if(loadingEl) loadingEl.remove(); }catch(e){}
  };

  const installHtml = (htmlText) => {
    const html = String(htmlText || '') || proxyFailSrcdoc(target, 'empty proxy response');

    // Use srcdoc, not iframe.src/blob navigation. This keeps the browser Back
    // button owned by the IGDC search page instead of being captured by the
    // nested source page history. The proxy injects a navigation bridge so
    // links inside the source page reload this same iframe without leaving IGDC.
    try{
      if(frame.__maruProxyBlobUrl){
        try{ URL.revokeObjectURL(frame.__maruProxyBlobUrl); }catch(e){}
        frame.__maruProxyBlobUrl = '';
      }
      frame.removeAttribute('src');
      frame.srcdoc = html;
      frame.onload = () => finish();
      setTimeout(finish, 1800);
      return;
    }catch(e){}

    try{
      const blob = new Blob([html], { type:'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      frame.__maruProxyBlobUrl = blobUrl;
      frame.removeAttribute('srcdoc');
      frame.onload = () => finish();
      frame.src = blobUrl;
      setTimeout(finish, 1800);
      return;
    }catch(e2){}

    frame.removeAttribute('src');
    frame.srcdoc = proxyFailSrcdoc(target, 'viewer install failed');
    finish();
  };

  try{
    if(loadingEl) loadingEl.textContent = uiText('receiving', 'receiving...');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18000);
    const r = await fetch(proxySrc, { cache:'no-store', credentials:'same-origin', signal:ctrl.signal });
    const text = await r.text();
    clearTimeout(timer);
    if(!r.ok){
      installHtml(proxyFailSrcdoc(target, 'proxy status ' + r.status));
      return;
    }
    installHtml(text);
  }catch(e){
    installHtml(proxyFailSrcdoc(target, String(e && e.message || e || 'proxy failed')));
  }
}

function installProxyViewerMessageBridge(){
  if(installProxyViewerMessageBridge._done) return;
  installProxyViewerMessageBridge._done = true;
  window.addEventListener('message', function(ev){
    const data = ev && ev.data;
    if(!data || typeof data !== 'object') return;
    if(data.__igdcProxyNavigate !== 1) return;
    const proxyId = String(data.proxyId || '');
    const nextUrl = String(data.url || '').trim();
    if(!proxyId || !nextUrl) return;
    const frame = Array.from(document.querySelectorAll('.maru-search-owned-proxy-frame')).find(f => f && f.dataset && f.dataset.proxyId === proxyId);
    if(!frame) return;
    const proxyBox = frame.closest('.maru-search-owned-proxy');
    let loading = proxyBox && proxyBox.querySelector('.maru-search-owned-proxy-loading');
    if(!loading && proxyBox){
      loading = document.createElement('div');
      loading.className = 'maru-search-owned-proxy-loading';
      loading.textContent = uiText('receiving', 'receiving...');
      proxyBox.insertBefore(loading, frame);
    }
    const src = proxyUrlForResult(nextUrl, { mode:'static', proxyId });
    try{ frame.src = src; }catch(e){ loadProxyHtmlIntoFrame(frame, loading, src, nextUrl); }
    setTimeout(() => { try{ if(loading) loading.remove(); }catch(e){} }, 1800);
  });
}


function originalUrlFromMaybeProxy(href){
  const raw = String(href || '').trim();
  if(!raw) return '';
  try{
    const u = new URL(raw, location.href);
    if(u.origin === location.origin && u.pathname === SEARCH_PAGE_PROXY_URL){
      return u.searchParams.get('url') || raw;
    }
    return u.href;
  }catch(e){
    return raw;
  }
}

function buildSearchOwnedResultHref(target){
  try{
    const raw = String(target || '').trim();
    if(!raw) return '#';
    const u = new URL(location.href);
    u.searchParams.set('view', 'result');
    u.searchParams.set('target', raw);
    u.searchParams.set('page', String(currentPage || 1));
    u.searchParams.set('block', String(currentBlock || 0));
    const q = String(lastQuery || input.value || '').trim();
    if(q) u.searchParams.set('q', q);
    if(activeType && activeType !== 'all') u.searchParams.set('type', activeType);
    else u.searchParams.delete('type');
    return u.pathname + u.search + u.hash;
  }catch(e){
    return '#';
  }
}


function buildSearchListReturnHref(){
  try{
    const u = new URL(location.href);
    u.searchParams.delete('view');
    u.searchParams.delete('target');
    u.searchParams.set('page', String(currentPage || 1));
    u.searchParams.set('block', String(currentBlock || 0));
    const q = String(lastQuery || input.value || '').trim();
    if(q) u.searchParams.set('q', q);
    if(activeType && activeType !== 'all') u.searchParams.set('type', activeType);
    else u.searchParams.delete('type');
    return u.pathname + u.search + u.hash;
  }catch(e){
    return location.pathname + location.search + location.hash;
  }
}

function goToOriginalSourceSameTab(target){
  const raw = normalizeSourceViewUrl(target);
  if(!raw) return;
  try{
    const u = new URL(raw, location.href);
    if(!/^https?:$/.test(u.protocol)) return;
  }catch(e){ return; }

  try{
    const returnUrl = buildSearchListReturnHref();
    const q = String(lastQuery || input.value || '').trim();
    try{
      sessionStorage.setItem('maruSearchReturnUrl', returnUrl);
      sessionStorage.setItem('maruSearchReturnState', JSON.stringify({
        q, page: currentPage || 1, block: currentBlock || 0, type: activeType || 'all', scrollY: window.scrollY || 0, ts: Date.now()
      }));
      // Keep a light rich-result cache so Browser Back can restore cards with
      // thumbnails/videos immediately even if the browser does not keep bfcache.
      try{
        const cacheItems = (Array.isArray(allItems) ? allItems.slice(0, Math.min(allItems.length, 360)) : []);
        sessionStorage.setItem('maruSearchReturnItems', JSON.stringify({
          q, page: currentPage || 1, block: currentBlock || 0, type: activeType || 'all',
          serverTotalItems: serverTotalItems || 0, authoritativeServerTotalItems: authoritativeServerTotalItems || 0,
          items: cacheItems, ts: Date.now()
        }));
      }catch(cacheErr){}
    }catch(e){}
    history.replaceState({
      ...(history.state || {}),
      __maruSearchOwnedResult:false,
      __maruSearchList:true,
      q,
      page: currentPage || 1,
      block: currentBlock || 0,
      type: activeType || 'all'
    }, '', returnUrl);
  }catch(e){}

  try{ window.location.assign(raw); }
  catch(e){ window.location.href = raw; }
}


function restoreSearchReturnItemsFromSession(expectedQ, expectedType){
  try{
    const raw = sessionStorage.getItem('maruSearchReturnItems') || '';
    if(!raw) return false;
    const pack = JSON.parse(raw);
    if(!pack || !Array.isArray(pack.items) || !pack.items.length) return false;
    const q = String(expectedQ || '').trim();
    const type = normalizeSearchType(expectedType || activeType || 'all');
    const packQ = String(pack.q || '').trim();
    const packType = normalizeSearchType(pack.type || 'all');
    if(q && packQ && q !== packQ) return false;
    if(type && packType && type !== packType) return false;
    allItems = mergeItemsPreferDisplayRichness([], pack.items);
    loadedServerPages.clear();
    seedLoadedServerPagesFromItems(allItems, allItems.length);
    currentPage = Math.max(1, parseInt(pack.page || currentPage || 1, 10) || 1);
    currentBlock = Math.max(0, parseInt(pack.block || currentBlock || 0, 10) || 0);
    lastQuery = packQ || q || lastQuery;
    lastType = packType || type || lastType;
    activeType = packType || type || activeType;
    serverTotalItems = Math.max(serverTotalItems || 0, Number(pack.serverTotalItems || 0) || allItems.length);
    authoritativeServerTotalItems = Math.max(authoritativeServerTotalItems || 0, Number(pack.authoritativeServerTotalItems || 0) || allItems.length);
    progressivePagerPages = Math.max(progressivePagerPages || INITIAL_PROGRESSIVE_PAGER_PAGES, preloadPageCountFromItems(allItems));
    return true;
  }catch(e){ return false; }
}

function findSearchItemByUrl(target){
  const raw = String(target || '').trim();
  if(!raw) return null;
  let norm = raw.toLowerCase();
  try{ norm = new URL(raw, location.href).href.toLowerCase(); }catch(e){}
  const list = Array.isArray(allItems) ? allItems : [];
  for(const it of list){
    const urls = [it && it.url, it && it.link, it && it.openUrl, it && it.href].map(v => String(v || '').trim()).filter(Boolean);
    for(const u0 of urls){
      let v = u0.toLowerCase();
      try{ v = new URL(u0, location.href).href.toLowerCase(); }catch(e){}
      if(v === norm) return it;
    }
  }
  return null;
}

function installSearchResultClickGuard(){
  if(!results || results.__maruOwnedClickGuardInstalled) return;
  results.__maruOwnedClickGuardInstalled = true;
  results.addEventListener('click', function(e){
    if(!isSearchPage) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a || a.dataset.maruExternal === '1' || a.closest('.maru-result-viewer-actions')) return;
    const href = a.getAttribute('href') || '';
    if(isSkippableNavigationHref(href)) return;
    if(a.closest('.maru-search-owned-result-actions') && a.dataset.maruExternal === '1') return;
    const target = a.dataset.originalUrl || originalUrlFromMaybeProxy(href);
    if(!target) return;
    e.preventDefault();
    e.stopPropagation();
    goToOriginalSourceSameTab(target);
  }, true);
}


function resolveSearchHomeUrl(){
  try {
    const rawFrom = (new URLSearchParams(location.search).get('from') || '').trim();
    if (rawFrom) {
      const u = new URL(rawFrom, location.origin);
      if (u.origin === location.origin) return u.pathname + u.search + u.hash;
    }
  } catch(e) {}
  return '/';
}

function ensureSearchHeaderHomeLink(){
  if (!isSearchPage || document.getElementById('maru-search-home-title-link')) return;
  try {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (text === 'IGDC Global Search') return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    const node = walker.nextNode();
    if (!node || !node.parentNode) return;

    const wrap = document.createElement('span');
    wrap.className = 'maru-search-header-title';

    const home = document.createElement('a');
    home.id = 'maru-search-home-title-link';
    home.className = 'maru-search-home-link';
    home.href = resolveSearchHomeUrl();
    home.textContent = uiText('home', 'Home');
    home.setAttribute('aria-label', 'Go to Home');

    wrap.appendChild(home);
    wrap.appendChild(document.createTextNode(' ' + uiText('globalSearchTitle', 'Global Search')));
    node.parentNode.replaceChild(wrap, node);
  } catch(e) {}
}

function applySearchUiI18n(){
  try{
    const lang = getSearchUiLang();
    const htmlLang = lang === 'zht' ? 'zh-Hant' : lang;
    if(document.documentElement && htmlLang && document.documentElement.getAttribute('lang') !== htmlLang) {
      document.documentElement.setAttribute('lang', htmlLang);
    }
  }catch(e){}
  try{ if(input) input.setAttribute('placeholder', uiText('placeholder', 'Search the world…')); }catch(e){}
  try{ if(btn) btn.textContent = uiText('search', 'Search'); }catch(e){}
  try{
    const home = document.getElementById('maru-search-home-title-link');
    if(home) home.textContent = uiText('home', 'Home');
    const brand = document.querySelector('.brand');
    if(brand){
      const titleWrap = brand.querySelector('.maru-search-header-title');
      if(titleWrap){
        Array.from(titleWrap.childNodes).forEach(node => {
          if(node.nodeType === 3) node.nodeValue = ' ' + uiText('globalSearchTitle', 'Global Search');
        });
      }else if(!brand.querySelector('#maru-search-home-title-link')){
        brand.textContent = uiText('globalSearchTitle', 'Global Search');
      }
    }
  }catch(e){}
  try{
    const bar = document.getElementById('maru-search-tabs');
    if(bar) bar.dataset.profileKey = '';
    updateSearchTabsActive(queryTextForTabs());
  }catch(e){}
}

function bindSearchUiI18nEvents(){
  if(bindSearchUiI18nEvents._bound) return;
  bindSearchUiI18nEvents._bound = true;
  const rerender = () => setTimeout(applySearchUiI18n, 0);
  try{ window.addEventListener('igdc:langchange', rerender); }catch(e){}
  try{ window.addEventListener('languagechange', rerender); }catch(e){}
  try{ window.addEventListener('storage', e => { if(!e || e.key === 'igdc_lang') rerender(); }); }catch(e){}
  try{
    new MutationObserver(rerender).observe(document.documentElement, { attributes:true, attributeFilter:['lang'] });
  }catch(e){}
}

ensureSearchHeaderHomeLink();
applySearchUiI18n();
bindSearchUiI18nEvents();
installSearchResultClickGuard();


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
  const cleanQ = String(q || '').trim();
  signalSanmaruSearch(cleanQ, 'all', 'home-to-search-handoff');

  const u = new URL('/search.html', location.origin);
  u.searchParams.set('q', cleanQ);
  u.searchParams.set('page', '1');
  u.searchParams.set('block', '0');

  // A fresh query from the homepage/search box must not inherit the previous
  // tab such as type=video. Search page tabs may be clicked after the new
  // query loads.
  u.searchParams.delete('type');
  u.searchParams.set('residentFirst', '1');
  u.searchParams.set('sanmaruFirst', '1');
  u.searchParams.set('residentSwitch', '1');
  u.searchParams.set('handoff', '1');

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
  updateSearchTabsActive(qp);

  input.value = qp;

  if (run && qp) {
    runSearch(qp, activeType).then(() => {
      currentPage = pageParam;
      currentBlock = blockParam;
      loadServerPageAndRender(currentPage);
    });
  } else if (run && !qp) {
    allItems = [];
    lastSearchPayload = null;
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
  }
}

window.addEventListener('popstate', (e) => {
  if (!isSearchPage) return;

  const state = e.state || {};

  // 1️⃣ 검색 상세/목록 상태에서는 브라우저 뒤로가기가 반드시 검색 목록으로 복원되어야 한다.
  // from 복귀는 검색어가 없는 순수 진입 상태에서만 허용한다.
  const sp = new URLSearchParams(location.search);
  if (state.__searchEntry && state.from && !sp.get('q') && !sp.get('view')) {
    location.href = state.from;
    return;
  }

  // 2️⃣ URL 기준으로 항상 복원 (state 의존 제거)

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
  updateSearchTabsActive(q);

  // 3️⃣ 검색어 동기화
  if (q && input.value !== q) {
    input.value = q;
  }

  const viewMode = (sp.get('view') || state.view || '').trim();
  const viewTarget = (sp.get('target') || state.target || '').trim();
  if (viewMode === 'result' && viewTarget) {
    // Direct original mode no longer uses internal result views. If an old
    // history entry remains, normalize it back to the search list.
    try{
      const u = new URL(location.href);
      u.searchParams.delete('view');
      u.searchParams.delete('target');
      history.replaceState({ ...(state || {}), __maruSearchOwnedResult:false, view:'' }, '', u.toString());
    }catch(e){}
  }

  // 4️⃣ 데이터 없거나 검색어/탭이 바뀌면 다시 검색
  if (!allItems || !allItems.length || q !== lastQuery || nextType !== lastType) {
    runSearch(q, nextType).then(() => {
      currentPage = page;
      currentBlock = block;
      loadServerPageAndRender(currentPage);
    });
    return;
  }

  // 5️⃣ 바로 페이지 복원
  currentPage = page;
  currentBlock = block;
  loadServerPageAndRender(currentPage);
});

if (q0) {
  input.value = q0;
}

ensureSearchTabs();
bindRelatedSearchSuggest();
updateSearchTabsActive();

if (q0) {
  signalSanmaruSearch(q0, activeType, 'search-page-url-open');
  // When returning from an original source page, restore the previous rich
  // list first so cards/thumbnails appear immediately, then let Sanmaru
  // continue refreshing in the background.
  if(restoreSearchReturnItemsFromSession(q0, activeType)){
    input.value = q0;
    updateSearchTabsActive(q0);
    renderPage(currentPage || 1, true);
    status.textContent = statusResultsText(actualResultCountForStatus(), q0, activeType);
    try{
      const restoreSeq = (Number(runSearch._seq) || 0) + 1;
      runSearch._seq = restoreSeq;
      startContinuousIntake(q0, activeType, restoreSeq);
    }catch(e){}
  } else {
    syncSearchFromUrl(true);
  }
} else {
  bootSanmaruOnce('search-ui-ready', '', activeType);
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
      const nextType = 'all';
      activeType = nextType;
      updateSearchTabsActive();
      const u = new URL(location.href);
      u.searchParams.set('q', q);
      u.searchParams.set('page', '1');
      u.searchParams.set('block', '0');
      u.searchParams.delete('type');
      u.searchParams.set('residentFirst', '1');
      u.searchParams.set('sanmaruFirst', '1');
      u.searchParams.set('residentSwitch', '1');
      history.pushState({ q, type: nextType, page: 1, block: 0 }, '', u.toString());
      runSearch(q, nextType);
      return;
    }

    const nextType = 'all';
    activeType = nextType;
    updateSearchTabsActive();
    signalSanmaruSearch(q, nextType, 'search-page-new-query');

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    u.searchParams.delete('type');
    u.searchParams.set('residentFirst', '1');
    u.searchParams.set('sanmaruFirst', '1');
    u.searchParams.set('residentSwitch', '1');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: nextType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, nextType);
    return;
  }

  try { window.top.location.href = buildSearchUrl(q); } catch(e) { window.location.assign(buildSearchUrl(q)); }
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
      const nextType = 'all';
      activeType = nextType;
      updateSearchTabsActive();
      const u = new URL(location.href);
      u.searchParams.set('q', q);
      u.searchParams.set('page', '1');
      u.searchParams.set('block', '0');
      u.searchParams.delete('type');
      u.searchParams.set('residentFirst', '1');
      u.searchParams.set('sanmaruFirst', '1');
      u.searchParams.set('residentSwitch', '1');
      history.pushState({ q, type: nextType, page: 1, block: 0 }, '', u.toString());
      runSearch(q, nextType);
      return;
    }

    const nextType = 'all';
    activeType = nextType;
    updateSearchTabsActive();
    signalSanmaruSearch(q, nextType, 'search-page-new-query');

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    u.searchParams.delete('type');
    u.searchParams.set('residentFirst', '1');
    u.searchParams.set('sanmaruFirst', '1');
    u.searchParams.set('residentSwitch', '1');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: nextType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, nextType);
    return;
  }

  try { window.top.location.href = buildSearchUrl(q); } catch(e) { window.location.assign(buildSearchUrl(q)); }
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


function normalizeSearchPayload(payload){
  const root = unwrap(payload) || payload || {};
  const items = normalizeItems(root);
  const pageItems =
    (root.visiblePagePack && Array.isArray(root.visiblePagePack.pageItems) && root.visiblePagePack.pageItems) ||
    (Array.isArray(root.pageItems) && root.pageItems) ||
    (root.sectionPack && Array.isArray(root.sectionPack.pageItems) && root.sectionPack.pageItems) ||
    [];
  const viewportSections =
    (Array.isArray(root.viewportSections) && root.viewportSections) ||
    (root.sectionPack && Array.isArray(root.sectionPack.viewportSections) && root.sectionPack.viewportSections) ||
    (Array.isArray(root.displaySections) && root.displaySections) ||
    [];
  return { payload: root, items, pageItems, viewportSections, supplySignal: supplySignalFromPayload(root, Math.max(items.length, pageItems.length)) };
}

function boolishSearchSignal(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return ['1','true','yes','on','ok'].includes(s);
}

function firstFiniteSearchNumber(){
  for(let i=0; i<arguments.length; i++){
    const n = Number(arguments[i]);
    if(Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function maxFiniteSearchNumber(){
  let out = 0;
  for(let i=0; i<arguments.length; i++){
    const n = Number(arguments[i]);
    if(Number.isFinite(n) && n >= 0) out = Math.max(out, n);
  }
  return out;
}

function supplySignalFromPayload(payload, fallbackCount){
  const root = unwrap(payload) || payload || {};
  const meta = root.meta || {};
  const readiness = meta.supplyReadiness || root.supplyReadiness || {};
  const vp = root.visiblePagePack || meta.viewport || (root.sectionPack && root.sectionPack.visiblePagePack) || {};
  const count = firstFiniteSearchNumber(meta.count, root.count, fallbackCount);
  const availableNow = maxFiniteSearchNumber(
    count,
    meta.responseWindowCount,
    meta.visibleCount,
    readiness.available,
    vp.visibleCount,
    fallbackCount
  );
  const estimatedTotal = maxFiniteSearchNumber(
    vp.totalVisibleItems,
    vp.fullCandidateCount,
    vp.totalCandidates,
    meta.totalCandidates,
    meta.fullCandidateCount,
    meta.totalItems,
    root.totalCandidates,
    root.fullCandidateCount,
    root.totalItems,
    availableNow,
    fallbackCount
  );
  const explicitHasMore = root.hasMore !== undefined || meta.hasMore !== undefined || vp.hasNextPage !== undefined;
  const hasMore = explicitHasMore
    ? !!(boolishSearchSignal(root.hasMore) || boolishSearchSignal(meta.hasMore) || boolishSearchSignal(vp.hasNextPage))
    : estimatedTotal > Math.max(availableNow, fallbackCount || 0);
  const exhausted = !!(
    boolishSearchSignal(root.exhausted) ||
    boolishSearchSignal(meta.exhausted) ||
    boolishSearchSignal(meta.sourceExhausted) ||
    boolishSearchSignal(readiness.exhausted) ||
    boolishSearchSignal(root.sourceExhausted)
  );
  return {
    availableNow,
    estimatedTotal,
    authoritativeTotal: maxFiniteSearchNumber(meta.authoritativeTotal, root.authoritativeTotal, estimatedTotal),
    hasMore: exhausted ? false : hasMore,
    exhausted,
    partial: !exhausted && (hasMore || estimatedTotal > availableNow),
    realDataOnly: readiness.realItemsOnly !== false,
    shortage: firstFiniteSearchNumber(readiness.shortage, 0)
  };
}

function serverTotalFromPayload(payload, fallbackCount){
  const signal = supplySignalFromPayload(payload, fallbackCount || 0);
  const total = signal.estimatedTotal || fallbackCount || 0;
  const cappedTotal = Math.min(Math.max(total, fallbackCount || 0), MAX_PAGER_PAGES * PAGE_SIZE);
  return cappedTotal;
}

function pageItemsFromPack(pack){
  if(!pack) return [];
  if(Array.isArray(pack.pageItems) && pack.pageItems.length) return pack.pageItems;
  const payload = pack.payload || pack;
  if(payload && payload.visiblePagePack && Array.isArray(payload.visiblePagePack.pageItems) && payload.visiblePagePack.pageItems.length) return payload.visiblePagePack.pageItems;
  if(payload && Array.isArray(payload.pageItems) && payload.pageItems.length) return payload.pageItems;
  return Array.isArray(pack.items) ? pack.items.slice(0, PAGE_SIZE) : [];
}

function preloadPageCountFromItems(items){
  return Math.max(1, Math.ceil((Array.isArray(items) ? items.length : 0) / PAGE_SIZE));
}

function adaptiveSearchTarget(q, type){
  const text = String(q || '').trim().toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const safeType = normalizeSearchType(type || activeType || 'all');
  const broadHints = /(세계|전세계|글로벌|뉴스|영상|이미지|관광|여행|ai|인공지능|기술|시장|경제|정치|스포츠|금융|도서|쇼핑|웹툰|공공|학술|논문|사이트|홈페이지|global|world|news|tour|travel|technology|market|sports|finance|book|shopping|webtoon)/i;
  const narrowHints = /(카페|맛집|식당|주소|전화|위치|지도|병원|약국|학교|교회|상호|주차|near me|cafe|restaurant|address|map)/i;

  // Search.js remains only a receiver/container. This target is the amount of
  // Sanmaru/MaruSearch supply the UI is ready to cache for search pages. It is
  // separate from the 4,500~5,000 Search Bank Snapshot supply used by front pages.
  // Broad searches may keep filling up to 4,500 candidates, while first paint
  // still renders only the current viewport and uses continuous intake for the rest.
  let target = 3200;
  if (safeType === 'all') target = 4500;
  if (safeType !== 'all') target = 2400;
  if (words.length >= 3 || narrowHints.test(text)) target = Math.max(target, 2400);
  if (words.length <= 1 || broadHints.test(text)) target = 4500;
  if (/^(news|image|video|sns|blog|cafe|tour|site|academic|wiki|public_data)$/.test(safeType)) target = Math.max(target, 3000);
  if (/^(map|knowledge|book|shopping|sports|finance|webtoon)$/.test(safeType)) target = Math.max(2200, Math.min(target, 3200));

  return Math.max(INITIAL_PRELOAD_TARGET, Math.min(MAX_SMOOTH_CANDIDATES, target));
}

function firstPaintLimitFor(q, type){
  // Keep the UI first paint light, but ask Sanmaru for the first 12 pages of
  // already-prepared resident candidates. The DOM still renders only the
  // current viewport; the extra candidates keep the initial pager at 10~12 pages
  // and let page navigation feel immediate.
  return Math.min(INITIAL_PRELOAD_TARGET, adaptiveSearchTarget(q, type));
}

function seedLoadedServerPagesFromItems(items, maxItems){
  const list = Array.isArray(items) ? items : [];
  const limit = Math.min(list.length, maxItems || INITIAL_DOM_RENDER_TARGET);
  for(let offset = 0; offset < limit; offset += PAGE_SIZE){
    const pageNo = Math.floor(offset / PAGE_SIZE) + 1;
    const slice = list.slice(offset, offset + PAGE_SIZE);
    if(slice.length) loadedServerPages.set(pageNo, slice);
  }
}

function updateProgressiveTotalFromPayload(payload, fallbackCount, opts){
  const signal = supplySignalFromPayload(payload, fallbackCount || 0);
  const total = serverTotalFromPayload(payload, fallbackCount || 0);
  const floorCount = Math.max(fallbackCount || 0, allItems.length || 0);

  if(signal.exhausted && total > 0){
    authoritativeServerTotalItems = Math.max(total, floorCount);
  }else{
    authoritativeServerTotalItems = Math.max(authoritativeServerTotalItems || 0, total || 0, floorCount || 0);
  }

  const minPages = signal.exhausted
    ? Math.max(1, preloadPageCountFromItems(allItems))
    : Math.max(INITIAL_PROGRESSIVE_PAGER_PAGES, preloadPageCountFromItems(allItems));
  const wantedPages = Math.max(minPages, Math.ceil((authoritativeServerTotalItems || floorCount || 0) / PAGE_SIZE));
  const previousPages = Math.max(progressivePagerPages || 0, Math.ceil((serverTotalItems || 0) / PAGE_SIZE));
  const nextPages = signal.exhausted
    ? Math.min(MAX_PROGRESSIVE_PAGER_PAGES, wantedPages)
    : (opts && opts.expandAll
      ? Math.min(MAX_PROGRESSIVE_PAGER_PAGES, wantedPages)
      : Math.min(MAX_PROGRESSIVE_PAGER_PAGES, Math.max(minPages, previousPages, Math.min(wantedPages, previousPages + 8 || minPages))));
  progressivePagerPages = Math.max(minPages, nextPages);
  serverTotalItems = signal.exhausted
    ? Math.max(floorCount, Math.min(authoritativeServerTotalItems || 0, progressivePagerPages * PAGE_SIZE))
    : Math.max(serverTotalItems || 0, Math.min(authoritativeServerTotalItems || 0, progressivePagerPages * PAGE_SIZE));
  return serverTotalItems;
}

function stopContinuousIntake(){
  continuousIntakeSeq += 1;
  continuousIntakeActive = false;
}

function sleepIntake(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startContinuousIntake(q, type, seq){
  if(!q || runSearch._seq !== seq) return;
  const token = ++continuousIntakeSeq;
  continuousIntakeActive = true;
  const target = adaptiveSearchTarget(q, type);
  authoritativeServerTotalItems = Math.max(authoritativeServerTotalItems || 0, target);
  updateProgressiveTotalFromPayload(lastSearchPayload || {}, Math.max(target, allItems.length || 0));

  let nextPage = Math.max(2, preloadPageCountFromItems(allItems) + 1);
  const maxPages = Math.min(MAX_PROGRESSIVE_PAGER_PAGES, Math.max(INITIAL_PROGRESSIVE_PAGER_PAGES, Math.ceil(target / PAGE_SIZE)));
  const retryPages = [];
  const retryCounts = new Map();

  function takeNextIntakePage(){
    while(retryPages.length){
      const p = retryPages.shift();
      if(p && !loadedServerPages.has(p)) return p;
    }
    while(nextPage <= maxPages){
      const p = nextPage++;
      if(p && !loadedServerPages.has(p)) return p;
    }
    return 0;
  }

  async function worker(){
    while(continuousIntakeActive && continuousIntakeSeq === token && runSearch._seq === seq){
      const page = takeNextIntakePage();
      if(!page) break;
      try{
        const pack = await fetchSearch(q, type, page);
        if(!continuousIntakeActive || continuousIntakeSeq !== token || runSearch._seq !== seq) return;
        const pageSlice = dedupeItems(filterSearchResultItems(pageItemsFromPack(pack))).slice(0, PAGE_SIZE);
        if(pageSlice.length){
          loadedServerPages.set(page, pageSlice);
          retryCounts.delete(page);
          allItems = mergeItemsPreferDisplayRichness(allItems, pageSlice).slice(0, MAX_SMOOTH_CANDIDATES);
          lastSearchPayload = pack && pack.payload || lastSearchPayload;
          updateProgressiveTotalFromPayload(pack && pack.payload, Math.max(target, allItems.length));
          if(page === currentPage) renderPage(page, true);
          else drawPager();
          status.textContent = statusResultsText(actualResultCountForStatus(), q, type, true);
        }else{
          const signal = supplySignalFromPayload(pack && pack.payload, 0);
          if(signal.exhausted){
            retryCounts.delete(page);
          }else if(allItems.length < target){
            const tried = retryCounts.get(page) || 0;
            if(tried < 3){
              retryCounts.set(page, tried + 1);
              retryPages.push(page);
            }
          }
        }
      }catch(e){
        const tried = retryCounts.get(page) || 0;
        if(tried < 3 && allItems.length < target){
          retryCounts.set(page, tried + 1);
          retryPages.push(page);
        }
        console.warn('continuous intake page skipped:', page, e);
      }
      await sleepIntake(INTAKE_BURST_DELAY_MS);
    }
    if(continuousIntakeActive && continuousIntakeSeq === token && runSearch._seq === seq){
      drawPager();
      if(allItems.length >= Math.min(target, MAX_SMOOTH_CANDIDATES)) {
        status.textContent = statusResultsText(actualResultCountForStatus(), q, type);
      }
    }
  }

  for(let i = 0; i < INTAKE_CONCURRENCY; i++) worker();
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

function searchDisplayKeyForItem(it){
  if(!it) return '';
  const rawUrl = String(it.url || it.link || it.openUrl || '').trim();
  const normUrl = rawUrl.toLowerCase();
  const isPlaceholderUrl =
    !rawUrl ||
    rawUrl === '#' ||
    rawUrl === '/' ||
    normUrl === 'javascript:void(0)' ||
    normUrl.startsWith('javascript:');

  if(!isPlaceholderUrl) return normUrl;
  return String(
    it.id || it.indexId || it.originalId ||
    ((String(it.title || it.name || '').trim()) + '|' + String((it.source && (it.source.name || it.source.platform)) || it.source || it.provider || '').trim())
  ).toLowerCase();
}

function displayRichnessScore(it){
  if(!it || typeof it !== 'object') return 0;
  let score = 0;
  const card = (it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
  const media = (it.media && typeof it.media === 'object') ? it.media : {};
  const preview = (media.preview && typeof media.preview === 'object') ? media.preview : {};
  const summaryText = [
    card.summary, card.description, card.body, card.text,
    it.displaySummary, it.summary, it.snippet, it.description, it.contentSnippet,
    it.excerpt, it.abstract, it.text, it.content, it.metaDescription, it.ogDescription
  ].map(v => String(v || '').trim()).filter(Boolean).join(' ');
  if(summaryText.length >= 18) score += Math.min(40, Math.floor(summaryText.length / 12));
  if(card && Object.keys(card).length) score += 18;
  if(card.showMapPreview || it.__maruAllowMapPreview || it.mapQuery || it.placeInfo) score += 20;
  if(card.thumbnail || card.image || (Array.isArray(card.imageSet) && card.imageSet.length)) score += 25;
  if(it.thumbnail || it.thumb || it.image || it.ogImage || it.og_image || (Array.isArray(it.imageSet) && it.imageSet.length)) score += 20;
  if(preview.thumbnail || preview.image || preview.poster || preview.mp4 || preview.webm) score += 18;
  if(it.videoId || it.videoUrl || it.embedUrl || /youtube|youtu\.be|ytimg/i.test(String([it.url, it.link, it.thumbnail, it.image].join(' ')))) score += 14;
  return score;
}

function mergeItemsPreferDisplayRichness(baseItems, incomingItems){
  const out = [];
  const pos = new Map();
  function addOrMerge(it){
    if(!it) return;
    const key = searchDisplayKeyForItem(it);
    if(!key) return;
    if(!pos.has(key)){
      pos.set(key, out.length);
      out.push(it);
      return;
    }
    const idx = pos.get(key);
    const prev = out[idx];
    const merged = Object.assign({}, prev || {}, it || {});
    const prevScore = displayRichnessScore(prev);
    const nextScore = displayRichnessScore(it);
    out[idx] = nextScore >= prevScore ? merged : Object.assign({}, it || {}, prev || {});
  }
  (Array.isArray(baseItems) ? baseItems : []).forEach(addOrMerge);
  (Array.isArray(incomingItems) ? incomingItems : []).forEach(addOrMerge);
  return out;
}

async function fetchSearch(q, type = activeType, page = 1){
  const safeType = normalizeSearchType(type);
  signalSanmaruSearch(q, safeType, 'maru-search-fetch');

  const sp = new URLSearchParams();
  sp.set('q', q);
  sp.set('limit', String(adaptiveSearchTarget(q, safeType)));
  sp.set('type', safeType);
  sp.set('tab', safeType);
  sp.set('perPage', String(PAGE_SIZE));
  sp.set('visibleCardsPerPage', String(PAGE_SIZE));
  sp.set('page', String(Math.max(1, Number(page) || 1)));
  sp.set('visiblePage', String(Math.max(1, Number(page) || 1)));
  sp.set('pageWindowOnly', '1');
  sp.set('residentFirst', '1');
  sp.set('sanmaruFirst', '1');
  sp.set('routeOwner', 'sanmaru');
  sp.set('naturalFlow', '1');
  sp.set('smoothIntake', '1');
  sp.set('noBlockingWide', '1');
  sp.set('residentSwitch', '1');
  sp.set('activateResident', '1');
  sp.set('handoff', isSearchPage ? 'search-html' : 'home');
  const url = `/.netlify/functions/maru-search?${sp.toString()}`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { items: [], payload: null, pageItems: [], viewportSections: [] };

    const json = await r.json();
    if (!json) return { items: [], payload: null, pageItems: [], viewportSections: [] };
    if (json.status === 'error') return { items: [], payload: json, pageItems: [], viewportSections: [] };
    if (json.status === 'blocked') return { items: [], payload: json, pageItems: [], viewportSections: [] };

    return normalizeSearchPayload(json);
  } catch (e) {
    console.error('fetchSearch failed:', e);
    return { items: [], payload: null, pageItems: [], viewportSections: [] };
  }
}

async function fetchInstantSearchPack(q, type = activeType){
  const safeType = normalizeSearchType(type);
  const sp = new URLSearchParams();
  sp.set('action', 'instant-supply');
  sp.set('q', q);
  sp.set('query', q);
  sp.set('type', safeType);
  sp.set('tab', safeType);
  sp.set('limit', String(adaptiveSearchTarget(q, safeType)));
  sp.set('firstPaintLimit', String(INITIAL_PRELOAD_TARGET));
  sp.set('candidatePool', String(adaptiveSearchTarget(q, safeType)));
  sp.set('candidatePoolTarget', String(adaptiveSearchTarget(q, safeType)));
  sp.set('initialPreloadPages', String(INITIAL_PRELOAD_PAGES));
  sp.set('initialPreloadTarget', String(INITIAL_PRELOAD_TARGET));
  sp.set('perPage', String(PAGE_SIZE));
  sp.set('visibleCardsPerPage', String(PAGE_SIZE));
  sp.set('providerPassthrough', '1');
  sp.set('residentFirst', '1');
  sp.set('sanmaruFirst', '1');
  sp.set('reason', 'search-ui-first-paint');

  try {
    const r = await fetch(`${SANMARU_BOOT_URL}?${sp.toString()}`, { cache: 'no-store' });
    if (!r.ok) return { items: [], payload: null, pageItems: [], viewportSections: [] };
    const json = await r.json();
    if (!json || json.status === 'error' || json.status === 'blocked') return { items: [], payload: json || null, pageItems: [], viewportSections: [] };
    return normalizeSearchPayload(json);
  } catch (e) {
    console.warn('fetchInstantSearchPack failed:', e);
    return { items: [], payload: null, pageItems: [], viewportSections: [] };
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




    function isLikelySearchInputElement(el){
      if(!el || !el.tagName || String(el.tagName).toLowerCase() !== 'input') return false;
      const id = String(el.id || '').toLowerCase();
      const name = String(el.name || '').toLowerCase();
      const cls = String(el.className || '').toLowerCase();
      const ph = String(el.getAttribute('placeholder') || '').toLowerCase();
      const role = String(el.getAttribute('role') || '').toLowerCase();
      const type = String(el.type || '').toLowerCase();
      return el === input || id.includes('search') || name.includes('search') || cls.includes('search') || ph.includes('검색') || ph.includes('search') || role === 'searchbox' || type === 'search';
    }

    function runGlobalSearch(){
      const anchor = activeSuggestInput || input;
      const q = (anchor && anchor.value ? anchor.value : input.value || '').trim();
      if(!q) return;
      if(anchor && anchor !== input) input.value = q;
      if(isSearchPage){
        const nextType = 'all';
        activeType = nextType;
        updateSearchTabsActive();
        const u = new URL(location.href);
        u.searchParams.set('q', q);
        u.searchParams.set('page', '1');
        u.searchParams.set('block', '0');
        u.searchParams.delete('type');
        u.searchParams.set('residentFirst', '1');
        u.searchParams.set('sanmaruFirst', '1');
        u.searchParams.set('residentSwitch', '1');
        const safeReturnUrl = getSafeReturnUrl();
        if(safeReturnUrl) u.searchParams.set('from', safeReturnUrl);
        history.pushState({ q, type: nextType, from: safeReturnUrl || '' }, '', u.toString());
        runSearch(q, nextType);
      } else {
        try { window.top.location.href = buildSearchUrl(q); } catch(e) { window.location.assign(buildSearchUrl(q)); }
      }
    }

    function ensureRelatedSearchSuggestStyle(){
      if(document.getElementById('maru-related-search-style')) return;
      const style = document.createElement('style');
      style.id = 'maru-related-search-style';
      style.textContent = `
        #maru-related-suggest-box {
          position: fixed;
          z-index: 9999;
          display: none;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16);
          padding: 8px;
          max-height: 420px;
          overflow-y: auto;
        }
        #maru-related-suggest-box[data-open="1"] { display: block; }
        .maru-related-suggest-row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 12px;
          border: 0;
          border-radius: 10px;
          background: transparent;
          color: #111827;
          cursor: pointer;
          text-align: left;
          font-size: 14px;
          font-weight: 700;
        }
        .maru-related-suggest-row:hover,
        .maru-related-suggest-row:focus { background: #f3f4f6; outline: none; }
        .maru-related-suggest-icon {
          flex: 0 0 auto;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 13px;
        }
        .maru-related-suggest-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .maru-related-suggest-caption {
          padding: 7px 12px 5px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }
      `;
      document.head.appendChild(style);
    }

    function ensureRelatedSuggestBox(){
      ensureRelatedSearchSuggestStyle();
      let box = document.getElementById('maru-related-suggest-box');
      if(box) return box;
      box = document.createElement('div');
      box.id = 'maru-related-suggest-box';
      box.setAttribute('role', 'listbox');
      document.body.appendChild(box);
      return box;
    }

    let activeSuggestInput = input;

    function positionRelatedSuggestBox(targetInput){
      const box = ensureRelatedSuggestBox();
      const anchor = targetInput || activeSuggestInput || input;
      if(!anchor || !box) return;
      const r = anchor.getBoundingClientRect();
      box.style.left = Math.max(8, r.left) + 'px';
      box.style.top = (r.bottom + 6) + 'px';
      box.style.width = Math.max(280, r.width) + 'px';
    }

    function relatedSearchTermsFor(q){
      const base = String(q || '').trim().replace(/\s+/g, ' ');
      if(!base) return [];
      const lower = base.toLowerCase();
      const broadPlace = /서울|부산|대구|인천|광주|대전|울산|제주|대한민국|한국|뉴욕|도쿄|오사카|파리|런던|베트남|하노이|호치민|seoul|busan|korea|new york|tokyo|paris|london|vietnam/.test(lower);
      const foodOrLocal = /카페|맛집|식당|시장|호텔|숙소|관광|여행|축제|공원|박물관|cafe|restaurant|hotel|market|travel|tour/.test(lower);
      const mediaIntent = /영상|영화|드라마|음악|유튜브|쇼츠|sns|video|movie|youtube|shorts/.test(lower);
      let suffixes;
      if(mediaIntent){
        suffixes = ['유튜브', '쇼츠', '영상', '뉴스', '인스타그램', '틱톡', '블로그', '이미지', '리뷰', '추천'];
      }else if(foodOrLocal || broadPlace){
        suffixes = ['지도', '날씨', '맛집', '카페', '볼만한 곳', '관광', '여행 코스', '축제', '호텔', '교통', '뉴스', '블로그', '유튜브', '이미지'];
      }else{
        suffixes = ['뜻', '뉴스', '이미지', '영상', '블로그', '리뷰', '가격', '방법', '추천', '비교', '공식', '위키'];
      }
      const out = [];
      const seen = new Set();
      suffixes.forEach(s => {
        const term = `${base} ${s}`.trim();
        const key = term.toLowerCase();
        if(key !== lower && !seen.has(key)){
          seen.add(key); out.push(term);
        }
      });
      return out.slice(0, 12);
    }

    function hideRelatedSuggestBox(){
      const box = document.getElementById('maru-related-suggest-box');
      if(box) box.dataset.open = '0';
    }

    function showRelatedSuggestBox(targetInput){
      const anchor = targetInput || activeSuggestInput || input;
      activeSuggestInput = anchor || input;
      const q = anchor ? anchor.value.trim() : '';
      const terms = relatedSearchTermsFor(q);
      const box = ensureRelatedSuggestBox();
      if(!q || !terms.length){ hideRelatedSuggestBox(); return; }
      box.innerHTML = '';
      const cap = document.createElement('div');
      cap.className = 'maru-related-suggest-caption';
      cap.textContent = uiText('relatedSearch', 'Related searches');
      box.appendChild(cap);
      terms.forEach(term => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'maru-related-suggest-row';
        row.setAttribute('role', 'option');
        const icon = document.createElement('span');
        icon.className = 'maru-related-suggest-icon';
        icon.textContent = '⌕';
        const text = document.createElement('span');
        text.className = 'maru-related-suggest-text';
        text.textContent = term;
        row.appendChild(icon);
        row.appendChild(text);
        row.addEventListener('mousedown', e => e.preventDefault());
        row.addEventListener('click', () => {
          const anchor = activeSuggestInput || input;
          if(anchor) anchor.value = term;
          if(anchor && anchor !== input) input.value = term;
          hideRelatedSuggestBox();
          runGlobalSearch();
        });
        box.appendChild(row);
      });
      positionRelatedSuggestBox(anchor);
      box.dataset.open = '1';
    }

    function bindRelatedSearchSuggest(){
      const selector = [
        '#searchInput',
        '#globalSearchInput',
        '#homeSearchInput',
        '#mainSearchInput',
        '#heroSearchInput',
        'input[type="search"]',
        'input[data-search-input]',
        'input[name*="search" i]',
        'input[id*="search" i]',
        'input[class*="search" i]',
        'input[placeholder*="검색" i]',
        'input[placeholder*="search" i]'
      ].join(',');

      const targets = Array.from(new Set([input].concat(Array.from(document.querySelectorAll(selector))).filter(Boolean)))
        .filter(isLikelySearchInputElement);

      targets.forEach(target => {
        if(target.__maruRelatedSuggestBound) return;
        target.__maruRelatedSuggestBound = true;
        target.addEventListener('input', () => { activeSuggestInput = target; showRelatedSuggestBox(target); });
        target.addEventListener('focus', () => { activeSuggestInput = target; showRelatedSuggestBox(target); });
        target.addEventListener('blur', () => setTimeout(hideRelatedSuggestBox, 160));
        target.addEventListener('keydown', e => {
          if(e.key === 'Escape') hideRelatedSuggestBox();
          if(e.key === 'Enter') {
            activeSuggestInput = target;
            hideRelatedSuggestBox();
          }
        });
      });

      if(!bindRelatedSearchSuggest.__windowBound){
        bindRelatedSearchSuggest.__windowBound = true;
        window.addEventListener('resize', () => positionRelatedSuggestBox(activeSuggestInput));
        window.addEventListener('scroll', () => positionRelatedSuggestBox(activeSuggestInput), true);
        document.addEventListener('input', e => {
          const target = e.target;
          if(!isLikelySearchInputElement(target)) return;
          activeSuggestInput = target;
          showRelatedSuggestBox(target);
        }, true);
        document.addEventListener('focusin', e => {
          const target = e.target;
          if(!isLikelySearchInputElement(target)) return;
          activeSuggestInput = target;
          showRelatedSuggestBox(target);
          bindRelatedSearchSuggest();
        });
        try {
          const mo = new MutationObserver(() => bindRelatedSearchSuggest());
          mo.observe(document.body, { childList: true, subtree: true });
        } catch(e) {}
        setTimeout(bindRelatedSearchSuggest, 500);
        setTimeout(bindRelatedSearchSuggest, 1500);
      }
    }

    function buildSearchTabButton(type, label){
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
      return b;
    }

    function renderSearchTabsForQuery(bar, qOverride){
      if(!bar) return;
      const q = queryTextForTabs(qOverride);
      const key = searchTabsProfileKey(q, activeType);
      if(bar.dataset.profileKey === key && bar.childNodes.length) return;
      bar.dataset.profileKey = key;
      bar.innerHTML = '';
      inferSearchTabsForQuery(q, activeType).forEach(([type, label]) => {
        bar.appendChild(buildSearchTabButton(type, label));
      });
    }

    function ensureSearchTabs(qOverride){
      if (!isSearchPage) return null;
      let bar = document.getElementById('maru-search-tabs');
      if (!bar){
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
        status.parentNode.insertBefore(bar, status);
      }
      renderSearchTabsForQuery(bar, qOverride);
      return bar;
    }

    function updateSearchTabsActive(qOverride){
      const bar = ensureSearchTabs(qOverride);
      if (!bar) return;
      renderSearchTabsForQuery(bar, qOverride);
      const type = normalizeSearchType(activeType);
      Array.from(bar.querySelectorAll('button[data-type]')).forEach(btn => {
        const on = btn.dataset.type === type;
        btn.style.background = on ? '#4f46e5' : '#f8fafc';
        btn.style.color = on ? '#fff' : '#111827';
        btn.style.borderColor = on ? '#4f46e5' : '#e5e7eb';
      });
    }

    function switchSearchType(type){
      const nextType = normalizeSearchType(type);
      activeType = nextType;
      updateSearchTabsActive();

      const q = input.value.trim() || (new URLSearchParams(location.search).get('q') || '').trim();
      if (!q) return;

      currentPage = 1;
      currentBlock = 0;

      const u = new URL(location.href);
      u.searchParams.set('q', q);
      u.searchParams.set('page', '1');
      u.searchParams.set('block', '0');
      if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
      else u.searchParams.delete('type');

      history.pushState({ q, type: activeType, page: 1, block: 0 }, '', u.toString());

      // Top category tabs are views over the current received search pool.
      // They must not restart Sanmaru/MaruSearch from zero. The all search
      // keeps receiving in the background; this view re-renders from allItems.
      if (Array.isArray(allItems) && allItems.length) {
        renderPage(1, true);
        status.textContent = statusResultsText(actualResultCountForStatus(), q, activeType, continuousIntakeActive);
        return;
      }

      // If the user opened /search.html?type=... directly before any pool exists,
      // fall back to the normal search path once.
      runSearch(q, activeType);
    }

    function clearPager(){
      const bar = document.getElementById('maru-page-controls');
      if (bar) bar.remove();
    }

    function ensureStatusPagerRow(){
      if(!statusEl || !statusEl.parentNode) return null;
      let row = document.getElementById('maru-search-status-pager-row');
      if(!row){
        row = document.createElement('div');
        row.id = 'maru-search-status-pager-row';
        statusEl.parentNode.insertBefore(row, statusEl);
        row.appendChild(statusEl);
      }else if(statusEl.parentNode !== row){
        row.insertBefore(statusEl, row.firstChild || null);
      }

      // Google/Naver-like compact fixed search control line:
      // status text stays on the left, the pager is visually centered, and
      // the whole line remains sticky together with the search category tabs.
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'minmax(180px, 1fr) auto minmax(180px, 1fr)';
      row.style.alignItems = 'center';
      row.style.columnGap = '12px';
      row.style.padding = '4px 24px';
      row.style.minHeight = '34px';
      row.style.borderBottom = '1px solid #f1f5f9';
      row.style.background = '#fff';
      row.style.position = 'sticky';
      row.style.top = '116px';
      row.style.zIndex = '88';
      row.style.boxShadow = '0 1px 0 rgba(15,23,42,.03)';

      statusEl.style.gridColumn = '1';
      statusEl.style.minWidth = '0';
      statusEl.style.margin = '0';
      statusEl.style.padding = '0';
      statusEl.style.whiteSpace = 'nowrap';
      statusEl.style.overflow = 'hidden';
      statusEl.style.textOverflow = 'ellipsis';
      statusEl.style.fontSize = '12px';
      statusEl.style.lineHeight = '1.2';
      return row;
    }

    function ensurePager(){
      let bar = document.getElementById('maru-page-controls');
      if (!bar){
        bar = document.createElement('div');
        bar.id = 'maru-page-controls';
        const row = ensureStatusPagerRow();
        if(row) row.appendChild(bar);
        else status.parentNode.insertBefore(bar, status.nextSibling);
      }else{
        const row = ensureStatusPagerRow();
        if(row && bar.parentNode !== row) row.appendChild(bar);
      }
      bar.style.gridColumn = '2';
      bar.style.display = 'flex';
      bar.style.alignItems = 'center';
      bar.style.justifyContent = 'center';
      bar.style.gap = '4px';
      bar.style.margin = '0 auto';
      bar.style.padding = '0';
      bar.style.flex = '0 0 auto';
      bar.style.whiteSpace = 'nowrap';
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
        'captcha',
        'staticmap',
        'maps.googleapis.com',
        'map.naver.com',
        'naver_map',
        '/maps/',
        '/map/',
        'map_tile',
        'tile.openstreetmap',
        'banner',
        'placard',
        'adserver',
        'doubleclick',
        'advertisement',
        'promo-banner'
      ];

      if(hardBad.some(k => s.includes(k))) return true;
      if(/\.(ico)(\?|#|$)/i.test(s)) return true;
      if(/\.(svg)(\?|#|$)/i.test(s) && /(logo|symbol|icon|emblem|brand|ci|bi)/i.test(s)) return true;

      // Brand/logo images must not be promoted as large media snapshots.
      // Keep the small favicon in the link row, but reject logos from card media.
      const logoLike = /(^|[\/_\-.])(logo|logotype|brand|symbol|emblem|ci|bi)([\/_\-.]|$)/i.test(s) ||
        /(naver|google|youtube|tiktok|facebook|instagram|twitter|x)[^?#]*(logo|brand|symbol|favicon)/i.test(s);
      if(logoLike) return true;

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

    function isMapImageUrlClient(imageUrl){
      const s = String(imageUrl || '').toLowerCase();
      return /staticmap|maps\.googleapis|google\.com\/maps|map\.naver\.com|naver_map|\/maps\/|\/map\/|map_tile|tile\.openstreetmap/.test(s);
    }

    function isProviderLogoOrBannerImageClient(imageUrl, it){
      const s = String(imageUrl || '').toLowerCase();
      const host = (() => { try { return new URL(s, location.origin).hostname.toLowerCase(); } catch(e){ return ''; } })();
      const titleSummary = String([it && it.title, it && it.summary, it && it.description, it && it.alt, it && it.caption].filter(Boolean).join(' ')).toLowerCase();
      if(/google\.com\/s2\/favicons|favicon|apple-touch-icon|logo|logotype|brandmark|symbol|emblem|\/ci[\/_-]|\/bi[\/_-]/i.test(s)) return true;
      if(/(naver|google|youtube|facebook|instagram|tiktok|twitter|x)[^?#]*(logo|favicon|brand|symbol|icon)/i.test(s)) return true;
      if(/banner|placard|adserver|doubleclick|advertisement|promo-banner|popup|slogan|billboard/i.test(s)) return true;
      if(/(로고|logo|ci|bi|심벌|심볼|슬로건|현수막|플래카드|플랜카드|배너|광고판|광고|banner|placard|slogan|billboard)/i.test(titleSummary)) return true;
      return false;
    }

    function isMeaningfulImageForItemClient(imageUrl, it){
      const s = String(imageUrl || '').trim();
      if(!s) return false;
      if(!/^https?:\/\//i.test(s) && !s.startsWith('/')) return false;
      if(isHardRejectImageUrlClient(s)) return false;
      if(isMapImageUrlClient(s)) return false;
      if(isProviderLogoOrBannerImageClient(s, it)) return false;
      return true;
    }


    function extractYouTubeIdQuickClient(v){
      const raw = String(v || '').trim();
      if (!raw) return '';
      const m =
        raw.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
        raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
        raw.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/) ||
        raw.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/) ||
        raw.match(/(?:i\.ytimg\.com|img\.youtube\.com)\/vi\/([A-Za-z0-9_-]{11})/);
      return m ? String(m[1] || '').trim() : '';
    }

    function isYoutubeLikeItemClient(it){
      const hay = [
        it && it.source,
        it && it.type,
        it && it.mediaType,
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.watchUrl,
        it && it.embedUrl,
        it && it.thumbnail,
        it && it.thumb,
        it && it.image,
        Array.isArray(it && it.imageSet) ? it.imageSet.join(' ') : ''
      ].join(' ').toLowerCase();
      return hay.includes('youtube') || hay.includes('youtu.be') || hay.includes('ytimg.com') || hay.includes('img.youtube.com');
    }

    function preferredYoutubeThumbClient(it){
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const candidates = [
        displayCard.videoId,
        displayCard.videoUrl,
        displayCard.watchUrl,
        displayCard.embedUrl,
        displayCard.thumbnail,
        displayCard.image,
        it && it.videoId,
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.watchUrl,
        it && it.embedUrl,
        it && it.thumbnail,
        it && it.thumb,
        it && it.image
      ]
        .concat(Array.isArray(displayCard.imageSet) ? displayCard.imageSet : [])
        .concat(Array.isArray(it && it.imageSet) ? it.imageSet : []);

      for (const v of candidates) {
        const id = String(v || '').length === 11 && /^[A-Za-z0-9_-]{11}$/.test(String(v || ''))
          ? String(v)
          : extractYouTubeIdQuickClient(v);
        if (id) return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
      }
      return '';
    }

    function collectNaturalImages(it){
      const sourceText = String((it && it.source) || '').toLowerCase();
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const data = (it && it.data && typeof it.data === 'object') ? it.data : {};
      const media = (it && it.media && typeof it.media === 'object') ? it.media : {};
      const preview = (media && media.preview && typeof media.preview === 'object') ? media.preview : {};

      const raw = []
        .concat(displayCard.thumbnail ? [displayCard.thumbnail] : [])
        .concat(displayCard.image ? [displayCard.image] : [])
        .concat(Array.isArray(displayCard.imageSet) ? displayCard.imageSet : [])
        .concat(displayCard.preview && displayCard.preview.thumbnail ? [displayCard.preview.thumbnail] : [])
        .concat(displayCard.preview && displayCard.preview.image ? [displayCard.preview.image] : [])
        .concat(it && it.thumbnail ? [it.thumbnail] : [])
        .concat(it && it.thumb ? [it.thumb] : [])
        .concat(it && it.image ? [it.image] : [])
        .concat(it && it.poster ? [it.poster] : [])
        .concat(it && it.cover ? [it.cover] : [])
        .concat(it && it.og_image ? [it.og_image] : [])
        .concat(it && it.ogImage ? [it.ogImage] : [])
        .concat(payload.thumbnail ? [payload.thumbnail] : [])
        .concat(payload.thumb ? [payload.thumb] : [])
        .concat(payload.image ? [payload.image] : [])
        .concat(payload.image_url ? [payload.image_url] : [])
        .concat(payload.og_image ? [payload.og_image] : [])
        .concat(payload.ogImage ? [payload.ogImage] : [])
        .concat(payload.poster ? [payload.poster] : [])
        .concat(payload.cover ? [payload.cover] : [])
        .concat(data.thumbnail ? [data.thumbnail] : [])
        .concat(data.thumb ? [data.thumb] : [])
        .concat(data.image ? [data.image] : [])
        .concat(data.og_image ? [data.og_image] : [])
        .concat(data.poster ? [data.poster] : [])
        .concat(preview.poster ? [preview.poster] : [])
        .concat(preview.thumbnail ? [preview.thumbnail] : [])
        .concat(preview.image ? [preview.image] : [])
        .concat(Array.isArray(it && it.imageSet) ? it.imageSet : [])
        .concat(Array.isArray(payload.imageSet) ? payload.imageSet : [])
        .concat(Array.isArray(data.imageSet) ? data.imageSet : []);

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

        // Provider logos and brand icons are source markers, not thumbnails.
        // They must never be promoted into the visual card area.
        const providerLogoLike = /(google|naver|youtube|facebook|instagram|tiktok|twitter|x)[^?#]*(logo|favicon|brand|symbol|icon)/i.test(low) ||
          /(logo|favicon|brandmark|symbol|emblem|ci|bi)[^?#]*\.(png|jpg|jpeg|webp|svg)(\?|#|$)/i.test(low);
        if (providerLogoLike) return;

        let key = s.split('#')[0].toLowerCase();
        try {
          const u = new URL(s, location.origin);
          key = (u.origin + u.pathname).toLowerCase();
        } catch(e) {}

        if (seen.has(key)) return;

        seen.add(key);
        out.push(s);
      });

      // YouTube result cards should expose a representative thumbnail when a
      // full player is not appropriate or when the provider did not include an image.
      if (isYoutubeLikeItemClient(it)) {
        const best = preferredYoutubeThumbClient(it) || out[0] || '';
        return best ? [best] : [];
      }

      // Naver image API item is one image result; thumbnail/original often look duplicated.
      if (sourceText.includes('naver_image') && out.length > 1) {
        return dedupeImageVariantsClient(out).slice(0, 1);
      }

      return dedupeImageVariantsClient(out).slice(0, 3);
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
        mediaType === 'video' ||
        type === 'video' ||
        source.includes('youtube') ||
        source.includes('video') ||
        isYoutubeLikeItemClient(it) ||
        text.includes('영상') ||
        text.includes('동영상') ||
        text.includes('유튜브')
      ) {
        return 'video';
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


    function normalizeDisplayGroupClient(group){
      const raw = String(group || '').trim();
      const map = {
        official_authority: 'authority',
        official: 'authority',
        gov: 'authority',
        government: 'authority',
        public: 'public_data',
        public_data: 'public_data',
        opendata: 'public_data',
        open_data: 'public_data',
        knowledge_wiki: 'knowledge',
        wiki: 'wiki',
        encyclopedia: 'knowledge',
        academic: 'academic',
        scholar: 'academic',
        research: 'academic',
        paper: 'academic',
        map_local_tour: 'local_tour',
        local: 'local_tour',
        map: 'local_tour',
        tour: 'local_tour',
        video_vlog: 'video',
        video: 'video',
        youtube: 'video',
        image_gallery: 'image',
        image: 'image',
        photo: 'image',
        blog_review: 'blog',
        blog: 'blog',
        cafe: 'cafe',
        forum: 'community',
        community: 'community',
        community_sns: 'social',
        sns: 'social',
        social: 'social',
        shopping_product: 'shopping',
        shopping: 'shopping',
        commerce: 'shopping',
        product: 'shopping',
        sports: 'sports',
        finance: 'finance',
        stock: 'finance',
        webtoon: 'webtoon',
        company_web: 'site',
        corporate_homepage: 'site',
        business_site: 'site',
        official_site: 'site',
        homepage: 'site',
        website: 'site',
        site: 'site',
        company: 'site',
        corporate: 'site',
        business: 'site',
        general_web: 'web'
      };
      return map[raw] || raw;
    }

    
    function isNewsLikeItemClient(it){
      if(!it || typeof it !== 'object') return false;
      const sourceObj = it.source && typeof it.source === 'object' ? it.source : null;
      const source = String(sourceObj ? (sourceObj.name || sourceObj.provider || sourceObj.platform || '') : (it.source || '')).toLowerCase();
      const provider = String(it.provider || it.channel || (sourceObj && (sourceObj.provider || sourceObj.platform)) || '').toLowerCase();
      const type = String(it.type || '').toLowerCase();
      const category = String(it.category || '').toLowerCase();
      const title = String(it.title || '').toLowerCase();
      const summary = String(it.summary || it.snippet || it.description || it.contentSnippet || it.excerpt || '').toLowerCase();
      const url = String(it.url || it.link || it.originallink || it.originalLink || '').toLowerCase();
      const host = domainOf(url).toLowerCase();
      const text = `${source} ${provider} ${type} ${category} ${title} ${summary} ${host} ${url}`;
      if(type === 'news' || category === 'news' || source.includes('news') || provider.includes('news')) return true;
      if(/(뉴스|신문|일보|기사|보도|언론|속보|취재|기자|news|press|journal|daily|times|herald|tribune)/i.test(text)) return true;
      if(/(^|\.)(ohmynews\.com|hani\.co\.kr|chosun\.com|joongang\.co\.kr|donga\.com|khan\.co\.kr|mk\.co\.kr|hankyung\.com|sedaily\.com|seoul\.co\.kr|yna\.co\.kr|ytn\.co\.kr|sbs\.co\.kr|kbs\.co\.kr|jtbc\.co\.kr|ichannela\.com|mbn\.co\.kr|tvchosun\.com|news\.|press\.)/i.test(host)) return true;
      return false;
    }

function displayGroupOfItem(it){
      const rawGroup = String((it && (it.displayGroup || it.displayGroupLabel || it.group)) || '').trim();
      const normalized = normalizeDisplayGroupClient(rawGroup);
      const inferred = inferDisplayGroupClient(it);
      // Server-side broad labels can occasionally mis-place news into map/local.
      // Keep the category rail intact, but never let news cards occupy 지도/지역.
      if(isNewsLikeItemClient(it) && !['video','image','social'].includes(inferred)) return 'news';

      // Keep server groups when they are already precise, but allow broad groups
      // such as web/media/knowledge/community to split into richer portal lanes.
      if(!rawGroup) return inferred;
      const broadGroups = new Set(['web','general_web','media','knowledge','community','social']);
      if(broadGroups.has(normalized) && inferred && inferred !== normalized && inferred !== 'web') return inferred;
      return normalized || inferred || 'web';
    }

    function isHomepageLikeUrlClient(url){
      try {
        const u = new URL(String(url || ''), location.origin);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        const path = String(u.pathname || '/').replace(/\/+$/,'/');
        const parts = path.split('/').filter(Boolean);
        if(!host || !/\./.test(host)) return false;
        if(parts.length === 0) return true;
        if(parts.length === 1 && /^(home|main|company|about|intro|kr|ko|en|index)$/i.test(parts[0])) return true;
        return false;
      } catch(e) { return false; }
    }

    function isKnownNonSiteHostClient(host){
      host = String(host || '').toLowerCase();
      return /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|x\.com|twitter\.com|naver\.com|daum\.net|google\.com|google\.co|bing\.com|wikipedia\.org|namu\.wiki)$/i.test(host) ||
        /(news|blog|cafe|shopping|shop|book|maps|map|finance|sports|webtoon)/i.test(host);
    }

    function isVisualSearchCandidateClient(it){
      it = it && typeof it === 'object' ? it : {};
      const sourceObj = it.source && typeof it.source === 'object' ? it.source : null;
      const source = String(sourceObj ? (sourceObj.name || sourceObj.provider || sourceObj.platform || '') : (it.source || '')).toLowerCase();
      const provider = String(it.provider || it.channel || (sourceObj && (sourceObj.provider || sourceObj.platform)) || '').toLowerCase();
      const type = String(it.type || '').toLowerCase();
      const category = String(it.category || '').toLowerCase();
      const mediaType = String(it.mediaType || '').toLowerCase();
      const title = String(it.title || it.name || '').toLowerCase();
      const summary = String(it.summary || it.snippet || it.description || it.contentSnippet || it.excerpt || it.abstract || '').toLowerCase();
      const url = String(it.url || it.link || it.openUrl || it.href || it.videoUrl || it.embedUrl || '').toLowerCase();
      const host = domainOf(url).toLowerCase();
      const text = `${source} ${provider} ${type} ${category} ${mediaType} ${title} ${summary} ${host} ${url}`;
      const naturalImages = collectNaturalImages(it);
      const explicitImage = mediaType === 'image' || type === 'image' || category === 'image' || source.includes('image') || naturalImages.length > 0;
      const visualTerms = /(사진|포토|풍경|전경|경관|갤러리|화보|스냅|홍보|관광|명소|랜드마크|야경|전망|브이로그|영상\s*소개|둘러보기|visual|photo|picture|scenery|landscape|gallery|promo|promotional|tourism|travel|landmark|night\s*view|view|vlog|video\s*guide)/i.test(text);
      const visualVideo = /(youtube|youtu\.be|video|영상|동영상|브이로그|vlog)/i.test(text) && /(홍보|관광|명소|풍경|전경|경관|소개|둘러보기|travel|tourism|landmark|scenery|landscape|guide|promo)/i.test(text);
      return explicitImage || visualVideo || visualTerms;
    }

    function inferDisplayGroupClient(it){
      if(isSyntheticProviderGuideCardClient(it)) return 'web';
      const source = String((it && it.source) || '').toLowerCase();
      const provider = String((it && (it.provider || it.channel)) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const category = String((it && it.category) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const summary = String((it && (it.summary || it.snippet || it.description || it.contentSnippet || it.excerpt || it.abstract)) || '').toLowerCase();
      const url = String((it && (it.url || it.link)) || '').toLowerCase();
      const host = domainOf(url).toLowerCase();
      const text = `${source} ${provider} ${type} ${category} ${mediaType} ${title} ${summary} ${host}`;

      if (/(shopping\.naver|shopping|coupang|gmarket|11st|auction|amazon|aliexpress|temu|shop|store|mall)/i.test(host + ' ' + url)) return 'shopping';
      if (/(sports\.naver|espn|fifa|kbo|kfa|nba|mlb|uefa|sports|score|league)/i.test(host + ' ' + url + ' ' + text)) return 'sports';
      if (/(finance\.naver|finance\.yahoo|investing|tradingview|marketwatch|bloomberg|reuters|stock|finance|securities|증권|주식|환율|코스피|나스닥)/i.test(host + ' ' + url + ' ' + text)) return 'finance';
      if (/(comic\.naver|webtoon|kakao.*webtoon|comic|manga|웹툰|만화)/i.test(host + ' ' + url + ' ' + text)) return 'webtoon';

      if (host.includes('.go.kr') || host.endsWith('.gov') || host.includes('.gov.') || host.includes('korea.kr')) return 'authority';
      if (source.includes('public') || provider.includes('public') || type === 'public_data' || category === 'public_data' || text.includes('공공데이터') || text.includes('공공 데이터') || text.includes('데이터포털') || text.includes('open data') || host.includes('data.go.kr')) return 'public_data';
      // Map/local classification must be narrow.  A broad query like "서울" often
      // contains words such as 관광/주소/위치 inside ordinary news/site snippets;
      // treating those as map items makes the whole result page fill with maps.
      // Only explicit map/local providers, map URLs, or clearly local/tour result
      // records should enter the map/tour lane.
      const explicitMapSignal = source.includes('local') || source.includes('map') || provider.includes('map') || provider.includes('local') ||
        type === 'map' || type === 'local' || mediaType === 'map' || category === 'map' || category === 'local';
      const mapUrlSignal = /google\.com\/maps|map\.naver\.com|maps\.apple\.com|kakaomap|map\.kakao|\/maps?(\/|\?|$)/i.test(url + ' ' + host);
      const tourHostSignal = /(visitseoul|tour|travel|tripadvisor|lonelyplanet|airbnb|booking|agoda|expedia|hotel)/i.test(host + ' ' + url);
      const titleLocalSignal = /(지도|길찾기|주소|위치|근처|맛집|호텔|숙소|관광|여행|명소|공원|landmark|tour|travel|place|hotel)/i.test(title);
      const nonLocalContent = /(뉴스|신문|일보|기사|보도|블로그|카페|위키|논문|쇼핑|상품|증권|주식|영상|동영상|photo|image|news|blog|wiki|shop|video)/i.test(source + ' ' + provider + ' ' + type + ' ' + category + ' ' + host);
      if (!isNewsLikeItemClient(it) && (explicitMapSignal || mapUrlSignal || tourHostSignal || (titleLocalSignal && !nonLocalContent))) return 'local_tour';
      if (host.includes('wikipedia.org') || host.includes('namu.wiki') || source.includes('wiki') || type === 'wiki' || text.includes('위키')) return 'wiki';
      if (source.includes('scholar') || source.includes('academic') || source.includes('paper') || source.includes('research') || source.includes('library') || type === 'academic' || type === 'paper' || type === 'research' || category === 'academic' || text.includes('학술') || text.includes('논문') || text.includes('연구') || text.includes('journal') || text.includes('citation') || text.includes('thesis') || host.includes('scholar.google') || host.includes('riss.kr') || host.includes('dbpia.co.kr') || host.includes('kci.go.kr')) return 'academic';
      if (source.includes('encyc') || source.includes('kin') || type === 'knowledge' || category === 'knowledge' || text.includes('지식') || text.includes('백과') || text.includes('사전')) return 'knowledge';
      if (source.includes('corporate') || source.includes('homepage') || source.includes('business') || source.includes('company') || type === 'site' || type === 'homepage' || type === 'business' || category === 'site' || text.includes('홈페이지') || text.includes('공식사이트') || text.includes('공식 사이트') || text.includes('기업') || text.includes('회사') || text.includes('business') || text.includes('company') || text.includes('corporate')) return 'site';
      if (isHomepageLikeUrlClient(url) && !isKnownNonSiteHostClient(host) && !source.includes('news')) return 'site';
      if (source.includes('book') || type === 'book' || category === 'book' || text.includes('도서') || text.includes('책 ') || text.includes('isbn') || host.includes('book.naver') || host.includes('books.google')) return 'book';
      if (source.includes('news') || type === 'news' || category === 'news' || text.includes('뉴스') || text.includes('속보') || text.includes('latest') || text.includes('breaking')) return 'news';
      if (source.includes('blog') || type === 'blog' || category === 'blog' || host.includes('blog.') || text.includes('블로그')) return 'blog';
      if (source.includes('cafe') || type === 'cafe' || category === 'cafe' || host.includes('cafe.') || text.includes('카페')) return 'cafe';
      if (source.includes('forum') || type === 'community' || category === 'community' || text.includes('커뮤니티') || text.includes('forum') || text.includes('게시판')) return 'community';
      if (source.includes('shopping') || source.includes('shop') || source.includes('commerce') || type === 'shopping' || type === 'product' || category === 'shopping' || text.includes('쇼핑') || text.includes('상품') || text.includes('구매') || text.includes('가격') || host.includes('shopping.')) return 'shopping';
      if (source.includes('sports') || type === 'sports' || category === 'sports' || text.includes('스포츠') || text.includes('축구') || text.includes('야구') || text.includes('농구') || text.includes('배구')) return 'sports';
      if (source.includes('finance') || type === 'finance' || category === 'finance' || text.includes('금융') || text.includes('증권') || text.includes('주식') || text.includes('환율') || text.includes('코스피') || text.includes('나스닥')) return 'finance';
      if (source.includes('webtoon') || type === 'webtoon' || category === 'webtoon' || text.includes('웹툰') || text.includes('만화') || text.includes('comic') || text.includes('manga')) return 'webtoon';
      if (isVisualSearchCandidateClient(it) && (mediaType === 'image' || type === 'image' || category === 'image' || source.includes('image') || text.includes('사진') || text.includes('풍경') || text.includes('홍보'))) return 'image';
      if (mediaType === 'video' || type === 'video' || category === 'video' || source.includes('youtube') || source.includes('video') || host.includes('youtube.com') || host.includes('youtu.be') || text.includes('영상') || text.includes('유튜브')) return 'video';
      if (isVisualSearchCandidateClient(it)) return 'image';
      if (host.includes('instagram.') || host.includes('facebook.') || host.includes('tiktok.') || host.includes('x.com') || host.includes('twitter.') || source.includes('sns') || source.includes('social') || type === 'sns' || category === 'sns') return 'social';
      return 'web';
    }

    function displayGroupLabel(group, sample){
      return groupLabel(group || 'web');
    }

    function displayGroupPreviewLimit(group, sample){
      const n = parseInt(sample && sample.displayGroupPreviewLimit, 10);
      if (n > 0) return n;

      const limits = {
        authority: 3,
        public_data: 2,
        local_tour: 2,
        knowledge: 3,
        wiki: 3,
        academic: 4,
        site: 5,
        book: 4,
        news: 5,
        blog: 5,
        cafe: 5,
        community: 5,
        image: 5,
        video: 5,
        media: 5,
        social: 4,
        shopping: 5,
        sports: 4,
        finance: 4,
        webtoon: 4,
        web: 18
      };
      return limits[group] || 6;
    }

    function shouldUseDisplayGroups(slice){
      if (!Array.isArray(slice) || !slice.length) return false;
      if (normalizeSearchType(activeType) !== 'all') return false;
      return slice.some(it => it && (it.displayGroup || it.displayGroupLabel));
    }

    function displayGroupOrderForCurrentSearch(){
      const q = queryTextForTabs(lastQuery || (input && input.value) || '');
      const intent = inferMaruSearchIntentProfile(q, allItems);
      const orders = {
        person:  ['authority','knowledge','wiki','news','video','image','media','social','blog','site','book','community','web','academic','public_data','local_tour','shopping','sports','finance','webtoon'],
        place:   ['authority','local_tour','knowledge','wiki','site','public_data','news','image','media','video','blog','social','community','web','book','academic','shopping','sports','finance','webtoon'],
        country: ['authority','local_tour','knowledge','wiki','site','public_data','news','image','media','video','blog','social','community','web','book','academic','shopping','sports','finance','webtoon'],
        company: ['authority','site','knowledge','wiki','news','finance','local_tour','image','media','video','blog','social','shopping','public_data','community','web','book','academic','sports','webtoon'],
        issue:   ['news','video','image','media','social','blog','community','site','knowledge','wiki','authority','public_data','web','local_tour','book','academic','shopping','sports','finance','webtoon'],
        product: ['shopping','site','image','media','video','blog','community','cafe','news','knowledge','wiki','authority','web','local_tour','book','public_data','academic','sports','finance','webtoon'],
        academic:['academic','knowledge','wiki','book','site','news','image','media','video','authority','public_data','web','blog','community','local_tour','shopping','sports','finance','webtoon'],
        book:    ['book','knowledge','wiki','site','blog','news','image','media','shopping','authority','web','video','social','community','local_tour','public_data','academic','sports','finance','webtoon'],
        finance: ['finance','news','site','knowledge','wiki','blog','image','media','video','authority','web','social','public_data','local_tour','book','academic','shopping','sports','webtoon'],
        sports:  ['sports','news','video','image','media','social','blog','site','knowledge','wiki','authority','web','community','local_tour','book','public_data','academic','shopping','finance','webtoon'],
        webtoon: ['webtoon','image','media','video','site','blog','social','shopping','news','knowledge','wiki','authority','web','community','local_tour','book','public_data','academic','sports','finance'],
        media:   ['video','image','media','news','social','blog','site','knowledge','wiki','authority','web','community','local_tour','book','public_data','academic','shopping','sports','finance','webtoon'],
        image:   ['image','media','video','site','news','blog','social','knowledge','wiki','authority','web','community','local_tour','book','public_data','academic','shopping','sports','finance','webtoon'],
        public:  ['public_data','authority','site','knowledge','wiki','news','local_tour','image','media','video','web','blog','community','book','academic','shopping','sports','finance','webtoon'],
        general: ['authority','knowledge','wiki','site','book','blog','cafe','community','shopping','news','image','media','video','social','public_data','academic','local_tour','sports','finance','webtoon','web']
      };
      const base = orders[intent] || orders.general;
      const full = ['authority','local_tour','knowledge','wiki','site','book','blog','cafe','shopping','news','image','video','media','social','public_data','academic','community','sports','finance','webtoon','web'];
      const out = [];
      const seen = new Set();
      base.concat(full).forEach(g => { if(g && !seen.has(g)){ seen.add(g); out.push(g); } });
      return out;
    }

    function groupSliceForDisplay(slice){
      const order = displayGroupOrderForCurrentSearch();
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

    function sourceKeyForDisplayGroupItem(it){
      const payload = it && it.payload && typeof it.payload === 'object' ? it.payload : {};
      const group = displayGroupOfItem(it);
      const newsOrigin = group === 'news' ? String(payload.originallink || payload.originalLink || it.originallink || it.originalLink || '').trim() : '';
      const url = String(newsOrigin || (it && (it.url || it.link || it.openUrl)) || '').trim();
      const host = domainOf(url).toLowerCase();
      const source = String((it && (it.source || it.provider || it.channel)) || '').toLowerCase();
      if(host) return host.replace(/^www\./, '');
      return source || String((it && it.title) || '').slice(0, 40).toLowerCase();
    }

    function diversifyGroupPreviewItems(group, items){
      const list = Array.isArray(items) ? items.slice() : [];
      if(!list.length) return list;
      const verticals = new Set(['news','blog','cafe','community','social','image','video','media']);
      if(!verticals.has(group)) return list;

      const firstBySource = [];
      const rest = [];
      const seen = new Set();
      list.forEach(it => {
        const key = sourceKeyForDisplayGroupItem(it);
        if(key && !seen.has(key)) {
          seen.add(key);
          firstBySource.push(it);
        } else {
          rest.push(it);
        }
      });
      return firstBySource.concat(rest);
    }

    function buildFrontViewportGroups(source, maxSlots){
      if(!Array.isArray(source) || !source.length) return [];
      const slotLimit = Math.max(1, parseInt(maxSlots, 10) || PAGE_SIZE);

      // Front viewport policy:
      // - each section exposes only representative cards;
      // - hidden overflow is stored behind the section button;
      // - hidden overflow NEVER counts in the 25 visible slots;
      // - do not refill empty slots with hidden news/blog/SNS overflow.
      const visibleCaps = {
        authority: 3,
        public_data: 2,
        local_tour: 2,
        knowledge: 3,
        wiki: 3,
        site: 5,
        book: 4,
        news: 5,
        community: 5,
        media: 5,
        social: 4,
        shopping: 4,
        sports: 3,
        finance: 3,
        webtoon: 3,
        web: 8
      };

      const groups = groupSliceForDisplay(source).map(g => {
        const items = diversifyGroupPreviewItems(g.group, g.items || []);
        return Object.assign({}, g, { items });
      });

      const out = [];
      let remaining = slotLimit;
      groups.forEach(g => {
        if(remaining <= 0 || !g || !Array.isArray(g.items) || !g.items.length) return;
        const baseCap = visibleCaps[g.group] || displayGroupPreviewLimit(g.group, g.items[0]) || 5;
        const visibleCount = Math.max(0, Math.min(baseCap, g.items.length, remaining));
        if(!visibleCount) return;
        out.push(Object.assign({}, g, {
          previewLimit: visibleCount,
          previewItems: g.items.slice(0, visibleCount),
          hiddenItems: g.items.slice(visibleCount),
          slotAwareViewport: true,
          displaySlotCount: visibleCount,
          sourceTotal: g.items.length
        }));
        remaining -= visibleCount;
      });

      return out;
    }

    function decorateDisplayItemForRender(it, groupInfo, index, hidden){
      const copy = Object.assign({}, it || {});
      const group = groupInfo && groupInfo.group ? groupInfo.group : displayGroupOfItem(copy);
      copy.__maruDisplayGroup = group;
      copy.__maruGroupPreviewIndex = Math.max(0, parseInt(index, 10) || 0);
      copy.__maruGroupHidden = !!hidden;

      // Only top-ranked map/local cards get live map preview + place info.
      // Later local results remain normal cards with summary text, preventing
      // long map iframes from flooding the search pages.
      copy.__maruAllowMapPreview = group === 'local_tour' && !hidden && copy.__maruGroupPreviewIndex < 1;
      return copy;
    }

    function renderGroupedSlice(slice, page){
      const groups = (Array.isArray(slice) && slice.length && slice[0] && Array.isArray(slice[0].items) && slice[0].group) ? slice : groupSliceForDisplay(slice);
      groups.forEach(groupInfo => {
        groupInfo.items = (Array.isArray(groupInfo.items) ? groupInfo.items : []).filter(it => {
          if(!isSyntheticProviderGuideCardClient(it)) return true;
          // News provider shortcuts are not news cards.  Image/video groups,
          // however, must stay visible as gallery lanes even while actual
          // thumbnails are still being supplied.
          return !/^(news)$/.test(String(groupInfo.group || ''));
        });
        groupInfo.items = diversifyGroupPreviewItems(groupInfo.group, groupInfo.items);
        if(!groupInfo.items.length) return;

        const section = document.createElement('section');
        section.className = 'maru-display-section';
        section.dataset.group = groupInfo.group;
        section.dataset.expanded = '0';

        const head = document.createElement('div');
        head.className = 'maru-display-section-head';

        const title = document.createElement('div');
        title.className = 'maru-display-section-title';
        const cleanGroupLabel = displayGroupLabel(groupInfo.group, groupInfo.items && groupInfo.items[0]);
        title.textContent = cleanGroupLabel;
        groupInfo.label = cleanGroupLabel;

        const meta = document.createElement('div');
        meta.className = 'maru-display-section-meta';
        const sourceTotal = parseInt(groupInfo.sourceTotal, 10) || Math.max.apply(null, groupInfo.items.map(x => parseInt(x && x.displayGroupSourceTotal, 10) || 0).concat([groupInfo.items.length]));
        const visibleCountForMeta = Array.isArray(groupInfo.previewItems) ? groupInfo.previewItems.length : groupInfo.items.length;
        meta.textContent = sourceTotal > visibleCountForMeta ? `${visibleCountForMeta}/${itemCountText(sourceTotal)}` : itemCountText(visibleCountForMeta);

        head.appendChild(title);
        head.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'maru-display-section-body';

        const previewLimit = Math.max(1, parseInt(groupInfo.previewLimit, 10) || displayGroupPreviewLimit(groupInfo.group, groupInfo.items[0]));
        const previewItems = Array.isArray(groupInfo.previewItems) ? groupInfo.previewItems : groupInfo.items.slice(0, previewLimit);
        let hiddenItems = Array.isArray(groupInfo.hiddenItems) ? groupInfo.hiddenItems : null;
        if(!hiddenItems && normalizeSearchType(activeType) === 'all'){
          const fullGroup = diversifyGroupPreviewItems(groupInfo.group, groupSliceForDisplay(allItems).find(g => g.group === groupInfo.group)?.items || []);
          const visibleKeys = new Set(previewItems.map(it => String((it && (it.url || it.link || it.openUrl || it.id || it.title)) || '').toLowerCase()).filter(Boolean));
          const groupCap = Math.max(displayGroupPreviewLimit(groupInfo.group, fullGroup[0]), displayGroupModuleTotalCap(groupInfo.group));
          hiddenItems = fullGroup.slice(displayGroupPreviewLimit(groupInfo.group, fullGroup[0]), groupCap).filter(it => {
            const key = String((it && (it.url || it.link || it.openUrl || it.id || it.title)) || '').toLowerCase();
            return !key || !visibleKeys.has(key);
          });
        }
        hiddenItems = Array.isArray(hiddenItems) ? hiddenItems : groupInfo.items.slice(previewItems.length);
        let hiddenMounted = false;
        let hiddenWrap = null;

        const visualSection = groupInfo.group === 'image' || groupInfo.group === 'media';
        const videoSection = groupInfo.group === 'video';
        if (visualSection) {
          const gallerySource = visualGalleryItemsClient((groupInfo.items || []).concat(previewItems || [], hiddenItems || []));
          if(gallerySource.length) {
            renderImageGalleryInto(gallerySource.map((it, idx) => decorateDisplayItemForRender(it, groupInfo, idx, false)), body, Math.max(previewLimit, 12));
          } else {
            renderVisualPendingPlaceholderClient(body, 8);
          }
        } else if (videoSection) {
          const videoSource = videoSnapshotItemsClient(previewItems);
          if(videoSource.length) {
            videoSource.forEach((it, idx) => renderItem(decorateDisplayItemForRender(it, groupInfo, idx, false), body));
          } else {
            renderVisualPendingPlaceholderClient(body, 6);
          }
        } else {
          previewItems.forEach((it, idx) => renderItem(decorateDisplayItemForRender(it, groupInfo, idx, false), body));
        }

        section.appendChild(head);
        section.appendChild(body);

        if (hiddenItems.length) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'maru-display-more';
          const hiddenCount = hiddenItems.length;
          const label = groupInfo.label || '이 섹션';
          more.textContent = `${label} ${uiText('viewAll', 'View all')} ▾ (${itemCountText(hiddenCount)})`;
          more.addEventListener('click', () => {
            const open = section.dataset.expanded === '1';
            if(open){
              section.dataset.expanded = '0';
              if(hiddenWrap) hiddenWrap.style.display = 'none';
              more.textContent = `${label} ${uiText('viewAll', 'View all')} ▾ (${itemCountText(hiddenCount)})`;
              return;
            }

            section.dataset.expanded = '1';
            if(!hiddenMounted){
              hiddenWrap = document.createElement('div');
              hiddenWrap.className = 'maru-display-hidden-wrap';
              const hiddenSlice = hiddenItems.slice(0, displayGroupModuleTotalCap(groupInfo.group)).filter(it => !isSyntheticProviderGuideCardClient(it));
              if (groupInfo.group === 'image' || groupInfo.group === 'media') {
                const hiddenVisuals = visualGalleryItemsClient(hiddenSlice);
                if(hiddenVisuals.length) renderImageGalleryInto(hiddenVisuals.map((it, idx) => decorateDisplayItemForRender(it, groupInfo, idx, true)), hiddenWrap, hiddenVisuals.length);
              } else if (groupInfo.group === 'video') {
                videoSnapshotItemsClient(hiddenSlice).forEach((it, idx) => renderItem(decorateDisplayItemForRender(it, groupInfo, idx, true), hiddenWrap));
              } else {
                hiddenSlice.forEach((it, idx) => renderItem(decorateDisplayItemForRender(it, groupInfo, idx, true), hiddenWrap));
              }
              body.appendChild(hiddenWrap);
              hiddenMounted = true;
            }
            if(hiddenWrap) hiddenWrap.style.display = '';
            more.textContent = `${label} ${uiText('collapse', 'Collapse')} ▴`;
          });
          section.appendChild(more);
        }

        results.appendChild(section);
      });
    }


    function setRevenueDataset(el, key, value){
      if (!el || value === undefined || value === null || value === '') return;
      try { el.dataset[key] = String(value); } catch(e) {}
    }

    function inferSearchRevenueLine(it){
      const text = String([
        it && it.revenueLine,
        it && it.revenue_line,
        it && it.type,
        it && it.mediaType,
        it && it.category,
        it && it.source,
        it && it.url,
        it && it.title
      ].filter(Boolean).join(' ')).toLowerCase();

      if (text.includes('ad') || text.includes('sponsor') || text.includes('banner')) return 'display_ad';
      if (text.includes('shopping') || text.includes('shop') || text.includes('product') || text.includes('commerce') || text.includes('affiliate') || text.includes('상품') || text.includes('구매')) return 'product_affiliate';
      if (text.includes('video') || text.includes('media') || text.includes('youtube') || text.includes('image') || text.includes('영상')) return 'media_engagement';
      if (text.includes('tour') || text.includes('travel') || text.includes('관광') || text.includes('여행')) return 'tour_commission';
      if (text.includes('donation') || text.includes('donate') || text.includes('후원') || text.includes('기부')) return 'donation_intent';
      return 'search_click';
    }

    function applySearchRevenueDataset(card, it, url){
      if (!card || !it) return;

      const itemId =
        it.id ||
        it.itemId ||
        it.contentId ||
        it.productId ||
        it.slotId ||
        it.trackId ||
        url ||
        it.title ||
        '';

      setRevenueDataset(card, 'maruRevenue', '1');
      setRevenueDataset(card, 'itemId', itemId);
      setRevenueDataset(card, 'contentId', it.contentId || it.content_id || '');
      setRevenueDataset(card, 'productId', it.productId || it.product_id || it.sku || '');
      setRevenueDataset(card, 'slotId', it.slotId || it.slot_id || '');
      setRevenueDataset(card, 'trackId', it.trackId || it.track_id || '');
      setRevenueDataset(card, 'campaignId', it.campaignId || it.campaign_id || '');
      setRevenueDataset(card, 'providerId', it.providerId || it.provider_id || it.provider || it.source?.name || it.source || '');
      setRevenueDataset(card, 'sellerId', it.sellerId || it.seller_id || it.seller || '');
      setRevenueDataset(card, 'title', it.title || '');
      setRevenueDataset(card, 'url', url || it.url || it.link || '');
      setRevenueDataset(card, 'itemType', it.type || it.itemType || '');
      setRevenueDataset(card, 'mediaType', it.mediaType || '');
      setRevenueDataset(card, 'category', it.category || activeType || 'search');
      setRevenueDataset(card, 'page', 'search');
      setRevenueDataset(card, 'section', activeType || 'all');
      setRevenueDataset(card, 'revenueLine', it.revenueLine || it.revenue_line || inferSearchRevenueLine(it));
      setRevenueDataset(card, 'snapshotSource', it.snapshotSource || it._snapshotSource || '');
      setRevenueDataset(card, 'snapshotRecordId', it.snapshotRecordId || it.snapshot_record_id || '');
      setRevenueDataset(card, 'price', it.price || it.amount || '');
      setRevenueDataset(card, 'currency', it.currency || it.ccy || '');
    }


    function extractYouTubeIdFromUrl(url){
      const raw = String(url || '').trim();
      if (!raw) return '';

      try {
        const u = new URL(raw, location.origin);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();

        if (host === 'youtu.be') {
          return (u.pathname.split('/').filter(Boolean)[0] || '').trim();
        }

        if (host.includes('youtube.com')) {
          if (u.searchParams.get('v')) return u.searchParams.get('v').trim();

          const parts = u.pathname.split('/').filter(Boolean);
          const embedIdx = parts.indexOf('embed');
          if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1].trim();

          const shortsIdx = parts.indexOf('shorts');
          if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1].trim();

          const liveIdx = parts.indexOf('live');
          if (liveIdx >= 0 && parts[liveIdx + 1]) return parts[liveIdx + 1].trim();
        }

        if (host === 'img.youtube.com' || host === 'i.ytimg.com') {
          const parts = u.pathname.split('/').filter(Boolean);
          const viIdx = parts.indexOf('vi');
          if (viIdx >= 0 && parts[viIdx + 1]) return parts[viIdx + 1].trim();
        }
      } catch(e) {}

      const m =
        raw.match(/[?&]v=([A-Za-z0-9_-]+)/) ||
        raw.match(/youtu\.be\/([A-Za-z0-9_-]+)/) ||
        raw.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/) ||
        raw.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/) ||
        raw.match(/img\.youtube\.com\/vi\/([A-Za-z0-9_-]+)/);

      return m ? String(m[1] || '').trim() : '';
    }

    function isValidYouTubeId(id){
      return /^[A-Za-z0-9_-]{11}$/.test(String(id || '').trim());
    }

    function isYouTubeUrl(url){
      const s = String(url || '').toLowerCase();
      return s.includes('youtube.com') || s.includes('youtu.be') || s.includes('ytimg.com') || s.includes('img.youtube.com');
    }

    function looksLikeGeneratedMediaPlaceholderToken(v){
      const s = String(v || '').toLowerCase();
      return /media(movie|drama|thriller|romance|variety|documentary|animation|music|shorts)?0*\d+/i.test(s) ||
             /movie\s*slot\s*\d+/i.test(s) ||
             /drama\s*slot\s*\d+/i.test(s) ||
             /media\s*slot\s*\d+/i.test(s);
    }

    function isSeedPlaceholderItem(it){
      if (!it || typeof it !== 'object') return false;

      const sourceName = String(it.source?.name || it.source || '').toLowerCase();
      const title = String(it.title || it.name || '').toLowerCase();
      const summary = String(it.summary || it.description || '').toLowerCase();
      const url = String(it.url || it.link || it.videoUrl || '').toLowerCase();
      const thumb = String(it.thumbnail || it.thumb || it.image || '').toLowerCase();

      const hasPlaceholderObject =
        !!(it.extension && it.extension.placeholder) ||
        !!(it.placeholder === true) ||
        !!(it.isPlaceholder === true);

      return (
        sourceName === 'seed' ||
        hasPlaceholderObject ||
        summary.includes('seed placeholder') ||
        summary.includes('replace with ranked media content') ||
        looksLikeGeneratedMediaPlaceholderToken(title) ||
        looksLikeGeneratedMediaPlaceholderToken(url) ||
        looksLikeGeneratedMediaPlaceholderToken(thumb)
      );
    }

    function hasInvalidYouTubeVideoUrl(it){
      const urls = [
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.media && it.media.url,
        it && it.media && it.media.videoUrl,
        it && it.thumbnail,
        it && it.thumb,
        it && it.image
      ].filter(Boolean);

      return urls.some(u => {
        const s = String(u || '');
        if (!isYouTubeUrl(s)) return false;
        const id = extractYouTubeIdFromUrl(s);
        return !isValidYouTubeId(id);
      });
    }

    function shouldRejectSearchResultItem(it){
      if (!it) return true;
      if (isSeedPlaceholderItem(it)) return true;
      if (hasInvalidYouTubeVideoUrl(it)) return true;
      return false;
    }

    function filterSearchResultItems(items){
      return (Array.isArray(items) ? items : []).filter(it => !shouldRejectSearchResultItem(it));
    }

    function getDirectVideoUrl(it){
      const urls = [
        it && it.videoUrl,
        it && it.media && it.media.videoUrl,
        it && it.media && it.media.url,
        it && it.media && it.media.src,
        it && it.media && it.media.preview && it.media.preview.mp4,
        it && it.media && it.media.preview && it.media.preview.webm,
        it && it.url,
        it && it.link
      ].filter(Boolean);

      for (const u of urls) {
        const s = String(u || '').trim();
        if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(s)) return s;
      }

      return '';
    }

    function getPlayableMediaInfo(it, url){
      const candidates = [
        url,
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.media && it.media.url,
        it && it.media && it.media.videoUrl
      ].filter(Boolean);

      for (const u of candidates) {
        const s = String(u || '').trim();
        if (isYouTubeUrl(s)) {
          const id = extractYouTubeIdFromUrl(s);
          if (isValidYouTubeId(id)) {
            return {
              kind: 'youtube',
              id,
              embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
              originalUrl: s
            };
          }
        }
      }

      const direct = getDirectVideoUrl(it);
      if (direct) {
        return {
          kind: 'direct',
          src: direct,
          mime: /\.webm(\?|#|$)/i.test(direct) ? 'video/webm' : /\.ogg(\?|#|$)/i.test(direct) ? 'video/ogg' : 'video/mp4'
        };
      }

      return null;
    }

    function isPureMapItemClient(it){
      const source = String((it && it.source) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const category = String((it && it.category) || '').toLowerCase();
      const visualKind = String((it && it.visualKind) || '').toLowerCase();
      const url = String((it && (it.url || it.link)) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const group = displayGroupOfItem(it);

      // Do not let a generic web/news result become a thumbnail-like map card
      // just because its title contains words such as 지도/교통지도. Map preview
      // is allowed only for the map tab or for true map provider records.
      if (normalizeSearchType(activeType) === 'map') return true;
      if (source.includes('google_maps') || source.includes('naver_map')) return true;
      if (/google\.com\/maps|map\.naver\.com|\/maps\/search/.test(url)) return true;
      if ((type === 'map' || mediaType === 'map' || category === 'map') && group === 'local_tour' && !source.includes('news')) return true;
      if (visualKind === 'map' && group === 'local_tour' && !source.includes('news') && !title.includes('뉴스')) return true;
      return false;
    }

    function isMapLikeItemClient(it){
      return isPureMapItemClient(it);
    }

    function firstExistingValueClient(obj, keys){
      if(!obj || typeof obj !== 'object') return '';
      for(const key of keys){
        const v = obj[key];
        if(v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return '';
    }

    function placeInfoForItemClient(it){
      const p = (it && it.placeInfo && typeof it.placeInfo === 'object') ? it.placeInfo : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const address = firstExistingValueClient(p, ['address','roadAddress','jibunAddress','addr']) || firstExistingValueClient(it, ['address','roadAddress','jibunAddress','addr']) || firstExistingValueClient(payload, ['address','roadAddress','jibunAddress','addr']);
      const phone = firstExistingValueClient(p, ['phone','telephone','tel','contact']) || firstExistingValueClient(it, ['phone','telephone','tel','contact']) || firstExistingValueClient(payload, ['phone','telephone','tel','contact']);
      const hours = firstExistingValueClient(p, ['hours','openingHours','businessHours','openStatus']) || firstExistingValueClient(it, ['hours','openingHours','businessHours','openStatus']) || firstExistingValueClient(payload, ['hours','openingHours','businessHours','openStatus']);
      const homepage = firstExistingValueClient(p, ['homepage','website','officialUrl','url']) || firstExistingValueClient(it, ['homepage','website','officialUrl']);
      const title = String((it && it.title) || '').replace(/^\[[^\]]+\]\s*/, '').trim();
      const query = firstExistingValueClient(p, ['mapQuery','query','name']) || firstExistingValueClient(it, ['mapQuery','placeName','name']) || title || lastQuery || input.value || '';
      return { address, phone, hours, homepage, query };
    }

    function mapQueryForItemClient(it){
      const info = placeInfoForItemClient(it);
      const title = String((it && it.title) || '').replace(/^\[[^\]]+\]\s*/, '').replace(/[-–—].*$/, '').trim();
      const summary = String((it && (it.summary || it.description)) || '').trim();
      return (info.address ? `${title || info.query} ${info.address}` : (info.query || title || summary || lastQuery || input.value || '')).slice(0, 160);
    }

    function renderPlaceInfoClient(it, mapQuery){
      const info = placeInfoForItemClient(it);
      const hasInfo = !!(info.address || info.phone || info.hours || info.homepage);
      const wrap = document.createElement('div');
      wrap.className = 'maru-place-info';

      if(hasInfo){
        if(info.address){
          const row = document.createElement('div');
          row.className = 'maru-place-info-row';
          row.textContent = '주소: ' + info.address;
          wrap.appendChild(row);
        }
        if(info.phone){
          const row = document.createElement('div');
          row.className = 'maru-place-info-row';
          row.textContent = '전화: ' + info.phone;
          wrap.appendChild(row);
        }
        if(info.hours){
          const row = document.createElement('div');
          row.className = 'maru-place-info-row';
          row.textContent = '시간: ' + info.hours;
          wrap.appendChild(row);
        }
      } else {
        const row = document.createElement('div');
        row.className = 'maru-place-info-row';
        row.textContent = '장소 정보: 지도 보기에서 주소·길찾기·주변 정보를 확인할 수 있습니다.';
        wrap.appendChild(row);
      }

      const actions = document.createElement('div');
      actions.className = 'maru-place-actions';

      const google = document.createElement('a');
      google.href = 'https://www.google.com/maps/search/' + encodeURIComponent(mapQuery || info.query || '');
      google.target = '_self';
      google.rel = 'noopener';
      google.textContent = 'Google 지도';
      actions.appendChild(google);

      const naver = document.createElement('a');
      naver.href = 'https://map.naver.com/p/search/' + encodeURIComponent(mapQuery || info.query || '');
      naver.target = '_self';
      naver.rel = 'noopener';
      naver.textContent = 'Naver 지도';
      actions.appendChild(naver);

      if(info.homepage){
        const home = document.createElement('a');
        home.href = info.homepage;
        home.target = '_self';
        home.rel = 'noopener';
        home.textContent = '홈페이지';
        actions.appendChild(home);
      }

      wrap.appendChild(actions);
      return wrap;
    }

    function renderMapPreviewClient(it){
      if(!isMapLikeItemClient(it)) return null;
      const q = mapQueryForItemClient(it);
      if(!q) return null;
      const wrap = document.createElement('div');
      wrap.className = 'maru-map-preview';
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      iframe.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed';
      iframe.title = q + ' map';
      iframe.onerror = () => wrap.remove();
      wrap.appendChild(iframe);
      const cap = document.createElement('div');
      cap.className = 'maru-map-preview-caption';
      cap.textContent = q;
      wrap.appendChild(cap);
      wrap.appendChild(renderPlaceInfoClient(it, q));
      return wrap;
    }

    function renderPlayableMedia(mediaInfo, it){
      if (!mediaInfo) return null;

      const wrap = document.createElement('div');
      wrap.className = 'maru-video-embed-wrap';

      if (mediaInfo.kind === 'youtube') {
        const iframe = document.createElement('iframe');
        iframe.src = mediaInfo.embedUrl;
        iframe.loading = 'lazy';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.title = (it && it.title) ? String(it.title).slice(0, 120) : 'YouTube video';
        wrap.appendChild(iframe);
        return wrap;
      }

      if (mediaInfo.kind === 'direct') {
        const video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        if (it && (it.poster || it.thumbnail || it.thumb || it.image)) {
          video.poster = it.poster || it.thumbnail || it.thumb || it.image;
        }

        const source = document.createElement('source');
        source.src = mediaInfo.src;
        source.type = mediaInfo.mime || 'video/mp4';
        video.appendChild(source);
        wrap.appendChild(video);
        return wrap;
      }

      return null;
    }


    function compactCardTextClient(v){
      if(v === undefined || v === null) return '';
      if(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'){
        return String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if(Array.isArray(v)){
        return v.map(compactCardTextClient).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      }
      if(typeof v === 'object'){
        return compactCardTextClient([
          v.summary, v.snippet, v.description, v.contentSnippet, v.content, v.text,
          v.abstract, v.excerpt, v.intro, v.body, v.caption
        ]);
      }
      return '';
    }

    function isGeneratedGuideTextClient(v){
      const text = compactCardTextClient(v);
      if(!text) return false;
      const low = text.toLowerCase();
      return /(확인할 수 있는 결과입니다|연결되는 결과입니다|표시됩니다|함께 표시|대표 이미지가 있으면|대표 스냅샷|본문 요약이 제공|2~3줄|사진·그래픽·이미지|현장 화면·리뷰|최신 보도·이슈·기사|통합 검색 결과|검색 결과로 연결|자료를 확인할 수 있는|news 흐름|image 자료|video 자료)/i.test(text) ||
        /(google news|bing images|bing videos|naver images|naver videos|google images)/i.test(low);
    }

    function isSyntheticProviderGuideCardClient(it){
      it = it && typeof it === 'object' ? it : {};
      const payload = it.payload && typeof it.payload === 'object' ? it.payload : {};
      const displayCard = it.displayCard && typeof it.displayCard === 'object' ? it.displayCard : {};
      const title = compactCardTextClient([it.title, displayCard.title, payload.title]).toLowerCase();
      const desc = compactCardTextClient([
        it.summary, it.description, it.snippet, it.contentSnippet,
        displayCard.summary, displayCard.description, displayCard.snippet,
        payload.summary, payload.description, payload.snippet
      ]);
      const url = String(it.url || it.link || it.openUrl || payload.url || payload.link || '').toLowerCase();
      const source = String(it.source || it.provider || it.channel || payload.source || '').toLowerCase();
      const shortcutTitle = /(google news|bing images|bing videos|google images|naver images|naver videos|통합 검색|이미지 검색|동영상 검색|뉴스 검색)/i.test(title);
      const providerShortcut = /(google\.com|bing\.com|naver\.com|news\.google\.com)/i.test(url + ' ' + source) && shortcutTitle;
      return (shortcutTitle || providerShortcut) && (!desc || isGeneratedGuideTextClient(desc));
    }

    function hasRenderableVisualClient(it){
      return !!(it && collectNaturalImages(it).length);
    }

    function visualGalleryItemsClient(items){
      const out = [];
      const seenItems = new Set();
      const seenImages = new Set();
      (Array.isArray(items) ? items : []).forEach(it => {
        if(!it || isSyntheticProviderGuideCardClient(it)) return;
        const images = dedupeImageVariantsClient(collectNaturalImages(it));
        if(!images.length) return;
        const itemKey = displayItemKey ? displayItemKey(it) : String((it.url || it.link || it.title || '')).toLowerCase();
        const imageKey = normalizeImageVariantKeyClient(images[0]) || images[0].toLowerCase();
        if((itemKey && seenItems.has(itemKey)) || (imageKey && seenImages.has(imageKey))) return;
        if(itemKey) seenItems.add(itemKey);
        if(imageKey) seenImages.add(imageKey);
        out.push(it);
      });
      return out;
    }

    function videoSnapshotItemsClient(items){
      return (Array.isArray(items) ? items : []).filter(it => {
        if(!it || isSyntheticProviderGuideCardClient(it)) return false;
        if(hasRenderableVisualClient(it)) return true;
        return !!(getPlayableMediaInfo(it, String((it && (it.url || it.link || it.videoUrl || it.embedUrl)) || '')));
      });
    }

    function ensureSearchOwnedResultViewStyle(){
      if(document.getElementById('maru-search-owned-result-style')) return;
      const style = document.createElement('style');
      style.id = 'maru-search-owned-result-style';
      style.textContent = `
        .maru-search-owned-result {
          margin: 8px 0 20px;
          border: 1px solid #e6e8ef;
          border-radius: 16px;
          background: #ffffff;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(15,23,42,.04);
        }
        .maru-search-owned-result-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          min-height: 52px;
          padding: 10px 12px 10px 14px;
          border-bottom: 1px solid #edf0f5;
          background: #ffffff;
        }
        .maru-search-owned-result-head-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .maru-search-owned-result-kicker {
          max-width: 900px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #111827;
          font-size: 15px;
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: -0.01em;
        }
        .maru-search-owned-result-source {
          max-width: 980px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-top: 3px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.2;
        }
        .maru-search-owned-result-actions {
          display: flex;
          align-items: center;
          gap: 7px;
          flex: 0 0 auto;
        }
        .maru-search-owned-result-actions button,
        .maru-search-owned-result-actions a {
          height: 32px;
          padding: 0 12px;
          border: 1px solid #dfe4ee;
          border-radius: 10px;
          background: #ffffff;
          color: #334155;
          font-size: 12px;
          font-weight: 800;
          text-decoration: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }
        .maru-search-owned-result-actions a {
          background: #4f46e5;
          border-color: #4f46e5;
          color: #ffffff;
        }
        .maru-search-owned-result-actions button:hover,
        .maru-search-owned-result-actions a:hover {
          filter: brightness(.98);
          text-decoration: none;
        }
        .maru-search-owned-proxy {
          margin: 0;
          border: 0;
          border-radius: 0;
          background: #ffffff;
        }
        .maru-search-owned-proxy-loading {
          height: 36px;
          padding: 0 14px;
          display: flex;
          align-items: center;
          border-bottom: 1px solid #edf0f5;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          background: #ffffff;
        }
        .maru-search-owned-proxy-frame,
        .maru-search-owned-source-frame {
          display: block;
          width: 100%;
          height: calc(100vh - 252px);
          min-height: 620px;
          border: 0;
          background: #ffffff;
        }
        .maru-search-owned-image-grid {
          padding: 16px;
          margin: 0;
          border-top: 1px solid #edf0f5;
        }
        .maru-search-owned-empty {
          padding: 34px 16px 46px;
          text-align: center;
          color: #64748b;
          font-size: 14px;
          line-height: 1.7;
          background: #ffffff;
        }
        @media (max-width: 840px) {
          .maru-search-owned-result-head {
            align-items: flex-start;
            flex-direction: column;
          }
          .maru-search-owned-result-actions {
            width: 100%;
          }
          .maru-search-owned-result-actions button,
          .maru-search-owned-result-actions a {
            flex: 1 1 auto;
          }
          .maru-search-owned-proxy-frame,
        .maru-search-owned-source-frame {
            height: calc(100vh - 310px);
            min-height: 520px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    function sourceLabelForOwnedResult(it, target){
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const rawSource = (it && it.source && typeof it.source === 'object')
        ? (it.source.name || it.source.platform || it.source.provider || '')
        : (it && it.source) || displayCard.source || payload.source || '';
      const host = domainOf(target || (it && (it.url || it.link)) || '');
      return String(rawSource || host || target || '').trim();
    }

    function detailTextForOwnedResult(it){
      const desc = descriptionForItemClient(it);
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const candidates = [
        desc,
        displayCard.body,
        displayCard.text,
        displayCard.description,
        displayCard.summary,
        it && it.content,
        it && it.text,
        it && it.body,
        it && it.excerpt,
        it && it.abstract,
        payload.body,
        payload.content,
        payload.text,
        payload.description,
        payload.summary
      ];
      for(const v of candidates){
        const text = compactCardTextClient(v);
        if(text && text.length >= 18) return text.slice(0, 900);
      }
      return '';
    }

    function relatedTermsForOwnedResult(it){
      const rawTags = []
        .concat(Array.isArray(it && it.tags) ? it.tags : [])
        .concat(Array.isArray(it && it.keywords) ? it.keywords : [])
        .concat(Array.isArray(it && it.categories) ? it.categories : []);
      const title = String((it && it.title) || lastQuery || '').trim();
      const base = String(lastQuery || input.value || title || '').trim();
      const fallback = base ? relatedSearchTermsFor(base).slice(0, 6) : [];
      const out = [];
      const seen = new Set();
      rawTags.concat(fallback).forEach(v => {
        const s = String(v || '').replace(/[#;]/g, ' ').replace(/\s+/g, ' ').trim();
        if(!s || seen.has(s.toLowerCase())) return;
        seen.add(s.toLowerCase());
        out.push(s);
      });
      return out.slice(0, 8);
    }

    function bindProxyAutoFallback(frame, proxySrc, target, proxyId){
      if(!frame || !proxySrc || !proxyId) return;
      let triedStatic = false;
      let loadTimer = null;
      const useStatic = () => {
        if(triedStatic) return;
        triedStatic = true;
        try{ frame.src = proxyUrlForResult(target, { mode: 'snapshot', proxyId: proxyId + '-snapshot' }); }catch(e){}
      };
      const cleanup = () => {
        try{ window.removeEventListener('message', onMessage); }catch(e){}
        if(loadTimer) try{ clearTimeout(loadTimer); }catch(e){}
      };
      const onMessage = (event) => {
        const data = event && event.data;
        if(!data || data.__igdcProxyStatus !== 1 || data.proxyId !== proxyId) return;
        const textLen = Number(data.textLen || 0) || 0;
        const height = Number(data.height || 0) || 0;
        const mediaCount = Number(data.mediaCount || 0) || 0;
        const titleLen = String(data.title || '').trim().length;
        if(!triedStatic && textLen < 40 && mediaCount < 1 && height < 180 && titleLen < 4){
          useStatic();
          return;
        }
        cleanup();
      };
      window.addEventListener('message', onMessage);
      loadTimer = setTimeout(() => {
        if(!triedStatic) useStatic();
      }, 5200);
      frame.addEventListener('load', () => {
        setTimeout(() => {
          if(triedStatic) { cleanup(); return; }
          try{
            const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
            const body = doc && doc.body;
            if(!body) return;
            const textLen = String(body.innerText || '').trim().length;
            const height = Math.max(body.scrollHeight || 0, doc.documentElement && doc.documentElement.scrollHeight || 0);
            const mediaCount = body.querySelectorAll ? body.querySelectorAll('img,svg,canvas,video,iframe,table').length : 0;
            if(textLen < 40 && mediaCount < 1 && height < 180) useStatic();
            else cleanup();
          }catch(e){}
        }, 1400);
      });
    }

    function isImageProviderResult(target, it){
      const raw = String(target || '').toLowerCase();
      const source = String((it && (it.source || it.provider || it.channel || it.type || it.category)) || '').toLowerCase();
      return /bing\.com\/images|google\.[^/]+\/search.*(?:tbm=isch|udm=2)|search\.naver\.com\/search\.naver.*where=image|image_passthrough|bing_image|google_image|naver_image/.test(raw + ' ' + source);
    }

    function collectImageProviderItems(seed){
      const out = [];
      const seen = new Set();
      function push(it){
        if(!it) return;
        const imgs = dedupeImageVariantsClient(collectNaturalImages(it));
        const src = imgs[0] || String((it && (it.image || it.thumbnail || it.thumb)) || '').trim();
        if(!src) return;
        const key = normalizeImageVariantKeyClient(src) || src.toLowerCase();
        if(seen.has(key)) return;
        seen.add(key);
        out.push(it);
      }
      push(seed);
      (Array.isArray(allItems) ? allItems : []).forEach(push);
      return out.slice(0, 120);
    }

    function appendNativeImageProviderView(shell, seedItem){
      const list = collectImageProviderItems(seedItem);
      if(!list.length) return false;
      const grid = document.createElement('div');
      grid.className = 'maru-image-gallery-grid maru-search-owned-image-grid';
      list.forEach((imgItem) => {
        const images = dedupeImageVariantsClient(collectNaturalImages(imgItem));
        const src = images[0] || String((imgItem && (imgItem.image || imgItem.thumbnail || imgItem.thumb)) || '').trim();
        if(!src) return;
        const tile = document.createElement('div');
        tile.className = 'maru-image-tile';
        tile.title = String((imgItem && imgItem.title) || '').trim();
        const img = document.createElement('img');
        img.src = src;
        img.loading = 'lazy';
        img.alt = String((imgItem && imgItem.title) || '').trim();
        img.onload = () => {
          try{
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            tile.dataset.orientation = h > w * 1.18 ? 'portrait' : (w > h * 1.25 ? 'landscape' : 'square');
          }catch(e){}
        };
        img.onerror = () => tile.remove();
        tile.appendChild(img);
        const capText = String((imgItem && imgItem.title) || '').trim();
        if(capText){
          const cap = document.createElement('div');
          cap.className = 'maru-image-tile-caption';
          cap.textContent = capText;
          tile.appendChild(cap);
        }
        tile.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pageUrl = displayUrlForImageItemClient(imgItem, src);
          if(pageUrl) goToOriginalSourceSameTab(pageUrl);
        });
        grid.appendChild(tile);
      });
      shell.appendChild(grid);
      return !!grid.childNodes.length;
    }

    function renderSearchOwnedResultView(url, it, opts){
      opts = opts || {};
      const target = normalizeSourceViewUrl(url);
      if(!target) return;
      if(!isSearchPage){
        try { window.location.href = target; } catch(e) {}
        return;
      }

      ensureSearchOwnedResultViewStyle();

      const displayTitle = String((it && it.title) || sourceLabelForOwnedResult(it || {}, target) || domainOf(target) || target).trim() || target;
      const sourceLabel = sourceLabelForOwnedResult(it || {}, target);

      if(!opts.skipHistory) try{
        const currentQ = String(lastQuery || input.value || '').trim();
        const u = new URL(location.href);
        u.searchParams.set('view', 'result');
        u.searchParams.set('target', target);
        u.searchParams.set('page', String(currentPage || 1));
        u.searchParams.set('block', String(currentBlock || 0));
        if(currentQ) u.searchParams.set('q', currentQ);
        if(activeType && activeType !== 'all') u.searchParams.set('type', activeType);
        else u.searchParams.delete('type');
        history.pushState({
          ...(history.state || {}),
          __maruSearchOwnedResult: true,
          q: currentQ,
          page: currentPage || 1,
          block: currentBlock || 0,
          type: activeType,
          target: target,
          title: displayTitle.slice(0, 180),
          view: 'result'
        }, '', u.toString());
      }catch(e){}

      const shell = document.createElement('div');
      shell.className = 'maru-search-owned-result';

      const head = document.createElement('div');
      head.className = 'maru-search-owned-result-head';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'maru-search-owned-result-head-main';

      const title = document.createElement('div');
      title.className = 'maru-search-owned-result-kicker';
      title.textContent = displayTitle;
      titleWrap.appendChild(title);

      const source = document.createElement('div');
      source.className = 'maru-search-owned-result-source';
      source.textContent = sourceLabel ? `${sourceLabel} · ${target}` : target;
      titleWrap.appendChild(source);

      const actions = document.createElement('div');
      actions.className = 'maru-search-owned-result-actions';

      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = uiText('searchList', 'Search list');
      back.addEventListener('click', () => {
        try{
          const u = new URL(location.href);
          u.searchParams.delete('view');
          u.searchParams.delete('target');
          history.replaceState({ ...(history.state || {}), __maruSearchOwnedResult:false }, '', u.toString());
        }catch(e){}
        try{ document.querySelectorAll('.maru-search-owned-proxy-frame').forEach(f => { if(f.__maruProxyBlobUrl){ URL.revokeObjectURL(f.__maruProxyBlobUrl); f.__maruProxyBlobUrl=''; } }); }catch(e){}
        renderPage(currentPage || 1, true);
        status.textContent = statusResultsText(actualResultCountForStatus(), lastQuery || input.value || '', activeType);
      });

      const open = document.createElement('a');
      open.href = target;
      open.removeAttribute('target');
      open.rel = 'noopener';
      open.dataset.maruExternal = '1';
      open.textContent = '사이트 원문';
      open.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        goToOriginalSourceSameTab(target);
      });

      actions.appendChild(back);
      actions.appendChild(open);
      head.appendChild(titleWrap);
      head.appendChild(actions);
      shell.appendChild(head);

      if(isImageProviderResult(target, it) && appendNativeImageProviderView(shell, it)){
        results.innerHTML = '';
        results.appendChild(shell);
        drawPager();
        status.textContent = statusResultsText(actualResultCountForStatus(), lastQuery || input.value || '', activeType);
        return;
      }

      const proxyId = 'maru-proxy-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const proxyBox = document.createElement('div');
      proxyBox.className = 'maru-search-owned-proxy';
      const loading = document.createElement('div');
      loading.className = 'maru-search-owned-proxy-loading';
      loading.textContent = uiText('receiving', 'receiving...');
      const frame = document.createElement('iframe');
      frame.className = 'maru-search-owned-source-frame';
      frame.dataset.proxyId = proxyId;
      frame.loading = 'eager';
      frame.title = displayTitle.slice(0, 120);
      proxyBox.appendChild(loading);
      proxyBox.appendChild(frame);
      shell.appendChild(proxyBox);
      installProxyViewerMessageBridge();
      mountOwnedSourceFrame(frame, loading, target, proxyId);

      results.innerHTML = '';
      results.appendChild(shell);
      drawPager();
      status.textContent = statusResultsText(actualResultCountForStatus(), lastQuery || input.value || '', activeType);
      // Keep the current IGDC search header/tabs/pager position; do not auto-scroll the shell away.
    }

    function openResultInsideSearchFrame(url, it){
      // Direct original mode: keep the rich IGDC result list intact, but open
      // the selected original page in the same tab. Browser Back returns to the
      // exact IGDC search-list URL because goToOriginalSourceSameTab rewrites
      // the current history entry before leaving.
      goToOriginalSourceSameTab(url);
    }

    function displayUrlForImageItemClient(it, src){
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const media = (it && it.media && typeof it.media === 'object') ? it.media : {};
      const preview = (media && media.preview && typeof media.preview === 'object') ? media.preview : {};
      return String(
        (it && (it.pageUrl || it.openUrl || it.contextLink || it.originalPageUrl)) ||
        displayCard.pageUrl || displayCard.openUrl || displayCard.url ||
        payload.pageUrl || payload.openUrl || payload.contextLink || payload.url || payload.link ||
        preview.pageUrl || preview.openUrl ||
        (it && (it.url || it.link || it.href)) ||
        src || ''
      ).trim();
    }

    function normalizeImageVariantKeyClient(imageUrl){
      const raw = String(imageUrl || '').trim();
      if(!raw) return '';
      try{
        const yt = extractYouTubeIdQuickClient(raw);
        if(yt) return 'youtube-video-thumb/' + yt;
      }catch(e){}
      try{
        const u = new URL(raw, location.origin);
        let path = decodeURIComponent(u.pathname || '').toLowerCase();
        path = path.replace(/\/thumb\//g, '/');
        path = path.replace(/\/\d+(?:px|x\d+)[^/]*$/i, '');
        path = path.replace(/[-_](?:\d{2,5}x\d{2,5}|\d{2,5}w|\d{2,5}h)(?=\.)/ig, '');
        const file = path.split('/').filter(Boolean).pop() || path;
        return (u.hostname.replace(/^www\./,'').toLowerCase() + '/' + file).replace(/\.(jpg|jpeg|png|webp|gif|avif)$/i, '');
      }catch(e){
        return raw.split('?')[0].split('#')[0].toLowerCase();
      }
    }

    function dedupeImageVariantsClient(images){
      const out = [];
      const seen = new Set();
      (Array.isArray(images) ? images : []).forEach(src => {
        const s = String(src || '').trim();
        if(!s) return;
        const key = normalizeImageVariantKeyClient(s) || s.toLowerCase();
        if(seen.has(key)) return;
        seen.add(key);
        out.push(s);
      });
      return out;
    }

    function renderVisualPendingPlaceholderClient(mountTarget, count){
      const grid = document.createElement('div');
      grid.className = 'maru-image-gallery-grid maru-image-gallery-pending';
      const n = Math.max(1, Math.min(12, parseInt(count, 10) || 6));
      for(let i = 0; i < n; i++){
        const tile = document.createElement('div');
        tile.className = 'maru-image-tile maru-image-tile-pending';
        tile.setAttribute('aria-hidden', 'true');
        grid.appendChild(tile);
      }
      (mountTarget || results).appendChild(grid);
      return grid;
    }

    function renderImageGalleryInto(slice, mountTarget, maxTiles){
      const source = visualGalleryItemsClient(slice);
      const grid = document.createElement('div');
      grid.className = 'maru-image-gallery-grid';
      const usedImages = new Set();
      const limit = Math.max(0, parseInt(maxTiles, 10) || source.length);
      source.some((it) => {
        if(limit && grid.children.length >= limit) return true;
        const images = dedupeImageVariantsClient(collectNaturalImages(it));
        const src = images[0] || '';
        if(!src) return false;
        const imageKey = normalizeImageVariantKeyClient(src) || src.toLowerCase();
        if(usedImages.has(imageKey)) return false;
        usedImages.add(imageKey);

        const tile = document.createElement('div');
        tile.className = 'maru-image-tile';
        tile.title = String((it && it.title) || '').trim();

        const img = document.createElement('img');
        img.src = src;
        img.loading = 'lazy';
        img.alt = String((it && it.title) || '').trim();
        img.onload = () => {
          try{
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            tile.dataset.orientation = h > w * 1.18 ? 'portrait' : (w > h * 1.25 ? 'landscape' : 'square');
          }catch(e){}
        };
        img.onerror = () => tile.remove();
        tile.appendChild(img);

        const capText = String((it && it.title) || '').trim();
        if(capText){
          const cap = document.createElement('div');
          cap.className = 'maru-image-tile-caption';
          cap.textContent = capText;
          tile.appendChild(cap);
        }
        const summaryText = descriptionForItemClient(it);
        if(summaryText){
          const summary = document.createElement('div');
          summary.className = 'maru-image-tile-summary';
          summary.textContent = summaryText;
          tile.appendChild(summary);
        }

        tile.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openResultInsideSearchFrame(displayUrlForImageItemClient(it, src), it);
        });
        grid.appendChild(tile);
        return false;
      });
      if(grid.children.length) (mountTarget || results).appendChild(grid);
      return grid;
    }

    function renderImageGalleryPage(slice){
      const grid = renderImageGalleryInto(slice, results);
      if(!grid || !grid.children.length){
        const pending = document.createElement('div');
        pending.className = 'card';
        pending.style.padding = '16px 18px';
        pending.style.color = '#64748b';
        pending.style.fontWeight = '700';
        pending.textContent = '이미지 썸네일을 수신 중입니다. 실제 이미지가 도착하면 갤러리로 표시됩니다.';
        results.appendChild(pending);
      }
    }

    function descriptionForItemClient(it){
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const data = (it && it.data && typeof it.data === 'object') ? it.data : {};
      const media = (it && it.media && typeof it.media === 'object') ? it.media : {};
      const preview = (media && media.preview && typeof media.preview === 'object') ? media.preview : {};
      const titleText = compactCardTextClient([it && it.title, displayCard.title, payload.title]).toLowerCase();

      // Body/snippet fields must win over displayCard guide copy.  The displayCard
      // summary often contains a generic provider explanation such as “사진 자료를
      // 확인할 수 있는 결과입니다”; that text is UI guidance, not searched body text.
      const candidates = [
        it && it.snippet,
        it && it.contentSnippet,
        it && it.excerpt,
        it && it.abstract,
        it && it.content,
        it && it.text,
        it && it.body,
        it && it.bodyText,
        it && it.lead,
        it && it.subtitle,
        it && it.description,
        it && it.summary,
        it && it.displaySummary,
        payload.snippet,
        payload.contentSnippet,
        payload.excerpt,
        payload.abstract,
        payload.content,
        payload.text,
        payload.body,
        payload.bodyText,
        payload.lead,
        payload.subtitle,
        payload.description,
        payload.summary,
        data.snippet,
        data.contentSnippet,
        data.excerpt,
        data.abstract,
        data.content,
        data.text,
        data.body,
        data.bodyText,
        data.lead,
        data.subtitle,
        data.description,
        data.summary,
        displayCard.body,
        displayCard.text,
        displayCard.snippet,
        displayCard.htmlSnippet,
        displayCard.html,
        displayCard.description,
        displayCard.summary,
        it && it.htmlSnippet,
        it && it.html,
        payload.htmlSnippet,
        payload.html,
        data.htmlSnippet,
        data.html,
        it && it.desc,
        it && it.metaDescription,
        it && it.ogDescription,
        payload.desc,
        payload.metaDescription,
        payload.ogDescription,
        data.desc,
        data.metaDescription,
        data.ogDescription,
        preview.summary,
        preview.description,
        preview.caption
      ];
      const seen = new Set();
      for(const v of candidates){
        const text = compactCardTextClient(v);
        if(!text) continue;
        const key = text.toLowerCase();
        if(seen.has(key)) continue;
        seen.add(key);
        if(isGeneratedGuideTextClient(text)) continue;
        if(titleText && key === titleText) continue;
        if(/^(google news|bing images|bing videos|google images|naver images|naver videos)$/i.test(key)) continue;
        return text.slice(0, 620);
      }
      return '';
    }

    function shouldRenderMapPreviewForItemClient(it){
      if(!it) return false;
      const displayCard = (it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      if(displayCard.showMapPreview === true && isMapLikeItemClient(it)) return true;
      if(it.__maruAllowMapPreview === true && isMapLikeItemClient(it)) return true;
      const t = normalizeSearchType(activeType);
      if((t === 'map' || t === 'tour') && isMapLikeItemClient(it)) return true;
      return false;
    }

    function renderItem(it, mountTarget){
      const url = it.url || it.link || '';
      const domain = domainOf(url);

      const card = document.createElement('div');
      card.className = 'card';
      applySearchRevenueDataset(card, it, url);

      const playableMedia = getPlayableMediaInfo(it, url);

      if (url) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
          if (e.target && e.target.closest && e.target.closest('a, button, iframe, video, .maru-video-embed-wrap, .maru-card-media')) return;
          e.preventDefault();
          e.stopPropagation();
          openResultInsideSearchFrame(url, it);
        });
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
        a.href = normalizeSourceViewUrl(url) || url;
        a.dataset.originalUrl = url;
        a.target = '_self';
        a.rel = 'noopener';
        a.textContent = (it.title || '').trim() || '(no title)';
        a.style.color = 'inherit';
        a.style.textDecoration = 'none';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openResultInsideSearchFrame(url, it);
        });
        t.appendChild(a);
      } else {
        t.textContent = (it.title || '').trim() || '(no title)';
      }

      const l = document.createElement('div');
      l.className = 'link';

      const fav = document.createElement('img');
      fav.src = faviconOf(url);
      fav.style.width = '16px';
      fav.style.height = '16px';
      fav.style.verticalAlign = 'middle';
      fav.style.marginRight = '10px';
      fav.style.borderRadius = '4px';
      fav.style.background = '#ffffff';
      fav.style.border = '1px solid #d6e4ff';
      fav.style.boxShadow = '0 0 0 0 rgba(0,0,0,0)';
      fav.style.padding = '1px';
      fav.onerror = () => fav.remove();

      const span = document.createElement('span');
      span.textContent = domain || (it.source?.name || it.source || '');

      l.appendChild(fav);
      l.appendChild(span);

      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = descriptionForItemClient(it);

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

      if (risk.textContent) textCol.appendChild(risk);
      textCol.appendChild(l);
      if (d.textContent) textCol.appendChild(d);

      if (d && d.textContent) {
        d.style.display = '-webkit-box';
        const cardLineClamp = it && it.displayCard && parseInt(it.displayCard.lineClamp, 10);
        d.style.webkitLineClamp = String(cardLineClamp > 0 ? Math.min(5, cardLineClamp) : 5);
        d.style.webkitBoxOrient = 'vertical';
        d.style.overflow = 'hidden';
        d.style.textOverflow = 'ellipsis';
      }

      const hasImageSet = Array.isArray(it.imageSet) && it.imageSet.length > 0;

      const naturalImages = dedupeImageVariantsClient(collectNaturalImages(it));
      const isRealThumb = naturalImages.length > 0;

      const hasVideoPreview =
        it.media &&
        ((it.media.type || it.media.kind) === 'video') &&
        it.media.preview &&
        (it.media.preview.mp4 || it.media.preview.webm || it.media.preview.poster);

      body.appendChild(textCol);

      const forcePlayableEmbed = !!(it && it.displayCard && it.displayCard.forceEmbed === true);
      const playableMediaNode = forcePlayableEmbed ? renderPlayableMedia(playableMedia, it) : null;
      if (playableMediaNode) {
        const badge = document.createElement('div');
        badge.className = 'maru-video-badge';
        badge.textContent = playableMedia.kind === 'youtube' ? '영상 재생' : '동영상';
        textCol.appendChild(badge);
        body.appendChild(playableMediaNode);
      } else if (playableMedia || isYoutubeLikeItemClient(it)) {
        const badge = document.createElement('div');
        badge.className = 'maru-video-badge';
        badge.textContent = '영상 스냅샷';
        textCol.appendChild(badge);
      }

      const mapPreviewNode = (!playableMediaNode && shouldRenderMapPreviewForItemClient(it)) ? renderMapPreviewClient(it) : null;
      if (mapPreviewNode) {
        body.appendChild(mapPreviewNode);
      }

      if (!playableMediaNode && isRealThumb) {
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

        mediaWrap.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openResultInsideSearchFrame(displayUrlForImageItemClient(it, naturalImages[0] || url), it);
        });

        naturalImages.slice(0, mediaCount).forEach((src) => {
          const img = document.createElement('img');
          img.src = src;
          img.loading = 'lazy';
          img.alt = '';
          img.onerror = () => img.remove();
          mediaWrap.appendChild(img);
        });

        body.appendChild(mediaWrap);
      }

      if (hasVideoPreview && !playableMediaNode && !isYoutubeLikeItemClient(it)) {
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
          `/.netlify/functions/maru-search?action=enrich-images&q=${encodeURIComponent(q)}&type=${encodeURIComponent(activeType || 'all')}`;

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



    function stateKeyForGroup(page, group){
      return `${lastQuery || input.value || ''}::${activeType || 'all'}::${page}::${group}`;
    }

    function isDisplayGroupModule(x){
      return !!(x && x.__maruDisplayGroupModule === true && x.group && Array.isArray(x.items));
    }

    function displayItemKey(it){
      return String((it && (it.url || it.link || it.openUrl || it.id || it.title)) || '').toLowerCase();
    }

    function makePlainWebItem(it){
      const copy = Object.assign({}, it || {});
      delete copy.displayGroup;
      delete copy.displayGroupLabel;
      delete copy.displayGroupVisibleIndex;
      delete copy.displayGroupSourceTotal;
      delete copy.displayGroupCollapsedCount;
      copy.generalWebContinuation = true;
      copy.visibleViewportCard = true;
      return copy;
    }

    function displayGroupModuleTotalCap(group){
      // Keep each category useful but bounded. Extra items are not deleted; they
      // continue as ordinary web/list results after the category portal blocks.
      const caps = {
        authority: 8,
        public_data: 8,
        local_tour: 8,
        knowledge: 3,
        wiki: 3,
        academic: 15,
        site: 15,
        book: 15,
        news: 15,
        blog: 15,
        cafe: 15,
        community: 15,
        image: 15,
        video: 15,
        media: 15,
        social: 15,
        shopping: 15,
        sports: 15,
        finance: 15,
        webtoon: 15
      };
      return caps[group] || 30;
    }

    function buildPortalPageModel(){
      const sourceItems = Array.isArray(allItems) ? allItems : [];
      const empty = { categoryPages: [], webItems: [], pageCount: 0, virtualCount: 0 };
      if(!sourceItems.length || normalizeSearchType(activeType) !== 'all') return empty;

      const grouped = groupSliceForDisplay(sourceItems).map(g => Object.assign({}, g, {
        items: diversifyGroupPreviewItems(g.group, g.items || [])
      }));
      const byGroup = new Map(grouped.map(g => [g.group, g]));
      const categoryOrder = displayGroupOrderForCurrentSearch().filter(g => g !== 'web');
      const categoryOverflowItems = [];
      const categoryPages = [];
      let page = [];
      let pageWeight = 0;

      function pushCategoryModule(g){
        if(!g || !Array.isArray(g.items) || !g.items.length) return;
        if(/^(news)$/.test(String(g.group || ''))) {
          g = Object.assign({}, g, { items: g.items.filter(it => !isSyntheticProviderGuideCardClient(it)) });
        }
        // Do not pre-filter image/video groups down to thumbnail-ready items here.
        // The renderer will show a gallery lane with real thumbnails when they
        // exist, or an empty gallery skeleton while the thumbnails are still
        // arriving.  Pre-filtering here makes the entire category disappear.
        if(!g.items.length) return;
        const previewLimit = Math.max(1, displayGroupPreviewLimit(g.group, g.items[0]));
        const moduleCap = Math.max(previewLimit, displayGroupModuleTotalCap(g.group));
        const moduleItems = g.items.slice(0, moduleCap);
        const previewItems = moduleItems.slice(0, previewLimit);
        const hiddenItems = moduleItems.slice(previewItems.length);
        const overflowItems = g.items.slice(moduleCap).map(makePlainWebItem);
        if(overflowItems.length) categoryOverflowItems.push(...overflowItems);
        const weight = Math.max(1, previewItems.length);
        const categoryPageTarget = PAGE_SIZE;
        if(page.length && pageWeight + weight > categoryPageTarget){
          categoryPages.push(page);
          page = [];
          pageWeight = 0;
        }
        page.push({
          __maruDisplayGroupModule: true,
          group: g.group,
          label: displayGroupLabel(g.group, g.items[0]),
          previewLimit,
          previewItems,
          hiddenItems,
          sourceTotal: moduleItems.length,
          overflowAsWebCount: overflowItems.length,
          items: previewItems,
          firstIndex: g.firstIndex || 0
        });
        pageWeight += weight;
      }

      categoryOrder.forEach(group => pushCategoryModule(byGroup.get(group)));
      if(page.length) categoryPages.push(page);

      const ordered = new Set(categoryOrder.concat(['web']));
      const nonPortalItems = [];
      grouped.forEach(g => {
        if(!ordered.has(g.group) && Array.isArray(g.items)) nonPortalItems.push(...g.items.map(makePlainWebItem));
      });
      const webGroup = byGroup.get('web');
      const webItems = categoryOverflowItems
        .concat(nonPortalItems)
        .concat((webGroup && Array.isArray(webGroup.items) ? webGroup.items : []).map(makePlainWebItem));
      function categoryModuleWeight(mod){
        return Math.max(1, Array.isArray(mod && mod.previewItems) ? mod.previewItems.length : 1);
      }
      function categoryPageWeight(modules){
        return (Array.isArray(modules) ? modules : []).reduce((sum, mod) => sum + categoryModuleWeight(mod), 0);
      }
      let filledWebBeforePlainPages = 0;
      const categoryFillCounts = categoryPages.map((modules, idx) => {
        // General web/plain results must not be inserted between category modules.
        // They may only start after the final category page has rendered, so the
        // category board keeps its intended order: knowledge/wiki/site/book/blog/cafe/news/etc.
        if(idx !== categoryPages.length - 1) return 0;
        const fill = Math.min(
          Math.max(0, webItems.length - filledWebBeforePlainPages),
          Math.max(0, PAGE_SIZE - categoryPageWeight(modules))
        );
        filledWebBeforePlainPages += fill;
        return fill;
      });
      const remainingWebCount = Math.max(0, webItems.length - filledWebBeforePlainPages);
      const pageCount = categoryPages.length + Math.max(0, Math.ceil(remainingWebCount / PAGE_SIZE));
      return {
        categoryPages,
        categoryFillCounts,
        filledWebBeforePlainPages,
        webItems,
        pageCount,
        virtualCount: (categoryPages.length * PAGE_SIZE) + remainingWebCount
      };
    }

    function normalizeItemSearchTypeClient(it){
      it = it && typeof it === 'object' ? it : {};
      const raw = [
        it.type, it.category, it.searchCategory, it.tab, it.vertical, it.mediaType,
        it.displayGroup, it.group, it.displayGroupLabel,
        it.source && typeof it.source === 'object' ? (it.source.name || it.source.provider || it.source.platform) : it.source,
        it.provider, it.channel
      ].map(v => String(v || '').trim().toLowerCase()).filter(Boolean).join(' ');
      const group = displayGroupOfItem(it);
      const url = String(it.url || it.link || it.openUrl || it.href || '').toLowerCase();
      const text = [it.title, it.name, it.summary, it.snippet, it.description, raw, url].map(v => String(v || '').toLowerCase()).join(' ');

      if(group === 'local_tour' || /(map|maps|local|place|tour|travel|tourism)/.test(raw) || /google\.com\/maps|map\.naver\.com|kko\.to\//.test(url)) return 'map';
      if(group === 'public_data' || /public_data|public data|공공자료|공공데이터|data\.go\.kr/.test(text)) return 'public_data';
      if(group === 'academic' || /academic|scholar|paper|research|논문|학술|연구/.test(text)) return 'academic';
      if(group === 'wiki' || /wiki|위키/.test(text)) return 'wiki';
      if(group === 'knowledge' || /knowledge|encyclopedia|지식|백과/.test(text)) return 'knowledge';
      if(group === 'book' || /book|books|도서|책|isbn/.test(text)) return 'book';
      if(group === 'blog' || /blog|블로그|blog\.naver\.com/.test(text)) return 'blog';
      if(group === 'cafe' || group === 'community' || /cafe|카페|community|forum/.test(text)) return 'cafe';
      if(group === 'shopping' || /shopping|shop|commerce|product|쇼핑|상품|가격/.test(text)) return 'shopping';
      if(group === 'news' || /news|뉴스|신문|일보|press/.test(text)) return 'news';
      if(group === 'image' || isVisualSearchCandidateClient(it) || /image|images|photo|picture|사진|포토|풍경|전경|갤러리|홍보/.test(raw + ' ' + text)) return 'image';
      if(group === 'video' || group === 'media' || /video|youtube|youtu\.be|영상|동영상/.test(text)) return 'video';
      if(group === 'social' || /sns|social|instagram|facebook|tiktok|twitter|x\.com|소셜/.test(text)) return 'sns';
      if(group === 'sports' || /sports|스포츠|축구|야구|농구/.test(text)) return 'sports';
      if(group === 'finance' || /finance|stock|market|증권|주식|금융|환율/.test(text)) return 'finance';
      if(group === 'webtoon' || /webtoon|웹툰|comic|manga/.test(text)) return 'webtoon';
      if(group === 'site' || group === 'authority' || /site|website|homepage|official|go\.kr|\.or\.kr|사이트|홈페이지|공식/.test(text)) return 'site';
      return 'site';
    }

    function itemMatchesActiveSearchTab(it, type){
      const t = normalizeSearchType(type || activeType || 'all');
      if(t === 'all') return true;
      const itemType = normalizeItemSearchTypeClient(it);
      const group = displayGroupOfItem(it);
      const url = String((it && (it.url || it.link || it.openUrl || it.href)) || '').toLowerCase();

      if(t === itemType) return true;
      if(t === 'map') return !isNewsLikeItemClient(it) && (itemType === 'map' || group === 'local_tour');
      if(t === 'tour') return !isNewsLikeItemClient(it) && (itemType === 'map' || group === 'local_tour' || /visit|tour|travel|관광|여행/.test(url));
      if(t === 'site') return ['site','knowledge','wiki','public_data'].includes(itemType) || ['authority','site','public_data'].includes(group);
      if(t === 'knowledge') return ['knowledge','wiki','site'].includes(itemType) || ['knowledge','wiki','authority'].includes(group);
      if(t === 'wiki') return itemType === 'wiki' || /wiki|wikipedia|namu\.wiki|위키/.test(url);
      if(t === 'sns') return itemType === 'sns' || group === 'social';
      if(t === 'image') return itemType === 'image' || group === 'image' || group === 'media' || isVisualSearchCandidateClient(it) || hasRenderableVisualClient(it);
      if(t === 'video') return itemType === 'video' || group === 'video' || group === 'media' || isYoutubeLikeItemClient(it) || !!(it && (it.videoId || it.videoUrl || it.embedUrl));
      if(t === 'cafe') return itemType === 'cafe' || group === 'community';
      return false;
    }

    function activeTabItemsFromPool(sourceItems){
      const source = Array.isArray(sourceItems) ? sourceItems : [];
      const t = normalizeSearchType(activeType || 'all');
      if(t === 'all') return source.slice();
      let filtered = source.filter(it => itemMatchesActiveSearchTab(it, t));
      if(t === 'news') filtered = filtered.filter(it => !isSyntheticProviderGuideCardClient(it));
      if(t === 'news') return diversifyGroupPreviewItems('news', filtered);
      if(t === 'image') return diversifyGroupPreviewItems('image', filtered);
      if(t === 'video') return diversifyGroupPreviewItems('video', filtered);
      return filtered;
    }

    function buildClientVisibleStream(page){
      const sourceItems = Array.isArray(allItems) ? allItems : [];
      if (!sourceItems.length) return [];
      if (normalizeSearchType(activeType) !== 'all') return activeTabItemsFromPool(sourceItems);

      const model = buildPortalPageModel();
      if(model.pageCount){
        const categoryPageCount = model.categoryPages.length;
        const pageNo = Math.max(1, parseInt(page, 10) || 1);
        if(pageNo <= categoryPageCount) {
          const modules = model.categoryPages[pageNo - 1] || [];
          const fillStart = (model.categoryFillCounts || []).slice(0, pageNo - 1).reduce((sum, n) => sum + (Number(n) || 0), 0);
          const fillCount = Number((model.categoryFillCounts || [])[pageNo - 1]) || 0;
          return modules.concat((model.webItems || []).slice(fillStart, fillStart + fillCount));
        }
        const webPage = pageNo - categoryPageCount;
        const start = Math.max(0, (model.filledWebBeforePlainPages || 0) + ((webPage - 1) * PAGE_SIZE));
        return model.webItems.slice(start, start + PAGE_SIZE);
      }

      return sourceItems.slice();
    }

    function visibleItemsForPage(page){
      const start = (page - 1) * PAGE_SIZE;

      // In the all tab, never let a raw server page full of one vertical
      // such as news occupy the viewport. Rebuild a balanced visible stream
      // from the accumulated pool so collapsed/overflow items do not consume
      // the 25 visible slots.
      if (normalizeSearchType(activeType) === 'all') {
        return buildClientVisibleStream(page);
      }

      const stream = buildClientVisibleStream(page);
      return stream.slice(start, start + PAGE_SIZE);
    }

    function actualResultCountForStatus(){
      // This is the real number currently received into the browser cache.
      // For a category tab, show the count inside the already received search pool.
      if (normalizeSearchType(activeType) !== 'all') return activeTabItemsFromPool(allItems).length;
      return Array.isArray(allItems) ? allItems.length : 0;
    }

    function visibleItemCountForPager(){
      // In the all tab the pager must count the client visible stream, not the
      // raw server total. Collapsed category overflow remains behind 더보기 and
      // must not consume page slots.
      if (normalizeSearchType(activeType) === 'all') {
        const model = buildPortalPageModel();
        const portalCount = model && model.virtualCount ? model.virtualCount : buildClientVisibleStream(currentPage || 1).length;
        const preloadFloor = lastQuery ? INITIAL_PRELOAD_TARGET : 0;
        return Math.max(portalCount, allItems.length || 0, preloadFloor);
      }
      if (normalizeSearchType(activeType) !== 'all') return activeTabItemsFromPool(allItems).length;
      if(serverPagedMode && serverTotalItems > 0) return Math.max(INITIAL_PRELOAD_TARGET, allItems.length || 0, buildClientVisibleStream(currentPage || 1).length);
      return Math.max(lastQuery ? INITIAL_PRELOAD_TARGET : 0, allItems.length || 0, buildClientVisibleStream(currentPage || 1).length);
    }

    function frontPageSectionSource(){
      if(normalizeSearchType(activeType) !== 'all') return null;
      const source = Array.isArray(allItems) ? allItems : [];
      if(!source.length) return null;
      // First page is a Naver/Google-like category board. It uses the received
      // pool, but each vertical renders only its preview count until the user
      // opens that section. This prevents news/blog/SNS from occupying hundreds
      // of cards in the main flow.
      return source.slice(0, Math.min(source.length, 600));
    }

    function renderPage(page, skipEnrich = false){
      try{ updateSearchTabsActive(lastQuery || (input && input.value) || ''); }catch(e){}
      if(serverPagedMode && !loadedServerPages.has(page)){
        const preloadedPageCount = preloadPageCountFromItems(allItems);
        if(page > preloadedPageCount && !renderPage._serverWindowLoading){
          renderPage._serverWindowLoading = true;
          loadServerPageAndRender(page).finally(() => { renderPage._serverWindowLoading = false; });
          return;
        }
      }
      const slice = visibleItemsForPage(page);
      const start = (page - 1) * PAGE_SIZE;

      if (!slice.length && normalizeSearchType(activeType) === 'all') {
        results.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'card';
        empty.style.padding = '16px 18px';
        empty.style.color = '#64748b';
        empty.style.fontWeight = '700';
        empty.textContent = `현재 ${page}페이지에 내려온 검색 카드가 없습니다.`;
        results.appendChild(empty);
        drawPager();
        return;
      }

      results.innerHTML = '';

      if (!slice.length && normalizeSearchType(activeType) !== 'all') {
        const empty = document.createElement('div');
        empty.className = 'card';
        empty.style.padding = '16px 18px';
        empty.style.color = '#64748b';
        empty.style.fontWeight = '700';
        empty.textContent = `${getTypeLabel(activeType)} 항목은 현재 받은 검색 목록 안에서 아직 발견되지 않았습니다.`;
        results.appendChild(empty);
        clearPager();
        return;
      }

      // Image search should render as a gallery grid instead of stacked cards.
      if (normalizeSearchType(activeType) === 'image') {
        renderImageGalleryPage(slice);
        drawPager();
        return;
      }

      // Render the already-balanced visible stream. Do not rebuild page 1 from a
      // raw source slice, because a raw slice may contain only news/logo/map cards
      // and then hidden overflow still blocks the following categories from moving up.
      if (slice.some(isDisplayGroupModule)) {
        slice.forEach(entry => {
          if(isDisplayGroupModule(entry)) renderGroupedSlice([entry], page);
          else renderItem(entry);
        });
      } else if (shouldUseDisplayGroups(slice)) {
        renderGroupedSlice(slice, page);
      } else {
        slice.forEach(it => renderItem(it));
      }

      drawPager();

      if(!skipEnrich){
        enrichRenderedPageImages(page, slice, start);
      }
    }


    async function loadServerPageAndRender(page){
      if (normalizeSearchType(activeType) !== 'all') {
        renderPage(page, true);
        status.textContent = statusResultsText(actualResultCountForStatus(), lastQuery || input.value || '', activeType, continuousIntakeActive);
        return;
      }
      if(!serverPagedMode){
        renderPage(page);
        return;
      }
      if(loadedServerPages.has(page)){
        renderPage(page);
        return;
      }
      const preloadedPageCount = preloadPageCountFromItems(allItems);
      if(page <= preloadedPageCount){
        renderPage(page);
        return;
      }
      const q = (lastQuery || input.value || '').trim();
      if(!q){
        renderPage(page);
        return;
      }
      status.textContent = `${uiText('loadingPage', 'Loading page')} ${page} ${uiText('resultsFor', 'for')} "${q}"...`;
      try{
        const pack = await fetchSearch(q, activeType, page);
        const pageSlice = dedupeItems(filterSearchResultItems(pageItemsFromPack(pack)));
        if(pageSlice.length){
          loadedServerPages.set(page, pageSlice.slice(0, PAGE_SIZE));
          allItems = mergeItemsPreferDisplayRichness(allItems, pageSlice);
          const total = serverTotalFromPayload(pack && pack.payload, serverTotalItems || pageSlice.length);
          serverTotalItems = Math.max(serverTotalItems || 0, total || 0, INITIAL_PRELOAD_TARGET);
        } else {
          loadedServerPages.set(page, []);
          status.textContent = `현재 ${page}페이지에 내려온 검색 카드가 없습니다.`;
        }
      }catch(e){
        console.warn('server page fetch skipped:', e);
      }
      if(loadedServerPages.has(page) || page <= preloadPageCountFromItems(allItems)){
        renderPage(page);
        if(loadedServerPages.has(page) && !(loadedServerPages.get(page) || []).length && page > preloadPageCountFromItems(allItems)){
          status.textContent = `현재 ${page}페이지에 내려온 검색 카드가 없습니다.`;
        } else {
          status.textContent = statusResultsText(actualResultCountForStatus(), q, activeType);
        }
      }
    }

function updateSearchPageHistory(page, block) {
  if (!isSearchPage) return;

  const u = new URL(location.href);
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
  const pages = Math.min(MAX_PAGER_PAGES, Math.max(1, Math.ceil(visibleItemCountForPager() / PAGE_SIZE)));
  if (pages <= 1) { clearPager(); return; }

  const bar = ensurePager();
  bar.innerHTML = '';

  function stylePagerButton(b, on){
    b.style.minWidth = '28px';
    b.style.height = '28px';
    b.style.padding = '0 8px';
    b.style.borderRadius = '8px';
    b.style.border = '1px solid ' + (on ? '#4f46e5' : '#dbe2ea');
    b.style.background = on ? '#4f46e5' : '#ffffff';
    b.style.color = on ? '#ffffff' : '#334155';
    b.style.fontSize = '12px';
    b.style.fontWeight = '800';
    b.style.cursor = 'pointer';
    b.style.lineHeight = '1';
  }

  const blockStart = currentBlock * BLOCK_SIZE + 1;
  const blockEnd = Math.min(blockStart + BLOCK_SIZE - 1, pages);

  if (blockStart > 1){
    const left = document.createElement('button');
    left.textContent = '◀';
    stylePagerButton(left, false);
    left.onclick = () => {
      currentBlock = Math.max(0, currentBlock - 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      loadServerPageAndRender(currentPage);
    };
    bar.appendChild(left);
  }

  for (let p = blockStart; p <= blockEnd; p++){
    const b = document.createElement('button');
    b.textContent = String(p);
    stylePagerButton(b, p === currentPage);
    b.onclick = () => {
      currentPage = p;
      currentBlock = Math.floor((p - 1) / BLOCK_SIZE);
      updateSearchPageHistory(currentPage, currentBlock);
      loadServerPageAndRender(currentPage);
    };
    bar.appendChild(b);
  }

  if (blockEnd < pages){
    const right = document.createElement('button');
    right.textContent = '▶';
    stylePagerButton(right, false);
    right.onclick = () => {
      const maxBlock = Math.floor((pages - 1) / BLOCK_SIZE);
      currentBlock = Math.min(maxBlock, currentBlock + 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      loadServerPageAndRender(currentPage);
    };
    bar.appendChild(right);
  }
}

async function runSearch(q, type = activeType){
  const qq = (q || '').trim();
  activeType = normalizeSearchType(type);
  lastQuery = qq;
  updateSearchTabsActive(qq);
  stopContinuousIntake();

  if (!qq){
    allItems = [];
    serverPagedMode = false;
    serverTotalItems = 0;
    authoritativeServerTotalItems = 0;
    progressivePagerPages = INITIAL_PROGRESSIVE_PAGER_PAGES;
    loadedServerPages.clear();
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
    return;
  }

  runSearch._seq = (runSearch._seq || 0) + 1;
  const seq = runSearch._seq;
  const target = Math.max(INITIAL_PRELOAD_TARGET, adaptiveSearchTarget(qq, activeType));

  allItems = [];
  serverPagedMode = true;
  authoritativeServerTotalItems = Math.max(target, INITIAL_PRELOAD_TARGET);
  progressivePagerPages = Math.min(
    MAX_PROGRESSIVE_PAGER_PAGES,
    Math.max(INITIAL_PROGRESSIVE_PAGER_PAGES, Math.ceil(Math.min(target, MAX_SMOOTH_CANDIDATES) / PAGE_SIZE))
  );
  serverTotalItems = Math.max(INITIAL_PRELOAD_TARGET, progressivePagerPages * PAGE_SIZE);
  loadedServerPages.clear();

  signalSanmaruSearch(qq, activeType, 'run-search');
  status.textContent = `${uiText('receiving', 'receiving...')} ${getTypeLabel(activeType)} · "${qq}"...`;
  renderSkeleton();
  // Search.js is ready to receive the first 12 pages immediately. Show the
  // basic pager while Sanmaru/MaruSearch fills the packet, instead of leaving
  // the page with no page structure.
  drawPager();

  currentBlock = 0;
  currentPage = 1;
  lastQuery = qq;
  lastType = activeType;
  pageImageEnrichCache.clear();
  itemImageEnrichCache.clear();
  expandedDisplayGroups.clear();

  let firstPaintDone = false;
  let intakeStarted = false;
  let intakeTimer = null;

  function startIntakeOnce(reason){
    if(intakeStarted || runSearch._seq !== seq) return;
    intakeStarted = true;
    if(intakeTimer) clearTimeout(intakeTimer);
    startContinuousIntake(qq, activeType, seq);
    status.textContent = statusResultsText(actualResultCountForStatus(), qq, activeType, true);
  }

  function schedulePipeHandoff(reason, delayMs){
    if(intakeStarted || runSearch._seq !== seq) return;
    if(intakeTimer) clearTimeout(intakeTimer);
    const ms = Math.max(0, Math.min(16, Number(delayMs) || 0));
    intakeTimer = setTimeout(() => startIntakeOnce(reason), ms);
  }

  function applySupplyPack(pack, sourceName){
    if(runSearch._seq !== seq || !pack) return 0;
    const normalized = normalizeSearchPayload(pack && pack.payload ? pack.payload : pack);
    const payload = normalized.payload || (pack && pack.payload) || pack || null;
    lastSearchPayload = payload || lastSearchPayload;

    const rawItems = Array.isArray(pack)
      ? pack
      : dedupeItems(filterSearchResultItems((pack && pack.items) || normalized.items || []));
    const pageItems = dedupeItems(filterSearchResultItems(pageItemsFromPack(pack)));
    const incoming = rawItems && rawItems.length ? rawItems : pageItems;
    const supplySignal = supplySignalFromPayload(payload, incoming && incoming.length ? incoming.length : 0);
    if(!incoming || !incoming.length){
      updateProgressiveTotalFromPayload(payload, Math.max(allItems.length || 0, supplySignal.estimatedTotal || 0));
      return 0;
    }

    // Cache the supply window immediately. Rendering still shows only the current
    // viewport, but pages 2~12 are already in memory when the user clicks them.
    const initialWindow = Math.min(
      MAX_SMOOTH_CANDIDATES,
      Math.max(INITIAL_PRELOAD_TARGET, incoming.length)
    );
    const windowItems = incoming.slice(0, initialWindow);
    allItems = mergeItemsPreferDisplayRichness(allItems, windowItems).slice(0, MAX_SMOOTH_CANDIDATES);
    seedLoadedServerPagesFromItems(allItems, Math.min(allItems.length, Math.max(INITIAL_PRELOAD_TARGET, windowItems.length)));
    if(pageItems.length) loadedServerPages.set(1, pageItems.slice(0, PAGE_SIZE));

    updateProgressiveTotalFromPayload(payload, Math.max(target, allItems.length, INITIAL_PRELOAD_TARGET), { expandAll:true });
    serverTotalItems = Math.max(serverTotalItems || 0, target, allItems.length, INITIAL_PRELOAD_TARGET);
    progressivePagerPages = Math.max(progressivePagerPages || 0, INITIAL_PROGRESSIVE_PAGER_PAGES, Math.ceil(Math.min(serverTotalItems, MAX_SMOOTH_CANDIDATES) / PAGE_SIZE));

    if(!firstPaintDone && allItems.length){
      firstPaintDone = true;
      renderPage(1);
    }else if(firstPaintDone && currentPage === 1){
      renderPage(1, true);
    }else if(firstPaintDone){
      drawPager();
    }
    status.textContent = statusResultsText(actualResultCountForStatus(), qq, activeType, supplySignal.exhausted ? false : true);
    if(!intakeStarted && !supplySignal.exhausted){
      schedulePipeHandoff('receiver-packet-open-pipe', allItems.length >= INITIAL_PRELOAD_TARGET ? 0 : FIRST_PIPE_HANDOFF_MS);
    }
    return incoming.length;
  }

  function wrapSupply(promise, kind){
    return promise.then(pack => ({ kind, pack })).catch(error => ({ kind, error }));
  }

  // PATCH: first render uses Sanmaru/MaruSearch first supply window, not forced 25-only paint
  const instantPromise = wrapSupply(fetchInstantSearchPack(qq, activeType), 'sanmaru-instant');
  const maruWindowPromise = wrapSupply(fetchSearch(qq, activeType, 1), 'maru-search-window');

  try{
    const first = await Promise.race([instantPromise, maruWindowPromise]);
    if(runSearch._seq !== seq) return;

    const firstCount = first && !first.error ? applySupplyPack(first.pack, first.kind) : 0;
    if(!firstCount){
      const second = first && first.kind === 'sanmaru-instant' ? await maruWindowPromise : await instantPromise;
      if(runSearch._seq !== seq) return;
      if(second && !second.error) applySupplyPack(second.pack, second.kind);
    }

    if(!firstPaintDone){
      if(!results.children.length) renderSkeleton();
      status.textContent = `${uiText('noQuickResults', 'No quick results')} "${qq}" · ${uiText('receiving', 'receiving...')}`;
    }

    // Do not wait for Sanmaru/MaruSearch to finish all lanes. Start the faucet
    // shortly after first paint, but let the page-1 300-window seed pages 1~12
    // first when it arrives quickly.
    schedulePipeHandoff('first-paint-handoff', FIRST_PIPE_HANDOFF_MS);

    maruWindowPromise.then(res => {
      if(runSearch._seq !== seq || !res || res.error) return;
      applySupplyPack(res.pack, res.kind);
      startIntakeOnce('maru-page1-window-ready');
    });
    instantPromise.then(res => {
      if(runSearch._seq !== seq || !res || res.error) return;
      applySupplyPack(res.pack, res.kind);
    });
  }catch(e){
    console.error(e);
    const fallbackPack = await fetchSearch(qq, activeType, 1);
    if (runSearch._seq !== seq) return;
    applySupplyPack(fallbackPack, 'fallback-maru-search');
    if(!firstPaintDone){
      if(!results.children.length) renderSkeleton();
      clearPager();
      status.textContent = `${uiText('noResults', 'No results')} "${qq}"`;
    }
    startIntakeOnce('fallback');
  }
}


  });
})();



/* ------------------------------------------------------------------
 * MARU Search Revenue Hook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Load /assets/js/maru-revenue-autohook.js
 * - Bind search submit/result impression/click events.
 * ------------------------------------------------------------------ */
(function loadMaruSearchRevenueHooks(){
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function loadScriptOnce(src, id, globalName, done){
    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    var existing = document.getElementById(id);
    if (existing) {
      existing.addEventListener("load", function(){
        if (typeof done === "function") done();
      }, { once:true });
      existing.addEventListener("error", function(){
        console.warn("[MARU Search Revenue] failed to load:", src);
      }, { once:true });
      return;
    }

    var s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.async = false;
    s.onload = function(){
      if (typeof done === "function") done();
    };
    s.onerror = function(){
      console.warn("[MARU Search Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(s);
  }

  function bindSearchRevenue(){
    try {
      if (
        window.MaruRevenueTracker &&
        typeof window.MaruRevenueTracker.bindSearch === "function" &&
        !window.__MARU_SEARCH_REVENUE_BIND_DONE__
      ) {
        window.__MARU_SEARCH_REVENUE_BIND_DONE__ = true;
        window.MaruRevenueTracker.bindSearch("#searchInput", "#searchResults", {
          pageType: "search",
          service: "search.js",
          buttonSelector: "#searchBtn"
        });
      }

      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "search.js",
          observeRootSelector: "#searchResults"
        });
      }
    } catch (e) {
      console.warn("[MARU Search Revenue] hook skipped:", e);
    }
  }

  function boot(){
    loadScriptOnce(
      "/assets/js/maru-revenue-tracker.js",
      "maruRevenueTrackerScript",
      "MaruRevenueTracker",
      function(){
        loadScriptOnce(
          "/assets/js/maru-revenue-autohook.js",
          "maruRevenueAutoHookScript",
          "MaruRevenueAutoHook",
          bindSearchRevenue
        );
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }
})();
