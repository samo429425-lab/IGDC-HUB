"use strict";
// Only explicitly configured HTTPS search submission endpoints are contacted.
const https=require("https");
const SITE="https://igdcglobal.com";
const MAX_WAIT_MS=6500;
function safeEndpoint(value){
  try{
    const u=new URL(String(value||"")),host=u.hostname.toLowerCase();
    if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443"))return null;
    if(!/^[a-z0-9.-]+$/.test(host)||!host.includes(".")||host.endsWith(".")||host.endsWith(".local")||host.endsWith(".internal")||host.endsWith(".localhost")||host.endsWith(".test")||host.endsWith(".invalid"))return null;
    if(/^[0-9.]+$/.test(host)||host==="localhost"||host==="0.0.0.0"||host.startsWith("169.254."))return null;
    const allowed=String(process.env.SEARCH_SUBMIT_ALLOWED_HOSTS||"").toLowerCase().split(",").map(x=>x.trim()).filter(Boolean);
    if(allowed.length&&!allowed.includes(host))return null;
    return u;
  }catch(_e){return null;}
}
function ownUrl(value){
  try{const u=new URL(String(value||""));return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&!u.username&&!u.password&&!u.hash?u.href:"";}catch(_e){return "";}
}
function requestJson(endpoint,token,payload){
  return new Promise(resolve=>{
    const data=JSON.stringify(payload);
    let done=false,req;
    const timer=setTimeout(()=>{if(req)req.destroy(new Error("request_timeout"));else finish({ok:false,error:"request_timeout"});},MAX_WAIT_MS);
    function finish(v){if(!done){done=true;clearTimeout(timer);resolve(v);}}
    try{
      req=https.request({hostname:endpoint.hostname,port:endpoint.port||443,path:endpoint.pathname+endpoint.search,method:"POST",headers:{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(data),...(token?{"authorization":"Bearer "+token}:{})}},res=>{
        let body="";
        res.on("data",part=>{if(body.length<300)body+=String(part).slice(0,300-body.length);});
        res.on("end",()=>finish({ok:res.statusCode===200||res.statusCode===202,statusCode:res.statusCode,body:body.slice(0,300)}));
        res.on("error",e=>finish({ok:false,error:String(e.message||e).slice(0,120)}));
      });
      req.on("error",e=>finish({ok:false,error:String(e.message||e).slice(0,120)}));
      req.end(data);
    }catch(e){finish({ok:false,error:String(e.message||e).slice(0,120)});}
  });
}
async function submit(name,prefix,urls){
  const target=String(process.env[prefix+"_SUBMIT_ENDPOINT"]||"").trim();
  if(!target)return{adapter:name,status:"sitemap-managed",reason:prefix+"_SUBMIT_ENDPOINT not configured",sitemap:SITE+"/sitemap-global.xml"};
  const endpoint=safeEndpoint(target);
  if(!endpoint)return{adapter:name,status:"failed",reason:"Endpoint must be a permitted public HTTPS hostname"};
  const list=[...new Set((Array.isArray(urls)?urls:[]).map(ownUrl).filter(Boolean))].slice(0,5000);
  if(!list.length)return{adapter:name,status:"noop",count:0};
  const token=String(process.env[prefix+"_SUBMIT_TOKEN"]||"").trim();
  const http=await requestJson(endpoint,token,{site:SITE,sitemap:SITE+"/sitemap-global.xml",urls:list});
  return{adapter:name,status:http.ok?"submitted":"failed",count:list.length,http};
}
module.exports={submit};
