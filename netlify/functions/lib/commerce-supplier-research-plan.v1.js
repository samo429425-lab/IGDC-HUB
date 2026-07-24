"use strict";

/*
 * Evidence-guided supplier research plan.
 * Thin read-only bridge: it reads the existing SearchBank/PSOM/policy reservoirs
 * to build country research queries and private research seeds. It never rewrites
 * SearchBank, Snapshot Engine, PSOM, or public snapshots.
 */

const fs = require("fs");
const path = require("path");

const VERSION = "commerce-supplier-research-plan-v1.3.0-country-lane-balanced-mesh";

function text(value){ return String(value == null ? "" : value).trim(); }
function lower(value){ return text(value).toLowerCase(); }
function array(value){ return Array.isArray(value) ? value : []; }
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
  return unique(text(value).replace(/[^0-9A-Za-z가-힣ぁ-んァ-ン一-龥\s-]/g," ").split(/\s+/).filter(token=>token.length>=2), 120);
}

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
  "의류 신발 가방 패션잡화", "가구 침구 인테리어 생활가전",
  "전자제품 액세서리 소형가전", "유아용품 교육용품 문구 완구"
]);


const GENERIC_SUPPLY_LANES = Object.freeze([
  {id:"agri_cooperative",query:"agricultural fishery forestry cooperative producer farm direct official online store shipping returns"},
  {id:"food_essentials",query:"food manufacturer grocery household essentials responsible seller official shop delivery refund support"},
  {id:"industrial_manufacturing",query:"industrial goods tools parts machinery manufacturer factory direct sales official product catalog online order"},
  {id:"consumer_manufacturing",query:"home living kitchen electronics cosmetics apparel manufacturer brand owner official online store"},
  {id:"regional_market",query:"regional market local products traditional market producer collective official ecommerce delivery returns"},
  {id:"small_business",query:"small business social enterprise cooperative maker official store payment shipping customer service"},
  {id:"wholesale_distribution",query:"regional distributor wholesaler authorized dealer official online ordering delivery returns support"},
  {id:"public_directory_bridge",query:"official producer directory cooperative member directory local manufacturers marketplace vendor list"}
]);

const KR_ENTITY_CLUSTERS = Object.freeze([
  "농가 농장 생산자 영농조합법인 농업회사법인", "농협 축협 수협 산림조합 협동조합",
  "제조사 제조업체 공장 브랜드 본사 책임판매업자", "지역 유통업체 도매 총판 공판장 로컬푸드 직매장",
  "소규모 판매업체 직영몰 공식 판매처 온라인몰"
]);

function loadSources(){
  const psomFile=findFile(["data/psom.json","netlify/functions/data/psom.json","assets/hero/psom.json"]);
  const bankFile=findFile(["data/search-bank.snapshot.json","netlify/functions/data/search-bank.snapshot.json","netlify/functions/search-bank.snapshot.json"]);
  const commerceFile=findFile(["netlify/functions/data/commerce-candidate-policy.v1.json","data/commerce-candidate-policy.v1.json"]);
  const regionalFile=findFile(["netlify/functions/data/regional-brokerage-policy.json","data/regional-brokerage-policy.json"]);
  return {
    psomFile, bankFile, commerceFile, regionalFile,
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
  return unique([
    ...array(page && page.sections),
    ...Object.values(labels && typeof labels==="object" ? labels : {}),
    ...rows.flatMap(row=>array(row.keywords)),
    ...rows.map(row=>row.category),
    ...rows.map(row=>row.title)
  ],80);
}

function commercePolicyTerms(policy){
  return unique([
    ...array(policy && policy.essentialGoods && policy.essentialGoods.keywords),
    ...array(policy && policy.essentialGoods && policy.essentialGoods.preferredClasses),
    ...array(policy && policy.revenue && policy.revenue.sourcePriority),
    ...array(policy && policy.ranking && policy.ranking.priorityOrder)
  ],120);
}

function bankTaxonomy(bank){
  const tags=[]; const categories=[]; const producers=[]; let externalCount=0; let commerceCount=0;
  for(const item of array(bank && bank.items)){
    if(!item || typeof item!=="object") continue;
    const url=safeUrl(first(item.url,item.link,item.official_url));
    if(url) externalCount+=1;
    const channel=lower(first(item.channel,item.section,item.type));
    if(/commerce|distribution|product|supplier|producer|shop|store/.test(channel)) commerceCount+=1;
    tags.push(...array(item.tags));
    categories.push(item.category,item.semantic_category,item.sector,item.type,item.channel,item.section);
    if(typeof item.producer==="string") producers.push(item.producer);
    else if(item.producer && typeof item.producer==="object") producers.push(item.producer.name,item.producer.title,item.producer.type);
  }
  return {
    tags:unique(tags,160), categories:unique(categories,120), producers:unique(producers,80),
    itemCount:array(bank && bank.items).length, externalCount, commerceCount
  };
}

function genericRows(geo, locales, sourceTerms, maxQueries){
  const country=first(geo && geo.countryName, geo && geo.country, "target country");
  const localeRows=unique(locales && locales.length ? locales : ["en"],4);
  const sectors=unique(sourceTerms.filter(term=>term.length<80),20);
  const rows=[];
  for(const lane of GENERIC_SUPPLY_LANES){
    const variants=[lane.query,`${lane.query} official ecommerce catalog contact customer service`];
    for(let index=0;index<variants.length;index+=1){
      const locale=localeRows[index%localeRows.length]||"en";
      rows.push({query:`${country} ${variants[index]}`,locale,origin:`country-supply-lane:${lane.id}`,lane:lane.id,localName:country,localizationError:null});
      if(rows.length>=maxQueries)break;
    }
    if(rows.length>=maxQueries)break;
  }
  if(rows.length<maxQueries && sectors.length) rows.push({query:`${country} ${sectors.slice(0,10).join(" ")} manufacturer producer supplier official store`,locale:localeRows[0]||"en",origin:"searchbank-psom-policy-plan",lane:"taxonomy_bridge",localName:country,localizationError:null});
  return rows.slice(0,maxQueries);
}

function krRows(geo, sourceTerms, maxQueries){
  const period=Math.floor(Date.now()/(6*60*60*1000));
  const productOffset=stableOffset([geo.country,geo.region||"NATIONWIDE",period,"product"].join("|"),KR_PRODUCT_CLUSTERS.length);
  const entityOffset=stableOffset([geo.country,geo.region||"NATIONWIDE",period,"entity"].join("|"),KR_ENTITY_CLUSTERS.length);
  const dynamic=[];
  for(let i=0;i<4;i+=1){
    const products=KR_PRODUCT_CLUSTERS[(productOffset+i)%KR_PRODUCT_CLUSTERS.length];
    const entities=KR_ENTITY_CLUSTERS[(entityOffset+i)%KR_ENTITY_CLUSTERS.length];
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
  return unique(KR_FOUNDATION_QUERIES.concat(dynamic),maxQueries).map((query,index)=>{const lane=laneFor(query,index);return{query,locale:"ko",origin:`country-supply-lane:${lane}`,lane,localName:"대한민국",localizationError:null};});
}

function snapshotSeeds(bank, geo, rows, limit){
  const country=lower(first(geo && geo.country));
  const queryTokens=unique(array(rows).flatMap(row=>words(row && row.query)),160).map(lower);
  const out=[];
  for(const item of array(bank && bank.items)){
    if(!item || typeof item!=="object") continue;
    const url=safeUrl(first(item.url,item.link,item.official_url));
    if(!url || /^#/.test(url)) continue;
    let parsedUrl=null;try{parsedUrl=new URL(url);}catch(_e){}
    const titleText=lower(first(item.title,item.name));
    if(!parsedUrl || /(^|\.)example\.(com|org|net|edu)$/.test(parsedUrl.hostname) || /youtube\.com|youtu\.be/.test(parsedUrl.hostname) || /\/(?:seed|placeholder)(?:\/|$)/i.test(parsedUrl.pathname) || /seed placeholder|placeholder item|sample item/.test(titleText)) continue;
    const hay=lower(JSON.stringify({title:item.title,name:item.name,summary:item.summary,tags:item.tags,category:item.category,section:item.section,type:item.type,channel:item.channel,geo:item.geo,producer:item.producer,country:item.country,marketCountry:item.marketCountry,distributionMarketCountry:item.distributionMarketCountry,availabilityCountries:item.availabilityCountries}));
    const commerceLike=/(commerce|distribution|product|supplier|producer|manufacturer|cooperative|shop|store|seller|merchant|농장|농협|축협|수협|협동조합|제조|생산|판매|유통)/i.test(hay);
    if(!commerceLike) continue;
    const countryMatched=country && (hay.includes(`\"${country}\"`) || (country==="kr"&&(hay.includes("대한민국")||hay.includes("south korea")||hay.includes("korea")||hay.includes("한국"))));
    const hasCountrySignal=/\"country\"|marketcountry|distributionmarketcountry|availabilitycountries/i.test(hay);
    if(country && hasCountrySignal && !countryMatched) continue;
    let score=countryMatched?30:0;
    for(const token of queryTokens){ if(token.length>=2 && hay.includes(token)) score+=1; }
    if(/official|공식|manufacturer|producer|cooperative|supplier|농장|농협|축협|수협|협동조합|제조사|생산자|유통업체/i.test(hay)) score+=12;
    if(score<10) continue;
    out.push({score,item:Object.assign({},item,{source:first(item.source,"searchbank_snapshot"),provider:"searchbank",payload:Object.assign({},item.payload||{},{source:"searchbank_snapshot",country:geo.country,researchPlanVersion:VERSION})})});
  }
  out.sort((a,b)=>b.score-a.score);
  const seen=new Set(); const seeds=[];
  for(const row of out){
    const url=safeUrl(first(row.item.url,row.item.link));
    if(!url || seen.has(url)) continue;
    seen.add(url); seeds.push(row.item);
    if(seeds.length>=limit) break;
  }
  return seeds;
}

function buildPlan(input){
  const raw=input && typeof input==="object" ? input : {};
  const geo=raw.geo && typeof raw.geo==="object" ? raw.geo : raw;
  const locales=unique(raw.locales && raw.locales.length ? raw.locales : [geo.country==="KR"?"ko":"en"],12);
  const maxQueries=Math.max(3,Math.min(24,Number(raw.maxQueries)||12));
  const sources=loadSources();
  const bank=bankTaxonomy(sources.bank);
  const terms=unique([].concat(psomTerms(sources.psom),commercePolicyTerms(sources.commerce),bank.tags,bank.categories,bank.producers),240);
  const rows=geo.country==="KR" ? krRows(geo,terms,maxQueries) : genericRows(geo,locales,terms,maxQueries);
  const seeds=snapshotSeeds(sources.bank,geo,rows,Math.max(0,Math.min(20,Number(raw.seedLimit)||10)));
  return {
    version:VERSION, rows, seeds,
    diagnostics:{
      files:{psom:!!sources.psomFile,searchBankSnapshot:!!sources.bankFile,commercePolicy:!!sources.commerceFile,regionalPolicy:!!sources.regionalFile},
      psomTerms:psomTerms(sources.psom).length,
      commercePolicyTerms:commercePolicyTerms(sources.commerce).length,
      searchBank:{items:bank.itemCount,external:bank.externalCount,commerceLike:bank.commerceCount,tags:bank.tags.length,categories:bank.categories.length,producers:bank.producers.length},
      generatedQueries:rows.length,supplyLanes:unique(rows.map(row=>row&&row.lane),40),snapshotSeeds:seeds.length
    }
  };
}

module.exports={VERSION,buildPlan};
