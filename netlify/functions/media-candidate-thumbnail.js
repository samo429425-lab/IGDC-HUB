"use strict";

/**
 * Administrator-only thumbnail adapter for candidate review.
 * It first validates provider thumbnails. A browser-captured video frame may
 * then be stored in a dedicated public Supabase Storage bucket. It never
 * modifies media.snapshot.json or the Snapshot/Automap engines.
 */
const MediaStore=require("./lib/media-candidate-store.v1");
const SharedAdminAuth=require("./lib/global-slot-console-auth");

const VERSION="media-candidate-thumbnail-v1.4.0-card-hero-resolution-split";
const DEFAULT_BUCKET="media-candidate-thumbnails";
const MAX_IMAGE_BYTES=1572864;
const PROBE_TIMEOUT_MS=1600;
const PROBE_MAX_BYTES=65536;
const FRONT_MIN_WIDTH=320;
const FRONT_MIN_HEIGHT=180;
const HERO_MIN_WIDTH=1280;
const HERO_MIN_HEIGHT=720;

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
  if(yt){
    const enc=encodeURIComponent(yt);
    add("https://i.ytimg.com/vi/"+enc+"/maxresdefault.jpg","youtube_maxres");
    add("https://i.ytimg.com/vi/"+enc+"/sddefault.jpg","youtube_sd");
    add("https://i.ytimg.com/vi/"+enc+"/hqdefault.jpg","youtube_hq");
  }
  return output;
}
function imageDimensions(buffer,contentType){
  if(!Buffer.isBuffer(buffer)||buffer.length<10)return{width:0,height:0,format:""};
  const type=MediaStore.text(contentType).toLowerCase();
  try{
    if((type.includes("png")||(buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4e&&buffer[3]===0x47))&&buffer.length>=24){
      return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),format:"png"};
    }
    if(type.includes("gif")||buffer.slice(0,6).toString("ascii").match(/^GIF8[79]a$/)){
      return{width:buffer.readUInt16LE(6),height:buffer.readUInt16LE(8),format:"gif"};
    }
    if(type.includes("jpeg")||type.includes("jpg")||(buffer[0]===0xff&&buffer[1]===0xd8)){
      let offset=2;
      while(offset+9<buffer.length){
        if(buffer[offset]!==0xff){offset+=1;continue;}
        while(offset<buffer.length&&buffer[offset]===0xff)offset+=1;
        const marker=buffer[offset++];
        if(marker===0xd8||marker===0xd9)continue;
        if(marker===0xda)break;
        if(offset+2>buffer.length)break;
        const length=buffer.readUInt16BE(offset);
        if(length<2||offset+length>buffer.length)break;
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7){
          return{width:buffer.readUInt16BE(offset+5),height:buffer.readUInt16BE(offset+3),format:"jpeg"};
        }
        offset+=length;
      }
    }
  }catch(_error){}
  return{width:0,height:0,format:""};
}
async function responsePrefix(response,maxBytes){
  if(!response.body||typeof response.body.getReader!=="function")return Buffer.alloc(0);
  const reader=response.body.getReader(),parts=[];let total=0;
  try{
    while(total<maxBytes){
      const chunk=await reader.read();
      if(!chunk||chunk.done)break;
      const value=chunk.value;if(!value||!value.byteLength)continue;
      const take=Math.min(value.byteLength,maxBytes-total);
      parts.push(Buffer.from(value.buffer,value.byteOffset,take));total+=take;
      if(take<value.byteLength)break;
    }
  }finally{try{await reader.cancel();}catch(_error){}}
  return Buffer.concat(parts,total);
}
async function probeImage(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PROBE_TIMEOUT_MS);
  const started=Date.now();
  try{
    const response=await fetch(url,{
      method:"GET",redirect:"follow",signal:controller.signal,
      headers:Object.assign({},imageHeaders(),{range:"bytes=0-"+(PROBE_MAX_BYTES-1)})
    });
    const contentType=MediaStore.text(response.headers&&response.headers.get&&response.headers.get("content-type")).toLowerCase();
    const prefix=await responsePrefix(response,PROBE_MAX_BYTES);
    const dimensions=imageDimensions(prefix,contentType);
    const bytesRead=prefix.length;
    const dimensionKnown=dimensions.width>0&&dimensions.height>0;
    const frontReady=!dimensionKnown||(dimensions.width>=FRONT_MIN_WIDTH&&dimensions.height>=FRONT_MIN_HEIGHT);
    const heroReady=dimensionKnown&&dimensions.width>=HERO_MIN_WIDTH&&dimensions.height>=HERO_MIN_HEIGHT;
    return{
      ok:response.ok&&/^image\//.test(contentType)&&bytesRead>0&&frontReady,
      status:response.status,contentType,bytesRead,latencyMs:Date.now()-started,
      width:dimensions.width,height:dimensions.height,format:dimensions.format,dimensionKnown,frontReady,heroReady,
      url:MediaStore.normalizeUrl(response.url||url),
      reason:dimensionKnown&&!frontReady?"thumbnail_resolution_below_front_floor":undefined
    };
  }catch(error){
    return{
      ok:false,status:0,contentType:"",bytesRead:0,latencyMs:Date.now()-started,width:0,height:0,dimensionKnown:false,frontReady:false,heroReady:false,
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
  const probe=plain(record.probe);
  const width=Number(record.width||probe.width||0)||0,height=Number(record.height||probe.height||0)||0;
  record.width=width;record.height=height;
  record.frontReady=record.frontReady===true||probe.frontReady===true||(width>=FRONT_MIN_WIDTH&&height>=FRONT_MIN_HEIGHT);
  record.heroReady=record.heroReady===true||probe.heroReady===true||(width>=HERO_MIN_WIDTH&&height>=HERO_MIN_HEIGHT);
  sourceMetadata.thumbnailGeneration=record;
  sourceMetadata.thumbnailProbe=Object.assign({},plain(sourceMetadata.thumbnailProbe),probe,{url,width,height,frontReady:record.frontReady,heroReady:record.heroReady,verifiedAt:record.updatedAt});
  sourceMetadata.thumbnailWidth=width;sourceMetadata.thumbnailHeight=height;
  raw.sourceMetadata=sourceMetadata;
  raw.thumb_url=url;
  raw.thumbnailWidth=width;raw.thumbnailHeight=height;
  raw.thumbnailReady=record.frontReady;raw.heroThumbnailReady=record.heroReady;
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
  const mime=jpeg?"image/jpeg":"image/png",dimensions=imageDimensions(buffer,mime);
  return{buffer,mime,extension:jpeg?"jpg":"png",width:dimensions.width,height:dimensions.height};
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
    width:image.width,height:image.height,frontReady:image.width>=FRONT_MIN_WIDTH&&image.height>=FRONT_MIN_HEIGHT,heroReady:image.width>=HERO_MIN_WIDTH&&image.height>=HERO_MIN_HEIGHT,
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
        const section=MediaStore.normalizeSection(row.section_key||plain(row.raw).sectionKey);
        const heroSection=section==="media-movie"||section==="media-drama";
        // A provider image can be perfectly adequate for a 320x180 rail card but
        // still be too small for the expanded hero. Preserve that card thumbnail,
        // then ask the administrator browser to capture a 1280x720 video frame only
        // for the two hero-source sections. If capture fails, the stored card image
        // remains valid and the item simply stays out of the hero pool.
        if(heroSection&&probe.heroReady!==true){
          return MediaStore.response(200,{ok:true,version:VERSION,id,thumbUrl:"",cardThumbUrl:url,captureRequired:true,heroCaptureRequired:true,attempts,reason:"provider_thumbnail_below_hero_floor_capture_hd_frame"});
        }
        return MediaStore.response(200,{ok:true,version:VERSION,id,thumbUrl:url,cardThumbUrl:url,captureRequired:false,heroCaptureRequired:false,attempts});
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
