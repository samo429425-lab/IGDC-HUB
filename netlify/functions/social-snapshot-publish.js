"use strict";

/**
 * Builds and validates a Social release from approved Supabase candidates.
 * Runtime functions never write deployed static files. A confirmed release is
 * stored first, then the configured Netlify build hook runs the canonical line:
 * Social release -> SearchBank adapter -> Snapshot Engine -> social.snapshot.json.
 */
const fs = require("fs");
const path = require("path");
const SocialStore = require("./lib/social-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");
const CountryRouting = require("./lib/social-country-routing.v1");

const VERSION =
  "social-snapshot-publish-v1.4.0-canonical-searchbank-build-pipeline";
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
  return text(route && route.countryCode).toUpperCase() || "GLOBAL";
}
async function latestStoredBase(route) {
  try {
    const countryCode = text(route && route.countryCode).toUpperCase();
    const exactRows = await SocialStore.selectReleases(
      "select=release_id,snapshot,created_at,notes&status=eq.stored&notes=like." +
        encodeURIComponent("scope=" + scopeToken(route) + ";%") +
        "&order=created_at.desc&limit=1",
    );
    let latest = Array.isArray(exactRows) && exactRows[0];
    if (!latest && countryCode) {
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
      latest = exact || (countryCode ? global : null);
    }
    if (latest && latest.snapshot)
      return {
        file: "stored-current:" + latest.release_id,
        doc: latest.snapshot,
      };
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
  const names = [
    "SOCIAL_NETLIFY_BUILD_HOOK_URL",
    "IGDC_NETLIFY_BUILD_HOOK_URL",
    "NETLIFY_BUILD_HOOK_URL",
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
  };
}
async function triggerCanonicalBuild(release, operation) {
  const setting = buildHookSetting();
  if (!setting.value) {
    return {
      ok: false,
      status: "not_configured",
      requiredEnvironment: "SOCIAL_NETLIFY_BUILD_HOOK_URL",
      message:
        "승인본은 저장됐지만 정식 정적 스냅샷 배포를 시작할 Netlify Build Hook이 설정되지 않았습니다.",
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
        "정식 빌드가 접수됐습니다. 빌드에서 SearchBank 어댑터와 기존 Snapshot Engine이 실행됩니다.",
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
    const storeRelease =
      params.storeRelease === true || params.storeRelease === "true";
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
      rows = sectionKey
        ? (Array.isArray(allRows) ? allRows : []).filter(
            (row) => SocialStore.text(row && row.section_key) === sectionKey,
          )
        : allRows;
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
        : "actual_front_apply",
      requestedCandidateIds: candidateIds.length,
      removedSlots: unpublish ? unpublish.removedSlots : 0,
      removedBySection: unpublish ? unpublish.removedBySection : {},
      releaseStored: !!stored,
      actualFrontApplyStored: !!stored && !unpublishSelected,
      actualFrontUnpublishStored: !!stored && unpublishSelected,
      actualFrontApplyQueued:
        !!stored && !!buildTrigger && buildTrigger.ok && !unpublishSelected,
      actualFrontUnpublishQueued:
        !!stored && !!buildTrigger && buildTrigger.ok && unpublishSelected,
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
          "social_searchbank_release_adapter",
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
