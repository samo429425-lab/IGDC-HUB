"use strict";

/**
 * Revenue ledger Supabase connector.
 *
 * One server-only resolver is shared by all confirmed non-PG revenue readers
 * and writers so the project URL and privileged key cannot drift between
 * endpoints. Browser/anon/publishable keys are never accepted here.
 */

const VERSION = "revenue-ledger-supabase-v1.0.0";
const DEFAULT_TIMEOUT_MS = 12000;

function clean(value){
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f\u200b\u200c\u200d\ufeff]/g, " ")
    .trim();
}
function firstEnv(env, names){
  for(const name of names){
    const value = clean(env && env[name]);
    if(value) return { name, value };
  }
  return { name:null, value:"" };
}
function normalizeUrl(value){
  const raw = clean(value).replace(/^[\s'"`]+|[\s'"`]+$/g, "").replace(/\/+$/, "");
  if(!raw) return "";
  try {
    const url = new URL(raw);
    if(url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    if(url.pathname && url.pathname !== "/") return "";
    return url.origin;
  } catch(_error){ return ""; }
}
function normalizeKey(value){
  let raw = clean(value);
  let normalized = false;
  for(let i=0;i<4;i++){
    const next = raw.replace(/^[\s'"`]+|[\s'"`]+$/g, "").trim();
    if(next === raw) break;
    raw = next;
    normalized = true;
  }
  const prefixed = raw.match(/^(?:bearer|apikey|api_key|service_role|secret|key)\s*[:=]\s*(.+)$/i);
  if(prefixed){ raw = prefixed[1].trim(); normalized = true; }
  return { key:clean(raw), normalized };
}
function decodeJwtPayload(token){
  const parts = String(token || "").split(".");
  if(parts.length !== 3) return null;
  try {
    let body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while(body.length % 4) body += "=";
    return JSON.parse(Buffer.from(body, "base64").toString("utf8"));
  } catch(_error){ return null; }
}
function projectRefFromUrl(urlText){
  try {
    const host = new URL(String(urlText || "")).hostname.toLowerCase();
    const ref = host.split(".")[0] || "";
    return /^[a-z0-9]{15,40}$/.test(ref) ? ref : "";
  } catch(_error){ return ""; }
}
function keyKind(key){
  const value = String(key || "");
  if(!value) return "missing";
  if(/^sb_secret_/i.test(value)) return "supabase_secret_key";
  if(/^sb_publishable_/i.test(value)) return "publishable_key_wrong_for_server";
  const payload = decodeJwtPayload(value);
  if(payload && clean(payload.role)) return "legacy_jwt_" + clean(payload.role).toLowerCase();
  if(value.split(".").length === 3) return "jwt_unreadable";
  return "unknown_server_key_format";
}
function resolveConfig(envInput){
  const env = envInput || process.env;
  const dedicatedUrlNames = ["REVENUE_LEDGER_SUPABASE_URL", "IGDC_REVENUE_SUPABASE_URL"];
  const dedicatedKeyNames = [
    "REVENUE_LEDGER_SUPABASE_SERVICE_ROLE_KEY",
    "REVENUE_LEDGER_SUPABASE_SECRET_KEY",
    "REVENUE_LEDGER_SUPABASE_SERVICE_KEY",
    "IGDC_REVENUE_SUPABASE_SERVICE_ROLE_KEY",
    "IGDC_REVENUE_SUPABASE_SECRET_KEY",
    "IGDC_REVENUE_SUPABASE_SERVICE_KEY"
  ];
  const sharedUrlNames = ["SUPABASE_URL"];
  const sharedKeyNames = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY"];

  const dedicatedUrl = firstEnv(env, dedicatedUrlNames);
  const dedicatedKey = firstEnv(env, dedicatedKeyNames);
  const dedicatedMode = !!(dedicatedUrl.value || dedicatedKey.value);
  const urlRecord = dedicatedMode ? dedicatedUrl : firstEnv(env, sharedUrlNames);
  const keyRecord = dedicatedMode ? dedicatedKey : firstEnv(env, sharedKeyNames);
  const url = normalizeUrl(urlRecord.value);
  const keyPack = normalizeKey(keyRecord.value);
  const key = keyPack.key;
  const kind = keyKind(key);
  const urlRef = projectRefFromUrl(url);
  const payload = decodeJwtPayload(key) || {};
  const keyRef = clean(payload.ref).toLowerCase();
  const role = clean(payload.role).toLowerCase();

  let errorCode = null;
  let errorMessage = null;
  if(!urlRecord.value || !keyRecord.value){
    errorCode = "revenue_ledger_config_missing";
    errorMessage = dedicatedMode
      ? "Revenue ledger dedicated Supabase URL/key pair is incomplete."
      : "Revenue ledger Supabase URL or privileged server key is missing.";
  } else if(!url){
    errorCode = "revenue_ledger_url_invalid";
    errorMessage = "Revenue ledger Supabase URL must be an HTTPS project origin.";
  } else if(!key){
    errorCode = "revenue_ledger_key_missing";
    errorMessage = "Revenue ledger privileged server key is missing.";
  } else if(kind === "publishable_key_wrong_for_server" || role === "anon" || role === "authenticated"){
    errorCode = "revenue_ledger_public_key_rejected";
    errorMessage = "A browser/public Supabase key cannot access the confirmed revenue ledger.";
  } else if(urlRef && keyRef && urlRef !== keyRef){
    errorCode = "revenue_ledger_url_key_project_mismatch";
    errorMessage = "Revenue ledger Supabase URL and privileged JWT key belong to different projects.";
  }

  return {
    version:VERSION,
    configured:!!(urlRecord.value && keyRecord.value),
    valid:!errorCode,
    dedicated:dedicatedMode,
    url,
    key,
    urlSource:urlRecord.name,
    keySource:keyRecord.name,
    keyKind:kind,
    keyNormalized:keyPack.normalized,
    urlProjectRef:urlRef || null,
    keyProjectRef:keyRef || null,
    keyRole:role || null,
    errorCode,
    errorMessage
  };
}
function describeConfig(config){
  const cfg = config || {};
  return {
    connectorVersion:VERSION,
    configured:cfg.configured === true,
    valid:cfg.valid === true,
    dedicated:cfg.dedicated === true,
    urlSource:cfg.urlSource || null,
    keySource:cfg.keySource || null,
    keyKind:cfg.keyKind || "missing",
    keyNormalized:cfg.keyNormalized === true,
    projectPairState:cfg.urlProjectRef && cfg.keyProjectRef
      ? (cfg.urlProjectRef === cfg.keyProjectRef ? "match" : "mismatch")
      : "not_decodable",
    errorCode:cfg.errorCode || null
  };
}
function safeMessage(value){
  return clean(value).replace(/\s+/g, " ").slice(0, 500);
}
function bodyMessage(body, fallback){
  if(body && typeof body === "object"){
    return safeMessage(body.message || body.error_description || body.error || body.hint || fallback);
  }
  return safeMessage(body || fallback);
}
function classifyHttp(status, body){
  const message = bodyMessage(body, "Supabase HTTP " + status);
  const low = message.toLowerCase();
  if(status === 401 || /invalid api key|invalid jwt|jwt expired|jwserror/.test(low)) return { errorCode:"revenue_ledger_key_invalid", errorMessage:message };
  if(status === 403 || /permission denied|42501|row-level security/.test(low)) return { errorCode:"revenue_ledger_permission_denied", errorMessage:message };
  if(status === 404 || /does not exist|schema cache|could not find/.test(low)) return { errorCode:"revenue_ledger_table_missing", errorMessage:message };
  return { errorCode:"revenue_ledger_supabase_http_error", errorMessage:message };
}
function classifyFetchError(error){
  const cause = error && error.cause || {};
  const code = clean(cause.code || error && error.code).toUpperCase();
  if(error && error.name === "AbortError") return { errorCode:"revenue_ledger_request_timeout", errorMessage:"Revenue ledger Supabase request timed out." };
  if(["ENOTFOUND","EAI_AGAIN"].includes(code)) return { errorCode:"revenue_ledger_dns_failed", errorMessage:"Revenue ledger Supabase host could not be resolved." };
  if(["ECONNREFUSED","ECONNRESET","ETIMEDOUT"].includes(code)) return { errorCode:"revenue_ledger_network_failed", errorMessage:"Revenue ledger Supabase network connection failed ("+code+")." };
  if(/CERT|TLS|SSL/.test(code)) return { errorCode:"revenue_ledger_tls_failed", errorMessage:"Revenue ledger Supabase TLS connection failed ("+code+")." };
  return { errorCode:"revenue_ledger_fetch_failed", errorMessage:safeMessage(error && error.message || "Revenue ledger Supabase fetch failed.") };
}
async function request(configInput, route, initInput){
  const config = configInput || resolveConfig();
  if(!config.configured || !config.valid){
    return {
      ok:false,
      unavailable:true,
      status:503,
      data:null,
      errorCode:config.errorCode || "revenue_ledger_config_missing",
      errorMessage:config.errorMessage || "Revenue ledger Supabase configuration is unavailable.",
      config:describeConfig(config)
    };
  }

  const init = Object.assign({}, initInput || {});
  const timeoutMs = Math.max(2000, Math.min(30000, Number(init.timeoutMs || process.env.REVENUE_LEDGER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
  delete init.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = Object.assign({}, init.headers || {}, {
    apikey:config.key,
    Authorization:"Bearer " + config.key,
    "content-type":"application/json"
  });
  try {
    const response = await fetch(config.url + route, Object.assign({}, init, { headers, signal:controller.signal }));
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch(_error){ data = raw || null; }
    if(!response.ok){
      const classified = classifyHttp(response.status, data);
      return {
        ok:false,
        unavailable:false,
        status:response.status,
        data,
        errorCode:classified.errorCode,
        errorMessage:classified.errorMessage,
        config:describeConfig(config)
      };
    }
    return { ok:true, unavailable:false, status:response.status, data, errorCode:null, errorMessage:null, config:describeConfig(config) };
  } catch(error){
    const classified = classifyFetchError(error);
    return {
      ok:false,
      unavailable:true,
      status:503,
      data:null,
      errorCode:classified.errorCode,
      errorMessage:classified.errorMessage,
      config:describeConfig(config)
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  VERSION,
  resolveConfig,
  describeConfig,
  request,
  normalizeUrl,
  normalizeKey,
  keyKind,
  projectRefFromUrl,
  decodeJwtPayload,
  classifyHttp,
  classifyFetchError
};
