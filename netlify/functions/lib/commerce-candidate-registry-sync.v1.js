"use strict";

/**
 * Commerce Candidate Registry Sync v1
 * --------------------------------------------------------------------------
 * Pulls only administrator-approved commerce candidates from the existing
 * Global Slot management database into a local, expiry-bound review queue.
 * It never publishes a front Snapshot and never opens a release key.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const MarketSaleScope = require("./market-sale-scope.v1");
const IpSlotPolicy = require("./ip-slot-policy.v1");
const ProductRanking = require("./commerce-product-ranking.v1");

const VERSION = "commerce-candidate-registry-sync-v1.13.0-tour-right-commercial-spectrum";
const QUEUE_FILE = "commerce-candidate-review-queue.v1.json";
const PRODUCT_RESEARCH_SOURCE_REF = "country-product-ranking-review";
const CANDIDATE_REVIEW_SOURCE_REF = "commerce-candidate-review-api";

function text(v){ return v == null ? "" : String(v).trim(); }
function lower(v){ return text(v).toLowerCase(); }
function bool(v){ return v === true || ["1","true","yes","on","approved","verified","active","enabled"].includes(lower(v)); }
function isObject(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function plain(v){ return isObject(v) ? v : {}; }
function array(v){ return Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]); }
function first(){ for(const v of arguments){ const x=text(v); if(x) return x; } return ""; }
function rootOf(input){ return path.resolve(input && input.root || process.cwd()); }
function now(){ return new Date().toISOString(); }
function sha256(v){ return crypto.createHash("sha256").update(typeof v === "string"?v:JSON.stringify(v)).digest("hex"); }
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function atomicWrite(file,doc){ ensureDir(path.dirname(file)); const out=JSON.stringify(doc,null,2)+"\n"; const temp=path.join(path.dirname(file),"."+path.basename(file)+"."+process.pid+"."+crypto.randomBytes(5).toString("hex")+".tmp"); fs.writeFileSync(temp,out,"utf8"); fs.renameSync(temp,file); return sha256(out); }
function queuePath(root){ return path.join(root,"netlify","functions","data",QUEUE_FILE); }
function safeUrl(v){ try { const u=new URL(text(v)); return u.protocol==="https:"?u.toString():""; } catch(_e){return "";} }
function requiredEnvPresent(){ return !!(text(process.env.GSLOT_SUPABASE_URL) && text(process.env.GSLOT_SUPABASE_SECRET_KEY||process.env.GSLOT_SUPABASE_SERVICE_ROLE_KEY||process.env.GSLOT_SUPABASE_SERVICE_KEY)); }
function allowedCandidateStatus(v){ return ["revenue_ready","approval_pending","enrollable"].includes(lower(v)); }
function allowedAssignmentState(v){ return ["approved","pinned"].includes(lower(v)); }
function approvedRevenue(v){ return ["approved","active","verified","live","enabled"].includes(lower(v)); }
function approvedAvailability(v){ return ["active","approved","ready"].includes(lower(v)); }
function verifiedEvidenceRow(row){ return !!row && bool(row.verified) && !!safeUrl(row.evidence_url); }
function genericProductTitle(value){
  const valueText=lower(value).replace(/&[a-z0-9#]+;/g," ").replace(/[^a-z0-9가-힣]+/g," ").trim();
  return !valueText || valueText.length<4 || /^(aside menu|menu|home|product|products|item|detail|details|상품|상품 상세|목록)$/.test(valueText);
}
function productCardOf(payload){
  payload=plain(payload);
  const readiness=plain(payload.researchReadiness);
  const researchCard=plain(readiness.productCard);
  const directCard=plain(payload.productCard);
  return Object.assign({},researchCard,directCard);
}
function exactProductTitle(candidate,payload){
  payload=plain(payload); const card=productCardOf(payload);
  const candidates=[card.title,card.sourceTitle,payload.productName,payload.sourceTitle,payload.title,candidate&&candidate.title];
  for(const value of candidates){ if(value&&!genericProductTitle(value)) return text(value); }
  return first.apply(null,candidates);
}
function exactProductImage(candidate,payload){
  payload=plain(payload); const card=productCardOf(payload);
  const candidates=[card.image,card.imageUrl,card.imageOriginalUrl,card.thumbnail,card.thumbnailUrl,card.thumb,payload.imageUrl,payload.imageOriginalUrl,payload.image,payload.thumbnail,payload.thumb,candidate&&candidate.thumbnail_url];
  for(const value of candidates){ const url=safeUrl(value); if(url) return url; }
  return "";
}
function normalizedUrlKey(value){
  const url=safeUrl(value); if(!url) return "";
  try{ const u=new URL(url); u.hash=""; if(u.pathname!=="/")u.pathname=u.pathname.replace(/\/+$/,""); return u.toString(); }catch(_e){return "";}
}
function isRootPageUrl(value){
  const url=safeUrl(value); if(!url)return true;
  try{ const u=new URL(url); return (!u.pathname||u.pathname==="/")&&!u.search; }catch(_e){return true;}
}
function exactProductDestination(candidate,payload){
  payload=plain(payload); const card=productCardOf(payload);
  const supplierCandidates=[card.supplierUrl,payload.supplierSiteUrl,plain(payload.supplier).officialUrl,plain(payload.sellerResponsibility).supportUrl].map(normalizedUrlKey).filter(Boolean);
  const candidates=[
    payload.externalProductUrl,payload.officialProductUrl,payload.productUrl,payload.productPageUrl,
    card.productUrl,card.checkoutUrl,payload.detailUrl,payload.checkoutUrl,payload.purchaseUrl,payload.orderUrl,payload.productLink,
    plain(payload.directCommerceListing).destinationUrl,plain(payload.brokerageContract).destinationUrl,
    payload.url,payload.link,payload.href,candidate&&candidate.official_url
  ];
  for(const value of candidates){
    const url=safeUrl(value); if(!url||isRootPageUrl(url))continue;
    const key=normalizedUrlKey(url); if(supplierCandidates.includes(key))continue;
    return url;
  }
  return "";
}
function tourCommercialProfile(candidate,payload){
  payload=plain(payload); const card=productCardOf(payload);
  return ProductRanking.tourRightProfile({
    productName:exactProductTitle(candidate,payload),
    title:exactProductTitle(candidate,payload),
    summary:first(payload.summary,card.summary),
    description:first(payload.description,card.description),
    priorityLabel:first(payload.category,payload.type,payload.serviceType),
    productUrl:exactProductDestination(candidate,payload),
    url:exactProductDestination(candidate,payload)
  });
}
function qualifiedTourServiceCandidate(candidate,payload){
  payload=plain(payload);
  if(payload.travelService===true||payload.tourService===true||payload.bookingService===true) return true;
  return tourCommercialProfile(candidate,payload).service===true;
}
function qualifiedTourRecreationProductCandidate(candidate,payload){
  return tourCommercialProfile(candidate,payload).recreationProduct===true;
}
function qualifiedTourDiningCandidate(candidate,payload){
  return tourCommercialProfile(candidate,payload).diningAuxiliary===true;
}
function qualifiedTourCandidate(candidate,payload){
  return tourCommercialProfile(candidate,payload).eligible===true;
}
function productFirstVerifiedAt(candidate,payload){
  payload=plain(payload); const mapping=plain(payload.productMapping), timestamps=plain(payload.timestamps), research=plain(payload.research);
  return first(mapping.firstVerifiedAt,payload.firstVerifiedAt,payload.lastVerifiedAt,payload.listedAt,payload.discoveredAt,timestamps.discoveredAt,research.discoveredAt,candidate&&candidate.created_at,candidate&&candidate.updated_at);
}
function explicitHardRisk(payload){
  const risk=plain(payload&&payload.riskAssessment);
  const supplier=plain(payload&&payload.supplierAssessment);
  const queueControl=plain(payload&&payload.queueControl);
  /* Missing/unfinished trust evidence is not itself a concrete danger signal.
     An authenticated administrator Front Match may publish a non-payable
     external-seller referral while those soft review fields remain pending.
     Keep only explicit safety, availability and seller-domain failures as hard
     blockers so the old market-evidence gate cannot silently cancel the
     administrator's publication request. */
  if(queueControl.permanentExcluded===true||queueControl.hiddenFromCountryQueue===true&&queueControl.rediscoveryAllowed===false) return true;
  if(payload&&payload.productPageLive===false) return true;
  if(payload&&payload.sameSupplierSite===false||risk.supplierSiteMatched===false||risk.explicitUnavailable===true) return true;
  const blockers=unique([].concat(array(risk.blockers),array(supplier.blockers),array(payload&&payload.blockers),array(payload&&payload.hardBlockers))).map(lower).join(" ");
  return /fraud|scam|phish|malware|illegal|counterfeit|forgery|adult|porn|sanction|prohibited|unsafe|product_page_unavailable|supplier_product_domain_mismatch|사기|악성|피싱|불법|위조|성인|음란|제재|금지/.test(blockers);
}
function frontPublicationMarker(candidate){
  const payload=sourcePayload(candidate), front=plain(payload.frontPublication), review=plain(payload.review), pipeline=plain(payload.pipeline);
  const status=lower(first(front.status,review.publicationStatus,review.publicationRequested===true?"publish_requested":"",pipeline.explicitPublicationRequested===true?"publish_requested":""));
  if(!["queued","publish_requested","matched","published"].includes(status)) return null;
  const placement=plain(payload.approvedPlacement||payload.selectedPlacement||payload.primaryPlacement||payload.placement);
  const page=first(placement.page,payload.page), section=first(placement.sectionKey,placement.section,payload.section,payload.psom_key);
  const country=MarketSaleScope.normalizeCountry(first(placement.country,front.country,payload.country,payload.targetCountry));
  const region=MarketSaleScope.normalizeRegion(first(placement.region,front.region,payload.region,"NATIONWIDE"),country)||"NATIONWIDE";
  if(!candidate||!candidate.id||!page||!section||!country) return null;
  return {
    status:"publish_requested", candidateId:candidate.id,
    assignmentId:first(front.assignmentId,"front-marker-"+candidate.id),
    page, section, country, region,
    requestedAt:first(front.requestedAt,review.decidedAt,candidate.updated_at,now()),
    requestedBy:first(front.requestedBy,review.decidedBy,"administrator"),
    priority:Number(first(placement.priority,payload.rankingScore,0))||0,
    manualPinned:bool(placement.manualPinned),
    authority:first(front.authority,"explicit_administrator_front_match")
  };
}
function frontWithdrawalMarker(candidate){
  const payload=sourcePayload(candidate), front=plain(payload.frontPublication), review=plain(payload.review), pipeline=plain(payload.pipeline);
  const status=lower(first(front.status,review.publicationStatus,pipeline.publicationStatus));
  const operation=lower(front.operation);
  // Only the durable marker written by the authenticated unpublication flow is
  // allowed to make an empty administrator queue authoritative. A generic empty
  // queue must never erase committed real-product snapshots.
  if(status!=="unpublish_requested"||operation!=="unmatch") return null;
  const placement=plain(payload.approvedPlacement||payload.selectedPlacement||payload.primaryPlacement||payload.placement), previous=plain(payload.previousApprovedPlacement);
  const page=first(front.page,placement.page,previous.page,payload.page), section=first(front.section,front.sectionKey,placement.sectionKey,placement.section,previous.sectionKey,previous.section,payload.section,payload.psom_key);
  const country=MarketSaleScope.normalizeCountry(first(front.country,placement.country,previous.country,payload.country,payload.targetCountry));
  const region=MarketSaleScope.normalizeRegion(first(front.region,placement.region,previous.region,payload.region,"NATIONWIDE"),country)||"NATIONWIDE";
  if(!candidate||!candidate.id||!country) return null;
  return {
    status:"unpublish_requested", operation:"unmatch", candidateId:candidate.id,
    assignmentId:first(front.assignmentId,"front-marker-"+candidate.id),
    page:page||null, section:section||null, country, region,
    requestedAt:first(front.requestedAt,candidate.updated_at,now()),
    requestedBy:first(front.requestedBy,"administrator"),
    reason:first(front.reason,"administrator_unmatch")
  };
}
function syntheticAssignmentFromMarker(candidate, marker){
  if(!marker) return null;
  return {
    id:marker.assignmentId,candidate_id:candidate.id,hub_key:marker.page,country_code:marker.country,
    region_code:marker.region&&marker.region!=="NATIONWIDE"?marker.region:null,slot_key:marker.section,
    priority:marker.priority||0,state:marker.manualPinned?"pinned":"approved",publication_status:"publish_requested",
    manual_pinned:marker.manualPinned===true,updated_at:marker.requestedAt||candidate.updated_at||now(),updated_by:marker.requestedBy||"administrator"
  };
}
function syntheticAvailabilityFromMarker(candidate, marker){
  if(!marker) return [];
  const payload=sourcePayload(candidate), destination=safeUrl(first(payload.url,payload.productUrl,payload.checkoutUrl,candidate&&candidate.official_url));
  return [{
    candidate_id:candidate.id,country_code:marker.country,region_code:marker.region&&marker.region!=="NATIONWIDE"?marker.region:null,
    availability_state:"active",
    legal_basis:"Authenticated administrator Front Match for an external-seller referral. The external seller remains seller and merchant of record.",
    delivery_or_access:destination?"Administrator selected the official external seller product destination; checkout, delivery, returns, refunds and support remain with the external seller.":"Administrator selected an external-seller referral route.",
    updated_at:marker.requestedAt||candidate.updated_at||now(),updated_by:marker.requestedBy||"administrator"
  }];
}
function syntheticEvidenceFromMarker(candidate, marker){
  if(!marker) return [];
  const payload=sourcePayload(candidate), url=safeUrl(first(payload.supplierSiteUrl,plain(payload.supplier).officialUrl,payload.url,payload.productUrl,payload.checkoutUrl,candidate&&candidate.official_url));
  if(!url) return [];
  return [{
    id:"front-marker-evidence-"+candidate.id,candidate_id:candidate.id,evidence_type:"administrator_confirmed_official_supplier_product_reference",
    evidence_url:url,note:"Verified only as the administrator-selected official supplier/product reference for this Front Match; this does not assert IGDC seller, payment, delivery, return, refund or after-sales responsibility.",
    verified:true,created_at:marker.requestedAt||candidate.updated_at||now()
  }];
}
function explicitAdminReferralReady(candidate,assignment,availabilityRows){
  if(lower(assignment&&assignment.publication_status)!=="publish_requested") return false;
  const payload=sourcePayload(candidate);
  const title=exactProductTitle(candidate,payload);
  const destination=exactProductDestination(candidate,payload);
  const image=exactProductImage(candidate,payload);
  const supplierUrl=safeUrl(first(payload.supplierSiteUrl,plain(payload.supplier).officialUrl,plain(payload.sellerResponsibility).supportUrl,candidate&&candidate.official_url));
  const supplierName=first(payload.sellerName,payload.supplierName,plain(payload.supplier).name,plain(payload.sellerResponsibility).legalEntity,candidate&&candidate.title);
  if(genericProductTitle(title)||!destination||!image||!supplierUrl||!supplierName) return false;
  if(!array(availabilityRows).length||explicitHardRisk(payload)) return false;
  return true;
}
function explicitReferralRevenueRow(candidate,assignment){
  const payload=sourcePayload(candidate);
  return {
    id:first(assignment&&assignment.id,"admin-referral-"+text(candidate&&candidate.id)),
    candidate_id:candidate&&candidate.id,
    revenue_type:"external_referral",
    status:"administrator_nonpayable_referral",
    affiliate_url:exactProductDestination(candidate,payload),
    provider_name:first(payload.sellerName,payload.supplierName,plain(payload.sellerResponsibility).legalEntity,candidate&&candidate.title),
    currency:null,
    note:"Authenticated administrator publication request; non-payable external seller referral",
    updated_at:first(assignment&&assignment.updated_at,candidate&&candidate.updated_at,now())
  };
}
function authoritativeSlotProfile(payload, slotStrategy){
  const required=array(slotStrategy&&slotStrategy.requiredSlotProfiles).map(text).filter(Boolean);
  const existing=first(plain(payload&&payload.productMapping).slotProfile,payload&&payload.slotProfile);
  if(existing&&required.includes(existing)) return existing;
  return first(required[0],slotStrategy&&slotStrategy.strategyId,existing);
}
function authoritativeProductClass(candidate,payload,page,slotStrategy){
  payload=plain(payload);
  const allowed=array(slotStrategy&&slotStrategy.allowedProductClasses).map(lower).filter(Boolean);
  const existing=lower(first(plain(payload.productMapping).productClass,payload.productClass));
  if(existing&&allowed.includes(existing)) return existing;
  // Tour accepts travel/booking services plus recreation goods and a small
  // auxiliary dining layer. Only actual travel/leisure services require the
  // travel-operator evidence gate; recreation goods and dining offers stay on
  // the external-seller/referral travel_product contract.
  if(page==="tour"){
    if(qualifiedTourServiceCandidate(candidate,payload)&&allowed.includes("travel_service")) return "travel_service";
    if((qualifiedTourRecreationProductCandidate(candidate,payload)||qualifiedTourDiningCandidate(candidate,payload))&&allowed.includes("travel_product")) return "travel_product";
  }
  if(allowed.includes("physical_product")) return "physical_product";
  return existing&&allowed.includes(existing)?existing:first(allowed[0],existing);
}
function authoritativeRequestedSlot(payload, assignment){
  if(!bool(assignment&&assignment.manual_pinned)) return "";
  const raw=first(plain(payload&&payload.placement).slot,payload&&payload.slot,assignment&&assignment.priority);
  const value=Number(raw);
  return Number.isInteger(value)&&value>=1&&value<=100?value:"";
}
function sourcePayload(candidate){
  const payload=plain(candidate.source_payload);
  if(isObject(payload.candidate)) return Object.assign({},payload.candidate);
  return Object.assign({},payload);
}
function serviceProof(url, evidence){ return { verified:true, evidenceUrl:safeUrl(url)||null, evidence:[text(evidence)].filter(Boolean) }; }
function marketRecord(candidate, availability, evidenceRows){
  const payload=sourcePayload(candidate);
  const country=MarketSaleScope.normalizeCountry(availability.country_code);
  const region=MarketSaleScope.normalizeRegion(availability.region_code,country);
  const legalBasis=text(availability.legal_basis);
  const deliveryEvidence=text(availability.delivery_or_access);
  const evidenceUrl=safeUrl(first(payload.marketEvidenceUrl,payload.shippingPolicyUrl,payload.returnsPolicyUrl,payload.supportUrl,candidate.official_url));
  const verifiedEvidence=(evidenceRows||[]).filter(row=>bool(row.verified)).map(row=>safeUrl(row.evidence_url)).filter(Boolean);
  const commonUrl=evidenceUrl||verifiedEvidence[0]||"";
  const seller=plain(payload.sellerResponsibility);
  return {
    country,
    region:region||"NATIONWIDE",
    nationwide:!region,
    active:true,
    verifiedAt:first(availability.updated_at,candidate.updated_at),
    shipping:serviceProof(first(payload.shippingPolicyUrl,commonUrl),first(deliveryEvidence,legalBasis)),
    returns:serviceProof(first(payload.returnsPolicyUrl,commonUrl),first(legalBasis,deliveryEvidence)),
    support:serviceProof(first(payload.supportUrl,commonUrl),first(legalBasis,deliveryEvidence)),
    sellerResponsibility:{verified:bool(first(seller.verified,true)),legalEntity:first(seller.legalEntity,payload.sellerLegalEntity,payload.sellerName,candidate.title),supportUrl:safeUrl(first(seller.supportUrl,payload.supportUrl,commonUrl))||null},
    source:{name:"global-slot-console",url:safeUrl(candidate.official_url)||null},
    evidence:unique([legalBasis,deliveryEvidence].concat(verifiedEvidence))
  };
}
function unique(values){ return Array.from(new Set((values||[]).map(text).filter(Boolean))); }
function runtimeTravelOperatorEvidence(candidate,payload,assignment){
  payload=plain(payload); assignment=plain(assignment);
  if(lower(assignment.hub_key)!=="tour" || !qualifiedTourServiceCandidate(candidate,payload)) return plain(payload.travelOperator);
  const runtime=plain(payload.runtimeValidation), prior=plain(payload.travelOperator), supplier=plain(payload.supplier), seller=plain(payload.sellerResponsibility);
  const liveVerified=lower(runtime.state)==="live" || (payload.productPageLive===true && payload.inspectionComplete===true && !runtime.state);
  const operatorName=first(prior.name,prior.operatorName,payload.supplierName,supplier.name,seller.legalEntity);
  const supplierUrl=safeUrl(first(prior.supportUrl,prior.bookingPolicyUrl,payload.supportUrl,supplier.supportUrl,supplier.officialUrl,payload.supplierSiteUrl,seller.supportUrl));
  const bookingUrl=exactProductDestination(candidate,payload);
  if(!liveVerified || !operatorName || !(supplierUrl||bookingUrl)) return prior;
  // This is not a licence assertion. It records only that the authenticated
  // administrator selected a live booking/service detail page whose external
  // operator identity and service URL were revalidated immediately before
  // publication. The external operator remains responsible for the service.
  return Object.assign({},prior,{
    responsibleOperatorVerified:true,
    name:operatorName,operatorName,
    supportUrl:first(prior.supportUrl,supplierUrl,bookingUrl),
    bookingPolicyUrl:first(prior.bookingPolicyUrl,bookingUrl),
    evidenceSource:"administrator_live_travel_detail_validation",
    verifiedAt:first(runtime.checkedAt,payload.inspectedAt,candidate&&candidate.updated_at,now()),
    externalOperator:true,igdcOperator:false
  });
}
function compactPayload(candidate, assignment, availabilityRows, revenueRows, evidenceRows, ipPolicy){
  const payload=sourcePayload(candidate);
  const assignmentInfo=assignment||{};
  const revenue=(revenueRows||[]).find(row=>approvedRevenue(row.status)) || (revenueRows||[]).find(row=>lower(row.status)==="administrator_nonpayable_referral") || {};
  const revenueType=lower(revenue.revenue_type);
  const trafficOnly=revenueType==="external_referral";
  const payloadDirect=plain(payload.directCommerceListing);
  const payloadContract=plain(payload.brokerageContract);
  const revenueProvider=first(revenue.provider_name,payloadContract.providerName,payloadDirect.providerName);
  const revenueId=first(revenue.id,payloadContract.id,payloadDirect.contractId,assignmentInfo.id);
  const revenueUrl=safeUrl(first(revenue.affiliate_url,payloadContract.destinationUrl,payloadDirect.destinationUrl));
  const disclosureReady=bool(first(payloadContract.disclosureReady,payloadDirect.disclosureReady));
  const payoutBasisVerified=bool(first(payloadContract.payoutBasisVerified,payloadDirect.payoutBasisVerified));
  const storedSettlementMode=lower(first(payloadContract.settlementMode,payloadDirect.settlementMode));
  const directPayable=["advertising","brokerage","lead","referral","sponsor"].includes(revenueType) && !!revenueProvider && !!revenueId && disclosureReady && payoutBasisVerified && !!storedSettlementMode;
  const settlementMode=directPayable?storedSettlementMode:(trafficOnly?"traffic_only":"provider_program");
  const markets=(availabilityRows||[]).map(row=>marketRecord(candidate,row,evidenceRows));
  const pageMap={home:"home",distribution:"distribution",network:"network",tour:"tour",social:"social"};
  const page=pageMap[text(assignmentInfo.hub_key)]||text(payload.page);
  // The selected Global Slot assignment is the authoritative publication
  // route. A stale candidate payload must never override the administrator's
  // current page/section decision.
  const section=first(assignmentInfo.slot_key,payload.section);
  const policyDoc=plain(ipPolicy&&ipPolicy.policy);
  const pageStrategies=plain(plain(policyDoc.slotStrategies)[page]);
  const slotStrategy=plain(pageStrategies[section]);
  const slotProfile=authoritativeSlotProfile(payload,slotStrategy);
  const productClass=authoritativeProductClass(candidate,payload,page,slotStrategy);
  // gslot_slot_assignments.priority is ranking priority, not a physical slot.
  // Only a manually pinned assignment may request a concrete slot number.
  const requestedSlot=authoritativeRequestedSlot(payload,assignmentInfo);
  const destination=exactProductDestination(candidate,payload);
  const image=exactProductImage(candidate,payload);
  const title=exactProductTitle(candidate,payload);
  const runtimeState=lower(plain(payload.runtimeValidation).state);
  const administratorValidatedOrderPath=!!destination && (runtimeState==="live" || (payload.productPageLive===true && payload.inspectionComplete===true));
  const firstVerifiedAt=productFirstVerifiedAt(candidate,payload);
  const card=productCardOf(payload);
  const rawPrice=first(card.price,payload.price,payload.salePrice,payload.currentPrice);
  const rawCurrency=first(card.priceCurrency,card.currency,payload.priceCurrency,payload.currency);
  const item=Object.assign({},payload,{
    id:first(payload.id,candidate.id),
    title,
    name:title,
    summary:"",
    description:"",
    url:destination,
    link:destination,
    href:destination,
    externalProductUrl:destination,
    productUrl:destination,
    productPageUrl:destination,
    detailUrl:destination,
    checkoutUrl:destination,
    externalOutboundUrl:trafficOnly?destination:payload.externalOutboundUrl,
    image,
    thumb:image,
    thumbnail:image,
    price:rawPrice||undefined,
    currency:rawCurrency||undefined,
    firstVerifiedAt:firstVerifiedAt||undefined,
    page,
    channel:page,
    route:page,
    section,
    psom_key:section,
    slotKey:section,
    bind:Object.assign({},plain(payload.bind),{page,section,psom_key:section,slot:requestedSlot}),
    layerPointer:Object.assign({},plain(payload.layerPointer),{page,section,slot:requestedSlot}),
    placement:Object.assign({},plain(payload.placement),{page,section,slot:requestedSlot}),
    source:{name:first(plain(payload.source).name,candidate.title,"Approved commerce member"),url:first(plain(payload.source).url,candidate.official_url)},
    orderReady:bool(first(payload.orderReady,administratorValidatedOrderPath)),
    searchBankContract:Object.assign({},plain(payload.searchBankContract),{frontSupplyAllowed:true,searchBankEligible:true,snapshotEligible:true,indexEligible:true,orderReady:bool(first(plain(payload.searchBankContract).orderReady,administratorValidatedOrderPath)),lastVerifiedAt:first(plain(payload.searchBankContract).lastVerifiedAt,candidate.updated_at),trustScore:Number(plain(payload.searchBankContract).trustScore||payload.trustScore||75),trustTier:first(plain(payload.searchBankContract).trustTier,payload.trustTier,"A"),officialSource:bool(first(plain(payload.searchBankContract).officialSource,payload.officialSource,true)),producerVerified:bool(first(plain(payload.searchBankContract).producerVerified,payload.producerVerified,true))}),
    marketAvailability:{markets},
    directCommerceListing:Object.assign({},plain(payload.directCommerceListing),{
      sourceTier:"approved_commerce_member",
      revenueType:first(plain(payload.directCommerceListing).revenueType,revenueType),
      contractApproved:directPayable,
      contractStatus:directPayable?"approved":(trafficOnly?"traffic_only":"provider_program"),
      contractId:first(plain(payload.directCommerceListing).contractId,revenueId),
      providerName:first(plain(payload.directCommerceListing).providerName,revenueProvider),
      counterparty:first(plain(payload.directCommerceListing).counterparty,revenueProvider),
      disclosureReady:directPayable,
      payoutBasisVerified:directPayable,
      settlementMode:first(plain(payload.directCommerceListing).settlementMode,settlementMode),
      destinationUrl:first(revenueUrl,destination,plain(payload.directCommerceListing).destinationUrl),
      expectedNetRevenuePerOrder:first(plain(payload.directCommerceListing).expectedNetRevenuePerOrder,payload.expectedNetRevenuePerOrder)
    }),
    commerceCandidate:Object.assign({},plain(payload.commerceCandidate),{sourceTier:"approved_commerce_member",origin:"global-slot-console",essentialClass:first(plain(payload.commerceCandidate).essentialClass,payload.essentialClass)}),
    sellerResponsibility:Object.assign({},plain(payload.sellerResponsibility),{verified:true,legalEntity:first(plain(payload.sellerResponsibility).legalEntity,payload.sellerLegalEntity,payload.sellerName,candidate.title),supportUrl:first(plain(payload.sellerResponsibility).supportUrl,payload.supportUrl,candidate.official_url)}),
    brokerageContract:Object.assign({},plain(payload.brokerageContract),{
      approved:directPayable,
      status:directPayable?"approved":(trafficOnly?"traffic_only":"provider_program"),
      id:first(plain(payload.brokerageContract).id,revenueId),
      type:first(plain(payload.brokerageContract).type,revenueType,"brokerage"),
      providerName:first(plain(payload.brokerageContract).providerName,revenueProvider),
      counterparty:first(plain(payload.brokerageContract).counterparty,revenueProvider),
      disclosureReady:directPayable,
      payoutBasisVerified:directPayable,
      settlementMode:first(plain(payload.brokerageContract).settlementMode,settlementMode),
      destinationUrl:first(revenueUrl,destination,plain(payload.brokerageContract).destinationUrl),
      currency:first(plain(payload.brokerageContract).currency,revenue.currency),
      approvalSource:"global-slot-console-approved-revenue-record",
      approvalRecordId:revenueId||null,
      note:first(plain(payload.brokerageContract).note,revenue.note),
      expectedNetRevenuePerOrder:first(plain(payload.brokerageContract).expectedNetRevenuePerOrder,payload.expectedNetRevenuePerOrder)
    }),
    originCountry:first(payload.originCountry,payload.manufacturingCountry),
    productMapping:Object.assign({},plain(payload.productMapping),{slotProfile,productClass,productIdentity:first(plain(payload.productMapping).productIdentity,payload.productId,candidate.id),strategyId:first(slotStrategy.strategyId,slotProfile),strategyRole:first(slotStrategy.role),policyDerivedSlotProfile:!!slotStrategy.strategyId,firstVerifiedAt:firstVerifiedAt||undefined}),
    travelOperator:runtimeTravelOperatorEvidence(candidate,payload,assignmentInfo)
  });
  return item;
}

async function syncApprovedCandidates(input){
  const root=rootOf(input);
  const file=queuePath(root);
  if(!requiredEnvPresent()) return {ok:true,status:"not_configured",version:VERSION,wrote:false,file,reason:"global-slot-console-supabase-not-configured"};
  let sb;
  try { sb=require("./global-slot-console-supabase"); } catch(error){ return {ok:false,status:"blocked",version:VERSION,wrote:false,file,reason:"global-slot-console-store-unavailable",error:String(error&&error.message||error)}; }
  try {
    const ipPolicy=IpSlotPolicy.load(root);
    if(!ipPolicy.ok) return {ok:false,status:"blocked",version:VERSION,wrote:false,file,reason:"ip-slot-policy-invalid",problems:ipPolicy.problems||[]};
    const [candidates,assignments,availability,revenue,evidence]=await Promise.all([
      sb.select("gslot_candidates","select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,source_payload,updated_at,created_at&order=updated_at.desc&limit=2000"),
      sb.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,priority,state,publication_status,manual_pinned,updated_at,updated_by&order=updated_at.desc&limit=5000"),
      sb.select("gslot_candidate_availability","select=candidate_id,country_code,region_code,availability_state,legal_basis,delivery_or_access,updated_at,updated_by&order=updated_at.desc&limit=5000"),
      sb.select("gslot_candidate_revenue","select=id,candidate_id,revenue_type,status,affiliate_url,provider_name,currency,note,updated_at&order=updated_at.desc&limit=5000"),
      sb.select("gslot_candidate_evidence","select=id,candidate_id,evidence_type,evidence_url,note,verified,created_at&order=created_at.desc&limit=5000")
    ]);
    const assignmentByCandidate=new Map();
    array(assignments).forEach(row=>{ if(!allowedAssignmentState(row.state))return; if(!assignmentByCandidate.has(row.candidate_id))assignmentByCandidate.set(row.candidate_id,[]); assignmentByCandidate.get(row.candidate_id).push(row); });
    const avBy=new Map(), rBy=new Map(), eBy=new Map();
    array(availability).forEach(row=>{ if(!approvedAvailability(row.availability_state)) return; if(!avBy.has(row.candidate_id)) avBy.set(row.candidate_id,[]); avBy.get(row.candidate_id).push(row); });
    array(revenue).forEach(row=>{ if(!rBy.has(row.candidate_id)) rBy.set(row.candidate_id,[]); rBy.get(row.candidate_id).push(row); });
    array(evidence).forEach(row=>{ if(!eBy.has(row.candidate_id)) eBy.set(row.candidate_id,[]); eBy.get(row.candidate_id).push(row); });
    const withdrawalRows=[];
    for(const candidate of array(candidates)){
      const explicitAuditSource=[PRODUCT_RESEARCH_SOURCE_REF,CANDIDATE_REVIEW_SOURCE_REF].includes(text(candidate&&candidate.source_ref));
      if(!explicitAuditSource) continue;
      const marker=frontWithdrawalMarker(candidate);
      if(!marker) continue;
      const currentAssignments=assignmentByCandidate.get(candidate.id)||[];
      // A new publication request wins over an older withdrawal marker for the
      // same candidate. Otherwise the explicit withdrawal remains a durable
      // rebuild authorization, including when runtime revalidation put the
      // candidate into HOLD before the build hook executes.
      if(currentAssignments.some((row)=>lower(row&&row.publication_status)==="publish_requested")) continue;
      withdrawalRows.push(marker);
    }
    const output=[];
    for(const candidate of array(candidates)){
      if(!allowedCandidateStatus(candidate.status)) continue;
      const assignmentRows=assignmentByCandidate.get(candidate.id)||[];
      // The slot-assignment relation is preferred, but the candidate's durable
      // Front Match marker is an authoritative recovery source. This keeps a
      // successful administrator click publishable even if an auxiliary
      // relation write was interrupted before the build hook ran.
      const explicitAuditSource=[PRODUCT_RESEARCH_SOURCE_REF,CANDIDATE_REVIEW_SOURCE_REF].includes(text(candidate.source_ref));
      const marker=explicitAuditSource?frontPublicationMarker(candidate):null;
      let assignment=assignmentRows.find((row)=>explicitAuditSource?lower(row.publication_status)==="publish_requested":["ready","publish_requested"].includes(lower(row.publication_status)));
      if(!assignment&&marker) assignment=syntheticAssignmentFromMarker(candidate,marker);
      if(!assignment) continue;
      // Old assignments created before the Tour classifier fix must not become
      // public merely because their persisted page says `tour`. Only actual
      // booking/travel services may enter the Tour SearchBank route.
      if(lower(assignment.hub_key)==="tour"&&!qualifiedTourCandidate(candidate,sourcePayload(candidate))) continue;
      const publicationRequested=lower(assignment.publication_status)==="publish_requested";
      let avail=avBy.get(candidate.id)||[];
      if(!avail.length&&marker&&publicationRequested) avail=syntheticAvailabilityFromMarker(candidate,marker);
      if(!avail.length) continue;
      const candidateRevenue=rBy.get(candidate.id)||[];
      const hasApprovedRevenue=candidateRevenue.some(row=>approvedRevenue(row.status));
      const explicitAdminReferral=explicitAuditSource&&publicationRequested&&explicitAdminReferralReady(candidate,assignment,avail);
      if(!hasApprovedRevenue&&!explicitAdminReferral) continue;
      let verifiedEvidence=(eBy.get(candidate.id)||[]).filter(verifiedEvidenceRow);
      if(!verifiedEvidence.length&&explicitAdminReferral&&marker) verifiedEvidence=syntheticEvidenceFromMarker(candidate,marker);
      if(!verifiedEvidence.length&&!explicitAdminReferral) continue;
      const publicationRevenue=hasApprovedRevenue?candidateRevenue:[explicitReferralRevenueRow(candidate,assignment)];
      const compact=compactPayload(candidate,assignment,avail,publicationRevenue,verifiedEvidence,ipPolicy);
      const row=publicationRevenue.find(entry=>approvedRevenue(entry.status))||publicationRevenue[0]||{};
      const type=lower(row.revenue_type)||"external_referral";
      const contract=plain(compact.brokerageContract);
      const listing=plain(compact.directCommerceListing);
      const trafficOnly=type==="external_referral";
      const payable=bool(first(contract.approved,listing.contractApproved)) && bool(first(contract.disclosureReady,listing.disclosureReady)) && bool(first(contract.payoutBasisVerified,listing.payoutBasisVerified));
      const publicationStatus=lower(assignment.publication_status);
      output.push({
        id:"gslot-"+candidate.id,
        sourceTier:"approved_commerce_member",
        syncedAt:now(),
        candidate:compact,
        review:{status:"approved",assignmentState:assignment.state,approvalId:assignment.id,approvedAt:assignment.updated_at,approvedBy:assignment.updated_by||null},
        assignment:{id:assignment.id,state:assignment.state,page:assignment.hub_key,section:assignment.slot_key,country:assignment.country_code,region:assignment.region_code||null,priority:assignment.priority,publicationStatus,updatedAt:assignment.updated_at},
        publicationRequest:{
          requested:publicationRequested,
          status:publicationStatus||null,
          assignmentId:assignment.id,
          requestedAt:assignment.updated_at||candidate.updated_at||null,
          requestedBy:assignment.updated_by||null,
          country:assignment.country_code,
          region:assignment.region_code||"NATIONWIDE",
          page:assignment.hub_key,
          section:assignment.slot_key,
          crossCountryFallback:false
        },
        revenue:{id:row.id||null,status:payable?"approved":"administrator_nonpayable_referral",type,contractId:first(contract.id,listing.contractId,row.id,assignment.id),approved:payable,trafficValueOnly:trafficOnly,nonPayableReferral:trafficOnly&&!payable,providerName:first(contract.providerName,listing.providerName,row.provider_name)||null,settlementMode:first(contract.settlementMode,listing.settlementMode,trafficOnly?"traffic_only":"provider_program"),disclosureReady:bool(first(contract.disclosureReady,listing.disclosureReady)),payoutBasisVerified:bool(first(contract.payoutBasisVerified,listing.payoutBasisVerified))}
      });
    }
    const expires=new Date(Date.now()+7*86400000).toISOString();
    const requestedRows=output.filter((entry)=>entry&&entry.publicationRequest&&entry.publicationRequest.requested===true);
    const requestedScopeKeys=unique(requestedRows.map((entry)=>{
      const request=plain(entry.publicationRequest);
      const country=MarketSaleScope.normalizeCountry(request.country);
      const region=MarketSaleScope.normalizeRegion(request.region||"NATIONWIDE",country)||"NATIONWIDE";
      return country?country+"|"+region:"";
    }));
    const withdrawalScopeKeys=unique(withdrawalRows.map((entry)=>{
      const country=MarketSaleScope.normalizeCountry(entry&&entry.country);
      const region=MarketSaleScope.normalizeRegion(entry&&entry.region||"NATIONWIDE",country)||"NATIONWIDE";
      return country?country+"|"+region:"";
    }));
    const scopeKeys=unique(requestedScopeKeys.concat(withdrawalScopeKeys));
    const explicitAdminRequest=requestedRows.length>0, explicitAdminWithdrawal=withdrawalRows.length>0;
    const authoritative=explicitAdminRequest||explicitAdminWithdrawal;
    const mode=explicitAdminRequest?"explicit-admin-publication-request":"explicit-admin-unpublication-request";
    const releaseAuthorization={
      authoritative,
      mode,
      explicitAdminRequest,
      explicitAdminWithdrawal,
      requestedCount:requestedRows.length,
      withdrawnCount:withdrawalRows.length,
      scopeKeys,
      withdrawalScopeKeys,
      withdrawalCandidateIds:unique(withdrawalRows.map((row)=>row&&row.candidateId)),
      generatedAt:now(),
      source:"gslot_slot_assignments.publication_status|gslot_candidates.source_payload.frontPublication",
      crossCountryFallback:false,
      automaticPublication:false
    };
    const doc={schema:"commerce-candidate-review-queue.v1",version:VERSION,generatedAt:now(),expiresAt:expires,source:"global-slot-console-approved-candidates",sourceDigest:sha256({candidates,assignments,availability,revenue,evidence}),authoritative,mode,explicitAdminRequest,explicitAdminWithdrawal,requestedCount:requestedRows.length,withdrawnCount:withdrawalRows.length,scopeKeys,withdrawalScopeKeys,releaseAuthorization,items:output};
    const digest=atomicWrite(file,doc);
    return {ok:true,status:"synchronized",version:VERSION,wrote:true,file,digest,count:output.length,requestedCount:requestedRows.length,withdrawnCount:withdrawalRows.length,scopeKeys,withdrawalScopeKeys,authoritative,releaseAuthorization,expiresAt:expires};
  } catch(error){
    return {ok:false,status:"blocked",version:VERSION,wrote:false,file,reason:"registry-sync-failed-existing-queue-preserved",error:String(error&&error.message||error)};
  }
}

module.exports={VERSION,QUEUE_FILE,PRODUCT_RESEARCH_SOURCE_REF,CANDIDATE_REVIEW_SOURCE_REF,syncApprovedCandidates,approvedAvailability,verifiedEvidenceRow};
