'use strict';
// Scheduled function performs checkpointed supplier research steps, not entire
// long research cycles in one 30-second invocation.
const Staged = require('./lib/commerce-country-auto-supplier-pipeline.v1');
const Guard=require('./lib/commerce-scheduler-db-guard.v1');
exports.config={schedule:'0,3,5,8,10,13,15,18,20,23,25,28,30,33,35,38,40,43,45,48,50,53,55,58 * * * *'};
exports.handler=async function(){
  try{
    const result=await Guard.run('supplier-research',()=>Staged.run());
    // Netlify Function logs reveal whether the cron fired and what happened.
    // Only country codes and stage summaries, never seller URLs or DB secrets.
    console.info('[IGDC_SUPPLIER_AUTO]',JSON.stringify({active:result.activeScopes,elapsedMs:result.elapsedMs,eligible:result.eligibleScopes,deferred:result.deferredScopes,processed:result.processed,
      scopes:(result.results||[]).map(row=>({scope:row.scope,ok:row.ok!==false,
        phase:row.phase,result:row.lastResult,skipped:row.skipped||null,steps:row.stepsAdvanced,
        provider:row.lastProvider&&row.lastProvider.provider,providerStatus:row.lastProvider&&row.lastProvider.status,
        providerFound:row.lastProvider&&row.lastProvider.count,privateSaved:row.progressivePersisted,
        error:row.error?String(row.error).slice(0,110):null}))}));
    return{statusCode:result.ok?200:500,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(result)};
  }catch(e){console.error('[IGDC_SUPPLIER_AUTO_ERROR]',String(e&&e.message||e).slice(0,180));
    return{statusCode:500,body:JSON.stringify({ok:false,error:String(e&&e.message||e)})};}
};
