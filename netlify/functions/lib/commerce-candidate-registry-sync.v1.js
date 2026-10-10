"use strict";

const fs=require("fs"),crypto=require("crypto"),Base=require("./commerce-candidate-registry-sync.baseline-1229.v1"),Pipeline=require("./commerce-product-pipeline-state.v1"),ProductRanking=require("./commerce-product-ranking.v1");
const VERSION="commerce-candidate-registry-sync-v1.21.0-canonical-product-dedupe";
function t(v){return v==null?"":String(v).trim()}function l(v){return t(v).toLowerCase()}function o(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}function a(v){return Array.isArray(v)?v:[]}function f(){for(const v of arguments){const x=t(v);if(x)return x}return""}function https(v){try{const u=new URL(t(v));return u.protocol==="https:"?u.toString():""}catch(_e){return""}}function now(){return new Date().toISOString()}function sha(v){return crypto.createHash("sha256").update(v).digest("hex")}
const FRONT_SECTIONS=new Set([
"home|home_1","home|home_2","home|home_3","home|home_4","home|home_5","home|home_6","home|home_right_top","home|home_right_middle","home|home_right_bottom",
"distribution|distribution-recommend","distribution|distribution-sponsor","distribution|distribution-trending","distribution|distribution-new","distribution|distribution-special","distribution|distribution-others","distribution|distribution-extra","distribution|distribution-right",
"network|network-right","social|rightPanel","tour|tour"
]);
function requested(row){const r=o(row&&row.publicationRequest),s=l(o(row&&row.assignment).publicationStatus);return r.requested===true||l(r.status)==="publish_requested"||["publish_requested","matched","published"].includes(s)}
function productAssetUrl(v){try{return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i.test(new URL(t(v)).pathname)}catch(_e){return false}}
function bestTitle(){const values=Array.from(arguments).map(t).filter(Boolean);for(const value of values){if(!ProductRanking.isGenericProductName(value))return value}return values[0]||""}
function bestProductUrl(){for(const value of arguments){const url=https(value);if(url&&!productAssetUrl(url))return url}return""}
function normalize(row){
 const out=JSON.parse(JSON.stringify(row||{})),c=o(out.candidate),r=o(out.publicationRequest),as=o(out.assignment),p=o(c.approvedPlacement||c.selectedPlacement||c.primaryPlacement||c.placement),frontRec=o(c.administratorFrontMatchRecord),rec=Pipeline.administratorProductRecord(c)||{},card=o(o(c.researchReadiness).productCard),pc=o(c.productCard);
 const id=t(c.id),title=bestTitle(frontRec.title,rec.title,pc.title,card.title,c.productName,c.productTitle,c.itemName,c.displayName,c.sourceTitle,c.title,c.name),url=bestProductUrl(frontRec.productUrl,rec.productUrl,c.externalProductUrl,c.officialProductUrl,c.productUrl,c.productPageUrl,pc.productUrl,pc.checkoutUrl,card.productUrl,card.checkoutUrl,c.detailUrl,c.checkoutUrl,c.purchaseUrl,c.orderUrl,c.url,c.link,c.href),image=https(f(frontRec.imageUrl,rec.imageUrl,pc.imageUrl,pc.imageOriginalUrl,pc.thumbnailUrl,pc.thumbnail,pc.image,card.imageUrl,card.thumbnailUrl,card.thumbnail,card.image,c.imageUrl,c.imageOriginalUrl,c.thumbnailUrl,c.thumbnail,c.image)),page=f(frontRec.page,r.page,as.page,p.page,c.page,c.channel),section=f(frontRec.section,frontRec.sectionKey,r.section,as.section,p.sectionKey,p.section,c.section,c.psom_key),country=f(frontRec.country,r.country,as.country,p.country,c.country,c.targetCountry).toUpperCase(),region=f(frontRec.region,r.region,as.region,p.region,c.region,"NATIONWIDE").toUpperCase()||"NATIONWIDE",assignmentId=f(r.assignmentId,as.id),stamp=f(as.updatedAt,r.requestedAt,now()),errors=[];
 if(!id)errors.push("candidate_id_missing");if(!title)errors.push("title_missing");else if(ProductRanking.isGenericProductName(title))errors.push("product_title_generic_unresolved");if(!url)errors.push("product_url_missing_or_not_https");else if(productAssetUrl(url))errors.push("product_url_is_image_asset");if(!image)errors.push("image_missing_or_not_https");if(!page)errors.push("page_missing");if(!section)errors.push("section_missing");if(page&&section&&!FRONT_SECTIONS.has(page+"|"+section))errors.push("invalid_front_section");if(!country)errors.push("country_missing");if(!assignmentId)errors.push("assignment_id_missing");
 const req=Object.assign({},r,{requested:true,status:"publish_requested",assignmentId,requestedAt:f(r.requestedAt,stamp),requestedBy:f(r.requestedBy,as.updatedBy,"administrator"),country,region,page,section,crossCountryFallback:false});
 const auth={schema:"igdc-administrator-front-match-authority.v1",verified:true,assignmentId,publicationStatus:"publish_requested",page,section,country,region,externalSeller:true,noIgdcCheckout:true,noIgdcPayment:true,verifiedAt:stamp,verificationSource:"administrator-20-section-master-board"};
 out.candidate=Object.assign({},c,{id,title,name:title,url,link:url,href:url,externalProductUrl:url,officialProductUrl:f(c.officialProductUrl,url),productUrl:url,productPageUrl:url,detailUrl:url,checkoutUrl:url,image,imageUrl:image,thumb:image,thumbnail:image,thumbnailUrl:image,page,channel:page,route:page,section,psom_key:section,slotKey:section,placement:Object.assign({},o(c.placement),{page,section,sectionKey:section,country,region}),approvedPlacement:Object.assign({},o(c.approvedPlacement),{page,section,sectionKey:section,country,region,manualPinned:as.state==="pinned"}),administratorFrontMatchAuthority:auth,commerceReview:Object.assign({},o(c.commerceReview),{status:"approved",assignmentState:as.state==="pinned"?"pinned":"approved",approvalId:assignmentId,approvedAt:stamp,publicationStatus:"publish_requested",explicitPublicationRequested:true,publicationRequest:req}),commerceCandidate:Object.assign({},o(c.commerceCandidate),{sourceTier:"approved_commerce_member",origin:"admin_review_queue",explicitPublicationRequested:true,publicationScope:{country,region,page,section,crossCountryFallback:false}}),directCommerceListing:Object.assign({},o(c.directCommerceListing),{sourceTier:"approved_commerce_member"}),searchBankContract:Object.assign({},o(c.searchBankContract),{frontSupplyAllowed:true,searchBankEligible:true,snapshotEligible:true,indexEligible:true,lastVerifiedAt:stamp,officialSource:true,producerVerified:true}),frontBridgeValidation:{version:VERSION,structuralOnly:true,ok:errors.length===0,errors}});
 out.sourceTier="approved_commerce_member";out.assignment=Object.assign({},as,{id:assignmentId,state:as.state==="pinned"?"pinned":"approved",page,section,country,region,publicationStatus:"publish_requested",updatedAt:stamp});out.publicationRequest=req;out.review=Object.assign({},o(out.review),{status:"approved",assignmentState:out.assignment.state,approvalId:assignmentId,approvedAt:stamp});out.bridgeValidation={ok:errors.length===0,structuralOnly:true,errors};return out;
}

function publicationDestination(row){const c=o(row&&row.candidate);return https(f(c.productUrl,c.externalProductUrl,c.officialProductUrl,c.productPageUrl,c.detailUrl,c.url,c.href,c.link))}
function canonicalPublicationDestination(row){const raw=publicationDestination(row);return ProductRanking.canonicalProductUrl(raw)||raw}
function publicationKey(row){const r=o(row&&row.publicationRequest),as=o(row&&row.assignment);const page=f(r.page,as.page),section=f(r.section,as.section),country=f(r.country,as.country).toUpperCase(),region=f(r.region,as.region,"NATIONWIDE").toUpperCase()||"NATIONWIDE",url=canonicalPublicationDestination(row);return [page,section,country,region,url].join("|")}
function sectionScopeKey(row){const r=o(row&&row.publicationRequest),as=o(row&&row.assignment);return [f(r.page,as.page),f(r.section,as.section),f(r.country,as.country).toUpperCase(),f(r.region,as.region,"NATIONWIDE").toUpperCase()||"NATIONWIDE"].join("|")}
function sectionCapacity(row){const r=o(row&&row.publicationRequest),as=o(row&&row.assignment),page=f(r.page,as.page),section=f(r.section,as.section);return page==="tour"&&section==="tour"?200:100}
function publicationRank(row){
 const c=o(row&&row.candidate),as=o(row&&row.assignment),rec=o(c.administratorFrontMatchRecord),src=o(c.source),title=t(c.title||c.name),supplier=t(rec.supplierName||c.supplierName||src.name),priority=Number(as.priority),updated=Date.parse(f(as.updatedAt,o(row&&row.publicationRequest).requestedAt))||0;
 const pinned=l(as.state)==="pinned"?1:0,titleQuality=title&&!ProductRanking.isGenericProductName(title)?1:0,supplierQuality=supplier&&!/^(aside menu|menu|home|product|products|item|detail|details|상품|상품 상세|목록|대표이미지|대표 이미지)$/i.test(supplier)?1:0;
 return [pinned,titleQuality,supplierQuality,Number.isFinite(priority)?priority:0,updated];
}
function comparePublicationRows(a,b){
 const ar=publicationRank(a),br=publicationRank(b);
 for(let i=0;i<ar.length;i++){if(ar[i]!==br[i])return br[i]-ar[i]}
 return t(o(a&&a.candidate).id).localeCompare(t(o(b&&b.candidate).id));
}
function deferPublication(row,status,detail){
 row.publicationRequest=Object.assign({},o(row.publicationRequest),{requested:false,status});
 row.assignment=Object.assign({},o(row.assignment),{publicationStatus:status});
 const c=o(row.candidate),review=o(c.commerceReview),authority=o(c.administratorFrontMatchAuthority),commerceCandidate=o(c.commerceCandidate);
 row.candidate=Object.assign({},c,{
   commerceReview:Object.assign({},review,{publicationStatus:status,explicitPublicationRequested:false}),
   commerceCandidate:Object.assign({},commerceCandidate,{explicitPublicationRequested:false}),
   administratorFrontMatchAuthority:Object.assign({},authority,{publicationStatus:status}),
   publicationDeferred:Object.assign({status},detail||{})
 });
}
function normalizePublicationSet(rows){
 const valid=a(rows).filter(x=>o(x.bridgeValidation).ok===true);
 const duplicateDeferred=[],capacityDeferred=[];
 const groups=new Map();
 for(const row of valid){const key=publicationKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
 const unique=[];
 for(const group of groups.values()){
   group.sort(comparePublicationRows);
   unique.push(group[0]);
   for(const row of group.slice(1)){
     deferPublication(row,"deferred_duplicate_product",{reason:"duplicate_exact_product_destination",keptCandidateId:t(o(group[0].candidate).id)||null});
     duplicateDeferred.push(row);
   }
 }
 const scopes=new Map();
 for(const row of unique){const key=sectionScopeKey(row);if(!scopes.has(key))scopes.set(key,[]);scopes.get(key).push(row)}
 const requested=[];
 for(const group of scopes.values()){
   group.sort(comparePublicationRows);
   const cap=sectionCapacity(group[0]);
   for(let i=0;i<group.length;i++){
     const row=group[i];
     if(i<cap)requested.push(row);
     else{
       deferPublication(row,"deferred_section_capacity",{reason:"section_capacity",capacity:cap,rank:i+1});
       capacityDeferred.push(row);
     }
   }
 }
 return {requested,duplicateDeferred,capacityDeferred};
}

async function syncApprovedCandidates(input){
 const res=await Base.syncApprovedCandidates(input);if(!res||res.wrote!==true||!res.file||!fs.existsSync(res.file))return Object.assign({},res||{},{version:VERSION});
 let doc;try{doc=JSON.parse(fs.readFileSync(res.file,"utf8"))}catch(e){return Object.assign({},res,{ok:false,status:"blocked",version:VERSION,reason:"front_bridge_queue_read_failed",error:t(e&&e.message)})}
 doc.items=a(doc.items).map(x=>requested(x)?normalize(x):x);
 const originallyRequested=doc.items.filter(requested),bad=originallyRequested.filter(x=>o(x.bridgeValidation).ok!==true);
 // A malformed administrator card must never take the whole release down.
 // Keep the row in the private queue for diagnostics, but remove only that row
 // from the publication request. The other structurally valid board rows remain
 // authoritative and continue to SearchBank in the same build.
 bad.forEach(x=>{
   x.publicationRequest=Object.assign({},o(x.publicationRequest),{requested:false,status:"blocked_structural"});
   x.assignment=Object.assign({},o(x.assignment),{publicationStatus:"blocked_structural"});
   if(o(x.candidate).commerceReview)x.candidate.commerceReview=Object.assign({},o(x.candidate.commerceReview),{publicationStatus:"blocked_structural",explicitPublicationRequested:false});
 });
 const publicationSet=normalizePublicationSet(originallyRequested),req=publicationSet.requested,scope=Array.from(new Set(req.map(x=>{const r=o(x.publicationRequest);return t(r.country)?t(r.country).toUpperCase()+"|"+(t(r.region).toUpperCase()||"NATIONWIDE"):""}).filter(Boolean))),auth=Object.assign({},o(doc.releaseAuthorization),{authoritative:req.length>0||o(doc.releaseAuthorization).explicitAdminWithdrawal===true,mode:req.length?"explicit-admin-publication-request":o(doc.releaseAuthorization).mode,explicitAdminRequest:req.length>0,requestedCount:req.length,structuralBlockedCount:bad.length,duplicateDeferredCount:publicationSet.duplicateDeferred.length,capacityDeferredCount:publicationSet.capacityDeferred.length,scopeKeys:scope,source:"administrator-20-section-master-board",generatedAt:now(),crossCountryFallback:false,automaticPublication:false});
 doc.version=VERSION;doc.generatedAt=now();doc.authoritative=auth.authoritative;doc.explicitAdminRequest=auth.explicitAdminRequest;doc.requestedCount=req.length;doc.scopeKeys=scope;doc.releaseAuthorization=auth;doc.bridge={schema:"igdc-admin-board-searchbank-handoff.v1",version:VERSION,structuralOnlyAfterBoard:true,policyRejudgement:false,manualPlacementAuthority:true,requested:originallyRequested.length,structurallyValid:originallyRequested.length-bad.length,publicationRequested:req.length,structuralBlocked:bad.length,duplicateDeferred:publicationSet.duplicateDeferred.length,capacityDeferred:publicationSet.capacityDeferred.length,structuralErrors:bad.map(x=>({candidateId:t(o(x.candidate).id)||null,errors:a(o(x.bridgeValidation).errors)})).slice(0,100),duplicateSample:publicationSet.duplicateDeferred.slice(0,20).map(x=>({candidateId:t(o(x.candidate).id)||null,productUrl:publicationDestination(x),canonicalProductUrl:canonicalPublicationDestination(x),section:sectionScopeKey(x),keptCandidateId:o(o(x.candidate).publicationDeferred).keptCandidateId||null})),capacitySample:publicationSet.capacityDeferred.slice(0,20).map(x=>({candidateId:t(o(x.candidate).id)||null,section:sectionScopeKey(x),capacity:o(o(x.candidate).publicationDeferred).capacity||null,rank:o(o(x.candidate).publicationDeferred).rank||null}))};
 const body=JSON.stringify(doc,null,2)+"\n",tmp=res.file+"."+process.pid+".frontbridge.tmp";fs.writeFileSync(tmp,body,"utf8");fs.renameSync(tmp,res.file);return Object.assign({},res,{version:VERSION,digest:sha(body),count:doc.items.length,requestedCount:req.length,scopeKeys:scope,authoritative:auth.authoritative,releaseAuthorization:auth,bridge:doc.bridge});
}
module.exports=Object.assign({},Base,{VERSION,syncApprovedCandidates,normalizeRequestedEntry:normalize,normalizePublicationSet});
