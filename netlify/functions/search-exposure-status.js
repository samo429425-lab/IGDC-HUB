"use strict";
const {buildRegistry}=require("./lib/search-exposure/registry");
exports.handler=async()=>{const r=buildRegistry();return{statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},body:JSON.stringify({ok:true,version:r.version,generatedAt:r.generatedAt,hash:r.hash,counts:r.counts,total:r.targets.length,targets:r.targets.slice(0,50).map(x=>({kind:x.kind,id:x.id,title:x.title,url:x.url}))})};};
