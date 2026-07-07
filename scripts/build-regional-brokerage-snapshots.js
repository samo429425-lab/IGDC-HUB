"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const canonical = require(path.join(root, "netlify", "functions", "lib", "canonical-snapshot-publisher.v1"));
const snapshots = require(path.join(root, "netlify", "functions", "snapshot-engine"));
const regional = require(path.join(root, "netlify", "functions", "lib", "regional-brokerage-publisher.v1"));
const ipSlots = require(path.join(root, "netlify", "functions", "lib", "ip-slot-snapshot-publisher.v1"));
const commerceRegistry = require(path.join(root, "netlify", "functions", "lib", "commerce-candidate-registry-sync.v1"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fileExists(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch (_e) { return false; }
}

function upstreamMirrorFiles() {
  return [
    path.join(root, "data", "search-bank.upstream.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "search-bank.upstream.snapshot.json"),
    path.join(root, "netlify", "functions", "search-bank.upstream.snapshot.json")
  ];
}

function emptyStagingUpstream() {
  // The private SearchBank/Sanmaru candidate source is intentionally absent
  // until real verified intake is provisioned. During staging-only builds, use
  // an explicit empty input for Canonical safety accounting only. Do not run
  // lower snapshot publishers in this mode; the existing front snapshots and
  // their sample/automap placeholders must remain untouched until real product
  // candidates are present.
  const releaseMode = String(process.env.COMMERCE_CANDIDATE_RELEASE_MODE || "").trim().toLowerCase();
  if (releaseMode === "enabled" || upstreamMirrorFiles().some(fileExists)) return null;
  return {
    meta: {
      schema: "search-bank.upstream.staging-empty.v1",
      source: "netlify-build-empty-upstream",
      generatedAt: new Date().toISOString(),
      reason: "upstream-candidate-source-not-yet-provisioned"
    },
    items: []
  };
}

const ROOT_GATE_PAGE_BY_FILE = Object.freeze({
  "front.snapshot.json": "home",
  "distribution.snapshot.json": "distribution",
  "networkhub-snapshot.json": "network",
  "tour-snapshot.json": "tour",
  "social.snapshot.json": "social"
});

function listRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.slots)) return value.slots;
  return [];
}

function rootGateRows(doc, page) {
  if (!doc || typeof doc !== "object") return [];
  if (page === "home") {
    const sections = doc.pages && doc.pages.home && doc.pages.home.sections;
    return Object.values(sections || {}).flatMap(listRows);
  }
  if (page === "distribution") {
    const sections = doc.pages && doc.pages.distribution && doc.pages.distribution.sections;
    return Object.values(sections || {}).flatMap(listRows);
  }
  if (page === "social") {
    const sections = doc.pages && doc.pages.social && doc.pages.social.sections;
    return listRows(sections && sections.rightPanel);
  }
  return listRows(doc.items).concat(listRows(doc.slots));
}

function verifyPublishedRootGeoGates(ipSlotReport) {
  const writes = Array.isArray(ipSlotReport && ipSlotReport.rootGates) ? ipSlotReport.rootGates : [];
  const checked = new Set();
  const summary = [];
  const problems = [];
  for (const write of writes) {
    const relative = String(write && write.path || "").replace(/\\/g, "/");
    if (!relative || checked.has(relative)) continue;
    checked.add(relative);
    const file = path.basename(relative);
    const page = ROOT_GATE_PAGE_BY_FILE[file];
    if (!page) {
      problems.push("IP_SLOT_ROOT_GATE_UNKNOWN_FILE:" + relative);
      continue;
    }
    const absolute = path.join(root, relative);
    const doc = readJson(absolute);
    const meta = doc && doc.meta && typeof doc.meta === "object" ? doc.meta : {};
    const rows = rootGateRows(doc, page);
    const metaOk = meta.ipSlotGeoGate === true && meta.geoResolutionRequired === true && meta.geoMatched === false && meta.noCrossCountryFallback === true && meta.noGlobalFallback === true;
    summary.push({ path: relative, page, cardCount: rows.length, metaOk });
    if (!metaOk) problems.push("IP_SLOT_ROOT_GATE_META_INVALID:" + relative);
    if (rows.length) problems.push("IP_SLOT_ROOT_GATE_NOT_EMPTY:" + relative + ":" + rows.length);
  }
  if (!checked.size) problems.push("IP_SLOT_ROOT_GATE_OUTPUT_MISSING");
  return { ok: problems.length === 0, summary, problems };
}

async function main() {
  // Approved direct-commerce listings may be mirrored from the management
  // registry into the private review queue. Missing optional registry access
  // cannot activate any candidate or public slot.
  const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });
  const upstreamFallback = emptyStagingUpstream();
  const stagingEmptyUpstream = !!upstreamFallback;
  const publication = canonical.publish({
    root,
    trigger: "netlify-build",
    bank: upstreamFallback || undefined
  });
  if (publication.status !== "published") {
    throw new Error("Canonical Snapshot Publisher blocked build: " + JSON.stringify(publication.errors || publication));
  }
  const published = canonical.verifyPublished({ root });
  if (!published.ok) {
    throw new Error("Canonical Snapshot Publisher integrity failure: " + JSON.stringify(published.problems));
  }

  if (stagingEmptyUpstream) {
    // Critical preservation branch: there is no real upstream product feed yet.
    // Do not call Snapshot Engine, Regional Brokerage Publisher, or IP Slot
    // Publisher because those modules are allowed to rewrite root snapshots for
    // real geo-scoped releases. In this preparation mode the deployed site must
    // keep the current sample/automap slots exactly as committed.
    process.stdout.write(JSON.stringify({
      commerceRegistrySync,
      upstreamFallback: { mode: "staging-empty", reason: upstreamFallback.meta.reason },
      publication,
      published,
      lowerSnapshotPublishers: "skipped-preserve-existing-front-snapshots",
      donation: { mode: "independent-runtime-contract-not-touched" },
      ipSlots: { mode: "not-run-no-upstream-candidates" }
    }, null, 2) + "\n");
    return;
  }

  // Only commercial Snapshot surfaces are built here. Donation has an
  // independent endpoint/snapshot contract and is intentionally excluded.
  // Existing root placeholders are replaced only when a real upstream candidate
  // source exists or release mode explicitly requires one.
  snapshots.run({ canonicalReleaseId: publication.releaseId });

  const regionalReport = regional.publishFromSearchBank({ root, trigger: "netlify-build-canonical" });
  const ipSlotReport = ipSlots.publish({ root, trigger: "netlify-build-canonical-ip-slots" });
  if (ipSlotReport.status !== "published") {
    throw new Error("Canonical IP Slot Publisher blocked build: " + JSON.stringify(ipSlotReport.errors || ipSlotReport));
  }
  const ipSlotVerification = ipSlots.verifyPublished({ root });
  if (!ipSlotVerification.ok) {
    throw new Error("Canonical IP Slot Publisher integrity failure: " + JSON.stringify(ipSlotVerification.problems));
  }
  const rootGateVerification = verifyPublishedRootGeoGates(ipSlotReport);
  if (!rootGateVerification.ok) {
    throw new Error("Canonical IP root geo-gate integrity failure: " + JSON.stringify(rootGateVerification.problems));
  }

  process.stdout.write(JSON.stringify({
    commerceRegistrySync,
    upstreamFallback: null,
    publication,
    published,
    donation: { mode: "independent-runtime-contract-not-touched" },
    regional: regionalReport,
    ipSlots: ipSlotReport,
    ipSlotVerification,
    rootGateVerification
  }, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
