"use strict";

const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
function t(v){return v==null?"":String(v).trim()}
function l(v){return t(v).toLowerCase()}
function o(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}
function a(v){return Array.isArray(v)?v:[]}
function json(f){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch(_e){return null}}
function https(v){try{return new URL(t(v)).protocol==="https:"}catch(_e){return false}}
function baseId(v){return t(v).split("::")[0]}
const NONPUBLIC=new Set(["blocked_structural","deferred_duplicate_product","deferred_section_capacity"]);

const queue=json(path.join(root,"netlify/functions/data/commerce-candidate-review-queue.v1.json"))||{};
const all=a(queue.items);
const requested=all.filter(x=>{
  const r=o(x&&x.publicationRequest),as=o(x&&x.assignment);
  const status=l(r.status||as.publicationStatus);
  if(NONPUBLIC.has(status))return false;
  return r.requested===true||status==="publish_requested"||status==="matched"||status==="published"||status==="active";
});

if(requested.length===0){
  const held=all.filter(x=>NONPUBLIC.has(l(o(x&&x.publicationRequest).status||o(x&&x.assignment).publicationStatus))).length;
  console.log("IGDC SearchBank handoff gate skipped · no normalized administrator publication request · held="+held);
  process.exit(0);
}

const structurallyValid=requested.filter(x=>{
  const c=o(x&&x.candidate),r=o(x&&x.publicationRequest),as=o(x&&x.assignment);
  return t(c.id)&&t(c.title||c.name)&&https(c.productUrl||c.externalProductUrl||c.url)&&https(c.imageUrl||c.thumbnailUrl||c.thumbnail||c.image)&&t(r.page||as.page||c.page)&&t(r.section||as.section||c.section)&&t(r.country||as.country)&&t(r.assignmentId||as.id);
});
if(structurallyValid.length!==requested.length){
  const bad=requested.filter(x=>!structurallyValid.includes(x));
  console.error("IGDC SearchBank verification failed: normalized publication queue still contains "+bad.length+" structural error(s) · sample="+bad.slice(0,8).map(x=>t(o(x.candidate).id)).join(","));
  process.exit(86);
}

const files=[
  "data/search-bank.snapshot.json",
  "netlify/functions/data/search-bank.snapshot.json",
  "netlify/functions/search-bank.snapshot.json",
  "search-bank.snapshot.json"
].map(f=>path.join(root,f));
let bank=null,bankFile="";
for(const f of files){const d=json(f);if(d&&Array.isArray(d.items)){bank=d;bankFile=f;break}}
if(!bank){
  console.error("IGDC SearchBank verification failed: normalized Front Match exists but no valid search-bank.snapshot.json was materialized");
  process.exit(86);
}

// A base candidate ID alone is not a public identity in a 249-country market.
// Require exact country/subdivision from the canonical publication placement.
function marketIdentity(id,country,region){
  const c=t(country).toUpperCase(),r=t(region||"NATIONWIDE").toUpperCase();
  return baseId(id)&&/^[A-Z]{2}$/.test(c)&&r ? baseId(id)+"|"+c+"|"+r : "";
}
function requestedIdentity(row){
  const r=o(row&&row.publicationRequest),as=o(row&&row.assignment);
  return marketIdentity(o(row&&row.candidate).id,r.country||as.country,r.region||as.region);
}
const bankMarketIds=new Set();
for(const item of a(bank.items)){
  const publication=o(item&&item.canonicalPublication),placement=o(item&&item.placement);
  const country=placement.country,region=placement.region;
  for(const value of [publication.candidateId,item&&item.candidateId,item&&item.id,item&&item.productId,item&&item.contentId]){
    const key=marketIdentity(value,country,region);
    if(key)bankMarketIds.add(key);
  }
}
const missing=structurallyValid.filter(row=>!bankMarketIds.has(requestedIdentity(row)));

// Canonical may deliberately HOLD a Front-Matched item whose country/region
// market-sale verification has expired.  That is not identity loss: publishing
// such an item violates the public IP-scope contract, but retrying/aborting the
// entire Netlify build prevents every other valid product from going live.
// Reconcile only with the audit produced by the SAME canonical release.  An
// unaccounted-for ID, missing audit, truncated audit, unrelated rejection, or
// accepted-but-vanished product remains a fatal handoff error.
function reconcileMarketEvidenceHolds(missingRows, bankDocument){
  if(!missingRows.length)return{held:[],unexplained:[]};
  const base=path.join(root,"data","canonical-snapshot");
  const manifest=json(path.join(base,"current-manifest.json"));
  const audit=json(path.join(base,"audit","latest.json"));
  const release=t(o(bankDocument&&bankDocument.meta).releaseId);
  if(!release||!manifest||!audit||manifest.status!=="published"||
    t(manifest.releaseId)!==release||t(audit.releaseId)!==release||
    audit.rejectedTruncated===true||!Array.isArray(audit.rejected)||
    !Array.isArray(manifest.mapping)||!Array.isArray(audit.accepted)){
    return{held:[],unexplained:missingRows,reason:"canonical_same_release_audit_missing_or_incomplete"};
  }
  const acceptedIds=new Set(a(manifest.mapping).concat(a(audit.accepted)).map(row=>
    marketIdentity(o(row).candidateId,o(row).country,o(row).region)).filter(Boolean));
  const rejected=new Map();
  for(const row of audit.rejected){
    const id=baseId(o(row).candidateId);if(!id)continue;
    if(!rejected.has(id))rejected.set(id,[]);
    rejected.get(id).push(row);
  }
  const held=[],unexplained=[];
  for(const row of missingRows){
    const id=baseId(o(row&&row.candidate).id);
    const request=o(row&&row.publicationRequest),assignment=o(row&&row.assignment);
    const country=t(request.country||assignment.country).toUpperCase();
    const region=t(request.region||assignment.region||"NATIONWIDE").toUpperCase();
    // Country-specific rejection from a different market must NEVER excuse
    // this country's missing candidate, even if the base product ID is shared.
    const matchingAudit=a(rejected.get(id)).filter(entry=>
      country&&region&&t(o(entry).country).toUpperCase()===country&&
      t(o(entry).region).toUpperCase()===region);
    const reasons=matchingAudit.flatMap(entry=>a(o(entry).reasons).map(t).filter(Boolean));
    // An expired / invalid market evidence record is a *known* non-public
    // outcome.  Require a positive scope/timestamp gate reason and permit only
    // the two canonical integrity reasons added at pre-publication validation.
    const marketError=reasons.some(reason=>reason.startsWith("PUBLISHED_MARKET_SCOPE_EVIDENCE_INVALID:"));
    const known=reasons.length>0&&marketError&&reasons.every(reason=>
      reason.startsWith("PUBLISHED_MARKET_SCOPE_EVIDENCE_INVALID:")||
      reason==="PUBLISHED_MARKET_EVIDENCE_DIGEST_MISMATCH");
    if(!acceptedIds.has(marketIdentity(id,country,region))&&known)held.push({candidateId:id,reasons:Array.from(new Set(reasons))});
    else unexplained.push(row);
  }
  return{held,unexplained,reason:unexplained.length?"unexplained_canonical_handoff_loss":null,release};
}
const reconciliation=reconcileMarketEvidenceHolds(missing,bank);
const real=a(bank.items).filter(x=>https(x&&(x.productUrl||x.externalProductUrl||x.officialProductUrl||x.url||x.link||x.href))&&!/(sample|placeholder|demo|mock|fixture)/i.test(t(x&&(x.title||x.name)))).length;
const held=all.filter(x=>NONPUBLIC.has(l(o(x&&x.publicationRequest).status||o(x&&x.assignment).publicationStatus)));
const heldCounts={};
for(const x of held){const s=l(o(x&&x.publicationRequest).status||o(x&&x.assignment).publicationStatus)||"unknown";heldCounts[s]=(heldCounts[s]||0)+1;}

if(reconciliation.unexplained.length){
  console.error("IGDC SearchBank verification failed: true normalized identity loss "+reconciliation.unexplained.length+"/"+structurallyValid.length+
    " · known market-evidence holds="+reconciliation.held.length+
    " · reason="+(reconciliation.reason||"unreconciled")+
    " · sample="+reconciliation.unexplained.slice(0,12).map(x=>baseId(o(x.candidate).id)).join(","));
  process.exit(86);
}
if(reconciliation.held.length){
  console.warn("IGDC SearchBank canonical market-evidence hold: "+reconciliation.held.length+
    " requested candidate(s) remain PRIVATE pending market re-verification; release="+reconciliation.release+
    " · sample="+reconciliation.held.slice(0,12).map(x=>x.candidateId).join(","));
}
if(real===0){
  console.error("IGDC SearchBank verification failed: normalized administrator products were requested but SearchBank contains zero real products");
  process.exit(86);
}

console.log("IGDC SearchBank handoff OK · normalized-requested="+requested.length+" · structural-valid="+structurallyValid.length+" · held="+held.length+" "+JSON.stringify(heldCounts)+" · canonicalMarketHolds="+reconciliation.held.length+" · searchbank-real="+real+" · file="+path.relative(root,bankFile));
