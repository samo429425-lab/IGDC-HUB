'use strict';
// No network, no production DB writes. Tests the real backend functions via an
// isolated module instance, with only the persistence adapter replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root=path.resolve(__dirname,'..');
const backendPath=path.join(root,'netlify/functions/lib/commerce-country-automation.v1.js');
const code=fs.readFileSync(backendPath,'utf8');
const unit=new Module(backendPath,module);
unit.filename=backendPath;
unit.paths=Module._nodeModulePaths(path.dirname(backendPath));
unit._compile(code+'\nmodule.exports.__globalStateTest={unmatchPrivateResearchRows, syncProductCandidateQueue, productCandidateId, syncProductResearchPreview};\n',backendPath);
const t=unit.exports.__globalStateTest;
const store=require(path.join(root,'netlify/functions/lib/global-slot-console-supabase.js'));
const rank=require(path.join(root,'netlify/functions/lib/commerce-product-ranking.v1.js'));
const scope={country:'KR',region:'NATIONWIDE'};
const product={id:'test-product-1',productName:'Test Device Model 120',productUrl:'https://shop.example.com/products/test-device-120',imageUrl:'https://shop.example.com/img/device-120.jpg',supplierName:'Example Shop',supplierSiteUrl:'https://shop.example.com',inspectionComplete:true,productPageLive:true,sameSupplierSite:true,offerPresent:true,price:'180',priceCurrency:'USD',riskAssessment:{specificProductUrl:true}};
const id=t.productCandidateId(scope,product);
function durable(){return {id,source_ref:'country-product-ranking-review',status:'approval_pending',updated_at:'2026-10-29T00:00:00.000Z',official_url:product.productUrl,source_payload:{marketScope:{marketCountry:'KR',marketRegion:'NATIONWIDE'},countrySupply:{country:'KR',region:'NATIONWIDE'},slotDecision:'undecided',managementControl:{latestResearchHandoff:{registered:true,completed:true,destination:'unassigned',completedBy:'operator'},contractSupplierId:'contract-vendor'},queueControl:{action:'moved_to_unassigned',hiddenFromCountryQueue:false},review:{state:'unassigned'}}};}
async function withDb(initial,callback){
  let record=structuredClone(initial),updates=[],deletes=[],injectConflict=false;
  const original={select:store.select,update:store.update,remove:store.remove,insert:store.insert};
  store.select=async (table,q)=>{
    if(table==='gslot_candidates')return [structuredClone(record)];
    if(table==='gslot_slot_assignments')return [];
    throw Error('Unknown read: '+table+' '+q);
  };
  store.update=async (table,q,patch)=>{
    assert.equal(table,'gslot_candidates');
    updates.push({q,patch});
    if(injectConflict){record.updated_at='2026-10-29T00:00:01.000Z';injectConflict=false;}
    const previousRevision=(q.match(/(?:^|&)updated_at=eq\.([^&]+)/)||[])[1];
    if(previousRevision && decodeURIComponent(previousRevision)!==record.updated_at)return [];
    Object.assign(record,structuredClone(patch));
    return [structuredClone(record)];
  };
  store.remove=async (table,q)=>{deletes.push({table,q});return []};
  store.insert=async (table,row)=>{throw Error('Existing row must not be inserted again: '+table)};
  try{return await callback({get:()=>record,updates,deletes,conflict:()=>{injectConflict=true;}});}
  finally{Object.assign(store,original)}
}
(async()=>{
  assert.equal(rank.isSpecificProductUrl('https://www.hotelscombined.co.kr/car-rental/daegu.42701.ksp'),false,'city-wide rental search page cannot pass product test');
  assert.equal(rank.isSpecificProductUrl('https://shop.example.com/products/test-device-120'),true,'real product path preserved');
  assert.equal(rank.isSpecificProductUrl('https://shop.example.com/product/detail?product_no=120'),true,'retail query-based SKU path preserved');
  assert.equal(rank.isSpecificProductUrl('https://shop.example.com/login'),false,'login cannot pass');
  console.log('PASS detailed URL classification / HotelsCombined search rejection');
  await withDb(durable(),async db=>{
    const result=await t.unmatchPrivateResearchRows('operator',scope,[product],new Set(),new Set());
    assert.equal(result.removed,0);assert.equal(result.blocked,1);assert.equal(db.deletes.length,0);
  });
  console.log('PASS registered and handed-off candidate survives research unstage');
  await withDb(durable(),async db=>{
    const result=await t.syncProductCandidateQueue('operator',scope,product,'undecided',{administratorExplicit:true});
    assert.equal(result.candidateId,id);
    const mg=db.get().source_payload.managementControl;
    assert.equal(mg.latestResearchHandoff.completed,true);
    assert.equal(mg.latestResearchHandoff.destination,'unassigned');
    assert.equal(mg.contractSupplierId,'contract-vendor');
    assert.equal(db.get().source_payload.queueControl.action,'moved_to_unassigned');
    assert.equal(db.deletes.length,0);
  });
  console.log('PASS research requeue preserves permanent handoff and supplier provenance');
  await withDb(durable(),async db=>{
    const result=await t.syncProductCandidateQueue('operator',scope,product,'slot_candidate',{administratorExplicit:true});
    assert.equal(result.candidateId,id);
    assert.equal(db.get().source_payload.managementControl.latestResearchHandoff.completed,true);
    assert.equal(db.get().source_payload.managementControl.contractSupplierId,'contract-vendor');
  });
  console.log('PASS section-choice queue sync preserves prior handoff');
  await withDb(durable(),async db=>{
    db.conflict();
    await assert.rejects(
      t.syncProductCandidateQueue('operator',scope,product,'undecided',{administratorExplicit:true}),
      /candidate_revision_conflict_retry_from_ledger/,
      'stale research request must not overwrite a concurrent operator update'
    );
    assert.equal(db.get().source_payload.managementControl.latestResearchHandoff.destination,'unassigned');
    assert.equal(db.get().source_payload.queueControl.action,'moved_to_unassigned');
  });
  assert.notEqual(t.productCandidateId(scope,product),t.productCandidateId({country:'US',region:'NATIONWIDE'},product));
  assert.notEqual(t.productCandidateId(scope,product),t.productCandidateId({country:'KR',region:'SEOUL'},product));
  console.log('PASS stale-write conflict detection and country/region candidate ID isolation');
  const source=fs.readFileSync(backendPath,'utf8');
  assert.equal((source.match(/payload\.managementControl=\{schema:"igdc-product-management-control\.v1",source:"hold_ai/g)||[]).length,0,'hold AI must not reset durable management state');
  const deployedAuth=fs.readFileSync(path.join(root,'netlify/functions/commerce-candidate-admin-authority.js'),'utf8');
  assert.ok(deployedAuth.includes('const isManualSectionMove='),'previously working admin 20-section movement must remain unchanged');
  console.log('PASS hold state preservation and 20-section manual movement regression guard');
  console.log('PASS global state preservation suite: 4 behavior groups');
})().catch(e=>{console.error(e);process.exitCode=1});
