'use strict';
/* Windows-only Paddle Billing. Do not use for Android Google Play purchases. */
const crypto = require('crypto');
const PRICE_KEYS = Object.freeze({
 pro: 'MARU_PADDLE_PRICE_PRO', premium: 'MARU_PADDLE_PRICE_PREMIUM', extra: 'MARU_PADDLE_PRICE_EXTRA'
});
const CREDITS = Object.freeze({ pro: 400, premium: 1200, extra: 200 });
function configured() {
 return process.env.MARU_PADDLE_WINDOWS_ENABLED === '1' &&
   !!process.env.MARU_PADDLE_API_KEY && !!process.env.MARU_PADDLE_WEBHOOK_SECRET &&
   (process.env.MARU_PADDLE_SANDBOX === '1' ? String(process.env.MARU_PADDLE_API_KEY).includes('_sdbx') : !String(process.env.MARU_PADDLE_API_KEY).includes('_sdbx')) &&
   new RegExp(process.env.MARU_PADDLE_SANDBOX === '1' ? '^test_[a-z0-9_]+$' : '^live_[a-z0-9_]+$', 'i').test(String(process.env.MARU_PADDLE_CLIENT_TOKEN||'')) &&
   !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
   Object.values(PRICE_KEYS).every(k=>/^pri_[a-z0-9]{26}$/.test(String(process.env[k]||''))) &&
   /^https:\/\/[^/]+/.test(String(process.env.MARU_PADDLE_CHECKOUT_URL||''));
}
function priceFor(plan) { const key=PRICE_KEYS[plan]; return key && String(process.env[key]||''); }
function planFor(price) { return Object.keys(PRICE_KEYS).find(p=>priceFor(p)===price) || ''; }
function response(statusCode, payload) {return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin': 'https://igdcglobal.com','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'},body:JSON.stringify(payload)};}
async function paddleRequest(path, options={}) {
 const base=process.env.MARU_PADDLE_SANDBOX==='1'?'https://sandbox-api.paddle.com':'https://api.paddle.com';
 const res=await fetch(base+path,{...options,headers:{Authorization:`Bearer ${process.env.MARU_PADDLE_API_KEY}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})},redirect:'error'});
 const data=await res.json().catch(()=>null);
 if(!res.ok || !data || data.error) throw new Error(`paddle_http_${res.status}`);
 return data.data;
}
async function rpc(functionName,payload) {
 const url=new URL('/rest/v1/rpc/'+functionName,process.env.SUPABASE_URL);
 const res=await fetch(url,{method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error'});
 const result=await res.json().catch(()=>null);
 if(!res.ok) throw new Error(`paddle_ledger_http_${res.status}`);
 return result;
}
function getRawBody(event){return event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):String(event.body||'');}
function header(event,key) {return Object.entries(event.headers||{}).find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1]||'';}
function verifyWebhook(event, nowSeconds=Math.floor(Date.now()/1000)) {
 const signature=String(header(event,'paddle-signature'));
 const ts=/\bts=(\d+)\b/.exec(signature)?.[1];
 const h1s=[...signature.matchAll(/\bh1=([a-f0-9]{64})\b/gi)].map(m=>m[1]);
 if(!ts || !h1s.length || Math.abs(nowSeconds-Number(ts))>300) return false;
 const want=crypto.createHmac('sha256',String(process.env.MARU_PADDLE_WEBHOOK_SECRET||''))
   .update(`${ts}:${getRawBody(event)}`,'utf8').digest();
 return h1s.some(hex=>crypto.timingSafeEqual(Buffer.from(hex,'hex'),want));
}
function sanitizeUserId(value) {let s=String(value||'');return s.length>=3&&s.length<=160&&/^[a-zA-Z0-9|:_@.\-]+$/.test(s)?s:'';}
function periodEnd(record) {
 const raw=record?.billing_period?.ends_at || record?.current_billing_period?.ends_at;
 const ms=Date.parse(String(raw||''));
 return Number.isFinite(ms) && ms>Date.now()-86400000 ? new Date(ms).toISOString():'';
}
module.exports={configured,priceFor,planFor,CREDITS,response,paddleRequest,rpc,getRawBody,verifyWebhook,sanitizeUserId,periodEnd};
