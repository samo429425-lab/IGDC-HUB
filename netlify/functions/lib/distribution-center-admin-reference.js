"use strict";
const legacy=require('../commerce-candidate-management-ledger');
const guard=require('./commerce-product-image-integrity.v1');
const profiles=require('../../../distribution-center/source-profile-core');
const discovery=require('./distribution-center-discovery');
const norm=v=>String(v??'').normalize('NFKC').trim().toLowerCase();
const txt=(v,n=150)=>String(v??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/<[^>]*>/g,' ').trim().slice(0,n);
function project(row,q){
 const card=row?.productCard||{},supplier=row?.supplier||{};
 if(!row||row.productPageLive===false||row.managementIntegrity?.structuralReady!==true||row.ledgerScopeConflict===true||/^(?:deleted|rejected|blocked|excluded|held|hold|dead)$/i.test(String(row.stageStatus||'')))return null;
 const link=discovery.url(row.productUrl||card.checkoutUrl),title=txt(row.title||card.title);if(!link||!title)return null;
 const brand=txt(card.brand||card.manufacturer||row.brand),seller=txt(card.supplierName||supplier.name);
 const party=['supplier','shop'].includes(q.type),key=party?norm:profiles.brandKey;
 let matched=(party?[seller]:[brand]).some(v=>v&&key(v)===key(q.name));
 // Host match is a reference only; never convert it into a verified brand claim.
 let method=matched?'explicit_name':'';if(!matched&&q.type==='brand'&&!brand&&discovery.sameHost(link,q.url)){matched=true;method='source_host_reference';}
 if(!matched)return null;
 const image=discovery.url(guard.resolve(row).image);if(!image)return null;
 if(q.term&&!/^https?:\/\//i.test(q.term)&&!norm([title,brand,seller,card.sku||card.model].join(' ')).includes(norm(q.term)))return null;
 if(/^https?:\/\//i.test(q.term)&&discovery.url(q.term)!==link)return null;
 return {title,brand,supplier:seller,source_url:link,image_url:image,match_method:method,retail:discovery.price(card.price,String(card.priceCurrency||'').toUpperCase()),model:txt(card.sku||card.model,80)};
}
async function read(event,q,g,handler=legacy.handler){
 if(!g.owner||g.country!==q.country)return {status:'permission_required',rows:[],scanned:0,more:false};
 const phase=q.page>=100?'assignment':'payload',offset=(q.page%100)*75;
 const result=await handler({httpMethod:'GET',headers:event.headers||{},queryStringParameters:{country:g.country,region:'NATIONWIDE',mode:'scoped_indexed_v1',phase,offset:String(offset),limit:'75'}});
 if(result.statusCode!==200)return {status:'ledger_unavailable',http:result.statusCode,rows:[],scanned:0,more:false};
 let data;try{data=JSON.parse(result.body);}catch{return {status:'ledger_format_error',rows:[],scanned:0,more:false};}
 if(data.ok!==true||data.safety?.readOnly!==true||data.scope?.country!==g.country||data.scope?.region!=='NATIONWIDE'||!Array.isArray(data.candidates))return {status:'ledger_format_error',rows:[],scanned:0,more:false};
 const seen=new Set(),rows=[];for(const x of data.candidates){const r=project(x,q);if(r&&!seen.has(r.source_url)){seen.add(r.source_url);rows.push(r);}}
 const p=data.pagination||{};let next=null;if(p.hasMore&&p.nextPhase==='assignment'&&phase==='payload')next=100;else if(p.hasMore&&p.nextPhase===phase&&q.page%100<99)next=q.page+1;
 return {status:rows.length?'ok':next!==null?'partial_no_match':'empty',rows,scanned:Number(p.scanned)||0,returned:data.candidates.length,more:next!==null,next_page:next,limited:p.hasMore===true&&next===null};
}
module.exports={project,read};
