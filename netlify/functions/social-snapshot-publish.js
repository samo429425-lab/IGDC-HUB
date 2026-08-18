"use strict";

/**
 * Builds and validates a Social release from approved Supabase candidates.
 * Runtime functions never write deployed static files. A confirmed release is
 * stored first, then the configured Netlify build hook runs the existing line:
 * Social release -> Social/PSOM policy gate -> ordinary SearchBank Snapshot ->
 * existing Snapshot Engine -> social.snapshot.json.
 */
const fs = require("fs");
const path = require("path");
const SocialStore = require("./lib/social-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");
const CountryRouting = require("./lib/social-country-routing.v1");
const SocialSearchBankReleaseAdapter = require("./lib/social-searchbank-release-adapter.v1");

const VERSION =
  "social-snapshot-publish-v1.9.0-exact-candidate-apply";
function text(value) {
  return value == null ? "" : String(value).trim();
}
async function actorFor(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  const member = {
    memberId: text(actor && (actor.memberId || actor.sub)),
    email: text(actor && actor.email),
    roles: Array.isArray(actor && actor.roles) ? actor.roles : [],
  };
  SocialStore.requireRole(member, "write");
  return member;
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_e) {
    return null;
  }
}
function baseSnapshot() {
  const root = process.cwd();
  const files = [
    path.join(root, "data", "social.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "social.snapshot.json"),
    path.join(__dirname, "data", "social.snapshot.json"),
  ];
  for (const file of files) {
    const doc = readJson(file);
    if (doc) return { file, doc };
  }
  const sections = {};
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    sections[sectionKey] = [];
  });
  return {
    file: "generated-empty",
    doc: {
      version: "social.snapshot.empty",
      type: "social_snapshot",
      pages: { social: { sections } },
      meta: {},
    },
  };
}
function releaseCountry(row) {
  return text(
    row &&
      row.snapshot &&
      row.snapshot.meta &&
      row.snapshot.meta.applicationScope &&
      row.snapshot.meta.applicationScope.countryCode,
  ).toUpperCase();
}
function scopeToken(route) {
  const country = text(route && route.countryCode).toUpperCase();
  const region = text(route && (route.worldRegion || route.regionId));
  const mode = text(route && route.scopeMode).toLowerCase();
  if (mode === "global") return "GLOBAL";
  if (country) return country;
  if (region) return "REGION:" + region;
  return "GLOBAL";
}
function fullStructuralBase(storedSnapshot) {
  const seed = baseSnapshot();
  const base = JSON.parse(JSON.stringify((seed && seed.doc) || {}));
  const stored = storedSnapshot && typeof storedSnapshot === "object"
    ? JSON.parse(JSON.stringify(storedSnapshot))
    : null;
  if (!stored) return { file: seed && seed.file || "static-social-snapshot", doc: base };

  if (!base.pages) base.pages = {};
  if (!base.pages.social) base.pages.social = {};
  if (!base.pages.social.sections) base.pages.social.sections = {};

  const storedSocial = stored.pages && stored.pages.social || {};
  const storedSections = storedSocial.sections || {};

  // Only the nine managed SNS sections may be inherited from a stored release.
  // Reserved structural sections (social-maru, rightPanel) always stay exactly
  // as deployed in the static Social snapshot so a partial release can never
  // erase the right-side product cards or the MARU reserved section.
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    if (Array.isArray(storedSections[sectionKey])) {
      base.pages.social.sections[sectionKey] = JSON.parse(
        JSON.stringify(storedSections[sectionKey]),
      );
    }
  });

  if (storedSocial.candidatePool && typeof storedSocial.candidatePool === "object") {
    const currentPool = base.pages.social.candidatePool && typeof base.pages.social.candidatePool === "object"
      ? base.pages.social.candidatePool
      : {};
    SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
      if (Array.isArray(storedSocial.candidatePool[sectionKey])) {
        currentPool[sectionKey] = JSON.parse(
          JSON.stringify(storedSocial.candidatePool[sectionKey]),
        );
      }
    });
    base.pages.social.candidatePool = currentPool;
  }

  return { file: seed && seed.file || "static-social-snapshot", doc: base };
}

async function latestStoredBase(route) {
  try {
    const countryCode = text(route && route.countryCode).toUpperCase();
    const regionId = text(route && (route.worldRegion || route.regionId));
    const exactRows = await SocialStore.selectReleases(
      "select=release_id,snapshot,created_at,notes&status=eq.stored&notes=like." +
        encodeURIComponent("scope=" + scopeToken(route) + ";%") +
        "&order=created_at.desc&limit=1",
    );
    let latest = Array.isArray(exactRows) && exactRows[0];
    if (!latest && (countryCode || regionId)) {
      const globalRows = await SocialStore.selectReleases(
        "select=release_id,snapshot,created_at,notes&status=eq.stored&notes=like." +
          encodeURIComponent("scope=GLOBAL;%") +
          "&order=created_at.desc&limit=1",
      );
      latest = Array.isArray(globalRows) && globalRows[0];
    }
    if (!latest) {
      const legacyRows = await SocialStore.selectReleases(
        "select=release_id,snapshot,created_at,notes&status=eq.stored&order=created_at.desc&limit=25",
      );
      const list = Array.isArray(legacyRows) ? legacyRows : [];
      const exact = list.find((row) => releaseCountry(row) === countryCode);
      const global = list.find((row) => !releaseCountry(row));
      latest = exact || ((countryCode || regionId) ? global : null);
    }
    if (latest && latest.snapshot) {
      const structural = fullStructuralBase(latest.snapshot);
      return {
        file: "stored-current:" + latest.release_id + "+static-structural-base",
        doc: structural.doc,
      };
    }
  } catch (_error) {
    /* Static snapshot remains the safe fallback. */
  }
  return baseSnapshot();
}
function approvedQuery(limit) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 3500));
  return (
    "select=*&review_status=eq.approved&candidate_only=eq.false&seed_content=eq.false&order=section_key.asc,rotation_score.desc,approved_at.desc&limit=" +
    safeLimit
  );
}
function candidateIdsFrom(params) {
  return Array.from(
    new Set(
      SocialStore.array(
        params.candidateIds || params.ids || params.candidateId || params.id,
      )
        .map(SocialStore.text)
        .filter(Boolean),
    ),
  ).slice(0, 1000);
}
function buildHookSetting() {
  // The Social publisher triggers the same site build that runs the canonical
  // Social release -> SearchBank adapter -> Snapshot Engine chain. Reuse an
  // already configured site-level Commerce hook when a Social-specific hook
  // is not present; this avoids silently stopping at release_stored_waiting_for_build.
  const names = [
    "SOCIAL_NETLIFY_BUILD_HOOK_URL",
    "IGDC_NETLIFY_BUILD_HOOK_URL",
    "NETLIFY_BUILD_HOOK_URL",
    "COMMERCE_RELEASE_BUILD_HOOK_URL",
    "BUILD_HOOK_URL",
  ];
  for (const name of names) {
    const value = text(process.env[name]);
    if (value) return { name, value };
  }
  return { name: names[0], value: "" };
}
function buildHookStatus() {
  const setting = buildHookSetting();
  return {
    configured: !!setting.value,
    environment: setting.value ? setting.name : "SOCIAL_NETLIFY_BUILD_HOOK_URL",
    acceptedEnvironmentNames: [
      "SOCIAL_NETLIFY_BUILD_HOOK_URL",
      "IGDC_NETLIFY_BUILD_HOOK_URL",
      "NETLIFY_BUILD_HOOK_URL",
      "COMMERCE_RELEASE_BUILD_HOOK_URL",
      "BUILD_HOOK_URL",
    ],
  };
}
async function triggerCanonicalBuild(release, operation) {
  const setting = buildHookSetting();
  if (!setting.value) {
    return {
      ok: false,
      status: "not_configured",
      requiredEnvironment: "SOCIAL_NETLIFY_BUILD_HOOK_URL (or existing site build hook)",
      acceptedEnvironmentNames: [
        "SOCIAL_NETLIFY_BUILD_HOOK_URL",
        "IGDC_NETLIFY_BUILD_HOOK_URL",
        "NETLIFY_BUILD_HOOK_URL",
        "COMMERCE_RELEASE_BUILD_HOOK_URL",
        "BUILD_HOOK_URL",
      ],
      message:
        "승인본은 저장됐지만 정식 정적 스냅샷 배포를 시작할 Netlify Build Hook을 찾지 못했습니다.",
    };
  }
  let parsed;
  try {
    parsed = new URL(setting.value);
  } catch (_error) {
    return {
      ok: false,
      status: "invalid_configuration",
      environment: setting.name,
      message: "Netlify Build Hook 주소 형식이 올바르지 않습니다.",
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      status: "invalid_configuration",
      environment: setting.name,
      message: "Netlify Build Hook은 HTTPS 주소여야 합니다.",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(setting.value, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trigger_title:
          "IGDC Social " + operation + " " + text(release.release_id),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        status: "request_failed",
        environment: setting.name,
        httpStatus: response.status,
        message: "Netlify 정식 배포 요청이 접수되지 않았습니다.",
      };
    }
    return {
      ok: true,
      status: "queued",
      environment: setting.name,
      httpStatus: response.status,
      releaseId: text(release.release_id),
      message:
        "정식 빌드가 접수됐습니다. 승인 소셜 콘텐츠는 정책·PSOM 검증을 거쳐 기존 SearchBank Snapshot에 인계되고, 이후 기존 Snapshot Engine 경로가 이어집니다.",
    };
  } catch (error) {
    return {
      ok: false,
      status: error && error.name === "AbortError" ? "timeout" : "request_failed",
      environment: setting.name,
      message:
        error && error.name === "AbortError"
          ? "Netlify 정식 배포 요청 시간이 초과됐습니다."
          : "Netlify 정식 배포 요청 중 오류가 발생했습니다.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function latestStoredReleaseForRoute(route) {
  const token = scopeToken(route);
  const exactRows = await SocialStore.selectReleases(
    "select=release_id,status,snapshot_hash,snapshot,created_at,notes&status=eq.stored&notes=like." +
      encodeURIComponent("scope=" + token + ";%") +
      "&order=created_at.desc&limit=1",
  );
  let latest = Array.isArray(exactRows) && exactRows[0];
  if (!latest && token !== "GLOBAL") {
    const globalRows = await SocialStore.selectReleases(
      "select=release_id,status,snapshot_hash,snapshot,created_at,notes&status=eq.stored&notes=like." +
        encodeURIComponent("scope=GLOBAL;%") +
        "&order=created_at.desc&limit=1",
    );
    latest = Array.isArray(globalRows) && globalRows[0];
  }
  return latest || null;
}
function releasedIdsBySection(snapshot) {
  const sections = snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections || {};
  const result = {};
  SocialStore.Policy.SECTION_KEYS.forEach((sectionKey) => {
    result[sectionKey] = (Array.isArray(sections[sectionKey]) ? sections[sectionKey] : [])
      .filter((slot) => text(slot && slot.type) === "external_social" && text(slot && slot.audit && slot.audit.origin) === "social_candidates")
      .map((slot) => text(slot && (slot.contentId || slot.candidateId || slot.id || slot.audit && slot.audit.candidate_id)))
      .filter(Boolean);
  });
  return result;
}
function searchBankSnapshotState(root, expectedIds) {
  const files = SocialSearchBankReleaseAdapter.searchBankPaths(root);
  const mirrorRows = [];
  let primary = null;
  for (const file of files) {
    const doc = readJson(file);
    const valid = !!(doc && Array.isArray(doc.items));
    const hash = valid ? SocialSearchBankReleaseAdapter.sha256(doc) : null;
    const rel = path.relative(root, file).replace(/\\/g, "/");
    mirrorRows.push({ file: rel, present: valid, hash, itemCount: valid ? doc.items.length : 0 });
    if (!primary && valid) primary = { file: rel, doc, hash };
  }
  const expected = new Set(Array.isArray(expectedIds) ? expectedIds : []);
  const idsBySection = {};
  const presentIds = new Set();
  let candidateCount = 0;
  let sampleCount = 0;
  let socialTotal = 0;
  if (primary) {
    for (const item of primary.doc.items) {
      const section = text(item && (item.psom_key || item.section || item.bind && item.bind.section));
      if (!section.startsWith("social-")) continue;
      socialTotal += 1;
      const auditOrigin = text(item && item.audit && item.audit.origin);
      const socialCandidate = auditOrigin === "social_candidates" || !!(item && item.socialCandidatePublication && item.socialCandidatePublication.candidateId);
      if (socialCandidate) {
        candidateCount += 1;
        const id = text(item && (item.id || item.contentId || item.candidateId));
        if (id) {
          if (!idsBySection[section]) idsBySection[section] = [];
          idsBySection[section].push(id);
          if (expected.has(id)) presentIds.add(id);
        }
      } else {
        const url = text(item && (item.url || item.link || item.href)).toLowerCase();
        const image = text(item && (item.thumbnail || item.thumb || item.image)).toLowerCase();
        const title = text(item && (item.title || item.name)).toLowerCase();
        if (item && (item.sample === true || item.placeholder === true || item.replaceableSlot === true) || url === "#" || url.includes("example.com") || image.includes("placeholder") || title.includes("seed placeholder")) sampleCount += 1;
      }
    }
  }
  const hashes = mirrorRows.filter((row) => row.present).map((row) => row.hash);
  const mirrorConsensus = hashes.length === files.length && new Set(hashes).size === 1;
  return {
    checked: true,
    source: primary ? primary.file : null,
    mirrors: mirrorRows,
    mirrorConsensus,
    totalItems: primary ? primary.doc.items.length : 0,
    socialItems: socialTotal,
    socialCandidateItems: candidateCount,
    socialSampleItemsPreserved: sampleCount,
    idsBySection,
    presentExpectedIds: Array.from(presentIds),
  };
}
async function runtimePipelineDiagnostic(route) {
  const root = process.cwd();
  const release = await latestStoredReleaseForRoute(route);
  const out = {
    ok: false,
    reportType: "igdc-social-searchbank-handoff-verification",
    version: VERSION,
    generatedAt: SocialStore.nowIso(),
    scope: {
      countryCode: text(route && route.countryCode).toUpperCase() || null,
      worldRegion: text(route && (route.worldRegion || route.regionId)) || null,
      mode: text(route && route.scopeMode) || (text(route && route.countryCode) ? "country" : "global"),
    },
    pipelineModel: [
      "stored_social_release",
      "social_policy_and_psom_gate",
      "data/search-bank.snapshot.json",
      "existing_snapshot_engine",
      "data/social.snapshot.json",
      "existing_social_automap",
    ],
    buildHook: buildHookStatus(),
    release: release
      ? {
          releaseId: text(release.release_id),
          status: text(release.status),
          snapshotHash: text(release.snapshot_hash),
          createdAt: text(release.created_at),
          notes: text(release.notes),
        }
      : null,
    policyGate: null,
    searchBankSnapshot: null,
    comparison: {
      expectedApprovedItems: 0,
      presentInSearchBankSnapshot: 0,
      missingIds: [],
    },
    pipeline: {
      storedRelease: release ? "passed" : "missing",
      policyAndPsomGate: "not_run",
      searchBankSnapshotHandoff: "not_run",
      downstream: "existing_automatic_pipeline_not_mutated",
    },
    safety: {
      readOnly: true,
      runtimeFileWrite: false,
      searchBankEngineMutation: false,
      snapshotEngineMutation: false,
      socialSnapshotMutation: false,
      frontOrAutomapMutation: false,
      buildTrigger: false,
    },
  };
  if (!release || !release.snapshot) {
    out.reason = "stored_social_release_not_found";
    return out;
  }

  const converted = SocialSearchBankReleaseAdapter.releaseToBank(release);
  const gate = SocialSearchBankReleaseAdapter.policyGate(root, converted.bank);
  out.policyGate = {
    ok: gate.ok,
    psomFile: gate.psomFile,
    acceptedCount: gate.accepted.length,
    rejectedCount: gate.rejected.length,
    counts: gate.counts,
    rejected: gate.rejected.slice(0, 100),
  };
  out.pipeline.policyAndPsomGate = gate.ok ? "passed" : "failed";
  if (!gate.ok) {
    out.reason = "social_searchbank_policy_gate_rejected";
    return out;
  }

  const expectedIds = gate.accepted.map((item) => text(item && item.id)).filter(Boolean);
  const searchBank = searchBankSnapshotState(root, expectedIds);
  const present = new Set(searchBank.presentExpectedIds || []);
  const missingIds = expectedIds.filter((id) => !present.has(id));
  out.searchBankSnapshot = searchBank;
  out.comparison = {
    expectedApprovedItems: expectedIds.length,
    presentInSearchBankSnapshot: expectedIds.length - missingIds.length,
    missingIds,
  };
  out.pipeline.searchBankSnapshotHandoff =
    searchBank.mirrorConsensus && missingIds.length === 0 ? "passed" : "mismatch";
  out.ok =
    gate.ok &&
    searchBank.mirrorConsensus &&
    missingIds.length === 0;
  if (!out.ok) {
    out.reason = !searchBank.mirrorConsensus
      ? "search_bank_snapshot_mirror_mismatch"
      : "approved_social_items_missing_from_search_bank_snapshot";
  }
  return out;
}

exports.handler = async function (event) {
  if (event && event.httpMethod === "OPTIONS")
    return SocialStore.response(204, {});
  try {
    if (!["GET", "POST"].includes(event.httpMethod))
      return SocialStore.response(405, {
        ok: false,
        error: "method_not_allowed",
      });
    const actor = await actorFor(event);
    const params = Object.assign(
      {},
      event.queryStringParameters || {},
      event.httpMethod === "POST" ? SocialStore.parseBody(event) : {},
    );
    const operation = text(params.operation || params.action)
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const unpublishSelected =
      operation === "unpublish_selected" ||
      operation === "selected_front_unpublish";
    const candidateIds = candidateIdsFrom(params);
    const actualApplyOperation =
      operation === "actual_front_apply" || operation === "publish_actual" || operation === "apply_actual";
    const storeRelease =
      actualApplyOperation || params.storeRelease === true || params.storeRelease === "true";
    if (
      storeRelease &&
      !unpublishSelected &&
      params.confirmPublish !== true &&
      params.confirmPublish !== "true"
    ) {
      return SocialStore.response(400, {
        ok: false,
        version: VERSION,
        error: "actual_apply_confirmation_required",
        message: "실제 화면 적용 확인값이 필요합니다.",
      });
    }
    if (
      storeRelease &&
      unpublishSelected &&
      params.confirmUnpublish !== true &&
      params.confirmUnpublish !== "true"
    ) {
      return SocialStore.response(400, {
        ok: false,
        version: VERSION,
        error: "actual_unpublish_confirmation_required",
        message: "선택 콘텐츠 실제 적용 취소 확인값이 필요합니다.",
      });
    }
    if (unpublishSelected && !candidateIds.length) {
      return SocialStore.response(400, {
        ok: false,
        version: VERSION,
        error: "candidate_ids_required",
        message: "실제 적용을 취소할 콘텐츠를 선택해 주세요.",
      });
    }
    const sectionKey = SocialStore.Policy.normalizeSectionKey(
      params.sectionKey || params.section || params.targetSection,
    );
    if (
      (params.sectionKey || params.section || params.targetSection) &&
      !SocialStore.Policy.ALLOWED_SECTIONS.has(sectionKey)
    ) {
      return SocialStore.response(400, {
        ok: false,
        version: VERSION,
        error: "invalid_social_section",
        allowedSections: SocialStore.Policy.SECTION_KEYS,
      });
    }
    const route = CountryRouting.resolve(event, params);
    if (operation === "pipeline_diagnostic" || operation === "pipeline_verification") {
      const report = await runtimePipelineDiagnostic(route);
      return SocialStore.response(200, report);
    }
    const base = await latestStoredBase(route);
    let rows = [];
    let unpublish = null;
    let snapshot;
    if (unpublishSelected) {
      const seed = baseSnapshot();
      unpublish = SocialStore.unpublishSnapshot(
        base.doc,
        seed.doc,
        candidateIds,
        { route, sectionKey },
      );
      snapshot = unpublish.snapshot;
    } else {
      const allRows = await SocialStore.selectCandidates(
        approvedQuery(params.limit),
      );
      const approvedRows = Array.isArray(allRows) ? allRows : [];
      const requestedIds = new Set(candidateIds);
      rows = approvedRows.filter((row) => {
        const rowId = SocialStore.text(row && row.id);
        const rowSection = SocialStore.text(
          row && (row.section_key || row.sectionKey),
        );
        if (requestedIds.size > 0 && !requestedIds.has(rowId)) return false;
        if (sectionKey && rowSection !== sectionKey) return false;
        return true;
      });
      snapshot = SocialStore.buildSnapshot(
        base.doc,
        Array.isArray(rows) ? rows : [],
        {
          rotationSalt: params.rotationSalt || params.salt,
          limitPerSection: params.limitPerSection,
          route,
          sectionKey,
        },
      );
    }
    const hash = SocialStore.sha256(snapshot);
    const rotation = (snapshot.meta && snapshot.meta.rotation) || {};
    const eligible = Array.isArray(rows)
      ? rows.filter(SocialStore.isApprovedForSnapshot).length
      : 0;
    if (storeRelease && !unpublishSelected && eligible < 1) {
      return SocialStore.response(409, {
        ok: false,
        version: VERSION,
        error: "no_eligible_social_candidates",
        message:
          "검증을 통과한 실제 소셜 후보가 0개이므로 빈 적용본은 저장·배포하지 않았습니다.",
        appliedSection: sectionKey || null,
        approvedRows: Array.isArray(rows) ? rows.length : 0,
        eligibleRows: eligible,
        buildHook: buildHookStatus(),
      });
    }
    const release = {
      release_id:
        "social_snapshot_" +
        SocialStore.shortHash({ hash, at: SocialStore.nowIso() }),
      status: storeRelease ? "stored" : "preview",
      generated_by: SocialStore.compact(
        actor.email || actor.memberId || "admin",
        200,
      ),
      rotation_salt:
        text(params.rotationSalt || params.salt) ||
        new Date().toISOString().slice(0, 10),
      section_counts: rotation.counts || {},
      snapshot_hash: hash,
      snapshot,
      notes: SocialStore.compact(
        "scope=" +
          scopeToken(route) +
          ";" +
          (unpublishSelected
            ? sectionKey
              ? "section_selected_unpublish:" + sectionKey
              : "all_sections_selected_unpublish"
            : sectionKey
              ? "section_actual_apply:" + sectionKey
              : "all_social_sections_actual_apply") +
          (params.notes ? ";" + params.notes : ""),
        1000,
      ),
      created_at: SocialStore.nowIso(),
    };
    let stored = null;
    if (storeRelease) stored = await SocialStore.insertRelease(release);
    if (storeRelease && (!stored || (Array.isArray(stored) && stored.length < 1))) {
      return SocialStore.response(502, {
        ok: false, version: VERSION, error: "social_release_store_failed",
        message: "실제 적용 승인본을 저장하지 못해 SearchBank 인계 전에 중단했습니다.",
        releaseId: release.release_id, eligibleRows: eligible, buildHook: buildHookStatus()
      });
    }
    let buildTrigger = null;
    if (storeRelease && stored) {
      buildTrigger = await triggerCanonicalBuild(
        release,
        unpublishSelected ? "unpublish" : "publish",
      );
    }
    if (
      params.download === "1" ||
      params.download === true ||
      params.format === "snapshot"
    ) {
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, no-store, max-age=0",
          "content-disposition":
            "attachment; filename=social.snapshot.generated.json",
        },
        body: JSON.stringify(snapshot, null, 2) + "\n",
      };
    }
    return SocialStore.response(storeRelease && buildTrigger && buildTrigger.ok ? 202 : 200, {
      ok: true,
      version: VERSION,
      baseFile: base.file,
      hash,
      approvedRows: Array.isArray(rows) ? rows.length : 0,
      eligibleRows: eligible,
      appliedSection: sectionKey || null,
      appliedAllSections: !sectionKey,
      operation: unpublishSelected
        ? "selected_front_unpublish"
        : actualApplyOperation
          ? "actual_front_apply"
          : (operation || "preview"),
      requestMethod: event.httpMethod,
      effectiveOperation: unpublishSelected
        ? "selected_front_unpublish"
        : actualApplyOperation
          ? "actual_front_apply"
          : (operation || "preview"),
      requestedCandidateIds: candidateIds.length,
      exactCandidateSelectionApplied:
        !unpublishSelected && candidateIds.length > 0,
      resolvedCandidateRows: Array.isArray(rows) ? rows.length : 0,
      resolvedCandidateIds: Array.isArray(rows)
        ? rows.map((row) => SocialStore.text(row && row.id)).filter(Boolean)
        : [],
      removedSlots: unpublish ? unpublish.removedSlots : 0,
      removedBySection: unpublish ? unpublish.removedBySection : {},
      releaseStored: !!stored,
      actualFrontApplyStored: !!stored && !unpublishSelected,
      actualFrontUnpublishStored: !!stored && unpublishSelected,
      actualFrontApplyQueued:
        !!stored && !!buildTrigger && buildTrigger.ok && !unpublishSelected,
      actualFrontUnpublishQueued:
        !!stored && !!buildTrigger && buildTrigger.ok && unpublishSelected,
      actualApplyRequested: actualApplyOperation,
      storeReleaseRequested: storeRelease,
      frontPublicationStatus: !storeRelease
        ? "preview_only"
        : buildTrigger && buildTrigger.ok
          ? "canonical_build_queued"
          : "release_stored_waiting_for_build",
      buildHook: buildHookStatus(),
      buildTrigger,
      stored,
      rotation,
      route,
      release:
        params.includeSnapshot === "1"
          ? release
          : Object.assign({}, release, { snapshot: undefined }),
      snapshot: params.includeSnapshot === "1" ? snapshot : undefined,
      safety: {
        runtimeFileWrite: false,
        socialSnapshotMutation: false,
        frontReadsLatestStoredSnapshot: false,
        canonicalBuildPipeline: true,
        publicSnapshotSource: "/data/social.snapshot.json",
        pipelineOrder: [
          "stored_social_release",
          "social_policy_and_psom_gate",
          "data/search-bank.snapshot.json",
          "existing_snapshot_engine",
          "data/social.snapshot.json",
          "existing_social_automap",
        ],
        sampleSlotsPreserved: true,
        selectedCandidatesReturnedToWaiting: unpublishSelected,
        externalProviderCalls: false,
        externalMembershipOverride: false,
      },
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, {
      ok: false,
      version: VERSION,
      error: error.code || "social_snapshot_publish_failed",
      message: error.message || String(error),
    });
  }
};
