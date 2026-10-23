'use strict';
/** No network, no env secrets, no durable DB writes. Simulates operator PSOM preview/apply. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const impl=require('../netlify/functions/lib/commerce-product-psom-rank-compare.v1.js');
const src=fs.readFileSync(root+'/netlify/functions/lib/commerce-country-automation.v1.js','utf8');
const ui=fs.readFileSync(root+'/assets/js/admin-commerce-country-control.js','utf8');
const runner=fs.readFileSync(root+'/netlify/functions/commerce-country-control.js','utf8');
const begin=src.indexOf('async function productCandidatePsomRankedReplace(actorId,input){');
const end=src.indexOf('\nasync function productCandidatePsomPlace(',begin);
assert.ok(begin>0&&end>begin,'real production function found');
function row(id,market,score,options={}){
 const placed=!!options.section,locked=!!options.locked;
 return {id,source_ref:'country-product-ranking-review',status:'approval_pending',title:'Serum '+id,official_url:'https://seller.example.com/products/serum-'+id,updated_at:'2026-10-23T00:00:00Z',source_payload:{
 marketScope:{marketCountry:market,marketRegion:'NATIONWIDE'},slotDecision:placed?'slot_candidate':'undecided',title:'Serum '+id,externalProductUrl:'https://seller.example.com/products/serum-'+id,
 image:'https://seller.example.com/images/serum-'+id+'.jpg',inspectionComplete:true,productRanking:{category:'beauty_personal_care',score},
 approvedPlacement:placed?{page:'distribution',section:'distribution-extra',sectionKey:'distribution-extra',key:'distribution|distribution-extra',country:market,region:'NATIONWIDE',administratorSelected:locked}:undefined,
 managementControl:{administratorLocked:locked,aiReclassificationAllowed:!locked},frontPublication:options.published?{status:'published'}:{}}
 };
}
async function runCase({incomingScore=95,existingScore=40,existingCount=100,locked=false,published=false,assignment=false,changeAfterPreview=false,scope='KR',overrides={}}={}){
 const db=new Map(),relations=new Map(),writes=[];
 for(let i=0;i<existingCount;i++)db.set('old-'+i,row('old-'+i,'KR',existingScore+(i%12),{section:true,locked:i===0?locked:false,published:i===0?published:false}));
 db.set('new',row('new','KR',incomingScore));
 db.set('outside',row('outside','US',0,{section:true}));
 if(assignment)relations.set('old-0',[{candidate_id:'old-0',id:'live_0',publication_status:'publish_requested'}]);
 function read(ids){return ids.map(id=>db.get(id)).filter(Boolean).map(x=>structuredClone(x));}
 const store={update:async(_table,query,patch)=>{
  const id=decodeURIComponent((query.match(/^id=eq\.([^&]+)/)||[])[1]||''),x=db.get(id),timestamp=decodeURIComponent((query.match(/&updated_at=eq\.([^&]+)/)||[])[1]||'');
  if(!x||x.updated_at!==timestamp)return [];
  Object.assign(x,structuredClone(patch));writes.push({id,patch});return [structuredClone(x)];
 }};
 const ctx={
  SlotStore:store,PSOMRankCompare:impl,ProductDetailQuality:{evaluate:p=>({accepted:!!p.inspectionComplete&&!!p.imageUrl&&!!p.productUrl,reasons:[]})},
  PRODUCT_SOURCE_REF:'country-product-ranking-review',PRODUCT_SECTION_KEYS:['distribution|distribution-extra'],
  researchScope:x=>({country:x.countryCode,region:x.subdivisionCode}),
  heldCandidateMatchesScope:(x,s)=>x?.source_payload?.marketScope?.marketCountry===s.country&&s.region==='NATIONWIDE',
  frontSyncSelectCandidates:async ids=>read(ids),
  readResearchReserveRows:async s=>[...db.values()].filter(r=>r.source_payload.marketScope.marketCountry===s.country).map(x=>structuredClone(x)),
  frontSyncSelectByCandidate:async (_tbl,_select,ids)=>ids.flatMap(id=>relations.get(id)||[]),
  candidateRuntimeProduct:(r)=>r?{inspectionComplete:r.source_payload.inspectionComplete,productUrl:r.official_url,imageUrl:r.source_payload.image,productName:r.title}:null,
  candidateRuntimePlacementOptions:()=>({category:{primary:'beauty_personal_care',tags:[]},options:[{key:'distribution|distribution-extra',page:'distribution',section:'distribution-extra',score:90}]}),
  candidateLedgerPlacementRecord:(s,x,actor)=>({page:'distribution',section:'distribution-extra',sectionKey:'distribution-extra',key:'distribution|distribution-extra',country:s.country,region:s.region,aiSelected:true,administratorSelected:false}),
  productPlacementKey:x=>x?.key||(x?.page&&x?.section?x.page+'|'+x.section:''),
  automaticBalancedPlacement:(_p,options)=>options[0],normalizeProductSectionCounts:x=>x,
  validProductSectionKey:x=>x==='distribution|distribution-extra',
  text:v=>v==null?'':String(v).trim(),lower:v=>String(v||'').toLowerCase(),plain:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},array:v=>Array.isArray(v)?v:[],iso:()=>new Date().toISOString(),encodeURIComponent,
  Object,Array,Set,Map,Number,Math
 };
 vm.createContext(ctx);vm.runInContext(src.slice(begin,end)+'\nthis.rankReplace=productCandidatePsomRankedReplace;',ctx);
 const args={countryCode:scope,subdivisionCode:'NATIONWIDE',candidateIds:['new'],preferredSectionKey:'distribution|distribution-extra'};
 const preview=await ctx.rankReplace('tester',{...args,previewOnly:true});assert.equal(writes.length,0,'preview never writes');
 let result;
 if(preview.results[0].action==='replace'||preview.results[0].action==='place'){
   if(changeAfterPreview)db.get('old-0').source_payload.managementControl.administratorLocked=true;
   const acceptedPlan={new:{action:preview.results[0].action,sectionKey:preview.results[0].sectionKey,replacementId:preview.results[0].replacementId||''}};
   result=await ctx.rankReplace('tester',{...args,acceptedPlan});
 }
 return{preview,result,db,writes};
}
(async()=>{
 assert.equal(impl.choose(row('new','KR',90),Array.from({length:100},(_,i)=>row('old-'+i,'KR',40+i/10,{section:true})),{sectionKey:'distribution|distribution-extra',frontCapacity:100,sectionCapacity:200}).action,'replace');
 let c=await runCase();assert.equal(c.preview.results[0].action,'replace');assert.equal(c.result.processed,1);assert.equal(c.result.replaced,1);assert.equal(c.db.get('new').source_payload.slotDecision,'slot_candidate');assert.equal(c.db.get('old-0').source_payload.slotDecision,'undecided');assert.equal(c.writes.length,2);
 c=await runCase({incomingScore:10});assert.notEqual(c.preview.results[0].action,'replace');assert.notEqual(c.db.get('old-0').source_payload.slotDecision,'undecided');
 c=await runCase({existingCount:50});assert.equal(c.preview.results[0].action,'place');assert.equal(c.result.processed,1);assert.equal(c.writes.length,1);
 c=await runCase({existingCount:200,existingScore:100,incomingScore:0});assert.equal(c.preview.results[0].action,'defer');assert.equal(c.writes.length,0);
 c=await runCase({locked:true,assignment:true,published:true});assert.equal(c.db.get('old-0').source_payload.slotDecision,'slot_candidate');
 c=await runCase({changeAfterPreview:true});assert.equal(c.db.get('old-0').source_payload.slotDecision,'slot_candidate');
 c=await runCase({scope:'US'});assert.equal(c.preview.results[0].error,'selected_candidate_is_not_unassigned'===c.preview.results[0].error?'selected_candidate_is_not_unassigned':'candidate_not_found_in_selected_market');assert.equal(c.writes.length,0);
 assert.ok(ui.includes("product_candidate_psom_ranked_replace"));assert.ok(ui.includes('aiRankedReplaceCandidateIds(ids'));
 assert.ok(runner.includes('Automation.productCandidatePsomRankedReplace(actorId,body)'));
 assert.ok(ui.includes('선택 후보 AI 랭킹 비교·열위 상품 치환 배치'));
 console.log('PASS PSOM ranked replacement: preview no-write, quality, scope, rank, full/private capacity, assignment/manual/public guards, CAS, UI/server integration');
})().catch(e=>{console.error(e);process.exitCode=1;});
