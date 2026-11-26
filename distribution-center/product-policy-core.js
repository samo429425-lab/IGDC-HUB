'use strict';
(function(root){
 const category=typeof module!=='undefined'&&module.exports?require('./category-core'):root.DCenterCategory;
 const channels=['IGDC','쿠팡','G마켓','옥션','당근','기타'];
 const keys=['price','stock','title','image','description'];
 const fail=()=>{throw Error('상품 확장 정보의 형식 또는 범위를 확인하세요.');};
 const text=(v,n)=>{if(typeof v!=='string'||v.length>n)fail();return v.trim();};
 const integer=(v,max)=>{if(!Number.isSafeInteger(v)||v<0||v>max)fail();return v;};
 const obj=v=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v;};
 function url(v,local=false){if(!v)return '';if(local&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)&&v.length<=2800000)return v;const u=new URL(text(v,2048));if(u.protocol!=='https:'||u.username||u.password)fail();return u.href;}
 function optionalMoney(v){return v===undefined||v===null||v===''?null:integer(v,1e9);}
 const modes=['agency','dropship','direct'];
 function sourcing(v={}){const x=obj(v),mode=x.mode??'';if(mode!==''&&!modes.includes(mode))fail();if(!mode)return null;
  const out={mode,evidence:text(x.evidence??'',500),fulfillment:text(x.fulfillment??'',200),returns:text(x.returns??'',200),valid_until:text(x.valid_until??'',10),fee_bps:x.fee_bps==null?null:integer(x.fee_bps,10000),permission:x.permission??false};
  if(typeof out.permission!=='boolean')fail();if(out.valid_until){if(!/^\d{4}-\d{2}-\d{2}$/.test(out.valid_until))fail();const d=new Date(out.valid_until+'T00:00:00Z');if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==out.valid_until)fail();}return out;}
 function normalize(input={},local=false){const x=obj(input),o={sku:text(x.sku??'',80),barcode:text(x.barcode??'',32),origin:text(x.origin??'',100),notice:text(x.notice??'',2000),shipping_ref:text(x.shipping_ref??'',500),return_ref:text(x.return_ref??'',500),original_image:url(x.original_image??'',local),original_description:text(x.original_description??'',12000),fulfillment_cost:optionalMoney(x.fulfillment_cost),other_sale_cost:optionalMoney(x.other_sale_cost),zero_cost_evidence:text(x.zero_cost_evidence??'',500),images:[],video:url(x.video??''),video_poster:url(x.video_poster??''),variants:[],locks:{},channels:{},categories:category.normalize(x.categories??{})};
 if(x.images!==undefined&&!Array.isArray(x.images))fail();if((x.images||[]).length>5)fail();o.images=[...new Set((x.images||[]).map(v=>url(v)).filter(Boolean))];
 if(x.variants!==undefined&&!Array.isArray(x.variants))fail();if((x.variants||[]).length>30)fail();const seen=new Set();for(const v of x.variants||[]){obj(v);const sku=text(v.sku,80),name=text(v.name,100);if(!sku||!name||seen.has(sku.toLowerCase())||typeof v.enabled!=='boolean')fail();seen.add(sku.toLowerCase());o.variants.push({sku,name,base:integer(v.base,1e9),stock:integer(v.stock,1e6),enabled:v.enabled});}
 const locks=obj(x.locks??{});for(const k of keys){if(locks[k]!==undefined&&typeof locks[k]!=='boolean')fail();o.locks[k]=locks[k]??false;}
 const policies=obj(x.channels??{});for(const [k,p] of Object.entries(policies)){if(!channels.includes(k)||k==='IGDC')fail();obj(p);const fee=Number(p.fee);if(typeof p.fee!=='number'||!Number.isFinite(fee)||fee<0||fee>100||Math.abs(fee*100-Math.round(fee*100))>1e-7)fail();o.channels[k]={base:integer(p.base,1e9),fee,title:text(p.title??'',150),description:text(p.description??'',2000)};}const src=sourcing(x.sourcing??{});if(src)o.sourcing=src;return o;}
 function quote(p,channel){const m=normalize(p.details??{},true),policy=m.channels[channel],base=policy?.base??p.base,tax=p.tax==='standard'?Math.round(base/10):0,price=base+tax,fee=policy?Math.round(price*policy.fee/100):null;const costKnown=Number.isSafeInteger(p.cost)&&(p.cost>0||p.cost===0&&m.zero_cost_evidence.length>=10),partial=fee===null||!costKnown?null:base-p.cost-fee;const profit=partial===null||m.fulfillment_cost===null||m.other_sale_cost===null?null:partial-m.fulfillment_cost-m.other_sale_cost;return {base,tax,price,fee,profit,partial_profit:partial,fulfillment_cost:m.fulfillment_cost,other_sale_cost:m.other_sale_cost,cost_known:costKnown,title:policy?.title||p.title,description:policy?.description||p.description};}
 // Conservative estimate: shipping income excluded, fee calculated on total charged incl. shipping.
 function businessQuote(p,channel='IGDC',now=new Date()){
  const m=normalize(p.details??{},true),s=m.sourcing;if(!s)return null;const q=quote(p,channel),why=[];
  const day=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  if(!s.permission)why.push('판매 및 자료 이용 조건 확인 필요');if(s.evidence.length<5)why.push('조달 근거 필요');if(!s.fulfillment||!s.returns)why.push('배송·반품 책임자 지정 필요');
  if(s.mode!=='direct'&&(!s.valid_until||s.valid_until<day))why.push('조달 가격·공급 가능 기간 확인 필요');
  if(!p.source_ref||s.mode==='direct'&&!/^direct:/i.test(p.source_ref))why.push('등록 방식과 출처 확인 필요');
  if(!q.cost_known||m.fulfillment_cost===null||m.other_sale_cost===null)why.push('조달 원가·배송·기타 비용 확인 필요');
  const bps=channel==='IGDC'?s.fee_bps:m.channels[channel]?Math.round(m.channels[channel].fee*100):null;
  const amounts=[q.base,q.price,p.shipping];const valid=amounts.every(n=>Number.isSafeInteger(n)&&n>=0)&&q.base>0;if(!valid)why.push('판매가격·배송비 확인 필요');
  if(bps===null)why.push('채널 수수료 확인 필요');const fee=valid&&bps!==null?Math.ceil((q.price+p.shipping)*bps/10000):null;
  const profit=fee===null||!q.cost_known||m.fulfillment_cost===null||m.other_sale_cost===null?null:q.base-p.cost-m.fulfillment_cost-m.other_sale_cost-fee;
  if(profit!==null&&profit<=0)why.push('예상 이익 0 이하');
  return {mode:s.mode,fee,profit,margin:profit!==null&&q.base>0?profit/q.base*100:null,ready:!why.length,reasons:why,estimate_only:true};
 }
 const api={normalize,quote,channels,keys,sourcing,businessQuote};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DCenterProductPolicy=api;
})(typeof window==='undefined'?globalThis:window);
