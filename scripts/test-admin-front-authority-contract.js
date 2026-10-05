"use strict";
const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
function read(p){return fs.readFileSync(path.join(root,p),"utf8");}
function must(ok,msg){if(!ok)throw new Error(msg);}
const automation=read("netlify/functions/lib/commerce-country-automation.v1.js");
const intake=read("netlify/functions/lib/commerce-candidate-intake.v1.js");
const canonical=read("netlify/functions/lib/canonical-snapshot-publisher.v1.js");
const build=read("scripts/build-regional-brokerage-snapshots.js");
const ip=read("netlify/functions/lib/ip-slot-snapshot-publisher.v1.js");
const prep=automation.slice(automation.indexOf("async function prepareProductFrontTargets("),automation.indexOf("async function productFrontReplacementPlan("));
must(prep.includes("admin-ledger-to-front-publish-only"),"publish-only preparation missing");
must(!prep.includes("gslot_candidate_availability"),"Front Match must not rewrite availability evidence");
must(!prep.includes("gslot_candidate_revenue"),"Front Match must not rewrite revenue evidence");
must(!prep.includes("gslot_candidate_evidence"),"Front Match must not rewrite trust evidence");
must(prep.includes('publication_status:"publish_requested"'),"Front Match must persist publication request");
must(automation.includes('if (sourceDecision !== "slot_candidate") continue;'),"current administrator placement must control target selection");
must(intake.includes("administratorTransportBlockers"),"explicit admin intake transport-only gate missing");
must(canonical.includes("authoritativeAdminPublication"),"canonical admin-authority bypass missing");
must(build.includes("ADMIN_FRONT_MATCH_EMPTY_PUBLICATION_FORBIDDEN"),"old/sample reverse fallback is not blocked");
must(ip.includes('page === "tour" ? 200'),"Tour 200-slot output capacity missing");
must(ip.includes('key === "distribution-extra" ? 100'),"distribution-extra 100-slot output capacity missing");
console.log("IGDC admin-front authority contract: OK");
