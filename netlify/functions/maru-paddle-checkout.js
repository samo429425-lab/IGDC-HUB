'use strict';
const p=require('./lib/maru-paddle-windows');
const {verifyMember,accessErrorResponse}=require('./lib/maru-ai-access-control');
exports.handler=async(event)=>{
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:p.response(200,{}).headers,body:''};
 if(event.httpMethod!=='POST')return p.response(405,{ok:false,error:'method_not_allowed'});
 if(!p.configured())return p.response(503,{ok:false,error:'paddle_not_ready'});
 try{
  const member=await verifyMember(event);
  const userId=p.sanitizeUserId(member.userId);
  if(!userId) return p.response(403,{ok:false,error:'member_unbound'});
  let body={};try{body=JSON.parse(event.body||'{}');}catch{return p.response(400,{ok:false,error:'invalid_body'});}
  const plan=String(body.plan||''); const price=p.priceFor(plan);
  if(!price)return p.response(400,{ok:false,error:'unknown_plan'});
  const existing=await p.rpc('maru_paddle_win_balance',{p_user_id:userId});
  // Avoid duplicate monthly subscriptions; offer the authenticated portal for changes.
  if(plan!=='extra' && existing?.active===true)
    return p.response(409,{ok:false,error:'subscription_already_active'});
  if(plan==='extra' && existing?.active!==true)
    return p.response(409,{ok:false,error:'active_subscription_required'});

  // Paddle alone determines prices and tax. Never accept amount or user ID from browser.
  const checkoutUrl=new URL(process.env.MARU_PADDLE_CHECKOUT_URL);
  if(checkoutUrl.protocol!=='https:')return p.response(503,{ok:false,error:'checkout_domain_invalid'});
  const order=await p.paddleRequest('/transactions',{method:'POST',body:JSON.stringify({
   items:[{price_id:price,quantity:1}],collection_mode:'automatic',
   checkout:{url:checkoutUrl.toString()},
   custom_data:{maru_user_id:userId,maru_plan:plan,source:'maru_windows'}
  })});
  const url=order?.checkout?.url;
  if(!url || new URL(url).protocol!=='https:') throw new Error('paddle_checkout_missing');
  return p.response(200,{ok:true,url,transactionId:order.id});
 }catch(e){const e2=accessErrorResponse(e);return p.response(e2.statusCode||503,{ok:false,error:e2.statusCode<500?e2.code:'checkout_unavailable'});}
};
