/**
 * maru-revenue-engine.js
 * ------------------------------------------------------------
 * Admin-compatible wrapper for revenue-engine.js.
 *
 * Admin can keep calling:
 *   /.netlify/functions/maru-revenue-engine?action=report
 *
 * Maru Search can keep requiring:
 *   require("./revenue-engine")
 */
"use strict";

let RevenueEngine = null;

function getEngine(){
  if(RevenueEngine) return RevenueEngine;
  RevenueEngine = require("./revenue-engine");
  return RevenueEngine;
}

async function runEngine(payload){
  const engine = getEngine();
  if(engine && typeof engine.runEngine === "function") return engine.runEngine(payload || {});
  if(engine && typeof engine.dispatch === "function") return engine.dispatch(payload || {});
  throw new Error("revenue-engine.js does not expose runEngine/dispatch");
}

async function dispatch(payload){
  return runEngine(payload || {});
}

async function handle(payload){
  return runEngine(payload || {});
}

async function handler(event, context){
  const engine = getEngine();
  if(engine && typeof engine.handler === "function") return engine.handler(event, context);
  const result = await runEngine({});
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(result)
  };
}

module.exports = {
  handler,
  runEngine,
  dispatch,
  handle
};
