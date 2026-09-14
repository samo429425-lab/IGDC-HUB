"use strict";

/**
 * IGDC -> Coupang Partners entry gateway.
 *
 * Priority:
 * 1) operator-provided provider-generated entry URL (no API call),
 * 2) when the verified Coupang API adapter is ready, generate a provider deep
 *    link for the ordinary Coupang homepage on demand,
 * 3) ordinary Coupang homepage fallback.
 *
 * The public Network Hub label remains "Coupang" and no secret is exposed.
 */

const Provider = require("./lib/coupang-partners-provider.v1");
const DEFAULT_COUPANG_URL = "https://www.coupang.com/";

function text(value){ return value == null ? "" : String(value).trim(); }
function isAllowedCoupangUrl(value){ return Provider.hostAllowed(value); }
function sourceFromEvent(event){ const raw=text(event&&event.queryStringParameters&&event.queryStringParameters.source).toLowerCase(); return /^[a-z0-9_-]{1,40}$/.test(raw)?raw:"networkhub"; }
function enabled(v){ return /^(1|true|yes|on|enabled)$/i.test(text(v)); }

async function resolveDestination(deps){
  const configured=text(process.env.COUPANG_PARTNERS_ENTRY_URL);
  if(enabled(process.env.COUPANG_PARTNERS_ENABLED) && isAllowedCoupangUrl(configured)){
    return {destination:configured,state:"configured_manual_provider_link"};
  }
  const cfg=Provider.config();
  if(cfg.ready){
    try{
      const links=await Provider.createDeepLinks([DEFAULT_COUPANG_URL],cfg,deps);
      const generated=links.get(DEFAULT_COUPANG_URL);
      if(generated&&isAllowedCoupangUrl(generated)) return {destination:generated,state:"api_generated_provider_link"};
    }catch(_error){}
  }
  return {destination:DEFAULT_COUPANG_URL,state:"fallback_unconfigured"};
}

exports.handler=async function handler(event){
  const source=sourceFromEvent(event);
  const resolved=await resolveDestination();
  return {
    statusCode:302,
    headers:{
      Location:resolved.destination,
      "cache-control":"no-store, private",
      "referrer-policy":"strict-origin-when-cross-origin",
      "x-igdc-outbound-provider":"coupang-partners-kr",
      "x-igdc-outbound-source":source,
      "x-igdc-affiliate-state":resolved.state
    },
    body:""
  };
};

exports._test={DEFAULT_COUPANG_URL,isAllowedCoupangUrl,sourceFromEvent,resolveDestination};
