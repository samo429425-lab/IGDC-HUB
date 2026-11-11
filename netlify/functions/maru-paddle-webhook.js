'use strict';
const p=require('./lib/maru-paddle-windows');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return p.response(405,{ok:false,error:'method_not_allowed'});
 if(!p.configured())return p.response(503,{ok:false,error:'paddle_not_ready'});
 if(!p.verifyWebhook(event))return p.response(401,{ok:false,error:'bad_signature'});
 let message;try{message=JSON.parse(p.getRawBody(event));}catch{return p.response(400,{ok:false,error:'invalid_json'});}
 const type=String(message.event_type||''); const record=message.data||{};
 try{
  if(type==='transaction.completed'){
   if(record.status!=='completed'||record.collection_mode!=='automatic')return p.response(200,{ok:true,ignored:'not_completed'});
   let user=p.sanitizeUserId(record.custom_data?.maru_user_id);
   const src=record.custom_data?.source;
   const items=record.items||[];
   if(items.length!==1||items[0]?.quantity!==1)return p.response(200,{ok:true,ignored:'invalid_item_count'});
   const plan=p.planFor(items[0]?.price?.id||items[0]?.price_id);
   if(!plan)return p.response(200,{ok:true,ignored:'unrecognized_price'});
   if(!/^txn_[a-z0-9]{26}$/.test(String(record.id||'')))return p.response(422,{ok:false,error:'invalid_transaction_id'});
   const sub=String(record.subscription_id||'');
   // Initial checkout has signed source/user/plan metadata. Renewal transactions may not;
   // recover the binding only from a previously verified subscription ID in our ledger.
   if(src==='maru_windows'){
     if(!user||plan!==record.custom_data?.maru_plan)return p.response(422,{ok:false,error:'price_plan_mismatch'});
   }else if(sub && plan!=='extra'){
     const owner=await p.rpc('maru_paddle_win_sub_owner',{p_subscription_id:sub});
     user=p.sanitizeUserId(owner);
     if(!user)return p.response(503,{ok:false,error:'unknown_subscription_owner'});
   }else return p.response(200,{ok:true,ignored:'not_maru_windows'});
   // First paid transaction may have no transaction billing_period: fetch canonical subscription.
   let expiry=plan==='extra'?null:(p.periodEnd(record)||p.periodEnd(items[0]));
   if(plan!=='extra' && sub && !expiry){
     const canonical=await p.paddleRequest('/subscriptions/'+encodeURIComponent(sub));
     if(canonical?.customer_id!==record.customer_id ||
       (canonical?.custom_data?.maru_user_id && canonical.custom_data.maru_user_id!==user))
       return p.response(422,{ok:false,error:'subscription_customer_mismatch'});
     expiry=p.periodEnd(canonical);
   }
   if(plan!=='extra' && (!sub||!expiry))return p.response(503,{ok:false,error:'billing_period_missing'});
   await p.rpc('maru_paddle_win_paid',{
    p_user_id:user,p_transaction_id:record.id,p_subscription_id:sub||null,
    p_plan:plan,p_units:p.CREDITS[plan],p_period_end:expiry,p_event_at:message.occurred_at||message.created_at
   });
  }else if(['subscription.created','subscription.updated','subscription.canceled','subscription.paused','subscription.resumed'].includes(type)){
   let user=p.sanitizeUserId(record.custom_data?.maru_user_id);
   if(record.custom_data?.source!=='maru_windows'||!user){
     const owner=record.id?await p.rpc('maru_paddle_win_sub_owner',{p_subscription_id:record.id}):'';
     user=p.sanitizeUserId(owner);
     if(!user)return p.response(200,{ok:true,ignored:'other_source'});
   }
   const at=message.occurred_at||message.created_at;
   if(!at||!record.id)return p.response(422,{ok:false,error:'invalid_subscription'});
   const status=String(record.status||'');
   await p.rpc('maru_paddle_win_sub_status',{
    p_user_id:user,p_subscription_id:record.id,p_status:status,p_event_at:at,
    p_period_end:p.periodEnd(record)||null
   });
  }else if(type.startsWith('adjustment.')) {
    // A completed refund/chargeback revokes unspent entitlements, idempotently.
    if(String(record.status||'')==='approved' && ['refund','chargeback'].includes(String(record.action||'')) && record.id && record.transaction_id){
      await p.rpc('maru_paddle_win_adjustment',{
        p_adjustment_id:record.id,p_transaction_id:record.transaction_id,
        p_amount:String(record.totals?.total||''),p_event_at:message.occurred_at||message.created_at
      });
    }
  }
  return p.response(200,{ok:true});
 }catch(e){return p.response(503,{ok:false,error:'ledger_unavailable'});}
};
