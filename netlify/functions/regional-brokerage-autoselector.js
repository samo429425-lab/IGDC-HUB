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
const VERSION="regional-brokerage-autoselector-v1.2.0-country-multilingual-commerce-discovery";
const CACHE_TTL=5*60*1000;
function envInt(name,fallback,min,max){
  const value=Number(process.env[name]);
  return Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
}
// Quality-first defaults. Optional environment overrides exist, but no setup is required.
const DISCOVERY_TIMEOUT=envInt("IGDC_COUNTRY_DISCOVERY_TIMEOUT_MS",20000,8000,45000);
const PROVIDER_FETCH_TIMEOUT=envInt("IGDC_COUNTRY_PROVIDER_TIMEOUT_MS",20000,8000,45000);
const PAGE_CHECK_TIMEOUT=envInt("IGDC_COUNTRY_PAGE_CHECK_TIMEOUT_MS",8000,3000,20000);
const MAX_LIVE_QUERIES=envInt("IGDC_COUNTRY_SANMARU_QUERIES",4,2,6);
const MAX_PROVIDER_CALLS=envInt("IGDC_COUNTRY_PROVIDER_CALLS",4,2,6);
const MAX_PAGE_CHECKS=envInt("IGDC_COUNTRY_PAGE_CHECKS",10,4,16);
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


function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase();}
function first(){for(const v of arguments){const t=text(v);if(t)return t;}return "";}
function withTimeout(promise,ms){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Object.assign(new Error("timeout"),{code:"TIMEOUT"})),ms);Promise.resolve(promise).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
function cacheKey(geo,mode){return [VERSION,geo.country,geo.region||"-",mode||"front"].join(":");}
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
function localCountryName(country,locale,fallback){
  try{const names=new Intl.DisplayNames([locale],{type:"region"});return text(names.of(country))||fallback||country;}catch(_e){return fallback||country;}
}
function queryCategories(geo){
  const day=Math.floor(Date.now()/86400000);const size=LOCAL_QUERY_PACKS.en.categories.length;
  const offset=stableOffset([geo.country,geo.region||"NATIONWIDE",day].join("|"),size);
  return [offset,(offset+1)%size,(offset+2)%size];
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
        {role:"system",content:"Create exactly three concise commerce search queries in the requested locale. Use the country's normal local shopping vocabulary. Each query must seek official manufacturers, producers, cooperatives, responsible local sellers, real products, delivery, returns, and customer service. Exclude reports, PDFs, news, research, wikis, marketplaces, and unrelated documents. Do not include or invent URLs. Return JSON only: {\"queries\":[\"...\",\"...\",\"...\"]}."},
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
    return{locale,localName,origin:"static-local-pack",error:null,queries:indices.map(index=>`${locality} ${pack.categories[index%pack.categories.length]} ${pack.commerce}`.replace(/\s+/g," ").trim())};
  }
  const ai=await openAiLocalizedQueries(geo,locale,indices,localName);
  if(ai.queries.length)return{locale,localName,origin:ai.origin,error:null,queries:ai.queries.map(q=>`${locality} ${q}`.replace(/\s+/g," ").trim())};
  const english=LOCAL_QUERY_PACKS.en;const englishName=localCountryName(geo.country,"en",fallbackName);
  const englishLocality=[geo.region&&geo.region!=="NATIONWIDE"?geo.region:"",englishName].filter(Boolean).join(" ");
  return{locale:"en",localName:englishName,origin:"english-language-fallback",error:ai.error,queries:indices.map(index=>`${englishLocality} ${english.categories[index]} ${english.commerce}`.replace(/\s+/g," ").trim())};
}
async function discoveryQueryPlan(geo){
  const locales=localeList(geo.country);const indices=queryCategories(geo);
  const selectedLocales=languagePriorityPlan(geo,locales);
  const bundles=await Promise.all(selectedLocales.map((locale,position)=>{
    const rotated=[indices[position%indices.length],indices[(position+1)%indices.length],indices[(position+2)%indices.length]];
    return queriesForLocale(geo,locale,rotated);
  }));
  const rows=[];const seen=new Set();
  const addRow=(bundle,queryIndex)=>{
    if(!bundle)return;const query=bundle.queries[queryIndex]||bundle.queries[0];if(!query)return;
    const key=bundle.locale.toLowerCase()+"|"+query.toLowerCase();if(seen.has(key))return;seen.add(key);
    rows.push({query,locale:bundle.locale,origin:bundle.origin,localName:bundle.localName,localizationError:bundle.error||null});
  };
  // First pass gives each selected market language one real commerce query.
  bundles.forEach(bundle=>addRow(bundle,0));
  // Remaining provider capacity returns to the primary and bridge languages.
  let round=1;
  while(rows.length<MAX_PROVIDER_CALLS&&round<4){
    for(const bundle of bundles){addRow(bundle,round);if(rows.length>=MAX_PROVIDER_CALLS)break;}
    round+=1;
  }
  return{rows:rows.slice(0,MAX_PROVIDER_CALLS),locales,selectedLocales:rows.map(row=>row.locale),primaryLocale:locales[0]||"en"};
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
function googleKeys(){return{key:envFirst("GOOGLE_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_CUSTOM_SEARCH_API_KEY","GOOGLE_CLOUD_API_KEY"),cx:envFirst("GOOGLE_CSE_ID","GOOGLE_CX","GOOGLE_SEARCH_ENGINE_ID","GOOGLE_CUSTOM_SEARCH_ENGINE_ID","GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID")};}
function naverKeys(){return{id:envFirst("NAVER_API_KEY","NAVER_CLIENT_ID","NAVER_SEARCH_CLIENT_ID","NAVER_OPENAPI_CLIENT_ID"),secret:envFirst("NAVER_CLIENT_SECRET","NAVER_API_SECRET","NAVER_SEARCH_CLIENT_SECRET","NAVER_OPENAPI_CLIENT_SECRET")};}
function resultText(item){return [item&&item.title,item&&item.name,item&&item.summary,item&&item.snippet,item&&item.url,item&&item.link].map(text).join(" ");}
function obviousNonCommerceReason(item){
  const rawUrl=first(item&&item.url,item&&item.link);const u=safeHttpUrl(rawUrl);
  if(!u)return "invalid_url";
  if(BLOCKED_DOCUMENT_EXT_RX.test(u.pathname+u.search))return "document_file";
  if(BLOCKED_REFERENCE_HOST_RX.test(u.hostname))return "reference_or_research_host";
  const hay=resultText(item);
  if(NON_COMMERCE_TEXT_RX.test(hay)&&!COMMERCE_TEXT_RX.test(hay))return "non_commerce_document";
  return "";
}
function commerceHeuristicScore(item){
  const rawUrl=first(item&&item.url,item&&item.link);const u=safeHttpUrl(rawUrl);if(!u)return-100;
  const hay=resultText(item);let score=0;
  if(COMMERCE_TEXT_RX.test(hay))score+=8;
  if(/\/(shop|store|product|products|item|items|catalog|category|collection|collections|mall)(?:\/|$|[?#])/i.test(u.pathname+u.search))score+=8;
  if(/(official|manufacturer|producer|cooperative|brand|authorized|공식|제조사|생산자|협동조합|メーカー|公式|官方|fabricante|producteur|hersteller|производитель|مصنع)/i.test(hay))score+=4;
  if(/([$€£¥₩₹₽]|price|가격|価格|价格|precio|prix|preis|цена|سعر)/i.test(hay))score+=3;
  if(obviousNonCommerceReason(item))score-=40;
  return score;
}
function commerceFirst(items){return (items||[]).filter(item=>!obviousNonCommerceReason(item)).sort((a,b)=>commerceHeuristicScore(b)-commerceHeuristicScore(a));}
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
    const items=commerceFirst((Array.isArray(data.items)?data.items:[]).map(row=>{
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
    const items=commerceFirst((Array.isArray(data.items)?data.items:[]).map(row=>({title:stripHtml(row&&row.title),url:text(row&&row.link),link:text(row&&row.link),summary:stripHtml(row&&row.description),snippet:stripHtml(row&&row.description),source:"naver_country_discovery",provider:"naver",type:"web",payload:{source:"naver",country:geo.country,query,queryLocale:locale,queryOrigin:planRow&&planRow.origin||"unknown"}})).filter(row=>row.title&&row.url));
    return{provider:"naver",query,locale,status:items.length?"ok":"empty",detail:null,items};
  }catch(error){return{provider:"naver",query,locale,status:providerErrorCode(error),detail:providerErrorDetail(error),items:[]};}
}
async function runDirectProviderDiscovery(geo,targetLimit,queryPlan){
  const rows=queryPlan&&queryPlan.rows||[];const tasks=[];const limit=Math.max(1,Math.min(50,Number(targetLimit||20)||20));
  function add(task){if(tasks.length<MAX_PROVIDER_CALLS)tasks.push(task);}
  if(geo.country==="KR"){
    const koreanRows=rows.filter(row=>baseLocale(row&&row.locale)==="ko");
    const localPrimary=koreanRows[0]||rows[0];const localSecondary=koreanRows[1]||localPrimary;
    const bridgeRow=rows.find(row=>baseLocale(row&&row.locale)==="en")||rows[1]||localPrimary;
    add(naverCountrySearch(localPrimary,geo,Math.min(20,limit)));add(googleCountrySearch(localPrimary,geo,Math.min(10,limit)));
    if(limit>10){add(naverCountrySearch(localSecondary,geo,Math.min(20,limit)));add(googleCountrySearch(bridgeRow,geo,Math.min(10,limit)));}
  }else{
    for(let index=0;index<rows.length&&tasks.length<MAX_PROVIDER_CALLS;index+=1)add(googleCountrySearch(rows[index],geo,Math.min(10,limit)));
  }
  if(!tasks.length)return{items:[],trace:[{source:"country-provider",status:"not_configured",count:0,timeoutMs:PROVIDER_FETCH_TIMEOUT,locales:queryPlan&&queryPlan.locales||[]}]} ;
  const settled=await Promise.all(tasks);
  return{items:commerceFirst(settled.flatMap(row=>row.items||[])),trace:settled.map(row=>({source:row.provider,query:row.query,queryLocale:row.locale,queryOrigin:rows.find(plan=>plan.query===row.query&&plan.locale===row.locale)&&rows.find(plan=>plan.query===row.query&&plan.locale===row.locale).origin||"unknown",status:row.status,detail:row.detail||null,count:(row.items||[]).length,timeoutMs:PROVIDER_FETCH_TIMEOUT}))};
}
async function runSanmaruDiscovery(event,geo,targetLimit){
  const queryPlan=await discoveryQueryPlan(geo);let Sanmaru=null;try{Sanmaru=require("./sanmaru_engine_v2");}catch(_e){}
  const providerPromise=runDirectProviderDiscovery(geo,targetLimit,queryPlan);
  if(!Sanmaru||typeof Sanmaru.runEngine!=="function"){
    const provider=await providerPromise;
    return{items:provider.items,trace:[{source:"sanmaru",status:"unavailable",count:0,locales:queryPlan.locales,selectedLocales:queryPlan.selectedLocales,primaryLocale:queryPlan.primaryLocale}].concat(provider.trace)};
  }
  const tasks=queryPlan.rows.slice(0,MAX_LIVE_QUERIES).map(async row=>{
    const q=row.query;
    try{
      const result=await withTimeout(Sanmaru.runEngine(event||{}, {
        q,query:q,country:geo.country,region:geo.region||undefined,limit:18,candidatePool:36,language:row.locale,locale:row.locale,
        type:"site",external:"off",directExternal:"0",noExternal:"1",noMedia:"1",deep:"0",timeoutMs:Math.max(8000,DISCOVERY_TIMEOUT-1500),
        skipMaruSearch:"1",noMaruSearch:"1",skipCollector:"1",noCollector:"1",skipPlanetary:"1",noPlanetary:"1",
        from:"regional-brokerage-autoselector",source:"regional-brokerage-autoselector",
        regionalBrokerageSupply:"1",noAnalytics:"1",noRevenue:"1",readOnly:"1",noWrite:"1",noSync:"1",writeMode:"readonly"
      }),DISCOVERY_TIMEOUT);
      const items=commerceFirst(extractItems(result));return{row,items,status:items.length?"ok":"empty"};
    }catch(error){return{row,items:[],status:providerErrorCode(error),detail:providerErrorDetail(error)};}
  });
  const [settled,provider]=await Promise.all([Promise.all(tasks),providerPromise]);
  return{items:commerceFirst(settled.flatMap(x=>x.items||[]).concat(provider.items||[])),trace:settled.map(x=>({source:"sanmaru",query:x.row.query,queryLocale:x.row.locale,queryOrigin:x.row.origin,status:x.status,detail:x.detail||x.row.localizationError||null,count:(x.items||[]).length,timeoutMs:DISCOVERY_TIMEOUT})).concat(provider.trace||[])};
}

function safeHttpUrl(raw){
  try{const u=new URL(raw);if(u.protocol!=="https:"&&u.protocol!=="http:")return null;const host=u.hostname.toLowerCase();if(!host||host==="localhost"||host.endsWith(".local")||/^\d{1,3}(\.\d{1,3}){3}$/.test(host)||host.includes(":"))return null;return u;}catch(_e){return null;}
}
function htmlTextScore(value){
  const t=String(value||"");
  return{
    shipping:/(shipping|delivery|ship to|dispatch|배송|배달|출고|配達|配送|発送|送貨|送货|envío|entrega|livraison|expédition|lieferung|versand|spedizione|bezorging|доставка|توصيل|شحن|डिलीवरी|वितरण|ডেলিভারি|ترسیل|pengiriman|penghantaran|giao hàng|จัดส่ง|usafirishaji)/i.test(t),
    returns:/(return(?:s| policy)?|refund(?:s| policy)?|exchange(?:s)?|반품|환불|교환|返品|返金|交換|退貨|退款|退货|devoluciones|reembolso|retours|remboursement|rückgabe|erstattung|resi|rimborso|retourneren|terugbetaling|возврат|обмен|إرجاع|استرداد|वापसी|रिफंड|ফেরত|ریفنڈ|pengembalian|pemulangan|đổi trả|hoàn tiền|คืนสินค้า|คืนเงิน|marejesho)/i.test(t),
    service:/(customer service|customer support|contact us|support center|고객센터|고객 지원|문의|カスタマーサービス|お問い合わせ|客服|客戶服務|atención al cliente|servicio al cliente|service client|kundenservice|assistenza clienti|klantenservice|поддержка клиентов|خدمة العملاء|ग्राहक सेवा|কাস্টমার সেবা|کسٹمر سروس|layanan pelanggan|khidmat pelanggan|chăm sóc khách hàng|บริการลูกค้า|huduma kwa wateja)/i.test(t),
    official:/(official|manufacturer|producer|cooperative|brand store|authorized distributor|공식|제조사|생산자|협동조합|농협|축협|수협|공판장|총판|公式|メーカー|生産者|協同組合|官方|製造商|制造商|生產者|生产者|合作社|oficial|fabricante|productor|cooperativa|officiel|fabricant|producteur|coopérative|offiziell|hersteller|erzeuger|genossenschaft|ufficiale|produttore|cooperativa|officieel|fabrikant|producent|coöperatie|официальный|производитель|кооператив|رسمي|مصنع|منتج|تعاونية|आधिकारिक|निर्माता|सहकारी|অফিসিয়াল|প্রস্তুতকারক|সমবায়|resmi|produsen|koperasi|rasmi|pengeluar|chính thức|nhà sản xuất|hợp tác xã|ทางการ|ผู้ผลิต|สหกรณ์|rasmi|mzalishaji|ushirika)/i.test(t)
  };
}
function flattenJsonLd(value,out){if(!value)return;if(Array.isArray(value)){value.forEach(v=>flattenJsonLd(v,out));return;}if(typeof value!=="object")return;out.push(value);if(Array.isArray(value["@graph"]))flattenJsonLd(value["@graph"],out);}
function jsonLdEvidence(html,geo){
  const nodes=[];const rx=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=rx.exec(html))){try{flattenJsonLd(JSON.parse(m[1]),nodes);}catch(_e){}}
  let org=false,product=false,matchCountry=false,matchRegion=false,detectedCountry="",detectedRegion="";
  for(const node of nodes){
    const type=Array.isArray(node["@type"])?node["@type"].join(" "):String(node["@type"]||"");
    if(/Organization|LocalBusiness|Store|Farm|WholesaleStore|OnlineStore|Corporation/i.test(type))org=true;
    if(/Product|Offer|ItemList/i.test(type))product=true;
    const address=node.address||{};
    const country=Core.normalizeCountry(address.addressCountry||node.areaServed||node.countryOfOrigin||"");
    const region=Core.normalizeRegion(address.addressRegion||node.areaServedRegion||"",country||geo.country);
    if(country){detectedCountry=detectedCountry||country;if(geo.country&&country===geo.country)matchCountry=true;}
    if(region){detectedRegion=detectedRegion||region;if(geo.region&&region===geo.region)matchRegion=true;}
  }
  return{org,product,matchCountry,matchRegion,country:detectedCountry,region:detectedRegion};
}
async function inspectCandidate(item,geo){
  const url=Core.externalUrl(item);if(!url)return item;
  const u=safeHttpUrl(url);if(!u)return item;
  try{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),PAGE_CHECK_TIMEOUT);
    const response=await fetch(u.toString(),{redirect:"follow",signal:controller.signal,headers:{"user-agent":"IGDC-MARU-BrokerageVerifier/1.0 (+https://igdc.example)"}});clearTimeout(timer);
    if(!response.ok)return item;
    const finalUrl=safeHttpUrl(response.url||u.toString());if(!finalUrl)return item;
    const type=String(response.headers.get("content-type")||"");if(!/text\/html|application\/xhtml\+xml/i.test(type))return item;
    const length=Number(response.headers.get("content-length")||0);if(length>550000)return item;
    const html=(await response.text()).slice(0,550000);
    const words=htmlTextScore(html);const ld=jsonLdEvidence(html,geo);
    const evidence=Object.assign({},item.brokerageVerification||{}, { automated:true, inspectedAt:new Date().toISOString(), official:words.official||ld.org, shipping:words.shipping, returns:words.returns, service:words.service, jsonLdOrganization:ld.org, jsonLdProduct:ld.product, inspectedUrl:finalUrl.toString() });
    // Do not infer a seller's legal distribution market merely from the visitor's IP.
    // Only retain a live candidate when its source already carries a market scope,
    // or the official page exposes country/region metadata through JSON-LD.
    const detectedCountry=ld.country||Core.normalizeCountry(item.distributionMarketCountry||item.sellerMarketCountry||item.marketCountry||item.country||item.geo&&item.geo.country);
    const detectedRegion=ld.region||Core.normalizeRegion(item.distributionMarketRegion||item.sellerRegion||item.region||item.geo&&item.geo.state,detectedCountry);
    const scope=Object.assign({},item,{
      distributionMarketCountry:detectedCountry||undefined,
      distributionMarketRegion:detectedRegion||undefined,
      availabilityCountries:item.availabilityCountries||item.shippingCountries||(detectedCountry?[detectedCountry]:undefined),
      availabilityRegions:item.availabilityRegions||item.shippingRegions||(detectedRegion?[detectedRegion]:undefined),
      nationalAvailability:item.nationalAvailability===true||(!detectedRegion&&detectedCountry===geo.country&&ld.matchCountry)
    });
    return Object.assign({},scope,{url:finalUrl.toString(),officialSource:item.officialSource||evidence.official,sellerVerified:item.sellerVerified||false,brokerageVerification:evidence,shippingAvailable:item.shippingAvailable||evidence.shipping,returnPolicyAvailable:item.returnPolicyAvailable||evidence.returns,customerServiceAvailable:item.customerServiceAvailable||evidence.service,sourceTrust:Math.max(Number(item.sourceTrust||0), evidence.official&&evidence.shipping&&(evidence.returns||evidence.service)&&detectedCountry?0.65:0)});
  }catch(_e){return item;}
}
async function inspectLive(items,geo){
  const unique=[];const seen=new Set();
  for(const item of commerceFirst(items||[])){
    const url=Core.externalUrl(item);if(!url||seen.has(url))continue;seen.add(url);unique.push(item);if(unique.length>=MAX_PAGE_CHECKS)break;
  }
  return await Promise.all(unique.map(item=>inspectCandidate(item,geo)));
}
function privateReviewPool(rawItems,inspectedItems,geo,limit){
  const inspected=new Map();for(const item of inspectedItems||[]){const url=Core.externalUrl(item);if(url)inspected.set(url,item);}
  const out=[];const seen=new Set();
  for(const raw of commerceFirst(rawItems||[])){
    const url=Core.externalUrl(raw);if(!url||seen.has(url)||Core.isMarketplace(raw,url)||obviousNonCommerceReason(raw))continue;
    const item=inspected.get(url)||raw;const title=first(item&&item.title,item&&item.name,item&&item.label);if(!title)continue;
    const sourceText=lower([item&&item.source,item&&item.provider,item&&item.sourceType,item&&item.generatedBy].filter(Boolean).join(" "));
    if(/sanmaru-route|sanmaru-opening|provider-page-window|provider-window|search-route-hint/.test(sourceText))continue;
    const evidence=item&&item.brokerageVerification||{};
    const commerceSignal=commerceHeuristicScore(item)>0||evidence.jsonLdProduct||evidence.jsonLdOrganization||evidence.shipping||evidence.returns||evidence.service;
    if(!commerceSignal)continue;
    seen.add(url);
    out.push(Object.assign({},item,{
      igdcPrivateReviewOnly:true,igdcCollectionStage:"country-local-language-commerce-discovery",
      igdcCollectionScope:{country:geo.country,region:geo.region||"NATIONWIDE",collectedAt:new Date().toISOString(),locales:localeList(geo.country)},
      brokerageVerification:Object.assign({},evidence,{privateQueueOnly:true,publicEligible:false,obviousNonCommerce:false})
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
  const geo=explicitCountry?{country:explicitCountry,region:Core.normalizeRegion(requested.region||requested.targetRegion,explicitCountry),city:"",countryName:Core.COUNTRY_NAMES[explicitCountry]||explicitCountry}:Core.parseGeo(event,requested);
  const privateCollection=requested.privateCollection===true||String(requested.privateCollection||"").toLowerCase()==="true";
  const privateLimit=Math.max(1,Math.min(50,Number(requested.privateLimit||requested.maxCandidates||20)||20));
  const key=cacheKey(geo,privateCollection?"private":"front");const cached=getCache(key);if(cached)return Object.assign({},cached,{meta:Object.assign({},cached.meta||{},{cache:"hit"})});
  const started=Date.now();const stored=Core.loadStoredCandidates();let selected=Core.selection(stored.items,geo);let discovery={items:[],trace:[]},checked=[],privateReviewItems=[];
  if((privateCollection||selected.accepted.length<6)&&geo.country!=="GLOBAL"){
    discovery=await runSanmaruDiscovery(event,geo,privateLimit);
    checked=await inspectLive(discovery.items,geo);
    selected=Core.selection(stored.items.concat(checked),geo);
    if(privateCollection)privateReviewItems=privateReviewPool(discovery.items,checked,geo,privateLimit);
  }
  const template=templateSnapshot();const snapshot=selected.accepted.length&&template?Core.buildSnapshot(template,selected.accepted,geo,{storedSources:stored.sources,discovery:discovery.trace,stats:selected.stats,elapsedMs:Date.now()-started}):null;
  const result={status:"ok",engine:"regional-brokerage-autoselector",version:VERSION,geo:{country:geo.country,region:geo.region||null,precision:geo.region?"coarse-region":"country",source:explicitCountry?"explicit-scope":"request-ip"},items:selected.accepted.map(x=>x.item),privateReviewItems,snapshot,meta:{cache:"miss",countryLocales:localeList(geo.country),selection:selected.stats,rejections:selected.rejected.slice(0,80),discovery:discovery.trace,privateReview:{enabled:privateCollection,raw:discovery.items.length,inspected:checked.length,count:privateReviewItems.length,publicPublication:false},elapsedMs:Date.now()-started,hasSnapshot:!!snapshot}};
  return setCache(key,result);
}

module.exports={VERSION,runSelection};
