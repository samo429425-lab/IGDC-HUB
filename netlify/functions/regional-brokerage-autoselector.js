"use strict";

/*
 * Distribution Hub automatic seller/product collector.
 * - Reads SearchBank reservoir first.
 * - When a country/region does not have enough verified candidates, asks the
 *   existing Sanmaru engine to search its authorised provider lanes.
 * - Performs bounded public-page evidence inspection before publication.
 * - Returns an in-memory snapshot; never rewrites SearchBank, Snapshot Engine,
 *   or generic search output from a visitor request.
 */

const Core=require("./lib/regional-brokerage-autoselection.core.v1");
const ProductRanking=require("./lib/commerce-product-ranking.v1");
let SupplierResearchPlan=null;
try{SupplierResearchPlan=require("./lib/commerce-supplier-research-plan.v1");}catch(_e){SupplierResearchPlan=null;}
const VERSION="regional-brokerage-autoselector-v2.6.2-resumable-product-inspection";
const CACHE_TTL=5*60*1000;
function envInt(name,fallback,min,max){
  const value=Number(process.env[name]);
  return Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
}
// Quality-first defaults. Optional environment overrides exist, but no setup is required.
const DISCOVERY_TIMEOUT=envInt("IGDC_COUNTRY_DISCOVERY_TIMEOUT_MS",20000,8000,45000);
const PROVIDER_FETCH_TIMEOUT=envInt("IGDC_COUNTRY_PROVIDER_TIMEOUT_MS",20000,8000,45000);
const PAGE_CHECK_TIMEOUT=envInt("IGDC_COUNTRY_PAGE_CHECK_TIMEOUT_MS",8000,3000,20000);
const MAX_LIVE_QUERIES=envInt("IGDC_COUNTRY_SANMARU_QUERIES",6,2,8);
const MAX_PROVIDER_CALLS=envInt("IGDC_COUNTRY_PROVIDER_CALLS",6,2,8);
const MAX_PAGE_CHECKS=envInt("IGDC_COUNTRY_PAGE_CHECKS",14,4,20);
const CACHE=globalThis.__IGDC_REGIONAL_BROKERAGE_CACHE__||(globalThis.__IGDC_REGIONAL_BROKERAGE_CACHE__=new Map());
const COUNTRY_LOCALES=Object.freeze({AD:"ca",AE:"ar,en",AF:"fa,ps",AG:"en",AI:"en",AL:"sq",AM:"hy,ru",AO:"pt",AQ:"en",AR:"es",AS:"sm,en",AT:"de",AU:"en",AW:"nl,pap",AX:"sv",AZ:"az,ru",BA:"bs,sr",BB:"en",BD:"bn",BE:"nl,fr",BF:"fr",BG:"bg",BH:"ar,en",BI:"rn,fr",BJ:"fr",BL:"fr",BM:"en",BN:"ms,en",BO:"es,qu",BQ:"nl",BR:"pt",BS:"en",BT:"dz",BV:"no",BW:"en,tn",BY:"be,ru",BZ:"en",CA:"en,fr",CC:"en",CD:"fr",CF:"sg,fr",CG:"fr",CH:"de,fr",CI:"fr",CK:"en",CL:"es",CM:"fr,en",CN:"zh-Hans",CO:"es",CR:"es",CU:"es",CV:"pt",CW:"pap,nl",CX:"en",CY:"el,tr",CZ:"cs",DE:"de",DJ:"fr,ar",DK:"da",DM:"en",DO:"es",DZ:"ar,fr",EC:"es,qu",EE:"et,ru",EG:"ar,en",EH:"ar",ER:"ti,en",ES:"es,ca",ET:"am,en",FI:"fi,sv",FJ:"en,fj",FK:"en",FM:"en",FO:"fo",FR:"fr",GA:"fr",GB:"en",GD:"en",GE:"ka,en",GF:"fr",GG:"en",GH:"en",GI:"en",GL:"kl",GM:"en",GN:"fr",GP:"fr",GQ:"es,fr",GR:"el",GS:"en",GT:"es",GU:"en,ch",GW:"pt",GY:"en",HK:"zh-Hant,en",HM:"en",HN:"es",HR:"hr",HT:"ht,fr",HU:"hu",ID:"id",IE:"en,ga",IL:"he,ar",IM:"en,gv",IN:"hi,en",IO:"en",IQ:"ar",IR:"fa",IS:"is",IT:"it",JE:"en",JM:"en",JO:"ar,en",JP:"ja",KE:"sw,en",KG:"ky,ru",KH:"km",KI:"en,gil",KM:"ar,zdj",KN:"en",KR:"ko",KW:"ar,en",KY:"en",KZ:"kk,ru",LA:"lo",LB:"ar,fr",LC:"en",LI:"de,gsw",LK:"si,ta",LR:"en",LS:"st,en",LT:"lt,ru",LU:"fr,de",LV:"lv,ru",LY:"ar",MA:"ar,fr",MC:"fr",MD:"ro,ru",ME:"sr",MF:"fr",MG:"mg,fr",MH:"en,mh",MK:"mk",ML:"fr",MM:"my",MN:"mn",MO:"zh-Hant,pt",MP:"en",MQ:"fr",MR:"ar",MS:"en",MT:"mt,en",MU:"en,fr",MV:"dv",MW:"en,ny",MX:"es",MY:"ms,en",MZ:"pt",NA:"en",NC:"fr",NE:"fr",NF:"en",NG:"en",NI:"es",NL:"nl",NO:"nb",NP:"ne",NR:"en,na",NU:"en,niu",NZ:"en,mi",OM:"ar,en",PA:"es",PE:"es,qu",PF:"fr,ty",PG:"en,tpi",PH:"fil,en",PK:"ur,en",PL:"pl",PM:"fr",PN:"en",PR:"es,en",PS:"ar",PT:"pt",PW:"pau,en",PY:"es,gn",QA:"ar,en",RE:"fr",RO:"ro",RS:"sr",RU:"ru",RW:"rw,en",SA:"ar,en",SB:"en",SC:"en,fr",SD:"ar,en",SE:"sv",SG:"en,zh-Hans",SH:"en",SI:"sl",SJ:"nb",SK:"sk",SL:"en",SM:"it",SN:"wo,fr",SO:"so,ar",SR:"nl",SS:"en",ST:"pt",SV:"es",SX:"en,nl",SY:"ar",SZ:"en,ss",TC:"en",TD:"ar,fr",TF:"fr",TG:"fr",TH:"th",TJ:"tg,ru",TK:"tkl,en",TL:"pt,tet",TM:"tk,ru",TN:"ar,fr",TO:"to,en",TR:"tr",TT:"en",TV:"tvl,en",TW:"zh-Hant",TZ:"sw,en",UA:"uk",UG:"en,sw",UM:"en",US:"en",UY:"es",UZ:"uz,ru",VA:"it",VC:"en",VE:"es",VG:"en",VI:"en",VN:"vi",VU:"bi,en",WF:"fr",WS:"sm,en",XK:"sq,sr",YE:"ar",YT:"fr",ZA:"en,af",ZM:"en",ZW:"sn,en"});

// Official languages alone do not describe how commerce is actually searched.
// These overrides add widely used trade, diaspora, regional, and English bridge
// languages for multilingual markets. The full portfolio is rotated across runs.
const COUNTRY_COMMERCE_LOCALE_OVERRIDES=Object.freeze({
  AE:"ar,en,hi,ur",AF:"fa,ps,uz,tk,en",BE:"nl,fr,de,en",BO:"es,qu,ay,en",BY:"be,ru,en",
  CA:"en,fr",CH:"de,fr,it,rm,en",CN:"zh-Hans,en",CY:"el,tr,en",DZ:"ar,fr,en",EE:"et,ru,en",
  EG:"ar,en",ER:"ti,ar,en",ES:"es,ca,eu,gl,en",ET:"am,om,ti,en",FJ:"en,fj,hi",FI:"fi,sv,en",
  GB:"en,cy,gd",GE:"ka,ru,en",GH:"en,ak",HK:"zh-Hant,en",ID:"id,en",IE:"en,ga",IL:"he,ar,en",
  IN:"hi,en,bn,ta,te,mar,gu,kn,ml,pa,ur",IQ:"ar,ku,en",IR:"fa,az,ku,en",KE:"sw,en",KG:"ky,ru,en",
  KZ:"kk,ru,en",LB:"ar,fr,en",LK:"si,ta,en",LU:"lb,fr,de,en",MA:"ar,fr,en",MD:"ro,ru,en",
  MK:"mk,sq,en",MM:"my,en",MO:"zh-Hant,pt,en",MU:"en,fr,mfe",MY:"ms,en,zh-Hans,ta",
  NG:"en,ha,yo,ig",NL:"nl,en",NO:"nb,nn,en",NP:"ne,en",NZ:"en,mi",PH:"fil,en,ceb",
  PK:"ur,en,pa,sd,ps",PR:"es,en",RU:"ru,en",SG:"en,zh-Hans,ms,ta",SI:"sl,en",SO:"so,ar,en",
  SS:"en,ar",SZ:"en,ss",TJ:"tg,ru,en",TM:"tk,ru,en",TN:"ar,fr,en",TR:"tr,en",UA:"uk,ru,en",
  UG:"en,sw",UZ:"uz,ru,en",ZA:"en,af,zu,xh,st,tn",ZW:"sn,en,nd"
});
const MAX_COUNTRY_LANGUAGE_PORTFOLIO=12;
const CATEGORY_KEYS=Object.freeze(["local_products","manufacturer_brands","food_household_essentials","beauty_personal_care","fashion","electronics_accessories","home_appliances_living","baby_family_education","agriculture_fishery_forestry","travel_local_services"]);

const LOCAL_QUERY_PACKS=Object.freeze({
  en:{commerce:"official online store products buy delivery returns customer service",categories:["producer cooperative local products","manufacturer brand products","food groceries household essentials","beauty personal care products","clothing shoes bags","electronics accessories","home kitchen appliances","baby family education products","agricultural fishery forestry products","local travel products booking"]},
  ko:{commerce:"공식 온라인몰 상품 구매 배송 반품 고객센터",categories:["생산자 협동조합 지역 특산품","제조사 브랜드 상품","식품 식료품 생활용품","화장품 개인용품","의류 신발 가방","전자제품 액세서리","가전 주방 생활제품","유아 가족 교육용품","농산물 수산물 임산물","지역 여행상품 예약"]},
  ja:{commerce:"公式 オンラインストア 商品 購入 配送 返品 カスタマーサポート",categories:["生産者 協同組合 地域商品","メーカー ブランド商品","食品 食料品 日用品","化粧品 パーソナルケア","衣料品 靴 バッグ","電子機器 アクセサリー","家電 キッチン 生活用品","ベビー 家族 教育用品","農産物 水産物 林産物","地域 旅行商品 予約"]},
  "zh-Hans":{commerce:"官方 网上商城 商品 购买 配送 退货 客服",categories:["生产者 合作社 地方产品","制造商 品牌产品","食品 杂货 日用品","美容 个护产品","服装 鞋 包","电子产品 配件","家电 厨房 家居用品","母婴 家庭 教育用品","农产品 水产品 林产品","本地 旅游产品 预订"]},
  "zh-Hant":{commerce:"官方 網上商店 商品 購買 配送 退貨 客服",categories:["生產者 合作社 地方產品","製造商 品牌產品","食品 雜貨 日用品","美容 個人護理產品","服裝 鞋 バッグ","電子產品 配件","家電 廚房 家居用品","母嬰 家庭 教育用品","農產品 水產品 林產品","本地 旅遊產品 預訂"]},
  es:{commerce:"tienda oficial en línea productos comprar envío devoluciones atención al cliente",categories:["productor cooperativa productos locales","fabricante productos de marca","alimentos comestibles artículos del hogar","belleza cuidado personal","ropa zapatos bolsos","electrónica accesorios","electrodomésticos cocina hogar","bebé familia educación","productos agrícolas pesqueros forestales","productos turísticos locales reservas"]},
  pt:{commerce:"loja oficial online produtos comprar entrega devoluções atendimento ao cliente",categories:["produtor cooperativa produtos locais","fabricante produtos de marca","alimentos mercearia artigos domésticos","beleza cuidados pessoais","roupas sapatos bolsas","eletrônicos acessórios","eletrodomésticos cozinha casa","bebê família educação","produtos agrícolas pesqueiros florestais","produtos turísticos locais reservas"]},
  fr:{commerce:"boutique officielle en ligne produits acheter livraison retours service client",categories:["producteur coopérative produits locaux","fabricant produits de marque","alimentation épicerie articles ménagers","beauté soins personnels","vêtements chaussures sacs","électronique accessoires","électroménager cuisine maison","bébé famille éducation","produits agricoles halieutiques forestiers","produits touristiques locaux réservation"]},
  de:{commerce:"offizieller Onlineshop Produkte kaufen Lieferung Rückgabe Kundenservice",categories:["Erzeuger Genossenschaft lokale Produkte","Hersteller Markenprodukte","Lebensmittel Haushaltswaren","Schönheit Körperpflege","Kleidung Schuhe Taschen","Elektronik Zubehör","Haushaltsgeräte Küche Wohnen","Baby Familie Bildung","Agrar Fischerei Forstprodukte","lokale Reiseprodukte Buchung"]},
  it:{commerce:"negozio online ufficiale prodotti acquistare spedizione resi assistenza clienti",categories:["produttore cooperativa prodotti locali","produttore prodotti di marca","alimentari generi domestici","bellezza cura personale","abbigliamento scarpe borse","elettronica accessori","elettrodomestici cucina casa","bambini famiglia istruzione","prodotti agricoli ittici forestali","prodotti turistici locali prenotazione"]},
  nl:{commerce:"officiële webshop producten kopen levering retourneren klantenservice",categories:["producent coöperatie lokale producten","fabrikant merkproducten","voeding boodschappen huishoudartikelen","schoonheid persoonlijke verzorging","kleding schoenen tassen","elektronica accessoires","huishoudelijke apparaten keuken wonen","baby gezin onderwijs","landbouw visserij bosbouwproducten","lokale reisproducten boeken"]},
  ru:{commerce:"официальный интернет-магазин товары купить доставка возврат поддержка клиентов",categories:["производитель кооператив местные товары","производитель брендовые товары","продукты питания товары для дома","красота личный уход","одежда обувь сумки","электроника аксессуары","бытовая техника кухня дом","детские семейные образовательные товары","сельскохозяйственные рыбные лесные товары","местные туристические продукты бронирование"]},
  uk:{commerce:"офіційний інтернет-магазин товари купити доставка повернення підтримка клієнтів",categories:["виробник кооператив місцеві товари","виробник брендові товари","продукти харчування товари для дому","краса особистий догляд","одяг взуття сумки","електроніка аксесуари","побутова техніка кухня дім","дитячі сімейні освітні товари","сільськогосподарські рибні лісові товари","місцеві туристичні продукти бронювання"]},
  ar:{commerce:"متجر رسمي عبر الإنترنت منتجات شراء توصيل إرجاع خدمة العملاء",categories:["منتج تعاونية منتجات محلية","مصنع منتجات العلامة التجارية","أغذية بقالة مستلزمات منزلية","جمال عناية شخصية","ملابس أحذية حقائب","إلكترونيات ملحقات","أجهزة منزلية مطبخ منزل","أطفال أسرة تعليم","منتجات زراعية سمكية غابية","منتجات سياحية محلية حجز"]},
  tr:{commerce:"resmi çevrimiçi mağaza ürün satın al teslimat iade müşteri hizmetleri",categories:["üretici kooperatif yerel ürünler","üretici marka ürünleri","gıda market ev ihtiyaçları","güzellik kişisel bakım","giyim ayakkabı çanta","elektronik aksesuarlar","ev aletleri mutfak yaşam","bebek aile eğitim ürünleri","tarım balıkçılık ormancılık ürünleri","yerel turizm ürünleri rezervasyon"]},
  hi:{commerce:"आधिकारिक ऑनलाइन स्टोर उत्पाद खरीदें डिलीवरी वापसी ग्राहक सेवा",categories:["उत्पादक सहकारी स्थानीय उत्पाद","निर्माता ब्रांड उत्पाद","खाद्य किराना घरेलू सामान","सौंदर्य व्यक्तिगत देखभाल","कपड़े जूते बैग","इलेक्ट्रॉनिक्स सहायक उपकरण","घरेलू उपकरण रसोई घर","शिशु परिवार शिक्षा उत्पाद","कृषि मत्स्य वन उत्पाद","स्थानीय यात्रा उत्पाद बुकिंग"]},
  bn:{commerce:"অফিসিয়াল অনলাইন স্টোর পণ্য কিনুন ডেলিভারি ফেরত গ্রাহক সেবা",categories:["উৎপাদক সমবায় স্থানীয় পণ্য","প্রস্তুতকারক ব্র্যান্ড পণ্য","খাদ্য মুদি গৃহস্থালি পণ্য","সৌন্দর্য ব্যক্তিগত যত্ন","পোশাক জুতা ব্যাগ","ইলেকট্রনিক্স আনুষাঙ্গিক","গৃহস্থালি যন্ত্র রান্নাঘর","শিশু পরিবার শিক্ষা পণ্য","কৃষি মৎস্য বনজ পণ্য","স্থানীয় ভ্রমণ পণ্য বুকিং"]},
  ur:{commerce:"آفیشل آن لائن اسٹور مصنوعات خریدیں ڈیلیوری واپسی کسٹمر سروس",categories:["پروڈیوسر کوآپریٹو مقامی مصنوعات","مینوفیکچرر برانڈ مصنوعات","خوراک گروسری گھریلو سامان","خوبصورتی ذاتی نگہداشت","کپڑے جوتے بیگ","الیکٹرانکس لوازمات","گھریلو آلات باورچی خانہ","بچے خاندان تعلیمی مصنوعات","زرعی ماہی گیری جنگلاتی مصنوعات","مقامی سفری مصنوعات بکنگ"]},
  id:{commerce:"toko online resmi produk beli pengiriman pengembalian layanan pelanggan",categories:["produsen koperasi produk lokal","produsen produk merek","makanan bahan pokok rumah tangga","kecantikan perawatan pribadi","pakaian sepatu tas","elektronik aksesori","peralatan rumah dapur","bayi keluarga pendidikan","produk pertanian perikanan kehutanan","produk wisata lokal pemesanan"]},
  ms:{commerce:"kedai dalam talian rasmi produk beli penghantaran pemulangan khidmat pelanggan",categories:["pengeluar koperasi produk tempatan","pengilang produk jenama","makanan barangan runcit rumah","kecantikan penjagaan diri","pakaian kasut beg","elektronik aksesori","perkakas rumah dapur","bayi keluarga pendidikan","produk pertanian perikanan perhutanan","produk pelancongan tempatan tempahan"]},
  vi:{commerce:"cửa hàng trực tuyến chính thức sản phẩm mua giao hàng đổi trả chăm sóc khách hàng",categories:["nhà sản xuất hợp tác xã sản phẩm địa phương","nhà sản xuất sản phẩm thương hiệu","thực phẩm tạp hóa đồ gia dụng","làm đẹp chăm sóc cá nhân","quần áo giày túi","điện tử phụ kiện","đồ gia dụng nhà bếp","trẻ em gia đình giáo dục","sản phẩm nông lâm ngư nghiệp","sản phẩm du lịch địa phương đặt chỗ"]},
  th:{commerce:"ร้านค้าออนไลน์ทางการ สินค้า ซื้อ จัดส่ง คืนสินค้า บริการลูกค้า",categories:["ผู้ผลิต สหกรณ์ สินค้าท้องถิ่น","ผู้ผลิต สินค้าแบรนด์","อาหาร ของชำ ของใช้ในบ้าน","ความงาม ของใช้ส่วนบุคคล","เสื้อผ้า รองเท้า กระเป๋า","อิเล็กทรอนิกส์ อุปกรณ์เสริม","เครื่องใช้ไฟฟ้า ห้องครัว บ้าน","เด็ก ครอบครัว การศึกษา","สินค้าเกษตร ประมง ป่าไม้","สินค้าท่องเที่ยวท้องถิ่น จอง"]},
  sw:{commerce:"duka rasmi mtandaoni bidhaa nunua usafirishaji marejesho huduma kwa wateja",categories:["mzalishaji ushirika bidhaa za eneo","mtengenezaji bidhaa za chapa","chakula mboga vifaa vya nyumbani","urembo huduma binafsi","nguo viatu mifuko","elektroniki vifaa","vifaa vya nyumbani jikoni","mtoto familia elimu","bidhaa za kilimo uvuvi misitu","bidhaa za utalii wa eneo kuhifadhi"]}
});


const QUERY_LOCALIZATION_CACHE=globalThis.__IGDC_COUNTRY_QUERY_LOCALIZATION_CACHE__||(globalThis.__IGDC_COUNTRY_QUERY_LOCALIZATION_CACHE__=new Map());
const GOOGLE_LOCALE_ALIASES=Object.freeze({"zh-Hans":"zh-CN","zh-Hant":"zh-TW",nb:"no",fil:"tl"});
const COMMERCE_TEXT_RX=/(shop|store|product|buy|price|cart|catalog|mall|shopping|official store|online store|쇼핑|상품|구매|가격|스토어|온라인몰|ショップ|商品|購入|通販|商店|商品|購買|網上商店|网上商城|tienda|producto|comprar|loja|produto|comprar|boutique|produit|acheter|onlineshop|produkt|kaufen|negozio|prodotto|acquistare|webshop|producten|kopen|магазин|товар|купить|інтернет-магазин|товари|متجر|منتج|شراء|ऑनलाइन स्टोर|उत्पाद|खरीद|অনলাইন স্টোর|পণ্য|কিনুন|آن لائن اسٹور|مصنوعات|خریدیں|toko|produk|beli|kedai|cửa hàng|sản phẩm|mua|ร้านค้า|สินค้า|ซื้อ|duka|bidhaa|nunua)/i;
const NON_COMMERCE_TEXT_RX=/(\.pdf\b|\bpdf\b|report|research|study|journal|paper|proceedings|conference|symposium|whitepaper|statistics|policy brief|trade agreement|free trade agreement|trade barriers|news article|press release|working paper|annual report|보고서|연구|논문|학술|통계|협정|기사|보도자료|報告書|研究|論文|統計|協定|ニュース|报告|研究|论文|统计|协定|新闻|rapport|recherche|étude|journal|conférence|informe|investigación|estudio|revista|conferencia|relatório|pesquisa|estudo|conferência|bericht|forschung|studie|konferenz|отчет|исследование|доклад|конференция|تقرير|بحث|دراسة|مؤتمر)/i;
const BLOCKED_DOCUMENT_EXT_RX=/\.(pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|csv|zip|rar|7z)(?:$|[?#])/i;
const BLOCKED_REFERENCE_HOST_RX=/(^|\.)(wikipedia\.org|wikimedia\.org|namu\.wiki|researchgate\.net|academia\.edu|semanticscholar\.org|sciencedirect\.com|springer\.com|jstor\.org)$/i;
const SUPPLIER_ROLE_TERMS=Object.freeze({
  en:"manufacturer producer cooperative responsible seller local distributor official store",
  ko:"제조사 생산자 협동조합 책임 판매업체 지역 유통업체 공식 판매처",
  ja:"メーカー 生産者 協同組合 責任販売事業者 地域流通業者 公式販売店",
  "zh-Hans":"制造商 生产者 合作社 责任销售商 地方经销商 官方商店",
  "zh-Hant":"製造商 生產者 合作社 責任銷售商 地區經銷商 官方商店",
  es:"fabricante productor cooperativa vendedor responsable distribuidor local tienda oficial",
  pt:"fabricante produtor cooperativa vendedor responsável distribuidor local loja oficial",
  fr:"fabricant producteur coopérative vendeur responsable distributeur local boutique officielle",
  de:"Hersteller Erzeuger Genossenschaft verantwortlicher Verkäufer lokaler Händler offizieller Shop",
  it:"produttore cooperativa venditore responsabile distributore locale negozio ufficiale",
  nl:"fabrikant producent coöperatie verantwoordelijke verkoper lokale distributeur officiële winkel",
  ru:"производитель поставщик кооператив ответственный продавец местный дистрибьютор официальный магазин",
  uk:"виробник постачальник кооператив відповідальний продавець місцевий дистриб'ютор офіційний магазин",
  ar:"مصنع منتج تعاونية بائع مسؤول موزع محلي متجر رسمي",
  hi:"निर्माता उत्पादक सहकारी जिम्मेदार विक्रेता स्थानीय वितरक आधिकारिक स्टोर",
  bn:"প্রস্তুতকারক উৎপাদক সমবায় দায়িত্বশীল বিক্রেতা স্থানীয় পরিবেশক অফিসিয়াল স্টোর",
  ur:"مینوفیکچرر پروڈیوسر کوآپریٹو ذمہ دار فروخت کنندہ مقامی ڈسٹری بیوٹر آفیشل اسٹور",
  id:"produsen koperasi penjual bertanggung jawab distributor lokal toko resmi",
  ms:"pengeluar koperasi penjual bertanggungjawab pengedar tempatan kedai rasmi",
  vi:"nhà sản xuất hợp tác xã người bán chịu trách nhiệm nhà phân phối địa phương cửa hàng chính thức",
  th:"ผู้ผลิต สหกรณ์ ผู้ขายที่รับผิดชอบ ผู้จัดจำหน่ายท้องถิ่น ร้านค้าอย่างเป็นทางการ",
  tr:"üretici kooperatif sorumlu satıcı yerel distribütör resmi mağaza",
  sw:"mtengenezaji mzalishaji ushirika muuzaji anayewajibika msambazaji wa eneo duka rasmi"
});
const SUPPLIER_TEXT_RX=/(manufacturer|producer|cooperative|supplier|authorized distributor|local distributor|responsible seller|official store|제조사|생산자|협동조합|책임 판매|지역 유통|공식 판매처|メーカー|生産者|協同組合|責任販売|地域流通|製造商|制造商|生產者|生产者|合作社|責任銷售|责任销售|經銷商|经销商|fabricante|productor|coopérative|producteur|hersteller|erzeuger|genossenschaft|produttore|producent|производитель|поставщик|кооператив|مصنع|منتج|تعاونية|निर्माता|उत्पादक|सहकारी|প্রস্তুতকারক|উৎপাদক|সমবায়|مینوفیکچرر|پروڈیوسر|کوآپریٹو|produsen|koperasi|pengeluar|nhà sản xuất|hợp tác xã|ผู้ผลิต|สหกรณ์|üretici|kooperatif|mtengenezaji|mzalishaji|ushirika)/i;
const DIRECT_SALE_TEXT_RX=/(add to cart|buy now|checkout|shop now|online store|catalog|products|장바구니|바로구매|구매하기|온라인몰|상품목록|カート|購入|オンラインストア|购物车|立即购买|網上商店|网上商城|añadir al carrito|comprar ahora|cesta|loja online|acheter maintenant|panier|jetzt kaufen|warenkorb|acquista ora|carrello|winkelwagen|купить сейчас|корзина|اشتر الآن|سلة|अभी खरीदें|कार्ट|এখনই কিনুন|কার্ট|ابھی خریدیں|ٹوکری|beli sekarang|keranjang|mua ngay|giỏ hàng|ซื้อเลย|ตะกร้า|hemen al|sepet)/i;
const PAYMENT_TEXT_RX=/(payment|pay by|credit card|debit card|visa|mastercard|paypal|결제|신용카드|카드결제|支払い|決済|付款|支付|pago|paiement|zahlung|pagamento|betaling|оплата|الدفع|भुगतान|পেমেন্ট|ادائیگی|pembayaran|thanh toán|ชำระเงิน|ödeme)/i;
const LEGAL_IDENTITY_TEXT_RX=/(company registration|business registration|registered office|legal notice|terms and conditions|사업자등록|통신판매업|회사소개|법적 고지|特定商取引法|会社概要|企業信息|企业信息|工商信息|aviso legal|registro mercantil|mentions légales|impressum|registro imprese|bedrijfsgegevens|регистрац|реквизит|السجل التجاري|company profile)/i;
const REFUND_TEXT_RX=/(refund(?:s| policy)?|money[- ]back|환불|退款|返金|reembolso|remboursement|erstattung|rimborso|terugbetaling|возврат средств|استرداد|रिफंड|রিফান্ড|ریفنڈ|pengembalian dana|hoàn tiền|คืนเงิน|para iade)/i;
const EXCHANGE_TEXT_RX=/(exchange(?:s| policy)?|replacement|교환|交換|换货|換貨|cambio|échange|umtausch|sostituzione|omruilen|обмен|استبدال|विनिमय|বদল|تبدیلی|penukaran|đổi hàng|เปลี่ยนสินค้า|değişim)/i;
const WARRANTY_TEXT_RX=/(warranty|guarantee|after[- ]sales|service center|repair service|보증|품질보증|AS센터|애프터서비스|保証|售后|售後|garantía|garantie|garantiebedingungen|garanzia|garantie|гарантия|ضمان|वारंटी|ওয়ারেন্টি|وارنٹی|garansi|bảo hành|รับประกัน|garanti)/i;
const TRACKING_TEXT_RX=/(order tracking|track(?:ing)? number|shipment tracking|배송조회|운송장|배송 추적|追跡|配送追蹤|配送追踪|seguimiento del pedido|rastreamento|suivi de commande|sendungsverfolgung|tracciamento|track en trace|отслеживание|تتبع الشحنة|ऑर्डर ट्रैकिंग|অর্ডার ট্র্যাকিং|آرڈر ٹریکنگ|pelacakan pesanan|theo dõi đơn hàng|ติดตามคำสั่งซื้อ|sipariş takibi)/i;
const DELIVERY_COMMITMENT_TEXT_RX=/(estimated delivery|delivery time|ships within|business days|영업일 이내|배송 예정|도착 예정|お届け予定|発送予定|预计送达|預計送達|plazo de entrega|prazo de entrega|délai de livraison|lieferzeit|tempi di consegna|levertijd|срок доставки|موعد التسليم|डिलीवरी समय|ডেলিভারি সময়|ترسیل کا وقت|waktu pengiriman|thời gian giao hàng|ระยะเวลาจัดส่ง|teslimat süresi)/i;
const CONTACT_CHANNEL_TEXT_RX=/(mailto:|tel:|customer service|customer support|contact us|live chat|help desk|고객센터|문의하기|전화 상담|채팅 상담|お問い合わせ|客服|客戶服務|atención al cliente|service client|kundenservice|assistenza clienti|klantenservice|поддержка клиентов|خدمة العملاء|ग्राहक सेवा|কাস্টমার সেবা|کسٹمر سروس|layanan pelanggan|chăm sóc khách hàng|บริการลูกค้า|müşteri hizmetleri)/i;
const TERMS_PRIVACY_TEXT_RX=/(privacy policy|terms of service|terms and conditions|consumer terms|개인정보처리방침|이용약관|구매약관|プライバシーポリシー|利用規約|隐私政策|隱私政策|服务条款|服務條款|política de privacidad|termos e condições|politique de confidentialité|conditions générales|datenschutz|allgemeine geschäftsbedingungen|informativa sulla privacy|algemene voorwaarden|политика конфиденциальности|شروط الاستخدام|سياسة الخصوصية|गोपनीयता नीति|শর্তাবলী|شرائط و ضوابط|kebijakan privasi|chính sách bảo mật|นโยบายความเป็นส่วนตัว|gizlilik politikası)/i;
const AFFILIATE_TEXT_RX=/(affiliate|partner program|referral program|dealer program|wholesale inquiry|제휴|파트너스|추천인|도매문의|販売パートナー|提携|联盟计划|聯盟計畫|programa de afiliados|programme d'affiliation|partnerprogramm|programma di affiliazione|партнерская программа|برنامج الشركاء|सहबद्ध कार्यक्रम|অ্যাফিলিয়েট|افیلیئیٹ|program afiliasi|chương trình liên kết|โปรแกรมพันธมิตร|ortaklık programı)/i;
const CATALOG_BREADTH_TEXT_RX=/(all categories|shop by category|product categories|catalog|collections|전체 카테고리|상품 카테고리|제품군|カテゴリー|商品一覧|全部分类|全部分類|categorías|catálogo|catégories|catalogue|kategorien|produktkatalog|categorie|collecties|каталог|الفئات|الكتالوج|श्रेणियाँ|ক্যাটাগরি|زمرہ جات|kategori produk|danh mục sản phẩm|หมวดหมู่สินค้า|ürün kategorileri)/i;
const POLICY_LINK_TEXT_RX=/(return|refund|exchange|shipping|delivery|warranty|support|contact|terms|privacy|legal|반품|환불|교환|배송|보증|고객|문의|약관|개인정보|返品|返金|配送|保証|お問い合わせ|利用規約|退货|退款|配送|售后|客服|条款|隐私|devoluci|reembols|envío|entrega|garant|contact|privacidad|retour|rembourse|livraison|garantie|kundenservice|rückgabe|lieferung|datenschutz|resi|rimborso|spedizione|garanzia|возврат|доставка|гарантия|إرجاع|استرداد|توصيل|ضمان|वापसी|रिफंड|डिलीवरी|वारंटी|ফেরত|রিফান্ড|ডেলিভারি|واپسی|ریفنڈ|ترسیل|pengembalian|pengiriman|garansi|đổi trả|hoàn tiền|giao hàng|bảo hành|คืนสินค้า|คืนเงิน|จัดส่ง|รับประกัน|iade|teslimat|garanti)/i;
const PRODUCT_DETAIL_URL_RX=/\/(?:product|products|item|items|goods|detail|p|dp)\/[A-Za-z0-9._~-]+(?:\/|$|[?#])/i;


function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase();}
function array(v){return Array.isArray(v)?v:[];}
function plain(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function first(){for(const v of arguments){const t=text(v);if(t)return t;}return "";}
function withTimeout(promise,ms){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Object.assign(new Error("timeout"),{code:"TIMEOUT"})),ms);Promise.resolve(promise).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
function policyList(value,limit){const out=[];for(const raw of Array.isArray(value)?value:[]){const item=text(raw).replace(/\s+/g," ").slice(0,260);if(item&&!out.some(row=>row.toLowerCase()===item.toLowerCase()))out.push(item);if(out.length>=(limit||30))break;}return out;}
function policyHints(value){const raw=value&&typeof value==="object"&&!Array.isArray(value)?value:{};return{priorityDirections:policyList(raw.priorityDirections,12),avoidDirections:policyList(raw.avoidDirections,12),manualPriorityTargets:policyList(raw.manualPriorityTargets,30),manualBlockedTargets:policyList(raw.manualBlockedTargets,30),finalDecision:text(raw.finalDecision).replace(/\s+/g," ").slice(0,1200)};}
function cacheKey(geo,mode){const weights=CATEGORY_KEYS.map(key=>Number(geo&&geo.categoryWeights&&geo.categoryWeights[key])||0).join(","),hints=policyHints(geo&&geo.policyHints),policyKey=JSON.stringify(hints).slice(0,2400);return [VERSION,geo.country,geo.region||"-",mode||"front",text(geo&&geo.signalPlanVersion),weights,policyKey].join(":");}
function getCache(key){const row=CACHE.get(key);if(!row||Date.now()-row.at>(row.ttl||CACHE_TTL)){CACHE.delete(key);return null;}return row.value;}
function setCache(key,value){CACHE.set(key,{at:Date.now(),ttl:value&&value.snapshot?CACHE_TTL:90000,value});if(CACHE.size>120){const firstKey=CACHE.keys().next().value;CACHE.delete(firstKey);}return value;}
function extractItems(result){if(!result)return[];if(Array.isArray(result))return result;if(Array.isArray(result.items))return result.items;if(Array.isArray(result.results))return result.results;if(result.data&&Array.isArray(result.data.items))return result.data.items;return[];}

function stableOffset(value,size){
  let hash=0;for(const ch of String(value||""))hash=((hash<<5)-hash+ch.charCodeAt(0))|0;
  return size?Math.abs(hash)%size:0;
}
function localeList(country){
  const raw=text(COUNTRY_COMMERCE_LOCALE_OVERRIDES[country]||COUNTRY_LOCALES[country]||"en");
  const out=[];
  for(const value of raw.split(",").map(value=>value.trim()).filter(Boolean)){
    if(!out.some(existing=>existing.toLowerCase()===value.toLowerCase()))out.push(value);
  }
  // English is a bridge language, never a replacement for the country's local languages.
  if(!out.some(locale=>baseLocale(locale)==="en"))out.push("en");
  return out.slice(0,MAX_COUNTRY_LANGUAGE_PORTFOLIO);
}
function rotateList(values,offset){
  const list=(values||[]).slice();if(list.length<2)return list;
  const start=Math.abs(Number(offset)||0)%list.length;return list.slice(start).concat(list.slice(0,start));
}
function languagePriorityPlan(geo,locales){
  const all=(locales||[]).slice();const primary=all[0]||"en";
  const english=all.find(locale=>baseLocale(locale)==="en")||null;
  const additional=all.filter(locale=>locale!==primary&&(!english||locale!==english));
  const day=Math.floor(Date.now()/86400000);
  const rotating=rotateList(additional,stableOffset([geo.country,geo.region||"NATIONWIDE",day,"languages"].join("|"),additional.length));
  const ordered=[];const add=locale=>{if(locale&&!ordered.some(row=>row.toLowerCase()===locale.toLowerCase()))ordered.push(locale);};
  add(primary);
  add(rotating[0]);
  if(english&&english!==primary)add(english);
  add(rotating[1]);
  rotating.slice(2).forEach(add);
  all.forEach(add);
  return ordered.slice(0,Math.max(3,MAX_PROVIDER_CALLS));
}
function baseLocale(locale){return text(locale).split("-")[0].toLowerCase()||"en";}
function googleLocale(locale){return GOOGLE_LOCALE_ALIASES[locale]||locale||"en";}
function packForLocale(locale){return LOCAL_QUERY_PACKS[locale]||LOCAL_QUERY_PACKS[baseLocale(locale)]||null;}
function supplierRoleTerms(locale){return SUPPLIER_ROLE_TERMS[locale]||SUPPLIER_ROLE_TERMS[baseLocale(locale)]||SUPPLIER_ROLE_TERMS.en;}
function localCountryName(country,locale,fallback){
  try{const names=new Intl.DisplayNames([locale],{type:"region"});return text(names.of(country))||fallback||country;}catch(_e){return fallback||country;}
}
function queryCategories(geo){
  const day=Math.floor(Date.now()/86400000),size=LOCAL_QUERY_PACKS.en.categories.length;
  const offset=stableOffset([geo.country,geo.region||"NATIONWIDE",day].join("|"),size);
  const rotated=Array.from({length:size},(_,step)=>(offset+step)%size);
  const weights=geo&&geo.categoryWeights&&typeof geo.categoryWeights==="object"?geo.categoryWeights:{};
  const ranked=rotated.slice().sort((a,b)=>{const aw=Number(weights[CATEGORY_KEYS[a]])||0,bw=Number(weights[CATEGORY_KEYS[b]])||0;return bw-aw||rotated.indexOf(a)-rotated.indexOf(b);});
  const positive=ranked.filter(index=>(Number(weights[CATEGORY_KEYS[index]])||0)>0);
  const neutral=ranked.filter(index=>(Number(weights[CATEGORY_KEYS[index]])||0)>=0);
  const chosen=[];for(const index of positive.concat(neutral,ranked)){if(!chosen.includes(index))chosen.push(index);if(chosen.length>=3)break;}
  return chosen.length===3?chosen:[offset,(offset+1)%size,(offset+2)%size];
}
function parseOpenAiJson(raw){
  const value=text(raw);if(!value)return null;
  try{return JSON.parse(value);}catch(_e){}
  const start=value.indexOf("{");const end=value.lastIndexOf("}");
  if(start>=0&&end>start){try{return JSON.parse(value.slice(start,end+1));}catch(_e){}}
  return null;
}
function validLocalizedQuery(value){
  const q=text(value).replace(/\s+/g," ").slice(0,320);
  if(!q||/^https?:\/\//i.test(q)||/\bhttps?:\/\//i.test(q))return "";
  return q;
}
async function openAiLocalizedQueries(geo,locale,indices,localName){
  const key=envFirst("OPENAI_API_KEY","OPENAI_KEY");
  if(!key)return{queries:[],origin:"english-fallback",error:"OPENAI_API_KEY_missing"};
  const cacheKey=[geo.country,geo.region||"NATIONWIDE",locale,indices.join("-")].join("|");
  const cached=QUERY_LOCALIZATION_CACHE.get(cacheKey);
  if(cached&&Date.now()-cached.at<24*60*60*1000)return cached.value;
  const model=envFirst("IGDC_COUNTRY_QUERY_MODEL","IGDC_COUNTRY_AUTOMATION_MODEL","OPENAI_MODEL")||"gpt-4o-mini";
  const categories=indices.map(index=>LOCAL_QUERY_PACKS.en.categories[index]);
  const controller=typeof AbortController!=="undefined"?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),Math.min(24000,PROVIDER_FETCH_TIMEOUT)):null;
  try{
    const response=await fetch((envFirst("OPENAI_BASE_URL")||"https://api.openai.com/v1").replace(/\/+$/,"")+"/chat/completions",{
      method:"POST",signal:controller?controller.signal:undefined,
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},
      body:JSON.stringify({model,temperature:0.05,response_format:{type:"json_object"},messages:[
        {role:"system",content:"Create exactly three concise supplier-discovery search queries in the requested locale. Each query must seek real manufacturers, producers, cooperatives, responsible sellers, small or regional distributors, and official stores that conduct their own sales and clearly handle payment, delivery, returns, refunds, and customer support. Search for the responsible business, not individual product listings. Exclude reports, PDFs, news, research, wikis, major marketplaces, classifieds, and unrelated documents. Do not include or invent URLs. Return JSON only: {\"queries\":[\"...\",\"...\",\"...\"]}."},
        {role:"user",content:JSON.stringify({countryCode:geo.country,countryName:localName,region:geo.region||"NATIONWIDE",locale,categories})}
      ]})
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(text(body&&body.error&&body.error.message)||"OpenAI HTTP "+response.status),{code:"HTTP_"+response.status});
    const parsed=parseOpenAiJson(body&&body.choices&&body.choices[0]&&body.choices[0].message&&body.choices[0].message.content);
    const queries=(Array.isArray(parsed&&parsed.queries)?parsed.queries:[]).map(validLocalizedQuery).filter(Boolean).slice(0,3);
    if(queries.length<3)throw new Error("localized_query_count_invalid");
    const value={queries,origin:"openai-localized",error:null};QUERY_LOCALIZATION_CACHE.set(cacheKey,{at:Date.now(),value});
    return value;
  }catch(error){return{queries:[],origin:"english-fallback",error:providerErrorCode(error)};}
  finally{if(timer)clearTimeout(timer);}
}
async function queriesForLocale(geo,locale,indices){
  const fallbackName=geo.countryName||geo.country;const localName=localCountryName(geo.country,locale,fallbackName);
  const locality=[geo.region&&geo.region!=="NATIONWIDE"?geo.region:"",localName].filter(Boolean).join(" ");
  const pack=packForLocale(locale);
  if(pack){
    return{locale,localName,origin:"static-local-pack",error:null,queries:indices.map(index=>`${locality} ${pack.categories[index%pack.categories.length]} ${supplierRoleTerms(locale)} ${pack.commerce}`.replace(/\s+/g," ").trim())};
  }
  const ai=await openAiLocalizedQueries(geo,locale,indices,localName);
  if(ai.queries.length)return{locale,localName,origin:ai.origin,error:null,queries:ai.queries.map(q=>`${locality} ${q}`.replace(/\s+/g," ").trim())};
  const english=LOCAL_QUERY_PACKS.en;const englishName=localCountryName(geo.country,"en",fallbackName);
  const englishLocality=[geo.region&&geo.region!=="NATIONWIDE"?geo.region:"",englishName].filter(Boolean).join(" ");
  return{locale:"en",localName:englishName,origin:"english-language-fallback",error:ai.error,queries:indices.map(index=>`${englishLocality} ${english.categories[index]} ${supplierRoleTerms("en")} ${english.commerce}`.replace(/\s+/g," ").trim())};
}
function safePolicyTargetUrl(value){try{const u=new URL(text(value));if(!["https:","http:"].includes(u.protocol)||u.username||u.password||!u.hostname)return"";u.hash="";return u.toString();}catch(_e){return"";}}
function manualPolicySeeds(geo){const hints=policyHints(geo&&geo.policyHints),out=[];for(const target of hints.manualPriorityTargets){const url=safePolicyTargetUrl(target);if(!url)continue;let title="";try{title=new URL(url).hostname.replace(/^www\./,"");}catch(_e){}out.push({title:title||target,name:title||target,url,link:url,source:"administrator_policy_manual_seed",provider:"administrator",type:"site",payload:{source:"administrator_policy_manual_seed",country:geo.country,region:geo.region||"NATIONWIDE",manualPriority:true}});}return out.slice(0,12);}
function blockedByAdministratorPolicy(item,geo){const hints=policyHints(geo&&geo.policyHints),hay=[item&&item.title,item&&item.name,item&&item.url,item&&item.link,item&&item.supplierOfficialUrl].map(text).join(" ").toLowerCase();if(!hay)return false;return hints.manualBlockedTargets.concat(hints.avoidDirections).some(raw=>{const target=text(raw).toLowerCase();if(!target)return false;const url=safePolicyTargetUrl(target);if(url){try{return hay.includes(new URL(url).hostname.toLowerCase());}catch(_e){return false;}}return target.length>=3&&hay.includes(target);});}

async function discoveryQueryPlan(geo){
  const locales=localeList(geo.country);const indices=queryCategories(geo);
  const selectedLocales=languagePriorityPlan(geo,locales);
  let researchPlan={rows:[],seeds:[],diagnostics:null,version:null};
  if(SupplierResearchPlan&&typeof SupplierResearchPlan.buildPlan==="function"){
    try{researchPlan=SupplierResearchPlan.buildPlan({geo,locales,maxQueries:MAX_PROVIDER_CALLS,seedLimit:Math.min(20,MAX_PAGE_CHECKS)});}catch(_e){researchPlan={rows:[],seeds:[],diagnostics:{error:"research_plan_failed"},version:SupplierResearchPlan.VERSION||null};}
  }
  const bundles=await Promise.all(selectedLocales.map((locale,position)=>{
    const rotated=[indices[position%indices.length],indices[(position+1)%indices.length],indices[(position+2)%indices.length]];
    return queriesForLocale(geo,locale,rotated);
  }));
  const fallbackRows=[];const seen=new Set();
  const addRow=(bundle,queryIndex)=>{
    if(!bundle)return;const query=bundle.queries[queryIndex]||bundle.queries[0];if(!query)return;
    const key=bundle.locale.toLowerCase()+"|"+query.toLowerCase();if(seen.has(key))return;seen.add(key);
    fallbackRows.push({query,locale:bundle.locale,origin:bundle.origin,localName:bundle.localName,localizationError:bundle.error||null});
  };
  bundles.forEach(bundle=>addRow(bundle,0));
  let round=1;
  while(fallbackRows.length<MAX_PROVIDER_CALLS&&round<4){
    for(const bundle of bundles){addRow(bundle,round);if(fallbackRows.length>=MAX_PROVIDER_CALLS)break;}
    round+=1;
  }
  const guidedRows=array(researchPlan&&researchPlan.rows).map(row=>({query:text(row&&row.query),locale:text(row&&row.locale)||locales[0]||"en",origin:text(row&&row.origin)||"searchbank-psom-policy-plan",localName:text(row&&row.localName)||geo.countryName||geo.country,localizationError:text(row&&row.localizationError)||null})).filter(row=>row.query);
  const rows=geo.country==="KR"?guidedRows.concat(fallbackRows):guidedRows.slice(0,2).concat(fallbackRows,guidedRows.slice(2));
  const hints=policyHints(geo&&geo.policyHints),primaryBundle=bundles[0],priorityText=hints.manualPriorityTargets.filter(value=>!safePolicyTargetUrl(value)).concat(hints.priorityDirections).slice(0,3).join(" ");
  if(priorityText){const baseQuery=(guidedRows[0]&&guidedRows[0].query)||(primaryBundle&&primaryBundle.queries[0])||"";const policyQuery=(baseQuery+" "+priorityText).replace(/\s+/g," ").slice(0,900);rows.unshift({query:policyQuery,locale:(guidedRows[0]&&guidedRows[0].locale)||(primaryBundle&&primaryBundle.locale)||locales[0]||"en",origin:"administrator-policy-priority",localName:(guidedRows[0]&&guidedRows[0].localName)||(primaryBundle&&primaryBundle.localName)||geo.countryName||geo.country,localizationError:null});}
  const uniqueRows=[],rowSeen=new Set();for(const row of rows){const key=(row.locale+"|"+row.query).toLowerCase();if(rowSeen.has(key))continue;rowSeen.add(key);uniqueRows.push(row);if(uniqueRows.length>=MAX_PROVIDER_CALLS)break;}
  return{rows:uniqueRows,locales,selectedLocales:uniqueRows.map(row=>row.locale),primaryLocale:locales[0]||"en",categoryIndices:indices,categoryKeys:indices.map(index=>CATEGORY_KEYS[index]),categoryWeights:Object.assign({},geo.categoryWeights||{}),snapshotSeeds:array(researchPlan&&researchPlan.seeds),researchPlanVersion:text(researchPlan&&researchPlan.version)||null,researchDiagnostics:plain(researchPlan&&researchPlan.diagnostics),administratorPolicy:{active:!!(priorityText||hints.manualBlockedTargets.length),priorityTargets:hints.manualPriorityTargets,blockedTargets:hints.manualBlockedTargets,priorityDirections:hints.priorityDirections,avoidDirections:hints.avoidDirections}};
}
function envFirst(){
  for(const name of arguments){const value=text(process.env[name]);if(value)return value;}
  return "";
}
function stripHtml(value){return text(value).replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim();}
function providerErrorCode(error){
  const code=lower(error&&error.code||error&&error.name||error&&error.message||"provider_error");
  if(/abort|timeout/.test(code))return "timeout";
  const http=code.match(/http[_-]?(\d{3})/);if(http)return "http_"+http[1];
  return code.slice(0,80)||"provider_error";
}
function providerErrorDetail(error){return text(error&&error.detail||error&&error.message).slice(0,240)||null;}
function retryableProviderError(error){
  const code=lower(error&&error.code||error&&error.name||error&&error.message||"");
  return /abort|timeout|http[_-]?(408|409|425|429|5\d\d)/.test(code);
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function fetchJson(url,options,timeoutMs){
  const wait=Math.max(3000,timeoutMs||PROVIDER_FETCH_TIMEOUT);let lastError=null;
  for(let attempt=0;attempt<2;attempt+=1){
    const controller=typeof AbortController!=="undefined"?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),wait):null;
    try{
      const response=await fetch(url,Object.assign({},options||{},{signal:controller?controller.signal:undefined}));
      const raw=await response.text();let body={};try{body=raw?JSON.parse(raw):{};}catch(_e){body={raw:raw.slice(0,500)};}
      if(!response||!response.ok){
        const error=new Error("HTTP_"+(response&&response.status||0));error.code="HTTP_"+(response&&response.status||0);
        error.detail=text(body&&body.error&&body.error.message||body&&body.message||body&&body.error_description||body&&body.raw).slice(0,240);throw error;
      }
      return body;
    }catch(error){
      lastError=error;if(attempt===0&&retryableProviderError(error)){await delay(500);continue;}throw error;
    }finally{if(timer)clearTimeout(timer);}
  }
  throw lastError||new Error("provider_error");
}
function googleKeys(){return{key:envFirst("GOOGLE_CUSTOM_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_API_KEY","GOOGLE_CLOUD_API_KEY"),cx:envFirst("GOOGLE_CSE_ID","GOOGLE_CX","GOOGLE_SEARCH_ENGINE_ID","GOOGLE_CUSTOM_SEARCH_ENGINE_ID","GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID")};}
function naverKeys(){return{id:envFirst("NAVER_API_KEY","NAVER_CLIENT_ID","NAVER_SEARCH_CLIENT_ID","NAVER_OPENAPI_CLIENT_ID"),secret:envFirst("NAVER_CLIENT_SECRET","NAVER_API_SECRET","NAVER_SEARCH_CLIENT_SECRET","NAVER_OPENAPI_CLIENT_SECRET")};}
function resultText(item){return [item&&item.title,item&&item.name,item&&item.summary,item&&item.snippet,item&&item.url,item&&item.link].map(text).join(" ");}
function obviousNonCommerceReason(item){
  const rawUrl=first(item&&item.url,item&&item.link);const u=safeHttpUrl(rawUrl);
  if(!u)return "invalid_url";
  if(BLOCKED_DOCUMENT_EXT_RX.test(u.pathname+u.search))return "document_file";
  if(BLOCKED_REFERENCE_HOST_RX.test(u.hostname))return "reference_or_research_host";
  if(Core.isMarketplace(item,u.toString()))return "major_marketplace_or_aggregator";
  const hay=resultText(item);
  if(/\/(?:attachment|tag|author|category|archives?)\//i.test(u.pathname)||/wp-auto-importer|featured-image|첨부파일|꿈\s*해몽|fortune|horoscope/i.test(hay))return "blog_attachment_or_generated_page";
  if(/\/(?:blog|news|article|post|board|bbs)\//i.test(u.pathname)&&!SUPPLIER_TEXT_RX.test(hay)&&!COMMERCE_TEXT_RX.test(hay))return "article_or_blog_page";
  if(NON_COMMERCE_TEXT_RX.test(hay)&&!COMMERCE_TEXT_RX.test(hay))return "non_commerce_document";
  return "";
}
function commerceHeuristicScore(item){
  const rawUrl=first(item&&item.url,item&&item.link);const u=safeHttpUrl(rawUrl);if(!u)return-100;
  const hay=resultText(item);let score=0;
  if(SUPPLIER_TEXT_RX.test(hay))score+=14;
  if(COMMERCE_TEXT_RX.test(hay))score+=5;
  if(/\/(about|company|brand|manufacturer|producer|cooperative|wholesale|distribution|store|shop|catalog)(?:\/|$|[?#])/i.test(u.pathname+u.search))score+=7;
  if(DIRECT_SALE_TEXT_RX.test(hay))score+=5;
  if(PAYMENT_TEXT_RX.test(hay))score+=3;
  if(PRODUCT_DETAIL_URL_RX.test(u.pathname+u.search))score-=8;
  if(obviousNonCommerceReason(item))score-=50;
  return score;
}
function commerceFirst(items){return (items||[]).filter(item=>!obviousNonCommerceReason(item)).sort((a,b)=>commerceHeuristicScore(b)-commerceHeuristicScore(a));}
function guidedResearchResult(item){
  const payload=plain(item&&item.payload),origin=lower([payload.queryOrigin,payload.source,item&&item.source,item&&item.provider,item&&item.generatedBy].filter(Boolean).join(" "));
  return /searchbank-psom-policy-plan|country_discovery|searchbank_snapshot|administrator-policy|sanmaru/.test(origin);
}
function researchFirst(items){
  return (items||[]).filter(item=>{
    const reason=obviousNonCommerceReason(item);
    if(!reason)return true;
    if(!guidedResearchResult(item))return false;
    return !["invalid_url","document_file","reference_or_research_host","major_marketplace_or_aggregator"].includes(reason);
  }).sort((a,b)=>commerceHeuristicScore(b)-commerceHeuristicScore(a));
}
async function googleCountrySearch(planRow,geo,limit){
  const query=planRow&&planRow.query||text(planRow);const locale=planRow&&planRow.locale||"en";
  const keys=googleKeys();if(!keys.key||!keys.cx)return{provider:"google",query,locale,status:"not_configured",detail:"GOOGLE_API_KEY_or_GOOGLE_CSE_ID_missing",items:[]};
  const googleLang=googleLocale(locale);const negative=" -filetype:pdf -filetype:doc -filetype:ppt -filetype:xls -wikipedia -wiki -report -research -news";
  const params=new URLSearchParams({key:keys.key,cx:keys.cx,q:(query+negative).slice(0,900),num:String(Math.max(1,Math.min(10,limit||10))),start:"1",safe:"active",filter:"1",hl:googleLang,lr:"lang_"+googleLang});
  if(/^[A-Z]{2}$/.test(geo.country||"")){params.set("gl",geo.country.toLowerCase());params.set("cr","country"+geo.country);}
  try{
    let data;
    try{data=await fetchJson("https://www.googleapis.com/customsearch/v1?"+params.toString(),null,PROVIDER_FETCH_TIMEOUT);}
    catch(error){
      // Some Google language-restrict codes are narrower than real market usage.
      // Keep the local-language query and country scope, but retry once without lr.
      if(providerErrorCode(error)==="http_400"&&params.has("lr")){params.delete("lr");data=await fetchJson("https://www.googleapis.com/customsearch/v1?"+params.toString(),null,PROVIDER_FETCH_TIMEOUT);}
      else throw error;
    }
    const items=researchFirst((Array.isArray(data.items)?data.items:[]).map(row=>{
      const map=row&&row.pagemap||{};const thumb=first(map.cse_image&&map.cse_image[0]&&map.cse_image[0].src,map.cse_thumbnail&&map.cse_thumbnail[0]&&map.cse_thumbnail[0].src);
      return{title:stripHtml(row&&row.title),url:text(row&&row.link),link:text(row&&row.link),summary:stripHtml(row&&row.snippet),snippet:stripHtml(row&&row.snippet),source:"google_country_discovery",provider:"google",type:"web",thumbnail:thumb,image:thumb,payload:{source:"google",country:geo.country,query,queryLocale:locale,queryOrigin:planRow&&planRow.origin||"unknown"}};
    }).filter(row=>row.title&&row.url));
    return{provider:"google",query,locale,status:items.length?"ok":"empty",detail:null,items};
  }catch(error){return{provider:"google",query,locale,status:providerErrorCode(error),detail:providerErrorDetail(error),items:[]};}
}
async function naverCountrySearch(planRow,geo,limit){
  const query=planRow&&planRow.query||text(planRow);const locale=planRow&&planRow.locale||"ko";
  const keys=naverKeys();if(!keys.id||!keys.secret)return{provider:"naver",query,locale,status:"not_configured",detail:"NAVER_API_KEY_or_NAVER_CLIENT_SECRET_missing",items:[]};
  const params=new URLSearchParams({query,display:String(Math.max(1,Math.min(100,limit||20))),start:"1"});
  try{
    const data=await fetchJson("https://openapi.naver.com/v1/search/webkr.json?"+params.toString(),{headers:{"X-Naver-Client-Id":keys.id,"X-Naver-Client-Secret":keys.secret}},PROVIDER_FETCH_TIMEOUT);
    const items=researchFirst((Array.isArray(data.items)?data.items:[]).map(row=>({title:stripHtml(row&&row.title),url:text(row&&row.link),link:text(row&&row.link),summary:stripHtml(row&&row.description),snippet:stripHtml(row&&row.description),source:"naver_country_discovery",provider:"naver",type:"web",payload:{source:"naver",country:geo.country,query,queryLocale:locale,queryOrigin:planRow&&planRow.origin||"unknown"}})).filter(row=>row.title&&row.url));
    return{provider:"naver",query,locale,status:items.length?"ok":"empty",detail:null,items};
  }catch(error){return{provider:"naver",query,locale,status:providerErrorCode(error),detail:providerErrorDetail(error),items:[]};}
}
async function runDirectProviderDiscovery(geo,targetLimit,queryPlan){
  const rows=queryPlan&&queryPlan.rows||[];const tasks=[];const limit=Math.max(1,Math.min(50,Number(targetLimit||20)||20));
  function add(task){if(tasks.length<MAX_PROVIDER_CALLS)tasks.push(task);}
  if(geo.country==="KR"){
    const koreanRows=rows.filter(row=>baseLocale(row&&row.locale)==="ko");
    const bridgeRows=rows.filter(row=>baseLocale(row&&row.locale)!=="ko");
    const naverRows=(koreanRows.length?koreanRows:rows).slice(0,Math.min(4,MAX_PROVIDER_CALLS));
    for(const row of naverRows)add(naverCountrySearch(row,geo,Math.min(20,Math.max(limit,20))));
    const googleRows=(koreanRows.slice(0,1).concat(bridgeRows.slice(0,1))).filter(Boolean);
    for(const row of googleRows)add(googleCountrySearch(row,geo,Math.min(10,limit)));
  }else{
    for(let index=0;index<rows.length&&tasks.length<MAX_PROVIDER_CALLS;index+=1)add(googleCountrySearch(rows[index],geo,Math.min(10,limit)));
  }
  if(!tasks.length)return{items:[],trace:[{source:"country-provider",status:"not_configured",count:0,timeoutMs:PROVIDER_FETCH_TIMEOUT,locales:queryPlan&&queryPlan.locales||[]}]} ;
  const settled=await Promise.all(tasks);
  return{items:researchFirst(settled.flatMap(row=>row.items||[])),trace:settled.map(row=>({source:row.provider,query:row.query,queryLocale:row.locale,queryOrigin:rows.find(plan=>plan.query===row.query&&plan.locale===row.locale)&&rows.find(plan=>plan.query===row.query&&plan.locale===row.locale).origin||"unknown",status:row.status,detail:row.detail||null,count:(row.items||[]).length,timeoutMs:PROVIDER_FETCH_TIMEOUT}))};
}
async function runSanmaruDiscovery(event,geo,targetLimit){
  const queryPlan=await discoveryQueryPlan(geo);let Sanmaru=null;try{Sanmaru=require("./sanmaru_engine_v2");}catch(_e){}
  const providerPromise=runDirectProviderDiscovery(geo,targetLimit,queryPlan);
  const snapshotSeeds=array(queryPlan&&queryPlan.snapshotSeeds);
  const researchTrace={source:"searchbank-psom-policy-plan",status:"ok",count:snapshotSeeds.length,queries:array(queryPlan&&queryPlan.rows).length,version:text(queryPlan&&queryPlan.researchPlanVersion)||null,detail:plain(queryPlan&&queryPlan.researchDiagnostics)};
  if(!Sanmaru||typeof Sanmaru.runEngine!=="function"){
    const provider=await providerPromise,seeds=manualPolicySeeds(geo),items=researchFirst(seeds.concat(snapshotSeeds,provider.items||[])).filter(item=>!blockedByAdministratorPolicy(item,geo));
    return{items,trace:[{source:"administrator-policy",status:seeds.length?"seeded":"empty",count:seeds.length},researchTrace,{source:"sanmaru",status:"unavailable",count:0,locales:queryPlan.locales,selectedLocales:queryPlan.selectedLocales,primaryLocale:queryPlan.primaryLocale}].concat(provider.trace)};
  }
  const tasks=queryPlan.rows.slice(0,MAX_LIVE_QUERIES).map(async row=>{
    const q=row.query;
    try{
      const result=await withTimeout(Sanmaru.runEngine(event||{}, {
        q,query:q,country:geo.country,region:geo.region||undefined,limit:18,candidatePool:48,language:row.locale,locale:row.locale,
        type:"site",channel:"commerce",entity:"supplier",external:"off",directExternal:"0",noExternal:"1",noMedia:"1",deep:"0",timeoutMs:Math.max(8000,DISCOVERY_TIMEOUT-1500),
        from:"regional-brokerage-autoselector",source:"regional-brokerage-autoselector",
        regionalBrokerageSupply:"1",noAnalytics:"1",noRevenue:"1",readOnly:"1",noWrite:"1",noSync:"1",writeMode:"readonly"
      }),DISCOVERY_TIMEOUT);
      const items=researchFirst(extractItems(result));return{row,items,status:items.length?"ok":"empty"};
    }catch(error){return{row,items:[],status:providerErrorCode(error),detail:providerErrorDetail(error)};}
  });
  const [settled,provider]=await Promise.all([Promise.all(tasks),providerPromise]),seeds=manualPolicySeeds(geo);
  const items=researchFirst(seeds.concat(snapshotSeeds,settled.flatMap(x=>x.items||[]),provider.items||[])).filter(item=>!blockedByAdministratorPolicy(item,geo));
  return{items,trace:[{source:"administrator-policy",status:seeds.length?"seeded":"empty",count:seeds.length,blockedTargets:policyHints(geo&&geo.policyHints).manualBlockedTargets.length},researchTrace].concat(settled.map(x=>({source:"sanmaru",query:x.row.query,queryLocale:x.row.locale,queryOrigin:x.row.origin,status:x.status,detail:x.detail||x.row.localizationError||null,count:(x.items||[]).length,timeoutMs:DISCOVERY_TIMEOUT})),provider.trace||[])};
}

function safeHttpUrl(raw){
  try{const u=new URL(raw);if(u.protocol!=="https:"&&u.protocol!=="http:")return null;const host=u.hostname.toLowerCase();if(!host||host==="localhost"||host.endsWith(".local")||/^\d{1,3}(\.\d{1,3}){3}$/.test(host)||host.includes(":"))return null;return u;}catch(_e){return null;}
}
function htmlTextScore(value){
  const t=String(value||"");
  return{
    shipping:/(shipping|delivery|ship to|dispatch|배송|배달|출고|配達|配送|発送|送貨|送货|envío|entrega|livraison|expédition|lieferung|versand|spedizione|bezorging|доставка|توصيل|شحن|डिलीवरी|वितरण|ডেলিভারি|ترسیل|pengiriman|penghantaran|giao hàng|จัดส่ง|usafirishaji)/i.test(t),
    returns:/(return(?:s| policy)?|exchange(?:s)?|반품|교환|返品|交換|退貨|退货|devoluciones|retours|rückgabe|resi|retourneren|возврат|обмен|إرجاع|वापसी|ফেরত|واپسی|pengembalian|pemulangan|đổi trả|คืนสินค้า|marejesho)/i.test(t),
    refund:REFUND_TEXT_RX.test(t),
    exchange:EXCHANGE_TEXT_RX.test(t),
    warranty:WARRANTY_TEXT_RX.test(t),
    tracking:TRACKING_TEXT_RX.test(t),
    deliveryCommitment:DELIVERY_COMMITMENT_TEXT_RX.test(t),
    service:/(customer service|customer support|contact us|support center|help desk|고객센터|고객 지원|문의|カスタマーサービス|お問い合わせ|客服|客戶服務|atención al cliente|servicio al cliente|service client|kundenservice|assistenza clienti|klantenservice|поддержка клиентов|خدمة العملاء|ग्राहक सेवा|কাস্টমার সেবা|کسٹمر سروس|layanan pelanggan|khidmat pelanggan|chăm sóc khách hàng|บริการลูกค้า|huduma kwa wateja)/i.test(t),
    contactChannel:CONTACT_CHANNEL_TEXT_RX.test(t),
    payment:PAYMENT_TEXT_RX.test(t),
    securePayment:/(secure checkout|secure payment|ssl payment|3d secure|pci dss|안전결제|보안결제|安全な支払い|安全支付|pago seguro|paiement sécurisé|sichere zahlung|pagamento sicuro|veilige betaling|безопасная оплата|دفع آمن|सुरक्षित भुगतान|নিরাপদ পেমেন্ট|محفوظ ادائیگی|pembayaran aman|thanh toán an toàn|ชำระเงินปลอดภัย|güvenli ödeme)/i.test(t),
    directSales:DIRECT_SALE_TEXT_RX.test(t),
    legalIdentity:LEGAL_IDENTITY_TEXT_RX.test(t),
    termsPrivacy:TERMS_PRIVACY_TEXT_RX.test(t),
    affiliatePotential:AFFILIATE_TEXT_RX.test(t),
    catalogBreadth:CATALOG_BREADTH_TEXT_RX.test(t),
    supplierRole:SUPPLIER_TEXT_RX.test(t),
    manufacturer:/(manufacturer|factory|제조사|제조업체|メーカー|製造商|制造商|fabricante|fabricant|hersteller|produttore|производитель|مصنع|निर्माता|প্রস্তুতকারক|مینوفیکچرر|produsen|pengeluar|nhà sản xuất|ผู้ผลิต|üretici|mtengenezaji)/i.test(t),
    producer:/(producer|grower|farm|생산자|농장|양식장|生産者|農場|生產者|生产者|productor|producteur|erzeuger|produttore|производитель|منتج|उत्पादक|উৎপাদক|پروڈیوسر|produsen|nhà sản xuất|ผู้ผลิต|mzalishaji)/i.test(t),
    cooperative:/(cooperative|co-op|협동조합|농협|축협|수협|協同組合|合作社|cooperativa|coopérative|genossenschaft|кооператив|تعاونية|सहकारी|সমবায়|کوآپریٹو|koperasi|hợp tác xã|สหกรณ์|kooperatif|ushirika)/i.test(t),
    distributor:/(authorized distributor|local distributor|wholesale distributor|총판|공식 유통|지역 유통|대리점|卸売|販売代理店|經銷商|经销商|distribuidor|distributeur|händler|distributore|distributeur|дистрибьютор|موزع|वितरक|পরিবেশক|ڈسٹری بیوٹر|distributor|pengedar|nhà phân phối|ผู้จัดจำหน่าย|distribütör|msambazaji)/i.test(t),
    retailer:/(responsible seller|official seller|official store|책임 판매|공식 판매처|직영몰|公式販売店|公式ストア|官方商店|vendedor responsable|boutique officielle|offizieller shop|negozio ufficiale|officiële winkel|официальный магазин|بائع مسؤول|متجر رسمي|जिम्मेदार विक्रेता|অফিসিয়াল স্টোর|ذمہ دار فروخت کنندہ|toko resmi|kedai rasmi|cửa hàng chính thức|ร้านค้าอย่างเป็นทางการ|sorumlu satıcı|duka rasmi)/i.test(t),
    official:/(official|authorized|company profile|about us|공식|회사소개|법인|公式|会社概要|官方|企業信息|企业信息|oficial|officiel|offiziell|ufficiale|officieel|официальный|رسمي|आधिकारिक|অফিসিয়াল|آفیشل|resmi|rasmi|chính thức|ทางการ)/i.test(t)
  };
}
function policyPageUrls(html,baseUrl){
  const base=safeHttpUrl(baseUrl);if(!base)return[];
  const out=[],seen=new Set();const rx=/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=rx.exec(String(html||"")))){
    const label=stripHtml(m[2]);const href=text(m[1]);if(!POLICY_LINK_TEXT_RX.test(label+" "+href))continue;
    let u;try{u=new URL(href,base.toString());}catch(_e){continue;}
    if(!sameSite(base.toString(),u.toString())||!["http:","https:"].includes(u.protocol))continue;
    u.hash="";const key=u.toString();if(seen.has(key)||key===base.toString())continue;seen.add(key);out.push(key);if(out.length>=4)break;
  }
  return out;
}
async function fetchPolicyText(url,controller){
  try{
    const response=await fetch(url,{redirect:"follow",signal:controller.signal,headers:{"user-agent":"IGDC-MARU-BrokerageVerifier/1.2 (+https://igdcglobal.com)"}});
    if(!response.ok)return"";const type=String(response.headers.get("content-type")||"");if(!/text\/html|application\/xhtml\+xml/i.test(type))return"";
    const length=Number(response.headers.get("content-length")||0);if(length>250000)return"";return(await response.text()).slice(0,250000);
  }catch(_e){return"";}
}
function flattenJsonLd(value,out){if(!value)return;if(Array.isArray(value)){value.forEach(v=>flattenJsonLd(v,out));return;}if(typeof value!=="object")return;out.push(value);if(Array.isArray(value["@graph"]))flattenJsonLd(value["@graph"],out);}
function jsonLdEvidence(html,geo){
  const nodes=[];const rx=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=rx.exec(html))){try{flattenJsonLd(JSON.parse(m[1]),nodes);}catch(_e){}}
  let org=false,product=false,offer=false,matchCountry=false,matchRegion=false,detectedCountry="",detectedRegion="",orgName="",orgUrl="",orgType="";
  for(const node of nodes){
    const type=Array.isArray(node["@type"])?node["@type"].join(" "):String(node["@type"]||"");
    if(/Organization|LocalBusiness|Store|Farm|WholesaleStore|OnlineStore|Corporation|Brand/i.test(type)){
      org=true;orgType=orgType||type;orgName=orgName||text(node.name||node.legalName);orgUrl=orgUrl||text(node.url||node.sameAs&&node.sameAs[0]);
    }
    if(/Product|ItemList/i.test(type))product=true;
    if(/Offer|AggregateOffer/i.test(type)||node.offers)offer=true;
    const address=node.address||{};
    const addressCountry=address&&typeof address.addressCountry==="object"?address.addressCountry.name||address.addressCountry.code:address.addressCountry;
    const areaCountry=node.areaServed&&typeof node.areaServed==="object"?node.areaServed.name||node.areaServed.addressCountry:node.areaServed;
    const country=Core.normalizeCountry(addressCountry||areaCountry||node.countryOfOrigin||"");
    const region=Core.normalizeRegion(address.addressRegion||node.areaServedRegion||"",country||geo.country);
    if(country){detectedCountry=detectedCountry||country;if(geo.country&&country===geo.country)matchCountry=true;}
    if(region){detectedRegion=detectedRegion||region;if(geo.region&&region===geo.region)matchRegion=true;}
  }
  return{org,product,offer,matchCountry,matchRegion,country:detectedCountry,region:detectedRegion,orgName,orgUrl,orgType};
}
function sameSite(left,right){
  const a=safeHttpUrl(left),b=safeHttpUrl(right);if(!a||!b)return false;
  const ah=a.hostname.toLowerCase().replace(/^www\./,""),bh=b.hostname.toLowerCase().replace(/^www\./,"");
  return ah===bh||ah.endsWith("."+bh)||bh.endsWith("."+ah);
}
function supplierType(words,ld){
  if(words.cooperative)return"cooperative";
  if(words.producer||/Farm/i.test(ld.orgType||""))return"producer";
  if(words.manufacturer)return"manufacturer";
  if(words.distributor||/Wholesale/i.test(ld.orgType||""))return"regional_distributor";
  if(words.retailer||/Store|LocalBusiness|OnlineStore/i.test(ld.orgType||""))return"responsible_seller";
  return ld.org?"responsible_business":"unclassified";
}
function supplierLandingUrl(finalUrl,ld){
  if(ld.orgUrl&&sameSite(finalUrl.toString(),ld.orgUrl)){const official=safeHttpUrl(ld.orgUrl);if(official)return official.toString();}
  return finalUrl.origin+"/";
}
function researchMissingEvidence(evidence){
  const ev=plain(evidence);const required=[
    ["official_business",ev.official],["responsible_entity",ev.responsibleEntity],["direct_sales",ev.directSales],
    ["supplier_payment",ev.payment],["secure_transport",ev.secureTransport],["shipping_policy",ev.shipping],
    ["return_policy",ev.returns],["refund_policy",ev.refund],["customer_support",ev.service],
    ["contact_channel",ev.contactChannel],["legal_identity",ev.legalIdentity]
  ];
  return required.filter(row=>row[1]!==true).map(row=>row[0]);
}
function researchCandidateShell(item,geo,status,error){
  const originalUrl=Core.externalUrl(item),u=safeHttpUrl(originalUrl);if(!u)return item;
  const marketplace=Core.isMarketplace(item,u.toString());const hay=resultText(item);
  const supplierSignal=SUPPLIER_TEXT_RX.test(hay);const commerceSignal=COMMERCE_TEXT_RX.test(hay)||commerceHeuristicScore(item)>=5;
  const researchEligible=!marketplace&&!obviousNonCommerceReason(item)&&(supplierSignal||commerceSignal||guidedResearchResult(item));
  const secureTransport=u.protocol==="https:";const detectedCountry=Core.normalizeCountry(item&&item.distributionMarketCountry||item&&item.sellerMarketCountry||item&&item.marketCountry||item&&item.country||item&&item.geo&&item.geo.country);
  const detectedRegion=Core.normalizeRegion(item&&item.distributionMarketRegion||item&&item.sellerRegion||item&&item.region||item&&item.geo&&item.geo.state,detectedCountry||geo.country);
  const evidence=Object.assign({},item&&item.brokerageVerification||{}, {
    automated:true,inspectedAt:new Date().toISOString(),discoveredFromUrl:originalUrl,inspectedUrl:null,supplierOfficialUrl:u.toString(),
    official:/official|공식|직영|본사|회사소개|사업자/i.test(hay),responsibleEntity:supplierSignal,directSales:commerceSignal,payment:false,secureTransport,
    shipping:/배송|택배|delivery|shipping|출고/i.test(hay),returns:/반품|교환|return|exchange/i.test(hay),refund:/환불|refund/i.test(hay),
    service:/고객센터|문의|customer service|support|contact/i.test(hay),contactChannel:/전화|이메일|문의|contact|고객센터/i.test(hay),legalIdentity:/사업자|법인|회사|corporation|company/i.test(hay),
    marketplace,majorPlatform:marketplace,supplierType:supplierSignal?"research_supplier":(guidedResearchResult(item)?"query_guided_research":"unclassified"),
    supplierReviewEligible:false,supplierResearchEligible:researchEligible,trustEvidenceReady:false,provisionalTrustScore:researchEligible?Math.max(20,Math.min(55,commerceHeuristicScore(item)+28)):0,
    researchStatus:text(status)||"page_check_pending",researchError:text(error).slice(0,180)||null,policyPagesInspected:0,policyUrls:[],
    legalVerificationComplete:false,contractVerificationComplete:false,deliveryPerformanceVerified:false,returnRefundPerformanceVerified:false,supportPerformanceVerified:false,
    privateQueueOnly:true,publicEligible:false
  });
  evidence.researchMissingEvidence=researchMissingEvidence(evidence);
  const title=first(item&&item.supplierName,item&&item.organizationName,item&&item.title,item&&item.name,u.hostname.replace(/^www\./,""));
  const profile={name:title,type:evidence.supplierType,officialUrl:u.toString(),targetCountry:geo.country,targetRegion:geo.region||"NATIONWIDE",detectedCountry:detectedCountry||null,detectedRegion:detectedRegion||null,directSales:evidence.directSales,handlesPayment:false,handlesShipping:evidence.shipping,handlesReturns:evidence.returns,handlesRefunds:evidence.refund,handlesCustomerSupport:evidence.service,responsibleForTransaction:true,adminVerificationRequired:true,performanceVerificationRequired:true,productCatalogImportAllowed:false,researchStatus:evidence.researchStatus};
  return Object.assign({},item,{title,name:title,url:u.toString(),link:u.toString(),supplierOfficialUrl:u.toString(),distributionMarketCountry:detectedCountry||undefined,distributionMarketRegion:detectedRegion||undefined,officialSource:evidence.official,sellerVerified:false,igdcSupplierCandidate:true,igdcProductCandidate:false,supplierProfile:profile,brokerageVerification:evidence,sourceTrust:Math.max(Number(item&&item.sourceTrust||0),Number(evidence.provisionalTrustScore||0)/100)});
}
async function inspectCandidate(item,geo){
  const discoveredUrl=Core.externalUrl(item);if(!discoveredUrl)return item;
  const u=safeHttpUrl(discoveredUrl);if(!u)return item;
  let timer=null;
  try{
    const controller=new AbortController();timer=setTimeout(()=>controller.abort(),PAGE_CHECK_TIMEOUT);
    const response=await fetch(u.toString(),{redirect:"follow",signal:controller.signal,headers:{"user-agent":"IGDC-MARU-BrokerageVerifier/1.3 (+https://igdcglobal.com)"}});
    if(!response.ok)return researchCandidateShell(item,geo,"page_http_"+response.status,null);
    const finalUrl=safeHttpUrl(response.url||u.toString());if(!finalUrl)return researchCandidateShell(item,geo,"redirect_url_invalid",null);
    const type=String(response.headers.get("content-type")||"");if(!/text\/html|application\/xhtml\+xml/i.test(type))return researchCandidateShell(item,geo,"non_html_page",type);
    const length=Number(response.headers.get("content-length")||0);if(length>550000)return researchCandidateShell(item,geo,"page_too_large",String(length));
    const html=(await response.text()).slice(0,550000);
    const policyUrls=policyPageUrls(html,finalUrl.toString());
    const policyPages=(await Promise.all(policyUrls.map(url=>fetchPolicyText(url,controller)))).filter(Boolean);
    const combinedHtml=[html].concat(policyPages).join("\n");
    const words=htmlTextScore(combinedHtml),ld=jsonLdEvidence(html,geo),marketplace=Core.isMarketplace(item,finalUrl.toString());
    const responsibleEntity=(words.supplierRole||ld.org)&&(words.official||ld.org);
    const directSales=words.directSales||ld.product||ld.offer;
    const secureTransport=finalUrl.protocol==="https:";
    const searchText=resultText(item);
    const researchEligible=!marketplace&&!obviousNonCommerceReason(item)&&((responsibleEntity||words.supplierRole||ld.org||SUPPLIER_TEXT_RX.test(searchText))&&(directSales||COMMERCE_TEXT_RX.test(combinedHtml)||COMMERCE_TEXT_RX.test(searchText)));
    const reviewEligible=researchEligible&&responsibleEntity&&directSales&&words.shipping&&(words.returns||words.refund)&&words.service&&(words.payment||words.legalIdentity||ld.org);
    const trustEvidenceReady=reviewEligible&&words.payment&&words.refund&&words.legalIdentity&&words.contactChannel&&secureTransport;
    const detectedCountry=ld.country||Core.normalizeCountry(item.distributionMarketCountry||item.sellerMarketCountry||item.marketCountry||item.country||item.geo&&item.geo.country);
    const detectedRegion=ld.region||Core.normalizeRegion(item.distributionMarketRegion||item.sellerRegion||item.region||item.geo&&item.geo.state,detectedCountry);
    const officialUrl=supplierLandingUrl(finalUrl,ld),typeCode=supplierType(words,ld),now=new Date().toISOString();
    const provisionalTrustScore=Math.max(0,Math.min(100,Math.round(
      (words.official||ld.org?8:0)+(responsibleEntity?14:0)+(directSales?10:0)+(words.payment?8:0)+(secureTransport?5:0)+
      (words.shipping?8:0)+(words.tracking?5:0)+(words.deliveryCommitment?4:0)+(words.returns?8:0)+(words.refund?8:0)+
      (words.service?8:0)+(words.contactChannel?5:0)+(words.legalIdentity||ld.org?7:0)+(words.termsPrivacy?4:0)+(words.warranty?3:0)+
      (detectedCountry&&detectedCountry===geo.country?3:0)-(marketplace?100:0)
    )));
    const evidence=Object.assign({},item.brokerageVerification||{}, {
      automated:true,inspectedAt:now,discoveredFromUrl:discoveredUrl,inspectedUrl:finalUrl.toString(),supplierOfficialUrl:officialUrl,
      official:words.official||ld.org,responsibleEntity,directSales,payment:words.payment,secureTransport,securePaymentSignal:words.securePayment,
      shipping:words.shipping,tracking:words.tracking,deliveryCommitment:words.deliveryCommitment,returns:words.returns,refund:words.refund,exchange:words.exchange,
      service:words.service,contactChannel:words.contactChannel,warranty:words.warranty,termsPrivacy:words.termsPrivacy,legalIdentity:words.legalIdentity||ld.org,
      affiliatePotential:words.affiliatePotential,catalogBreadth:words.catalogBreadth,policyPagesInspected:policyPages.length,policyUrls:policyUrls.slice(0,4),
      marketplace,majorPlatform:marketplace,jsonLdOrganization:ld.org,jsonLdProduct:ld.product,jsonLdOffer:ld.offer,supplierType:typeCode,
      supplierReviewEligible:reviewEligible,supplierResearchEligible:researchEligible,trustEvidenceReady,provisionalTrustScore,
      researchStatus:reviewEligible?"evidence_ready_for_review":"evidence_incomplete",researchError:null,
      legalVerificationComplete:false,contractVerificationComplete:false,deliveryPerformanceVerified:false,returnRefundPerformanceVerified:false,supportPerformanceVerified:false,
      privateQueueOnly:true,publicEligible:false
    });
    evidence.researchMissingEvidence=researchMissingEvidence(evidence);
    const profile={
      name:ld.orgName||first(item&&item.supplierName,item&&item.organizationName,item&&item.title,item&&item.name),type:typeCode,officialUrl,
      targetCountry:geo.country,targetRegion:geo.region||"NATIONWIDE",detectedCountry:detectedCountry||null,detectedRegion:detectedRegion||null,
      directSales,handlesPayment:words.payment,handlesShipping:words.shipping,handlesReturns:words.returns,handlesRefunds:words.refund,handlesCustomerSupport:words.service,
      offersTracking:words.tracking,statesDeliveryCommitment:words.deliveryCommitment,offersWarrantyOrAfterSales:words.warranty,
      catalogBreadthSignal:words.catalogBreadth,affiliatePotential:words.affiliatePotential,
      responsibleForTransaction:true,adminVerificationRequired:true,performanceVerificationRequired:true,productCatalogImportAllowed:false,
      researchStatus:evidence.researchStatus,researchMissingEvidence:evidence.researchMissingEvidence
    };
    return Object.assign({},item,{
      title:profile.name||first(item&&item.title,item&&item.name),name:profile.name||first(item&&item.name,item&&item.title),url:officialUrl,link:officialUrl,supplierOfficialUrl:officialUrl,
      distributionMarketCountry:detectedCountry||undefined,distributionMarketRegion:detectedRegion||undefined,
      availabilityCountries:item.availabilityCountries||item.shippingCountries||(detectedCountry?[detectedCountry]:undefined),
      availabilityRegions:item.availabilityRegions||item.shippingRegions||(detectedRegion?[detectedRegion]:undefined),
      nationalAvailability:item.nationalAvailability===true||(!detectedRegion&&detectedCountry===geo.country&&ld.matchCountry),
      officialSource:evidence.official,sellerVerified:false,igdcSupplierCandidate:true,igdcProductCandidate:false,supplierProfile:profile,brokerageVerification:evidence,
      shippingAvailable:words.shipping,shippingTrackingAvailable:words.tracking,deliveryCommitmentAvailable:words.deliveryCommitment,
      returnPolicyAvailable:words.returns,refundPolicyAvailable:words.refund,customerServiceAvailable:words.service,paymentAvailable:words.payment,
      sourceTrust:Math.max(Number(item.sourceTrust||0),provisionalTrustScore/100)
    });
  }catch(_e){return researchCandidateShell(item,geo,"page_check_failed",_e&&(_e.code||_e.name||_e.message));}
  finally{if(timer)clearTimeout(timer);}
}
async function inspectLive(items,geo){
  const unique=[];const seen=new Set();
  for(const item of researchFirst(items||[])){
    const url=Core.externalUrl(item);if(!url||seen.has(url))continue;seen.add(url);unique.push(item);if(unique.length>=MAX_PAGE_CHECKS)break;
  }
  return await Promise.all(unique.map(item=>inspectCandidate(item,geo)));
}
function privateReviewPool(rawItems,inspectedItems,geo,limit){
  const inspected=new Map();
  for(const item of inspectedItems||[]){
    const original=text(item&&item.brokerageVerification&&item.brokerageVerification.discoveredFromUrl),official=Core.externalUrl(item);
    if(original)inspected.set(original,item);if(official)inspected.set(official,item);
  }
  const out=[];const seen=new Set();
  for(const raw of researchFirst(rawItems||[])){
    const originalUrl=Core.externalUrl(raw),item=inspected.get(originalUrl)||researchCandidateShell(raw,geo,"page_check_pending",null);
    const evidence=item&&item.brokerageVerification||{},officialUrl=Core.externalUrl(item),profile=item&&item.supplierProfile||{};
    if(!officialUrl||seen.has(officialUrl)||evidence.marketplace===true||(evidence.supplierReviewEligible!==true&&evidence.supplierResearchEligible!==true))continue;
    const sourceText=lower([item.source,item.provider,item.sourceType,item.generatedBy].filter(Boolean).join(" "));
    if(/sanmaru-route|sanmaru-opening|provider-page-window|provider-window|search-route-hint/.test(sourceText))continue;
    const title=first(profile.name,item.title,item.name);if(!title)continue;
    seen.add(officialUrl);
    out.push(Object.assign({},item,{
      title,name:title,url:officialUrl,link:officialUrl,igdcPrivateReviewOnly:true,igdcSupplierCandidate:true,igdcProductCandidate:false,
      igdcCollectionStage:"responsible-supplier-private-discovery",
      igdcCollectionScope:{country:geo.country,region:geo.region||"NATIONWIDE",collectedAt:new Date().toISOString(),locales:localeList(geo.country)},
      brokerageVerification:Object.assign({},evidence,{privateQueueOnly:true,publicEligible:false,obviousNonCommerce:false,researchMissingEvidence:array(evidence.researchMissingEvidence).length?array(evidence.researchMissingEvidence):researchMissingEvidence(evidence)}),
      intermediaryContract:{igdcRole:"distribution_service_intermediary",sellerOfRecord:false,merchantOfRecord:false,inventoryCustody:false,checkoutOnIgdc:false,paymentProcessing:false,fulfillment:false,returnsHandling:false,afterSalesService:false,transactionAtSupplier:true},
      productCatalogImportAllowed:false,productReferenceSelectionRequired:true
    }));
    if(out.length>=limit)break;
  }
  return out;
}

function templateSnapshot(){
  const stored=Core.loadStoredCandidates();
  const templateSource=stored.sources.find(s=>/distribution\.snapshot\.json$/i.test(s.file));
  if(templateSource){try{return JSON.parse(require("fs").readFileSync(templateSource.file,"utf8"));}catch(_e){}}
  const fs=require("fs"),path=require("path");
  for(const root of [process.cwd(),path.resolve(__dirname,"..","..")]){const file=path.join(root,"data","distribution.snapshot.json");try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){}}
  return null;
}
async function runSelection(event,params){
  const requested=params||{};
  const explicitCountry=Core.normalizeCountry(requested.country||requested.targetCountry);
  const categoryWeights={};for(const key of CATEGORY_KEYS)categoryWeights[key]=Math.max(-20,Math.min(20,Number(requested.categoryWeights&&requested.categoryWeights[key])||0));
  const adminPolicyHints=policyHints(requested.policyHints);
  const geo=explicitCountry?{country:explicitCountry,region:Core.normalizeRegion(requested.region||requested.targetRegion,explicitCountry),city:"",countryName:Core.COUNTRY_NAMES[explicitCountry]||explicitCountry,categoryWeights,signalPlanVersion:text(requested.signalPlanVersion),policyHints:adminPolicyHints}:Object.assign({},Core.parseGeo(event,requested),{categoryWeights,signalPlanVersion:text(requested.signalPlanVersion),policyHints:adminPolicyHints});
  const privateCollection=requested.privateCollection===true||String(requested.privateCollection||"").toLowerCase()==="true";
  const privateLimit=Math.max(1,Math.min(50,Number(requested.privateLimit||requested.maxCandidates||20)||20));
  const key=cacheKey(geo,privateCollection?"private-supplier":"front");const cached=getCache(key);if(cached)return Object.assign({},cached,{meta:Object.assign({},cached.meta||{},{cache:"hit"})});
  const started=Date.now(),stored=Core.loadStoredCandidates();let selected=Core.selection(stored.items,geo),discovery={items:[],trace:[]},checked=[],privateReviewItems=[];
  if((privateCollection||selected.accepted.length<6)&&geo.country!=="GLOBAL"){
    discovery=await runSanmaruDiscovery(event,geo,privateLimit);
    checked=await inspectLive(discovery.items,geo);
    if(privateCollection)privateReviewItems=privateReviewPool(discovery.items,checked,geo,privateLimit);
    else selected=Core.selection(stored.items.concat(checked),geo);
  }
  const template=templateSnapshot();
  const snapshot=!privateCollection&&selected.accepted.length&&template?Core.buildSnapshot(template,selected.accepted,geo,{storedSources:stored.sources,discovery:discovery.trace,stats:selected.stats,elapsedMs:Date.now()-started}):null;
  const result={
    status:"ok",engine:"regional-brokerage-autoselector",version:VERSION,
    geo:{country:geo.country,region:geo.region||null,precision:geo.region?"coarse-region":"country",source:explicitCountry?"explicit-scope":"request-ip"},
    items:privateCollection?[]:selected.accepted.map(x=>x.item),privateReviewItems,snapshot,
    meta:{cache:"miss",discoveryMode:privateCollection?"responsible-supplier":"front-supply",countryLocales:localeList(geo.country),selection:selected.stats,rejections:selected.rejected.slice(0,80),discovery:discovery.trace,
      marketSignals:{applied:Object.values(categoryWeights).some(value=>value!==0),categoryWeights,signalPlanVersion:text(requested.signalPlanVersion),categoryKeys:queryCategories(geo).map(index=>CATEGORY_KEYS[index])},
      administratorPolicy:{applied:adminPolicyHints.priorityDirections.length>0||adminPolicyHints.avoidDirections.length>0||adminPolicyHints.manualPriorityTargets.length>0||adminPolicyHints.manualBlockedTargets.length>0,priorityDirections:adminPolicyHints.priorityDirections,avoidDirections:adminPolicyHints.avoidDirections,manualPriorityTargets:adminPolicyHints.manualPriorityTargets,manualBlockedTargets:adminPolicyHints.manualBlockedTargets,manualPrecedence:true},
      privateReview:{enabled:privateCollection,entityKind:"supplier",raw:discovery.items.length,inspected:checked.length,count:privateReviewItems.length,researchEligible:privateReviewItems.filter(item=>plain(item&&item.brokerageVerification).supplierResearchEligible===true).length,evidenceReady:privateReviewItems.filter(item=>plain(item&&item.brokerageVerification).supplierReviewEligible===true).length,productPageImport:false,publicPublication:false},
      elapsedMs:Date.now()-started,hasSnapshot:!!snapshot}
  };
  return setCache(key,result);
}

// Persisted staged supplier research helpers. Each network lane is executed in a
// separate request so a thorough search can continue for minutes without forcing
// any single Netlify request to race the platform timeout.
function stagedGeo(params){
  const requested=params||{};
  const country=Core.normalizeCountry(requested.country||requested.targetCountry);
  const categoryWeights={};for(const key of CATEGORY_KEYS)categoryWeights[key]=Math.max(-20,Math.min(20,Number(requested.categoryWeights&&requested.categoryWeights[key])||0));
  return {country,region:Core.normalizeRegion(requested.region||requested.targetRegion,country),city:"",countryName:Core.COUNTRY_NAMES[country]||country,categoryWeights,signalPlanVersion:text(requested.signalPlanVersion),policyHints:policyHints(requested.policyHints)};
}
function compactResearchItem(item){
  const u=Core.externalUrl(item);if(!u)return null;
  return {title:first(item&&item.title,item&&item.name),name:first(item&&item.name,item&&item.title),url:u,link:u,summary:text(item&&item.summary).slice(0,1200),snippet:text(item&&item.snippet).slice(0,1200),source:text(item&&item.source),provider:text(item&&item.provider),type:text(item&&item.type)||"web",thumbnail:first(item&&item.thumbnail,item&&item.image),image:first(item&&item.image,item&&item.thumbnail),sourceTrust:Number(item&&item.sourceTrust||0),payload:Object.assign({},plain(item&&item.payload))};
}
function createSupplierResearchPlan(params){
  const geo=stagedGeo(params);if(!geo.country)return{geo,rows:[],tasks:[],seeds:[],diagnostics:{error:"country_missing"}};
  const locales=localeList(geo.country);let plan={rows:[],seeds:[],diagnostics:null,version:null};
  if(SupplierResearchPlan&&typeof SupplierResearchPlan.buildPlan==="function")plan=SupplierResearchPlan.buildPlan({geo,locales,maxQueries:24,seedLimit:40});
  const rows=[];const seen=new Set();for(const row of array(plan.rows)){const q=text(row&&row.query).replace(/\s+/g," ");if(!q||seen.has(q.toLowerCase()))continue;seen.add(q.toLowerCase());rows.push({query:q,locale:text(row&&row.locale)||locales[0]||"en",origin:text(row&&row.origin)||"searchbank-psom-policy-plan",lane:text(row&&row.lane)||"general",localName:text(row&&row.localName)||geo.countryName||geo.country});}
  const tasks=[];rows.forEach((row,index)=>{if(geo.country==="KR")tasks.push({lane:"naver",rowIndex:index,query:row.query,locale:row.locale,origin:row.origin,supplyLane:row.lane,attempt:0});else tasks.push({lane:"google",rowIndex:index,query:row.query,locale:row.locale,origin:row.origin,supplyLane:row.lane,attempt:0});tasks.push({lane:"sanmaru",rowIndex:index,query:row.query,locale:row.locale,origin:row.origin,supplyLane:row.lane,attempt:0});});
  if(geo.country==="KR")rows.slice(0,8).forEach((row,index)=>tasks.push({lane:"google",rowIndex:index,query:row.query,locale:row.locale,origin:row.origin,supplyLane:row.lane,attempt:0}));
  const seeds=array(plan.seeds).concat(manualPolicySeeds(geo)).map(compactResearchItem).filter(Boolean);
  return{version:VERSION,researchPlanVersion:text(plan.version),geo,locales,rows,tasks,seeds,diagnostics:plain(plan.diagnostics)};
}
async function fetchJsonStaged(url,options,timeoutMs){
  const controller=typeof AbortController!=="undefined"?new AbortController():null;const timer=controller?setTimeout(()=>controller.abort(),Math.max(5000,timeoutMs||18000)):null;
  try{const response=await fetch(url,Object.assign({},options||{},{signal:controller?controller.signal:undefined}));const raw=await response.text();let body={};try{body=raw?JSON.parse(raw):{};}catch(_e){body={raw:raw.slice(0,500)};}if(!response.ok){const error=new Error("HTTP_"+response.status);error.code="HTTP_"+response.status;error.detail=text(body&&body.error&&body.error.message||body&&body.message||body&&body.error_description||body&&body.raw).slice(0,240);throw error;}return body;}finally{if(timer)clearTimeout(timer);}
}
async function stagedNaver(row,geo,limit){
  const keys=naverKeys();if(!keys.id||!keys.secret)return{provider:"naver",status:"not_configured",detail:"NAVER_API_KEY_or_NAVER_CLIENT_SECRET_missing",items:[]};
  const params=new URLSearchParams({query:row.query,display:String(Math.max(1,Math.min(100,limit||20))),start:"1"});
  try{const data=await fetchJsonStaged("https://openapi.naver.com/v1/search/webkr.json?"+params.toString(),{headers:{"X-Naver-Client-Id":keys.id,"X-Naver-Client-Secret":keys.secret}},18000);const items=researchFirst(array(data.items).map(x=>({title:stripHtml(x&&x.title),url:text(x&&x.link),link:text(x&&x.link),summary:stripHtml(x&&x.description),snippet:stripHtml(x&&x.description),source:"naver_country_discovery",provider:"naver",type:"web",payload:{source:"naver",country:geo.country,query:row.query,queryLocale:row.locale,queryOrigin:row.origin,supplyLane:row.supplyLane||"general"}})).filter(x=>x.title&&x.url));return{provider:"naver",status:items.length?"ok":"empty",detail:null,items};}catch(error){return{provider:"naver",status:providerErrorCode(error),detail:providerErrorDetail(error),items:[]};}
}
async function stagedGoogle(row,geo,limit){
  const keys=googleKeys();if(!keys.key||!keys.cx)return{provider:"google",status:"not_configured",detail:"GOOGLE_API_KEY_or_GOOGLE_CSE_ID_missing",items:[]};
  const lang=googleLocale(row.locale||"en"),params=new URLSearchParams({key:keys.key,cx:keys.cx,q:(row.query+" -filetype:pdf -filetype:doc -filetype:ppt -filetype:xls -wikipedia -wiki -report -research -news").slice(0,900),num:String(Math.max(1,Math.min(10,limit||10))),start:"1",safe:"active",filter:"1",hl:lang});if(/^[A-Z]{2}$/.test(geo.country||"")){params.set("gl",geo.country.toLowerCase());params.set("cr","country"+geo.country);}
  try{const data=await fetchJsonStaged("https://www.googleapis.com/customsearch/v1?"+params.toString(),null,18000);const items=researchFirst(array(data.items).map(x=>{const map=x&&x.pagemap||{},thumb=first(map.cse_image&&map.cse_image[0]&&map.cse_image[0].src,map.cse_thumbnail&&map.cse_thumbnail[0]&&map.cse_thumbnail[0].src);return{title:stripHtml(x&&x.title),url:text(x&&x.link),link:text(x&&x.link),summary:stripHtml(x&&x.snippet),snippet:stripHtml(x&&x.snippet),source:"google_country_discovery",provider:"google",type:"web",thumbnail:thumb,image:thumb,payload:{source:"google",country:geo.country,query:row.query,queryLocale:row.locale,queryOrigin:row.origin,supplyLane:row.supplyLane||"general"}};}).filter(x=>x.title&&x.url));return{provider:"google",status:items.length?"ok":"empty",detail:null,items};}catch(error){return{provider:"google",status:providerErrorCode(error),detail:providerErrorDetail(error),items:[]};}
}
async function stagedSanmaru(event,row,geo,limit){
  let Sanmaru=null;try{Sanmaru=require("./sanmaru_engine_v2");}catch(_e){}if(!Sanmaru||typeof Sanmaru.runEngine!=="function")return{provider:"sanmaru",status:"unavailable",detail:null,items:[]};
  try{const result=await withTimeout(Sanmaru.runEngine(event||{},{q:row.query,query:row.query,country:geo.country,region:geo.region||undefined,limit:Math.min(20,limit||18),candidatePool:48,language:row.locale,locale:row.locale,type:"site",channel:"commerce",entity:"supplier",external:"off",directExternal:"0",noExternal:"1",noMedia:"1",deep:"0",timeoutMs:18000,from:"regional-brokerage-autoselector-staged",source:"regional-brokerage-autoselector-staged",regionalBrokerageSupply:"1",noAnalytics:"1",noRevenue:"1",readOnly:"1",noWrite:"1",noSync:"1",writeMode:"readonly"}),19000);const items=researchFirst(extractItems(result));return{provider:"sanmaru",status:items.length?"ok":"empty",detail:null,items};}catch(error){return{provider:"sanmaru",status:providerErrorCode(error),detail:providerErrorDetail(error),items:[]};}
}
function directoryBridgeCandidate(label,url,sourceUrl,geo,row){
  const clean=stripHtml(label).replace(/\s+/g," ").trim();
  if(!clean||clean.length<2||clean.length>180)return null;
  const u=safeHttpUrl(url);if(!u)return null;
  const host=lower(u.hostname);
  if(/(?:facebook|instagram|youtube|youtu\.be|twitter|x\.com|pinterest|tiktok|linkedin|naver\.com|daum\.net|google\.|kakao\.|blog\.|news\.)/i.test(host))return null;
  if(/\.(?:pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip)(?:$|[?#])/i.test(u.toString()))return null;
  const hay=lower(clean+" "+u.pathname);
  if(!/(?:농장|농원|농협|축협|수협|산림조합|영농조합|협동조합|농업회사|생산자|제조|공장|기업|회사|공식몰|쇼핑몰|직매장|로컬푸드|farm|grower|producer|manufacturer|factory|cooperative|company|official\s*(?:shop|store)|online\s*(?:shop|store)|direct\s*sale)/i.test(hay))return null;
  return compactResearchItem({title:clean,name:clean,url:u.toString(),link:u.toString(),source:"official_directory_bridge",provider:"directory-bridge",type:"site",summary:"Official directory outbound supplier candidate",payload:{source:"official_directory_bridge",directoryUrl:sourceUrl,country:geo.country,region:geo.region||"NATIONWIDE",query:row.query,queryLocale:row.locale,queryOrigin:row.origin,supplyLane:row.supplyLane||"public_directory_bridge"}});
}
async function bridgeOfficialDirectory(item,geo,row,max){
  const sourceUrl=Core.externalUrl(item),source=safeHttpUrl(sourceUrl);if(!source)return[];
  const controller=typeof AbortController!=="undefined"?new AbortController():null,timer=controller?setTimeout(()=>controller.abort(),8000):null;
  try{
    const response=await fetch(source.toString(),{redirect:"follow",signal:controller?controller.signal:undefined,headers:{"user-agent":"IGDC-MARU-OfficialDirectoryBridge/1.0 (+https://igdcglobal.com)",accept:"text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"}});
    if(!response.ok)return[];const type=text(response.headers.get("content-type"));if(!/text\/html|application\/xhtml\+xml/i.test(type))return[];
    const length=Number(response.headers.get("content-length")||0);if(length>450000)return[];
    const html=(await response.text()).slice(0,450000),base=response.url||source.toString(),out=[],seen=new Set(),rx=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let match;
    while((match=rx.exec(html))){
      const target=absoluteHttpUrl(base,match[1]);if(!target||sameSite(base,target))continue;
      const candidate=directoryBridgeCandidate(match[2],target,base,geo,row);if(!candidate)continue;
      const key=lower(candidate.url);if(seen.has(key))continue;seen.add(key);out.push(candidate);if(out.length>=Math.max(3,Math.min(16,Number(max)||10)))break;
    }
    return out;
  }catch(_error){return[];}finally{if(timer)clearTimeout(timer);}
}

async function searchSupplierResearchStep(event,params){
  const geo=stagedGeo(params),task=plain(params&&params.task),row={query:text(task.query),locale:text(task.locale)||"en",origin:text(task.origin)||"searchbank-psom-policy-plan",supplyLane:text(task.supplyLane)||"general"};
  let result;if(task.lane==="naver")result=await stagedNaver(row,geo,Math.max(20,Number(params&&params.limit)||20));else if(task.lane==="google")result=await stagedGoogle(row,geo,Math.min(10,Number(params&&params.limit)||10));else result=await stagedSanmaru(event,row,geo,Math.max(18,Number(params&&params.limit)||18));
  let items=researchFirst(result.items||[]).filter(item=>!blockedByAdministratorPolicy(item,geo)).map((item)=>{const compact=compactResearchItem(item);if(compact){compact.payload=Object.assign({},plain(compact.payload),{supplyLane:row.supplyLane});}return compact;}).filter(Boolean);
  let bridged=[];
  if(row.supplyLane==="public_directory_bridge"&&items.length){bridged=await bridgeOfficialDirectory(items[0],geo,row,12);items=items.concat(bridged);}
  return{ok:true,version:VERSION,task:Object.assign({},task),status:result.status,detail:result.detail||null,items,trace:{source:result.provider,query:row.query,queryLocale:row.locale,queryOrigin:row.origin,supplyLane:row.supplyLane,status:result.status,detail:result.detail||null,count:items.length,directoryBridgeCount:bridged.length,timeoutMs:19000}};
}
function prepareSupplierInspectionPool(rawItems,params){
  const geo=stagedGeo(params),limit=Math.max(10,Math.min(100,Number(params&&params.limit)||60)),out=[],seen=new Set(),hostCounts=new Map();
  for(const item of researchFirst(rawItems||[])){const url=Core.externalUrl(item);if(!url||seen.has(url)||blockedByAdministratorPolicy(item,geo))continue;let host="";try{host=new URL(url).hostname.toLowerCase();}catch(_e){}const count=hostCounts.get(host)||0;if(count>=3)continue;seen.add(url);hostCounts.set(host,count+1);out.push(compactResearchItem(item));if(out.length>=limit)break;}return out.filter(Boolean);
}
async function inspectSupplierResearchStep(rawItems,params){const geo=stagedGeo(params),items=array(rawItems).slice(0,3);const inspected=await Promise.all(items.map(item=>inspectCandidate(item,geo)));return{ok:true,version:VERSION,items:inspected};}
function buildSupplierReviewPool(rawItems,inspectedItems,params){const geo=stagedGeo(params),limit=Math.max(1,Math.min(100,Number(params&&params.limit)||40));return privateReviewPool(rawItems,inspectedItems,geo,limit);}



// Product-reference research. This stage is private and review-only: it reads
// official seller pages, extracts real product names/images/original links, and
// never publishes or downloads third-party images into IGDC storage.
function decodeHtmlValue(value){
  return String(value||"").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").trim();
}
function absoluteHttpUrl(baseUrl,raw){
  const value=decodeHtmlValue(raw);if(!value)return"";
  try{const u=new URL(value,baseUrl);if(!["http:","https:"].includes(u.protocol)||u.username||u.password||!u.hostname)return"";u.hash="";return u.toString();}catch(_e){return"";}
}
function metaContent(html,names){
  const source=String(html||"");
  for(const name of array(names)){
    const escaped=String(name).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const patterns=[
      new RegExp('<meta\\b[^>]*(?:property|name)\\s*=\\s*["\\\']'+escaped+'["\\\'][^>]*content\\s*=\\s*["\\\']([^"\\\']+)["\\\'][^>]*>','i'),
      new RegExp('<meta\\b[^>]*content\\s*=\\s*["\\\']([^"\\\']+)["\\\'][^>]*(?:property|name)\\s*=\\s*["\\\']'+escaped+'["\\\'][^>]*>','i')
    ];
    for(const rx of patterns){const m=source.match(rx);if(m&&m[1])return decodeHtmlValue(m[1]);}
  }
  return"";
}
function canonicalPageUrl(html,baseUrl){
  const m=String(html||"").match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>|<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["'][^>]*>/i);
  return absoluteHttpUrl(baseUrl,m&&(m[1]||m[2]))||baseUrl;
}
function jsonLdNodesDeep(html){
  const roots=[],rx=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=rx.exec(String(html||"")))){try{roots.push(JSON.parse(m[1]));}catch(_e){}}
  const out=[],seen=new Set();
  function walk(value,depth){
    if(depth>8||value==null)return;
    if(Array.isArray(value)){value.forEach(v=>walk(v,depth+1));return;}
    if(typeof value!=="object")return;
    if(!seen.has(value)){seen.add(value);out.push(value);}
    for(const [key,child] of Object.entries(value)){if(["image","logo","review","offers","brand","seller","itemListElement","item","mainEntity","@graph"].includes(key)||depth<3)walk(child,depth+1);}
  }
  roots.forEach(v=>walk(v,0));return out;
}
function nodeType(node){return array(node&&node["@type"]).concat(typeof(node&&node["@type"])==="string"?[node["@type"]]:[]).join(" ");}
function imageFromValue(value,baseUrl){
  const values=array(value);if(!values.length&&value!=null)values.push(value);
  for(const row of values){
    const raw=typeof row==="string"?row:first(row&&row.url,row&&row.contentUrl,row&&row.thumbnailUrl,row&&row["@id"]);
    const url=absoluteHttpUrl(baseUrl,raw);if(url&&isProductImageUrl(url))return url;
  }
  return"";
}
function isProductImageUrl(url){
  const low=text(url).toLowerCase();if(!/^https?:\/\//.test(low))return false;
  if(/\.(?:css|js|mjs|json|xml|map|txt|pdf|zip|svg)(?:$|[?#])/i.test(low))return false;
  if(/(?:^|[\/_\-.])(logo|favicon|icon|sprite|avatar|profile|banner|header|footer|brandmark|placeholder|no[-_]?image|blank|spacer|transparent|loading|1x1)(?:[\/_\-.]|$)/i.test(low))return false;
  return true;
}
function imageAttrFromHtml(fragment,baseUrl){
  const source=String(fragment||""),patterns=[
    /(?:data-original|data-lazy-src|data-lazy|data-echo|data-image|data-thumb|data-src|src)\s*=\s*["']([^"']+)["']/i,
    /(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/i,
    /(?:background-image\s*:\s*url\(|data-background(?:-image)?\s*=\s*["']?)(["']?)([^"')\s]+)\1/i
  ];
  for(const rx of patterns){
    const match=source.match(rx);if(!match)continue;
    const raw=match[2]||match[1];if(!raw||/^data:/i.test(raw))continue;
    const firstCandidate=String(raw).split(",")[0].trim().split(/\s+/)[0],url=absoluteHttpUrl(baseUrl,firstCandidate);
    if(url&&isProductImageUrl(url))return url;
  }
  return"";
}
function isProductDetailUrl(url){return ProductRanking.isSpecificProductUrl(url);}

function isScriptArtifactName(value){
  const raw=String(value||"");
  return /(?:\br\.push\s*\(|\b(?:item|product|goods)\.[a-z_$][\w$]*|document\.|window\.|function\s*\(|=>|<\/?script\b|getCurrency\s*\()/i.test(raw);
}
function meaningfulProductName(value){
  const name=stripHtml(value).replace(/\s+/g," ").trim();
  if(!name||name.length<2||name.length>220||isScriptArtifactName(name))return"";
  if(/^(?:상품|제품|상품목록|제품목록|제품별|브랜드별|카테고리|전체상품|전체보기|보기|상세|더보기|구매|결과|검색|검색결과|로그인|로그아웃|회원가입|마이페이지|장바구니|주문조회|상품\s*삭제|최근\s*검색어\s*전체삭제|전체삭제|품절|shop|store|view|detail|list|result|results|login|logout|cart|search)$/i.test(name))return"";
  if(/^(?:new|best|sale|event|기획전|이벤트|추천상품)$/i.test(name))return"";
  return name;
}
function nearbyProductName(fragment,inner){
  const direct=meaningfulProductName(inner);if(direct)return direct;
  const source=String(fragment||""),imgAlt=source.match(/<img\b[^>]*(?:alt|title)\s*=\s*["']([^"']+)["'][^>]*>/i);
  const alt=meaningfulProductName(imgAlt&&imgAlt[1]);if(alt)return alt;
  const patterns=[
    /<(?:strong|em|span|div|p)\b[^>]*class\s*=\s*["'][^"']*(?:item[_-]?name|goods[_-]?name|prd[_-]?name|product[_-]?name|name)[^"']*["'][^>]*>([\s\S]{1,500}?)<\/(?:strong|em|span|div|p)>/i,
    /(?:data-goods-name|data-product-name|title)\s*=\s*["']([^"']+)["']/i
  ];
  for(const rx of patterns){const m=source.match(rx),name=meaningfulProductName(m&&m[1]);if(name)return name;}
  return"";
}
function productBlockContext(source,start,end){
  const html=String(source||""),liStart=html.lastIndexOf("<li",start),liEnd=html.indexOf("</li>",end);
  if(liStart>=0&&liEnd>liStart&&liEnd-liStart<14000)return html.slice(liStart,liEnd+5);
  return html.slice(Math.max(0,start-700),Math.min(html.length,end+1000));
}
function decodeEmbeddedUrl(value){
  return String(value||"").replace(/&amp;/gi,"&").replace(/\\u002f/gi,"/").replace(/\\\//g,"/").replace(/\\u0026/gi,"&").trim();
}
function embeddedProductUrls(html,pageUrl,max){
  const source=String(html||""),out=[],seen=new Set(),patterns=[
    /(?:href|data-href|data-url|data-link|data-product-url|data-goods-url|productUrl|productURL|goodsUrl|goodsURL)\s*[:=]\s*["']([^"']+)["']/gi,
    /(?:location(?:\.href)?|window\.location)\s*=\s*["']([^"']+)["']/gi,
    /["']((?:https?:\/\/|https?:\\\/\\\/|\/)[^"']{0,420}(?:goods_view\.(?:php|html?)|product_view\.(?:php|html?)|item_view\.(?:php|html?)|product_detail\.(?:php|html?)|goods_detail\.(?:php|html?)|goodsdetail\.(?:php|html?)|productdetail\.(?:php|html?)|shopdetail\.(?:php|html?)|\/(?:product|products|item|items|detail|goods|prd|p)\/)[^"']*)["']/gi
  ];
  for(const rx of patterns){let m;while((m=rx.exec(source))){const raw=decodeEmbeddedUrl(m[1]),url=absoluteHttpUrl(pageUrl,raw);if(!url||!sameSite(pageUrl,url)||!isProductDetailUrl(url))continue;const key=lower(url);if(seen.has(key))continue;seen.add(key);out.push({url,index:m.index,end:rx.lastIndex});if(out.length>=Math.max(10,Math.min(120,Number(max)||60)))return out;}}
  return out;
}
function sitemapLocations(xml,baseUrl,max){
  const out=[],seen=new Set(),rx=/<loc>\s*([\s\S]*?)\s*<\/loc>/gi;let m;while((m=rx.exec(String(xml||"")))){const url=absoluteHttpUrl(baseUrl,decodeEmbeddedUrl(stripHtml(m[1])));if(!url||!sameSite(baseUrl,url)||seen.has(lower(url)))continue;seen.add(lower(url));out.push(url);if(out.length>=Math.max(20,Math.min(500,Number(max)||240)))break;}return out;
}
async function fetchProductSitemapUrls(siteUrl,controller,max){
  const root=new URL(siteUrl);root.pathname="/sitemap.xml";root.search="";root.hash="";const headers={"user-agent":"IGDC-MARU-ProductReferenceResearch/1.0 (+https://igdcglobal.com)",accept:"application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1"};
  async function read(url){try{const response=await fetch(url,{redirect:"follow",signal:controller.signal,headers});if(!response.ok)return{ok:false,url,body:""};const length=Number(response.headers.get("content-length")||0);if(length>1800000)return{ok:false,url,body:""};return{ok:true,url:response.url||url,body:(await response.text()).slice(0,1600000)};}catch(_e){return{ok:false,url,body:""};}}
  const firstDoc=await read(root.toString());if(!firstDoc.ok)return[];let locations=sitemapLocations(firstDoc.body,firstDoc.url,500),productUrls=locations.filter(isProductDetailUrl);
  if(productUrls.length<Math.max(5,Math.min(20,Number(max)||20))){const childMaps=locations.filter(url=>/sitemap/i.test(url)&&/(product|goods|item|shop|store|catalog)/i.test(url)).slice(0,2);for(const child of childMaps){const doc=await read(child);if(!doc.ok)continue;productUrls=productUrls.concat(sitemapLocations(doc.body,doc.url,500).filter(isProductDetailUrl));}}
  const out=[],seen=new Set();for(const url of productUrls){const key=lower(url);if(seen.has(key))continue;seen.add(key);out.push(url);if(out.length>=Math.max(10,Math.min(80,Number(max)||40)))break;}return out;
}
function productPriorityInfo(value){
  const hay=lower(value),labels=[];
  if(/(?:버섯|표고|느타리|목이|송이|고사리|산채|임산물|밤|대추|호두|잣|꿀|약초)/i.test(hay))labels.push("버섯·임산물");
  if(/(?:쌀|잡곡|콩|참깨|들깨|고춧가루|마늘|양파|과일|채소|농산물|한우|돼지고기|닭고기|계란|우유|축산물|수산물|건어물|김|미역|젓갈|전복|굴|새우)/i.test(hay))labels.push("농·축·수산물");
  if(/(?:식품|식료품|김치|장류|반찬|떡|한과|생필품|생활용품|세제|위생용품|주방용품)/i.test(hay))labels.push("식품·생활필수품");
  if(/(?:화장품|뷰티|스킨케어|세럼|크림|로션|선크림|샴푸|린스|클렌징|마스크팩|메이크업|향수|personal care|beauty|cosmetic|skincare)/i.test(hay))labels.push("뷰티·개인용품");
  if(/(?:공구|산업용품|기계|부품|금속|철강|플라스틱|고무|목재|포장재|전기자재|전자부품|자동차부품|건축자재|설비|안전용품|industrial|machinery|machine|tool|component|parts|metal|steel|plastic|rubber|packaging|electrical|hardware)/i.test(hay))labels.push("공업·산업재");
  if(/(?:의류|섬유|패션|신발|가방|완구|교육용품|문구|유아용품|가구|조명|침구|apparel|textile|fashion|footwear|toy|stationery|furniture|lighting|bedding)/i.test(hay))labels.push("소비재·제조상품");
  if(/(?:농협|축협|수협|산림조합|협동조합|영농조합|농업회사법인|로컬푸드|생산자|농장|어촌|산촌)/i.test(hay))labels.push("생산자·조합");
  return{score:labels.length*40,label:labels[0]||""};
}
function isDirectProductVideoUrl(url){return /\.(?:mp4|webm|ogv|ogg)(?:$|[?#])/i.test(text(url));}
function isTrustedVideoPage(url){try{const u=new URL(url),host=lower(u.hostname);return host==="youtu.be"||host.endsWith("youtube.com")||host.endsWith("youtube-nocookie.com")||host==="vimeo.com"||host.endsWith(".vimeo.com");}catch(_e){return false;}}
function videoInfoFromValue(value,baseUrl){
  const queue=array(value);if(!queue.length&&value!=null)queue.push(value);const out={videoUrl:"",videoContentUrl:"",videoEmbedUrl:"",videoThumbnailUrl:"",videoSource:""};
  for(const row of queue){
    if(typeof row==="string"){const url=absoluteHttpUrl(baseUrl,row);if(url&&!out.videoUrl){out.videoUrl=url;if(isDirectProductVideoUrl(url))out.videoContentUrl=url;else if(isTrustedVideoPage(url))out.videoEmbedUrl=url;out.videoSource="json_ld_video";}continue;}
    const node=plain(row),content=absoluteHttpUrl(baseUrl,first(node.contentUrl,node.url,node["@id"])),embed=absoluteHttpUrl(baseUrl,node.embedUrl),thumb=imageFromValue(first(node.thumbnailUrl,node.thumbnail),baseUrl);
    if(content&&!out.videoContentUrl)out.videoContentUrl=content;if(embed&&!out.videoEmbedUrl)out.videoEmbedUrl=embed;if(thumb&&!out.videoThumbnailUrl)out.videoThumbnailUrl=thumb;if(!out.videoUrl)out.videoUrl=content||embed;if(out.videoUrl&&!out.videoSource)out.videoSource="json_ld_video";
  }
  return out;
}
function videoInfoFromHtml(html,pageUrl){
  const source=String(html||""),metaVideo=absoluteHttpUrl(pageUrl,metaContent(source,["og:video:secure_url","og:video:url","og:video","twitter:player"])),poster=absoluteHttpUrl(pageUrl,metaContent(source,["og:video:thumbnail","og:image:secure_url","og:image","twitter:image"]));
  const videoTag=source.match(/<video\b[^>]*(?:src\s*=\s*["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/video>/i),videoOpen=source.match(/<video\b[^>]*>/i),sourceTag=source.match(/<(?:source)\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/i),iframe=source.match(/<iframe\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/i),posterAttr=videoOpen&&videoOpen[0].match(/poster\s*=\s*["']([^"']+)["']/i);
  const direct=absoluteHttpUrl(pageUrl,first(videoTag&&videoTag[1],sourceTag&&sourceTag[1])),iframeUrl=absoluteHttpUrl(pageUrl,iframe&&iframe[1]);
  const trustedIframe=isTrustedVideoPage(iframeUrl)?iframeUrl:"",videoUrl=direct||metaVideo||trustedIframe;
  return{videoUrl,videoContentUrl:isDirectProductVideoUrl(direct||metaVideo)?(direct||metaVideo):"",videoEmbedUrl:trustedIframe||(!isDirectProductVideoUrl(metaVideo)&&isTrustedVideoPage(metaVideo)?metaVideo:""),videoThumbnailUrl:absoluteHttpUrl(pageUrl,posterAttr&&posterAttr[1])||poster,videoSource:direct?"html_video":trustedIframe?"trusted_video_embed":metaVideo?"open_graph_video":""};
}

function normalizedPrice(value){
  const raw=stripHtml(value).replace(/\s+/g," ").trim();if(!raw)return"";
  const match=raw.match(/(?:₩|KRW|원|USD|US\$|\$|EUR|€|JPY|¥|CNY|RMB|GBP|£)?\s*([0-9]{1,3}(?:[,.][0-9]{3})+(?:[.][0-9]+)?|[0-9]{2,}(?:[.][0-9]+)?)/i);
  if(!match)return"";const number=match[1].replace(/,/g,"");if(!Number.isFinite(Number(number))||Number(number)<=0)return"";return number;
}
function currencyFromText(value){
  const raw=text(value);if(/(?:₩|KRW|원)/i.test(raw))return"KRW";if(/(?:USD|US\$|\$)/i.test(raw))return"USD";if(/(?:EUR|€)/i.test(raw))return"EUR";if(/(?:JPY|¥)/i.test(raw))return"JPY";if(/(?:CNY|RMB)/i.test(raw))return"CNY";if(/(?:GBP|£)/i.test(raw))return"GBP";return"";
}
function priceInfoFromHtml(html){
  const source=String(html||""),metaAmount=metaContent(source,["product:price:amount","og:price:amount","twitter:data1"]),metaCurrency=metaContent(source,["product:price:currency","og:price:currency"]);
  const patterns=[
    /<(?:meta|input)\b[^>]*(?:itemprop|name|property)\s*=\s*["'](?:price|sale_price|product:price:amount)["'][^>]*(?:content|value)\s*=\s*["']([^"']+)["'][^>]*>/i,
    /(?:data-price|data-sale-price|data-product-price|data-goods-price)\s*=\s*["']([^"']+)["']/i,
    /<(?:strong|span|div|em)\b[^>]*class\s*=\s*["'][^"']*(?:price|sale_price|goods_price|product-price)[^"']*["'][^>]*>([\s\S]{1,240}?)<\/(?:strong|span|div|em)>/i
  ];
  let raw=metaAmount;for(const rx of patterns){if(raw)break;const m=source.match(rx);if(m)raw=stripHtml(m[1]);}
  return{price:normalizedPrice(raw),priceCurrency:text(metaCurrency).toUpperCase()||currencyFromText(raw)};
}
function availabilityFromHtml(html){
  const source=String(html||""),meta=metaContent(source,["product:availability","og:availability"]);if(meta)return meta;
  const item=source.match(/(?:itemprop|property)\s*=\s*["']availability["'][^>]*(?:content|href)\s*=\s*["']([^"']+)["']/i);if(item)return decodeHtmlValue(item[1]);
  if(/(?:품절|sold\s*out|out\s*of\s*stock)/i.test(stripHtml(source.slice(0,180000))))return"OutOfStock";
  if(/(?:구매하기|장바구니|바로구매|add\s*to\s*cart|buy\s*now)/i.test(source))return"InStock";
  return"";
}

function productOffer(node){
  const offers=array(node&&node.offers);if(!offers.length&&node&&node.offers)offers.push(node.offers);
  const offer=plain(offers[0]);return{price:normalizedPrice(first(offer.price,offer.lowPrice,offer.highPrice)),priceCurrency:first(offer.priceCurrency),availability:first(offer.availability),sellerName:first(plain(offer.seller).name,plain(node&&node.seller).name)};
}
function productIdSeed(url,name){let h=0;const value=String(url||"")+"|"+String(name||"");for(let i=0;i<value.length;i++)h=((h<<5)-h+value.charCodeAt(i))|0;return"product_ref_"+Math.abs(h).toString(36)+"_"+value.length.toString(36);}
function productRowsFromHtml(html,pageUrl,supplier,max){
  const out=[],seen=new Set(),supplierSiteUrl=absoluteHttpUrl(pageUrl,first(supplier&&supplier.supplierSiteUrl,supplier&&supplier.url,pageUrl)),supplierName=first(supplier&&supplier.supplierName,supplier&&supplier.title,supplier&&supplier.name);
  const supplierMeta={
    supplierId:text(supplier&&supplier.supplierId),
    supplierName,
    supplierSiteUrl,
    supplierType:text(supplier&&supplier.supplierType),
    supplierTrustScore:Number(supplier&&supplier.trustScore)||0,
    supplierDecision:text(supplier&&supplier.supplierDecision),
    supplierApprovalReady:supplier&&supplier.approvalReady===true,
    supplierEvidenceReady:supplier&&supplier.evidenceReady===true,
    supplyLane:text(supplier&&supplier.supplyLane)||"general",
    discoverySource:text(supplier&&supplier.discoverySource)||"official_public_page",
    officialDirectoryUrl:text(supplier&&supplier.officialDirectoryUrl)
  };
  const add=(row)=>{
    const resolved=absoluteHttpUrl(pageUrl,row&&row.productUrl),productUrl=ProductRanking.canonicalProductUrl(resolved),rawName=stripHtml(first(row&&row.productName,row&&row.title));
    if(!productUrl||!isProductDetailUrl(productUrl)||isScriptArtifactName(rawName))return;
    if(supplierSiteUrl&&!sameSite(supplierSiteUrl,productUrl))return;
    const provisionalName=row&&row.provisionalName===true||!meaningfulProductName(rawName)||ProductRanking.isGenericProductName(rawName),productName=provisionalName?"상품명 확인 중":rawName;
    const imageUrl=absoluteHttpUrl(productUrl,row&&row.imageUrl),videoUrl=absoluteHttpUrl(productUrl,first(row&&row.videoUrl,row&&row.videoContentUrl,row&&row.videoEmbedUrl)),videoContentUrl=absoluteHttpUrl(productUrl,row&&row.videoContentUrl),videoEmbedUrl=absoluteHttpUrl(productUrl,row&&row.videoEmbedUrl),videoThumbnailUrl=absoluteHttpUrl(productUrl,row&&row.videoThumbnailUrl),priority=productPriorityInfo(productName+" "+(supplierName||text(row&&row.supplierName))+" "+productUrl);
    const candidate=Object.assign({},supplierMeta,{id:productIdSeed(productUrl,productName),entityKind:"product_reference",productName,title:productName,productUrl,url:productUrl,imageUrl:isProductImageUrl(imageUrl)?imageUrl:"",imageOriginalUrl:isProductImageUrl(imageUrl)?imageUrl:"",imageSource:text(row&&row.imageSource)||"unresolved",videoUrl,videoContentUrl,videoEmbedUrl,videoThumbnailUrl:isProductImageUrl(videoThumbnailUrl)?videoThumbnailUrl:"",videoSource:text(row&&row.videoSource)||"unresolved",supplierName:supplierName||text(row&&row.supplierName),supplierSiteUrl,sourcePageUrl:pageUrl,price:text(row&&row.price),priceCurrency:text(row&&row.priceCurrency),availability:text(row&&row.availability),jsonLdProduct:row&&row.jsonLdProduct===true,offerPresent:row&&row.offerPresent===true,provisionalName,priorityScore:Math.max(Number(row&&row.priorityScore)||0,priority.score),priorityLabel:text(row&&row.priorityLabel)||priority.label,productPageLive:true,sameSupplierSite:true,inspectionComplete:false,researchStatus:"discovered",slotDecision:"undecided",publicPublication:false,automaticImport:false});
    const identity=ProductRanking.productIdentity(candidate);if(!identity||seen.has(identity))return;seen.add(identity);out.push(candidate);
  };
  const nodes=jsonLdNodesDeep(html);
  for(const node of nodes){
    if(!/\bProduct\b/i.test(nodeType(node)))continue;
    const explicit=first(node.url,node["@id"],plain(node.mainEntityOfPage)["@id"]),resolved=absoluteHttpUrl(pageUrl,explicit),productUrl=resolved||(isProductDetailUrl(pageUrl)?canonicalPageUrl(html,pageUrl):"");
    if(!productUrl)continue;
    const offer=productOffer(node),imageUrl=imageFromValue(node.image,productUrl||pageUrl),video=videoInfoFromValue(node.video,productUrl||pageUrl),priority=productPriorityInfo(first(node.name,node.headline)+" "+supplierName);
    add({productName:first(node.name,node.headline),productUrl,imageUrl,imageSource:imageUrl?"json_ld_product":"",videoUrl:video.videoUrl,videoContentUrl:video.videoContentUrl,videoEmbedUrl:video.videoEmbedUrl,videoThumbnailUrl:video.videoThumbnailUrl,videoSource:video.videoSource,price:offer.price,priceCurrency:offer.priceCurrency,availability:offer.availability,supplierName:offer.sellerName,jsonLdProduct:true,offerPresent:!!(node.offers||offer.price),priorityScore:priority.score,priorityLabel:priority.label});
  }
  const sourceHtml=String(html||""),anchorRx=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let match;
  while((match=anchorRx.exec(sourceHtml))&&out.length<(max||60)){
    const href=absoluteHttpUrl(pageUrl,match[1]);if(!href||!isProductDetailUrl(href))continue;
    const inner=match[2],context=productBlockContext(sourceHtml,match.index,anchorRx.lastIndex),label=nearbyProductName(context,inner);if(!label)continue;
    const imageUrl=imageAttrFromHtml(inner,href)||imageAttrFromHtml(context,href),priority=productPriorityInfo(label+" "+supplierName+" "+href);
    add({productName:label,productUrl:href,imageUrl,imageSource:imageUrl?"product_list_context":"",jsonLdProduct:false,offerPresent:false,priorityScore:priority.score,priorityLabel:priority.label});
  }
  for(const found of embeddedProductUrls(sourceHtml,pageUrl,Math.max(20,(max||60)*2))){
    if(out.length>=(max||60))break;const context=productBlockContext(sourceHtml,found.index,found.end),label=nearbyProductName(context,"")||"상품명 확인 중",imageUrl=imageAttrFromHtml(context,found.url),priority=productPriorityInfo(label+" "+supplierName+" "+found.url);
    add({productName:label,productUrl:found.url,imageUrl,imageSource:imageUrl?"embedded_product_context":"",jsonLdProduct:false,offerPresent:false,priorityScore:priority.score,priorityLabel:priority.label,provisionalName:label==="상품명 확인 중"});
  }
  const pageType=metaContent(html,["og:type"]),ogTitle=metaContent(html,["og:title","twitter:title"]),itemPropImage=((String(html).match(/<(?:meta|link)\b[^>]*itemprop\s*=\s*["']image["'][^>]*(?:content|href)\s*=\s*["']([^"']+)["'][^>]*>/i)||[])[1]||""),ogImage=absoluteHttpUrl(pageUrl,metaContent(html,["og:image:secure_url","og:image","twitter:image"])||itemPropImage),pageVideo=videoInfoFromHtml(html,pageUrl),pagePrice=priceInfoFromHtml(html),pageAvailability=availabilityFromHtml(html);
  if(/product/i.test(pageType)||isProductDetailUrl(pageUrl)){const pageName=ogTitle||stripHtml((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]),priority=productPriorityInfo(pageName+" "+supplierName+" "+pageUrl);add({productName:pageName,productUrl:canonicalPageUrl(html,pageUrl),imageUrl:ogImage,imageSource:ogImage?"open_graph":"",videoUrl:pageVideo.videoUrl,videoContentUrl:pageVideo.videoContentUrl,videoEmbedUrl:pageVideo.videoEmbedUrl,videoThumbnailUrl:pageVideo.videoThumbnailUrl,videoSource:pageVideo.videoSource,price:pagePrice.price,priceCurrency:pagePrice.priceCurrency,availability:pageAvailability,jsonLdProduct:false,offerPresent:!!pagePrice.price,priorityScore:priority.score,priorityLabel:priority.label});}
  return out.slice(0,max||60);
}

function catalogPageUrls(html,baseUrl){
  const out=[],seen=new Set(),rx=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=rx.exec(String(html||"")))){
    const label=stripHtml(m[2]).replace(/\s+/g," ").trim(),href=absoluteHttpUrl(baseUrl,m[1]);if(!href||!sameSite(baseUrl,href))continue;
    if(!isProductDetailUrl(href)&&!/(상품|제품|쇼핑|스토어|공식몰|카탈로그|농산물|축산물|수산물|임산물|버섯|식품|생필품|생활용품|뷰티|화장품|로컬푸드|product|products|shop|store|catalog|collection|beauty|cosmetic)/i.test(label+" "+href))continue;
    if(seen.has(href)||href===baseUrl)continue;seen.add(href);out.push(href);if(out.length>=8)break;
  }
  return out;
}
async function fetchProductHtml(url,controller){
  try{const response=await fetch(url,{redirect:"follow",signal:controller.signal,headers:{"user-agent":"IGDC-MARU-ProductReferenceResearch/1.0 (+https://igdcglobal.com)"}});if(!response.ok)return{ok:false,status:"http_"+response.status,url,html:""};const type=String(response.headers.get("content-type")||"");if(!/text\/html|application\/xhtml\+xml/i.test(type))return{ok:false,status:"non_html",url:response.url||url,html:""};const length=Number(response.headers.get("content-length")||0);if(length>1800000)return{ok:false,status:"page_too_large",url:response.url||url,html:""};return{ok:true,status:"ok",url:response.url||url,html:(await response.text()).slice(0,1400000)};}catch(error){return{ok:false,status:providerErrorCode(error),url,html:"",detail:providerErrorDetail(error)};}
}
async function discoverSupplierProductsStep(supplier,params){
  const source=plain(supplier),supplierSiteUrl=absoluteHttpUrl(first(source.url,source.supplierSiteUrl),first(source.url,source.supplierSiteUrl));if(!supplierSiteUrl)return{ok:true,items:[],trace:{source:"supplier-product-discovery",status:"supplier_url_missing",count:0}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),19000);try{
    const initialUrls=[supplierSiteUrl],candidateUrl=absoluteHttpUrl(supplierSiteUrl,source.sourceCandidateUrl);if(candidateUrl&&sameSite(supplierSiteUrl,candidateUrl)&&candidateUrl!==supplierSiteUrl)initialUrls.push(candidateUrl);
    const initialPages=await Promise.all(initialUrls.map(url=>fetchProductHtml(url,controller))),validInitial=initialPages.filter(page=>page.ok);if(!validInitial.length){const firstFailure=initialPages[0]||{};return{ok:true,items:[],trace:{source:"supplier-product-discovery",status:firstFailure.status||"unavailable",detail:firstFailure.detail||null,supplierSiteUrl,count:0}};}
    const supplierInfo={supplierId:text(source.supplierId),supplierName:first(source.title,source.name,source.supplierName),supplierSiteUrl,supplierType:text(source.supplierType),trustScore:Number(source.trustScore)||0,supplierDecision:text(source.supplierDecision),approvalReady:source.approvalReady===true,evidenceReady:source.evidenceReady===true,supplyLane:text(source.supplyLane)||"general",discoverySource:text(source.discoverySource)||"official_public_page",officialDirectoryUrl:text(source.officialDirectoryUrl)};let items=[],extraUrls=[];
    for(const page of validInitial){items=items.concat(productRowsFromHtml(page.html,page.url,supplierInfo,50));extraUrls=extraUrls.concat(catalogPageUrls(page.html,page.url));}
    const uniqueExtras=[];for(const url of extraUrls){if(!url||initialUrls.includes(url)||uniqueExtras.includes(url))continue;uniqueExtras.push(url);if(uniqueExtras.length>=12)break;}
    const extras=await Promise.all(uniqueExtras.map(url=>fetchProductHtml(url,controller)));for(const page of extras)if(page.ok)items=items.concat(productRowsFromHtml(page.html,page.url,supplierInfo,50));
    let sitemapCount=0;if(items.filter(row=>isProductDetailUrl(row&&row.productUrl)).length<5){const sitemapUrls=await fetchProductSitemapUrls(supplierSiteUrl,controller,80);sitemapCount=sitemapUrls.length;for(const url of sitemapUrls){const priority=productPriorityInfo(supplierInfo.supplierName+" "+url);items.push({id:productIdSeed(url,"상품명 확인 중"),entityKind:"product_reference",productName:"상품명 확인 중",title:"상품명 확인 중",productUrl:url,url,imageUrl:"",imageOriginalUrl:"",imageSource:"sitemap_pending_inspection",videoUrl:"",videoContentUrl:"",videoEmbedUrl:"",videoThumbnailUrl:"",videoSource:"unresolved",supplierId:supplierInfo.supplierId,supplierName:supplierInfo.supplierName,supplierSiteUrl,supplierType:supplierInfo.supplierType,supplierTrustScore:supplierInfo.trustScore,supplierDecision:supplierInfo.supplierDecision,supplierApprovalReady:supplierInfo.approvalReady===true,supplierEvidenceReady:supplierInfo.evidenceReady===true,sourcePageUrl:supplierSiteUrl,jsonLdProduct:false,offerPresent:false,provisionalName:true,priorityScore:priority.score,priorityLabel:priority.label,productPageLive:true,sameSupplierSite:true,inspectionComplete:false,researchStatus:"discovered",slotDecision:"undecided",publicPublication:false,automaticImport:false});}}
    const dedup=[],seen=new Set();for(const row of items){const key=ProductRanking.productIdentity(row);if(!key||seen.has(key)||!isProductDetailUrl(row.productUrl))continue;seen.add(key);dedup.push(row);if(dedup.length>=Math.max(10,Math.min(120,Number(params&&params.limit)||80)))break;}
    return{ok:true,items:dedup,trace:{source:"supplier-product-discovery",status:"ok",supplierName:supplierInfo.supplierName,supplierSiteUrl,sourceCandidateChecked:initialUrls.length>1,catalogPagesChecked:validInitial.length+extras.filter(x=>x.ok).length,sitemapProductUrls:sitemapCount,count:dedup.length}};
  }finally{clearTimeout(timer);}
}
function prepareProductInspectionPool(rawItems,params){
  const limit=Math.max(20,Math.min(1200,Number(params&&params.limit)||300)),ranked=ProductRanking.mergeProductRows([],array(rawItems),{limit:Math.max(limit,300)}).filter(row=>ProductRanking.isSpecificProductUrl(row&&row.productUrl)&&!isScriptArtifactName(first(row&&row.productName,row&&row.title))).sort((a,b)=>Number(!!b.imageUrl)-Number(!!a.imageUrl)||Number(b.priorityScore||0)-Number(a.priorityScore||0)||text(a.productName).localeCompare(text(b.productName))),out=[],seen=new Set();
  for(const item of ranked){const url=ProductRanking.canonicalProductUrl(item&&item.productUrl),key=ProductRanking.productIdentity(item);if(!url||!key||seen.has(key)||!isProductDetailUrl(url))continue;seen.add(key);out.push(Object.assign({},item,{productUrl:url,url}));if(out.length>=limit)break;}return out;
}

async function inspectProductCandidate(item){
  const row=plain(item),productUrl=ProductRanking.canonicalProductUrl(absoluteHttpUrl(row.productUrl,row.productUrl)),supplierSiteUrl=absoluteHttpUrl(row.supplierSiteUrl,row.supplierSiteUrl);if(!productUrl)return Object.assign({},row,{researchStatus:"invalid_product_url",productPageLive:false,inspectionComplete:true});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);try{
    const page=await fetchProductHtml(productUrl,controller);if(!page.ok)return Object.assign({},row,{researchStatus:page.status,productPageLive:false,inspectionComplete:true,inspectedAt:new Date().toISOString()});
    const supplierMeta={supplierId:row.supplierId,supplierName:row.supplierName,supplierSiteUrl:supplierSiteUrl||row.supplierSiteUrl,supplierType:row.supplierType,trustScore:row.supplierTrustScore,supplierDecision:row.supplierDecision,approvalReady:row.supplierApprovalReady,evidenceReady:row.supplierEvidenceReady,supplyLane:row.supplyLane,discoverySource:row.discoverySource,officialDirectoryUrl:row.officialDirectoryUrl};
    const parsed=productRowsFromHtml(page.html,page.url,supplierMeta,20),canonical=ProductRanking.canonicalProductUrl(canonicalPageUrl(page.html,page.url))||productUrl,exact=parsed.find(x=>ProductRanking.canonicalProductUrl(x.productUrl)===canonical)||parsed[0]||{},pageVideo=videoInfoFromHtml(page.html,page.url);
    const pageTitle=meaningfulProductName(metaContent(page.html,["og:title","twitter:title"])||stripHtml((String(page.html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1])),candidateNames=[exact.productName!=="상품명 확인 중"?exact.productName:"",pageTitle,row.productName].map(meaningfulProductName).filter(name=>name&&!ProductRanking.isGenericProductName(name)),resolvedName=candidateNames[0]||"",name=resolvedName||"상품명 확인 중",image=first(exact.imageUrl,row.imageUrl),same=supplierSiteUrl?sameSite(supplierSiteUrl,page.url):true,pagePrice=priceInfoFromHtml(page.html),pageAvailability=availabilityFromHtml(page.html),price=first(exact.price,pagePrice.price,row.price),priceCurrency=first(exact.priceCurrency,pagePrice.priceCurrency,row.priceCurrency),availability=first(exact.availability,pageAvailability,row.availability),ready=!!resolvedName&&!!image&&same&&ProductRanking.isSpecificProductUrl(canonical);
    return Object.assign({},row,exact,{id:row.id||exact.id||productIdSeed(canonical,name),productName:name,title:name,provisionalName:!resolvedName,productUrl:canonical,url:canonical,imageUrl:isProductImageUrl(image)?image:"",imageOriginalUrl:isProductImageUrl(image)?image:"",price,priceCurrency,availability,offerPresent:exact.offerPresent===true||!!price,videoUrl:first(exact.videoUrl,pageVideo.videoUrl,row.videoUrl),videoContentUrl:first(exact.videoContentUrl,pageVideo.videoContentUrl,row.videoContentUrl),videoEmbedUrl:first(exact.videoEmbedUrl,pageVideo.videoEmbedUrl,row.videoEmbedUrl),videoThumbnailUrl:first(exact.videoThumbnailUrl,pageVideo.videoThumbnailUrl,row.videoThumbnailUrl),videoSource:first(exact.videoSource,pageVideo.videoSource,row.videoSource),supplierSiteUrl:supplierSiteUrl||exact.supplierSiteUrl,supplierId:first(row.supplierId,exact.supplierId),supplierType:first(row.supplierType,exact.supplierType),supplierTrustScore:Math.max(Number(row.supplierTrustScore)||0,Number(exact.supplierTrustScore)||0),supplierEvidenceReady:row.supplierEvidenceReady===true||exact.supplierEvidenceReady===true,supplierApprovalReady:row.supplierApprovalReady===true||exact.supplierApprovalReady===true,productPageLive:true,sameSupplierSite:same,inspectionComplete:true,inspectedAt:new Date().toISOString(),researchStatus:ready?"ready_for_admin_review":"needs_manual_review",slotDecision:text(row.slotDecision)||"undecided",publicPublication:false,automaticImport:false});
  }finally{clearTimeout(timer);}
}

async function inspectProductResearchStep(rawItems){
  const items=array(rawItems).slice(0,4),results=await Promise.allSettled(items.map((item)=>withTimeout(inspectProductCandidate(item),16000)));
  const inspected=results.map((result,index)=>{
    if(result.status==="fulfilled")return result.value;
    const row=plain(items[index]),error=result.reason;
    return Object.assign({},row,{
      researchStatus:"inspection_error",
      productPageLive:false,
      inspectionComplete:true,
      inspectedAt:new Date().toISOString(),
      inspectionError:{code:text(error&&error.code)||"INSPECTION_ERROR",message:text(error&&error.message||error)||"product inspection failed"},
      slotDecision:text(row.slotDecision)||"undecided",
      publicPublication:false,
      automaticImport:false
    });
  });
  return{ok:true,version:VERSION,items:inspected,failed:results.filter((result)=>result.status==="rejected").length};
}

module.exports={VERSION,runSelection,createSupplierResearchPlan,searchSupplierResearchStep,prepareSupplierInspectionPool,inspectSupplierResearchStep,buildSupplierReviewPool,discoverSupplierProductsStep,prepareProductInspectionPool,inspectProductResearchStep};
