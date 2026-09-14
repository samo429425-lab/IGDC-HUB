"use strict";

/**
 * Coupang Partners product sync.
 *
 * Runs daily, but exits immediately while the provider is not fully enabled.
 * When enabled it imports only provider-signed product data and provider-
 * generated affiliate URLs into the EXISTING private commerce candidate ledger.
 * It never writes a public snapshot and never bypasses the existing ranking,
 * profitability, tax, market, audit, or canonical publication gates.
 */

const crypto = require("crypto");
const Provider = require("./lib/coupang-partners-provider.v1");
const Store = require("./lib/global-slot-console-supabase");
const ProductPipeline = require("./lib/commerce-product-pipeline-state.v1");

exports.config = { schedule:"@daily" };

const VERSION = "coupang-partners-sync-v1.0.0-private-ledger";
const REVENUE_TYPE = "affiliate";

function text(v){ return v == null ? "" : String(v).trim(); }
function bool(v){ return v === true || ["1","true","yes","on","enabled"].includes(text(v).toLowerCase()); }
function sha256(v){ return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function json(statusCode,body){ return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"},body:JSON.stringify(body)}; }
function bearer(event){ const h=event&&event.headers||{}; const raw=text(h.authorization||h.Authorization); const m=raw.match(/^Bearer\s+(.+)$/i); return m?text(m[1]):""; }
function safeEqual(a,b){ const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||"")); return x.length===y.length&&crypto.timingSafeEqual(x,y); }
function isScheduled(event){ return !!(event && (event.scheduledTime || event.next_run)) || !text(event&&event.httpMethod); }

function requireHttpAuth(event){
  if(isScheduled(event)) return;
  const expected=text(process.env.COUPANG_SYNC_TOKEN);
  if(!expected || !safeEqual(bearer(event),expected)){ const e=new Error("coupang_sync_unauthorized"); e.statusCode=401; throw e; }
}

function dbRow(candidate,now){
  return {
    id:candidate.id,
    kind:"product",
    title:candidate.title,
    official_url:candidate.externalProductUrl,
    status:"enrollable",
    source_ref:ProductPipeline.SOURCE_REF,
    thumbnail_url:candidate.image||null,
    description:candidate.description||null,
    owner_note:"Coupang Partners API candidate. Existing IGDC audit, profitability, tax/legal, slot, canonical and publication gates remain mandatory.",
    source_payload:candidate,
    updated_at:now,
    created_by:"coupang-partners-sync"
  };
}

async function upsertCandidate(candidate,now){
  const row=dbRow(candidate,now);
  const route=Store.rest("gslot_candidates","on_conflict=id");
  const result=await Store.request(route,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([row])});
  return Array.isArray(result)?result[0]||row:row;
}

async function upsertAvailability(candidate,now){
  const row={
    candidate_id:candidate.id,
    country_code:"KR",
    region_code:"NATIONWIDE",
    availability_state:"active",
    legal_basis:"provider_signed_affiliate_catalog",
    delivery_or_access:"external_provider_checkout",
    updated_at:now,
    updated_by:"coupang-partners-sync"
  };
  // Avoid assuming a compound on_conflict key exists. Replace only the exact
  // candidate/provider row through the existing REST operations.
  try { await Store.remove("gslot_candidate_availability","candidate_id=eq."+encodeURIComponent(candidate.id)+"&country_code=eq.KR&region_code=eq.NATIONWIDE"); } catch(_e){}
  return Store.insert("gslot_candidate_availability",row,"return=representation");
}

async function upsertRevenue(candidate,now){
  const id="rev_"+sha256("coupang|"+candidate.id).slice(0,24);
  const row={
    id,
    candidate_id:candidate.id,
    revenue_type:REVENUE_TYPE,
    status:"approved",
    affiliate_url:candidate.affiliate&&candidate.affiliate.trackingUrl||null,
    provider_name:"Coupang Partners Korea",
    currency:"KRW",
    note:"Provider-generated affiliate route. Actual commission/fees/tax are confirmed only from provider statements; no simulated revenue is recorded.",
    updated_at:now
  };
  const route=Store.rest("gslot_candidate_revenue","on_conflict=id");
  return Store.request(route,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([row])});
}

async function stage(products,cfg){
  const now=new Date().toISOString();
  const urls=products.map(p=>p.productUrl);
  const deepLinks=await Provider.createDeepLinks(urls,cfg);
  const results=[];
  for(const product of products){
    const trackingUrl=deepLinks.get(product.productUrl);
    if(!trackingUrl){ results.push({providerProductId:product.providerProductId,status:"held",reason:"PROVIDER_DEEPLINK_MISSING"}); continue; }
    const candidate=Provider.candidateFromProduct(product,trackingUrl,cfg);
    try{
      await upsertCandidate(candidate,now);
      await upsertAvailability(candidate,now);
      await upsertRevenue(candidate,now);
      results.push({candidateId:candidate.id,providerProductId:product.providerProductId,status:"staged_private",seoLandingEnabled:true});
    }catch(error){ results.push({candidateId:candidate.id,providerProductId:product.providerProductId,status:"failed",error:text(error&&error.message||error)}); }
  }
  return results;
}

async function run(input){
  const cfg=input&&input.cfg||Provider.config();
  if(!cfg.ready) return {ok:true,version:VERSION,status:"provider_not_ready",provider:Provider.publicConfig(cfg),fetched:0,staged:0,publicPublication:false};
  const all=[];
  const failures=[];
  for(const categoryId of cfg.categoryIds){
    try{
      const rows=await Provider.fetchPopular(categoryId,cfg,input&&input.deps);
      rows.forEach(row=>all.push(row));
    }catch(error){ failures.push({categoryId,error:text(error&&error.message||error),statusCode:error&&error.statusCode||null}); }
  }
  const dedupe=new Map();
  for(const row of all) if(row&&row.providerProductId&&!dedupe.has(row.providerProductId)) dedupe.set(row.providerProductId,row);
  const products=Array.from(dedupe.values()).slice(0,Math.max(1,Math.min(500,Number(process.env.COUPANG_SYNC_MAX_PRODUCTS)||120)));
  const staged=await stage(products,cfg);
  return {
    ok:failures.length===0 || staged.some(r=>r.status==="staged_private"),
    version:VERSION,
    status:"completed",
    provider:Provider.publicConfig(cfg),
    fetched:products.length,
    staged:staged.filter(r=>r.status==="staged_private").length,
    held:staged.filter(r=>r.status==="held").length,
    failed:staged.filter(r=>r.status==="failed").length,
    failures,
    results:staged.slice(0,500),
    safety:{privateCandidateLedger:true,automaticPublicSnapshot:false,automaticCheckout:false,simulatedRevenue:false,existingProfitabilityGateRequired:true,existingCanonicalAuditRequired:true}
  };
}

exports.handler=async function(event){
  try{
    if(text(event&&event.httpMethod).toUpperCase()==="OPTIONS") return json(204,{});
    requireHttpAuth(event||{});
    if(text(event&&event.httpMethod).toUpperCase()==="GET" && !isScheduled(event)){
      return json(200,{ok:true,version:VERSION,status:"ready_check",provider:Provider.publicConfig(Provider.config()),schedule:"@daily",publicPublication:false});
    }
    return json(200,await run({}));
  }catch(error){ return json(error&&error.statusCode||500,{ok:false,version:VERSION,error:text(error&&error.message||error),code:text(error&&error.code)||null,blockers:error&&error.blockers||undefined}); }
};

exports._test={VERSION,dbRow,run,isScheduled};
