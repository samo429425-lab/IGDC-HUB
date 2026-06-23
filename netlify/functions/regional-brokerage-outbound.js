"use strict";

const fs = require("fs");
const path = require("path");
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
function appendTracking(url, record, requestId) {
  const target = new URL(record.targetUrl);
  if (!/^https?:$/.test(target.protocol) || target.host.toLowerCase() !== String(record.approvedHost || "").toLowerCase()) return "";
  if (!target.searchParams.has("utm_source")) target.searchParams.set("utm_source", "igdc_maru");
  if (!target.searchParams.has("utm_medium")) target.searchParams.set("utm_medium", "brokerage_referral");
  if (!target.searchParams.has("utm_campaign")) target.searchParams.set("utm_campaign", "distribution_hub");
  target.searchParams.set("igdc_ref", String(requestId || record.id));
  return target.toString();
}
exports.handler = async (event) => {
  const id = String((event && event.queryStringParameters && event.queryStringParameters.id) || "").trim();
  if (!id) return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: "Missing referral id" };
  const record = readRegistry()[id];
  if (!record) return { statusCode: 404, headers: { "Cache-Control": "no-store" }, body: "Referral listing not found" };
  const destination = appendTracking(record.targetUrl, record, id);
  if (!destination) return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: "Referral target unavailable" };
  return {
    statusCode: 302,
    headers: {
      Location: destination,
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-IGDC-Revenue-Line": "brokerage_referral_lead_ad"
    },
    body: ""
  };
};
