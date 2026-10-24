"use strict";

/*
IGDC / MARU Organic Search Amplifier v1.1.0
------------------------------------------------------------
Purpose
- Independent peripheral engine. DOES NOT modify Sanmaru core.
- Organic search only: no paid ads, fake queries, auto-clicks, fake visits or reviews.
- Uses Sanmaru in read-only mode when present.
- Exposes search-discovery, keyword, SEO and dynamic sitemap endpoints.
- Zero new npm dependencies. Designed for the current IGDC Netlify layout.

Public actions
  ?action=health
  ?action=manifest
  ?action=keywords&lang=ko
  ?action=discover&q=media%20player&lang=en
  ?action=expand&q=media%20player&lang=en
  ?action=seo&route=mediahub&lang=en
  ?action=sitemap
*/

const fs = require("fs");
const path = require("path");

const ENGINE = "IGDC_MARU_ORGANIC_SEARCH_AMPLIFIER";
const VERSION = "1.1.0";
const MAX_Q = 180;
const MAX_RESULTS = 24;

function s(v){ return String(v == null ? "" : v); }
function low(v){ return s(v).trim().toLowerCase(); }
function clamp(n,min,max,d){ n=Number(n); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):d; }
function uniq(arr){ return Array.from(new Set((arr||[]).filter(Boolean))); }
function escXml(v){ return s(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
function sanitizeQuery(q){
  return s(q).normalize("NFKC").replace(/[<>;$`]/g," ").replace(/process\.env/gi," ").replace(/\s+/g," ").trim().slice(0,MAX_Q);
}
function tokenize(v){
  return low(v).normalize("NFKC").replace(/[^\p{L}\p{N}\s_-]/gu," ").replace(/[_-]+/g," ").split(/\s+/).filter(Boolean);
}
function json(statusCode, body){
  return {
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"public, max-age=300, s-maxage=900",
      "access-control-allow-origin":"*",
      "access-control-allow-methods":"GET,OPTIONS",
      "x-robots-tag":"noindex, nofollow"
    },
    body:JSON.stringify(body)
  };
}
function text(statusCode, body, contentType, cache){
  return {
    statusCode,
    headers:{
      "content-type":contentType || "text/plain; charset=utf-8",
      "cache-control":cache || "public, max-age=900, s-maxage=3600",
      "access-control-allow-origin":"*",
      "x-robots-tag":"index, follow"
    },
    body
  };
}
function loadConfig(){
  const candidates=[
    path.join(__dirname,"data","igdc-maru-organic-search.config.json"),
    path.join(process.cwd(),"netlify","functions","data","igdc-maru-organic-search.config.json")
  ];
  for(const p of candidates){
    try{ if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,"utf8")); }catch(_){}
  }
  return {engine:ENGINE,version:VERSION,baseUrl:"https://igdcglobal.com",brands:[],routes:{},locales:{ko:{dir:"",suffix:""}},extraPages:[],localizedTerms:{}};
}
const CFG = loadConfig();

function localeSpec(lang){
  lang=low(lang||"ko").replace("_","-");
  if(lang==="ko-kr") lang="ko";
  if(lang==="en-us"||lang==="en-gb") lang="en";
  if(lang==="zh-cn") lang="zh";
  if(lang==="zh-tw"||lang==="zh-hk") lang="zht";
  lang=lang.split("-")[0] || "ko";
  return {key:CFG.locales[lang]?lang:"ko", spec:CFG.locales[lang]||CFG.locales.ko};
}
function routeUrl(route, lang){
  const r=CFG.routes[route];
  if(!r) return CFG.baseUrl+"/home.html";
  const L=localeSpec(lang);
  if(L.key==="ko") return CFG.baseUrl+"/"+r.file;
  const stem=r.file.replace(/\.html$/i,"");
  return CFG.baseUrl+"/"+L.spec.dir+"/"+stem+L.spec.suffix+".html";
}
function allOwnedTargets(lang){
  const out=[];
  for(const [key,r] of Object.entries(CFG.routes||{})){
    out.push({id:key,name:r.title,url:routeUrl(key,lang),description:r.description,keywords:r.keywords||[],type:"igdc-route"});
  }
  for(const b of (CFG.brands||[])){
    out.push({id:b.id,name:b.name,url:CFG.baseUrl+b.path,description:b.name+" official IGDC / MARU destination",keywords:[...(b.keywords||[]),...(b.aliases||[])],type:"brand",vertical:b.vertical});
  }
  return out;
}
function scoreTarget(q,target,lang){
  const query=low(q);
  const qt=tokenize(q);
  const hay=[target.name,target.description,...(target.keywords||[])].join(" ").toLowerCase();
  const ht=new Set(tokenize(hay));
  let score=0;
  if(query && hay.includes(query)) score+=12;
  for(const t of qt){
    if(ht.has(t)) score+=3;
    else if(hay.includes(t)) score+=1;
  }
  // Localized terminology is destination-specific: never boost every target for the same locale term.
  const local=((CFG.localizedTerms||{})[localeSpec(lang).key]||[]);
  const isPlayer=target.id==="maru-media-player";
  const isPlatform=target.id==="igdc-global-hub" || target.id==="maru-platform" || target.id==="home";
  for(const term of local){
    const normalized=low(term);
    if(!normalized || !(isPlayer || isPlatform)) continue;
    // First two seeds are player terms; later explicit player aliases also belong to the player.
    const index=local.indexOf(term);
    const playerTerm=index<2 || /플레이어|media player/i.test(normalized);
    if((isPlayer && !playerTerm) || (isPlatform && playerTerm)) continue;
    if(query===normalized) score+=4;
    else if(query.includes(normalized) && normalized.length>=3) score+=2;
  }
  if(target.id==="maru-media-player" && /media|video|player|플레이어|미디어|영상|동영상|播放器|プレーヤー|lecteur|reproductor|spieler|плеер/i.test(q)) score+=8;
  if(target.id==="distributionhub" && /distribution|distrib|유통|배급|流通|分销|분배|distribución|distribution/i.test(q)) score+=8;
  if(target.id==="mediahub" && /media|미디어|媒体|メディア/i.test(q)) score+=6;
  return score;
}

async function sanmaruReadOnly(q, lang, limit){
  // Peripheral adapter only. Sanmaru source is never modified.
  try{
    const sanmaru=require("./sanmaru_engine_v2");
    if(!sanmaru || typeof sanmaru.runSanmaru!=="function") return {available:false,items:[],reason:"sanmaru-module-unavailable"};
    const res=await sanmaru.runSanmaru({
      q, query:q, lang,
      limit:Math.min(18,limit||12),
      publicSearch:true,
      openPipe:false,
      noExternal:true,
      disableExternal:true,
      noRouteCards:true,
      noOpeningCards:true,
      external:"off",
      source:"organic-search-amplifier-readonly"
    });
    const items=Array.isArray(res&&res.items)?res.items:(Array.isArray(res&&res.results)?res.results:[]);
    return {
      available:true,
      items:items.slice(0,18).map(x=>({
        title:s(x&& (x.title||x.name||x.label)).slice(0,180),
        url:s(x&& (x.url||x.link||x.href)).slice(0,800),
        source:s(x&& (x.source||x.provider)).slice(0,80),
        type:s(x&& (x.type||x.category)).slice(0,80)
      })).filter(x=>x.title||x.url),
      reason:null
    };
  }catch(e){
    return {available:false,items:[],reason:"sanmaru-readonly-error:"+s(e&&e.message).slice(0,120)};
  }
}
function keywordPayload(lang){
  const L=localeSpec(lang);
  const local=(CFG.localizedTerms||{})[L.key]||[];
  const brandSeeds=[];
  for(const b of (CFG.brands||[])) brandSeeds.push(b.name,...(b.aliases||[]),...(b.keywords||[]));
  const routeSeeds=[];
  for(const r of Object.values(CFG.routes||{})) routeSeeds.push(...(r.keywords||[]));
  return {
    lang:L.key,
    localized:uniq(local),
    brand:uniq(brandSeeds).slice(0,120),
    service:uniq(routeSeeds).slice(0,120),
    policy:{organicOnly:true,noFakeTraffic:true,noAutoClick:true,noKeywordStuffing:true}
  };
}
function buildSeo(route,lang){
  const L=localeSpec(lang);
  const r=CFG.routes[route]||CFG.routes.home;
  const url=routeUrl(route in (CFG.routes||{})?route:"home",L.key);
  const sameAs=(CFG.brands||[]).filter(b=>b.path===new URL(url).pathname).map(b=>CFG.baseUrl+b.path);
  return {
    lang:L.key,
    url,
    title:r.title,
    description:r.description,
    keywords:uniq([...(r.keywords||[]),...((CFG.localizedTerms||{})[L.key]||[])]).slice(0,30),
    canonical:url,
    schema:{
      "@context":"https://schema.org",
      "@type": route==="home" ? "WebSite" : "WebPage",
      "name":r.title,
      "url":url,
      "description":r.description,
      "isPartOf":{"@type":"WebSite","name":"IGDC Global Hub","url":CFG.baseUrl+"/home.html"},
      "about":[
        {"@type":"Organization","name":"IGDC Global"},
        {"@type":"SoftwareApplication","name":"MARU Media Player","applicationCategory":"MultimediaApplication","url":CFG.baseUrl+"/maru-download.html"}
      ],
      "sameAs":sameAs
    }
  };
}
function sitemapXml(){
  const base=CFG.baseUrl.replace(/\/$/, "");
  const localeKeys=Object.keys(CFG.locales||{});
  const out=['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
  const seen=new Set();
  const add=(url, alternates)=>{
    if(seen.has(url)) return;
    seen.add(url);
    out.push('  <url>',`    <loc>${escXml(url)}</loc>`);
    if(alternates){
      for(const [lang,href] of alternates){
        const tag=lang==="ko"?"ko-KR":lang==="zh"?"zh-CN":lang==="zht"?"zh-TW":lang;
        out.push(`    <xhtml:link rel="alternate" hreflang="${escXml(tag)}" href="${escXml(href)}" />`);
      }
      out.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escXml(alternates.find(x=>x[0]==="en")?.[1]||alternates[0][1])}" />`);
    }
    out.push('  </url>');
  };
  for(const route of Object.keys(CFG.routes||{})){
    const alternatives=localeKeys.map(lang=>[lang,routeUrl(route,lang)]);
    // Every one of the 30 alternate pages must be listed, not just the Korean source.
    for(const [,url] of alternatives) add(url,alternatives);
  }
  for(const p of (CFG.extraPages||[])) add(base+p);
  out.push('</urlset>');
  return out.join("\n")+"\n";
}

async function handler(event){
  if(event && event.httpMethod==="OPTIONS") return json(200,{ok:true});
  if(event && event.httpMethod && event.httpMethod!=="GET") return json(405,{ok:false,error:"GET_ONLY"});
  const qp=(event&&event.queryStringParameters)||{};
  const action=low(qp.action||qp.mode||"health");
  const q=sanitizeQuery(qp.q||qp.query||"");
  const lang=localeSpec(qp.lang||qp.locale||"ko").key;
  const limit=clamp(qp.limit,1,MAX_RESULTS,12);

  if(action==="health"){
    let sanmaru={available:false,reason:"not-probed"};
    try{
      const mod=require("./sanmaru_engine_v2");
      sanmaru={available:!!(mod&&typeof mod.runSanmaru==="function"),version:s(mod&&mod.version||"")};
    }catch(e){ sanmaru={available:false,reason:"module-unavailable"}; }
    return json(200,{
      ok:true,engine:ENGINE,version:VERSION,mode:"organic-only",
      sanmaru:{...sanmaru,integration:"read-only-peripheral-adapter",coreMutation:false},
      searchBankCoreMutation:false,
      baseUrl:CFG.baseUrl,
      locales:Object.keys(CFG.locales||{}).length,
      routes:Object.keys(CFG.routes||{}).length,
      safeguards:{paidAds:false,fakeTraffic:false,autoClick:false,keywordStuffing:false}
    });
  }

  if(action==="manifest"){
    return json(200,{
      ok:true,engine:ENGINE,version:VERSION,
      baseUrl:CFG.baseUrl,brands:CFG.brands,routes:CFG.routes,
      locales:Object.keys(CFG.locales||{}),
      sitemap:CFG.baseUrl+"/sitemap.xml"
    });
  }

  if(action==="keywords"){
    return json(200,{ok:true,engine:ENGINE,version:VERSION,...keywordPayload(lang)});
  }

  if(action==="discover"){
    if(!q) return json(400,{ok:false,error:"QUERY_REQUIRED"});
    const ranked=allOwnedTargets(lang)
      .map(x=>({...x,score:scoreTarget(q,x,lang)}))
      .filter(x=>x.score>0)
      .sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name))
      .slice(0,limit);
    return json(200,{ok:true,engine:ENGINE,version:VERSION,query:q,lang,count:ranked.length,results:ranked});
  }

  if(action==="expand"){
    if(!q) return json(400,{ok:false,error:"QUERY_REQUIRED"});
    const sanmaru=await sanmaruReadOnly(q,lang,limit);
    const owned=allOwnedTargets(lang)
      .map(x=>({...x,score:scoreTarget(q,x,lang)}))
      .filter(x=>x.score>0)
      .sort((a,b)=>b.score-a.score)
      .slice(0,limit);
    const harvested=uniq(sanmaru.items.flatMap(x=>tokenize(x.title)).filter(t=>t.length>=2)).slice(0,60);
    return json(200,{
      ok:true,engine:ENGINE,version:VERSION,query:q,lang,
      sanmaru:{available:sanmaru.available,reason:sanmaru.reason,count:sanmaru.items.length},
      expansionTerms:harvested,
      ownedDestinations:owned,
      sourceItems:sanmaru.items.slice(0,limit),
      policy:"read-only; no Sanmaru/SearchBank core mutation"
    });
  }

  if(action==="social"){
    const key=low(qp.route||qp.page||"maru-media-player");
    const route=CFG.routes[key]||null;
    const brand=(CFG.brands||[]).find(b=>b.id===key);
    if(!route && !brand) return json(404,{ok:false,error:"UNKNOWN_ROUTE"});
    const title=route?route.title:brand.name;
    const keywords=uniq([...(route?.keywords||brand?.keywords||[]), ...((CFG.localizedTerms||{})[lang]||[])]).slice(0,16);
    const url=route?routeUrl(key,lang):CFG.baseUrl+brand.path;
    return json(200,{ok:true,lang,route:key,meta:{title,description:route?.description||title+" — IGDC / MARU official destination",url,tags:keywords,hashtags:keywords.map(x=>"#"+s(x).replace(/[^\p{L}\p{N}]/gu,"")).filter(x=>x.length>1).slice(0,12)},publishing:false});
  }

  if(action==="seo"){
    const route=low(qp.route||qp.page||"home");
    return json(200,{ok:true,engine:ENGINE,version:VERSION,seo:buildSeo(route,lang)});
  }

  if(action==="sitemap"){
    return text(200,sitemapXml(),"application/xml; charset=utf-8","public, max-age=1800, s-maxage=21600");
  }

  return json(404,{ok:false,error:"UNKNOWN_ACTION",allowed:["health","manifest","keywords","discover","expand","seo","social","sitemap"]});
}

module.exports={handler,version:VERSION,engine:ENGINE,sitemapXml,keywordPayload,buildSeo};
exports.handler=handler;
