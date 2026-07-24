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
const commerceIntake = require(path.join(root, "netlify", "functions", "lib", "commerce-candidate-intake.v1"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fileExists(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch (_error) { return false; }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function upstreamMirrorFiles() {
  return [
    path.join(root, "data", "search-bank.upstream.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "search-bank.upstream.snapshot.json"),
    path.join(root, "netlify", "functions", "search-bank.upstream.snapshot.json")
  ];
}

/*
 * Snapshot publication is allowed only with a confirmed, non-empty upstream
 * candidate set. Ordinary site/admin updates must preserve the committed
 * SearchBank and front Snapshot files exactly as they are.
 */
function loadConfirmedUpstream(commerceRegistrySync) {
  const files = upstreamMirrorFiles();
  const mirrors = files.map(file => ({ path: path.relative(root, file).replace(/\\/g, "/"), present: fileExists(file) }));
  const queueOnlyReady = !!(commerceRegistrySync && commerceRegistrySync.ok === true && Number(commerceRegistrySync.count || 0) > 0);

  if (mirrors.some(row => !row.present)) {
    if (queueOnlyReady) {
      return {
        ok: true,
        sourceMode: "approved-review-queue-only",
        warning: "upstream-candidate-source-missing",
        doc: { schema: "search-bank.upstream.review-queue-only.v1", generatedAt: new Date().toISOString(), items: [] },
        candidateCount: 0,
        mirrors
      };
    }
    return { ok: false, reason: "upstream-candidate-source-missing", mirrors };
  }

  const parsed = [];
  for (let index = 0; index < files.length; index += 1) {
    try {
      const doc = readJson(files[index]);
      if (!doc || !Array.isArray(doc.items)) {
        return { ok: false, reason: "upstream-candidate-source-invalid", mirrors };
      }
      parsed.push({ doc, hash: sha256File(files[index]) });
    } catch (_error) {
      return { ok: false, reason: "upstream-candidate-source-invalid", mirrors };
    }
  }

  if (new Set(parsed.map(row => row.hash)).size !== 1) {
    return { ok: false, reason: "upstream-candidate-mirrors-differ", mirrors };
  }

  if (parsed[0].doc.items.length === 0) {
    if (queueOnlyReady) {
      return {
        ok: true,
        sourceMode: "approved-review-queue-only",
        warning: "upstream-candidate-source-empty",
        doc: parsed[0].doc,
        candidateCount: 0,
        mirrors
      };
    }
    return { ok: false, reason: "upstream-candidate-source-empty", mirrors };
  }

  return {
    ok: true,
    sourceMode: "mirrored-sanmaru-searchbank-upstream",
    doc: parsed[0].doc,
    candidateCount: parsed[0].doc.items.length,
    mirrors
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

function writePreservedBuild(reason, details) {
  process.stdout.write(JSON.stringify({
    mode: "preserve-existing-snapshots",
    reason,
    details: details || null,
    publication: "skipped-no-confirmed-release-ready-candidates",
    lowerSnapshotPublishers: "skipped-preserve-existing-front-snapshots",
    donation: { mode: "independent-runtime-contract-not-touched" },
    ipSlots: { mode: "not-run-no-confirmed-release-ready-candidates" }
  }, null, 2) + "\n");
}

async function main() {
  // This sync only refreshes the private approved-candidate review queue. It
  // never writes a public Snapshot and cannot by itself publish front cards.
  const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });

  // Ordinary builds do not publish or regenerate Snapshot files. Publication
  // begins only after a real, mirrored upstream candidate source is present.
  const upstream = loadConfirmedUpstream(commerceRegistrySync);
  if (!upstream.ok) {
    writePreservedBuild(upstream.reason, { commerceRegistrySync, mirrors: upstream.mirrors });
    return;
  }

  // Build and persist the private candidate stage on every qualified build.
  // This makes the ordered research/revenue/assignment pipeline visible to the
  // candidate queue and go-live audit even while the public release key is off.
  // The intake writer touches only private staging/audit files; Canonical and
  // front snapshots remain blocked by the independent release gate below.
  let intake;
  try {
    intake = commerceIntake.build({
      root,
      items: upstream.doc.items,
      trigger: "netlify-build-private-candidate-stage",
      write: true
    });
  } catch (error) {
    writePreservedBuild("candidate-intake-preflight-failed", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      error: String(error && error.message || error)
    });
    return;
  }

  if (!intake.ok) {
    writePreservedBuild("candidate-intake-not-ready", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      problems: intake.problems || []
    });
    return;
  }

  if (!intake.releaseGate || intake.releaseGate.enabled !== true) {
    writePreservedBuild("candidate-release-not-authorized", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      releaseGate: intake.releaseGate || null
    });
    return;
  }

  if (!Array.isArray(intake.releaseItems) || intake.releaseItems.length === 0) {
    writePreservedBuild("no-release-ready-candidates", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      intakeSummary: intake.summary || null
    });
    return;
  }

  const publication = canonical.publish({ root, trigger: "netlify-build", bank: upstream.doc, requireMirrorConsensus: false });
  if (publication.status !== "published") {
    throw new Error("Canonical Snapshot Publisher blocked build: " + JSON.stringify(publication.errors || publication));
  }
  if (!publication.counts || Number(publication.counts.accepted || 0) <= 0) {
    throw new Error("Canonical Snapshot Publisher produced no accepted candidates; deployment halted before front Snapshot publishing.");
  }

  const published = canonical.verifyPublished({ root });
  if (!published.ok) {
    throw new Error("Canonical Snapshot Publisher integrity failure: " + JSON.stringify(published.problems));
  }

  // Only commercial Snapshot surfaces are built here. Donation has an
  // independent endpoint/snapshot contract and is intentionally excluded.
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
    upstream: { candidateCount: upstream.candidateCount, sourceMode: upstream.sourceMode || null, warning: upstream.warning || null, mirrors: upstream.mirrors },
    intake: { releaseGate: intake.releaseGate, summary: intake.summary },
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
