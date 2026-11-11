'use strict';
exports.handler=async event=>{
 if(event.httpMethod!=='GET')return {statusCode:405,body:'Method not allowed'};
 const {configured}=require('./lib/maru-paddle-windows');
 const on=configured(),sandbox=process.env.MARU_PADDLE_SANDBOX==='1';
 const payload=on?{ok:true,token:String(process.env.MARU_PADDLE_CLIENT_TOKEN),environment:sandbox?'sandbox':'production'}:{ok:false,error:'Payment service is not ready'};
 return {statusCode:on?200:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(payload)};
};
