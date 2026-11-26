'use strict';
(function(root){
 // Source routing is discovery metadata only, never a grant to fetch or sell.
 const profiles=[
  ['농심','nongshim.com','https://brand.nongshim.com/all_product/index','catalog','제품 소개'],
  ['동원','dongwon.com','https://www.dongwonfnb.com/Product/Product_List.jsp','catalog','제품 소개'],
  ['닥터자르트','drjart.com','https://www.drjart.co.kr/shop-all','store','상품'],
  ['삼성전자','samsung.com','https://www.samsung.com/sec/','store','제품 모델'],
  ['지오다노','giordano.co.kr','https://www.giordano.co.kr/shop/search_result.php?search_str=NEW','store','상품'],
  ['오뚜기','ottogi.co.kr','https://www.otoki.com/product/product_cat','catalog','제품 소개'],
  ['한국타이어','hankooktire.com','https://www.hankooktire.com/kr/ko/tirelist/brand-family/ventus.html','catalog','타이어 제품 모델'],
  ['설화수','sulwhasoo.com','https://www.sulwhasoo.com/kr/ko/products/skincare/skincare.html','store','상품'],
  ['유한킴벌리','yuhan-kimberly.co.kr','https://www.yuhan-kimberly.co.kr/','catalog','제품 브랜드']
 ];
 const norm=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
 const aliases=[['adidas','아디다스'],['puma','푸마'],['nike','나이키'],['new balance','뉴발란스'],['asics','아식스'],['mizuno','미즈노'],['skechers','스케쳐스'],['삼성전자','Samsung','Samsung Electronics','삼성'],['LG전자','LG','LG Electronics'],['쿠쿠','Cuckoo'],['쿠첸','Cuchen'],['코웨이','Coway'],['락앤락','Lock&Lock','LocknLock'],['농심','Nongshim'],['오뚜기','Ottogi','Otoki'],['설화수','Sulwhasoo'],['라네즈','Laneige'],['이니스프리','Innisfree'],['한국타이어','Hankook','Hankook Tire','Hankook Tire & Technology'],['지오다노','Giordano'],['유한킴벌리','Yuhan-Kimberly','Yuhan Kimberly'],['동원','Dongwon'],['닥터자르트','Dr.Jart+','Dr. Jart+','Dr.Jart','Dr Jart']];
 function brandKey(v){const n=norm(v);return norm(aliases.find(a=>a.some(x=>norm(x)===n))?.[0]||n);}
 const host=v=>{try{return new URL(v).hostname.replace(/^www\./,'');}catch{return ''}};
 function profile(q){if(q?.country!=='KR'||!['brand','manufacturer'].includes(q.type))return null;return profiles.find(p=>brandKey(q.name)===brandKey(p[0])&&(host(q.url)===p[1]||host(q.url)===host(p[2])))||null;}
 function discoveryURL(q){const p=profile(q);if(!p)return q?.url||'';const u=new URL(q.url);return u.pathname==='/'&&!u.search?p[2]:q.url;}
 function defaultPage(q){const p=profile(q);if(!p)return '';const a=new URL(q.url),b=new URL(p[2]);if(a.hostname!==b.hostname||b.pathname==='/')return '';if(a.pathname==='/'&&!a.search)return b.href;return a.href===b.href||listingPath(a)&&(!a.search||listingQuery(a))?a.href:'';}
 function queryScope(q){const p=profile(q),u=new URL(q.url);return p&&p[0]==='삼성전자'&&u.pathname.startsWith('/sec/')?u.hostname.replace(/^www\./,'')+'/sec/':p&&p[0]==='한국타이어'&&u.pathname.startsWith('/kr/ko/')?u.hostname.replace(/^www\./,'')+'/kr/ko/':u.hostname.replace(/^www\./,'');}
 function localPathMatches(q,ref){const p=profile(q),u=new URL(ref);if(p?.[0]==='삼성전자'&&new URL(q.url).pathname.startsWith('/sec/'))return u.pathname.startsWith('/sec/');if(p?.[0]==='한국타이어'&&new URL(q.url).pathname.startsWith('/kr/ko/'))return u.pathname.startsWith('/kr/ko/');return true;}
 function term(q){const p=profile(q);return p?p[4]:q.country==='KR'?'제품 상품':q.country==='JP'?'商品 製品':q.country==='CN'?'商品 产品':q.country==='TW'?'商品 產品':q.country==='DE'?'Produkt':q.country==='FR'?'produit':q.country==='ES'?'producto':'product';}
 const keys=['product_no','productno','productid','product_id','goodsno','goods_no','goodscd','goods_id','itemid','item_id','itemno','item_no','sku','variant','goodsseq','productseq','branduid','goods_idx','product_idx'];
 function path(u){try{return decodeURIComponent(u.pathname);}catch{return '';}}
 function giordanoDetail(u){if(u.hostname!=='www.giordano.co.kr'||u.pathname!=='/shop/detail.php')return false;const a=[...u.searchParams];return a.length>=1&&a.length<=2&&new Set(a.map(x=>x[0])).size===a.length&&a.every(([k,v])=>k==='pno'?/^[a-f0-9]{32}$/i.test(v):k==='cno1'&&/^\d{1,8}$/.test(v))&&u.searchParams.has('pno');}
 function tireDetail(u){return ['www.hankooktire.com','hankooktire.com'].includes(u.hostname)&&/^\/kr\/ko\/tire\/[a-z0-9_-]+\/[a-z0-9_-]+\.html$/i.test(path(u));}
 function cafeDetail(u){return /^\/product\/[^/]+\/\d+(?:\/category\/\d+(?:\/display\/\d+)?)?\/?$/i.test(path(u));}
 function blockedPath(u){const p=path(u);return !p||/(?:^|\/)(?:login|account|cart|checkout|admin|api|auth|logout|order|user|payment|redirect|help|support|contact|about|news|blog|privacy|terms|shipping|returns|faq|customer[-_]service|stores?|company|media-list|brand-story)(?:[/.]|$)/i.test(p)||/\.(?:pdf|zip|exe|jpg|jpeg|png|gif|webp|svg|mp4|css|js)$/i.test(p);}
 function listingPath(u){const p=path(u);if(!p)return true;if(cafeDetail(u)||giordanoDetail(u))return false;return /(?:^|\/)(?:product[_-]?list|product_cat(?:_2nd)?|search_result|goods[_-]?list|item[_-]?list|all_product|shop-all|catalog|category|categories|collections|search|tirelist)(?:[/.]|$)/i.test(p)||/\/(?:product|products|goods|items)\/(?:list|index)(?:[/.]|$)/i.test(p)||/(?:^|\/)list(?:[/.]|$)/i.test(p)||/\/(?:products\/skincare\/skincare|products\/makeup\/makeup)\.html$/i.test(p)||(/(?:^|\.)nongshim\.com$/i.test(u.hostname)&&/^\/[^/]+\/(?:main|product)\/index\/?$/i.test(p))||(/(?:^|\.)otoki\.com$/i.test(u.hostname)&&/^\/product\/otoki-brand-\d+\/?$/i.test(p));}
 function productQuery(u){if(giordanoDetail(u))return true;const a=[...u.searchParams];return !listingPath(u)&&!blockedPath(u)&&a.length===1&&keys.includes(a[0][0].toLowerCase())&&/^[A-Za-z0-9_-]{1,80}$/.test(a[0][1]);}
 // Only documented, host/path-specific listing parameters; arbitrary query strings remain denied.
 function listingQuery(u){const a=[...u.searchParams];if(a.length!==1||!listingPath(u)||blockedPath(u))return false;const [k,v]=a[0],p=path(u);return u.hostname==='brand.nongshim.com'&&p==='/all_product/index'&&k==='catCd'&&/^[A-Z]\d{2}$/.test(v)||u.hostname==='www.otoki.com'&&p==='/product/product_cat_2nd'&&k==='idx'&&/^\d{1,5}$/.test(v)||['www.sulwhasoo.com','membership.sulwhasoo.com'].includes(u.hostname)&&/^\/kr\/ko\/products\//.test(p)&&k==='page'&&/^[1-9]\d{0,2}$/.test(v)||u.hostname==='www.giordano.co.kr'&&p==='/shop/search_result.php'&&k==='search_str'&&/^[\p{L}\p{N} _-]{1,60}$/u.test(v);}
 function detailPath(u){const p=path(u);if(blockedPath(u)||listingPath(u))return false;return cafeDetail(u)||tireDetail(u)||productQuery(u)||/\/(?:product|products|p|pd|dp|item|goods|product-detail|product-details|productdetail|detail|goodsdetail|itemdetail|shopdetail)\/[^/]+(?:\/[^/]+)*\/?$/i.test(p)&&!/\/(?:category|categories|collections)(?:[/.]|$)/i.test(p)||/\/[A-Z0-9-]{5,}\.html$/i.test(p)&&/\d/.test(p);}
 const api={brandKey,giordanoDetail,tireDetail,profile,discoveryURL,defaultPage,queryScope,localPathMatches,term,productQuery,listingQuery,listingPath,detailPath,blockedPath};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DCenterSourceProfile=api;
})(typeof window==='undefined'?globalThis:window);
