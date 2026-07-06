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
  // until real verified intake is provisioned.  During staging-only builds,
  // use an explicit empty input so the site deploys with the existing empty
  // commercial slot state.  In release mode, absence remains a hard failure.
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

function isCardRow(entry) {
  return !!(
    entry && typeof entry === "object" &&
    (entry.id || entry.uid || entry.contentId || entry.productId || entry.indexId) &&
    (entry.title || entry.name || entry.url || entry.link || entry.video)
  );
}

function cardRows(value, rows) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isCardRow(entry)) rows.push(entry);
      else if (entry && typeof entry === "object") {
        cardRows(entry.slots, rows);
        cardRows(entry.items, rows);
        cardRows(entry.results, rows);
        cardRows(entry.cards, rows);
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (isCardRow(value)) rows.push(value);
  cardRows(value.slots, rows);
  cardRows(value.items, rows);
  cardRows(value.results, rows);
  cardRows(value.cards, rows);
}

function downstreamRows(doc) {
  const rows = [];
  if (doc.pages && typeof doc.pages === "object") {
    for (const page of Object.values(doc.pages)) {
      if (!page || !page.sections) continue;
      for (const section of Object.values(page.sections)) cardRows(section, rows);
    }
  }
  if (doc.sections && typeof doc.sections === "object") {
    for (const section of Object.values(doc.sections)) cardRows(section, rows);
  }
  cardRows(doc.items, rows);
  cardRows(doc.slots, rows);
  return rows;
}

function verifyCommercialDownstream() {
  // Donation is deliberately outside the Canonical commercial/IP-slot chain.
  // Its endpoint owns its own snapshot lifecycle, so this build must neither
  // call its private implementation nor rewrite its snapshot data.
  const targets = [
    "data/front.snapshot.json",
    "data/distribution.snapshot.json",
    "data/media.snapshot.json",
    "data/social.snapshot.json",
    "data/networkhub-snapshot.json",
    "data/tour-snapshot.json"
  ];
  const unmanaged = [];
  const summary = [];
  for (const relative of targets) {
    const doc = readJson(path.join(root, relative));
    const rows = downstreamRows(doc);
    const stale = rows.filter(row => !(row.canonicalPublication && row.canonicalPublication.status === "published" && row.placement));
    summary.push({ path: relative, cardCount: rows.length, unmanagedCount: stale.length });
    for (const row of stale.slice(0, 100)) unmanaged.push({ path: relative, id: row.id || row.uid || null, title: row.title || null });
  }
  return { ok: unmanaged.length === 0, summary, unmanaged };
}

async function main() {
  // Approved direct-commerce listings may be mirrored from the management
  // registry into the private review queue.  Missing optional registry access
  // cannot activate any candidate or public slot.
  const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });
  const upstreamFallback = emptyStagingUpstream();
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

  // Only commercial Snapshot surfaces are built here.  Donation has an
  // independent endpoint/snapshot contract and is intentionally excluded.
  snapshots.run({ canonicalReleaseId: publication.releaseId });
  const downstreamBeforeIpGate = verifyCommercialDownstream();
  if (!downstreamBeforeIpGate.ok) {
    throw new Error("Unmanaged commercial lower-snapshot card detected before IP publication: " + JSON.stringify(downstreamBeforeIpGate.unmanaged));
  }

  const regionalReport = regional.publishFromSearchBank({ root, trigger: "netlify-build-canonical" });
  const ipSlotReport = ipSlots.publish({ root, trigger: "netlify-build-canonical-ip-slots" });
  if (ipSlotReport.status !== "published") {
    throw new Error("Canonical IP Slot Publisher blocked build: " + JSON.stringify(ipSlotReport.errors || ipSlotReport));
  }
  const ipSlotVerification = ipSlots.verifyPublished({ root });
  if (!ipSlotVerification.ok) {
    throw new Error("Canonical IP Slot Publisher integrity failure: " + JSON.stringify(ipSlotVerification.problems));
  }
  const downstreamAfterIpGate = verifyCommercialDownstream();
  if (!downstreamAfterIpGate.ok) {
    throw new Error("Unmanaged commercial lower-snapshot card detected after IP publication: " + JSON.stringify(downstreamAfterIpGate.unmanaged));
  }

  process.stdout.write(JSON.stringify({
    commerceRegistrySync,
    upstreamFallback: upstreamFallback ? { mode: "staging-empty", reason: upstreamFallback.meta.reason } : null,
    publication,
    published,
    donation: { mode: "independent-runtime-contract-not-touched" },
    downstreamBeforeIpGate,
    regional: regionalReport,
    ipSlots: ipSlotReport,
    ipSlotVerification,
    downstreamAfterIpGate
  }, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
