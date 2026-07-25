"use strict";

/**
 * IGDC/MARU media candidate policy v2
 *
 * One fail-closed contract shared by collection, administrator review and
 * snapshot publication. Metadata/AI signals can quarantine a candidate, but
 * only deterministic prohibited-content signals can hard-block it.
 * Ordinary romance, dating, marriage and non-explicit affection are not
 * restricted by this policy.
 */
const VERSION = "media-candidate-policy-v2.0.0";

const VERIFIED_RIGHTS = new Set([
  "rights_verified_by_admin",
  "public_domain_verified",
  "cc0_verified",
  "cc_by_verified",
  "cc_by_sa_verified",
  "direct_license_verified"
]);
const ALLOWED_USE = new Set([
  "approved_for_snapshot",
  "approved_embed_or_link",
  "public_domain",
  "cc0",
  "cc_by",
  "cc_by_sa",
  "direct_license"
]);
const EXCLUSION_STATUSES = new Set([
  "search_excluded",
  "permanent_blocked"
]);

const CLEAR_PROHIBITED = [
  /\b(?:hentai|hardcore\s+porn|porn(?:ography|ographic)?|porno|pornhub|xvideos|xxx)\b/i,
  /\b(?:pornograf[ií]a|pornographie|porn[oô]|bokep)\b/i,
  /(?:포르노|야동|헨타이|ポルノ|ヘンタイ|アダルトビデオ|色情片|成人视频|成人影片)/i,
  /\b(?:explicit\s+sex|sex\s+tape|sex\s+video|adult\s+film)\b/i,
  /\b(?:bestiality|zoophilia|incest\s+porn|rape\s+porn|snuff)\b/i,
  /\b(?:loli|lolicon|shota|shotacon|underage|child)\b.{0,28}\b(?:sex|porn|nude|explicit)\b/i,
  /\b(?:sex|porn|nude|explicit)\b.{0,28}\b(?:loli|lolicon|shota|shotacon|underage|child)\b/i,
  /\breal\s+(?:murder|execution|torture|beheading)\b/i,
  /\b(?:terrorist\s+propaganda|white\s+supremac(?:y|ist)|neo[- ]?nazi\s+propaganda)\b/i
];
const ADULT_REVIEW = [
  /\b(?:nude|nudes|nudity|naked|uncensored|erotic|erotica|ecchi|harem)\b/i,
  /\b(?:desnudo|desnuda|desnudez|er[oó]tico|er[oó]tica|sem censura|sin censura)\b/i,
  /(?:성인물|선정성|노출|무삭제|19금|成人向け|無修正|ヌード|裸|エッチ|裸体|无码|后宫|後宮|अश्लील)/i,
  /\b(?:sexuality|sexual\s+content|sensual|fetish|bdsm|onlyfans|playboy)\b/i,
  /\b(?:adult\s+animation|adult\s+content|mature\s+audience|18\+|rated\s+x)\b/i,
  /\b(?:ullu|redtube|xnxx)\b/i
];
const PIRACY_REVIEW = [
  /\b(?:camrip|hdcam|telesync|dvdrip|bdrip|bluray\s*rip|webrip|web[- .]?dl)\b/i,
  /\b(?:torrent|pirated|cracked|warez)\b/i,
  /\b(?:full|complete)\s+(?:season|series|episode\s+pack)\b/i
];
const VIOLENCE_REVIEW = /\b(?:graphic\s+violence|gore\s+compilation|extreme\s+gore)\b/i;
const VIOLENCE_WARNING = /\b(?:violence|violent|blood|fight|weapon|gun|murder|horror|terror)\b/i;
const HORROR_WARNING = /\b(?:horror|terror|fear|scary)\b/i;
const ROMANCE_ONLY = /\b(?:romance|romantic|love\s+story|dating|marriage|melodrama|affection|kiss)\b/i;
const PUBLIC_DOMAIN = /\b(?:public\s*domain|cc0)\b|creativecommons\.org\/publicdomain/i;
const CC_LICENSE = /creativecommons\.org\/licenses\/(by|by-sa)(?:\/|\b)/i;
const NONCOMMERCIAL_LICENSE = /creativecommons\.org\/licenses\/(?:by-nc|by-nc-sa|by-nc-nd)(?:\/|\b)/i;

function text(value){
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f\u200b\u200c\u200d\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function lower(value){ return text(value).toLowerCase(); }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value){ return Array.isArray(value) ? value : (value == null ? [] : [value]); }
function uniq(values){ return Array.from(new Set(array(values).map(text).filter(Boolean))); }
function bool(value){
  if(value === true) return true;
  if(value === false || value == null) return false;
  return /^(?:1|true|yes|on)$/i.test(text(value));
}
function compactJson(value, max){
  try { return JSON.stringify(value).slice(0, max || 12000); } catch (_error) { return ""; }
}
function metadataText(input){
  const row=plain(input);
  const raw=plain(row.raw);
  const source=plain(row.sourceMetadata || raw.sourceMetadata);
  const rights=plain(row.rights || raw.rights);
  return [
    row.title, row.name, row.description, row.subject, row.collection, row.creator,
    row.notes, row.note, row.provider, row.source_host,
    raw.title, raw.description, raw.subject, raw.collection, raw.creator, raw.notes,
    source.title, source.description, source.subject, source.collection, source.creator,
    source.videoFile, rights.candidate, rights.status
  ].flatMap(array).map(text).filter(Boolean).join(" ");
}
function matchReasons(value, patterns, prefix){
  const reasons=[];
  patterns.forEach((pattern,index)=>{ if(pattern.test(value)) reasons.push(prefix+"_"+(index+1)); });
  return reasons;
}
function aiAssessment(input){
  const row=plain(input);
  const raw=plain(row.raw);
  const ai=plain(row.aiAssessment || row.ai_assessment || raw.aiAssessment || raw.ai_assessment);
  const verdict=lower(ai.verdict || ai.decision || ai.label);
  let confidence=Number(ai.confidence || ai.score || 0);
  if(confidence>1) confidence=confidence/100;
  confidence=Math.max(0,Math.min(1,Number.isFinite(confidence)?confidence:0));
  return {
    present:!!verdict,
    verdict,
    confidence,
    model:text(ai.model || ai.engine),
    reasons:uniq(ai.reasons || ai.labels)
  };
}
function assessSafety(input){
  const value=metadataText(input);
  const hardReasons=matchReasons(value,CLEAR_PROHIBITED,"prohibited_content");
  const reviewReasons=matchReasons(value,ADULT_REVIEW,"adult_context_review");
  if(VIOLENCE_REVIEW.test(value)) reviewReasons.push("graphic_violence_review");
  const ai=aiAssessment(input);
  if(ai.present && /(?:unsafe|adult|sexual|explicit|restricted|block)/.test(ai.verdict) && ai.confidence>=0.72){
    reviewReasons.push("ai_safety_review");
  }
  const warnings=[];
  if(VIOLENCE_WARNING.test(value)) warnings.push("폭력성");
  if(HORROR_WARNING.test(value)) warnings.push("공포");
  if(reviewReasons.some((reason)=>reason.indexOf("adult_context_review")===0)) warnings.push("성인성 검토");
  const romanceSignal=ROMANCE_ONLY.test(value);
  let decision="allow";
  if(hardReasons.length) decision="hard_block";
  else if(reviewReasons.length) decision="quarantine";
  return {
    decision,
    reasons:uniq(hardReasons.concat(reviewReasons)),
    warnings:uniq(warnings),
    ageRating:decision==="hard_block"?"18+":warnings.length?"15+":romanceSignal?"12+":"전체",
    romanceAllowed:romanceSignal && !hardReasons.length && !reviewReasons.length,
    ai
  };
}
function rightsText(input){
  const row=plain(input);
  const raw=plain(row.raw);
  const rights=plain(row.rights || raw.rights);
  const source=plain(row.sourceMetadata || raw.sourceMetadata);
  return [
    row.rights_status, row.allowed_use, row.license, row.licenseurl, row.license_url,
    rights.status, rights.candidate, rights.licenseUrl,
    raw.rights_status, raw.allowed_use, raw.license, raw.licenseurl,
    source.license, source.licenseurl, source.rights, source.usage,
    metadataText(input)
  ].flatMap(array).map(text).filter(Boolean).join(" ");
}
function assessRights(input){
  const row=plain(input);
  const value=rightsText(input);
  const piracyReasons=matchReasons(value,PIRACY_REVIEW,"piracy_signal");
  const status=lower(row.rights_status || row.rightsStatus || plain(row.rights).status);
  const allowedUse=lower(row.allowed_use || row.allowedUse || plain(row.rights).allowedUse);
  const verified=VERIFIED_RIGHTS.has(status) && ALLOWED_USE.has(allowedUse);
  const noncommercial=NONCOMMERCIAL_LICENSE.test(value);
  const publicDomain=PUBLIC_DOMAIN.test(value);
  const ccMatch=value.match(CC_LICENSE);
  const evidenceType=publicDomain?"public_domain_signal":ccMatch?("cc_"+lower(ccMatch[1]).replace(/-/g,"_")+"_signal"):"unverified";
  let decision="review";
  if(piracyReasons.length || noncommercial) decision="quarantine";
  if(verified) decision="verified";
  return {
    decision,
    verified,
    status,
    allowedUse,
    evidenceType,
    evidenceFound:publicDomain || !!ccMatch,
    reasons:uniq(piracyReasons.concat(noncommercial?["noncommercial_license_review"]:[]))
  };
}
function minDuration(section){
  const key=text(section);
  if(key==="media-shorts") return 180;
  if(key==="media-music") return 600;
  return 1200;
}
function qualityAssessment(input, options){
  const row=plain(input);
  const raw=plain(row.raw);
  const source=plain(row.sourceMetadata || raw.sourceMetadata);
  const section=text(row.section_key || row.sectionKey || raw.classifiedSection || raw.requestedSection);
  const duration=Number(row.durationSeconds || raw.durationSeconds || source.durationSeconds || 0);
  const height=Number(row.height || source.height || 0);
  const filename=text(source.videoFile || row.videoFile);
  const filenameHeight=Number((filename.match(/(?:^|[^0-9])(720|1080|1440|2160)p?(?:[^0-9]|$)/i)||[])[1]||0);
  const reasons=[];
  if(!duration) reasons.push("duration_unknown");
  else if(duration<minDuration(section)) reasons.push("full_length_duration_not_met");
  if(height && height<1080) reasons.push("actual_resolution_below_1080p");
  if(height>=1080 && filenameHeight && filenameHeight<1080) reasons.push("quality_metadata_filename_conflict");
  const requested=text(raw.requestedSection || source.requestedSection || row.requestedSection);
  const classified=text(raw.classifiedSection || source.classifiedSection || row.classifiedSection || section);
  const confidence=Number(raw.classificationConfidence || source.classificationConfidence || row.classificationConfidence || 0);
  if(requested && classified && requested!==classified && confidence>=80) reasons.push("strong_section_mismatch");
  if(options && options.adminException===true){
    const index=reasons.indexOf("full_length_duration_not_met");
    if(index>=0) reasons.splice(index,1);
  }
  return {decision:reasons.length?"quarantine":"allow",reasons:uniq(reasons),durationSeconds:duration,height,requestedSection:requested,classifiedSection:classified,classificationConfidence:confidence};
}
function assessCandidate(input, options){
  const safety=assessSafety(input);
  const rights=assessRights(input);
  const quality=qualityAssessment(input,options);
  const reasons=uniq(safety.reasons.concat(rights.reasons,quality.reasons));
  let decision="allow", reviewStatus="pending", riskLevel=rights.evidenceFound?"rights_review":"unverified";
  if(safety.decision==="hard_block"){
    decision="hard_block";reviewStatus="permanent_blocked";riskLevel="prohibited";
  }else if(safety.decision==="quarantine"){
    decision="quarantine";reviewStatus="safety_quarantine";riskLevel="adult_context_review";
  }else if(rights.decision==="quarantine"){
    decision="quarantine";reviewStatus="rights_quarantine";riskLevel="rights_risk";
  }else if(quality.decision==="quarantine"){
    decision="quarantine";reviewStatus=quality.reasons.includes("strong_section_mismatch")?"classification_quarantine":"quality_quarantine";riskLevel="manual_review";
  }
  return {version:VERSION,decision,reviewStatus,riskLevel,reasons,safety,rights,quality};
}
function releaseEligibility(row){
  const value=plain(row);
  const raw=plain(value.raw);
  const review=lower(value.review_status || value.reviewStatus);
  const verification=lower(value.verification_status || value.verificationStatus);
  const rightsStatus=lower(value.rights_status || value.rightsStatus || plain(value.rights).status);
  const allowedUse=lower(value.allowed_use || value.allowedUse || plain(value.rights).allowedUse);
  const administratorReview=plain(raw.administratorReview || value.administratorReview);
  const safety=assessSafety(value);
  const reasons=[];
  if(review!=="approved") reasons.push("review_not_approved");
  if(verification!=="approved_for_snapshot") reasons.push("verification_not_approved_for_snapshot");
  if(bool(value.candidate_only === undefined ? value.candidateOnly : value.candidate_only)) reasons.push("candidate_only");
  if(bool(value.seed_content === undefined ? value.seedContent : value.seed_content)) reasons.push("seed_content");
  if(!VERIFIED_RIGHTS.has(rightsStatus) || !ALLOWED_USE.has(allowedUse)) reasons.push("rights_not_administrator_verified");
  if(safety.decision==="hard_block") reasons.push("prohibited_content_detected");
  if(safety.decision==="quarantine" && administratorReview.contentSafe!==true) reasons.push("content_safety_confirmation_required");
  if(administratorReview.rightsSafe!==true) reasons.push("rights_confirmation_required");
  if(!text(administratorReview.note || value.review_note || value.reviewNote)) reasons.push("administrator_review_note_required");
  if(EXCLUSION_STATUSES.has(review)) reasons.push("excluded_or_permanent_blocked");
  return {ok:reasons.length===0,reasons:uniq(reasons),safety,rightsStatus,allowedUse};
}
function publicReleaseAllowed(item){
  const value=plain(item);
  const contract=plain(value.releaseContract || value.release_contract);
  if(contract.policy===VERSION && contract.eligible===true) return true;
  return releaseEligibility(value).ok;
}

module.exports={
  VERSION, VERIFIED_RIGHTS, ALLOWED_USE, EXCLUSION_STATUSES,
  text, lower, plain, array, uniq, bool, metadataText, aiAssessment,
  assessSafety, assessRights, qualityAssessment, assessCandidate,
  releaseEligibility, publicReleaseAllowed
};
