"use strict";

/*
 * Lightweight administrator product-management ledger reader.
 * Purpose: keep the ordinary admin list independent from the large diagnostic /
 * staging / relation-hydration paths. Read-only; never publishes or mutates DB.
 */
const AdminSession=require("./lib/global-slot-console-auth");
const SlotStore=require("./lib/global-slot-console-supabase");
const MarketSaleScope=require("./lib/market-sale-scope.v1");
const ProductPipeline=require("./lib/commerce-product-pipeline-state.v1");

const VERSION="commerce-candidate-management-ledger-v1.0.0-direct-source-ref";
const READ_ROLES=new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager"]);
const PRODUCT_SOURCE_REF=ProductPipeline.SOURCE_REF; // country-product-ranking-review
function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase().replace(/\s+/g,"_");}
function plain(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function array(v){return Array.isArray(v)?v:[];}
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"},body:JSON.stringify(body)};}
function roles(actor){return Array.from(new Set(array(actor&&actor.roles).map(lower).filter(Boolean)));}
function normalizeCountry(v){return MarketSaleScope.normalizeCountry(v);}
function normalizeRegion(v,c){return MarketSaleScope.normalizeRegion(v,c);}
function candidateScopes(payloadInput){
  const payload=plain(payloadInput),scopes=[];
  function add(c,r){c=normalizeCountry(c);if(!c||c==="GLOBAL")return;r=normalizeRegion(r||"NATIONWIDE",c)||"NATIONWIDE";scopes.push({country:c,region:r});}
  for(const key of array(payload.marketKeys)){const m=text(key).toUpperCase().match(/^([A-Z]{2})-(.+)$/);if(m)add(m[1],m[2]);}
  const ms=plain(payload.marketScope);add(ms.marketCountry,ms.marketRegion);
  const cs=plain(payload.countrySupply);add(cs.country||cs.countryCode||cs.targetMarket,cs.region||cs.regionCode||cs.targetRegion);
  const p=plain(payload.approvedPlacement||payload.selectedPlacement||payload.placement);add(p.country||p.countryCode,p.region||p.regionCode);
  add(payload.targetCountry||payload.countryCode,payload.targetRegion||payload.regionCode);
  const seen=new Set();return scopes.filter(s=>{const k=s.country+"|"+s.region;if(seen.has(k))return false;seen.add(k);return true;});
}
function scopeMatch(payload,countryInput,regionInput){
  const country=normalizeCountry(countryInput),requested=normalizeRegion(regionInput||"NATIONWIDE",country)||"NATIONWIDE";
  if(!country||country==="GLOBAL")return false;
  const scopes=candidateScopes(payload).filter(s=>s.country===country);
  if(requested==="NATIONWIDE")return scopes.some(s=>s.region==="NATIONWIDE");
  return scopes.some(s=>s.region===requested||s.region==="NATIONWIDE");
}
function compact(candidate){
  const payload=plain(candidate&&candidate.source_payload),live=ProductPipeline.liveQueueRow(candidate,{assignments:[],markets:[],revenues:[],evidence:[]});
  live.queueControl=plain(payload.queueControl);live.slotDecision=text(payload.slotDecision);
  const placement=plain(payload.approvedPlacement||payload.selectedPlacement||payload.placement),front=plain(payload.frontPublication||payload.publication||payload.frontSync);
  if(Object.keys(placement).length){live.placement=Object.assign({},plain(live.placement),{page:text(placement.page),section:text(placement.section||placement.sectionKey),slot:text(placement.slot),country:text(placement.country||plain(payload.marketScope).marketCountry),region:text(placement.region||plain(payload.marketScope).marketRegion)});}
  if(Object.keys(front).length){live.lifecycle=Object.assign({},plain(live.lifecycle),{assignment:{publicationStatus:text(front.status||front.publicationStatus||front.publication_status),hubKey:text(front.hubKey||front.hub_key),slotKey:text(front.slotKey||front.slot_key)}});}
  live.managementProjection="direct_source_ref";return live;
}
async function selectPage(query){return SlotStore.request(SlotStore.rest("gslot_candidates",query),{method:"GET"});}
exports.handler=async function(event){
  const started=Date.now();
  try{
    if(String(event&&event.httpMethod||"GET").toUpperCase()==="OPTIONS")return json(204,{});
    if(String(event&&event.httpMethod||"GET").toUpperCase()!=="GET")return json(405,{ok:false,error:"method_not_allowed"});
    const actor=await AdminSession.resolveUser(event);if(!roles(actor).some(r=>READ_ROLES.has(r)))return json(403,{ok:false,error:"administrator_required"});
    const q=event.queryStringParameters||{},country=normalizeCountry(q.country),region=normalizeRegion(q.region||"NATIONWIDE",country)||"NATIONWIDE";
    if(!country||country==="GLOBAL")return json(200,{ok:true,version:VERSION,scope:{country:country||null,region},candidates:[],pagination:{returned:0,hasMore:false,nextOffset:null}});
    const limit=Math.max(25,Math.min(125,Number(q.limit||q.pageSize)||75)),offset=Math.max(0,Number(q.offset)||0);
    const fields="id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at";
    // First use the canonical current payload path. This is the normal fast path.
    const direct="select="+fields+"&source_ref=eq."+encodeURIComponent(PRODUCT_SOURCE_REF)+"&source_payload->marketScope->>marketCountry=eq."+encodeURIComponent(country)+"&source_payload->marketScope->>marketRegion=eq."+encodeURIComponent(region)+"&order=updated_at.desc,id.asc&limit="+limit+"&offset="+offset;
    let rows=await selectPage(direct),mode="marketScope";
    rows=array(rows);
    // Legacy fallback: only when the first direct page is empty. Scan the canonical
    // product source in bounded chunks and apply the old/new scope shapes in JS.
    if(offset===0&&!rows.length){
      mode="bounded_legacy_scan";const found=[];let scanOffset=0,rawDone=false;
      while(found.length<limit&&!rawDone&&scanOffset<6000){
        const batch=150,query="select="+fields+"&source_ref=eq."+encodeURIComponent(PRODUCT_SOURCE_REF)+"&order=updated_at.desc,id.asc&limit="+batch+"&offset="+scanOffset;
        const raw=array(await selectPage(query));for(const row of raw){if(scopeMatch(plain(row.source_payload),country,region))found.push(row);if(found.length>=limit)break;}
        scanOffset+=raw.length;rawDone=raw.length<batch;
      }
      rows=found;
    }
    const candidates=rows.map(compact),hasMore=mode==="marketScope"&&rows.length===limit;
    return json(200,{ok:true,version:VERSION,sourceRef:PRODUCT_SOURCE_REF,scope:{country,region},candidates,pagination:{offset,limit,returned:candidates.length,hasMore,nextOffset:hasMore?offset+rows.length:null,mode},runtime:{totalMs:Date.now()-started},safety:{readOnly:true,mutatesDatabase:false}});
  }catch(error){return json(Number(error&&error.statusCode)||500,{ok:false,version:VERSION,error:text(error&&error.message||error),runtime:{totalMs:Date.now()-started}});}
};
