"use strict";
/* Offline reproduction of 2026-10-23 Distribution operator action failures. */
const assert=require("node:assert/strict");
const Module=require("node:module");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
function loaded(rel,mocks){
 const filename=path.join(root,rel),original=Module._load;
 Module._load=function(name,parent,isMain){return Object.prototype.hasOwnProperty.call(mocks,name)?mocks[name]:original.apply(this,arguments);};
 delete require.cache[require.resolve(filename)];
 try{return require(filename);}finally{Module._load=original;}
}
async function testStalePublicationVersusDurableAssignment(){
 const ref="country-product-ranking-review",rows=new Map(),assignments=new Map();
 function add(id,rel,pub){
  rows.set(id,{id,kind:"product",source_ref:ref,status:"hold",source_payload:{
   marketScope:{marketCountry:"KR",marketRegion:"NATIONWIDE"},
   slotDecision:"hold",review:{state:"hold"},queueControl:{action:"hold"},
   frontPublication:{status:pub}
  }});
  assignments.set(id,rel.map((r,i)=>({id:"assign_"+id+"_"+i,candidate_id:id,publication_status:r})));
 }
 add("stale_publication",[ "not_ready" ],"published");
 add("really_published",["published"],"published");
 add("payload_only",[],"published");
 const store={
  select:async(table,query)=>{
   if(table==="gslot_candidates"){const id=decodeURIComponent((query.match(/id=eq\.([^&]+)/)||[])[1]||"");return rows.has(id)?[rows.get(id)]:[];}
   if(table==="gslot_slot_assignments"){const id=decodeURIComponent((query.match(/candidate_id=eq\.([^&]+)/)||[])[1]||"");return assignments.get(id)||[];}
   throw Error(table);
  },
  remove:async(table,query)=>{
   assert.equal(table,"gslot_slot_assignments");
   const id=decodeURIComponent((query.match(/candidate_id=eq\.([^&]+)/)||[])[1]||"");
   const previous=assignments.get(id)||[];assignments.set(id,[]);return previous;
  },
  update:async(table,query,patch)=>{
   assert.equal(table,"gslot_candidates");
   const id=decodeURIComponent((query.match(/id=eq\.([^&]+)/)||[])[1]||"");
   Object.assign(rows.get(id),patch);return [rows.get(id)];
  }
 };
 const {handler}=loaded("netlify/functions/commerce-candidate-queue-control.js",{
  "./lib/global-slot-console-auth":{resolveUser:async()=>({roles:["owner"],sub:"operator"})},
  "./lib/global-slot-console-supabase":store,
  "./lib/commerce-country-automation.v1":{syncCandidateManagementResearchVisibilityByInput:async()=>({ok:true})}
 });
 const request=id=>({httpMethod:"POST",body:JSON.stringify({decision:"dismiss",expectedBucket:"hold",candidateIds:[id],countryCode:"KR",subdivisionCode:"NATIONWIDE"})});
 let response=await handler(request("stale_publication"));
 assert.equal(response.statusCode,200,response.body);
 assert.equal(rows.get("stale_publication").status,"removed");
 assert.equal(assignments.get("stale_publication").length,0);
 response=await handler(request("really_published"));
 assert.equal(response.statusCode,409);
 assert.equal(rows.get("really_published").status,"hold");
 response=await handler(request("payload_only"));
 assert.equal(response.statusCode,409,"No assignment and old publication marker must remain protected until reconciled");
 console.log("PASS historical assignment stale payload deletion, active publication protection");
}
async function testChunkedVisibility(){
 const pathName=path.join(root,"netlify/functions/lib/commerce-country-automation.v1.js"),source=fs.readFileSync(pathName,"utf8");
 const from=source.indexOf("async function syncCandidateManagementResearchVisibility(");
 const to=source.indexOf("\nasync function syncCandidateManagementResearchVisibilityByInput(",from);
 assert.ok(from>=0&&to>from);
 let savedRuntime=null, lookupCount=0;
 const state={
  PRODUCT_JOB_SCHEMA:"test",PRODUCT_SOURCE_REF:"country-product-ranking-review",PRODUCT_PORTFOLIO_LIMIT:20000,
  loadProductResearchJob:async()=>({schema:"test",resultStorage:"chunked_v1",products:[],rawProducts:[]}),
  productCandidateId:()=>"",
  ProductRanking:{productIdentity:x=>x.productIdentity},
  SlotStore:{select:async()=>{lookupCount++;return [{id:"candidate_99",source_ref:"country-product-ranking-review",official_url:"https://shop.example.com/item/99",source_payload:{researchIdentity:"shop.example.com|id:99"}}];}},
  productRuntimeRule:async()=>({jobId:"current",latestResearchDeletedIdentities:[],permanentExcludedIdentities:["shop.example.com|id:99"],researchExcludedIdentities:["shop.example.com|id:99"]}),
  saveProductRuntime:async(_scope,_actor,value)=>{savedRuntime=value;},
  safeUrl:x=>x,first:(...args)=>args.find(x=>x!==undefined&&x!==null&&x!=="")||"",
  text:x=>x==null?"":String(x).trim(),lower:x=>x==null?"":String(x).trim().toLowerCase(),
  plain:x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{},array:x=>Array.isArray(x)?x:[],
  productUrl:r=>r.productUrl||r.url||"",iso:()=>new Date().toISOString()
 };
 vm.createContext(state);vm.runInContext(source.slice(from,to)+"\nthis.action=syncCandidateManagementResearchVisibility;",state);
 const outcome=await state.action("owner",{country:"KR",region:"NATIONWIDE"},"candidate_99","dismiss");
 assert.equal(outcome.ok,true);
 assert.equal(lookupCount,1);
 assert.ok(savedRuntime.latestResearchDeletedIdentities.includes("shop.example.com|id:99"));
 assert.equal(savedRuntime.permanentExcludedIdentities.includes("shop.example.com|id:99"),false);
 assert.equal(savedRuntime.researchExcludedIdentities.includes("shop.example.com|id:99"),false);
 console.log("PASS chunked research deletion visibility checkpoint");
}
function testAdminReadbackFallback(){
 const ui=fs.readFileSync(path.join(root,"assets/js/admin-commerce-country-control.js"),"utf8");
 assert.match(ui,/var persistedIds=new Set\(\(bulkResult\.processedIds\|\|\[\]\)/);
 assert.match(ui,/renderProducts\(nextRows\)/);
 assert.match(ui,/var stageRows=allMode\?latestVisibleResearchRows\(\)\.slice\(\):selectedRows\.slice\(\)/,
   "whole latest-list registration must exclude already transferred or held items");
 const html=fs.readFileSync(path.join(root,"commerce-country-control.html"),"utf8");
 assert.match(html,/admin-commerce-country-control\.js\?v=20261023-latest-inventory-actions-v2/);
 console.log("PASS committed management actions survive slow full-ledger reload; browser cache revision");
}
(async()=>{await testStalePublicationVersusDurableAssignment();await testChunkedVisibility();testAdminReadbackFallback();console.log("PASS operator actions regression suite");})().catch(error=>{console.error(error);process.exitCode=1;});
