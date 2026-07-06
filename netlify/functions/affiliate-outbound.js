"use strict";

/**
 * Same-origin outbound resolver for released commerce cards.
 *
 * It supports two explicitly approved modes only:
 *   1) approved_manual_affiliate — provider-generated tracking link already
 *      approved by an operator; no provider API key is used here.
 *   2) verified_external_referral — official seller route whose traffic value
 *      may be measured, but no product-level commission is claimed.
 *
 * The browser never supplies a destination. The item is resolved from a
 * Canonical Snapshot and revalidated against the affiliate program registry.
 */

const fs = require("fs");
const path = require("path");
const Contract = require("./lib/nonpg-revenue-contract.core.v1");
const AffiliateRegistry = require("./lib/affiliate-program-registry.v1");

const SNAPSHOTS = [
  "data/search-bank.snapshot.json",
  "netlify/functions/data/search-bank.snapshot.json",
  "netlify/functions/search-bank.snapshot.json",
  "data/distribution.snapshot.json",
  "netlify/functions/data/distribution.snapshot.json",
  "data/front.snapshot.json",
  "netlify/functions/data/front.snapshot.json",
  "data/networkhub-snapshot.json",
  "netlify/functions/data/networkhub-snapshot.json",
  "data/tour-snapshot.json",
  "netlify/functions/data/tour-snapshot.json",
  "data/social.snapshot.json",
  "netlify/functions/data/social.snapshot.json"
];

function read(file){ try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch(_e){ return null; } }
function rootCandidates(rel){ return [path.join(process.cwd(), rel), path.join(__dirname, "..", "..", rel), path.join(__dirname, rel.replace(/^netlify\/functions\//, ""))]; }
function pushAll(out, value){ if(Array.isArray(value)) value.forEach(v=>{ if(v && typeof v === "object") out.push(v); }); }
function collect(doc){
  const out=[]; if(!doc || typeof doc !== "object") return out;
  pushAll(out,doc.items); pushAll(out,doc.results);
  for(const key of ["pages","sections"]){
    const container=doc[key]; if(!container || typeof container !== "object") continue;
    Object.values(container).forEach(page=>{
      const sections=page && page.sections || (key==="sections"?page:null);
      if(!sections || typeof sections!=="object") return;
      Object.values(sections).forEach(section=>{ if(Array.isArray(section)) pushAll(out,section); else if(section&&typeof section==="object"){pushAll(out,section.slots);pushAll(out,section.items);pushAll(out,section.results);} });
    });
  }
  return out;
}
function findItem(id){
  const seen=new Set();
  for(const rel of SNAPSHOTS) for(const file of rootCandidates(rel)){
    if(seen.has(file)) continue; seen.add(file);
    const hit=collect(read(file)).find(item=>String(item && (item.id||item.contentId||item.productId||item.uid)||"")===id);
    if(hit) return hit;
  }
  return null;
}
function plain(statusCode,body){ return {statusCode,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store, private"},body}; }
function published(item){ return !!(item && item.canonicalPublication && item.canonicalPublication.status==="published" && item.commerceCandidatePublication); }
function candidateCountries(item){ const values=[item&&item.country,item&&item.placement&&item.placement.country,item&&item.ipSlot&&item.ipSlot.marketCountry]; return Array.from(new Set(values.map(v=>String(v||"").trim().toUpperCase()).filter(v=>/^[A-Z]{2}$/.test(v)))); }

exports.handler=async(event)=>{
  const id=Contract.cleanId(event&&event.queryStringParameters&&event.queryStringParameters.id);
  if(!id) return plain(400,"Missing released commerce listing id");
  const item=findItem(id);
  if(!item || !published(item)) return plain(404,"Released commerce listing not found");
  const registry=AffiliateRegistry.load(process.cwd());
  if(!registry.ok) return plain(503,"Outbound policy registry is unavailable");
  const route=AffiliateRegistry.routeForItem(item,registry,candidateCountries(item));
  if(!route.ok) return plain(409,"Outbound route is no longer approved");
  const releasedRoute=item.outboundRoute||{};
  if(releasedRoute.mode!==AffiliateRegistry.publicRoute(route).mode) return plain(409,"Outbound route release evidence diverged");

  if(route.kind==="affiliate"){
    const affiliate=Contract.affiliateForItem(item);
    const destination=Contract.decorateAffiliateUrl(affiliate.trackingUrl,{affiliate,allowedHost:affiliate.trackingHost,referralId:id,itemId:id,source:"affiliate-outbound",campaign:"igdc_affiliate",clickSigningSecret:process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET||""});
    if(!destination) return plain(409,"Affiliate destination is unavailable");
    return {statusCode:302,headers:{Location:destination,"cache-control":"no-store, private","referrer-policy":"strict-origin-when-cross-origin","x-igdc-outbound-mode":"approved_manual_affiliate","x-igdc-revenue-state":"provider-approved-affiliate","x-igdc-affiliate-provider":affiliate.providerId||""},body:""};
  }

  const destination=Contract.httpsUrl(item.url||item.externalProductUrl||"");
  if(!destination) return plain(409,"External referral destination is unavailable");
  return {statusCode:302,headers:{Location:destination,"cache-control":"no-store, private","referrer-policy":"strict-origin-when-cross-origin","x-igdc-outbound-mode":"verified_external_referral","x-igdc-revenue-state":"traffic-value-not-product-commission"},body:""};
};
