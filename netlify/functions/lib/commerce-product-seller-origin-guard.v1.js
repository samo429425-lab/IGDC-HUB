"use strict";
// Product references from an official seller must resolve to that seller's
// verified website/storefront. Cross-seller search snippets stay out of the
// automatic private candidate inbox; administrators may still inspect them.
const SupplierSourceGuard=require('./commerce-supplier-source-guard.v1');
const txt=value=>value==null?'':String(value).trim();
const cleanHost=host=>txt(host).toLowerCase().replace(/^www\./,'');
const NAVER_SHOPS=new Set(['smartstore.naver.com','brand.naver.com','storefarm.naver.com']);
function url(value){try{const u=new URL(txt(value));return /^https?:$/.test(u.protocol)?u:null;}catch(_){return null;}}
function productUrl(row){return txt(row&&(row.verifiedDetailPageUrl||row.productUrl||row.url));}
function reason(sourceInput,item){
  const source=sourceInput&&typeof sourceInput==='object'?sourceInput:{};
  const seller=url(source.supplierSiteUrl||source.url),product=url(productUrl(item));
  if(!seller||!product)return 'missing_seller_or_product_url';
  if(SupplierSourceGuard.reason(seller.toString()))return 'unverified_seller_host';
  if(SupplierSourceGuard.reason(product.toString()))return 'discovery_or_service_page';
  const sh=cleanHost(seller.hostname),ph=cleanHost(product.hostname);
  if(!(ph===sh||ph.endsWith('.'+sh)))return 'product_host_not_supplier';
  if(NAVER_SHOPS.has(sh)){
    const shop=seller.pathname.split('/').filter(Boolean)[0]||'';
    const itemShop=product.pathname.split('/').filter(Boolean)[0]||'';
    if(!shop||shop.toLowerCase()!==itemShop.toLowerCase())return 'different_naver_merchant';
  }
  // A site landing page, category collection, search, or generic service
  // page cannot be advertised as a distinct researched retail product.
  const segments=product.pathname.split('/').filter(Boolean);
  const p=product.pathname.toLowerCase(),q=product.searchParams;
  const detailQuery=['productid','product_id','goodsno','goods_no','itemid','item_id','sku','productno','product_no','prdno','goods_id','uid','pid'].some(k=>q.has(k));
  const detailPath=/(?:\/(?:products?|goods|items?|dp|gp\/product|p|pd|detail|shopdetail)\/[^/]+|\/(?:goodsview|productview|itemdetail|goodsdetail)\b)/i.test(p);
  if(segments.length===0&&!detailQuery)return 'not_a_product_detail_page';
  if(/^(?:search|results?|collections?|categories?|catalog|news|blog|about|company|help|contact|services?|apps?|features?|pricing|cart|login|signup)$/i.test(segments[0]||'')&&!detailPath&&!detailQuery)return 'not_a_product_detail_page';
  if(NAVER_SHOPS.has(sh)&&segments.length<=1&&!detailQuery)return 'not_a_product_detail_page';
  if(['store.google.com','store.microsoft.com'].includes(sh)&&!detailPath&&!detailQuery)return 'not_a_product_detail_page';
  // Large multi-merchant marketplaces need supplier-specific seller evidence;
  // a shared marketplace root does not establish who sells a listed product.
  if(/^(?:amazon\.[a-z.]+|ebay\.[a-z.]+|aliexpress\.com|etsy\.com)$/.test(sh))return 'marketplace_merchant_not_established';
  return '';
}
module.exports={VERSION:'igdc-product-seller-origin-guard.v1',reason,allowed:(source,item)=>!reason(source,item)};
