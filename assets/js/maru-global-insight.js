"use strict";

/*
 MARU Global Insight JS
 FULL VERSION – STRUCTURE CORRECTED
 --------------------------------------------------
 ✔ Collector direct call REMOVED
 ✔ Orchestrated strictly via Netlify Insight Engine
 ✔ Existing public API preserved
 ✔ DetachedPane integration preserved
 ✔ No feature reduction
*/

(function(global){

  if(!global.MaruGlobalInsight){
    global.MaruGlobalInsight = {};
  }

  const Insight = global.MaruGlobalInsight;

  /* =====================================================
     CONFIG
  ===================================================== */

  Insight.config = {
    version: "2.1.0-orchestrated",
    enableSnapshot: true,
    enableMediaAttach: true,
    enableConversationHook: true
  };

  /* =====================================================
     UTIL
  ===================================================== */

  function safe(fn){
    try { return fn(); }
    catch(e){ console.error("[MARU Insight Error]", e); return null; }
  }

  function now(){ return Date.now(); }

  /* =====================================================
     CORE ENGINE CALL (Single Orchestrator Entry)
  ===================================================== */

  async function callInsightEngine(params){

    const response = await fetch("/.netlify/functions/maru-global-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    if(!response.ok){
      throw new Error("Insight Engine Call Failed");
    }

    return await response.json();
  }

  /* =====================================================
     REGION BRIEF
  ===================================================== */

  Insight.generateRegionBrief = async function(regionKey){

    if(!regionKey) return null;

    return await callInsightEngine({
      q: regionKey,
      scope: "region",
      target: regionKey,
      intent: "summary",
      timestamp: now()
    });
  };

  /* =====================================================
     COUNTRY BRIEF
  ===================================================== */

  Insight.generateCountryBrief = async function(countryKey){

    if(!countryKey) return null;

    return await callInsightEngine({
      q: countryKey,
      scope: "country",
      target: countryKey,
      intent: "summary",
      timestamp: now()
    });
  };

  /* =====================================================
     GENERIC QUERY EXECUTION (Future-proof)
  ===================================================== */

  Insight.query = async function(query, options = {}){

    if(!query) return null;

    return await callInsightEngine({
      q: query,
      scope: options.scope || "global",
      target: options.target || null,
      intent: options.intent || "summary",
      limit: options.limit || 20,
      timestamp: now()
    });
  };

  /* =====================================================
     UNIFIED EXECUTION
  ===================================================== */

  Insight.execute = async function(params){

    if(!params || !params.type) return null;

    if(params.type === "region"){
      return await Insight.generateRegionBrief(params.key);
    }

    if(params.type === "country"){
      return await Insight.generateCountryBrief(params.key);
    }

    if(params.type === "query"){
      return await Insight.query(params.q, params);
    }

    return null;
  };

  /* =====================================================
     DETACHED PANE CONVERSATION HOOK
  ===================================================== */

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

  /* =====================================================
     BULK REGION EXECUTION (ADMIN)
  ===================================================== */

  Insight.runGlobal = async function(regionList){

    if(!Array.isArray(regionList)) return [];

    const results = [];

    for(const region of regionList){
      const brief = await Insight.generateRegionBrief(region);
      results.push(brief);
    }

    return results;
  };

  /* =====================================================
     EXTENSION-SAFE HOOK (No Direct Engine Access)
  ===================================================== */

  Insight.request = async function(payload){
    return await callInsightEngine(payload);
  };

  console.log("MARU Global Insight JS Loaded v" + Insight.config.version);

})(typeof window !== "undefined" ? window : global);
