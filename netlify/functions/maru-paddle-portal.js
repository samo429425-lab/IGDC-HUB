'use strict';
/* Short-lived, server-bound Paddle customer portal link for the signed-in Windows user. */
const p=require('./lib/maru-paddle-windows');
const {verifyMember,accessErrorResponse}=require('./lib/maru-ai-access-control');
exports.handler=async(event)=>{
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:p.response(200,{}).headers,body:''};
 if(event.httpMethod!=='POST')return p.response(405,{ok:false,error:'method_not_allowed'});
 if(!p.configured())return p.response(503,{ok:false,error:'paddle_not_ready'});
 try{
  const member=await verifyMember(event);
  const balance=await p.rpc('maru_paddle_win_balance',{p_user_id:member.userId});
  const sub=String(balance?.subscription_id||'');
  if(!/^sub_[a-z0-9]{26}$/.test(sub))return p.response(404,{ok:false,error:'subscription_not_found'});
  const detail=await p.paddleRequest(`/subscriptions/${encodeURIComponent(sub)}`);
  const customer=String(detail?.customer_id||'');
  // Defense in depth: Paddle subscription and our verified Auth0 binding must agree.
  if(!/^ctm_[a-z0-9]{26}$/.test(customer)||String(detail?.custom_data?.maru_user_id||'')!==member.userId)
    return p.response(403,{ok:false,error:'subscription_binding_mismatch'});
  const portal=await p.paddleRequest(`/customers/${encodeURIComponent(customer)}/portal-sessions`,{
    method:'POST',body:JSON.stringify({subscription_ids:[sub]})
  });
  const url=portal?.urls?.subscriptions?.find(s=>s.id===sub)?.view_subscription||portal?.urls?.general?.overview||'';
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.hostname!=='customer-portal.paddle.com')throw Error('invalid_portal_url');
  return p.response(200,{ok:true,url});
 }catch(e){const result=accessErrorResponse(e);return p.response(result.statusCode<500?result.statusCode:503,{ok:false,error:result.statusCode<500?result.code:'portal_unavailable'});}
};
