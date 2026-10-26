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

const VERSION = "social-content-rotation-scheduler-v1.5.0-seven-parallel-candidate-publish";
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
  // Seven independent Social lanes advance together. Failure or timeout on
  // one SNS must not starve the later Snapchat/Bilibili/Douyin lanes.
  // Each lane owns one cursor and one bounded candidate write per scheduled run.
  const results = await Promise.allSettled(SECTIONS.map(async (sectionKey, i) => {
    let baselineCursor = cursorFor(i, startedAt);
    // A truly empty Bilibili/Douyin ledger gets the search query that has
    // previously returned verified direct content URLs in diagnostics. This
    // remains a best-effort read; errors leave the normal cursor untouched.
    if (/^social-(?:snapchat|bilibili|douyin)$/.test(sectionKey)) {
      try {
        const ledger = await Store.selectCandidates("select=id,raw&section_key=eq." + encodeURIComponent(sectionKey) + "&limit=100");
        if (Array.isArray(ledger) && !ledger.some((row) => Store.assetClassOf(row) === "latest_content")) baselineCursor = 0;
      } catch (_error) { /* Keep the ordinary rotating cursor. */ }
    }
    const response = await Collector.collectInternal({
      action: "collect_live", sectionKey, batchSize: 10, limit: 10,
      queryPasses: 1, queryCursor: baselineCursor, qualitySweep: true,
      contentFirst: true, registryOnly: false, registrySweepDone: true,
      scopeMode: "global", countryCode: "", regionId: "", scheduledRotation: true
    });
    const data = bodyOf(response);
    return {
      sectionKey, ok: !!data.ok,
      accepted: Number(data.accepted || 0), saved: Number(data.saved || 0),
      insertedLatestContent: Number(data.insertedLatestContent || 0),
      verifiedInsertedLatestContent: data.verifiedInsertedLatestContent == null ? null : Number(data.verifiedInsertedLatestContent),
      searchedRows: Number(data.liveCollection && data.liveCollection.searchedRows || 0),
      providerGroupName: data.liveCollection && data.liveCollection.providerGroupName || null,
      error: data.error || data.liveCollection && data.liveCollection.gateway && data.liveCollection.gateway.error || null
    };
  }));
  const runs = results.map((entry, i) => entry.status === "fulfilled"
    ? entry.value
    : { sectionKey: SECTIONS[i], ok: false, accepted: 0, saved: 0,
        searchedRows: 0, error: String(entry.reason && entry.reason.message || entry.reason) });

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
      ok: runs.every((row) => row.ok) && curation.ok && publishes.every((row) => row.ok),
      version: VERSION,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      strategy: "seven_parallel_psom_platform_content_first_then_verified_ledger_and_selective_ranked_runtime_publish",
      runs,
      preview,
      curation,
      publishes,
      netlifyRebuildRequired: false
    })
  };
};
