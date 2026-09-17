"use strict";

/*
 * Donation Global News scheduler
 * - Global News only
 * - Daily
 * - Researches current humanitarian videos, publishes valid candidates through
 *   the existing Donation -> SearchBank exact-ingest path.
 * - The seven organization lanes are never touched by this scheduler.
 */
const CandidateAdmin = require("./donation-candidate-admin");

function json(statusCode,body){
  return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0"},body:JSON.stringify(body)};
}

/* 02:15 UTC = 11:15 KST, Daily. */
exports.config = { schedule:"15 2 * * *" };

exports.handler = async function(event){
  try{
    if(!CandidateAdmin || typeof CandidateAdmin.runScheduledGlobalNewsRefresh!=="function") throw new Error("donation_global_scheduler_pipeline_unavailable");
    const result=await CandidateAdmin.runScheduledGlobalNewsRefresh(event||{},{limit:50});
    return json(200,result);
  }catch(error){
    return json(500,{ok:false,scope:"donation-global",error:String(error&&error.message||error)});
  }
};
