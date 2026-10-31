"use strict";
/* Administrator section/assignment reconciliation, read-only audit by default.
 * Repair is a separate explicit action, checked again against the live ledger
 * and delegated to the existing administrator authority (no new write logic).
 */
const Auth=require("./lib/global-slot-console-auth");
const Store=require("./lib/global-slot-console-supabase");
const Scope=require("./lib/market-sale-scope.v1");
const Authority=require("./commerce-candidate-admin-authority");
const VERSION="igdc-section-ledger-reconcile-v1";
const ROLES=new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);
const SECTIONS=new Set([
 "home|home_1","home|home_2","home|home_3","home|home_4","home|home_5","home|home_6","home|home_right_top","home|home_right_middle","home|home_right_bottom",
 "distribution|distribution-recommend","distribution|distribution-trending","distribution|distribution-sponsor","distribution|distribution-new","distribution|distribution-special","distribution|distribution-others","distribution|distribution-extra","distribution|distribution-right",
 "network|network-right","social|rightPanel","tour|tour"
]);
const SOURCES=new Set(["country-product-ranking-review","commerce-candidate-review-api"]);
const str=x=>x==null?"":String(x).trim();
const low=x=>str(x).toLowerCase();
const obj=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{};
const arr=x=>Array.isArray(x)?x:[];
const unique=a=>[...new Set(a)];
const respond=(status,body)=>({statusCode:status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff"},body:JSON.stringify(body)});
const fail=(message,code=409)=>{const e=new Error(message);e.statusCode=code;throw e;};
function scopeFrom(i){const country=Scope.normalizeCountry(str(i.countryCode).toUpperCase());if(!country||country==="GLOBAL")fail("invalid_country_scope",400);const region=Scope.normalizeRegion(i.subdivisionCode||"NATIONWIDE",country)||"NATIONWIDE";return{country,region};}
function placementKey(p){p=obj(p);const k=str(p.key)||[str(p.page||p.channel),str(p.sectionKey||p.section)].join("|");return SECTIONS.has(k)?k:"";}
function candidatePlacement(p){p=obj(p);return obj(p.approvedPlacement||p.selectedPlacement||p.primaryPlacement||p.placement);}
function scopeMatches(p,scope){p=obj(p);const place=candidatePlacement(p),market=obj(p.marketScope),supply=obj(p.countrySupply);const countries=[market.marketCountry,supply.countryCode,supply.country,p.countryCode,place.country].map(x=>str(x).toUpperCase()).filter(Boolean),regions=[market.marketRegion,supply.regionCode,supply.region,p.regionCode,place.region].map(str).filter(Boolean);return countries.length>0&&countries.every(x=>Scope.normalizeCountry(x)===scope.country)&&(!regions.length?scope.region==="NATIONWIDE":regions.every(x=>Scope.normalizeRegion(x,scope.country)===scope.region));}
function placementScopeExplicit(p,scope){p=obj(p);const c=str(p.country||p.countryCode).toUpperCase(),r=str(p.region||p.regionCode);return c===scope.country&&!!r&&(Scope.normalizeRegion(r,scope.country)||"NATIONWIDE")===scope.region;}
function assignmentKey(a){return str(a.hub_key)+"|"+str(a.slot_key);}
function sameScope(a,scope){return str(a.country_code).toUpperCase()===scope.country&&(Scope.normalizeRegion(a.region_code||"NATIONWIDE",scope.country)||"NATIONWIDE")===scope.region;}
function activeAssignment(a){return ["approved","pinned"].includes(low(a.state));}
async function select(table,query){const rows=await Store.select(table,query);if(!Array.isArray(rows))fail("incomplete_ledger_read:"+table,502);return rows;}
async function sectionRelations(scope,key){const [hub,slot]=key.split("|"),all=[],pageSize=150;for(let offset=0;offset<2400;offset+=pageSize){const q="select=id,candidate_id,hub_key,slot_key,country_code,region_code,state,publication_status,manual_pinned,updated_at"+
 "&country_code=eq."+encodeURIComponent(scope.country)+"&region_code=eq."+encodeURIComponent(scope.region)+"&hub_key=eq."+encodeURIComponent(hub)+"&slot_key=eq."+encodeURIComponent(slot)+"&order=id.asc&limit="+pageSize+"&offset="+offset;
 const batch=await select("gslot_slot_assignments",q);all.push(...batch);if(batch.length<pageSize)return all;}fail("section_assignment_scan_limit:"+key,409);}
async function candidates(ids){const map=new Map();for(let i=0;i<ids.length;i+=40){const part=ids.slice(i,i+40);const q="select=id,title,source_ref,source_payload,updated_at,official_url&"+"id=in.("+part.map(encodeURIComponent).join(",")+")&limit="+part.length;const found=await select("gslot_candidates",q);found.forEach(r=>map.set(str(r.id),r));}return map;}
async function relationsForIds(ids){const out=new Map();for(let i=0;i<ids.length;i+=40){const part=ids.slice(i,i+40);const q="select=id,candidate_id,hub_key,slot_key,country_code,region_code,state,publication_status,manual_pinned,updated_at&candidate_id=in.("+part.map(encodeURIComponent).join(",")+")&limit=2000";const rows=await select("gslot_slot_assignments",q);if(rows.length>=2000)fail("candidate_assignment_scan_limit",409);rows.forEach(a=>{const id=str(a.candidate_id);if(!out.has(id))out.set(id,[]);out.get(id).push(a);});}return out;}
function evaluate(id,row,relations,scope,key,allowedKeys){if(!row)return{candidateId:id,sectionKey:key,status:"missing_candidate",canRepair:false,reason:"candidate_not_found"};
 const p=obj(row.source_payload),place=candidatePlacement(p),desired=placementKey(place),decision=low(p.slotDecision),control=obj(p.managementControl);
 const active=relations.filter(activeAssignment),scoped=active.filter(a=>sameScope(a,scope)),other=active.filter(a=>!sameScope(a,scope)),actual=unique(scoped.map(assignmentKey));
 const relevant=actual.includes(key)||desired===key;
 if(!relevant)return null;
 let status="consistent";
 if(other.length)status="cross_market_assignment";
 else if(actual.length>1||scoped.length>1)status="multiple_assignments";
 else if(decision!=="slot_candidate"&&actual.length)status="inactive_candidate_assignment";
 else if(decision==="slot_candidate"&&!desired)status="missing_admin_section";
 else if(decision==="slot_candidate"&&desired&&!actual.length)status="missing_assignment";
 else if(decision==="slot_candidate"&&actual.length===1&&actual[0]!==desired)status="section_mismatch";
 else if(actual.some(x=>!SECTIONS.has(x)))status="unknown_section";
 else if(!SOURCES.has(str(row.source_ref)))status="unmanaged_source";
 if(status==="consistent")return null;
 const protectedSource=SOURCES.has(str(row.source_ref)),explicitAdmin=control.source==="administrator"&&control.administratorLocked===true||place.administratorSelected===true&&control.aiReclassificationAllowed===false;
 const conflictPinned=scoped.some(a=>a.manual_pinned===true&&assignmentKey(a)!==desired);
 const canRepair=(status==="missing_assignment"||status==="section_mismatch")&&decision==="slot_candidate"&&protectedSource&&explicitAdmin&&!!desired&&placementScopeExplicit(place,scope)&&scopeMatches(p,scope)&&!other.length&&scoped.length<=1&&!conflictPinned&&!relations.some(a=>!sameScope(a,scope))&&!!str(row.updated_at)&&!["unpublish_requested","unpublish_failed"].includes(low(obj(p.frontPublication).status))&&!scoped.some(a=>["unpublish_requested","unpublish_failed"].includes(low(a.publication_status)))&&allowedKeys.has(desired)&&actual.every(x=>allowedKeys.has(x));
 return{candidateId:id,title:str(row.title||p.productName),sectionKey:key,status,desiredKey:desired,actualKeys:actual,canRepair,reason:canRepair?"explicit_administrator_placement_verified":"manual_review_or_out_of_scope",updatedAt:str(row.updated_at),publicationSyncRequired:scoped.some(a=>["published","publish_requested","active","matched","unpublish_requested"].includes(low(a.publication_status)))};
}
async function audit(scope,key,expectedIds,allowedKeys){const targetIds=unique(arr(expectedIds).map(str).filter(Boolean));if(targetIds.length>900)fail("section_candidate_input_limit",400);
 const found=await sectionRelations(scope,key),ids=unique(targetIds.concat(found.map(a=>str(a.candidate_id)).filter(Boolean)));if(ids.length>1800)fail("section_candidate_limit",409);
 const [rows,relationMap]=await Promise.all([candidates(ids),relationsForIds(ids)]);
 const report=[];for(const id of ids){const item=evaluate(id,rows.get(id),(relationMap.get(id)||[]),scope,key,allowedKeys);if(item)report.push(item);}
 return{sectionKey:key,expectedCandidates:targetIds.length,assignmentRows:found.length,checked:ids.length,consistent:ids.length-report.length,issues:report};}
async function repair(event,input,scope){const id=str(input.candidateId),expected=str(input.expectedUpdatedAt),desired=str(input.desiredKey),allowed=new Set(arr(input.sectionKeys).map(str));if(!id||!expected||!SECTIONS.has(desired)||!allowed.size||[...allowed].some(k=>!SECTIONS.has(k)))fail("repair_scope_or_revision_missing",400);
 if(str(input.confirmation)!=="ADMIN_RECONCILE_CONFIRMED")fail("explicit_admin_confirmation_required",400);
 const found=await candidates([id]),row=found.get(id);if(!row||str(row.updated_at)!==expected)fail("candidate_changed_after_audit",409);
 const p=obj(row.source_payload),place=candidatePlacement(p);if(placementKey(place)!==desired)fail("administrator_placement_changed",409);
 const rel=(await relationsForIds([id])).get(id)||[],actual=unique(rel.filter(a=>sameScope(a,scope)&&activeAssignment(a)).map(assignmentKey));
 const source=actual[0]||desired; if(!allowed.has(source)||!allowed.has(desired))fail("reconciliation_requires_all_affected_sections",409);
 const checked=evaluate(id,row,rel,scope,source,allowed);if(!checked||!checked.canRepair||checked.desiredKey!==desired)fail("not_deterministically_repairable",409);
 const activeNow=rel.filter(a=>sameScope(a,scope)&&activeAssignment(a));
 const payload={countryCode:scope.country,subdivisionCode:scope.region,candidateIds:[id],decision:"slot_candidate",placementKey:desired,source:activeNow.length===1&&assignmentKey(activeNow[0])!==desired?"administrator_reconcile":"administrator"};
 const call=Object.assign({},event,{httpMethod:"POST",isBase64Encoded:false,body:JSON.stringify(payload)});
 const result=await Authority.handler(call);let response={};try{response=JSON.parse(result.body||"{}");}catch(_e){fail("admin_authority_invalid_response",502);}
 if(result.statusCode!==200||response.ok!==true||response.processed!==1||!arr(response.results).some(x=>x.candidateId===id&&x.ledgerVerified===true))fail("admin_authority_reconcile_failed:"+str(response.error||arr(response.failures)[0]&&arr(response.failures)[0].error),409);
 return{candidateId:id,repaired:true,desiredKey:desired,frontMatchRequired:true,authorityVerified:true};}
exports.handler=async event=>{try{if(str(event.httpMethod).toUpperCase()==="OPTIONS")return respond(204,{});if(str(event.httpMethod).toUpperCase()!=="POST")return respond(405,{ok:false,error:"method_not_allowed"});const actor=await Auth.resolveUser(event);if(!arr(actor&&actor.roles).some(r=>ROLES.has(low(r))))return respond(403,{ok:false,error:"administrator_required"});const body=JSON.parse(event.isBase64Encoded?Buffer.from(event.body||"e30=","base64").toString("utf8"):event.body||"{}");const scope=scopeFrom(body),action=str(body.action);if(action==="audit"){const key=str(body.sectionKey),allowed=new Set(arr(body.sectionKeys).map(str));if(!SECTIONS.has(key)||!allowed.has(key)||!allowed.size||allowed.size>SECTIONS.size||[...allowed].some(k=>!SECTIONS.has(k)))fail("invalid_audit_sections",400);const res=await audit(scope,key,body.expectedCandidateIds,allowed);return respond(200,{ok:true,version:VERSION,scope,readonly:true,result:res});}if(action==="repair")return respond(200,{ok:true,version:VERSION,scope,result:await repair(event,body,scope)});fail("unknown_action",400);}catch(e){return respond(Number(e.statusCode)||500,{ok:false,version:VERSION,error:str(e.message)||"section_reconcile_failed"});}};
exports._test={evaluate,placementKey,scopeMatches,placementScopeExplicit,SECTIONS};
