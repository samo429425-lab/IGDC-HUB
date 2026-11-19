'use strict';
// Single authority for automated research gates; not a public seller approval.
// First 20 DISTINCT verified seller roots unlock the independent product worker.
// The supplier worker continues toward 100 (200 US) concurrently thereafter.
const VERSION='igdc-country-auto-research-policy.v1.20261119';
const INITIAL_SUPPLIER_SITES=20;
const FREE_DIRECTORY_TIMEOUT_MS=10500;
const FREE_DIRECTORY_MAX_TIMEOUT_MS=11500;
const SCHEDULED_WINDOW_MS=30000;
function firstStageReady(count){return Number.isFinite(Number(count))&&Number(count)>=INITIAL_SUPPLIER_SITES;}
module.exports={VERSION,INITIAL_SUPPLIER_SITES,FREE_DIRECTORY_TIMEOUT_MS,
 FREE_DIRECTORY_MAX_TIMEOUT_MS,SCHEDULED_WINDOW_MS,firstStageReady};
