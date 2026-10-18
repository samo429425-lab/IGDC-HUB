"use strict";
// Revenue-first ordering of already placed candidates. NEVER edits placements or publication.
const Auth=require('./lib/global-slot-console-auth');
const Store=require('./lib/global-slot-console-supabase');
const Market=require('./lib/market-sale-scope.v1');
const VERSION='igdc-section-revenue-order-v1.0.0';
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
 return{candidateId:row.id,title:str(row.title),sectionKey:key,override:override==='demote'?'demote':'',tier:effectiveTier,className:cls,score:Number.isFinite(score)?score:0,originalPriority:Number(row.assignment.priority||0),assignmentId:str(row.assignment.id),createdAt:str(row.assignment.created_at)};
}
function compare(a,b){return (a.override==='demote'?1:0)-(b.override==='demote'?1:0)||b.tier-a.tier||b.score-a.score||a.candidateId.localeCompare(b.candidateId);}
function chunks(rows,size){const out=[];for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out;}
async function readAll(scope,keys){
 const assignments=[];const pageSize=200,maxRecords=3000;
 for(let offset=0;offset<maxRecords;offset+=pageSize){
   const query='select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,created_at,updated_at&country_code=eq.'+encodeURIComponent(scope.country)+'&region_code=eq.'+encodeURIComponent(scope.region)+'&limit='+pageSize+'&offset='+offset+'&order=id.asc';
   const batch=await Store.select('gslot_slot_assignments',query);
   if(!Array.isArray(batch))err('배치 원장 조회 실패',502);
   assignments.push(...batch);
   if(batch.length<pageSize)break;
   if(offset+pageSize>=maxRecords)err('배치 원장이 안전 조회 한도를 초과했습니다. 정렬을 실행하지 않습니다.',409);
 }
 const scoped=assignments.filter(x=>keys.has(str(x.hub_key)+'|'+str(x.slot_key))&&['approved','pinned'].includes(str(x.state).toLowerCase()));
 const ids=[...new Set(scoped.map(x=>str(x.candidate_id)).filter(Boolean))],candidates=new Map();
 for(const batch of chunks(ids,35)){
   const result=await Store.select('gslot_candidates','select=id,title,status,source_ref,source_payload,updated_at&id=in.('+batch.map(encodeURIComponent).join(',')+')&limit='+batch.length);
   if(!Array.isArray(result))err('상품 후보 원장 조회 실패',502);
   result.forEach(row=>candidates.set(str(row.id),row));
 }
 if(candidates.size!==ids.length)err('상품 원장과 배치 원장의 상품 수가 일치하지 않아 정렬을 중단했습니다.',409);
 const groups=new Map([...keys].map(k=>[k,[]])),seen=new Set();
 for(const a of scoped){
   const key=str(a.hub_key)+'|'+str(a.slot_key),candidate=candidates.get(str(a.candidate_id)),payload=obj(candidate&&candidate.source_payload),placed=obj(payload.approvedPlacement||payload.placement||payload.primaryPlacement),placementKey=str(placed.key||((placed.page&&placed.sectionKey||placed.section)?str(placed.page)+'|'+str(placed.sectionKey||placed.section):'')),uniq=groupScope(scope,key)+'|'+str(a.candidate_id);
   if(seen.has(uniq))err('같은 상품이 같은 섹션에 중복 배정되어 있습니다. 먼저 중복 배정을 정리하세요.',409);
   seen.add(uniq);
   if(str(payload.slotDecision)!=='slot_candidate'||placementKey!==key)err('현재 관리자 배치와 원장 배정이 불일치합니다. 변경 없이 중단했습니다: '+str(a.candidate_id),409);
   if(!['country-product-ranking-review','commerce-candidate-review-api'].includes(str(candidate.source_ref)))err('관리자 원장 밖 상품이 포함되어 있습니다.',409);
   groups.get(key).push({id:str(candidate.id),title:candidate.title,payload,assignment:a,candidateUpdatedAt:candidate.updated_at});
 }
 return groups;
}
async function setOverride(scope,key,id,mode,actor){
 if(!KEYS.has(key))err('섹션 키가 잘못됐습니다.');if(!id)err('상품 ID가 비어 있습니다.');
 const data=await readAll(scope,new Set([key])),item=(data.get(key)||[]).find(r=>r.id===id);if(!item)err('선택 상품이 해당 섹션에 배치되어 있지 않습니다.',409);
 const now=new Date().toISOString(),p=Object.assign({},item.payload);
 if(mode==='demote')p.sectionRevenueOverride={scopeKey:groupScope(scope,key),mode:'demote',decidedBy:actor,decidedAt:now};
 else delete p.sectionRevenueOverride;
 await Store.update('gslot_candidates','id=eq.'+encodeURIComponent(id),{source_payload:p,updated_at:now});
 return{candidateId:id,sectionKey:key,override:mode==='demote'?'demote':''};
}
async function order(scope,keys,apply,actor,offset=0){
 const groups=await readAll(scope,keys),summaries=[],items=[],plans=[];
 for(const key of keys){const rows=groups.get(key)||[],ranked=rows.map(row=>Object.assign(rating(row,scope,key),{row})).sort(compare);
  ranked.forEach((v,i)=>{
   const rank=i+1,priority=Math.max(1,10000-rank);
   items.push({candidateId:v.candidateId,sectionKey:key,rank,priority,tier:v.tier,className:v.className,override:v.override,title:v.title,previousPriority:v.originalPriority});
   plans.push({item:v.row,priority,rank,key,tier:v.tier,className:v.className});
  });
  summaries.push({sectionKey:key,count:ranked.length,manualDemoted:ranked.filter(v=>v.override==='demote').length});
 }
 if(!apply)return{preview:true,applied:false,sections:summaries,items};
 let saved=0;const now=new Date().toISOString();
 // Only ordinal metadata and assignment priority are modified. No section/status/publication writes.
 // Work is retryable; a failed write returns partial progress, never claims completion.
 for(const job of plans.slice(offset,offset+12)){
  const p=Object.assign({},job.item.payload),scopeKey=groupScope(scope,job.key);
  p.sectionRevenueRanking={schema:VERSION,scopeKey,rank:job.rank,priority:job.priority,tier:job.tier,className:job.className,rankedAt:now,rankedBy:actor};
  await Store.update('gslot_candidates','id=eq.'+encodeURIComponent(job.item.id),{source_payload:p,updated_at:now});
  await Store.update('gslot_slot_assignments','id=eq.'+encodeURIComponent(job.item.assignment.id),{priority:job.priority,updated_at:now,updated_by:actor});
  saved+=1;
 }
 return{preview:false,applied:true,saved,sections:summaries,items,nextOffset:offset+saved,remaining:Math.max(0,plans.length-(offset+saved)),frontMatchExecuted:false,placementsModified:0};
}
exports.handler=async(event)=>{
 try{
  if(event.httpMethod==='OPTIONS')return reply(200,{ok:true});
  if(event.httpMethod!=='POST')return reply(405,{ok:false,error:'method_not_allowed'});
  const actor=await Auth.resolveUser(event);if(![].concat(actor&&actor.roles||[]).some(role=>ROLE.has(str(role).toLowerCase())))err('상품 정렬 관리자 권한이 없습니다.',403);
  const input=parse(event),scope=normScope(input),action=str(input.action),keys=new Set([].concat(input.sectionKeys||[]).filter(k=>KEYS.has(str(k))).map(str)),name=str(actor&&actor.sub)||'administrator';
  if(!keys.size)err('정렬할 섹션을 선택하세요.');
  let result;
  if(action==='preview'||action==='apply'){const offset=Number(input.offset||0);if(!Number.isInteger(offset)||offset<0||offset>3000)err('정렬 저장 위치가 올바르지 않습니다.');result=await order(scope,keys,action==='apply',name,offset);}
  else if(action==='demote'||action==='restore'){
    if(keys.size!==1)err('예외 지정은 한 섹션씩 처리하세요.');
    result=await setOverride(scope,[...keys][0],str(input.candidateId),action,name);
  }else err('알 수 없는 수익 순위 작업입니다.');
  return reply(200,Object.assign({ok:true,version:VERSION,scope},result));
 }catch(e){return reply(e.statusCode||500,{ok:false,version:VERSION,error:str(e.message)||'revenue_rank_failed'});}
};
