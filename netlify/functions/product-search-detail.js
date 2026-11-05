"use strict";
const {buildRegistry,ORIGIN,hasMarket,marketUrl,marketName}=require("./lib/search-exposure/registry");
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function jsonSafe(v){return JSON.stringify(v).replace(/</g,"\\u003c");}
function lang(event){const q=event.queryStringParameters||{};const v=String(q.lang||"ko").toLowerCase();return /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(v)?v:"ko";}
function response(code,body,headers={}){return{statusCode:code,headers:{"content-type":"text/html; charset=utf-8","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin",...headers},body};}
function normalizeCountry(v){const s=String(v||"").trim().toUpperCase();return /^[A-Z]{2}$/.test(s)?s:"";}
function geoCountry(event){
  const h=event&&event.headers||{};
  let nf={}; try{nf=JSON.parse(h["x-nf-geo"]||h["X-Nf-Geo"]||"{}");}catch(_e){}
  const c=nf&&nf.country; return normalizeCountry((c&&typeof c==="object"?(c.code||c.alpha2):c)||h["cf-ipcountry"]||h["x-country"]||h["x-nf-country"]||h["x-vercel-ip-country"]||"");
}
function parsePath(event){
  const parts=String(event&&event.path||"").split("/").filter(Boolean);
  const productAt=parts.lastIndexOf("product");
  const tail=productAt>=0?parts.slice(productAt+1):parts.slice(-2);
  const maybeCountry=normalizeCountry(tail.length>1?tail[tail.length-1]:"");
  const idPart=maybeCountry?tail[tail.length-2]:tail[tail.length-1];
  return {id:decodeURIComponent(idPart||""),market:maybeCountry};
}
exports.handler=async(event)=>{
  const parsed=parsePath(event), registry=buildRegistry();
  const t=registry.targets.find(x=>x.kind==="commerce"&&x.id===parsed.id);
  if(!t)return response(404,"<!doctype html><meta name=robots content='noindex'><p>Product not found.</p>",{"cache-control":"public,max-age=60"});
  if(parsed.market&&!hasMarket(t,parsed.market)) return response(404,"<!doctype html><meta name=robots content='noindex'><p>Product is not verified for this market.</p>",{"cache-control":"public,max-age=60"});
  const market=parsed.market||"", visitor=geoCountry(event), visitorEligible=visitor&&hasMarket(t,visitor);
  const canonical=market?marketUrl(t.id,market):t.url;
  const marketLabel=market?marketName(market,lang(event)==="ko"?"ko":"en"):"";
  const title=market?`${t.title} | ${marketLabel} | IGDC Global Distribution`:`${t.title} | IGDC Global Distribution`;
  const baseDesc=t.description||[t.brand,t.model,t.category,t.seller].filter(Boolean).join(" · ")||`${t.title} — IGDC Global 공개 유통 정보`;
  const desc=market?`${baseDesc} · IGDC verified market availability: ${marketLabel} (${market}).`:baseDesc;
  const graph=[
    {"@type":"WebPage","@id":canonical,"url":canonical,"name":title,"description":desc,"isPartOf":{"@id":`${ORIGIN}/#website`},"mainEntity":{"@id":`${canonical}#product`}},
    {"@type":"Product","@id":`${canonical}#product`,"name":t.title,"description":desc,"url":canonical,"sku":t.id}
  ];
  const product=graph[1];
  if(t.image)product.image=[t.image];
  if(t.brand)product.brand={"@type":"Brand","name":t.brand};
  if(t.model)product.model=t.model;
  if(t.category)product.category=t.category;
  if(t.price!==null){const offer={"@type":"Offer","price":String(t.price),"priceCurrency":t.currency,"url":canonical,"seller":t.seller?{"@type":"Organization","name":t.seller}:undefined};if(market)offer.eligibleRegion={"@type":"Country","name":marketLabel||market,"identifier":market};product.offers=offer;}
  graph.push({"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"IGDC Global","item":`${ORIGIN}/home`},{"@type":"ListItem","position":2,"name":"Distribution Hub","item":`${ORIGIN}/distributionhub`},{"@type":"ListItem","position":3,"name":t.title,"item":canonical}]});
  const related=registry.targets.filter(x=>x.kind==="commerce"&&x.id!==t.id&&((t.brand&&x.brand===t.brand)||(t.category&&x.category===t.category))).slice(0,8);
  const relatedHtml=related.length?`<section><h2>IGDC 관련 상품</h2><ul>${related.map(x=>`<li><a href="${esc(x.url)}">${esc(x.title)}</a></li>`).join("")}</ul></section>`:"";
  const details=[t.brand&&`브랜드: ${t.brand}`,t.model&&`모델: ${t.model}`,t.category&&`분류: ${t.category}`,t.seller&&`판매처: ${t.seller}`,market&&`검증 판매국가: ${marketLabel} (${market})`,t.price!==null&&`표시 가격: ${t.price} ${t.currency}`].filter(Boolean);
  const outboundMarket=market||(visitorEligible?visitor:"");
  const outboundUrl=t.outboundUrl+(outboundMarket?`&market=${encodeURIComponent(outboundMarket)}`:"");
  const markets=(t.markets||[]).map(m=>`<a href="${esc(marketUrl(t.id,m.country))}">${esc(m.nameKo||m.nameEn||m.country)} (${esc(m.country)})</a>`).join(" · ");
  const visitorHint=!market&&visitorEligible?`<p class="market"><strong>현재 접속 국가:</strong> <a href="${esc(marketUrl(t.id,visitor))}">${esc(marketName(visitor,"ko"))} (${esc(visitor)}) 판매 정보 보기</a></p>`:"";
  const hiddenCountry=visitor?`<input type="hidden" name="country" value="${esc(visitor)}">`:"";
  const html=`<!doctype html><html lang="${esc(lang(event))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(desc.slice(0,180))}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${esc(canonical)}"><meta property="og:type" content="product"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc.slice(0,180))}"><meta property="og:url" content="${esc(canonical)}">${t.image?`<meta property="og:image" content="${esc(t.image)}">`:""}<script type="application/ld+json">${jsonSafe({"@context":"https://schema.org","@graph":graph})}</script><style>body{font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;margin:0;background:#f5f7fa;color:#162536}main{max-width:980px;margin:0 auto;padding:24px}a{color:#14569c}.card{background:#fff;border:1px solid #dde4eb;border-radius:14px;padding:22px}img{max-width:100%;max-height:420px;object-fit:contain}.search{display:flex;gap:8px;margin:0 0 18px}.search input[type=search]{flex:1;padding:11px 12px}.search button,.cta{display:inline-block;padding:11px 15px;border:0;border-radius:8px;background:#173f73;color:#fff;text-decoration:none}.meta{color:#556575}.notice,.market{font-size:13px;color:#617184}</style></head><body><main><form class="search" action="/search.html" method="get"><input type="search" name="q" value="${esc(t.title)}" aria-label="IGDC Search">${hiddenCountry}<button type="submit">IGDC 검색</button></form><article class="card"><p><a href="/distributionhub">IGDC Global Distribution Hub</a></p><h1>${esc(t.title)}</h1>${t.image?`<p><img src="${esc(t.image)}" alt="${esc(t.title)}"></p>`:""}${desc?`<p>${esc(desc)}</p>`:""}${visitorHint}${details.length?`<p class="meta">${details.map(esc).join(" · ")}</p>`:""}${markets?`<p class="meta"><strong>검증된 판매 시장:</strong> ${markets}</p>`:""}<p><a class="cta" href="${esc(outboundUrl)}" rel="nofollow sponsored noopener">판매처 상세정보 확인</a></p><p class="notice">최종 가격·재고·배송·교환·환불 조건은 연결된 판매처에서 확인하십시오.</p></article>${relatedHtml}</main></body></html>`;
  return response(200,html,{"cache-control":"public,max-age=300,s-maxage=900","x-igdc-search-registry":registry.hash,"vary":"Accept-Language"});
};
