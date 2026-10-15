"use strict";
// IGDC Distribution-only guard. No changes to shared media/social/tour runtimes.
// Existing administrator selections, placements and front publication are
// authoritative. Transient remote-site failures are not deletion evidence.
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function hasPlacement(v){const p=obj(v);return !!(p.page&&(p.sectionKey||p.section||p.key));}
function establishedCandidate(rowInput){
  const row=obj(rowInput),p=obj(row.source_payload||row),control=obj(p.managementControl),queue=obj(p.queueControl),front=obj(p.frontPublication);
  return p.slotDecision==="slot_candidate"||hasPlacement(p.approvedPlacement)||hasPlacement(p.selectedPlacement)||hasPlacement(p.placement)
    || control.administratorLocked===true||control.aiReclassificationAllowed===false
    || queue.permanentExcluded===true
    || ["queued","publish_requested","matched","published","active","unpublish_requested","unpublish_failed"].includes(String(front.status||"").toLowerCase())
    || ["approved","revenue_ready","enrollable","published","active"].includes(String(row.status||"").toLowerCase());
}
function preserveDuringAutomation(currentInput,durableInput){
  const current=obj(currentInput),durable=obj(durableInput),payload=obj(durable.source_payload);
  if(!establishedCandidate(durable))return current;
  const recovered=Object.assign({},current,{candidateId:durable.id||current.candidateId||null});
  for(const key of ["slotDecision","approvedPlacement","selectedPlacement","placement","managementControl","frontPublication","queueControl","decisionSource","decisionAt","decisionBy"]){
    if(Object.prototype.hasOwnProperty.call(payload,key))recovered[key]=payload[key];
  }
  return recovered;
}
function isTemporaryAccessFailure(status){return /^(http_(?:401|403|408|409|425|429|5\d\d)|blocked|unavailable|inspection_error|timeout|fetch_failed|aborterror|access_temporarily_restricted)$/i.test(String(status||""));}
module.exports={establishedCandidate,preserveDuringAutomation,isTemporaryAccessFailure};
