
/**
 * netlify/functions/central-collector.js
 * ------------------------------------------------------------
 * MARU CENTRAL COLLECTOR — v2
 * ------------------------------------------------------------
 * Purpose:
 *  - Entry gateway for MARU search system
 *  - Receives query requests
 *  - Passes them to MARU Quality Router
 *  - Handles request validation / rate guard
 *
 * Architecture
 *
 * Client
 *   ↓
 * Central Collector
 *   ↓
 * MARU Quality Router
 *   ↓
 * Search / Insight / Bank / Future Engines
 */

"use strict";

const Router = require("./maru-quality-router")

/* ------------------------------------------------------------
   CONFIG
------------------------------------------------------------ */

const VERSION = "collector-v2-router-gateway"

const MAX_QUERY_LENGTH = 200
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/* ------------------------------------------------------------
   UTIL
------------------------------------------------------------ */

function s(x){
  return String(x==null?"":x)
}

function sanitizeQuery(q){

  q = s(q).replace(/[<>]/g,"").trim()

  if(q.length > MAX_QUERY_LENGTH){
    q = q.slice(0,MAX_QUERY_LENGTH)
  }

  return q
}

function parseLimit(v){

  let n = parseInt(v || DEFAULT_LIMIT)

  if(isNaN(n)) n = DEFAULT_LIMIT

  if(n > MAX_LIMIT) n = MAX_LIMIT

  return n
}

function ok(body){

  const origin =
    process.env.ALLOWED_ORIGIN ||
    "https://igdcglobal.com"

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

  const params = event.queryStringParameters || {}

  const rawQuery =
    params.q ||
    params.query ||
    ""

  const q = sanitizeQuery(rawQuery)

  const limit = parseLimit(params.limit)

  if(!q){

    return {
      status:"ok",
      engine:"central-collector",
      version:VERSION,
      items:[]
    }

  }

  /* Pass request to Router */

  const routerResult =
    await Router.runEngine(event,{ q, limit })

  return {

    status:"ok",
    engine:"central-collector",
    version:VERSION,

    query:q,

    router:routerResult.engine,
    routerVersion:routerResult.version,

    items:routerResult.items,

    meta:{
      count: routerResult.items ? routerResult.items.length : 0
    }

  }

}

/* ------------------------------------------------------------
   NETLIFY HANDLER
------------------------------------------------------------ */

exports.handler = async function(event){

  try{

    const result = await runCollector(event)

    return ok(result)

  }catch(err){

    return ok({
      status:"error",
      engine:"central-collector",
      version:VERSION,
      message:"collector failure"
    })

  }

}

/* ------------------------------------------------------------
   INTERNAL CALL SUPPORT
------------------------------------------------------------ */

exports.runEngine = async function(event,params){

  return await runCollector({
    queryStringParameters: params || {}
  })

}
