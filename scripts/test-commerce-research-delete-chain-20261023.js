"use strict";
/** Tests read an isolated in-memory store and do not connect to production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..');
function isolated(rel,mocks){const filename=path.join(root,rel),original=Module._load;Module._load=function(name,p,i){return Object.prototype.hasOwnProperty.call(mocks,name)?mocks[name]:original.apply(this,arguments)};delete require.cache[require.resolve(filename)];try{return require(filename);}finally{Module._load=original;}}
async function testCandidateAfterTransfer(){
 const rows=new Map(),relations=new Map(),store={};
 function make(id,status,decision,publication){rows.set(id,{id,kind:'product',source_ref:'country-product-ranking-review',status,official_url:'https://store.example.com/products/'+id,source_payload:{marketScope:{marketCountry:'KR',marketRegion:'NATIONWIDE'},slotDecision:decision,approvedPlacement:decision==='slot_candidate'?{page:'distribution',sectionKey:'distribution-new',country:'KR'}:null,queueControl:{action:decision},review:{state:decision},frontPublication:{status:publication||'unmatched'}}});relations.set(id,decision==='slot_candidate'?[{id:'rel_'+id,candidate_id:id,hub_key:'distribution',slot_key:'distribution-new',country_code:'KR',region_code:'NATIONWIDE',publication_status:publication||'not_ready'}]:[]);}
 make('unpublished_slot','approval_pending','slot_candidate','not_ready');
 make('live_slot','approval_pending','slot_candidate','published');
 make('stale_bucket','suppressed','hold','not_ready');
 make('foreign_scope','hold','hold','not_ready');rows.get('foreign_scope').source_payload.marketScope.marketCountry='JP';
 Object.assign(store,{
 select:async(table,q)=>{let id=decodeURIComponent((q.match(/(?:candidate_)?id=eq\.([^&]+)/)||[])[1]||'');return table==='gslot_candidates'?(rows.has(id)?[rows.get(id)]:[]):(relations.get(id)||[]);},
 remove:async(table,q)=>{assert.equal(table,'gslot_slot_assignments');let id=decodeURIComponent((q.match(/candidate_id=eq\.([^&]+)/)||[])[1]||'');let result=relations.get(id)||[];relations.set(id,[]);return result;},
 update:async(table,q,patch)=>{let id=decodeURIComponent((q.match(/id=eq\.([^&]+)/)||[])[1]||'');Object.assign(rows.get(id),patch);return [rows.get(id)];}
 });
 const module=isolated('netlify/functions/commerce-candidate-queue-control.js',{
 './lib/global-slot-console-auth':{resolveUser:async()=>({roles:['owner'],sub:'operator'})},
 './lib/global-slot-console-supabase':store,
 './lib/commerce-country-automation.v1':{syncCandidateManagementResearchVisibilityByInput:async()=>{throw Error('secondary research sync timeout')}}
 });
 async function call(id,bucket){return module.handler({httpMethod:'POST',body:JSON.stringify({decision:'dismiss',expectedBucket:bucket||'',candidateIds:[id],countryCode:'KR',subdivisionCode:'NATIONWIDE'})});}
 let r=await call('unpublished_slot','');assert.equal(r.statusCode,200,r.body);let result=JSON.parse(r.body);assert.equal(result.processed,1);assert.match(result.results[0].warning,/research_visibility_sync_failed/);assert.equal(rows.get('unpublished_slot').status,'removed');assert.equal(relations.get('unpublished_slot').length,0);
 r=await call('live_slot','');assert.equal(r.statusCode,409,'published item is protected');assert.equal(rows.get('live_slot').status,'approval_pending');assert.equal(relations.get('live_slot').length,1);
 r=await module.handler({httpMethod:'POST',body:JSON.stringify({decision:'restore',candidateIds:['live_slot'],countryCode:'KR',subdivisionCode:'NATIONWIDE'})});assert.equal(r.statusCode,409,'published item cannot silently restore/unpublish');
 r=await call('stale_bucket','hold');assert.equal(r.statusCode,200,'saved slotDecision=hold overrides stale suppressed status');assert.equal(rows.get('stale_bucket').status,'removed');
 r=await call('foreign_scope','hold');assert.equal(r.statusCode,409,'different country product cannot be deleted from KR scope');assert.equal(rows.get('foreign_scope').status,'hold');
 console.log('PASS candidate ID deletion after staging/PSOM, public item protected, stale hold state and secondary sync failure');
}
function testDirectResearchUi(){const js=fs.readFileSync(path.join(root,'assets/js/admin-commerce-country-control.js'),'utf8'),html=fs.readFileSync(path.join(root,'commerce-country-control.html'),'utf8'),backend=fs.readFileSync(path.join(root,'netlify/functions/lib/commerce-country-automation.v1.js'),'utf8');
 for(let key of ['data-latest-delete-one','data-latest-purge-one','data-candidate-delete-one','removeSinglePrivateCandidate','idsOverride:[id]'])assert.ok(js.includes(key),'missing card action or routing: '+key);
 for(let key of ['LATEST_RESEARCH_DELETE_TARGET_NOT_FOUND','LATEST_RESEARCH_PURGE_TARGET_NOT_FOUND','LEGACY_LATEST_DELETE_TARGET_NOT_FOUND','LEGACY_LATEST_PURGE_TARGET_NOT_FOUND'])assert.ok(backend.includes(key),'missing missing-target failure: '+key);
 assert.ok(html.includes('20261023-latest-inventory-actions-v2'),'browser cache bust missing');
 console.log('PASS direct card delete actions, stable delegation, failed selection readback and cache revision');
}
(async()=>{await testCandidateAfterTransfer();testDirectResearchUi();console.log('PASS research-to-candidate deletion chain');})().catch(e=>{console.error(e);process.exitCode=1;});
