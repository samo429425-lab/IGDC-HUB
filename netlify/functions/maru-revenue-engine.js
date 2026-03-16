"use strict";

/*
 MARU Unified Revenue Settlement Engine
*/

const VERSION = "maru-revenue-engine-v1";

/* RATE TABLE */

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

/* LEDGER */

const LEDGER = new Map();

/* PRODUCER REVENUE ACCUMULATION */

const PRODUCER_LEDGER = new Map();

/* PRODUCER PAYOUT QUEUE */

const PRODUCER_PAYOUT_QUEUE = new Map();

function queueProducerPayout(producerId, amount){

  if(!producerId) return;

  const prev = PRODUCER_PAYOUT_QUEUE.get(producerId) || 0;
  PRODUCER_PAYOUT_QUEUE.set(producerId, prev + amount);

}

/* AUTO PAYOUT PROCESSOR */

function processProducerPayouts(){

  const payouts = [];

  for(const [producerId, amount] of PRODUCER_PAYOUT_QUEUE.entries()){

    payouts.push({
      producerId,
      amount
    });

  }

  return payouts;

}

/* PAYOUT EXECUTOR */

function executeProducerPayouts(){

  const executed = [];

  for(const [producerId, amount] of PRODUCER_PAYOUT_QUEUE.entries()){

    executed.push({
      producerId,
      amount,
      status:"ready"
    });

    PRODUCER_PAYOUT_QUEUE.delete(producerId);

  }

  return executed;

}

function accumulateProducerRevenue(producerId, amount){

  if(!producerId) return;

  const prev = PRODUCER_LEDGER.get(producerId) || 0;
  PRODUCER_LEDGER.set(producerId, prev + amount);

}

/* UTIL */

function generateId(){
  return "rev-" + Date.now() + "-" + Math.floor(Math.random()*100000);
}

function safeNumber(v){
  const n = Number(v);
  if(!Number.isFinite(n)) return 0;
  return n;
}

function resolveRate(type){
  return RATE_TABLE[type] || 0.01;
}

function validateEvent(e){
  if(!e) return false;
  if(!e.type) return false;
  return true;
}

function isDuplicate(id){
  if(!id) return false;
  return LEDGER.has(id);
}

function record(entry){
  LEDGER.set(entry.id,entry);
}

/* EVENT PROCESSOR */

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
  const sectionRevenue = revenue * 0.20;
  const producerRevenue = revenue * 0.60;
  const platformRevenue = revenue * 0.15;
  const foundationRevenue = revenue * 0.05;
  const country = event.country || "global";
  const region = event.region || "global";
  const producerId = event.producer || "unknown";

  const countryRevenue = revenue * 0.01;
  const regionRevenue = revenue * 0.01;

  const geoKey = country + ":" + region;

  const entry = {
    id,
    type:event.type,
    source:event.source || "unknown",
    user:event.user || null,
    producer:event.producer || null,
	country,
    region,
    producerId,
    countryRevenue,
    regionRevenue,
    geoKey,
    value,
    rate,
    revenue,

    sectionRevenue,
    producerRevenue,
    platformRevenue,
    foundationRevenue,

    currency:event.currency || "USD",
    timestamp:Date.now()
  };

  record(entry);
  
  accumulateProducerRevenue(producerId, producerRevenue);
  
  queueProducerPayout(producerId, producerRevenue);

  return { status:"recorded", entry };

}

/* REPORT */

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
    records:LEDGER.size,
    totalRevenue:total,
    breakdown:summary
  };

}

/* HOOKS */

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

function hookMedia(event){

  processEvent({
    type:"media",
    source:event.source || "media",
    value:event.value || 1
  });

}

function hookCommerce(event){

  processEvent({
    type:"commerce",
    source:event.source || "commerce",
    value:event.amount || 0
  });

}

function hookMembership(event){

  processEvent({
    type:"membership",
    source:"membership",
    value:event.amount || 0
  });

}

function hookSNS(event){

  processEvent({
    type:"sns",
    source:event.platform || "sns",
    value:event.value || 1
  });

}

/* API */

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