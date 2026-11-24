"use strict";
/** Read-only three-SNS administrator audit of stored release links and candidate status. */
const Auth=require("./lib/global-slot-console-auth");
const Social=require("./lib/social-candidate-store.v1");
const VERSION="social-content-issues-report-v1.0.0";
const SECTIONS=["social-youtube","social-instagram","social-tiktok"];
const LABELS={"social-youtube":"YouTube","social-instagram":"Instagram","social-tiktok":"TikTok"};
const ROLES=new Set(["owner","admin","super_admin","site_manager","site_manager_director","director","social_manager","media_manager"]);
const text=v=>String(v==null?"":v).trim();
const arr=v=>Array.isArray(v)?v:[];
const obj=v=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const norm=v=>text(v).toLowerCase().replace(/[\s-]+/g,"_");
function reply(code,data){return{statusCode:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,OPTIONS"},body:code===204?"":JSON.stringify(data)};}
function releasedIds(snapshot){
 const src=obj(obj(obj(snapshot).pages).social).sections,sections=obj(src),sets=new Map();
 for(const key of SECTIONS){const ids=new Set();for(const slot of arr(sections[key])){
  if(text(slot&&slot.type)!=="external_social"||text(slot&&slot.audit&&slot.audit.origin)!=="social_candidates")continue;
  const id=text(slot&&(slot.contentId||slot.candidateId||slot.id||slot.audit&&slot.audit.candidate_id));if(id)ids.add(id);
 }sets.set(key,ids);}return sets;
}
function detail(row,sectionKey,published){
 const review=norm(row.review_status),verification=norm(row.verification_status),access=norm(row.access_status),risk=norm(row.risk_level),raw=obj(row.raw);
 const asset=Social.assetClassOf(row),approved=review==="approved";
 const reasons=[];
 if(/replacement_requested|replacement_waiting/.test(review)||norm(raw.placementOverride)==="replacement_waiting")reasons.push("replacement_requested");
 if(published){
  if(!Social.isPublishEligibleContentRow(row))reasons.push("published_candidate_no_longer_eligible");
  if(!Social.platformContentUrl(text(row.platform)||sectionKey.replace(/^social-/,""),text(raw.latestContentUrl||raw.sourceContentUrl||row.source_url)))reasons.push("invalid_content_detail_link");
  if(row.login_required===true||row.public_access===false||/private|blocked|login_required/.test(access))reasons.push("public_access_or_login_problem");
  if(risk==="blocked"||risk==="rejected"||/rejected|suppressed|blocked|hold/.test(review))reasons.push("review_rejected_or_held");
  if(!Social.publishableThumbnail(row))reasons.push("thumbnail_missing_or_unverified");
 }else if(approved&&asset==="latest_content"){
  if(!Social.isPublishEligibleContentRow(row))reasons.push("approved_candidate_not_publishable");
 }
 if(published&&/error|failed|invalid|missing|required/.test(verification))reasons.push("verification_needs_review");
 if(!reasons.length)return null;
 return {sectionKey,sectionName:LABELS[sectionKey],candidateId:text(row.id),title:text(row.title)||"제목 미확인",url:text(row.source_url)||null,
  thumbnailUrl:text(row.thumbnail_url)||null,publishedInStoredRelease:published,reasons:Array.from(new Set(reasons)),reviewStatus:review,
  verificationStatus:verification,accessStatus:access,updatedAt:text(row.updated_at)||null,
  category:published?"stored_release_problem":approved?"approved_candidate_review":"replacement_waiting"};
}
async function report(){
 Social.config();
 const warnings=[];let release=null,releaseReadOk=false;
 try{
  const rows=await Social.selectReleases("select=release_id,created_at,snapshot,snapshot_hash,notes&status=eq.stored&notes=like."+encodeURIComponent("scope=GLOBAL;%")+"&order=created_at.desc&limit=1");
  if(!Array.isArray(rows))throw new Error("release_read_incomplete");
  release=rows[0]||null;releaseReadOk=true;
 }catch(e){warnings.push("last_stored_release_read_failed:"+text(e&&e.code||e&&e.message).slice(0,160));}
 const bySection=releasedIds(release&&release.snapshot),issues=[],sections=[],readLimit=150,maxPages=3;
 for(const sectionKey of SECTIONS){let offset=0,complete=false,readOk=true,returned=0,seen=new Set();
  for(let p=0;p<maxPages;p++){
   let rows;try{rows=await Social.selectCandidates("select=*&section_key=eq."+encodeURIComponent(sectionKey)+"&order=updated_at.desc&offset="+offset+"&limit="+readLimit);}
   catch(e){readOk=false;warnings.push(sectionKey+"_candidate_read_failed:"+text(e&&e.code||e&&e.message).slice(0,160));break;}
   if(!Array.isArray(rows)){readOk=false;warnings.push(sectionKey+"_candidate_read_incomplete");break;}
   returned+=rows.length;
   for(const row of rows){const id=text(row&&row.id);if(!id||seen.has(id))continue;seen.add(id);
    const item=detail(row,sectionKey,bySection.get(sectionKey).has(id));if(item)issues.push(item);
   }
   if(rows.length<readLimit){complete=true;break;}offset+=rows.length;
  }
  // A release candidate not present in bounded ledger is *unverified*, not automatically deleted.
  if(complete&&releaseReadOk){for(const id of bySection.get(sectionKey)){
   if(!seen.has(id))issues.push({sectionKey,sectionName:LABELS[sectionKey],candidateId:id,title:"승인 릴리스의 콘텐츠 원장 연결 확인 필요",publishedInStoredRelease:true,category:"release_candidate_not_found",reasons:["stored_release_candidate_missing_from_current_ledger"],verifiedDead:false});
  }}
  sections.push({sectionNumber:SECTIONS.indexOf(sectionKey)+1,sectionKey,sectionName:LABELS[sectionKey],candidateRowsRead:returned,readComplete:complete&&readOk,
   storedReleaseIds:bySection.get(sectionKey).size,issueCount:issues.filter(x=>x.sectionKey===sectionKey).length});
 }
 return{ok:true,reportType:"igdc-social-content-issues",version:VERSION,generatedAt:new Date().toISOString(),readOnly:true,automaticDeployment:false,
  source:{candidateTable:Social.CANDIDATE_TABLE,releaseTable:Social.RELEASE_TABLE,globalReleaseReadOk:releaseReadOk,globalReleaseFound:!!release,
   releaseId:text(release&&release.release_id)||null,releaseCreatedAt:text(release&&release.created_at)||null,
   scanScope:"GLOBAL 저장 릴리스 + SNS별 최신 후보 원장 450건 한도; 외부 사이트 실시간 재검증 아님"},
  warnings,summary:{issues:issues.length,affectedSections:sections.filter(x=>x.issueCount).length,partial:sections.some(x=>!x.readComplete)||!releaseReadOk},sections,issues};
}
exports.handler=async(event)=>{
 if(event&&event.httpMethod==="OPTIONS")return reply(204,{});
 if(!event||event.httpMethod!=="GET")return reply(405,{ok:false,error:"method_not_allowed"});
 try{const actor=await Auth.resolveUser(event),roles=arr(actor&&actor.roles).map(norm);
  if(!roles.some(role=>ROLES.has(role)))return reply(403,{ok:false,error:"social_issues_forbidden"});
  return reply(200,await report());
 }catch(e){return reply(e&&e.statusCode||503,{ok:false,version:VERSION,error:text(e&&e.code)||"social_issues_read_failed",message:text(e&&e.message)||"소셜 점검 실패",readOnly:true});}
};
exports._test={detail,releasedIds,report};
