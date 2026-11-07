"use strict";
const {buildCatalog}=require("./lib/igdc-amplify/catalog");
exports.handler=async()=>{const c=buildCatalog();return {statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex, nofollow"},body:JSON.stringify({ok:true,version:c.version,publicationReady:c.ready,reason:c.reason,releaseId:c.releaseId,counts:c.counts,sitemap:"https://igdcglobal.com/.netlify/functions/igdc-amplify-sitemap",indexedRecordsHash:c.hash})};};
