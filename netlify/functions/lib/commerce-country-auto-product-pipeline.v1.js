'use strict';

// Country/IP-scoped continuation of scheduled supplier discovery:
// product discovery -> inspection -> private candidate queue -> private PSOM.
// The existing administrator/manual flow and Front Match are never invoked.
const crypto = require('crypto');
const Automation = require('./commerce-country-automation.v1');
const Store = require('./global-slot-console-supabase');
const MarketSaleScope = require('./market-sale-scope.v1');

const VERSION = 'igdc-country-product-ai-private-pipeline.v1';
const HUB = 'country-product-ai-private-pipeline';
const ACTOR = 'scheduled-country-product-ai';
const LEASE_MS = 3 * 60 * 1000; // Country checkpoint resumes after a killed invocation.
const RECENT_ADMIN_EDIT_MS = 90 * 1000; // Only a short concurrency yield for administrator edits.
const MAX_SCOPES = 3; // Fair rotation across active markets; bounded by each country lease.
// Stage 1 is research -> latest research / private shared candidate ledger.
// PSOM section placement is deliberately reserved for the administrator's
// separate approval/section workflow; NEVER run it in this scheduled worker.
const MIN_SUPPLIER_SOURCES = 10;
const CANDIDATE_SCAN = 24;
// Private country board targets: first 20 verified candidates per section,
// then build to 100. Never create fake candidates to meet those targets.
const MIN_PER_SECTION = 20;
const TARGET_PER_SECTION = 100;
// After a complete product-source pass, underfilled private boards remain
// in initial-fill mode. Revisit fresh sources promptly (with bounded provider
// backoff), not at the 84-hour maintenance cadence reserved for full boards.
const REFRESH_UNDERFILLED_MS = 15 * 60 * 1000;
const REFRESH_FULL_MS = 84 * 60 * 60 * 1000;
const SECTION_KEYS = Object.freeze([
  'home|home_1','home|home_2','home|home_3','home|home_4','home|home_5','home|home_6',
  'home|home_right_top','home|home_right_middle','home|home_right_bottom',
  'distribution|distribution-recommend','distribution|distribution-trending',
  'distribution|distribution-sponsor','distribution|distribution-new',
  'distribution|distribution-special','distribution|distribution-others',
  'distribution|distribution-extra','distribution|distribution-right',
  'network|network-right','social|rightPanel','tour|tour'
]);
const MAX_REPORT_ERRORS = 40;
const SOURCE_REF = 'country-product-ranking-review';
const STOPPED = new Set(['off', 'paused']);
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function arr(v) { return Array.isArray(v) ? v : []; }
function txt(v) { return v == null ? '' : String(v).trim(); }
function stamp() { return new Date().toISOString(); }
function ts(v) { return Date.parse(txt(v)) || 0; }
function idFor(scope) { return 'igdc_product_private_auto_' + txt(scope.countryCode).toLowerCase() + '_' + txt(scope.subdivisionCode || 'NATIONWIDE').toLowerCase().replace(/[^a-z0-9_-]/g, '_'); }
function region(scope) { return txt(scope.subdivisionCode || 'NATIONWIDE').toUpperCase(); }
function inputFor(scope, extra) { return Object.assign({ countryCode: scope.countryCode, subdivisionCode: region(scope) }, extra || {}); }
function safeErrors(before, input) { return arr(before).concat([input]).slice(-MAX_REPORT_ERRORS); }
function isActive(scope, live) { return arr(live && live.scopes).some(s => s.countryCode === scope.countryCode && region(s) === region(scope)); }
function scopeKey(scope) { return scope.countryCode + '|' + region(scope); }
function configuredScopeMap(plan) { return new Map(arr(plan && plan.scopes).map(s => [scopeKey(s), s])); }
// Normalize a persisted six-hour gap from older deployments, while keeping
// the original checkpoint and the full-board 84-hour maintenance window.
function eligibleRefreshAt(state) {
  const saved=ts(obj(state).nextRefreshAt),finished=ts(obj(state).completedAt)||ts(obj(state).lastStepAt);
  if(!saved||!finished||obj(obj(state).sectionFill).fullTargetComplete===true)return saved;
  return Math.min(saved,finished+REFRESH_UNDERFILLED_MS);
}

function makePipeline(deps) {
  const automation = (deps && deps.automation) || Automation;
  const store = (deps && deps.store) || Store;
  const clock = (deps && deps.clock) || stamp;

  async function rows() {
    const all=[],page=500;
    for(let offset=0;offset<10000;offset+=page){
      const slice=arr(await store.select('gslot_policies','select=id,rule,updated_at&scope_hub=eq.'+HUB+'&order=id.asc&limit='+page+'&offset='+offset));
      all.push(...slice);if(slice.length<page)return all;
    }
    throw new Error('product_auto_checkpoint_page_limit');
  }
  async function rowFor(id) {
    return arr(await store.select('gslot_policies', 'select=id,rule,updated_at&id=eq.' + encodeURIComponent(id) + '&limit=1'))[0] || null;
  }
  async function ensureRow(scope) {
    const id = idFor(scope);
    const rule = { schema: VERSION, scope: { countryCode: scope.countryCode, subdivisionCode: region(scope) }, phase: 'idle', jobId: null, autoTakeover:false, lastStepAt: null, pendingPlacementIds: [], errors: [], leaseToken: null, leaseUntil: null };
    await store.insert('gslot_policies', { id, name: '국가별 상품 리서치·PSOM 비공개 자동화', scope_hub: HUB, scope_country: scope.countryCode, scope_region: region(scope) === 'NATIONWIDE' ? null : region(scope), enabled: true, rule, created_at: clock(), updated_at: clock(), updated_by: ACTOR }, 'resolution=ignore-duplicates,return=minimal');
    return rowFor(id);
  }
  async function claim(scope) {
    const id = idFor(scope);
    const previous = await rowFor(id) || await ensureRow(scope);
    if (!previous) throw new Error('auto_product_checkpoint_unavailable:' + id);
    const rule = obj(previous.rule), now = new Date(Math.max(ts(clock()),ts(previous.updated_at)+1)).toISOString();
    if (ts(rule.leaseUntil) > ts(now)) return null;
    const token = crypto.randomBytes(12).toString('hex');
    // updated_at optimistic compare-and-swap: two Netlify invocations may see
    // the same checkpoint but only one is permitted to claim this IP scope.
    const changed = arr(await store.update('gslot_policies', 'id=eq.' + encodeURIComponent(id) + '&updated_at=eq.' + encodeURIComponent(txt(previous.updated_at)), {
      rule: Object.assign({}, rule, { leaseToken: token, leaseUntil: new Date(ts(now) + LEASE_MS).toISOString() }), updated_at: now, updated_by: ACTOR
    }));
    if (changed.length !== 1 || txt(obj(changed[0].rule).leaseToken) !== token) return null;
    return { token, updatedAt: txt(changed[0].updated_at) || now, rule: obj(changed[0].rule) };
  }
  async function release(scope, claimInfo, updated) {
    const data = Object.assign({}, obj(updated), { schema: VERSION, scope: { countryCode: scope.countryCode, subdivisionCode: region(scope) }, leaseToken: null, leaseUntil: null, lastStepAt: clock() });
    const nextRevision = new Date(Math.max(ts(clock()),ts(claimInfo.updatedAt)+1)).toISOString();
    const saved = arr(await store.update('gslot_policies', 'id=eq.' + encodeURIComponent(idFor(scope)) + '&updated_at=eq.' + encodeURIComponent(claimInfo.updatedAt), { rule: data, updated_at: nextRevision, updated_by: ACTOR }));
    if (saved.length !== 1) throw new Error('auto_product_checkpoint_revision_conflict:' + idFor(scope));
    return data;
  }
  async function recheck(scope) {
    const live=await automation.autoScopeStatus(inputFor(scope));
    if(live.active!==true)throw Object.assign(new Error('country_automation_paused_before_write:'+txt(live.reason)),{stopped:true});
  }
  // A manually STARTED product search is not a country-wide stop. Preserve
  // actual administrator decisions in the downstream candidate/PSOM guards.
  async function humanResearchIsActive(scope) {
    const id='igdc_product_research_job_'+txt(scope.countryCode).toLowerCase()+'_'+region(scope).toLowerCase().replace(/[^a-z0-9_-]/g,'_');
    const row=arr(await store.select('gslot_policies','select=updated_at,updated_by&id=eq.'+encodeURIComponent(id)+'&limit=1'))[0];
    return !!row && txt(row.updated_by)!==ACTOR && ts(row.updated_at)>0 &&
      ts(clock())-ts(row.updated_at)<RECENT_ADMIN_EDIT_MS;
  }
  function candidateMatchesScope(row, scope) {
    const payload = obj(row.source_payload), market = obj(payload.marketScope), supply = obj(payload.countrySupply);
    return txt(row.source_ref) === SOURCE_REF && txt(row.created_by) === ACTOR &&
      txt(market.marketCountry).toUpperCase() === scope.countryCode &&
      txt(market.marketRegion || 'NATIONWIDE').toUpperCase() === region(scope) &&
      txt(supply.country).toUpperCase() === scope.countryCode &&
      txt(supply.region || 'NATIONWIDE').toUpperCase() === region(scope);
  }
  function candidateNewForJob(row, scope, state) {
    return candidateMatchesScope(row, scope) && !!ts(state.autoJobStartedAt) && ts(row.created_at) >= ts(state.autoJobStartedAt) &&
      txt(obj(row.source_payload).slotDecision || 'undecided').toLowerCase() === 'undecided' &&
      obj(obj(row.source_payload).queueControl).permanentExcluded !== true &&
      obj(obj(row.source_payload).managementControl).administratorLocked !== true;
  }
  async function verifiedNewIds(scope, state, ids) {
    const unique = [...new Set(arr(ids).map(txt).filter(Boolean))].slice(0,100);
    if (!unique.length) return [];
    const rows = arr(await store.select('gslot_candidates', 'select=id,source_ref,created_by,created_at,source_payload&id=in.(' + unique.map(encodeURIComponent).join(',') + ')&limit=100'));
    return rows.filter(r => candidateNewForJob(r, scope, state)).map(r => txt(r.id));
  }
  async function nextAutoCandidateBatch(scope, state) {
    // Stable ID cursor (rather than OFFSET): PSOM changes candidate status,
    // but cannot cause the next scan to skip an earlier row.
    const query = 'select=id,source_ref,created_by,created_at,source_payload' +
      '&source_ref=eq.' + encodeURIComponent(SOURCE_REF) + '&created_by=eq.' + encodeURIComponent(ACTOR) +
      '&source_payload->marketScope->>marketCountry=eq.' + encodeURIComponent(scope.countryCode) +
      '&source_payload->marketScope->>marketRegion=eq.' + encodeURIComponent(region(scope)) +
      (txt(state.reconcileCursor) ? '&id=gt.' + encodeURIComponent(state.reconcileCursor) : '') +
      '&order=id.asc&limit=' + CANDIDATE_SCAN;
    const rows = arr(await store.select('gslot_candidates', query));
    const eligible = rows.filter(r => candidateNewForJob(r, scope, state)).map(r => txt(r.id));
    return { ids: eligible, cursor: rows.length ? txt(rows[rows.length-1].id) : txt(state.reconcileCursor), complete: rows.length < CANDIDATE_SCAN };
  }
  async function sectionCounts(scope) {
    const counts = {}, visited = new Set(), page = 300, max = 9000;
    // Canonical assignment ledger is already partitioned by country and
    // region. An unavailable or overlarge scan fails closed (no placement).
    for (let offset=0; offset<max; offset+=page) {
      const query = 'select=id,hub_key,slot_key,region_code,country_code,state' +
        '&country_code=eq.' + encodeURIComponent(scope.countryCode) + '&order=id.asc&limit=' + page + '&offset=' + offset;
      const rows = arr(await store.select('gslot_slot_assignments', query));
      for (const a of rows) {
        if (visited.has(txt(a.id)) || txt(a.country_code).toUpperCase() !== scope.countryCode || !['approved','pinned'].includes(txt(a.state).toLowerCase())) continue;
        const r = MarketSaleScope.normalizeRegion(a.region_code || 'NATIONWIDE', scope.countryCode) || 'NATIONWIDE';
        if (r !== region(scope)) continue;
        visited.add(txt(a.id));
        const key = txt(a.hub_key) + '|' + txt(a.slot_key);
        counts[key] = Number(counts[key] || 0) + 1;
      }
      if (rows.length < page) return counts;
    }
    throw new Error('auto_psom_country_assignment_scan_limit');
  }

  async function sectionFill(scope) {
    const counts = await sectionCounts(scope);
    const under20=SECTION_KEYS.filter(k=>Number(counts[k]||0)<MIN_PER_SECTION);
    const under100=SECTION_KEYS.filter(k=>Number(counts[k]||0)<TARGET_PER_SECTION);
    return{totalSections:SECTION_KEYS.length,firstStagePerSection:MIN_PER_SECTION,fullTargetPerSection:TARGET_PER_SECTION,
      firstStageComplete:under20.length===0,fullTargetComplete:under100.length===0,
      under20,under100,counts};
  }
  // A human may explicitly authorize auto-continuation AFTER an already
  // completed manual job. Active manual jobs and their individual products
  // remain protected; this does not unlock any administrator-pinned listing.
  async function setTakeover(actor,scope,enabled) {
    if(!txt(actor))throw new Error('administrator_required');
    const prior=await rowFor(idFor(scope))||await ensureRow(scope);
    if(!prior)throw new Error('product_auto_takeover_checkpoint_unavailable');
    if(ts(obj(prior.rule).leaseUntil)>ts(clock()))throw Object.assign(new Error('상품 자동 조사 진행 중입니다. 단계 종료 후 다시 선택해 주세요.'),{statusCode:409});
    const t=new Date(Math.max(ts(clock()),ts(prior.updated_at)+1)).toISOString();
    const next=Object.assign({},obj(prior.rule),{autoTakeover:enabled===true,operatorAutoPause:enabled!==true,phase:enabled===true&&obj(prior.rule).phase==='manual_job_preserved'?'idle':obj(prior.rule).phase,changedAt:t,changedBy:txt(actor)});
    const rows=arr(await store.update('gslot_policies','id=eq.'+encodeURIComponent(idFor(scope))+'&updated_at=eq.'+encodeURIComponent(txt(prior.updated_at)),{rule:next,updated_at:t,updated_by:txt(actor)}));
    if(rows.length!==1)throw Object.assign(new Error('상품 자동화 전환 설정 저장 충돌'),{statusCode:409});
    return{ok:true,scope:scopeKey(scope),autoTakeover:next.autoTakeover,manualProductsPreserved:true,automaticFrontMatch:false};
  }
  async function advance(scope, before) {
    const state = Object.assign({ phase:'idle', pendingPlacementIds:[], errors:[], placed:0, reviewRequired:0 }, before);
    if(state.operatorAutoPause===true)return Object.assign(state,{lastResult:'administrator_automation_paused_checkpoint_preserved'});
    const checkpoint = await automation.autoProductJobCheckpoint(inputFor(scope));
    const thisJob = txt(state.jobId);
    const isOwned = thisJob && checkpoint.jobId === thisJob;
    if (checkpoint.paused && !(state.autoTakeover && ['complete','committed'].includes(checkpoint.status))) return Object.assign(state,{ lastResult:'research_manually_paused_preserved' });
    if(checkpoint.jobId && checkpoint.updatedBy && checkpoint.updatedBy!==ACTOR){
      if(await humanResearchIsActive(scope))return Object.assign(state,{phase:'manual_job_preserved',lastResult:'recent_administrator_edit_yield_auto_retry',protectedJobId:checkpoint.jobId});
    }
    if(checkpoint.jobId && !isOwned){
      // Resume the exact existing job/cursor. A human clicking Start does not
      // disable all other research for that country; never delete that job.
      state.jobId=checkpoint.jobId;
      state.autoJobStartedAt=checkpoint.startedAt||clock();
      state.phase=['complete','committed'].includes(checkpoint.status)?'staging':'researching';
      state.lastStagedResultCount=0;
      state.pendingPlacementIds=[];
      state.reconcileCursor='';
    }else if(state.phase==='manual_job_preserved'){
      // The 90-second manual edit window expired. Resume existing work.
      state.phase=['complete','committed'].includes(checkpoint.status)?'staging':'researching';
    }
    if (state.phase === 'complete') {
      const active = configuredScopeMap(await automation.autoProductScopes()).get(scopeKey(scope));
      const supplierUpdated = ts(active && active.supplierLastRunAt) > ts(state.lastSupplierRunAt);
      const nextEligible=eligibleRefreshAt(state);
      if(nextEligible&&nextEligible!==ts(state.nextRefreshAt))state.nextRefreshAt=new Date(nextEligible).toISOString();
      const refreshDue = !nextEligible || ts(clock())>=nextEligible;
      if(!supplierUpdated&&!refreshDue)return Object.assign(state,{lastResult:'awaiting_new_supplier_or_next_gap_refresh'});
      // Refresh even the same durable supplier portfolio when section slots
      // are underfilled; existing manual and canonical assignments remain held.
      state.fullRescanNeeded=refreshDue;
      state.phase='idle';state.jobId=null;state.reconcileCursor='';state.pendingPlacementIds=[];
    }
    if (!state.jobId || state.phase === 'idle') {
      const selected = configuredScopeMap(await automation.autoProductScopes()).get(scopeKey(scope));
      if (!txt(selected && selected.supplierLastRunAt)) return Object.assign(state,{phase:'idle',lastResult:'supplier_discovery_not_yet_durably_saved'});
      // The durable supplier marker is not a count. New product jobs wait for
      // ten usable seller sites; current seller research continues in parallel.
      // For legacy settings with unknown count, the server begin function
      // checks the real country-local ledger before starting a new job.
      const observedSuppliers=Number(selected.supplierCount||0);
      // A small market may legitimately have fewer than ten usable suppliers.
      // After a complete five-round survey, use its verified real sellers.
      const surveyed=Number(selected.supplierRoundsCompleted||0)>=5;
      if(observedSuppliers>0&&observedSuppliers<MIN_SUPPLIER_SOURCES&&!surveyed)
        return Object.assign(state,{phase:'idle',lastResult:'waiting_for_ten_usable_suppliers',usableSuppliers:observedSuppliers});
      const minimum=observedSuppliers>0&&surveyed?1:MIN_SUPPLIER_SOURCES;
      await recheck(scope);
      const started = await automation.beginProductResearchJob(ACTOR, inputFor(scope, {compact:true,fullRescan:state.fullRescanNeeded===true,minEligibleSupplierSources:minimum}));
      if (!txt(started && started.jobId)) throw new Error('auto_product_begin_no_job_id');
      // A same-ID completion with zero fresh sources must not restage older
      // products, nor reset the management ledger.
      if(started.jobId===checkpoint.jobId&&started.status==='complete'){
        // A source-empty cycle cannot decide board completion from job status.
        // Recheck the country's actual PRIVATE canonical assignments before
        // choosing between initial-fill retries and 84-hour maintenance.
        const fill=await sectionFill(scope),full=fill.fullTargetComplete===true;
        return Object.assign(state,{phase:'complete',jobId:started.jobId,sectionFill:fill,
          nextRefreshAt:new Date(ts(clock())+(full?REFRESH_FULL_MS:REFRESH_UNDERFILLED_MS)).toISOString(),
          fillPhase:full?'maintenance':'initial_fill',targetReached:full,
          lastResult:full?'private_board_full_weekly_twice_maintenance':'no_new_product_sources_initial_fill_retry_scheduled'});
      }
      return Object.assign(state, { phase:txt(started.status)==='complete'?'staging':'researching', jobId:started.jobId,autoJobStartedAt:started.startedAt||clock(),lastSupplierRunAt:selected.supplierLastRunAt,fullRescanNeeded:false,reconcileCursor:'',pendingPlacementIds:[],stagingComplete:false,lastStagedResultCount:0,nextPhaseAfterPlacement:null,lastResult:'product_research_started' });
    }
    if (state.phase === 'researching') {
      if (checkpoint.status === 'complete') return Object.assign(state, {phase:'staging',lastResult:'research_complete_pending_private_staging'});
      // Verified products already inspected are eligible for PRIVATE staging
      // while the same country job continues researching other suppliers.
      if (Number(checkpoint.resultCount||0)>Number(state.lastStagedResultCount||0)) {
        await recheck(scope);
        const staged=await automation.stageCurrentProductResearchQueue(ACTOR,inputFor(scope,{jobId:state.jobId,source:'scheduled_auto',operation:'stage'}));
        const part=obj(staged.partialQueue);
        // Saved research results remain visible in Latest Research, and
        // inspected candidates are safely entered in the shared private ledger.
        // Do not automatically select a PSOM section on behalf of the operator.
        return Object.assign(state, {lastStagedResultCount:Number(checkpoint.resultCount||0),
          privateCandidatesStaged:Number(state.privateCandidatesStaged||0)+Number(part.created||0),latestStaging:part,
          awaitingAdminSectionReview:true,phase:'researching',
          lastResult:'latest_research_private_candidates_staged_supplier_crawl_continues'});
      }
      await recheck(scope);
      const step = await automation.advanceProductResearchJob(ACTOR, inputFor(scope,{jobId:state.jobId,compact:true}));
      return Object.assign(state, {phase:txt(step.status)==='complete'?'staging':'researching',lastResult:'research_step_'+txt(step.status)});
    }
    if (state.phase === 'staging') {
      if (checkpoint.status !== 'complete') return Object.assign(state, {phase:'researching',lastResult:'research_not_complete'});
      await recheck(scope);
      const step = await automation.stageCurrentProductResearchQueue(ACTOR,inputFor(scope,{jobId:state.jobId,source:'scheduled_auto',operation:'stage'}));
      const p=obj(step.partialQueue);
      const next=Object.assign(state,{stagingComplete:p.complete===true,
        privateCandidatesStaged:Number(state.privateCandidatesStaged||0)+Number(p.created||0),latestStaging:p,
        awaitingAdminSectionReview:true,lastResult:'latest_research_and_shared_candidate_ledger_updated',phase:'staging'});
      if(p.complete===true){
        const fill=await sectionFill(scope);
        next.phase='complete';next.completedAt=clock();next.sectionFill=fill;
        next.fillPhase=fill.fullTargetComplete?'maintenance':'initial_fill';
        next.targetReached=fill.fullTargetComplete===true;
        next.nextRefreshAt=new Date(ts(clock())+(fill.fullTargetComplete?REFRESH_FULL_MS:REFRESH_UNDERFILLED_MS)).toISOString();
      }
      return next;
    }
    if (state.phase === 'placing' || state.phase === 'reconciling') {
      // Upgrade in-flight checkpoints from older deployments WITHOUT losing
      // any candidate rows: all pending IDs already live in the private ledger.
      // We must not resume an old automatic PSOM placement here.
      return Object.assign(state,{
        phase:checkpoint.status==='complete'?'staging':'researching',
        awaitingAdminSectionReview:true,
        deferredLegacyPsomCandidateIds:Array.from(new Set([
          ...arr(state.deferredLegacyPsomCandidateIds),...arr(state.pendingPlacementIds)
        ].map(txt).filter(Boolean))).slice(-300),
        pendingPlacementIds:[],
        lastResult:'legacy_auto_psom_disabled_candidates_preserved_for_admin_review'
      });
    }
    return Object.assign(state,{phase:'idle',lastResult:'unknown_phase_reset_without_deleting_data'});
  }

  async function runScope(scope) {
    const claimed = await claim(scope);
    if(!claimed) return { scope:scopeKey(scope),skipped:'already_running' };
    let update = Object.assign({},claimed.rule), result='unknown';
    try {
      await recheck(scope);
      update = await advance(scope,update);
      result=txt(update.lastResult);
    } catch (err) {
      if(err && err.stopped) result='paused_checkpoint_preserved';
      else {
        result='step_failed_checkpoint_preserved';
        const reason=txt(err&&err.message||err);
        update.errors = safeErrors(update.errors,{at:clock(),stage:txt(update.phase),reason});
        update.failures=Number(update.failures||0)+1;
        // No eligible seller URL is a recoverable input gap, not a reason to
        // hammer the same empty ledger every two minutes in 90 countries.
        // A new durable supplier marker invalidates the backoff immediately.
        if(/활성 공급업체가 없습니다|공식 판매 출처 URL이 없습니다|supplier_discovery_not_yet_durably_saved|AUTO_PRODUCT_SUPPLIER_THRESHOLD_PENDING/.test(reason)){
          update.nextRetryAt=new Date(ts(clock())+30*60*1000).toISOString();
          update.retrySupplierAt=txt(scope.supplierLastRunAt)||null;
          update.lastErrorReason=reason;
        }
      }
      update.lastResult=result;
    }
    // Stop is never a reset, including if a selected-country pause happens
    // between two DB calls. Keep pending candidate IDs and research cursors.
    await release(scope,claimed,update);
    return { scope:scopeKey(scope),ok:result!=='step_failed_checkpoint_preserved',phase:txt(update.phase),jobId:txt(update.jobId)||null,result,
      placed:Number(update.placed||0),privateCandidatesStaged:Number(update.privateCandidatesStaged||0),
      awaitingAdminSectionReview:update.awaitingAdminSectionReview===true,
      reviewRequired:Number(update.reviewRequired||0),pendingPlacement:arr(update.pendingPlacementIds).length,
      sectionFill:obj(update.sectionFill),nextRefreshAt:update.nextRefreshAt||null,fillPhase:txt(update.fillPhase)||null,
      targetReached:update.targetReached===true,automaticPsomPlacement:false,publicPublication:false };
  }
  async function run() {
    const plan=await automation.autoProductScopes();
    if(!arr(plan.scopes).length)return {ok:true,version:VERSION,masterMode:plan.mode,activeScopes:0,processed:0,results:[],safety:{stoppedDoesNotDelete:true,publicPublication:false}};
    const previous=new Map((await rows()).map(row=>[txt(row.id),obj(row.rule)]));
    const choices=arr(plan.scopes).filter(s=>{
      // Legacy hourly lastRunAt is not proof of inspected, durable suppliers.
      // Wait for supplier worker's verified country-local completion marker
      // before creating any NEW product checkpoint or starting product search.
      const st=previous.get(idFor(s))||{};
      // An existing manually-started product job may continue its private
      // research even when a supplier completion timestamp is not yet present.
      if (!txt(s.supplierLastRunAt) && !txt(st.jobId)) return false;
      if(st.operatorAutoPause===true)return false;
      if(ts(st.nextRetryAt)>ts(clock())&&
         ts(s.supplierLastRunAt)<=ts(st.retrySupplierAt))return false;
      // Do not repeatedly poll a completed market while nothing changed.
      const supplier=arr(plan.scopes).find(p=>scopeKey(p)===scopeKey(s));
      if(st.phase==='complete'&&eligibleRefreshAt(st)>ts(clock())&&ts(supplier&&supplier.supplierLastRunAt)<=ts(st.lastSupplierRunAt))return false;
      return true;
    }).sort((a,b)=>ts(previous.get(idFor(a))&&previous.get(idFor(a)).lastStepAt)-ts(previous.get(idFor(b))&&previous.get(idFor(b)).lastStepAt)||scopeKey(a).localeCompare(scopeKey(b))).slice(0,MAX_SCOPES);
    // Independent country leases permit bounded parallel research without
    // waiting for the previous country to complete a slow product inspection.
    // This does not change the scheduled function's 30-second limit.
    const settled=await Promise.allSettled(choices.map(runScope));
    const results=settled.map((item,index)=>item.status==='fulfilled'?item.value:{
      scope:scopeKey(choices[index]),ok:false,error:txt(item.reason&&item.reason.message||item.reason)
    });
    return {ok:results.every(r=>r.ok!==false),version:VERSION,masterMode:plan.mode,activeScopes:plan.scopes.length,processed:results.length,results,safety:{countryIndependent:true,priorResearchAndAssignmentsPreserved:true,automaticPrivateCandidateStaging:true,automaticPsomPlacement:false,automaticFrontMatch:false,automaticPublication:false,administratorApprovalRequired:true}};
  }
  return { run, runScope, claim, release, advance, setTakeover, sectionFill, idFor };
}

module.exports={VERSION,ACTOR,makePipeline,run:()=>makePipeline().run(),setTakeover:(actor,scope,enabled)=>makePipeline().setTakeover(actor,scope,enabled)};
