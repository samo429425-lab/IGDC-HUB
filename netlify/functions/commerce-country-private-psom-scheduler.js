'use strict';
// Private verified candidate-to-PSOM worker; never triggers Front Match.
const Pipeline=require('./lib/commerce-country-private-psom-auto.v1');
exports.config={schedule:'*/3 * * * *'};
exports.handler=async function(){
  try{
    const result=await Pipeline.run();
    // Emit only country codes and private-queue progress. Never log seller
    // URLs, personally identifying visitor IPs, candidate payloads or secrets.
    console.info('[IGDC_PRIVATE_PSOM_AUTO]',JSON.stringify({active:result.activeScopes,processed:result.processed,
      scopes:(result.results||[]).map(item=>({scope:item.scope,ok:item.ok!==false,
        phase:item.phase,result:item.result,skipped:item.skipped||null,
        placed:item.placed,reviewRequired:item.reviewRequired,nextCycleAt:item.nextCycleAt||null,
        error:item.error?String(item.error).slice(0,110):null}))}));
    return{statusCode:result.ok?200:500,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(result)};
  }catch(e){console.error('[IGDC_PRIVATE_PSOM_AUTO_ERROR]',String(e&&e.message||e).slice(0,180));
    return{statusCode:500,body:JSON.stringify({ok:false,error:String(e&&e.message||e)})};}
};
