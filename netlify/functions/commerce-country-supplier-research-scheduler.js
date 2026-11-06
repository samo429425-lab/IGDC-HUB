'use strict';
// Scheduled function performs checkpointed supplier research steps, not entire
// long research cycles in one 30-second invocation.
const Staged = require('./lib/commerce-country-auto-supplier-pipeline.v1');
exports.config={schedule:'* * * * *'};
exports.handler=async function(){
  try{const result=await Staged.run();return{statusCode:result.ok?200:500,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(result)};}
  catch(e){return{statusCode:500,body:JSON.stringify({ok:false,error:String(e&&e.message||e)})};}
};
