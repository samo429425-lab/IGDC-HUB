'use strict';
// Private verified candidate-to-PSOM worker; never triggers Front Match.
const Pipeline=require('./lib/commerce-country-private-psom-auto.v1');
exports.config={schedule:'*/3 * * * *'};
exports.handler=async function(){
  try{const result=await Pipeline.run();return{statusCode:result.ok?200:500,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(result)};}
  catch(e){return{statusCode:500,body:JSON.stringify({ok:false,error:String(e&&e.message||e)})};}
};
