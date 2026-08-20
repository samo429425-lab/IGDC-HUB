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
  // Social writes into the ordinary shared SearchBank. Keep all three mirrors
  // transactional so a failed Social handoff can never leave Distribution or
  // another front domain half-overwritten.
  path.join("data", "search-bank.snapshot.json"),
  path.join("netlify", "functions", "data", "search-bank.snapshot.json"),
  path.join("netlify", "functions", "search-bank.snapshot.json"),
  path.join("data", "social.snapshot.json"),
  path.join("data", "social-searchbank.release.snapshot.json"),
  path.join("data", "social-pipeline.report.json"),
  path.join("netlify", "functions", "data", "social.snapshot.json"),
  path.join("netlify", "functions", "social.snapshot.json")
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
      const report = snapshots.run({ targetPage: "social" });
      if (!report || report.ok !== true) {
        const error = new Error("Social target Snapshot Engine materialization failed.");
        error.code = "SOCIAL_SNAPSHOT_MATERIALIZATION_FAILED";
        throw error;
      }
      result = Object.assign({}, result, {
        snapshotEngine: report,
        downstream: "social-target-materialized"
      });
    }
    return result;
  } catch (error) {
    let restored = [];
    let rollbackError = null;
    try { restored = restoreSocialCheckpoint(checkpoint); }
    catch (restoreError) { rollbackError = String(restoreError && restoreError.message || restoreError); }
    if (rollbackError) {
      const safetyError = new Error("Social publication failed and rollback could not restore the shared SearchBank state: " + rollbackError);
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

const SOCIAL_OWNED_SECTIONS = new Set([
  "social-youtube", "social-instagram", "social-tiktok", "social-facebook",
  "social-wechat", "social-weibo", "social-pinterest", "social-reddit", "social-twitter"
]);

function searchBankMirrorPaths() {
  return [
    path.join(root, "data", "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "search-bank.snapshot.json")
  ];
}

function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }

function captureSocialSearchBankBase() {
  for (const file of searchBankMirrorPaths()) {
    if (!fileExists(file)) continue;
    try {
      const doc = readJson(file);
      if (doc && Array.isArray(doc.items)) return { file, doc: cloneJson(doc) };
    } catch (_error) {}
  }
  return { file: null, doc: { items: [], meta: {} } };
}

function socialOwnedSearchBankItem(item) {
  if (!item || typeof item !== "object") return false;
  const bind = item.bind && typeof item.bind === "object" ? item.bind : {};
  const section = String(item.psom_key || item.section || bind.section || "").trim();
  const page = String(item.page || item.channel || bind.page || "").trim().toLowerCase();
  // rightPanel is deliberately excluded: it is Distribution-owned even though
  // it is displayed on the Social page.
  return page === "social" && SOCIAL_OWNED_SECTIONS.has(section);
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temp, file);
}

function stableItemIdentity(item) {
  const id = String(item && (item.id || item.contentId || item.candidateId || item.snapshotRecordId) || "").trim();
  const url = String(item && (item.url || item.link || item.href) || "").trim().toLowerCase();
  return { id, url };
}

function restoreSocialDomainIntoCanonical(baseCapture) {
  const primary = path.join(root, "data", "search-bank.snapshot.json");
  if (!fileExists(primary)) return { ok: false, reason: "canonical_searchbank_missing" };
  const canonicalDoc = readJson(primary);
  if (!canonicalDoc || !Array.isArray(canonicalDoc.items)) return { ok: false, reason: "canonical_searchbank_invalid" };
  const previous = baseCapture && baseCapture.doc && Array.isArray(baseCapture.doc.items) ? baseCapture.doc.items : [];
  const socialItems = previous.filter(socialOwnedSearchBankItem);
  if (!socialItems.length) return { ok: true, preserved: 0, skippedCollisions: 0, total: canonicalDoc.items.length };

  // Distribution/Commerce is authoritative on this branch. Re-attaching the
  // previously committed Social nine-section rows must never run a broad merge
  // or sanitizer over Canonical products. Preserve Canonical rows exactly; add
  // only Social rows whose identity cannot collide with a Canonical row.
  const ids = new Set();
  const urls = new Set();
  for (const item of canonicalDoc.items) {
    const key = stableItemIdentity(item);
    if (key.id) ids.add(key.id);
    if (key.url && key.url !== "#") urls.add(key.url);
  }
  const safeSocialItems = [];
  const collisions = [];
  for (const item of socialItems) {
    const key = stableItemIdentity(item);
    if ((key.id && ids.has(key.id)) || (key.url && key.url !== "#" && urls.has(key.url))) {
      collisions.push({ id: key.id || null, url: key.url || null });
      continue;
    }
    safeSocialItems.push(item);
    if (key.id) ids.add(key.id);
    if (key.url && key.url !== "#") urls.add(key.url);
  }
  const canonicalHashBefore = sha256(canonicalDoc.items);
  const mergedItems = canonicalDoc.items.concat(safeSocialItems);
  const canonicalPrefixHashAfter = sha256(mergedItems.slice(0, canonicalDoc.items.length));
  if (canonicalPrefixHashAfter !== canonicalHashBefore) {
    throw new Error("Distribution Canonical invariant failed while preserving Social rows.");
  }
  const merged = Object.assign({}, canonicalDoc, {
    items: mergedItems,
    meta: Object.assign({}, canonicalDoc.meta || {}, {
      socialDomainPreservation: {
        mode: "append-social-nine-only-canonical-immutable",
        preserved: safeSocialItems.length,
        skippedCollisions: collisions.length,
        rightPanelOwnedBy: "distribution",
        canonicalHash: canonicalHashBefore,
        preservedAt: new Date().toISOString()
      }
    })
  });
  for (const file of searchBankMirrorPaths()) atomicWriteJson(file, merged);
  return { ok: true, preserved: safeSocialItems.length, skippedCollisions: collisions.length, collisions: collisions.slice(0, 25), canonicalHash: canonicalHashBefore, total: mergedItems.length };
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
function validateExplicitCommerceSelection(upstream, intent) {
  const selectedIds = Array.from(new Set((Array.isArray(intent && intent.candidateIds) ? intent.candidateIds : []).map(value => String(value || "").trim()).filter(Boolean))).slice(0,1800);
  const applicable = !!(
    upstream && upstream.queueAuthoritative === true &&
    intent && intent.explicit === true && intent.operation === "publish" &&
    selectedIds.length
  );
  const authoritativeItems = Array.isArray(upstream && upstream.doc && upstream.doc.items) ? upstream.doc.items : [];
  if (!applicable) {
    return { applied:false, selectedCandidateIds:selectedIds, selectedCount:selectedIds.length, authoritativeCount:authoritativeItems.length, fullQueuePreserved:true, missingCandidateIds:[] };
  }
  const authoritativeIds = new Set(authoritativeItems.map(entry => {
    const candidate = entry && entry.candidate || {};
    return String(candidate.id || entry && entry.candidateId || "").trim();
  }).filter(Boolean));
  const missingCandidateIds = selectedIds.filter(id => !authoritativeIds.has(id));
  if (missingCandidateIds.length) {
    const error = new Error("Explicit administrator Front Match candidates are missing from the authoritative publication queue: " + missingCandidateIds.join(","));
    error.code = "FRONT_MATCH_SELECTION_NOT_IN_AUTHORITATIVE_QUEUE";
    error.missingCandidateIds = missingCandidateIds;
    throw error;
  }
  return {
    applied:true,
    selectedCandidateIds:selectedIds,
    selectedCount:selectedIds.length,
    authoritativeCount:authoritativeItems.length,
    fullQueuePreserved:true,
    missingCandidateIds:[]
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
      const requestedItems = Array.isArray(queueDoc && queueDoc.items)
        ? queueDoc.items.filter(item => item && item.publicationRequest && item.publicationRequest.requested === true)
        : [];
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
  const incomingCommerceIntent = incomingCommerceHookIntent();
  const incomingSocialIntent = incomingSocialHookIntent();
  const explicitAdminPublicationInBuild = incomingCommerceIntent.explicit === true && incomingCommerceIntent.operation === "publish";
  const explicitSocialPublicationInBuild = incomingSocialIntent.explicit === true;

  // An explicit Social release is a Social-only transaction. It may update only
  // the nine Social main sections inside the shared SearchBank and then only
  // materialize the Social target. Commerce/Distribution publishers are not
  // entered at all on this branch.
  if (explicitSocialPublicationInBuild) {
    // Defensive compatibility for already-queued/older Social build hooks:
    // a normal publish with an empty manifest is not an unpublish. Preserve the
    // committed site and finish the build without touching SearchBank. New
    // publisher code blocks this before the hook is queued, but this guard also
    // protects deployments already waiting in Netlify's queue.
    if (incomingSocialIntent.publicationPlanPresent === true && incomingSocialIntent.operation !== "unpublish" && Number(incomingSocialIntent.actualPublicationPlanCount || 0) === 0) {
      process.stdout.write(JSON.stringify({
        incomingSocialIntent,
        socialPublication: {
          status: "preserved",
          isolated: true,
          reason: "empty_social_publish_plan_rejected_before_write",
          searchBank: "unchanged",
          snapshotEngine: "not-run",
          note: "Zero-row publish is a safe no-op; only explicit unpublish may carry an empty plan."
        }
      }, null, 2) + "\n");
      return;
    }
    const socialPublication = await publishSocialSafely({
      allowLatestStored: false,
      materializeSnapshot: true
    });
    process.stdout.write(JSON.stringify({ incomingSocialIntent, socialPublication }, null, 2) + "\n");
    if (String(socialPublication && socialPublication.status || "").toLowerCase() !== "searchbank_handoff_complete") {
      const error = new Error("Explicit Social publication did not complete its SearchBank handoff: " + JSON.stringify(socialPublication));
      error.code = "EXPLICIT_SOCIAL_SEARCHBANK_HANDOFF_FAILED";
      throw error;
    }
    return;
  }

  // Capture only Social-owned SearchBank rows before the proven Distribution
  // build runs. If Commerce rewrites its canonical bank, these rows are merged
  // back before the shared Snapshot Engine. rightPanel is never captured here.
  const preCommerceSocialBase = captureSocialSearchBankBase();
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
    writePreservedBuild(upstream.reason, { commerceRegistrySync, mirrors: upstream.mirrors, incomingCommerceIntent });
    return;
  }
  const queueAuthoritative = upstream.queueAuthoritative === true;
  // candidateIds from the clicked button identify the delta that was just
  // changed. They must never truncate the authoritative queue: Canonical writes
  // a complete public document, so filtering here turns a one-section match
  // into an invalid partial replacement. Validate the delta and rebuild from
  // the full durable publication queue instead.
  const incomingCommerceSelection = validateExplicitCommerceSelection(upstream, incomingCommerceIntent);

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
  const administratorRequestedCount = Number(intake && intake.releaseGate && intake.releaseGate.requestedCount || commerceRegistrySync && commerceRegistrySync.requestedCount || 0);
  if (releaseItems.length === 0 && administratorRequestedCount > 0) {
    const held = Array.isArray(intake && intake.stage && intake.stage.candidates) ? intake.stage.candidates.filter(row => row && row.releaseEligible !== true).slice(0,25).map(row => ({candidateId:row.candidateId,reasons:row.reasons,administratorFrontMatch:row.administratorFrontMatch||null})) : [];
    throw new Error("Administrator publication queue contained " + administratorRequestedCount + " requested products, but Commerce Candidate Intake released none: " + JSON.stringify({summary:intake.summary||{},heldSample:held}));
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

  // Preserve only the previously committed Social nine-section rows before the
  // shared Snapshot Engine runs. A Distribution/Commerce build NEVER replays a
  // stored Social release. Social publication is allowed only on the explicit
  // Social-only hook branch above, so one domain cannot silently rewrite the
  // other during an unrelated deploy.
  const socialPreservation = restoreSocialDomainIntoCanonical(preCommerceSocialBase);
  const socialRefresh = {
    status: "not-run",
    reason: "stored-social-replay-disabled-on-commerce-build",
    allowLatestStored: false
  };

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
    incomingCommerceIntent,
    incomingCommerceSelection,
    upstream: { candidateCount: upstream.candidateCount, sourceMode: upstream.sourceMode || null, warning: upstream.warning || null, queueAuthoritative, mirrors: upstream.mirrors },
    intake: { releaseGate: intake.releaseGate, summary: intake.summary, releaseItemCount: releaseItems.length },
    publicationInput: { source: publicationBank.source, itemCount: publicationBank.items.length },
    publication,
    published,
    socialIsolation: {
      incomingSocialIntent,
      preservation: socialPreservation,
      refresh: socialRefresh,
      rightPanelOwnedBy: "distribution"
    },
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
    if (rollbackError || explicitAdminPublicationInBuild) throw error;
  } finally {
    removeCommerceCheckpoint(commerceCheckpoint);
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
