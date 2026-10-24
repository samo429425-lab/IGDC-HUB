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
const ADMIN_COMMERCE_JS = path.join(ROOT, "assets", "js", "admin-commerce-country-control.js");

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
    if (patch.label === "canonical URL aliases" && (
        (source.includes("function canonicalSectionOf(item)") &&
         source.includes("function explicitAdminFrontPublication(item)")) ||
        (source.includes("function sectionOfSnapshotItem(item, fallback)") &&
         source.includes("function urlOfSnapshotItem(item)") &&
         source.includes("item.productUrl"))
      )) {
      continue;
    }
    const result = patch.mode === "all"
      ? replaceAllOrAlready(source, patch.before, patch.after, patch.label)
      : replaceOnceOrAlready(source, patch.before, patch.after, patch.label);
    source = result.source;
    changed = changed || result.changed;
  }

  mustContain(source, `item.productUrl`, "Snapshot Engine accepts productUrl");
  if (
    !source.includes("function canonicalSectionOf(item)") &&
    !source.includes("function sectionOfSnapshotItem(item, fallback)")
  ) {
    throw new Error("frontmap invariant missing: Snapshot Engine reads canonical placement section");
  }
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

// Keep the live administrator JS as the source of truth: patch only the
// synchronous Front-Match command lock while preserving all newer code.
function patchFrontMatchControl() {
  let source = read(ADMIN_COMMERCE_JS);
  if (source.includes("frontMatchCommandBusy=true;") && source.includes("maxAttempts=16")) return false;
  function replace(before, after, label) {
    const r = replaceOnceOrAlready(source, before, after, label);
    source = r.source;
  }
  replace("productAutomationActive||productFrontSyncActive||productSectionCleanupActive,matchBusy=busy",
    "productAutomationActive||productFrontSyncActive||productFrontSyncPreflightActive||frontMatchCommandBusy||frontMatchDeploymentBusy||productSectionCleanupActive,matchBusy=busy",
    "Front Match global busy lock");
  replace("productAutomationActive||productFrontSyncActive||productSectionCleanupActive,matchBusy=controlsBusy",
    "productAutomationActive||productFrontSyncActive||productFrontSyncPreflightActive||frontMatchCommandBusy||frontMatchDeploymentBusy||productSectionCleanupActive,matchBusy=controlsBusy",
    "Front Match section render lock");
  replace("    PRODUCT_SECTIONS.forEach(function(section){var ids=selectedProductIds(section.key)",
    "    // Lock section buttons already rendered on the page without a rerender.\n" +
    "    if(busy)Array.prototype.forEach.call(document.querySelectorAll('[data-section-front-match],[data-section-front-unmatch],[data-selected-products-front]'),function(button){button.disabled=true;});\n" +
    "    PRODUCT_SECTIONS.forEach(function(section){var ids=selectedProductIds(section.key)",
    "Front Match section button sync");
  // The passive snapshot verifier must hold the lock across asynchronous Netlify builds.
  const start = source.indexOf("  function startAutomaticFrontSnapshotCheck(");
  const end = source.indexOf("  var productFrontSyncPreflightActive=false;",start);
  if(start<0||end<=start)throw new Error("front match snapshot checker signature missing");
  let checker=source.slice(start,end);
  function once(before,after,label){
    if(!checker.includes(before))throw new Error("front match checker signature missing: "+label);
    checker=checker.replace(before,after);
  }
  once("    var attempt=0,maxAttempts=4;\n    async function check(){",
    "    var attempt=0,maxAttempts=16;\n" +
    "    function unlockDeployment(){\n" +
    "      if(token!==frontMatchSnapshotCheckEpoch)return;\n" +
    "      frontMatchDeploymentBusy=false;\n" +
    "      renderProducts(productRows);syncFrontSelectionControls();\n" +
    "    }\n" +
    "    async function check(){", "snapshot polling lock/release");
  checker=checker.replaceAll("if(token!==frontMatchSnapshotCheckEpoch||scopeKey()!==frozenScope)return;",
    "if(token!==frontMatchSnapshotCheckEpoch||scopeKey()!==frozenScope){unlockDeployment();return;}");
  once("          renderProducts(productRows);\n          return;",
    "          renderProducts(productRows);\n          unlockDeployment();return;", "empty target release");
  once("if(state)state.textContent=originalLabel+' · 매칭 해제 서버 저장 확인됨 · 프론트 상태 자동 조회 완료 (배포 완료 여부는 비동기)';\n          return;",
    "if(state)state.textContent=originalLabel+' · 매칭 해제 서버 저장 확인됨 · 프론트 상태 자동 조회 완료 (배포 완료 여부는 비동기)';\n          unlockDeployment();return;", "unmatch release");
  once("if(state){state.className='front-sync-state complete';state.textContent=originalLabel+' · 프론트 스냅샷 자동 확인 '+verified+'/'+ids.length+'건 · 추가 새로고침 불필요';}\n          return;",
    "if(state){state.className='front-sync-state complete';state.textContent=originalLabel+' · 프론트 스냅샷 자동 확인 '+verified+'/'+ids.length+'건 · 추가 새로고침 불필요';}\n          unlockDeployment();return;", "verified release");
  once("if(state)state.textContent=originalLabel+' · 자동 확인 '+verified+'/'+ids.length+'건 · 나머지는 배포/스냅샷 확인 대기 (추가 버튼 조작 불필요)';\n          return;",
    "if(state)state.textContent=originalLabel+' · 자동 확인 '+verified+'/'+ids.length+'건 · 나머지는 배포/스냅샷 확인 대기 (추가 버튼 조작 불필요)';\n          unlockDeployment();return;", "timeout release");
  once("if(attempt>=maxAttempts){if(state)state.textContent=originalLabel+' · 공개 요청 저장 확인됨 · 자동 스냅샷 조회 지연: '+text(error&&error.message);return;}",
    "if(attempt>=maxAttempts){if(state)state.textContent=originalLabel+' · 공개 요청 저장 확인됨 · 자동 스냅샷 조회 지연: '+text(error&&error.message);unlockDeployment();return;}", "failure release");
  source=source.slice(0,start)+checker+source.slice(end);
  replace("  var productFrontSyncPreflightActive=false;\n  async function runProductFrontSync(operation,mode,sectionKey,productId,selection){",
    "  var productFrontSyncPreflightActive=false;\n" +
    "  var frontMatchCommandBusy=false,frontMatchDeploymentBusy=false;\n" +
    "  async function runProductFrontSync(operation,mode,sectionKey,productId,selection){\n" +
    "    if(!selectedCountry||frontMatchCommandBusy||frontMatchDeploymentBusy||productFrontSyncActive||productFrontSyncPreflightActive)return;\n" +
    "    frontMatchCommandBusy=true;\n" +
    "    syncFrontSelectionControls();\n" +
    "    try{return await runProductFrontSyncCore(operation,mode,sectionKey,productId,selection);}\n" +
    "    finally{frontMatchCommandBusy=false;if(!frontMatchDeploymentBusy)renderProducts(productRows);syncFrontSelectionControls();}\n" +
    "  }\n" +
    "  async function runProductFrontSyncCore(operation,mode,sectionKey,productId,selection){",
    "click synchronously locks entire Front Match board");
  replace("      if(queued){\n        // Passive checking occurs after the current command has completed;",
    "      if(queued){\n        frontMatchDeploymentBusy=true;syncFrontSelectionControls();\n" +
    "        // Passive checking occurs after the current command has completed;",
    "lock while waiting for Netlify deploy");
  mustContain(source,"frontMatchCommandBusy=true", "Front Match synchronous lock");
  mustContain(source,"frontMatchDeploymentBusy=true", "Front Match deploy lock");
  atomicWrite(ADMIN_COMMERCE_JS,source);
  return true;
}

// Keep the existing administrator JS and HTML as the sources of truth.
// This paint-only follow-up runs after the established Front Match lock patch.
// It never changes business policy, country scopes, Supabase writes or build hooks.
function patchFrontMatchImmediatePaint() {
  let source=read(ADMIN_COMMERCE_JS);
  const helperName='function frontMatchImmediateLockV2()';
  if(!source.includes(helperName)){
    const helper=`  // Synchronously lock EVERY front command before costly ledger/DOM work.\n`+
      `  function frontMatchImmediateLockV2(){\n`+
      `    var selector='#productFrontMatchBtn,#productFrontUnmatchBtn,#selectedSectionsMatchBtn,#allSectionsMatchBtn,#selectedSectionsUnmatchBtn,#allSectionsUnmatchBtn,[data-section-front-match],[data-section-front-unmatch],[data-selected-products-front]';\n`+
      `    Array.prototype.forEach.call(document.querySelectorAll(selector),function(button){button.disabled=true;});\n`+
      `    var state=$('productFrontSyncState');\n`+
      `    if(state){state.className='front-sync-state running';state.textContent='프론트 매칭 준비 중 · 모든 프론트 매칭 버튼 잠금';}\n`+
      `  }\n`;
    const before='  var productFrontSyncPreflightActive=false;';
    if(!source.includes(before))throw new Error('Front Match preflight boundary not found for immediate lock');
    source=source.replace(before,helper+before);
  }
  const before=`    frontMatchCommandBusy=true;\n`+
    `    syncFrontSelectionControls();\n`+
    `    try{return await runProductFrontSyncCore(operation,mode,sectionKey,productId,selection);}`;
  const after=`    frontMatchCommandBusy=true;\n`+
    `    // Set disabled properties within the click event itself.  Yield one\n`+
    `    // browser paint opportunity before scanning the 249-market ledger.\n`+
    `    frontMatchImmediateLockV2();\n`+
    `    await new Promise(function(resolve){setTimeout(resolve,20);});\n`+
    `    syncFrontSelectionControls();\n`+
    `    try{return await runProductFrontSyncCore(operation,mode,sectionKey,productId,selection);}`;
  if(source.includes(before))source=source.replace(before,after);
  else if(!source.includes(after))throw new Error('Front Match click wrapper missing or conflicting');
  mustContain(source,'frontMatchImmediateLockV2();','Front Match immediate click lock');
  if(source!==read(ADMIN_COMMERCE_JS)){
    atomicWrite(ADMIN_COMMERCE_JS,source);
    return true;
  }
  return false;
}

// HTML must request the fingerprint of the exact built JS, not a static old
// ?build= value which can leave operators running a stale cached script.
function patchFrontMatchAssetFingerprint(){
  const htmlPath=path.join(ROOT,'commerce-country-control.html');
  const original=read(htmlPath);
  const digest=require('crypto').createHash('sha256').update(read(ADMIN_COMMERCE_JS)).digest('hex').slice(0,12);
  const asset='/assets/js/admin-commerce-country-control.js';
  const pattern=/(\/assets\/js\/admin-commerce-country-control\.js)\?(?:build|v)=[^"'\s<>]+/g;
  if(!original.includes(asset))throw new Error('Admin JS script src not found for fingerprint');
  const next=original.replace(pattern,asset+'?build=igdc-'+digest);
  if(next===original){
    // The HTML must already carry this exact fingerprint; a bare src or an
    // unknown loader form requires inspection rather than silent cache bugs.
    if(!original.includes(asset+'?build=igdc-'+digest))throw new Error('Admin JS build query not updated');
    return false;
  }
  atomicWrite(htmlPath,next);
  return true;
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
  const frontControlChanged=patchFrontMatchControl();
  const paintChanged=patchFrontMatchImmediatePaint();
  const cacheChanged=patchFrontMatchAssetFingerprint();
  console.log(
    "IGDC FrontMap repair OK" +
    " · snapshotEngine=" + (snapshotChanged ? "patched" : "ready") +
    " · adminReview=" + (reviewChanged ? "patched" : "ready") +
    " · routes=home_3,home_right_top,distribution-extra" +
    " · FrontMatchLock="+(frontControlChanged?"patched":"ready")+
    " · FrontMatchPaint="+(paintChanged?"patched":"ready")+
    " · AdminJsFingerprint="+(cacheChanged?"updated":"current")+
    " · mode=structural-transport-only"
  );
} catch (error) {
  console.error("IGDC FrontMap repair FAILED:", error && error.message || error);
  process.exit(85);
}
