'use strict';
// Tests the exact shipped browser batch-transfer function in isolation.
const fs=require('fs'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../assets/js/admin-commerce-country-control.js'),'utf8');
function extract(begin,end){const a=source.indexOf(begin),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const body=extract('  async function authorityCandidateAction(decision,candidateIds,placementKey,options){','  async function authorityAiPlacements(');
const make=(api,scope)=>new Function('api','scopeKey','text','transientResearchRequestError','selectedCountry','selectedSubdivision','ADMIN_AUTHORITY',body+';return authorityCandidateAction;')(
 api,()=>scope.value,x=>x==null?'':String(x).trim(),err=>[408,429,500,502,503,504].includes(err&&err.status),'KR','NATIONWIDE','/.netlify/functions/commerce-candidate-admin-authority');
function response(ids){return{ok:true,processed:ids.length,processedIds:ids,results:ids.map(candidateId=>({candidateId,ledgerVerified:true,ok:true})),failures:[]};}
function error(status,payload){const e=Object.assign(new Error('HTTP '+status),{status,payload});return e;}
(async()=>{
  // Partial error: 3 committed, 1 legally blocked, 1 uncertain. The uncertain
  // candidate alone is retried; all five other batches continue afterwards.
  let requests=[],scope={value:'KR|NATIONWIDE'};
  const api=async(_e,_a,_m,_p,body)=>{
    requests.push(body.candidateIds.slice());
    const ids=body.candidateIds;
    if(ids.length>1&&ids.includes('A'))throw error(200,{processedIds:['A','B','C'],results:[],failures:[{candidateId:'D',error:'published_protected'}]});
    return response(ids);
  };
  let progress=[];
  const run=make(api,scope),ids=['A','B','C','D','E','F','G','H','I','J'];
  const r=await run('slot_candidate',ids,'home|home_2',{chunkSize:5,onProgress:(...p)=>progress.push(p)});
  assert.equal(r.processed,9);assert.equal(r.failed,1);assert.equal(r.failures[0].candidateId,'D');
  assert(r.processedIds.includes('E')&&r.processedIds.includes('J'));
  assert(requests.some(x=>x.length===1&&x[0]==='E'));
  assert.equal(requests.filter(x=>x.includes('D')).length,1);assert.equal(progress.length,2);
  // A failed network invocation must never cause the entire selection to vanish.
  scope={value:'KR|NATIONWIDE'};requests=[];
  const fallback=make(async(_e,_a,_m,_p,body)=>{requests.push(body.candidateIds.slice());if(body.candidateIds.length>1)throw error(504);return response(body.candidateIds);},scope);
  const f=await fallback('undecided',Array.from({length:100},(_,i)=>'C'+i),'',{chunkSize:5});
  assert.equal(f.processed,100);assert.equal(f.failed,0);assert.equal(new Set(f.processedIds).size,100);assert.equal(requests.filter(x=>x.length===5).length,20);
  // Changing the selected country may not redirect remaining IDs silently.
  scope={value:'KR|NATIONWIDE'};let calls=0;
  const safe=make(async(_e,_a,_m,_p,body)=>{calls++;scope.value='US|NATIONWIDE';return response(body.candidateIds);},scope);
  const q=await safe('undecided',['a','b','c','d','e','f'],'',{chunkSize:3});
  assert.equal(calls,1);assert.equal(q.processed,3);assert.equal(q.failed,3);
  // Local PSOM preview must replace an earlier section relation, not append it.
  const local=extract('  function applyPsomPlacementResultsLocally(results){','  async function aiPlaceCandidateIds(');
  const row={id:'Q',sectionAssignments:[{page:'home',sectionKey:'home_1',country:'KR',region:'NATIONWIDE'}]};
  const fn=new Function('text','PRODUCT_SECTION_MAP','productById','selectedCountry','selectedSubdivision','sectionKeyOf','renderProducts','productRows','productPlacementSelections',local+';return applyPsomPlacementResultsLocally;')(
    x=>x==null?'':String(x),{'home|home_2':{page:'home',section:'home_2'}},()=>row,'KR','NATIONWIDE',v=>v.page+'|'+(v.sectionKey||v.section),()=>{},[row],{});
  assert.equal(fn([{assigned:true,candidateId:'Q',sectionKey:'home|home_2'}]),1);
  assert.equal(row.sectionAssignments.length,1);assert.equal(row.sectionAssignments[0].sectionKey,'home_2');
  console.log('PASS partial success, blocked single, timeout recovery 100, scope freeze, local section removal');
})().catch(e=>{console.error(e);process.exitCode=1;});
// Standalone PSOM integration exercise: 100 selections / partial 409 with
// committed IDs / one explicitly blocked item / destination readback.
(async()=>{
  const segment=extract('  async function aiPlaceCandidateIds(candidateIds,options){','  // Two-phase AI rank comparison:');
  const state={value:'KR|NATIONWIDE'},rows={},calls=[];
  const ids=Array.from({length:100},(_,i)=>'P'+i);
  const makePsom=(fn)=>new Function('api','scopeKey','text','selectedCountry','selectedSubdivision','PRODUCT_SECTION_MAP','productSectionCounts','applyPsomPlacementResultsLocally','refreshCandidateLedgerProducts','productById','productDecision','assignedSectionKey','transientResearchRequestError','CONTROL',segment+';return aiPlaceCandidateIds;')(
   fn,()=>state.value,x=>x==null?'':String(x).trim(),'KR','NATIONWIDE',{'home|home_2':{}},()=>({}),
   ()=>{throw new Error('PSOM must not optimistically move cards');},
   async()=>{ids.filter(id=>id!=='P7').forEach(id=>{rows[id]={slotDecision:'slot_candidate',sectionKey:'home|home_2'};});return{pipeline:{ledgerLoadComplete:true}};},id=>rows[id]||null,row=>row.slotDecision,row=>row.sectionKey,()=>false,'/control');
  const service=async(_e,_a,_m,_p,body)=>{
    const chunk=body.candidateIds;calls.push(chunk.slice());
    const makeRows=keys=>keys.map(candidateId=>({candidateId,assigned:candidateId!=='P7',sectionKey:'home|home_2',error:candidateId==='P7'?'not_verified':undefined}));
    const results=makeRows(chunk.filter(x=>x!=='P8'));
    if(chunk.includes('P8')&&chunk.length>1)throw error(200,{results,balanceCounts:{}});
    return {ok:true,results:makeRows(chunk)};
  };
  const run=makePsom(service);let last;
  const result=await run(ids,{onProgress:(...x)=>{last=x;}});
  assert.equal(result.processed,99);assert.equal(result.failed,1);assert(!result.processedIds.includes('P7'));
  assert(result.processedIds.includes('P8'));assert(calls.some(chunk=>chunk.length===1&&chunk[0]==='P8'));
  assert.equal(last[2],100);
  console.log('PASS PSOM 100 rows, partial exception, one blocked, exact destination readback');
})().catch(e=>{console.error(e);process.exitCode=1;});
(async()=>{
  const segment=extract('  async function aiPlaceCandidateIds(candidateIds,options){','  // Two-phase AI rank comparison:');
  let prematurelyMoved=0;
  const fn=new Function('api','scopeKey','text','selectedCountry','selectedSubdivision','PRODUCT_SECTION_MAP','productSectionCounts','applyPsomPlacementResultsLocally','refreshCandidateLedgerProducts','productById','productDecision','assignedSectionKey','transientResearchRequestError','CONTROL',segment+';return aiPlaceCandidateIds;')(
    async(_e,_a,_m,_p,body)=>({ok:true,results:body.candidateIds.map(candidateId=>({candidateId,sectionKey:'home|home_2',assigned:true}))}),
    ()=> 'KR|NATIONWIDE',x=>String(x||''),'KR','NATIONWIDE',{'home|home_2':{}},()=>({}),()=>{prematurelyMoved++;},async()=>{throw new Error('ledger_unavailable');},()=>null,()=>'',()=>'',()=>false,'/control');
  const result=await fn(['C1','C2']);
  assert.equal(result.processed,0);assert.equal(result.failed,2);assert.equal(prematurelyMoved,0);
  console.log('PASS no optimistic UI move when durable readback fails');
})().catch(e=>{console.error(e);process.exitCode=1;});
