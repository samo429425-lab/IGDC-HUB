'use strict';
/** Pure/offline regression: zero external requests, no DB/Netlify mutations. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const Ranking=require('../netlify/functions/lib/commerce-product-ranking.v1');
const Reserve=require('../netlify/functions/lib/commerce-product-research-reserve.v1');
const Detail=require('../netlify/functions/lib/commerce-product-detail-quality.v1');
const MarketScope=require('../netlify/functions/lib/market-sale-scope.v1');
const source=fs.readFileSync(path.join(root,'netlify/functions/lib/commerce-country-automation.v1.js'),'utf8');
const inspector=fs.readFileSync(path.join(root,'netlify/functions/regional-brokerage-autoselector.js'),'utf8');
const geo=fs.readFileSync(path.join(root,'netlify/edge-functions/commerce-country-geo.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'assets/js/admin-commerce-country-control.js'),'utf8');
const runner=fs.readFileSync(path.join(root,'netlify/functions/commerce-country-control.js'),'utf8');
function row(id,country,category,score,opts={}){return {id,status:opts.status||'approval_pending',source_ref:'country-product-ranking-review',source_payload:{marketScope:{marketCountry:country,marketRegion:'NATIONWIDE'},countrySupply:{country,region:'NATIONWIDE'},slotDecision:opts.locked?'slot_candidate':'undecided',managementControl:{administratorLocked:!!opts.locked},productRanking:{category,score},frontPublication:opts.published?{status:'published'}:{}},official_url:'https://example.com/product/'+id};}
function incoming(category,score){return {productCategory:category,rankingScore:score,productName:'Premium retail item '+category,productUrl:'https://example.com/product/new-'+category,supplierName:'Brand'};}
function testReserve(){
 const active=Array.from({length:200},(_,i)=>row('KR-'+i,'KR','beauty_personal_care',40+i/10,{locked:i<70,published:i===70}));
 const others=Array.from({length:400},(_,i)=>row('US-'+i,'US','beauty_personal_care',5));
 const pile=active.concat(others);
 const scope={country:'KR',region:'NATIONWIDE'};
 assert.equal(pile.filter(r=>Reserve.scopeMatches(r,scope)).length,200,'other countries cannot consume KR reserve');
 assert.equal(Reserve.reserveCapacity('beauty_personal_care'),200,'100 front to 200 private pool');
 assert.equal(Reserve.reserveCapacity('travel_local_services'),400,'200 front to 400 private pool');
 let verdict=Reserve.decision(active,incoming('beauty_personal_care',40));assert.equal(verdict.action,'defer','low score cannot overfill');
 verdict=Reserve.decision(active,incoming('beauty_personal_care',200));assert.equal(verdict.action,'replace','strong new item can replace lower unplaced');
 assert.ok(!Reserve.protectedRow(active.find(r=>r.id===verdict.replacementId)),'no public/manual candidate can be replaced');
 assert.equal(Reserve.decision(active.slice(0,199),incoming('beauty_personal_care',10)).action,'admit');
 assert.equal(Reserve.decision(active.filter(r=>Reserve.protectedRow(r)),incoming('beauty_personal_care',999)).action,'admit','protected candidates count toward cap but are immutable');
 const allLocked=Array.from({length:205},(_,i)=>row('LOCK-'+i,'KR','beauty_personal_care',4,{locked:true}));
 assert.equal(Reserve.decision(allLocked,incoming('beauty_personal_care',999)).action,'defer','full protected pool is untouchable');
 const sources=[...Array.from({length:5},(_,i)=>({supplierName:'Beauty'+i,supplyLane:'beauty_focus',affiliatePriority:0})),...Array.from({length:3},(_,i)=>({supplierName:'Furniture'+i,supplyLane:'home_appliances_living',affiliatePriority:0})),{supplierName:'Travel',supplyLane:'travel_local_services',affiliatePriority:0}];
 const ordered=Reserve.interleaveSuppliers(sources);
 assert.equal(ordered.length,9);
 assert.equal(new Set(ordered.slice(0,3).map(x=>Reserve.interleaveSuppliers([x])[0].supplyLane)).size,3,'early suppliers represent all present categories');
 assert.equal(new Set(ordered.map(x=>x.supplierName)).size,9);
 console.log('PASS market-safe reserve 100→200, 200→400, rank replacement, manual lock, category fairness');
}
function testQuality(){
 const base={productName:'Luxury 50 ml serum',productUrl:'https://store.example.com/products/serum-50ml',imageUrl:'https://store.example.com/images/serum.jpg',supplierName:'Store',productPageLive:true,inspectionComplete:true,offerPresent:true,price:'35.00',productDetailProof:true};
 assert.equal(Detail.evaluate(base).accepted,true);
 assert.equal(Detail.evaluate({...base,productName:'회사 소개',offerPresent:false,price:'',productDetailProof:false}).accepted,false);
 assert.equal(Detail.evaluate({...base,imageUrl:'',offerPresent:true}).accepted,false);
 assert.equal(Detail.evaluate({...base,productName:'Shop home page'}).accepted,false);
 assert.equal(Detail.evaluate({...base,price:'',offerPresent:false,productDetailProof:false,imageSource:'open_graph_detail'}).accepted,false,'OG site banner without item evidence rejected');
 assert.equal(Detail.evaluate({...base,inspectionComplete:false}).accepted,false,'uninspected product is not an auto candidate');
 assert.match(inspector,/promotionalPreviewOnly/);assert.match(inspector,/productDetailProof:independentDetailProof/);
 assert.match(source,/ProductDetailQuality\.evaluate\(productInput\)/);
 console.log('PASS individual-product quality and generic promotional-page exclusions');
}
async function testCountryQueries(){
 const begin=source.indexOf('async function readResearchReserveRows(scope){');
 const end=source.indexOf('async function archiveReplacedPrivateResearchCandidate',begin);
 assert.ok(begin>0&&end>begin);
 const all=[...Array.from({length:250},(_,i)=>row('KR-main-'+i,'KR','beauty_personal_care',40)),...Array.from({length:55},(_,i)=>({...row('KR-legacy-'+i,'KR','fashion',30),source_payload:{countrySupply:{country:'KR',region:'NATIONWIDE'},productRanking:{category:'fashion',score:30}}})),...Array.from({length:500},(_,i)=>row('ZZ-other-'+i,'US','fashion',90))];
 let requests=0,globalScans=0;
 const store={select:async(_table,q)=>{
   requests++;
   let selector=q.match(/(?:source_payload->marketScope->>marketCountry|source_payload->countrySupply->>country|source_payload->countrySupply->>countryCode|source_payload->approvedPlacement->>country|source_payload->primaryPlacement->>country|source_payload->placement->>country|source_payload->>countryCode)=eq\.([^&]+)/);
   if(!selector){globalScans++;throw new Error('unspecific global scan');}
   const p=decodeURIComponent(selector[1]),offset=Number((q.match(/&offset=(\d+)/)||[])[1]||0),limit=Number((q.match(/&limit=(\d+)/)||[])[1]||250);
   const key=selector[0].slice(0,selector[0].indexOf('=eq.'));
   const rows=all.filter(r=>{
      const payload=r.source_payload,field=key.split('->').slice(1).map(s=>s.replace(/^>/,'')).filter(Boolean);
      let value=payload;for(const k of field){if(value===undefined||value===null)return false;value=value[k];}return String(value||'')===p;
   });return rows.slice(offset,offset+limit);
 }};
 const ctx={SlotStore:store,ProductReserve:Reserve,PRODUCT_SOURCE_REF:'country-product-ranking-review',encodeURIComponent,text:v=>String(v==null?'':v).trim(),array:v=>Array.isArray(v)?v:[],Map,Array};
 vm.createContext(ctx);vm.runInContext(source.slice(begin,end)+'\nthis.run=readResearchReserveRows;',ctx);
 const loaded=await ctx.run({country:'KR',region:'NATIONWIDE'});
 assert.equal(loaded.length,305,'new and legacy market records retained without other countries');
 assert.equal(globalScans,0,'never scan worldwide products to decide one country reserve');
 assert.ok(requests>=7);
 console.log('PASS 249-country-compatible server-scoped reserve query', {loaded:loaded.length,requests});
}
function testStartToFrontContracts(){
 const registry=require('../netlify/functions/lib/commerce-country-automation.v1').registry();
 assert.equal(registry.countries.length,249);assert.ok(!registry.countries.some(c=>c.code==='KP'));
 assert.equal(MarketScope.normalizeCountry('gb'),'GB');assert.equal(MarketScope.normalizeRegion('US-CA','US'),'CA');
 assert.match(geo,/context\.geo/);assert.match(runner,/product_front_match/);assert.match(runner,/product_front_finalize/);
 for(const txt of ['function refreshCandidateLedgerProducts','function runProductFrontSync','function stageCurrentResearchQueue','function applyProductExclusionBulk'])assert.ok(admin.includes(txt),txt);
 assert.match(source,/readResearchReserveRows\(scope\)/);assert.match(source,/archiveReplacedPrivateResearchCandidate/);assert.match(source,/MARKET_RESERVE_LEDGER_INCOMPLETE/);
 assert.match(source,/RESERVE_REPLACEMENT_ROLLBACK_UNCONFIRMED/);assert.match(source,/heldCandidateMatchesScope\(r,scope\)/);
 assert.ok(fs.existsSync(path.join(root,'scripts/build-regional-brokerage-snapshots.js')));
 assert.ok(fs.existsSync(path.join(root,'scripts/verify-admin-searchbank-handoff.js')));
 console.log('PASS 249-country geo registration, scoped staging, PSOM/front publish/build script linkage');
}
(async()=>{testReserve();testQuality();await testCountryQueries();testStartToFrontContracts();console.log('PASS global reserve/quality/country contract suite');})().catch(e=>{console.error(e);process.exitCode=1;});
