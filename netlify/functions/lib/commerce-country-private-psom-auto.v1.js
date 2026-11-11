'use strict';
/*
 * Independent, bounded PSOM PRIVATE placement worker for inspected country
 * product candidates. It cannot publish Front Match, change a human-created
 * record, override an administrator lock, or manufacture merchant evidence.
 * SearchBank and shared public Snapshot engines are deliberately untouched.
 */
const crypto=require('crypto');
const Automation=require('./commerce-country-automation.v1');
const Store=require('./global-slot-console-supabase');
const Safety=require('./commerce-international-distribution-safety.v1');
const SourceGuard=require('./commerce-supplier-source-guard.v1');
const ProductWorker=require('./commerce-country-auto-product-pipeline.v1');
const ProductRanking=require('./commerce-product-ranking.v1');
const VERSION='igdc-country-private-psom-scheduled.v1';
const HUB='country-private-psom-auto';
const ACTOR='scheduled-country-product-ai';
const MAX_SCOPES=2, CANDIDATES_PER_SCOPE=2, SCAN_LIMIT=12, LEASE_MS=180000;
const MAX_ERRORS=15;
const txt=v=>String(v==null?'':v).trim();
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
const ts=v=>Date.parse(txt(v))||0;
const region=s=>txt(s.subdivisionCode||'NATIONWIDE').toUpperCase();
const key=s=>txt(s.countryCode).toUpperCase()+'|'+region(s);
const idFor=s=>'igdc_private_psom_auto_'+txt(s.countryCode).toLowerCase()+'_'+region(s).toLowerCase().replace(/[^a-z0-9_-]/g,'_');
const encoded=encodeURIComponent;
const NEXT_CYCLE_MS=15*60000;
const RECHECK_MS=24*60*60000;
function rowEligible(row,scope){
  const p=obj(row.source_payload),market=obj(p.marketScope),supply=obj(p.countrySupply),management=obj(p.managementControl),queue=obj(p.queueControl),pipeline=obj(p.pipeline),front=obj(p.frontPublication),seller=obj(p.supplier);
  if(txt(row.source_ref)!=='country-product-ranking-review'||txt(row.created_by)!==ACTOR||txt(pipeline.promotedBy)!==ACTOR)return{ok:false,reason:'not_scheduler_owned'};
  if(txt(market.marketCountry).toUpperCase()!==scope.countryCode||txt(market.marketRegion||'NATIONWIDE').toUpperCase()!==region(scope)||txt(supply.country).toUpperCase()!==scope.countryCode||txt(supply.region||'NATIONWIDE').toUpperCase()!==region(scope))return{ok:false,reason:'cross_market'};
  if(txt(p.slotDecision||'undecided').toLowerCase()!=='undecided'||queue.permanentExcluded===true||management.administratorLocked===true||management.aiReclassificationAllowed===false)return{ok:false,reason:'operator_or_existing_placement'};
  if(['hold','held','blocked','suppressed','rejected','purged','removed'].includes(txt(row.status).toLowerCase()))return{ok:false,reason:'candidate_on_hold'};
  if(['queued','publish_requested','published','matched','active','unpublish_requested'].includes(txt(front.status).toLowerCase()))return{ok:false,reason:'front_already_managed'};
  const productUrl=txt(p.externalProductUrl||p.productUrl||row.official_url),supplierUrl=txt(p.supplierSiteUrl||seller.officialUrl||seller.url);
  if(!productUrl||!supplierUrl||SourceGuard.reason(productUrl)||SourceGuard.reason(supplierUrl)||
     !ProductRanking.isSpecificProductUrl(productUrl))return{ok:false,reason:'missing_specific_real_product_or_seller_url'};
  if(p.sameSupplierSite===false||!txt(p.image||p.imageUrl||row.thumbnail_url))return{ok:false,reason:'product_detail_or_seller_mismatch'};
  // Phase 11 staged records predate the inspection fields in the durable
  // candidate payload. Never pretend these rows are pre-verified; allow a
  // strictly bounded RE-INSPECTION attempt only for a still-private, scheduler-
  // owned item which was originally quality-eligible in the real research job.
  // The called server action rechecks the live product page and re-evaluates
  // market safety before it can assign any PSOM section.
  const legacyNeedsInspection=p.inspectionComplete===undefined&&p.productPageLive===undefined;
  if(legacyNeedsInspection){
    const readiness=obj(p.researchReadiness),supplier=obj(p.supplier),logistics=obj(p.countryLogistics),checks=obj(p.supplierPolicyChecks);
    if(readiness.queueEligible!==true)return{ok:false,reason:'legacy_research_not_ready_for_fresh_inspection'};
    if(scope.countryCode!=='KR'){
      if(supplier.evidenceReady!==true||txt(logistics.sellerAddressCountryClaim).toUpperCase()!==scope.countryCode||
         ![checks.shippingPolicyUrl,checks.returnsPolicyUrl,checks.refundPolicyUrl,checks.supportPolicyUrl].every(Boolean))
        return{ok:false,reason:'legacy_overseas_merchant_policy_unconfirmed'};
    }
  } else {
    if(p.productPageLive!==true||p.inspectionComplete!==true||p.sameSupplierSite!==true)return{ok:false,reason:'product_detail_not_fully_inspected'};
    const safety=Safety.product(p,scope.countryCode);
    if(safety.eligibleForAutomaticPrivatePlacement!==true)return{ok:false,reason:txt(safety.reason)||'market_policy_evidence_pending'};
  }
  const semantic=ProductRanking.strictPlacementSectionKeys({
    productName:txt(p.productName||p.title||row.title),title:txt(p.title||row.title),
    description:txt(p.description),productCategory:txt(p.productCategory),
    productCategoryTags:arr(p.productCategoryTags)
  });
  if(!arr(semantic.keys).length||txt(semantic.family)==='unknown')return{ok:false,reason:'strict_psom_category_evidence_pending'};
  return{ok:true,needsFreshReinspection:legacyNeedsInspection};
}
function makePipeline(deps){
  const automation=deps&&deps.automation||Automation;
  const store=deps&&deps.store||Store;
  const productWorker=deps&&deps.productWorker||ProductWorker;
  const clock=deps&&deps.clock||(()=>new Date().toISOString());
  async function readCheckpoint(s){return arr(await store.select('gslot_policies','select=id,rule,updated_at&id=eq.'+encoded(idFor(s))+'&limit=1'))[0]||null;}
  async function ensure(s){
    let row=await readCheckpoint(s);
    if(row)return row;
    const t=clock();
    await store.insert('gslot_policies',{id:idFor(s),name:'국가별 검증 상품 비공개 PSOM 자동 배정',scope_hub:HUB,scope_country:s.countryCode,scope_region:region(s)==='NATIONWIDE'?null:region(s),enabled:true,
      rule:{schema:VERSION,cursor:'',phase:'idle',lastStepAt:null,nextCycleAt:null,errors:[],leaseUntil:null},created_at:t,updated_at:t,updated_by:ACTOR},'resolution=ignore-duplicates,return=minimal');
    return readCheckpoint(s);
  }
  async function claim(s){
    const old=await ensure(s);if(!old)throw new Error('psom_checkpoint_missing');
    const t=new Date(Math.max(ts(clock()),ts(old.updated_at)+1)).toISOString(),prior=obj(old.rule);
    if(ts(prior.leaseUntil)>ts(t)||ts(prior.nextCycleAt)>ts(t))return null;
    const token=crypto.randomBytes(10).toString('hex');
    const next=obj(Object.assign({},prior,{leaseToken:token,leaseUntil:new Date(ts(t)+LEASE_MS).toISOString()}));
    const written=arr(await store.update('gslot_policies','id=eq.'+encoded(idFor(s))+'&updated_at=eq.'+encoded(txt(old.updated_at)),{rule:next,updated_at:t,updated_by:ACTOR}));
    if(written.length!==1||txt(obj(written[0].rule).leaseToken)!==token)return null;
    return{rule:next,revision:txt(written[0].updated_at)||t};
  }
  async function release(s,lock,state){
    const t=new Date(Math.max(ts(clock()),ts(lock.revision)+1)).toISOString();
    const rule=Object.assign({},obj(state),{schema:VERSION,leaseToken:null,leaseUntil:null,lastStepAt:clock()});
    const updated=arr(await store.update('gslot_policies','id=eq.'+encoded(idFor(s))+'&updated_at=eq.'+encoded(lock.revision),{rule,updated_at:t,updated_by:ACTOR}));
    if(updated.length!==1)throw new Error('psom_checkpoint_revision_conflict');
    return rule;
  }
  async function active(s){
    const status=await automation.autoScopeStatus({countryCode:s.countryCode,subdivisionCode:region(s)});
    return status&&status.active===true;
  }
  async function candidateBatch(s,cursor){
    // Only PRIVATE, scheduler-owned candidates in the exact country and
    // subdivision. Stable ID cursor prevents OFFSET skips after PSOM updates.
    const query='select=id,source_ref,created_by,status,official_url,thumbnail_url,source_payload'+
      '&source_ref=eq.country-product-ranking-review&created_by=eq.'+encoded(ACTOR)+
      '&source_payload->marketScope->>marketCountry=eq.'+encoded(s.countryCode)+
      '&source_payload->marketScope->>marketRegion=eq.'+encoded(region(s))+
      (txt(cursor)?'&id=gt.'+encoded(txt(cursor)):'')+
      '&order=id.asc&limit='+SCAN_LIMIT;
    return arr(await store.select('gslot_candidates',query));
  }
  async function runScope(s){
    const lock=await claim(s);
    if(!lock)return{scope:key(s),skipped:'lease_or_retry_interval'};
    let state=Object.assign({cursor:'',errors:[],reviewRequired:0,placed:0,legacyReinspectionAttempts:0},lock.rule),error=null;
    try{
      if(!await active(s)){state.phase='paused';state.nextCycleAt=new Date(ts(clock())+NEXT_CYCLE_MS).toISOString();}
      else{
        const batch=await candidateBatch(s,state.cursor),eligible=[];
        for(const row of batch){
          const check=rowEligible(row,s);
          if(check.ok&&eligible.length<CANDIDATES_PER_SCOPE){
            eligible.push(txt(row.id));
            if(check.needsFreshReinspection===true)state.legacyReinspectionAttempts=Number(state.legacyReinspectionAttempts||0)+1;
          }
          else if(!check.ok)state.reviewRequired=Number(state.reviewRequired||0)+1;
        }
        // Do not advance beyond an eligible item left unprocessed in the batch.
        // This ensures no qualified product is skipped on the next tick.
        let nextCursor=batch.length?txt(batch[batch.length-1].id):txt(state.cursor);
        if(eligible.length===CANDIDATES_PER_SCOPE){
          const last=eligible[eligible.length-1];
          if(batch.some(row=>txt(row.id)===last))nextCursor=last;
        }
        if(eligible.length){
          if(!await active(s))throw Object.assign(new Error('country_paused_before_psom_write'),{stopped:true});
          // This is a bounded canonical assignment count, not a stale snapshot.
          // On any count/read error, fail CLOSED instead of placing blindly.
          const fill=await productWorker.makePipeline().sectionFill(s);
          const result=await automation.productCandidateVerifiedPsomPlace(ACTOR,{
            countryCode:s.countryCode,subdivisionCode:region(s),candidateIds:eligible,balanceCounts:obj(fill.counts)});
          state.placed=Number(state.placed||0)+Number(result.assigned||0);
          state.reviewRequired=Number(state.reviewRequired||0)+Number(result.failed||0)+Number(result.held||0)+Number(result.inconclusive||0);
          state.lastPlacementResult=arr(result.results).map(x=>({candidateId:txt(x.candidateId),assigned:x.assigned===true,reason:txt(x.reason||x.error)})).slice(-CANDIDATES_PER_SCOPE);
        }
        const atEnd=batch.length<SCAN_LIMIT&&eligible.length<CANDIDATES_PER_SCOPE;
        state.cursor=atEnd?'':nextCursor;
        state.phase=atEnd?'cycle_complete':'research_candidates_scanned';
        state.nextCycleAt=new Date(ts(clock())+(atEnd?RECHECK_MS:NEXT_CYCLE_MS)).toISOString();
        state.lastResult=atEnd?'waiting_for_fresh_validated_products':(eligible.length?'private_psom_attempt_recorded':'private_psom_no_evidence_ready_product');
        state.lastScanned=Number(batch.length);
      }
    }catch(e){
      error=txt(e&&e.message||e);
      state.phase=e&&e.stopped?'paused':'retry';
      state.lastResult=e&&e.stopped?'country_stopped_before_psom_write':'psom_step_failed_cursor_preserved';
      state.nextCycleAt=new Date(ts(clock())+NEXT_CYCLE_MS).toISOString();
      if(!(e&&e.stopped))state.errors=arr(state.errors).concat([{at:clock(),error}]).slice(-MAX_ERRORS);
    }
    await release(s,lock,state);
    return{scope:key(s),ok:!error,phase:state.phase,result:state.lastResult,placed:Number(state.placed||0),reviewRequired:Number(state.reviewRequired||0),legacyReinspectionAttempts:Number(state.legacyReinspectionAttempts||0),error,publicPublication:false};
  }
  async function run(){
    const plan=await automation.autoProductScopes(),scopes=arr(plan.scopes);
    if(!scopes.length)return{ok:true,version:VERSION,processed:0,results:[],automaticFrontMatch:false};
    const prior=[],page=500;
    for(let offset=0;offset<1000;offset+=page){
      const slice=arr(await store.select('gslot_policies','select=id,rule&scope_hub=eq.'+HUB+'&order=id.asc&limit='+page+'&offset='+offset));
      prior.push(...slice);if(slice.length<page)break;
    }
    const byId=new Map(prior.map(row=>[txt(row.id),obj(row.rule)]));
    const choices=scopes.filter(s=>ts(obj(byId.get(idFor(s))).nextCycleAt)<=ts(clock()))
      .sort((a,b)=>ts(obj(byId.get(idFor(a))).lastStepAt)-ts(obj(byId.get(idFor(b))).lastStepAt)||key(a).localeCompare(key(b))).slice(0,MAX_SCOPES);
    const settled=await Promise.allSettled(choices.map(runScope));
    const results=settled.map((x,i)=>x.status==='fulfilled'?x.value:{scope:key(choices[i]),ok:false,error:txt(x.reason&&x.reason.message||x.reason)});
    return{ok:results.every(x=>x.ok!==false),version:VERSION,activeScopes:scopes.length,processed:results.length,results,automaticFrontMatch:false,automaticPublication:false};
  }
  return{run,runScope,rowEligible:(r,s)=>rowEligible(r,s),idFor};
}
module.exports={VERSION,ACTOR,makePipeline,rowEligible,run:()=>makePipeline().run()};
