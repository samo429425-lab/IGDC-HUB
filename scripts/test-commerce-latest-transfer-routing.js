"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = path.resolve(__dirname, "..");
const frontendPath = path.join(root, "assets/js/admin-commerce-country-control.js");
const backendPath = path.join(root, "netlify/functions/lib/commerce-country-automation.v1.js");
const htmlPath = path.join(root, "commerce-country-control.html");

const frontend = fs.readFileSync(frontendPath, "utf8");
const backend = fs.readFileSync(backendPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");

assert(frontend.includes("allStageBusy=hardBusy,hasRows=latestProductRows.length>0"), "latest-list whole-current-list buttons must not wait for research pause/complete");
assert(!frontend.includes("allStageBusy=hardBusy||productLoopActive||!queueReady"), "obsolete latest-list research-loop gate must be removed");
assert(frontend.includes("productDecision(row)==='undecided'&&wanted[productUrlMatchKey"), "latest AI fallback must only select active undecided candidates");
assert(frontend.includes("activeCandidateIds[id]=true"), "latest AI candidate IDs must be filtered against the active candidate ledger");
assert(frontend.includes("routedHold") && frontend.includes("routedReject"), "frontend must surface automatic hold/reject routing counts");
assert(frontend.includes("liveLatestExpected>latestProductRows.length"), "open latest-product panel must refresh as newly inspected rows are committed");
assert(frontend.includes("preserveOnFailure:true"), "pause/live latest refresh must preserve already loaded rows on transient failures");
assert(backend.includes('commerce-country-automation-v3.23.0-latest-transfer-routing'), "backend version must identify latest transfer routing patch");
assert(backend.includes("async function routeBlockedLatestProducts"), "blocked latest products must be routed into management state");
assert(backend.includes('schema:"igdc-product-research-partial-private-queue.v5"'), "chunked queue result must use routing-aware schema");
assert(html.includes("조사 진행 중에도 현재 목록의 선택 상품 또는 현재 목록 전체를 후보 관리목록으로 즉시 이관"), "operator help must describe live latest-list transfer behavior");
assert(html.includes("v=20260924-v16-transfer-routing"), "admin JS cache-bust version must be updated");

// Load the production backend in-place and export only the private classifier for
// deterministic regression checks. No production export surface is changed.
const compiledSource = backend + "\nmodule.exports.__latestTransferRoutingTest = { latestProductValidationDisposition };\n";
const testModule = new Module(backendPath, module);
testModule.filename = backendPath;
testModule.paths = Module._nodeModulePaths(path.dirname(backendPath));
testModule._compile(compiledSource, backendPath);
const classify = testModule.exports.__latestTransferRoutingTest.latestProductValidationDisposition;

const missingUrl = classify({
  productName: "Missing URL product",
  supplierName: "Supplier",
  inspectionComplete: true,
  riskAssessment: { specificProductUrl: false }
});
assert.strictEqual(missingUrl.decision, "reject", "missing/non-specific product URL must go to reject management");

const temporarilyUnavailable = classify({
  productName: "Temporarily unavailable product",
  productUrl: "https://shop.example.com/product/sku-12345",
  supplierName: "Supplier",
  supplierSiteUrl: "https://shop.example.com/",
  inspectionComplete: true,
  productPageLive: false,
  sameSupplierSite: true,
  riskAssessment: { specificProductUrl: true, explicitUnavailable: true }
});
assert.strictEqual(temporarilyUnavailable.decision, "hold", "temporarily unavailable but structurally specific product URL must go to hold management");

const wrongSupplierDomain = classify({
  productName: "Wrong-domain product",
  productUrl: "https://market.example.net/product/sku-9",
  supplierName: "Supplier",
  supplierSiteUrl: "https://shop.example.com/",
  inspectionComplete: true,
  productPageLive: true,
  sameSupplierSite: false,
  riskAssessment: { specificProductUrl: true }
});
assert.strictEqual(wrongSupplierDomain.decision, "reject", "supplier/product domain mismatch must go to reject management");

console.log("commerce latest transfer routing regression: OK");
