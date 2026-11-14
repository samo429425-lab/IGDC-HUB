'use strict';
const Pipeline = require('./lib/commerce-country-auto-product-pipeline.v1');
function json(code, data) { return { statusCode:code, headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}, body:JSON.stringify(data) }; }
// Bounded, checkpointed continuation of supplier discovery; does not touch
// the manually operated country/IP selector or invoke Front Match.
exports.config = { schedule:'*/2 * * * *' };
exports.handler = async function () {
  try {
    const result=await Pipeline.run();
    console.info('[IGDC_PRODUCT_AUTO]',JSON.stringify({active:result.activeScopes,processed:result.processed,
      scopes:(result.results||[]).map(row=>({scope:row.scope,ok:row.ok!==false,phase:row.phase,
        result:row.result,privateSaved:row.privateCandidatesStaged,review:row.awaitingAdminSectionReview}))}));
    return json(result.ok===false?500:200,result);
  }catch(e){console.error('[IGDC_PRODUCT_AUTO_ERROR]',String(e&&e.message||e).slice(0,180));
    return json(500,{ok:false,version:Pipeline.VERSION,error:String(e&&e.message||e)}); }
};
