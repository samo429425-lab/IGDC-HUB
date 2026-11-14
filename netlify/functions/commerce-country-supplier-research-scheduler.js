'use strict';
// Scheduled function performs checkpointed supplier research steps, not entire
// long research cycles in one 30-second invocation.
const Staged = require('./lib/commerce-country-auto-supplier-pipeline.v1');
exports.config={schedule:'* * * * *'};
exports.handler=async function(){
  try{
    const result=await Staged.run();
    // Netlify Function logs reveal whether the cron fired and what happened.
    // Only country codes and stage summaries, never seller URLs or DB secrets.
    console.info('[IGDC_SUPPLIER_AUTO]',JSON.stringify({active:result.activeScopes,processed:result.processed,
      scopes:(result.results||[]).map(row=>({scope:row.scope,ok:row.ok!==false,
        phase:row.phase,result:row.lastResult,skipped:row.skipped||null,steps:row.stepsAdvanced,
        provider:row.lastProvider&&row.lastProvider.provider,providerStatus:row.lastProvider&&row.lastProvider.status,
        providerFound:row.lastProvider&&row.lastProvider.count,privateSaved:row.progressivePersisted,
        error:row.error?String(row.error).slice(0,110):null}))}));
    return{statusCode:result.ok?200:500,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(result)};
  }catch(e){console.error('[IGDC_SUPPLIER_AUTO_ERROR]',String(e&&e.message||e).slice(0,180));
    return{statusCode:500,body:JSON.stringify({ok:false,error:String(e&&e.message||e)})};}
};
