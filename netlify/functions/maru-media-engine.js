/**
 * maru-media-engine.js
 * ------------------------------------------------------------
 * IGDC / MARU Future Immersive Media Engine
 *
 * Purpose:
 * - High-level media hub over maru-media-adapter.js
 * - Bridge for Maru Search, Global Insight, Sanmaru, Media Player,
 *   Creator/Editor, Broadcaster, SNS Broadcaster, and future AI providers.
 * - Supports video, image, audio, news, SNS, live, XR, VR, AR, hologram,
 *   3D, spatial, volumetric and metaverse-ready media packages.
 *
 * Safety:
 * - No automatic SNS publishing.
 * - No automatic broadcast execution.
 * - No real AI call unless explicitly requested and provider module exists.
 *
 * CommonJS / Netlify Functions compatible.
 */
"use strict";

const VERSION = "maru-media-engine-v10.0.0-immersive-ai-final";

let Adapter = null;
function getAdapter(){
  if(Adapter) return Adapter;
  Adapter = require("./maru-media-adapter");
  return Adapter;
}

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function safeArray(v){ return Array.isArray(v) ? v : []; }
function bool(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const x = low(v);
  return !!x && !["0","false","no","off","disabled","null","undefined"].includes(x);
}
function safeRequire(name){
  try { return require(name); } catch(e){ return null; }
}
function isImmersiveType(type){
  return ["xr","vr","ar","hologram","3d","spatial","volumetric","metaverse"].includes(low(type));
}

function optionalAIProvider(){
  return (
    safeRequire("./maru-ai-media-bridge") ||
    safeRequire("./maru-ai-engine") ||
    safeRequire("./maru-intelligence-engine") ||
    null
  );
}

async function runOptionalAI(item, payload = {}){
  if(!bool(payload.ai) && !bool(payload.useAI) && !bool(payload.executeAI)) {
    return item;
  }

  const provider = optionalAIProvider();
  if(!provider) {
    return Object.assign({}, item, {
      aiExecution: {
        requested: true,
        executed: false,
        status: "provider_not_connected",
        note: "AI metadata is ready; provider bridge is not attached yet."
      }
    });
  }

  try{
    let result = null;
    if(typeof provider.runMediaAI === "function") result = await provider.runMediaAI(item, payload);
    else if(typeof provider.processMedia === "function") result = await provider.processMedia(item, payload);
    else if(typeof provider.runEngine === "function") result = await provider.runEngine({}, { action:"media-ai", item, payload });
    else if(typeof provider.process === "function") result = await provider.process({ item, payload });

    if(result && typeof result === "object"){
      return Object.assign({}, item, {
        aiExecution: {
          requested: true,
          executed: true,
          status: "ok",
          provider: provider.name || "maru-ai-provider"
        },
        aiResult: result
      });
    }
  }catch(e){
    return Object.assign({}, item, {
      aiExecution: {
        requested: true,
        executed: false,
        status: "error",
        error: String(e && e.message || e)
      }
    });
  }

  return Object.assign({}, item, {
    aiExecution: {
      requested: true,
      executed: false,
      status: "unsupported_provider_shape"
    }
  });
}

function attachEnginePackage(item, payload = {}){
  const mediaType = item.mediaType || item.type || "video";
  const immersive = item.immersive || {};
  const langs = safeArray(payload.languages).length ? safeArray(payload.languages) : [payload.lang || payload.language || "en", "ko"].filter(Boolean);

  return Object.assign({}, item, {
    mediaEngine: {
      version: VERSION,
      wrapped: true,
      autoPublish: false,
      autoBroadcast: false,
      maruSearchCompatible: true,
      sanmaruCompatible: true,
      globalInsightCompatible: true,
      creatorEditorCompatible: true,
      playerCompatible: true,
      broadcasterCompatible: true,
      aiCompatible: true,
      render: {
        mode:
          immersive.enabled ? immersive.renderMode :
          mediaType === "image" ? "image-card" :
          mediaType === "audio" ? "audio-card" :
          mediaType === "live" ? "live-video-card" :
          "video-card",
        immersive: !!immersive.enabled,
        adaptiveAspectRatio: true,
        subtitleReady: true,
        dubbingReady: true,
        detachedPaneReady: true,
        playerReady: true,
        deviceProfiles: immersive.deviceProfiles || ["mobile","desktop","tv","headset"]
      },
      immersiveBridge: {
        enabled: !!immersive.enabled,
        type: immersive.type || null,
        assetUrl: immersive.assetUrl || null,
        renderMode: immersive.renderMode || null,
        capabilities: immersive.capabilities || {},
        safety: immersive.safety || {},
        supported:
          isImmersiveType(mediaType) ||
          !!immersive.enabled
      },
      aiBridge: {
        enabled: true,
        execution: bool(payload.ai) || bool(payload.useAI) || bool(payload.executeAI) ? "requested" : "metadata_ready",
        provider: payload.aiProvider || "optional",
        tasks: [
          "summary",
          "transcript",
          "subtitle",
          "translation",
          "dubbing-script",
          "voice-dubbing",
          "thumbnail-prompt",
          "clip-plan",
          "social-copy",
          "rights-review",
          "safety-review",
          "immersive-scene-plan",
          "ar-overlay-plan",
          "vr-comfort-review",
          "hologram-stage-plan",
          "spatial-audio-plan",
          "3d-model-optimization"
        ],
        languages: langs
      },
      playerBridge: {
        enabled: true,
        packageKey: "mediaPackage.player",
        eventTargets: {
          impression: "/.netlify/functions/revenue-engine?action=track",
          watchTime: "/.netlify/functions/revenue-engine?action=track",
          spatialInteraction: "/.netlify/functions/revenue-engine?action=track",
          like: "/.netlify/functions/revenue-engine?action=track",
          recommend: "/.netlify/functions/revenue-engine?action=track"
        }
      },
      creatorEditorBridge: {
        enabled: true,
        packageKey: "mediaPackage.creatorEditor",
        projectMode: "metadata_ready",
        immersiveEditing: !!immersive.enabled
      },
      broadcasterBridge: {
        enabled: true,
        packageKey: "mediaPackage.broadcaster",
        approvalRequired: true,
        autoPublish: false,
        immersiveSafetyReviewRequired: !!immersive.enabled
      }
    }
  });
}

async function enrichItems(items, payload){
  const out = [];
  for(const item of safeArray(items)){
    const withEngine = attachEnginePackage(item, payload);
    out.push(await runOptionalAI(withEngine, payload));
  }
  return out;
}

async function runEngine(eventOrPayload = {}, params = {}){
  const payload = Object.assign(
    {},
    eventOrPayload && eventOrPayload.queryStringParameters ? eventOrPayload.queryStringParameters : eventOrPayload,
    params || {}
  );

  const action = low(payload.action || payload.mode || payload.fn || "search");
  const adapter = getAdapter();

  if(action === "health"){
    const h = adapter && typeof adapter.runEngine === "function"
      ? await adapter.runEngine({ action:"health" })
      : { ok:false };
    return {
      ok:true,
      status:"ok",
      engine:"maru-media-engine",
      version:VERSION,
      adapter:h,
      features:{
        adapterSafe:true,
        autoPublish:false,
        autoBroadcast:false,
        searchBankBridge:true,
        optionalMaruSearchBridge:true,
        globalInsightReady:true,
        maruSearchReady:true,
        sanmaruReady:true,
        aiBridgeReady:true,
        creatorEditorReady:true,
        mediaPlayerReady:true,
        broadcasterReady:true,
        immersiveReady:true,
        xr:true,
        vr:true,
        ar:true,
        hologram:true,
        threeD:true,
        spatial:true,
        volumetric:true,
        metaverse:true
      }
    };
  }

  if(action === "ai-subtitle" || action === "ai-dubbing" || action === "ai-summary" || action === "ai-edit-plan" || action === "ai-immersive-plan"){
    const item = payload.item || {
      id: payload.id || "manual",
      title: payload.title || payload.q || payload.query || "Untitled",
      summary: payload.summary || "",
      url: payload.url || payload.sceneUrl || payload.modelUrl || "#",
      sceneUrl: payload.sceneUrl || null,
      modelUrl: payload.modelUrl || null,
      mediaType: payload.mediaType || payload.type || "video"
    };
    const adapterItem = adapter.normalizeMediaItem ? adapter.normalizeMediaItem(item, Object.assign({}, payload, { ai:true })) : item;
    const enriched = await runOptionalAI(attachEnginePackage(adapterItem, Object.assign({}, payload, { ai:true })), Object.assign({}, payload, { ai:true }));
    return {
      ok:true,
      status:"ok",
      engine:"maru-media-engine",
      version:VERSION,
      action,
      item: enriched
    };
  }

  const result = adapter && typeof adapter.runEngine === "function"
    ? await adapter.runEngine(payload)
    : { ok:false, status:"error", items:[], results:[], error:"ADAPTER_UNAVAILABLE" };

  if(result && Array.isArray(result.items)){
    const items = await enrichItems(result.items, payload);
    return Object.assign({}, result, {
      ok: result.ok !== false,
      status: result.status || "ok",
      engine:"maru-media-engine",
      version:VERSION,
      adapterEngine: result.engine,
      items,
      results:items,
      meta:Object.assign({}, result.meta || {}, {
        mediaEngineWrapped:true,
        autoPublish:false,
        autoBroadcast:false,
        aiBridgeReady:true,
        creatorEditorReady:true,
        mediaPlayerReady:true,
        broadcasterReady:true,
        immersiveReady:true
      })
    });
  }

  return Object.assign({}, result, {
    engine:"maru-media-engine",
    version:VERSION,
    adapterEngine: result && result.engine
  });
}

function parseBody(event){
  if(!event) return {};
  if((event.httpMethod || "GET").toUpperCase() === "GET") return event.queryStringParameters || {};
  try{
    const raw = event.body || "";
    const text = event.isBase64Encoded ? Buffer.from(raw,"base64").toString("utf8") : raw;
    return text ? JSON.parse(text) : {};
  }catch(e){
    return event.queryStringParameters || {};
  }
}

function json(statusCode, body){
  return {
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*",
      "access-control-allow-headers":"content-type"
    },
    body:JSON.stringify(body)
  };
}

async function handler(event){
  try{
    const payload = parseBody(event || {});
    const result = await runEngine(payload);
    return json(200, result);
  }catch(e){
    return json(500, { ok:false, status:"error", engine:"maru-media-engine", version:VERSION, error:String(e && e.message || e) });
  }
}

module.exports = {
  VERSION,
  handler,
  runEngine,
  attachEnginePackage,
  enrichItems,
  runOptionalAI
};

if(require.main === module){
  runEngine({ action:"health" }).then(r => console.log(JSON.stringify(r,null,2))).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
