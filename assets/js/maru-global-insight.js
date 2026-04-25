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
    version: "2.1.2-orchestrated-safe-bridge",
    endpoint: "/.netlify/functions/maru-global-insight",
    fallbackEndpoint: "/.netlify/functions/maru-global-insight-engine",
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

  function getUiLang(){
    return safe(function(){
      var docLang = (global.document && global.document.documentElement)
        ? global.document.documentElement.getAttribute("lang")
        : "";
      var stored = "";
      try { stored = global.localStorage ? (global.localStorage.getItem("igdc_lang") || "") : ""; } catch(e) { stored = ""; }
      var igdcLang = "";
      try {
        if(global.IGDC && typeof global.IGDC.getLang === "function") igdcLang = global.IGDC.getLang() || "";
      } catch(e) { igdcLang = ""; }
      return docLang || global.IGTC_CURRENT_LANG || igdcLang || stored || "";
    }) || "";
  }

  function withInsightDefaults(params){
    var out = Object.assign({}, params || {});
    if(!out.mode) out.mode = "global-insight";
    if(!out.uiLang) out.uiLang = getUiLang();
    if(out.noAnalytics == null) out.noAnalytics = "1";
    if(out.noRevenue == null) out.noRevenue = "1";
    return out;
  }

  async function callInsightEngine(params){

  const finalParams = withInsightDefaults(params);
  const query = new URLSearchParams(finalParams).toString();
  const endpoints = [
    Insight.config.endpoint || "/.netlify/functions/maru-global-insight",
    Insight.config.fallbackEndpoint || "/.netlify/functions/maru-global-insight-engine"
  ].filter(function(v, i, arr){ return v && arr.indexOf(v) === i; });

  let lastError = null;

  for(let i = 0; i < endpoints.length; i++){
    const endpoint = endpoints[i];
    try{
      const response = await fetch(
        endpoint + "?" + query,
        { method: "GET", cache: "no-store" }
      );

      if(response && response.ok){
        return await response.json();
      }

      lastError = new Error("Insight Engine Call Failed: " + (response ? response.status : "NO_RESPONSE") + " @ " + endpoint);
      continue;
    }catch(e){
      lastError = e;
      continue;
    }
  }

  throw lastError || new Error("Insight Engine Call Failed");
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

  Insight.dispatch = async function(payload){
    return await Insight.request(payload);
  };

  console.log("MARU Global Insight JS Loaded v" + Insight.config.version);

})(typeof window !== "undefined" ? window : global);
