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
const LEASE_MS = 3 * 60 * 1000; // Worker timeouts recover without a nine-minute country stall.
const RECENT_ADMIN_EDIT_MS = 90 * 1000; // Brief concurrency yield, never a country-wide permanent pause.
const MAX_SCOPES = 4; // Keep concurrent country network/DB writes within one short Netlify scheduled invocation.
const RESEARCH_ROUNDS = 5; // Country scheduled automation always completes five distinct research rounds.
// Checkpoints run each scheduled tick while a country is being researched.
// These gaps apply ONLY after a complete five-round search has exhausted its
// current provider/source plan without filling the PRIVATE country board.
// They are NOT the 84-hour recurring maintenance interval.
const UNDERFILLED_RETRY_MS = 15 * 60 * 1000;
const NO_RESULT_RETRY_MS = 30 * 60 * 1000;
const SUPPLIER_REFRESH_MS = 84 * 60 * 60 * 1000;
const RESEARCH_ROUNDS_PER_JOB = 1; // Persist reviewed suppliers after each completed round, not after all five rounds.
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function txt(v) { return v == null ? '' : String(v).trim(); }
function now() { return new Date().toISOString(); }
function ts(v) { const n = Date.parse(txt(v)); return Number.isFinite(n) ? n : 0; }
function reg(s) { return txt(s.subdivisionCode || 'NATIONWIDE').toUpperCase(); }
function key(s) { return txt(s.countryCode).toUpperCase() + '|' + reg(s); }
// A successful scheduler invocation is not proof that its external search
// provider returned sellers. Store a tiny error summary in the staged control
// record so national bottleneck JSON can distinguish "searched" from "found".
function providerOutcome(result, previousCursor) {
  const progress=obj(obj(result).progress);
  const done=Number(obj(progress.search).done||0);
  if(done<=Number(previousCursor||0))return null;
  const trace=arr(obj(result).trace);
  // A provider-configuration fallback record can follow the actual result.
  // Report the underlying Google/Naver/Sanmaru status, not the guard message.
  const last=obj(trace.slice().reverse().find(row=>['google','naver','sanmaru'].includes(txt(obj(row).source).toLowerCase())));
  const provider=txt(last.source).toLowerCase();
  if(!provider)return null;
  return {provider,status:txt(last.status).toLowerCase()||'unknown',count:Math.max(0,Number(last.count||0)),searchCursor:done};
}
function idFor(s) { return 'igdc_supplier_staged_auto_' + txt(s.countryCode).toLowerCase() + '_' + reg(s).toLowerCase().replace(/[^a-z0-9_-]/g, '_'); }
function input(s,extra) { return Object.assign({countryCode:s.countryCode,subdivisionCode:reg(s),scopeAuthority:'administrator-selected',ignoreRequestGeo:true},extra||{}); }
// Existing database checkpoints may still contain a SIX-HOUR nextCycleAt
// written by an older deploy. Shorten only an unfilled market's old wait;
// never shortcut 84-hour full-board maintenance or erase its job cursor.
function eligibleCycleAt(state) {
  const saved=ts(obj(state).nextCycleAt),finished=ts(obj(state).completedAt)||ts(obj(state).lastStepAt);
  if(!saved||!finished)return saved;
  // A large unverified lead pool cannot mark the country as complete.
  // Only the policy-qualified count (or the previously confirmed full flag)
  // permits the long maintenance interval.
  const goal=Number(obj(state).supplierTarget||100);
  const full=obj(state).targetReached===true || Number(obj(state).qualifiedSupplierCount||0)>=goal;
  if(full)return saved;
  const gap=Number(obj(state).activeSupplierCount||0)>0?UNDERFILLED_RETRY_MS:NO_RESULT_RETRY_MS;
  return Math.min(saved,finished+gap);
}
function create(deps) {
  const automation=deps&&deps.automation||Automation;
  const store=deps&&deps.store||Store;
  const clock=deps&&deps.clock||now;
  async function rowFor(s) { return arr(await store.select('gslot_policies','select=id,rule,updated_at&id=eq.'+encodeURIComponent(idFor(s))+'&limit=1'))[0]||null; }
  async function rows() {
    const all=[],page=500;
    for(let offset=0;offset<10000;offset+=page){
      // A global fairness check needs only compact fields. Do not transfer a
      // growing array of supplier errors and section diagnostics for every
      // country once per minute. The full rule is read only when a country is
      // claimed (rowFor/claim/release retain their existing CAS contract).
      const fields='select=id,updated_at,phase:rule->>phase,lastStepAt:rule->>lastStepAt,'+
        'completedAt:rule->>completedAt,nextCycleAt:rule->>nextCycleAt,'+
        'activeSupplierCount:rule->activeSupplierCount,supplierTarget:rule->supplierTarget,'+
        'operatorAutoPause:rule->operatorAutoPause,nextRetryAt:rule->>nextRetryAt';
      const slice=arr(await store.select('gslot_policies',fields+'&scope_hub=eq.'+HUB+'&order=id.asc&limit='+page+'&offset='+offset));
      all.push(...slice.map(row=>({id:row.id,updated_at:row.updated_at,rule:{
        phase:row.phase,lastStepAt:row.lastStepAt,completedAt:row.completedAt,nextCycleAt:row.nextCycleAt,
        activeSupplierCount:row.activeSupplierCount,supplierTarget:row.supplierTarget,
        operatorAutoPause:row.operatorAutoPause===true,nextRetryAt:row.nextRetryAt
      }})));if(slice.length<page)return all;
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
  async function recheck(s) {
    // Fresh country-only policy read: honor immediate operator stops without
    // reading all markets before every one of several scheduler steps.
    const live=await automation.autoScopeStatus(input(s));
    if(live.active!==true)throw Object.assign(new Error('country_automation_paused:'+txt(live.reason)),{stopped:true});
  }
  // Administrator research-button clicks are NOT country automation bans.
  // Yield briefly to an active administrator to avoid racing a single shared
  // job checkpoint; keep every manual-pinned supplier/decision in its own ledger.
  async function humanResearchIsActive(s) {
    const id='igdc_supplier_research_job_'+txt(s.countryCode).toLowerCase()+'_'+reg(s).toLowerCase().replace(/[^a-z0-9_-]/g,'_');
    const row=arr(await store.select('gslot_policies','select=updated_at,updated_by&id=eq.'+encodeURIComponent(id)+'&limit=1'))[0];
    return !!row && txt(row.updated_by)!==ACTOR && ts(row.updated_at)>0 &&
      ts(clock())-ts(row.updated_at)<RECENT_ADMIN_EDIT_MS;
  }
  async function advance(s,current) {
    const state=Object.assign({phase:'idle',autoTakeover:false,operatorAutoPause:false,rounds:RESEARCH_ROUNDS},current);
    if(state.operatorAutoPause===true)return Object.assign(state,{lastResult:'administrator_automation_paused_checkpoint_preserved'});
    const job=await automation.autoSupplierJobCheckpoint(input(s));
    // Scheduled and manual research now have separate durable job keys. A manual
    // search click may briefly yield to the human, but cannot keep a country
    // blocked forever. Supplier-level holds/pins still prevail downstream.
    if(job.jobId && job.updatedBy!==ACTOR){
      if(job.manualOnly===true)return Object.assign(state,{phase:'manual_preserved',protectedJobId:job.jobId,lastResult:'explicit_manual_only_job_preserved'});
      if(await humanResearchIsActive(s))return Object.assign(state,{phase:'manual_preserved',protectedJobId:job.jobId,lastResult:'recent_administrator_edit_yield_auto_retry'});
      if(job.status==='committed'){
        // The administrator already completed this historical job. Its saved
        // candidates and decisions remain in the ledger; start a fresh round.
        state.lastCommittedJobId=job.jobId;state.jobId=null;state.phase='idle';
      }else if(['searching','inspecting','ranking','complete'].includes(job.status)){
        // Never silently take over an unfinished administrator checkpoint.
        // An explicit takeover flag allows continuation only after the
        // administrator has authorized it; otherwise the same job is retained.
        if(state.autoTakeover!==true)return Object.assign(state,{phase:'manual_preserved',protectedJobId:job.jobId,lastResult:'administrator_research_checkpoint_protected'});
        state.jobId=job.jobId;
        state.phase=job.status==='complete'?'committing':'researching';
        state.lastProgressiveSearchCursor=0;
      }
    }
    if(state.phase==='manual_preserved')state.phase='idle';
    if(state.phase==='cooldown') {
      const eligible=eligibleCycleAt(state);
      if(eligible&&eligible!==ts(state.nextCycleAt))state.nextCycleAt=new Date(eligible).toISOString();
      if(eligible>ts(clock()))return Object.assign(state,{lastResult:'next_research_cycle_scheduled'});
      state.phase='idle';state.jobId=null;state.roundsCompleted=0;
    }
    if(job.jobId && !state.jobId && job.jobId!==state.lastCommittedJobId && job.updatedBy===ACTOR && ['searching','inspecting','ranking','complete','committed'].includes(job.status)) {
      state.jobId=job.jobId;state.phase=job.status==='complete'?'committing':'researching';
    }
    if(state.jobId&&job.jobId&&state.jobId!==job.jobId) {
      if(job.updatedBy===ACTOR){state.jobId=job.jobId;state.phase=['complete','committed'].includes(job.status)?'committing':'researching';}
      else return Object.assign(state,{phase:'manual_preserved',protectedJobId:job.jobId,lastResult:'research_job_changed_during_step_retry_next_tick'});
    }
    if(state.phase==='idle') {
      await recheck(s);
      const started=await automation.beginResearchJob(ACTOR,input(s,{researchRounds:RESEARCH_ROUNDS_PER_JOB,researchRoundIndex:Math.min(RESEARCH_ROUNDS,Number(state.roundsCompleted||0)+1)}));
      if(!txt(started&&started.jobId))throw new Error('supplier_research_start_without_job');
      return Object.assign(state,{jobId:started.jobId,lastProgressiveSearchCursor:0,lastResearchStage:txt(started.status),phase:['complete','committed'].includes(started.status)?'committing':'researching',rounds:RESEARCH_ROUNDS,startedAt:started.startedAt||clock(),lastResult:'five_round_supplier_research_started_round_'+String(Math.min(RESEARCH_ROUNDS,Number(state.roundsCompleted||0)+1))});
    }
    if(state.phase==='researching') {
      if(job.status==='complete'||job.status==='committed')return Object.assign(state,{phase:'committing',lastResult:'supplier_research_complete'});
      // During long multi-query discovery, persist verified PRIVATE leads in
      // small batches instead of waiting for every query of all five rounds.
      // This never truncates searchTasks or advances the completed-round count.
      if(job.status==='searching' && job.updatedBy===ACTOR && Number(job.searchCursor||0)>0 &&
         Number(job.searchCursor||0)>=Number(state.lastProgressiveSearchCursor||0)+2 &&
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
      const outcome=job.status==='searching'?providerOutcome(result,job.searchCursor):null;
      let lastResult='supplier_step_'+txt(result.status);
      if(outcome){
        state.lastProvider=Object.assign({at:clock()},outcome);
        if(outcome.status==='ok'){
          state.providerSuccesses=Number(state.providerSuccesses||0)+1;
          lastResult=outcome.count?'supplier_provider_results_saved_in_research_checkpoint':'supplier_provider_no_usable_results';
        }else if(outcome.status==='empty'){
          lastResult='supplier_provider_empty_continue';
        }else{
          state.providerFailures=Number(state.providerFailures||0)+1;
          state.errors=arr(state.errors).concat([{at:clock(),phase:'researching',provider:outcome.provider,error:'provider_'+outcome.status}]).slice(-24);
          lastResult='supplier_provider_'+outcome.status+'_step_saved';
          // A provider quota limit is not permission to launch more queries
          // immediately. Yield this COUNTRY for 10 minutes; other countries
          // retain their own independent rotation and progress.
          if(/^(?:http_429|rate_limit|quota_exceeded)$/.test(outcome.status))
            state.nextRetryAt=new Date(ts(clock())+10*60*1000).toISOString();
          else if(/^(?:http_408|http_500|http_502|http_503|http_504|timeout|typeerror|network_error|fetch_failed)$/.test(outcome.status))
            state.nextRetryAt=new Date(ts(clock())+2*60*1000).toISOString();
          // Missing/disabled provider credentials use an independent Sanmaru
          // lane; do not postpone the fallback on those deterministic errors.
        }
      }
      return Object.assign(state,{phase:['complete','committed'].includes(result.status)?'committing':'researching',
        lastResult,lastResearchStage:txt(result.status)});
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
      const owned=await automation.autoSupplierJobCheckpoint(input(s));
      // An exhausted search may legitimately contain zero new candidates.
      // commitResearchJob is intentionally not called in that case; its
      // checkpoint stays "complete" rather than "committed". Count this as a
      // finished EMPTY round, not an operator takeover or a permanent error.
      const emptyComplete=Number(job.candidateCount||0)===0&&owned.status==='complete';
      if(owned.jobId!==state.jobId||owned.updatedBy!==ACTOR||
         (!emptyComplete&&owned.status!=='committed')){
        // An administrator may have committed/updated the same job between
        // checkpoints. Preserve it and start a new scheduler cycle later,
        // rather than repeatedly failing the country on a 409 handover.
        return Object.assign(state,{phase:'manual_preserved',jobId:null,
          protectedJobId:owned.jobId||state.jobId,
          lastResult:'supplier_checkpoint_changed_before_durable_handoff'});
      }
      const completedRounds=Math.min(RESEARCH_ROUNDS,Math.max(0,Number(state.roundsCompleted||0))+Math.max(1,Number(job.researchRounds||1)));
      const recorded=await automation.recordScheduledSupplierCompletion(input(s,{
        jobId:state.jobId,recordedSuppliers:savedCount,supplierRoundsCompleted:completedRounds}));
      const have=Number(recorded&&recorded.activeSupplierCount||0);
      const qualified=Number(recorded&&recorded.qualifiedSupplierCount||0);
      // The supplier crawl also revisits markets while their PRIVATE 20-section
      // board is under target, independent of the ordinary 84-hour refresh.
      let fill={unavailable:true};
      if(have){try{fill=await require('./commerce-country-auto-product-pipeline.v1').makePipeline().sectionFill(s);}catch(error){fill={unavailable:true,error:txt(error&&error.message||error)};}}
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
      // Weekly twice is MAINTENANCE only after ALL real 20-section private
      // placements are at target. Underfilled markets automatically begin
      // another durable five-round cycle. Exhausted/empty providers receive a
      // modest quota-safe retry gap; no browser session is needed.
      const supplierTarget=s.countryCode==='US'?200:100;
      const full=qualified>=supplierTarget;
      const gap=full?SUPPLIER_REFRESH_MS:(have?UNDERFILLED_RETRY_MS:NO_RESULT_RETRY_MS);
      return Object.assign(state,{phase:'cooldown',lastCommittedJobId:committedJobId,roundsCompleted:completedRounds,completedAt:clock(),sectionFill:fill,
        fillPhase:full?'maintenance':'initial_fill',targetReached:full,supplierTarget,qualifiedSupplierCount:qualified,
        nextCycleAt:new Date(ts(clock())+gap).toISOString(),
        lastResult:full?'private_board_full_weekly_twice_maintenance':have?'private_board_underfilled_continue_after_source_retry':'no_verified_supplier_continue_after_provider_retry',committedSuppliers:savedCount,activeSupplierCount:have});
    }
    return Object.assign(state,{phase:'idle',lastResult:'supplier_unknown_phase_safely_reset'});
  }
  async function runScope(s) {
    const claimed=await claim(s);if(!claimed)return{scope:key(s),skipped:'already_running'};
    let state=Object.assign({},claimed.rule),failure=null,stopped=false,steps=0;
    try {
      // Netlify gives scheduled invocations 30 seconds. Run a second bounded
      // search/inspection step ONLY if the first checkpoint was cheap, preserving
      // room for the database release on the slowest country.
      // No unbounded tight loop, and a provider 429 is never retried in-tick.
      const begin=Date.now(),startedIdle=state.phase==='idle';
      for(let i=0;i<2;i++){
        // A cheap job-init may precede one search. Never chain two provider,
        // inspection, AI ranking or ledger writes into one 30s invocation.
        if(i>0&&(!startedIdle||Date.now()-begin>3500||state.phase!=='researching'||
          state.lastResearchStage==='ranking'||state.operatorAutoPause===true||
          ts(state.nextRetryAt)>ts(clock())))break;
        await recheck(s);
        state=await advance(s,state);steps++;
        // Keep a deliberate provider backoff (e.g. HTTP 429) even when the
        // research cursor was saved. Only clear an EXPIRED prior retry timer.
        if(ts(state.nextRetryAt)<=ts(clock()))state.nextRetryAt=null;
        if(['manual_preserved','cooldown'].includes(state.phase)||state.operatorAutoPause===true)break;
      }
    }
    catch(e) {
      failure=txt(e&&e.message||e);
      stopped=!!(e&&e.stopped);
      state.lastResult=stopped?'country_paused_without_data_loss':'supplier_step_failed_checkpoint_preserved';
      if(!(e&&e.stopped)){
        // Persist the SAME job/cursor. Retry 429/403 less aggressively without
        // pausing other countries or mistaking an API outage for a full board.
        const wait=/\b429\b|rate.limit|quota/i.test(failure)?10*60*1000:
          /\b403\b|permission.denied|no.access/i.test(failure)?20*60*1000:2*60*1000;
        state.nextRetryAt=new Date(ts(clock())+wait).toISOString();
      }
      if(!stopped)state.errors=arr(state.errors).concat([{at:clock(),phase:state.phase,error:failure}]).slice(-24);
    }
    const stored=await release(s,claimed,state);
    // An administrator STOP during an invocation is expected cancellation,
    // not a failed scheduled function for every other country in the batch.
    return{scope:key(s),ok:!failure||stopped,stopped,phase:stored.phase,jobId:stored.jobId||null,
      rounds:stored.rounds,lastResult:stored.lastResult,stepsAdvanced:steps,error:stopped?null:failure,
      lastProvider:stored.lastProvider||null,providerSuccesses:Number(stored.providerSuccesses||0),
      providerFailures:Number(stored.providerFailures||0),progressivePersisted:Number(stored.progressivePersisted||0),
      activeSupplierCount:Number(stored.activeSupplierCount||0),qualifiedSupplierCount:Number(stored.qualifiedSupplierCount||0),
      nextRetryAt:stored.nextRetryAt||null,publicPublication:false};
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
    const choices=active.filter(s=>{const state=previous.get(idFor(s))||{};
      return state.operatorAutoPause!==true &&
        !(state.phase==='cooldown'&&eligibleCycleAt(state)>ts(clock())) &&
        !(ts(state.nextRetryAt)>ts(clock()));})
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
