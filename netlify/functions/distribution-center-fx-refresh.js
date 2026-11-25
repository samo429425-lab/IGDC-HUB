'use strict';
const fx=require('./lib/distribution-center-fx');
exports.config={schedule:'@daily'};
exports.handler=async()=>{try{const data=await fx.sync();return {statusCode:200,body:JSON.stringify(data)};}catch{return {statusCode:503,body:JSON.stringify({error:'fx_refresh_failed'})};}};
