"use strict";

/* Explicit, evidence-backed danger signals only. Never guess fraud from language,
 * product category, vendor country or an ordinary complaint word in a listing.
 * These are immutable safety exceptions to administrator ranking/placement
 * precedence, not a second commercial or semantic product review.
 */
const VERSION = "commerce-hard-risk-v1.0.0";
const FLAG_NAMES = Object.freeze([
  "scam", "fraud", "phishing", "counterfeit", "illegal", "sanctioned",
  "sellerImpersonation", "sellerIdentityMismatch", "verifiedIdentityMismatch",
  "knownFraud", "confirmedFraud", "confirmedScam", "confirmedPhishing",
  "fraudulentPayment", "verifiedRefundNonPerformance", "verifiedSupportNonPerformance"
]);
const RISK_RX = /(?:^|[^a-z])(?:fraud|scam|phish(?:ing)?|counterfeit|seller[_ -]?impersonation|seller[_ -]?identity[_ -]?mismatch|verified[_ -]?refund[_ -]?nonperformance|verified[_ -]?support[_ -]?nonperformance|sanction(?:ed)?|illegal[_ -]?(?:sale|merchant|product)|malware)(?:$|[^a-z])/i;
const RISK_FIELDS = ["risk", "riskAssessment", "searchBankContract", "supplierRisk", "sellerRisk", "brokerageVerification", "fraudScreening"];
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function entries(value) { return Array.isArray(value) ? value : []; }
function collect(item) {
  const row = object(item), found = new Set();
  const payload = object(row.source_payload || row.payload);
  const objects = [row, payload, object(row.commerceCandidate),
    ...RISK_FIELDS.map(key => object(row[key])), ...RISK_FIELDS.map(key => object(payload[key]))];
  for (const container of objects) {
    for (const name of FLAG_NAMES) if (container[name] === true) found.add("CONFIRMED_" + name.replace(/([a-z])([A-Z])/g,"$1_$2").toUpperCase());
    for (const field of ["blockers", "riskBlockers", "hardRiskFlags", "confirmedRiskSignals"]) {
      for (const signal of entries(container[field])) {
        const value = String(signal || "").trim().slice(0,120);
        if (RISK_RX.test(value)) found.add("CONFIRMED_RISK_SIGNAL:" + value.replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,80));
      }
    }
  }
  return Array.from(found);
}
module.exports = { VERSION, collect };
