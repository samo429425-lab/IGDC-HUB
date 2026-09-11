"use strict";

const Sync = require("./lib/revenue-provider-sync.v1");

exports.config = { schedule:"@hourly" };
function json(statusCode,body){ return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},body:JSON.stringify(body)}; }
exports.handler = async function(){
  try{
    const result=await Sync.run();
    return json(result.ok?200:207,result);
  }catch(error){ return json(500,{ok:false,version:Sync.VERSION,error:"revenue_provider_sync_failed",detail:String(error&&error.message||error)}); }
};
