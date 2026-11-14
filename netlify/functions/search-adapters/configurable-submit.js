"use strict";
const https=require("https");
const SITE="https://igdcglobal.com";
const MAX_WAIT_MS=6500;
function safeEndpoint(value){
  try{
    const u=new URL(String(value||""));
    const host=u.hostname.toLowerCase();
    if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443"))return null;
    if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host==="::1"||host==="[::1]"||/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host))return null;
    return u;
  }catch(_e){return null;}
}
function siteUrl(value){
  try{const u=new URL(String(value||""));return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&u.username===""&&u.password===""?u.href:"";}catch(_e){return "";}
}
function requestJson(endpoint,token,payload){
  return new Promise(resolve=>{
    const data=JSON.stringify(payload);
    let finished=false;
    function finish(v){if(!finished){finished=true;resolve(v);}}
    const req=https.request({hostname:endpoint.hostname,port:endpoint.port||443,path:endpoint.pathname+endpoint.search,method:"POST",headers:{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(data),...(token?{"authorization":"Bearer "+token}:{})}},res=>{
      let response="";
      res.on("data",part=>{if(response.length<500)response+=String(part).slice(0,500-response.length);});
      res.on("end",()=>finish({ok:res.statusCode>=200&&res.statusCode<300,statusCode:res.statusCode,body:response.slice(0,500)}));
      res.on("error",e=>finish({ok:false,error:String(e.message||e)}));
    });
    req.setTimeout(MAX_WAIT_MS,()=>req.destroy(new Error("search_adapter_timeout")));
    req.on("error",e=>finish({ok:false,error:String(e.message||e)}));
    req.end(data);
  });
}
async function submit(name,prefix,urls){
  const target=String(process.env[prefix+"_SUBMIT_ENDPOINT"]||"").trim();
  if(!target)return{adapter:name,status:"sitemap-managed",reason:prefix+"_SUBMIT_ENDPOINT not configured",sitemap:SITE+"/sitemap-global.xml"};
  const endpoint=safeEndpoint(target);
  if(!endpoint)return{adapter:name,status:"failed",reason:"Invalid HTTPS submission endpoint"};
  const token=String(process.env[prefix+"_SUBMIT_TOKEN"]||"").trim();
  const list=[...new Set((Array.isArray(urls)?urls:[]).map(siteUrl).filter(Boolean))].slice(0,5000);
  if(!list.length)return{adapter:name,status:"noop",count:0};
  const r=await requestJson(endpoint,token,{site:SITE,sitemap:SITE+"/sitemap-global.xml",urls:list});
  return{adapter:name,status:r.ok?"submitted":"failed",count:list.length,http:r};
}
module.exports={submit};
