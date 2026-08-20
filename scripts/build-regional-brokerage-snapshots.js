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
    return { status: "skipped", isolated: true, reason: "social_release_adapter_unavailable", error: String(error && error.message || error) };
  }
  if (!socialRelease || typeof socialRelease.publish !== "function") {
    return { status: "skipped", isolated: true, reason: "social_release_adapter_invalid" };
  }
  try {
    // The Social adapter owns only the handoff into the ordinary SearchBank
    // mirrors.  Snapshot Engine remains the one shared downstream renderer.
    const result = await socialRelease.publish({ root });
    return Object.assign({}, result || {}, { isolated: true });
  } catch (error) {
    return { status: "failed", isolated: true, reason: "social_release_execution_failed", error: String(error && error.message || error) };
  }
}

const SOCIAL_CHECKPOINT_TARGETS = [
  // SearchBank mirrors written by the Social adapter.
  path.join("data", "search-bank.snapshot.json"),
  path.join("netlify", "functions", "data", "search-bank.snapshot.json"),
  path.join("netlify", "functions", "search-bank.snapshot.json"),
  // Social handoff audit/report plus the downstream Social snapshots.  The
  // latter are included because a Social-only build materializes exactly the
  // social target through the existing Snapshot Engine.
  path.join("data", "social-searchbank.release.snapshot.json"),
  path.join("data", "social-pipeline.report.json"),
  path.join("data", "social.snapshot.json"),
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
  if (checkpoint && checkpoint.checkpointRoot) fs.rmSync(checkpoint.checkpointRoot, { recursive: true, force: true });
}

async function publishSocialSafely(options) {
  options = options || {};
  const materializeSnapshot = options.materializeSnapshot === true;
  const socialCheckpoint = createSocialCheckpoint();
  let socialPublication;
  try {
    socialPublication = await publishSocialIndependently();
    const status = String(socialPublication && socialPublication.status || "").toLowerCase();
    if (["blocked", "failed", "skipped"].includes(status)) {
      const restored = restoreSocialCheckpoint(socialCheckpoint);
      socialPublication = Object.assign({}, socialPublication, { rollback: "restored", restored });
    } else if (materializeSnapshot && status === "searchbank_handoff_complete") {
      // A Social-only deploy must not wait for a future Commerce build.  Feed
      // the just-updated ordinary SearchBank through the existing Snapshot
      // Engine, but restrict execution to the Social page. Distribution and
      // its IP snapshots are therefore not rebuilt or overwritten here.
      const socialSnapshotReport = snapshots.run({ targetPage: "social" });
      if (!socialSnapshotReport || socialSnapshotReport.ok !== true) {
        const error = new Error("Social-only Snapshot Engine materialization failed.");
        error.code = "SOCIAL_SNAPSHOT_MATERIALIZATION_FAILED";
        throw error;
      }
      socialPublication = Object.assign({}, socialPublication, { snapshotEngine: socialSnapshotReport, downstream: "social-target-materialized" });
    }
  } catch (error) {
    let restored = [], rollbackError = null;
    try { restored = restoreSocialCheckpoint(socialCheckpoint); }
    catch (restoreError) { rollbackError = String(restoreError && restoreError.message || restoreError); }
    socialPublication = {
      status: "failed", isolated: true, reason: error && error.code || "social_publication_execution_failed",
      error: String(error && error.message || error), rollback: rollbackError ? "failed" : "restored", restored, rollbackError
    };
    if (rollbackError) {
      const safetyError = new Error("Social publication failed and rollback could not restore the prior SearchBank/Snapshot state: " + rollbackError);
      safetyError.code = "SOCIAL_PUBLICATION_ROLLBACK_FAILED";
      throw safetyError;
    }
  } finally {
    removeSocialCheckpoint(socialCheckpoint);
  }
  process.stdout.write(JSON.stringify({ socialPublication }, null, 2) + "\n");
  if (["blocked", "failed", "skipped"].includes(String(socialPublication && socialPublication.status || "").toLowerCase())) {
    process.stderr.write("Social publication was isolated and prior SearchBank/Snapshot state was preserved: " + JSON.stringify(socialPublication) + "\n");
  }
  return socialPublication;
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
  const explicitAdminPublicationInBuild = incomingCommerceIntent.explicit === true && incomingCommerceIntent.operation === "publish";
  let socialSearchBankHandoffRan = false;

  // Commerce owns the canonical first write. Social is merged only AFTER that
  // canonical write and BEFORE the one shared Snapshot Engine pass. This order
  // prevents either domain from erasing the other's SearchBank rows.
  try {
    const commerceCheckpoint = createCommerceCheckpoint();
    try {
      const commerceRegistrySync = await commerceRegistry.syncApprovedCandidates({ root });
      const upstream = loadConfirmedUpstream(commerceRegistrySync);
      if (!upstream.ok) {
        if (incomingCommerceIntent.explicit === true && incomingCommerceIntent.operation === "publish") {
          throw new Error("Explicit administrator Front Match reached the Netlify build, but the authoritative Global Slot publication queue could not be loaded: " + upstream.reason + " | " + JSON.stringify({ commerceRegistrySync, incomingCommerceIntent }));
        }
        writePreservedBuild(upstream.reason, { commerceRegistrySync, mirrors: upstream.mirrors, incomingCommerceIntent });
        return;
      }

      const queueAuthoritative = upstream.queueAuthoritative === true;
      const incomingCommerceSelection = validateExplicitCommerceSelection(upstream, incomingCommerceIntent);

      const sampleFallback = ipSlots.captureSampleFallbackTemplates({ root });
      if (!sampleFallback.ok) {
        writePreservedBuild("sample-fallback-template-capture-failed", { commerceRegistrySync, problems: sampleFallback.problems || [] });
        return;
      }

      let intake;
      try {
        intake = commerceIntake.build({
          root,
          // The durable Global Slot review queue is already normalized. Do not
          // feed its envelopes through raw SearchBank intake a second time.
          items: queueAuthoritative ? [] : upstream.doc.items,
          trigger: "netlify-build-private-candidate-stage",
          reviewQueueDoc: queueAuthoritative ? upstream.doc : undefined,
          write: true
        });
      } catch (error) {
        writePreservedBuild("candidate-intake-preflight-failed", { commerceRegistrySync, candidateCount: upstream.candidateCount, error: String(error && error.message || error) });
        return;
      }

      if (!intake.ok) {
        writePreservedBuild("candidate-intake-not-ready", { commerceRegistrySync, candidateCount: upstream.candidateCount, problems: intake.problems || [] });
        return;
      }
      if (!intake.releaseGate || intake.releaseGate.enabled !== true) {
        writePreservedBuild("candidate-release-not-authorized", { commerceRegistrySync, candidateCount: upstream.candidateCount, releaseGate: intake.releaseGate || null });
        return;
      }

      const releaseItems = Array.isArray(intake.releaseItems) ? intake.releaseItems : [];
      const administratorRequestedCount = Number(intake && intake.releaseGate && intake.releaseGate.requestedCount || commerceRegistrySync && commerceRegistrySync.requestedCount || 0);
      if (releaseItems.length === 0 && administratorRequestedCount > 0) {
        const held = Array.isArray(intake && intake.stage && intake.stage.candidates)
          ? intake.stage.candidates.filter(row => row && row.releaseEligible !== true).slice(0, 25).map(row => ({ candidateId: row.candidateId, reasons: row.reasons, administratorFrontMatch: row.administratorFrontMatch || null }))
          : [];
        throw new Error("Administrator publication queue contained " + administratorRequestedCount + " requested products, but Commerce Candidate Intake released none: " + JSON.stringify({ summary: intake.summary || {}, heldSample: held }));
      }
      if (releaseItems.length === 0 && !queueAuthoritative) {
        writePreservedBuild("no-release-ready-candidates", { commerceRegistrySync, candidateCount: upstream.candidateCount, intakeSummary: intake.summary || null });
        return;
      }

      const publicationBank = Object.assign({}, upstream.doc, {
        schema: "search-bank.release-input.v1",
        generatedAt: new Date().toISOString(),
        source: "commerce-candidate-intake-release",
        items: releaseItems
      });
      const publication = canonical.publish({ root, trigger: "netlify-build-country-region-admin-publication", bank: publicationBank, requireMirrorConsensus: false });
      if (publication.status !== "published") throw new Error("Canonical Snapshot Publisher blocked build: " + JSON.stringify(publication.errors || publication));
      if (!publication.counts) throw new Error("Canonical Snapshot Publisher did not return candidate counts.");
      if (Number(publication.counts.accepted || 0) <= 0 && administratorRequestedCount > 0) {
        throw new Error("Canonical Snapshot Publisher rejected every administrator-requested product. Inspect data/canonical-snapshot/audit/latest.json before publishing sample-only output.");
      }
      if (Number(publication.counts.accepted || 0) <= 0 && !queueAuthoritative) {
        throw new Error("Canonical Snapshot Publisher produced no accepted candidates without an authoritative administrator withdrawal state.");
      }

      const published = canonical.verifyPublished({ root });
      if (!published.ok) throw new Error("Canonical Snapshot Publisher integrity failure: " + JSON.stringify(published.problems));

      // FINAL SearchBank composition order:
      //   Commerce Canonical -> Social main-9 merge -> Snapshot Engine once.
      const socialPublication = await publishSocialSafely({ materializeSnapshot: false });
      socialSearchBankHandoffRan = true;

      const snapshotEngineReport = snapshots.run({ canonicalReleaseId: publication.releaseId });
      if (!snapshotEngineReport || snapshotEngineReport.ok !== true) {
        throw new Error("Snapshot Engine did not complete the SearchBank-to-front merge layer.");
      }

      const regionalReport = regional.publishFromSearchBank({ root, trigger: "netlify-build-canonical" });
      const ipSlotReport = ipSlots.publish({ root, trigger: "netlify-build-canonical-ip-slots", fallbackTemplates: sampleFallback.templates });
      if (ipSlotReport.status !== "published") throw new Error("Canonical IP Slot Publisher blocked build: " + JSON.stringify(ipSlotReport.errors || ipSlotReport));
      const ipSlotVerification = ipSlots.verifyPublished({ root });
      if (!ipSlotVerification.ok) throw new Error("Canonical IP Slot Publisher integrity failure: " + JSON.stringify(ipSlotVerification.problems));
      const rootFallbackVerification = verifyPublishedRootSampleFallbacks(ipSlotReport);
      if (!rootFallbackVerification.ok) throw new Error("Canonical IP root sample-fallback integrity failure: " + JSON.stringify(rootFallbackVerification.problems));
      const canonicalToIpVerification = verifyCanonicalToIpOutputs(ipSlotReport);
      if (!canonicalToIpVerification.ok) throw new Error("Canonical SearchBank products did not reach their country/IP front snapshots: " + JSON.stringify(canonicalToIpVerification.problems));

      process.stdout.write(JSON.stringify({
        commerceRegistrySync,
        incomingCommerceIntent,
        incomingCommerceSelection,
        upstream: { candidateCount: upstream.candidateCount, sourceMode: upstream.sourceMode || null, warning: upstream.warning || null, queueAuthoritative, mirrors: upstream.mirrors },
        intake: { releaseGate: intake.releaseGate, summary: intake.summary, releaseItemCount: releaseItems.length },
        publicationInput: { source: publicationBank.source, itemCount: publicationBank.items.length },
        publication,
        published,
        social: socialPublication,
        donation: { mode: "independent-runtime-contract-not-touched" },
        snapshotEngine: snapshotEngineReport,
        canonicalToIpVerification,
        regional: regionalReport,
        ipSlots: ipSlotReport,
        ipSlotVerification,
        rootFallbackVerification
      }, null, 2) + "\n");
    } catch (error) {
      let restored = [], rollbackError = null;
      try {
        restored = restoreCommerceCheckpoint(commerceCheckpoint);
        // A full commerce rollback also removes a Social merge made inside the
        // same transaction. Re-run Social independently in the outer finalizer.
        socialSearchBankHandoffRan = false;
      } catch (restoreError) {
        rollbackError = String(restoreError && restoreError.message || restoreError);
      }
      process.stderr.write("Commerce release did not publish; prior Commerce state was restored: " + JSON.stringify({
        status: "failed", isolated: true, reason: "commerce_release_execution_failed",
        error: String(error && error.message || error), rollback: rollbackError ? "failed" : "restored", restored, rollbackError
      }) + "\n");
      if (rollbackError || explicitAdminPublicationInBuild) throw error;
    } finally {
      removeCommerceCheckpoint(commerceCheckpoint);
    }
  } finally {
    // If Commerce had nothing to publish (or a non-explicit commerce build was
    // rolled back), Social still completes its own orthodox downstream path:
    // Social -> ordinary SearchBank -> existing Snapshot Engine (social only).
    if (!socialSearchBankHandoffRan) {
      await publishSocialSafely({ materializeSnapshot: true });
      socialSearchBankHandoffRan = true;
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
