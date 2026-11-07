"use strict";
const {ORIGIN,buildCatalog,productUrl,validId,Market}=require("./lib/igdc-amplify/catalog");
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function safeJson(v){return JSON.stringify(v).replace(/</g,"\\u003c").replace(/\u2028|\u2029/g,"");}
function html(code,body,extra={}){return{statusCode:code,headers:{"content-type":"text/html; charset=utf-8","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin",...extra},body};}
function missing(){return html(404,"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='robots' content='noindex,nofollow'><title>Product unavailable | IGDC</title></head><body><h1>Product is no longer available</h1><p><a href='/igdc-amplify-search.html'>Search other IGDC products</a></p></body></html>",{"x-robots-tag":"noindex, nofollow","cache-control":"no-store"});}
exports.handler=async(event)=>{
  const q=event&&event.queryStringParameters||{},id=validId(q.id),market=String(q.market||"").trim().toUpperCase();
  if(!id||(market&&!/^[A-Z]{2}$/.test(market)))return missing();
  const c=buildCatalog(),item=c.getById(id);
  if(!c.ready||!item||(market&&!item.markets.includes(market)))return missing();
  const name=item.productName||item.title,canonical=productUrl(id),pageTitle=`${name} | IGDC Global Distribution`;
  const desc=(item.description||[item.brand,item.model,item.category,item.seller].filter(Boolean).join(" · ")||`${name} — 공개 상품 정보 및 검증된 판매처 안내`).slice(0,340);
  const terms=[item.title!==name?`공개 제목: ${item.title}`:"",item.brand&&`브랜드: ${item.brand}`,item.maker&&`제조사: ${item.maker}`,
    item.model&&`모델: ${item.model}`,item.category&&`분류: ${item.category}`,item.seller&&`판매처: ${item.seller}`].filter(Boolean);
  const markets=item.markets.map(code=>`<a href="${esc(productUrl(id,code))}">${esc(code)}</a>`).join(" · ");
  const related=c.items.filter(x=>x.id!==id&&((item.brand&&x.brand===item.brand)||(item.category&&x.category===item.category))).slice(0,8);
  const relatedHtml=related.length?`<section><h2>IGDC 관련 공개 상품</h2><ul>${related.map(x=>`<li><a href="${esc(x.url)}">${esc(x.productName||x.title)}</a></li>`).join("")}</ul></section>`:"";
  const outgoing=`${item.outbound}${market?`&market=${encodeURIComponent(market)}`:""}`;
  const product={"@type":"Product","@id":`${canonical}#product`,"name":name,"url":canonical,"sku":id,"description":desc};
  if(item.title!==name)product.alternateName=item.title;
  if(item.brand)product.brand={"@type":"Brand","name":item.brand};
  if(item.model)product.model=item.model;
  if(item.image)product.image=[item.image];
  // No Offer or guaranteed availability is fabricated: IGDC is not merchant of record.
  const graph={"@context":"https://schema.org","@graph":[{"@type":"WebPage","url":canonical,"name":pageTitle,"mainEntity":{"@id":`${canonical}#product`}},product]};
  const markup=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(pageTitle)}</title><meta name="description" content="${esc(desc.slice(0,170))}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(pageTitle)}"><meta property="og:description" content="${esc(desc.slice(0,170))}"><meta property="og:url" content="${esc(canonical)}">${item.image?`<meta property="og:image" content="${esc(item.image)}">`:""}<script type="application/ld+json">${safeJson(graph)}</script><style>body{font:16px/1.6 system-ui,-apple-system,'Malgun Gothic',sans-serif;background:#f6f7fb;color:#142338;margin:0}main{max-width:920px;margin:0 auto;padding:26px}.paper{background:#fff;border:1px solid #dee5ef;border-radius:14px;padding:24px}.pill{color:#476079}.button{background:#1a4983;color:white;padding:12px 16px;border-radius:8px;display:inline-block;text-decoration:none}a{color:#1a4983}.cover{max-width:100%;max-height:410px;object-fit:contain}.fine{font-size:13px;color:#556477}nav{margin-bottom:18px}</style></head><body><main><nav><a href="/home.html">IGDC Global</a> · <a href="/distributionhub.html">Distribution</a> · <a href="/igdc-amplify-search.html">상품 검색</a></nav><article class="paper"><h1>${esc(name)}</h1>${item.image?`<p><img class="cover" alt="${esc(name)}" src="${esc(item.image)}" loading="lazy"></p>`:""}<p>${esc(desc)}</p>${terms.length?`<p class="pill">${terms.map(esc).join(" · ")}</p>`:""}<p><strong>판매 가능성이 검증된 국가:</strong> ${markets}</p>${item.price!==null?`<p>공개 표시 가격: ${esc(item.price)} ${esc(item.currency)}</p>`:""}<p><a class="button" href="${esc(outgoing)}" rel="nofollow sponsored noopener">판매처 정보 확인</a></p><p class="fine">IGDC는 광고·홍보 및 판매처 연결 서비스이며 직접 판매·결제·배송을 처리하지 않습니다. 구매 전 판매처의 배송·교환·환불·A/S 조건을 확인하십시오. 연결이 불가능한 경우 해당 판매처의 검증 상태를 다시 확인해야 합니다.</p></article>${relatedHtml}</main></body></html>`;
  return html(200,markup,{"cache-control":"public,max-age=0,s-maxage=10,must-revalidate","x-igdc-amplify-catalog":c.hash});
};
exports._test={esc,safeJson};
