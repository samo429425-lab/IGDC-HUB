"use strict";

/**
 * Administrator-only read interface for the Media Hub candidate queue.
 * It never publishes media.snapshot.json or mutates provider media.
 */
const fs=require("fs");
const path=require("path");
const SharedAdminAuth=require("./lib/global-slot-console-auth");
const MediaStore=require("./lib/media-candidate-store.v1");
const MediaPolicy=require("./lib/media-candidate-policy.v2");

const VERSION="media-candidate-review-api-v1.3.0-exclusion-restore-visible";
const READ_ROLES=new Set(["owner","admin","site_manager","site_manager_director","director","media_manager","commerce_manager"]);

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase().replace(/\s+/g,"_");}
function plain(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function boolValue(value){
  if(value===true)return true;
  if(value===false||value==null)return false;
  return/^(1|true|yes|on)$/i.test(text(value));
}
function json(statusCode,body){
  return{
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"private, no-store, max-age=0",
      "x-content-type-options":"nosniff",
      "access-control-allow-headers":"Content-Type, Authorization",
      "access-control-allow-methods":"GET,OPTIONS"
    },
    body:statusCode===204?"":JSON.stringify(body)
  };
}
function roles(member){
  return Array.from(new Set((member&&member.roles||[]).map(lower).filter(Boolean)));
}
function requireRead(member){
  const values=roles(member);
  if(!values.some((role)=>READ_ROLES.has(role))){
    const error=new Error("미디어 콘텐츠 후보 대기열은 관리자/운영진 권한에서만 볼 수 있습니다.");
    error.statusCode=403;error.code="media_candidate_read_forbidden";throw error;
  }
  return values;
}
async function resolveCurrentAdmin(event){
  const actor=await SharedAdminAuth.resolveUser(event);
  return{
    memberId:text(actor&&(actor.memberId||actor.sub)),
    email:text(actor&&actor.email),
    name:text(actor&&actor.name),
    roles:Array.isArray(actor&&actor.roles)?actor.roles:[],
    authMode:"validated_platform_bearer"
  };
}
function readJsonFile(file){
  try{
    if(!fs.existsSync(file))return null;
    return JSON.parse(fs.readFileSync(file,"utf8"));
  }catch(_error){return null;}
}
async function supabaseCandidateSnapshot(){
  try{
    MediaStore.config();
    const rows=[];
    for(let offset=0;offset<10000;offset+=1000){
      const pageRows=await MediaStore.selectCandidates("select=*&order=updated_at.desc&limit=1000&offset="+offset);
      const list=Array.isArray(pageRows)?pageRows:[];
      rows.push(...list);
      if(list.length<1000)break;
    }
    return{
      file:"supabase:"+(MediaStore.CANDIDATE_TABLE||"media_candidates"),
      sourceMode:"supabase",
      doc:{
        version:"media.candidate-library.supabase.v2",
        type:"media_candidate_library",
        schema:"media_candidates.supabase.v1",
        generatedAt:new Date().toISOString(),
        renderPolicy:"private_review_only",
        mediaTrendingPolicy:"manual_seed_excluded",
        count:rows.length,
        items:rows
      }
    };
  }catch(error){
    return{
      file:"",
      sourceMode:"supabase_unavailable",
      storeError:{code:error&&error.code||null,message:text(error&&error.message||error)},
      doc:null
    };
  }
}
async function candidateSnapshot(root){
  const stage=await supabaseCandidateSnapshot();
  if(stage&&stage.doc)return stage;
  const candidates=[
    path.join(__dirname,"data","media.candidates.snapshot.json"),
    path.join(root,"netlify","functions","data","media.candidates.snapshot.json"),
    path.join(root,"data","media.candidates.snapshot.json")
  ];
  for(const file of candidates){
    const doc=readJsonFile(file);
    if(doc)return{file,sourceMode:"static_snapshot",storeError:stage&&stage.storeError||null,doc};
  }
  return{
    file:"",
    sourceMode:stage&&stage.sourceMode||"empty",
    storeError:stage&&stage.storeError||null,
    doc:{version:"media.candidate-library.empty",type:"media_candidate_library",count:0,items:[]}
  };
}
function sectionList(doc){
  if(Array.isArray(doc&&doc.sections))return doc.sections;
  return Object.keys(plain(doc&&doc.sections)).map((key)=>{
    const value=doc.sections[key];
    return Array.isArray(value)?{key,slots:value}:Object.assign({key},plain(value));
  });
}
function publicSnapshotDigest(root){
  const candidates=[
    path.join(root,"data","media.snapshot.json"),
    path.join(root,"netlify","functions","data","media.snapshot.json")
  ];
  for(const file of candidates){
    const doc=readJsonFile(file);
    if(!doc)continue;
    const sections=sectionList(doc);
    let seededInPublic=0,realSlots=0;
    sections.forEach((section)=>{
      (Array.isArray(section&&section.slots)?section.slots:[]).forEach((slot)=>{
        if(!slot)return;
        const real=text(slot.title)&&text(slot.title).toLowerCase()!=="coming soon"&&(text(slot.contentId)||text(slot.id));
        if(slot.seedContent===true||slot.candidateOnly===true||/verification_required|web_verification_required|pending/i.test(text(slot.verificationStatus||slot.rights&&slot.rights.status)))seededInPublic+=1;
        if(real)realSlots+=1;
      });
    });
    return{file,sections:sections.length,realSlots,seededInPublic};
  }
  return{file:"",sections:0,realSlots:0,seededInPublic:0};
}
function countBy(rows,selector){
  const output={};
  (Array.isArray(rows)?rows:[]).forEach((row)=>{
    const key=text(selector(row))||"unknown";
    output[key]=(output[key]||0)+1;
  });
  return Object.keys(output).sort().reduce((result,key)=>{result[key]=output[key];return result;},{});
}
function isPromotable(row){
  if(row&&(row.section_key||row.source_url||row.video_url))return MediaStore.snapshotEligible(row);
  return MediaPolicy.publicReleaseAllowed(row);
}
function exclusionRestoreInfo(database,rawStored){
  const record=plain(rawStored.queueExclusion);
  const previous=plain(record.previous);
  const exact=record.version==="media-candidate-exclusion-v1"&&Object.keys(previous).length>0;
  return{
    exact,
    recordVersion:text(record.version),
    excludedAt:text(record.excludedAt)||text(database.reviewed_at||database.updated_at),
    excludedBy:text(record.excludedBy)||text(database.reviewed_by),
    exclusionReason:text(record.exclusionReason)||text(database.blocked_reason||database.review_note),
    originalReviewStatus:exact?text(previous.reviewStatus):"",
    originalVerificationStatus:exact?text(previous.verificationStatus):"",
    originalSectionKey:exact?text(previous.sectionKey):text(database.section_key),
    originalPriority:exact?text(previous.priority):text(database.priority),
    originalCreatedAt:exact?text(previous.createdAt):text(database.created_at),
    originalCollectedAt:exact?text(previous.collectedAt):text(database.collected_at),
    restoreTarget:exact?"original_state_and_position":"legacy_pending_fallback"
  };
}
function normalizeRow(row){
  const database=plain(row);
  const rawStored=plain(database.raw);
  const detail=Object.keys(rawStored).length?rawStored:database;
  const sourceMetadata=plain(detail.sourceMetadata||database.sourceMetadata);
  const rights=plain(detail.rights||database.rights);
  const administratorReview=plain(detail.administratorReview);
  const storedAssessment=plain(detail.policyAssessment||database.policyAssessment);
  const policyAssessment=Object.keys(storedAssessment).length?storedAssessment:MediaPolicy.assessCandidate(Object.assign({},detail,database));
  const sourceUrl=text(database.url||database.source_url||database.sourceUrl||database.page_url||database.pageUrl||database.link||database.href||detail.source_url||detail.sourceUrl||detail.url);
  const videoUrl=text(database.video||database.video_url||database.videoUrl||detail.video_url||detail.videoUrl);
  const embedUrl=text(database.embedUrl||database.embed_url||detail.embed_url||detail.embedUrl);
  const thumbUrl=text(database.thumb||database.thumbnail||database.image||database.thumb_url||database.thumbUrl||detail.thumb_url||detail.thumbUrl);
  const verificationStatus=text(database.verificationStatus||database.verification_status)||text(rights.status)||text(database.rights_status)||"verification_required";
  const candidateOnly=database.candidateOnly===true||database.candidate_only===true||boolValue(database.candidate_only);
  const seedContent=database.seedContent===true||database.seed_content===true||boolValue(database.seed_content);
  const captions=Array.isArray(detail.captions)?detail.captions:[];
  const exclusionRestore=exclusionRestoreInfo(database,rawStored);
  return{
    slotId:database.slotId||database.slot_id||null,
    contentId:text(database.contentId||database.content_id||database.id),
    id:text(database.id||database.contentId||database.content_id),
    sectionKey:text(database.sectionKey||database.section_key||database.section||database.targetSection||database.category||detail.section_key),
    title:text(database.title||detail.title),
    provider:text(database.provider||database.sourceProvider||database.source_host||database.publisher||database.channel||detail.provider),
    year:text(database.year||database.release_year||detail.year||sourceMetadata.year),
    region:text(database.region||detail.region),
    qualityTarget:text(database.qualityTarget||database.quality_target||database.quality_hint||database.quality||database.resolution||detail.quality_hint),
    qualityPriority:text(database.qualityPriority||database.quality_priority||database.priority||detail.priority),
    riskLevel:text(database.riskLevel||database.risk_level||detail.risk_level),
    reviewStatus:text(database.reviewStatus||database.review_status||detail.review_status),
    blockedReason:text(database.blockedReason||database.blocked_reason),
    reviewNote:text(database.reviewNote||database.review_note),
    reviewedAt:text(database.reviewedAt||database.reviewed_at||database.updated_at),
    verificationStatus,
    sanmaruSearchSeed:text(database.sanmaruSearchSeed||database.sanmaru_query||database.searchSeed||database.query||detail.sanmaru_query),
    url:sourceUrl,
    video:videoUrl,
    embedUrl,
    thumb:thumbUrl,
    candidateOnly,
    seedContent,
    trendingEligible:database.trendingEligible===true||boolValue(database.trending_eligible),
    replacementPolicy:text(database.replacementPolicy||database.replacement_policy),
    rankingScore:Number(database.rankingScore||database.ranking_score||detail.rankingScore||0),
    rankingTier:text(database.rankingTier||database.ranking_tier||detail.rankingTier||database.priority),
    rankingSignals:Array.isArray(detail.rankingSignals)?detail.rankingSignals:[],
    subtitleLanguages:Array.isArray(detail.subtitleLanguages)?detail.subtitleLanguages:[],
    subtitleCount:Number(detail.subtitleCount||captions.length||0),
    captions,
    ageRating:text(detail.ageRating||policyAssessment.safety&&policyAssessment.safety.ageRating||""),
    contentWarnings:Array.isArray(detail.contentWarnings)?detail.contentWarnings:[],
    safetyDecision:administratorReview.contentSafe===true?"administrator_approved":text(policyAssessment.safety&&policyAssessment.safety.decision||detail.safetyDecision),
    policyDecision:text(policyAssessment.decision),
    policyReasons:Array.isArray(policyAssessment.reasons)?policyAssessment.reasons:[],
    aiAssessment:plain(policyAssessment.safety&&policyAssessment.safety.ai||detail.aiAssessment),
    classificationConfidence:Number(detail.classificationConfidence||sourceMetadata.classificationConfidence||0),
    requestedSection:text(detail.requestedSection||sourceMetadata.requestedSection),
    classifiedSection:text(detail.classifiedSection||sourceMetadata.classifiedSection||database.sectionKey||database.section_key),
    durationSeconds:Number(detail.durationSeconds||sourceMetadata.durationSeconds||0),
    sourceMetadata,
    playbackCandidates:Array.isArray(sourceMetadata.playbackCandidates)?sourceMetadata.playbackCandidates:[],
    exclusionRestore,
    rights:{
      status:text(rights.status)||text(database.rights_status),
      candidate:text(rights.candidate)||text(database.allowed_use),
      sourceHint:text(rights.sourceHint)||text(database.source_host),
      hostingModeCandidate:text(rights.hostingModeCandidate)||text(database.hosting_mode_candidate),
      sourceUrl:text(rights.sourceUrl)||sourceUrl,
      licenseUrl:text(rights.licenseUrl)||text(database.license_url||database.licenseUrl),
      verifiedAt:rights.verifiedAt||database.reviewed_at||database.approved_at||null,
      verifiedBy:text(rights.verifiedBy)||text(database.reviewed_by),
      attribution:text(rights.attribution)||text(database.attribution)
    },
    promotable:isPromotable(database)
  };
}
function summaryDoc(doc,publicDigest){
  const items=(Array.isArray(doc&&doc.items)?doc.items:[]).map(normalizeRow);
  const manualTrending=items.filter((row)=>row.sectionKey==="media-trending"||row.trendingEligible===true).length;
  const promotable=items.filter((row)=>row.promotable===true).length;
  const verificationRequired=items.filter((row)=>row.promotable!==true).length;
  const quarantined=items.filter((row)=>/quarantine/.test(lower(row.reviewStatus))||row.policyDecision==="quarantine").length;
  return{
    version:VERSION,
    policyVersion:MediaPolicy.VERSION,
    libraryVersion:text(doc&&doc.version),
    generatedAt:text(doc&&doc.generatedAt)||null,
    candidateCount:items.length,
    promotableCount:promotable,
    verificationRequired,
    quarantinedCount:quarantined,
    trendingManualCandidates:manualTrending,
    publicSnapshotMutation:publicDigest&&publicDigest.seededInPublic>0?"주의":"없음",
    publicSnapshotSeededCandidates:publicDigest&&publicDigest.seededInPublic||0,
    bySection:countBy(items,(row)=>row.sectionKey),
    byRisk:countBy(items,(row)=>row.riskLevel),
    byVerificationStatus:countBy(items,(row)=>row.verificationStatus),
    byReviewStatus:countBy(items,(row)=>row.reviewStatus),
    bySafetyDecision:countBy(items,(row)=>row.safetyDecision),
    byProvider:countBy(items,(row)=>row.provider)
  };
}
function diagnosticDoc(stage,publicDigest,member){
  const doc=stage&&stage.doc||{};
  const rows=(Array.isArray(doc.items)?doc.items:[]).map(normalizeRow);
  const summary=summaryDoc(doc,publicDigest);
  const blockers=[];
  if(rows.length===0)blockers.push("media_candidate_queue_empty");
  if(summary.trendingManualCandidates!==0)blockers.push("manual_trending_candidates_present");
  if((publicDigest&&publicDigest.seededInPublic||0)>0)blockers.push("candidate_seed_found_in_public_media_snapshot");
  if(summary.promotableCount===0)blockers.push("no_verified_promotable_media_yet");
  return{
    ok:true,
    reportType:"igdc-media-candidate-queue-diagnostic",
    version:VERSION,
    generatedAt:new Date().toISOString(),
    safety:{
      policyVersion:MediaPolicy.VERSION,
      readOnly:true,writes:false,publicSnapshotPublication:false,mediaSnapshotMutation:false,
      externalVideoNavigation:false,providerCalls:false,paymentOrRevenueMutation:false,secretsExcluded:true
    },
    administrator:{roles:roles(member),access:"validated-media-candidate-read",authMode:text(member&&member.authMode)},
    source:{
      candidateFileLoaded:!!(stage&&stage.file),
      candidateFile:stage&&stage.file?(String(stage.file).startsWith("supabase:")?stage.file:path.basename(stage.file)):"not_found",
      candidateSourceMode:text(stage&&stage.sourceMode),
      supabaseStoreError:stage&&stage.storeError||null,
      publicSnapshotChecked:!!(publicDigest&&publicDigest.file),
      publicSnapshotSeededCandidates:publicDigest&&publicDigest.seededInPublic||0,
      publicSnapshotRealSlots:publicDigest&&publicDigest.realSlots||0
    },
    queue:{
      schema:text(doc.schema||doc.type),
      libraryVersion:text(doc.version),
      renderPolicy:text(doc.renderPolicy),
      mediaTrendingPolicy:text(doc.mediaTrendingPolicy),
      promotionRule:plain(doc.promotionRule),
      rows
    },
    summary,
    blockingConditions:blockers
  };
}
function sessionDoc(member){
  return{ok:true,version:VERSION,session:{authenticated:true,roles:roles(member),readOnlyQueueAccess:true,authMode:text(member&&member.authMode)}};
}

exports.buildDiagnostic=diagnosticDoc;
exports.handler=async function(event){
  try{
    if(String(event&&event.httpMethod||"GET").toUpperCase()==="OPTIONS")return json(204,{});
    const method=String(event&&event.httpMethod||"GET").toUpperCase();
    if(method!=="GET")return json(405,{ok:false,error:"method_not_allowed"});
    const member=await resolveCurrentAdmin(event);
    requireRead(member);
    const action=lower((event.queryStringParameters||{}).action||"summary");
    const root=process.cwd();
    const stage=await candidateSnapshot(root);
    const publicDigest=publicSnapshotDigest(root);
    const doc=stage.doc||{};
    if(action==="session")return json(200,sessionDoc(member));
    if(action==="summary")return json(200,{ok:true,sourceMode:text(stage.sourceMode),storeError:stage.storeError||null,summary:summaryDoc(doc,publicDigest)});
    if(action==="candidates")return json(200,{ok:true,sourceMode:text(stage.sourceMode),storeError:stage.storeError||null,summary:summaryDoc(doc,publicDigest),candidates:(Array.isArray(doc.items)?doc.items:[]).map(normalizeRow).slice(0,10000)});
    if(action==="diagnostic")return json(200,diagnosticDoc(stage,publicDigest,member));
    return json(404,{ok:false,error:"지원하지 않는 조회 요청입니다."});
  }catch(error){
    return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:error&&error.code||null});
  }
};
