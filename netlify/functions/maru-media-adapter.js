/**
 * maru-media-adapter.js
 * ------------------------------------------------------------
 * IGDC / MARU Future Immersive Media Adapter
 *
 * Purpose:
 * - Supply/normalize media data for Maru Search, Global Insight, Search Bank,
 *   front pages, Media Player, Creator/Editor, Broadcaster, and AI bridge.
 * - Supports video, image, audio, news, sns, live, XR, VR, AR, hologram,
 *   3D, spatial, volumetric, and metaverse-ready media.
 *
 * Safety:
 * - Snapshot/SearchBank/MaruSearch first.
 * - External hooks only when explicitly requested.
 * - No auto-publish, no auto-broadcast, no automatic AI execution.
 *
 * CommonJS / Netlify Functions compatible.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "maru-media-adapter-v3.0.0-immersive-final";
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 300;

const MEDIA_TYPES = Object.freeze({
  VIDEO: "video",
  IMAGE: "image",
  AUDIO: "audio",
  NEWS: "news",
  SNS: "sns",
  LIVE: "live",
  XR: "xr",
  VR: "vr",
  AR: "ar",
  HOLOGRAM: "hologram",
  THREE_D: "3d",
  SPATIAL: "spatial",
  VOLUMETRIC: "volumetric",
  METAVERSE: "metaverse",
  DOCUMENT: "document",
  MEDIA: "media"
});

const IMMERSIVE_TYPES = new Set([
  MEDIA_TYPES.XR,
  MEDIA_TYPES.VR,
  MEDIA_TYPES.AR,
  MEDIA_TYPES.HOLOGRAM,
  MEDIA_TYPES.THREE_D,
  MEDIA_TYPES.SPATIAL,
  MEDIA_TYPES.VOLUMETRIC,
  MEDIA_TYPES.METAVERSE
]);

const DEVICE_PROFILES = [
  "mobile",
  "tablet",
  "desktop",
  "tv",
  "foldable",
  "headset",
  "ar-glasses",
  "vr-headset",
  "spatial-computer",
  "hologram-stage",
  "vehicle-display",
  "kiosk"
];

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function n(v, d = 0){ const x = Number(v); return Number.isFinite(x) ? x : d; }
function bool(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const x = low(v);
  return !!x && !["0","false","no","off","disabled","null","undefined"].includes(x);
}
function clampInt(v, d, min, max){
  const x = parseInt(v, 10);
  const y = Number.isFinite(x) ? x : d;
  return Math.max(min, Math.min(max, y));
}
function hash(v){ return crypto.createHash("sha1").update(String(v || "")).digest("hex").slice(0,16); }
function stableId(v){ return "media-" + hash(v); }
function nowIso(){ return new Date().toISOString(); }
function safeArray(v){ return Array.isArray(v) ? v : []; }
function validUrl(url){
  const v = s(url).trim();
  return !!v && v !== "#" && v !== "/" && !low(v).startsWith("javascript:");
}
function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./,""); }
  catch(e){ return ""; }
}
function readJson(file){
  try { return JSON.parse(fs.readFileSync(file,"utf8")); }
  catch(e){ return null; }
}
function exists(file){
  try { return fs.existsSync(file); }
  catch(e){ return false; }
}
function candidatePaths(name){
  return [
    path.join(process.cwd(), name),
    path.join(process.cwd(), "data", name),
    path.join(process.cwd(), "netlify", "functions", "data", name),
    path.join(process.cwd(), "functions", "data", name),
    path.join(__dirname, name),
    path.join(__dirname, "data", name)
  ];
}
function readFirstJson(name){
  for(const p of candidatePaths(name)){
    if(exists(p)) return { path:p, data:readJson(p) };
  }
  return { path:null, data:null };
}
function safeRequire(name){
  try { return require(name); } catch(e){ return null; }
}
function uniqBy(items, keyFn){
  const out = [];
  const seen = new Set();
  safeArray(items).forEach(item => {
    const key = s(keyFn(item)).trim().toLowerCase();
    if(!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

/* ------------------------------------------------------------
 * Media / immersive inference
 * ------------------------------------------------------------ */

function youtubeId(url){
  const u = s(url);
  let m = u.match(/[?&]v=([^&]+)/);
  if(m) return m[1];
  m = u.match(/youtu\.be\/([^?]+)/);
  if(m) return m[1];
  m = u.match(/youtube\.com\/shorts\/([^?]+)/);
  return m ? m[1] : "";
}
function thumbFromUrl(url){
  const id = youtubeId(url);
  if(id) return "https://img.youtube.com/vi/" + id + "/hqdefault.jpg";
  return "";
}
function mediaPlatform(raw){
  const url = s(raw.url || raw.link || raw.videoUrl || raw.href || raw.sceneUrl || raw.modelUrl);
  const host = domainOf(url);
  const text = low([raw.platform, raw.provider, raw.source && raw.source.name, host, url].join(" "));
  if(text.includes("youtube") || text.includes("youtu.be")) return "youtube";
  if(text.includes("tiktok")) return "tiktok";
  if(text.includes("instagram")) return "instagram";
  if(text.includes("facebook") || text.includes("fb.watch")) return "facebook";
  if(text.includes("vimeo")) return "vimeo";
  if(text.includes("x.com") || text.includes("twitter")) return "x";
  if(text.includes("naver")) return "naver";
  if(text.includes("kakao")) return "kakao";
  if(text.includes("netflix")) return "netflix";
  if(text.includes("unity")) return "unity";
  if(text.includes("unreal")) return "unreal";
  if(text.includes("webxr")) return "webxr";
  if(text.includes("spatial")) return "spatial";
  if(text.includes("news")) return "news";
  return raw.platform || raw.provider || host || "unknown";
}
function inferMediaType(raw, fallback){
  const txt = low([
    raw.type,
    raw.mediaType,
    raw.category,
    raw.section,
    raw.psom_key,
    raw.title,
    raw.summary,
    raw.url,
    raw.link,
    raw.sceneUrl,
    raw.modelUrl,
    raw.assetType,
    fallback
  ].join(" "));

  if(/hologram|holo|lightfield|holographic/.test(txt)) return MEDIA_TYPES.HOLOGRAM;
  if(/volumetric|pointcloud|point-cloud|gaussian|neural-radiance|nerf/.test(txt)) return MEDIA_TYPES.VOLUMETRIC;
  if(/spatial|visionpro|spatial-computer|spatialvideo|spatial-video/.test(txt)) return MEDIA_TYPES.SPATIAL;
  if(/\bvr\b|virtual reality|vr-headset|360/.test(txt)) return MEDIA_TYPES.VR;
  if(/\bar\b|augmented reality|ar-glasses|usdz|quicklook/.test(txt)) return MEDIA_TYPES.AR;
  if(/\bxr\b|mixed reality|mr\b|webxr/.test(txt)) return MEDIA_TYPES.XR;
  if(/3d|three_d|model|glb|gltf|obj|fbx|usd/.test(txt)) return MEDIA_TYPES.THREE_D;
  if(/metaverse|world|avatar|scene/.test(txt)) return MEDIA_TYPES.METAVERSE;
  if(/live|stream|broadcast/.test(txt)) return MEDIA_TYPES.LIVE;
  if(/image|photo|picture|img|gallery|thumbnail/.test(txt)) return MEDIA_TYPES.IMAGE;
  if(/audio|music|song|voice|podcast|radio/.test(txt)) return MEDIA_TYPES.AUDIO;
  if(/news|article|press|headline|journal/.test(txt)) return MEDIA_TYPES.NEWS;
  if(/sns|social|instagram|tiktok|reels|shorts|x\.com|twitter|facebook/.test(txt)) return MEDIA_TYPES.SNS;
  if(/document|pdf|paper|report/.test(txt)) return MEDIA_TYPES.DOCUMENT;
  if(/video|youtube|youtu\.be|vimeo|movie|drama|clip|shorts|media/.test(txt)) return MEDIA_TYPES.VIDEO;
  return fallback || MEDIA_TYPES.MEDIA;
}
function inferSection(raw, mediaType){
  const bind = raw.bind && typeof raw.bind === "object" ? raw.bind : {};
  const sec = s(raw.section || raw.psom_key || raw.category || raw._snapshotSection || bind.section);
  if(sec) return sec;
  if(mediaType === MEDIA_TYPES.NEWS) return "media-news";
  if(mediaType === MEDIA_TYPES.SNS) return "media-sns";
  if(mediaType === MEDIA_TYPES.IMAGE) return "media-image";
  if(mediaType === MEDIA_TYPES.AUDIO) return "media-audio";
  if(mediaType === MEDIA_TYPES.LIVE) return "media-live";
  if(IMMERSIVE_TYPES.has(mediaType)) return "media-immersive";
  return "media-video";
}
function metricsOf(raw){
  const m = raw.metrics && typeof raw.metrics === "object" ? raw.metrics : {};
  return {
    view: n(raw.views ?? raw.view ?? m.views ?? m.view),
    click: n(raw.clicks ?? raw.click ?? m.clicks ?? m.click),
    like: n(raw.likes ?? raw.like ?? m.likes ?? m.like),
    recommend: n(raw.recommend ?? raw.recommends ?? m.recommend ?? m.recommends),
    share: n(raw.shares ?? raw.share ?? m.shares ?? m.share),
    comment: n(raw.comments ?? raw.comment ?? m.comments ?? m.comment),
    watchTimeSec: n(raw.watchTimeSec ?? raw.watch_time_sec ?? raw.watchTime ?? m.watchTimeSec ?? m.watch_time_sec ?? m.watchTime),
    dwellSec: n(raw.avgDwellSeconds ?? raw.dwell ?? m.avgDwellSeconds ?? m.dwellSec),
    interactionSec: n(raw.interactionSec ?? m.interactionSec),
    spatialInteraction: n(raw.spatialInteraction ?? m.spatialInteraction),
    adImpression: n(raw.adImpressions ?? raw.impressions ?? m.adImpression ?? m.impressions),
    adClick: n(raw.adClicks ?? m.adClick)
  };
}
function isMediaLike(raw){
  if(!raw || typeof raw !== "object") return false;
  const txt = low([
    raw.type,
    raw.mediaType,
    raw.category,
    raw.section,
    raw.psom_key,
    raw.platform,
    raw.provider,
    raw.title,
    raw.summary,
    raw.url,
    raw.link,
    raw.videoUrl,
    raw.sceneUrl,
    raw.modelUrl,
    raw.assetType
  ].join(" "));
  return /media|video|youtube|youtu\.be|vimeo|tiktok|instagram|facebook|x\.com|twitter|movie|drama|shorts|clip|image|photo|audio|podcast|news|article|broadcast|sns|social|xr|vr|ar|hologram|holo|3d|gltf|glb|usdz|spatial|volumetric|metaverse|scene|live/.test(txt);
}
function queryScore(item, query){
  const q = low(query);
  if(!q) return 0.5;
  const text = low([item.title, item.summary, item.url, item.platform, item.section, item.tags && item.tags.join(" ")].join(" "));
  let score = 0.3;
  q.split(/\s+/).filter(Boolean).forEach(tok => {
    if(text.includes(tok)) score += 0.12;
  });
  return Math.min(1, score);
}

/* ------------------------------------------------------------
 * Trust / rights / immersive capability
 * ------------------------------------------------------------ */

function trustLists(){
  const allow = readFirstJson("trust.allowlist.json").data || {};
  const block = readFirstJson("trust.blocklist.json").data || {};
  return {
    allowDomains: (Array.isArray(allow.domains) ? allow.domains : Array.isArray(allow.allowlist) ? allow.allowlist : []).map(x => low(x)),
    blockDomains: (Array.isArray(block.domains) ? block.domains : Array.isArray(block.blocklist) ? block.blocklist : []).map(x => low(x))
  };
}
function riskOfUrl(url){
  const domain = low(domainOf(url));
  const lists = trustLists();

  if(!validUrl(url)) return { level:"placeholder", status:"warn", reason:"placeholder_or_missing_url", domain:null };
  if(lists.blockDomains.includes(domain)) return { level:"blocked", status:"error", reason:"domain_blocklisted", domain };
  if(lists.allowDomains.includes(domain)) return { level:"trusted", status:"ok", reason:"domain_allowlisted", domain };
  if(/^http:\/\//i.test(url)) return { level:"danger", status:"error", reason:"insecure_http", domain };
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return { level:"danger", status:"error", reason:"ip_direct_endpoint", domain };
  return { level:"unverified", status:"warn", reason:"unverified_domain", domain };
}
function rightsPolicy(raw, url){
  const platform = mediaPlatform(raw);
  const external = validUrl(url);
  return {
    status: raw.rightsStatus || "unknown",
    copyrightCheckRequired: true,
    sourceAttributionRequired: external,
    allowedUse: raw.allowedUse || (external ? "link_embed_or_summary_only" : "owned_or_internal_review_required"),
    downloadAllowed: bool(raw.downloadAllowed),
    editAllowed: bool(raw.editAllowed),
    remixAllowed: bool(raw.remixAllowed),
    aiTrainingAllowed: bool(raw.aiTrainingAllowed),
    aiTransformAllowed: bool(raw.aiTransformAllowed),
    platformTermsRequired: platform !== "unknown",
    provider: raw.provider || platform
  };
}
function immersiveProfile(raw, mediaType){
  const url = s(raw.url || raw.link || raw.sceneUrl || raw.modelUrl || raw.assetUrl);
  const assetFormat = low(raw.assetFormat || raw.format || (
    /\.glb($|\?)/i.test(url) ? "glb" :
    /\.gltf($|\?)/i.test(url) ? "gltf" :
    /\.usdz($|\?)/i.test(url) ? "usdz" :
    /\.obj($|\?)/i.test(url) ? "obj" :
    /\.fbx($|\?)/i.test(url) ? "fbx" :
    /\.mp4($|\?)/i.test(url) ? "mp4" :
    "unknown"
  ));

  const immersive = IMMERSIVE_TYPES.has(mediaType);
  return {
    enabled: immersive,
    type: immersive ? mediaType : null,
    assetUrl: raw.assetUrl || raw.sceneUrl || raw.modelUrl || (immersive ? url : null),
    sceneUrl: raw.sceneUrl || null,
    modelUrl: raw.modelUrl || null,
    assetFormat,
    renderMode:
      mediaType === MEDIA_TYPES.HOLOGRAM ? "hologram-stage" :
      mediaType === MEDIA_TYPES.VOLUMETRIC ? "volumetric" :
      mediaType === MEDIA_TYPES.SPATIAL ? "spatial" :
      mediaType === MEDIA_TYPES.AR ? "ar-overlay" :
      mediaType === MEDIA_TYPES.VR ? "vr-scene" :
      mediaType === MEDIA_TYPES.XR ? "xr-scene" :
      mediaType === MEDIA_TYPES.THREE_D ? "3d-model" :
      mediaType === MEDIA_TYPES.METAVERSE ? "metaverse-world" :
      "none",
    deviceProfiles:
      mediaType === MEDIA_TYPES.HOLOGRAM ? ["hologram-stage", "desktop", "tv"] :
      mediaType === MEDIA_TYPES.AR ? ["mobile", "tablet", "ar-glasses", "spatial-computer"] :
      mediaType === MEDIA_TYPES.VR ? ["vr-headset", "desktop"] :
      mediaType === MEDIA_TYPES.SPATIAL ? ["spatial-computer", "headset", "desktop"] :
      immersive ? ["headset", "desktop", "mobile"] : [],
    capabilities: {
      headTracking: [MEDIA_TYPES.VR, MEDIA_TYPES.XR, MEDIA_TYPES.SPATIAL, MEDIA_TYPES.METAVERSE].includes(mediaType),
      handTracking: [MEDIA_TYPES.XR, MEDIA_TYPES.AR, MEDIA_TYPES.SPATIAL, MEDIA_TYPES.METAVERSE].includes(mediaType),
      spatialAudio: [MEDIA_TYPES.VR, MEDIA_TYPES.XR, MEDIA_TYPES.SPATIAL, MEDIA_TYPES.VOLUMETRIC, MEDIA_TYPES.HOLOGRAM].includes(mediaType),
      depthMap: [MEDIA_TYPES.AR, MEDIA_TYPES.XR, MEDIA_TYPES.SPATIAL, MEDIA_TYPES.VOLUMETRIC].includes(mediaType),
      occlusion: [MEDIA_TYPES.AR, MEDIA_TYPES.XR, MEDIA_TYPES.SPATIAL].includes(mediaType),
      lightEstimation: [MEDIA_TYPES.AR, MEDIA_TYPES.XR, MEDIA_TYPES.HOLOGRAM].includes(mediaType),
      multiUser: [MEDIA_TYPES.METAVERSE, MEDIA_TYPES.XR, MEDIA_TYPES.VR].includes(mediaType),
      avatarReady: [MEDIA_TYPES.METAVERSE, MEDIA_TYPES.XR, MEDIA_TYPES.VR].includes(mediaType)
    },
    safety: {
      motionComfortCheck: [MEDIA_TYPES.VR, MEDIA_TYPES.XR].includes(mediaType),
      photosensitiveWarning: mediaType === MEDIA_TYPES.VR || mediaType === MEDIA_TYPES.HOLOGRAM,
      boundaryRequired: mediaType === MEDIA_TYPES.VR || mediaType === MEDIA_TYPES.XR,
      humanApprovalRequired: true
    }
  };
}
function aiReadiness(raw, mediaType, ctx){
  const hasTranscript = !!(raw.transcript || raw.captions || raw.subtitles);
  const hasUrl = validUrl(raw.url || raw.link || raw.videoUrl || raw.sceneUrl || raw.modelUrl);
  const lang = ctx.lang || ctx.language || raw.language || "auto";
  const targetLanguages = safeArray(ctx.languages).length ? safeArray(ctx.languages) : [lang, "en", "ko"].filter(Boolean);
  const immersive = IMMERSIVE_TYPES.has(mediaType);

  return {
    enabled: true,
    execution: bool(ctx.ai) || bool(ctx.useAI) ? "requested" : "metadata_ready",
    provider: ctx.aiProvider || "maru-ai-bridge",
    tasks: {
      summarize: true,
      titleGenerate: true,
      transcriptExtract: mediaType === MEDIA_TYPES.VIDEO || mediaType === MEDIA_TYPES.AUDIO || mediaType === MEDIA_TYPES.LIVE,
      subtitleGenerate: mediaType === MEDIA_TYPES.VIDEO || mediaType === MEDIA_TYPES.AUDIO || mediaType === MEDIA_TYPES.LIVE,
      translate: true,
      dubbingScript: mediaType === MEDIA_TYPES.VIDEO || mediaType === MEDIA_TYPES.AUDIO || mediaType === MEDIA_TYPES.LIVE,
      voiceDubbing: mediaType === MEDIA_TYPES.VIDEO || mediaType === MEDIA_TYPES.AUDIO || mediaType === MEDIA_TYPES.LIVE,
      thumbnailPrompt: true,
      safetyReview: true,
      rightsReview: true,
      sceneCut: mediaType === MEDIA_TYPES.VIDEO || mediaType === MEDIA_TYPES.LIVE,
      shortClip: mediaType === MEDIA_TYPES.VIDEO || mediaType === MEDIA_TYPES.LIVE || mediaType === MEDIA_TYPES.SNS,
      socialPost: true,
      immersiveScenePlan: immersive,
      arOverlayPlan: mediaType === MEDIA_TYPES.AR || mediaType === MEDIA_TYPES.XR,
      vrComfortReview: mediaType === MEDIA_TYPES.VR || mediaType === MEDIA_TYPES.XR,
      hologramStagePlan: mediaType === MEDIA_TYPES.HOLOGRAM,
      spatialAudioPlan: immersive,
      modelOptimization: mediaType === MEDIA_TYPES.THREE_D || mediaType === MEDIA_TYPES.AR || mediaType === MEDIA_TYPES.VR || mediaType === MEDIA_TYPES.XR
    },
    inputs: {
      hasUrl,
      hasTranscript,
      textSeed: s(raw.transcript || raw.summary || raw.description || raw.title).slice(0, 1200),
      sourceLanguage: lang,
      targetLanguages: Array.from(new Set(targetLanguages.map(x => low(x)).filter(Boolean))).slice(0, 12)
    },
    outputs: {
      summary: null,
      transcript: raw.transcript || null,
      subtitles: raw.subtitles || null,
      dubbing: raw.dubbing || null,
      thumbnailPrompt: null,
      editPlan: null,
      immersiveScenePlan: null,
      safetyReview: null
    }
  };
}

/* ------------------------------------------------------------
 * Media package builders
 * ------------------------------------------------------------ */

function buildPlayerPackage(item, ctx){
  const immersive = item.immersive || {};
  return {
    ready: true,
    playerType:
      IMMERSIVE_TYPES.has(item.mediaType) ? "immersive" :
      item.mediaType === MEDIA_TYPES.AUDIO ? "audio" :
      item.mediaType === MEDIA_TYPES.IMAGE ? "image" :
      "video",
    url: item.url,
    thumb: item.thumb,
    title: item.title,
    provider: item.provider,
    platform: item.platform,
    embedReady: item.media && item.media.embedReady,
    immersiveReady: !!immersive.enabled,
    renderMode: immersive.renderMode || item.media.renderMode,
    deviceProfiles: immersive.deviceProfiles && immersive.deviceProfiles.length ? immersive.deviceProfiles : DEVICE_PROFILES,
    subtitles: {
      enabled: true,
      tracks: item.ai && item.ai.outputs && item.ai.outputs.subtitles ? item.ai.outputs.subtitles : [],
      requestEndpoint: "/.netlify/functions/maru-media-engine?action=ai-subtitle"
    },
    dubbing: {
      enabled: true,
      voices: item.ai && item.ai.outputs && item.ai.outputs.dubbing ? item.ai.outputs.dubbing : [],
      requestEndpoint: "/.netlify/functions/maru-media-engine?action=ai-dubbing"
    },
    spatial: {
      enabled: !!immersive.enabled,
      spatialAudio: immersive.capabilities && immersive.capabilities.spatialAudio,
      headTracking: immersive.capabilities && immersive.capabilities.headTracking,
      handTracking: immersive.capabilities && immersive.capabilities.handTracking,
      arOverlay: item.mediaType === MEDIA_TYPES.AR,
      hologramStage: item.mediaType === MEDIA_TYPES.HOLOGRAM
    },
    tracking: {
      impressionTrackId: item.id + "-player-imp",
      clickTrackId: item.id + "-player-click",
      watchTimeTrackId: item.id + "-watch",
      spatialInteractionTrackId: item.id + "-spatial",
      revenueEventEndpoint: "/.netlify/functions/revenue-engine?action=track"
    },
    detachedPaneReady: true,
    creatorEditorReady: true
  };
}
function buildCreatorEditorPackage(item, ctx){
  const immersive = item.immersive || {};
  return {
    ready: true,
    editorProjectId: "edit-" + hash(item.id + item.title),
    source: {
      url: item.url,
      title: item.title,
      thumb: item.thumb,
      mediaType: item.mediaType,
      provider: item.provider,
      immersiveAssetUrl: immersive.assetUrl || null,
      assetFormat: immersive.assetFormat || null
    },
    timeline: {
      scenes: [],
      markers: [],
      autoSceneDetectionReady: item.mediaType === MEDIA_TYPES.VIDEO || item.mediaType === MEDIA_TYPES.LIVE,
      spatialTimelineReady: !!immersive.enabled,
      volumetricTrackReady: item.mediaType === MEDIA_TYPES.VOLUMETRIC || item.mediaType === MEDIA_TYPES.HOLOGRAM
    },
    aiTools: {
      summarize: true,
      rewriteTitle: true,
      generateCaption: true,
      generateShorts: item.mediaType === MEDIA_TYPES.VIDEO || item.mediaType === MEDIA_TYPES.LIVE || item.mediaType === MEDIA_TYPES.SNS,
      subtitle: true,
      translate: true,
      dubbing: true,
      thumbnail: true,
      safetyReview: true,
      rightsReview: true,
      immersiveScenePlan: !!immersive.enabled,
      arOverlayPlan: item.mediaType === MEDIA_TYPES.AR || item.mediaType === MEDIA_TYPES.XR,
      vrComfortReview: item.mediaType === MEDIA_TYPES.VR || item.mediaType === MEDIA_TYPES.XR,
      hologramStagePlan: item.mediaType === MEDIA_TYPES.HOLOGRAM,
      modelOptimization: item.mediaType === MEDIA_TYPES.THREE_D || !!immersive.enabled
    },
    exportProfiles: ["player", "shorts", "sns-card", "broadcast-pack", "article-card", "immersive-scene", "ar-overlay", "hologram-stage"]
  };
}
function buildBroadcasterPackage(item, ctx){
  const targets = safeArray(ctx.broadcastTargets).length ? safeArray(ctx.broadcastTargets) : ["youtube", "instagram", "tiktok", "x", "facebook", "web", "app"];
  return {
    ready: true,
    autoPublish: false,
    approvalRequired: true,
    targets,
    suggested: targets.map(channel => ({
      channel,
      status: "candidate",
      publishNow: false,
      requiresCredential: true,
      supportsImmersive: ["web", "app"].includes(channel) || (item.mediaType !== MEDIA_TYPES.HOLOGRAM && item.mediaType !== MEDIA_TYPES.VOLUMETRIC)
    })),
    scheduleReady: true,
    policy: {
      requireHumanApproval: true,
      copyrightCheckRequired: true,
      platformTermsRequired: true,
      immersiveSafetyReviewRequired: IMMERSIVE_TYPES.has(item.mediaType)
    }
  };
}
function buildInsightPackage(item, ctx){
  return {
    ready: true,
    query: ctx.query || "",
    region: ctx.region || item.region || null,
    country: ctx.country || item.country || null,
    useCases: ["global-insight", "search-result", "media-reference", "news-context", "sns-context", "immersive-context"],
    summarySeed: s(item.summary || item.title).slice(0, 800),
    citation: {
      title: item.title,
      url: item.url,
      provider: item.provider,
      platform: item.platform
    }
  };
}

function normalizeMediaItem(raw, ctx = {}){
  raw = raw || {};
  const url = s(raw.url || raw.link || raw.href || raw.videoUrl || raw.video || raw.sceneUrl || raw.modelUrl || raw.assetUrl || "");
  const mediaType = inferMediaType(raw, ctx.mediaType || ctx.type);
  const platform = mediaPlatform(raw);
  const section = inferSection(raw, mediaType);
  const id = s(raw.id || raw.contentId || raw.slotId || url || raw.title) || stableId(JSON.stringify(raw));
  const thumb = s(raw.thumb || raw.thumbnail || raw.image || raw.poster || thumbFromUrl(url) || "/assets/img/placeholder.png");
  const metrics = metricsOf(raw);
  const title = s(raw.title || raw.name || raw.label || ctx.query || "Untitled Media");
  const summary = s(raw.summary || raw.description || raw.snippet || raw.caption || "");
  const score = Math.max(n(raw.score, 0), n(raw.qualityScore, 0), queryScore({ title, summary, url, platform, section, tags: raw.tags }, ctx.query));
  const risk = riskOfUrl(url);
  const rights = rightsPolicy(raw, url);
  const immersive = immersiveProfile(raw, mediaType);
  const ai = aiReadiness(raw, mediaType, ctx);

  const base = Object.assign({}, raw, {
    id,
    contentId: raw.contentId || id,
    title,
    summary,
    url: url || "#",
    link: url || "#",
    thumb,
    thumbnail: raw.thumbnail || thumb,
    image: raw.image || thumb,
    type: mediaType === MEDIA_TYPES.VIDEO ? "video" : (raw.type || mediaType),
    mediaType,
    platform,
    provider: raw.provider || raw.source && raw.source.name || platform,
    source: raw.source || platform,
    page: raw.page || raw._snapshotPage || "media",
    channel: raw.channel || "media",
    section,
    psom_key: raw.psom_key || section,
    route: raw.route || ["media", section].join("."),
    region: raw.region || ctx.region || null,
    country: raw.country || ctx.country || null,
    language: raw.language || ctx.lang || ctx.language || null,
    publishedAt: raw.publishedAt || raw.published_at || raw.createdAt || raw.timestamp || null,
    score,
    qualityScore: n(raw.qualityScore, score),
    metrics,
    risk,
    rights,
    immersive,
    ai,
    media: {
      enabled: true,
      type: mediaType,
      platform,
      provider: raw.provider || platform,
      url: url || "#",
      thumb,
      external: validUrl(url),
      embedReady: ["youtube","vimeo","tiktok","instagram","facebook","x"].includes(platform),
      transcriptReady: !!raw.transcript,
      subtitleReady: !!raw.subtitles,
      dubbingReady: !!raw.dubbing,
      renderMode: immersive.enabled ? immersive.renderMode : (mediaType === MEDIA_TYPES.IMAGE ? "image" : mediaType === MEDIA_TYPES.AUDIO ? "audio" : "video")
    },
    monetization: Object.assign({}, raw.monetization || {}, {
      impression: Object.assign({
        enabled: true,
        provider: raw.adProvider || "igdc-media-ad",
        trackId: (raw.trackId || id) + "-media-imp",
        cpmKey: mediaType === MEDIA_TYPES.VIDEO || mediaType === MEDIA_TYPES.LIVE ? "video_cpm_usd" : "banner_cpm_usd"
      }, raw.monetization && raw.monetization.impression || {}),
      engagement: Object.assign({
        enabled: true,
        minSeconds: IMMERSIVE_TYPES.has(mediaType) ? 30 : 15,
        rewardType: IMMERSIVE_TYPES.has(mediaType) ? "spatial_interaction" : (mediaType === MEDIA_TYPES.VIDEO ? "watch_time" : "media_engagement")
      }, raw.monetization && raw.monetization.engagement || {})
    }),
    mediaRevenue: Object.assign({
      enabled: true,
      model: IMMERSIVE_TYPES.has(mediaType) ? "ads_spatial_interaction_license" : "ads_affiliate_watchtime_engagement",
      watchTimeSec: metrics.watchTimeSec,
      dwellSec: metrics.dwellSec,
      interactionSec: metrics.interactionSec,
      spatialInteraction: metrics.spatialInteraction,
      view: metrics.view,
      click: metrics.click,
      like: metrics.like,
      recommend: metrics.recommend,
      share: metrics.share
    }, raw.mediaRevenue || {}),
    linkRevenue: raw.linkRevenue || {
      enabled: validUrl(url),
      trackId: id + "-media-link",
      providers: [platform],
      commission: 0,
      conversionTrack: true,
      url: url || "#"
    },
    _adapter: {
      name: "maru-media-adapter",
      version: VERSION,
      normalizedAt: nowIso(),
      inputSource: raw.source || raw.provider || raw._source || "unknown"
    }
  });

  base.mediaPackage = {
    version: "media-package-v2-immersive",
    id,
    player: buildPlayerPackage(base, ctx),
    creatorEditor: buildCreatorEditorPackage(base, ctx),
    broadcaster: buildBroadcasterPackage(base, ctx),
    insight: buildInsightPackage(base, ctx),
    ai,
    rights,
    risk,
    immersive
  };

  return base;
}

/* ------------------------------------------------------------
 * Snapshot extraction
 * ------------------------------------------------------------ */

function extractItemsFromSnapshot(snapshot){
  const out = [];
  function push(item, meta){
    if(!item || typeof item !== "object") return;
    out.push(Object.assign({}, item, {
      _snapshotPage: item._snapshotPage || meta.page,
      _snapshotSection: item._snapshotSection || meta.section,
      _source: meta.source
    }));
  }

  if(Array.isArray(snapshot)) snapshot.forEach(x => push(x, {}));
  if(snapshot && Array.isArray(snapshot.items)) snapshot.items.forEach(x => push(x, { source:"items" }));
  if(snapshot && Array.isArray(snapshot.results)) snapshot.results.forEach(x => push(x, { source:"results" }));

  if(snapshot && snapshot.pages && typeof snapshot.pages === "object"){
    Object.keys(snapshot.pages).forEach(page => {
      const sections = snapshot.pages[page] && snapshot.pages[page].sections || {};
      Object.keys(sections).forEach(section => {
        const sec = sections[section];
        if(Array.isArray(sec)) sec.forEach(x => push(x, { page, section, source:"pages.sections" }));
        else if(sec && Array.isArray(sec.slots)) sec.slots.forEach(x => push(x, { page, section, source:"pages.sections.slots" }));
      });
    });
  }

  if(snapshot && snapshot.sections && typeof snapshot.sections === "object"){
    Object.keys(snapshot.sections).forEach(section => {
      const sec = snapshot.sections[section];
      if(Array.isArray(sec)) sec.forEach(x => push(x, { section, source:"sections" }));
      else if(sec && Array.isArray(sec.slots)) sec.slots.forEach(x => push(x, { section, source:"sections.slots" }));
    });
  }

  return out;
}

function loadSnapshotMedia(){
  const files = [
    "media.snapshot.json",
    "social.snapshot.json",
    "search-bank.snapshot.json",
    "front.snapshot.json"
  ];
  const items = [];
  const sources = [];

  files.forEach(name => {
    const pack = readFirstJson(name);
    if(pack.data){
      const extracted = extractItemsFromSnapshot(pack.data).filter(isMediaLike);
      extracted.forEach(x => items.push(x));
      sources.push({ name, path:pack.path, count:extracted.length });
    }
  });

  return { items, sources };
}

/* ------------------------------------------------------------
 * Source bridges
 * ------------------------------------------------------------ */

async function fromSearchBank(ctx){
  const mod = safeRequire("./search-bank-engine");
  if(!mod || typeof mod.runEngine !== "function") return { items:[], source:null };

  try{
    const params = {
      q: ctx.query,
      query: ctx.query,
      limit: Math.min(ctx.limit * 2, 200),
      channel: "media",
      type: ctx.mediaType === MEDIA_TYPES.IMAGE ? "image" : ctx.mediaType,
      region: ctx.region,
      country: ctx.country,
      external: ctx.external,
      noExternal: ctx.noExternal,
      disableExternal: ctx.disableExternal,
      from: "media-adapter"
    };
    const res = await mod.runEngine({}, params);
    const items = safeArray(res && (res.items || res.results || res.data && res.data.items)).filter(isMediaLike);
    return { items, source:"search-bank", meta:res && res.meta || null };
  }catch(e){
    return { items:[], source:"search-bank", error:String(e && e.message || e) };
  }
}

async function fromMaruSearch(ctx){
  if(!bool(ctx.useMaruSearch) && !bool(ctx.viaMaruSearch)) return { items:[], source:null };
  if(low(ctx.from) === "maru-search" || low(ctx.source) === "maru-search") return { items:[], source:null };

  const mod = safeRequire("./maru-search");
  if(!mod || typeof mod.runEngine !== "function") return { items:[], source:null };

  try{
    const params = {
      q: ctx.query,
      query: ctx.query,
      limit: Math.min(ctx.limit * 2, 200),
      type: ctx.mediaType,
      category: "media",
      noRevenue: 1,
      noAnalytics: 1,
      from: "media-adapter",
      mediaAdapter: "off"
    };
    const res = await mod.runEngine({ queryStringParameters: params }, params);
    const items = safeArray(res && (res.items || res.results || res.data && res.data.items || res.baseResult && res.baseResult.items)).filter(isMediaLike);
    return { items, source:"maru-search", meta:res && res.meta || null };
  }catch(e){
    return { items:[], source:"maru-search", error:String(e && e.message || e) };
  }
}

async function fromPlanetary(ctx){
  if(!bool(ctx.external) && !bool(ctx.useExternal) && !bool(ctx.live)) return { items:[], source:null };
  const mod = safeRequire("./planetary-data-connector");
  if(!mod) return { items:[], source:null };

  try{
    let res = null;
    if(typeof mod.search === "function") res = await mod.search(ctx.query, ctx.mediaType, ctx);
    else if(typeof mod.connect === "function"){
      res = await mod.connect(
        { queryStringParameters: { q:ctx.query, query:ctx.query, type:ctx.mediaType, mediaType:ctx.mediaType, limit:ctx.limit } },
        { q:ctx.query, query:ctx.query, type:ctx.mediaType, mediaType:ctx.mediaType, limit:ctx.limit }
      );
    }else if(typeof mod.runEngine === "function"){
      res = await mod.runEngine({}, { q:ctx.query, type:ctx.mediaType, limit:ctx.limit });
    }
    const raw = safeArray(res && (res.items || res.results || res.data && res.data.items || res.baseResult && res.baseResult.items || res.baseResult && res.baseResult.data && res.baseResult.data.items));
    return { items:raw.filter(isMediaLike), source:"planetary" };
  }catch(e){
    return { items:[], source:"planetary", error:String(e && e.message || e) };
  }
}

async function fromCollector(ctx){
  if(!bool(ctx.external) && !bool(ctx.useExternal) && !bool(ctx.live)) return { items:[], source:null };
  const mod = safeRequire("./collector");
  if(!mod) return { items:[], source:null };

  try{
    let res = null;
    if(typeof mod.collect === "function") res = await mod.collect(ctx.query, ctx);
    else if(typeof mod.run === "function") res = await mod.run(ctx.query, ctx);
    else if(typeof mod.runEngine === "function") res = await mod.runEngine({}, { q:ctx.query, type:ctx.mediaType, limit:ctx.limit });
    const raw = safeArray(res && (res.items || res.results || res.data && res.data.items || res));
    return { items:raw.filter(isMediaLike), source:"collector" };
  }catch(e){
    return { items:[], source:"collector", error:String(e && e.message || e) };
  }
}

/* ------------------------------------------------------------
 * Search / ranking
 * ------------------------------------------------------------ */

function dedupe(items){
  return uniqBy(items, item => item.url || item.link || item.sceneUrl || item.modelUrl || item.assetUrl || item.id || item.title);
}
function rank(items, ctx){
  return safeArray(items)
    .map(item => {
      const m = metricsOf(item);
      const risk = riskOfUrl(item.url || item.link || item.sceneUrl || item.modelUrl);
      const immersiveBonus = IMMERSIVE_TYPES.has(item.mediaType) ? 0.08 : 0;
      const riskPenalty = risk.status === "error" ? -0.4 : risk.status === "warn" ? -0.08 : 0.08;
      const score =
        n(item.score, 0) +
        n(item.qualityScore, 0) * 0.35 +
        queryScore(item, ctx.query) * 0.4 +
        Math.min(0.2, (m.view / 100000)) +
        Math.min(0.2, (m.click / 10000)) +
        Math.min(0.2, (m.spatialInteraction / 1000)) +
        (validUrl(item.url || item.link || item.sceneUrl || item.modelUrl) ? 0.08 : -0.15) +
        (item.thumb && !s(item.thumb).includes("placeholder") ? 0.06 : 0) +
        immersiveBonus +
        riskPenalty;
      return Object.assign({}, item, { score: Math.max(0, Math.min(1.5, score)) });
    })
    .sort((a,b) => n(b.score) - n(a.score));
}

function normalizeContext(payload = {}){
  const query = s(payload.q || payload.query || payload.keyword || "").replace(/[<>;$`]/g,"").trim().slice(0,300);
  const mediaType = inferMediaType({ type:payload.type || payload.mediaType || payload.category || query }, MEDIA_TYPES.VIDEO);
  const limit = clampInt(payload.limit || payload.count || payload.max, DEFAULT_LIMIT, 1, MAX_LIMIT);

  return {
    query,
    mediaType,
    limit,
    lang: payload.lang || payload.language || payload.uiLang || null,
    languages: Array.isArray(payload.languages) ? payload.languages : [],
    region: payload.region || null,
    country: payload.country || null,
    section: payload.section || null,
    page: payload.page || null,
    external: payload.external,
    noExternal: payload.noExternal,
    disableExternal: payload.disableExternal,
    useExternal: payload.useExternal,
    live: payload.live,
    useMaruSearch: payload.useMaruSearch,
    viaMaruSearch: payload.viaMaruSearch,
    from: payload.from,
    source: payload.source,
    ai: payload.ai,
    useAI: payload.useAI,
    aiProvider: payload.aiProvider,
    broadcastTargets: Array.isArray(payload.broadcastTargets) ? payload.broadcastTargets : []
  };
}

async function searchMedia(payload = {}){
  const ctx = normalizeContext(payload);
  if(!ctx.query){
    return {
      ok:true,
      status:"ok",
      engine:"maru-media-adapter",
      version:VERSION,
      query:"",
      mediaType:ctx.mediaType,
      items:[],
      results:[],
      sources:[],
      meta:{ count:0, limit:ctx.limit }
    };
  }

  const snapshot = loadSnapshotMedia();
  const fromSnap = snapshot.items.filter(item => {
    const q = low(ctx.query);
    if(!q) return true;
    const text = low([item.title, item.summary, item.url, item.sceneUrl, item.modelUrl, item.section, item.psom_key, item.platform, item.tags && item.tags.join(" ")].join(" "));
    return q.split(/\s+/).some(tok => tok && text.includes(tok));
  });

  const [bank, maru, planetary, collector] = await Promise.all([
    fromSearchBank(ctx),
    fromMaruSearch(ctx),
    fromPlanetary(ctx),
    fromCollector(ctx)
  ]);

  const merged = dedupe([].concat(fromSnap, bank.items, maru.items, planetary.items, collector.items));
  const normalized = rank(merged.map(x => normalizeMediaItem(x, ctx)), ctx).slice(0, ctx.limit);

  return {
    ok:true,
    status:"ok",
    engine:"maru-media-adapter",
    version:VERSION,
    query:ctx.query,
    mediaType:ctx.mediaType,
    items:normalized,
    results:normalized,
    sources:[
      ...snapshot.sources,
      bank.source ? { name:bank.source, count:bank.items.length, error:bank.error || null } : null,
      maru.source ? { name:maru.source, count:maru.items.length, error:maru.error || null } : null,
      planetary.source ? { name:planetary.source, count:planetary.items.length, error:planetary.error || null } : null,
      collector.source ? { name:collector.source, count:collector.items.length, error:collector.error || null } : null
    ].filter(Boolean),
    meta:{
      count:normalized.length,
      limit:ctx.limit,
      snapshotCount:fromSnap.length,
      searchBankCount:bank.items.length,
      maruSearchCount:maru.items.length,
      planetaryCount:planetary.items.length,
      collectorCount:collector.items.length,
      externalUsed: !!(planetary.items.length || collector.items.length),
      maruSearchBridgeUsed: !!maru.items.length,
      aiReady:true,
      playerReady:true,
      creatorEditorReady:true,
      broadcasterReady:true,
      immersiveReady:true,
      supportedMediaTypes:Object.values(MEDIA_TYPES)
    }
  };
}

async function report(payload = {}){
  const pack = loadSnapshotMedia();
  const normalized = pack.items.map(x => normalizeMediaItem(x, payload));
  const byType = {};
  const byPlatform = {};
  const byRisk = {};
  normalized.forEach(x => {
    byType[x.mediaType] = (byType[x.mediaType] || 0) + 1;
    byPlatform[x.platform] = (byPlatform[x.platform] || 0) + 1;
    const key = x.risk && x.risk.level || "unknown";
    byRisk[key] = (byRisk[key] || 0) + 1;
  });
  return {
    ok:true,
    status:"ok",
    engine:"maru-media-adapter",
    version:VERSION,
    summary:{
      total: normalized.length,
      byType,
      byPlatform,
      byRisk,
      immersive: normalized.filter(x => x.immersive && x.immersive.enabled).length,
      withUrl: normalized.filter(x => validUrl(x.url)).length,
      withThumb: normalized.filter(x => x.thumb && !x.thumb.includes("placeholder")).length,
      monetized: normalized.filter(x => x.mediaRevenue && x.mediaRevenue.enabled).length,
      aiReady: normalized.filter(x => x.ai && x.ai.enabled).length,
      playerReady: normalized.filter(x => x.mediaPackage && x.mediaPackage.player && x.mediaPackage.player.ready).length,
      creatorEditorReady: normalized.filter(x => x.mediaPackage && x.mediaPackage.creatorEditor && x.mediaPackage.creatorEditor.ready).length,
      broadcasterReady: normalized.filter(x => x.mediaPackage && x.mediaPackage.broadcaster && x.mediaPackage.broadcaster.ready).length
    },
    sources:pack.sources,
    supportedMediaTypes:Object.values(MEDIA_TYPES),
    deviceProfiles:DEVICE_PROFILES,
    sample:normalized.slice(0,20)
  };
}

async function runEngine(eventOrPayload = {}, params = {}){
  const payload = Object.assign(
    {},
    eventOrPayload && eventOrPayload.queryStringParameters ? eventOrPayload.queryStringParameters : eventOrPayload,
    params || {}
  );
  const action = low(payload.action || payload.mode || payload.fn || "search");

  if(action === "health"){
    return {
      ok:true,
      status:"ok",
      engine:"maru-media-adapter",
      version:VERSION,
      features:{
        snapshotFirst:true,
        searchBankBridge:true,
        optionalMaruSearchBridge:true,
        planetaryExternalHook:true,
        collectorExternalHook:true,
        autoPublish:false,
        autoSNS:false,
        autoBroadcast:false,
        mediaRevenueMetadata:true,
        aiReady:true,
        playerPackage:true,
        creatorEditorPackage:true,
        broadcasterPackage:true,
        rightsRiskCheck:true,
        trustAllowBlockCheck:true,
        immersiveMedia:true,
        xr:true,
        vr:true,
        ar:true,
        hologram:true,
        threeD:true,
        spatial:true,
        volumetric:true,
        metaverse:true
      },
      supportedMediaTypes:Object.values(MEDIA_TYPES),
      deviceProfiles:DEVICE_PROFILES
    };
  }
  if(action === "report") return report(payload);
  if(action === "normalize"){
    const items = safeArray(payload.items || payload.results).map(x => normalizeMediaItem(x, payload));
    return { ok:true, status:"ok", engine:"maru-media-adapter", version:VERSION, items, results:items, meta:{ count:items.length } };
  }
  return searchMedia(payload);
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
    return json(500, { ok:false, status:"error", engine:"maru-media-adapter", version:VERSION, error:String(e && e.message || e) });
  }
}

module.exports = {
  VERSION,
  MEDIA_TYPES,
  IMMERSIVE_TYPES,
  DEVICE_PROFILES,
  handler,
  runEngine,
  searchMedia,
  report,
  normalizeMediaItem,
  extractItemsFromSnapshot,
  loadSnapshotMedia,
  aiReadiness,
  immersiveProfile,
  buildPlayerPackage,
  buildCreatorEditorPackage,
  buildBroadcasterPackage
};

if(require.main === module){
  runEngine({ action:"health" }).then(r => console.log(JSON.stringify(r,null,2))).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
