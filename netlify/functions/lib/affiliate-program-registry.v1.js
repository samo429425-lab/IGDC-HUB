"use strict";

/**
 * Affiliate / outbound revenue registry v1
 * --------------------------------------------------------------------------
 * Runtime policy for non-PG commerce referral programs.  This module never
 * creates affiliate accounts, calls a provider API, generates a provider
 * tracking link, or stores any API secret.  It only verifies that a candidate
 * already carries an operator-approved, provider-generated link or an
 * operator-approved official external referral route.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const NonPgRevenue = require("./nonpg-revenue-contract.core.v1");

const VERSION = "affiliate-program-registry-v1.0.0-manual-link-first";
const REGISTRY_FILE = "affiliate-program-registry.v1.json";
const ACTIVE = new Set(["active", "approved", "verified", "live", "enabled", "policy_ok", "confirmed"]);
const API_DISABLED = new Set(["disabled", "inactive", "manual_link_only", "pending", "blocked"]);

function text(v){ return v == null ? "" : String(v).trim(); }
function lower(v){ return text(v).toLowerCase(); }
function bool(v){ return v === true || ["1","true","yes","on","approved","verified","active","enabled"].includes(lower(v)); }
function object(v){ return !!v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function arr(v){ return Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]); }
function uniq(values){ return Array.from(new Set((values || []).map(text).filter(Boolean))); }
function sha256(v){ return crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex"); }
function safeRead(file){ try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch(_e){ return null; } }
function rootOf(input){ return path.resolve(input && input.root || process.cwd()); }
function registryPaths(root){ return [path.join(root,"netlify","functions","data",REGISTRY_FILE),path.join(root,"data",REGISTRY_FILE)]; }
function isFresh(value, days){ const t=Date.parse(text(value)); const span=Math.max(1, Number(days)||30)*86400000; return Number.isFinite(t) && t <= Date.now()+300000 && t >= Date.now()-span; }
function iso(v){ const code=text(v).toUpperCase(); return /^[A-Z]{2}$/.test(code) ? code : ""; }
function affiliateRecord(item){
  const root=item||{}; const extension=object(root.extension); const commerce=object(root.commerceCandidate); const nested=object(extension.affiliate); const direct=object(root.affiliate);
  return Object.assign({}, nested, direct, object(commerce.affiliate));
}
function referralRecord(item){
  const root=item||{}; const extension=object(root.extension); const commerce=object(root.commerceCandidate);
  return Object.assign({}, object(extension.outboundReferral), object(root.outboundReferral), object(commerce.outboundReferral));
}
function normaliseProgram(program){
  const p=object(program);
  const id=lower(p.id||p.programId||p.program_id);
  return {
    id,
    name:text(p.name)||id,
    enabled:p.enabled !== false,
    mode:lower(p.mode||"manual_link_only") || "manual_link_only",
    allowedCountries:uniq(arr(p.allowedCountries||p.allowedMarkets).map(iso).filter(Boolean)),
    policyStatus:lower(p.policyStatus||p.policy_state||"operator_review_required"),
    policyCheckedAt:text(p.policyCheckedAt||p.policy_checked_at),
    policyMaxAgeDays:Math.max(1,Number(p.policyMaxAgeDays||p.policy_max_age_days)||14),
    manualLink:{
      enabled:object(p.manualLink).enabled !== false,
      requireOperatorApproval:object(p.manualLink).requireOperatorApproval !== false,
      requireProviderGeneratedUrl:object(p.manualLink).requireProviderGeneratedUrl !== false,
      requireDisclosure:object(p.manualLink).requireDisclosure !== false
    },
    api:{
      mode:lower(object(p.api).mode||"disabled") || "disabled",
      enabledEnv:text(object(p.api).enabledEnv||""),
      requiredSecrets:uniq(arr(object(p.api).requiredSecrets).map(text))
    }
  };
}
function defaultRegistry(){
  return {
    version:VERSION,
    purpose:"Provider policy registry for manual affiliate links and approved external referral routes. No API secret is stored here.",
    programs:[],
    externalReferral:{
      enabled:true,
      requireOperatorApproval:true,
      requireOfficialDestination:true,
      requireDisclosure:true,
      requireFreshVerification:true,
      verificationMaxAgeDays:30
    }
  };
}
function load(rootInput){
  const root=rootOf({root:rootInput}); const paths=registryPaths(root); const docs=paths.map(file=>({file,doc:safeRead(file)}));
  const first=docs.find(entry=>entry.doc && typeof entry.doc === "object"); const problems=[];
  if(!first) problems.push("AFFILIATE_PROGRAM_REGISTRY_MISSING");
  if(docs[0].doc && docs[1].doc && sha256(docs[0].doc)!==sha256(docs[1].doc)) problems.push("AFFILIATE_PROGRAM_REGISTRY_MIRROR_DIVERGED");
  const raw=Object.assign({},defaultRegistry(),first&&first.doc||{});
  const programs=arr(raw.programs).map(normaliseProgram).filter(program=>program.id);
  return {ok:problems.length===0, problems, root, raw, programs, externalReferral:Object.assign({},defaultRegistry().externalReferral,object(raw.externalReferral)), fingerprint:sha256({version:raw.version||VERSION,programs,externalReferral:raw.externalReferral||{}}), mirrors:docs.map(entry=>({path:entry.file,present:!!entry.doc,sha256:entry.doc?sha256(entry.doc):null}))};
}
function programFor(item, registry){
  const affiliate=NonPgRevenue.affiliateForItem(item);
  const raw=affiliateRecord(item);
  const id=lower(affiliate.programId||raw.programId||raw.program_id||raw.program);
  const provider=lower(affiliate.providerId||raw.providerId||raw.provider_id||raw.provider);
  const program=(registry&&registry.programs||[]).find(entry=>entry.id===id || (!!provider && entry.id===provider));
  return {affiliate, raw, id:id||provider||"", program:program||null};
}
function allowedCountriesFor(record, candidateCountries){
  const wanted=uniq(arr(candidateCountries).map(iso).filter(Boolean));
  const allowed=record.program && record.program.allowedCountries || [];
  if(!allowed.length) return wanted;
  return wanted.filter(country=>allowed.includes(country));
}
function manualAffiliate(item, registry, candidateCountries){
  const pack=programFor(item,registry||{}); const affiliate=pack.affiliate; const raw=pack.raw; const program=pack.program;
  const policyState=lower(raw.policyStatus||raw.policy_state||program&&program.policyStatus);
  const policyCheckedAt=text(raw.policyCheckedAt||raw.policy_checked_at||program&&program.policyCheckedAt);
  const policyAge=Number(raw.policyMaxAgeDays||raw.policy_max_age_days||program&&program.policyMaxAgeDays||14);
  const manualApproved=bool(raw.manualLinkApproved||raw.manual_link_approved||raw.operatorApproved||raw.operator_approved);
  const providerGenerated=bool(raw.providerGenerated||raw.provider_generated||raw.generatedByProvider||raw.generated_by_provider);
  const disclosure=bool(raw.disclosureReady||raw.disclosure_ready||raw.disclosureApproved||raw.disclosure_approved);
  const countries=allowedCountriesFor(pack,candidateCountries);
  const reasons=[];
  if(!program) reasons.push("AFFILIATE_PROGRAM_NOT_REGISTERED");
  else {
    if(!program.enabled) reasons.push("AFFILIATE_PROGRAM_DISABLED");
    if(program.mode!=="manual_link_only" && program.mode!=="api_enabled") reasons.push("AFFILIATE_PROGRAM_MODE_NOT_PERMITTED");
    if(!program.manualLink.enabled) reasons.push("AFFILIATE_MANUAL_LINK_DISABLED");
    if(API_DISABLED.has(program.api.mode) && lower(raw.integrationMode||raw.integration_mode||"manual")!=="manual") reasons.push("AFFILIATE_API_DISABLED_MANUAL_LINK_ONLY");
    if(!ACTIVE.has(policyState)) reasons.push("AFFILIATE_POLICY_NOT_CONFIRMED");
    else if(!isFresh(policyCheckedAt,policyAge)) reasons.push("AFFILIATE_POLICY_CHECK_STALE");
    if(program.manualLink.requireOperatorApproval && !manualApproved) reasons.push("AFFILIATE_MANUAL_LINK_OPERATOR_APPROVAL_MISSING");
    if(program.manualLink.requireProviderGeneratedUrl && !providerGenerated) reasons.push("AFFILIATE_PROVIDER_GENERATED_LINK_EVIDENCE_MISSING");
    if(program.manualLink.requireDisclosure && !disclosure) reasons.push("AFFILIATE_DISCLOSURE_NOT_APPROVED");
  }
  if(!affiliate.eligible || !affiliate.trackingUrl) reasons.push("AFFILIATE_TRACKING_LINK_NOT_APPROVED");
  if(!countries.length) reasons.push("AFFILIATE_MARKET_NOT_ALLOWED");
  return {
    mode:"approved_manual_affiliate",
    ok:reasons.length===0,
    reasons,
    providerId:affiliate.providerId||null,
    programId:affiliate.programId||pack.id||null,
    trackingUrl:affiliate.trackingUrl||null,
    trackingHost:affiliate.trackingHost||null,
    allowedCountries:countries,
    policyState:policyState||null,
    policyCheckedAt:policyCheckedAt||null,
    manualLinkApproved:manualApproved,
    providerGenerated,
    disclosureReady:disclosure,
    apiMode:program&&program.api.mode||"disabled"
  };
}
function externalReferral(item, registry, candidateCountries){
  const raw=referralRecord(item); const policy=registry&&registry.externalReferral||defaultRegistry().externalReferral;
  const state=lower(raw.status||raw.state||"");
  const approved=bool(raw.operatorApproved||raw.operator_approved||raw.approved)||ACTIVE.has(state);
  const official=bool(raw.officialDestination||raw.official_destination||raw.officialSeller||raw.official_seller);
  const disclosure=bool(raw.disclosureReady||raw.disclosure_ready||raw.disclosureApproved||raw.disclosure_approved);
  const verifiedAt=text(raw.verifiedAt||raw.verified_at||raw.checkedAt||raw.checked_at);
  const destination=NonPgRevenue.httpsUrl(raw.destinationUrl||raw.destination_url||item&&item.url||item&&item.externalProductUrl||"");
  const countries=uniq(arr(candidateCountries).map(iso).filter(Boolean)); const reasons=[];
  if(policy.enabled!==true) reasons.push("EXTERNAL_REFERRAL_POLICY_DISABLED");
  if(policy.requireOperatorApproval!==false && !approved) reasons.push("EXTERNAL_REFERRAL_OPERATOR_APPROVAL_MISSING");
  if(policy.requireOfficialDestination!==false && !official) reasons.push("EXTERNAL_REFERRAL_OFFICIAL_DESTINATION_NOT_CONFIRMED");
  if(policy.requireDisclosure!==false && !disclosure) reasons.push("EXTERNAL_REFERRAL_DISCLOSURE_NOT_APPROVED");
  if(policy.requireFreshVerification!==false && !isFresh(verifiedAt,Number(policy.verificationMaxAgeDays)||30)) reasons.push("EXTERNAL_REFERRAL_VERIFICATION_STALE");
  if(!destination) reasons.push("EXTERNAL_REFERRAL_DESTINATION_NOT_HTTPS");
  if(!countries.length) reasons.push("EXTERNAL_REFERRAL_MARKET_MISSING");
  return {mode:"verified_external_referral",ok:reasons.length===0,reasons,destination,allowedCountries:countries,verifiedAt:verifiedAt||null,officialDestination:official,disclosureReady:disclosure,operatorApproved:approved,trafficMonetization:"not_claimed"};
}
function routeForItem(item, registry, candidateCountries){
  const affiliate=manualAffiliate(item,registry,candidateCountries);
  if(affiliate.ok) return {ok:true,kind:"affiliate",affiliate,referral:null,allowedCountries:affiliate.allowedCountries,reasons:[]};
  const referral=externalReferral(item,registry,candidateCountries);
  if(referral.ok) return {ok:true,kind:"external_referral",affiliate,referral,allowedCountries:referral.allowedCountries,reasons:[]};
  return {ok:false,kind:"none",affiliate,referral,allowedCountries:[],reasons:affiliate.reasons.concat(referral.reasons)};
}
function publicRoute(route){
  if(!route||!route.ok) return {mode:"blocked",reason:"OUTBOUND_ROUTE_NOT_APPROVED"};
  if(route.kind==="affiliate") return {mode:"approved_manual_affiliate",providerId:route.affiliate.providerId,programId:route.affiliate.programId,trackingHost:route.affiliate.trackingHost,allowedCountries:route.allowedCountries,policyCheckedAt:route.affiliate.policyCheckedAt,apiMode:route.affiliate.apiMode,disclosureReady:true};
  return {mode:"verified_external_referral",allowedCountries:route.allowedCountries,verifiedAt:route.referral.verifiedAt,officialDestination:true,disclosureReady:true,trafficMonetization:"not_claimed"};
}

module.exports={VERSION,REGISTRY_FILE,load,programFor,manualAffiliate,externalReferral,routeForItem,publicRoute,registryPaths,isFresh};
