"use strict";

/**
 * Same-origin thumbnail relay for Social Hub provider previews.
 * It is intentionally limited to provider-owned public image URLs that have
 * already passed social-preview-metadata validation. If a stored signed image
 * has expired, it resolves a fresh public preview from the original content URL.
 * No candidate, snapshot, Distribution or Media state is mutated here.
 */
const Preview = require("./social-preview-metadata");

const VERSION = "social-thumbnail-proxy-v1.0.0-provider-preview-relay";
const SUPPORTED = new Set(["instagram", "tiktok", "facebook"]);
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 5500;

function text(value) { return value == null ? "" : String(value).trim(); }
function platformOf(value) {
  const p = text(value).toLowerCase().replace(/^social-/, "").replace(/^x$/, "twitter");
  return SUPPORTED.has(p) ? p : "";
}
function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(Object.assign({ version: VERSION }, body || {})),
  };
}
function validatedThumb(platform, value) {
  if (!platform || !Preview || typeof Preview.previewImageUrl !== "function") return "";
  return text(Preview.previewImageUrl(platform, value));
}
function validatedContent(platform, value) {
  try {
    const fn = Preview && Preview.__test && Preview.__test.safeProviderUrl;
    return typeof fn === "function" ? text(fn(platform, value)) : "";
  } catch (_error) { return ""; }
}
async function fetchImage(platform, value) {
  const safe = validatedThumb(platform, value);
  if (!safe) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(safe, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
        referer: "https://igdcglobal.com/",
      },
    });
    if (!response.ok) return null;
    const finalUrl = validatedThumb(platform, response.url || safe);
    if (!finalUrl) return null;
    const type = text(response.headers.get("content-type")).toLowerCase().split(";")[0];
    if (!/^image\//.test(type)) return null;
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return null;
    return { buffer, type, source: finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async function handler(event) {
  if (!event || event.httpMethod !== "GET") return json(405, { ok: false, error: "method_not_allowed" });
  const q = event.queryStringParameters || {};
  const platform = platformOf(q.platform);
  if (!platform) return json(400, { ok: false, error: "invalid_platform" });
  const contentUrl = validatedContent(platform, q.url);
  let storedThumb = validatedThumb(platform, q.thumb);

  try {
    let result = storedThumb ? await fetchImage(platform, storedThumb) : null;
    if (!result && contentUrl && Preview && typeof Preview.resolvePreview === "function") {
      const fresh = await Preview.resolvePreview(platform, contentUrl);
      const freshThumb = validatedThumb(platform, fresh && fresh.thumbnailUrl);
      if (freshThumb) result = await fetchImage(platform, freshThumb);
    }
    if (!result) return json(404, { ok: false, error: "thumbnail_unavailable" });
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "content-type": result.type,
        "cache-control": "public, max-age=900, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
        "access-control-allow-origin": "*",
        "x-igdc-social-thumbnail": platform,
      },
      body: result.buffer.toString("base64"),
    };
  } catch (error) {
    return json(404, { ok: false, error: "thumbnail_fetch_failed", detail: text(error && error.name || "fetch_error") });
  }
};
