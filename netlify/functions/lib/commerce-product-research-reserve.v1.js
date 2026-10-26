'use strict';
/**
 * Distribution-only country/region product reserve control.
 * Public section capacity and the private research reserve are deliberately
 * distinct. This module has no DB writes, publication or assignment authority.
 */
const Ranking=require('./commerce-product-ranking.v1');
const DEFAULT_FRONT_CATEGORY_SLOTS=100;
const TOUR_FRONT_CATEGORY_SLOTS=200;
const RESERVE_MULTIPLIER=2;
const CATEGORIES=new Set(Ranking.CATEGORY_KEYS);
const ACTIVE_STATUSES=new Set(['approval_pending','research_pending','active','approved','published','slot_candidate']);
const PUBLISHED=new Set(['published','active','matched','queued','publish_requested','pending_build','unpublish_requested']);
const text=v=>v==null?'':String(v).trim();
const low=v=>text(v).toLowerCase();
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
function categoryOf(rowInput){
 const row=obj(rowInput),payload=obj(row.source_payload),rank=obj(payload.productRanking),current=text(row.productCategory||rank.category||payload.productCategory);
 if(CATEGORIES.has(current))return current;
 const card=obj(payload.productCard),supplier=obj(payload.supplier);
 const safe={productName:text(row.productName||payload.title||card.title||row.title),supplierName:text(row.supplierName||supplier.name),productUrl:text(row.productUrl||payload.externalProductUrl||row.official_url),description:text(row.description||payload.description)};
 return Ranking.classifyCategory(safe).primary;
}
// Use the proposed 20-section destination as the primary reserve bucket.
// Without this, ten broad category labels would cap a 20-section front at
// roughly half its intended reserve capacity and starve legitimate sections.
const SECTION_NAMES=new Set(Object.entries(Ranking.FRONT_SECTION_KEYS).flatMap(([page,sections])=>sections.map(section=>page+'|'+section)));
function placementKey(value){const p=obj(value),key=text(p.key),page=text(p.page),section=text(p.sectionKey||p.section);return SECTION_NAMES.has(key)?key:(SECTION_NAMES.has(page+'|'+section)?page+'|'+section:'');}
function bucketOf(rowInput){
 const row=obj(rowInput),p=obj(row.source_payload);
 const candidates=[p.approvedPlacement,p.selectedPlacement,p.primaryPlacement,p.placement,row.approvedPlacement,row.primaryPlacement,row.selectedPlacement,row.placement,...arr(p.proposedPlacements),...arr(row.sectionAssignments)];
 for(const candidate of candidates){const key=placementKey(candidate);if(key)return key;}
 return categoryOf(row);
}
function frontCapacity(bucket,overrides){const value=Number(obj(overrides)[bucket]);return Number.isFinite(value)&&value>=1&&value<=5000?Math.floor(value):(bucket==='tour|tour'||bucket==='travel_local_services'?TOUR_FRONT_CATEGORY_SLOTS:DEFAULT_FRONT_CATEGORY_SLOTS);}
function reserveCapacity(category,overrides){return RESERVE_MULTIPLIER*frontCapacity(category,overrides);}
function scopeMatches(row,scope){
 const payload=obj(row.source_payload),market=obj(payload.marketScope),countrySupply=obj(payload.countrySupply),placement=obj(payload.approvedPlacement),country=low(scope.country),region=low(scope.region||'NATIONWIDE');
 const scopedCountry=low(market.marketCountry||countrySupply.country||countrySupply.countryCode||placement.country||payload.countryCode);
 const scopedRegion=low(market.marketRegion||countrySupply.region||countrySupply.regionCode||placement.region||payload.regionCode||'NATIONWIDE');
 return country===scopedCountry&&region===scopedRegion;
}
function reserveRowActive(row){const p=obj(row&&row.source_payload),q=obj(p.queueControl),state=low(row&&row.status),decision=low(p.slotDecision);return ACTIVE_STATUSES.has(state)&&!['hold','reject','purge','removed','suppressed'].includes(decision)&&q.hiddenFromCountryQueue!==true;}
function protectedRow(row){const p=obj(row&&row.source_payload),front=obj(p.frontPublication),placement=obj(p.approvedPlacement),manual=obj(p.managementControl);
 return p.slotDecision==='slot_candidate'||!!(placement.section||placement.sectionKey)||manual.administratorLocked===true||PUBLISHED.has(low(front.status))||row&&row._relationProtected===true;
}
function score(row){const p=obj(row&&row.source_payload),rank=obj(p.productRanking);const value=Number(row&&row.rankingScore!=null?row.rankingScore:rank.score);return Number.isFinite(value)?value:0;}
function decision(activeRows,input,options){
 const category=categoryOf(input),bucket=bucketOf(input),limit=reserveCapacity(bucket,obj(options).frontCapacities),pool=arr(activeRows).filter(row=>reserveRowActive(row)&&bucketOf(row)===bucket),protectedCount=pool.filter(protectedRow).length;
 if(pool.length<limit)return {action:'admit',category,bucket,limit,used:pool.length,protected:protectedCount};
 const incomingScore=score(input),replaceable=pool.filter(r=>!protectedRow(r)).sort((a,b)=>score(a)-score(b)||text(a.id).localeCompare(text(b.id))),worst=replaceable[0];
 if(!worst)return {action:'defer',category,bucket,limit,used:pool.length,protected:protectedCount,reason:'only_protected_candidates'};
 // A ranking tie does not justify a destructive change of an established row.
 if(incomingScore<=score(worst)+15)return {action:'defer',category,bucket,limit,used:pool.length,protected:protectedCount,reason:'reserve_full_no_rank_improvement',incomingScore,threshold:score(worst)+15};
 return {action:'replace',category,bucket,limit,used:pool.length,protected:protectedCount,replacementId:text(worst.id),incomingScore,priorScore:score(worst)};
}
function laneKey(source){
 // Product discovery fairness operates only WITHIN the same explicit priority
 // tier. Preserve every supplier and the existing admin/affiliate ordering.
 // Separate household/food and small-appliance/electronics so one abundant
 // supplier category cannot crowd out the other's early research turns.
 let key=low(source&&source.supplyLane).replace(/[-\s]+/g,'_');
 if(!key||key==='general')return 'general';
 if(/beauty|cosmetic|skincare/.test(key))return 'beauty_personal_care';
 if(/fashion|apparel|cloth/.test(key))return 'fashion';
 if(/small_appliance|kitchen_appliance|home_appliance|household_appliance/.test(key))return 'small_home_appliances';
 if(/electronics|phone|computer|audio|bluetooth|speaker|microphone/.test(key))return 'electronics_accessories';
 if(/household|daily|essentials|living/.test(key))return 'household_essentials';
 if(/food|grocery|agri/.test(key))return 'food_essentials';
 if(/furniture|appliance/.test(key))return 'home_appliances_living';
 if(/tour|travel|hotel/.test(key))return 'travel_local_services';
 return key;
}
function interleaveSuppliers(sources){
 // Fairness is applied within the same explicit operator/affiliate priority
 // tier. Do not allow one category to consume the entire discovery prefix.
 const rows=arr(sources),tiers=new Map();rows.forEach((row,i)=>{const tier=(row&&row.adminPinned===true?'0':'1')+'|'+String(99999-Math.min(99999,Math.max(0,Number(row&&row.affiliatePriority||0)))).padStart(5,'0');if(!tiers.has(tier))tiers.set(tier,[]);tiers.get(tier).push({row,i});});
 const out=[];
 for(const tier of [...tiers.keys()].sort()){
  const groups=new Map();for(const item of tiers.get(tier)){const key=laneKey(item.row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  const keys=[...groups.keys()].sort((a,b)=>groups.get(a)[0].i-groups.get(b)[0].i);
  while(keys.some(key=>groups.get(key).length)){for(const key of keys){const item=groups.get(key).shift();if(item)out.push(item.row);}}
 }
 return out;
}
module.exports={VERSION:'distribution-reserve-v1.0',DEFAULT_FRONT_CATEGORY_SLOTS,TOUR_FRONT_CATEGORY_SLOTS,RESERVE_MULTIPLIER,categoryOf,bucketOf,frontCapacity,reserveCapacity,scopeMatches,reserveRowActive,protectedRow,score,decision,interleaveSuppliers};
