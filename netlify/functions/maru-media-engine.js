
/**
 * MARU MEDIA ENGINE
 * Future Media Generation / Processing Engine
 * Compatible with:
 *  - Collector v3
 *  - Planetary Connector
 *  - Quality Router v7
 *  - Resilience Engine
 */

"use strict";

const VERSION = "maru-media-engine-v1";

/* --------------------------------------------------
   CONFIG
-------------------------------------------------- */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/* --------------------------------------------------
   UTIL
-------------------------------------------------- */

function now(){
  return Date.now();
}

function s(x){
  return String(x==null?"":x);
}

function parseLimit(v){

  let n = parseInt(v || DEFAULT_LIMIT);

  if(isNaN(n)) n = DEFAULT_LIMIT;
  if(n > MAX_LIMIT) n = MAX_LIMIT;

  return n;
}

function sanitizeQuery(q){

  q = s(q).replace(/[<>]/g,"").trim();

  if(q.length > 200)
    q = q.slice(0,200);

  return q;
}

/* --------------------------------------------------
   MEDIA TYPE DETECTION
-------------------------------------------------- */

function detectMediaIntent(q){

  const t = q.toLowerCase();

  if(/video|movie|clip|watch/.test(t)) return "video";
  if(/image|photo|picture/.test(t)) return "image";
  if(/music|audio|song/.test(t)) return "audio";
  if(/3d|xr|vr|ar/.test(t)) return "xr";

  return "media";
}

/* --------------------------------------------------
   SOFTWARE GPU LAYER
-------------------------------------------------- */

async function softwareGPUProcess(job){

  return {
    processed:true,
    gpu:"software-gpu-layer",
    timestamp:now(),
    job
  };

}

/* --------------------------------------------------
   MEDIA AI PROCESSOR
-------------------------------------------------- */

async function aiMediaProcessor(query,type){

  const base = {
    title:query,
    timestamp:now()
  };

  if(type === "video"){
    return {
      ...base,
      mediaType:"video",
      format:"mp4",
      url:"https://media.igdcglobal.com/video/"+encodeURIComponent(query),
      score:0.8
    };
  }

  if(type === "image"){
    return {
      ...base,
      mediaType:"image",
      format:"png",
      url:"https://media.igdcglobal.com/image/"+encodeURIComponent(query),
      score:0.7
    };
  }

  if(type === "audio"){
    return {
      ...base,
      mediaType:"audio",
      format:"mp3",
      url:"https://media.igdcglobal.com/audio/"+encodeURIComponent(query),
      score:0.6
    };
  }

  if(type === "xr"){
    return {
      ...base,
      mediaType:"xr",
      format:"xr-scene",
      url:"https://media.igdcglobal.com/xr/"+encodeURIComponent(query),
      score:0.9
    };
  }

  return {
    ...base,
    mediaType:"media",
    url:"https://media.igdcglobal.com/media/"+encodeURIComponent(query),
    score:0.5
  };

}

/* --------------------------------------------------
   UPSCALE ENGINE
-------------------------------------------------- */

function upscaleMedia(item){

  return {
    ...item,
    enhanced:true,
    enhancement:"ai-upscale"
  };

}

/* --------------------------------------------------
   MEDIA GENERATION PIPELINE
-------------------------------------------------- */

async function generateMedia(query,type,limit){

  const items = [];

  for(let i=0;i<limit;i++){

    let media =
      await aiMediaProcessor(query,type);

    media =
      upscaleMedia(media);

    await softwareGPUProcess(media);

    items.push({
      ...media,
      engine:"media"
    });

  }

  return items;

}

/* --------------------------------------------------
   ENGINE CORE
-------------------------------------------------- */

async function runMediaEngine(event,params){

  const q = sanitizeQuery(params.q || params.query);

  const limit = parseLimit(params.limit);

  if(!q){

    return {
      status:"ok",
      engine:"maru-media-engine",
      version:VERSION,
      items:[]
    };

  }

  const intent =
    detectMediaIntent(q);

  const items =
    await generateMedia(q,intent,limit);

  return {

    status:"ok",
    engine:"maru-media-engine",
    version:VERSION,

    query:q,
    intent,

    items,

    meta:{
      generated:items.length
    }

  };

}

/* --------------------------------------------------
   NETLIFY HANDLER
-------------------------------------------------- */

exports.handler = async function(event){

  const params =
    event.queryStringParameters || {};

  const result =
    await runMediaEngine(event,params);

  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json",
      "Access-Control-Allow-Origin":"*"
    },
    body:JSON.stringify(result)
  };

};

/* --------------------------------------------------
   COLLECTOR COMPATIBILITY
-------------------------------------------------- */

exports.runEngine = async function(event,params){

  return await runMediaEngine(event,params || {});

};
