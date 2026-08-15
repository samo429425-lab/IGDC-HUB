"use strict";

/**
 * Thin, fail-safe bridge from an already-authorized product-slot approval to
 * the existing Netlify build publication pipeline. It never publishes a
 * snapshot itself and it never exposes the build hook URL.
 */

const VERSION = "commerce-release-dispatch-v1.3.1-patient-front-match-hook-retry";
const HOOK_ENVS = Object.freeze([
  "COMMERCE_RELEASE_BUILD_HOOK_URL",
  "NETLIFY_BUILD_HOOK_URL",
  "NETLIFY_DEPLOY_HOOK_URL",
  "BUILD_HOOK_URL"
]);
const HOOK_ENV = HOOK_ENVS.find((name) => String(process.env[name] || "").trim()) || HOOK_ENVS[0];
const MODE_ENV = "COMMERCE_CANDIDATE_RELEASE_MODE";
const KEY_ENV = "COMMERCE_CANDIDATE_RELEASE_KEY";

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase(); }
function configuredHook() {
  for (const name of HOOK_ENVS) {
    const value = text(process.env[name]);
    if (value) return { name, value };
  }
  return { name: HOOK_ENVS[0], value: "" };
}
function releaseArmed(input) {
  const mode = lower(process.env[MODE_ENV]);
  const key = text(process.env[KEY_ENV]);
  const environmentArmed = mode === "enabled" && key.length >= 32;
  const explicitAdminAuthorization = !!(input && input.explicitAdminAuthorization === true);
  return {
    armed: environmentArmed || explicitAdminAuthorization,
    mode: environmentArmed ? mode : (explicitAdminAuthorization ? "explicit_admin_confirmation" : mode),
    keyPresent: key.length >= 32,
    environmentArmed,
    explicitAdminAuthorization
  };
}
function validHook(raw) {
  try {
    const url = new URL(text(raw));
    return url.protocol === "https:" && url.hostname === "api.netlify.com" && /^\/build_hooks\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? url : null;
  } catch (_error) { return null; }
}
function safeReason(error) {
  const message = text(error && error.message || error);
  if (/abort|timeout/i.test(message)) return "build_hook_timeout";
  return "build_hook_request_failed";
}

async function dispatch(input) {
  const release = releaseArmed(input);
  const configured = configuredHook();
  if (!release.armed) {
    return { ok: true, queued: false, version: VERSION, reason: "release_gate_not_armed", releaseGate: release, hookConfigured: !!configured.value, hookSource: configured.value ? configured.name : null, attempts:0 };
  }
  const hook = validHook(configured.value);
  if (!hook) {
    return { ok: true, queued: false, version: VERSION, reason: configured.value ? "build_hook_invalid" : "build_hook_not_configured", releaseGate: release, hookConfigured: false, hookSource: configured.value ? configured.name : null, attempts:0 };
  }

  const fetchImpl = input && input.fetch || global.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, queued: false, version: VERSION, reason: "fetch_unavailable", releaseGate: release, hookConfigured: true, hookSource: configured.name, attempts:0 };
  }
  const candidateIds=Array.from(new Set((Array.isArray(input&&input.candidateIds)?input.candidateIds:[]).map(text).filter(Boolean))).slice(0,1800);
  const primaryCandidate=text(input&&input.candidateId)||candidateIds[0]||null;
  const payload = {
    trigger: text(input && input.operation) === "unpublish" ? "approved-commerce-unpublication" : "approved-commerce-assignment",
    candidateId: primaryCandidate,
    candidateIds,
    assignmentId: text(input && input.assignmentId) || null,
    actorId: text(input && input.actorId) || null,
    operation: text(input && input.operation) || "publish",
    candidateCount: Math.max(1, Number(input && input.candidateCount) || candidateIds.length || 1),
    authorization: release.explicitAdminAuthorization ? "explicit_admin_confirmation" : "deployment_release_gate",
    frontMatchBatch: candidateIds.length>0,
    requestedAt: new Date().toISOString()
  };
  let lastReason="build_hook_request_failed",lastStatus=null,lastError=null;
  for(let attempt=1;attempt<=2;attempt+=1){
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetchImpl(hook.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      lastStatus=response.status;
      const queued = response.status >= 200 && response.status < 300;
      if(queued){
        clearTimeout(timeout);
        return {ok:true,queued:true,version:VERSION,reason:"build_hook_queued",status:response.status,releaseGate:release,hookConfigured:true,hookSource:configured.name,attempts:attempt,candidateCount:payload.candidateCount};
      }
      lastReason="build_hook_http_"+response.status;
      if(response.status!==429 && response.status<500){
        clearTimeout(timeout);
        return {ok:false,queued:false,version:VERSION,reason:lastReason,status:response.status,releaseGate:release,hookConfigured:true,hookSource:configured.name,attempts:attempt,candidateCount:payload.candidateCount};
      }
    } catch (error) {
      lastError=error;
      lastReason=safeReason(error);
    } finally {
      clearTimeout(timeout);
    }
    if(attempt<2) await new Promise(resolve=>setTimeout(resolve,250));
  }
  return { ok:false, queued:false, version:VERSION, reason:lastReason, status:lastStatus, releaseGate:release, hookConfigured:true, hookSource:configured.name, attempts:2, candidateCount:payload.candidateCount, error:lastError?safeReason(lastError):null };
}
module.exports = { VERSION, HOOK_ENVS, HOOK_ENV, MODE_ENV, KEY_ENV, configuredHook, releaseArmed, validHook, dispatch };
