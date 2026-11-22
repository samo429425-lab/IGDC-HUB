'use strict';
/**
 * Shared, country-neutral commercial proof for price-comparison / referral
 * landing pages. This is NOT an automatic deletion or a finding of fraud.
 * A hotel-name URL on an aggregator is a discovery lead, not proof of an
 * individually bookable inventory unit or of IGDC's referral authorization.
 * Existing administrator-owned records remain untouched. New automatic
 * promotion and new manual placement must satisfy independently verifiable
 * booking and commercial-rights gates.
 */
const txt=v=>v==null?'':String(v).trim();
const lower=v=>txt(v).toLowerCase();
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const COMPARISON_HOSTS=[
  /(^|\.)hotelscombined\.[a-z.]+$/i,
  /(^|\.)kayak\.[a-z.]+$/i,
  /(^|\.)trivago\.[a-z.]+$/i,
  /(^|\.)momondo\.[a-z.]+$/i,
  /(^|\.)skyscanner\.[a-z.]+$/i,
  /(^|\.)wego\.[a-z.]+$/i
];
function host(v){try{const u=new URL(txt(v));return /^https?:$/.test(u.protocol)?u.hostname.toLowerCase().replace(/\.$/,''):'';}catch(_){return '';}}
function isComparisonHost(v){const h=host(v);return !!h&&COMPARISON_HOSTS.some(rx=>rx.test(h));}
function isComparisonCandidate(row){
  const r=obj(row);
  return [r.verifiedDetailPageUrl,r.productUrl,r.url,r.supplierSiteUrl,
    r.originalOfficialProductUrl,r.sourceUrl].some(isComparisonHost);
}
function isProvenReferralContract(r){
  const settlement=obj(r.affiliateSettlement),revenue=obj(r.revenue),partner=obj(r.verifiedPartner),commercial=obj(r.commercialVerification);
  const contract=txt(settlement.contractId||settlement.verifiedContractId||revenue.contractId||partner.contractId||commercial.contractId);
  return !!contract&&(settlement.settlementReady===true||partner.verified===true||commercial.verified===true);
}
function evaluate(row){
  const r=obj(row),issues=[];
  if(!isComparisonCandidate(r))return {comparisonSite:false,accepted:true,issues:[],category:null};
  const type=lower(r.supplierType||obj(r.supplier).supplierType);
  if(/^(?:producer|manufacturer|manufacturing|factory|제조사|생산자)$/.test(type))issues.push('comparison_service_not_manufacturer');
  if(!isProvenReferralContract(r))issues.push('comparison_referral_contract_not_verified');
  if(r.travelInventoryVerified!==true)issues.push('specific_bookable_inventory_not_verified');
  // Hotel profile availability such as `InStock` is not evidence of a
  // priced bookable room at a chosen date. A verified booking route and real
  // item/offer evidence must accompany any commercial promotion.
  const commercial=obj(r.commercialVerification);
  if(!(r.offerPresent===true&&!!txt(r.price)&&commercial.actualOfferVerified===true))issues.push('bookable_offer_price_not_verified');
  return {comparisonSite:true,accepted:issues.length===0,issues,category:'travel_referral_comparison'};
}
module.exports={VERSION:'igdc-commercial-landing-guard.v1',isComparisonHost,isComparisonCandidate,isProvenReferralContract,evaluate};
