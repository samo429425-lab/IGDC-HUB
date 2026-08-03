"use strict";
const Selector=require("./regional-brokerage-autoselector");
function json(statusCode,payload){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","vary":"x-nf-geo, cf-ipcountry, x-country, x-region"},body:JSON.stringify(payload)}}
exports.handler=async function(event){
  try{
    const p=(event&&event.queryStringParameters)||{};
    if(String(p.hub||"distribution").toLowerCase()!=="distribution")return json(400,{status:"blocked",code:"DISTRIBUTION_HUB_ONLY"});
    // Public snapshot reads are cache/snapshot only. Query parameters may not
    // enable private collection, live supplier discovery, or OpenAI localization.
    const safeParams=Object.assign({},p,{privateCollection:false,noLiveDiscovery:true});
    const result=await Selector.runSelection(event,safeParams);
    if(!result.snapshot)return json(204,{status:"empty",engine:Selector.VERSION,meta:result.meta,geo:result.geo});
    return json(200,result.snapshot);
  }catch(e){return json(200,{status:"fallback",engine:Selector.VERSION,error:String(e&&e.message||e)});}
};
