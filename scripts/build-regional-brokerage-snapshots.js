"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const root = path.resolve(__dirname, "..");
const canonical = require(path.join(root, "netlify", "functions", "lib", "canonical-snapshot-publisher.v1"));
const snapshots = require(path.join(root, "netlify", "functions", "snapshot-engine"));
const regional = require(path.join(root, "netlify", "functions", "lib", "regional-brokerage-publisher.v1"));
const ipSlots = require(path.join(root, "netlify", "functions", "lib", "ip-slot-snapshot-publisher.v1"));
const commerceRegistry = require(path.join(root, "netlify", "functions", "lib", "commerce-candidate-registry-sync.v1"));
const commerceIntake = require(path.join(root, "netlify", "functions", "lib", "commerce-candidate-intake.v1"));

async function publishSocialIndependently() {
  const adapterPath = path.join(root, "netlify", "functions", "lib", "social-searchbank-release-adapter.v1");
  let socialRelease;
  try {
    socialRelease = require(adapterPath);
  } catch (error) {
    return {
      status: "skipped",
      isolated: true,
      reason: "social_release_adapter_unavailable",
      error: String(error && error.message || error)
    };
  }
  if (!socialRelease || typeof socialRelease.publish !== "function") {
    return {
      status: "skipped",
      isolated: true,
      reason: "social_release_adapter_invalid"
    };
  }
  try {
    const result = await socialRelease.publish({ root, snapshotEngine: snapshots });
    return Object.assign({}, result || {}, { isolated: true });
  } catch (error) {
    return {
      status: "failed",
      isolated: true,
      reason: "social_release_execution_failed",
      error: String(error && error.message || error)
    };
  }
}

const SOCIAL_CHECKPOINT_TARGETS = [
  path.join("data", "social.snapshot.json"),
  path.join("data", "social-searchbank.release.snapshot.json"),
  path.join("data", "social-pipeline.report.json"),
  path.join("netlify", "functions", "data", "social.snapshot.json"),
  path.join("netlify", "functions", "social.snapshot.json"),
  // Social publication now hands approved real content into the ordinary
  // SearchBank Snapshot mirrors. Include all mirrors in the social transaction
  // so any failed policy/PSOM/downstream verification restores the exact bank.
  path.join("data", "search-bank.snapshot.json"),
  path.join("netlify", "functions", "data", "search-bank.snapshot.json"),
  path.join("netlify", "functions", "search-bank.snapshot.json")
];

function createSocialCheckpoint() {
  const checkpointRoot = fs.mkdtempSync(path.join(os.tmpdir(), "igdc-social-checkpoint-"));
  const entries = SOCIAL_CHECKPOINT_TARGETS.map(relative => {
    const source = path.join(root, relative);
    const backup = path.join(checkpointRoot, relative);
    const present = fs.existsSync(source);
    if (present) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(source, backup);
    }
    return { relative, source, backup, present };
  });
  return { checkpointRoot, entries };
}

function restoreSocialCheckpoint(checkpoint) {
  const restored = [];
  for (const entry of checkpoint.entries) {
    fs.rmSync(entry.source, { force: true });
    if (entry.present) {
      fs.mkdirSync(path.dirname(entry.source), { recursive: true });
      fs.copyFileSync(entry.backup, entry.source);
    }
    restored.push(entry.relative.replace(/\\/g, "/"));
  }
  return restored;
}

function removeSocialCheckpoint(checkpoint) {
  if (checkpoint && checkpoint.checkpointRoot) {
    fs.rmSync(checkpoint.checkpointRoot, { recursive: true, force: true });
  }
}

const COMMERCE_CHECKPOINT_TARGETS = [
  { type: "directory", relative: "data" },
  { type: "directory", relative: path.join("netlify", "functions", "data") },
  { type: "file", relative: path.join("netlify", "functions", "search-bank.snapshot.json") }
];

function createCommerceCheckpoint() {
  const checkpointRoot = fs.mkdtempSync(path.join(os.tmpdir(), "igdc-commerce-checkpoint-"));
  const entries = [];
  for (const target of COMMERCE_CHECKPOINT_TARGETS) {
    const source = path.join(root, target.relative);
    const backup = path.join(checkpointRoot, target.relative);
    const present = fs.existsSync(source);
    entries.push(Object.assign({}, target, { source, backup, present }));
    if (!present) continue;
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(source, backup, { recursive: true, force: true });
  }
  return { checkpointRoot, entries };
}

function restoreCommerceCheckpoint(checkpoint) {
  const restored = [];
  for (const entry of checkpoint.entries) {
    fs.rmSync(entry.source, { recursive: true, force: true });
    if (entry.present) {
      fs.mkdirSync(path.dirname(entry.source), { recursive: true });
      fs.cpSync(entry.backup, entry.source, { recursive: true, force: true });
    }
    restored.push(entry.relative.replace(/\\/g, "/"));
  }
  return restored;
}

function removeCommerceCheckpoint(checkpoint) {
  if (checkpoint && checkpoint.checkpointRoot) {
    fs.rmSync(checkpoint.checkpointRoot, { recursive: true, force: true });
  }
}

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
  const queueAuthoritative = !!(
    commerceRegistrySync &&
    commerceRegistrySync.ok === true &&
    commerceRegistrySync.status === "synchronized" &&
    commerceRegistrySync.authoritative === true &&
    Number(commerceRegistrySync.requestedCount || 0) > 0
  );
  const queueMeta = {
    authoritative: queueAuthoritative,
    requestedCount: Number(commerceRegistrySync && commerceRegistrySync.requestedCount || 0),
    scopeKeys: Array.isArray(commerceRegistrySync && commerceRegistrySync.scopeKeys) ? commerceRegistrySync.scopeKeys.slice() : [],
    releaseAuthorization: commerceRegistrySync && commerceRegistrySync.releaseAuthorization || null
  };

  if (queueAuthoritative) {
    try {
      const queueFile = String(commerceRegistrySync.file || path.join(root, "netlify", "functions", "data", "commerce-candidate-review-queue.v1.json"));
      const queueDoc = readJson(queueFile);
      const requestedItems = Array.isArray(queueDoc && queueDoc.items)
        ? queueDoc.items.filter(item => item && item.publicationRequest && item.publicationRequest.requested === true)
        : [];
      if (requestedItems.length !== queueMeta.requestedCount || requestedItems.length === 0) {
        return { ok: false, reason: "authoritative-admin-queue-count-mismatch", mirrors, queueAuthoritative };
      }
      return {
        ok: true,
        sourceMode: "authoritative-admin-review-queue",
        doc: Object.assign({}, queueDoc, { queue: queueMeta, items: requestedItems }),
        candidateCount: requestedItems.length,
        queueAuthoritative,
        mirrors
      };
    } catch (_error) {
      return { ok: false, reason: "authoritative-admin-queue-invalid", mirrors, queueAuthoritative };
    }
  }

  if (mirrors.some(row => !row.present)) {
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
    return { ok: false, reason: "upstream-candidate-source-empty", mirrors };
  }

  return {
    ok: true,
    sourceMode: queueAuthoritative ? "mirrored-sanmaru-searchbank-upstream+authoritative-admin-review-queue" : "mirrored-sanmaru-searchbank-upstream",
    doc: Object.assign({}, parsed[0].doc, { queue:queueMeta }),
    candidateCount: parsed[0].doc.items.length,
    queueAuthoritative,
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

function verifyPublishedRootSampleFallbacks(ipSlotReport) {
  const writes = Array.isArray(ipSlotReport && ipSlotReport.rootFallbacks)
    ? ipSlotReport.rootFallbacks
    : (Array.isArray(ipSlotReport && ipSlotReport.rootGates) ? ipSlotReport.rootGates : []);
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
      problems.push("IP_SLOT_ROOT_FALLBACK_UNKNOWN_FILE:" + relative);
      continue;
    }
    const absolute = path.join(root, relative);
    const doc = readJson(absolute);
    const meta = doc && doc.meta && typeof doc.meta === "object" ? doc.meta : {};
    const rows = rootGateRows(doc, page);
    const unsafe = rows.filter(row => !(row && row.sample === true && row.placeholder === true && row.realProduct === false && String(row.url || "") === "#" && String(row.link || "") === "#" && row.monetization && row.monetization.enabled === false));
    const metaOk = meta.ipSlotSampleFallback === true && meta.geoResolutionRequired === true && meta.geoMatched === false && meta.noCrossCountryFallback === true && meta.noGlobalRealProductFallback === true;
    summary.push({ path: relative, page, cardCount: rows.length, unsafeCount: unsafe.length, metaOk });
    if (!metaOk) problems.push("IP_SLOT_ROOT_FALLBACK_META_INVALID:" + relative);
    if (!rows.length) problems.push("IP_SLOT_ROOT_FALLBACK_EMPTY:" + relative);
    if (unsafe.length) problems.push("IP_SLOT_ROOT_FALLBACK_UNSAFE:" + relative + ":" + unsafe.length);
  }
  if (!checked.size) problems.push("IP_SLOT_ROOT_FALLBACK_OUTPUT_MISSING");
  return { ok: problems.length === 0, summary, problems };
}
function canonicalPublicationExpectations() {
  const file = path.join(root, "data", "search-bank.snapshot.json");
  const doc = fileExists(file) ? readJson(file) : null;
  const expected = new Map();
  for (const item of Array.isArray(doc && doc.items) ? doc.items : []) {
    const placement = item && item.placement || {};
    const page = String(placement.page || "").trim();
    const country = String(placement.country || "").trim().toUpperCase();
    const regionRaw = String(placement.region || "").trim().toUpperCase();
    const region = regionRaw && regionRaw !== "NATIONWIDE" ? regionRaw : null;
    if (!page || !country || !["home","distribution","network","social","tour"].includes(page)) continue;
    const key = [page,country,region || "NATIONWIDE"].join("|");
    if (!expected.has(key)) expected.set(key,{page,country,region,count:0});
    expected.get(key).count += 1;
  }
  return Array.from(expected.values());
}

function verifyCanonicalToIpOutputs(ipSlotReport) {
  const expected = canonicalPublicationExpectations();
  const outputs = Array.isArray(ipSlotReport && ipSlotReport.scopedOutputs) ? ipSlotReport.scopedOutputs : [];
  const problems = [];
  for (const target of expected) {
    const found = outputs.find((row) => row && row.page === target.page && row.country === target.country && String(row.region || "") === String(target.region || ""));
    if (!found) problems.push("CANONICAL_SCOPE_NOT_PUBLISHED:" + [target.page,target.country,target.region || "NATIONWIDE"].join(":"));
    else if (Number(found.cardCount || 0) <= 0) problems.push("CANONICAL_SCOPE_PUBLISHED_EMPTY:" + String(found.path || ""));
  }
  return { ok: problems.length === 0, expected, outputCount: outputs.length, problems };
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
  // Social publication is an independent build-time SearchBank contract.
  // It targets only the existing Social Snapshot Engine path and does not
  // replace or bypass the commerce, country/region or IP-slot pipeline below.
  const socialCheckpoint = createSocialCheckpoint();
  let socialPublication;
  try {
    socialPublication = await publishSocialIndependently();
    const socialStatus = String(socialPublication && socialPublication.status || "").toLowerCase();
    if (["blocked", "failed", "skipped"].includes(socialStatus)) {
      const restored = restoreSocialCheckpoint(socialCheckpoint);
      socialPublication = Object.assign({}, socialPublication, {
        rollback: "restored",
        restored
      });
    }
  } catch (error) {
    let rollbackError = null;
    try {
      restoreSocialCheckpoint(socialCheckpoint);
    } catch (restoreError) {
      rollbackError = String(restoreError && restoreError.message || restoreError);
    }
    const safetyError = new Error(
      rollbackError
        ? "Social publication and rollback both failed: " + rollbackError
        : "Social publication isolation failed: " + String(error && error.message || error)
    );
    safetyError.code = "SOCIAL_PUBLICATION_ISOLATION_FAILED";
    throw safetyError;
  } finally {
    removeSocialCheckpoint(socialCheckpoint);
  }
  process.stdout.write(JSON.stringify({ socialPublication }, null, 2) + "\n");
  if (["blocked", "failed", "skipped"].includes(String(socialPublication.status || "").toLowerCase())) {
    process.stderr.write("Social SearchBank release did not publish; commerce build continues independently: " + JSON.stringify(socialPublication) + "\n");
  }

  // Commerce writes are transactional with respect to this combined build.
  // A failed commerce publication restores the exact post-social checkpoint,
  // allowing a successful Social publication to deploy independently without
  // exposing partially written commerce/SearchBank/front Snapshot artifacts.
  const commerceCheckpoint = createCommerceCheckpoint();
  try {

  // This sync only refreshes the private approved-candidate review queue. It
  // never writes a public Snapshot and cannot by itself publish front cards.
  const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });

  // A publication queue is authoritative only when it contains at least one
  // explicit administrator request. A zero-count queue is not a withdrawal
  // command and must never erase the committed SearchBank/front snapshots.
  const upstream = loadConfirmedUpstream(commerceRegistrySync);
  if (!upstream.ok) {
    writePreservedBuild(upstream.reason, { commerceRegistrySync, mirrors: upstream.mirrors });
    return;
  }
  const queueAuthoritative = upstream.queueAuthoritative === true || (
    commerceRegistrySync && commerceRegistrySync.status === "synchronized" &&
    commerceRegistrySync.authoritative === true && Number(commerceRegistrySync.requestedCount || 0) > 0
  );

  // Capture the committed safe sample templates before Snapshot Engine writes
  // any real-product documents. They are restored at root whenever the request
  // IP has no matching country/region real-product snapshot.
  const sampleFallback = ipSlots.captureSampleFallbackTemplates({ root });
  if (!sampleFallback.ok) {
    writePreservedBuild("sample-fallback-template-capture-failed", {
      commerceRegistrySync,
      problems: sampleFallback.problems || []
    });
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

  const releaseItems = Array.isArray(intake.releaseItems) ? intake.releaseItems : [];
  const administratorRequestedCount = Number(commerceRegistrySync && commerceRegistrySync.requestedCount || 0);
  if (releaseItems.length === 0 && administratorRequestedCount > 0) {
    throw new Error("Administrator publication queue contained " + administratorRequestedCount + " requested products, but Commerce Candidate Intake released none: " + JSON.stringify(intake.summary || {}));
  }
  if (releaseItems.length === 0 && !queueAuthoritative) {
    writePreservedBuild("no-release-ready-candidates", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      intakeSummary: intake.summary || null
    });
    return;
  }

  // Canonical publication must receive the actual post-intake release set.
  // The previous bridge passed the pre-intake upstream document, so explicit
  // administrator products were visible in the private queue but never entered
  // SearchBank or any front Snapshot. An authoritative empty set is preserved
  // for explicit withdrawal and therefore restores the safe sample fallbacks.
  const publicationBank = Object.assign({}, upstream.doc, {
    schema: "search-bank.release-input.v1",
    generatedAt: new Date().toISOString(),
    source: "commerce-candidate-intake-release",
    items: releaseItems
  });
  const publication = canonical.publish({ root, trigger: "netlify-build-country-region-admin-publication", bank: publicationBank, requireMirrorConsensus: false });
  if (publication.status !== "published") {
    throw new Error("Canonical Snapshot Publisher blocked build: " + JSON.stringify(publication.errors || publication));
  }
  if (!publication.counts) {
    throw new Error("Canonical Snapshot Publisher did not return candidate counts.");
  }
  if (Number(publication.counts.accepted || 0) <= 0 && administratorRequestedCount > 0) {
    throw new Error("Canonical Snapshot Publisher rejected every administrator-requested product. Inspect data/canonical-snapshot/audit/latest.json before publishing sample-only output.");
  }
  if (Number(publication.counts.accepted || 0) <= 0 && !queueAuthoritative) {
    throw new Error("Canonical Snapshot Publisher produced no accepted candidates without an authoritative administrator withdrawal state.");
  }

  const published = canonical.verifyPublished({ root });
  if (!published.ok) {
    throw new Error("Canonical Snapshot Publisher integrity failure: " + JSON.stringify(published.problems));
  }

  // Only commercial Snapshot surfaces are built here. Donation has an
  // independent endpoint/snapshot contract and is intentionally excluded.
  // The shared engine now reads the combined SearchBank Snapshot, including
  // Social real rows that passed the dedicated Social/PSOM gate above.
  const snapshotEngineReport = snapshots.run({ canonicalReleaseId: publication.releaseId });
  if (!snapshotEngineReport || snapshotEngineReport.ok !== true) {
    throw new Error("Snapshot Engine did not complete the SearchBank-to-front merge layer.");
  }

  const regionalReport = regional.publishFromSearchBank({ root, trigger: "netlify-build-canonical" });
  const ipSlotReport = ipSlots.publish({ root, trigger: "netlify-build-canonical-ip-slots", fallbackTemplates: sampleFallback.templates });
  if (ipSlotReport.status !== "published") {
    throw new Error("Canonical IP Slot Publisher blocked build: " + JSON.stringify(ipSlotReport.errors || ipSlotReport));
  }
  const ipSlotVerification = ipSlots.verifyPublished({ root });
  if (!ipSlotVerification.ok) {
    throw new Error("Canonical IP Slot Publisher integrity failure: " + JSON.stringify(ipSlotVerification.problems));
  }
  const rootFallbackVerification = verifyPublishedRootSampleFallbacks(ipSlotReport);
  if (!rootFallbackVerification.ok) {
    throw new Error("Canonical IP root sample-fallback integrity failure: " + JSON.stringify(rootFallbackVerification.problems));
  }
  const canonicalToIpVerification = verifyCanonicalToIpOutputs(ipSlotReport);
  if (!canonicalToIpVerification.ok) {
    throw new Error("Canonical SearchBank products did not reach their country/IP front snapshots: " + JSON.stringify(canonicalToIpVerification.problems));
  }

  process.stdout.write(JSON.stringify({
    commerceRegistrySync,
    upstream: { candidateCount: upstream.candidateCount, sourceMode: upstream.sourceMode || null, warning: upstream.warning || null, queueAuthoritative, mirrors: upstream.mirrors },
    intake: { releaseGate: intake.releaseGate, summary: intake.summary, releaseItemCount: releaseItems.length },
    publicationInput: { source: publicationBank.source, itemCount: publicationBank.items.length },
    publication,
    published,
    donation: { mode: "independent-runtime-contract-not-touched" },
    snapshotEngine: snapshotEngineReport,
    canonicalToIpVerification,
    regional: regionalReport,
    ipSlots: ipSlotReport,
    ipSlotVerification,
    rootFallbackVerification
  }, null, 2) + "\n");
  } catch (error) {
    let restored = [];
    let rollbackError = null;
    try {
      restored = restoreCommerceCheckpoint(commerceCheckpoint);
    } catch (restoreError) {
      rollbackError = String(restoreError && restoreError.message || restoreError);
    }
    process.stderr.write("Commerce release did not publish; Social build remains independent: " + JSON.stringify({
      status: "failed",
      isolated: true,
      reason: "commerce_release_execution_failed",
      error: String(error && error.message || error),
      rollback: rollbackError ? "failed" : "restored",
      restored,
      rollbackError
    }) + "\n");
    if (rollbackError) throw error;
  } finally {
    removeCommerceCheckpoint(commerceCheckpoint);
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
