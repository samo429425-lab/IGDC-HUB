"use strict";
// Deterministic, no-network regression fixtures for the Distribution hold flow.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ProductRanking = require("../netlify/functions/lib/commerce-product-ranking.v1.js");
const src=fs.readFileSync(path.join(__dirname,"../netlify/functions/lib/commerce-country-automation.v1.js"),"utf8");
const from=src.indexOf("function heldCandidateRecoverySource(candidateInput)");
const until=src.indexOf("\nasync function productCandidateHoldVerify(actorId, input) {",from);
assert(from>0 && until>from,"hold recovery functions must exist");
const helpers=src.slice(from,until);
const text=v=>v==null?"":String(v).trim();
const plain=v=>v&&!Array.isArray(v)&&typeof v==="object"?v:{};
const array=v=>Array.isArray(v)?v:[];
const first=(...values)=>values.map(text).find(Boolean)||"";
const safeUrl=v=>{try{const u=new URL(text(v));return u.protocol==="https:"?u.toString():""}catch(_e){return"";}};
const site=(a,b)=>{try{return new URL(a).hostname===new URL(b).hostname;}catch(_e){return false;}};
const productUrl=row=>ProductRanking.canonicalProductUrl(first(row&&row.productUrl,row&&row.url));
const imageUrl=row=>ProductRanking.safeProductImageUrl(first(row&&row.imageUrl,row&&row.imageOriginalUrl));
const oldFurniture="https://englander.co.kr/goods/goods_view.php?goodsno=5976";
const goodFurniture="https://englander.co.kr/goods/goods_view.php?goodsNo=5976";
const oldCosmetics="https://tonymoly.com/set/products/premium-rx-swallow-set.do?i_sproductcd=TM20240829000149680";
const newCosmetics="https://tonymoly.com/products/new-premium-rx-swallow-set.do?i_sproductcd=TM20240829000149680";
const unrelated="https://englander.co.kr/goods/goods_view.php?goodsNo=6671";
let found=[];let inspection=[];
const selector={
  async discoverSupplierProductsStep(){return {items:found};},
  prepareProductInspectionPool(rows,{limit}){return rows.slice(0,limit);},
  async inspectProductResearchStep(rows){
    return {items:rows.map(row=>{
      const match=inspection.find(i=>i.productUrl===row.productUrl);
      return match?Object.assign({},row,match):Object.assign({},row,{productPageLive:false,inspectionComplete:true,researchStatus:"product_page_explicit_invalid_message"});
    })};
  }
};
const context={URL,ProductRanking,RegionalSelector:selector,SlotStore:{async select(){return[];}},PRODUCT_SOURCE_REF:"country-product-ranking-review",first,text,lower:v=>text(v).toLowerCase(),array,plain,safeUrl,sameSupplierSite:site,runtimeProductOrigin:v=>new URL(v).origin+"/",persistedProductRows:async()=>[],productJobRule:async()=>({}),productUrl,productImageUrl:imageUrl,sha256:v=>crypto.createHash("sha256").update(String(v)).digest("hex"),fallbackDiscoverSupplierProducts:async()=>({items:[]}),candidateRuntimeHealth:row=>({live:row.productPageLive===true&&row.inspectionComplete===true&&!!imageUrl(row)&&!!text(row.productName),dead:row.productPageLive!==true})};
vm.createContext(context);
vm.runInContext(helpers,context,{filename:"commerce-country-automation.v1.js"});
const row=(url,supplier)=>({id:"held-1",title:"Original",official_url:url,source_payload:{productName:"Original",productUrl:url,externalProductUrl:url,imageUrl:"https://example.org/original.jpg",supplierSiteUrl:supplier,sourcePageUrl:supplier+"category",sourcePageUrls:[supplier+"another-category"]}});
const healthy=(url,title)=>({productUrl:url,url,productName:title,title,imageUrl:"https://example.org/current.jpg",imageOriginalUrl:"https://example.org/current.jpg",supplierSiteUrl:new URL(url).origin+"/",productPageLive:true,inspectionComplete:true,sameSupplierSite:true,researchStatus:"ready_for_admin_review",verifiedDetailPageUrl:url});
(async()=>{
  const origin=context.heldCandidateRecoverySource(row(oldFurniture,"https://englander.co.kr/"));
  assert.equal(origin.sourcePageUrls.length,2,"source hints must no longer throw undeclared sourcePageUrls");
  assert.equal(context.heldProductReference(oldFurniture),context.heldProductReference(goodFurniture),"case-only query repair preserves product id");
  assert.equal(context.heldRecoveryReferenceMatches(oldFurniture,unrelated),false,"different product number must not auto-replace");
  assert.equal(context.heldRecoveryReferenceMatches(oldCosmetics,newCosmetics),true,"same immutable cosmetics product code may move path");
  inspection=[healthy(goodFurniture,"Original Furniture")];found=[];
  const repaired=await context.recoverHeldCandidateProduct(row(oldFurniture,"https://englander.co.kr/"),{country:"KR",region:"NATIONWIDE"});
  assert.equal(repaired.ok,true,"same-id case variant should repair");
  assert.equal(repaired.kind,"same_product_url_repair");
  assert.equal(repaired.recoveredUrl,goodFurniture);
  // A different live furniture product stays a REVIEW-ONLY suggestion.
  inspection=[healthy(unrelated,"Different Furniture")];found=[healthy(unrelated,"Different Furniture")];
  const alternative=await context.recoverHeldCandidateProduct(row(oldFurniture,"https://englander.co.kr/"),{country:"KR",region:"NATIONWIDE"});
  assert.equal(alternative.ok,false,"different product may never overwrite same candidate");
  assert.equal(alternative.suggestions.length,1);
  assert.equal(alternative.suggestions[0].status,"page_checked_alternative_requires_administrator_approval");
  // Current product's unchanged ID, new official supplier product path.
  inspection=[healthy(newCosmetics,"Premium RX Swallow")];found=[healthy(newCosmetics,"Premium RX Swallow")];
  const moved=await context.recoverHeldCandidateProduct(row(oldCosmetics,"https://tonymoly.com/"),{country:"US",region:"NATIONWIDE"});
  assert.equal(moved.ok,true,"global country scopes must allow same supplier same product code relocation");
  assert.equal(moved.kind,"same_product_reference_recovered");
  // Invalid original and no validated product -> remain held.
  inspection=[];found=[];
  const held=await context.recoverHeldCandidateProduct(row(oldCosmetics,"https://tonymoly.com/"),{country:"KR",region:"NATIONWIDE"});
  assert.equal(held.ok,false);assert.equal(held.suggestions.length,0);
  console.log("PASS: source-page hint binding; query case normalization; same-product URL repair; distinct-product review only; multilingual scope; unresolved stays held (6 checks)");
})().catch(error=>{console.error(error);process.exitCode=1;});
