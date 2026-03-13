/**
 * MARU Unified Revenue Settlement Engine
 * Production Integrated Version
 */

"use strict";

/* ------------------------------------------------------------
   CONFIG
------------------------------------------------------------ */

const VERSION = "maru-revenue-engine-v1";

/* ------------------------------------------------------------
   RATE TABLE
------------------------------------------------------------ */

const RATE_TABLE = {

  search: 0.01,

  media: 0.02,

  commerce: 0.05,

  sns: 0.015,

  membership: 0.10,

  api: 0.03,

  affiliate: 0.04,

  dataset: 0.025

};

/* ------------------------------------------------------------
   GLOBAL LEDGER
------------------------------------------------------------ */

const LEDGER = new Map();

/* ------------------------------------------------------------
   EVENT ID GENERATOR
------------------------------------------------------------ */

function generateId(){

  return "rev-" + Date.now() + "-" + Math.floor(Math.random()*100000);

}

/* ------------------------------------------------------------
   SAFE NUMBER
------------------------------------------------------------ */

function safeNumber(v){

  const n = Number(v);

  if(!Number.isFinite(n)) return 0;

  return n;

}

/* ------------------------------------------------------------
   RATE RESOLVER
------------------------------------------------------------ */

function resolveRate(type){

  if(!type) return 0.01;

  return RATE_TABLE[type] || 0.01;

}

/* ------------------------------------------------------------
   EVENT VALIDATION
------------------------------------------------------------ */

function validateEvent(e){

  if(!e) return false;

  if(!e.type) return false;

  return true;

}

/* ------------------------------------------------------------
   DUPLICATE GUARD
------------------------------------------------------------ */

function isDuplicate(id){

  if(!id) return false;

  return LEDGER.has(id);

}

/* ------------------------------------------------------------
   RECORD
------------------------------------------------------------ */

function record(entry){

  LEDGER.set(entry.id,entry);

}

/* ------------------------------------------------------------
   PROCESS EVENT
------------------------------------------------------------ */

async function processEvent(event){

  if(!validateEvent(event)){

    return { status:"invalid-event" };

  }

  const id = event.id || generateId();

  if(isDuplicate(id)){

    return { status:"duplicate-event" };

  }

  const value = safeNumber(event.value);

  const rate = resolveRate(event.type);

  const revenue = value * rate;

  const entry = {

    id,

    type: event.type,

    source: event.source || "unknown",

    user: event.user || null,

    producer: event.producer || null,

    value,

    rate,

    revenue,

    currency: event.currency || "USD",

    blockchain: event.blockchain || null,

    wallet: event.wallet || null,

    timestamp: Date.now()

  };

  record(entry);

  return {

    status:"recorded",

    entry

  };

}

/* ------------------------------------------------------------
   REPORT
------------------------------------------------------------ */

function report(){

  let total = 0;

  const summary = {};

  for(const entry of LEDGER.values()){

    total += entry.revenue;

    if(!summary[entry.type]){

      summary[entry.type] = 0;

    }

    summary[entry.type] += entry.revenue;

  }

  return {

    engine:"maru-revenue",

    version:VERSION,

    records: LEDGER.size,

    totalRevenue: total,

    breakdown: summary

  };

}

/* ------------------------------------------------------------
   ROUTER HOOK
------------------------------------------------------------ */

function hookRouter(items){

  if(!Array.isArray(items)) return;

  for(const item of items){

    if(item && item.engine){

      processEvent({

        type:"search",

        source:item.engine,

        value:1

      });

    }

  }

}

/* ------------------------------------------------------------
   MEDIA HOOK
------------------------------------------------------------ */

function hookMedia(event){

  processEvent({

    type:"media",

    source:event.source || "media-engine",

    value:event.value || 1

  });

}

/* ------------------------------------------------------------
   COMMERCE HOOK
------------------------------------------------------------ */

function hookCommerce(event){

  processEvent({

    type:"commerce",

    source:event.source || "commerce",

    value:event.amount || 0

  });

}

/* ------------------------------------------------------------
   MEMBERSHIP HOOK
------------------------------------------------------------ */

function hookMembership(event){

  processEvent({

    type:"membership",

    source:"membership",

    value:event.amount || 0

  });

}

/* ------------------------------------------------------------
   SNS HOOK
------------------------------------------------------------ */

function hookSNS(event){

  processEvent({

    type:"sns",

    source:event.platform || "sns",

    value:event.value || 1

  });

}

/* ------------------------------------------------------------
   API ENTRY
------------------------------------------------------------ */

module.exports = {

  runEngine: async function(event,params){

    if(params && params.action === "track"){
      return await processEvent(params.event || {});
    }

    if(params && params.action === "report"){
      return report();
    }

    return {
      status:"revenue-engine-ready",
      version:VERSION
    };

  },

  processEvent,
  hookRouter,
  hookMedia,
  hookCommerce,
  hookMembership,
  hookSNS,
  report

};