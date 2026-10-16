"use strict";
/**
 * Stand-alone administrator inspection and narrow correction of a persisted
 * anti-bot/Cafe24 challenge URL. Does not import the country automation engine.
 * It never tests live supplier inventory, guesses product numbers or reassigns
 * a product/slot. All protected/current disposition fields remain unchanged.
 */
const Auth = require("./lib/global-slot-console-auth");
const Store = require("./lib/global-slot-console-supabase");
const Ranking = require("./lib/commerce-product-ranking.v1");
const Historical = require("./lib/igdc-original-product-url-evidence-20261013.json");
const PRODUCT_REF = "country-product-ranking-review";
const ROLES = new Set(["owner", "admin", "site_manager", "site_manager_director", "director", "commerce_manager"]);
function t(v){return v==null?"":String(v).trim();}
function low(v){return t(v).toLowerCase();}
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function arr(v){return Array.isArray(v)?v:[];}
function reply(statusCode,body){return{statusCode,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"},body:JSON.stringify(body)};}
function bad(msg,code){const e=new Error(msg);e.statusCode=code||400;throw e;}
function safeUrl(input){try{const u=new URL(t(input));return (u.protocol==="https:"&&!u.username&&!u.password&&u.hostname)?u.toString():"";}catch(_){return"";}}
function isChallenge(input){const s=safeUrl(input);if(!s)return false;try{
 const u=new URL(s),p=low(u.pathname),h=low(u.hostname);
 // Restrict the aggressive challenge match to actual protection endpoints.
 return /(?:^|\/)(?:challenge|captcha|access[-_]denied|bot[-_]check|security[-_]check)(?:\/|$)/i.test(p)
   || /\/(?:cdn-cgi\/challenge-platform|_guard\/challenge|waf\/challenge)(?:\/|$)/i.test(p)
   || (/(?:^|\.)cafe24\.com$/.test(h)&&/\/challenge(?:\/|$)/.test(p));
 }catch(_){return false;}}
function urlLabel(input){const s=safeUrl(input);if(!s)return "";try{const u=new URL(s);return u.origin+u.pathname+(isChallenge(s)?" (접근 제한 주소 · 인증 토큰 비공개)":u.search);}catch(_){return"";}}
function sameHost(a,b){try{return new URL(a).hostname.toLowerCase()===new URL(b).hostname.toLowerCase();}catch(_){return false;}}
function urlKey(v){return Ranking.canonicalProductUrl(v)||safeUrl(v);}
function productProofUrl(input){const v=safeUrl(input);if(!v||isChallenge(v))return"";if(!Ranking.isSpecificProductUrl(v)||!Ranking.productIdFromUrl(v))return"";return v;}
function urls(row){const p=obj(row.source_payload),card=obj(p.productCard),readiness=obj(p.researchReadiness),rCard=obj(readiness.productCard),rev=obj(p.review),runtime=obj(p.runtimeValidation),mapping=obj(p.productMapping),proof=obj(p.productMappingEvidence);
 const candidates=[
  ["review.previousProductUrl",rev.previousProductUrl],
  ["review.recoveredProductUrl",rev.recoveredProductUrl],
  ["runtimeValidation.exactProductUrl",runtime.exactProductUrl],
  ["originalProductUrl",p.originalProductUrl],
  ["verifiedDetailPageUrl",p.verifiedDetailPageUrl],
  ["officialProductUrl",p.officialProductUrl],
  ["productCard.checkoutUrl",card.checkoutUrl],
  ["productCard.productUrl",card.productUrl],
  ["researchReadiness.productCard.checkoutUrl",rCard.checkoutUrl],
  ["researchReadiness.productCard.productUrl",rCard.productUrl],
  ["productMapping.productUrl",mapping.productUrl],
  ["productMappingEvidence.productUrl",proof.productUrl],
  ["externalProductUrl",p.externalProductUrl],
  ["productUrl",p.productUrl],
  ["productPageUrl",p.productPageUrl],
  ["detailUrl",p.detailUrl],
  ["checkoutUrl",p.checkoutUrl],
  ["purchaseUrl",p.purchaseUrl],
  ["url",p.url],
  ["official_url",row.official_url],
  ["sourcePageUrl",p.sourcePageUrl]
 ].map(([source,value])=>({source,url:safeUrl(value)})).filter(x=>x.url);
 return candidates;
}
function hasDurableAssignment(p){const place=obj(p.approvedPlacement||p.selectedPlacement||p.placement),ctl=obj(p.managementControl),front=obj(p.frontPublication);return low(p.slotDecision)==="slot_candidate"||!!t(place.sectionKey||place.section||place.slot)||ctl.administratorLocked===true||["matched","published","active","publish_requested"].includes(low(front.status));}
function normalizedTitle(input){return low(input).replace(/[^\p{L}\p{N}]+/gu,"");}
function historicalOriginal(row){
 const all=obj(obj(Historical).entries),data=obj(all[t(row.id)]),p=obj(row.source_payload),currentTitle=normalizedTitle(t(row.title||p.productName||p.title));
 const original=productProofUrl(data.url),previous=normalizedTitle(data.name);
 if(original&&previous&&currentTitle&&previous===currentTitle)
   return {source:"2026-10-13-original-candidate-id-and-title",url:original};
 // URL-derived candidate IDs can change when the corrupted redirect was saved.
 // In that narrow case require an EXACT, UNIQUE title+supplier+image triple.
 const supplier=normalizedTitle(t(p.supplierName||obj(p.supplier).name||obj(p.productCard).supplierName)),
       image=safeUrl(t(p.imageUrl||p.image||obj(p.productCard).imageUrl||row.thumbnail_url));
 if(!currentTitle||!supplier||!image)return null;
 const matches=Object.entries(all).filter(([id,r])=>normalizedTitle(r.name)===currentTitle
   &&normalizedTitle(r.supplierName)===supplier&&safeUrl(r.imageUrl)===image&&productProofUrl(r.url));
 return matches.length===1?{source:"2026-10-13-unique-title-supplier-image",url:productProofUrl(matches[0][1].url)}:null;
}
function candidateCheck(row){const p=obj(row.source_payload),u=urls(row),badUrls=u.filter(x=>isChallenge(x.url)),good=u.filter(x=>productProofUrl(x.url));
 if(!badUrls.length)return null;
 // One exact concrete product URL only. A different seller or multiple product IDs
 // means evidence is ambiguous: do not attempt repair.
 const challengeHosts=new Set(badUrls.map(x=>new URL(x.url).hostname.toLowerCase()));
 const eligible=good.filter(x=>challengeHosts.has(new URL(x.url).hostname.toLowerCase()));
 const unique=new Map(eligible.map(x=>[urlKey(x.url),x]));
 const productIds=new Set(Array.from(unique.values()).map(x=>Ranking.productIdFromUrl(x.url)));
 let chosen=unique.size===1&&productIds.size===1?Array.from(unique.values())[0]:null;
 // Historical snapshot can recover a different-host official product URL
 // only on EXACT candidate ID and EXACT normalized product title match.
 const history=historicalOriginal(row);
 if(!chosen&&unique.size===0&&history)chosen=history;
 let reason=chosen?"stored_same_seller_product_detail":(unique.size>1?"multiple_original_product_urls_conflict":"original_product_detail_not_preserved");
 if(chosen&&chosen.source==="2026-10-13-original-candidate-id-and-title")reason="historical_exact_candidate_original_url";
 if(chosen&&chosen.source==="2026-10-13-unique-title-supplier-image")reason="historical_unique_title_supplier_image";
 // If two independent valid URLs disagree, fail closed.
 if(chosen&&history&&history.url&&urlKey(history.url)!==urlKey(chosen.url)&&chosen.source!==history.source){chosen=null;reason="historical_original_url_disagrees_with_current_evidence";}
 if(chosen&&hasDurableAssignment(p)){reason="existing_assignment_protected";}
 const decision=low(p.slotDecision||row.status);
 const permanentlyExcluded=obj(p.queueControl).permanentExcluded===true||decision==="purge";
 if(chosen&&permanentlyExcluded)reason="permanent_exclusion_protected";
 return {id:t(row.id),name:t(row.title||p.productName||p.title),decision,status:t(row.status),challengeFields:badUrls.map(x=>x.source),challengeExample:urlLabel(badUrls[0].url),recoveryUrl:chosen?chosen.url:null,recoveryEvidence:chosen?chosen.source:null,reason,restorable:!!chosen&&["stored_same_seller_product_detail","historical_exact_candidate_original_url","historical_unique_title_supplier_image"].includes(reason),originalUrlProof:chosen?Ranking.productIdFromUrl(chosen.url):null};
}
function affectedRegion(row,country,region){const p=obj(row.source_payload),ms=obj(p.marketScope),pl=obj(p.approvedPlacement||p.placement||p.selectedPlacement),cs=obj(p.countrySupply);
 const c=t(ms.marketCountry||cs.country||cs.countryCode||p.targetCountry||p.countryCode||pl.country).toUpperCase();
 if(c!==country&&!arr(p.marketKeys).some(x=>t(x).toUpperCase().startsWith(country+"-")))return false;
 const r=t(ms.marketRegion||cs.region||cs.regionCode||p.targetRegion||p.regionCode||pl.region||"NATIONWIDE").toUpperCase();
 return region==="NATIONWIDE"?r==="NATIONWIDE":r===region||r==="NATIONWIDE";
}
function cleanse(row,original,actor){const p=structuredClone(obj(row.source_payload)),replacement=safeUrl(original);if(!replacement||!productProofUrl(replacement))throw Error("unverified_original_url");
 const fields=["externalProductUrl","productUrl","productPageUrl","detailUrl","checkoutUrl","purchaseUrl","url","officialProductUrl","verifiedDetailPageUrl","originalProductUrl"];
 const changed=[];
 for(const key of fields){if(isChallenge(p[key])){p[key]=replacement;changed.push(key);}}
 for(const [name,item,keys] of [["productCard",obj(p.productCard),["checkoutUrl","productUrl"]],["researchReadiness.productCard",obj(obj(p.researchReadiness).productCard),["checkoutUrl","productUrl"]]]){
   const local={...item};let modified=false;
   for(const key of keys){if(isChallenge(local[key])){local[key]=replacement;modified=true;changed.push(name+"."+key);}}
   if(modified){if(name==="productCard")p.productCard=local;else p.researchReadiness={...obj(p.researchReadiness),productCard:local};}
 }
 if(isChallenge(p.sourcePageUrl)){p.sourcePageUrl=replacement;changed.push("sourcePageUrl");}
 p.urlRecovery={schema:"igdc-admin-challenge-url-recovery.v1",type:"original_stored_detail_restored",evidence:"stored_valid_detail_or_historical_exact_id_and_name",source:"administrator_explicit_only",at:new Date().toISOString(),by:t(actor.sub),fieldsChanged:changed};
 // No change to slotDecision, approvedPlacement, managementControl, queueControl,
 // inspectionComplete, productPageLive, researchStatus or frontPublication.
 return {source_payload:p,official_url:isChallenge(row.official_url)?replacement:row.official_url,updated_at:new Date().toISOString()};
}
async function scan(country,region,offsetInput,limitInput){const offset=Math.max(0,Number(offsetInput)||0),limit=Math.max(25,Math.min(125,Number(limitInput)||100));if(offset>6000)bad("최대 검색 범위를 초과했습니다.",400);
 const fields="id,kind,title,official_url,status,source_ref,source_payload,updated_at";
 const query="select="+fields+"&source_ref=eq."+encodeURIComponent(PRODUCT_REF)+"&order=updated_at.desc,id.asc&limit="+limit+"&offset="+offset;
 const rows=arr(await Store.select("gslot_candidates",query)),items=rows.filter(x=>affectedRegion(x,country,region)).map(candidateCheck).filter(Boolean);
 return {ok:true,scope:{country,region},offset,limit,processed:rows.length,hasMore:rows.length===limit,nextOffset:rows.length===limit?offset+rows.length:null,items,stats:{challengeFound:items.length,autoRecoverable:items.filter(x=>x.restorable).length,needsHistoricalSource:items.filter(x=>x.reason==="original_product_detail_not_preserved").length},readOnly:true};
}
async function fix(actor,country,region,request){if(t(request.confirm)!=="REPAIR_STORED_CHALLENGE_URL_ONLY")bad("수정 확인 코드가 일치하지 않습니다.");const ids=Array.from(new Set(arr(request.ids).map(t).filter(Boolean))).slice(0,12);if(!ids.length)bad("복구 대상이 없습니다.");
 const results=[];
 for(const id of ids){try{
  const rows=arr(await Store.select("gslot_candidates","select=id,kind,title,official_url,status,source_ref,source_payload,updated_at&id=eq."+encodeURIComponent(id)+"&limit=1"));
  const row=rows[0],check=row&&candidateCheck(row);
  if(!row||row.source_ref!==PRODUCT_REF||!affectedRegion(row,country,region)||!check||!check.restorable){results.push({id,state:"preserved",reason:check&&check.reason||"not_repairable"});continue;}
  // Additional durable assignment proof from actual DB, not just source_payload.
  const relation=arr(await Store.select("gslot_slot_assignments","select=id,candidate_id,state,publication_status&candidate_id=eq."+encodeURIComponent(id)+"&limit=3"));
  if(relation.length){results.push({id,state:"preserved",reason:"durable_assignment_protected"});continue;}
  // Refuse if same recovered product URL already belongs to another candidate.
  const duplicate=arr(await Store.select("gslot_candidates","select=id&source_ref=eq."+encodeURIComponent(PRODUCT_REF)+"&official_url=eq."+encodeURIComponent(check.recoveryUrl)+"&limit=3")).filter(x=>t(x.id)!==id);
  if(duplicate.length){results.push({id,state:"preserved",reason:"product_url_already_in_other_candidate"});continue;}
  const next=cleanse(row,check.recoveryUrl,actor),filter="id=eq."+encodeURIComponent(id)+"&updated_at=eq."+encodeURIComponent(t(row.updated_at));
  const updated=arr(await Store.update("gslot_candidates",filter,next,"return=representation"));
  if(updated.length!==1){results.push({id,state:"conflict",reason:"data_changed_while_repairing"});continue;}
  results.push({id,state:"url_repaired",originalUrl:check.recoveryUrl,proof:check.originalUrlProof,dispositionUnchanged:true});
 }catch(error){results.push({id,state:"failed",reason:t(error&&error.message)});}}
 return {ok:true,requested:ids.length,repaired:results.filter(x=>x.state==="url_repaired").length,preserved:results.filter(x=>x.state==="preserved").length,conflicts:results.filter(x=>x.state==="conflict").length,failed:results.filter(x=>x.state==="failed").length,results,safety:{frontMatch:false,publication:false,slotDecisionUnchanged:true,placementUnchanged:true,productPageLiveUnchanged:true}};
}
exports.handler=async function(event){try{const method=t(event&&event.httpMethod).toUpperCase();if(method==="OPTIONS")return reply(204,{});
 const actor=await Auth.resolveUser(event);if(!arr(actor&&actor.roles).map(low).some(x=>ROLES.has(x)))bad("administrator_required",403);
 const q=obj(event&&event.queryStringParameters),body=method==="POST"?JSON.parse(t(event.body)||"{}"):{};
 const country=t(q.country||body.country||"KR").toUpperCase(),region=t(q.region||body.region||"NATIONWIDE").toUpperCase();
 if(!/^[A-Z]{2}$/.test(country)||!/^[A-Z0-9_-]{3,60}$/.test(region))bad("invalid_scope");
 if(method==="GET")return reply(200,await scan(country,region,q.offset,q.limit));
 if(method==="POST"&&body.action==="repair")return reply(200,await fix(actor,country,region,body));
 return reply(405,{ok:false,error:"method_not_allowed"});
 }catch(error){return reply(Number(error&&error.statusCode)||500,{ok:false,error:t(error&&error.message||error)});}};
exports._test={isChallenge,productProofUrl,candidateCheck,affectedRegion,cleanse,urlLabel,fix,scan};
