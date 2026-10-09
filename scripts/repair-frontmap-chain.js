"use strict";

/**
 * IGDC FrontMap Chain Repair
 * Target: current 12:29-restored lineage + administrator->SearchBank bridge.
 *
 * Scope:
 *  - No policy/company/product re-judgement after administrator placement.
 *  - Preserve canonical product/image URL aliases through Snapshot Engine.
 *  - Restore HOME6 / distribution-extra publication whitelist coverage.
 *  - Ensure distribution-extra survives SearchBank -> Snapshot -> AutoMap.
 *  - Idempotent: repeated Netlify builds are safe.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_ENGINE = path.join(ROOT, "netlify", "functions", "snapshot-engine.js");
const REVIEW_API = path.join(ROOT, "netlify", "functions", "commerce-candidate-review.js");
const HOME_AUTOMAP = path.join(ROOT, "assets", "js", "home-products-automap.v2.js");
const DIST_AUTOMAP = path.join(ROOT, "assets", "js", "distribution-products-automap.v3.js");
const DIST_HTML = path.join(ROOT, "distributionhub.html");
const SEARCHBANK_ENGINE = path.join(ROOT, "netlify", "functions", "search-bank-engine.js");
const CANONICAL_PUBLISHER = path.join(ROOT, "netlify", "functions", "lib", "canonical-snapshot-publisher.v1.js");

function read(file) {
  if (!fs.existsSync(file)) throw new Error("required file missing: " + path.relative(ROOT, file));
  return fs.readFileSync(file, "utf8");
}

function atomicWrite(file, body) {
  const tmp = file + "." + process.pid + ".frontmap.tmp";
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
}

function replaceOnceOrAlready(source, before, after, label) {
  if (source.includes(after)) return { source, changed: false };
  if (!source.includes(before)) throw new Error("frontmap repair signature not found: " + label);
  return { source: source.replace(before, after), changed: true };
}

function replaceAllOrAlready(source, before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return { source, changed: false };
    throw new Error("frontmap repair signature not found: " + label);
  }
  return { source: source.split(before).join(after), changed: true };
}

function mustContain(source, token, label) {
  if (!source.includes(token)) throw new Error("frontmap invariant missing: " + label);
}

function patchSnapshotEngine() {
  let source = read(SNAPSHOT_ENGINE);
  let changed = false;

  const patches = [
    {
      mode: "once",
      label: "canonical URL aliases",
      before: `function urlOfSnapshotItem(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.url || item.link || item.href || item.video || item.videoUrl || "").trim();
}`,
      after: `function urlOfSnapshotItem(item) {
  if (!item || typeof item !== "object") return "";
  return String(
    item.affiliateOutboundUrl ||
    item.affiliate_outbound_url ||
    item.externalOutboundUrl ||
    item.external_outbound_url ||
    item.externalProductUrl ||
    item.officialProductUrl ||
    item.productUrl ||
    item.product_url ||
    item.productPageUrl ||
    item.detailUrl ||
    item.checkoutUrl ||
    item.purchaseUrl ||
    item.orderUrl ||
    item.productLink ||
    item.displayUrl ||
    item.sourceUrl ||
    item.source_url ||
    item.targetUrl ||
    item.target_url ||
    item.outboundUrl ||
    item.outbound_url ||
    item.url ||
    item.link ||
    item.href ||
    item.video ||
    item.videoUrl ||
    ""
  ).trim();
}`
    },
    {
      mode: "once",
      label: "canonical image aliases",
      before: `function imageOfSnapshotItem(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.thumbnail || item.thumb || item.image || item.poster || "").trim();
}`,
      after: `function imageOfSnapshotItem(item) {
  if (!item || typeof item !== "object") return "";
  return String(
    item.imageUrl ||
    item.imageOriginalUrl ||
    item.thumbnailUrl ||
    item.thumbnail_url ||
    item.thumbnail ||
    item.thumb ||
    item.image ||
    item.poster ||
    ""
  ).trim();
}`
    },
    {
      mode: "all",
      label: "raw card URL normalization",
      before: `url: raw.url || raw.link || "#",`,
      after: `url: urlOfSnapshotItem(raw) || "#",`
    },
    {
      mode: "all",
      label: "item card URL normalization",
      before: `url: item.url || item.link || "#",`,
      after: `url: urlOfSnapshotItem(item) || "#",`
    },
    {
      mode: "all",
      label: "raw card image normalization",
      before: `thumb:\n      raw.thumbnail ||\n      raw.thumb ||\n      raw.image ||\n      "/assets/img/placeholder.png",`,
      after: `thumb: imageOfSnapshotItem(raw) || "/assets/img/placeholder.png",`
    },
    {
      mode: "all",
      label: "item card image normalization",
      before: `thumb:\n        item.thumbnail ||\n        item.thumb ||\n        item.image ||\n        "/assets/img/placeholder.png",`,
      after: `thumb: imageOfSnapshotItem(item) || "/assets/img/placeholder.png",`
    },
    {
      mode: "all",
      label: "distribution-extra compact map",
      before: `"distribution-others": "distribution-others",\n      "dist_7": "distribution-right",`,
      after: `"distribution-others": "distribution-others",\n      "distribution-extra": "distribution-extra",\n      "dist_8": "distribution-extra",\n      "dist8": "distribution-extra",\n      "distribution_8": "distribution-extra",\n      "distribution8": "distribution-extra",\n      "dist_7": "distribution-right",`
    },
    {
      mode: "all",
      label: "distribution-extra wide map",
      before: `"distribution-others": "distribution-others",\n\n  // ===== right =====`,
      after: `"distribution-others": "distribution-others",\n\n  // ===== extra / outdoor / food =====\n  "distribution-extra": "distribution-extra",\n  "dist_8": "distribution-extra",\n  "dist8": "distribution-extra",\n  "distribution_8": "distribution-extra",\n  "distribution8": "distribution-extra",\n\n  // ===== right =====`
    }
  ];

  for (const patch of patches) {
    // Newer Snapshot Engine versions deliberately use the administrator/canonical
    // product detail route before affiliate/tracking aliases and centralize
    // section lookup in canonicalSectionOf(). Do not force the legacy URL helper
    // back over that newer contract during every Netlify build.
    if (patch.label === "canonical URL aliases" &&
        source.includes("function canonicalSectionOf(item)") &&
        source.includes("function explicitAdminFrontPublication(item)")) {
      continue;
    }
    const result = patch.mode === "all"
      ? replaceAllOrAlready(source, patch.before, patch.after, patch.label)
      : replaceOnceOrAlready(source, patch.before, patch.after, patch.label);
    source = result.source;
    changed = changed || result.changed;
  }

  mustContain(source, `item.productUrl`, "Snapshot Engine accepts productUrl");
  mustContain(source, `function canonicalSectionOf(item)`, "Snapshot Engine reads canonical placement section");
  mustContain(source, `item.imageUrl`, "Snapshot Engine accepts imageUrl");
  mustContain(source, `"distribution-extra": "distribution-extra"`, "distribution-extra canonical map");
  mustContain(source, `"main3": "home_3"`, "home_3 canonical route");
  mustContain(source, `"right_top": "home_right_top"`, "home_right_top route");

  if (changed) atomicWrite(SNAPSHOT_ENGINE, source);
  return changed;
}

function patchReviewApi() {
  let source = read(REVIEW_API);
  let changed = false;

  let result = replaceOnceOrAlready(
    source,
    `home:new Set(["home_1","home_2","home_3","home_4","home_5","home_right_top","home_right_middle","home_right_bottom"])`,
    `home:new Set(["home_1","home_2","home_3","home_4","home_5","home_6","home_right_top","home_right_middle","home_right_bottom"])`,
    "admin review HOME6 whitelist"
  );
  source = result.source;
  changed = changed || result.changed;

  result = replaceOnceOrAlready(
    source,
    `distribution:new Set(["distribution-recommend","distribution-sponsor","distribution-trending","distribution-new","distribution-special","distribution-others","distribution-right"])`,
    `distribution:new Set(["distribution-recommend","distribution-sponsor","distribution-trending","distribution-new","distribution-special","distribution-others","distribution-extra","distribution-right"])`,
    "admin review distribution-extra whitelist"
  );
  source = result.source;
  changed = changed || result.changed;

  mustContain(source, `"home_6"`, "admin review permits home_6");
  mustContain(source, `"distribution-extra"`, "admin review permits distribution-extra");

  if (changed) atomicWrite(REVIEW_API, source);
  return changed;
}

function validateExistingChain() {
  const home = read(HOME_AUTOMAP);
  mustContain(home, `const KEYS_MAIN = ['home_1', 'home_2', 'home_3', 'home_4', 'home_5', 'home_6'];`, "Home AutoMap main keys");
  mustContain(home, `const KEYS_RIGHT = ['home_right_top', 'home_right_middle', 'home_right_bottom'];`, "Home AutoMap right keys");

  const dist = read(DIST_AUTOMAP);
  mustContain(dist, `{key:'distribution-extra'`, "Distribution AutoMap extra section");

  const html = read(DIST_HTML);
  mustContain(html, `data-psom-key="distribution-extra"`, "Distribution page extra DOM slot");

  const bank = read(SEARCHBANK_ENGINE);
  mustContain(bank, `distribution-extra`, "SearchBank distribution-extra route");
  mustContain(bank, `home_right_top`, "SearchBank home_right_top route");
  mustContain(bank, `home_3`, "SearchBank home_3 route");

  const publisher = read(CANONICAL_PUBLISHER);
  mustContain(publisher, `distribution-extra`, "Canonical publisher distribution-extra route");
  mustContain(publisher, `home_right_top`, "Canonical publisher home_right_top route");
  mustContain(publisher, `home_3`, "Canonical publisher home_3 route");
}

try {
  const snapshotChanged = patchSnapshotEngine();
  const reviewChanged = patchReviewApi();
  validateExistingChain();
  console.log(
    "IGDC FrontMap repair OK" +
    " · snapshotEngine=" + (snapshotChanged ? "patched" : "ready") +
    " · adminReview=" + (reviewChanged ? "patched" : "ready") +
    " · routes=home_3,home_right_top,distribution-extra" +
    " · mode=structural-transport-only"
  );
} catch (error) {
  console.error("IGDC FrontMap repair FAILED:", error && error.message || error);
  process.exit(85);
}
