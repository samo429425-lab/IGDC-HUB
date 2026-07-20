"use strict";
const Automation = require("./lib/commerce-country-automation.v1");
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0"},body:JSON.stringify(body)};}
exports.config={schedule:"@hourly"};
exports.handler=async function(event){
  try{return json(200,await Automation.schedulerRun(event||{}));}
  catch(error){return json(500,{ok:false,version:Automation.VERSION,error:String(error&&error.message||error)});}
};
