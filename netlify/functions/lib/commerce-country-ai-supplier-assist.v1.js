'use strict';
/** Explicit administrator-only opt-in to ONE OpenAI query-suggestion request
 * per country. This does NOT recharge OpenAI/Google or create seller leads.
 */
const Budget=require('./commerce-country-paid-search-budget.v1');
const VERSION='igdc-country-optional-ai-search-phrases.v1';
const text=v=>v==null?'':String(v).trim();
function safeCountry(v){const country=text(v).toUpperCase();if(!/^[A-Z]{2}$/.test(country)||country==='KP')throw Object.assign(new Error('국가 코드가 올바르지 않습니다.'),{statusCode:400});return country;}
function configured(){return !!text(process.env.OPENAI_API_KEY);}
async function run(countryInput,approval){
  const country=safeCountry(countryInput);
  if(approval!==true)throw Object.assign(new Error('OpenAI 1회 추가 요청은 관리자가 직접 승인해야 합니다.'),{statusCode:403});
  const key=text(process.env.OPENAI_API_KEY);
  if(!key)throw Object.assign(new Error('OpenAI API 키가 설정되지 않았습니다.'),{statusCode:503});
  const claim=await Budget.reserveAi(country);
  if(!claim.allowed)throw Object.assign(new Error('해당 국가의 OpenAI 추가 1회 허용량이 이미 소진됐습니다.'),{statusCode:409});
  let called=false,status='failed_before_call',tokens=0;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
  try{
    const model=text(process.env.IGDC_COUNTRY_QUERY_MODEL)||'gpt-4o-mini';
    // One explicit external model request, never in the scheduled job.
    called=true;
    const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,temperature:0.1,max_tokens:220,response_format:{type:'json_object'},messages:[{role:'system',content:'Produce exactly 3 concise search phrases for locating verified REAL direct-selling manufacturers/cooperatives/retailers in the requested country. No invented URLs or entities. JSON: {"queries":["...","...","..."]}. Return ONLY JSON.'},{role:'user',content:JSON.stringify({country,focus:'official seller sites, payment, delivery, returns, customer support'})}]})});
    const payload=await response.json().catch(()=>({}));
    status=response.ok?'ok':'http_'+response.status;
    tokens=Math.max(0,Number(payload&&payload.usage&&payload.usage.total_tokens)||0);
    if(!response.ok)throw Object.assign(new Error('OpenAI 검색어 보강 요청 오류 HTTP '+response.status),{statusCode:502});
    let parsed={};try{parsed=JSON.parse(text(payload&&payload.choices&&payload.choices[0]&&payload.choices[0].message&&payload.choices[0].message.content));}catch(_e){}
    const queries=(Array.isArray(parsed.queries)?parsed.queries:[]).map(v=>text(v).replace(/\s+/g,' ').slice(0,300)).filter(v=>v&&!/https?:\/\//i.test(v)).slice(0,3);
    return{ok:true,version:VERSION,country,queries,tokens,oneTimeCall:true,automaticPaidSearch:false,automaticProductPublication:false,estimatedOpenAiCostUsd:null,actualOpenAiBalanceUsd:null};
  }catch(e){status=status==='failed_before_call'?'unknown_after_attempt':status;throw e;}
  finally{clearTimeout(timer);await Budget.settleAi(country,claim.token,{called,status,tokens});}
}
module.exports={VERSION,configured,run};
