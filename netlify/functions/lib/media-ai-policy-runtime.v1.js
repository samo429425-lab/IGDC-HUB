"use strict";
const VERSION="media-ai-policy-runtime-v1.0.0";
const SECTION_KEYS=new Set(["media-trending","media-movie","media-drama","media-thriller","media-romance","media-variety","media-documentary","media-animation","media-music","media-shorts"]);
function text(v){return v==null?"":String(v).trim();}
function list(v){return Array.from(new Set((Array.isArray(v)?v:text(v).split(/[,\n]/)).map(text).filter(Boolean))).slice(0,50);}
function clamp(n,lo,hi,fallback){n=Number(n);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):fallback;}
function normalize(input){const p=input&&typeof input==="object"?input:{};const sectionKey=SECTION_KEYS.has(text(p.sectionKey))?text(p.sectionKey):"";return{version:VERSION,scopeType:/^(global|supplier|collector|pool|sections|section)$/.test(text(p.scopeType).toLowerCase())?text(p.scopeType).toLowerCase():"global",sectionKey,instructions:text(p.instructions).slice(0,5000),includeTopics:list(p.includeTopics),excludeTopics:list(p.excludeTopics),preferredContentTraits:list(p.preferredContentTraits),blockedContentTraits:list(p.blockedContentTraits),freshnessDays:clamp(p.freshnessDays,1,3650,180),minWidth:clamp(p.minWidth,320,7680,1280),minHeight:clamp(p.minHeight,180,4320,720),minSafetyScore:clamp(p.minSafetyScore,0,100,70),minQualityScore:clamp(p.minQualityScore,0,100,60),requireRightsVerified:p.requireRightsVerified!==false,requireThumbnail:p.requireThumbnail!==false,notes:list(p.notes)};}
function querySuffix(input){const p=normalize(input);return p.includeTopics.concat(p.preferredContentTraits).slice(0,10).join(" ");}
module.exports={VERSION,SECTION_KEYS,normalize,querySuffix,text,list};
