"use strict";

/**
 * Generic, same-origin outbound endpoint for approved non-PG affiliate links.
 *
 * It never accepts a destination URL from the browser. The product id is
 * resolved only from deployed snapshots, then the explicit affiliate contract
 * on that record is validated before the redirect is issued.
 */

const fs = require("fs");
const path = require("path");
const Contract = require("./lib/nonpg-revenue-contract.core.v1");

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
  "netlify/functions/data/social.snapshot.json",
  "data/media.snapshot.json",
  "netlify/functions/data/media.snapshot.json"
];

function read(file){ try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch(_e){ return null; } }
function rootCandidates(rel){
  return [path.join(process.cwd(), rel), path.join(__dirname, "..", "..", rel), path.join(__dirname, rel.replace(/^netlify\/functions\//, ""))];
}
function pushAll(out, value){
  if(Array.isArray(value)) value.forEach(v => { if(v && typeof v === "object") out.push(v); });
}
function collect(doc){
  const out = [];
  if(!doc || typeof doc !== "object") return out;
  pushAll(out, doc.items);
  pushAll(out, doc.results);
  const pages = doc.pages;
  if(pages && typeof pages === "object"){
    Object.values(pages).forEach(page => {
      const sections = page && page.sections;
      if(!sections || typeof sections !== "object") return;
      Object.values(sections).forEach(section => {
        if(Array.isArray(section)) pushAll(out, section);
        else if(section && typeof section === "object"){
          pushAll(out, section.slots);
          pushAll(out, section.items);
          pushAll(out, section.results);
        }
      });
    });
  }
  const sections = doc.sections;
  if(sections && typeof sections === "object"){
    Object.values(sections).forEach(section => {
      if(Array.isArray(section)) pushAll(out, section);
      else if(section && typeof section === "object"){
        pushAll(out, section.slots);
        pushAll(out, section.items);
      }
    });
  }
  return out;
}
function findItem(id){
  const seen = new Set();
  for(const rel of SNAPSHOTS){
    for(const file of rootCandidates(rel)){
      if(seen.has(file)) continue;
      seen.add(file);
      const doc = read(file);
      const hit = collect(doc).find(item => String(item && (item.id || item.contentId || item.productId || item.uid) || "") === id);
      if(hit) return hit;
    }
  }
  return null;
}
function plain(statusCode, body){
  return {
    statusCode,
    headers:{ "content-type":"text/plain; charset=utf-8", "cache-control":"no-store, private" },
    body
  };
}

exports.handler = async (event) => {
  const id = Contract.cleanId(event && event.queryStringParameters && event.queryStringParameters.id);
  if(!id) return plain(400, "Missing affiliate listing id");

  const item = findItem(id);
  if(!item) return plain(404, "Affiliate listing not found");

  const affiliate = Contract.affiliateForItem(item);
  if(!affiliate.eligible || !affiliate.trackingUrl) return plain(409, "Affiliate tracking is not configured for this listing");

  const destination = Contract.decorateAffiliateUrl(affiliate.trackingUrl, {
    affiliate,
    allowedHost: affiliate.trackingHost,
    referralId: id,
    itemId: id,
    source: "affiliate-outbound",
    campaign: "igdc_affiliate",
    clickSigningSecret: process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET || ""
  });
  if(!destination) return plain(409, "Affiliate destination is unavailable");

  return {
    statusCode: 302,
    headers:{
      Location: destination,
      "cache-control":"no-store, private",
      "referrer-policy":"strict-origin-when-cross-origin",
      "x-igdc-revenue-line":"product_affiliate",
      "x-igdc-affiliate-provider": affiliate.providerId || ""
    },
    body:""
  };
};
