"use strict";

const assert = require("assert");
const Gate = require("../netlify/functions/lib/commerce-profitability-gate.v1");
const Ranking = require("../netlify/functions/lib/commerce-product-ranking.v1");

const policy = {
  profitabilityPolicy: {
    minimumNetProfitMinor: 100,
    minimumMarginBps: 500,
    requireVerifiedEconomics: true,
    requireTaxResolved: true,
    requireLegalRoleResolved: true
  }
};

function economics(overrides){
  return Object.assign({
    verified: true,
    currency: "KRW",
    legalRoleStatus: "resolved",
    taxStatus: "resolved",
    grossRevenueMinor: 10000,
    taxLiabilityMinor: 1000,
    withholdingMinor: 0,
    paymentFeeMinor: 300,
    fxFeeMinor: 0,
    networkFeeMinor: 200,
    refundReserveMinor: 200,
    chargebackReserveMinor: 100,
    operatorCostMinor: 500
  }, overrides || {});
}

function base(id, host){
  return {
    id,
    productName: "검증 상품 " + id,
    title: "검증 상품 " + id,
    productUrl: `https://${host}/products/${id}`,
    url: `https://${host}/products/${id}`,
    imageUrl: `https://${host}/images/${id}.jpg`,
    imageOriginalUrl: `https://${host}/images/${id}.jpg`,
    supplierSiteUrl: `https://${host}/`,
    supplierName: "Supplier " + id,
    supplierEvidenceReady: true,
    supplierApprovalReady: true,
    supplierTrustScore: 96,
    supplierDecision: "approve",
    sameSupplierSite: true,
    researchStatus: "ready_for_admin_review",
    inspectionComplete: true,
    jsonLdProduct: true,
    offerPresent: true,
    productPageLive: true,
    availability: "in_stock",
    price: 50000,
    priceCurrency: "KRW"
  };
}

function settlement(stage){
  return {
    stage,
    settlementReady: true,
    payoutBasisVerified: true,
    trackingVerified: true,
    officialDestination: true,
    trackingUrl: "https://partner.example.com/track/item",
    counterparty: "Verified Partner Ltd",
    settlementMode: "commission",
    contractVerified: stage === "formal_partner",
    contractId: "contract-" + stage,
    programId: "program-" + stage
  };
}

const direct = Object.assign(base("direct", "direct.example.com"), {
  sourceTier: "approved_commerce_member",
  affiliateSettlement: settlement("formal_partner"),
  monetizationEconomics: economics()
});
const formal = Object.assign(base("formal", "formal.example.com"), {
  sourceTier: "risk_ranked_official_supplier_product",
  affiliateSettlement: settlement("formal_partner"),
  monetizationEconomics: economics()
});
const affiliate = Object.assign(base("affiliate", "affiliate.example.com"), {
  sourceTier: "risk_ranked_official_supplier_product",
  affiliateSettlement: settlement("online_affiliate_active"),
  monetizationEconomics: economics({ networkFeeMinor: 400 })
});
const ordinary = Object.assign(base("ordinary", "ordinary.example.com"), {
  sourceTier: "risk_ranked_official_supplier_product"
});
const loss = Object.assign(base("loss", "loss.example.com"), {
  sourceTier: "risk_ranked_official_supplier_product",
  affiliateSettlement: settlement("formal_partner"),
  monetizationEconomics: economics({ taxLiabilityMinor: 8000, operatorCostMinor: 3000 })
});

// Gate-level verification.
let a = Gate.assess(direct, Ranking.commercialAssessment(direct, Ranking.classifyCategory(direct), {gatePassed:true}, policy).revenueEvidence, policy);
assert.strictEqual(a.gatePassed, true);
assert.strictEqual(a.commercialClass, "DIRECT_COMMERCE_VERIFIED");
assert.strictEqual(a.netProfitMinor, 7700);
assert.strictEqual(a.marginBps, 7700);

let b = Gate.assess(loss, Ranking.commercialAssessment(loss, Ranking.classifyCategory(loss), {gatePassed:true}, policy).revenueEvidence, policy);
assert.strictEqual(b.gatePassed, false);
assert.strictEqual(b.commercialClass, "REVENUE_ROUTE_HOLD");
assert.ok(b.blockers.includes("NEGATIVE_NET_PROFIT"));

// Unresolved tax must fail closed.
const unresolved = Object.assign({}, formal, { id:"unresolved", monetizationEconomics: economics({ taxStatus:"pending" }) });
let c = Gate.assess(unresolved, Ranking.commercialAssessment(unresolved, Ranking.classifyCategory(unresolved), {gatePassed:true}, policy).revenueEvidence, policy);
assert.strictEqual(c.gatePassed, false);
assert.ok(c.blockers.includes("TAX_STATUS_UNRESOLVED"));

// Missing threshold policy must fail closed for monetized routes.
let d = Gate.assess(formal, Ranking.commercialAssessment(formal, Ranking.classifyCategory(formal), {gatePassed:true}, {}).revenueEvidence, {});
assert.strictEqual(d.gatePassed, false);
assert.ok(d.blockers.includes("PROFITABILITY_THRESHOLD_UNCONFIGURED"));

// Portfolio ordering: verified direct > formal > active affiliate > ordinary > held monetization.
const portfolio = Ranking.buildPortfolio([ordinary, loss, affiliate, formal, direct], policy);
const representatives = portfolio.products.filter(row => row.familyRepresentative !== false && row.rankingEligible === true);
const order = representatives.map(row => row.id);
assert.deepStrictEqual(order.slice(0,5), ["direct","formal","affiliate","ordinary","loss"]);
const classes = Object.fromEntries(portfolio.products.map(row => [row.id, row.commercialPriorityClass]));
assert.strictEqual(classes.direct, "DIRECT_COMMERCE_VERIFIED");
assert.strictEqual(classes.formal, "FORMAL_PARTNER");
assert.strictEqual(classes.affiliate, "AFFILIATE_ACTIVE");
assert.strictEqual(classes.ordinary, "ORDINARY");
assert.strictEqual(classes.loss, "REVENUE_ROUTE_HOLD");
assert.strictEqual(portfolio.summary.profitabilityGatePassed, 3);
assert.strictEqual(portfolio.summary.profitabilityHeld, 1);

// Replay / determinism: same input yields same order and economics result.
const replay = Ranking.buildPortfolio([ordinary, loss, affiliate, formal, direct], policy);
assert.deepStrictEqual(replay.products.map(row => row.id), portfolio.products.map(row => row.id));
assert.deepStrictEqual(replay.products.map(row => row.commercialPriorityClass), portfolio.products.map(row => row.commercialPriorityClass));

console.log(JSON.stringify({
  ok: true,
  gateVersion: Gate.VERSION,
  rankingVersion: Ranking.VERSION,
  order,
  summary: portfolio.summary,
  lossBlockers: b.blockers,
  unresolvedTaxBlockers: c.blockers
}, null, 2));
