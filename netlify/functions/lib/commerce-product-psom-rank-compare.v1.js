"use strict";
/**
 * Pure ranking/section replacement plan. No DB writes, no publication.
 * Only the server may supply verified candidate rows and assignment relations.
 */
const Reserve=require('./commerce-product-research-reserve.v1');
const Ranking=require('./commerce-product-ranking.v1');
const SECTION_KEYS=new Set(Object.entries(Ranking.FRONT_SECTION_KEYS).flatMap(([page,sections])=>sections.map(section=>page+'|'+section)));
const text=x=>x==null?'':String(x).trim();
const low=x=>text(x).toLowerCase();
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const arr=x=>Array.isArray(x)?x:[];
const LIVE=new Set(['published','matched','active','publish_requested','queued','pending_build','unpublish_requested','unpublish_pending','ready','audit_ready']);
function sectionKey(row){const p=plain(row&&row.source_payload);for(const placement of [p.approvedPlacement,p.selectedPlacement,p.primaryPlacement,p.placement]){const value=plain(placement),direct=text(value.key),joined=text(value.page)+'|'+text(value.section||value.sectionKey);const key=SECTION_KEYS.has(direct)?direct:(SECTION_KEYS.has(joined)?joined:'');if(key)return key;}return '';}
function isProtected(row,relations){
 const p=plain(row&&row.source_payload),m=plain(p.managementControl),q=plain(p.queueControl),front=plain(p.frontPublication),slot=low(p.slotDecision);
 const key=sectionKey(row),override=plain(p.sectionRevenueOverride),release=plain(p.sectionRevenueAutomation);
 const pinned=override.mode==='pin_top'&&text(override.scopeKey).endsWith('|'+key);
 // Unpin removes the extra top-pin lock. Previously placed private products
 // can then rejoin ordinary PSOM comparison, provided they have NO durable
 // assignment and NO public or contractual protection. The release marker is
 // written only by the authenticated administrator override endpoint.
 const ordinaryReleased=release.schema==='igdc-section-ordinary-automation-v1'&&release.ordinaryEligible===true&&text(release.scopeKey).endsWith('|'+key);
 const legacyManualLock=!ordinaryReleased&&(m.administratorLocked===true||m.aiReclassificationAllowed===false||plain(p.approvedPlacement).administratorSelected===true);
 // Every durable slot assignment is preserved: even a stale assignment can be
 // referenced by a deployment, and must be reconciled separately. An explicit
 // pin release is NOT permission to delete a live assignment or MOU supplier.
 return !row||pinned||slot!=='slot_candidate'||row._supplierRegistryProtected===true||legacyManualLock||
  LIVE.has(low(front.status))||row._relationProtected===true||arr(relations).length>0||q.permanentExcluded===true;
}
function rank(row){const p=plain(row&&row.source_payload),v=plain(p.valueAssessment),r=plain(p.productRanking),commercial=low(p.commercialPriorityClass),stage=low(plain(p.affiliateSettlement).stage);
 const base=Reserve.score(row);let bonus=0;
 if(commercial==='direct_commerce_verified')bonus+=30;else if(commercial==='formal_partner')bonus+=24;else if(commercial==='affiliate_active')bonus+=15;
 if(stage==='formal_partner')bonus+=12;else if(stage==='online_affiliate_active')bonus+=8;else if(stage==='referral_verified')bonus+=4;
 const value=Number(v.portfolioPriorityScore);if(Number.isFinite(value))bonus+=Math.max(-20,Math.min(20,value/10));
 const opportunity=Number(r.revenueOpportunityScore);if(Number.isFinite(opportunity))bonus+=Math.max(0,Math.min(10,opportunity/10));
 return Math.round((base+bonus)*100)/100;
}
function choose(input,candidates,options={}){
 const key=text(options.sectionKey),frontCap=Math.max(1,Math.floor(Number(options.frontCapacity)||100)),sectionCap=Math.max(frontCap,Math.floor(Number(options.sectionCapacity)||200)),threshold=Number.isFinite(Number(options.minImprovement))?Math.max(1,Number(options.minImprovement)):15;
 const eligible=arr(candidates).filter(row=>sectionKey(row)===key&&low(plain(row.source_payload).slotDecision)==='slot_candidate');
 const available=eligible.length<sectionCap,score=rank(input),replacement=eligible.filter(row=>!isProtected(row,plain(options.relations)[text(row.id)])).sort((a,b)=>rank(a)-rank(b)||text(a.id).localeCompare(text(b.id)))[0];
 if(eligible.some(row=>text(row.id)===text(input.id)))return{action:'preserve',reason:'already_in_section',sectionKey:key,sectionCount:eligible.length,incomingScore:score};
 // Below the public count, there is no need to evict a private candidate.
 if(eligible.length<frontCap)return{action:'place',sectionKey:key,sectionCount:eligible.length,incomingScore:score};
 if(replacement&&score>=rank(replacement)+threshold){return{action:'replace',sectionKey:key,sectionCount:eligible.length,incomingScore:score,replacementId:text(replacement.id),replacementScore:rank(replacement),improvement:Math.round((score-rank(replacement))*100)/100};}
 if(available)return{action:'place',sectionKey:key,sectionCount:eligible.length,incomingScore:score,reason:'below_private_200_capacity_no_safe_ranked_replace'};
 return{action:'defer',sectionKey:key,sectionCount:eligible.length,incomingScore:score,reason:replacement?'insufficient_rank_advantage':'no_safe_replacement'};
}
module.exports={VERSION:'commerce-product-psom-rank-compare-v1',LIVE,rank,sectionKey,isProtected,choose};
