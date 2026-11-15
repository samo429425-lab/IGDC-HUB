"use strict";
// Notify IndexNow and Naver only about actual changes. Receipt is not indexing.
const https=require("https");
const ORIGIN="https://igdcglobal.com";
const MAX_WAIT_MS=6500;
function safeUrl(value){
  try{
    const u=new URL(String(value||""));
    return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&!u.username&&!u.password&&!(u.hash)?u.href:"";
  }catch(_e){return "";}
}
function send(host,body){
  return new Promise(resolve=>{
    const data=JSON.stringify(body);
    let req,done=false;
    const timeout=setTimeout(()=>{if(req)req.destroy(new Error("request_timeout"));else finish({ok:false,error:"request_timeout"});},MAX_WAIT_MS);
    function finish(v){if(!done){done=true;clearTimeout(timeout);resolve(v);}}
    try{
      req=https.request({hostname:host,path:"/indexnow",method:"POST",headers:{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(data)}},res=>{
        let response="";
        res.on("data",v=>{if(response.length<300)response+=String(v).slice(0,300-response.length);});
        res.on("end",()=>finish({ok:res.statusCode===200||res.statusCode===202,statusCode:res.statusCode,receipt:res.statusCode===202?"pending-key-verification":"received",body:response}));
        res.on("error",e=>finish({ok:false,error:String(e.message||e).slice(0,120)}));
      });
      req.on("error",e=>finish({ok:false,error:String(e.message||e).slice(0,120)}));
      req.end(data);
    }catch(e){finish({ok:false,error:String(e.message||e).slice(0,120)});}
  });
}
async function submit(urls){
  const key=String(process.env.INDEXNOW_KEY||"").trim();
  if(!key)return{adapter:"indexnow",status:"disabled",reason:"INDEXNOW_KEY not configured; root key file must be verified"};
  if(!/^[a-zA-Z0-9-]{8,128}$/.test(key))return{adapter:"indexnow",status:"failed",reason:"INDEXNOW_KEY format is invalid"};
  const list=[...new Set((Array.isArray(urls)?urls:[]).map(safeUrl).filter(Boolean))].slice(0,10000);
  if(!list.length)return{adapter:"indexnow",status:"noop",count:0};
  const payload={host:"igdcglobal.com",key,keyLocation:ORIGIN+"/indexnow-key.txt",urlList:list};
  const replies=await Promise.all([send("api.indexnow.org",payload),send("searchadvisor.naver.com",payload)]);
  const engines=replies.map((r,i)=>({
    engine:i?"naver-indexnow":"indexnow-network",
    status:r.statusCode===200?"received":r.statusCode===202?"pending-verification":"failed",
    http:{ok:r.ok,statusCode:r.statusCode||null,receipt:r.receipt||null,error:r.error||null}
  }));
  const received=engines.filter(x=>x.status==="received").length;
  const pending=engines.filter(x=>x.status==="pending-verification").length;
  const failed=engines.length-received-pending;
  const status=failed?(received||pending?"partial-failure":"failed"):
    pending?"pending-verification":"submitted";
  return{adapter:"indexnow",status,count:list.length,acceptedProviders:received,
    pendingProviders:pending,failedProviders:failed,providers:engines,
    http:{ok:replies[0].ok,statusCode:replies[0].statusCode||null,receipt:replies[0].receipt||null}};
}
module.exports={submit};
