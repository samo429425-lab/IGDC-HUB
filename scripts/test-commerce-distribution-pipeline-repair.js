"use strict";
/* Offline integrity suite: no Supabase, Netlify, GitHub or published data touched. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function mocksLoaded(rel,mocks){
  const filename=path.join(root,rel),loader=Module._load;
  Module._load=function(request,parent,isMain){return Object.prototype.hasOwnProperty.call(mocks,request)?mocks[request]:loader.apply(this,arguments)};
  delete require.cache[require.resolve(filename)];
  try{return require(filename);}finally{Module._load=loader;}
}
function product(id,scope,legacy){
 const payload=legacy?{countrySupply:{country:scope,region:'NATIONWIDE'},slotDecision:'undecided'}:{marketScope:{marketCountry:scope,marketRegion:'NATIONWIDE'},slotDecision:'undecided'};
 return {id,kind:'product',title:id,status:'approval_pending',official_url:'https://seller.example.com/products/'+id,source_ref:'country-product-ranking-review',source_payload:payload,updated_at:'2026-10-22T00:00:00Z'};
}
async function testScopedLedger(){
 const records=[...Array.from({length:190},(_,i)=>product('modern_'+i,'KR',false)),...Array.from({length:84},(_,i)=>product('legacy_'+i,'KR',true)),...Array.from({length:130},(_,i)=>product('other_'+i,'US',false)),...Array.from({length:3},(_,i)=>({...product('placement_'+i,'KR',false),source_payload:{primaryPlacement:{page:'distribution',section:'distribution-new',country:'KR',region:'NATIONWIDE'},slotDecision:'slot_candidate'}}))];
 // Mixed ordering means an old-format record must not vanish when the first
 // direct marketScope page is nonempty; raw cursors must not skip records.
 const store={
  rest:(table,query)=>'/rest/v1/'+table+'?'+query,
  request:async(url)=>{
   const u=new URL('https://local.invalid'+url),p=u.searchParams;
   assert.equal(u.pathname,'/rest/v1/gslot_candidates');
   assert.equal(p.get('source_ref'),'eq.country-product-ranking-review');
   return records.slice(Number(p.get('offset')||0),Number(p.get('offset')||0)+Number(p.get('limit')||0));
  },select:async()=>[]
 };
 const {handler}=mocksLoaded('netlify/functions/commerce-candidate-management-ledger.js',{
   './lib/global-slot-console-auth':{resolveUser:async()=>({roles:['owner']})},
   './lib/global-slot-console-supabase':store
 });
 let offset=0,collected=[],calls=0,sawEmptyContinuation=false;
 do{
  const result=await handler({httpMethod:'GET',queryStringParameters:{country:'KR',region:'NATIONWIDE',limit:'75',offset:String(offset)}});
  assert.equal(result.statusCode,200,result.body);
  const parsed=JSON.parse(result.body);collected.push(...parsed.candidates.map(x=>x.candidateId));calls++;
  if(!parsed.candidates.length&&parsed.pagination.hasMore)sawEmptyContinuation=true;
  if(!parsed.pagination.hasMore)break;
  assert.ok(parsed.pagination.nextOffset>offset,'cursor strictly increases');offset=parsed.pagination.nextOffset;
  assert.ok(calls<20,'bounded completion');
 }while(true);
 assert.equal(new Set(collected).size,277,'no duplicate IDs');
 assert.equal(collected.length,277,'both schemas and no other country');
 assert.equal(collected.filter(x=>x.startsWith('legacy_')).length,84,'all historical legacy IDs included');
 console.log('PASS mixed-schema candidate ledger pagination', {pages:calls,total:collected.length,sawEmptyContinuation});
}
async function testExclusionCleanup(){
 const row={id:'hold_candidate_1',kind:'product',source_ref:'country-product-ranking-review',status:'hold',source_payload:{slotDecision:'hold',queueControl:{action:'hold'},review:{state:'hold'},marketScope:{marketCountry:'KR',marketRegion:'NATIONWIDE'}}};
 const rows=new Map([[row.id,row]]),assignments=new Map([[row.id,[{id:'old_assignment',candidate_id:row.id,publication_status:'not_ready'}]]]);
 const store={
  select:async(table,query)=>{
   if(table==='gslot_candidates'){const id=decodeURIComponent((query.match(/id=eq\.([^&]+)/)||[])[1]||'');return rows.has(id)?[rows.get(id)]:[];}
   if(table==='gslot_slot_assignments'){const id=decodeURIComponent((query.match(/candidate_id=eq\.([^&]+)/)||[])[1]||'');return assignments.get(id)||[];}
   throw Error(table);
  },
  remove:async(table,query)=>{
   assert.equal(table,'gslot_slot_assignments');const id=decodeURIComponent((query.match(/candidate_id=eq\.([^&]+)/)||[])[1]||'');const prev=assignments.get(id)||[];assignments.set(id,[]);return prev;
  },
  update:async(table,query,patch)=>{
   assert.equal(table,'gslot_candidates');const id=decodeURIComponent((query.match(/id=eq\.([^&]+)/)||[])[1]||'');Object.assign(rows.get(id),patch);return [rows.get(id)];
  }
 };
 const handler=mocksLoaded('netlify/functions/commerce-candidate-queue-control.js',{
  './lib/global-slot-console-auth':{resolveUser:async()=>({roles:['owner'],sub:'test-operator'})},
  './lib/global-slot-console-supabase':store,
  './lib/commerce-country-automation.v1':{syncCandidateManagementResearchVisibilityByInput:async()=>({ok:true})}
 }).handler;
 const request=(id)=>({httpMethod:'POST',body:JSON.stringify({decision:'dismiss',expectedBucket:'hold',candidateIds:[id],countryCode:'KR',subdivisionCode:'NATIONWIDE'})});
 const response=await handler(request(row.id));assert.equal(response.statusCode,200,response.body);
 assert.equal(rows.get(row.id).status,'removed');assert.equal(assignments.get(row.id).length,0);
 const active={id:'hold_candidate_2',kind:'product',source_ref:row.source_ref,status:'hold',source_payload:{slotDecision:'hold',queueControl:{action:'hold'},review:{state:'hold'},frontPublication:{status:'published'}}};
 rows.set(active.id,active);assignments.set(active.id,[{id:'live',publication_status:'publish_requested'}]);
 const forbidden=await handler(request(active.id));assert.equal(forbidden.statusCode,409,'live publication remains protected');
 assert.equal(active.status,'hold');assert.equal(assignments.get(active.id).length,1);
 console.log('PASS inactive assignment delete and live publication protection');
}
async function testResearchRawPagination(){
 const source=fs.readFileSync(path.join(root,'netlify/functions/lib/commerce-country-automation.v1.js'),'utf8');
 const start=source.indexOf('async function fastProductResearchStatus('),end=source.indexOf('\nfunction productResearchStepResponse',start);
 assert.ok(start>0&&end>start);
 const records=Array.from({length:57},(_,i)=>({id:'product_'+i}));
 const context={plain:v=>v&&typeof v==='object'?v:{},array:v=>Array.isArray(v)?v:[],text:v=>v==null?'':String(v).trim(),ProductRanking:{productIdentity:r=>r.id},compactProductResearchStep:job=>({summary:{},resultStorage:job.resultStorage}),readProductChunkRange:async(_job,_kind,offset,limit)=>records.slice(offset,offset+limit),PRODUCT_STATUS_PAGE_LIMIT:200,VERSION:'test'};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.run=fastProductResearchStatus;',context);
 const deleted=['product_4','product_25','product_56','previous_cycle_product'];
 const results=[],job={resultStorage:'chunked_v1',resultCount:records.length},expected=records.length-3;
 let next=0;
 for(let pages=0;pages<10;pages++){
  const res=await context.run(job,{fast:'latest:'+next+':25',__deletedLatestIdentities:deleted});
  results.push(...res.latestProducts.map(r=>r.id));
  assert.equal(res.pagination.rawTotal,57);
  if(!res.pagination.hasMore){assert.equal(res.pagination.nextOffset,null);break;}
  assert.ok(res.pagination.nextOffset>next);next=res.pagination.nextOffset;
 }
 assert.equal(results.length,expected,'stale deleted identities do not suppress unrelated current rows');
 assert.equal(new Set(results).size,expected,'pages are non-overlapping');
 assert.ok(!results.includes('product_4')&&!results.includes('product_25')&&!results.includes('product_56'));
 console.log('PASS deleted research history raw-cursor traversal',{visible:results.length,raw:records.length});
}
function testStaticGuards(){
 const auto=fs.readFileSync(path.join(root,'netlify/functions/lib/commerce-country-automation.v1.js'),'utf8');
 const front=fs.readFileSync(path.join(root,'assets/js/admin-commerce-country-control.js'),'utf8');
 const diagnostic=fs.readFileSync(path.join(root,'assets/js/admin-commerce-candidate-pipeline.js'),'utf8');
 assert.match(auto,/const PRODUCT_PORTFOLIO_LIMIT = 20000;/);
 assert.doesNotMatch(auto,/counts\[lockedKey\]\s*=\s*Number\(counts\[lockedKey\]/);
 assert.match(auto,/product_media_or_title_incomplete/);
 assert.match(front,/currentLedger\.pipeline\.ledgerLoadComplete!==true/);
 assert.match(front,/Math\.min\(250,Number\(options\.maxPages\|\|250\)\)/);
 assert.match(diagnostic,/diagnosticCache=await api\('diagnostic'\)/);
 console.log('PASS Psom preservation, real media gate, bounded research history and front readback');
}
(async()=>{await testScopedLedger();await testExclusionCleanup();await testResearchRawPagination();testStaticGuards();console.log('PASS distribution pipeline repair regression suite');})().catch(e=>{console.error(e);process.exitCode=1;});
