"use strict";

/**
 * Social SearchBank Release Adapter v1
 *
 * Build-time contract bridge only:
 * approved Social candidate release -> SearchBank-shaped release document ->
 * existing Snapshot Engine -> data/social.snapshot.json.
 *
 * It never serves a front feed and never edits Social HTML or Automap files.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SocialStore = require("./social-candidate-store.v1");
const PublicSnapshot = require("./public-snapshot-sanitizer.v1");

const VERSION = "social-searchbank-release-adapter-v1.0.0";
const RELEASE_FILE = "social-searchbank.release.snapshot.json";
const REPORT_FILE = "social-pipeline.report.json";

function text(value) {
  return value == null ? "" : String(value).trim();
}
function rootOf(input) {
  return path.resolve((input && input.root) || process.cwd());
}
function stable(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stable(value[key]))
      .join(",") +
    "}"
  );
}
function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : stable(value))
    .digest("hex");
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, file);
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_error) {
    return null;
  }
}
function outputPath(root, file) {
  return path.join(root, "data", file);
}
function socialSections(snapshot) {
  return (
    snapshot &&
    snapshot.pages &&
    snapshot.pages.social &&
    snapshot.pages.social.sections
  ) || {};
}
function isReleasedSocialSlot(slot) {
  const audit = (slot && slot.audit) || {};
  return (
    text(slot && slot.type) === "external_social" &&
    text(audit.origin) === "social_candidates" &&
    !!text(slot && slot.title) &&
    /^https:\/\//i.test(text(slot && (slot.url || slot.href || slot.link)))
  );
}
function sourceItem(slot, sectionKey, release) {
  const audit = (slot && slot.audit) || {};
  const social = (slot && slot.social) || {};
  const source = (slot && slot.source) || {};
  const id = text(
    slot &&
      (slot.contentId || slot.candidateId || audit.candidate_id || slot.id),
  );
  const url = text(slot && (slot.url || slot.href || slot.link));
  const thumbnail = text(
    slot &&
      (slot.thumbnailUrl || slot.thumbnail || slot.thumb || slot.imageUrl || slot.image),
  );
  return {
    id,
    contentId: id,
    candidateId: id,
    snapshotRecordId: id,
    title: text(slot.title),
    summary: text(slot.description || slot.summary),
    url,
    link: url,
    thumbnail,
    thumb: thumbnail,
    image: thumbnail,
    page: "social",
    channel: "social",
    psom_key: sectionKey,
    category: sectionKey,
    bind: { page: "social", section: sectionKey },
    type: "external_social",
    description: text(slot.description || slot.summary),
    creator: text(slot.creator || slot.creatorName || slot.creatorHandle),
    creatorName: text(slot.creatorName),
    creatorHandle: text(slot.creatorHandle),
    embedUrl: text(slot.embedUrl) || undefined,
    displayMode: text(slot.displayMode || "link_card"),
    priority: Number(
      (slot.signals &&
        (slot.signals.rotation_score || slot.signals.quality_score)) ||
        slot.priority ||
        0,
    ),
    publicAccess: true,
    accessStatus: "public",
    verified: true,
    realContent: true,
    snapshotEligible: true,
    frontSupplyAllowed: true,
    searchBankEligible: true,
    indexEligible: true,
    riskLevel: "low",
    blockedReason: "",
    source: {
      name: text(source.provider || source.platform || social.platform) || "social_candidates",
      platform: text(social.platform || source.platform),
      section_key: sectionKey,
      provider: text(source.provider || "external_social_platform"),
      url,
    },
    social: {
      platform: text(social.platform || source.platform),
      channelUrl: text(social.channelUrl),
      latestContentUrl: url,
      contentPublishedAt: text(social.contentPublishedAt),
      countryScopes: Array.isArray(social.countryScopes)
        ? social.countryScopes.slice()
        : [],
      languageScopes: Array.isArray(social.languageScopes)
        ? social.languageScopes.slice()
        : [],
    },
    signals: Object.assign({}, slot.signals || {}),
    audit: {
      origin: "social_candidates",
      candidate_id: id,
      approved_at: text(audit.approved_at),
      generated_at: text(audit.generated_at || release.created_at),
    },
    timestamps: Object.assign({}, slot.timestamps || {}),
    searchBankContract: {
      contractVersion: "sanmaru-searchbank-supply-contract-v1.1",
      searchBankEligible: true,
      snapshotEligible: true,
      indexEligible: true,
      frontSupplyAllowed: true,
      riskLevel: "low",
      blockedReason: "",
      officialSource: false,
      producerVerified: false,
    },
    socialCandidatePublication: {
      releaseId: text(release.release_id),
      releaseHash: text(release.snapshot_hash),
      candidateId: id,
      approvedAt: text(audit.approved_at),
      createdAt: text(release.created_at),
    },
    snapshotSource: "data/" + RELEASE_FILE,
  };
}
function releaseToBank(release) {
  const sections = socialSections(release && release.snapshot);
  const items = [];
  const counts = {};
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    const rows = Array.isArray(sections[sectionKey]) ? sections[sectionKey] : [];
    const accepted = rows
      .filter(isReleasedSocialSlot)
      .map((slot) => sourceItem(slot, sectionKey, release));
    counts[sectionKey] = accepted.length;
    items.push(...accepted);
  });
  const bank = PublicSnapshot.sanitizeDocument({
    meta: {
      schema: "search-bank.social-release.snapshot.v1",
      adapterVersion: VERSION,
      source: "supabase.social_snapshot_releases",
      releaseId: text(release && release.release_id),
      releaseHash: text(release && release.snapshot_hash),
      generatedAt: new Date().toISOString(),
      targetPage: "social",
      candidateCounts: counts,
      itemCount: items.length,
    },
    items,
  });
  return { bank, counts };
}
async function latestStoredRelease() {
  const rows = await SocialStore.selectReleases(
    "select=release_id,status,snapshot_hash,snapshot,created_at,notes&status=eq.stored&order=created_at.desc&limit=1",
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}
function finalSocialSummary(root, expectedIds) {
  const file = outputPath(root, "social.snapshot.json");
  const snapshot = readJson(file);
  const sections = socialSections(snapshot);
  const present = new Set();
  const counts = {};
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    const rows = Array.isArray(sections[sectionKey]) ? sections[sectionKey] : [];
    counts[sectionKey] = rows.filter((row) => {
      const id = text(row && (row.contentId || row.id));
      if (id && expectedIds.has(id)) present.add(id);
      return id && expectedIds.has(id);
    }).length;
  });
  return {
    file: "data/social.snapshot.json",
    exists: !!snapshot,
    hash: snapshot ? sha256(snapshot) : null,
    expected: expectedIds.size,
    present: present.size,
    missingIds: Array.from(expectedIds).filter((id) => !present.has(id)),
    counts,
  };
}
async function publish(input) {
  const root = rootOf(input);
  const snapshotEngine = input && input.snapshotEngine;
  const report = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    status: "preserved",
    pipeline: {
      releaseRead: "not_started",
      searchBankReleaseBuild: "not_started",
      snapshotEngine: "not_started",
      finalSocialSnapshotReadback: "not_started",
    },
  };
  let release;
  try {
    release = await latestStoredRelease();
  } catch (error) {
    report.reason = "social_release_store_unavailable";
    report.error = text(error && error.message) || String(error);
    atomicWriteJson(outputPath(root, REPORT_FILE), report);
    return report;
  }
  if (!release || !release.snapshot) {
    report.reason = "stored_social_release_not_found";
    atomicWriteJson(outputPath(root, REPORT_FILE), report);
    return report;
  }
  report.pipeline.releaseRead = "passed";
  report.releaseId = text(release.release_id);
  report.releaseHash = text(release.snapshot_hash);
  const converted = releaseToBank(release);
  const bankHash = sha256(converted.bank);
  atomicWriteJson(outputPath(root, RELEASE_FILE), converted.bank);
  report.pipeline.searchBankReleaseBuild = "passed";
  report.searchBankRelease = {
    file: "data/" + RELEASE_FILE,
    hash: bankHash,
    itemCount: converted.bank.items.length,
    counts: converted.counts,
  };
  if (!snapshotEngine || typeof snapshotEngine.run !== "function") {
    const error = new Error("SOCIAL_SNAPSHOT_ENGINE_RUNNER_MISSING");
    error.code = "social_snapshot_engine_runner_missing";
    throw error;
  }
  const engineReport = snapshotEngine.run({
    targetPage: "social",
    bank: converted.bank,
    trigger: "netlify-build-social-approved-release",
  });
  if (engineReport && engineReport.ok === false) {
    const error = new Error("SOCIAL_SNAPSHOT_ENGINE_REPORTED_FAILURE");
    error.code = "social_snapshot_engine_reported_failure";
    throw error;
  }
  report.pipeline.snapshotEngine = "passed";
  report.snapshotEngineReport = engineReport || null;
  const expectedIds = new Set(converted.bank.items.map((item) => text(item.id)).filter(Boolean));
  const final = finalSocialSummary(root, expectedIds);
  report.finalSocialSnapshot = final;
  report.pipeline.finalSocialSnapshotReadback =
    final.exists && final.present === final.expected ? "passed" : "failed";
  report.status =
    report.pipeline.finalSocialSnapshotReadback === "passed"
      ? "published"
      : "blocked";
  if (report.status !== "published") {
    report.reason = "final_social_snapshot_readback_mismatch";
  }
  atomicWriteJson(outputPath(root, REPORT_FILE), report);
  return report;
}

module.exports = {
  VERSION,
  RELEASE_FILE,
  REPORT_FILE,
  releaseToBank,
  publish,
  sha256,
};
