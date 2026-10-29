'use strict';
// Isolated run of the actual maintenance-replacement function: no network/DB.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../netlify/functions/lib/commerce-country-automation.v1.js'),'utf8');
const start=source.indexOf('async function applyMaintenanceReplacement('),end=source.indexOf('async function retryMaintenanceBuild(',start);
assert.ok(start>0&&end>start,'maintenance function must remain present');
const routine=source.slice(start,end);
const originalUrl='https://merchant.example.com/product/old',replacementUrl='https://merchant.example.com/product/new';
const row={id:'cand-1',title:'Old',official_url:originalUrl,thumbnail_url:'https://merchant.example.com/old.jpg',status:'approval_pending',updated_at:'2026-10-29T00:00:00.000Z',source_payload:{supplier:{officialUrl:'https://merchant.example.com/',manualSupplierId:'vendor-1'},productUrl:originalUrl}};
const assignment={id:'asn-1',candidate_id:'cand-1',hub_key:'home',slot_key:'home-1',country_code:'KR',region_code:'NATIONWIDE',state:'approved',publication_status:'published',updated_at:'2026-10-29T00:00:00.000Z'};
function helpers(options={}){
 const writes=[],producer={candidateId:'cand-1',assignmentId:'asn-1',country:'KR',region:'NATIONWIDE',page:'home',sectionKey:'home-1',previousProductUrl:originalUrl,replacementProductUrl:replacementUrl,title:'New',image:'https://merchant.example.com/new.jpg',supplierSiteUrl:options.replacementSeller||'https://merchant.example.com/'};
 let assignmentResult=options.assignmentConflict?[]:[{id:'asn-1'}];
 const hostKey=v=>{try{return new URL(v).hostname.toLowerCase().replace(/^www\./,'')}catch{return''}};
 const r={
   console,URL,Set,Date,encodeURIComponent,MAINTENANCE_QUEUE_SCHEMA:'maintenance-test',
   text:v=>String(v==null?'':v).trim(),lower:v=>String(v==null?'':v).trim().toLowerCase(),
   plain:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},array:v=>Array.isArray(v)?v:[],
   first:(...v)=>v.find(x=>x!=null&&String(x).trim())||'',iso:()=> '2026-10-29T03:00:00.000Z',
   safeUrl:v=>v,normalizeCountry:v=>v,normalizeRegion:v=>v||'NATIONWIDE',
   maintenanceAssignment:async()=>({...assignment}),maintenanceAssignmentStillOwnsSlot:()=>true,
   frontSyncSelectCandidates:async()=>[{...row,updated_at:options.noRevision?"":row.updated_at}],
   candidateRuntimeProduct:()=>({productUrl:originalUrl,supplierSiteUrl:'https://merchant.example.com/'}),
   productUrl:p=>p.productUrl||p.url,productImageUrl:p=>p.imageUrl||producer.image,
   ProductRanking:{canonicalProductUrl:v=>v,productIdentity:()=> 'new-sku'},
   RegionalSelector:{inspectProductResearchStep:async(items)=>({items:[{productUrl:items[0].productUrl,productName:'New',imageUrl:producer.image,supplierSiteUrl:producer.supplierSiteUrl,price:'10',priceCurrency:'USD',availability:'available',researchStatus:'ready'}]})},
   candidateRuntimeHealth:p=>p.productUrl===originalUrl?{dead:true,live:false,inconclusive:false,reasons:['unavailable']}:{live:true},
   manualSupplierRegistry:async()=>({suppliers:[{id:'vendor-1',officialUrl:'https://www.merchant.example.com/',adminPinned:true,state:'active'}]}),
   supplierRootUrl:v=>{try{return new URL('/',v).toString()}catch{return''}},
   activePinnedManualSupplier:(registry,ref)=>registry.suppliers.find(x=>x.adminPinned&&(x.id===ref.manualSupplierId||hostKey(x.officialUrl)===hostKey(ref.officialUrl))),
   sameSupplierSite:(a,b)=>hostKey(a)===hostKey(b),
   replacementProductExclusions:async()=>({urls:new Set(),identities:new Set()}),
   replacementProductAlreadyInLedger:async()=>({duplicate:false}),
   candidateRuntimeCard:()=>({}),frontAuthorityEnvelopeNote:()=> 'validated-note',
   writeCandidateAtObservedRevision:async(_id,observed,patch)=>{
      writes.push({target:'candidate',observed,patch});
      if(options.candidateConflict)throw Object.assign(new Error('candidate_revision_conflict_retry_from_ledger'),{statusCode:409});
      return [{id:'cand-1'}];
   },
   SlotStore:{update:async(table,query,patch)=>{
      writes.push({target:table,query,patch});
      if(table==='gslot_slot_assignments')return assignmentResult;
      return [{id:'cand-1'}];
   }}
 };
 vm.createContext(r);vm.runInContext(routine+'\nthis.apply=applyMaintenanceReplacement;',r);
 return {apply:()=>r.apply('scheduled-product-maintenance',producer),writes};
}
(async()=>{
 let h=helpers({replacementSeller:'https://unrelated.example.com/'});
 let out=await h.apply();assert.equal(out.ok,false);assert.equal(out.reason,'administrator_supplier_cross_seller_replacement_requires_review');assert.equal(h.writes.length,0);
 console.log('PASS protected supplier cross-seller proposal stays in administrator review');
 h=helpers({noRevision:true});out=await h.apply();assert.equal(out.reason,'maintenance_revision_unavailable_requires_review');assert.equal(h.writes.length,0);
 console.log('PASS missing revision requires administrator review without write');
 h=helpers({candidateConflict:true});await assert.rejects(h.apply(),/candidate_revision_conflict_retry_from_ledger/);assert.equal(h.writes.filter(x=>x.target==='gslot_slot_assignments').length,0);
 console.log('PASS stale maintenance cannot overwrite newer administrator candidate');
 h=helpers({assignmentConflict:true});await assert.rejects(h.apply(),/maintenance_assignment_revision_conflict_requires_review/);
 assert.equal(h.writes.some(x=>x.target==='gslot_candidates'&&x.query.includes('updated_at=eq.')),true,'rollback conditional on maintenance revision');
 console.log('PASS concurrent assignment decision aborts and conditional rollback is used');
 h=helpers();out=await h.apply();assert.equal(out.ok,true);assert.equal(h.writes.some(x=>x.target==='gslot_slot_assignments'&&x.query.includes('updated_at=eq.')),true);
 console.log('PASS same supplier product repair can be applied with verified candidate/assignment revisions');
})().catch(e=>{console.error(e);process.exitCode=1});
