"use strict";
const {buildRegistry,marketName}=require("./lib/search-exposure/registry");
const ROOT="https://igdcglobal.com/.netlify/functions/public-commerce-search-index",BATCH=80;
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function html(title,description,url,body,robots){
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><meta name="description" content="'+esc(description)+'"><meta name="robots" content="'+(robots||"index,follow")+'"><link rel="canonical" href="'+esc(url)+'"><style>body{font:16px/1.7 system-ui,Arial,sans-serif;background:#f5f8fc;color:#17324d;margin:0}main{max-width:1020px;margin:auto;padding:28px 18px 72px}a{color:#0753a0}section{background:white;border:1px solid #dce5ed;border-radius:12px;padding:20px}li{margin:6px 0}.info{color:#5c6d7a}</style></head><body><main><nav><a href="/home">IGDC Global Platform</a> / <a href="/distributionhub">Distribution Hub</a></nav>'+body+'</main></body></html>';
}
function send(statusCode,body){return{statusCode,headers:{"content-type":"text/html; charset=utf-8","cache-control":statusCode===200?"public,max-age=180,s-maxage=600":"no-store","x-content-type-options":"nosniff"},body};}
exports.handler=async event=>{
 try{
  const reg=buildRegistry(),q=event&&event.queryStringParameters||{},country=String(q.country||"").toUpperCase();
  const markets=Object.entries(reg.countryCounts||{}).filter(([cc,count])=>/^[A-Z]{2}$/.test(cc)&&Number(count)>0).sort((a,b)=>a[0].localeCompare(b[0]));
  if(!country){
   const rows=markets.map(([cc,count])=>'<li><a href="'+ROOT+'?country='+cc+'">'+esc(marketName(cc,"en"))+' ('+cc+')</a> — '+Number(count)+' verified product market pages</li>').join("");
   const body='<h1>IGDC verified country product directory</h1><p>국가별로 공개 승인된 상품만 안내합니다. Visitors and search crawlers can reach each verified country listing without IP-based redirection.</p><section><ul>'+rows+'</ul></section>';
   return send(200,html("IGDC Global — verified country product markets","Approved IGDC Distribution product listings for verified country markets.",ROOT,body));
  }
  if(!/^[A-Z]{2}$/.test(country)||!markets.some(([cc])=>cc===country))return send(404,html("No verified market","Not published",ROOT,"<h1>No verified products for this country</h1>","noindex,follow"));
  const items=(reg.targets||[]).filter(t=>t&&t.kind==="commerce-market"&&t.marketCountry===country&&typeof t.url==="string"&&t.url.startsWith("https://igdcglobal.com/product/"));
  const pages=Math.max(1,Math.ceil(items.length/BATCH)),page=Number(q.page||1);
  if(!Number.isSafeInteger(page)||page<1||page>pages)return send(404,html("Page not found","Invalid listing page",ROOT,"<h1>Page not found</h1>","noindex,follow"));
  const base=ROOT+"?country="+country,canonical=base+(page>1?"&page="+page:"");
  const list=items.slice((page-1)*BATCH,page*BATCH).map(t=>'<li><a href="'+esc(t.url)+'">'+esc(t.title||t.id)+'</a>'+(t.category?' — '+esc(t.category):'')+'</li>').join("");
  const prev=page>1?'<a href="'+base+(page>2?'&page='+(page-1):'')+'">Previous page</a>':"";
  const next=page<pages?'<a href="'+base+'&page='+(page+1)+'">Next page</a>':"";
  const body='<h1>IGDC verified products — '+esc(marketName(country,"en"))+' ('+country+')</h1><p class="info">'+items.length+' public approved market listings · page '+page+' / '+pages+'</p><p>Only currently published and verified market entries appear here. Prices and availability are confirmed at the seller.</p><section><ul>'+list+'</ul></section><nav aria-label="Pages">'+prev+' '+next+'</nav><p><a href="'+ROOT+'">All verified markets</a></p>';
  return send(200,html("IGDC verified products — "+country+" — page "+page,"IGDC Distribution verified product market listings for "+country,canonical,body));
 }catch(_e){return send(503,html("Directory temporarily unavailable","Temporary failure",ROOT,"<h1>Temporarily unavailable</h1>","noindex,follow"));}
};