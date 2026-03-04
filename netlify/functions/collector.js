
/**
 * MARU Central Collector Engine
 * Unified gateway for all engines
 */

"use strict";

let searchBank = null;
let maruSearch = null;
let insightEngine = null;

try { searchBank = require("./search-bank-engine"); } catch(e){}
try { maruSearch = require("./maru-search"); } catch(e){}
try { insightEngine = require("./maru-global-insight-engine"); } catch(e){}

function now(){
  return new Date().toISOString();
}

function safeInt(n, def, min, max){
  const v = Number(n);
  if(!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function normalizeQuery(q){
  if(!q) return "";
  return String(q).trim().slice(0,200);
}

function buildResponse(data){
  return {
    status:"ok",
    collector:"maru-central",
    timestamp: now(),
    data
  };
}

function fail(msg){
  return {
    status:"fail",
    collector:"maru-central",
    timestamp: now(),
    message: msg
  };
}

async function dispatch(event, params){

  const mode = params.mode || params.engine || "search";
  const q = normalizeQuery(params.q || params.query || "");
  const limit = safeInt(params.limit, 30, 1, 200);

  if(mode === "search"){
    if(searchBank && searchBank.runEngine){
      return await searchBank.runEngine(event, { q, limit });
    }
    return fail("SEARCH_ENGINE_NOT_AVAILABLE");
  }

  if(mode === "insight"){
    if(insightEngine && insightEngine.runEngine){
      return await insightEngine.runEngine(event, { q, limit });
    }
    return fail("INSIGHT_ENGINE_NOT_AVAILABLE");
  }

  if(mode === "maru-search"){
    if(maruSearch && maruSearch.runEngine){
      return await maruSearch.runEngine(event, { q, limit });
    }
    return fail("MARU_SEARCH_NOT_AVAILABLE");
  }

  if(mode === "media"){
    return fail("MEDIA_ENGINE_NOT_CONNECTED");
  }

  if(mode === "revenue"){
    return fail("REVENUE_ENGINE_NOT_CONNECTED");
  }

  return fail("UNKNOWN_MODE");
}

exports.handler = async function(event){

  try{

    const method = (event.httpMethod || "GET").toUpperCase();

    if(method !== "GET"){
      return {
        statusCode:405,
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(fail("METHOD_NOT_ALLOWED"))
      };
    }

    const params = event.queryStringParameters || {};
    const result = await dispatch(event, params);

    return {
      statusCode:200,
      headers:{
        "Content-Type":"application/json",
        "Cache-Control":"no-store"
      },
      body: JSON.stringify(buildResponse(result))
    };

  }catch(err){

    return {
      statusCode:500,
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(fail(err.message || "COLLECTOR_ERROR"))
    };

  }

};
