"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const canonical = require(path.join(root, "netlify", "functions", "lib", "canonical-snapshot-publisher.v1"));
const snapshots = require(path.join(root, "netlify", "functions", "snapshot-engine"));
const donation = require(path.join(root, "netlify", "functions", "donation-snapshot-builder"));
const regional = require(path.join(root, "netlify", "functions", "lib", "regional-brokerage-publisher.v1"));
const ipSlots = require(path.join(root, "netlify", "functions", "lib", "ip-slot-snapshot-publisher.v1"));
const commerceRegistry = require(path.join(root, "netlify", "functions", "lib", "commerce-candidate-registry-sync.v1"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
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
function verifyDownstream() {
  const targets = [
    "data/front.snapshot.json",
    "data/distribution.snapshot.json",
    "data/media.snapshot.json",
    "data/social.snapshot.json",
    "data/networkhub-snapshot.json",
    "data/tour-snapshot.json",
    "data/donation.snapshot.json"
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
// Approved direct-commerce listings live in the management registry.  A
// build may mirror them into the private review queue when the secure registry
// is configured; absence of that optional connection is fail-closed and does
// not activate any candidate or public slot.
const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });
const publication = canonical.publish({ root, trigger: "netlify-build" });
if (publication.status !== "published") {
  throw new Error("Canonical Snapshot Publisher blocked build: " + JSON.stringify(publication.errors || publication));
}
const published = canonical.verifyPublished({ root });
if (!published.ok) {
  throw new Error("Canonical Snapshot Publisher integrity failure: " + JSON.stringify(published.problems));
}

// Lower snapshots receive only canonical rows. Existing seed/sample cards are
// removed by the canonical guard in Snapshot Engine before any merge occurs.
snapshots.run({ canonicalReleaseId: publication.releaseId });
const donationSnapshot = donation.buildCanonicalSnapshotFromDisk();
donation.writeCanonicalSnapshot(donationSnapshot);

const downstreamBeforeIpGate = verifyDownstream();
if (!downstreamBeforeIpGate.ok) {
  throw new Error("Unmanaged lower-snapshot card detected before IP publication: " + JSON.stringify(downstreamBeforeIpGate.unmanaged));
}
// Existing Distribution brokerage retains ownership of outbound/referral links.
// The Canonical IP publisher then validates that output, publishes all other
// IP-scoped page snapshots and converts root snapshots into empty geo gates.
const regionalReport = regional.publishFromSearchBank({ root, trigger: "netlify-build-canonical" });
const ipSlotReport = ipSlots.publish({ root, trigger: "netlify-build-canonical-ip-slots" });
if (ipSlotReport.status !== "published") {
  throw new Error("Canonical IP Slot Publisher blocked build: " + JSON.stringify(ipSlotReport.errors || ipSlotReport));
}
const ipSlotVerification = ipSlots.verifyPublished({ root });
if (!ipSlotVerification.ok) {
  throw new Error("Canonical IP Slot Publisher integrity failure: " + JSON.stringify(ipSlotVerification.problems));
}
const downstreamAfterIpGate = verifyDownstream();
if (!downstreamAfterIpGate.ok) {
  throw new Error("Unmanaged lower-snapshot card detected after IP publication: " + JSON.stringify(downstreamAfterIpGate.unmanaged));
}

process.stdout.write(JSON.stringify({ commerceRegistrySync, publication, published, donation: { items: donationSnapshot.items.length }, downstreamBeforeIpGate, regional: regionalReport, ipSlots: ipSlotReport, ipSlotVerification, downstreamAfterIpGate }, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
