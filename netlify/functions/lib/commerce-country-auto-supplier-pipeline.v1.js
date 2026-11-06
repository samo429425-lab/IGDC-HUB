'use strict';
// Checkpointed, country-local continuation of the existing five-round supplier
// researcher. This worker NEVER publishes Front Match and NEVER overwrites a
// human research job without an explicit takeover for that geographic scope.
const crypto = require('crypto');
const Automation = require('./commerce-country-automation.v1');
const Store = require('./global-slot-console-supabase');
const VERSION = 'igdc-country-supplier-staged-auto.v1';
const ACTOR = 'scheduled-automation';
const HUB = 'country-supplier-staged-auto';
const LEASE_MS = 9 * 60 * 1000;
const MAX_SCOPES = 8; // Country-local fair rotation, bounded parallel work per minute (<= 12).
const RESEARCH_ROUNDS = 5; // Country scheduled automation always completes five distinct research rounds.
const NO_RESULT_RETRY_MS = 6 * 60 * 60 * 1000;
const SUPPLIER_REFRESH_MS = 84 * 60 * 60 * 1000;
const RESEARCH_ROUNDS_PER_JOB = 1; // Persist reviewed suppliers after each completed round, not after all five rounds.
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function txt(v) { return v == null ? '' : String(v).trim(); }
function now() { return new Date().toISOString(); }
function ts(v) { const n = Date.parse(txt(v)); return Number.isFinite(n) ? n : 0; }
function reg(s) { return txt(s.subdivisionCode || 'NATIONWIDE').toUpperCase(); }
function key(s) { return txt(s.countryCode).toUpperCase() + '|' + reg(s); }
function idFor(s) { return 'igdc_supplier_staged_auto_' + txt(s.countryCode).toLowerCase() + '_' + reg(s).toLowerCase().replace(/[^a-z0-9_-]/g, '_'); }
function input(s,extra) { return Object.assign({countryCode:s.countryCode,subdivisionCode:reg(s),scopeAuthority:'administrator-selected',ignoreRequestGeo:true},extra||{}); }
function create(deps) {
  const automation=deps&&deps.automation||Automation;
  const store=deps&&deps.store||Store;
  const clock=deps&&deps.clock||now;
  async function rowFor(s) { return arr(await store.select('gslot_policies','select=id,rule,updated_at&id=eq.'+encodeURIComponent(idFor(s))+'&limit=1'))[0]||null; }
  async function rows() {
    const all=[],page=500;
    for(let offset=0;offset<10000;offset+=page){
      const slice=arr(await store.select('gslot_policies','select=id,rule,updated_at&scope_hub=eq.'+HUB+'&order=id.asc&limit='+page+'&offset='+offset));
      all.push(...slice);if(slice.length<page)return all;
    }
    throw new Error('supplier_auto_checkpoint_page_limit');
  }
  async function ensure(s) {
    const found=await rowFor(s);if(found)return found;
    const t=clock(),rule={schema:VERSION,scope:{countryCode:s.countryCode,subdivisionCode:reg(s)},phase:'idle',jobId:null,autoTakeover:false,rounds:RESEARCH_ROUNDS,lastStepAt:null,nextCycleAt:null,errors:[]};
    await store.insert('gslot_policies',{id:idFor(s),name:'국가별 반복 공급업체 자동 조사',scope_hub:HUB,scope_country:s.countryCode,scope_region:reg(s)==='NATIONWIDE'?null:reg(s),enabled:true,rule,created_at:t,updated_at:t,updated_by:ACTOR},'resolution=ignore-duplicates,return=minimal');
    return rowFor(s);
  }
  async function claim(s) {
    const previous=await ensure(s);if(!previous)throw new Error('supplier_checkpoint_unavailable');
    const current=obj(previous.rule),revision=new Date(Math.max(ts(clock()),ts(previous.updated_at)+1)).toISOString();
    if(ts(current.leaseUntil)>ts(revision))return null;
    const leaseToken=crypto.randomBytes(12).toString('hex');
    const written=arr(await store.update('gslot_policies','id=eq.'+encodeURIComponent(idFor(s))+'&updated_at=eq.'+encodeURIComponent(txt(previous.updated_at)),{rule:Object.assign({},current,{leaseToken,leaseUntil:new Date(ts(revision)+LEASE_MS).toISOString()}),updated_at:revision,updated_by:ACTOR}));
    if(written.length!==1||txt(obj(written[0].rule).leaseToken)!==leaseToken)return null;
    return{rule:obj(written[0].rule),updatedAt:txt(written[0].updated_at)||revision};
  }
  async function release(s,lock,value) {
    const revision=new Date(Math.max(ts(clock()),ts(lock.updatedAt)+1)).toISOString();
    const rule=Object.assign({},obj(value),{schema:VERSION,scope:{countryCode:s.countryCode,subdivisionCode:reg(s)},leaseToken:null,leaseUntil:null,lastStepAt:clock()});
    const written=arr(await store.update('gslot_policies','id=eq.'+encodeURIComponent(idFor(s))+'&updated_at=eq.'+encodeURIComponent(lock.updatedAt),{rule,updated_at:revision,updated_by:ACTOR}));
    if(written.length!==1)throw new Error('supplier_checkpoint_revision_conflict');
    return rule;
  }
  async function recheck(s) { const live=await automation.autoProductScopes();if(!arr(live.scopes).some(x=>key(x)===key(s)))throw Object.assign(new Error('country_automation_paused'),{stopped:true}); }
  async function advance(s,current) {
    const state=Object.assign({phase:'idle',autoTakeover:false,operatorAutoPause:false,rounds:RESEARCH_ROUNDS},current);
    if(state.operatorAutoPause===true)return Object.assign(state,{lastResult:'administrator_automation_paused_checkpoint_preserved'});
    const job=await automation.autoSupplierJobCheckpoint(input(s));
    const owned=!!txt(state.jobId)&&txt(state.jobId)===txt(job.jobId)&&txt(job.updatedBy)===ACTOR;
    // A manually edited active job must never be advanced by a scheduler,
    // even after an earlier approval to take over a *completed* job.
    if(job.jobId && !owned && job.updatedBy!==ACTOR) {
      if(!state.autoTakeover)return Object.assign(state,{phase:'manual_preserved',protectedJobId:job.jobId,lastResult:'manual_supplier_job_preserved'});
      if(!['complete','committed'].includes(job.status))return Object.assign(state,{phase:'manual_preserved',lastResult:'manual_supplier_job_still_active'});
    }
    if(state.phase==='manual_preserved')state.phase='idle';
    if(state.phase==='cooldown') {
      if(ts(state.nextCycleAt)>ts(clock()))return Object.assign(state,{lastResult:'next_research_cycle_scheduled'});
      state.phase='idle';state.jobId=null;state.roundsCompleted=0;
    }
    if(job.jobId && !state.jobId && job.jobId!==state.lastCommittedJobId && job.updatedBy===ACTOR && ['searching','inspecting','ranking','complete','committed'].includes(job.status)) {
      state.jobId=job.jobId;state.phase=job.status==='complete'?'committing':'researching';
    }
    if(state.jobId&&job.jobId&&state.jobId!==job.jobId) {
      if(job.updatedBy===ACTOR){state.jobId=job.jobId;state.phase=['complete','committed'].includes(job.status)?'committing':'researching';}
      else return Object.assign(state,{phase:'manual_preserved',autoTakeover:false,protectedJobId:job.jobId,lastResult:'human_restarted_supplier_research_preserved'});
    }
    if(state.phase==='idle') {
      await recheck(s);
      const started=await automation.beginResearchJob(ACTOR,input(s,{researchRounds:RESEARCH_ROUNDS_PER_JOB,researchRoundIndex:Math.min(RESEARCH_ROUNDS,Number(state.roundsCompleted||0)+1)}));
      if(!txt(started&&started.jobId))throw new Error('supplier_research_start_without_job');
      return Object.assign(state,{jobId:started.jobId,lastProgressiveSearchCursor:0,phase:['complete','committed'].includes(started.status)?'committing':'researching',rounds:RESEARCH_ROUNDS,startedAt:started.startedAt||clock(),lastResult:'five_round_supplier_research_started_round_'+String(Math.min(RESEARCH_ROUNDS,Number(state.roundsCompleted||0)+1))});
    }
    if(state.phase==='researching') {
      if(job.status==='complete'||job.status==='committed')return Object.assign(state,{phase:'committing',lastResult:'supplier_research_complete'});
      // During long multi-query discovery, persist verified PRIVATE leads in
      // small batches instead of waiting for every query of all five rounds.
      // This never truncates searchTasks or advances the completed-round count.
      if(job.status==='searching' && Number(job.searchCursor||0)>0 &&
         Number(job.searchCursor||0)>=Number(state.lastProgressiveSearchCursor||0)+3 &&
         typeof automation.progressivePrivateSupplierCommit==='function') {
        await recheck(s);
        const staged=await automation.progressivePrivateSupplierCommit(ACTOR,input(s));
        state.lastProgressiveSearchCursor=Number(job.searchCursor||0);
        state.progressiveInspected=Number(state.progressiveInspected||0)+Number(staged.inspected||0);
        state.progressivePersisted=Number(state.progressivePersisted||0)+Number(staged.persisted||0);
        state.progressiveUsableSuppliers=Number(staged.usableSuppliers||state.progressiveUsableSuppliers||0);
        if(Number(staged.persisted||0)>0)return Object.assign(state,{lastResult:'supplier_progressive_private_leads_staged_search_continues'});
      }
      await recheck(s);
      const result=await automation.advanceResearchJob(ACTOR,input(s));
      return Object.assign(state,{phase:['complete','committed'].includes(result.status)?'committing':'researching',lastResult:'supplier_step_'+txt(result.status)});
    }
    if(state.phase==='committing') {
      await recheck(s);
      let savedCount=0;
      if(Number(job.candidateCount||0)>0) {
        const result=await automation.commitResearchJob(ACTOR,input(s));
        if(!result||result.ok===false)throw new Error('supplier_commit_not_confirmed');
        savedCount=Number(obj(result.summary).created||0)+Number(obj(result.summary).updated||0);
        if(result.partial===true)return Object.assign(state,{phase:'committing',committedSuppliers:savedCount,
          commitCursor:Number(result.committedCursor||0),commitTarget:Number(result.totalNewCandidates||0),lastResult:'supplier_commit_chunk_saved_next_batch_pending'});
      }
      // The country-local supplier ledger, not a research count, is the product
      // worker's durable start gate. An empty search never marks the cycle as
      // a successfully discovered supplier portfolio.
      const recorded=await automation.recordScheduledSupplierCompletion(input(s,{jobId:state.jobId,recordedSuppliers:savedCount}));
      const have=Number(recorded&&recorded.activeSupplierCount||0);
      // The supplier crawl also revisits markets while their PRIVATE 20-section
      // board is under target, independent of the ordinary 84-hour refresh.
      let fill={unavailable:true};
      if(have){try{fill=await require('./commerce-country-auto-product-pipeline.v1').makePipeline().sectionFill(s);}catch(error){fill={unavailable:true,error:txt(error&&error.message||error)};}}
      const completedRounds=Math.min(RESEARCH_ROUNDS,Math.max(0,Number(state.roundsCompleted||0))+Math.max(1,Number(job.researchRounds||1)));
      // The same completed persistent job must never count as the next search
      // round after this checkpoint moves back to idle.
      const committedJobId=txt(state.jobId);
      // Each round commits its verified supplier list; product research may start
      // immediately. The next research round has a new job/checkpoint, without
      // overwriting prior suppliers, manual locks, or exclusions.
      if(completedRounds<RESEARCH_ROUNDS) return Object.assign(state,{
        phase:'idle',jobId:null,lastCommittedJobId:committedJobId,roundsCompleted:completedRounds,completedAt:clock(),
        sectionFill:fill,committedSuppliers:savedCount,activeSupplierCount:have,
        lastResult:have?'supplier_round_saved_product_research_unlocked':'supplier_round_complete_retry_next_round'
      });
      const incomplete=!have||fill.fullTargetComplete!==true;
      return Object.assign(state,{phase:'cooldown',lastCommittedJobId:committedJobId,roundsCompleted:completedRounds,completedAt:clock(),sectionFill:fill,
        nextCycleAt:new Date(ts(clock())+(incomplete?NO_RESULT_RETRY_MS:SUPPLIER_REFRESH_MS)).toISOString(),
        lastResult:have?'supplier_five_rounds_complete_product_worker_eligible':'five_rounds_no_verified_supplier_retry_scheduled',committedSuppliers:savedCount,activeSupplierCount:have});
    }
    return Object.assign(state,{phase:'idle',lastResult:'supplier_unknown_phase_safely_reset'});
  }
  async function runScope(s) {
    const claimed=await claim(s);if(!claimed)return{scope:key(s),skipped:'already_running'};
    let state=Object.assign({},claimed.rule),failure=null,steps=0;
    try {
      // At most two country-local steps per minute. Do not start a second
      // network search after a slow first one: scheduled function executions
      // have a short hard timeout, and every step must leave a durable cursor.
      const begin=Date.now();
      for(let i=0;i<2;i++){
        if(i>0&&(Date.now()-begin>11000||['manual_preserved','cooldown'].includes(state.phase)||state.operatorAutoPause===true))break;
        await recheck(s);
        state=await advance(s,state);steps++;
        if(['manual_preserved','cooldown'].includes(state.phase)||state.operatorAutoPause===true)break;
      }
    }
    catch(e) {failure=txt(e&&e.message||e);state.lastResult=e&&e.stopped?'country_paused_without_data_loss':'supplier_step_failed_checkpoint_preserved';state.errors=arr(state.errors).concat([{at:clock(),phase:state.phase,error:failure}]).slice(-24);}
    const stored=await release(s,claimed,state);
    return{scope:key(s),ok:!failure,phase:stored.phase,jobId:stored.jobId||null,rounds:stored.rounds,lastResult:stored.lastResult,stepsAdvanced:steps,error:failure,publicPublication:false};
  }
  async function setTakeover(actor,s,enabled) {
    if(!['string','number'].includes(typeof actor)||!txt(actor))throw new Error('administrator_required');
    const prior=await rowFor(s)||await ensure(s);if(!prior)throw new Error('supplier_auto_takeover_checkpoint_unavailable');
    if(ts(obj(prior.rule).leaseUntil)>ts(clock()))throw Object.assign(new Error('해당 국가 자동화 작업이 진행 중입니다. 단계 종료 후 다시 선택해 주세요.'),{statusCode:409});
    const t=new Date(Math.max(ts(clock()),ts(prior.updated_at)+1)).toISOString();
    const next=Object.assign({},obj(prior.rule),{autoTakeover:enabled===true,operatorAutoPause:enabled!==true,phase:enabled===true&&obj(prior.rule).phase==='manual_preserved'?'idle':obj(prior.rule).phase,changedBy:txt(actor),changedAt:t});
    const saved=arr(await store.update('gslot_policies','id=eq.'+encodeURIComponent(idFor(s))+'&updated_at=eq.'+encodeURIComponent(txt(prior.updated_at)),{rule:next,updated_at:t,updated_by:txt(actor)}));
    if(saved.length!==1)throw Object.assign(new Error('자동화 전환 상태 저장 충돌'),{statusCode:409});
    return{ok:true,scope:key(s),autoTakeover:next.autoTakeover,manualDataPreserved:true,automaticFrontMatch:false};
  }
  async function run() {
    const plan=await automation.autoProductScopes();const active=arr(plan.scopes);
    if(!active.length)return{ok:true,version:VERSION,activeScopes:0,processed:0,results:[]};
    const previous=new Map((await rows()).map(x=>[txt(x.id),obj(x.rule)]));
    const choices=active.filter(s=>{const state=previous.get(idFor(s))||{};return state.operatorAutoPause!==true && !(state.phase==='manual_preserved'&&state.autoTakeover!==true) && !(state.phase==='cooldown'&&ts(state.nextCycleAt)>ts(clock()));})
      .sort((a,b)=>ts((previous.get(idFor(a))||{}).lastStepAt)-ts((previous.get(idFor(b))||{}).lastStepAt)||key(a).localeCompare(key(b))).slice(0,MAX_SCOPES);
    // Independent leases allow concurrent country steps, without overwriting
    // another country's research or an administrator selection.
    const settled=await Promise.allSettled(choices.map(runScope));
    const results=settled.map((r,i)=>r.status==='fulfilled'?r.value:{scope:key(choices[i]),ok:false,error:txt(r.reason&&r.reason.message||r.reason)});
    return{ok:results.every(r=>r.ok!==false),version:VERSION,activeScopes:active.length,processed:results.length,results,safety:{humanJobProtected:true,countryIndependent:true,researchRounds:RESEARCH_ROUNDS,noPublicFrontMatch:true}};
  }
  return{run,runScope,setTakeover,idFor,advance,claim,release};
}
module.exports={VERSION,ACTOR,create,run:()=>create().run(),setTakeover:(actor,scope,enabled)=>create().setTakeover(actor,scope,enabled)};
