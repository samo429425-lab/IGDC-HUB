"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function text(v) { return v == null ? "" : String(v).trim(); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (_e) { return null; }
}
function incomingIntent() {
  const raw = text(process.env.INCOMING_HOOK_BODY);
  if (!raw) return { explicitPublish: false, body: null };
  try {
    const body = JSON.parse(raw);
    const trigger = text(body && body.trigger).toLowerCase();
    const operation = text(body && body.operation).toLowerCase();
    const authorization = text(body && body.authorization).toLowerCase();
    return {
      explicitPublish:
        authorization === "explicit_admin_confirmation" &&
        operation === "publish" &&
        trigger === "approved-commerce-assignment",
      body
    };
  } catch (_e) {
    return { explicitPublish: false, body: null };
  }
}
function rows(doc) {
  return Array.isArray(doc && doc.items) ? doc.items : [];
}
function realRows(doc) {
  return rows(doc).filter((item) => {
    if (!item || typeof item !== "object") return false;
    const url = text(
      item.affiliateOutboundUrl || item.externalOutboundUrl || item.externalProductUrl ||
      item.officialProductUrl || item.productUrl || item.productPageUrl || item.detailUrl ||
      item.checkoutUrl || item.purchaseUrl || item.orderUrl || item.url || item.href || item.link
    );
    if (!/^https:\/\//i.test(url)) return false;
    if (/(^|\.)example\.(com|org|net)(?:[\/:]|$)/i.test(url)) return false;
    if (item.sample === true || item.placeholder === true || item.realProduct === false) return false;
    return true;
  });
}
function fail(message, details) {
  process.stderr.write("\nIGDC RELEASE SAFETY GUARD: " + message + "\n");
  if (details) process.stderr.write(JSON.stringify(details, null, 2) + "\n");
  process.exit(86);
}

const intent = incomingIntent();
const child = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-regional-brokerage-snapshots.js")], {
  cwd: ROOT,
  env: process.env,
  encoding: "utf8",
  stdio: "pipe"
});
if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
if (child.error) fail("build process could not start", { error: String(child.error.message || child.error) });
if (Number(child.status || 0) !== 0) process.exit(Number(child.status || 1));

if (intent.explicitPublish) {
  const canonicalFile = path.join(ROOT, "data", "search-bank.snapshot.json");
  const canonical = readJson(canonicalFile);
  const canonicalRows = rows(canonical);
  const canonicalRealRows = realRows(canonical);

  if (!canonical || !Array.isArray(canonical.items)) {
    fail("explicit Front Match produced no valid Canonical SearchBank document; refusing deploy", {
      file: "data/search-bank.snapshot.json"
    });
  }
  if (canonicalRows.length === 0 || canonicalRealRows.length === 0) {
    fail("explicit Front Match produced zero real published products; refusing sample-fallback deployment", {
      canonicalItemCount: canonicalRows.length,
      realProductCount: canonicalRealRows.length,
      trigger: intent.body && intent.body.trigger,
      operation: intent.body && intent.body.operation,
      candidateCount: intent.body && intent.body.candidateCount
    });
  }

  const required = [
    "front.snapshot.json",
    "distribution.snapshot.json",
    "networkhub-snapshot.json",
    "tour-snapshot.json"
  ];
  const snapshotChecks = required.map((name) => {
    const file = path.join(ROOT, "data", name);
    const doc = readJson(file);
    return { name, validJson: !!doc };
  });
  const missing = snapshotChecks.filter((row) => !row.validJson);
  if (missing.length) {
    fail("explicit Front Match did not materialize every Distribution-owned snapshot; refusing deploy", {
      missing: missing.map((row) => row.name)
    });
  }
}

process.stdout.write("IGDC release safety guard OK\n");
process.exit(0);
