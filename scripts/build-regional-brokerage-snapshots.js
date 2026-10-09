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

async function publishSocialIndependently(options) {
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
  // Never execute an older adapter that writes Social rows into the shared
  // Canonical Commerce SearchBank. Distribution remains safe even when this
  // shared build file is deployed a moment before the Social package.
  if (typeof socialRelease.socialBankPaths !== "function" ||
      String(socialRelease.SOCIAL_BANK_FILE || "") !== "social-searchbank.release.snapshot.json") {
    return {
      status: "skipped",
      isolated: true,
      reason: "legacy_shared_searchbank_social_adapter_blocked"
    };
  }
  try {
    const result = await socialRelease.publish({
      root,
      allowLatestStored: !!(options && options.allowLatestStored === true)
    });
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
  // Social is physically isolated from the Commerce/Distribution canonical
  // SearchBank. Checkpoint only Social-owned handoff/snapshot files.
  path.join("data", "social.snapshot.json"),
  path.join("data", "social-searchbank.release.snapshot.json"),
  path.join("data", "social-pipeline.report.json"),
  path.join("netlify", "functions", "data", "social.snapshot.json"),
  path.join("netlify", "functions", "social.snapshot.json"),
  path.join("netlify", "functions", "data", "social-searchbank.release.snapshot.json"),
  path.join("netlify", "functions", "social-searchbank.release.snapshot.json")
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

function incomingSocialHookIntent() {
  const raw = String(process.env.INCOMING_HOOK_BODY || "").trim();
  if (!raw) return { explicit: false, rawAvailable: false, releaseId: null, operation: null, publicationPlanPresent: false, publicationPlanCount: 0, actualPublicationPlanCount: 0 };
  try {
    const body = JSON.parse(raw);
    const trigger = String(body && body.trigger || "").toLowerCase();
    const releaseId = String(body && body.releaseId || "").trim();
    const snapshotHash = String(body && body.snapshotHash || "").trim();
    const plan = body && body.publicationPlan && typeof body.publicationPlan === "object" ? body.publicationPlan : null;
    const planHash = String(body && body.publicationPlanHash || "").trim();
    const operation = String(body && body.operation || "publish").trim().toLowerCase() || "publish";
    const publicationPlanCount = Number(body && body.publicationPlanCount || 0);
    const actualPublicationPlanCount = plan
      ? Object.values(plan).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)
      : 0;
    const explicit = trigger === "approved-social-snapshot-release" && !!(
      (plan && planHash) || (releaseId && snapshotHash)
    );
    return {
      explicit,
      rawAvailable: true,
      trigger: trigger || null,
      operation,
      releaseId: releaseId || null,
      snapshotHash: snapshotHash || null,
      publicationPlanPresent: !!plan,
      publicationPlanCount,
      actualPublicationPlanCount,
      publicationPlanCountMismatch: !!plan && publicationPlanCount !== actualPublicationPlanCount
    };
  } catch (error) {
    return {
      explicit: false,
      rawAvailable: true,
      parseError: String(error && error.message || error),
      releaseId: null,
      operation: null,
      publicationPlanPresent: false,
      publicationPlanCount: 0,
      actualPublicationPlanCount: 0
    };
  }
}

function loadDedicatedSocialBank() {
  const files = [
    path.join(root, "data", "social-searchbank.release.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "social-searchbank.release.snapshot.json"),
    path.join(root, "netlify", "functions", "social-searchbank.release.snapshot.json")
  ];
  const errors = [];
  for (const file of files) {
    if (!fileExists(file)) continue;
    try {
      const doc = readJson(file);
      if (doc && Array.isArray(doc.items)) {
        return { ok: true, file, relative: path.relative(root, file).replace(/\\/g, "/"), bank: doc, errors };
      }
      errors.push({ file: path.relative(root, file).replace(/\\/g, "/"), reason: "invalid_shape" });
    } catch (error) {
      errors.push({ file: path.relative(root, file).replace(/\\/g, "/"), reason: String(error && error.message || error) });
    }
  }
  return { ok: false, file: null, relative: null, bank: null, errors };
}

async function publishSocialSafely(options) {
  options = options || {};
  const checkpoint = createSocialCheckpoint();
  let result;
  try {
    result = await publishSocialIndependently({
      allowLatestStored: options.allowLatestStored === true
    });
    const status = String(result && result.status || "").toLowerCase();
    if (status !== "searchbank_handoff_complete") {
      const restored = restoreSocialCheckpoint(checkpoint);
      return Object.assign({}, result || {}, { rollback: "restored", restored });
    }
    if (options.materializeSnapshot === true) {
      const loaded = loadDedicatedSocialBank();
      if (!loaded.ok) {
        const error = new Error("Dedicated Social SearchBank handoff is missing or invalid.");
        error.code = "SOCIAL_DEDICATED_BANK_UNAVAILABLE";
        error.details = loaded.errors;
        throw error;
      }
      const report = snapshots.run({ targetPage: "social", bank: loaded.bank });
      if (!report || report.ok !== true) {
        const error = new Error("Social target Snapshot Engine materialization failed.");
        error.code = "SOCIAL_SNAPSHOT_MATERIALIZATION_FAILED";
        throw error;
      }
      result = Object.assign({}, result, {
        snapshotEngine: report,
        downstream: "dedicated-social-bank-to-social-snapshot",
        socialBankFile: loaded.relative
      });
    }
    return result;
  } catch (error) {
    let restored = [];
    let rollbackError = null;
    try { restored = restoreSocialCheckpoint(checkpoint); }
    catch (restoreError) { rollbackError = String(restoreError && restoreError.message || restoreError); }
    if (rollbackError) {
      const safetyError = new Error("Social publication failed and rollback could not restore the isolated Social state: " + rollbackError);
      safetyError.code = "SOCIAL_PUBLICATION_ROLLBACK_FAILED";
      throw safetyError;
    }
    return {
      status: "failed",
      isolated: true,
      reason: error && error.code || "social_publication_execution_failed",
      error: String(error && error.message || error),
      rollback: "restored",
      restored
    };
  } finally {
    removeSocialCheckpoint(checkpoint);
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

function incomingCommerceHookIntent() {
  const raw = String(process.env.INCOMING_HOOK_BODY || "").trim();
  if (!raw) return { explicit:false, operation:null, candidateIds:[], candidateCount:0, rawAvailable:false };
  try {
    const body = JSON.parse(raw);
    const operation = String(body && body.operation || "").toLowerCase();
    const trigger = String(body && body.trigger || "").toLowerCase();
    const authorization = String(body && body.authorization || "").toLowerCase();
    const ids = Array.from(new Set((Array.isArray(body && body.candidateIds) ? body.candidateIds : [body && body.candidateId]).map(value => String(value || "").trim()).filter(Boolean))).slice(0,1800);
    const explicit = authorization === "explicit_admin_confirmation" && ["publish","unpublish"].includes(operation) && ["approved-commerce-assignment","approved-commerce-unpublication"].includes(trigger);
    return { explicit, operation: operation || null, candidateIds: ids, candidateCount: Math.max(ids.length, Number(body && body.candidateCount || 0)), rawAvailable:true };
  } catch (error) {
    return { explicit:false, operation:null, candidateIds:[], candidateCount:0, rawAvailable:true, parseError:String(error && error.message || error) };
  }
}

// A section/single-section Front Match is a delta request, not a replacement
// SearchBank document. Validate that every clicked candidate is present in the
// authoritative publication queue, but keep the complete queue intact so the
// canonical publisher can rebuild all unchanged sections alongside the delta.
const ADMIN_SELECTION_NONPUBLIC_STATUSES = new Set([
  "blocked_structural",
  "deferred_duplicate_product",
  "deferred_section_capacity"
]);

function queueCandidateId(entry) {
  const candidate = entry && entry.candidate || {};
  return String(candidate.id || entry && entry.candidateId || "").trim();
}
function queuePublicationStatus(entry) {
  const request = entry && entry.publicationRequest || {};
  const assignment = entry && entry.assignment || {};
  return String(request.status || assignment.publicationStatus || "").trim().toLowerCase();
}
function compactCommerceSelection(selection) {
  selection = selection && typeof selection === "object" ? selection : {};
  const held = Array.isArray(selection.heldCandidates) ? selection.heldCandidates : [];
  const statusCounts = {};
  for (const row of held) {
    const status = String(row && row.status || "unknown");
    statusCounts[status] = Number(statusCounts[status] || 0) + 1;
  }
  return {
    applied: selection.applied === true,
    selectedCount: Number(selection.selectedCount || 0),
    authoritativeCount: Number(selection.authoritativeCount || 0),
    admittedCount: Array.isArray(selection.admittedCandidateIds) ? selection.admittedCandidateIds.length : 0,
    heldCount: held.length,
    heldStatusCounts: statusCounts,
    heldSample: held.slice(0, 12),
    hardMissingCount: Array.isArray(selection.missingCandidateIds) ? selection.missingCandidateIds.length : 0,
    hardMissingSample: Array.isArray(selection.missingCandidateIds) ? selection.missingCandidateIds.slice(0, 12) : [],
    fullQueuePreserved: selection.fullQueuePreserved === true,
    buildBlocked: selection.buildBlocked === true
  };
}

// A section/single-section Front Match is a delta request, not a replacement
// SearchBank document.  Registry intentionally normalizes the publication set:
// structurally broken rows are held, exact-product duplicates are represented by
// one canonical candidate, and rows beyond a physical section capacity remain
// private.  Those deliberate holds are NOT identity loss.  Only a clicked ID
// that disappeared from the complete private queue (or has an unrecognized
// non-publication status) is a hard deployment error.
function validateExplicitCommerceSelection(upstream, intent) {
  const selectedIds = Array.from(new Set((Array.isArray(intent && intent.candidateIds) ? intent.candidateIds : []).map(value => String(value || "").trim()).filter(Boolean))).slice(0,1800);
  const applicable = !!(
    upstream && upstream.queueAuthoritative === true &&
    intent && intent.explicit === true && intent.operation === "publish" &&
    selectedIds.length
  );
  const authoritativeItems = Array.isArray(upstream && upstream.doc && upstream.doc.items) ? upstream.doc.items : [];
  const allQueueItems = Array.isArray(upstream && upstream.allQueueItems) ? upstream.allQueueItems : authoritativeItems;
  if (!applicable) {
    return { applied:false, selectedCandidateIds:selectedIds, selectedCount:selectedIds.length, authoritativeCount:authoritativeItems.length, fullQueuePreserved:true, missingCandidateIds:[], heldCandidateIds:[], heldCandidates:[], admittedCandidateIds:[], rejectedCandidateIds:[], buildBlocked:false };
  }
  const authoritativeIds = new Set(authoritativeItems.map(queueCandidateId).filter(Boolean));
  const allById = new Map(allQueueItems.map(entry => [queueCandidateId(entry), entry]).filter(pair => pair[0]));
  const admittedCandidateIds = [];
  const heldCandidates = [];
  const hardMissingCandidateIds = [];
  for (const id of selectedIds) {
    if (authoritativeIds.has(id)) {
      admittedCandidateIds.push(id);
      continue;
    }
    const row = allById.get(id);
    const status = row ? queuePublicationStatus(row) : "";
    if (row && ADMIN_SELECTION_NONPUBLIC_STATUSES.has(status)) {
      const candidate = row.candidate || {};
      const deferred = candidate.publicationDeferred || {};
      heldCandidates.push({
        candidateId:id,
        status,
        reason:String(deferred.reason || (row.bridgeValidation && row.bridgeValidation.errors || []).join(",") || status),
        keptCandidateId:String(deferred.keptCandidateId || "") || null,
        capacity:Number(deferred.capacity || 0) || null,
        rank:Number(deferred.rank || 0) || null
      });
      continue;
    }
    hardMissingCandidateIds.push(id);
  }
  return {
    applied:true,
    selectedCandidateIds:selectedIds,
    selectedCount:selectedIds.length,
    authoritativeCount:authoritativeItems.length,
    fullQueuePreserved:true,
    missingCandidateIds:hardMissingCandidateIds,
    heldCandidateIds:heldCandidates.map(row => row.candidateId),
    heldCandidates,
    admittedCandidateIds,
    rejectedCandidateIds:hardMissingCandidateIds,
    buildBlocked:hardMissingCandidateIds.length>0
  };
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
 * Snapshot publication normally requires an explicit administrator publication
 * queue. The only authoritative empty queue is a durable, explicit
 * administrator unpublication request written by the go-live audit flow. This
 * distinction lets "no healthy replacement" restore sample fallbacks without
 * allowing an ordinary empty queue to erase committed real-product snapshots.
 */
function loadConfirmedUpstream(commerceRegistrySync) {
  const files = upstreamMirrorFiles();
  const mirrors = files.map(file => ({ path: path.relative(root, file).replace(/\\/g, "/"), present: fileExists(file) }));
  const authorization = commerceRegistrySync && commerceRegistrySync.releaseAuthorization || {};
  const requestedCount = Number(commerceRegistrySync && commerceRegistrySync.requestedCount || authorization.requestedCount || 0);
  const withdrawnCount = Number(commerceRegistrySync && commerceRegistrySync.withdrawnCount || authorization.withdrawnCount || 0);
  const explicitAdminRequest = authorization.explicitAdminRequest === true && requestedCount > 0;
  const explicitAdminWithdrawal = authorization.explicitAdminWithdrawal === true && withdrawnCount > 0;
  const recognizedMode = ["explicit-admin-publication-request", "explicit-admin-unpublication-request"].includes(String(authorization.mode || "").toLowerCase());
  const queueAuthoritative = !!(
    commerceRegistrySync &&
    commerceRegistrySync.ok === true &&
    commerceRegistrySync.status === "synchronized" &&
    commerceRegistrySync.authoritative === true &&
    authorization.authoritative === true &&
    recognizedMode &&
    (explicitAdminRequest || explicitAdminWithdrawal)
  );
  const queueMeta = {
    authoritative: queueAuthoritative,
    requestedCount,
    withdrawnCount,
    explicitAdminRequest,
    explicitAdminWithdrawal,
    scopeKeys: Array.isArray(commerceRegistrySync && commerceRegistrySync.scopeKeys) ? commerceRegistrySync.scopeKeys.slice() : [],
    withdrawalScopeKeys: Array.isArray(commerceRegistrySync && commerceRegistrySync.withdrawalScopeKeys) ? commerceRegistrySync.withdrawalScopeKeys.slice() : [],
    releaseAuthorization: authorization
  };

  if (queueAuthoritative) {
    try {
      const queueFile = String(commerceRegistrySync.file || path.join(root, "netlify", "functions", "data", "commerce-candidate-review-queue.v1.json"));
      const queueDoc = readJson(queueFile);
      const allQueueItems = Array.isArray(queueDoc && queueDoc.items) ? queueDoc.items : [];
      const requestedItems = allQueueItems.filter(item => item && item.publicationRequest && item.publicationRequest.requested === true);
      if (requestedItems.length !== queueMeta.requestedCount) {
        return { ok: false, reason: "authoritative-admin-queue-count-mismatch", mirrors, queueAuthoritative };
      }
      if (requestedItems.length === 0 && !explicitAdminWithdrawal) {
        return { ok: false, reason: "authoritative-admin-queue-empty-without-withdrawal", mirrors, queueAuthoritative };
      }
      return {
        ok: true,
        sourceMode: requestedItems.length ? "authoritative-admin-review-queue" : "authoritative-admin-withdrawal-empty-queue",
        doc: Object.assign({}, queueDoc, { queue: queueMeta, items: requestedItems }),
        candidateCount: requestedItems.length,
        queueAuthoritative,
        allQueueItems,
        authoritativeWithdrawal: requestedItems.length === 0 && explicitAdminWithdrawal,
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
    sourceMode: "mirrored-sanmaru-searchbank-upstream",
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
function cardDestination(card) {
  if (!card || typeof card !== "object") return "";
  const authority=card.administratorFrontMatchAuthority&&typeof card.administratorFrontMatchAuthority==="object"?card.administratorFrontMatchAuthority:{};
  const review=card.commerceCandidatePublication&&card.commerceCandidatePublication.review&&typeof card.commerceCandidatePublication.review==="object"?card.commerceCandidatePublication.review:{};
  const direct=String(card.externalProductUrl||card.officialProductUrl||card.productUrl||card.productPageUrl||card.detailUrl||card.checkoutUrl||card.purchaseUrl||card.orderUrl||card.productLink||card.displayUrl||"").trim();
  if((authority.verified===true||review.explicitPublicationRequested===true)&&direct)return direct;
  return String(card.affiliateOutboundUrl||card.externalOutboundUrl||direct||card.sourceUrl||card.targetUrl||card.outboundUrl||card.url||card.href||card.link||"").trim();
}
function cardImage(card) {
  return String(card && (card.image || card.imageUrl || card.image_url || card.imageOriginalUrl || card.thumb || card.thumbnail || card.thumbnailUrl || card.thumbnail_url) || "").trim();
}
function canonicalPublicationExpectations() {
  const file = path.join(root, "data", "search-bank.snapshot.json");
  const doc = fileExists(file) ? readJson(file) : null;
  const expected = new Map();
  for (const item of Array.isArray(doc && doc.items) ? doc.items : []) {
    const placement = item && item.placement || {};
    const publication = item && item.canonicalPublication || {};
    const page = String(placement.page || "").trim();
    const country = String(placement.country || "").trim().toUpperCase();
    const regionRaw = String(placement.region || "").trim().toUpperCase();
    const region = regionRaw && regionRaw !== "NATIONWIDE" ? regionRaw : null;
    const candidateId = String(publication.candidateId || item && item.id || "").trim();
    if (!page || !country || !candidateId || !["home","distribution","network","social","tour"].includes(page)) continue;
    const key = [page,country,region || "NATIONWIDE"].join("|");
    if (!expected.has(key)) expected.set(key,{page,country,region,count:0,candidates:[]});
    const target=expected.get(key);
    target.count += 1;
    target.candidates.push({candidateId,destination:cardDestination(item),image:cardImage(item)});
  }
  return Array.from(expected.values());
}

function verifyCanonicalToIpOutputs(ipSlotReport) {
  const expected = canonicalPublicationExpectations();
  const outputs = Array.isArray(ipSlotReport && ipSlotReport.scopedOutputs) ? ipSlotReport.scopedOutputs : [];
  const problems = [];
  for (const target of expected) {
    const found = outputs.find((row) => row && row.page === target.page && row.country === target.country && String(row.region || "") === String(target.region || ""));
    if (!found) {
      problems.push("CANONICAL_SCOPE_NOT_PUBLISHED:" + [target.page,target.country,target.region || "NATIONWIDE"].join(":"));
      continue;
    }
    if (Number(found.cardCount || 0) <= 0) {
      problems.push("CANONICAL_SCOPE_PUBLISHED_EMPTY:" + String(found.path || ""));
      continue;
    }
    const relative=String(found.path||"").replace(/^\/+/,"");
    const absolute=relative?path.join(root,relative):"";
    const scopedDoc=absolute&&fileExists(absolute)?readJson(absolute):null;
    const cards=rootGateRows(scopedDoc,target.page);
    const byId=new Map();
    for(const card of cards){
      const publication=card&&card.canonicalPublication||{};
      const id=String(publication.candidateId||card&&card.id||"").trim();
      if(id&&!byId.has(id))byId.set(id,card);
    }
    for(const candidate of target.candidates){
      const card=byId.get(candidate.candidateId);
      if(!card){problems.push("CANONICAL_CANDIDATE_NOT_PUBLISHED:"+candidate.candidateId+":"+String(found.path||""));continue;}
      const destination=cardDestination(card),image=cardImage(card);
      if(!destination) problems.push("CANONICAL_CANDIDATE_DESTINATION_LOST:"+candidate.candidateId);
      else if(candidate.destination&&destination!==candidate.destination) problems.push("CANONICAL_CANDIDATE_DESTINATION_CHANGED:"+candidate.candidateId);
      if(!image) problems.push("CANONICAL_CANDIDATE_IMAGE_LOST:"+candidate.candidateId);
      else if(candidate.image&&image!==candidate.image) problems.push("CANONICAL_CANDIDATE_IMAGE_CHANGED:"+candidate.candidateId);
    }
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

function productionDeployBuild() {
  return String(process.env.CONTEXT || "").trim().toLowerCase() === "production";
}

function liveCarrySourceUrls() {
  const values = [];
  const add = (raw) => {
    try {
      const url = new URL(String(raw || "").trim());
      if (!/^https?:$/.test(url.protocol)) return;
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      const normalized = url.toString().replace(/\/$/, "");
      if (normalized && !values.includes(normalized)) values.push(normalized);
    } catch (_error) {}
  };
  const siteName = String(process.env.SITE_NAME || "").trim().toLowerCase();

  // An explicit operator source always wins.
  add(process.env.IGDC_DISTRIBUTION_CARRY_SOURCE_URL);

  // igdc-test must inherit the currently published production product scopes
  // BEFORE considering its own previous deploy.  A previous test deploy may be
  // structurally valid but contain only placeholder/root fallback cards.
  if (siteName === "igdc-test") {
    add(process.env.IGDC_PRODUCTION_SITE_URL);
    add("https://igdc-platform.netlify.app");
  }

  // For the production project, URL/SITE_URL still point at the deploy that is
  // currently live while this fresh build is running, which is the correct
  // source for byte-for-byte carry-forward.
  add(process.env.URL);
  add(process.env.SITE_URL);
  if (siteName) add("https://" + siteName + ".netlify.app");
  return values;
}

function scopedCarryPath(relative) {
  const raw = String(relative || "").trim();
  if (!raw.startsWith("/data/auto/") || raw.includes("..") || raw.includes("\\")) return null;
  const autoRoot = path.resolve(root, "data", "auto");
  const absolute = path.resolve(root, raw.replace(/^\/+/, ""));
  if (absolute !== autoRoot && !absolute.startsWith(autoRoot + path.sep)) return null;
  return absolute;
}

function rootCarryPath(relative) {
  const raw = String(relative || "").trim();
  const allowed = new Set([
    "/data/front.snapshot.json",
    "/data/distribution.snapshot.json",
    "/data/networkhub-snapshot.json",
    "/data/tour-snapshot.json",
    "/data/social.snapshot.json"
  ]);
  if (!allowed.has(raw)) return null;
  return path.resolve(root, raw.replace(/^\/+/, ""));
}

async function fetchJsonArtifact(base, relative) {
  const target = new URL(String(relative || ""), base + "/");
  target.searchParams.set("igdc_carry", String(Date.now()));
  const response = await fetch(target.toString(), { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("HTTP_" + response.status + ":" + relative);
  const bytes = Buffer.from(await response.arrayBuffer());
  let doc;
  try { doc = JSON.parse(bytes.toString("utf8")); }
  catch (_error) { throw new Error("INVALID_JSON:" + relative); }
  return { bytes, doc };
}

function carriedScopedSnapshotHasPublishedProducts(doc, row, manifest) {
  const page = String(row && row.page || "").trim();
  const country = String(row && row.country || "").trim().toUpperCase();
  const region = String(row && row.region || "").trim().toUpperCase();
  const meta = doc && doc.meta && typeof doc.meta === "object" ? doc.meta : {};
  if (!doc || !page || !country) return false;

  if (page === "distribution") {
    if (meta.regionalBrokerageSnapshot !== true || String(meta.targetMarket || "").toUpperCase() !== country) return false;
    if (String(meta.targetRegion || "").toUpperCase() !== region) return false;
  } else {
    if (meta.ipSlotSnapshot !== true || meta.geoMatched !== true) return false;
    if (String(meta.targetCountry || "").toUpperCase() !== country) return false;
    if (String(meta.targetRegion || "").toUpperCase() !== region) return false;
    if (String(meta.canonicalReleaseId || "") !== String(manifest && manifest.canonicalReleaseId || "")) return false;
    if (String(meta.ipSlotPolicyDigest || "") !== String(manifest && manifest.ipSlotPolicyDigest || "")) return false;
  }

  const cards = rootGateRows(doc, page);
  let realCount = 0;
  for (const card of cards) {
    if (!card || typeof card !== "object") continue;
    const publication = card.canonicalPublication && typeof card.canonicalPublication === "object" ? card.canonicalPublication : null;
    const placement = card.placement && typeof card.placement === "object" ? card.placement : null;
    if (!publication || publication.status !== "published") continue;
    if (String(publication.releaseId || "") !== String(manifest && manifest.canonicalReleaseId || "")) continue;
    if (!publication.candidateId || !publication.mappingDigest) continue;
    if (!placement || String(placement.page || "") !== page || String(placement.country || "").toUpperCase() !== country) continue;
    const url = String(card.affiliateOutboundUrl || card.externalOutboundUrl || card.url || card.link || "").trim();
    if (!/^https?:\/\//i.test(url) || /(^|\.)example\.(com|org|net)(?:[\/:]|$)/i.test(url)) continue;
    realCount += 1;
    if (realCount > 0) return true;
  }
  return false;
}

async function carryForwardPublishedScopedOutputs() {
  const attempts = [];
  const allowedFiles = new Set([
    "front.snapshot.json",
    "distribution.snapshot.json",
    "networkhub-snapshot.json",
    "tour-snapshot.json",
    "social.snapshot.json"
  ]);
  for (const base of liveCarrySourceUrls()) {
    let stageRoot = null;
    try {
      const manifestArtifact = await fetchJsonArtifact(base, "/data/auto/ip-slot-manifest.json");
      const manifest = manifestArtifact.doc;
      const rows = Array.isArray(manifest && manifest.snapshots) ? manifest.snapshots : [];
      if (!manifest || manifest.schema !== "canonical-ip-slot-release-manifest-v1" || !manifest.canonicalReleaseId || !rows.length || rows.length > 2500) {
        throw new Error("INVALID_OR_EMPTY_LIVE_IP_SLOT_MANIFEST");
      }
      stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "igdc-live-distribution-"));
      let totalBytes = manifestArtifact.bytes.length;
      const written = [];
      for (const row of rows) {
        const relative = String(row && row.path || "").trim();
        const expectedHash = String(row && row.sha256 || "").trim().toLowerCase();
        const expectedFile = String(row && row.file || "").trim();
        const absolute = scopedCarryPath(relative);
        if (!absolute || !allowedFiles.has(expectedFile) || path.basename(relative) !== expectedFile || !/^[a-f0-9]{64}$/.test(expectedHash)) {
          throw new Error("INVALID_LIVE_SCOPED_ROW:" + relative);
        }
        const artifact = await fetchJsonArtifact(base, relative);
        const actualHash = crypto.createHash("sha256").update(artifact.bytes).digest("hex");
        if (actualHash !== expectedHash) throw new Error("LIVE_SCOPED_HASH_MISMATCH:" + relative);
        if (!carriedScopedSnapshotHasPublishedProducts(artifact.doc, row, manifest)) {
          throw new Error("LIVE_SCOPED_REAL_PRODUCTS_MISSING:" + relative);
        }
        totalBytes += artifact.bytes.length;
        if (totalBytes > 512 * 1024 * 1024) throw new Error("LIVE_SCOPED_CARRY_TOO_LARGE");
        const staged = path.join(stageRoot, relative.replace(/^\/+/, ""));
        fs.mkdirSync(path.dirname(staged), { recursive: true });
        fs.writeFileSync(staged, artifact.bytes);
        written.push(relative);
      }
      const rootFallbacks = Array.isArray(manifest.rootFallbacks) ? manifest.rootFallbacks : [];
      const rootWrites = [];
      for (const row of rootFallbacks) {
        const relative = String(row && row.path || "").trim();
        const expectedHash = String(row && row.sha256 || "").trim().toLowerCase();
        const absolute = rootCarryPath(relative);
        if (!absolute || !/^[a-f0-9]{64}$/.test(expectedHash)) continue;
        const artifact = await fetchJsonArtifact(base, relative);
        const actualHash = crypto.createHash("sha256").update(artifact.bytes).digest("hex");
        if (actualHash !== expectedHash) throw new Error("LIVE_ROOT_FALLBACK_HASH_MISMATCH:" + relative);
        const staged = path.join(stageRoot, relative.replace(/^\/+/, ""));
        fs.mkdirSync(path.dirname(staged), { recursive: true });
        fs.writeFileSync(staged, artifact.bytes);
        rootWrites.push(relative);
      }
      const stagedManifest = path.join(stageRoot, "data", "auto", "ip-slot-manifest.json");
      fs.mkdirSync(path.dirname(stagedManifest), { recursive: true });
      fs.writeFileSync(stagedManifest, manifestArtifact.bytes);

      const targetAuto = path.join(root, "data", "auto");
      const stagedAuto = path.join(stageRoot, "data", "auto");
      fs.rmSync(targetAuto, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(targetAuto), { recursive: true });
      fs.cpSync(stagedAuto, targetAuto, { recursive: true, force: true });
      for (const relative of rootWrites) {
        const source = path.join(stageRoot, relative.replace(/^\/+/, ""));
        const target = rootCarryPath(relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
      // Re-check the final build workspace after the atomic-ish directory copy.
      // This catches partial/corrupt carries before Netlify is allowed to publish.
      const copiedManifest = readJson(path.join(root, "data", "auto", "ip-slot-manifest.json"));
      if (String(copiedManifest && copiedManifest.canonicalReleaseId || "") !== String(manifest.canonicalReleaseId || "")) {
        throw new Error("LIVE_CARRY_FINAL_MANIFEST_MISMATCH");
      }
      for (const row of rows) {
        const relative = String(row && row.path || "").trim();
        const expectedHash = String(row && row.sha256 || "").trim().toLowerCase();
        const target = scopedCarryPath(relative);
        if (!target || !fileExists(target) || sha256File(target) !== expectedHash) {
          throw new Error("LIVE_CARRY_FINAL_HASH_MISMATCH:" + relative);
        }
      }
      fs.rmSync(stageRoot, { recursive: true, force: true });
      return {
        ok: true,
        source: base,
        canonicalReleaseId: manifest.canonicalReleaseId,
        scopedOutputCount: written.length,
        rootFallbackCount: rootWrites.length,
        totalBytes
      };
    } catch (error) {
      if (stageRoot) fs.rmSync(stageRoot, { recursive: true, force: true });
      attempts.push({ source: base, error: String(error && error.message || error) });
    }
  }
  return { ok: false, attempts };
}

function compactSocialReport(report) {
  if (!report || typeof report !== "object") return report || null;
  const gate = report.policyGate && typeof report.policyGate === "object" ? report.policyGate : null;
  const handoff = report.searchBankSnapshot && typeof report.searchBankSnapshot === "object" ? report.searchBankSnapshot : null;
  return {
    version: report.version || null,
    status: report.status || null,
    reason: report.reason || null,
    isolated: report.isolated === true,
    releaseId: report.releaseId || null,
    releaseRead: report.releaseRead ? {
      source: report.releaseRead.source || null,
      directError: report.releaseRead.directError || null
    } : null,
    policyGate: gate ? {
      ok: gate.ok === true,
      acceptedCount: Number(gate.acceptedCount || 0),
      rejectedCount: Number(gate.rejectedCount || 0),
      counts: gate.counts || {},
      rejectedSample: Array.isArray(gate.rejected) ? gate.rejected.slice(0, 10) : []
    } : null,
    searchBankSnapshot: handoff ? {
      file: handoff.file || null,
      hash: handoff.hash || null,
      finalTotalItems: handoff.finalTotalItems == null ? null : Number(handoff.finalTotalItems),
      sharedSearchBankUntouched: handoff.sharedSearchBankUntouched === true,
      searchBankEngine: handoff.searchBankEngine ? {
        version: handoff.searchBankEngine.version || null,
        contractVersion: handoff.searchBankEngine.contractVersion || null,
        inputCount: Number(handoff.searchBankEngine.inputCount || 0),
        accepted: Number(handoff.searchBankEngine.accepted || 0),
        rejected: Number(handoff.searchBankEngine.rejected || 0)
      } : null
    } : null,
    pipeline: report.pipeline || null,
    rollback: report.rollback || null
  };
}

function compactProblems(list, limit) {
  const source = Array.isArray(list) ? list.map(value => String(value)) : [];
  const max = Math.max(1, Number(limit) || 20);
  return {
    count: source.length,
    sample: source.slice(0, max),
    truncated: source.length > max
  };
}
function compactRegionalReport(report) {
  report = report && typeof report === "object" ? report : {};
  const scopes = Array.isArray(report.scopes) ? report.scopes : [];
  return {
    version: report.version || null,
    sourceBank: report.sourceBank || null,
    canonicalPublicationVerified: report.canonicalPublicationVerified === true,
    scopeCount: scopes.length,
    publishedScopeCount: scopes.filter(row => row && row.published === true).length,
    publishedSnapshotCount: Number(report.publishedSnapshotCount || 0),
    removedStaleCount: Array.isArray(report.removedStaleSnapshots) ? report.removedStaleSnapshots.length : 0,
    manifest: report.manifest || null,
    scopeSample: scopes.slice(0, 10).map(row => ({market:row && row.market || null,region:row && row.region || null,published:row && row.published === true,written:Number(row && row.written || 0),output:row && row.output || null}))
  };
}
function compactIpSlotReport(report) {
  report = report && typeof report === "object" ? report : {};
  const outputs = Array.isArray(report.scopedOutputs) ? report.scopedOutputs : [];
  return {
    version: report.version || null,
    status: report.status || null,
    releaseId: report.releaseId || null,
    scopedOutputCount: outputs.length,
    rootFallbackCount: Array.isArray(report.rootFallbacks) ? report.rootFallbacks.length : 0,
    removedStaleCount: Array.isArray(report.removedStale) ? report.removedStale.length : 0,
    errors: compactProblems(report.errors || [], 12),
    manifest: report.manifest || null,
    outputSample: outputs.slice(0, 12).map(row => ({page:row && row.page || null,country:row && row.country || null,region:row && row.region || null,cardCount:Number(row && row.cardCount || 0),path:row && row.path || null}))
  };
}

async function main() {
  const incomingCommerceIntent = incomingCommerceHookIntent();
  const incomingSocialIntent = incomingSocialHookIntent();
  const explicitAdminPublicationInBuild = incomingCommerceIntent.explicit === true && incomingCommerceIntent.operation === "publish";
  const explicitSocialPublicationInBuild = incomingSocialIntent.explicit === true;
  const mustMaterializeDistribution = explicitAdminPublicationInBuild || explicitSocialPublicationInBuild || productionDeployBuild();
  let explicitSocialPublication = null;

  // A normal code deploy must carry the currently published scoped product
  // artifacts into the fresh Netlify filesystem.  Publication changes are the
  // only builds allowed to replace them from the administrator pipeline.
  if (productionDeployBuild() && !explicitAdminPublicationInBuild && !explicitSocialPublicationInBuild) {
    const carried = await carryForwardPublishedScopedOutputs();
    if (carried.ok) {
      writePreservedBuild("ordinary-production-live-scoped-output-carried-forward", carried);
      return;
    }
    process.stderr.write("Distribution live carry-forward unavailable; attempting authoritative rebuild: " + JSON.stringify(carried) + "\n");
  }

  function preserveOrFail(reason, details) {
    // An explicit administrator Front Match is a master-board replacement build.
    // Never preserve/carry forward an older live Snapshot in that path.  If the
    // current Supabase-backed authoritative queue cannot be materialized, fail
    // this deploy so stale front data cannot be mistaken for the new admin state.
    if (explicitAdminPublicationInBuild) {
      const error = new Error("Explicit administrator Front Match cannot preserve previous snapshots: " + reason);
      error.code = "EXPLICIT_FRONT_MATCH_CANNOT_PRESERVE_OLD_SNAPSHOTS";
      error.details = details || null;
      throw error;
    }
    // data/auto is build output, not a committed source tree. On a fresh Netlify
    // production build, returning before the regional/IP publishers would deploy
    // root sample fallbacks without the Distribution-owned scoped snapshots.
    // Fail closed so the previous production deploy stays live instead.
    const manifest = path.join(root, "data", "auto", "ip-slot-manifest.json");
    if (mustMaterializeDistribution && !fileExists(manifest)) {
      const error = new Error("Distribution scoped outputs were not materialized in this fresh build: " + reason);
      error.code = "DISTRIBUTION_SCOPED_OUTPUTS_NOT_MATERIALIZED";
      error.details = details || null;
      throw error;
    }
    writePreservedBuild(reason, details);
  }

  // A Social release changes only the isolated Social SearchBank handoff, but
  // a Netlify deploy is a fresh filesystem. Therefore Social cannot return early:
  // the durable Commerce state must be rehydrated in the same build and the
  // Distribution-owned country/region snapshots must be regenerated before the
  // deploy is allowed to become active.
  if (explicitSocialPublicationInBuild) {
    // Defensive compatibility for already-queued/older Social build hooks:
    // a normal publish with an empty manifest is not an unpublish. Preserve the
    // committed site and finish the build without touching SearchBank. New
    // publisher code blocks this before the hook is queued, but this guard also
    // protects deployments already waiting in Netlify's queue.
    if (incomingSocialIntent.publicationPlanPresent === true && incomingSocialIntent.operation !== "unpublish" && Number(incomingSocialIntent.actualPublicationPlanCount || 0) === 0) {
      explicitSocialPublication = {
        status: "preserved",
        isolated: true,
        reason: "empty_social_publish_plan_rejected_before_write",
        sharedSearchBank: "unchanged",
        snapshotEngine: "deferred-to-shared-build",
        note: "Zero-row publish is a safe no-op; Distribution scoped outputs are still rebuilt before deploy."
      };
    } else {
      explicitSocialPublication = await publishSocialSafely({
        allowLatestStored: false,
        // Do not materialize Social yet. Commerce/Distribution canonical state is
        // reconstructed independently first; Social then uses its dedicated bank.
        materializeSnapshot: false
      });
      if (String(explicitSocialPublication && explicitSocialPublication.status || "").toLowerCase() !== "searchbank_handoff_complete") {
        const error = new Error("Explicit Social publication did not complete its isolated SearchBank handoff: " + JSON.stringify(compactSocialReport(explicitSocialPublication)));
        error.code = "EXPLICIT_SOCIAL_SEARCHBANK_HANDOFF_FAILED";
        throw error;
      }
    }
  }

  // Explicit Social publication is isolated from Commerce/Distribution candidate
  // admission. Preserve the currently-live Distribution/IP artifacts byte-for-byte,
  // then materialize only the nine managed Social sections from the dedicated Social
  // bank. A stale or held Commerce review queue must never block an unrelated Social
  // release. If live Distribution carry-forward cannot be verified, fail closed so
  // Netlify keeps the previous production deploy instead of rebuilding Distribution
  // from an unrelated/invalid Commerce queue.
  if (explicitSocialPublicationInBuild) {
    const carriedDistribution = await carryForwardPublishedScopedOutputs();
    if (!carriedDistribution || carriedDistribution.ok !== true) {
      const error = new Error(
        "Explicit Social publication could not preserve the currently-live Distribution scoped outputs: " +
        JSON.stringify(carriedDistribution || null)
      );
      error.code = "SOCIAL_DISTRIBUTION_CARRY_FORWARD_FAILED";
      throw error;
    }

    let socialSnapshotReport = null;
    const socialStatus = String(explicitSocialPublication && explicitSocialPublication.status || "").toLowerCase();
    if (socialStatus === "searchbank_handoff_complete") {
      const socialBank = loadDedicatedSocialBank();
      if (!socialBank.ok) {
        const error = new Error("Explicit Social release completed but its dedicated bank cannot be read.");
        error.code = "SOCIAL_DEDICATED_BANK_UNAVAILABLE";
        error.details = socialBank.errors;
        throw error;
      }
      socialSnapshotReport = snapshots.run({ targetPage: "social", bank: socialBank.bank });
      if (!socialSnapshotReport || socialSnapshotReport.ok !== true) {
        const error = new Error("Explicit Social Snapshot materialization failed.");
        error.code = "SOCIAL_SNAPSHOT_MATERIALIZATION_FAILED";
        throw error;
      }
    } else if (socialStatus !== "preserved") {
      const error = new Error(
        "Explicit Social publication reached isolated materialization with unexpected status: " +
        socialStatus
      );
      error.code = "EXPLICIT_SOCIAL_UNEXPECTED_STATUS";
      throw error;
    }

    process.stdout.write(JSON.stringify({
      socialIsolation: {
        incomingSocialIntent,
        explicitPublication: compactSocialReport(explicitSocialPublication),
        canonicalCommerceSearchBankMutation: false,
        commerceCandidateIntake: "not_run_for_social_release",
        distribution: {
          mode: "live-byte-for-byte-carry-forward",
          source: carriedDistribution.source || null,
          canonicalReleaseId: carriedDistribution.canonicalReleaseId || null,
          scopedOutputCount: Number(carriedDistribution.scopedOutputCount || 0),
          rootFallbackCount: Number(carriedDistribution.rootFallbackCount || 0)
        },
        dedicatedBank: "data/social-searchbank.release.snapshot.json",
        socialSnapshot: socialSnapshotReport,
        rightPanelOwnedBy: "distribution-carried-forward"
      },
      snapshotEngine: {
        ok: !socialSnapshotReport || socialSnapshotReport.ok === true,
        mode: "social-only-isolated-materialization",
        socialTarget: socialSnapshotReport,
        distribution: "carried-forward-unchanged",
        media: "untouched",
        donation: "untouched"
      }
    }, null, 2) + "\n");
    return;
  }

  const commerceCheckpoint = createCommerceCheckpoint();
  try {

  // This sync only refreshes the private approved-candidate review queue. It
  // never writes a public Snapshot and cannot by itself publish front cards.
  const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });

  // A generic zero-count queue is never authoritative. The sole exception is
  // an explicit durable unpublication marker produced by the administrator
  // refresh/repair flow; that intentional empty set restores sample fallback.
  const upstream = loadConfirmedUpstream(commerceRegistrySync);
  if (!upstream.ok) {
    if (incomingCommerceIntent.explicit === true && incomingCommerceIntent.operation === "publish") {
      throw new Error("Explicit administrator Front Match reached the Netlify build, but the authoritative Global Slot publication queue could not be loaded: " + upstream.reason + " | " + JSON.stringify({commerceRegistrySync,incomingCommerceIntent}));
    }
    preserveOrFail(upstream.reason, { commerceRegistrySync, mirrors: upstream.mirrors, incomingCommerceIntent });
    return;
  }
  const queueAuthoritative = upstream.queueAuthoritative === true;
  // candidateIds from the clicked button identify the delta that was just
  // changed. They must never truncate the authoritative queue: Canonical writes
  // a complete public document, so filtering here turns a one-section match
  // into an invalid partial replacement. Validate the delta and rebuild from
  // the full durable publication queue instead.
  const incomingCommerceSelection = validateExplicitCommerceSelection(upstream, incomingCommerceIntent);
  if (incomingCommerceSelection.buildBlocked === true) {
    const error = new Error(
      "Administrator Front Match selection is not present in the complete authoritative/private queue: " +
      JSON.stringify(incomingCommerceSelection.missingCandidateIds || [])
    );
    error.code = "ADMIN_FRONT_SELECTION_NOT_IN_AUTHORITATIVE_QUEUE";
    error.details = compactCommerceSelection(incomingCommerceSelection);
    throw error;
  }
  if (Array.isArray(incomingCommerceSelection.heldCandidates) && incomingCommerceSelection.heldCandidates.length) {
    console.warn(
      "Administrator Front Match normalized " + incomingCommerceSelection.heldCandidates.length +
      " selected row(s) without aborting the release: " +
      JSON.stringify(compactCommerceSelection(incomingCommerceSelection))
    );
  }

  // Registry bridge performs the final board QA.  A Front Match with a broken
  // title, non-product destination, missing image or invalid section must fail
  // visibly; it must never silently publish a partial set or replace it with samples.
  const bridgeStructuralErrors = Array.isArray(commerceRegistrySync && commerceRegistrySync.bridge && commerceRegistrySync.bridge.structuralErrors)
    ? commerceRegistrySync.bridge.structuralErrors
    : [];
  let administratorStructuralHold = [];
  if (incomingCommerceIntent.explicit === true && incomingCommerceIntent.operation === "publish" && bridgeStructuralErrors.length) {
    const selected = new Set(incomingCommerceSelection.selectedCandidateIds || []);
    administratorStructuralHold = selected.size
      ? bridgeStructuralErrors.filter(row => selected.has(String(row && row.candidateId || "").trim()))
      : bridgeStructuralErrors.slice();
    // Structural QA is per product, not all-or-nothing. Registry has already
    // converted these rows to blocked_structural in the private review queue,
    // so the valid administrator rows must continue to SearchBank in the same
    // build. Keep the failures visible in diagnostics instead of rolling back
    // the entire deployment because one card has a bad title/url/image.
    if (administratorStructuralHold.length) {
      console.warn("Administrator Front Match structural hold: " + administratorStructuralHold.length + " row(s): " + JSON.stringify(administratorStructuralHold.slice(0, 25)));
    }
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
      // An authoritative Global Slot review queue is already the normalized
      // administrator source. Feeding the same queue envelopes through the raw
      // SearchBank input a second time creates duplicate malformed candidates
      // and can leave the private stage pinned to an old held result.
      items: queueAuthoritative ? [] : upstream.doc.items,
      trigger: "netlify-build-private-candidate-stage",
      reviewQueueDoc: queueAuthoritative ? upstream.doc : undefined,
      write: true
    });
  } catch (error) {
    preserveOrFail("candidate-intake-preflight-failed", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      error: String(error && error.message || error)
    });
    return;
  }

  if (!intake.ok) {
    preserveOrFail("candidate-intake-not-ready", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      problems: intake.problems || []
    });
    return;
  }

  if (!intake.releaseGate || intake.releaseGate.enabled !== true) {
    preserveOrFail("candidate-release-not-authorized", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      releaseGate: intake.releaseGate || null
    });
    return;
  }

  const releaseItems = Array.isArray(intake.releaseItems) ? intake.releaseItems : [];
  const administratorRequestedCount = Number(intake && intake.releaseGate && intake.releaseGate.requestedCount || commerceRegistrySync && commerceRegistrySync.requestedCount || 0);
  if (releaseItems.length === 0 && administratorRequestedCount > 0) {
    const held = Array.isArray(intake && intake.stage && intake.stage.candidates)
      ? intake.stage.candidates.filter(row => row && row.releaseEligible !== true).slice(0,25).map(row => ({
          candidateId:row.candidateId,
          reasons:row.reasons,
          administratorFrontMatch:row.administratorFrontMatch||null
        }))
      : [];
    const error = new Error(
      "Administrator Front Match requested " + administratorRequestedCount +
      " product(s), but zero structurally valid products reached SearchBank. Existing production snapshots are preserved."
    );
    error.code = "ADMIN_FRONT_MATCH_ZERO_RELEASE";
    error.details = {
      requestedCount: administratorRequestedCount,
      queueAuthoritative,
      intakeSummary: intake.summary || {},
      heldSample: held,
      administratorStructuralHold: administratorStructuralHold.slice(0, 100)
    };
    throw error;
  }
  if (releaseItems.length === 0 && !queueAuthoritative) {
    preserveOrFail("no-release-ready-candidates", {
      commerceRegistrySync,
      candidateCount: upstream.candidateCount,
      intakeSummary: intake.summary || null
    });
    return;
  }

  if (administratorRequestedCount > 0 && queueAuthoritative) {
    const requestedIds = new Set(
      (Array.isArray(upstream && upstream.doc && upstream.doc.items) ? upstream.doc.items : [])
        .filter(entry => {
          const request = entry && entry.publicationRequest || {};
          const assignment = entry && entry.assignment || {};
          const status = String(request.status || assignment.publicationStatus || "").toLowerCase();
          return request.requested === true || status === "publish_requested" || ["matched","published"].includes(status);
        })
        .map(entry => String(entry && entry.candidate && entry.candidate.id || entry && entry.candidateId || "").trim())
        .filter(Boolean)
    );
    const releasedIds = new Set(
      releaseItems.map(item => String(
        item && item.commerceCandidate && item.commerceCandidate.candidateId ||
        item && item.id || ""
      ).trim()).filter(Boolean)
    );
    const missingReleaseIds = Array.from(requestedIds).filter(id => !releasedIds.has(id));
    if (missingReleaseIds.length) {
      const error = new Error(
        "Administrator Front Match lost " + missingReleaseIds.length +
        " requested product(s) between the final board and SearchBank: " +
        missingReleaseIds.slice(0, 30).join(", ")
      );
      error.code = "ADMIN_FRONT_MATCH_IDENTITY_LOSS";
      error.details = {
        requested: requestedIds.size,
        released: releasedIds.size,
        missingCandidateIds: missingReleaseIds.slice(0, 200),
        intakeSummary: intake.summary || {}
      };
      throw error;
    }

    // V7 global contract: the administrator's exact publication record must
    // survive candidate -> assignment -> registry -> SearchBank without field
    // loss or section drift.  This is intentionally country/supplier agnostic.
    // If even one requested row changes page/section/title/product URL/image,
    // stop before Snapshot generation so a partial or misrouted global release
    // can never look successful.
    const requestedEntries = (Array.isArray(upstream && upstream.doc && upstream.doc.items) ? upstream.doc.items : [])
      .filter(entry => requestedIds.has(String(entry && entry.candidate && entry.candidate.id || entry && entry.candidateId || "").trim()));
    const releasedById = new Map(releaseItems.map(item => {
      const id = String(item && item.commerceCandidate && item.commerceCandidate.candidateId || item && item.id || "").trim();
      return [id, item];
    }).filter(pair => pair[0]));
    const cleanUrl = value => {
      try { const u = new URL(String(value || "").trim()); u.hash = ""; return u.toString(); }
      catch (_e) { return String(value || "").trim(); }
    };
    const cleanText = value => String(value == null ? "" : value).trim();
    const recordDrift = [];
    for (const entry of requestedEntries) {
      const candidate = entry && entry.candidate || {};
      const request = entry && entry.publicationRequest || {};
      const id = cleanText(candidate.id || entry && entry.candidateId);
      const released = releasedById.get(id);
      if (!released) continue;
      const auth = released.administratorFrontMatchAuthority || {};
      const actual = {
        page: cleanText(auth.page || released.page || released.channel),
        section: cleanText(auth.section || released.section || released.psom_key),
        country: cleanText(auth.country || released.targetCountry || released.country).toUpperCase(),
        region: cleanText(auth.region || released.region || "NATIONWIDE").toUpperCase() || "NATIONWIDE",
        title: cleanText(released.title || released.name),
        productUrl: cleanUrl(released.productUrl || released.externalProductUrl || released.url || released.href || released.link),
        imageUrl: cleanUrl(released.imageUrl || released.image || released.thumbnail || released.thumb)
      };
      const expected = {
        page: cleanText(request.page || candidate.page || candidate.channel),
        section: cleanText(request.section || candidate.section || candidate.psom_key),
        country: cleanText(request.country || candidate.country || candidate.targetCountry).toUpperCase(),
        region: cleanText(request.region || candidate.region || "NATIONWIDE").toUpperCase() || "NATIONWIDE",
        title: cleanText(candidate.title || candidate.name),
        productUrl: cleanUrl(candidate.productUrl || candidate.externalProductUrl || candidate.url || candidate.href || candidate.link),
        imageUrl: cleanUrl(candidate.imageUrl || candidate.image || candidate.thumbnail || candidate.thumb)
      };
      const fields = Object.keys(expected).filter(key => expected[key] !== actual[key]);
      if (fields.length) recordDrift.push({ candidateId:id, fields, expected, actual });
    }
    if (recordDrift.length) {
      const error = new Error(
        "Administrator Front Match record drift detected before SearchBank for " + recordDrift.length + " product(s)."
      );
      error.code = "ADMIN_FRONT_MATCH_RECORD_DRIFT";
      error.details = { count:recordDrift.length, sample:recordDrift.slice(0,50) };
      throw error;
    }
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
  if (Number(publication.counts.accepted || 0) <= 0 && administratorRequestedCount > 0 && !queueAuthoritative) {
    throw new Error("Canonical Snapshot Publisher rejected every administrator-requested product without an authoritative administrator queue.");
  }
  if (Number(publication.counts.accepted || 0) <= 0 && !queueAuthoritative) {
    throw new Error("Canonical Snapshot Publisher produced no accepted candidates without an authoritative administrator withdrawal state.");
  }

  const published = canonical.verifyPublished({ root });
  if (!published.ok) {
    throw new Error("Canonical Snapshot Publisher integrity failure: " + JSON.stringify(published.problems));
  }

  // Domain ownership boundary:
  // - data/search-bank.snapshot.json is Canonical Commerce/Distribution ONLY.
  // - Social main nine uses data/social-searchbank.release.snapshot.json.
  // Social must never be appended to Canonical after publication because that
  // invalidates Canonical manifest hashes and makes the IP publisher reject the
  // entire Distribution path.
  let socialRefresh = explicitSocialPublication;
  if (!explicitSocialPublicationInBuild) {
    // A fresh Netlify filesystem does not inherit the previous deploy output.
    // Safely rehydrate the latest stored Social release into the isolated bank;
    // this cannot mutate Canonical Commerce/Distribution state.
    socialRefresh = await publishSocialSafely({
      allowLatestStored: true,
      materializeSnapshot: false
    });
  }

  // Materialize only Distribution-owned surfaces from the Canonical bank.
  // Media is intentionally untouched. Social main nine is materialized from its
  // dedicated bank below; Social rightPanel is owned by the IP/Distribution path.
  const distributionSnapshotReports = [];
  for (const targetPage of ["home", "network", "distribution", "tour"]) {
    const report = snapshots.run({ targetPage, canonicalReleaseId: publication.releaseId });
    if (!report || report.ok !== true) {
      const error = new Error("Snapshot Engine failed for Distribution-owned target: " + targetPage);
      error.code = "DISTRIBUTION_SNAPSHOT_TARGET_FAILED";
      error.targetPage = targetPage;
      throw error;
    }
    distributionSnapshotReports.push(report);
  }

  let socialSnapshotReport = null;
  const socialStatus = String(socialRefresh && socialRefresh.status || "").toLowerCase();
  if (socialStatus === "searchbank_handoff_complete") {
    const socialBank = loadDedicatedSocialBank();
    if (!socialBank.ok) {
      if (explicitSocialPublicationInBuild) {
        const error = new Error("Explicit Social release completed but its dedicated bank cannot be read.");
        error.code = "SOCIAL_DEDICATED_BANK_UNAVAILABLE";
        error.details = socialBank.errors;
        throw error;
      }
    } else {
      socialSnapshotReport = snapshots.run({ targetPage: "social", bank: socialBank.bank });
      if (!socialSnapshotReport || socialSnapshotReport.ok !== true) {
        if (explicitSocialPublicationInBuild) {
          const error = new Error("Explicit Social Snapshot materialization failed.");
          error.code = "SOCIAL_SNAPSHOT_MATERIALIZATION_FAILED";
          throw error;
        }
        socialSnapshotReport = {
          ok: false,
          degraded: true,
          reason: "stored-social-materialization-failed-preserve-static-social"
        };
      }
    }
  }

  const snapshotEngineReport = {
    ok: distributionSnapshotReports.every(row => row && row.ok === true),
    mode: "domain-isolated-targeted-materialization",
    canonicalCommerceTargets: distributionSnapshotReports,
    socialTarget: socialSnapshotReport,
    media: "untouched",
    donation: "untouched"
  };

  const regionalReport = regional.publishFromSearchBank({ root, trigger: "netlify-build-canonical" });

  // Capture IP/root templates only AFTER Snapshot Engine has materialized the
  // current Social main nine sections. The Social IP document is partial: its
  // rightPanel is Distribution-owned, but its nine main sections must come from
  // the just-published Social snapshot. Reusing the pre-Snapshot template would
  // silently roll Social back when the IP publisher writes the root fallback.
  const publishFallback = ipSlots.captureSampleFallbackTemplates({ root });
  if (!publishFallback.ok) {
    const error = new Error("Post-Snapshot IP fallback capture failed: " + JSON.stringify(publishFallback.problems || []));
    error.code = "POST_SNAPSHOT_IP_FALLBACK_CAPTURE_FAILED";
    throw error;
  }
  const ipSlotReport = ipSlots.publish({ root, trigger: "netlify-build-canonical-ip-slots", fallbackTemplates: publishFallback.templates });
  const ipSlotErrors = Array.isArray(ipSlotReport && ipSlotReport.errors) ? ipSlotReport.errors.map(String) : [];
  const scopedOutputs = Array.isArray(ipSlotReport && ipSlotReport.scopedOutputs) ? ipSlotReport.scopedOutputs : [];
  const onlyScopedRenderFailures = ipSlotErrors.length > 0 && ipSlotErrors.every((problem) => problem.startsWith("IP_SLOT_RENDER_FAILED:"));
  const partialIpPublication = ipSlotReport.status !== "published" && onlyScopedRenderFailures && scopedOutputs.length > 0;
  if (ipSlotReport.status !== "published" && !partialIpPublication) {
    // Core policy/source/manifest failures remain hard-stop conditions. A single
    // country/region render failure must not take every other market offline.
    throw new Error("Canonical IP Slot Publisher blocked build: " + JSON.stringify(ipSlotErrors.length ? compactProblems(ipSlotErrors, 20) : { status: ipSlotReport && ipSlotReport.status, errors: compactProblems(ipSlotErrors, 20) }));
  }
  if (partialIpPublication) {
    ipSlotReport.degraded = true;
    ipSlotReport.degradedReason = "partial-country-region-render-failure";
    ipSlotReport.degradedErrors = ipSlotErrors.slice();
  }
  const ipSlotVerification = ipSlots.verifyPublished({ root });
  if (!ipSlotVerification.ok) {
    // Hash/policy/manifest integrity failures affect published output itself and
    // are therefore still global safety failures, not country-level soft fails.
    throw new Error("Canonical IP Slot Publisher integrity failure: " + JSON.stringify(compactProblems(ipSlotVerification.problems, 20)));
  }
  const rootFallbackVerification = verifyPublishedRootSampleFallbacks(ipSlotReport);
  if (!rootFallbackVerification.ok) {
    throw new Error("Canonical IP root sample-fallback integrity failure: " + JSON.stringify(rootFallbackVerification.problems));
  }
  const canonicalToIpVerification = verifyCanonicalToIpOutputs(ipSlotReport);
  if (!canonicalToIpVerification.ok) {
    // Canonical -> scoped front is one publication transaction. Never deploy a
    // release in which a candidate, exact destination or image silently vanished.
    // A failed build preserves the previous known-good deploy instead of exposing
    // a partially materialized worldwide catalog.
    throw new Error("Canonical SearchBank identity did not reach every country/IP front snapshot: " + JSON.stringify(compactProblems(canonicalToIpVerification.problems, 40)));
  }

  process.stdout.write(JSON.stringify({
    commerceRegistrySync,
    incomingCommerceIntent,
    incomingCommerceSelection: compactCommerceSelection(incomingCommerceSelection),
    upstream: { candidateCount: upstream.candidateCount, sourceMode: upstream.sourceMode || null, warning: upstream.warning || null, queueAuthoritative, mirrors: upstream.mirrors },
    intake: { releaseGate: intake.releaseGate, summary: intake.summary, releaseItemCount: releaseItems.length },
    publicationInput: { source: publicationBank.source, itemCount: publicationBank.items.length },
    publication,
    published,
    socialIsolation: {
      incomingSocialIntent,
      explicitPublication: compactSocialReport(explicitSocialPublication),
      canonicalCommerceSearchBankMutation: false,
      dedicatedBank: "data/social-searchbank.release.snapshot.json",
      refresh: compactSocialReport(socialRefresh),
      socialSnapshot: socialSnapshotReport,
      rightPanelOwnedBy: "distribution"
    },
    donation: { mode: "independent-runtime-contract-not-touched" },
    snapshotEngine: snapshotEngineReport,
    canonicalToIpVerification,
    regional: compactRegionalReport(regionalReport),
    ipSlots: compactIpSlotReport(ipSlotReport),
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
    if (rollbackError || mustMaterializeDistribution) throw error;
  } finally {
    removeCommerceCheckpoint(commerceCheckpoint);
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
