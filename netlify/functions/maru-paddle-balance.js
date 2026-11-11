'use strict';
const p=require('./lib/maru-paddle-windows');
const {verifyMember,accessErrorResponse}=require('./lib/maru-ai-access-control');
exports.handler=async(event)=>{
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:p.response(200,{}).headers,body:''};
 if(event.httpMethod!=='POST')return p.response(405,{ok:false,error:'method_not_allowed'});
 if(!p.configured())return p.response(503,{ok:false,error:'paddle_not_ready'});
 try{
  const member=await verifyMember(event);
  const result=await p.rpc('maru_paddle_win_balance',{p_user_id:member.userId});
  return p.response(200,{ok:true,...result});
 }catch(e){const x=accessErrorResponse(e);return p.response(x.statusCode||503,{ok:false,error:x.statusCode<500?x.code:'balance_unavailable'});}
};
