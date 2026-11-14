"use strict";
const https=require("https");
const SITE="https://igdcglobal.com";
const MAX_WAIT_MS=6500;
function localUrl(value){
  try{const u=new URL(String(value||""));return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&u.username===""&&u.password===""?u.href:"";}catch(_e){return "";}
}
function postJson(body){
  return new Promise(resolve=>{
    const data=JSON.stringify(body);
    let finished=false;
    function finish(value){if(!finished){finished=true;resolve(value);}}
    const req=https.request({hostname:"api.indexnow.org",path:"/indexnow",method:"POST",headers:{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(data)}},res=>{
      let response="";
      res.on("data",chunk=>{if(response.length<500)response+=String(chunk).slice(0,500-response.length);});
      res.on("end",()=>finish({ok:res.statusCode>=200&&res.statusCode<300,statusCode:res.statusCode,body:response.slice(0,500)}));
      res.on("error",e=>finish({ok:false,error:String(e.message||e)}));
    });
    req.setTimeout(MAX_WAIT_MS,()=>req.destroy(new Error("indexnow_timeout")));
    req.on("error",e=>finish({ok:false,error:String(e.message||e)}));
    req.end(data);
  });
}
async function submit(urls){
  const key=String(process.env.INDEXNOW_KEY||"").trim();
  if(!key)return{adapter:"indexnow",status:"disabled",reason:"INDEXNOW_KEY missing"};
  const list=[...new Set((Array.isArray(urls)?urls:[]).map(localUrl).filter(Boolean))].slice(0,10000);
  if(!list.length)return{adapter:"indexnow",status:"noop",count:0};
  const r=await postJson({host:"igdcglobal.com",key,keyLocation:SITE+"/"+encodeURIComponent(key)+".txt",urlList:list});
  return{adapter:"indexnow",status:r.ok?"submitted":"failed",count:list.length,http:r};
}
module.exports={submit};
