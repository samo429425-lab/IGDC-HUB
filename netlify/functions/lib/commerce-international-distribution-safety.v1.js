"use strict";
/**
 * Country-independent private research / automatic-placement safety contract.
 * SearchBank and MARU Search output are discovery inputs, NOT supplier identity
 * or delivery evidence. Operator-pinned/manual/contract records are never
 * overwritten by this module. Unsupported proof remains PENDING, not fraud.
 * A seller-site claim is never independent shipment or regulatory proof.
 */
const SourceGuard=require('./commerce-supplier-source-guard.v1');
const VERSION='igdc-international-distribution-safety.v1';
const POLICY=Object.freeze({schema:VERSION,appliesTo:'country_registry_scopes',koreanProtectionPreserved:true,
  overseasAutomaticPlacementRequires:'fresh_merchant_site_policy_and_local_market_evidence',
  crossBorderDefault:'private_research_only_no_auto_placement_without_independent_proof',
  unknownData:'pending_not_assumed_safe_or_fraud',publicPublication:'separate_administrator_front_match',
  verificationItems:['seller_legal_identity','official_seller_site','seller_market','destination_delivery','stock','returns','refund','after_sales','customs_tax_if_cross_border','restricted_goods_country_rules','affiliate_revenue_and_seller_responsibility'],
  automatedClaimsNotProof:['ip_origin','border_adjacency','search_result_country','supplier_volume_claim','carrier_name_mention']});
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const str=x=>String(x==null?'':x).trim();
const isoCountry=x=>/^[A-Z]{2}$/.test(str(x).toUpperCase())?str(x).toUpperCase():'';
const arr=x=>Array.isArray(x)?x:[];
const inactive=new Set(['blocked','suppressed','rejected','reject','disabled','excluded','removed','purged','hold','held']);
function supplier(rowInput,targetInput){
  const row=obj(rowInput),e=obj(row.evidence||row.brokerageVerification),log=obj(row.countryLogistics||e.countryLogistics),pol=obj(e.publicPolicyChecks||row.supplierPolicyChecks),
    country=isoCountry(targetInput||e.targetCountry||log.targetCountry||row.targetCountry),
    sellerCountry=isoCountry(log.sellerAddressCountryClaim||e.sellerAddressCountryClaim),
    url=str(row.url||row.supplierOfficialUrl||row.supplierSiteUrl||row.official_url),sourceBlock=SourceGuard.reason(url),
    confirmedRisk=arr(row.confirmedRiskSignals).length>0||arr(e.confirmedRiskSignals).length>0,
    disabled=inactive.has(str(row.status).toLowerCase())||inactive.has(str(row.decision).toLowerCase())||inactive.has(str(row.operatorDecision).toLowerCase()),
    checked=Date.parse(str(e.inspectedAt)),sellerEvidenceFresh=Number.isFinite(checked)&&Date.now()-checked<=30*86400000&&checked<=Date.now()+300000,
    inspected=e.automatedInspection===true&&!!str(e.inspectedUrl)&&Number(e.policyPagesInspected||0)>0&&sellerEvidenceFresh,
    shippingPolicy=!!str(pol.shippingPolicyUrl),returnPolicy=!!str(pol.returnsPolicyUrl),refundPolicy=!!str(pol.refundPolicyUrl),supportPolicy=!!str(pol.supportPolicyUrl),
    claimedDest=log.targetCountryShippingClaim===true&&isoCountry(log.targetCountry)===country,
    crossBorder=!!country&&!!sellerCountry&&sellerCountry!==country,
    unsupportedCrossBorder=crossBorder&&!claimedDest;
  const blockers=[];
  if(sourceBlock)blockers.push('invalid_supplier_source:'+sourceBlock);
  if(confirmedRisk)blockers.push('confirmed_supplier_risk');
  if(disabled)blockers.push('operator_disabled_supplier');
  if(unsupportedCrossBorder)blockers.push('foreign_seller_target_shipping_unverified');
  const missing=[];
  if(!country)missing.push('country_scope');
  if(!sellerCountry)missing.push('seller_address_country');
  if(!inspected)missing.push('current_seller_site_policy_inspection');
  if(!shippingPolicy)missing.push('shipping_policy');
  if(!returnPolicy)missing.push('returns_policy');
  if(!refundPolicy)missing.push('refund_policy');
  if(!supportPolicy)missing.push('customer_support_policy');
  if(crossBorder){missing.push('independent_border_delivery_and_customs_confirmation');if(!claimedDest)missing.push('destination_shipping_claim');}
  const researchAllowed=!blockers.length;
  // This is a private REVIEW qualification, not seller approval for trade.
  const qualifiedForOverseasTarget=researchAllowed&&!!country&&!!sellerCountry&&sellerCountry===country&&inspected&&shippingPolicy&&returnPolicy&&refundPolicy&&supportPolicy&&
    e.responsibleEntity===true&&e.directSales===true;
  return{schema:VERSION,targetCountry:country||null,sellerAddressCountryClaim:sellerCountry||null,
    crossBorder,sourceBlocked:!!sourceBlock,privateProductResearchAllowed:researchAllowed,
    overseasPolicyQualified:qualifiedForOverseasTarget,
    automaticCrossBorderApproval:false,publicPublicationApproved:false,
    status:blockers.length?'blocked_for_automation':(missing.length?'private_research_review_pending':'private_research_policy_checked'),
    blockers,missingEvidence:Array.from(new Set(missing)),checkBasis:'seller_site_claims_are_not_independently_verified',
    evidenceSource:'stored_supplier_inspection_no_ip_geolocation'};
}
function product(rowInput,targetInput){
  const row=obj(rowInput),scope=obj(row.marketScope),supply=obj(row.countrySupply),e=obj(row.internationalSafety),
    country=isoCountry(targetInput||e.targetCountry||obj(row.countryLogistics).targetCountry||scope.marketCountry||supply.country||obj(row.foreignSupplierSafety).country),
    log=obj(row.countryLogistics||row.supplierLogistics||supply.logisticsEvidence||obj(row.supplier).logisticsEvidence),
    sellerCountry=isoCountry(log.sellerAddressCountryClaim||row.supplierOriginCountryClaim),
    checks=obj(row.supplierPolicyChecks||row.publicPolicyChecks),
    risk=obj(row.riskAssessment),source=SourceGuard.reason(row.supplierSiteUrl||row.supplierOfficialUrl||obj(row.supplier).officialUrl||row.productUrl||row.url),
    crossBorder=!!country&&!!sellerCountry&&sellerCountry!==country,
    sellerPolicyOK=!!str(checks.shippingPolicyUrl)&&!!str(checks.returnsPolicyUrl)&&!!str(checks.refundPolicyUrl)&&!!str(checks.supportPolicyUrl),
    countryMatch=!!country&&sellerCountry===country,
    blockCountry=country&&country!=='KR';
  const blockers=[];
  if(source)blockers.push('invalid_seller_source:'+source);
  if(risk.explicitUnavailable===true||arr(risk.blockers).some(x=>/fraud|phishing|counterfeit|illegal|sanction|unsafe|malware|위조|사기|불법|피싱/i.test(str(x))))blockers.push('confirmed_product_risk');
  // Korea retains its pre-existing manual and AI decision path. Overseas
  // markets require actual seller-controlled policy pages before AUTO placement.
  if(blockCountry){
    if(!countryMatch)blockers.push(crossBorder?'cross_border_independent_delivery_proof_required':'seller_country_not_confirmed');
    const sellerUrl=str(row.supplierSiteUrl||row.supplierOfficialUrl||obj(row.supplier).officialUrl||row.productUrl||row.url);
    if(!/^https:\/\//i.test(sellerUrl))blockers.push('secure_seller_site_required');
    if(!sellerPolicyOK)blockers.push('seller_shipping_returns_refunds_support_evidence_incomplete');
    if(row.supplierEvidenceReady!==true)blockers.push('supplier_review_evidence_pending');
    if(row.productPageLive!==true||row.inspectionComplete!==true)blockers.push('fresh_product_page_validation_required');
    const checked=Date.parse(str(row.inspectedAt||row.lastVerifiedAt));
    if(!Number.isFinite(checked)||Date.now()-checked>30*24*60*60*1000||checked>Date.now()+5*60*1000)blockers.push('product_evidence_expired_or_missing');
  }
  return{schema:VERSION,targetCountry:country||null,sourceBlocked:!!source,
    eligibleForAutomaticPrivatePlacement:blockers.length===0,
    reason:blockers[0]||'country_seller_policy_checked_private_only',
    blockers,automaticCrossBorderApproval:false,automaticPublicPublication:false,
    manualAdministratorReviewAllowed:!source&&blockers.every(x=>!['confirmed_product_risk'].includes(x)),
    requiredEvidence:POLICY.verificationItems.slice(),crossBorder};
}
module.exports={VERSION,POLICY,supplier,product};
