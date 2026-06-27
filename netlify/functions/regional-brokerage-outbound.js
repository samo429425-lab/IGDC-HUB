"use strict";

const fs = require("fs");
const path = require("path");
const Contract = require("./lib/nonpg-revenue-contract.core.v1");
const REGISTRY = "regional-brokerage-outbound.json";

function readRegistry() {
  const paths = [
    path.join(__dirname, "data", REGISTRY),
    path.join(process.cwd(), "netlify", "functions", "data", REGISTRY),
    path.join(process.cwd(), "data", REGISTRY)
  ];
  for (const file of paths) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    } catch (_e) {}
  }
  return {};
}

function affiliateForRecord(record){
  return Contract.affiliateForItem({ affiliate: record && record.affiliate });
}
function appendTracking(record, requestId) {
  const affiliate = affiliateForRecord(record);
  const base = affiliate.eligible && affiliate.trackingUrl ? affiliate.trackingUrl : record.targetUrl;
  const allowedHost = affiliate.eligible ? affiliate.trackingHost : String(record.approvedHost || "").toLowerCase();
  const target = Contract.decorateAffiliateUrl(base, {
    affiliate: affiliate.eligible ? affiliate : {},
    allowedHost,
    referralId: requestId || record.id,
    itemId: record.sourceItemId || record.id,
    source: "regional-brokerage-outbound",
    campaign: "distribution_hub",
    clickSigningSecret: process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET || ""
  });
  return { destination: target, affiliate };
}

exports.handler = async (event) => {
  const id = String((event && event.queryStringParameters && event.queryStringParameters.id) || "").trim();
  if (!id) return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: "Missing referral id" };
  const record = readRegistry()[id];
  if (!record) return { statusCode: 404, headers: { "Cache-Control": "no-store" }, body: "Referral listing not found" };
  const resolved = appendTracking(record, id);
  if (!resolved.destination) return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: "Referral target unavailable" };
  return {
    statusCode: 302,
    headers: {
      Location: resolved.destination,
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-IGDC-Revenue-Line": "brokerage_referral_lead_ad",
      "X-IGDC-Affiliate-Ready": resolved.affiliate.eligible ? "true" : "false"
    },
    body: ""
  };
};
