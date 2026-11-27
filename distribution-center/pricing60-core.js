'use strict';
// Private price-planning worksheet. No public price writes. KR tax rules only.
(function(root){
 const policy=typeof module!=='undefined'&&module.exports?require('./product-policy-core'):root.DCenterProductPolicy;
 const text=(v,max)=>{if(v==null)return '';if(typeof v!=='string'||v.length>max)throw Error('증빙 또는 입력 길이 확인');return v.trim();};
 function number(v,max=1e9,decimal=false){if(v==null||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||(!decimal&&!Number.isSafeInteger(v))||(decimal&&Math.abs(v*100-Math.round(v*100))>1e-7))throw Error('금액 또는 비율 입력 확인');return v;}
 function normalize(p={}){if(!p||typeof p!=='object'||Array.isArray(p))throw Error('가격 자료 확인');const o={};for(const k of ['cost','fulfillment','other','shipping','market','base'])o[k]=number(p[k]);o.fee=number(p.fee,100,true);o.margin=number(p.margin,99,true);o.discount=number(p.discount,99,true);o.tax=text(p.tax,10);if(o.tax&&!['standard','exempt','zero'].includes(o.tax))throw Error('세금 구분 확인');for(const k of ['cost_evidence','market_evidence','tax_evidence'])o[k]=text(p[k],500);o.market_date=text(p.market_date,10);if(o.market_date&&(!/^\d{4}-\d\d-\d\d$/.test(o.market_date)||!Number.isFinite(Date.parse(o.market_date))||new Date(o.market_date).toISOString().slice(0,10)!==o.market_date))throw Error('시장가 확인 날짜 오류');return o;}
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
 const api={normalize,quote};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DCenterPricing60=api;
})(typeof window==='undefined'?globalThis:window);
