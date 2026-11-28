'use strict';
// Private price-planning worksheet. No public price writes. KR tax rules only.
(function(root){
 const policy=typeof module!=='undefined'&&module.exports?require('./product-policy-core'):root.DCenterProductPolicy;
 const text=(v,max)=>{if(v==null)return '';if(typeof v!=='string'||v.length>max)throw Error('증빙 또는 입력 길이 확인');return v.trim();};
 function number(v,max=1e9,decimal=false){if(v==null||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||(!decimal&&!Number.isSafeInteger(v))||(decimal&&Math.abs(v*100-Math.round(v*100))>1e-7))throw Error('금액 또는 비율 입력 확인');return v;}
 function normalize(p={}){if(!p||typeof p!=='object'||Array.isArray(p))throw Error('가격 자료 확인');const o={};for(const k of ['cost','fulfillment','other','shipping','market','base'])o[k]=number(p[k]);o.fee=number(p.fee,100,true);o.margin=number(p.margin,99,true);o.discount=number(p.discount,99,true);o.tax=text(p.tax,10);if(o.tax&&!['standard','exempt','zero'].includes(o.tax))throw Error('세금 구분 확인');for(const k of ['cost_evidence','market_evidence','tax_evidence'])o[k]=text(p[k],500);o.market_date=text(p.market_date,10);if(o.market_date&&(!/^\d{4}-\d\d-\d\d$/.test(o.market_date)||!Number.isFinite(Date.parse(o.market_date))||new Date(o.market_date).toISOString().slice(0,10)!==o.market_date))throw Error('시장가 확인 날짜 오류');o.channel_fees={};if(p.channel_fees!=null){if(typeof p.channel_fees!=='object'||Array.isArray(p.channel_fees))throw Error('채널별 수수료 확인');for(const [k,v] of Object.entries(p.channel_fees)){if(!channels.includes(k))throw Error('판매 채널 확인');const fee=number(v,100,true);if(fee!==null)o.channel_fees[k]=fee;}}return o;}
 const channels=['쿠팡','G마켓','옥션','당근','기타'];
 const today=(now)=>new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
 function quote(raw,country,now=new Date()){
  const p=normalize(raw),reasons=[];if(country!=='KR')return {ready:false,reasons:['현재 한국 가격·세금 정책만 지원'],p};
  if(['cost','fulfillment','other','shipping','fee','margin','discount','market'].some(k=>p[k]===null)||!p.tax)reasons.push('매입가·비용·수수료·시장가·목표 마진 입력 필요');
  if(!p.cost_evidence||p.cost===0&&p.cost_evidence.length<10)reasons.push('실제 매입가 증빙 필요');if(!p.market_evidence||!p.market_date||p.market<=0)reasons.push('동일 상품 시장가 출처·확인일 필요');
  if(p.market_date){const d=(Date.parse(today(now))-Date.parse(p.market_date))/86400000;if(d<0||d>7)reasons.push('시장가격 7일 이내 재확인 필요');}
  if(p.tax&&p.tax!=='standard'&&!p.tax_evidence)reasons.push('면세·영세율 근거 필요');if(reasons.length)return {ready:false,reasons,p};
  let min;try{min=policy.targetPrice({cost:p.cost,fulfillment:p.fulfillment,other:p.other,shipping:p.shipping,fee:p.fee,margin:p.margin,tax:p.tax});}catch(e){return {ready:false,reasons:[e.message],p};}
  const ceiling=Math.floor(p.market*(1-p.discount/100)),minTotal=min.price+p.shipping;
  const calc=base=>{const tax=p.tax==='standard'?Math.round(base/10):0,total=base+tax+p.shipping,fee=Math.ceil(total*p.fee/100),expenses=p.cost+p.fulfillment+p.other+fee,profit=base-expenses;return {base,tax,total,fee,expenses,profit,margin:base>0?profit/base*100:null,markup:expenses>0?profit/expenses*100:null,discount:(p.market-total)/p.market*100};};
  // Choose near the requested discount, not an unnecessary price race to the bottom.
  let lo=0,hi=Math.min(1e9,Math.max(0,ceiling-p.shipping));while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(calc(mid).total<=ceiling)lo=mid;else hi=mid-1;}
  const recommendation=minTotal<=ceiling?Math.max(min.base,lo):min.base;
  const q=calc(p.base??recommendation);if(minTotal>ceiling)reasons.push('현재 공급가로 목표 마진과 시장가 경쟁력 동시 달성 불가');if(q.profit<=0||q.margin<p.margin-1e-8)reasons.push('역마진 또는 목표 순마진 미달');if(q.total>ceiling)reasons.push('목표 시장 할인율 미달');if(q.base>1e9)reasons.push('가격 범위 초과');return {...q,p,ready:!reasons.length,reasons,recommended:recommendation,minimum_total:minTotal,ceiling};
 }
 function estimate(raw,country,now=new Date()){
  const p=normalize(raw),q=quote(p,country,now);if(q.base!=null||country!=='KR')return q;
  if(['cost','fulfillment','other','shipping','fee','margin'].some(k=>p[k]===null)||!p.tax||!p.cost_evidence||p.cost===0&&p.cost_evidence.length<10||p.tax!=='standard'&&!p.tax_evidence)return q;
  try{const x=policy.targetPrice(p),total=x.price+p.shipping,expenses=p.cost+p.fulfillment+p.other+x.fee;return {...q,base:x.base,tax:x.tax,total,fee:x.fee,expenses,profit:x.profit,margin:x.margin,markup:expenses>0?x.profit/expenses*100:null,discount:null,provisional:true};}catch(e){return {...q,reasons:[...q.reasons,e.message]};}
 }
 function channelQuotes(raw,country,now=new Date()){const p=normalize(raw),out={};for(const [channel,fee] of Object.entries(p.channel_fees)){let base=null;try{if(country==='KR'&&p.cost_evidence)base=policy.targetPrice({...p,fee}).base;}catch{}out[channel]=estimate({...p,fee,base},country,now);}return out;}
 function applyPolicy(raw,row,settings){const p=normalize(raw);if(!settings||row?.pinned||row?.sourcing?.mode!==settings.mode)throw Error('판매 방식 불일치 또는 고정 상품');for(const k of ['fulfillment','other','shipping','fee','margin','discount','tax','tax_evidence'])if(settings[k]!==undefined)p[k]=settings[k];if(settings.channel_fees!==undefined)p.channel_fees={...p.channel_fees,...settings.channel_fees};for(const [k,r] of [['fulfillment','fulfillment_rate'],['other','other_rate']])if(settings[r]!==undefined){if(p.cost===null||!p.cost_evidence)throw Error('공급가 확인 후 비율 비용 적용');const rate=number(settings[r],100,true);p[k]=Math.ceil(p.cost*rate/100);}if(row.sourcing?.fee_bps!=null&&p.fee!=null&&row.sourcing.fee_bps!==Math.round(p.fee*100))throw Error('저장된 판매 방식 수수료와 불일치 · 조달 조건 먼저 수정');if(settings.useReferenceMarket===true&&!p.market){const r=row.record?.retail;if(!row.record?.identity_review&&!row.record?.variant_conflict&&r?.currency==='KRW'&&Number.isSafeInteger(r.value)&&r.value>0){p.market=r.value;p.market_evidence='관리자 동일규격·배송 포함 가격 확인: '+String(row.record.source_url||'').slice(0,420);p.market_date=settings.market_date;}}
  p.base=null;return normalize(p);
 }
 // Explicitly confirmed supplier quote file, exact saved ID or exact source + model; never infer cost from retail.
 function importSupplier(raw,rows){if(!Array.isArray(raw)||raw.length>500)throw Error('공급 자료는 1~500행 JSON 배열');const out=new Map();for(const v of raw){if(!v||typeof v!=='object'||typeof v.id!=='string'||!v.id||out.has(v.id)||!rows.some(r=>r.id===v.id))throw Error('저장 상품 ID 불일치 또는 중복');if(v.currency!=='KRW'||v.confirmed!==true)throw Error('KRW 및 실제 공급가 확인 표시 필요');const cost=number(v.cost),evidence=text(v.evidence,500);if(cost===null||!evidence||cost===0&&evidence.length<10)throw Error('실제 공급가와 증빙 필요');out.set(v.id,{cost,cost_evidence:evidence});}return out;}
 const api={normalize,quote,estimate,channelQuotes,applyPolicy,importSupplier,channels};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DCenterPricing60=api;
})(typeof window==='undefined'?globalThis:window);
