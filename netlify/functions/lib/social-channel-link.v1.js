"use strict";

/*
 * Converts public SNS content URLs into the channel/profile asset that IGDC
 * recommends first during discovery. This is Social-candidate-only code and
 * does not mutate SearchBank, snapshots, releases, rightPanel, or Distribution.
 */
const VERSION = "social-channel-link-v1.3.0-six-video-platforms";

const PLATFORM_HOSTS = Object.freeze({
  youtube: ["youtube.com", "youtu.be"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch"],
  douyin: ["douyin.com", "v.douyin.com", "iesdouyin.com"],
  dailymotion: ["dailymotion.com", "dai.ly"]
});
const RESERVED = Object.freeze({
  instagram: new Set(["about","accounts","developer","direct","directory","explore","legal","privacy","reels","stories","web"]),
  tiktok: new Set(["about","business","community-guidelines","discover","explore","legal","login","search","tag"]),
  facebook: new Set(["about","ads","business","events","gaming","groups","help","login","marketplace","privacy","reel","search","share","stories","watch"]),
  douyin: new Set(["about","discover","hot","login","search","video","note","user"]),
  dailymotion: new Set(["about","embed","legal","playlist","search","signin","upload","user","video"])
});

function text(value){ return value == null ? "" : String(value).trim(); }
function cleanTitle(value){ return text(value).replace(/\s+/g, " ").slice(0, 240); }
function hostOf(value){ try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch (_e) { return ""; } }
function platformFromUrl(value){
  const host = hostOf(value);
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    if (hosts.some((allowed) => host === allowed || host.endsWith("." + allowed))) return platform;
  }
  return "";
}
function httpsUrl(value){
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|gclid$|fbclid$|igshid$|si$|feature$|ref$|ref_)/i.test(key)) url.searchParams.delete(key);
    }
    return url;
  } catch (_e) { return null; }
}
function parts(url){ return url.pathname.split("/").map((part) => decodeURIComponent(part).trim()).filter(Boolean); }
function canonical(platform, path){
  const roots = {
    youtube: "https://www.youtube.com",
    instagram: "https://www.instagram.com",
    tiktok: "https://www.tiktok.com",
    facebook: "https://www.facebook.com",
    douyin: "https://www.douyin.com",
    dailymotion: "https://www.dailymotion.com"
  };
  return (roots[platform] || "") + (path.startsWith("/") ? path : "/" + path);
}
function handleAllowed(platform, value){
  const raw = text(value).replace(/^@/, "");
  if (!raw || RESERVED[platform] && RESERVED[platform].has(raw.toLowerCase())) return false;
  return /^[a-z0-9._-]{2,160}$/i.test(raw);
}
function titleHandle(title, platform){
  const raw = cleanTitle(title);
  const patterns = platform === "instagram"
    ? [
        /^@?([a-z0-9._]{2,100})\s+(?:on\s+instagram|•\s+instagram)/i,
        /^.+?\(@([a-z0-9._]{2,100})\)\s*(?:[|·•-]\s*)?instagram/i,
        /^.+?[|·•-]\s*@?([a-z0-9._]{2,100})\s+(?:on\s+)?instagram/i,
        /instagram\s+(?:photos|profile|account)\s+(?:and\s+videos\s+)?from\s+@?([a-z0-9._]{2,100})/i
      ]
    : [];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && handleAllowed(platform, match[1])) return match[1];
  }
  return "";
}
function labelFromTarget(targetUrl, entityKind){
  const url = httpsUrl(targetUrl);
  const values = url ? parts(url) : [];
  let raw = values[values.length - 1] || values[0] || entityKind || "SNS 채널";
  if ((values[0] === "user" || values[0] === "channel") && values[1]) raw = values[1];
  if (values[0] === "groups" && values[1]) raw = values[1];
  return cleanTitle(raw.replace(/[-_]+/g, " "));
}

function resolve(value, options){
  const input = options && typeof options === "object" ? options : {};
  const evidence = httpsUrl(value);
  if (!evidence) return { ok:false, reason:"https_url_required" };
  const platform = platformFromUrl(evidence.toString());
  if (!platform) return { ok:false, reason:"unsupported_social_host" };
  if (input.platform && input.platform !== platform) return { ok:false, reason:"platform_host_mismatch", platform };
  const path = evidence.pathname.replace(/\/+/g, "/");
  const p = parts(evidence);
  let targetUrl = "", entityKind = "", needsEnrichment = "";

  if (platform === "youtube") {
    if (/^\/@[^/]+/i.test(path)) { targetUrl = canonical(platform, "/" + p[0]); entityKind = "channel"; }
    else if (/^\/(channel|c|user)\/[^/]+/i.test(path)) { targetUrl = canonical(platform, "/" + p[0] + "/" + p[1]); entityKind = "channel"; }
    else if (hostOf(evidence.toString()) === "youtu.be" || /^\/(watch|shorts|live|embed)(?:\/|$)/i.test(path)) { needsEnrichment = "youtube_oembed_author"; entityKind = "channel"; }
  } else if (platform === "instagram") {
    if (p.length === 1 && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0] + "/"); entityKind = "profile"; }
    else {
      const handle = titleHandle(input.title, platform);
      if (handle) { targetUrl = canonical(platform, "/" + handle + "/"); entityKind = "profile"; }
    }
  } else if (platform === "tiktok") {
    if (p[0] && /^@/.test(p[0]) && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0]); entityKind = "profile"; }
  } else if (platform === "facebook") {
    if (p[0] === "groups" && p[1]) { targetUrl = canonical(platform, "/groups/" + encodeURIComponent(p[1])); entityKind = "public_group"; }
    else if (path === "/profile.php" && evidence.searchParams.get("id")) { targetUrl = canonical(platform, "/profile.php?id=" + encodeURIComponent(evidence.searchParams.get("id"))); entityKind = "public_page"; }
    else if (p[0] && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0]); entityKind = "public_page"; }
  } else if (platform === "douyin") {
    if (p[0] === "user" && p[1]) { targetUrl = canonical(platform, "/user/" + encodeURIComponent(p[1])); entityKind = "profile"; }
    else if (/^\/(video|note)\//i.test(path) || hostOf(evidence.toString()) === "v.douyin.com") { needsEnrichment = "douyin_public_meta_author"; entityKind = "profile"; }
  } else if (platform === "dailymotion") {
    if (p[0] === "user" && p[1]) { targetUrl = canonical(platform, "/user/" + encodeURIComponent(p[1])); entityKind = "channel"; }
    else if (p.length === 1 && p[0] !== "video" && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0]); entityKind = "channel"; }
    else if (/^\/video\//i.test(path) || hostOf(evidence.toString()) === "dai.ly") { needsEnrichment = "dailymotion_oembed_author"; entityKind = "channel"; }
  }

  if (!targetUrl && !needsEnrichment) return { ok:false, reason:"channel_target_not_resolved", platform, evidenceUrl:evidence.toString() };
  return {
    ok:true,
    platform,
    entityKind,
    channelUrl: targetUrl,
    evidenceUrl: evidence.toString(),
    promotedFromContent: !!targetUrl && targetUrl !== evidence.toString(),
    needsEnrichment,
    suggestedTitle: labelFromTarget(targetUrl, entityKind)
  };
}

function parseIntakeLine(value){
  const raw = text(value);
  if (!raw || raw.startsWith("#")) return null;
  const fields = raw.split(/\s*\|\s*/);
  const urlIndex = fields.findIndex((field) => /^https:\/\//i.test(field));
  if (urlIndex < 0) return { ok:false, reason:"https_url_required", raw:raw.slice(0,300) };
  const url = fields[urlIndex];
  const title = cleanTitle(fields[urlIndex + 1] || (fields[0] === url ? "" : fields[0]));
  const category = cleanTitle(fields[urlIndex + 2] || "");
  return { ok:true, url, title, category };
}

module.exports = {
  VERSION,
  PLATFORM_HOSTS,
  text,
  cleanTitle,
  hostOf,
  platformFromUrl,
  labelFromTarget,
  resolve,
  parseIntakeLine
};
