"use strict";

/**
 * Coupang Partners provider adapter (prepared / disabled-by-default).
 *
 * Production safety:
 * - No browser secrets.
 * - No provider call unless API enable switch, credentials, endpoint contract,
 *   current policy verification and disclosure approval are all present.
 * - Endpoint paths are ENV-configured instead of hard-coded so a stale API
 *   contract cannot silently become production traffic.
 * - Candidate output is private/staging data only. Publication is left to the
 *   existing IGDC commerce candidate -> audit -> canonical snapshot pipeline.
 */

const crypto = require("crypto");

const VERSION = "coupang-partners-provider-v1.0.0-prepared";
const PROVIDER_ID = "coupang-partners-kr";
const SAFE_HOST_SUFFIX = ".coupang.com";

function text(v){ return v == null ? "" : String(v).trim(); }
function lower(v){ return text(v).toLowerCase(); }
function bool(v){ return v === true || ["1","true","yes","on","enabled","approved","verified","active"].includes(lower(v)); }
function array(v){ return Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]); }
function safeInt(v,min,max,fallback){ const n=Number(v); return Number.isInteger(n)&&n>=min&&n<=max?n:fallback; }
function httpsUrl(v){ try{ const u=new URL(text(v)); return u.protocol==="https:"?u.toString():""; }catch(_e){return "";} }
function hostAllowed(v){ try{ const h=new URL(v).hostname.toLowerCase(); return h==="coupang.com" || h.endsWith(SAFE_HOST_SUFFIX); }catch(_e){return false;} }
function isFresh(value,days){ const t=Date.parse(text(value)); const span=Math.max(1,Number(days)||14)*86400000; return Number.isFinite(t)&&t<=Date.now()+300000&&t>=Date.now()-span; }
function sha256(v){ return crypto.createHash("sha256").update(String(v)).digest("hex"); }

function config(envInput){
  const env=envInput||process.env;
  const enabled=bool(env.COUPANG_API_ENABLED);
  const accessKey=text(env.COUPANG_ACCESS_KEY);
  const secretKey=text(env.COUPANG_SECRET_KEY);
  const baseUrl=httpsUrl(env.COUPANG_API_BASE_URL);
  const popularPathTemplate=text(env.COUPANG_API_POPULAR_PATH_TEMPLATE);
  const deeplinkPath=text(env.COUPANG_API_DEEPLINK_PATH);
  const authMode=lower(env.COUPANG_API_AUTH_MODE||"coupang-cea-hmac-sha256");
  const policyVerifiedAt=text(env.COUPANG_API_POLICY_VERIFIED_AT);
  const policyMaxAgeDays=safeInt(env.COUPANG_API_POLICY_MAX_AGE_DAYS,1,90,14);
  const disclosureApproved=bool(env.COUPANG_DISCLOSURE_APPROVED);
  const disclosureText=text(env.COUPANG_DISCLOSURE_TEXT);
  const categoryIds=text(env.COUPANG_POPULAR_CATEGORY_IDS).split(",").map(s=>s.trim()).filter(Boolean).slice(0,100);
  const pageSize=safeInt(env.COUPANG_API_PAGE_SIZE,1,100,20);
  const timeoutMs=safeInt(env.COUPANG_API_TIMEOUT_MS,2000,30000,12000);
  const blockers=[];
  if(!enabled) blockers.push("COUPANG_API_DISABLED");
  if(!accessKey) blockers.push("COUPANG_ACCESS_KEY_MISSING");
  if(!secretKey) blockers.push("COUPANG_SECRET_KEY_MISSING");
  if(!baseUrl) blockers.push("COUPANG_API_BASE_URL_MISSING_OR_INVALID");
  else if(!hostAllowed(baseUrl)) blockers.push("COUPANG_API_BASE_HOST_NOT_COUPANG");
  if(!popularPathTemplate || popularPathTemplate.indexOf("{categoryId}")<0) blockers.push("COUPANG_POPULAR_PATH_TEMPLATE_MISSING");
  if(!deeplinkPath) blockers.push("COUPANG_DEEPLINK_PATH_MISSING");
  if(authMode!=="coupang-cea-hmac-sha256") blockers.push("COUPANG_API_AUTH_MODE_UNVERIFIED");
  if(!isFresh(policyVerifiedAt,policyMaxAgeDays)) blockers.push("COUPANG_API_POLICY_VERIFICATION_MISSING_OR_STALE");
  if(!disclosureApproved || !disclosureText) blockers.push("COUPANG_DISCLOSURE_NOT_APPROVED");
  if(!categoryIds.length) blockers.push("COUPANG_CATEGORY_IDS_MISSING");
  return {
    version:VERSION, providerId:PROVIDER_ID, enabled, ready:blockers.length===0, blockers,
    accessKey, secretKey, baseUrl, popularPathTemplate, deeplinkPath, authMode,
    policyVerifiedAt, policyMaxAgeDays, disclosureApproved, disclosureText,
    categoryIds, pageSize, timeoutMs
  };
}

function publicConfig(cfg){
  cfg=cfg||config();
  return {
    version:cfg.version, providerId:cfg.providerId, enabled:cfg.enabled, ready:cfg.ready,
    blockers:(cfg.blockers||[]).slice(), apiBaseConfigured:!!cfg.baseUrl,
    popularPathConfigured:!!cfg.popularPathTemplate, deeplinkPathConfigured:!!cfg.deeplinkPath,
    accessKeyConfigured:!!cfg.accessKey, secretKeyConfigured:!!cfg.secretKey,
    policyVerifiedAt:cfg.policyVerifiedAt||null, policyMaxAgeDays:cfg.policyMaxAgeDays,
    disclosureApproved:cfg.disclosureApproved===true, categoryCount:(cfg.categoryIds||[]).length,
    pageSize:cfg.pageSize
  };
}

function signedDate(dateInput){
  const d=dateInput instanceof Date?dateInput:new Date(dateInput||Date.now());
  const yy=String(d.getUTCFullYear()).slice(-2), mo=String(d.getUTCMonth()+1).padStart(2,"0"), da=String(d.getUTCDate()).padStart(2,"0");
  const hh=String(d.getUTCHours()).padStart(2,"0"), mm=String(d.getUTCMinutes()).padStart(2,"0"), ss=String(d.getUTCSeconds()).padStart(2,"0");
  return yy+mo+da+"T"+hh+mm+ss+"Z";
}

function signedHeaders(method,urlInput,cfg,dateInput){
  const url=new URL(urlInput);
  const datetime=signedDate(dateInput);
  const path=url.pathname;
  const query=url.search ? url.search.slice(1) : "";
  const message=datetime+String(method||"GET").toUpperCase()+path+query;
  const signature=crypto.createHmac("sha256",cfg.secretKey).update(message).digest("hex");
  return {
    Authorization:`CEA algorithm=HmacSHA256, access-key=${cfg.accessKey}, signed-date=${datetime}, signature=${signature}`,
    "content-type":"application/json; charset=utf-8"
  };
}

async function request(method,pathOrUrl,body,cfgInput,deps){
  const cfg=cfgInput||config();
  if(!cfg.ready){ const e=new Error("coupang_provider_not_ready"); e.code="COUPANG_PROVIDER_NOT_READY"; e.blockers=cfg.blockers; throw e; }
  const url=/^https:\/\//i.test(pathOrUrl)?new URL(pathOrUrl):new URL(pathOrUrl,cfg.baseUrl);
  if(!hostAllowed(url.toString())){ const e=new Error("coupang_api_host_rejected"); e.code="COUPANG_API_HOST_REJECTED"; throw e; }
  const fetchImpl=deps&&deps.fetch||fetch;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),cfg.timeoutMs);
  try{
    const res=await fetchImpl(url.toString(),{
      method:String(method||"GET").toUpperCase(),
      headers:signedHeaders(method,url.toString(),cfg),
      body:body==null?undefined:JSON.stringify(body),
      signal:controller.signal
    });
    const raw=await res.text();
    let data=null; try{data=raw?JSON.parse(raw):null;}catch(_e){data=raw||null;}
    if(!res.ok){ const e=new Error("coupang_api_http_"+res.status); e.statusCode=res.status; e.providerBody=data; throw e; }
    return data;
  } finally { clearTimeout(timer); }
}

function listFromResponse(doc){
  if(Array.isArray(doc)) return doc;
  if(!doc||typeof doc!=="object") return [];
  const candidates=[doc.data,doc.products,doc.items,doc.productData,doc.rData,doc.result];
  for(const value of candidates){
    if(Array.isArray(value)) return value;
    if(value&&typeof value==="object"){
      for(const k of ["products","items","productData","data"]){ if(Array.isArray(value[k])) return value[k]; }
    }
  }
  return [];
}

function first(){ for(const v of arguments){ if(v!==undefined&&v!==null&&text(v)!=="") return v; } return undefined; }
function productId(row){ return text(first(row&&row.productId,row&&row.product_id,row&&row.id,row&&row.itemId,row&&row.item_id)); }
function productUrl(row){ return httpsUrl(first(row&&row.productUrl,row&&row.product_url,row&&row.url,row&&row.link,row&&row.landingUrl,row&&row.originalUrl)); }
function productImage(row){ return httpsUrl(first(row&&row.productImage,row&&row.product_image,row&&row.imageUrl,row&&row.image,row&&row.thumbnailUrl,row&&row.thumbnail)); }
function productTitle(row){ return text(first(row&&row.productName,row&&row.product_name,row&&row.title,row&&row.name)); }
function productPrice(row){ const v=first(row&&row.productPrice,row&&row.product_price,row&&row.salePrice,row&&row.price); const n=Number(v); return Number.isFinite(n)&&n>=0?n:null; }
function productCategory(row){ return text(first(row&&row.categoryName,row&&row.category,row&&row.categoryId,row&&row.category_id)); }
function commissionRate(row){
  const raw=first(row&&row.commissionRate,row&&row.commission_rate,row&&row.rate,row&&row.commission);
  const n=Number(raw); if(!Number.isFinite(n)||n<0) return null;
  const ratio=n>1?n/100:n; return ratio>=0&&ratio<=1?ratio:null;
}
function envInt(env,name,min,max){ const raw=text(env&&env[name]); if(!/^-?\d+$/.test(raw)) return null; const n=Number(raw); return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null; }
function verifiedEconomics(product,envInput){
  const env=envInput||process.env;
  if(!bool(env.COUPANG_ECONOMICS_VERIFIED)) return null;
  const rate=product&&product.commissionRate;
  const price=product&&product.price;
  if(!(Number.isFinite(rate)&&rate>0&&rate<=1&&Number.isFinite(price)&&price>=0)) return null;
  const legalStatus=lower(env.COUPANG_LEGAL_ROLE_STATUS);
  const taxStatus=lower(env.COUPANG_TAX_STATUS);
  if(!["resolved","verified","approved","complete","ready"].includes(legalStatus)) return null;
  if(!["resolved","verified","approved","complete","ready"].includes(taxStatus)) return null;
  const names=["COUPANG_TAX_BPS","COUPANG_WITHHOLDING_BPS","COUPANG_PAYMENT_FEE_BPS","COUPANG_FX_FEE_BPS","COUPANG_NETWORK_FEE_BPS","COUPANG_REFUND_RESERVE_BPS","COUPANG_CHARGEBACK_RESERVE_BPS"];
  const bps=Object.fromEntries(names.map(name=>[name,envInt(env,name,0,10000)]));
  if(Object.values(bps).some(v=>v===null)) return null;
  const operatorCost=envInt(env,"COUPANG_OPERATOR_COST_MINOR",0,Number.MAX_SAFE_INTEGER);
  if(operatorCost===null) return null;
  const gross=Math.floor(price*rate);
  const cost=(name)=>Math.floor(gross*bps[name]/10000);
  return {
    verified:true, currency:"KRW", legalRoleStatus:legalStatus, taxStatus, grossRevenueMinor:gross,
    taxLiabilityMinor:cost("COUPANG_TAX_BPS"), withholdingMinor:cost("COUPANG_WITHHOLDING_BPS"),
    paymentFeeMinor:cost("COUPANG_PAYMENT_FEE_BPS"), fxFeeMinor:cost("COUPANG_FX_FEE_BPS"),
    networkFeeMinor:cost("COUPANG_NETWORK_FEE_BPS"), refundReserveMinor:cost("COUPANG_REFUND_RESERVE_BPS"),
    chargebackReserveMinor:cost("COUPANG_CHARGEBACK_RESERVE_BPS"), operatorCostMinor:operatorCost,
    source:"operator_verified_provider_terms", verifiedAt:text(env.COUPANG_ECONOMICS_VERIFIED_AT)||text(env.COUPANG_API_POLICY_VERIFIED_AT)||null
  };
}

function normalizeProducts(doc,context){
  const seen=new Set(),out=[];
  const rows=listFromResponse(doc);
  for(let index=0;index<rows.length;index++){ const row=rows[index];
    if(!row||typeof row!=="object") continue;
    const id=productId(row),url=productUrl(row),title=productTitle(row),image=productImage(row);
    if(!id||!url||!title||!hostAllowed(url)||seen.has(id)) continue;
    seen.add(id);
    out.push({
      providerId:PROVIDER_ID, providerProductId:id, title, productUrl:url, image,
      price:productPrice(row), currency:"KRW", category:productCategory(row), commissionRate:commissionRate(row),
      categoryId:text(context&&context.categoryId)||null, providerPopularityRank:index+1,
      providerPopularityScore:Math.max(1,100-Math.min(99,index*3)),
      providerPayloadDigest:sha256(JSON.stringify(row))
    });
  }
  return out;
}

function deepLinkList(doc){
  const rows=listFromResponse(doc),out=[];
  for(const row of rows){
    if(!row||typeof row!=="object") continue;
    const original=httpsUrl(first(row.originalUrl,row.original_url,row.coupangUrl,row.url));
    const tracking=httpsUrl(first(row.shortenUrl,row.shortUrl,row.affiliateUrl,row.landingUrl,row.trackingUrl,row.url));
    if(original&&tracking&&hostAllowed(tracking)) out.push({originalUrl:original,trackingUrl:tracking});
  }
  return out;
}

async function fetchPopular(categoryId,cfg,deps){
  const path=cfg.popularPathTemplate.replace(/\{categoryId\}/g,encodeURIComponent(categoryId)).replace(/\{limit\}/g,String(cfg.pageSize));
  const doc=await request("GET",path,null,cfg,deps);
  return normalizeProducts(doc,{categoryId});
}

async function createDeepLinks(urls,cfg,deps){
  const unique=Array.from(new Set(array(urls).map(httpsUrl).filter(v=>v&&hostAllowed(v)))).slice(0,100);
  if(!unique.length) return new Map();
  const doc=await request("POST",cfg.deeplinkPath,{coupangUrls:unique},cfg,deps);
  const map=new Map();
  for(const row of deepLinkList(doc)) map.set(row.originalUrl,row.trackingUrl);
  return map;
}

function candidateFromProduct(product,trackingUrl,cfgInput){
  const cfg=cfgInput||config();
  const id="coupang_"+sha256(PROVIDER_ID+"|"+product.providerProductId).slice(0,28);
  const canonicalPath="/content.html?id="+encodeURIComponent(id);
  const description=[product.title,product.category?"카테고리: "+product.category:"",product.price!=null?"가격: "+Math.round(product.price).toLocaleString("ko-KR")+"원":""].filter(Boolean).join(" · ");
  return {
    id,
    productId:id,
    providerProductId:product.providerProductId,
    title:product.title,
    productName:product.title,
    description,
    summary:description,
    image:product.image||"",
    thumbnail:product.image||"",
    url:product.productUrl,
    externalProductUrl:product.productUrl,
    price:product.price,
    currency:product.currency||"KRW",
    country:"KR",
    marketAvailability:{markets:[{country:"KR",regions:["NATIONWIDE"],status:"active",source:"coupang-partners-api",verified:true,verifiedAt:cfg.policyVerifiedAt}]},
    sellerResponsibility:{verified:true,marketplace:true,verificationType:"provider_signed_api",provider:"Coupang",checkoutOwner:"COUPANG",shippingOwner:"COUPANG_OR_SELLER"},
    commerceCandidate:{sourceTier:"external_brokerage",origin:"coupang-partners-api",revenueType:"affiliate",monetizationCandidate:true,providerId:PROVIDER_ID,providerPopularityRank:product.providerPopularityRank||null,providerPopularityScore:product.providerPopularityScore||0},
    affiliate:{
      approved:true, verified:true, status:"approved", providerId:PROVIDER_ID, programId:PROVIDER_ID,
      trackingUrl, providerGenerated:true, integrationMode:"api", disclosureReady:true,
      policyVerifiedAt:cfg.policyVerifiedAt, conversionMode:"statement_import", currency:"KRW", commissionRate:product.commissionRate
    },
    seoLandingEnabled:true,
    seo:{
      title:product.title+" | IGDC",
      description:description.slice(0,240),
      canonicalPath,
      productSchema:true,
      keywords:[product.title,product.category,"쿠팡","IGDC"].filter(Boolean)
    },
    monetizationEconomics:verifiedEconomics(product,process.env)||undefined,
    affiliateDisclosure:{providerId:PROVIDER_ID,text:cfg.disclosureText,approved:true,verifiedAt:cfg.policyVerifiedAt},
    providerEvidence:{providerId:PROVIDER_ID,apiVerified:true,policyVerifiedAt:cfg.policyVerifiedAt,payloadDigest:product.providerPayloadDigest||null}
  };
}

module.exports={
  VERSION,PROVIDER_ID,config,publicConfig,signedDate,signedHeaders,request,listFromResponse,
  normalizeProducts,deepLinkList,fetchPopular,createDeepLinks,candidateFromProduct,verifiedEconomics,commissionRate,
  httpsUrl,hostAllowed,isFresh,sha256
};
