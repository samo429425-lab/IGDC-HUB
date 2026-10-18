"use strict";

/**
 * Scheduled Social refresh.
 * - Runs three times per week.
 * - Content research is PSOM/SearchBank/policy driven and independent of the influencer registry.
 * - Influencer rows are supplemental metadata discovered from validated content.
 * - Every run performs broad global discovery per SNS section.
 * - Publishes fresh GLOBAL and KR runtime releases without a Netlify rebuild.
 */
const Collector = require("./sanmaru-social-live-collector");
const Publisher = require("./social-snapshot-publish");
const Curator = require("./social-candidate-auto-curator");
const Actions = require("./social-candidate-action");
const Store = require("./lib/social-candidate-store.v1");

const VERSION = "social-content-rotation-scheduler-v1.4.0-bilibili-douyin-six";
const SECTIONS = [
  "social-youtube", "social-instagram", "social-tiktok", "social-facebook",
  "social-snapchat",
  "social-bilibili", "social-douyin"
];

function bodyOf(response) {
  try { return JSON.parse(response && response.body || "{}"); } catch (_e) { return {}; }
}
function cursorFor(sectionIndex, now) {
  const day = Math.floor(now.getTime() / 86400000);
  // providerGroup = queryCursor % 3. The old day*3 term locked each SNS to
  // the same provider group forever (for example a sparse platform could stay on one provider group
  // and never reached native group 0). Let the day itself participate so every
  // scheduled run rotates public-directory/native -> configured APIs ->
  // Sanmaru/SearchBank over time.
  return (day + sectionIndex * 7) % 240;
}

exports.handler = async function() {
  const startedAt = new Date();
  const runs = [];
  for (let i = 0; i < SECTIONS.length; i += 1) {
    const sectionKey = SECTIONS[i];
    const response = await Collector.collectInternal({
      action: "collect_live",
      sectionKey,
      batchSize: 10,
      limit: 10,
      // Each sparse-platform collector call now opens independent native,
      // public-search and SearchBank lanes in parallel. One rotating query is
      // enough per scheduled invocation and avoids rate-limit/timeout bursts.
      queryPasses: 1,
      queryCursor: cursorFor(i, startedAt),
      qualitySweep: true,
      contentFirst: true,
      registryOnly: false,
      registrySweepDone: true,
      scopeMode: "global",
      countryCode: "",
      regionId: "",
      scheduledRotation: true
    });
    const data = bodyOf(response);
    runs.push({
      sectionKey,
      ok: !!data.ok,
      accepted: Number(data.accepted || 0),
      saved: Number(data.saved || 0),
      searchedRows: Number(data.liveCollection && data.liveCollection.searchedRows || 0),
      providerGroupName: data.liveCollection && data.liveCollection.providerGroupName || null,
      error: data.error || null
    });
  }

  // Bounded existing-schedule thumbnail repair: at most 2 rows per SNS.
  // This path is Social-only and never invokes a public new scheduler route.
  const previewIds = [];
  for (const sectionKey of SECTIONS) {
    try {
      const rows = await Store.selectCandidates("select=*&section_key=eq." + encodeURIComponent(sectionKey) +
        "&order=updated_at.desc&limit=60");
      for (const row of (Array.isArray(rows) ? rows : [])) {
        if (previewIds.filter((id) => id.sectionKey === sectionKey).length >= 2) break;
        if (Store.assetClassOf(row) !== "latest_content" || Store.publishableThumbnail(row)) continue;
        if (/^(hold|held|blocked|permanent_blocked|search_excluded|rejected|replacement_requested|replacement_waiting)$/i.test(String(row.review_status || ""))) continue;
        if (!Store.platformContentUrl(row.platform, row.source_url || (row.raw && row.raw.latestContentUrl))) continue;
        if (row.id) previewIds.push({ id: row.id, sectionKey });
      }
    } catch (_error) { /* Preserve other sections and the current durable release. */ }
  }
  let preview = { ok: true, requested: previewIds.length, updated: 0 };
  if (previewIds.length) {
    try {
      const result = bodyOf(await Actions.hydratePreviewInternal(previewIds.map((row) => row.id)));
      preview = { ok: result.ok === true, requested: previewIds.length, updated: Number(result.updated || 0), error: result.error || null };
    } catch (error) { preview = { ok: false, requested: previewIds.length, updated: 0, error: String(error && error.message || error) }; }
  }

  // New discoveries arrive pending; the previous scheduler published immediately
  // and could never surface newly eligible content in the same operation.
  let curation = { ok: false, error: "not_run" };
  try {
    const reviewed = bodyOf(await Curator.curateInternal({ scopeMode: "global", countryCode: "" }));
    curation = { ok: reviewed.ok === true, updated: reviewed.updated || 0,
      latestContentPools: Object.fromEntries(Object.entries(reviewed.bySection || {}).map(([key, value]) =>
        [key, Number(value && value.latestContentPool || 0)])),
      error: reviewed.error || null };
  } catch (error) {
    curation = { ok: false, error: String(error && error.message || error) };
  }

  const publishes = [];
  for (const scope of [
    { scopeMode: "global", countryCode: "" },
    { scopeMode: "country", countryCode: "KR" }
  ]) {
    const response = await Publisher.publishInternal({
      operation: "actual_front_apply",
      confirmPublish: true,
      storeRelease: true,
      scopeMode: scope.scopeMode,
      countryCode: scope.countryCode,
      scheduledRotation: true,
      forceBuild: false
    });
    const data = bodyOf(response);
    publishes.push({
      scope: scope.countryCode || "GLOBAL",
      ok: !!data.ok,
      noChange: !!data.noChange,
      releaseId: data.releaseId || null,
      publicationPlanCount: Number(data.publicationPlanCount || 0),
      error: data.error || null
    });
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: runs.some((row) => row.ok) && curation.ok && publishes.every((row) => row.ok),
      version: VERSION,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      strategy: "psom_searchbank_content_first_plus_platform_discovery_then_runtime_publish",
      runs,
      preview,
      curation,
      publishes,
      netlifyRebuildRequired: false
    })
  };
};
