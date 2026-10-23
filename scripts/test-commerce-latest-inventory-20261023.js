'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'assets/js/admin-commerce-country-control.js'),'utf8');
const html=fs.readFileSync(path.join(root,'commerce-country-control.html'),'utf8');
const queue=fs.readFileSync(path.join(root,'netlify/functions/commerce-candidate-queue-control.js'),'utf8');
const server=fs.readFileSync(path.join(root,'netlify/functions/lib/commerce-country-automation.v1.js'),'utf8');
const begin=js.indexOf('  function latestOverviewRows(){');
const end=js.indexOf('  function wireLatestOverview(){',begin);
assert.ok(begin>0 && end>begin,'missing actual overview status function');
const helper=js.slice(begin,end);
const ctx={latestOverviewChosenCandidates:{},productRows:[],latestProductRows:[],latestProductKey:r=>r.id,frontCandidateLedgerId:r=>r.candidateId||r.id,productDecision:r=>r.slotDecision||'undecided',frontPublicationActive:r=>['matched','published','active','queued','publish_requested','unpublish_requested'].includes(r.frontPublication?.status)||r.frontPublication?.publicSnapshotConfirmed===true,assignedSectionKey:r=>r.approvedPlacement?.sectionKey||'',sectionLabel:s=>s,productUrlMatchKey:v=>{try{let u=new URL(v);u.hash='';u.hostname=u.hostname.toLowerCase();u.pathname=u.pathname.replace(/\/+$/,'');return u.toString()}catch(e){return v||''}},text:v=>String(v??'').trim()};
vm.runInNewContext(helper,ctx);assert.equal(typeof ctx.latestOverviewRows,'function');
function row(id,url,status,publication){return{id,candidateId:id,ledgerSource:'candidate',productUrl:url,slotDecision:status,approvedPlacement:status==='slot_candidate'?{sectionKey:'home_1'}:null,frontPublication:{status:publication||'unmatched'}}}
ctx.productRows=[row('p','https://shop.test/goods/1','slot_candidate'),row('u','https://shop.test/goods/2','undecided'),row('x','https://shop.test/goods/3','purge'),row('live','https://shop.test/goods/4','slot_candidate','published')];
ctx.latestProductRows=[{id:'1',productUrl:'https://shop.test/goods/1'},{id:'2',productUrl:'https://shop.test/goods/2'},{id:'3',productUrl:'https://shop.test/goods/3'},{id:'4',productUrl:'https://shop.test/goods/4'},{id:'5',productUrl:'https://shop.test/goods/5'}];
let result=ctx.latestOverviewRows();assert.equal(result.length,5);assert.equal(result[0].kind,'slot_candidate');assert.equal(result[1].kind,'undecided');assert.equal(result[2].kind,'purge');assert.equal(result[3].protected,true);assert.equal(result[4].kind,'new');
ctx.productRows.push(row('duplicate','https://shop.test/goods/2','hold'));result=ctx.latestOverviewRows();assert.equal(result[1].kind,'duplicate');assert.equal(result[1].candidate,null);ctx.latestOverviewChosenCandidates['2']='u';result=ctx.latestOverviewRows();assert.equal(result[1].candidateId,'u');assert.equal(result[1].kind,'undecided');
for(let t of ['latestResearchOverview','latestOverviewRows','latestOverviewFilter','latestOverviewSearch','latestOverviewReload','latestOverviewOperationStatus'])assert.ok(html.includes('id="'+t+'"'),t);
for(let t of ['runLatestOverviewAction','candidateIds:[item.candidateId]','latestOverviewRows()','renderLatestResearchOverview()','latestOverviewLedgerComplete'])assert.ok(js.includes(t),t);
assert.ok(queue.includes('if(livePublication){'),'published restore must not bypass protected publication');
assert.ok(server.includes('permanent.delete(identity); researchExcluded.delete(identity); deleted.add(identity);'),'dismiss must release old permanent block');
console.log('PASS actual overview JS: linked statuses, new items, duplicate protection, public protection, controls, safe server actions');

// Optional read-only verification against an administrator-exported compact JSON.
if(process.argv[2]){
 const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 assert.equal(fixture.scope.country,'KR');
 assert.equal(fixture.scope.region,'NATIONWIDE');
 ctx.productRows=fixture.products;ctx.latestProductRows=fixture.latestProducts;ctx.latestOverviewChosenCandidates={};
 const items=ctx.latestOverviewRows(),numbers={};items.forEach(row=>{numbers[row.kind]=(numbers[row.kind]||0)+1});
 assert.equal(items.length,268,'expected retained latest records from supplied 2026-10-23 export');
 assert.equal(numbers.slot_candidate,192);assert.equal(numbers.undecided,50);assert.equal(numbers.new,3);
 assert.equal(numbers.duplicate,7);assert.equal(numbers.purge,16);
 const matches=items.filter(row=>row.duplicateCount>0);assert.equal(matches.length,265);
 console.log('PASS read-only KR export 268='+JSON.stringify(numbers)+'; matched candidates 265; manual ID selection required for 7 duplicates');
}
