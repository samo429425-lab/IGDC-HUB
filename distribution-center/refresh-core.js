'use strict';
(function(root){
 const policy=typeof module!=='undefined'&&module.exports?require('./product-policy-core'):root.DCenterProductPolicy;
 function plan(row, incoming, local=false){
  if(!row||!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw Error('상품 자료 오류');
  if(!row.source_ref||incoming.source_ref!==row.source_ref)throw Error('기존 상품과 공급 출처가 일치해야 합니다.');
  if(/^direct:/i.test(row.source_ref))return {patch:{},skipped:['cost','stock','title','description','image_url'].filter(k=>Object.prototype.hasOwnProperty.call(incoming,k))};
  if(!['draft','withdrawn','approved'].includes(row.status))throw Error('승인 대기 상품은 변경할 수 없습니다.');
  const locks=policy.normalize(row.details||{},local).locks, patch={}, skipped=[];
  const rules={cost:['price',v=>Number.isSafeInteger(v)&&v>=0&&v<=1e9],stock:['stock',v=>Number.isSafeInteger(v)&&v>=0&&v<=1e6],title:['title',v=>typeof v==='string'&&v.trim().length>0&&v.length<=150],description:['description',v=>typeof v==='string'&&v.trim().length>0&&v.length<=12000],image_url:['image',v=>{try{const u=new URL(v);return typeof v==='string'&&v.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}]};
  for(const [key,[lock,valid]] of Object.entries(rules)){if(!Object.prototype.hasOwnProperty.call(incoming,key))continue;if(!valid(incoming[key]))throw Error(key+' 값 오류');if(locks[lock]||(row.status==='approved'&&key!=='stock')||(key==='stock'&&row.details?.variants?.length)){skipped.push(key);continue;}if(row[key]!==incoming[key])patch[key]=incoming[key];}
  if('cost' in patch){const base=Math.round(patch.cost*(1+row.markup/100));if(!Number.isSafeInteger(base)||base>1e9||base<0)throw Error('계산 가격 범위 초과');patch.base=base;if(row.details?.sourcing?.mode&&row.details.sourcing.mode!=='direct'){patch.details=policy.normalize({...row.details,sourcing:{...row.details.sourcing,valid_until:''}},local);}}
  if(Object.keys(patch).some(k=>k!=='stock'))Object.assign(patch,{status:'draft',verification_status:'unverified',verification_note:''});
  return {patch,skipped};
 }
 const api={plan};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DCenterRefresh=api;
})(typeof window==='undefined'?globalThis:window);
