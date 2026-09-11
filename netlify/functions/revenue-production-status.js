"use strict";

const Registry=require("./lib/revenue-provider-registry.v1");
const LedgerStore=require("./lib/revenue-ledger-supabase.v1");

const VERSION="revenue-production-status-v1.0.0";
function text(v){return v==null?"":String(v).trim();}
function json(code,body){return{statusCode:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, private"},body:JSON.stringify(body)};}
exports.handler=async function(event){
  const method=String(event&&event.httpMethod||"GET").toUpperCase();
  if(!["GET","HEAD"].includes(method)) return json(405,{ok:false,error:"method_not_allowed"});
  const cfg=LedgerStore.resolveConfig();
  const providers=Registry.publicStatus();
  const active=providers.filter(x=>x.active&&x.valid);
  const affiliateConfigured=!!text(process.env.IGDC_AFFILIATE_PARTNERS_JSON)&&!!text(process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET);
  const nonPgIngestConfigured=!!text(process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN);
  const profitGateConfigured=!!text(process.env.COMMERCE_MIN_NET_PROFIT_MINOR)&&!!text(process.env.COMMERCE_MIN_MARGIN_BPS);
  const body={
    ok:true,
    version:VERSION,
    generatedAt:new Date().toISOString(),
    production:true,
    simulationRevenueAccepted:false,
    aiFinancialAuthority:false,
    aiRole:"ranking/classification/advisory_only",
    confirmedRevenueAuthority:"external_provider_or_verified_webhook_only",
    ledger:LedgerStore.describeConfig(cfg),
    providerSync:{configured:providers.length>0,activeValidProviders:active.length,providers},
    affiliate:{configured:affiliateConfigured},
    nonPgSettlementIngest:{configured:nonPgIngestConfigured},
    profitabilityGate:{configured:profitGateConfigured},
    settlementIngestExecution:cfg.valid&&(active.length>0||affiliateConfigured||nonPgIngestConfigured),
    payoutExecution:false,
    payoutMode:"external_provider_pays_IGDC_account; IGDC records confirmed settlement/payout events",
    blockers:[
      !cfg.valid?"confirmed_ledger_not_ready":null,
      !profitGateConfigured?"profitability_thresholds_not_ready":null,
      !(active.length>0||affiliateConfigured||nonPgIngestConfigured)?"no_live_revenue_ingress_configured":null
    ].filter(Boolean)
  };
  if(method==="HEAD") return {statusCode:200,headers:{"cache-control":"no-store"},body:""};
  return json(200,body);
};
module.exports={VERSION,handler:exports.handler};
