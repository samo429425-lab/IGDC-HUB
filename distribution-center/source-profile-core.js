'use strict';
(function(root){
 const profiles=[
  ['농심','nongshim.com','https://brand.nongshim.com/all_product/index','catalog','제품 소개'],
  ['동원','dongwon.com','https://www.dongwonfnb.com/Product/Product_List.jsp','catalog','제품 소개'],
  ['닥터자르트','drjart.com','https://www.drjart.co.kr/shop-all','store','상품'],
  ['삼성전자','samsung.com','https://www.samsung.com/sec/','store','제품 모델'],
  ['지오다노','giordano.co.kr','https://www.giordano.co.kr/','store','상품']
 ];
 const norm=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
 const host=v=>{try{return new URL(v).hostname.replace(/^www\./,'');}catch{return ''}};
 function profile(q){if(q?.country!=='KR'||q.type!=='brand')return null;return profiles.find(p=>norm(q.name)===norm(p[0])&&(host(q.url)===p[1]||host(q.url)===host(p[2])))||null;}
 function discoveryURL(q){const p=profile(q);if(!p)return q?.url||'';const u=new URL(q.url);return u.pathname==='/'&&!u.search?p[2]:q.url;}
 function queryScope(q){const p=profile(q);const u=new URL(q.url);return p&&p[0]==='삼성전자'&&u.pathname.startsWith('/sec/')?u.hostname.replace(/^www\./,'')+'/sec/':u.hostname.replace(/^www\./,'');}
 function localPathMatches(q,ref){if(profile(q)?.[0]!=='삼성전자'||!new URL(q.url).pathname.startsWith('/sec/'))return true;return new URL(ref).pathname.startsWith('/sec/');}
 function term(q){const p=profile(q);return p?p[4]:q.country==='KR'?'제품 상품':q.country==='JP'?'商品 製品':q.country==='CN'?'商品 产品':q.country==='TW'?'商品 產品':q.country==='DE'?'Produkt':q.country==='FR'?'produit':q.country==='ES'?'producto':'product';}
 const keys=['product_no','productno','productid','product_id','goodsno','goods_no','goodscd','goods_id','itemid','item_id','itemno','item_no','sku','variant','goodsseq','productseq','branduid','goods_idx','product_idx'];
 function listingPath(u){let p;try{p=decodeURIComponent(u.pathname);}catch{return true;}return /(?:^|\/)(?:product[_-]?list|goods[_-]?list|item[_-]?list|all_product|shop-all|catalog|category|categories|collections|search)(?:[/.]|$)/i.test(p)||/\/(?:product|products|goods|items)\/(?:list|index)(?:[/.]|$)/i.test(p);}
 function productQuery(u){const a=[...u.searchParams];return !listingPath(u)&&a.length===1&&keys.includes(a[0][0].toLowerCase())&&/^[A-Za-z0-9_-]{1,80}$/.test(a[0][1])&&!/\/(?:search|login|account|cart|checkout|api|redirect|help|support|contact|news|blog|category|categories|collection|collections|list)(?:[/.]|$)/i.test(u.pathname);}
 const api={profile,discoveryURL,queryScope,localPathMatches,term,productQuery,listingPath};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DCenterSourceProfile=api;
})(typeof window==='undefined'?globalThis:window);
