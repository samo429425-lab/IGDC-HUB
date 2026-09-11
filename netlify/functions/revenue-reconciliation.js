"use strict";
const Reconcile=require("./lib/revenue-reconciliation.v1");
exports.config={schedule:"@daily"};
function json(code,body){return{statusCode:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, private"},body:JSON.stringify(body)};}
exports.handler=async function(){
  try{const result=await Reconcile.run();return json(result.ok?200:409,result);}catch(error){return json(500,{ok:false,version:Reconcile.VERSION,error:"reconciliation_failed",detail:String(error&&error.message||error)});}
};
