"use strict";

/**
 * Commerce Candidate Intake v1
 * --------------------------------------------------------------------------
 * Closed pre-publication layer between SearchBank/Sanmaru discovery and the
 * Canonical Snapshot Publisher.
 *
 * It does not infer rights, sales-market readiness or customer value from a
 * URL/title.  It ranks only evidence-bearing candidates and writes a private
 * staging snapshot.  Canonical publication receives no candidate unless a
 * separate deployment environment release key is present.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const MarketSaleScope = require("./market-sale-scope.v1");
const NonPgRevenue = require("./nonpg-revenue-contract.core.v1");
const AffiliateRegistry = require("./affiliate-program-registry.v1");

const VERSION = "commerce-candidate-intake-v1.2.0-payable-revenue-qualification-gate";
const POLICY_FILE = "commerce-candidate-policy.v1.json";
const REVIEW_QUEUE_FILE = "commerce-candidate-review-queue.v1.json";
const STAGING_FILE = "commerce-candidate-staging.snapshot.v1.json";
const AUDIT_FILE = "commerce-candidate-staging.audit.v1.json";

function text(v){ return v == null ? "" : String(v).trim(); }
function lower(v){ return text(v).toLowerCase(); }
function isObject(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function clone(v){ return JSON.parse(JSON.stringify(v == null ? null : v)); }
function bool(v){ return v === true || ["1","true","yes","on","approved","verified","active","enabled"].includes(lower(v)); }
function array(v){ return Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]); }
function unique(values){ return Array.from(new Set((values || []).map(text).filter(Boolean))); }
function first(){ for(const value of arguments){ const out=text(value); if(out) return out; } return ""; }
function now(){ return new Date().toISOString(); }
function stable(v){
  if(v == null || typeof v !== "object") return JSON.stringify(v);
  if(Array.isArray(v)) return "["+v.map(stable).join(",")+"]";
  return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}";
}
function sha256(v){ return crypto.createHash("sha256").update(Buffer.isBuffer(v) ? v : Buffer.from(typeof v === "string" ? v : stable(v),"utf8")).digest("hex"); }
function safeRead(file){ try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch(_e){ return null; } }
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function atomicWrite(file, doc){
  ensureDir(path.dirname(file));
  const out=JSON.stringify(doc,null,2)+"\n";
  const temp=path.join(path.dirname(file),"."+path.basename(file)+"."+process.pid+"."+crypto.randomBytes(5).toString("hex")+".tmp");
  fs.writeFileSync(temp,out,"utf8"); fs.renameSync(temp,file);
  return sha256(Buffer.from(out,"utf8"));
}
function rootOf(input){ return path.resolve(input && input.root || process.cwd()); }
function safeHttpsUrl(v){ try { const u=new URL(text(v)); if(u.protocol!=="https:" || !u.hostname || u.hostname==="localhost" || u.hostname.endsWith(".local")) return ""; u.hash=""; return u.toString(); } catch(_e){ return ""; } }
function number(v, fallback){ const n=Number(v); return Number.isFinite(n) ? n : fallback; }
function bounded(v, min, max, fallback){ const n=number(v, fallback); return Math.max(min,Math.min(max,Number.isFinite(n)?n:fallback)); }
function normalizeCountry(v){ return MarketSaleScope.normalizeCountry(v); }
function normalizeRegion(v,c){ return MarketSaleScope.normalizeRegion(v,c); }
function isFresh(v, days){ const t=Date.parse(text(v)); return Number.isFinite(t) && t <= Date.now()+300000 && t >= Date.now()-Math.max(1,Number(days)||30)*86400000; }
function plain(v){ return isObject(v) ? v : {}; }

function policyPaths(root){ return [path.join(root,"netlify","functions","data",POLICY_FILE),path.join(root,"data",POLICY_FILE)]; }
function queuePaths(root){ return [path.join(root,"netlify","functions","data",REVIEW_QUEUE_FILE)]; }
function outputPath(root,name){ return path.join(root,"netlify","functions","data",name); }
function defaultPolicy(){ return { version:VERSION, publication:{defaultMode:"staging_only",enableEnv:"COMMERCE_CANDIDATE_RELEASE_MODE",enableValue:"enabled",keyEnv:"COMMERCE_CANDIDATE_RELEASE_KEY",minimumKeyLength:32,requireManualReleaseKey:true}, sources:{external_brokerage:{rankBoost:1800},approved_commerce_member:{rankBoost:5000},managed_sponsor:{rankBoost:3500}}, eligibility:{marketEvidenceMaxAgeDays:30}, essentialGoods:{preferredClasses:[],keywords:{},allowNonEssentialOnlyWhen:["approved_commerce_member","managed_sponsor"]}, revenue:{allowedTypes:["advertising","affiliate","brokerage","external_referral","lead","manual_affiliate","referral","sponsor"],requirePayableRevenueRightForPublicRelease:true,allowTrafficOnlyPublicRelease:false,allowVerifiedExternalReferral:true,sourcePriority:{approved_commerce_member:100,managed_sponsor:80,external_brokerage:60}}, ranking:{weights:{},searchExposure:{minimumVerifiedImpressions:100,minimumVerifiedOutboundClicks:10,maximumContribution:6}}, reviewQueue:{maxQueueAgeDays:7,directMemberRequiresApprovalState:"approved",directMemberRequiresAssignmentState:["approved","pinned"]} }; }
function loadPolicy(root){
  const base=defaultPolicy();
  const files=policyPaths(root);
  const docs=files.map(file=>({file,doc:safeRead(file)}));
  const source=docs.find(x=>isObject(x.doc));
  const problems=[];
  if(!source) problems.push("COMMERCE_CANDIDATE_POLICY_MISSING");
  if(docs[0] && docs[1] && isObject(docs[0].doc) && isObject(docs[1].doc) && sha256(docs[0].doc)!==sha256(docs[1].doc)) problems.push("COMMERCE_CANDIDATE_POLICY_MIRROR_DIVERGED");
  const policy=Object.assign({},base,source&&source.doc||{});
  return {ok:problems.length===0,problems,policy,fingerprint:sha256(policy),source:source&&source.file||null,mirrors:docs.map(x=>({path:x.file,present:isObject(x.doc),sha256:isObject(x.doc)?sha256(x.doc):null}))};
}
function loadReviewQueue(root, policy){
  const file=queuePaths(root)[0];
  const doc=safeRead(file) || { items:[] };
  const items=Array.isArray(doc.items)?doc.items:[];
  const maxDays=Number(policy.reviewQueue && policy.reviewQueue.maxQueueAgeDays || 7);
  const stale=doc.generatedAt && !isFresh(doc.generatedAt,maxDays);
  const expired=doc.expiresAt && Date.parse(doc.expiresAt) < Date.now();
  return {file,doc,items,stale:!!(stale||expired),digest:sha256(doc),problems:!Array.isArray(doc.items)?["COMMERCE_REVIEW_QUEUE_INVALID"]:[]};
}
function releaseGate(policy, input){
  const p=plain(policy.publication);
  const mode=lower((input&&input.releaseMode)||process.env[p.enableEnv||"COMMERCE_CANDIDATE_RELEASE_MODE"]||p.defaultMode||"staging_only");
  const key=text((input&&input.releaseKey)||process.env[p.keyEnv||"COMMERCE_CANDIDATE_RELEASE_KEY"]);
  const expected=lower(p.enableValue||"enabled");
  const min=Math.max(16,Number(p.minimumKeyLength)||32);
  const enabled=mode===expected && key.length>=min;
  return { enabled, mode:enabled?"release_enabled":"staging_only", reason:enabled?"deployment-release-key-present":(mode!==expected?"release-mode-not-enabled":"release-key-missing-or-short"), keyPresent:key.length>=min, keyLength:key.length };
}
function productText(item){ return lower([item&&item.title,item&&item.name,item&&item.summary,item&&item.description,item&&item.category,item&&item.productClass,item&&item.productType,item&&item.essentialClass, ...(array(item&&item.tags))].map(text).join(" ")); }
function detectedEssentialClass(item, policy){
  const explicit=lower(first(item&&item.essentialClass,item&&item.essentialGoodsClass,item&&plain(item&&item.commerceCandidate).essentialClass));
  const preferred=array(policy.essentialGoods&&policy.essentialGoods.preferredClasses).map(lower);
  if(explicit && preferred.includes(explicit)) return explicit;
  const haystack=productText(item); const keywords=plain(policy.essentialGoods&&policy.essentialGoods.keywords);
  for(const [klass, list] of Object.entries(keywords)) if(array(list).some(word=>haystack.includes(lower(word)))) return lower(klass);
  return "";
}
function sourceTier(item, inherited){
  const candidate=plain(item&&item.commerceCandidate);
  const direct=plain(item&&item.directCommerceListing);
  const raw=lower(first(inherited,candidate.sourceTier,candidate.sourceType,item&&item.sourceTier,item&&item.listingSource,direct.sourceTier));
  if(["approved_commerce_member","direct_member","commerce_member","operator_approved_direct"].includes(raw)) return "approved_commerce_member";
  if(["managed_sponsor","sponsor","sponsored"].includes(raw)) return "managed_sponsor";
  if(["external_brokerage","affiliate","brokerage","referral","external"].includes(raw)) return "external_brokerage";
  return "";
}
function candidateId(item, index, tier){ return first(item&&item.id,item&&item.productId,item&&item.product_id,item&&item.contentId,item&&item.uid,item&&plain(item&&item.commerceCandidate).candidateId) || (tier||"candidate")+"-"+sha256({index,title:item&&item.title,url:item&&item.url}).slice(0,22); }
function isCommerceSurface(item, tier){
  if(tier) return true;
  const pos=placement(item); const page=lower(pos.page), section=lower(pos.section);
  if(["home","network","networkhub","distribution","distributionhub","tour"].includes(page)) return true;
  if(page==="social" && ["rightpanel","right_panel"].includes(section)) return true;
  return /product|commerce|distribution|market|shop|seller|merchant|supplier|retail|상품|유통|판매|구매|제조|공급/.test(productText(item));
}
function sourceName(item){ const src=plain(item&&item.source); return first(src.name,src.provider,src.engine,item&&item.sourceName,item&&item.provider,item&&item.seller,item&&plain(item&&item.producer).name,item&&item.engine); }
function sourceUrl(item){ const src=plain(item&&item.source); return safeHttpsUrl(first(src.url,src.href,src.homepage,item&&item.sourceUrl,item&&item.source_url,item&&plain(item&&item.provenance).sourceUrl,item&&item.url)); }
function productDestination(item){ return safeHttpsUrl(first(item&&item.url,item&&item.externalProductUrl,item&&item.link,item&&item.href)); }
function productImage(item){ return safeHttpsUrl(first(item&&item.image,item&&item.thumbnail,item&&item.thumb,item&&item.imageUrl,plain(item&&item.media).image,plain(item&&item.media).thumb)); }
function placement(item){ const p=plain(item&&item.placement), b=plain(item&&item.bind); return {page:first(p.page,b.page,item&&item.page,item&&item.channel),section:first(p.section,b.section,item&&item.section,item&&item.psom_key),slot:first(p.slot,p.slotId,b.slot,b.slotId,item&&item.slot,item&&item.slotId)}; }
function contracts(item){ return plain(item&&item.searchBankContract) || {}; }
function eligibilityFlags(item){ const c=plain(item&&item.searchBankContract); return ["frontSupplyAllowed","searchBankEligible","snapshotEligible","indexEligible"].map(k=>({k,v:first(c[k],item&&item[k])})); }
function hasExplicitFlags(item){ return eligibilityFlags(item).every(x=>bool(x.v)); }
function trustedSeller(item){
  const c=plain(item&&item.searchBankContract), evidence=plain(item&&item.sanmaruEvidence), seller=plain(item&&item.sellerResponsibility);
  const trust=bounded(first(item&&item.trustScore,c.trustScore,evidence.trustScore,0),0,100,0);
  return { ok:trust>=62 || bool(item&&item.officialSource)||bool(item&&item.producerVerified)||bool(c.officialSource)||bool(c.producerVerified), score:trust };
}
function revenueRight(item, tier, policy, affiliateRegistry, candidateCountries){
  const source=plain(item&&item.commerceCandidate);
  const direct=plain(item&&item.directCommerceListing);
  const contract=plain(item&&item.brokerageContract);
  const sponsor=plain(item&&item.sponsorship);
  const affiliate=NonPgRevenue.affiliateForItem(item);
  const revenuePolicy=plain(policy&&policy.revenue);
  const allowed=array(revenuePolicy.allowedTypes).map(lower);
  const route=AffiliateRegistry.routeForItem(item, affiliateRegistry, candidateCountries);
  const affiliateApproved=route.ok && route.kind==="affiliate";
  const externalReferralApproved=route.ok && route.kind==="external_referral" && revenuePolicy.allowVerifiedExternalReferral===true;
  const type=lower(first(
    source.revenueType,
    direct.revenueType,
    contract.type,
    sponsor.type,
    affiliateApproved?"manual_affiliate":(externalReferralApproved?"external_referral":(affiliate.eligible?"affiliate":""))
  ));
  const permittedType=!!type && (allowed.length===0 || allowed.includes(type));
  const activeState=["approved","active","verified","live","enabled"].includes(lower(first(direct.contractStatus,contract.status,sponsor.status)));
  const contractId=first(
    direct.contractId,
    contract.id,
    sponsor.contractId,
    affiliateApproved ? route.affiliate.programId : "",
    affiliate.programId,
    affiliate.providerId
  );
  const counterparty=first(
    direct.providerName,direct.counterparty,direct.advertiserName,direct.sellerName,
    contract.providerName,contract.counterparty,contract.advertiserName,contract.sellerName,
    sponsor.sponsorName,sponsor.provider,sponsor.counterparty
  );
  const disclosureReady=bool(first(direct.disclosureReady,direct.disclosureApproved,contract.disclosureReady,contract.disclosureApproved,sponsor.disclosed));
  const settlementMode=lower(first(direct.settlementMode,direct.billingModel,direct.payoutBasis,contract.settlementMode,contract.billingModel,contract.payoutBasis,sponsor.settlementMode,sponsor.billingModel));
  const payoutBasisVerified=bool(first(direct.payoutBasisVerified,contract.payoutBasisVerified,sponsor.payoutBasisVerified));
  const commission=affiliateApproved && affiliate.commissionRate!=null ? affiliate.commissionRate : bounded(first(source.commissionRate,direct.commissionRate,contract.commissionRate),0,1,0);
  const conversion=affiliateApproved && affiliate.expectedConversionRate!=null ? affiliate.expectedConversionRate : bounded(first(source.expectedConversionRate,direct.expectedConversionRate,contract.expectedConversionRate),0,1,0);
  const estimatedNet=bounded(first(source.expectedNetRevenuePerOrder,direct.expectedNetRevenuePerOrder,contract.expectedNetRevenuePerOrder,direct.fixedFee,contract.fixedFee,direct.perLeadAmount,contract.perLeadAmount),0,1000000000,0);
  const payableAmountEvidence=estimatedNet>0 || commission>0 || bounded(first(direct.fixedFee,contract.fixedFee,sponsor.fixedFee),0,1000000000,0)>0 || bounded(first(direct.perLeadAmount,contract.perLeadAmount),0,1000000000,0)>0;
  const payableModeEvidence=["manual_invoice","bank_transfer","provider_statement","settlement_statement","fixed_fee","per_lead","cpc","cpa","cps","commission","operator_approved_statement_or_invoice"].includes(settlementMode);
  const directTypeAllowed=!["affiliate","manual_affiliate","external_referral"].includes(type);
  const directApproved=directTypeAllowed && permittedType &&
    (bool(direct.contractApproved)||bool(contract.approved)||activeState) &&
    !!contractId && !!counterparty && disclosureReady &&
    (payoutBasisVerified||payableAmountEvidence||payableModeEvidence);
  const sponsorApproved=type==="sponsor" && permittedType &&
    bool(sponsor.verified) && disclosureReady && !!contractId && !!counterparty &&
    (payoutBasisVerified||payableAmountEvidence||payableModeEvidence);
  const payable=permittedType && (affiliateApproved||directApproved||sponsorApproved);
  const allowTrafficOnlyPublic=revenuePolicy.allowTrafficOnlyPublicRelease===true;
  const rightOk=!!tier && (payable || (allowTrafficOnlyPublic && externalReferralApproved));
  const potential=payable || externalReferralApproved || !!(permittedType && (contractId||counterparty||bool(source.revenueCandidate)||bool(source.monetizationCandidate)));
  const monetizationState=affiliateApproved
    ? "verified_affiliate_payable"
    : (directApproved||sponsorApproved
      ? "verified_direct_revenue_right"
      : (externalReferralApproved?"traffic_value_only_review":"not_verified"));
  let publicRoute=AffiliateRegistry.publicRoute(route);
  let allowedCountries=route.allowedCountries||[];
  if(directApproved||sponsorApproved){
    allowedCountries=unique((candidateCountries||[]).map(normalizeCountry).filter(Boolean));
    publicRoute={
      mode:"approved_direct_revenue",
      revenueType:type,
      contractId:contractId||null,
      allowedCountries,
      disclosureReady:true,
      settlementMode:settlementMode||"operator_approved_statement_or_invoice"
    };
  }
  const verificationReasons=[];
  if(!type) verificationReasons.push("REVENUE_TYPE_MISSING");
  else if(!permittedType) verificationReasons.push("REVENUE_TYPE_NOT_ALLOWED");
  if(!payable){
    if(externalReferralApproved) verificationReasons.push("TRAFFIC_ONLY_ROUTE_HAS_NO_PAYABLE_REVENUE_RIGHT");
    else {
      if(!contractId && !affiliateApproved) verificationReasons.push("REVENUE_CONTRACT_OR_PROGRAM_ID_MISSING");
      if(!counterparty && !affiliateApproved) verificationReasons.push("REVENUE_COUNTERPARTY_MISSING");
      if(!disclosureReady && !affiliateApproved) verificationReasons.push("REVENUE_DISCLOSURE_NOT_APPROVED");
      if(!payoutBasisVerified&&!payableAmountEvidence&&!payableModeEvidence&&!affiliateApproved) verificationReasons.push("REVENUE_PAYOUT_BASIS_NOT_VERIFIED");
    }
  }
  const certainty=affiliateApproved?100:((directApproved||sponsorApproved)?95:(externalReferralApproved?35:(potential?15:0)));
  return {
    ok:rightOk,
    payable,
    potential,
    type:type||null,
    contractId:contractId||null,
    counterparty:counterparty||null,
    settlementMode:settlementMode||null,
    disclosureReady,
    payoutBasisVerified:payoutBasisVerified||payableAmountEvidence||payableModeEvidence,
    verificationReasons,
    affiliate,
    route,
    publicRoute,
    allowedCountries,
    monetizationState,
    estimatedNetRevenuePerOrder:affiliateApproved||directApproved||sponsorApproved?estimatedNet:0,
    commissionRate:commission,
    expectedConversionRate:conversion,
    certainty
  };
}
function reviewApproval(item, tier, policy){
  if(tier!=="approved_commerce_member" && tier!=="managed_sponsor") return {ok:true, state:"not-required"};
  const review=plain(item&&item.commerceReview), listing=plain(item&&item.directCommerceListing), approval=plain(item&&item.operatorApproval);
  const desired=lower(policy.reviewQueue&&policy.reviewQueue.directMemberRequiresApprovalState||"approved");
  const allowed=array(policy.reviewQueue&&policy.reviewQueue.directMemberRequiresAssignmentState||["approved","pinned"]).map(lower);
  const state=lower(first(review.status,listing.reviewStatus,approval.status));
  const assignment=lower(first(review.assignmentState,listing.assignmentState,approval.assignmentState));
  const id=first(review.approvalId,listing.approvalId,approval.approvalId,approval.id);
  const at=first(review.approvedAt,listing.approvedAt,approval.approvedAt,approval.updatedAt);
  return {ok:state===desired && allowed.includes(assignment) && !!id && !!at,state,assignment,approvalId:id||null,approvedAt:at||null};
}
function marketReady(item, policy){
  const records=MarketSaleScope.recordsFor(item);
  const maxAge=Number(policy.eligibility&&policy.eligibility.marketEvidenceMaxAgeDays||30);
  const validations=records.map(record=>({record,result:MarketSaleScope.validateMarketRecord(record,{maxVerificationAgeDays:maxAge,requireFresh:true})}));
  // A product can be valid in one sales market and incomplete in another. Keep
  // the verified market(s) and hold only the incomplete market(s); never let
  // one country manufacture eligibility for another.
  const validRecords=validations.filter(x=>x.result.ok).map(x=>x.record);
  const invalidRecords=validations.filter(x=>!x.result.ok);
  return {ok:validRecords.length>0,records,validRecords,invalidRecords,validations};
}
function marketCountries(records){ return unique((records||[]).map(record=>normalizeCountry(record&&record.country)).filter(Boolean)); }
function publicationMarkets(market, revenue){
  const allowed=unique((revenue&&revenue.allowedCountries||[]).map(normalizeCountry).filter(Boolean));
  const kept=allowed.length ? (market.validRecords||[]).filter(record=>allowed.includes(normalizeCountry(record&&record.country))) : (market.validRecords||[]).slice();
  const blocked=(market.validRecords||[]).filter(record=>!kept.includes(record)).map(record=>({country:normalizeCountry(record&&record.country),regions:(record&&record.regions||[]).slice(),reason:"OUTBOUND_ROUTE_MARKET_NOT_ALLOWED"}));
  return {ok:kept.length>0,validRecords:kept,blocked,allowedCountries:allowed};
}
function metricSource(item){ return plain(item&&item.rankingSignals); }
function ranking(item, tier, essentialClass, trust, revenue, market, policy){
  const signal=metricSource(item); const raw=plain(item&&item.commerceCandidate); const weights=plain(policy.ranking&&policy.ranking.weights); const priorities=plain(policy.revenue&&policy.revenue.sourcePriority);
  const scoreOf=(value, fallback)=>bounded(value,0,100,fallback);
  const essentiality=essentialClass?100:scoreOf(first(raw.essentialityScore,signal.essentialityScore),0);
  const affordability=scoreOf(first(raw.affordabilityScore,signal.affordabilityScore),40);
  const repeatPurchase=scoreOf(first(raw.repeatPurchaseScore,signal.repeatPurchaseScore),30);
  const sellerTrust=scoreOf(first(raw.sellerTrustScore,trust.score),trust.score);
  const marketReadiness=market.ok?100:0;
  const revenueCertainty=revenue.certainty;
  const expectedNetRevenue=bounded(revenue.estimatedNetRevenuePerOrder,0,1000000000,0)>0?100:Math.round((revenue.commissionRate||0)*(revenue.expectedConversionRate||0)*10000);
  const trafficValue=revenue&&revenue.monetizationState==="traffic_value_only_review" ? 35 : 0;
  const signalSource=lower(first(signal.source,signal.origin,signal.engine));
  const verifiedSignals=(signalSource==="search-exposure-engine" || signalSource==="searchbank-ranking") &&
    (bool(signal.serverVerified)||bool(signal.signed)) && isFresh(first(signal.verifiedAt,signal.updatedAt),30) && !!text(first(signal.evidenceDigest,signal.signatureDigest));
  const exposurePolicy=plain(policy.ranking&&policy.ranking.searchExposure);
  const minImp=Number(exposurePolicy.minimumVerifiedImpressions||100), minClicks=Number(exposurePolicy.minimumVerifiedOutboundClicks||10);
  const impressions=bounded(signal.impressions,0,1000000000,0), clicks=bounded(first(signal.outboundClicks,signal.clicks),0,1000000000,0);
  const searchExposure=verifiedSignals && impressions>=minImp && clicks>=minClicks ? Math.min(100,Math.round((Math.log10(1+impressions)+Math.log10(1+clicks))*20)) : 0;
  const conversionQuality=verifiedSignals && clicks>=minClicks ? scoreOf(first(signal.verifiedConversionScore,signal.conversionQualityScore),0) : 0;
  const operatorCost=scoreOf(first(raw.operatorCostScore,signal.operatorCostScore),35);
  const risk=scoreOf(first(raw.riskScore,signal.riskScore),0);
  const source=scoreOf(priorities[tier],0);
  const w=(name, fallback)=>Number.isFinite(Number(weights[name]))?Number(weights[name]):fallback;
  const positive=source*w("sourcePriority",50)/100+essentiality*w("essentiality",24)/100+affordability*w("affordability",10)/100+repeatPurchase*w("repeatPurchase",8)/100+sellerTrust*w("sellerTrust",18)/100+marketReadiness*w("marketReadiness",22)/100+revenueCertainty*w("revenueCertainty",24)/100+expectedNetRevenue*w("expectedNetRevenue",12)/100+searchExposure*w("searchExposure",6)/100+conversionQuality*w("conversionQuality",8)/100+trafficValue*w("trafficValue",4)/100;
  const negative=operatorCost*w("operatorCostPenalty",14)/100+risk*w("riskPenalty",30)/100;
  const boost=Number(plain(policy.sources)[tier]&&plain(policy.sources)[tier].rankBoost||0);
  return {score:Math.round((positive-negative)*100)/100,sourcePriority:source,essentiality,affordability,repeatPurchase,sellerTrust,marketReadiness,revenueCertainty,expectedNetRevenueScore:expectedNetRevenue,searchExposure,conversionQuality,operatorCost,risk,trafficValue,boost,finalScore:Math.round((positive-negative+boost)*100)/100,signalsAccepted:verifiedSignals};
}
function queueRecordToItem(entry){
  const candidate=clone(plain(entry&&entry.candidate));
  if(!candidate || !Object.keys(candidate).length) return null;
  const review=plain(entry.review); const assignment=plain(entry.assignment); const revenue=plain(entry.revenue);
  candidate.commerceCandidate=Object.assign({},plain(candidate.commerceCandidate),{sourceTier:first(entry.sourceTier,"approved_commerce_member")});
  candidate.directCommerceListing=Object.assign({},plain(candidate.directCommerceListing),plain(entry.directCommerceListing),{sourceTier:first(entry.sourceTier,"approved_commerce_member"),contractApproved:bool(first(entry.contractApproved,plain(entry.directCommerceListing).contractApproved)),contractStatus:first(entry.contractStatus,plain(entry.directCommerceListing).contractStatus),contractId:first(entry.contractId,plain(entry.directCommerceListing).contractId),expectedNetRevenuePerOrder:first(entry.expectedNetRevenuePerOrder,plain(entry.directCommerceListing).expectedNetRevenuePerOrder)});
  candidate.commerceReview=Object.assign({},plain(candidate.commerceReview),review,{assignmentState:first(review.assignmentState,assignment.state),approvalId:first(review.approvalId,assignment.id),approvedAt:first(review.approvedAt,assignment.updatedAt)});
  candidate.brokerageContract=Object.assign({},plain(candidate.brokerageContract),revenue,{approved:bool(first(revenue.approved,entry.contractApproved)),status:first(revenue.status,entry.contractStatus),id:first(revenue.contractId,entry.contractId),expectedNetRevenuePerOrder:first(revenue.expectedNetRevenuePerOrder,entry.expectedNetRevenuePerOrder)});
  return candidate;
}
function createEnvelope(item, index, tier, origin){
  const base=clone(item); base.commerceCandidate=Object.assign({},plain(base.commerceCandidate),{sourceTier:tier,origin:origin||"searchbank"});
  return base;
}
function candidateDecision(item, index, tier, origin, policy, affiliateRegistry){
  const reasons=[];
  const id=candidateId(item,index,tier);
  if(!tier) reasons.push("SOURCE_TIER_MISSING_OR_UNRECOGNIZED");
  const destination=productDestination(item), image=productImage(item), pos=placement(item);
  if(!text(item&&item.title||item&&item.name)) reasons.push("TITLE_MISSING");
  if(!destination) reasons.push("DESTINATION_NOT_HTTPS");
  if(!image) reasons.push("IMAGE_NOT_HTTPS");
  if(!pos.page || !pos.section) reasons.push("PSOM_PLACEMENT_MISSING");
  if(plain(policy.eligibility).requireSearchBankEligibilityFlags!==false && !hasExplicitFlags(item)) reasons.push("SEARCHBANK_ELIGIBILITY_FLAGS_MISSING");
  const trust=trustedSeller(item); if(!trust.ok) reasons.push("TRUSTED_SELLER_OR_PRODUCER_EVIDENCE_MISSING");
  const essential=detectedEssentialClass(item,policy);
  const exception=array(plain(policy.essentialGoods).allowNonEssentialOnlyWhen).map(lower).includes(tier);
  if(!essential && !exception) reasons.push("LIFE_ESSENTIAL_CATEGORY_NOT_CONFIRMED");
  const market=marketReady(item,policy); if(!market.ok) reasons.push("MARKET_SALE_EVIDENCE_INCOMPLETE_OR_STALE");
  const revenue=revenueRight(item,tier,policy,affiliateRegistry,marketCountries(market.validRecords));
  if(!revenue.potential) reasons.push("REVENUE_OPPORTUNITY_EVIDENCE_MISSING");
  if(!revenue.ok) reasons.push("PAYABLE_NON_PG_REVENUE_RIGHT_NOT_VERIFIED");
  const publishMarkets=publicationMarkets(market,revenue); if(market.ok && !publishMarkets.ok) reasons.push("REVENUE_ROUTE_HAS_NO_ALLOWED_VERIFIED_MARKET");
  const approval=reviewApproval(item,tier,policy); if(!approval.ok) reasons.push("DIRECT_LISTING_ADMIN_APPROVAL_OR_ASSIGNMENT_MISSING");
  const rank=ranking(item,tier,essential,trust,revenue,market,policy);
  const releaseEligible=reasons.length===0;
  const result={
    candidateId:id, sourceTier:tier||null, origin:origin||"searchbank", releaseEligible,
    stageStatus:releaseEligible?"eligible_for_release":(revenue.potential?"revenue_review_required":"hold"), reasons,
    essentialClass:essential||null, placement:pos, market, publishMarkets, marketCount:publishMarkets.validRecords.length,
    heldMarketCount:market.invalidRecords.length+publishMarkets.blocked.length,
    marketKeys:publishMarkets.validRecords.flatMap(record=>{ const values=record.regions.slice(); if(record.nationwide) values.push("NATIONWIDE"); return values.map(region=>MarketSaleScope.marketKey(record,region)); }),
    heldMarketReasons:market.invalidRecords.map(x=>({country:x.record.country,regions:(x.record.regions||[]).slice(),reasons:x.result.reasons.slice()})).concat(publishMarkets.blocked.map(x=>({country:x.country,regions:x.regions,reasons:[x.reason]}))),
    revenue:{type:revenue.type,contractId:revenue.contractId,counterparty:revenue.counterparty,settlementMode:revenue.settlementMode,disclosureReady:revenue.disclosureReady,payoutBasisVerified:revenue.payoutBasisVerified,payable:revenue.payable,potential:revenue.potential,verificationReasons:revenue.verificationReasons,certainty:revenue.certainty,affiliateEligible:revenue.route&&revenue.route.kind==="affiliate",outboundRoute:revenue.publicRoute,monetizationState:revenue.monetizationState,allowedCountries:revenue.allowedCountries,estimatedNetRevenuePerOrder:revenue.estimatedNetRevenuePerOrder,commissionRate:revenue.commissionRate,expectedConversionRate:revenue.expectedConversionRate},
    review:{ok:approval.ok,state:approval.state,assignment:approval.assignment||null,approvalId:approval.approvalId||null,approvedAt:approval.approvedAt||null},
    ranking:rank, destinationHost:(()=>{try{return new URL(destination).hostname.toLowerCase()}catch(_e){return null}})(),
    item
  };
  result.digest=sha256({candidateId:id,sourceTier:result.sourceTier,origin:result.origin,releaseEligible,reasons,essentialClass:result.essentialClass,placement:pos,marketKeys:result.marketKeys,heldMarketReasons:result.heldMarketReasons,revenue:result.revenue,review:result.review,ranking:rank,destination});
  return result;
}
function build(input){
  const root=rootOf(input); const policyPack=loadPolicy(root); const policy=policyPack.policy; const affiliateRegistry=AffiliateRegistry.load(root); const gate=releaseGate(policy,input); const queue=loadReviewQueue(root,policy);
  const raw=array(input&&input.items); const all=[]; let skippedNonCommerce=0;
  raw.forEach((rawItem,index)=>{
    const tier=sourceTier(rawItem);
    if(!isCommerceSurface(rawItem,tier)){ skippedNonCommerce += 1; return; }
    all.push({item:createEnvelope(rawItem,index,tier,"searchbank"),index,origin:"searchbank"});
  });
  if(!queue.stale){
    queue.items.forEach((entry,index)=>{ const item=queueRecordToItem(entry); if(item) all.push({item:createEnvelope(item,raw.length+index,sourceTier(item,entry.sourceTier),"admin_review_queue"),index:raw.length+index,origin:"admin_review_queue"}); });
  }
  const decisions=all.map(entry=>candidateDecision(entry.item,entry.index,sourceTier(entry.item),entry.origin,policy,affiliateRegistry));
  decisions.sort((a,b)=>b.ranking.finalScore-a.ranking.finalScore||a.candidateId.localeCompare(b.candidateId));
  const releaseDecisions=gate.enabled?decisions.filter(x=>x.releaseEligible):[];
  const outputItems=releaseDecisions.map(decision=>{
    const candidate=clone(decision.item);
    // Canonical expands only the independently verified sales markets. Invalid
    // market records remain visible in the private audit, never in public input.
    const marketAvailability=plain(candidate.marketAvailability);
    candidate.marketAvailability=Object.assign({},marketAvailability,{markets:clone(decision.publishMarkets.validRecords)});
    candidate.id=candidate.id||decision.candidateId;
    candidate.commerceCandidate=Object.assign({},plain(candidate.commerceCandidate),{
      version:VERSION, candidateId:decision.candidateId, sourceTier:decision.sourceTier, origin:decision.origin,
      essentialClass:decision.essentialClass, releaseEligible:true, selectionDigest:decision.digest,
      ranking:decision.ranking, revenue:decision.revenue, review:decision.review, verifiedMarketKeys:decision.marketKeys, heldMarketReasons:decision.heldMarketReasons, stagedAt:now()
    });
    candidate.outboundRoute=Object.assign({},decision.revenue.outboundRoute||{}, { candidateId:decision.candidateId, routeDigest:sha256({candidateId:decision.candidateId,revenue:decision.revenue,markets:decision.marketKeys}) });
    if(candidate.outboundRoute.mode==="approved_manual_affiliate") candidate.affiliateOutboundUrl="/.netlify/functions/affiliate-outbound?id="+encodeURIComponent(decision.candidateId);
    if(candidate.outboundRoute.mode==="verified_external_referral") candidate.externalOutboundUrl="/.netlify/functions/affiliate-outbound?id="+encodeURIComponent(decision.candidateId);
    candidate.candidateSelection={version:VERSION,releaseEligible:true,sourceTier:decision.sourceTier,selectionDigest:decision.digest,rankingScore:decision.ranking.finalScore,ranking:decision.ranking,revenue:decision.revenue,review:decision.review,stagedAt:now()};
    candidate.priority=Math.max(number(candidate.priority,0),Math.round(decision.ranking.finalScore*100));
    if(decision.sourceTier==="approved_commerce_member") candidate.managedPriority=true;
    return candidate;
  });
  const summary={receivedSearchBank:raw.length,skippedNonCommerce,receivedReviewQueue:queue.stale?0:queue.items.length,queueStale:queue.stale,considered:decisions.length,eligibleForRelease:decisions.filter(x=>x.releaseEligible).length,releasedToCanonical:outputItems.length,held:decisions.filter(x=>!x.releaseEligible).length,bySource:{},byReason:{}};
  decisions.forEach(x=>{ summary.bySource[x.sourceTier||"unknown"]=(summary.bySource[x.sourceTier||"unknown"]||0)+1; x.reasons.forEach(r=>summary.byReason[r]=(summary.byReason[r]||0)+1); });
  const stageDoc={schema:"commerce-candidate-staging.snapshot.v1",version:VERSION,generatedAt:now(),policy:{version:policy.version,fingerprint:policyPack.fingerprint},affiliateRegistry:{version:affiliateRegistry.raw&&affiliateRegistry.raw.version||AffiliateRegistry.VERSION,fingerprint:affiliateRegistry.fingerprint,ok:affiliateRegistry.ok,problems:affiliateRegistry.problems},releaseGate:{enabled:gate.enabled,mode:gate.mode,reason:gate.reason,keyPresent:gate.keyPresent},source:{searchBankCount:raw.length,reviewQueueDigest:queue.digest,reviewQueueStale:queue.stale},summary,candidates:decisions.map(x=>({candidateId:x.candidateId,sourceTier:x.sourceTier,origin:x.origin,stageStatus:x.stageStatus,releaseEligible:x.releaseEligible,reasons:x.reasons,essentialClass:x.essentialClass,placement:x.placement,marketKeys:x.marketKeys,heldMarketCount:x.heldMarketCount,heldMarketReasons:x.heldMarketReasons,revenue:x.revenue,review:x.review,ranking:x.ranking,destinationHost:x.destinationHost,digest:x.digest})),releaseCandidateIds:outputItems.map(x=>x.commerceCandidate.candidateId)};
  const auditDoc={schema:"commerce-candidate-staging.audit.v1",version:VERSION,generatedAt:now(),policyFingerprint:policyPack.fingerprint,queueDigest:queue.digest,queueStale:queue.stale,releaseGate:{enabled:gate.enabled,mode:gate.mode,reason:gate.reason},summary,held:decisions.filter(x=>!x.releaseEligible).slice(0,50000).map(x=>({candidateId:x.candidateId,sourceTier:x.sourceTier,origin:x.origin,reasons:x.reasons,digest:x.digest}))};
  const digest=sha256({sourceItems:raw,queueDigest:queue.digest,policy:policyPack.fingerprint,affiliateRegistry:affiliateRegistry.fingerprint,stage:stageDoc.candidates,gate:{enabled:gate.enabled,mode:gate.mode}});
  if(input&&input.write!==false){ atomicWrite(outputPath(root,STAGING_FILE),stageDoc); atomicWrite(outputPath(root,AUDIT_FILE),auditDoc); }
  return {ok:policyPack.ok && affiliateRegistry.ok && queue.problems.length===0,version:VERSION,policy:policyPack,affiliateRegistry,queue:{file:queue.file,digest:queue.digest,stale:queue.stale,problems:queue.problems},releaseGate:gate,summary,stage:stageDoc,releaseItems:outputItems,digest,problems:policyPack.problems.concat(affiliateRegistry.problems,queue.problems)};
}
function readStage(rootInput){ const root=rootOf({root:rootInput}); return safeRead(outputPath(root,STAGING_FILE)); }

module.exports={VERSION,POLICY_FILE,REVIEW_QUEUE_FILE,STAGING_FILE,AUDIT_FILE,loadPolicy,loadReviewQueue,releaseGate,detectedEssentialClass,revenueRight,marketReady,publicationMarkets,candidateDecision,build,readStage,sha256};
