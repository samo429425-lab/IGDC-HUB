"use strict";
exports.handler=async event=>{
 const method=String(event&&event.httpMethod||"GET").toUpperCase();
 const headers={"content-type":"text/plain; charset=utf-8","cache-control":"public,max-age=300","x-content-type-options":"nosniff","x-robots-tag":"noindex"};
 if(method!=="GET"&&method!=="HEAD")return{statusCode:405,headers,body:"Method not allowed"};
 const key=String(process.env.INDEXNOW_KEY||"").trim();
 if(!/^[a-z0-9-]{8,128}$/i.test(key))return{statusCode:503,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex"},body:"IndexNow key is not configured"};
 return{statusCode:200,headers,body:method==="HEAD"?"":key};
};
