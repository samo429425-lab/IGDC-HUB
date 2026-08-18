"use strict";

/**
 * Social -> SearchBank Snapshot handoff bridge.
 *
 * Purpose:
 *   approved Social release -> strict Social/PSOM policy gate -> existing
 *   SearchBank Snapshot mirrors -> existing Snapshot Engine -> Social Snapshot.
 *
 * Safety:
 * - SearchBank Engine code is not modified.
 * - Snapshot Engine code is not modified.
 * - Social HTML / Automap files are not modified.
 * - Existing SearchBank sample/placeholder rows are never deleted.
 * - Only prior real rows previously published by this social-candidate bridge
 *   are replaced by the latest authoritative stored Social release.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SocialStore = require("./social-candidate-store.v1");
const PublicSnapshot = require("./public-snapshot-sanitizer.v1");
const SearchBankEngine = require("../search-bank-engine");

const VERSION = "social-searchbank-release-adapter-v1.3.0-searchbank-boundary-only";
const RELEASE_FILE = "social-searchbank.release.snapshot.json";
const REPORT_FILE = "social-pipeline.report.json";
const SEARCH_BANK_FILE = "search-bank.snapshot.json";

function text(value) {
  return value == null ? "" : String(value).trim();
}
function lower(value) {
  return text(value).toLowerCase();
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
  const temporary = file + ".tmp-" + process.pid + "-" + Date.now();
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
function searchBankPaths(root) {
  return [
    path.join(root, "data", SEARCH_BANK_FILE),
    path.join(root, "netlify", "functions", "data", SEARCH_BANK_FILE),
    path.join(root, "netlify", "functions", SEARCH_BANK_FILE),
  ];
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
  const countries = Array.isArray(social.countryScopes)
    ? social.countryScopes.map((v) => text(v).toUpperCase()).filter(Boolean)
    : [];
  const languages = Array.isArray(social.languageScopes)
    ? social.languageScopes.map(text).filter(Boolean)
    : [];
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
    section: sectionKey,
    psom_key: sectionKey,
    category: sectionKey,
    bind: { page: "social", section: sectionKey, psom_key: sectionKey, route: "social." + sectionKey },
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
    sample: false,
    placeholder: false,
    snapshotEligible: true,
    frontSupplyAllowed: true,
    searchBankEligible: true,
    indexEligible: true,
    riskLevel: "low",
    blockedReason: "",
    geo: countries.length ? { country: countries[0] } : undefined,
    lang: languages.length ? languages[0] : undefined,
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
      countryScopes: countries,
      languageScopes: languages,
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
      bridgeVersion: VERSION,
      releaseId: text(release.release_id),
      releaseHash: text(release.snapshot_hash),
      candidateId: id,
      approvedAt: text(audit.approved_at),
      createdAt: text(release.created_at),
    },
    snapshotSource: "data/" + SEARCH_BANK_FILE,
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

function searchBankEngineContext(item) {
  const section = text(item && (item.psom_key || item.section || (item.bind && item.bind.section)));
  return {
    event: { httpMethod: "GET", headers: {}, queryStringParameters: {} },
    params: {
      page: "social",
      channel: "social",
      route: "social",
      section,
      psom_key: section,
      slotKey: section,
      list: "1"
    },
    limit: 120,
    q: "social",
    queryIntent: { raw: "social" },
    geoContext: {},
    ipGeo: {},
    slotContext: {
      channel: "social",
      section,
      psom_key: section,
      autoFill: true,
      policy: { persist: true }
    },
    operationalPolicy: {},
    slotDeficiency: {},
    channel: "social",
    type: "external_social",
    lang: ""
  };
}

function passThroughSearchBankEngineContract(items) {
  const accepted = [];
  const rejected = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const item = JSON.parse(JSON.stringify(raw || {}));
    const ctx = searchBankEngineContext(item);
    let contracted;
    try {
      contracted = SearchBankEngine.applyUnifiedSupplyContract(item, ctx);
    } catch (error) {
      rejected.push({
        id: text(item.id || item.contentId || item.candidateId),
        section: text(item.psom_key || item.section || (item.bind && item.bind.section)),
        reasons: ["SEARCHBANK_CONTRACT_EXCEPTION"],
        error: text(error && error.message) || String(error)
      });
      continue;
    }
    const validation = SearchBankEngine.validateBankItem(contracted);
    const slotAccepted = SearchBankEngine.slotAcceptsItem(contracted, ctx);
    const policyAccepted = SearchBankEngine.policyAcceptsItem(contracted, ctx);
    const contract = contracted.searchBankContract || {};
    const reasons = [];
    if (!validation || validation.ok !== true) reasons.push(...((validation && validation.issues) || ["SEARCHBANK_VALIDATE_FAILED"]));
    if (!slotAccepted) reasons.push("SEARCHBANK_SOCIAL_SLOT_REJECTED");
    if (!policyAccepted) reasons.push("SEARCHBANK_POLICY_REJECTED");
    if (contract.searchBankEligible === false) reasons.push("SEARCHBANK_NOT_ELIGIBLE");
    if (contract.snapshotEligible === false) reasons.push("SEARCHBANK_SNAPSHOT_NOT_ELIGIBLE");
    if (contract.frontSupplyAllowed === false) reasons.push("SEARCHBANK_FRONT_SUPPLY_NOT_ALLOWED");
    if (reasons.length) {
      rejected.push({
        id: text(contracted.id || contracted.contentId || contracted.candidateId),
        section: text(contracted.psom_key || contracted.section || (contracted.bind && contracted.bind.section)),
        reasons
      });
      continue;
    }
    accepted.push(contracted);
  }
  return {
    ok: rejected.length === 0 && accepted.length > 0,
    engineVersion: SearchBankEngine.SEARCH_BANK_ENGINE_VERSION,
    contractVersion: SearchBankEngine.SEARCH_BANK_CONTRACT_VERSION,
    accepted,
    rejected
  };
}

function psomSocialSections(root) {
  const candidates = [
    path.join(root, "data", "psom.json"),
    path.join(root, "netlify", "functions", "data", "psom.json"),
  ];
  for (const file of candidates) {
    const doc = readJson(file);
    const rows = doc && doc.pages && doc.pages.social && doc.pages.social.sections;
    if (Array.isArray(rows) && rows.length) {
      return { file, sections: new Set(rows.map(text).filter(Boolean)) };
    }
  }
  return { file: null, sections: new Set() };
}
function validHttps(value) {
  try {
    const u = new URL(text(value));
    return u.protocol === "https:" && !!u.hostname;
  } catch (_error) {
    return false;
  }
}
function isPlaceholderImage(value) {
  const v = lower(value);
  return !v || v.includes("placeholder") || v.includes("/assets/sample/");
}
function policyGate(root, bank) {
  const psom = psomSocialSections(root);
  const allowed = new Set(SocialStore.Policy.SECTION_KEYS);
  const accepted = [];
  const rejected = [];
  const seenIds = new Set();
  const seenUrls = new Set();
  const counts = {};
  SocialStore.Policy.SECTION_KEYS.forEach((key) => { counts[key] = 0; });

  for (const raw of Array.isArray(bank && bank.items) ? bank.items : []) {
    const item = raw || {};
    const section = text(item.psom_key || item.section || (item.bind && item.bind.section));
    const id = text(item.id || item.contentId || item.candidateId);
    const url = text(item.url || item.link);
    const image = text(item.thumbnail || item.thumb || item.image);
    const reasons = [];
    if (!allowed.has(section)) reasons.push("SOCIAL_SECTION_NOT_ALLOWED");
    if (psom.sections.size && !psom.sections.has(section)) reasons.push("SOCIAL_SECTION_NOT_IN_PSOM");
    if (section === "social-maru" || section === "rightPanel") reasons.push("RESERVED_SOCIAL_SECTION");
    if (text(item.page || (item.bind && item.bind.page)).toLowerCase() !== "social") reasons.push("PAGE_NOT_SOCIAL");
    if (!id) reasons.push("CANDIDATE_ID_MISSING");
    if (!text(item.title)) reasons.push("TITLE_MISSING");
    if (!validHttps(url)) reasons.push("PUBLIC_HTTPS_URL_REQUIRED");
    if (!image || isPlaceholderImage(image)) reasons.push("REAL_THUMBNAIL_REQUIRED");
    if (item.publicAccess !== true) reasons.push("PUBLIC_ACCESS_REQUIRED");
    if (item.searchBankEligible === false || item.snapshotEligible === false || item.frontSupplyAllowed === false) reasons.push("SEARCHBANK_OR_SNAPSHOT_NOT_ELIGIBLE");
    if (["blocked", "critical", "illegal", "unsafe", "rejected"].includes(lower(item.riskLevel))) reasons.push("RISK_BLOCKED");
    if (id && seenIds.has(id)) reasons.push("DUPLICATE_ID");
    if (url && seenUrls.has(url.toLowerCase())) reasons.push("DUPLICATE_URL");
    if (reasons.length) {
      rejected.push({ id: id || null, section: section || null, url: url || null, reasons });
      continue;
    }
    seenIds.add(id);
    seenUrls.add(url.toLowerCase());
    counts[section] = (counts[section] || 0) + 1;
    accepted.push(item);
  }
  return {
    // Bad rows are held out individually; one bad candidate must not block every
    // valid candidate in the same release. A truly empty release is allowed so
    // an explicit unpublish can fall back to preserved sample slots.
    ok: accepted.length > 0 || (Array.isArray(bank && bank.items) && bank.items.length === 0),
    clean: rejected.length === 0,
    psomFile: psom.file ? path.relative(root, psom.file).replace(/\\/g, "/") : null,
    accepted,
    rejected,
    counts,
  };
}
function isPriorSocialCandidateItem(item) {
  if (!item || typeof item !== "object") return false;
  const audit = item.audit && typeof item.audit === "object" ? item.audit : {};
  return (
    text(audit.origin) === "social_candidates" ||
    !!(item.socialCandidatePublication && item.socialCandidatePublication.candidateId)
  );
}
function isSocialSampleItem(item) {
  if (!item || typeof item !== "object") return false;
  const section = text(item.psom_key || item.section || (item.bind && item.bind.section));
  if (!section.startsWith("social-")) return false;
  if (isPriorSocialCandidateItem(item)) return false;
  const url = lower(item.url || item.link || item.href);
  const title = lower(item.title || item.name);
  return (
    item.sample === true ||
    item.placeholder === true ||
    item.replaceableSlot === true ||
    title.includes("seed placeholder") ||
    url === "#" ||
    url.includes("example.com") ||
    lower(item.thumbnail || item.thumb || item.image).includes("placeholder")
  );
}
function loadSearchBankSnapshot(root) {
  const paths = searchBankPaths(root);
  const docs = paths.map((file) => ({ file, doc: readJson(file) })).filter((row) => row.doc && Array.isArray(row.doc.items));
  if (!docs.length) {
    const error = new Error("SEARCH_BANK_SNAPSHOT_NOT_FOUND");
    error.code = "search_bank_snapshot_not_found";
    throw error;
  }
  const primary = docs[0];
  return {
    file: primary.file,
    doc: primary.doc,
    mirrors: paths.map((file) => ({ file, present: !!readJson(file) })),
  };
}
function mergeIntoSearchBankSnapshot(input) {
  const root = rootOf(input);
  const release = input && input.release;
  const converted = input && input.converted ? input.converted : releaseToBank(release);
  const gate = policyGate(root, converted.bank);
  if (!gate.ok) {
    const error = new Error("SOCIAL_SEARCHBANK_POLICY_GATE_REJECTED");
    error.code = "social_searchbank_policy_gate_rejected";
    error.details = { rejected: gate.rejected.slice(0, 100), counts: gate.counts };
    throw error;
  }
  const engineGate = passThroughSearchBankEngineContract(gate.accepted);
  if (!engineGate.ok) {
    const error = new Error("SOCIAL_SEARCHBANK_ENGINE_CONTRACT_REJECTED");
    error.code = "social_searchbank_engine_contract_rejected";
    error.details = {
      engineVersion: engineGate.engineVersion,
      contractVersion: engineGate.contractVersion,
      acceptedCount: engineGate.accepted.length,
      rejected: engineGate.rejected.slice(0, 100)
    };
    throw error;
  }
  const loaded = loadSearchBankSnapshot(root);
  const current = loaded.doc;
  const oldItems = Array.isArray(current.items) ? current.items : [];
  const preserved = oldItems.filter((item) => !isPriorSocialCandidateItem(item));
  const previousRealCount = oldItems.length - preserved.length;
  const sampleSocialCountBefore = oldItems.filter(isSocialSampleItem).length;
  const incoming = engineGate.accepted;
  const mergedItems = SearchBankEngine.mergeBankItems(preserved, incoming);
  const merged = PublicSnapshot.sanitizeDocument(Object.assign({}, current, {
    items: mergedItems,
    meta: Object.assign({}, current.meta || {}, {
      generated_at: (current.meta && current.meta.generated_at) || undefined,
      socialCandidateHandoff: {
        version: VERSION,
        mode: "searchbank-engine-contract-merge-preserve-samples",
        searchBankEngineVersion: engineGate.engineVersion,
        searchBankContractVersion: engineGate.contractVersion,
        releaseId: text(release && release.release_id),
        releaseHash: text(release && release.snapshot_hash),
        updatedAt: new Date().toISOString(),
        previousRealSocialCandidateItems: previousRealCount,
        insertedRealSocialCandidateItems: incoming.length,
        sampleSocialItemsPreserved: sampleSocialCountBefore,
        sectionCounts: gate.counts,
        psomFile: gate.psomFile,
      },
    }),
  }));
  const digest = sha256(merged);
  const writes = [];
  for (const file of searchBankPaths(root)) {
    atomicWriteJson(file, merged);
    writes.push({ path: path.relative(root, file).replace(/\\/g, "/"), sha256: digest, itemCount: merged.items.length });
  }
  return {
    ok: true,
    releaseId: text(release && release.release_id),
    hash: digest,
    previousTotalItems: oldItems.length,
    finalTotalItems: merged.items.length,
    previousRealSocialCandidateItems: previousRealCount,
    insertedRealSocialCandidateItems: incoming.length,
    sampleSocialItemsPreserved: sampleSocialCountBefore,
    counts: gate.counts,
    psomFile: gate.psomFile,
    searchBankEngine: {
      version: engineGate.engineVersion,
      contractVersion: engineGate.contractVersion,
      accepted: engineGate.accepted.length,
      rejected: engineGate.rejected.length
    },
    writes,
    bank: merged,
  };
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
  const report = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    status: "preserved",
    pipeline: {
      releaseRead: "not_started",
      policyAndPsomGate: "not_started",
      searchBankSnapshotHandoff: "not_started",
      downstream: "owned_by_existing_pipeline",
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
  const gate = policyGate(root, converted.bank);
  report.policyGate = {
    ok: gate.ok,
    psomFile: gate.psomFile,
    acceptedCount: gate.accepted.length,
    rejectedCount: gate.rejected.length,
    counts: gate.counts,
    rejected: gate.rejected.slice(0, 100),
  };
  if (!gate.ok) {
    report.status = "blocked";
    report.reason = "social_searchbank_policy_gate_rejected";
    report.pipeline.policyAndPsomGate = "failed";
    atomicWriteJson(outputPath(root, REPORT_FILE), report);
    return report;
  }
  report.pipeline.policyAndPsomGate = "passed";

  // Keep a small dedicated handoff audit file for administrators, but the
  // authoritative downstream source is the ordinary SearchBank Snapshot.
  const auditBank = PublicSnapshot.sanitizeDocument(Object.assign({}, converted.bank, {
    meta: Object.assign({}, converted.bank.meta || {}, {
      note: "Audit mirror only. Authoritative handoff is data/search-bank.snapshot.json.",
    }),
  }));
  atomicWriteJson(outputPath(root, RELEASE_FILE), auditBank);

  let handoff;
  try {
    handoff = mergeIntoSearchBankSnapshot({ root, release, converted });
  } catch (error) {
    report.status = "blocked";
    report.reason = error.code || "searchbank_snapshot_handoff_failed";
    report.error = text(error && error.message) || String(error);
    report.details = error.details || null;
    report.pipeline.searchBankSnapshotHandoff = "failed";
    atomicWriteJson(outputPath(root, REPORT_FILE), report);
    return report;
  }
  report.pipeline.searchBankSnapshotHandoff = "passed";
  report.searchBankSnapshot = {
    file: "data/" + SEARCH_BANK_FILE,
    hash: handoff.hash,
    previousTotalItems: handoff.previousTotalItems,
    finalTotalItems: handoff.finalTotalItems,
    previousRealSocialCandidateItems: handoff.previousRealSocialCandidateItems,
    insertedRealSocialCandidateItems: handoff.insertedRealSocialCandidateItems,
    sampleSocialItemsPreserved: handoff.sampleSocialItemsPreserved,
    counts: handoff.counts,
    psomFile: handoff.psomFile,
    searchBankEngine: handoff.searchBankEngine,
    writes: handoff.writes,
  };

  // Handoff boundary: stop exactly at the ordinary SearchBank Snapshot.
  // The existing build pipeline owns Snapshot Engine -> social.snapshot.json -> AutoMap.
  report.pipeline.downstream = "existing_pipeline_next";
  report.status = "searchbank_handoff_complete";
  atomicWriteJson(outputPath(root, REPORT_FILE), report);
  return report;
}

module.exports = {
  VERSION,
  RELEASE_FILE,
  REPORT_FILE,
  SEARCH_BANK_FILE,
  searchBankPaths,
  releaseToBank,
  policyGate,
  passThroughSearchBankEngineContract,
  mergeIntoSearchBankSnapshot,
  isPriorSocialCandidateItem,
  publish,
  sha256,
};
