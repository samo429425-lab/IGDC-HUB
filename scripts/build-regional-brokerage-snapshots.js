"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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


const PREPRODUCT_PROTECTED_SNAPSHOTS = Object.freeze([
  { file: "data/search-bank.snapshot.json", kind: "searchBank" },
  { file: "netlify/functions/data/search-bank.snapshot.json", kind: "searchBank" },
  { file: "netlify/functions/search-bank.snapshot.json", kind: "searchBank" },
  { file: "data/front.snapshot.json", page: "home" },
  { file: "data/distribution.snapshot.json", page: "distribution" },
  { file: "data/networkhub-snapshot.json", page: "network" },
  { file: "data/tour-snapshot.json", page: "tour" },
  { file: "data/social.snapshot.json", page: "social" }
]);

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshotItemCount(doc, page) {
  if (!doc || typeof doc !== "object") return 0;
  if (page === "home") {
    return Object.values(doc.pages && doc.pages.home && doc.pages.home.sections || {}).flatMap(listRows).length;
  }
  if (page === "distribution") {
    return Object.values(doc.pages && doc.pages.distribution && doc.pages.distribution.sections || {}).flatMap(listRows).length;
  }
  if (page === "social") {
    const sections = doc.pages && doc.pages.social && doc.pages.social.sections || {};
    return Object.values(sections).flatMap(listRows).length;
  }
  return listRows(doc.items).concat(listRows(doc.slots)).length;
}

function capturePreproductSnapshotBaseline() {
  const rows = [];
  const problems = [];
  for (const descriptor of PREPRODUCT_PROTECTED_SNAPSHOTS) {
    const absolute = path.join(root, descriptor.file);
    if (!fileExists(absolute)) {
      problems.push("PREPRODUCT_SNAPSHOT_MISSING:" + descriptor.file);
      continue;
    }
    let doc;
    try { doc = readJson(absolute); }
    catch (error) {
      problems.push("PREPRODUCT_SNAPSHOT_INVALID_JSON:" + descriptor.file);
      continue;
    }
    const itemCount = descriptor.kind === "searchBank"
      ? (Array.isArray(doc.items) ? doc.items.length : 0)
      : snapshotItemCount(doc, descriptor.page);
    if (itemCount <= 0) problems.push("PREPRODUCT_SNAPSHOT_EMPTY:" + descriptor.file);
    rows.push({ path: descriptor.file, sha256: sha256File(absolute), itemCount });
  }
  const searchBank = rows.filter(row => row.path.endsWith("search-bank.snapshot.json"));
  if (searchBank.length !== 3) problems.push("PREPRODUCT_SEARCHBANK_MIRROR_COUNT_INVALID");
  else if (new Set(searchBank.map(row => row.sha256)).size !== 1) problems.push("PREPRODUCT_SEARCHBANK_MIRROR_DIVERGENCE");
  return { ok: problems.length === 0, rows, problems };
}

function assertPreproductSnapshotBaselineUnchanged(before) {
  const after = capturePreproductSnapshotBaseline();
  const problems = (before && before.problems || []).concat(after.problems || []);
  const beforeByPath = new Map((before && before.rows || []).map(row => [row.path, row]));
  for (const row of after.rows || []) {
    const prior = beforeByPath.get(row.path);
    if (!prior || prior.sha256 !== row.sha256 || prior.itemCount !== row.itemCount) {
      problems.push("PREPRODUCT_SNAPSHOT_MUTATED_DURING_BUILD:" + row.path);
    }
  }
  if (problems.length) {
    throw new Error("Pre-product snapshot preservation failure: " + JSON.stringify(problems));
  }
  return after;
}

async function main() {
  const upstreamFallback = emptyStagingUpstream();
  const stagingEmptyUpstream = !!upstreamFallback;

  if (stagingEmptyUpstream) {
    // There is no real verified upstream candidate source yet. A deployment in
    // this state is not a publication run. It must preserve every committed
    // SearchBank mirror and every existing front Snapshot byte-for-byte.
    // Running Canonical Publisher with an artificial empty bank previously
    // rewrote all SearchBank mirrors to zero items, which can cut existing
    // sample/automap supply even though no real publication was authorized.
    const before = capturePreproductSnapshotBaseline();
    if (!before.ok) {
      throw new Error("Pre-product snapshot baseline is not deployable: " + JSON.stringify(before.problems));
    }
    const after = assertPreproductSnapshotBaselineUnchanged(before);
    process.stdout.write(JSON.stringify({
      mode: "preproduct-preserve-existing-snapshots",
      upstreamFallback: { mode: "staging-empty", reason: upstreamFallback.meta.reason },
      publication: "skipped-no-real-upstream-candidates",
      commerceRegistrySync: "skipped-no-publication-run",
      protectedSnapshots: after.rows,
      lowerSnapshotPublishers: "skipped-preserve-existing-front-snapshots",
      donation: { mode: "independent-runtime-contract-not-touched" },
      ipSlots: { mode: "not-run-no-upstream-candidates" }
    }, null, 2) + "\n");
    return;
  }

  // Approved direct-commerce listings may be mirrored from the management
  // registry into the private review queue only when a real upstream candidate
  // source exists for this build. Missing optional registry access cannot
  // activate any candidate or public slot.
  const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });
  const publication = canonical.publish({
    root,
    trigger: "netlify-build"
  });
  if (publication.status !== "published") {
    throw new Error("Canonical Snapshot Publisher blocked build: " + JSON.stringify(publication.errors || publication));
  }
  const published = canonical.verifyPublished({ root });
  if (!published.ok) {
    throw new Error("Canonical Snapshot Publisher integrity failure: " + JSON.stringify(published.problems));
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
