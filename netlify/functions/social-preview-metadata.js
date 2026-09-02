"use strict";

/*
 * IGDC Social main-card public preview resolver v1.0.0
 * Scope: Social main 9 sections only. This function never reads/writes rightPanel,
 * Distribution, snapshots, releases, candidate state, or deployment state.
 *
 * Purpose: recover public title/thumbnail metadata for already-published SNS content
 * when the provider/search result did not persist a usable preview image.
 */

const VERSION = "social-preview-metadata-v1.1.0-provider-embed-preview";
const TIMEOUT_MS = 2200;
const MAX_HTML_BYTES = 900000;

const PLATFORM_HOSTS = Object.freeze({
  youtube: [/(^|\.)youtube(?:-nocookie)?\.com$/i, /(^|\.)youtu\.be$/i],
  instagram: [/(^|\.)instagram\.com$/i],
  tiktok: [/(^|\.)tiktok\.com$/i],
  facebook: [/(^|\.)facebook\.com$/i, /^fb\.watch$/i],
  wechat: [/^mp\.weixin\.qq\.com$/i],
  weibo: [/(^|\.)weibo\.com$/i, /^m\.weibo\.cn$/i],
  pinterest: [/(^|\.)pinterest\.(?:com|ca|co\.uk|co\.kr|de|fr|es|it|jp|com\.au|com\.mx|cl|ph|nz|pt|ie|ch|at|se|dk|no|fi|nl|be|cz|pl)$/i, /^pin\.it$/i],
  reddit: [/(^|\.)reddit\.com$/i, /^redd\.it$/i],
  twitter: [/(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i]
});

function json(statusCode, body, cacheable) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheable
        ? "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400"
        : "no-store",
      "x-content-type-options": "nosniff"
    },
    body: JSON.stringify(Object.assign({ version: VERSION }, body || {}))
  };
}

function text(value) { return value == null ? "" : String(value); }

function normalizePlatform(value) {
  const raw = text(value).trim().toLowerCase();
  if (raw === "x") return "twitter";
  return Object.prototype.hasOwnProperty.call(PLATFORM_HOSTS, raw) ? raw : "";
}

function safeProviderUrl(platform, value) {
  try {
    const url = new URL(text(value).trim());
    if (url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    if (url.port && url.port !== "443") return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const rules = PLATFORM_HOSTS[platform] || [];
    if (!rules.some((rule) => rule.test(host))) return "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function decodeHtml(value) {
  return text(value)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\\//g, "/")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch (_e) { return _m; }
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch (_e) { return _m; }
    })
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(text(value).replace(/<[^>]*>/g, " "));
}

function attrValue(tag, name) {
  const re = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*([\\\"'])([\\s\\S]*?)\\1", "i");
  const match = text(tag).match(re);
  return match ? decodeHtml(match[2]) : "";
}

function metaMap(html) {
  const result = Object.create(null);
  const tags = text(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (attrValue(tag, "property") || attrValue(tag, "name") || attrValue(tag, "itemprop")).toLowerCase();
    const content = attrValue(tag, "content");
    if (key && content && !result[key]) result[key] = content;
  }
  return result;
}

function firstMeta(meta, keys) {
  for (const key of keys) {
    const value = text(meta && meta[key]).trim();
    if (value) return value;
  }
  return "";
}

function htmlTitle(html) {
  const meta = metaMap(html);
  const fromMeta = firstMeta(meta, ["og:title", "twitter:title", "title"]);
  if (fromMeta) return stripTags(fromMeta);
  const match = text(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : "";
}

function htmlImage(html) {
  const meta = metaMap(html);
  let image = firstMeta(meta, [
    "og:image:secure_url", "og:image", "twitter:image", "twitter:image:src",
    "thumbnailurl", "thumbnail", "image"
  ]);
  if (image && /^https:\/\//i.test(image)) return decodeHtml(image);

  const raw = text(html);
  const patterns = [
    /"(?:thumbnail_url|thumbnailUrl|display_url|displayUrl|image_url|imageUrl|preferred_thumbnail)"\s*:\s*"(https:[^"<>]+)"/i,
    /"(?:uri|src)"\s*:\s*"(https:\\?\/\\?\/[^"<>]+(?:fbcdn\.net|cdninstagram\.com|tiktokcdn[^/]*\.com|pinimg\.com|twimg\.com|redditmedia\.com)[^"<>]*)"/i,
    /(?:poster|data-poster|data-thumb|data-thumbnail)=["'](https:\/\/[^"'<>]+)["']/i,
    /background-image\s*:\s*url\(["']?(https:\/\/[^"')<>]+)["']?\)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      image = decodeHtml(match[1]);
      if (/^https:\/\//i.test(image)) return image;
    }
  }

  // Last-resort CDN URL scan. Keep the host close to the scheme so arbitrary
  // page text cannot be mistaken for an image URL.
  const generic = raw.match(/https:\\?\/\\?\/(?:[^"'<>\s\/]+\.)?(?:fbcdn\.net|cdninstagram\.com|tiktokcdn[^/]*\.com|pinimg\.com|twimg\.com|redditmedia\.com)[^"'<>\s]*/i);
  if (generic && generic[0]) {
    image = decodeHtml(generic[0]);
    if (/^https:\/\//i.test(image)) return image;
  }
  return "";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProviderHtml(platform, initialUrl) {
  let current = safeProviderUrl(platform, initialUrl);
  if (!current) return { url: "", html: "" };

  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetchWithTimeout(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.8"
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers && response.headers.get ? response.headers.get("location") : "";
      if (!location) return { url: current, html: "" };
      const target = safeProviderUrl(platform, new URL(location, current).toString());
      if (!target) return { url: current, html: "" };
      current = target;
      continue;
    }

    if (!response.ok) return { url: current, html: "" };
    let html = await response.text();
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);
    return { url: current, html };
  }
  return { url: current, html: "" };
}

async function fetchJson(url) {
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      redirect: "error",
      headers: {
        "accept": "application/json,text/plain;q=0.9,*/*;q=0.2",
        "user-agent": "IGDC-SocialPreview/1.0"
      }
    }, 1800);
    if (!response.ok) return null;
    return await response.json();
  } catch (_error) {
    return null;
  }
}

async function oembed(platform, contentUrl) {
  let endpoint = "";
  if (platform === "tiktok") endpoint = "https://www.tiktok.com/oembed?url=" + encodeURIComponent(contentUrl);
  else if (platform === "twitter") endpoint = "https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=" + encodeURIComponent(contentUrl);
  else if (platform === "reddit") endpoint = "https://www.reddit.com/oembed?url=" + encodeURIComponent(contentUrl);
  else if (platform === "pinterest") endpoint = "https://www.pinterest.com/oembed.json?url=" + encodeURIComponent(contentUrl);
  else return null;
  return fetchJson(endpoint);
}

function youtubeThumbnail(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = parsed.pathname.split("/")[1] || "";
    else if (/youtube(?:-nocookie)?\.com$/.test(host)) {
      id = parsed.searchParams.get("v") || "";
      if (!id) {
        const match = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
        if (match) id = match[1];
      }
    }
    return id ? "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg" : "";
  } catch (_error) { return ""; }
}

function facebookIsVideo(url) {
  return /\/(?:reel|watch|videos?)\//i.test(url) || /[?&](?:v|video_id)=\d+/i.test(url) || /fb\.watch/i.test(url);
}
function providerEmbedPreviewUrl(platform, contentUrl) {
  try {
    const parsed = new URL(contentUrl);
    if (platform === "facebook") {
      const base = facebookIsVideo(contentUrl)
        ? "https://www.facebook.com/plugins/video.php"
        : "https://www.facebook.com/plugins/post.php";
      return base + "?" + new URLSearchParams({
        href: contentUrl,
        show_text: facebookIsVideo(contentUrl) ? "false" : "true",
        autoplay: "false",
        width: "750"
      }).toString();
    }
    if (platform === "instagram") {
      const match = parsed.pathname.match(/^\/(p|reel|reels|tv)\/([^/?#]+)/i);
      if (!match) return "";
      const kind = match[1].toLowerCase() === "reels" ? "reel" : match[1].toLowerCase();
      return "https://www.instagram.com/" + kind + "/" + match[2] + "/embed/";
    }
  } catch (_error) {}
  return "";
}
async function fetchEmbedPreview(platform, contentUrl) {
  const embedUrl = providerEmbedPreviewUrl(platform, contentUrl);
  if (!embedUrl) return { title: "", thumbnailUrl: "", source: "" };
  try {
    const response = await fetchWithTimeout(embedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.8"
      }
    }, TIMEOUT_MS);
    if (!response.ok) return { title: "", thumbnailUrl: "", source: "embed-http-" + response.status };
    let html = await response.text();
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);
    return {
      title: htmlTitle(html),
      thumbnailUrl: htmlImage(html),
      source: "provider-embed-meta"
    };
  } catch (_error) {
    return { title: "", thumbnailUrl: "", source: "embed-error" };
  }
}

async function resolvePreview(platform, contentUrl) {
  if (platform === "youtube") {
    return { resolvedUrl: contentUrl, title: "", thumbnailUrl: youtubeThumbnail(contentUrl), source: "youtube-id" };
  }

  const oe = await oembed(platform, contentUrl);
  const oeTitle = stripTags(oe && (oe.title || oe.author_name || ""));
  const oeThumb = decodeHtml(oe && (oe.thumbnail_url || oe.thumbnailUrl || ""));
  if (oeThumb && /^https:\/\//i.test(oeThumb)) {
    return { resolvedUrl: contentUrl, title: oeTitle, thumbnailUrl: oeThumb, source: "oembed" };
  }

  // Facebook/Instagram often hide og:image from anonymous canonical-page
  // requests while their official embed document still contains the poster.
  // Resolve that document first, then fall back to the canonical public page.
  const embed = await fetchEmbedPreview(platform, contentUrl);
  if (embed.thumbnailUrl && /^https:\/\//i.test(embed.thumbnailUrl)) {
    return {
      resolvedUrl: contentUrl,
      title: embed.title || oeTitle,
      thumbnailUrl: embed.thumbnailUrl,
      source: embed.source || "provider-embed-meta"
    };
  }

  let page = { url: contentUrl, html: "" };
  try { page = await fetchProviderHtml(platform, contentUrl); } catch (_error) {}
  const title = htmlTitle(page.html) || embed.title || oeTitle;
  const thumbnailUrl = htmlImage(page.html) || embed.thumbnailUrl || oeThumb;
  return {
    resolvedUrl: safeProviderUrl(platform, page.url) || contentUrl,
    title,
    thumbnailUrl: /^https:\/\//i.test(thumbnailUrl) ? thumbnailUrl : "",
    source: page.html ? "public-meta" : (embed.source || (oe ? "oembed-no-image" : "unresolved"))
  };
}

exports.handler = async function handler(event) {
  if (!event || event.httpMethod !== "GET") return json(405, { ok: false, error: "method_not_allowed" }, false);
  const params = event.queryStringParameters || {};
  const platform = normalizePlatform(params.platform);
  if (!platform) return json(400, { ok: false, error: "invalid_platform" }, false);
  const contentUrl = safeProviderUrl(platform, params.url);
  if (!contentUrl) return json(400, { ok: false, error: "invalid_content_url" }, false);

  try {
    const preview = await resolvePreview(platform, contentUrl);
    return json(200, {
      ok: true,
      platform,
      resolved: !!(preview.thumbnailUrl || preview.title),
      resolvedUrl: preview.resolvedUrl || contentUrl,
      title: preview.title || "",
      thumbnailUrl: preview.thumbnailUrl || "",
      source: preview.source || "unresolved"
    }, true);
  } catch (error) {
    return json(200, {
      ok: true,
      platform,
      resolved: false,
      resolvedUrl: contentUrl,
      title: "",
      thumbnailUrl: "",
      source: "resolver_error",
      error: text(error && error.name || "preview_error")
    }, true);
  }
};

exports.__test = {
  normalizePlatform,
  safeProviderUrl,
  decodeHtml,
  metaMap,
  htmlTitle,
  htmlImage,
  facebookIsVideo,
  providerEmbedPreviewUrl,
  resolvePreview
};
