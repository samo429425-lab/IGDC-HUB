"use strict";
// One bounded read-only path for every source type. No new credentials, no writes.
const discovery=require('./distribution-center-discovery');
const reference=require('./distribution-center-admin-reference');
async function base(event,q,grant,deps={}){
 const load=deps.base||discovery.base, read=deps.read||reference.read;
 const requested=q.include_admin_reference===true;
 const allowed=requested&&grant.owner===true&&grant.country===q.country;
 const loadReference=async()=>{
  if(!requested)return {status:'not_requested',rows:[],scanned:0,more:false};
  if(!allowed)return {status:'permission_required',rows:[],scanned:0,more:false};
  try{const result=await read(event,{...q,page:0},grant);return result&&Array.isArray(result.rows)?result:{status:'ledger_format_error',rows:[],scanned:0,more:false};}catch{return {status:'ledger_unavailable',rows:[],scanned:0,more:false};}
 };
 const [result,admin]=await Promise.all([load(q,grant.country),loadReference()]);
 return {...result,admin_reference:admin,collection_flow:{version:60,public_status:result.statuses?.igdc||'unknown',feed_status:result.statuses?.feed||'unknown',ledger_status:admin.status,ledger_requested:requested,ledger_scanned:Number(admin.scanned)||0,ledger_matches:Array.isArray(admin.rows)?admin.rows.length:0,ledger_more:admin.more===true,original_request_separate:true}};
}
module.exports={base};
