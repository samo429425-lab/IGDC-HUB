"use strict";

/**
 * Thin, fail-safe bridge from an already-authorized product-slot approval to
 * the existing Netlify build publication pipeline. It never publishes a
 * snapshot itself and it never exposes the build hook URL.
 */

const VERSION = "commerce-release-dispatch-v1.1.0-explicit-admin-or-deployment-gate";
const HOOK_ENV = "COMMERCE_RELEASE_BUILD_HOOK_URL";
const MODE_ENV = "COMMERCE_CANDIDATE_RELEASE_MODE";
const KEY_ENV = "COMMERCE_CANDIDATE_RELEASE_KEY";

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase(); }
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
  if (!release.armed) {
    return { ok: true, queued: false, version: VERSION, reason: "release_gate_not_armed", releaseGate: release, hookConfigured: !!text(process.env[HOOK_ENV]) };
  }
  const hook = validHook(process.env[HOOK_ENV]);
  if (!hook) {
    return { ok: true, queued: false, version: VERSION, reason: text(process.env[HOOK_ENV]) ? "build_hook_invalid" : "build_hook_not_configured", releaseGate: release, hookConfigured: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const fetchImpl = input && input.fetch || global.fetch;
  if (typeof fetchImpl !== "function") {
    clearTimeout(timeout);
    return { ok: false, queued: false, version: VERSION, reason: "fetch_unavailable", releaseGate: release, hookConfigured: true };
  }
  const payload = {
    trigger: text(input && input.operation) === "unpublish" ? "approved-commerce-unpublication" : "approved-commerce-assignment",
    candidateId: text(input && input.candidateId) || null,
    assignmentId: text(input && input.assignmentId) || null,
    actorId: text(input && input.actorId) || null,
    operation: text(input && input.operation) || "publish",
    candidateCount: Math.max(1, Number(input && input.candidateCount) || 1),
    authorization: release.explicitAdminAuthorization ? "explicit_admin_confirmation" : "deployment_release_gate",
    requestedAt: new Date().toISOString()
  };
  try {
    const response = await fetchImpl(hook.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const queued = response.status >= 200 && response.status < 300;
    return {
      ok: queued,
      queued,
      version: VERSION,
      reason: queued ? "build_hook_queued" : "build_hook_http_" + response.status,
      status: response.status,
      releaseGate: release,
      hookConfigured: true
    };
  } catch (error) {
    return { ok: false, queued: false, version: VERSION, reason: safeReason(error), releaseGate: release, hookConfigured: true };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { VERSION, HOOK_ENV, MODE_ENV, KEY_ENV, releaseArmed, validHook, dispatch };
