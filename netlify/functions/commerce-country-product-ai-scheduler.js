'use strict';
const Pipeline = require('./lib/commerce-country-auto-product-pipeline.v1');
function json(code, data) { return { statusCode:code, headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}, body:JSON.stringify(data) }; }
// Bounded, checkpointed continuation of supplier discovery; does not touch
// the manually operated country/IP selector or invoke Front Match.
exports.config = { schedule:'7,22,37,52 * * * *' };
exports.handler = async function () {
  try { return json(200, await Pipeline.run()); }
  catch (e) { return json(500, {ok:false,version:Pipeline.VERSION,error:String(e&&e.message||e)}); }
};
