"use strict";

/*
 * Commerce-candidate administrator authentication.
 *
 * This private queue verifier accepts a signed ID token only when its audience
 * matches a server-side Netlify environment setting. No identifier value,
 * secret, API key, or token is embedded in deployable source.
 */
const crypto = require("crypto");

const VERSION = "commerce-candidate-auth-v1.0.1-server-audience-only";
const DEFAULT_ISSUER_HOST = "login.igdcglobal.com";
const JWKS_CACHE = { value: null, expiresAt: 0, issuer: "" };

function text(value) { return value == null ? "" : String(value).trim(); }
function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function unique(values) {
  return Array.from(new Set((values || []).map(text).filter(Boolean)));
}
function b64urlToBuffer(value) {
  let input = text(value).replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  return Buffer.from(input, "base64");
}
function decodeJson(value) { return JSON.parse(b64urlToBuffer(value).toString("utf8")); }
function normalizeRole(value) { return text(value).toLowerCase().replace(/\s+/g, "_"); }

function config() {
  const domain = text(process.env.AUTH0_DOMAIN || DEFAULT_ISSUER_HOST)
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const issuer = text(process.env.AUTH0_ISSUER || `https://${domain}/`).replace(/\/?$/, "/");
  const audiences = unique([
    process.env.COMMERCE_CANDIDATE_AUTH_AUDIENCE,
    process.env.AUTH0_SPA_CLIENT_ID,
    process.env.IGDC_AUTH0_SPA_CLIENT_ID,
    process.env.AUTH0_CLIENT_ID
  ]);
  if (!domain || !issuer || !audiences.length) {
    throw fail(503, "commerce_auth_not_configured", "Commerce candidate authentication is not configured.");
  }
  return {
    domain,
    issuer,
    audiences,
    rolesClaim: text(process.env.AUTH0_ROLES_CLAIM || "https://igdcglobal.com/roles")
  };
}

function authorizationToken(event) {
  const headers = event && event.headers || {};
  const raw = text(headers.authorization || headers.Authorization);
  if (!/^Bearer\s+/i.test(raw)) throw fail(401, "member_login_required", "관리자 로그인이 필요합니다.");
  return raw.replace(/^Bearer\s+/i, "").trim();
}

async function jwks(settings) {
  if (JWKS_CACHE.value && JWKS_CACHE.expiresAt > Date.now() && JWKS_CACHE.issuer === settings.issuer) return JWKS_CACHE.value;
  let response;
  try {
    response = await fetch(`https://${settings.domain}/.well-known/jwks.json`, { headers: { Accept: "application/json" } });
  } catch (_error) {
    throw fail(401, "member_token_invalid", "관리자 세션 서명 키를 확인하지 못했습니다.");
  }
  if (!response.ok) throw fail(401, "member_token_invalid", "관리자 세션 서명 키를 확인하지 못했습니다.");
  const value = await response.json();
  if (!value || !Array.isArray(value.keys)) throw fail(401, "member_token_invalid", "관리자 세션 서명 키가 올바르지 않습니다.");
  JWKS_CACHE.value = value;
  JWKS_CACHE.expiresAt = Date.now() + 60 * 60 * 1000;
  JWKS_CACHE.issuer = settings.issuer;
  return value;
}

function rolesFor(payload, settings) {
  const values = [];
  [settings.rolesClaim, "https://igdcglobal.com/roles", "https://example.com/roles", "roles", "role", "permissions"].forEach((key) => {
    const value = payload && payload[key];
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === "string") values.push(...value.split(","));
  });
  return unique(values.map(normalizeRole));
}

async function authenticateCommerceAdmin(event) {
  const settings = config();
  const token = authorizationToken(event);
  const parts = token.split(".");
  if (parts.length !== 3) throw fail(401, "member_token_invalid", "Invalid member session.");

  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch (_error) {
    throw fail(401, "member_token_invalid", "Invalid member session.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!header || header.alg !== "RS256" || !header.kid || !payload || !text(payload.sub)) {
    throw fail(401, "member_token_invalid", "Invalid member session.");
  }
  if ((payload.exp && Number(payload.exp) <= now) || (payload.nbf && Number(payload.nbf) > now + 30)) {
    throw fail(401, "member_token_expired", "관리자 로그인이 만료되었습니다.");
  }
  if (text(payload.iss) !== settings.issuer) {
    throw fail(401, "member_token_invalid", "Invalid member session issuer.");
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud.map(text) : [text(payload.aud)];
  if (!audiences.some((value) => settings.audiences.includes(value))) {
    throw fail(401, "member_token_invalid", "Invalid member session audience.");
  }

  const keys = await jwks(settings);
  const jwk = keys.keys.find((entry) => entry && entry.kid === header.kid);
  if (!jwk) throw fail(401, "member_token_invalid", "관리자 세션 서명 키가 현재 키와 일치하지 않습니다.");

  try {
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(`${parts[0]}.${parts[1]}`);
    verify.end();
    if (!verify.verify(key, b64urlToBuffer(parts[2]))) throw new Error("signature");
  } catch (_error) {
    throw fail(401, "member_token_invalid", "Invalid member session signature.");
  }

  return {
    memberId: text(payload.sub),
    email: text(payload.email),
    name: text(payload.name || payload.nickname),
    roles: rolesFor(payload, settings),
    tokenAudience: audiences.find((value) => settings.audiences.includes(value)) || null,
    issuer: settings.issuer
  };
}

module.exports = { VERSION, authenticateCommerceAdmin, config };