"use strict";
// Optional Baidu Search Resource Platform submission, never active without a verified-site token.
// Baidu is not an IndexNow recipient; its API accepts newline-delimited site URLs.
const https=require("https");
const SITE="https://igdcglobal.com";
const MAX_WAIT_MS=6500;
function owned(value){
  try{const u=new URL(String(value||""));return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&!u.username&&!u.password&&!u.hash?u.href:"";}catch(_e){return "";}
}
async function submit(urls){
  const token=String(process.env.BAIDU_SITE_TOKEN||"").trim();
  if(!token)return{adapter:"baidu",status:"disabled",reason:"Baidu verified-site API token not configured"};
  if(!/^[a-zA-Z0-9_-]{8,150}$/.test(token))return{adapter:"baidu",status:"failed",reason:"Baidu token format invalid"};
  const list=[...new Set((Array.isArray(urls)?urls:[]).map(owned).filter(Boolean))].slice(0,2000);
  if(!list.length)return{adapter:"baidu",status:"noop",count:0};
  const data=list.join("\n");
  const http=await new Promise(resolve=>{
    let req,done=false;
    const timer=setTimeout(()=>{if(req)req.destroy(new Error("request_timeout"));else finish({ok:false,error:"request_timeout"});},MAX_WAIT_MS);
    function finish(v){if(!done){done=true;clearTimeout(timer);resolve(v);}}
    try{
      req=https.request({hostname:"data.zz.baidu.com",path:"/urls?site=igdcglobal.com&token="+encodeURIComponent(token),method:"POST",headers:{"content-type":"text/plain; charset=utf-8","content-length":Buffer.byteLength(data)}},res=>{
        let body="";
        res.on("data",v=>{if(body.length<700)body+=String(v).slice(0,700-body.length);});
        res.on("end",()=>{
          let answer={};
          try{answer=JSON.parse(body);}catch(_e){}
          const count=Number(answer.success);
          const accepted=Number.isFinite(count)?Math.max(0,Math.min(list.length,count)):0;
          finish({ok:res.statusCode===200&&accepted>0,accepted,statusCode:res.statusCode,quotaRemaining:Number.isFinite(Number(answer.remain))?Number(answer.remain):null,errorCode:answer.error||answer.error_code||null});
        });
        res.on("error",e=>finish({ok:false,error:String(e.message||e).slice(0,120)}));
      });
      req.on("error",e=>finish({ok:false,error:String(e.message||e).slice(0,120)}));
      req.end(data);
    }catch(e){finish({ok:false,error:String(e.message||e).slice(0,120)});}
  });
  const status=http.ok?(http.accepted===list.length?"submitted":"partial-failure"):"failed";
  return{adapter:"baidu",status,count:list.length,http};
}
module.exports={submit};
