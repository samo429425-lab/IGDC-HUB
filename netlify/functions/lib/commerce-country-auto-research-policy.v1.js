'use strict';
// Single authority for automated research gates; not a public seller approval.
// First 10 DISTINCT usable seller roots unlock the independent private product worker.
// The supplier worker continues toward 100 (200 US) concurrently thereafter.
const VERSION='igdc-country-auto-research-policy.v1.20261119-threshold10';
const INITIAL_SUPPLIER_SITES=10;
const FREE_DIRECTORY_TIMEOUT_MS=10500;
const FREE_DIRECTORY_MAX_TIMEOUT_MS=11500;
// Scheduled functions have a hard 30s deadline. Do not enqueue a full country's
// 20+ repeated zero-result queries into one round. Five rounds select distinct
// slices of the actual country search plan; no synthetic supplier leads.
const SCHEDULED_SUPPLIER_QUERIES_PER_ROUND=8;
const SCHEDULED_SUPPLIER_SCOPE_BATCH=3;
const SCHEDULED_PRODUCT_SCOPE_BATCH=2;
const SCHEDULED_WINDOW_MS=30000;
function firstStageReady(count){return Number.isFinite(Number(count))&&Number(count)>=INITIAL_SUPPLIER_SITES;}
module.exports={VERSION,INITIAL_SUPPLIER_SITES,FREE_DIRECTORY_TIMEOUT_MS,
 FREE_DIRECTORY_MAX_TIMEOUT_MS,SCHEDULED_WINDOW_MS,
 SCHEDULED_SUPPLIER_QUERIES_PER_ROUND,SCHEDULED_SUPPLIER_SCOPE_BATCH,SCHEDULED_PRODUCT_SCOPE_BATCH,firstStageReady};
