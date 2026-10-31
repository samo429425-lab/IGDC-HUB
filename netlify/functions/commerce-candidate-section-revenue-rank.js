"use strict";
// Revenue-first ordering of already placed candidates. NEVER edits placements or publication.
const Auth=require('./lib/global-slot-console-auth');
const Store=require('./lib/global-slot-console-supabase');
const Market=require('./lib/market-sale-scope.v1');
const crypto=require('crypto');
const VERSION='igdc-section-revenue-order-v1.3.0-visible-three-step-preview';
const ROLE=new Set(['owner','admin','super_admin','site_manager','site_manager_director','director']);
const KEYS=new Set([
'home|home_1','home|home_2','home|home_3','home|home_4','home|home_5','home|home_6','home|home_right_top','home|home_right_middle','home|home_right_bottom',
'distribution|distribution-recommend','distribution|distribution-trending','distribution|distribution-sponsor','distribution|distribution-new','distribution|distribution-special','distribution|distribution-others','distribution|distribution-extra','distribution|distribution-right','network|network-right','social|rightPanel','tour|tour'
]);
function str(x){return x==null?'':String(x).trim();}
function obj(x){return x&&!Array.isArray(x)&&typeof x==='object'?x:{};}
function err(message,code=400){const e=new Error(message);e.statusCode=code;throw e;}
function reply(code,data){return{statusCode:code,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'},body:JSON.stringify(data)};}
function parse(event){try{return JSON.parse(event&&event.body||'{}');}catch(e){err('JSON 요청을 읽지 못했습니다.');}}
function normScope(input){const country=Market.normalizeCountry(str(input.countryCode).toUpperCase());if(!country)err('국가 코드를 확인하세요.');const region=Market.normalizeRegion(str(input.subdivisionCode||'NATIONWIDE'),country)||'NATIONWIDE';return{country,region};}
function groupScope(scope,key){return scope.country+'|'+scope.region+'|'+key;}
function segment(key){let i=key.indexOf('|');return{page:key.slice(0,i),section:key.slice(i+1)};}
function verifiedCommercialClass(payload){
 const selection=obj(payload.candidateSelection),context=obj(payload.commerceCandidate),proof=obj(selection.profitabilityAssessment);
 if(selection.releaseEligible!==true||context.releaseEligible!==true||!str(selection.selectionDigest)||!str(selection.sourceTier))return'ORDINARY';
 const klass=str(selection.commercialPriorityClass).toUpperCase();
 if(['DIRECT_COMMERCE_VERIFIED','FORMAL_PARTNER','AFFILIATE_ACTIVE','DIRECT_SPONSOR','REFERRAL_VERIFIED','VERIFIED_REVENUE_ROUTE'].includes(klass)&&proof.gatePassed!==true)return'ORDINARY';
 if(klass==='AD_INVENTORY_READY'&&proof.commercialClass!==klass)return'ORDINARY';
 return klass;
}
const TIER={DIRECT_COMMERCE_VERIFIED:700,FORMAL_PARTNER:650,AFFILIATE_ACTIVE:600,DIRECT_SPONSOR:550,REFERRAL_VERIFIED:500,VERIFIED_REVENUE_ROUTE:450,AD_INVENTORY_READY:100,TRAFFIC_VALUE_ONLY:65,AD_OPPORTUNITY:50,ORDINARY:40,REVENUE_ROUTE_HOLD:25,NON_REVENUE:20,FALLBACK:10};
function rating(row,scope,key){
 const payload=obj(row.payload),cls=verifiedCommercialClass(payload),revenue=obj(payload.revenue),management=obj(payload.sectionRevenueOverride),override=management.scopeKey===groupScope(scope,key)?str(management.mode):'';
 // An unverified affiliate route is an opportunity, NOT a verified paid partnership.
 const opportunity=['affiliate_connection_required','referral_pending','affiliate_pending','advertising_possible'].includes(str(revenue.monetizationState).toLowerCase());
 const tier=TIER[cls]===undefined?40:TIER[cls],effectiveTier=cls==='ORDINARY'&&opportunity?50:tier;
 const ranks=obj(payload.ranking),score=Number(ranks.finalScore||ranks.score||payload.rankingScore||0);
 return{candidateId:row.id,title:str(row.title),sectionKey:key,override:['pin_top','demote'].includes(override)?override:'',pinnedAt:str(management.pinnedAt),tier:effectiveTier,className:cls,score:Number.isFinite(score)?score:0,originalPriority:Number(row.assignment.priority||0),assignmentId:str(row.assignment.id),createdAt:str(row.assignment.created_at)};
}
function compare(a,b){
 const pinnedA=a.override==='pin_top',pinnedB=b.override==='pin_top';
 if(pinnedA!==pinnedB)return pinnedA?-1:1;
 // Newest explicit top pin goes first. Revenue rank never displaces a pin.
 if(pinnedA&&pinnedB)return b.pinnedAt.localeCompare(a.pinnedAt)||a.candidateId.localeCompare(b.candidateId);
 return (a.override==='demote'?1:0)-(b.override==='demote'?1:0)||b.tier-a.tier||b.score-a.score||a.candidateId.localeCompare(b.candidateId);
}
function chunks(rows,size){const out=[];for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out;}
async function readAll(scope,keys){
 // Fetch ONLY assignments for the requested sections. The former implementation
 // read every section in 200-row pages, even when previewing one section.
 const scoped=[];const pageSize=200,maxSectionRecords=2000;
 for(const key of keys){
   const part=segment(key);
   for(let offset=0;offset<maxSectionRecords;offset+=pageSize){
     const query='select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,created_at,updated_at'
       +'&country_code=eq.'+encodeURIComponent(scope.country)
       +'&region_code=eq.'+encodeURIComponent(scope.region)
       +'&hub_key=eq.'+encodeURIComponent(part.page)
       +'&slot_key=eq.'+encodeURIComponent(part.section)
       +'&limit='+pageSize+'&offset='+offset+'&order=id.asc';
     const batch=await Store.select('gslot_slot_assignments',query);
     if(!Array.isArray(batch))err('배치 원장 조회 실패',502);
     scoped.push(...batch.filter(row=>['approved','pinned'].includes(str(row.state).toLowerCase())));
     if(batch.length<pageSize)break;
     if(offset+pageSize>=maxSectionRecords)err('해당 섹션 배치 조회 한도를 초과했습니다: '+key,409);
   }
 }
 const ids=[...new Set(scoped.map(x=>str(x.candidate_id)).filter(Boolean))],candidates=new Map();
 const candidateBatches=chunks(ids,35);
 for(const group of chunks(candidateBatches,3)){
   const responses=await Promise.all(group.map(batch=>Store.select('gslot_candidates',
     'select=id,title,status,source_ref,source_payload,updated_at&id=in.('+batch.map(encodeURIComponent).join(',')+')&limit='+batch.length)));
   responses.forEach(result=>{
     if(!Array.isArray(result))err('상품 후보 원장 조회 실패',502);
     result.forEach(row=>candidates.set(str(row.id),row));
   });
 }
 if(candidates.size!==ids.length){
  const missing=ids.filter(id=>!candidates.has(id));
  err('배치 원장에 있으나 후보 원장에 없는 상품이 있습니다. 변경 없이 중단했습니다: '+missing.slice(0,5).join(', ')+(missing.length>5?' 외 '+(missing.length-5)+'건':''),409);
 }
 const groups=new Map([...keys].map(k=>[k,[]])),seen=new Set();
 for(const a of scoped){
   const key=str(a.hub_key)+'|'+str(a.slot_key),candidate=candidates.get(str(a.candidate_id)),payload=obj(candidate&&candidate.source_payload),placed=obj(payload.approvedPlacement||payload.placement||payload.primaryPlacement),placementKey=str(placed.key||((placed.page&&placed.sectionKey||placed.section)?str(placed.page)+'|'+str(placed.sectionKey||placed.section):'')),uniq=groupScope(scope,key)+'|'+str(a.candidate_id);
   if(seen.has(uniq))err('같은 상품의 중복 배치가 확인되었습니다. 자동 삭제 없이 중단했습니다: '+str(a.candidate_id)+' / '+key,409);
   seen.add(uniq);
   if(str(payload.slotDecision)!=='slot_candidate'||placementKey!==key)err('현재 관리자 배치와 원장 배정이 불일치합니다. 변경 없이 중단했습니다: '+str(a.candidate_id)+' [배치 관계='+key+', 상품 관리 배치='+(placementKey||'없음')+', 관리 결정='+(str(payload.slotDecision)||'없음')+']',409);
   if(!['country-product-ranking-review','commerce-candidate-review-api'].includes(str(candidate.source_ref)))err('관리 원장 범위 밖 상품이 배치 관계에 포함됐습니다. 변경 없이 중단했습니다: '+str(a.candidate_id)+' / '+key,409);
   groups.get(key).push({id:str(candidate.id),title:candidate.title,payload,assignment:a,candidateUpdatedAt:candidate.updated_at});
 }
 return groups;
}
async function setOverride(scope,key,id,mode,actor){
 if(!KEYS.has(key))err('섹션 키가 잘못됐습니다.');if(!id)err('상품 ID가 비어 있습니다.');
 const data=await readAll(scope,new Set([key])),item=(data.get(key)||[]).find(r=>r.id===id);if(!item)err('선택 상품이 해당 섹션에 배치되어 있지 않습니다.',409);
 const now=new Date().toISOString(),p=Object.assign({},item.payload),current=obj(p.sectionRevenueOverride),belongs=current.scopeKey===groupScope(scope,key),prior=belongs?str(current.mode):'';
 if(mode==='demote'&&prior==='pin_top')err('고정된 상품은 먼저 관리자 최상단 고정을 해제하세요.',409);
 if(mode==='pin_top'){
  // A new explicit pin supersedes any prior ordinary-automation release.
  delete p.sectionRevenueAutomation;
  p.sectionRevenueOverride={schema:'igdc-section-explicit-top-pin.v1',scopeKey:groupScope(scope,key),mode:'pin_top',pinnedAt:now,decidedBy:actor,decidedAt:now};
 }
 else if(mode==='demote')p.sectionRevenueOverride={schema:'igdc-section-revenue-override.v1',scopeKey:groupScope(scope,key),mode:'demote',decidedBy:actor,decidedAt:now};
 else if(mode==='unpin_top'&&prior!=='pin_top')err('현재 고정 상태가 아니므로 해제할 수 없습니다.',409);
 else if(mode==='restore'&&prior!=='demote')err('현재 후순위 상태가 아닙니다.',409);
 else if(mode==='unpin_top'){
  delete p.sectionRevenueOverride;
  // Release ONLY the explicit top-pin restriction in this market/section.
  // It does not release an unrelated supplier contract or public slot guard.
  p.sectionRevenueAutomation={schema:'igdc-section-ordinary-automation-v1',scopeKey:groupScope(scope,key),ordinaryEligible:true,unpinReleasedAt:now,unpinReleasedBy:actor};
 }
 else if(mode==='restore')delete p.sectionRevenueOverride;
 else err('알 수 없는 관리자 예외 지정',400);
 // Prevent a stale pin/unpin response from replacing a newer administrator decision.
 if(!str(item.candidateUpdatedAt))err('원장 버전을 확인할 수 없어 고정 작업을 중단했습니다.',409);
 const changed=await Store.update('gslot_candidates','id=eq.'+encodeURIComponent(id)+'&updated_at=eq.'+encodeURIComponent(item.candidateUpdatedAt),{source_payload:p,updated_at:now});
 if(!Array.isArray(changed)||!changed.some(row=>str(row.id)===id))err('관리 상태가 변경되었습니다. 새로 조회 후 다시 시도하세요.',409);
 return{candidateId:id,sectionKey:key,override:mode==='pin_top'?'pin_top':mode==='demote'?'demote':'',explicitTopPin:mode==='pin_top'};
}
// Preview values are bound to the country, section, candidate identities, explicit
// pins and the exact database versions observed before committing. A subsequent
// apply re-evaluates all records. No client-supplied rank or product placement is
// ever written directly.
function planDigest(scope,key,ranked){
 const raw=ranked.map((v,i)=>[v.candidateId,i+1,Math.max(1,10000-i-1),v.tier,v.className,v.override,v.pinnedAt,v.score,v.assignmentId]);
 return crypto.createHash('sha256').update(JSON.stringify([groupScope(scope,key),raw])).digest('hex');
}
function versionDigest(scope,key,ranked){
 const raw=ranked.map(v=>[v.candidateId,str(v.row.candidateUpdatedAt),str(v.row.assignment.updated_at)]);
 return crypto.createHash('sha256').update(JSON.stringify([groupScope(scope,key),raw])).digest('hex');
}
async function order(scope,keys,apply,actor,offset=0,expectedPlanHash='',expectedVersionHash=''){
 const groups=await readAll(scope,keys),summaries=[],items=[],plans=[];
 for(const key of keys){const rows=groups.get(key)||[],ranked=rows.map(row=>Object.assign(rating(row,scope,key),{row})).sort(compare);
  ranked.forEach((v,i)=>{
   const rank=i+1,priority=Math.max(1,10000-rank);
   items.push({candidateId:v.candidateId,sectionKey:key,rank,priority,tier:v.tier,className:v.className,override:v.override,pinnedAt:v.pinnedAt,title:v.title,previousPriority:v.originalPriority});
   plans.push({item:v.row,priority,rank,key,tier:v.tier,className:v.className});
  });
  const planHash=planDigest(scope,key,ranked),versionHash=versionDigest(scope,key,ranked);
  // The first commit must match the entire preview. Later chunks must still
  // match the ranking plan; their timestamps legitimately change as we save.
  if(apply&&expectedPlanHash&&planHash!==expectedPlanHash)err('미리보기 이후 상품 순위 또는 관리자 지정이 변경됐습니다. 다시 미리보기를 실행해 주세요.',409);
  if(apply&&offset===0&&expectedVersionHash&&versionHash!==expectedVersionHash)err('미리보기 이후 상품 또는 배치 원장이 변경됐습니다. 다시 미리보기를 실행해 주세요.',409);
  summaries.push({sectionKey:key,count:ranked.length,manualDemoted:ranked.filter(v=>v.override==='demote').length,manualTopPinned:ranked.filter(v=>v.override==='pin_top').length,planHash,versionHash});
 }
 if(!apply)return{preview:true,applied:false,sections:summaries,items};
 const batch=plans.slice(offset,offset+5),now=new Date().toISOString();let saved=0,alreadyComplete=0;
 for(const job of batch){
  const row=job.item,scopeKey=groupScope(scope,job.key),prior=obj(row.payload.sectionRevenueRanking);
  // Each already committed item acts as a durable resume marker: starting an
  // interrupted apply again at offset 0 skips confirmed records, not reorders them.
  if(prior.schema==='igdc-section-revenue-order-v1.0.0'&&prior.scopeKey===scopeKey&&Number(prior.rank)===job.rank&&Number(prior.priority)===job.priority&&Number(row.assignment.priority)===job.priority){alreadyComplete++;continue;}
  const p=Object.assign({},row.payload);
  // Canonical Snapshot publisher accepts this data-contract schema, while the
  // endpoint VERSION may evolve independently. Without this the front ignores ranking.
  p.sectionRevenueRanking={schema:'igdc-section-revenue-order-v1.0.0',scopeKey,rank:job.rank,priority:job.priority,tier:job.tier,className:job.className,rankedAt:now,rankedBy:actor};
  const revision=str(row.candidateUpdatedAt),asgnRevision=str(row.assignment.updated_at);
  if(!revision||!asgnRevision)err('변경 감지를 위한 원장 버전이 없어 순위 적용을 중지했습니다.',409);
  const written=await Store.update('gslot_candidates','id=eq.'+encodeURIComponent(row.id)+'&updated_at=eq.'+encodeURIComponent(revision),{source_payload:p,updated_at:now});
  if(!Array.isArray(written)||!written.some(x=>str(x.id)===row.id))err('관리자 변경이 감지되어 순위 적용을 중단했습니다. 다시 실행하면 저장된 항목은 건너뜁니다.',409);
  const assigned=await Store.update('gslot_slot_assignments','id=eq.'+encodeURIComponent(row.assignment.id)+'&candidate_id=eq.'+encodeURIComponent(row.id)+'&updated_at=eq.'+encodeURIComponent(asgnRevision),{priority:job.priority,updated_at:now,updated_by:actor});
  if(!Array.isArray(assigned)||!assigned.some(x=>str(x.id)===str(row.assignment.id)))err('배치 원장 충돌로 순위 적용이 중단되었습니다. 다시 실행하면 완료 항목은 건너뜁니다.',409);
  saved++;
 }
 const nextOffset=offset+batch.length;
 return{preview:false,applied:nextOffset>=plans.length,saved,alreadyComplete,sections:summaries,items,nextOffset,remaining:Math.max(0,plans.length-nextOffset),frontMatchExecuted:false,placementsModified:0};
}
exports.handler=async(event)=>{
 try{
  if(event.httpMethod==='OPTIONS')return reply(200,{ok:true});
  if(event.httpMethod!=='POST')return reply(405,{ok:false,error:'method_not_allowed'});
  const actor=await Auth.resolveUser(event);if(![].concat(actor&&actor.roles||[]).some(role=>ROLE.has(str(role).toLowerCase())))err('상품 정렬 관리자 권한이 없습니다.',403);
  const input=parse(event),scope=normScope(input),action=str(input.action),keys=new Set([].concat(input.sectionKeys||[]).filter(k=>KEYS.has(str(k))).map(str)),name=str(actor&&actor.sub)||'administrator';
  if(!keys.size)err('정렬할 섹션을 선택하세요.');
  let result;
  if(action==='preview'||action==='apply'){const offset=Number(input.offset||0);if(!Number.isInteger(offset)||offset<0||offset>3000)err('정렬 저장 위치가 올바르지 않습니다.');result=await order(scope,keys,action==='apply',name,offset,str(input.expectedPlanHash),str(input.expectedVersionHash));}
  else if(['demote','restore','pin_top','unpin_top'].includes(action)){
    if(keys.size!==1)err('예외 지정은 한 섹션씩 처리하세요.');
    result=await setOverride(scope,[...keys][0],str(input.candidateId),action,name);
  }else err('알 수 없는 수익 순위 작업입니다.');
  return reply(200,Object.assign({ok:true,version:VERSION,scope},result));
 }catch(e){return reply(e.statusCode||500,{ok:false,version:VERSION,error:str(e.message)||'revenue_rank_failed'});}
};
