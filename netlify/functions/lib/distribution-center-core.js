'use strict';
const policy=require('../../../distribution-center/product-policy-core');
const sections = require('../../../distribution-center/sections.json');
const ids = new Set(sections.map(x=>x.id));
const countries=new Set(require('../../../distribution-center/countries.json').map(x=>x.code));
const roleMap={seller:['commerce_manager'],manager:['site_manager_distribution'],director:['site_manager_director','director','admin','owner']};
function error(statusCode,message){return Object.assign(new Error(message),{statusCode});}
function scope(member,grant,requested){if(!grant||grant.active!==true||!member||!Array.isArray(member.roles)||grant.member_id!==member.memberId||(grant.hq_approved!==true||!Object.hasOwn(roleMap,grant.role))|| !countries.has(grant.country))throw error(403,'승인된 유통 회원만 이용할 수 있습니다.');const permitted=[grant.country,...(Array.isArray(grant.additional_countries)?grant.additional_countries:[])].filter(x=>countries.has(x));const country=requested===undefined||requested===null||requested===''?grant.country:requested;if(typeof country!=='string'||!permitted.includes(country))throw error(403,'승인되지 않은 관리 국가입니다.');return {...grant,country,countries:[...new Set(permitted)]};}
function integer(v,max){if(!Number.isSafeInteger(v)||v<0||v>max)throw error(400,'금액 또는 수량이 올바르지 않습니다.');return v;}
function text(v,max,min=1){if(typeof v!=='string'||v.trim().length<min||v.length>max)throw error(400,'입력 항목을 확인하세요.');return v.trim();}
function price(base,tax){integer(base,1000000000);if(!['standard','exempt','zero'].includes(tax))throw error(400,'과세 구분 오류');const taxAmount=tax==='standard'?Math.round(base/10):0;return {base,tax_amount:taxAmount,total:base+taxAmount};}
function product(input){if(!ids.has(input.section))throw error(400,'섹션 오류'); const p=price(input.base,input.tax);const markup=input.markup??0;if(typeof markup!=='number'||!Number.isFinite(markup)||markup<0||markup>1000||Math.abs(markup*100-Math.round(markup*100))>1e-7)throw error(400,'가산율 오류');let details;try{details=policy.normalize(input.details??{});}catch(e){throw error(400,'상품 확장 정보 오류');}const direct=/^direct:/i.test(input.source_ref||'');if(direct){if(typeof input.source_ref!=='string'||input.source_ref.slice(7).trim().length<3)throw error(400,'직접 등록 출처 또는 공급 증빙 필요');for(const k of policy.keys)details.locks[k]=true;}if(!details.original_image&&input.image_url)details.original_image=image(input.image_url);return {details,brand:text(input.brand||'',150,0),supplier:text(input.supplier||'',150,0),source_ref:text(input.source_ref||'',500,0),cost:integer(input.cost??0,1000000000),markup,title:text(input.title,150),description:text(input.description,12000),section:input.section,base:p.base,tax:input.tax,stock:integer(input.stock,1000000),shipping:integer(input.shipping,100000000),tax_evidence:text(input.tax_evidence||'',500,input.tax==='standard'?0:1),image_url:input.image_url?image(input.image_url):null};}
function image(v){let u;try{u=new URL(v);}catch{throw error(400,'이미지 주소 오류');}if(u.protocol!=='https:'||u.username||u.password||v.length>2048)throw error(400,'HTTPS 이미지 주소만 허용됩니다.');return u.href;}
// An original is the first preserved source image, not the currently selected representative.
// An existing product may change its display photo without replacing this audit reference.
function preserveOriginal(row, patch){
 if(!row||!patch||(!Object.hasOwn(patch,'image_url')&&!patch.details))return patch;
 let details;try{details=policy.normalize(patch.details??row.details??{});}catch(e){throw error(400,'상품 원본 정보 오류');}
 const old=row.details?.original_image;
 if(old){try{details.original_image=image(old);}catch{throw error(400,'기존 원본 사진 주소 확인 필요');}}
 else if(row.image_url)details.original_image=image(row.image_url);
 else if(!details.original_image&&patch.image_url)details.original_image=image(patch.image_url);
 return {...patch,details};
}
function sellerActive(grant,country){return !!(grant&&grant.active===true&&grant.hq_approved===true&&countries.has(country)&&(grant.country===country||(Array.isArray(grant.additional_countries)&&grant.additional_countries.includes(country))));}
function allowed(g,member,row){return row.country===g.country&&(g.role!=='seller'||row.seller_id===member.memberId);}
function transition(g,row,next){const rules={draft:['pending','withdrawn'],pending:['draft','withdrawn'],approved:['withdrawn'],withdrawn:['draft']};if(g.role!=='seller'&&row.status==='pending'&&next==='approved')return next;if(!rules[row.status]?.includes(next))throw error(409,'허용되지 않는 상태 변경');return next;}
module.exports={countries,sections,scope,price,product,preserveOriginal,allowed,sellerActive,transition,error};
