"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SlotStore = require("./global-slot-console-supabase");

const VERSION = "commerce-product-ledger-migration-v1.0.0";
const PRODUCT_JOB_SCHEMA = "igdc-country-product-reference-research-job.v1";
const ACTIVE_ID = "igdc_product_research_job_kr_nationwide";
const RECOVERY_FILE = "commerce-product-job-recovery.kr-nationwide.20260801.json";
const RECOVERY_SHA256 = "f413542aeaa028b4831de3c3a1d451a8a141394fff441e780c39c56b7c4fdb06";
const BASELINE = Object.freeze({ products: 314, undecided: 167, slotCandidate: 125, hold: 22 });

function text(value) { return value == null ? "" : String(value).trim(); }
function plain(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function iso() { return new Date().toISOString(); }
function safePart(value) { return text(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"; }
function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }

function normalizedScope(input) {
  const raw = plain(input);
  return {
    country: text(raw.country || raw.countryCode).toUpperCase(),
    region: text(raw.region || raw.subdivisionCode || raw.regionCode || "NATIONWIDE").toUpperCase() || "NATIONWIDE"
  };
}

function decisionCounts(products) {
  const result = { products: array(products).length, undecided: 0, slotCandidate: 0, hold: 0 };
  for (const product of array(products)) {
    const decision = text(product && product.slotDecision).toLowerCase();
    if (decision === "slot_candidate") result.slotCandidate += 1;
    else if (decision === "hold") result.hold += 1;
    else if (!decision || decision === "undecided") result.undecided += 1;
  }
  return result;
}

function isVerifiedBaseline(products) {
  const counts = decisionCounts(products);
  return counts.products === BASELINE.products &&
    counts.undecided === BASELINE.undecided &&
    counts.slotCandidate === BASELINE.slotCandidate &&
    counts.hold === BASELINE.hold;
}

function isHealthyActiveLedger(rule) {
  const current = plain(rule);
  return current.schema === PRODUCT_JOB_SCHEMA && current.status === "complete" && array(current.products).length >= BASELINE.products;
}

function loadRecoverySnapshot() {
  const filePath = path.join(__dirname, RECOVERY_FILE);
  const bytes = fs.readFileSync(filePath);
  const digest = sha256(bytes);
  if (digest !== RECOVERY_SHA256) {
    const error = new Error("검증된 KR 상품 원장 파일의 무결성 값이 일치하지 않습니다. 활성 원장은 변경하지 않았습니다.");
    error.statusCode = 500;
    throw error;
  }
  const snapshot = JSON.parse(bytes.toString("utf8"));
  const scope = normalizedScope(snapshot.scope);
  if (snapshot.reportType !== "igdc-country-product-reference-persisted-research" || snapshot.status !== "complete" || scope.country !== "KR" || scope.region !== "NATIONWIDE" || !isVerifiedBaseline(snapshot.products)) {
    const error = new Error("검증된 KR 상품 원장 기준(314/167/125/22)을 확인하지 못했습니다. 활성 원장은 변경하지 않았습니다.");
    error.statusCode = 500;
    throw error;
  }
  return snapshot;
}

function supplierSources(products) {
  const seen = new Set(), result = [];
  for (const product of array(products)) {
    const supplierSiteUrl = text(product && product.supplierSiteUrl);
    const key = supplierSiteUrl.toLowerCase() || text(product && product.supplierId).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      supplierId: text(product && product.supplierId),
      supplierName: text(product && product.supplierName),
      supplierSiteUrl,
      trustScore: Number(product && product.supplierTrustScore || 0),
      approvalReady: product && product.supplierApprovalReady === true,
      evidenceReady: product && product.supplierEvidenceReady === true
    });
  }
  return result;
}

function buildMigratedJob(snapshot, runtimeVersion, actorId) {
  const now = iso(), products = array(snapshot.products);
  const suppliers = supplierSources(products);
  const stageSummary = plain(snapshot.pipeline && snapshot.pipeline.stageSummary);
  const stagedProducts = products.slice(0, Math.max(0, Math.min(products.length, Number(stageSummary.eligible || products.length))));
  return {
    schema: PRODUCT_JOB_SCHEMA,
    version: text(runtimeVersion) || text(snapshot.version),
    rankingVersion: text(snapshot.rankingVersion),
    jobId: text(snapshot.jobId),
    status: "complete",
    scope: plain(snapshot.scope),
    startedAt: snapshot.startedAt || now,
    finishedAt: snapshot.finishedAt || now,
    updatedAt: now,
    supplierResearchJobId: null,
    supplierSources: suppliers,
    rankingContext: plain(snapshot.rankingContext),
    discoveryCursor: suppliers.length,
    rawProducts: [],
    inspectionPool: products,
    inspectCursor: products.length,
    products,
    stagePool: stagedProducts,
    stageCursor: stagedProducts.length,
    stageSummary,
    trace: array(snapshot.trace).concat([{
      at: now,
      source: VERSION,
      status: "verified_ledger_migrated",
      reason: "active_ledger_replaced_by_incomplete_zero_or_reduced_result",
      baseline: BASELINE,
      recoverySha256: RECOVERY_SHA256,
      migratedBy: text(actorId) || "system"
    }]).slice(-240),
    errors: array(snapshot.errors),
    lastError: null,
    migration: {
      version: VERSION,
      migratedAt: now,
      migratedBy: text(actorId) || "system",
      recoveryFile: RECOVERY_FILE,
      recoverySha256: RECOVERY_SHA256,
      baseline: BASELINE
    }
  };
}

async function activeRow() {
  const rows = await SlotStore.select("gslot_policies", "select=id,name,scope_hub,scope_country,scope_region,enabled,rule,created_at,updated_at,updated_by&id=eq." + encodeURIComponent(ACTIVE_ID) + "&limit=1");
  return array(rows)[0] || null;
}

async function ensureHealthyLedger(actorId, input, runtimeVersion) {
  const scope = normalizedScope(input);
  if (scope.country !== "KR" || scope.region !== "NATIONWIDE") {
    return { ok: true, version: VERSION, applicable: false, migrated: false };
  }

  const current = await activeRow();
  const currentRule = plain(current && current.rule);
  if (isHealthyActiveLedger(currentRule)) {
    return { ok: true, version: VERSION, applicable: true, migrated: false, protected: true, counts: decisionCounts(currentRule.products) };
  }

  const snapshot = loadRecoverySnapshot();
  const migratedJob = buildMigratedJob(snapshot, runtimeVersion, actorId);
  const now = iso();

  if (current) {
    const backupId = "igdc_product_ledger_backup_kr_nationwide_" + safePart(now) + "_" + crypto.randomBytes(5).toString("hex");
    await SlotStore.insert("gslot_policies", {
      id: backupId,
      name: "KR/NATIONWIDE 상품 활성 원장 자동 이관 전 백업",
      scope_hub: "country-product-reference-research-job-backup",
      scope_country: "KR",
      scope_region: null,
      enabled: false,
      rule: {
        schema: "igdc-country-product-ledger-backup.v1",
        backedUpAt: now,
        backedUpBy: text(actorId) || "system",
        sourceActiveId: ACTIVE_ID,
        sourceRow: current
      },
      created_at: now,
      updated_at: now,
      updated_by: text(actorId) || "system"
    }, "return=representation");
  }

  await SlotStore.insert("gslot_policies", {
    id: ACTIVE_ID,
    name: "국가 공식 상품 이미지·원본 링크 리서치 작업",
    scope_hub: "country-product-reference-research-job",
    scope_country: "KR",
    scope_region: null,
    enabled: false,
    rule: migratedJob,
    created_at: text(current && current.created_at) || now,
    updated_at: now,
    updated_by: text(actorId) || "system"
  }, "resolution=merge-duplicates,return=representation");

  return {
    ok: true,
    version: VERSION,
    applicable: true,
    migrated: true,
    protected: true,
    previousCounts: decisionCounts(currentRule.products),
    counts: decisionCounts(migratedJob.products)
  };
}

module.exports = {
  VERSION,
  BASELINE,
  ensureHealthyLedger,
  decisionCounts,
  isVerifiedBaseline,
  isHealthyActiveLedger,
  buildMigratedJob
};
