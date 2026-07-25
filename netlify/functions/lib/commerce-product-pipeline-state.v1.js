"use strict";

/*
 * IGDC product pipeline lifecycle contract.
 *
 * This module does not publish, charge, copy third-party media, or open seller
 * pages.  It only describes where a researched external-seller product sits in
 * the private commerce pipeline and which evidence is still required.
 */

const ProductRanking = require("./commerce-product-ranking.v1");

const VERSION = "commerce-product-pipeline-state-v1.3.0-explicit-go-live-audit-publication-gate";
const SOURCE_REF = "country-product-ranking-review";
const STAGES = Object.freeze([
  "research_discovered",
  "research_review_ready",
  "private_research_queue",
  "administrator_selection_pending",
  "market_evidence_pending",
  "trust_evidence_pending",
  "revenue_route_pending",
  "slot_assignment_pending",
  "registry_sync_ready",
  "staged_release_review",
  "canonical_canary_ready",
  "published_external_checkout",
  "held",
  "rejected"
]);

function text(value){ return value == null ? "" : String(value).trim(); }
function lower(value){ return text(value).toLowerCase(); }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value){ return Array.isArray(value) ? value : []; }
function first(){ for(const value of arguments){ const out=text(value); if(out) return out; } return ""; }
function safeHttpsUrl(value){ try{ const url=new URL(text(value)); return url.protocol === "https:" && !url.username && !url.password && !!url.hostname ? url.toString() : ""; }catch(_error){ return ""; } }
function bool(value){ return value === true || ["1","true","yes","on","approved","verified","active","enabled"].includes(lower(value)); }
function unique(values){ return Array.from(new Set(array(values).map(text).filter(Boolean))); }

function priceDisplay(product){
  const row=plain(product), raw=text(row.price), currency=text(row.priceCurrency).toUpperCase();
  if(!raw) return "판매처에서 현재 가격 확인";
  if(currency === "KRW") return raw.replace(/\s*KRW\s*/ig, "").replace(/원\s*$/, "") + "원";
  return currency ? raw + " " + currency : raw;
}

function productCard(productInput){
  const product=plain(productInput), rawTitle=first(product.productName,product.title), title=ProductRanking.isGenericProductName(rawTitle)?"상품명 확인 중":rawTitle, image=safeHttpsUrl(first(product.imageUrl,product.imageOriginalUrl,product.image,product.thumb));
  const checkoutUrl=safeHttpsUrl(first(product.externalProductUrl,product.productUrl,product.url));
  const supplierUrl=safeHttpsUrl(first(product.supplierSiteUrl,product.supplierOfficialUrl,plain(product.supplier).officialUrl));
  const supplierName=first(product.supplierName,plain(product.supplier).name);
  return {
    schema:"igdc-external-seller-product-card.v1",
    title,
    sourceTitle:rawTitle||null,
    image,
    price:text(product.price)||null,
    priceCurrency:text(product.priceCurrency)||null,
    priceDisplay:priceDisplay(product),
    availability:text(product.availability)||null,
    supplierName:supplierName||null,
    supplierUrl:supplierUrl||null,
    checkoutUrl:checkoutUrl||null,
    checkoutMode:"external_seller_checkout",
    merchantOfRecord:"external_supplier",
    sellerOfRecord:"external_supplier",
    igdcRole:"discovery_referral_broker",
    igdcCheckout:false,
    igdcPayment:false,
    deliveryResponsibility:"external_supplier",
    returnsResponsibility:"external_supplier",
    refundResponsibility:"external_supplier",
    lastVerifiedAt:first(product.inspectedAt,product.updatedAt)||null
  };
}

function researchReadiness(productInput){
  const product=plain(productInput), card=productCard(product), risk=plain(product.riskAssessment), supplier=plain(product.supplierAssessment);
  const hardBlockers=[], reviewGaps=[], warnings=[];

  // A private review queue must be broader than the publication gate.  Keep a
  // candidate visible when it is a real, same-site product detail page even if
  // title, price, image, supplier approval or revenue evidence still need work.
  // Only malformed/template/static/list pages and explicitly dead pages are
  // rejected before the administrator can inspect them.
  if(!card.checkoutUrl || !ProductRanking.isSpecificProductUrl(card.checkoutUrl)) hardBlockers.push("specific_product_detail_url_missing");
  if(ProductRanking.isTemplateOrPlaceholderUrl(card.checkoutUrl)) hardBlockers.push("template_or_placeholder_url");
  if(product.productPageLive === false) hardBlockers.push("product_page_unavailable");
  if(!card.supplierName && !card.supplierUrl) hardBlockers.push("supplier_identity_missing");

  if(ProductRanking.isGenericProductName(card.title)) reviewGaps.push("product_title_missing_or_generic");
  if(!card.image) reviewGaps.push("product_image_missing");
  if(!card.supplierName) reviewGaps.push("supplier_name_missing");
  if(!card.supplierUrl) reviewGaps.push("supplier_official_url_missing");
  if(risk.gatePassed !== true) reviewGaps.push("risk_gate_not_passed");
  if(!(product.supplierEvidenceReady === true || supplier.evidenceReady === true)) reviewGaps.push("supplier_evidence_not_ready");
  if(!card.price) warnings.push("price_to_be_confirmed_at_seller");
  if(!card.availability) warnings.push("availability_to_be_confirmed_at_seller");
  if(!(product.offerPresent === true)) warnings.push("structured_offer_not_confirmed");

  const queueEligible=hardBlockers.length === 0;
  const promotionEligible=queueEligible && reviewGaps.length === 0;
  return {
    version:VERSION,
    queueEligible,
    promotionEligible,
    stage:queueEligible?(promotionEligible?"research_review_ready":"private_research_queue"):"research_discovered",
    blockers:unique(hardBlockers),
    reviewGaps:unique(reviewGaps),
    warnings:unique(warnings),
    productCard:card,
    nextGate:queueEligible?(promotionEligible?"administrator_product_selection":"administrator_review_and_data_completion"):"discard_invalid_product_reference"
  };
}

function approvedRow(rows){ return array(rows).find((row)=>["approved","active","ready","pinned","enrollable","revenue_ready"].includes(lower(first(row&&row.status,row&&row.state,row&&row.publication_status,row&&row.availability_state)))) || null; }

function approvedRevenueRoute(payloadInput, revenueRows){
  const payload=plain(payloadInput), row=array(revenueRows).find((item)=>lower(item&&item.status)==="approved")||null;
  if(!row)return {ready:false,row:null,type:"",reason:"approved_revenue_record_missing"};
  const type=lower(row.revenue_type);
  if(type==="external_referral"){
    const route=plain(payload.outboundReferral);
    const ready=bool(route.approved)&&bool(route.officialDestination||route.officialSeller)&&bool(route.disclosureReady)&&!!safeHttpsUrl(first(route.destinationUrl,row.affiliate_url));
    return {ready,row,type,trafficValueOnly:true,reason:ready?null:"external_referral_verification_incomplete"};
  }
  if(["affiliate","manual_affiliate"].includes(type)){
    const route=plain(payload.affiliate);
    const ready=bool(route.approved)&&bool(route.disclosureReady)&&lower(route.policyStatus)==="policy_ok"&&!!text(route.programId)&&!!safeHttpsUrl(first(route.trackingUrl,row.affiliate_url));
    return {ready,row,type,trafficValueOnly:false,reason:ready?null:"affiliate_program_verification_incomplete"};
  }
  if(["brokerage","referral","lead","advertising","sponsor"].includes(type)){
    const route=plain(payload.brokerageContract);
    const ready=bool(route.approved)&&bool(route.disclosureReady)&&bool(route.payoutBasisVerified)&&!!text(route.settlementMode)&&!!safeHttpsUrl(first(route.destinationUrl,row.affiliate_url));
    return {ready,row,type,trafficValueOnly:false,reason:ready?null:"direct_revenue_contract_incomplete"};
  }
  return {ready:false,row,type,reason:"unsupported_revenue_route"};
}

function registryState(candidateInput, relationsInput){
  const candidate=plain(candidateInput), payload=plain(candidate.source_payload), relations=plain(relationsInput), status=lower(candidate.status);
  const assignments=array(relations.assignments), markets=array(relations.markets), revenues=array(relations.revenues), evidence=array(relations.evidence);
  const selected=lower(first(payload.slotDecision,plain(payload.review).state));
  const assignment=assignments.find((row)=>["approved","pinned"].includes(lower(row&&row.state)) && ["audit_ready","publish_requested","ready"].includes(lower(row&&row.publication_status))) || null;
  const market=markets.find((row)=>["active","approved","ready"].includes(lower(row&&row.availability_state))) || null;
  const revenueState=approvedRevenueRoute(payload,revenues), revenue=revenueState.ready?revenueState.row:null;
  const verifiedEvidence=evidence.find((row)=>row&&row.verified===true) || null;
  let stage="private_research_queue", nextGate="administrator_product_selection", reasons=[];
  if(["suppressed","rejected"].includes(status) || selected==="reject"){ stage="rejected"; nextGate=null; reasons.push("administrator_rejected"); }
  else if(status==="hold" || selected==="hold"){ stage="held"; nextGate="administrator_reconsideration"; reasons.push("administrator_hold"); }
  else if(status==="research_pending" || selected==="undecided" || !selected){ stage="administrator_selection_pending"; nextGate="administrator_product_selection"; reasons.push("slot_candidate_not_selected"); }
  else if(!market){ stage="market_evidence_pending"; nextGate="record_market_delivery_return_support_evidence"; reasons.push("market_evidence_missing"); }
  else if(!verifiedEvidence){ stage="trust_evidence_pending"; nextGate="record_verified_supplier_or_product_evidence"; reasons.push("verified_evidence_missing"); }
  else if(!revenue){ stage="revenue_route_pending"; nextGate="record_affiliate_referral_brokerage_or_advertising_right"; reasons.push(revenueState.reason||"approved_revenue_route_missing"); }
  else if(!assignment){ stage="slot_assignment_pending"; nextGate="approve_psom_assignment"; reasons.push("approved_slot_assignment_missing"); }
  else { stage="registry_sync_ready"; nextGate=lower(assignment&&assignment.publication_status)==="publish_requested"?"publication_build_requested":"go_live_audit_and_explicit_publication_request"; }
  return {
    version:VERSION,
    stage,
    nextGate,
    reasons,
    counts:{assignments:assignments.length,markets:markets.length,revenues:revenues.length,evidence:evidence.length},
    readiness:{market:!!market,evidence:!!verifiedEvidence,revenue:!!revenue,assignment:!!assignment},
    revenueRoute:{type:revenueState.type||null,trafficValueOnly:revenueState.trafficValueOnly===true,qualified:revenueState.ready===true},
    assignment:assignment?{id:text(assignment.id)||null,hubKey:text(assignment.hub_key)||null,slotKey:text(assignment.slot_key)||null,countryCode:text(assignment.country_code)||null,regionCode:text(assignment.region_code)||null,state:text(assignment.state)||null,publicationStatus:text(assignment.publication_status)||null,priority:Number(assignment.priority||0)}:null,
    releaseEligible:false,
    publicPublication:false,
    paymentExecution:false
  };
}

function liveQueueRow(candidateInput, relationsInput){
  const candidate=plain(candidateInput), payload=plain(candidate.source_payload), lifecycle=registryState(candidate,relationsInput), card=plain(payload.productCard&&payload.productCard.schema?payload.productCard:productCard(payload));
  const placement=plain(payload.placement), ranking=plain(payload.productRanking), revenue=plain(payload.revenue), readiness=plain(payload.researchReadiness);
  const qualityReasons=unique(array(readiness.blockers).concat(array(readiness.reviewGaps),array(readiness.warnings)));
  return {
    candidateId:text(candidate.id),
    pipelineSource:"live_product_research_db",
    title:first(card.title,candidate.title),
    image:card.image||safeHttpsUrl(candidate.thumbnail_url),
    productCard:card,
    supplier:plain(payload.supplier),
    sourceTier:first(plain(payload.commerceCandidate).sourceTier,"risk_ranked_official_supplier_product"),
    origin:first(plain(payload.commerceCandidate).origin,candidate.source_ref,SOURCE_REF),
    stageStatus:lifecycle.stage,
    releaseEligible:false,
    reasons:unique(array(lifecycle.reasons).concat(qualityReasons)),
    researchReadiness:readiness,
    proposedPlacements:array(payload.proposedPlacements),
    essentialClass:first(ranking.category,payload.productCategory),
    placement:{page:first(placement.page,payload.page),section:first(placement.section,payload.section),slot:first(placement.slot,payload.slot),country:first(placement.country,plain(payload.marketScope).marketCountry),region:first(placement.region,plain(payload.marketScope).marketRegion)},
    marketKeys:array(payload.marketKeys),
    revenue:{type:first(revenue.type,plain(payload.commercialAssessment).revenueType,"commercial_candidate"),monetizationState:first(revenue.monetizationState,plain(payload.commercialAssessment).monetizationState,"contract_required"),contractId:first(revenue.contractId),outboundRoute:{mode:card.checkoutMode}},
    review:{state:first(plain(payload.review).state,"pending"),nextGate:lifecycle.nextGate},
    ranking:{finalScore:Number(ranking.score||0),essentiality:0,sellerTrust:Number(plain(payload.supplier).trustScore||0),revenueCertainty:plain(payload.commercialAssessment).contractReady===true?100:0},
    destinationHost:(()=>{try{return new URL(card.checkoutUrl||"").hostname.toLowerCase();}catch(_error){return"";}})(),
    lifecycle,
    digest:text(payload.productIdentity||ranking.duplicateGroupKey||candidate.id)
  };
}

module.exports={VERSION,SOURCE_REF,STAGES,productCard,researchReadiness,approvedRevenueRoute,registryState,liveQueueRow};
