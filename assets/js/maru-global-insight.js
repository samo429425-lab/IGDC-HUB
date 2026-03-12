"use strict";

/*
 MARU Global Insight Engine
 확장형 구조
 기존 Addon → Insight → Collector → Engine 흐름 유지
 기존 기능 삭제 없음
*/

(function(global){

  if(!global.MaruGlobalInsight){
    global.MaruGlobalInsight = {};
  }

  const Insight = global.MaruGlobalInsight;

  /* ==========================
     Core Config
  ========================== */

  Insight.config = {
    version: "2.0.0",
    enableSnapshot: true,
    enableMediaAttach: true,
    enableConversationHook: true
  };

  /* ==========================
     Utility
  ========================== */

  function safe(fn){
    try { return fn(); }
    catch(e){ console.error("[MARU Insight Error]", e); return null; }
  }

  function now(){ return Date.now(); }

  /* ==========================
     Region Brief Generation
  ========================== */

  Insight.generateRegionBrief = async function(regionKey){

    if(!regionKey) return null;

    const payload = {
      type: "region",
      region: regionKey,
      timestamp: now()
    };

    const collected = await Insight.collect(payload);
    const analyzed  = await Insight.analyze(collected);

    return analyzed;
  };

  /* ==========================
     Country Brief Generation
  ========================== */

  Insight.generateCountryBrief = async function(countryKey){

    if(!countryKey) return null;

    const payload = {
      type: "country",
      country: countryKey,
      timestamp: now()
    };

    const collected = await Insight.collect(payload);
    const analyzed  = await Insight.analyze(collected);

    return analyzed;
  };

  /* ==========================
     Collector Bridge
  ========================== */

  Insight.collect = async function(payload){

    if(!global.collector) return payload;

    return await safe(async()=>{
      return await global.collector.collect(payload);
    }) || payload;
  };

  /* ==========================
     Intelligence Layer
  ========================== */

  Insight.analyze = async function(data){

    if(!global.MaruIntelligenceEngine) return data;

    return await safe(async()=>{
      const engine = new global.MaruIntelligenceEngine();
      return await engine.process(data);
    }) || data;
  };

  /* ==========================
     Media Attachment (Optional)
  ========================== */

  Insight.attachMedia = async function(brief){

    if(!Insight.config.enableMediaAttach) return brief;
    if(!global.MaruMediaEngine) return brief;

    return await safe(async()=>{
      const media = new global.MaruMediaEngine();
      const result = await media.generate({
        query: brief.title || brief.region || brief.country,
        mediaType: "video"
      });

      brief.media = result.items || [];
      return brief;
    }) || brief;
  };

  /* ==========================
     Conversation Hook
  ========================== */

  Insight.openConversation = function(contextData){

    if(!Insight.config.enableConversationHook) return;
    if(!global.MaruDetachedPane) return;

    safe(()=>{
      global.MaruDetachedPane.open({
        mode: "insight",
        context: contextData
      });
    });
  };

  /* ==========================
     Unified Execution
  ========================== */

  Insight.execute = async function(params){

    if(!params || !params.type) return null;

    let result = null;

    if(params.type === "region"){
      result = await Insight.generateRegionBrief(params.key);
    }

    if(params.type === "country"){
      result = await Insight.generateCountryBrief(params.key);
    }

    if(result && Insight.config.enableMediaAttach){
      result = await Insight.attachMedia(result);
    }

    return result;
  };

  /* ==========================
     Admin Trigger Hook
  ========================== */

  Insight.runGlobal = async function(regionList){

    if(!Array.isArray(regionList)) return [];

    const results = [];

    for(const region of regionList){
      const brief = await Insight.generateRegionBrief(region);
      results.push(brief);
    }

    return results;
  };

  console.log("MARU Global Insight Engine Loaded v" + Insight.config.version);

})(typeof window !== "undefined" ? window : global);
