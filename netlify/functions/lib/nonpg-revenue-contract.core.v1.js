"use strict";

/**
 * Non-PG revenue contract core.
 *
 * This is a thin contract hook for external-seller referral and advertising
 * revenue. It never initiates a customer payment or a payout.
 *
 * A referral is treated as commission-eligible only when the source record
 * explicitly supplies an approved provider id, active status, and HTTPS
 * tracking URL. Generic outbound URLs, default percentage values, and
 * placeholder monetization fields never qualify as confirmed affiliate terms.
 */

const crypto = require("crypto");

const VERSION = "nonpg-revenue-contract-v1.0.0";
const ACTIVE = new Set(["active", "approved", "verified", "live", "enabled"]);
const SAFE_PARAM = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

function text(v){ return v == null ? "" : String(v).trim(); }
function low(v){ return text(v).toLowerCase(); }
function bool(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  return !["", "0", "false", "no", "off", "disabled", "null", "undefined"].includes(low(v));
}
function num(v, d){ const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); }
function first(){ for(const v of arguments){ const x = text(v); if(x) return x; } return ""; }
function plain(v){ return !!v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function httpsUrl(v){
  try {
    const u = new URL(text(v));
    return u.protocol === "https:" ? u.toString() : "";
  } catch(_e){ return ""; }
}
function hostOf(v){ try { return new URL(v).host.toLowerCase(); } catch(_e){ return ""; } }
function cleanId(v){ const s = text(v); return SAFE_ID.test(s) ? s : ""; }
function cleanParam(v, fallback){ const s = text(v); return SAFE_PARAM.test(s) ? s : (fallback || ""); }
function rate(v){ const n = num(v, NaN); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null; }
function conversion(v){ const n = num(v, NaN); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null; }

function affiliateSource(item){
  const raw = item || {};
  const extension = plain(raw.extension);
  const revenue = plain(raw.linkRevenue);
  const direct = plain(raw.affiliate);
  const nested = plain(extension.affiliate);
  const source = Object.assign({}, nested, direct);
  return { raw, source, revenue };
}

function affiliateForItem(item){
  const pack = affiliateSource(item);
  const raw = pack.raw;
  const a = pack.source;
  const r = pack.revenue;

  const providerId = cleanId(first(
    a.providerId, a.provider_id, a.partnerId, a.partner_id, a.provider, a.partner,
    raw.affiliateProviderId, raw.affiliateProvider, raw.affiliatePartnerId, raw.affiliatePartner,
    raw.partnerId, raw.partner_id
  ));
  const programId = cleanId(first(
    a.programId, a.program_id, a.program, raw.affiliateProgramId, raw.affiliateProgram,
    raw.affiliate_program_id
  ));
  const status = low(first(a.status, raw.affiliateStatus, raw.affiliate_status, raw.affiliateApproved === true ? "approved" : ""));
  const approved = bool(a.approved) || bool(a.verified) || raw.affiliateApproved === true || ACTIVE.has(status);
  const trackingUrl = httpsUrl(first(
    a.trackingUrl, a.tracking_url, a.affiliateTrackingUrl, a.affiliate_url, a.url,
    raw.affiliateTrackingUrl, raw.affiliate_tracking_url, raw.affiliateUrl, raw.affiliate_url,
    r.affiliateTrackingUrl, r.affiliateUrl
  ));
  const clickIdParam = cleanParam(first(
    a.clickIdParam, a.click_id_param, a.subIdParam, a.sub_id_param,
    raw.affiliateClickIdParam, raw.affiliate_click_id_param
  ), "subid");
  const commissionRate = rate(first(
    a.commissionRate, a.commission_rate, a.rate, raw.affiliateCommissionRate,
    raw.affiliate_commission_rate
  ));
  const expectedConversionRate = conversion(first(
    a.expectedConversionRate, a.expected_conversion_rate, a.conversionRate,
    raw.affiliateExpectedConversionRate, raw.affiliate_expected_conversion_rate
  ));
  const conversionMode = low(first(
    a.conversionMode, a.conversion_mode, raw.affiliateConversionMode, raw.affiliate_conversion_mode,
    a.postback ? "postback" : ""
  )) || "statement_import";
  const payoutCurrency = text(first(a.currency, a.payoutCurrency, raw.affiliateCurrency, raw.currency));
  const explicit = !!(providerId || trackingUrl || a.status || raw.affiliateStatus || raw.affiliateApproved === true);
  const eligible = !!(approved && providerId && trackingUrl);

  return {
    version: VERSION,
    present: explicit,
    eligible,
    status: status || (approved ? "approved" : "unconfigured"),
    providerId: providerId || null,
    programId: programId || null,
    trackingUrl: trackingUrl || null,
    trackingHost: trackingUrl ? hostOf(trackingUrl) : null,
    clickIdParam: clickIdParam || null,
    commissionRate,
    expectedConversionRate,
    conversionMode,
    payoutCurrency: payoutCurrency || null
  };
}

function publicAffiliate(item){
  const a = affiliateForItem(item);
  if(!a.present) return null;
  return {
    version: a.version,
    eligible: a.eligible,
    status: a.status,
    providerId: a.providerId,
    programId: a.programId,
    trackingUrl: a.trackingUrl,
    trackingHost: a.trackingHost,
    clickIdParam: a.clickIdParam,
    commissionRate: a.commissionRate,
    expectedConversionRate: a.expectedConversionRate,
    conversionMode: a.conversionMode,
    payoutCurrency: a.payoutCurrency
  };
}

function hmac(secret, textValue){
  return crypto.createHmac("sha256", String(secret)).update(String(textValue)).digest("base64url");
}
function timingEqual(a, b){
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function signClick(payload, secret){
  if(!secret) return "";
  const json = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return json + "." + hmac(secret, json);
}
function verifyClick(token, secret){
  if(!token || !secret) return null;
  const parts = String(token).split(".");
  if(parts.length !== 2 || !timingEqual(hmac(secret, parts[0]), parts[1])) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if(!data || typeof data !== "object") return null;
    if(Number(data.exp || 0) && Date.now() > Number(data.exp)) return null;
    return data;
  } catch(_e){ return null; }
}
function clickPayload(input){
  input = input || {};
  const affiliate = input.affiliate || {};
  const now = Date.now();
  return {
    v: 1,
    id: cleanId(input.itemId) || null,
    providerId: cleanId(affiliate.providerId) || null,
    programId: cleanId(affiliate.programId) || null,
    source: cleanId(input.source) || "igdc",
    ts: now,
    exp: now + Math.max(5 * 60 * 1000, Number(input.ttlMs || 30 * 24 * 60 * 60 * 1000))
  };
}
function decorateAffiliateUrl(rawUrl, input){
  const targetUrl = httpsUrl(rawUrl);
  if(!targetUrl) return "";
  const affiliate = input && input.affiliate || {};
  const allowedHost = text(affiliate.trackingHost || input && input.allowedHost).toLowerCase();
  const target = new URL(targetUrl);
  if(allowedHost && target.host.toLowerCase() !== allowedHost) return "";
  if(!target.searchParams.has("utm_source")) target.searchParams.set("utm_source", "igdc_maru");
  if(!target.searchParams.has("utm_medium")) target.searchParams.set("utm_medium", "brokerage_referral");
  if(!target.searchParams.has("utm_campaign")) target.searchParams.set("utm_campaign", text(input && input.campaign) || "distribution_hub");
  const ref = cleanId(input && input.referralId);
  if(ref) target.searchParams.set("igdc_ref", ref);
  const secret = text(input && input.clickSigningSecret);
  const clickIdParam = cleanParam(affiliate.clickIdParam, "");
  if(secret && clickIdParam){
    const token = signClick(clickPayload({
      itemId: input && input.itemId,
      affiliate,
      source: input && input.source,
      ttlMs: input && input.ttlMs
    }), secret);
    if(token) target.searchParams.set(clickIdParam, token);
  }
  return target.toString();
}

module.exports = {
  VERSION,
  affiliateForItem,
  publicAffiliate,
  decorateAffiliateUrl,
  signClick,
  verifyClick,
  hmac,
  timingEqual,
  cleanId,
  httpsUrl,
  hostOf,
  text,
  low,
  bool,
  num
};
