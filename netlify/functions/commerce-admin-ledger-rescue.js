"use strict";
/*
 * Emergency recovery of PRIVATE administrator placement decisions.
 * Separate from supplier research / AI automation / Front Match.
 * Historical evidence is a proposal, not proof the supplier is currently live.
 * Explicit operator action is required; no public assignments are written.
 */
const AdminSession=require("./lib/global-slot-console-auth");
const SlotStore=require("./lib/global-slot-console-supabase");
const Evidence=require("./lib/igdc-historical-private-placement-20261013.json");
const PRODUCT_SOURCE_REF="country-product-ranking-review";
const ALLOWED=new Set(["owner","admin","site_manager","site_manager_director","director"]);
const SECTIONS=new Set([
 "home|home_1","home|home_2","home|home_3","home|home_4","home|home_5","home|home_6",
 "home|home_right_top","home|home_right_middle","home|home_right_bottom",
 "distribution|distribution-recommend","distribution|distribution-trending","distribution|distribution-sponsor",
 "distribution|distribution-new","distribution|distribution-special","distribution|distribution-others",
 "distribution|distribution-extra","distribution|distribution-right","network|network-right","social|rightPanel","tour|tour"
]);
function text(v){return String(v==null?"":v).trim();}
function lower(v){return text(v).toLowerCase();}
function plain(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function array(v){return Array.isArray(v)?v:[];}
function json(code,body){return{statusCode:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"},body:JSON.stringify(body)};}
function fail(msg,code){const e=new Error(msg);e.statusCode=code||400;throw e;}
function normalizedUrl(v){try{const u=new URL(text(v));if(u.protocol!=="https:"&&u.protocol!=="http:")return"";u.hash="";return u.toString().replace(/\/$/,"");}catch(_){return"";}}
function currentUrl(row){const p=plain(row.source_payload);return text(row.official_url||p.externalProductUrl||p.productUrl||p.checkoutUrl);}
function currentDecision(row){const p=plain(row.source_payload),q=plain(p.queueControl);return lower(p.slotDecision||q.action||(row.status==="suppressed"?"reject":row.status));}
function assignedKey(p){const x=plain(p.approvedPlacement||p.selectedPlacement||p.placement),page=text(x.page),section=text(x.sectionKey||x.section);return page&&section?page+"|"+section:"";}
function explicitOperatorHold(p){const m=plain(p.managementControl),r=plain(p.review);
 return m.administratorLocked===true && (m.source==="administrator"||m.source==="manual"||lower(p.decisionSource)==="administrator"||lower(r.state)==="administrator_hold");
}
function scopeMatch(p,code){const keys=array(p.marketKeys).map(text).filter(Boolean),ms=plain(p.marketScope),cs=plain(p.countrySupply),place=plain(p.approvedPlacement||p.placement||p.selectedPlacement);
 const c=text(ms.marketCountry||cs.country||cs.countryCode||p.targetCountry||p.countryCode||place.country).toUpperCase();
 return c===code||(!c&&keys.some(k=>k.toUpperCase().startsWith(code+"-")));
}
function eligibility(row,country){
 const id=text(row.id),e=plain(Evidence.entries[id]),p=plain(row.source_payload),q=plain(p.queueControl),m=plain(p.managementControl),d=currentDecision(row);
 if(!Object.keys(e).length)return{ok:false,reason:"historical_record_absent"};
 if(text(row.source_ref)!==PRODUCT_SOURCE_REF||text(row.kind)!=="product")return{ok:false,reason:"not_canonical_product_candidate"};
 if(!scopeMatch(p,country))return{ok:false,reason:"country_scope_mismatch"};
 const key=text(e.page)+"|"+text(e.section);
 if(!SECTIONS.has(key))return{ok:false,reason:"historical_section_invalid"};
 if(!normalizedUrl(e.url)||normalizedUrl(e.url)!==normalizedUrl(currentUrl(row)))return{ok:false,reason:"product_url_changed"};
 if(p.externalProductUrl&&normalizedUrl(p.externalProductUrl)!==normalizedUrl(e.url))return{ok:false,reason:"payload_product_url_changed"};
 if(d==="slot_candidate"&&SECTIONS.has(assignedKey(p)))return{ok:false,reason:"existing_placement_preserved"};
 if(q.permanentExcluded===true||["purge","block","remove_from_list","dismiss"].includes(lower(q.action))||["purge","removed","removed_from_list"].includes(d))return{ok:false,reason:"operator_exclusion_preserved"};
 if(explicitOperatorHold(p))return{ok:false,reason:"operator_hold_preserved"};
 if(["http_404","http_410","invalid_product_url","product_page_explicit_invalid_message"].includes(lower(p.researchStatus)))return{ok:false,reason:"confirmed_invalid_url_needs_review"};
 if(!["hold","reject","undecided","approval_pending","suppressed","slot_candidate"].includes(d))return{ok:false,reason:"unexpected_decision"};
 // A prior section is confirmed historically. This does NOT assert the URL is live today.
 return{ok:true,reason:"previous_private_placement_present",page:e.page,section:e.section,previousDecision:d,source:"2026-10-13",currentStatus:text(row.status)};
}
async function scopedCandidates(country){
 const out=[],maxPages=24,limit=250,seen=new Set(),fields="id,kind,title,official_url,status,source_ref,source_payload,updated_at";
 for(let offset=0,page=0;page<maxPages;page++,offset+=limit){
   const query="select="+fields+"&source_ref=eq."+encodeURIComponent(PRODUCT_SOURCE_REF)+"&order=updated_at.desc,id.asc&limit="+limit+"&offset="+offset;
   const batch=array(await SlotStore.select("gslot_candidates",query));
   for(const row of batch){if(!seen.has(text(row.id))){seen.add(text(row.id));if(scopeMatch(plain(row.source_payload),country))out.push(row);}}
   if(batch.length<limit)return{rows:out,complete:true,scanned:offset+batch.length};
 }
 return{rows:out,complete:false,scanned:maxPages*limit};
}
async function snapshot(country){
 const result=await scopedCandidates(country),buckets={},eligible=[],examples=[],historical=Evidence.entries;
 for(const row of result.rows){
   const d=currentDecision(row);buckets[d]=(buckets[d]||0)+1;
   const check=eligibility(row,country);
   if(check.ok){eligible.push({id:text(row.id),title:text(row.title),from:d,to:check.page+"|"+check.section,url:normalizedUrl(currentUrl(row))});}
   else if(historical[text(row.id)]){buckets["skip:"+check.reason]=(buckets["skip:"+check.reason]||0)+1;}
 }
 return{ok:true,scope:{country,region:"NATIONWIDE"},schema:"igdc-admin-private-placement-safe-restore.v1",
   historicalRecords:Evidence.sourceCandidates,historicalAssigned:Evidence.count,rawCandidateCount:result.rows.length,
   scannerComplete:result.complete,rawScanned:result.scanned,states:buckets,eligibleCount:eligible.length,
   eligiblePreview:eligible.slice(0,100),eligibleIds:eligible.map(r=>r.id),
   warnings:["과거 확정 섹션 기록은 현재 판매 가능 여부의 증명이 아닙니다.","프론트 공개·섹션 매칭·상품 URL 재검증은 실행하지 않습니다.",
             "일부 상품은 2026-10-13 이후 섹션 변경이 있었을 수 있습니다. 기존 정상 배치는 보호합니다."]};
}
async function restore(actor,body,country){
 if(text(body.confirm)!=="RESTORE_PRIOR_PRIVATE_PLACEMENTS")fail("복구 확인 코드가 필요합니다.");
 const list=array(body.candidateIds).map(text).filter(Boolean);
 if(!list.length)fail("복구할 상품 ID를 지정해야 합니다. 먼저 읽기 전용 점검을 진행하세요.",400);
 const ids=Array.from(new Set(list));
 if(ids.length>650)fail("한 번에 복구할 수 있는 상품 수를 초과했습니다.",413);
 const results=[],now=new Date().toISOString();
 for(const id of ids){
   try{
     const fetched=array(await SlotStore.select("gslot_candidates","select=id,kind,title,official_url,status,source_ref,source_payload,updated_at&id=eq."+encodeURIComponent(id)+"&limit=1"));
     const row=fetched[0],proof=row&&eligibility(row,country);
     if(!row||!proof||!proof.ok){results.push({id,state:"preserved",reason:proof&&proof.reason||"candidate_missing"});continue;}
     const payload=plain(row.source_payload),e=Evidence.entries[id],prior=plain(payload.approvedPlacement),placement={...prior,key:e.page+"|"+e.section,page:e.page,section:e.section,sectionKey:e.section,
       country,region:"NATIONWIDE",proposalOnly:false,publicPublication:false,reviewEligible:true,
       restorationEvidence:"2026-10-13-durable-management-export",restoredAt:now,restoredBy:text(actor.sub)};
     const next={...payload,slotDecision:"slot_candidate",approvedPlacement:placement,
       managementControl:{...plain(payload.managementControl),source:"administrator_private_ledger_recovery",administratorLocked:true,aiReclassificationAllowed:false,updatedAt:now,updatedBy:text(actor.sub)},
       queueControl:{...plain(payload.queueControl),action:"historical_private_placement_restored",hiddenFromCountryQueue:false,permanentExcluded:false,restoredAt:now,restoredBy:text(actor.sub)},
       review:{...plain(payload.review),state:"slot_candidate",priorDecision:proof.previousDecision,restorationType:"historical_admin_placement",restoredAt:now,restoredBy:text(actor.sub)},
       };
     // Optimistic conflict guard: do not overwrite another admin's intervening decision.
     const filter="id=eq."+encodeURIComponent(id)+"&updated_at=eq."+encodeURIComponent(row.updated_at);
     const written=array(await SlotStore.update("gslot_candidates",filter,{status:"approval_pending",source_payload:next,updated_at:now},"return=representation"));
     if(written.length!==1){results.push({id,state:"conflict",reason:"row_modified_since_read"});continue;}
     results.push({id,state:"restored",section:e.page+"|"+e.section});
   }catch(e){results.push({id,state:"failed",reason:text(e&&e.message)});}
 }
 return{ok:true,requested:ids.length,restored:results.filter(x=>x.state==="restored").length,
         preserved:results.filter(x=>x.state==="preserved").length,conflicts:results.filter(x=>x.state==="conflict").length,
         failed:results.filter(x=>x.state==="failed").length,results,
         invariant:{frontMatch:false,publicSnapshotWrite:false,assignmentMutation:false,researchJobMutation:false}};
}
exports.handler=async function(event){
 try{
   if(text(event&&event.httpMethod).toUpperCase()==="OPTIONS")return json(204,{});
   const actor=await AdminSession.resolveUser(event),roles=array(actor&&actor.roles).map(lower);
   if(!roles.some(x=>ALLOWED.has(x)))fail("관리자 승인 권한이 필요합니다.",403);
   const method=text(event&&event.httpMethod).toUpperCase(),q=event.queryStringParameters||{},body=method==="POST"?JSON.parse(event.body||"{}"):{};
   const country=text(q.country||body.country||"KR").toUpperCase();
   if(country!=="KR")fail("현재 복구 증빙은 KR 전국 상품에만 해당합니다.",400);
   if(text(q.region||body.region||"NATIONWIDE").toUpperCase()!=="NATIONWIDE")fail("현재 복구 증빙은 KR 전국 범위만 지원합니다.",400);
   if(method==="GET")return json(200,await snapshot(country));
   if(method==="POST"&&body.action==="restore")return json(200,await restore(actor,body,country));
   return json(405,{ok:false,error:"method_not_allowed"});
 }catch(e){return json(e.statusCode||500,{ok:false,error:text(e.message),code:e.code||null});}
};
exports._test={eligibility,normalizedUrl,currentDecision,scopeMatch,assignedKey};
