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

const VERSION = "commerce-candidate-registry-sync-v1.8.2-exact-product-card-destination";
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
function publicProductCards(payload){
  payload=plain(payload);
  const direct=plain(payload.productCard);
  const research=plain(payload.researchReadiness), researchCard=plain(research.productCard);
  const release=plain(payload.releaseReadiness), releaseCard=plain(release.productCard);
  return [researchCard,direct,releaseCard];
}
function publicProductDestination(candidate,payload){
  payload=plain(payload);
  const cards=publicProductCards(payload);
  /* The reviewed product card owns the exact product-detail destination.
     Supplier/home/list pages are never promoted ahead of that deep link. */
  const candidates=[];
  for(const card of cards){
    candidates.push(card.checkoutUrl,card.productUrl,card.productPageUrl,card.detailUrl,card.url,card.link,card.href);
  }
  candidates.push(payload.checkoutUrl,payload.productUrl,payload.productPageUrl,payload.detailUrl,payload.externalProductUrl,payload.url,payload.link,payload.href,payload.externalOutboundUrl,candidate&&candidate.official_url);
  for(const value of candidates){
    const url=safeUrl(value);
    if(url&&ProductRanking.isSpecificProductUrl(url)) return url;
  }
  return "";
}
function publicProductImage(candidate,payload){
  payload=plain(payload);
  const cards=publicProductCards(payload), candidates=[];
  for(const card of cards){
    candidates.push(card.image,card.imageUrl,card.imageOriginalUrl,card.thumbnail,card.thumbnailUrl,card.thumb);
  }
  candidates.push(payload.image,payload.imageUrl,payload.imageOriginalUrl,payload.thumbnail,payload.thumbnailUrl,payload.thumb,candidate&&candidate.thumbnail_url);
  for(const value of candidates){
    const url=ProductRanking.safeProductImageUrl(value);
    if(url) return url;
  }
  return "";
}
function publicProductTitle(candidate,payload){
  payload=plain(payload);
  const cards=publicProductCards(payload);
  return first(cards[0].title,cards[0].productName,cards[1].title,cards[1].productName,cards[2].title,cards[2].productName,payload.productName,payload.title,candidate&&candidate.title);
}
function publicProductPrice(payload){
  payload=plain(payload); const cards=publicProductCards(payload);
  return first(cards[0].price,cards[0].salePrice,cards[1].price,cards[1].salePrice,cards[2].price,cards[2].salePrice,payload.price,payload.salePrice,payload.currentPrice);
}
function publicProductCurrency(payload){
  payload=plain(payload); const cards=publicProductCards(payload);
  return first(cards[0].priceCurrency,cards[0].currency,cards[1].priceCurrency,cards[1].currency,cards[2].priceCurrency,cards[2].currency,payload.priceCurrency,payload.currency);
}
function publicProductTimestamp(candidate,payload){
  payload=plain(payload); const cards=publicProductCards(payload), mapping=plain(payload.productMapping), research=plain(payload.research), timestamps=plain(payload.timestamps);
  return first(cards[0].lastVerifiedAt,cards[1].lastVerifiedAt,cards[2].lastVerifiedAt,mapping.firstVerifiedAt,payload.firstVerifiedAt,payload.listedAt,payload.discoveredAt,research.discoveredAt,timestamps.discoveredAt,candidate&&candidate.created_at,candidate&&candidate.updated_at);
}
function publicCardReady(candidate,payload){
  const title=publicProductTitle(candidate,payload);
  return !ProductRanking.isGenericProductName(title) && !genericProductTitle(title) && !!publicProductDestination(candidate,payload) && !!publicProductImage(candidate,payload);
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
  const title=first(payload.title,payload.productName,candidate&&candidate.title);
  const destination=safeUrl(first(payload.url,payload.productUrl,payload.checkoutUrl,candidate&&candidate.official_url));
  const image=safeUrl(first(payload.image,payload.imageUrl,payload.imageOriginalUrl,payload.thumbnail,payload.thumb,candidate&&candidate.thumbnail_url));
  const supplierUrl=safeUrl(first(payload.supplierSiteUrl,plain(payload.supplier).officialUrl,plain(payload.sellerResponsibility).supportUrl,candidate&&candidate.official_url));
  const supplierName=first(payload.sellerName,payload.supplierName,plain(payload.supplier).name,plain(payload.sellerResponsibility).legalEntity,candidate&&candidate.title);
  if(ProductRanking.isGenericProductName(title)||genericProductTitle(title)||!destination||!image||!supplierUrl||!supplierName) return false;
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
    affiliate_url:first(payload.url,payload.productUrl,payload.checkoutUrl,candidate&&candidate.official_url),
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
  // gslot_slot_assignments.priority is ranking priority, not a physical slot.
  // Only a manually pinned assignment may request a concrete slot number.
  const requestedSlot=authoritativeRequestedSlot(payload,assignmentInfo);
  const destination=publicProductDestination(candidate,payload);
  const image=publicProductImage(candidate,payload);
  const title=publicProductTitle(candidate,payload);
  const price=publicProductPrice(payload);
  const currency=publicProductCurrency(payload);
  const firstVerifiedAt=publicProductTimestamp(candidate,payload);
  const item=Object.assign({},payload,{
    id:first(payload.id,candidate.id),
    title,
    name:title,
    // Public product cards are intentionally compact. Internal review/risk prose
    // belongs in the administrator ledger and must never leak into front cards.
    summary:"",
    description:"",
    url:destination,
    link:destination,
    href:destination,
    image,
    thumb:image,
    thumbnail:image,
    externalOutboundUrl:trafficOnly?destination:undefined,
    price:price||undefined,
    currency:currency||undefined,
    firstVerifiedAt:firstVerifiedAt||undefined,
    page,
    channel:page,
    section,
    psom_key:section,
    placement:Object.assign({},plain(payload.placement),{page,section,slot:requestedSlot}),
    source:{name:first(plain(payload.source).name,candidate.title,"Approved commerce member"),url:first(plain(payload.source).url,candidate.official_url)},
    searchBankContract:Object.assign({},plain(payload.searchBankContract),{frontSupplyAllowed:true,searchBankEligible:true,snapshotEligible:true,indexEligible:true,lastVerifiedAt:first(plain(payload.searchBankContract).lastVerifiedAt,candidate.updated_at),trustScore:Number(plain(payload.searchBankContract).trustScore||payload.trustScore||75),trustTier:first(plain(payload.searchBankContract).trustTier,payload.trustTier,"A"),officialSource:bool(first(plain(payload.searchBankContract).officialSource,payload.officialSource,true)),producerVerified:bool(first(plain(payload.searchBankContract).producerVerified,payload.producerVerified,true))}),
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
      destinationUrl:first(plain(payload.directCommerceListing).destinationUrl,revenueUrl,destination),
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
      destinationUrl:first(plain(payload.brokerageContract).destinationUrl,revenueUrl,destination),
      currency:first(plain(payload.brokerageContract).currency,revenue.currency),
      approvalSource:"global-slot-console-approved-revenue-record",
      approvalRecordId:revenueId||null,
      note:first(plain(payload.brokerageContract).note,revenue.note),
      expectedNetRevenuePerOrder:first(plain(payload.brokerageContract).expectedNetRevenuePerOrder,payload.expectedNetRevenuePerOrder)
    }),
    originCountry:first(payload.originCountry,payload.manufacturingCountry),
    productMapping:Object.assign({},plain(payload.productMapping),{slotProfile,productClass:first(plain(payload.productMapping).productClass,payload.productClass,"physical_product"),productIdentity:first(plain(payload.productMapping).productIdentity,payload.productId,candidate.id),strategyId:first(slotStrategy.strategyId,slotProfile),strategyRole:first(slotStrategy.role),policyDerivedSlotProfile:!!slotStrategy.strategyId,firstVerifiedAt:firstVerifiedAt||undefined})
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
    const output=[];
    for(const candidate of array(candidates)){
      if(!allowedCandidateStatus(candidate.status)) continue;
      const candidatePayload=sourcePayload(candidate);
      // A revenue relation never overrides the public-card contract. Missing or
      // generic titles, missing exact product destinations, and missing product
      // images stay private instead of producing broken public cards.
      if(!publicCardReady(candidate,candidatePayload)) continue;
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
    const scopeKeys=unique(requestedRows.map((entry)=>{
      const request=plain(entry.publicationRequest);
      const country=MarketSaleScope.normalizeCountry(request.country);
      const region=MarketSaleScope.normalizeRegion(request.region||"NATIONWIDE",country)||"NATIONWIDE";
      return country?country+"|"+region:"";
    }));
    const explicitAdminRequest=requestedRows.length>0;
    const releaseAuthorization={
      authoritative:explicitAdminRequest,
      mode:"explicit-admin-publication-request",
      explicitAdminRequest,
      requestedCount:requestedRows.length,
      scopeKeys,
      generatedAt:now(),
      source:"gslot_slot_assignments.publication_status|gslot_candidates.source_payload.frontPublication",
      crossCountryFallback:false,
      automaticPublication:false
    };
    const doc={schema:"commerce-candidate-review-queue.v1",version:VERSION,generatedAt:now(),expiresAt:expires,source:"global-slot-console-approved-candidates",sourceDigest:sha256({candidates,assignments,availability,revenue,evidence}),authoritative:explicitAdminRequest,mode:"explicit-admin-publication-request",explicitAdminRequest,requestedCount:requestedRows.length,scopeKeys,releaseAuthorization,items:output};
    const digest=atomicWrite(file,doc);
    return {ok:true,status:"synchronized",version:VERSION,wrote:true,file,digest,count:output.length,requestedCount:requestedRows.length,scopeKeys,authoritative:explicitAdminRequest,releaseAuthorization,expiresAt:expires};
  } catch(error){
    return {ok:false,status:"blocked",version:VERSION,wrote:false,file,reason:"registry-sync-failed-existing-queue-preserved",error:String(error&&error.message||error)};
  }
}

module.exports={VERSION,QUEUE_FILE,PRODUCT_RESEARCH_SOURCE_REF,CANDIDATE_REVIEW_SOURCE_REF,syncApprovedCandidates,approvedAvailability,verifiedEvidenceRow};
