"use strict";

/*
 * Converts public SNS content URLs into the channel/profile/group asset that
 * IGDC actually recommends. This is a social-candidate adapter only; it does
 * not alter Sanmaru, SearchBank, Snapshot Engine, or public slots.
 */
const VERSION = "social-channel-link-v1.1.0-public-directory-accounts";

const PLATFORM_HOSTS = Object.freeze({
  youtube: ["youtube.com", "youtu.be"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch"],
  wechat: ["mp.weixin.qq.com", "weixin.qq.com", "wechat.com"],
  weibo: ["weibo.com", "m.weibo.cn"],
  pinterest: ["pinterest.com", "pin.it"],
  reddit: ["reddit.com", "redd.it"],
  twitter: ["x.com", "twitter.com"]
});
const RESERVED = Object.freeze({
  instagram: new Set(["about","accounts","developer","direct","directory","explore","legal","privacy","reels","stories","web"]),
  tiktok: new Set(["about","business","community-guidelines","discover","explore","legal","login","search","tag"]),
  facebook: new Set(["about","ads","business","events","gaming","groups","help","login","marketplace","privacy","reel","search","share","stories","watch"]),
  pinterest: new Set(["about","business","ideas","login","pin","search","settings","today"]),
  reddit: new Set(["about","appeals","best","hot","login","new","popular","search","settings","submit","top"]),
  twitter: new Set(["compose","explore","hashtag","home","i","intent","login","messages","notifications","search","settings","share","tos"])
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
    wechat: "https://mp.weixin.qq.com",
    weibo: "https://weibo.com",
    pinterest: "https://www.pinterest.com",
    reddit: "https://www.reddit.com",
    twitter: "https://x.com"
  };
  return (roots[platform] || "") + (path.startsWith("/") ? path : "/" + path);
}
function handleAllowed(platform, value){
  const raw = text(value).replace(/^@/, "");
  if (!raw || RESERVED[platform] && RESERVED[platform].has(raw.toLowerCase())) return false;
  return /^[a-z0-9._-]{2,100}$/i.test(raw);
}
function titleHandle(title, platform){
  const raw = cleanTitle(title);
  const patterns = platform === "instagram"
    ? [
        /^@?([a-z0-9._]{2,100})\s+(?:on\s+instagram|•\s+instagram)/i,
        /instagram\s+(?:photos|profile|account)\s+(?:and\s+videos\s+)?from\s+@?([a-z0-9._]{2,100})/i
      ]
    : platform === "pinterest"
      ? [
          /^@?([a-z0-9._-]{2,100})\s+(?:on\s+pinterest|•\s+pinterest)/i,
          /^([^|()]{2,100})\s*\([^)]*\)\s*[|·-]\s*pinterest/i
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
  if (values[0] === "u" && values[1]) raw = values[1];
  if (values[0] === "r" && values[1]) raw = "r/" + values[1];
  if (values[0] === "groups" && values[1]) raw = values[1];
  return cleanTitle(raw.replace(/^@/, "@").replace(/[-_]+/g, " "));
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
  } else if (platform === "wechat") {
    if (/^\/s(?:\/|$)/i.test(path) || evidence.searchParams.get("__biz")) { targetUrl = evidence.toString(); entityKind = "official_account_article_channel"; }
    else if (hostOf(evidence.toString()) === "open.weixin.qq.com" && /^\/qr\/code$/i.test(path) && evidence.searchParams.get("username")) {
      targetUrl = evidence.toString();
      entityKind = "official_account";
    }
  } else if (platform === "weibo") {
    if (p[0] === "u" && p[1]) { targetUrl = canonical(platform, "/u/" + p[1]); entityKind = "profile"; }
    else if (p[0] === "detail" && p[1]) { needsEnrichment = "weibo_profile_lookup"; entityKind = "profile"; }
    else if (p[0] && /^\d+$/.test(p[0])) { targetUrl = canonical(platform, "/u/" + p[0]); entityKind = "profile"; }
    else if (p[0] && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0]); entityKind = "profile"; }
  } else if (platform === "pinterest") {
    if (p.length >= 2 && p[0] !== "pin" && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0] + "/" + p[1] + "/"); entityKind = "board"; }
    else if (p.length === 1 && p[0] !== "pin" && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0] + "/"); entityKind = "profile"; }
    else {
      const handle = titleHandle(input.title, platform);
      if (handle) { targetUrl = canonical(platform, "/" + handle + "/"); entityKind = "profile"; }
    }
  } else if (platform === "reddit") {
    const rIndex = p.findIndex((part) => part.toLowerCase() === "r");
    const uIndex = p.findIndex((part) => part.toLowerCase() === "user");
    if (rIndex >= 0 && p[rIndex + 1]) { targetUrl = canonical(platform, "/r/" + p[rIndex + 1] + "/"); entityKind = "community"; }
    else if (uIndex >= 0 && p[uIndex + 1]) { targetUrl = canonical(platform, "/user/" + p[uIndex + 1] + "/"); entityKind = "profile"; }
  } else if (platform === "twitter") {
    if (p[0] && handleAllowed(platform, p[0])) { targetUrl = canonical(platform, "/" + p[0]); entityKind = "profile"; }
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
