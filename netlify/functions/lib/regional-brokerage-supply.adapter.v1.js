"use strict";

/**
 * Additive, front-supply-only selector.
 * It never runs for ordinary SearchBank query, Search.js, or Global Insight.
 */
const Gate = require("./regional-brokerage-front-supply-gate.core.v1");
const Policy = require("./regional-brokerage-policy.core.v1");

function truthy(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  return !["", "0", "false", "no", "off", "disabled", "disable"].includes(String(v).trim().toLowerCase());
}
function text(v) { return v == null ? "" : String(v).trim(); }
function first() { for (const v of arguments) { const s = text(v); if (s) return s; } return ""; }
function isDistributionRequest(params) {
  params = params || {};
  if (!truthy(params.regionalBrokerageSupply)) return false;
  const page = first(params.hub, params.page, params.targetPage, params.channel, params.route).toLowerCase();
  const section = first(params.section, params.psom_key, params.slot, params.slotKey).toLowerCase();
  return /distribution|commerce|product|shop|market/.test(page + " " + section);
}
function selection(items, params) {
  params = params || {};
  if (!isDistributionRequest(params)) return null;
  const targetMarket = Policy.normalizeCountry(first(params.targetMarket, params.targetCountry, params.country, params.audienceCountry));
  if (!targetMarket) return null;
  const targetRegion = Policy.normalizeRegion(first(params.targetRegion, params.state, params.province, params.region), targetMarket);
  const selected = Gate.selectItems(Array.isArray(items) ? items : [], {
    targetMarket,
    targetRegion,
    hub: "distribution",
    forceEnforce: true
  });
  const decorated = selected.items.map((item) => {
    const copy = Object.assign({}, item);
    const decision = Gate.decisionForCandidate(item, selected, { hub: "distribution" });
    copy.regionalBrokerage = {
      targetMarket,
      targetRegion: targetRegion || null,
      supplyTier: decision && decision.supplyTier || "unknown",
      supplyTierOrder: decision && decision.supplyTierOrder || 999,
      externalSellerReferral: true,
      directSale: false,
      policyVersion: selected.audit && selected.audit.policyVersion || null
    };
    return copy;
  });
  return {
    items: decorated,
    meta: {
      active: true,
      targetMarket,
      targetRegion: targetRegion || null,
      acceptedCount: selected.audit && selected.audit.acceptedCount || 0,
      heldCount: selected.audit && selected.audit.heldCount || 0,
      acceptedByTier: selected.audit && selected.audit.acceptedByTier || {},
      heldByReason: selected.audit && selected.audit.heldByReason || {},
      policyVersion: selected.audit && selected.audit.policyVersion || null
    }
  };
}

module.exports = { isDistributionRequest, selection };
