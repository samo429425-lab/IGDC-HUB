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

const VERSION = "social-searchbank-release-adapter-v1.5.0-publication-plan-source";
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
      source: text(release && release.handoff_source) || "supabase.social_snapshot_releases",
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
    // One malformed candidate must never stop every other approved Social row.
    // SearchBank remains authoritative per item: continue when at least one row
    // passed the existing engine contract and report rejected rows separately.
    ok: accepted.length > 0,
    clean: rejected.length === 0,
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
    if (!validHttps(image) || isPlaceholderImage(image)) reasons.push("REAL_HTTPS_THUMBNAIL_REQUIRED");
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
function incomingReleaseExpectation() {
  const raw = text(process.env.INCOMING_HOOK_BODY);
  if (!raw) return {};
  try {
    const body = JSON.parse(raw);
    if (!body || body.trigger !== "approved-social-snapshot-release") return {};
    return {
      releaseId: text(body.releaseId),
      snapshotHash: text(body.snapshotHash),
      scopeMode: lower(body.scopeMode) === "country" ? "country" : "global",
      countryCode: text(body.countryCode).toUpperCase(),
      worldRegion: text(body.worldRegion),
      operation: text(body.operation) || "publish",
      publicationPlan: body.publicationPlan && typeof body.publicationPlan === "object"
        ? body.publicationPlan
        : null,
      publicationPlanHash: text(body.publicationPlanHash),
      publicationPlanCount: Number(body.publicationPlanCount || 0),
    };
  } catch (_error) {
    return {};
  }
}

function normalizePublicationPlan(plan) {
  const source = plan && typeof plan === "object" ? plan : {};
  const out = {};
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    const list = Array.isArray(source[sectionKey]) ? source[sectionKey] : [];
    out[sectionKey] = Array.from(new Set(list.map(text).filter(Boolean))).slice(0, 100);
  });
  return out;
}
function publicationPlanIds(plan) {
  const out = [];
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    (plan[sectionKey] || []).forEach((id) => out.push({ id, sectionKey }));
  });
  return out;
}
function readSocialBaseForPlan(root) {
  const files = [
    path.join(root, "data", "social.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "social.snapshot.json"),
    path.join(root, "netlify", "functions", "social.snapshot.json"),
  ];
  for (const file of files) {
    const doc = readJson(file);
    if (doc) return { file, doc };
  }
  const sections = {};
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => { sections[sectionKey] = []; });
  return {
    file: "generated-empty-social-base",
    doc: { version: "social.snapshot.empty", type: "social_snapshot", pages: { social: { sections } }, meta: {} },
  };
}
async function selectExactPublicationCandidates(plan) {
  const requested = publicationPlanIds(plan);
  const ids = requested.map((row) => row.id);
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    if (!batch.length) continue;
    const query = "select=*&id=" + SocialStore.encodeIn(batch) + "&limit=" + batch.length;
    const part = await SocialStore.selectCandidates(query);
    if (Array.isArray(part)) rows.push(...part);
  }
  const byId = new Map(rows.map((row) => [text(row && row.id), row]));
  const accepted = [];
  const rejected = [];
  requested.forEach((request) => {
    const row = byId.get(request.id);
    if (!row) {
      rejected.push({ id: request.id, sectionKey: request.sectionKey, reason: "candidate_not_found" });
      return;
    }
    const actualSection = text(row.section_key || row.sectionKey);
    if (actualSection !== request.sectionKey) {
      rejected.push({ id: request.id, sectionKey: request.sectionKey, actualSection, reason: "section_mismatch" });
      return;
    }
    if (!SocialStore.isApprovedForSnapshot(row)) {
      rejected.push({ id: request.id, sectionKey: request.sectionKey, reason: "candidate_no_longer_snapshot_eligible" });
      return;
    }
    accepted.push(row);
  });
  return { requested, rows, accepted, rejected };
}
async function releaseFromPublicationPlan(root, expected) {
  const normalizedPlan = normalizePublicationPlan(expected && expected.publicationPlan);
  const actualPlanHash = sha256(normalizedPlan);
  if (!expected || !expected.publicationPlan || !expected.publicationPlanHash) {
    const error = new Error("SOCIAL_PUBLICATION_PLAN_MISSING");
    error.code = "social_publication_plan_missing";
    throw error;
  }
  if (text(expected.publicationPlanHash) !== actualPlanHash) {
    const error = new Error("SOCIAL_PUBLICATION_PLAN_HASH_MISMATCH");
    error.code = "social_publication_plan_hash_mismatch";
    error.details = { expectedHash: text(expected.publicationPlanHash), actualHash: actualPlanHash };
    throw error;
  }
  const selected = await selectExactPublicationCandidates(normalizedPlan);
  const requestedCount = selected.requested.length;
  if (requestedCount > 0 && selected.accepted.length < 1) {
    const error = new Error("SOCIAL_PUBLICATION_PLAN_NO_ELIGIBLE_CANDIDATES");
    error.code = "social_publication_plan_no_eligible_candidates";
    error.details = { requestedCount, rejected: selected.rejected.slice(0, 100) };
    throw error;
  }
  const base = readSocialBaseForPlan(root);
  const route = {
    countryCode: text(expected.countryCode).toUpperCase(),
    worldRegion: text(expected.worldRegion),
    regionId: text(expected.worldRegion),
    scopeMode: text(expected.scopeMode) || (text(expected.countryCode) ? "country" : "global"),
  };
  const snapshot = SocialStore.buildSnapshot(base.doc, selected.accepted, { route });
  const documentHash = sha256(snapshot);
  const release = {
    release_id: text(expected.releaseId) || "social_plan_" + documentHash.slice(0, 20),
    status: "build_publication_plan",
    snapshot_hash: documentHash,
    snapshot,
    created_at: new Date().toISOString(),
    notes: "canonical_build_publication_plan;plan_hash=" + actualPlanHash,
    handoff_source: "supabase.social_candidates_exact_publication_plan",
  };
  return {
    release,
    source: "build_hook_publication_plan",
    expected,
    verification: {
      ok: true,
      planHash: actualPlanHash,
      requestedCount,
      acceptedCount: selected.accepted.length,
      rejectedCount: selected.rejected.length,
      rejected: selected.rejected.slice(0, 100),
      baseFile: path.relative(root, base.file).replace(/\\/g, "/"),
      documentHash,
    },
    directError: null,
  };
}
function releaseMatchesExpectation(release, expected) {
  if (!release || !release.snapshot) return { ok: false, reason: "stored_social_release_not_found" };
  const actualId = text(release.release_id);
  const storedHash = text(release.snapshot_hash);
  const documentHash = sha256(release.snapshot);
  if (expected && expected.releaseId && expected.releaseId !== actualId) {
    return { ok: false, reason: "social_release_id_mismatch", actualId, storedHash, documentHash };
  }
  if (storedHash && storedHash !== documentHash) {
    return { ok: false, reason: "social_release_stored_hash_mismatch", actualId, storedHash, documentHash };
  }
  if (expected && expected.snapshotHash && expected.snapshotHash !== documentHash) {
    return { ok: false, reason: "social_release_hook_hash_mismatch", actualId, storedHash, documentHash };
  }
  return { ok: true, actualId, storedHash, documentHash };
}
async function latestStoredRelease(expected) {
  const query = new URLSearchParams();
  query.set("select", "release_id,status,snapshot_hash,snapshot,created_at,notes");
  query.set("status", "eq.stored");
  if (expected && expected.releaseId) query.set("release_id", "eq." + expected.releaseId);
  query.set("order", "created_at.desc");
  query.set("limit", "1");
  const rows = await SocialStore.selectReleases(query.toString());
  return Array.isArray(rows) ? rows[0] || null : null;
}
function publicSiteBaseUrl() {
  const names = ["URL", "DEPLOY_PRIME_URL", "DEPLOY_URL", "SITE_URL"];
  for (const name of names) {
    const raw = text(process.env[name]);
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && url.hostname) return { name, value: url.origin };
    } catch (_error) {}
  }
  return { name: null, value: "" };
}
async function releaseFromFunctionReadback(expected) {
  // This fallback still reads the exact stored Social release on the server.
  // It exists only for Netlify build environments where the Supabase service
  // key is intentionally scoped to Functions. The returned release identity
  // and SHA-256 must match INCOMING_HOOK_BODY before SearchBank sees it.
  if (!expected || !expected.releaseId || !expected.snapshotHash) {
    const error = new Error("SOCIAL_EXACT_RELEASE_EXPECTATION_MISSING");
    error.code = "social_exact_release_expectation_missing";
    throw error;
  }
  const site = publicSiteBaseUrl();
  if (!site.value) {
    const error = new Error("SOCIAL_RELEASE_READBACK_SITE_URL_MISSING");
    error.code = "social_release_readback_site_url_missing";
    throw error;
  }
  const url = new URL("/.netlify/functions/social-snapshot-current", site.value);
  if (expected.scopeMode === "global") {
    url.searchParams.set("scopeMode", "global");
  } else if (expected.countryCode) {
    url.searchParams.set("countryCode", expected.countryCode);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: controller.signal,
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_error) { body = null; }
    if (!response.ok || !body || body.ok !== true || !body.snapshot) {
      const error = new Error("SOCIAL_RELEASE_FUNCTION_READBACK_FAILED:" + response.status);
      error.code = "social_release_function_readback_failed";
      throw error;
    }
    const release = {
      release_id: text(body.releaseId),
      status: "stored",
      snapshot_hash: text(body.hash),
      snapshot: body.snapshot,
      created_at: text(body.createdAt),
      notes: "build_exact_release_readback",
    };
    const match = releaseMatchesExpectation(release, expected);
    if (!match.ok || body.hashVerified !== true || text(body.documentHash) !== match.documentHash) {
      const error = new Error((match && match.reason) || "SOCIAL_RELEASE_READBACK_HASH_MISMATCH");
      error.code = (match && match.reason) || "social_release_readback_hash_mismatch";
      error.details = {
        expectedReleaseId: expected.releaseId,
        expectedSnapshotHash: expected.snapshotHash,
        returnedReleaseId: text(body.releaseId),
        returnedStoredHash: text(body.hash),
        returnedDocumentHash: text(body.documentHash),
        computedDocumentHash: match && match.documentHash || null,
      };
      throw error;
    }
    return {
      release,
      source: "function_exact_readback",
      endpointSource: site.name,
      endpoint: url.origin + url.pathname,
      verification: match,
    };
  } finally {
    clearTimeout(timer);
  }
}
async function loadStoredReleaseForBuild(rootInput, options) {
  const expected = incomingReleaseExpectation();
  const root = path.resolve(rootInput || process.cwd());
  const allowLatestStored = !!(options && options.allowLatestStored === true);
  const explicitHookIntent = !!(
    (expected.publicationPlan && expected.publicationPlanHash) ||
    (expected.releaseId && expected.snapshotHash)
  );

  // Never replay the last stored Social release just because some unrelated
  // Netlify deploy happens to execute this adapter.  The shared SearchBank may
  // only be changed by an explicit Social build hook, or by the canonical
  // Commerce transaction when it deliberately asks to preserve the currently
  // published Social state.
  if (!explicitHookIntent && !allowLatestStored) {
    return {
      release: null,
      source: "none",
      expected,
      verification: null,
      directError: "social_build_intent_not_explicit",
    };
  }

  if (expected.publicationPlan && expected.publicationPlanHash) {
    return releaseFromPublicationPlan(root, expected);
  }
  let directError = null;
  try {
    const release = await latestStoredRelease(expected);
    if (release && release.snapshot) {
      const verification = releaseMatchesExpectation(release, expected);
      if (!verification.ok) {
        const error = new Error(verification.reason);
        error.code = verification.reason;
        error.details = verification;
        throw error;
      }
      return { release, source: "supabase_direct", expected, verification, directError: null };
    }
    directError = "stored_social_release_not_found";
  } catch (error) {
    directError = text(error && (error.code || error.message)) || String(error);
    // Identity/hash mismatches are fail-closed. Only storage/config/read
    // unavailability may use the exact server-side readback bridge.
    if (/mismatch/i.test(directError)) throw error;
  }
  if (expected.releaseId && expected.snapshotHash) {
    const fallback = await releaseFromFunctionReadback(expected);
    return Object.assign({ expected, directError }, fallback);
  }
  if (directError && directError !== "stored_social_release_not_found") {
    const error = new Error(directError);
    error.code = "social_release_store_unavailable";
    throw error;
  }
  return { release: null, source: "none", expected, verification: null, directError };
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
  let releaseLoad;
  try {
    releaseLoad = await loadStoredReleaseForBuild(root, {
      allowLatestStored: !!(input && input.allowLatestStored === true),
    });
    release = releaseLoad && releaseLoad.release;
  } catch (error) {
    report.reason = error && error.code || "social_release_store_unavailable";
    report.error = text(error && error.message) || String(error);
    report.details = error && error.details || null;
    report.releaseRead = {
      source: "failed",
      expected: incomingReleaseExpectation(),
    };
    atomicWriteJson(outputPath(root, REPORT_FILE), report);
    return report;
  }
  report.releaseRead = {
    source: releaseLoad && releaseLoad.source || "none",
    expected: releaseLoad && releaseLoad.expected || {},
    directError: releaseLoad && releaseLoad.directError || null,
    endpointSource: releaseLoad && releaseLoad.endpointSource || null,
    endpoint: releaseLoad && releaseLoad.endpoint || null,
    verification: releaseLoad && releaseLoad.verification || null,
  };
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
  incomingReleaseExpectation,
  normalizePublicationPlan,
  releaseFromPublicationPlan,
  releaseMatchesExpectation,
  loadStoredReleaseForBuild,
  policyGate,
  passThroughSearchBankEngineContract,
  mergeIntoSearchBankSnapshot,
  isPriorSocialCandidateItem,
  publish,
  sha256,
};
