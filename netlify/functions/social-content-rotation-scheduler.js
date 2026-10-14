"use strict";

/**
 * Scheduled Social refresh.
 * - Runs three times per week.
 * - Registered influencers are priority seeds, not exclusive sources.
 * - Every run also performs broad global discovery per SNS section.
 * - Publishes fresh GLOBAL and KR runtime releases without a Netlify rebuild.
 */
const Collector = require("./sanmaru-social-live-collector");
const Publisher = require("./social-snapshot-publish");

const VERSION = "social-content-rotation-scheduler-v1.2.0-bounded-provider-research";
const SECTIONS = [
  "social-youtube", "social-instagram", "social-tiktok", "social-facebook",
  "social-douyin", "social-dailymotion"
];

function bodyOf(response) {
  try { return JSON.parse(response && response.body || "{}"); } catch (_e) { return {}; }
}
function cursorFor(sectionIndex, now) {
  const day = Math.floor(now.getTime() / 86400000);
  // providerGroup = queryCursor % 3. The old day*3 term locked each SNS to
  // the same provider group forever (for example Dailymotion stayed on group 2
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
      ok: runs.some((row) => row.ok) && publishes.every((row) => row.ok),
      version: VERSION,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      strategy: "priority_registry_plus_broad_global_discovery_then_runtime_publish",
      runs,
      publishes,
      netlifyRebuildRequired: false
    })
  };
};
