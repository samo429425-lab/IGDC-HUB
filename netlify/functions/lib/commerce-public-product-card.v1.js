"use strict";

/**
 * Commerce Public Product Card Contract v1
 * ------------------------------------------------------------
 * Thin, non-publishing display contract shared by the Commerce Registry and
 * Canonical publication boundary.  It does not assign slots, relax trust,
 * bypass market evidence or publish snapshots.  Its only job is to make sure
 * that a product which is already eligible for a public product surface has:
 *   - one specific external HTTPS product detail URL,
 *   - one usable HTTPS product image,
 *   - one resolved product title,
 *   - one stable product identity,
 *   - optional structured display meta that never comes from free-form admin
 *     notes / risk / evidence text.
 */

const crypto = require("crypto");

const VERSION = "commerce-public-product-card-v1.0.0";

function text(v){ return v == null ? "" : String(v).trim(); }
function lower(v){ return text(v).toLowerCase(); }
function isObject(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function plain(v){ return isObject(v) ? v : {}; }
function first(){ for(const v of arguments){ const s=text(v); if(s) return s; } return ""; }
function sha256(v){ return crypto.createHash("sha256").update(String(v == null ? "" : v)).digest("hex"); }
function unique(values){ return Array.from(new Set((values||[]).map(text).filter(Boolean))); }

function decodeEntities(value){
  let s=text(value);
  const named={amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:" ",middot:"·",hearts:"♥"};
  s=s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,(m,key)=>{
    const k=String(key).toLowerCase();
    if(k.startsWith("#x")){ const n=parseInt(k.slice(2),16); return Number.isFinite(n)?String.fromCodePoint(n):m; }
    if(k.startsWith("#")){ const n=parseInt(k.slice(1),10); return Number.isFinite(n)?String.fromCodePoint(n):m; }
    return Object.prototype.hasOwnProperty.call(named,k)?named[k]:m;
  });
  return s.replace(/\s+/g," ").trim();
}

function cleanTitle(value){
  let s=decodeEntities(value);
  if(!s) return "";
  // Free-form pipeline text must never become a public product title.
  if(/\b(?:administrator[- ]selected|risk[- ]gated|private researched|market evidence|revenue route|slot assignment|publication pending)\b/i.test(s)) return "";
  // URLs and obvious markup are not product titles.
  if(/^https?:\/\//i.test(s) || /<\/?[a-z][^>]*>/i.test(s)) return "";
  s=s.replace(/\s*[|｜]\s*(?:https?:\/\/\S+|www\.\S+)\s*$/i,"").trim();
  return s.slice(0,220).trim();
}

function normalizedTitleToken(value){
  return lower(decodeEntities(value)).replace(/&[a-z0-9#]+;/g," ").replace(/[^a-z0-9가-힣]+/g," ").replace(/\s+/g," ").trim();
}

function genericProductTitle(value){
  const s=normalizedTitleToken(value);
  if(!s || s.length<4) return true;
  return /^(?:상품명 확인 중|상품명 확인|상품 확인 중|오늘의 딜|오늘의 상품|상품 상세|상품 상세정보|상품|제품|product|products|item|detail|details|aside menu|menu|home|목록)$/.test(s);
}

function safeHttpsUrl(value){
  try{
    const u=new URL(text(value));
    if(u.protocol!=="https:" || u.username || u.password || !u.hostname) return "";
    u.hash="";
    return u.toString();
  }catch(_e){ return ""; }
}

function badDestinationHost(host){
  const h=lower(host).replace(/^www\./,"");
  return !h || h==="localhost" || h.endsWith(".local") || /(^|\.)example\.(?:com|org|net|edu)$/.test(h);
}

function productIdFromUrl(value){
  const safe=safeHttpsUrl(value); if(!safe) return "";
  try{
    const u=new URL(safe);
    const queryKeys=["goodsno","goods_no","productno","product_no","productid","product_id","itemno","item_no","itemid","item_id","prdno","prd_no","sku","skuid"];
    for(const key of queryKeys){ const v=text(u.searchParams.get(key)); if(v) return key+":"+v.slice(0,100); }
    const path=decodeURIComponent(u.pathname||"");
    const genericNo=text(u.searchParams.get("no"));
    if(genericNo && /\/(?:goods\/view|goods\/detail|product\/detail|item\/detail|i\/item)(?:\/|$)/i.test(path)) return "no:"+genericNo.slice(0,100);
    const patterns=[
      /\/(?:dp\/prod|i\/item|product\/detail|goods\/view|goods\/detail|products?|items?|detail|prd)\/([^/?#]{1,120})/i,
      /\/(?:product|item|goods|prd)[_-](?:view|detail)[._/-]?([^/?#]{1,120})/i
    ];
    for(const re of patterns){ const m=path.match(re); if(m&&text(m[1])) return "path:"+text(m[1]); }
  }catch(_e){}
  return "";
}

function isSpecificProductUrl(value){
  const safe=safeHttpsUrl(value); if(!safe) return false;
  try{
    const u=new URL(safe);
    if(badDestinationHost(u.hostname)) return false;
    const path=lower(decodeURIComponent(u.pathname||""));
    const query=lower(u.search||"");
    if(!path || path==="/") return false;
    if(/\/(?:category|categories|catalog|collection|collections|search|best|event|events|planshop|exhibition)(?:[._/-]|$)/i.test(path)) return false;
    if(/(?:goods_list|product_list|item_list|brand_list|goods_best_list|goods_search|first_time|event_sale)(?:[._/-]|$)/i.test(path)) return false;
    if(/(?:`|\$\{|document\.|window\.|javascript:|__product__|placeholder)/i.test(safe)) return false;
    if(productIdFromUrl(safe)) return true;
    if(/\/(?:dp\/prod|i\/item|goods\/view|product\/detail|products?\/[^/?#]+|items?\/[^/?#]+|detail\/[^/?#]+|goods\/(?:view|detail)\/[^/?#]+|prd\/[^/?#]+)/i.test(path)) return true;
    if(/(?:goods_view|product_view|item_view|product_detail|goods_detail)\.(?:php|html?|aspx?|jsp)$/i.test(path) && query) return true;
    // Some stores use a semantic product slug plus a terminal numeric id.
    if(/\/product\/[^/?#]{3,}\/\d{1,20}\/?$/i.test(path)) return true;
    return false;
  }catch(_e){ return false; }
}

function safeImageUrl(value){
  const safe=safeHttpsUrl(value); if(!safe) return "";
  try{
    const u=new URL(safe);
    if(badDestinationHost(u.hostname)) return "";
    const low=lower(decodeURIComponent(safe));
    if(/(?:^|[\/_\-.])(?:logo|favicon|icon|sprite|avatar|profile|banner|header|footer|brandmark|placeholder|no[-_]?image)(?:[\/_\-.]|$)/i.test(low)) return "";
    if(/\/assets\/sample\//i.test(low)) return "";
    return safe;
  }catch(_e){ return ""; }
}

function nestedProductCard(item){
  item=plain(item);
  // Candidate diagnostics often expose a compact top-level productCard while
  // the verified image/detail URL lives in researchReadiness.productCard.
  // Merge all known card layers instead of stopping at the first non-empty
  // object, otherwise a compact title-only card can hide the real product
  // destination and image.
  return Object.assign(
    {},
    plain(plain(item.commerceCandidate).productCard),
    plain(plain(item.researchReadiness).productCard),
    plain(item.productCard)
  );
}

function directDestination(item,candidate){
  item=plain(item); candidate=plain(candidate); const card=nestedProductCard(item);
  const values=[
    item.displayUrl,
    item.productUrl,item.product_url,item.checkoutUrl,item.checkout_url,item.externalProductUrl,
    card.checkoutUrl,card.productUrl,card.url,
    item.url,item.link,item.href,
    candidate.official_url
  ];
  for(const value of values){ const safe=safeHttpsUrl(value); if(safe&&isSpecificProductUrl(safe)) return safe; }
  return "";
}

function directImage(item,candidate){
  item=plain(item); candidate=plain(candidate); const card=nestedProductCard(item);
  const values=[
    item.displayImage,
    item.imageUrl,item.imageOriginalUrl,item.thumbnailUrl,item.thumbnail,item.thumb,item.image,
    card.image,card.imageUrl,card.thumbnail,card.thumb,
    candidate.thumbnail_url
  ];
  for(const value of values){ const safe=safeImageUrl(value); if(safe) return safe; }
  return "";
}

function directTitle(item,candidate){
  item=plain(item); candidate=plain(candidate); const card=nestedProductCard(item);
  const values=[item.displayTitle,item.productName,item.product_name,card.title,card.productName,item.title,item.name,candidate.title];
  for(const value of values){ const title=cleanTitle(value); if(title&&!genericProductTitle(title)) return title; }
  return "";
}

function cleanStructuredMeta(value,title){
  const s=decodeEntities(value);
  if(!s || s.length>100) return "";
  if(/^https?:\/\//i.test(s)) return "";
  if(/\b(?:administrator|risk|evidence|revenue|assignment|pending|private|verified by|source|seller url)\b/i.test(s)) return "";
  if(normalizedTitleToken(s)===normalizedTitleToken(title)) return "";
  return s;
}

function displayMeta(item,title){
  item=plain(item); const card=nestedProductCard(item);
  const candidates=[
    item.modelName,item.model,item.modelNumber,item.variant,item.optionName,item.spec,item.specification,item.size,item.packSize,item.capacity,
    card.modelName,card.model,card.variant,card.spec,card.size
  ];
  const parts=[];
  for(const v of candidates){ const s=cleanStructuredMeta(v,title); if(s&&!parts.includes(s)) parts.push(s); if(parts.length>=2) break; }
  if(parts.length) return parts.join(" · ").slice(0,100);
  // Price is intentionally not copied into the front card. Seller prices can
  // change independently; the shopper card stays to title + optional stable
  // model/spec/size and the verified seller detail page remains authoritative.
  return "";
}

function explicitProductId(item,candidate,url){
  item=plain(item); candidate=plain(candidate); const card=nestedProductCard(item);
  const explicit=first(item.productId,item.product_id,item.sku,item.productSku,card.productId,card.sku,productIdFromUrl(url));
  if(explicit) return explicit.slice(0,160);
  const candidateId=first(item.candidateId,plain(item.commerceCandidate).candidateId,candidate.id,item.id);
  return candidateId ? "candidate:"+candidateId.slice(0,140) : "url:"+sha256(url).slice(0,28);
}

function build(itemInput,candidateInput){
  const item=plain(itemInput), candidate=plain(candidateInput);
  const title=directTitle(item,candidate);
  const url=directDestination(item,candidate);
  const image=directImage(item,candidate);
  const reasons=[];
  if(!title) reasons.push("PUBLIC_PRODUCT_TITLE_UNRESOLVED");
  if(!url) reasons.push("PUBLIC_PRODUCT_DETAIL_URL_INVALID");
  if(!image) reasons.push("PUBLIC_PRODUCT_IMAGE_INVALID");
  const productId=url?explicitProductId(item,candidate,url):"";
  if(!productId) reasons.push("PUBLIC_PRODUCT_IDENTITY_MISSING");
  const meta=title?displayMeta(item,title):"";
  return {
    ok:reasons.length===0,
    version:VERSION,
    reasons,
    type:"product",
    productId:productId||null,
    displayTitle:title||null,
    displayImage:image||null,
    displayUrl:url||null,
    displayMeta:meta||"",
    destinationHost:(()=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,"");}catch(_e){return null;}})(),
    identityDigest:url?sha256(productId+"|"+url):null
  };
}

function apply(itemInput,candidateInput){
  const item=Object.assign({},plain(itemInput));
  const card=build(item,candidateInput);
  if(!card.ok) return {ok:false,item,reasons:card.reasons,card};
  item.type="product";
  item.kind="product";
  item.productId=card.productId;
  item.displayTitle=card.displayTitle;
  item.displayImage=card.displayImage;
  item.displayUrl=card.displayUrl;
  item.displayMeta=card.displayMeta;
  item.title=card.displayTitle;
  item.name=card.displayTitle;
  item.url=card.displayUrl;
  item.productUrl=card.displayUrl;
  // Existing AutoMap contracts already prioritize externalOutboundUrl. Keep
  // shopper navigation compatible without changing any front renderer.
  item.externalOutboundUrl=card.displayUrl;
  item.external_outbound_url=card.displayUrl;
  item.link=card.displayUrl;
  item.href=card.displayUrl;
  item.detailUrl=card.displayUrl;
  item.image=card.displayImage;
  item.imageUrl=card.displayImage;
  item.thumb=card.displayImage;
  item.thumbnail=card.displayImage;
  item.summary=card.displayMeta||"";
  item.description=card.displayMeta||"";
  item.publicCard={
    version:VERSION,
    type:"product",
    productId:card.productId,
    title:card.displayTitle,
    image:card.displayImage,
    url:card.displayUrl,
    meta:card.displayMeta||"",
    identityDigest:card.identityDigest
  };
  return {ok:true,item,card,reasons:[]};
}

module.exports={
  VERSION,
  decodeEntities,
  cleanTitle,
  genericProductTitle,
  safeHttpsUrl,
  safeImageUrl,
  productIdFromUrl,
  isSpecificProductUrl,
  directTitle,
  directDestination,
  directImage,
  build,
  apply
};
