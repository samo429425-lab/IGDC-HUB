"use strict";

/**
 * IGDC revenue-settlement diagnostic v1
 * --------------------------------------------------------------------------
 * Owner/admin-only, read-only settlement diagnostic.
 *
 * This endpoint does not create orders, provider links, payments, payouts,
 * ledger rows, settlement rows, or click events. It reads existing runtime
 * contracts only and separates:
 *   - forecast / preparation information,
 *   - provider-confirmed ledger income,
 *   - income-summary reconciliation,
 *   - provider/webhook/import readiness.
 *
 * No secret, token, provider credential, tracking URL, or raw customer/order
 * data is returned.
 */

const fs = require("fs");
const path = require("path");

const MemberAdmin = require("./member-admin");
const RevenueEngine = require("./revenue-engine");
const Ledger = require("./ledger");
const IncomeSummary = require("./igdc-income-summary");
const CommerceIntake = require("./lib/commerce-candidate-intake.v1");
const AffiliateRegistry = require("./lib/affiliate-program-registry.v1");

const VERSION = "igdc-revenue-settlement-diagnostic-v1.0.2-empty-vs-error-ledger-state";
const FX_KRW_PER_USD = Math.max(1, Number(process.env.IGDC_FX_KRW_PER_USD || 1300) || 1300);
const ADMIN_ROLES = new Set(["owner", "super_admin", "admin"]);

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase().replace(/\s+/g, "_"); }
function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : (fallback == null ? 0 : fallback);
}
function uniq(values) { return Array.from(new Set((values || []).map(text).filter(Boolean))); }
function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}
function rootOf(input) { return path.resolve(input && input.root || process.cwd()); }
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private, max-age=0",
      "x-content-type-options": "nosniff",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-allow-methods": "GET,OPTIONS"
    },
    body: statusCode === 204 ? "" : JSON.stringify(body)
  };
}
function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function responseBody(response) {
  if (!response) return {};
  if (response.body && typeof response.body === "object") return response.body;
  return safeJson(response.body || "{}", {});
}
function isSuccessful(response, body) {
  return !!response && Number(response.statusCode || 500) < 400 && (!body || body.ok !== false);
}
async function invoke(handler, event) {
  try {
    const response = await handler(event || {});
    const body = responseBody(response);
    return {
      ok: isSuccessful(response, body),
      statusCode: Number(response && response.statusCode) || 500,
      body,
      error: body && body.error ? String(body.error) : null
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: Number(error && error.statusCode) || 500,
      body: {},
      error: String(error && error.message || error || "handler_failed")
    };
  }
}
function roleList(user) {
  return uniq((user && user.roles || []).map(lower));
}
function highestRole(roles) {
  const order = ["owner", "super_admin", "admin"];
  return order.find(role => (roles || []).includes(role)) || "guest";
}
async function resolveAdministrator(event) {
  /*
   * Reuse the same server-side member-admin verifier that already governs
   * access to the existing administrator page.  The commerce queue and the
   * settlement diagnostic must not independently reinterpret an Auth0 token:
   * doing so caused a valid administrator iframe session to be rejected by a
   * second, incompatible audience/issuer contract.
   *
   * The proxy keeps the original Authorization header intact. member-admin
   * verifies the token signature, issuer, expiry and roles server-side; the
   * browser role label is never trusted here.
   */
  let response;
  let body;
  try {
    response = await MemberAdmin.handler({
      httpMethod: "GET",
      headers: event && event.headers || {},
      queryStringParameters: { action: "me" },
      body: null
    });
    body = responseBody(response);
  } catch (_error) {
    throw fail(503, "member_admin_verifier_unavailable", "관리자 공통 세션 검증 서버를 확인하지 못했습니다.");
  }

  const statusCode = Number(response && response.statusCode) || 500;
  if (statusCode !== 200 || !body || body.ok !== true || !body.me) {
    if (statusCode === 403) {
      throw fail(403, "admin_role_required", "수익 정산 점검은 owner/admin 권한에서만 열립니다.");
    }
    if (statusCode === 401) {
      throw fail(401, "admin_session_not_verified", "관리자 공통 세션의 서버 확인에 실패했습니다.");
    }
    throw fail(503, "member_admin_verifier_unavailable", "관리자 공통 세션 검증 서버를 확인하지 못했습니다.");
  }

  const roles = roleList(body.me);
  if (!roles.some(role => ADMIN_ROLES.has(role))) {
    throw fail(403, "admin_role_required", "수익 정산 점검은 owner/admin 권한에서만 열립니다.");
  }

  return {
    source: "member_admin_common_session",
    role: highestRole(roles),
    roles,
    memberId: text(body.me.user_id),
    email: text(body.me.email)
  };
}
function currency(value) {
  return text(value || "USD").toUpperCase() || "USD";
}
function toUsd(amount, ccy) {
  const amountNumber = number(amount, NaN);
  if (!Number.isFinite(amountNumber)) return null;
  const code = currency(ccy);
  if (code === "USD") return amountNumber;
  if (code === "KRW") return amountNumber / FX_KRW_PER_USD;
  return null;
}
function sumCurrency(rows) {
  const totals = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = currency(row && (row.ccy || row.currency));
    const amount = number(row && row.amount, NaN);
    if (!Number.isFinite(amount)) continue;
    totals[code] = (totals[code] || 0) + amount;
  }
  Object.keys(totals).forEach(key => { totals[key] = Number(totals[key].toFixed(8)); });
  return totals;
}
function summarizeLedger(body) {
  const rows = Array.isArray(body && body.rows) ? body.rows : [];
  const totalByCurrency = sumCurrency(rows);
  const byKind = {};
  const bySource = {};
  let positive = 0;
  let negative = 0;
  let zero = 0;
  let usdConvertibleTotal = 0;
  let nonConvertibleRows = 0;

  for (const row of rows) {
    const amount = number(row && row.amount, 0);
    if (amount > 0) positive++;
    else if (amount < 0) negative++;
    else zero++;

    const kind = text(row && row.kind) || "unknown";
    const source = text(row && row.source) || "unknown";
    byKind[kind] = (byKind[kind] || 0) + 1;
    bySource[source] = (bySource[source] || 0) + 1;

    const usd = toUsd(amount, row && (row.ccy || row.currency));
    if (usd === null) nonConvertibleRows++;
    else usdConvertibleTotal += usd;
  }

  return {
    configured: body && body.mode !== "unconfigured",
    mode: text(body && body.mode) || "unknown",
    windowHours: number(body && body.windowHours, 0),
    windowDays: number(body && body.windowDays, 0),
    rows: rows.length,
    positiveRows: positive,
    reversalOrNegativeRows: negative,
    zeroRows: zero,
    totalByCurrency,
    totalUsdConvertible: Number(usdConvertibleTotal.toFixed(8)),
    totalKrwEquivalent: Math.round(usdConvertibleTotal * FX_KRW_PER_USD),
    nonConvertibleRows,
    byKind,
    bySource,
    dataState: text(body && body.dataState) || (rows.length ? "confirmed_ledger_available" : (body && body.mode === "supabase" ? "confirmed_ledger_empty" : "unknown")),
    errorCode: text(body && body.errorCode) || null,
    config: body && body.config && typeof body.config === "object" ? body.config : null,
    warning: text(body && body.warning) || null,
    error: text(body && body.error) || null
  };
}
function incomeView(body) {
  return {
    ok: body && body.ok === true,
    dataState: text(body && body.dataState) || "unknown",
    sourceMode: text(body && body.source && body.source.mode) || "unknown",
    sourceError: text(body && body.source && body.source.error) || null,
    confirmedRows: number(body && body.confirmedRows, 0),
    unconvertedRows: number(body && body.unconvertedRows, 0),
    totalRevenueUsd: number(body && body.totalRevenueUsd, 0),
    totalRevenueKrw: number(body && body.totalRevenueKrw, 0),
    summary: body && body.summary && typeof body.summary === "object" ? body.summary : {}
  };
}
function state(code, label, detail) {
  return Object.assign({ code, label }, detail || {});
}
function reconcile(ledger, income) {
  if (!ledger.configured || income.dataState === "confirmed_ledger_unconfigured") {
    return state("not_configured", "확정 수익 ledger 저장소 미연결", {
      checked: false,
      differenceUsd: null,
      reason: "confirmed_ledger_unconfigured"
    });
  }
  if (ledger.mode !== "supabase" || !income.ok || income.sourceMode !== "supabase") {
    return state("source_unavailable", "ledger 또는 income summary 원천을 읽지 못함", {
      checked: false,
      differenceUsd: null,
      reason: ledger.error || income.sourceError || "source_unavailable"
    });
  }
  if (!ledger.rows && !income.confirmedRows) {
    return state("ready_no_confirmed_income", "확정 수익 기록 없음", {
      checked: true,
      differenceUsd: 0,
      reason: "no_confirmed_ledger_rows"
    });
  }
  if (ledger.nonConvertibleRows || income.unconvertedRows) {
    return state("currency_mapping_required", "환산 불가 통화 행이 있어 정산 대조 보류", {
      checked: false,
      differenceUsd: null,
      ledgerNonConvertibleRows: ledger.nonConvertibleRows,
      incomeUnconvertedRows: income.unconvertedRows
    });
  }
  const difference = Number((ledger.totalUsdConvertible - income.totalRevenueUsd).toFixed(8));
  if (Math.abs(difference) > 0.0001) {
    return state("difference_detected", "ledger와 income summary 금액 차이 확인 필요", {
      checked: true,
      differenceUsd: difference,
      differenceKrw: Math.round(difference * FX_KRW_PER_USD)
    });
  }
  return state("reconciled", "확정 ledger와 income summary가 일치", {
    checked: true,
    differenceUsd: 0,
    differenceKrw: 0
  });
}
function programSummary(program) {
  const policyCheckedAt = text(program && program.policyCheckedAt);
  const policyFresh = !!policyCheckedAt && AffiliateRegistry.isFresh(policyCheckedAt, Number(program && program.policyMaxAgeDays) || 14);
  const status = lower(program && program.policyStatus);
  const policyConfirmed = ["active", "approved", "verified", "live", "enabled", "policy_ok", "confirmed"].includes(status);
  return {
    id: text(program && program.id),
    name: text(program && program.name),
    enabled: !!(program && program.enabled),
    mode: text(program && program.mode) || "manual_link_only",
    allowedCountries: Array.isArray(program && program.allowedCountries) ? program.allowedCountries.slice(0, 30) : [],
    policyState: status || "operator_review_required",
    policyCheckedAt: policyCheckedAt || null,
    policyFresh,
    policyConfirmed,
    apiMode: text(program && program.api && program.api.mode) || "disabled",
    manualLinkRequired: !!(program && program.manualLink && program.manualLink.enabled)
  };
}
function partnerWebhookConfig() {
  const raw = safeJson(process.env.IGDC_AFFILIATE_PARTNERS_JSON || "[]", []);
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.providers) ? raw.providers : []);
  const active = list.filter(entry => entry && typeof entry === "object" && entry.active === true);
  return {
    activeProviderCount: active.length,
    clickSigningConfigured: !!text(process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET),
    activeProviders: active.slice(0, 30).map(entry => ({
      id: text(entry.id || entry.providerId) || null,
      active: true,
      conversionMode: text(entry.conversionMode || entry.mode) || "provider_callback",
      secretConfigured: !!(text(entry.secretEnv) && process.env[text(entry.secretEnv)])
    }))
  };
}
function candidateStage(root) {
  const stage = CommerceIntake.readStage(root);
  const summary = stage && stage.summary || {};
  const gate = stage && stage.releaseGate || {};
  return {
    present: !!stage,
    generatedAt: text(stage && stage.generatedAt) || null,
    considered: number(summary.considered, 0),
    eligibleForRelease: number(summary.eligibleForRelease, 0),
    releasedToCanonical: number(summary.releasedToCanonical, 0),
    held: number(summary.held, 0),
    releaseMode: text(gate.mode) || "staging_only",
    releaseEnabled: gate.enabled === true,
    releaseReason: text(gate.reason) || (stage ? "unknown" : "stage_not_built_yet")
  };
}
function canonicalState(root) {
  const candidates = [
    path.join(root, "data", "canonical-snapshot", "current-manifest.json"),
    path.join(root, "netlify", "functions", "data", "canonical-snapshot", "current-manifest.json")
  ];
  for (const file of candidates) {
    const doc = readJson(file);
    if (doc && typeof doc === "object") {
      return {
        present: true,
        releaseId: text(doc.releaseId) || null,
        itemCount: number(doc.itemCount, 0),
        generatedAt: text(doc.generatedAt || doc.publishedAt) || null
      };
    }
  }
  return { present: false, releaseId: null, itemCount: 0, generatedAt: null };
}
function buildChecks(input) {
  const checks = [];
  function add(key, status, label, detail) { checks.push({ key, status, label, detail: detail || "" }); }

  const engine = input.engine;
  add("revenue_engine", engine.ok ? "ok" : "warn",
    engine.ok ? "수익 엔진 읽기 계약 정상" : "수익 엔진 읽기 계약 확인 필요",
    engine.ok ? "정산·지급 실행은 꺼진 상태" : "엔진 health 응답 실패");

  const registry = input.registry;
  add("affiliate_registry", registry.ok ? "ok" : "warn",
    registry.ok ? "제휴 프로그램 레지스트리 구조 정상" : "제휴 프로그램 레지스트리 미러/구조 확인 필요",
    registry.problems && registry.problems.join(", ") || "");

  const stage = input.stage;
  add("commerce_stage", stage.present ? "ok" : "warn",
    stage.present ? "상품 후보·수익 대기열 stage 확인" : "상품 후보 stage가 아직 빌드되지 않음",
    `검토 ${stage.considered} · 공개전 통과 ${stage.eligibleForRelease} · Canonical 전달 ${stage.releasedToCanonical}`);

  const ledger = input.ledger;
  const ledgerConnected = ledger.configured && ledger.mode === "supabase";
  const ledgerEmpty = ledgerConnected && ledger.rows === 0;
  add("confirmed_ledger", ledgerConnected ? "ok" : "warn",
    ledgerEmpty ? "확정 수익 자료 없음" : (ledgerConnected ? "확정 수익 ledger 연결" : (ledger.configured ? "확정 수익 ledger 연결 오류" : "확정 수익 ledger 미연결")),
    ledgerConnected ? (ledger.rows ? `최근 ${ledger.windowDays || 0}일 ${ledger.rows}행` : "정상 조회 완료 · 확정 수익 0행") : (ledger.errorCode || ledger.error || "연결 상태 확인 필요"));

  const rec = input.reconciliation;
  const recStatus = (rec.code === "reconciled" || rec.code === "ready_no_confirmed_income") ? "ok" : "warn";
  add("settlement_reconciliation", recStatus, rec.label, rec.reason || "");

  const webhook = input.providerWebhook;
  add("affiliate_callback", webhook.activeProviderCount && webhook.clickSigningConfigured ? "ok" : "warn",
    webhook.activeProviderCount && webhook.clickSigningConfigured ? "승인 제휴 콜백 수신 준비" : "승인 제휴 콜백 미연결 또는 준비 전",
    `활성 제공자 ${webhook.activeProviderCount} · 클릭서명 ${webhook.clickSigningConfigured ? "설정" : "미설정"}`);

  const ingestReady = input.protectedIngestReady;
  add("protected_settlement_import", ingestReady ? "ok" : "warn",
    ingestReady ? "보호 정산명세 가져오기 준비" : "보호 정산명세 가져오기 미연결",
    "외부 정산명세는 서버 전용 토큰·ledger 연결 후에만 기록");

  add("payment_execution", "warn", "PG 결제 실행 미연동", "PG 승인·연동 전에는 실결제·지급을 실행하지 않음");
  add("payout_execution", "warn", "지급 실행 미구현", "이 진단은 입금/지급을 실행하지 않는 읽기 전용 점검");

  return checks;
}
function overallStatus(input) {
  const rec = input.reconciliation && input.reconciliation.code;
  if (rec === "reconciled") return "reconciled";
  if (rec === "ready_no_confirmed_income") return "ready_no_confirmed_income";
  if (rec === "not_configured") return "not_configured";
  if (rec === "source_unavailable" || rec === "difference_detected" || rec === "currency_mapping_required") return "attention_required";
  return "preparation_required";
}
async function buildDiagnostic(input) {
  const root = rootOf(input);
  const [ledgerResponse, incomeResponse] = await Promise.all([
    invoke(Ledger.handler, {
      httpMethod: "GET",
      queryStringParameters: { window_days: "366", limit: "5000" },
      headers: {}
    }),
    invoke(IncomeSummary.handler, { httpMethod: "GET", queryStringParameters: {}, headers: {} })
  ]);

  let engine;
  try {
    engine = await RevenueEngine.runEngine({ action: "health", dryRun: true, noWrite: true, audit: true });
  } catch (error) {
    engine = { ok: false, error: String(error && error.message || error) };
  }

  const rawRegistry = AffiliateRegistry.load(root);
  const registry = {
    ok: rawRegistry.ok === true,
    version: text(rawRegistry.raw && rawRegistry.raw.version) || AffiliateRegistry.VERSION,
    fingerprint: text(rawRegistry.fingerprint) || null,
    problems: Array.isArray(rawRegistry.problems) ? rawRegistry.problems.slice(0, 50) : [],
    programs: (rawRegistry.programs || []).map(programSummary),
    externalReferral: {
      enabled: rawRegistry.externalReferral && rawRegistry.externalReferral.enabled === true,
      requireOperatorApproval: rawRegistry.externalReferral && rawRegistry.externalReferral.requireOperatorApproval !== false,
      requireDisclosure: rawRegistry.externalReferral && rawRegistry.externalReferral.requireDisclosure !== false
    }
  };

  const ledger = summarizeLedger(ledgerResponse.body || {});
  const income = incomeView(incomeResponse.body || {});
  const reconciliation = reconcile(ledger, income);
  const stage = candidateStage(root);
  const canonical = canonicalState(root);
  const providerWebhook = partnerWebhookConfig();
  const protectedIngestReady = !!text(process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN) && ledger.configured && ledger.mode === "supabase";
  const engineSummary = {
    ok: engine && engine.ok === true,
    version: text(engine && engine.version) || null,
    pgExecution: !!(engine && engine.features && engine.features.pgExecution),
    pgStatus: text(engine && engine.features && engine.features.pgStatus) || "pending_pg_approval",
    confirmedProviderSettlement: !!(engine && engine.features && engine.features.confirmedProviderSettlement),
    forecastSeparatedFromLedger: !!(engine && engine.features && engine.features.forecastSeparatedFromLedger),
    weeklyBatchSettlementContract: !!(engine && engine.features && engine.features.weeklyBatchSettlement),
    payoutExecution: false
  };

  const checks = buildChecks({
    engine: engineSummary,
    registry,
    stage,
    ledger,
    reconciliation,
    providerWebhook,
    protectedIngestReady
  });

  return {
    ok: true,
    reportType: "igdc-revenue-settlement-diagnostic",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    dryRun: true,
    safety: {
      writes: false,
      publicSnapshotPublication: false,
      outboundNavigation: false,
      providerCalls: false,
      paymentExecution: false,
      settlementExecution: false,
      payoutExecution: false,
      secretsExcluded: true,
      customerOrOrderDataExcluded: true
    },
    overallState: overallStatus({ reconciliation }),
    semantics: {
      confirmedIncome: "approved provider callback or protected settlement statement rows already stored in the durable ledger",
      forecast: "not cash; never treated as confirmed income or payout-ready money",
      externalReferral: "traffic relationship only; not revenue unless a provider-approved settlement record arrives",
      pg: "pending approval/integration; not live"
    },
    engine: engineSummary,
    commerce: {
      candidateStage: stage,
      canonicalPublication: canonical
    },
    providerRevenueReadiness: {
      registry,
      affiliateCallback: providerWebhook,
      protectedSettlementImportReady: protectedIngestReady
    },
    confirmedLedger: ledger,
    confirmedIncome: income,
    reconciliation,
    checks,
    blockingConditions: checks.filter(check => check.status !== "ok").map(check => ({
      key: check.key,
      label: check.label,
      detail: check.detail
    }))
  };
}

exports.handler = async function handler(event) {
  try {
    if (String(event && event.httpMethod || "GET").toUpperCase() === "OPTIONS") return json(204, {});
    if (String(event && event.httpMethod || "GET").toUpperCase() !== "GET") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }
    const administrator = await resolveAdministrator(event || {});
    const report = await buildDiagnostic({ root: process.cwd() });
    report.administrator = {
      role: administrator.role,
      roles: administrator.roles,
      sessionValidation: administrator.source
    };
    return json(200, report);
  } catch (error) {
    return json(Number(error && error.statusCode) || 500, {
      ok: false,
      error: String(error && error.message || "revenue_settlement_diagnostic_failed"),
      code: error && error.code || "revenue_settlement_diagnostic_failed"
    });
  }
};

module.exports = {
  VERSION,
  handler: exports.handler,
  buildDiagnostic,
  summarizeLedger,
  reconcile
};
