"use strict";
/** Same-origin image inspection for a strictly allowlisted YouTube thumbnail. */
const VARIANTS=new Set(["maxresdefault","sddefault","hqdefault"]);
exports.handler=async function(event){
  const query=event&&event.queryStringParameters||{};
  const id=String(query.videoId||"");
  const variant=String(query.variant||"maxresdefault");
  if(event.httpMethod!=="GET"&&event.httpMethod!=="HEAD")return{statusCode:405,body:"Method not allowed"};
  if(!/^[A-Za-z0-9_-]{6,20}$/.test(id)||!VARIANTS.has(variant))return{statusCode:400,body:"Invalid thumbnail request"};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6500);
  try{
    const source="https://i.ytimg.com/vi/"+id+"/"+variant+".jpg";
    const response=await fetch(source,{signal:controller.signal,redirect:"error",headers:{Accept:"image/jpeg"}});
    if(!response.ok)return{statusCode:404,body:"Thumbnail unavailable"};
    const length=Number(response.headers.get("content-length")||0);
    if(length>5*1024*1024)return{statusCode:413,body:"Thumbnail too large"};
    if(!/^image\/jpeg(?:;|$)/i.test(response.headers.get("content-type")||""))return{statusCode:415,body:"Unsupported image"};
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length<4||bytes.length>5*1024*1024||bytes[0]!==255||bytes[1]!==216)return{statusCode:422,body:"Invalid JPEG"};
    return{statusCode:200,isBase64Encoded:true,headers:{"Content-Type":"image/jpeg","Cache-Control":"public, max-age=3600, s-maxage=21600","X-Content-Type-Options":"nosniff"},body:bytes.toString("base64")};
  }catch(_error){return{statusCode:502,body:"Thumbnail source unavailable"};}
  finally{clearTimeout(timeout);}
};
