"use strict";
/* Administrator-only, additive repair for genuine missing PSOM private placements.
   Does not change existing valid placements, public assignments or hub/front state. */
const AdminSession=require("./lib/global-slot-console-auth");
const SlotStore=require("./lib/global-slot-console-supabase");
const MarketSaleScope=require("./lib/market-sale-scope.v1");
const ProductRanking=require("./lib/commerce-product-ranking.v1");
const crypto=require("crypto");
const VERSION="igdc-admin-private-placement-repair-v1";
const ROLES=new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);
const SECTIONS=new Set([
  "home|home_1","home|home_2","home|home_3","home|home_4","home|home_5","home|home_6","home|home_right_top","home|home_right_middle","home|home_right_bottom",
  "distribution|distribution-recommend","distribution|distribution-trending","distribution|distribution-sponsor","distribution|distribution-new","distribution|distribution-special","distribution|distribution-others","distribution|distribution-extra","distribution|distribution-right",
  "network|network-right","social|rightPanel","tour|tour"
]);
const text=x=>x==null?"":String(x).trim();
const lower=x=>text(x).toLowerCase();
const obj=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{};
const arr=x=>Array.isArray(x)?x:[];
const json=(statusCode,body)=>({statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)});
function keyOf(p){p=obj(p);let s=text(p.key);if(SECTIONS.has(s))return s;s=text(p.page||p.channel)+"|"+text(p.sectionKey||p.section);return SECTIONS.has(s)?s:"";}
function splitKey(k){let x=k.indexOf("|");return {page:k.slice(0,x),section:k.slice(x+1)};}
function scopeOf(input){const country=MarketSaleScope.normalizeCountry(text(input.countryCode).toUpperCase()),region=country&&(MarketSaleScope.normalizeRegion(input.subdivisionCode||"NATIONWIDE",country)||"NATIONWIDE");if(!country||country==="GLOBAL")throw Object.assign(new Error("invalid_country_scope"),{statusCode:400});return {country,region};}
function rowScopeMatches(payload,scope){const m=obj(payload.marketScope),s=obj(payload.countrySupply),p=obj(payload.approvedPlacement||payload.placement),country=text(m.marketCountry||s.countryCode||s.country||payload.countryCode||p.country).toUpperCase();if(!country||country!==scope.country)return false;const r=text(m.marketRegion||s.regionCode||s.region||payload.regionCode||p.region||"NATIONWIDE").toUpperCase();const norm=MarketSaleScope.normalizeRegion(r,scope.country)||"NATIONWIDE";return norm===scope.region;}
function sameAssignmentScope(a,scope){return text(a.country_code).toUpperCase()===scope.country&&(MarketSaleScope.normalizeRegion(a.region_code||"NATIONWIDE",scope.country)||"NATIONWIDE")===scope.region;}
function knownProduct(row){const p=obj(row.source_payload),card=obj(p.productCard),r=obj(p.researchReadiness),rc=obj(r.productCard);return {title:text(card.title||p.productName||rc.title||row.title),url:text(p.externalProductUrl||p.productUrl||card.checkoutUrl||rc.checkoutUrl||row.official_url),image:text(p.imageUrl||card.image||rc.image||row.thumbnail_url),supplierName:text(p.supplierName||obj(p.supplier).name),sourceTitle:text(p.sourceTitle||card.sourceTitle)};}
function validProduct(product){if(!product.url||!/^https?:\/\//i.test(product.url)||/\/(?:challenge|captcha|block|access-denied)(?:[/?#]|$)/i.test(product.url)||/auth=.{30,}/i.test(product.url))return "invalid_or_challenge_product_url";if(!ProductRanking.isSpecificProductUrl(product.url))return "specific_product_url_missing";if(!product.title||ProductRanking.isGenericProductName(product.title))return "generic_product_title";if(!/^https?:\/\//i.test(product.image))return "product_image_missing";return "";}
async function restoreOne(actor,scope,id,preferredKey){
 const raw=arr(await SlotStore.select("gslot_candidates","select=id,status,source_ref,title,official_url,thumbnail_url,source_payload&id=eq."+encodeURIComponent(id)+"&limit=1"))[0],row=obj(raw);if(!row.id||text(row.source_ref)!=="country-product-ranking-review")return {candidateId:id,state:"review_required",reason:"candidate_not_found"};
 const p=Object.assign({},obj(row.source_payload)),decision=lower(p.slotDecision),management=obj(p.managementControl),queue=obj(p.queueControl),pub=obj(p.frontPublication);
 if(!rowScopeMatches(p,scope))return {candidateId:id,state:"review_required",reason:"scope_mismatch"};
 if(decision!=="slot_candidate"||queue.permanentExcluded===true||["hold","reject","purge","removed"].includes(decision))return {candidateId:id,state:"review_required",reason:"not_placement_repair_candidate"};
 const savedKey=keyOf(p.approvedPlacement||p.selectedPlacement||p.placement||p.primaryPlacement);
 if(savedKey)return {candidateId:id,state:"preserved",sectionKey:savedKey,reason:"confirmed_placement_already_exists"};
 const ass=arr(await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,slot_key,country_code,region_code,state,publication_status,manual_pinned&candidate_id=eq."+encodeURIComponent(id)+"&limit=100")).filter(a=>sameAssignmentScope(a,scope)),keys=Array.from(new Set(ass.map(a=>text(a.hub_key)+"|"+text(a.slot_key)).filter(k=>SECTIONS.has(k))));
 if(keys.length>1)return {candidateId:id,state:"review_required",reason:"conflicting_durable_assignments"};
 const assignmentKey=keys[0]||"";
 if(!assignmentKey&&(management.administratorLocked===true||["matched","published","active","publish_requested","queued"].includes(lower(pub.status))||ass.some(a=>a.manual_pinned===true)))return {candidateId:id,state:"review_required",reason:"administrator_or_public_placement_protected"};
 const product=knownProduct(row),productIssue=validProduct(product);
 if(productIssue)return {candidateId:id,state:"review_required",reason:productIssue};
 // An existing durable assignment wins; never create, replace or remove any relation here.
 const oldKey=keyOf(p.previousApprovedPlacement),proposed=arr(p.sectionAssignments||p.proposedPlacements).map(keyOf).filter(Boolean),semantic=ProductRanking.strictPlacementSectionKeys(Object.assign({},product,{productName:product.title}));
 const keysAllowed=arr(semantic.keys).filter(k=>SECTIONS.has(k));
 let target=assignmentKey||oldKey;
 if(!target&&preferredKey){if(keysAllowed.includes(preferredKey))target=preferredKey;else return {candidateId:id,state:"review_required",reason:"selected_section_category_mismatch"};}
 if(!target)target=proposed.find(k=>keysAllowed.includes(k))||keysAllowed[0]||"";
 if(!target)return {candidateId:id,state:"review_required",reason:"no_verified_psom_section"};
 const split=splitKey(target),now=new Date().toISOString(),actorId=text(actor.sub)||"administrator";
 const place={page:split.page,section:split.section,sectionKey:split.section,country:scope.country,region:scope.region,administratorSelected:!!preferredKey||!!assignmentKey,aiSelected:!preferredKey&&!assignmentKey,automaticPrivatePlacement:true,publicPublication:false,source:"admin_missing_placement_repair",selectedAt:now,selectedBy:actorId};
 p.approvedPlacement=place;p.placement=Object.assign({},place);p.managementControl=Object.assign({},management,{placementRepairAt:now,placementRepairBy:actorId,placementRepairOnly:true});p.review=Object.assign({},obj(p.review),{placementRepairStatus:"section_record_recovered",placementRepairAt:now});
 // Re-fetch confirms no competing update occurred between classification and the private write.
 const fresh=obj(arr(await SlotStore.select("gslot_candidates","select=id,source_payload&id=eq."+encodeURIComponent(id)+"&limit=1"))[0]),fp=obj(fresh.source_payload);
 if(keyOf(fp.approvedPlacement||fp.placement)||lower(fp.slotDecision)!=="slot_candidate")return {candidateId:id,state:"review_required",reason:"candidate_changed_during_repair"};
 const oldDigest=crypto.createHash("sha256").update(JSON.stringify(obj(row.source_payload))).digest("hex");
 if(crypto.createHash("sha256").update(JSON.stringify(fp)).digest("hex")!==oldDigest)return {candidateId:id,state:"review_required",reason:"candidate_changed_during_repair"};
 await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{source_payload:p,updated_at:now});
 return {candidateId:id,state:"restored",sectionKey:target,source:assignmentKey?"existing_assignment":oldKey?"existing_history":preferredKey?"administrator_chosen":"verified_psom_category"};
}
exports.handler=async event=>{
 try{const method=text(event.httpMethod||"POST").toUpperCase();if(method==="OPTIONS")return json(204,{});if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
 const actor=await AdminSession.resolveUser(event);if(!arr(actor&&actor.roles).some(role=>ROLES.has(lower(role))))return json(403,{ok:false,error:"administrator_required"});
 const input=JSON.parse(event.isBase64Encoded?Buffer.from(event.body||"e30=","base64").toString("utf8"):(event.body||"{}")),scope=scopeOf(input),ids=Array.from(new Set(arr(input.candidateIds).map(text).filter(Boolean))).slice(0,6),preferredKey=text(input.preferredSectionKey);
 if(preferredKey&&!SECTIONS.has(preferredKey))return json(400,{ok:false,error:"invalid_psom_section"});if(!ids.length)return json(400,{ok:false,error:"candidate_ids_required"});
 const results=[];for(const id of ids){try{results.push(await restoreOne(actor,scope,id,preferredKey));}catch(e){results.push({candidateId:id,state:"failed",reason:text(e.message)||"repair_failed"});}}
 return json(200,{ok:true,version:VERSION,requested:ids.length,restored:results.filter(x=>x.state==="restored").length,preserved:results.filter(x=>x.state==="preserved").length,reviewRequired:results.filter(x=>x.state==="review_required").length,failed:results.filter(x=>x.state==="failed").length,results,frontMatchExecuted:false,assignmentsModified:false});
 }catch(e){return json(Number(e.statusCode)||500,{ok:false,error:text(e.message)||"placement_repair_failed"});}
};
