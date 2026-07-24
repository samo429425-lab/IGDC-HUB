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

const VERSION = "commerce-candidate-registry-sync-v1.2.0-ordered-lifecycle-evidence-gate";
const QUEUE_FILE = "commerce-candidate-review-queue.v1.json";

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
function compactPayload(candidate, assignment, availabilityRows, revenueRows, evidenceRows){
  const payload=sourcePayload(candidate);
  const assignmentInfo=assignment||{};
  const revenue=(revenueRows||[]).find(row=>approvedRevenue(row.status)) || {};
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
  const item=Object.assign({},payload,{
    id:first(payload.id,candidate.id),
    title:first(payload.title,candidate.title),
    summary:first(payload.summary,candidate.description),
    description:first(payload.description,candidate.description),
    url:first(payload.url,candidate.official_url),
    image:first(payload.image,candidate.thumbnail_url),
    thumb:first(payload.thumb,candidate.thumbnail_url),
    page,
    channel:page,
    section:first(payload.section,assignmentInfo.slot_key),
    psom_key:first(payload.psom_key,assignmentInfo.slot_key),
    placement:Object.assign({},plain(payload.placement),{page,section:first(payload.section,assignmentInfo.slot_key),slot:first(payload.slot,assignmentInfo.priority>0?assignmentInfo.priority:"")}),
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
      destinationUrl:first(plain(payload.directCommerceListing).destinationUrl,revenueUrl,candidate.official_url),
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
      destinationUrl:first(plain(payload.brokerageContract).destinationUrl,revenueUrl,candidate.official_url),
      currency:first(plain(payload.brokerageContract).currency,revenue.currency),
      approvalSource:"global-slot-console-approved-revenue-record",
      approvalRecordId:revenueId||null,
      note:first(plain(payload.brokerageContract).note,revenue.note),
      expectedNetRevenuePerOrder:first(plain(payload.brokerageContract).expectedNetRevenuePerOrder,payload.expectedNetRevenuePerOrder)
    }),
    originCountry:first(payload.originCountry,payload.manufacturingCountry),
    productMapping:Object.assign({},plain(payload.productMapping),{slotProfile:first(plain(payload.productMapping).slotProfile,payload.slotProfile),productClass:first(plain(payload.productMapping).productClass,payload.productClass,"physical_product"),productIdentity:first(plain(payload.productMapping).productIdentity,payload.productId,candidate.id)})
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
    const [candidates,assignments,availability,revenue,evidence]=await Promise.all([
      sb.select("gslot_candidates","select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,source_payload,updated_at,created_at&order=updated_at.desc&limit=2000"),
      sb.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,priority,state,publication_status,manual_pinned,updated_at,updated_by&order=updated_at.desc&limit=5000"),
      sb.select("gslot_candidate_availability","select=candidate_id,country_code,region_code,availability_state,legal_basis,delivery_or_access,updated_at,updated_by&order=updated_at.desc&limit=5000"),
      sb.select("gslot_candidate_revenue","select=id,candidate_id,revenue_type,status,affiliate_url,provider_name,currency,note,updated_at&order=updated_at.desc&limit=5000"),
      sb.select("gslot_candidate_evidence","select=id,candidate_id,evidence_type,evidence_url,note,verified,created_at&order=created_at.desc&limit=5000")
    ]);
    const aBy=new Map(); array(assignments).forEach(row=>{ if(allowedAssignmentState(row.state) && lower(row.publication_status)==="ready" && !aBy.has(row.candidate_id)) aBy.set(row.candidate_id,row); });
    const avBy=new Map(), rBy=new Map(), eBy=new Map();
    array(availability).forEach(row=>{ if(!approvedAvailability(row.availability_state)) return; if(!avBy.has(row.candidate_id)) avBy.set(row.candidate_id,[]); avBy.get(row.candidate_id).push(row); });
    array(revenue).forEach(row=>{ if(!rBy.has(row.candidate_id)) rBy.set(row.candidate_id,[]); rBy.get(row.candidate_id).push(row); });
    array(evidence).forEach(row=>{ if(!eBy.has(row.candidate_id)) eBy.set(row.candidate_id,[]); eBy.get(row.candidate_id).push(row); });
    const output=[];
    for(const candidate of array(candidates)){
      if(!allowedCandidateStatus(candidate.status)) continue;
      const assignment=aBy.get(candidate.id); if(!assignment) continue;
      const candidateRevenue=rBy.get(candidate.id)||[]; if(!candidateRevenue.some(row=>approvedRevenue(row.status))) continue;
      const avail=avBy.get(candidate.id)||[]; if(!avail.length) continue;
      const verifiedEvidence=(eBy.get(candidate.id)||[]).filter(verifiedEvidenceRow); if(!verifiedEvidence.length) continue;
      const compact=compactPayload(candidate,assignment,avail,candidateRevenue,verifiedEvidence);
      const row=candidateRevenue.find(entry=>approvedRevenue(entry.status))||{};
      const type=lower(row.revenue_type)||"brokerage";
      const contract=plain(compact.brokerageContract);
      const listing=plain(compact.directCommerceListing);
      const trafficOnly=type==="external_referral";
      const payable=bool(first(contract.approved,listing.contractApproved)) && bool(first(contract.disclosureReady,listing.disclosureReady)) && bool(first(contract.payoutBasisVerified,listing.payoutBasisVerified));
      output.push({
        id:"gslot-"+candidate.id,
        sourceTier:"approved_commerce_member",
        syncedAt:now(),
        candidate:compact,
        review:{status:"approved",assignmentState:assignment.state,approvalId:assignment.id,approvedAt:assignment.updated_at,approvedBy:assignment.updated_by||null},
        assignment:{id:assignment.id,state:assignment.state,page:assignment.hub_key,section:assignment.slot_key,country:assignment.country_code,region:assignment.region_code||null,priority:assignment.priority,updatedAt:assignment.updated_at},
        revenue:{id:row.id||null,status:"approved",type,contractId:first(contract.id,listing.contractId,row.id,assignment.id),approved:payable,trafficValueOnly:trafficOnly,providerName:first(contract.providerName,listing.providerName,row.provider_name)||null,settlementMode:first(contract.settlementMode,listing.settlementMode,trafficOnly?"traffic_only":"provider_program"),disclosureReady:bool(first(contract.disclosureReady,listing.disclosureReady)),payoutBasisVerified:bool(first(contract.payoutBasisVerified,listing.payoutBasisVerified))}
      });
    }
    const expires=new Date(Date.now()+7*86400000).toISOString();
    const doc={schema:"commerce-candidate-review-queue.v1",version:VERSION,generatedAt:now(),expiresAt:expires,source:"global-slot-console-approved-candidates",sourceDigest:sha256({candidates,assignments,availability,revenue,evidence}),items:output};
    const digest=atomicWrite(file,doc);
    return {ok:true,status:"synchronized",version:VERSION,wrote:true,file,digest,count:output.length,expiresAt:expires};
  } catch(error){
    return {ok:false,status:"blocked",version:VERSION,wrote:false,file,reason:"registry-sync-failed-existing-queue-preserved",error:String(error&&error.message||error)};
  }
}

module.exports={VERSION,QUEUE_FILE,syncApprovedCandidates,approvedAvailability,verifiedEvidenceRow};
