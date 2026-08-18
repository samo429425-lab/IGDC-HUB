"use strict";

/**
 * Administrator-only thumbnail adapter for candidate review.
 * It first validates provider thumbnails. A browser-captured video frame may
 * then be stored in a dedicated public Supabase Storage bucket. It never
 * modifies media.snapshot.json or the Snapshot/Automap engines.
 */
const MediaStore=require("./lib/media-candidate-store.v1");
const SharedAdminAuth=require("./lib/global-slot-console-auth");

const VERSION="media-candidate-thumbnail-v1.1.0-fast-early-frame";
const DEFAULT_BUCKET="media-candidate-thumbnails";
const MAX_IMAGE_BYTES=1572864;
const PROBE_TIMEOUT_MS=1800;

function plain(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function imageHeaders(){return{"accept":"image/*","user-agent":"IGDC-MARU-MediaThumbnail/1.0 (+https://igdc.info)"};}
function storageHeaders(cfg,extra){
  return Object.assign({apikey:cfg.key,Authorization:"Bearer "+cfg.key},extra||{});
}
function safeStoragePart(value){
  return MediaStore.text(value).replace(/[^A-Za-z0-9_.-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120);
}
async function actorFor(event){
  const actor=await SharedAdminAuth.resolveUser(event);
  SharedAdminAuth.requireCapability(actor,"mediaEdit");
  MediaStore.requireRole(actor,"write");
  return actor;
}
async function loadRow(id){
  const rows=await MediaStore.selectCandidates("select=*&id="+MediaStore.encodeEq(id)+"&limit=1");
  const row=Array.isArray(rows)&&rows[0];
  if(!row){
    const error=new Error("썸네일을 만들 후보를 찾지 못했습니다.");
    error.statusCode=404;error.code="media_candidate_not_found";throw error;
  }
  return row;
}
function youtubeId(value){
  const source=MediaStore.text(value);
  const match=source.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,20})/i);
  return match&&match[1]||"";
}
function providerCandidates(row){
  const raw=plain(row.raw),source=plain(raw.sourceMetadata);
  const output=[];
  function add(url,mode){
    url=MediaStore.normalizeUrl(url);
    if(url&&!output.some((item)=>item.url===url))output.push({url,mode});
  }
  add(row.thumb_url||raw.thumb_url||raw.thumbUrl,"stored");
  const iaId=safeStoragePart(source.identifier||(/^ia:(.+)$/i.exec(MediaStore.text(row.id))||[])[1]);
  if(iaId)add("https://archive.org/services/img/"+encodeURIComponent(iaId),"internet_archive");
  const yt=youtubeId(row.source_url||row.video_url||row.embed_url||raw.source_url||raw.video_url||raw.embed_url);
  if(yt)add("https://i.ytimg.com/vi/"+encodeURIComponent(yt)+"/hqdefault.jpg","youtube");
  return output;
}
async function probeImage(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PROBE_TIMEOUT_MS);
  const started=Date.now();
  try{
    const response=await fetch(url,{
      method:"GET",redirect:"follow",signal:controller.signal,
      headers:Object.assign({},imageHeaders(),{range:"bytes=0-4095"})
    });
    const contentType=MediaStore.text(response.headers&&response.headers.get&&response.headers.get("content-type")).toLowerCase();
    let bytesRead=0;
    if(response.body&&typeof response.body.getReader==="function"){
      const reader=response.body.getReader();
      const chunk=await reader.read();
      bytesRead=chunk&&chunk.value&&chunk.value.byteLength||0;
      try{await reader.cancel();}catch(_error){}
    }
    return{
      ok:response.ok&&/^image\//.test(contentType)&&bytesRead>0,
      status:response.status,contentType,bytesRead,latencyMs:Date.now()-started,
      url:MediaStore.normalizeUrl(response.url||url)
    };
  }catch(error){
    return{
      ok:false,status:0,contentType:"",bytesRead:0,latencyMs:Date.now()-started,
      url:MediaStore.normalizeUrl(url),
      reason:error&&error.name==="AbortError"?"thumbnail_probe_timeout":MediaStore.compact(error&&error.message||"thumbnail_probe_failed",180)
    };
  }finally{clearTimeout(timer);}
}
function generationPatch(row,url,generation,actor){
  const raw=Object.assign({},plain(row.raw));
  const sourceMetadata=Object.assign({},plain(raw.sourceMetadata));
  const record=Object.assign({},generation,{
    url,updatedAt:MediaStore.nowIso(),
    updatedBy:MediaStore.compact(actor.email||actor.memberId||"admin",200)
  });
  sourceMetadata.thumbnailGeneration=record;
  raw.sourceMetadata=sourceMetadata;
  raw.thumb_url=url;
  raw.thumbnailGeneration=record;
  return{
    thumb_url:url,raw,
    updated_by:record.updatedBy,
    updated_at:record.updatedAt
  };
}
async function storeResolved(row,url,generation,actor){
  const updated=await MediaStore.updateCandidates([row.id],generationPatch(row,url,generation,actor));
  return Array.isArray(updated)&&updated[0]||null;
}
async function storageRequest(cfg,path,init){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(cfg.url+path,Object.assign({},init||{},{
      signal:controller.signal,
      headers:storageHeaders(cfg,init&&init.headers)
    }));
    const body=await response.text();
    let parsed=null;try{parsed=body?JSON.parse(body):null;}catch(_error){parsed=body||null;}
    return{response,body:parsed,raw:body};
  }finally{clearTimeout(timer);}
}
async function ensurePublicBucket(cfg,bucket){
  const found=await storageRequest(cfg,"/storage/v1/bucket/"+encodeURIComponent(bucket),{method:"GET"});
  if(found.response.ok){
    if(found.body&&found.body.public===false){
      const error=new Error("썸네일 저장 버킷이 비공개입니다. 공개 후보 카드에서 읽을 수 있도록 전용 버킷을 public으로 설정해 주세요.");
      error.statusCode=503;error.code="media_thumbnail_bucket_not_public";throw error;
    }
    return;
  }
  if(found.response.status!==404){
    const error=new Error(found.body&&found.body.message||found.raw||"썸네일 저장 버킷을 확인하지 못했습니다.");
    error.statusCode=found.response.status;error.code="media_thumbnail_bucket_lookup_failed";throw error;
  }
  const created=await storageRequest(cfg,"/storage/v1/bucket",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      id:bucket,name:bucket,public:true,file_size_limit:MAX_IMAGE_BYTES,
      allowed_mime_types:["image/jpeg","image/png"]
    })
  });
  if(!created.response.ok&&created.response.status!==409){
    const error=new Error(created.body&&created.body.message||created.raw||"썸네일 저장 버킷을 만들지 못했습니다.");
    error.statusCode=created.response.status;error.code="media_thumbnail_bucket_create_failed";throw error;
  }
}
function decodeImage(dataUrl){
  const match=MediaStore.text(dataUrl).match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/);
  if(!match){
    const error=new Error("브라우저가 만든 JPEG 또는 PNG 프레임 데이터가 필요합니다.");
    error.statusCode=400;error.code="media_thumbnail_data_invalid";throw error;
  }
  const buffer=Buffer.from(match[2].replace(/\s+/g,""),"base64");
  if(!buffer.length||buffer.length>MAX_IMAGE_BYTES){
    const error=new Error("썸네일 프레임은 1.5MB 이하여야 합니다.");
    error.statusCode=413;error.code="media_thumbnail_too_large";throw error;
  }
  const jpeg=buffer[0]===0xff&&buffer[1]===0xd8;
  const png=buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4e&&buffer[3]===0x47;
  if(!jpeg&&!png){
    const error=new Error("썸네일 파일 서명이 JPEG 또는 PNG가 아닙니다.");
    error.statusCode=400;error.code="media_thumbnail_signature_invalid";throw error;
  }
  return{buffer,mime:jpeg?"image/jpeg":"image/png",extension:jpeg?"jpg":"png"};
}
async function uploadCapture(row,dataUrl,actor){
  const image=decodeImage(dataUrl);
  const cfg=MediaStore.config();
  const bucket=safeStoragePart(process.env.MEDIA_CANDIDATE_THUMBNAIL_BUCKET||DEFAULT_BUCKET);
  if(!bucket){
    const error=new Error("썸네일 저장 버킷 이름이 올바르지 않습니다.");
    error.statusCode=503;error.code="media_thumbnail_bucket_invalid";throw error;
  }
  await ensurePublicBucket(cfg,bucket);
  const objectName="media-candidates/"+safeStoragePart(row.id)+"-"+Date.now()+"."+image.extension;
  const objectPath=objectName.split("/").map(encodeURIComponent).join("/");
  const uploaded=await storageRequest(cfg,"/storage/v1/object/"+encodeURIComponent(bucket)+"/"+objectPath,{
    method:"POST",
    headers:{"content-type":image.mime,"x-upsert":"true"},
    body:image.buffer
  });
  if(!uploaded.response.ok){
    const error=new Error(uploaded.body&&uploaded.body.message||uploaded.raw||"썸네일 프레임 저장에 실패했습니다.");
    error.statusCode=uploaded.response.status;error.code="media_thumbnail_upload_failed";throw error;
  }
  const publicUrl=cfg.url+"/storage/v1/object/public/"+encodeURIComponent(bucket)+"/"+objectPath;
  await storeResolved(row,publicUrl,{
    version:VERSION,mode:"administrator_video_frame",mime:image.mime,bytes:image.buffer.length,
    bucket,objectName
  },actor);
  return publicUrl;
}

exports.handler=async function(event){
  if(event&&event.httpMethod==="OPTIONS")return MediaStore.response(204,{});
  try{
    if(!event||event.httpMethod!=="POST")return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const actor=await actorFor(event);
    const body=MediaStore.parseBody(event);
    const action=MediaStore.lower(body.action);
    const id=MediaStore.text(body.id||body.candidateId);
    if(!id){
      const error=new Error("썸네일 대상 후보 ID가 필요합니다.");
      error.statusCode=400;error.code="media_thumbnail_candidate_required";throw error;
    }
    const row=await loadRow(id);
    if(action==="resolve"){
      const candidates=providerCandidates(row).slice(0,3);
      // 공급사 썸네일 확인은 순차 대기하지 않고 동시에 짧게 검사한다.
      const attempts=await Promise.all(candidates.map(async(candidate)=>{
        const probe=await probeImage(candidate.url);
        return Object.assign({mode:candidate.mode},probe);
      }));
      const firstOkIndex=attempts.findIndex((probe)=>probe&&probe.ok);
      if(firstOkIndex>=0){
        const candidate=candidates[firstOkIndex],probe=attempts[firstOkIndex];
        const url=probe.url||candidate.url;
        await storeResolved(row,url,{version:VERSION,mode:"provider_thumbnail",providerMode:candidate.mode,probe},actor);
        return MediaStore.response(200,{ok:true,version:VERSION,id,thumbUrl:url,captureRequired:false,attempts});
      }
      const raw=plain(row.raw),source=plain(raw.sourceMetadata);
      const directVideo=MediaStore.normalizeUrl(row.video_url||raw.video_url)||
        (Array.isArray(source.playbackCandidates)&&source.playbackCandidates.map((item)=>MediaStore.normalizeUrl(item&&item.url)).find(Boolean))||"";
      return MediaStore.response(200,{
        ok:true,version:VERSION,id,thumbUrl:"",captureRequired:true,
        directVideoAvailable:!!directVideo,attempts,
        reason:directVideo?"provider_thumbnail_unavailable_use_admin_frame":"provider_thumbnail_and_direct_video_unavailable"
      });
    }
    if(action==="store_capture"){
      const thumbUrl=await uploadCapture(row,body.dataUrl,actor);
      return MediaStore.response(200,{ok:true,version:VERSION,id,thumbUrl,mode:"administrator_video_frame"});
    }
    return MediaStore.response(400,{ok:false,version:VERSION,error:"unsupported_thumbnail_action"});
  }catch(error){
    return MediaStore.response(error.statusCode||500,{
      ok:false,version:VERSION,error:error.code||"media_candidate_thumbnail_failed",
      message:error.message||String(error)
    });
  }
};
