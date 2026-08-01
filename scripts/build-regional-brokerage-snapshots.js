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
const socialRelease = require(path.join(root, "netlify", "functions", "lib", "social-searchbank-release-adapter.v1"));

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
    commerceRegistrySync.authoritative === true
  );
  const queueMeta = {
    authoritative: queueAuthoritative,
    requestedCount: Number(commerceRegistrySync && commerceRegistrySync.requestedCount || 0),
    scopeKeys: Array.isArray(commerceRegistrySync && commerceRegistrySync.scopeKeys) ? commerceRegistrySync.scopeKeys.slice() : [],
    releaseAuthorization: commerceRegistrySync && commerceRegistrySync.releaseAuthorization || null
  };

  if (mirrors.some(row => !row.present)) {
    if (queueAuthoritative) {
      return {
        ok: true,
        sourceMode: "authoritative-admin-review-queue",
        warning: "upstream-candidate-source-missing",
        doc: { schema: "search-bank.upstream.authoritative-admin-queue.v1", generatedAt: new Date().toISOString(), source:"country-region-admin-publication-queue", queue:queueMeta, items: [] },
        candidateCount: 0,
        queueAuthoritative,
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
    if (queueAuthoritative) {
      const doc = Object.assign({}, parsed[0].doc, { queue:queueMeta, source:"country-region-admin-publication-queue", items:[] });
      return {
        ok: true,
        sourceMode: "authoritative-admin-review-queue",
        warning: "upstream-candidate-source-empty",
        doc,
        candidateCount: 0,
        queueAuthoritative,
        mirrors
      };
    }
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
  const socialPublication = await socialRelease.publish({
    root,
    snapshotEngine: snapshots
  });
  process.stdout.write(JSON.stringify({ socialPublication }, null, 2) + "\n");
  if (socialPublication.status === "blocked") {
    throw new Error("Social SearchBank release pipeline blocked build: " + JSON.stringify(socialPublication));
  }

  // This sync only refreshes the private approved-candidate review queue. It
  // never writes a public Snapshot and cannot by itself publish front cards.
  const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });

  // An authoritative country/region administrator queue is a valid release
  // source even when the broad Sanmaru/SearchBank upstream mirror is absent or
  // empty. This is the explicit control plane for publication and withdrawal.
  const upstream = loadConfirmedUpstream(commerceRegistrySync);
  if (!upstream.ok) {
    writePreservedBuild(upstream.reason, { commerceRegistrySync, mirrors: upstream.mirrors });
    return;
  }
  const queueAuthoritative = upstream.queueAuthoritative === true || (
    commerceRegistrySync && commerceRegistrySync.status === "synchronized" && commerceRegistrySync.authoritative === true
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
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
