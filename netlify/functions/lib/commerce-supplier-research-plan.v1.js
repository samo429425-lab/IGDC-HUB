"use strict";

/*
 * IGDC global responsible-supplier research plan.
 *
 * This module only builds private research queries and SearchBank seed rows.
 * It does not publish products, rewrite SearchBank/Snapshot/PSOM, process
 * checkout, or weaken the public release gate.
 */

const fs = require("fs");
const path = require("path");

const VERSION = "commerce-supplier-research-plan-v1.4.1-global-plus-restored-kr-supply-mesh";

function text(value){ return String(value == null ? "" : value).trim(); }
function lower(value){ return text(value).toLowerCase(); }
function array(value){ return Array.isArray(value) ? value : []; }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function first(){ for(const value of arguments){ const out=text(value); if(out) return out; } return ""; }
function safeRead(file, fallback){ try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch(_error){ return fallback; } }
function roots(){ return [process.cwd(), path.resolve(__dirname, "..", "..", "..")]; }
function findFile(candidates){
  for(const root of roots()){
    for(const rel of candidates){
      const file=path.resolve(root, rel);
      try { if(fs.statSync(file).isFile()) return file; } catch(_error){}
    }
  }
  return "";
}
function safeUrl(value){
  try{
    const u=new URL(text(value));
    if(!["https:","http:"].includes(u.protocol) || !u.hostname || u.username || u.password) return "";
    if(u.hostname === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)) return "";
    return u.toString();
  }catch(_error){ return ""; }
}
function stableOffset(value, size){
  let hash=0;
  for(const ch of String(value || "")) hash=((hash<<5)-hash+ch.charCodeAt(0))|0;
  return size ? Math.abs(hash)%size : 0;
}
function unique(values, limit){
  const out=[]; const seen=new Set();
  for(const raw of values){
    const value=text(raw).replace(/\s+/g," ");
    const key=lower(value);
    if(!value || seen.has(key)) continue;
    seen.add(key); out.push(value);
    if(limit && out.length>=limit) break;
  }
  return out;
}
function words(value){
  return unique(text(value).replace(/[^0-9A-Za-z가-힣ぁ-んァ-ン一-龥À-žА-яЁёΆ-ώ؀-ۿऀ-ॿก-๿\s-]/g," ").split(/\s+/).filter(token=>token.length>=2), 160);
}
function baseLocale(locale){ return text(locale).split("-")[0].toLowerCase() || "en"; }
function localCountryName(country, locale, fallback){
  try{
    const names=new Intl.DisplayNames([locale],{type:"region"});
    return text(names.of(country)) || fallback || country;
  }catch(_error){ return fallback || country; }
}
function sanitizeQuery(value){ return text(value).replace(/\s+/g," ").slice(0,760); }

const LANE_ORDER = Object.freeze([
  "agri_cooperative",
  "manufacturer_brand",
  "food_essentials",
  "consumer_goods",
  "industrial_goods",
  "regional_market",
  "wholesale_distribution",
  "small_business",
  "public_directory"
]);

// Preserve the proven Korean discovery mesh from v1.3. The global language
// packs remain active for every other country; KR uses these detailed local
// producer/manufacturer/distributor queries so a generic global query rotation
// cannot narrow the supplier pool again.
const KR_FOUNDATION_QUERIES = Object.freeze([
  "대한민국 생활필수품 식료품 농수축임산물 생산자 농협 축협 수협 산림조합 협동조합 공식몰 직거래 배송 반품 환불 고객센터",
  "대한민국 표고버섯 느타리버섯 목이버섯 버섯 재배 농가 산림조합 영농조합법인 공식몰 직거래 택배",
  "대한민국 농협 축협 수협 산림조합 협동조합 로컬푸드 직매장 공식몰 직거래 배송 반품 고객센터",
  "대한민국 지역농협 지역축협 지역수협 산림조합 온라인 쇼핑몰 특산품 농산물 수산물 임산물",
  "대한민국 사과 농장 참외 농장 토마토 농장 딸기 농장 버섯 재배 고사리 농가 영농조합법인 직거래 택배",
  "대한민국 농업회사법인 식품 제조업체 가공식품 공장 생산자 공식 온라인몰 배송 반품 환불 고객센터",
  "대한민국 전통시장 상인회 지역특산품 공동몰 로컬푸드 생산자 공동판매 온라인 주문 배송 반품",
  "대한민국 화장품 제조사 브랜드 본사 책임판매업자 공식몰 제품 구매 배송 반품 환불 고객센터",
  "대한민국 지역 유통업체 도매 총판 공판장 소규모 유통업체 공식 판매처 온라인 주문 배송 반품",
  "대한민국 생활용품 주방용품 가구 침구 제조사 생산업체 직영몰 공식 판매처 배송 반품 고객지원",
  "대한민국 전자제품 소형가전 부품 공구 산업용품 제조사 공장 직영몰 온라인 주문 배송 반품",
  "대한민국 기계 금속 플라스틱 목재 포장재 사무용품 제조업체 자체 쇼핑몰 제품 카탈로그 구매",
  "대한민국 의류 신발 가방 섬유 봉제 제조사 브랜드 직영몰 공식 온라인 판매처",
  "대한민국 유아용품 교육용품 문구 완구 제조사 공식몰 배송 반품 고객지원",
  "대한민국 사회적기업 마을기업 협동조합 자활기업 생산품 공식몰 온라인 판매 배송 반품",
  "대한민국 지자체 농업기술센터 생산자 명단 지역 기업 제품 공식 판매몰"
]);
const KR_PRODUCT_CLUSTERS = Object.freeze([
  "사과 배 복숭아 포도 감귤 딸기 참외 수박 토마토", "버섯 표고버섯 느타리버섯 고사리 나물 산채",
  "쌀 잡곡 콩 참깨 들깨 고춧가루 마늘 양파", "한우 돼지고기 닭고기 계란 우유 치즈 축산물",
  "수산물 건어물 김 미역 젓갈 전복 굴 새우", "임산물 밤 대추 호두 잣 꿀 약초",
  "김치 장류 반찬 떡 한과 전통식품 가공식품", "건강식품 차 음료 주스 발효식품",
  "화장품 스킨케어 헤어케어 바디케어 미용용품", "생활용품 세제 위생용품 주방용품",
  "의류 신발 가방 패션잡화", "가구 침구 인테리어 생활가전", "전자제품 액세서리 소형가전", "유아용품 교육용품 문구 완구"
]);
const KR_ENTITY_CLUSTERS = Object.freeze([
  "농가 농장 생산자 영농조합법인 농업회사법인", "농협 축협 수협 산림조합 협동조합",
  "제조사 제조업체 공장 브랜드 본사 책임판매업자", "지역 유통업체 도매 총판 공판장 로컬푸드 직매장",
  "소규모 판매업체 직영몰 공식 판매처 온라인몰"
]);

const PACKS = Object.freeze({
  en:{commerce:"official online store direct sales shipping returns refunds customer support",lanes:{
    agri_cooperative:"producer farm agricultural fishery forestry cooperative local products",
    manufacturer_brand:"manufacturer factory brand owner official products",
    food_essentials:"food groceries household essentials responsible seller",
    consumer_goods:"beauty personal care clothing shoes bags electronics home kitchen baby education products",
    industrial_goods:"industrial goods tools parts machinery materials manufacturer product catalog",
    regional_market:"regional products traditional market producer collective local ecommerce",
    wholesale_distribution:"authorized distributor wholesaler regional supplier official ordering",
    small_business:"small business social enterprise cooperative maker official store",
    public_directory:"official producer directory chamber of commerce cooperative member directory manufacturer registry"
  }},
  ko:{commerce:"공식 온라인몰 직영 판매 배송 반품 환불 고객센터",lanes:{
    agri_cooperative:"생산자 농가 농협 축협 수협 산림조합 협동조합 지역 특산품",
    manufacturer_brand:"제조사 공장 브랜드 본사 공식 제품",
    food_essentials:"식품 식료품 생활필수품 책임 판매업체",
    consumer_goods:"화장품 개인용품 의류 신발 가방 전자제품 가전 주방 유아 교육용품",
    industrial_goods:"산업재 공구 부품 기계 자재 제조업체 제품 카탈로그",
    regional_market:"지역 특산품 전통시장 생산자 공동판매 로컬 온라인몰",
    wholesale_distribution:"공식 총판 도매 지역 유통업체 온라인 주문",
    small_business:"소상공인 사회적기업 마을기업 협동조합 제조 판매",
    public_directory:"공식 생산자 명단 상공회의소 협동조합 회원 제조업체 사업자 목록"
  }},
  ja:{commerce:"公式 オンラインストア 直販 配送 返品 返金 カスタマーサポート",lanes:{
    agri_cooperative:"生産者 農家 農業協同組合 漁業協同組合 森林組合 地域商品",
    manufacturer_brand:"メーカー 工場 ブランド本社 公式商品",
    food_essentials:"食品 食料品 日用品 責任販売事業者",
    consumer_goods:"化粧品 衣料 靴 バッグ 電子機器 家電 キッチン ベビー 教育用品",
    industrial_goods:"産業用品 工具 部品 機械 資材 メーカー 製品カタログ",
    regional_market:"地域特産品 商店街 生産者共同販売 地域通販",
    wholesale_distribution:"正規代理店 卸売 地域流通業者 公式注文",
    small_business:"中小企業 社会的企業 協同組合 メーカー 公式販売",
    public_directory:"公式 生産者名簿 商工会議所 協同組合会員 メーカー名簿"
  }},
  "zh-Hans":{commerce:"官方 网上商城 直营 销售 配送 退货 退款 客服",lanes:{
    agri_cooperative:"生产者 农场 农业合作社 渔业合作社 林业合作社 地方产品",
    manufacturer_brand:"制造商 工厂 品牌总部 官方产品",
    food_essentials:"食品 杂货 生活必需品 责任销售商",
    consumer_goods:"美容 个护 服装 鞋 包 电子 家电 厨房 母婴 教育用品",
    industrial_goods:"工业品 工具 零部件 机械 材料 制造商 产品目录",
    regional_market:"地方特产 传统市场 生产者联合销售 本地电商",
    wholesale_distribution:"授权经销商 批发商 地方供应商 官方订购",
    small_business:"中小企业 社会企业 合作社 制造商 官方商店",
    public_directory:"官方 生产者名录 商会 合作社会员 制造商名录 企业信息"
  }},
  "zh-Hant":{commerce:"官方 網上商店 直營 銷售 配送 退貨 退款 客服",lanes:{
    agri_cooperative:"生產者 農場 農業合作社 漁業合作社 林業合作社 地方產品",
    manufacturer_brand:"製造商 工廠 品牌總部 官方產品",
    food_essentials:"食品 雜貨 生活必需品 責任銷售商",
    consumer_goods:"美容 個護 服裝 鞋 包 電子 家電 廚房 母嬰 教育用品",
    industrial_goods:"工業品 工具 零件 機械 材料 製造商 產品目錄",
    regional_market:"地方特產 傳統市場 生產者聯合銷售 本地電商",
    wholesale_distribution:"授權經銷商 批發商 地區供應商 官方訂購",
    small_business:"中小企業 社會企業 合作社 製造商 官方商店",
    public_directory:"官方 生產者名錄 商會 合作社會員 製造商名錄 企業資料"
  }},
  es:{commerce:"tienda oficial en línea venta directa envío devoluciones reembolsos atención al cliente",lanes:{
    agri_cooperative:"productor finca cooperativa agrícola pesquera forestal productos locales",
    manufacturer_brand:"fabricante fábrica propietario de marca productos oficiales",
    food_essentials:"alimentos comestibles artículos esenciales vendedor responsable",
    consumer_goods:"belleza ropa calzado bolsos electrónica hogar cocina bebé educación",
    industrial_goods:"bienes industriales herramientas piezas maquinaria materiales fabricante catálogo",
    regional_market:"productos regionales mercado tradicional venta colectiva productores comercio local",
    wholesale_distribution:"distribuidor autorizado mayorista proveedor regional pedidos oficiales",
    small_business:"pequeña empresa empresa social cooperativa fabricante tienda oficial",
    public_directory:"directorio oficial productores cámara de comercio cooperativas fabricantes registro empresarial"
  }},
  pt:{commerce:"loja oficial online venda direta entrega devoluções reembolsos atendimento ao cliente",lanes:{
    agri_cooperative:"produtor fazenda cooperativa agrícola pesqueira florestal produtos locais",
    manufacturer_brand:"fabricante fábrica proprietário da marca produtos oficiais",
    food_essentials:"alimentos mercearia itens essenciais vendedor responsável",
    consumer_goods:"beleza roupas calçados bolsas eletrônicos casa cozinha bebê educação",
    industrial_goods:"bens industriais ferramentas peças máquinas materiais fabricante catálogo",
    regional_market:"produtos regionais mercado tradicional venda coletiva produtores comércio local",
    wholesale_distribution:"distribuidor autorizado atacadista fornecedor regional pedidos oficiais",
    small_business:"pequena empresa empresa social cooperativa fabricante loja oficial",
    public_directory:"diretório oficial produtores câmara de comércio cooperativas fabricantes registro empresarial"
  }},
  fr:{commerce:"boutique officielle en ligne vente directe livraison retours remboursements service client",lanes:{
    agri_cooperative:"producteur ferme coopérative agricole halieutique forestière produits locaux",
    manufacturer_brand:"fabricant usine propriétaire de marque produits officiels",
    food_essentials:"alimentation épicerie produits essentiels vendeur responsable",
    consumer_goods:"beauté vêtements chaussures sacs électronique maison cuisine bébé éducation",
    industrial_goods:"biens industriels outils pièces machines matériaux fabricant catalogue",
    regional_market:"produits régionaux marché traditionnel vente collective producteurs commerce local",
    wholesale_distribution:"distributeur agréé grossiste fournisseur régional commande officielle",
    small_business:"petite entreprise entreprise sociale coopérative fabricant boutique officielle",
    public_directory:"annuaire officiel producteurs chambre de commerce coopératives fabricants registre entreprises"
  }},
  de:{commerce:"offizieller Onlineshop Direktverkauf Lieferung Rückgabe Erstattung Kundenservice",lanes:{
    agri_cooperative:"Erzeuger Bauernhof Landwirtschaft Fischerei Forst Genossenschaft regionale Produkte",
    manufacturer_brand:"Hersteller Fabrik Markeninhaber offizielle Produkte",
    food_essentials:"Lebensmittel Haushaltsbedarf verantwortlicher Verkäufer",
    consumer_goods:"Kosmetik Kleidung Schuhe Taschen Elektronik Haushalt Küche Baby Bildung",
    industrial_goods:"Industriegüter Werkzeuge Teile Maschinen Materialien Hersteller Katalog",
    regional_market:"regionale Produkte traditioneller Markt Erzeugergemeinschaft lokaler Handel",
    wholesale_distribution:"autorisierter Händler Großhändler regionaler Lieferant offizielle Bestellung",
    small_business:"Kleinunternehmen Sozialunternehmen Genossenschaft Hersteller offizieller Shop",
    public_directory:"offizielles Erzeugerverzeichnis Handelskammer Genossenschaftsmitglieder Herstellerregister"
  }},
  it:{commerce:"negozio online ufficiale vendita diretta spedizione resi rimborsi assistenza clienti",lanes:{
    agri_cooperative:"produttore azienda agricola cooperativa agricola ittica forestale prodotti locali",
    manufacturer_brand:"produttore fabbrica proprietario marchio prodotti ufficiali",
    food_essentials:"alimentari generi essenziali venditore responsabile",
    consumer_goods:"bellezza abbigliamento scarpe borse elettronica casa cucina bambini istruzione",
    industrial_goods:"beni industriali utensili componenti macchinari materiali produttore catalogo",
    regional_market:"prodotti regionali mercato tradizionale vendita collettiva produttori commercio locale",
    wholesale_distribution:"distributore autorizzato grossista fornitore regionale ordine ufficiale",
    small_business:"piccola impresa impresa sociale cooperativa produttore negozio ufficiale",
    public_directory:"elenco ufficiale produttori camera di commercio cooperative produttori registro imprese"
  }},
  nl:{commerce:"officiële webshop directe verkoop levering retourneren terugbetaling klantenservice",lanes:{
    agri_cooperative:"producent boerderij landbouw visserij bosbouw coöperatie lokale producten",
    manufacturer_brand:"fabrikant fabriek merkeigenaar officiële producten",
    food_essentials:"voeding boodschappen essentiële goederen verantwoordelijke verkoper",
    consumer_goods:"schoonheid kleding schoenen tassen elektronica huis keuken baby onderwijs",
    industrial_goods:"industriële goederen gereedschap onderdelen machines materialen fabrikant catalogus",
    regional_market:"regionale producten traditionele markt producentencollectief lokale handel",
    wholesale_distribution:"erkende distributeur groothandel regionale leverancier officiële bestelling",
    small_business:"kleinbedrijf sociale onderneming coöperatie fabrikant officiële winkel",
    public_directory:"officiële producentengids kamer van koophandel coöperaties fabrikantenregister"
  }},
  ru:{commerce:"официальный интернет-магазин прямые продажи доставка возврат возмещение поддержка клиентов",lanes:{
    agri_cooperative:"производитель ферма сельскохозяйственный рыболовный лесной кооператив местные товары",
    manufacturer_brand:"производитель завод владелец бренда официальные товары",
    food_essentials:"продукты питания товары первой необходимости ответственный продавец",
    consumer_goods:"косметика одежда обувь сумки электроника дом кухня дети образование",
    industrial_goods:"промышленные товары инструменты детали оборудование материалы производитель каталог",
    regional_market:"региональные товары традиционный рынок объединение производителей местная торговля",
    wholesale_distribution:"авторизованный дистрибьютор оптовик региональный поставщик официальный заказ",
    small_business:"малый бизнес социальное предприятие кооператив производитель официальный магазин",
    public_directory:"официальный реестр производителей торговая палата кооперативы каталог предприятий"
  }},
  ar:{commerce:"متجر رسمي عبر الإنترنت بيع مباشر توصيل إرجاع استرداد خدمة العملاء",lanes:{
    agri_cooperative:"منتج مزرعة تعاونية زراعية سمكية غابية منتجات محلية",
    manufacturer_brand:"مصنع مصنع إنتاج مالك علامة تجارية منتجات رسمية",
    food_essentials:"أغذية بقالة سلع أساسية بائع مسؤول",
    consumer_goods:"جمال ملابس أحذية حقائب إلكترونيات منزل مطبخ أطفال تعليم",
    industrial_goods:"سلع صناعية أدوات قطع غيار آلات مواد مصنع كتالوج",
    regional_market:"منتجات إقليمية سوق تقليدي بيع جماعي للمنتجين تجارة محلية",
    wholesale_distribution:"موزع معتمد تاجر جملة مورد إقليمي طلب رسمي",
    small_business:"مشروع صغير مؤسسة اجتماعية تعاونية مصنع متجر رسمي",
    public_directory:"دليل رسمي للمنتجين غرفة التجارة التعاونيات سجل المصنعين الشركات"
  }},
  tr:{commerce:"resmi çevrimiçi mağaza doğrudan satış teslimat iade geri ödeme müşteri hizmetleri",lanes:{
    agri_cooperative:"üretici çiftlik tarım balıkçılık ormancılık kooperatifi yerel ürünler",
    manufacturer_brand:"üretici fabrika marka sahibi resmi ürünler",
    food_essentials:"gıda market temel ihtiyaç sorumlu satıcı",
    consumer_goods:"güzellik giyim ayakkabı çanta elektronik ev mutfak bebek eğitim",
    industrial_goods:"sanayi ürünleri aletler parçalar makineler malzemeler üretici katalog",
    regional_market:"bölgesel ürünler geleneksel pazar üretici topluluğu yerel ticaret",
    wholesale_distribution:"yetkili distribütör toptancı bölgesel tedarikçi resmi sipariş",
    small_business:"küçük işletme sosyal girişim kooperatif üretici resmi mağaza",
    public_directory:"resmi üretici rehberi ticaret odası kooperatif üyeleri üretici sicili"
  }},
  id:{commerce:"toko online resmi penjualan langsung pengiriman pengembalian dana layanan pelanggan",lanes:{
    agri_cooperative:"produsen petani koperasi pertanian perikanan kehutanan produk lokal",
    manufacturer_brand:"produsen pabrik pemilik merek produk resmi",
    food_essentials:"makanan kebutuhan pokok penjual bertanggung jawab",
    consumer_goods:"kecantikan pakaian sepatu tas elektronik rumah dapur bayi pendidikan",
    industrial_goods:"barang industri alat suku cadang mesin bahan produsen katalog",
    regional_market:"produk daerah pasar tradisional kolektif produsen perdagangan lokal",
    wholesale_distribution:"distributor resmi grosir pemasok regional pemesanan resmi",
    small_business:"usaha kecil perusahaan sosial koperasi produsen toko resmi",
    public_directory:"direktori resmi produsen kamar dagang koperasi daftar perusahaan manufaktur"
  }},
  ms:{commerce:"kedai dalam talian rasmi jualan terus penghantaran pemulangan bayaran balik khidmat pelanggan",lanes:{
    agri_cooperative:"pengeluar ladang koperasi pertanian perikanan perhutanan produk tempatan",
    manufacturer_brand:"pengilang kilang pemilik jenama produk rasmi",
    food_essentials:"makanan barangan asas penjual bertanggungjawab",
    consumer_goods:"kecantikan pakaian kasut beg elektronik rumah dapur bayi pendidikan",
    industrial_goods:"barangan industri alat bahagian mesin bahan pengilang katalog",
    regional_market:"produk wilayah pasar tradisional jualan kolektif pengeluar perdagangan tempatan",
    wholesale_distribution:"pengedar sah pemborong pembekal wilayah pesanan rasmi",
    small_business:"perniagaan kecil perusahaan sosial koperasi pengilang kedai rasmi",
    public_directory:"direktori rasmi pengeluar dewan perniagaan koperasi daftar syarikat"
  }},
  vi:{commerce:"cửa hàng trực tuyến chính thức bán trực tiếp giao hàng đổi trả hoàn tiền chăm sóc khách hàng",lanes:{
    agri_cooperative:"nhà sản xuất trang trại hợp tác xã nông ngư lâm sản địa phương",
    manufacturer_brand:"nhà sản xuất nhà máy chủ thương hiệu sản phẩm chính thức",
    food_essentials:"thực phẩm hàng thiết yếu người bán chịu trách nhiệm",
    consumer_goods:"làm đẹp quần áo giày túi điện tử gia dụng bếp trẻ em giáo dục",
    industrial_goods:"hàng công nghiệp dụng cụ phụ tùng máy móc vật liệu nhà sản xuất danh mục",
    regional_market:"sản phẩm vùng chợ truyền thống liên minh nhà sản xuất thương mại địa phương",
    wholesale_distribution:"nhà phân phối ủy quyền bán buôn nhà cung cấp vùng đặt hàng chính thức",
    small_business:"doanh nghiệp nhỏ doanh nghiệp xã hội hợp tác xã nhà sản xuất cửa hàng chính thức",
    public_directory:"danh bạ chính thức nhà sản xuất phòng thương mại hợp tác xã đăng ký doanh nghiệp"
  }},
  th:{commerce:"ร้านค้าออนไลน์ทางการ ขายตรง จัดส่ง คืนสินค้า คืนเงิน บริการลูกค้า",lanes:{
    agri_cooperative:"ผู้ผลิต ฟาร์ม สหกรณ์ เกษตร ประมง ป่าไม้ สินค้าท้องถิ่น",
    manufacturer_brand:"ผู้ผลิต โรงงาน เจ้าของแบรนด์ สินค้าทางการ",
    food_essentials:"อาหาร ของจำเป็น ผู้ขายที่รับผิดชอบ",
    consumer_goods:"ความงาม เสื้อผ้า รองเท้า กระเป๋า อิเล็กทรอนิกส์ บ้าน ครัว เด็ก การศึกษา",
    industrial_goods:"สินค้าอุตสาหกรรม เครื่องมือ อะไหล่ เครื่องจักร วัสดุ ผู้ผลิต แคตตาล็อก",
    regional_market:"สินค้าภูมิภาค ตลาดดั้งเดิม กลุ่มผู้ผลิต การค้าท้องถิ่น",
    wholesale_distribution:"ผู้จัดจำหน่ายที่ได้รับอนุญาต ผู้ค้าส่ง ผู้จัดหาภูมิภาค สั่งซื้อทางการ",
    small_business:"ธุรกิจขนาดเล็ก วิสาหกิจเพื่อสังคม สหกรณ์ ผู้ผลิต ร้านค้าทางการ",
    public_directory:"รายชื่อผู้ผลิตทางการ หอการค้า สมาชิกสหกรณ์ ทะเบียนธุรกิจ"
  }},
  hi:{commerce:"आधिकारिक ऑनलाइन स्टोर प्रत्यक्ष बिक्री डिलीवरी वापसी रिफंड ग्राहक सेवा",lanes:{
    agri_cooperative:"उत्पादक किसान कृषि मत्स्य वन सहकारी स्थानीय उत्पाद",
    manufacturer_brand:"निर्माता कारखाना ब्रांड मालिक आधिकारिक उत्पाद",
    food_essentials:"खाद्य किराना आवश्यक वस्तुएँ जिम्मेदार विक्रेता",
    consumer_goods:"सौंदर्य कपड़े जूते बैग इलेक्ट्रॉनिक्स घर रसोई बच्चा शिक्षा",
    industrial_goods:"औद्योगिक वस्तुएँ उपकरण पुर्जे मशीन सामग्री निर्माता कैटलॉग",
    regional_market:"क्षेत्रीय उत्पाद पारंपरिक बाजार उत्पादक समूह स्थानीय वाणिज्य",
    wholesale_distribution:"अधिकृत वितरक थोक विक्रेता क्षेत्रीय आपूर्तिकर्ता आधिकारिक ऑर्डर",
    small_business:"लघु व्यवसाय सामाजिक उद्यम सहकारी निर्माता आधिकारिक स्टोर",
    public_directory:"आधिकारिक उत्पादक निर्देशिका वाणिज्य मंडल सहकारी सदस्य निर्माता रजिस्टर"
  }},
  sw:{commerce:"duka rasmi mtandaoni mauzo ya moja kwa moja usafirishaji marejesho huduma kwa wateja",lanes:{
    agri_cooperative:"mzalishaji shamba ushirika kilimo uvuvi misitu bidhaa za eneo",
    manufacturer_brand:"mtengenezaji kiwanda mmiliki wa chapa bidhaa rasmi",
    food_essentials:"chakula mahitaji muhimu muuzaji anayewajibika",
    consumer_goods:"urembo mavazi viatu mifuko elektroniki nyumba jikoni watoto elimu",
    industrial_goods:"bidhaa za viwanda zana vipuri mashine vifaa mtengenezaji katalogi",
    regional_market:"bidhaa za mkoa soko la jadi muungano wa wazalishaji biashara ya eneo",
    wholesale_distribution:"msambazaji aliyeidhinishwa jumla mtoa huduma wa mkoa agizo rasmi",
    small_business:"biashara ndogo biashara ya kijamii ushirika mtengenezaji duka rasmi",
    public_directory:"orodha rasmi ya wazalishaji chumba cha biashara wanachama wa ushirika sajili ya kampuni"
  }}
});

const COUNTRY_BOOSTS = Object.freeze({
  KR:["지역농협 지역축협 지역수협 산림조합 영농조합법인 공식몰", "지자체 농업기술센터 생산자 명단 지역 기업 제품"],
  JP:["JA 農業協同組合 JF 漁業協同組合 森林組合 公式通販", "商工会議所 地域メーカー 公式オンラインショップ"],
  CN:["农业合作社 供销合作社 地方制造商 官方商城", "企业信息 制造商 名录 官方销售"],
  TW:["農會 漁會 生產合作社 地方品牌 官方購物", "商業登記 製造商 名錄 官方商店"],
  BR:["cooperativa de produtores agricultura familiar loja oficial", "SEBRAE indústria local fabricante loja virtual"],
  IN:["farmer producer organisation cooperative manufacturer official store", "MSME manufacturer directory direct online sales"],
  ID:["koperasi produsen UMKM pabrik toko resmi", "kamar dagang daftar produsen penjualan online"],
  VN:["hợp tác xã nông nghiệp nhà sản xuất địa phương cửa hàng chính thức", "phòng thương mại danh bạ doanh nghiệp sản xuất bán hàng trực tuyến"],
  TH:["สหกรณ์การเกษตร ผู้ผลิตชุมชน ร้านค้าออนไลน์ทางการ", "หอการค้า รายชื่อโรงงาน ผู้ผลิต จำหน่ายออนไลน์"],
  RU:["сельскохозяйственный кооператив региональный производитель официальный магазин", "торгово промышленная палата реестр производителей интернет магазин"],
  TR:["üretici kooperatifi yerel üretici resmi mağaza", "ticaret odası üretici rehberi çevrimiçi satış"],
  AE:["local manufacturer cooperative official ecommerce delivery returns", "chamber of commerce supplier directory official store"],
  ZA:["producer cooperative local manufacturer official online store", "chamber of commerce supplier directory delivery returns"],
  AU:["regional producer cooperative manufacturer official online store", "industry association supplier directory direct sales"],
  CA:["regional producer cooperative manufacturer official online store", "chamber of commerce supplier directory direct ecommerce"],
  US:["regional producer cooperative manufacturer official online store", "state manufacturer directory chamber of commerce direct sales"]
});

function packForLocale(locale){ return PACKS[locale] || PACKS[baseLocale(locale)] || PACKS.en; }

function loadSources(){
  const psomFile=findFile(["data/psom.json","netlify/functions/data/psom.json","assets/hero/psom.json"]);
  const bankFile=findFile(["data/search-bank.research-reservoir.snapshot.json","netlify/functions/data/search-bank.research-reservoir.snapshot.json","netlify/functions/search-bank.research-reservoir.snapshot.json","data/search-bank.snapshot.json","netlify/functions/data/search-bank.snapshot.json","netlify/functions/search-bank.snapshot.json"]);
  const commerceFile=findFile(["netlify/functions/data/commerce-candidate-policy.v1.json","data/commerce-candidate-policy.v1.json"]);
  const regionalFile=findFile(["netlify/functions/data/regional-brokerage-policy.json","data/regional-brokerage-policy.json"]);
  return {
    psomFile,bankFile,commerceFile,regionalFile,
    psom:safeRead(psomFile,{}),
    bank:safeRead(bankFile,{items:[]}),
    commerce:safeRead(commerceFile,{}),
    regional:safeRead(regionalFile,{})
  };
}
function psomTerms(psom){
  const page=psom && psom.pages && psom.pages.distribution;
  const labels=psom && psom.sectionLabels && psom.sectionLabels.distribution;
  const rows=array(psom && psom.items).filter(row=>row && row.page==="distribution");
  return unique([].concat(array(page && page.sections),Object.values(labels && typeof labels==="object"?labels:{}),rows.flatMap(row=>array(row.keywords)),rows.map(row=>row.category),rows.map(row=>row.title)),100);
}
function commercePolicyTerms(policy){
  return unique([].concat(array(policy && policy.essentialGoods && policy.essentialGoods.keywords),array(policy && policy.essentialGoods && policy.essentialGoods.preferredClasses),array(policy && policy.revenue && policy.revenue.sourcePriority),array(policy && policy.ranking && policy.ranking.priorityOrder)),140);
}
function regionalPolicyTerms(policy){
  return unique([].concat(array(policy && policy.prioritySupplierTypes),array(policy && policy.searchTerms),array(policy && policy.preferredClasses),array(policy && policy.supplyLanes)),100);
}
function bankTaxonomy(bank){
  const tags=[];const categories=[];const producers=[];let externalCount=0;let commerceCount=0;
  for(const item of array(bank && bank.items)){
    if(!item || typeof item!=="object") continue;
    const url=safeUrl(first(item.url,item.link,item.official_url));
    if(url) externalCount+=1;
    const channel=lower(first(item.channel,item.section,item.type));
    if(/commerce|distribution|product|supplier|producer|shop|store/.test(channel)) commerceCount+=1;
    tags.push(...array(item.tags));
    categories.push(item.category,item.semantic_category,item.sector,item.type,item.channel,item.section);
    if(typeof item.producer==="string") producers.push(item.producer);
    else if(item.producer&&typeof item.producer==="object") producers.push(item.producer.name,item.producer.title,item.producer.type);
  }
  return {tags:unique(tags,180),categories:unique(categories,140),producers:unique(producers,100),itemCount:array(bank&&bank.items).length,externalCount,commerceCount};
}

function sourceHintTerms(sourceTerms, locale){
  const base=baseLocale(locale);
  const rx=base==="ko"?/[가-힣]/:base==="ja"?/[ぁ-んァ-ン一-龥]/:base==="zh"?/[一-龥]/:base==="ru"?/[А-яЁё]/:base==="ar"?/[؀-ۿ]/:null;
  const preferred=sourceTerms.filter(term=>term.length<=28&&(!rx||rx.test(term)));
  return unique(preferred,8).join(" ");
}
function restoredKrRows(geo, sourceTerms, maxQueries){
  const period=Math.floor(Date.now()/(6*60*60*1000));
  const productOffset=stableOffset([geo.country,geo.region||"NATIONWIDE",period,"product"].join("|"),KR_PRODUCT_CLUSTERS.length);
  const entityOffset=stableOffset([geo.country,geo.region||"NATIONWIDE",period,"entity"].join("|"),KR_ENTITY_CLUSTERS.length);
  const dynamic=[];
  for(let index=0;index<4;index+=1){
    const products=KR_PRODUCT_CLUSTERS[(productOffset+index)%KR_PRODUCT_CLUSTERS.length];
    const entities=KR_ENTITY_CLUSTERS[(entityOffset+index)%KR_ENTITY_CLUSTERS.length];
    dynamic.push(`대한민국 ${products} ${entities} 공식몰 직거래 온라인 주문 배송 반품 환불 고객센터`);
  }
  const sourceHint=unique(sourceTerms.filter(term=>/[가-힣]/.test(term)&&term.length<=24),10).join(" ");
  if(sourceHint) dynamic.push(`대한민국 ${sourceHint} 생산자 제조사 협동조합 책임 판매업체 공식 판매처`);
  function laneFor(query,index){
    if(/지자체|농업기술센터|생산자 명단|기업 제품/.test(query)) return "public_directory_bridge";
    if(/기계|금속|플라스틱|목재|포장재|공구|산업용품|전자제품|부품/.test(query)) return "industrial_manufacturing";
    if(/전통시장|지역특산품|공동몰/.test(query)) return "regional_market";
    if(/지역 유통업체|도매|총판|공판장/.test(query)) return "wholesale_distribution";
    if(/사회적기업|마을기업|자활기업/.test(query)) return "small_business";
    if(/화장품|생활용품|가구|침구|의류|신발|가방|유아용품|교육용품|문구|완구/.test(query)) return "consumer_manufacturing";
    if(/농협|축협|수협|산림조합|협동조합|영농조합|농업회사법인|농장|농가|수산물|임산물/.test(query)) return "agri_cooperative";
    return index<KR_FOUNDATION_QUERIES.length?"food_essentials":"kr_rotating";
  }
  return unique(KR_FOUNDATION_QUERIES.concat(dynamic),maxQueries).map((query,index)=>({query,locale:"ko",origin:`country-supply-lane:${laneFor(query,index)}`,lane:laneFor(query,index),localName:"대한민국",localizationError:null}));
}
function buildCountryRows(geo, locales, sourceTerms, maxQueries){
  const country=text(geo&&geo.country).toUpperCase();
  if(country==="KR") return restoredKrRows(geo,sourceTerms,maxQueries);
  const region=text(geo&&geo.region);
  const regionPart=region&&region!=="NATIONWIDE"?region:"";
  const localeRows=unique(locales&&locales.length?locales:[country==="KR"?"ko":"en"],12);
  if(!localeRows.some(locale=>baseLocale(locale)==="en")) localeRows.push("en");
  const period=Math.floor(Date.now()/(6*60*60*1000));
  const offset=stableOffset([country,region||"NATIONWIDE",period].join("|"),LANE_ORDER.length);
  const lanes=LANE_ORDER.slice(offset).concat(LANE_ORDER.slice(0,offset));
  const rows=[];
  const add=(query,locale,origin,lane,localName)=>{
    const clean=sanitizeQuery(query);
    if(!clean||rows.some(row=>lower(row.locale+"|"+row.query)===lower(locale+"|"+clean))) return;
    rows.push({query:clean,locale,origin,lane,localName,localizationError:null});
  };
  for(let index=0;index<lanes.length&&rows.length<maxQueries;index+=1){
    const lane=lanes[index],locale=localeRows[index%localeRows.length],pack=packForLocale(locale),localName=localCountryName(country,locale,first(geo&&geo.countryName,country));
    const locality=[regionPart,localName].filter(Boolean).join(" ");
    add(`${locality} ${pack.lanes[lane]||PACKS.en.lanes[lane]} ${pack.commerce}`,locale,`country-policy-lane:${lane}`,lane,localName);
  }
  const boosts=array(COUNTRY_BOOSTS[country]);
  for(let index=0;index<boosts.length&&rows.length<maxQueries;index+=1){
    const locale=localeRows[index%localeRows.length],localName=localCountryName(country,locale,first(geo&&geo.countryName,country));
    add(`${regionPart} ${localName} ${boosts[index]}`,locale,"country-policy-specific-boost","country_specific",localName);
  }
  for(let index=0;rows.length<maxQueries&&index<localeRows.length;index+=1){
    const locale=localeRows[index],pack=packForLocale(locale),localName=localCountryName(country,locale,first(geo&&geo.countryName,country)),hint=sourceHintTerms(sourceTerms,locale);
    if(!hint) continue;
    add(`${regionPart} ${localName} ${hint} ${pack.lanes.manufacturer_brand} ${pack.commerce}`,locale,"searchbank-psom-policy-taxonomy","taxonomy_bridge",localName);
  }
  if(rows.length<maxQueries){
    const locale=localeRows[0]||"en",pack=packForLocale(locale),localName=localCountryName(country,locale,first(geo&&geo.countryName,country));
    for(const lane of LANE_ORDER){
      add(`${regionPart} ${localName} ${pack.lanes[lane]||PACKS.en.lanes[lane]} ${pack.commerce} contact legal business information`,locale,`country-policy-deep-lane:${lane}`,lane,localName);
      if(rows.length>=maxQueries) break;
    }
  }
  return rows.slice(0,maxQueries);
}

function countrySignals(geo, locales){
  const country=text(geo&&geo.country).toUpperCase();
  const out=[country];
  for(const locale of unique([].concat(locales||[],["en"]),8)) out.push(localCountryName(country,locale,country));
  if(country==="KR") out.push("대한민국","한국","South Korea","Korea");
  return unique(out.map(lower),20);
}
function snapshotSeeds(bank, geo, rows, locales, limit){
  const signals=countrySignals(geo,locales),region=lower(geo&&geo.region&&geo.region!=="NATIONWIDE"?geo.region:"");
  const queryTokens=unique(array(rows).flatMap(row=>words(row&&row.query)),180).map(lower);
  const out=[];
  for(const item of array(bank&&bank.items)){
    if(!item||typeof item!=="object") continue;
    const url=safeUrl(first(item.url,item.link,item.official_url));
    if(!url||/^#/.test(url)) continue;
    let parsedUrl=null;try{parsedUrl=new URL(url);}catch(_error){}
    const titleText=lower(first(item.title,item.name));
    if(!parsedUrl||/(^|\.)example\.(com|org|net|edu)$/.test(parsedUrl.hostname)||/youtube\.com|youtu\.be/.test(parsedUrl.hostname)||/\/(?:seed|placeholder)(?:\/|$)/i.test(parsedUrl.pathname)||/seed placeholder|placeholder item|sample item/.test(titleText)) continue;
    const hay=lower(JSON.stringify({title:item.title,name:item.name,summary:item.summary,tags:item.tags,category:item.category,section:item.section,type:item.type,channel:item.channel,geo:item.geo,producer:item.producer,country:item.country,marketCountry:item.marketCountry,distributionMarketCountry:item.distributionMarketCountry,availabilityCountries:item.availabilityCountries,region:item.region}));
    if(!/(commerce|distribution|product|supplier|producer|manufacturer|cooperative|shop|store|seller|merchant|농장|농협|축협|수협|협동조합|제조|생산|판매|유통|メーカー|製造商|制造商|fabricante|producteur|hersteller|производитель|منتج|koperasi|hợp tác xã)/i.test(hay)) continue;
    const countryMatched=signals.some(signal=>signal&&hay.includes(signal));
    const explicitCountry=/"country"|marketcountry|distributionmarketcountry|availabilitycountries/i.test(hay);
    if(explicitCountry&&!countryMatched) continue;
    let score=countryMatched?35:0;
    if(region&&hay.includes(region)) score+=12;
    for(const token of queryTokens){ if(token.length>=2&&hay.includes(token)) score+=1; }
    if(/official|공식|manufacturer|producer|cooperative|supplier|제조사|생산자|유통업체|メーカー|製造商|制造商|fabricante|producteur|hersteller|производитель/i.test(hay)) score+=12;
    if(score<10) continue;
    out.push({score,item:Object.assign({},item,{source:first(item.source,"searchbank_snapshot"),provider:"searchbank",payload:Object.assign({},item.payload||{},{source:"searchbank_snapshot",country:geo.country,region:geo.region||"NATIONWIDE",researchPlanVersion:VERSION})})});
  }
  out.sort((a,b)=>b.score-a.score);
  const seen=new Set();const seeds=[];
  for(const row of out){
    const url=safeUrl(first(row.item.url,row.item.link));
    if(!url||seen.has(url)) continue;
    seen.add(url);seeds.push(row.item);
    if(seeds.length>=limit) break;
  }
  return seeds;
}

function buildPlan(input){
  const raw=input&&typeof input==="object"?input:{};
  const geo=raw.geo&&typeof raw.geo==="object"?raw.geo:raw;
  const locales=unique(raw.locales&&raw.locales.length?raw.locales:[geo.country==="KR"?"ko":"en"],12);
  const maxQueries=Math.max(3,Math.min(24,Number(raw.maxQueries)||12));
  const sources=loadSources();
  const bank=bankTaxonomy(sources.bank);
  const terms=unique([].concat(psomTerms(sources.psom),commercePolicyTerms(sources.commerce),regionalPolicyTerms(sources.regional),bank.tags,bank.categories,bank.producers),280);
  const rows=buildCountryRows(geo,locales,terms,maxQueries);
  const seeds=snapshotSeeds(sources.bank,geo,rows,locales,Math.max(0,Math.min(20,Number(raw.seedLimit)||10)));
  return {
    version:VERSION,
    rows,
    seeds,
    diagnostics:{
      files:{psom:!!sources.psomFile,searchBankSnapshot:!!sources.bankFile,commercePolicy:!!sources.commerceFile,regionalPolicy:!!sources.regionalFile},
      country:text(geo.country).toUpperCase(),region:text(geo.region)||"NATIONWIDE",locales,
      psomTerms:psomTerms(sources.psom).length,
      commercePolicyTerms:commercePolicyTerms(sources.commerce).length,
      regionalPolicyTerms:regionalPolicyTerms(sources.regional).length,
      searchBank:{items:bank.itemCount,external:bank.externalCount,commerceLike:bank.commerceCount,tags:bank.tags.length,categories:bank.categories.length,producers:bank.producers.length},
      generatedQueries:rows.length,
      supplyLanes:unique(rows.map(row=>row&&row.lane),40),
      localizedQueries:rows.filter(row=>baseLocale(row.locale)!=="en").length,
      countrySpecificBoosts:array(COUNTRY_BOOSTS[text(geo.country).toUpperCase()]).length,
      snapshotSeeds:seeds.length,
      localOnly:true,
      crossCountryFallback:false,
      automaticPublication:false
    }
  };
}

module.exports={VERSION,buildPlan};
