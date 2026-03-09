
/**
 * netlify/functions/central-collector.js
 * ------------------------------------------------------------
 * MARU CENTRAL COLLECTOR — v3 (Planetary Layer Upgrade)
 * ------------------------------------------------------------
 * 기존 Collector 로직을 유지하면서
 * 아래 두 레이어만 추가한 버전입니다.
 *
 * 1. Planetary Data Connector
 * 2. Resilience Guard
 *
 * 기존 Router / Search / Insight / Bank 엔진은
 * 전혀 수정하지 않습니다.
 */

"use strict";

const Router = require("./maru-quality-router");
const Planetary = require("./planetary-data-connector");
const Resilience = require("./maru-resilience-engine");

const VERSION = "collector-v3-planetary";

/* ------------------------------------------------------------
   CONFIG
------------------------------------------------------------ */

const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/* ------------------------------------------------------------
   UTIL
------------------------------------------------------------ */

function s(x){
  return String(x == null ? "" : x);
}

function sanitizeQuery(q){

  q = s(q).replace(/[<>]/g,"").trim();

  if(q.length > MAX_QUERY_LENGTH){
    q = q.slice(0,MAX_QUERY_LENGTH);
  }

  return q;
}

function parseLimit(v){

  let n = parseInt(v || DEFAULT_LIMIT);

  if(isNaN(n)) n = DEFAULT_LIMIT;

  if(n > MAX_LIMIT) n = MAX_LIMIT;

  return n;
}

function ok(body){

  const origin =
    process.env.ALLOWED_ORIGIN ||
    "https://igdcglobal.com";

  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json",
      "Access-Control-Allow-Origin":origin
    },
    body:JSON.stringify(body)
  }
}

/* ------------------------------------------------------------
   COLLECTOR CORE
------------------------------------------------------------ */

async function runCollector(event){

  const params = event.queryStringParameters || {};

  const rawQuery =
    params.q ||
    params.query ||
    "";

  const q = sanitizeQuery(rawQuery);

  const limit = parseLimit(params.limit);

  if(!q){

    return {
      status:"ok",
      engine:"central-collector",
      version:VERSION,
      items:[]
    };

  }

  /* ------------------------------------------------------------
     Planetary Connector Layer
  ------------------------------------------------------------ */

  try{
    await Planetary.connect(event,{ q });
  }catch(e){
    // Connector 오류는 Router 실행을 막지 않음
  }

  /* ------------------------------------------------------------
     Router Execution
  ------------------------------------------------------------ */

  const routerResult =
    await Router.runEngine(event,{ q, limit });

  /* ------------------------------------------------------------
     Resilience Guard
  ------------------------------------------------------------ */

  const safeItems =
    Resilience.guard(routerResult.items || []);

  return {

    status:"ok",
    engine:"central-collector",
    version:VERSION,

    query:q,

    router:routerResult.engine,
    routerVersion:routerResult.version,

    items:safeItems,

    meta:{
      count: safeItems.length
    }

  };

}

/* ------------------------------------------------------------
   NETLIFY HANDLER
------------------------------------------------------------ */

exports.handler = async function(event){

  try{

    const result = await runCollector(event);

    return ok(result);

  }catch(err){

    const fallback =
      Resilience.fallback(err);

    return ok({
      status:"error",
      engine:"central-collector",
      version:VERSION,
      message:"collector failure",
      resilience:fallback
    });

  }

}

/* ------------------------------------------------------------
   INTERNAL ENGINE CALL
------------------------------------------------------------ */

exports.runEngine = async function(event,params){

  return await runCollector({
    queryStringParameters: params || {}
  });

}
