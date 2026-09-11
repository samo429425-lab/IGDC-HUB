"use strict";

/**
 * IGDC/MARU production profitability gate.
 *
 * Purpose:
 * - Never invent tax, fee, FX, refund, chargeback, or revenue amounts.
 * - Accept only server/contract verified economics expressed in integer minor units.
 * - Prevent a monetized route from receiving revenue-priority placement when
 *   legal/tax status is unresolved, verified cost inputs are incomplete, or
 *   the transaction would fail the configured net-profit / margin floor.
 * - Ordinary non-monetized content is not deleted; it simply receives no
 *   verified commercial-priority class.
 *
 * This module does NOT calculate jurisdictional tax rates. Tax liability must
 * be supplied by a verified tax/legal adapter or an administrator-approved
 * settlement record. Unknown tax/legal state fails closed for monetization.
 */

const VERSION = "commerce-profitability-gate-v1.0.0";

const PRIORITY = Object.freeze({
  DIRECT_COMMERCE_VERIFIED: 700,
  FORMAL_PARTNER: 650,
  AFFILIATE_ACTIVE: 600,
  DIRECT_SPONSOR: 550,
  REFERRAL_VERIFIED: 500,
  VERIFIED_REVENUE_ROUTE: 450,
  ORDINARY: 40,
  TRAFFIC_VALUE_ONLY: 30,
  REVENUE_ROUTE_HOLD: 25,
  NON_REVENUE: 20,
  FALLBACK: 10
});

const RESOLVED = new Set(["resolved", "verified", "approved", "complete", "ready"]);

function text(v){ return v == null ? "" : String(v).trim(); }
function low(v){ return text(v).toLowerCase(); }
function plain(v){ return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function bool(v){ return v === true || ["1","true","yes","on","verified","approved","active","ready"].includes(low(v)); }
function first(){ for(const v of arguments){ if(v !== undefined && v !== null && text(v) !== "") return v; } return undefined; }

function intMinor(v){
  if(v === undefined || v === null || v === "") return null;
  if(typeof v === "bigint") return v;
  if(typeof v === "number"){
    if(!Number.isSafeInteger(v)) return null;
    return BigInt(v);
  }
  const s = text(v);
  if(!/^-?\d+$/.test(s)) return null;
  try { return BigInt(s); } catch(_e){ return null; }
}

function safeNumberOrString(v){
  const max = BigInt(Number.MAX_SAFE_INTEGER), min = -max;
  if(v <= max && v >= min) return Number(v);
  return v.toString();
}

function moneyContainers(rowInput){
  const row = plain(rowInput);
  return [
    plain(row.monetizationEconomics),
    plain(row.revenueEconomics),
    plain(row.transactionEconomics),
    plain(row.economics),
    plain(plain(row.revenue).economics),
    plain(plain(row.affiliateSettlement).economics),
    plain(plain(row.directCommerceListing).economics),
    plain(plain(row.brokerageContract).economics),
    plain(plain(row.commerceCandidate).economics),
    plain(plain(row.candidateSelection).economics)
  ];
}

function firstField(containers, names){
  for(const container of containers){
    for(const name of names){
      if(Object.prototype.hasOwnProperty.call(container, name) && container[name] !== undefined && container[name] !== null && text(container[name]) !== "") return container[name];
    }
  }
  return undefined;
}

function statusResolved(value){ return RESOLVED.has(low(value)); }

function policyFrom(rowInput, contextInput){
  const row = plain(rowInput), context = plain(contextInput);
  const p = Object.assign({}, plain(context.profitabilityPolicy), plain(row.profitabilityPolicy));
  const minNet = intMinor(first(p.minimumNetProfitMinor, p.minNetProfitMinor));
  const minMarginRaw = first(p.minimumMarginBps, p.minMarginBps);
  const minMargin = minMarginRaw == null || text(minMarginRaw) === "" ? null : Number(minMarginRaw);
  return {
    minimumNetProfitMinor: minNet,
    minimumMarginBps: Number.isInteger(minMargin) && minMargin >= 0 && minMargin <= 10000 ? minMargin : null,
    requireVerifiedEconomics: p.requireVerifiedEconomics !== false,
    requireTaxResolved: p.requireTaxResolved !== false,
    requireLegalRoleResolved: p.requireLegalRoleResolved !== false,
    thresholdConfigured: minNet !== null && Number.isInteger(minMargin) && minMargin >= 0 && minMargin <= 10000
  };
}


function publicPolicy(policy){
  return {
    minimumNetProfitMinor: policy.minimumNetProfitMinor === null ? null : safeNumberOrString(policy.minimumNetProfitMinor),
    minimumMarginBps: policy.minimumMarginBps,
    requireVerifiedEconomics: policy.requireVerifiedEconomics,
    requireTaxResolved: policy.requireTaxResolved,
    requireLegalRoleResolved: policy.requireLegalRoleResolved,
    thresholdConfigured: policy.thresholdConfigured
  };
}

function routeFacts(rowInput, revenueInput){
  const row = plain(rowInput), revenue = plain(revenueInput);
  const settlement = plain(row.affiliateSettlement);
  const sourceTier = low(first(row.sourceTier, row.supplyLane, row.candidateSourceTier, plain(row.commerceCandidate).sourceTier, plain(row.candidateSelection).sourceTier));
  const stage = low(first(revenue.affiliateSettlementStage, settlement.stage));
  const contractReady = revenue.contractReady === true;
  const directPayable = revenue.directPayable === true;
  const sponsorReady = revenue.sponsorReady === true;
  const affiliateReady = revenue.affiliateReady === true;
  const referralReady = revenue.referralReady === true;
  const trafficOnly = revenue.trafficOnly === true;
  const directSource = sourceTier === "approved_commerce_member" || sourceTier === "direct_member";
  const monetized = contractReady || directPayable || sponsorReady || affiliateReady || referralReady;
  return { sourceTier, stage, contractReady, directPayable, sponsorReady, affiliateReady, referralReady, trafficOnly, directSource, monetized };
}

function classifyRoute(facts, gatePassed){
  if(facts.monetized && !gatePassed) return "REVENUE_ROUTE_HOLD";
  if(gatePassed && facts.directSource && facts.directPayable) return "DIRECT_COMMERCE_VERIFIED";
  if(gatePassed && facts.stage === "formal_partner" && facts.contractReady) return "FORMAL_PARTNER";
  if(gatePassed && facts.stage === "online_affiliate_active" && facts.contractReady) return "AFFILIATE_ACTIVE";
  if(gatePassed && facts.sponsorReady) return "DIRECT_SPONSOR";
  if(gatePassed && facts.stage === "referral_verified" && facts.contractReady) return "REFERRAL_VERIFIED";
  if(gatePassed && facts.contractReady) return "VERIFIED_REVENUE_ROUTE";
  if(facts.trafficOnly || facts.referralReady) return "TRAFFIC_VALUE_ONLY";
  return "ORDINARY";
}

function assess(rowInput, revenueInput, contextInput){
  const row = plain(rowInput), revenue = plain(revenueInput), context = plain(contextInput);
  const containers = moneyContainers(row);
  const facts = routeFacts(row, revenue);
  const policy = policyFrom(row, context);
  const blockers = [], warnings = [];

  if(!facts.monetized){
    const commercialClass = facts.trafficOnly ? "TRAFFIC_VALUE_ONLY" : "ORDINARY";
    return {
      version: VERSION,
      applicable: false,
      gatePassed: false,
      monetizationAllowed: false,
      commercialClass,
      commercialPriority: PRIORITY[commercialClass],
      state: facts.trafficOnly ? "traffic_value_only" : "not_monetized",
      blockers: [], warnings: [], policy: publicPolicy(policy)
    };
  }

  const verified = bool(firstField(containers,["verified","serverVerified","economicsVerified","settlementVerified"]));
  const currency = text(firstField(containers,["currency","settlementCurrency","payoutCurrency"])).toUpperCase();
  const legalRoleStatus = firstField(containers,["legalRoleStatus","sellerRoleStatus","merchantRoleStatus","roleStatus"]);
  const taxStatus = firstField(containers,["taxStatus","taxResolutionStatus","taxLiabilityStatus"]);
  const gross = intMinor(firstField(containers,["grossRevenueMinor","grossCommissionMinor","grossPayoutMinor","grossIncomeMinor"]));

  const costFields = {
    taxLiabilityMinor: ["taxLiabilityMinor","taxMinor"],
    withholdingMinor: ["withholdingMinor","withholdingTaxMinor"],
    paymentFeeMinor: ["paymentFeeMinor","processorFeeMinor","pgFeeMinor"],
    fxFeeMinor: ["fxFeeMinor","currencyConversionFeeMinor"],
    networkFeeMinor: ["networkFeeMinor","affiliateNetworkFeeMinor","adNetworkFeeMinor"],
    refundReserveMinor: ["refundReserveMinor","returnReserveMinor"],
    chargebackReserveMinor: ["chargebackReserveMinor","disputeReserveMinor"],
    operatorCostMinor: ["operatorCostMinor","platformVariableCostMinor","transactionCostMinor"]
  };
  const costs = {};
  for(const [key,names] of Object.entries(costFields)) costs[key] = intMinor(firstField(containers,names));

  if(policy.requireVerifiedEconomics && !verified) blockers.push("ECONOMICS_NOT_SERVER_VERIFIED");
  if(!currency || !/^[A-Z]{3,8}$/.test(currency)) blockers.push("SETTLEMENT_CURRENCY_UNRESOLVED");
  if(policy.requireLegalRoleResolved && !statusResolved(legalRoleStatus)) blockers.push("LEGAL_ROLE_UNRESOLVED");
  if(policy.requireTaxResolved && !statusResolved(taxStatus)) blockers.push("TAX_STATUS_UNRESOLVED");
  if(gross === null || gross < 0n) blockers.push("GROSS_REVENUE_MINOR_MISSING_OR_INVALID");
  for(const [key,value] of Object.entries(costs)) if(value === null || value < 0n) blockers.push(key.replace(/Minor$/, "").toUpperCase()+"_MISSING_OR_INVALID");
  if(!policy.thresholdConfigured) blockers.push("PROFITABILITY_THRESHOLD_UNCONFIGURED");

  let totalCost = null, net = null, marginBps = null;
  if(gross !== null && gross >= 0n && Object.values(costs).every(value => value !== null && value >= 0n)){
    totalCost = Object.values(costs).reduce((sum,value)=>sum+value,0n);
    net = gross - totalCost;
    marginBps = gross > 0n ? Number((net * 10000n) / gross) : (net > 0n ? 10000 : 0);
    if(policy.minimumNetProfitMinor !== null && net < policy.minimumNetProfitMinor) blockers.push("MINIMUM_NET_PROFIT_NOT_MET");
    if(policy.minimumMarginBps !== null && marginBps < policy.minimumMarginBps) blockers.push("MINIMUM_MARGIN_NOT_MET");
    if(net < 0n) blockers.push("NEGATIVE_NET_PROFIT");
  }

  const gatePassed = blockers.length === 0;
  const commercialClass = classifyRoute(facts, gatePassed);
  return {
    version: VERSION,
    applicable: true,
    gatePassed,
    monetizationAllowed: gatePassed,
    commercialClass,
    commercialPriority: PRIORITY[commercialClass],
    state: gatePassed ? "verified_profitable" : "hold",
    currency: currency || null,
    grossRevenueMinor: gross === null ? null : safeNumberOrString(gross),
    costsMinor: Object.fromEntries(Object.entries(costs).map(([key,value])=>[key,value===null?null:safeNumberOrString(value)])),
    totalCostMinor: totalCost === null ? null : safeNumberOrString(totalCost),
    netProfitMinor: net === null ? null : safeNumberOrString(net),
    marginBps,
    blockers: Array.from(new Set(blockers)),
    warnings,
    legalRoleStatus: text(legalRoleStatus) || null,
    taxStatus: text(taxStatus) || null,
    verifiedEconomics: verified,
    facts,
    policy: publicPolicy(policy)
  };
}

function priorityOf(rowInput){
  const row = plain(rowInput);
  const gate = plain(row.profitabilityAssessment || row.monetizationAssessment);
  const n = Number(gate.commercialPriority);
  return Number.isFinite(n) ? n : PRIORITY.ORDINARY;
}

module.exports = { VERSION, PRIORITY, assess, priorityOf };
