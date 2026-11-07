"use strict";
const {buildCatalog,findProducts}=require("./lib/igdc-amplify/catalog");
function json(code,body){return{statusCode:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public,max-age=0,s-maxage=10,must-revalidate","x-robots-tag":"noindex, nofollow","x-content-type-options":"nosniff"},body:JSON.stringify(body)};}
exports.handler=async(event)=>{
  const q=event&&event.queryStringParameters||{},query=String(q.q||"").trim(),country=String(q.country||"").trim().toUpperCase();
  if(query.length>120)return json(400,{ok:false,error:"QUERY_TOO_LONG"});
  if(country&&!/^[A-Z]{2}$/.test(country))return json(400,{ok:false,error:"INVALID_COUNTRY"});
  const limit=Math.max(1,Math.min(40,Number.parseInt(q.limit,10)||20)),offset=Math.max(0,Math.min(2000,Number.parseInt(q.offset,10)||0));
  const c=buildCatalog(),res=findProducts(c,query,country,limit,offset);
  return json(200,{ok:true,version:c.version,publicationReady:c.ready,releaseId:c.releaseId,query,country,limit,offset,total:res.total,
    items:res.items.map(x=>({id:x.id,productName:x.productName,title:x.title,description:x.description,brand:x.brand,manufacturer:x.maker,
      seller:x.seller,category:x.category,model:x.model,image:x.image,url:x.url,markets:x.markets,price:x.price,currency:x.currency}))});
};
