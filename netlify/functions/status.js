// netlify/functions/status.js
// Unified status endpoint (reads pay-config.js as source of truth)

const path = require("path");

function boolEnv(name) {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return String(v).toLowerCase() === "true";
}

exports.handler = async function () {
  let config = {};
  try {
    delete require.cache[require.resolve("./data/pay-config.js")];
    config = require("./data/pay-config.js");
  } catch (e) {
    config = {};
  }

  const enabled =
    boolEnv("IGDC_PAY_ENABLED") ??
    config.enabled ??
    true;

  const features = config.features || {};

  const commerceEnabled =
    boolEnv("IGDC_COMMERCE_ENABLED") ??
    features.commerce === true;

  const donationEnabled =
    boolEnv("IGDC_DONATION_ENABLED") ??
    features.donation === true;

  const affiliateEnabled =
    boolEnv("IGDC_AFFILIATE_ENABLED") ??
    features.affiliate === true;

  const trackingEnabled =
    boolEnv("IGDC_TRACKING_ENABLED") ??
    features.tracking === true;

  const maintenance =
    boolEnv("IGDC_MAINTENANCE") ??
    config.maintenance === true;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ok: true,
      enabled,
      maintenance,
      features: {
        commerce: commerceEnabled,
        donation: donationEnabled,
        affiliate: affiliateEnabled,
        tracking: trackingEnabled
      }
    })
  };
};
