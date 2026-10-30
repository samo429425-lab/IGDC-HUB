"use strict";
/* IGDC Social main ONLY. Confirmable first-party clicks, NOT provider reactions. */
const crypto = require("crypto");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SOCIAL_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SOCIAL_SUPABASE_SERVICE_ROLE_KEY || "";
const VALID_PLATFORMS = new Set(["youtube","instagram","tiktok","facebook","reddit"]);
const VALID_EVENTS = new Set(["viewer_open","original_outbound"]);
const HOSTS = {
 youtube:["youtube.com","youtu.be"], instagram:["instagram.com"],
 tiktok:["tiktok.com"], facebook:["facebook.com","fb.watch"], reddit:["reddit.com"]
};
const lastSeen = new Map();
function json(code,data) { return {statusCode:code,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"https://igdcglobal.com","Vary":"Origin"},body:JSON.stringify(data)}; }
function canonical(raw, platform) {
 try {
  const url = new URL(String(raw || ""));
  if (url.protocol !== "https:") return "";
  const host = url.hostname.toLowerCase();
  if (!(HOSTS[platform] || []).some(x=>host===x || host.endsWith("."+x))) return "";
  // Count only a known individual public content URL, never a profile/homepage.
  const route=url.pathname;
  const isPost={
   youtube: /(?:^\/watch\/?$|^\/shorts\/[^/]+|^\/embed\/[^/]+)/i.test(route) &&
    (route!=="/watch" || !!url.searchParams.get("v")) || host==="youtu.be" && /^\/[^/]+/.test(route),
   instagram: /^\/(?:p|reel|reels|tv)\/[^/]+/i.test(route),
   tiktok: /^\/@[^/]+\/video\/\d+/i.test(route),
   facebook: /\/(?:reel|watch|videos?|posts|photos|photo|share)\//i.test(route) ||
    /\/(?:permalink|story)\.php$/i.test(route) && !!(url.searchParams.get("story_fbid")||url.searchParams.get("id")) ||
    route==="/watch/" && !!url.searchParams.get("v") || host==="fb.watch" && route!=="/",
   reddit: /^\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(route)
  }[platform];
  if (!isPost) return "";
  url.hash="";
  return url.toString().slice(0,1000);
 } catch (_) {return "";}
}
function fromSocialPage(event) {
 const h=event.headers || {};
 const origin=String(h.origin || h.Origin || "").toLowerCase();
 const referer=String(h.referer || h.Referer || "");
 if (origin && !/^https:\/\/(?:www\.)?igdcglobal\.com$/.test(origin) && !/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)) return false;
 try { const path=new URL(referer).pathname; return /(?:^|\/)(?:socialnetwork(?:_[a-z]{2,3})?\.html|socialnetwork\/?$)/i.test(path) || path==='/socialnetwork'; }
 catch (_) { return false; }
}
exports.handler = async function (event) {
 if (!event || event.httpMethod !== "POST") return json(405,{ok:false,error:"method_not_allowed"});
 if (!fromSocialPage(event)) return json(403,{ok:false,error:"social_main_referer_required"});
 let data;try { if ((event.body||"").length>3000) throw Error(); data=JSON.parse(event.body||"{}"); }catch (_) {return json(400,{ok:false,error:"invalid_payload"});}
 const platform=String(data.platform||"").toLowerCase();
 const eventType=String(data.eventType||"");
 if (!VALID_PLATFORMS.has(platform) || !VALID_EVENTS.has(eventType)) return json(400,{ok:false,error:"invalid_action"});
 const href=canonical(data.contentUrl,platform);
 if (!href || data.sectionKey!=="social-"+platform) return json(400,{ok:false,error:"invalid_content"});
 if (!SUPABASE_URL || !SUPABASE_KEY) return json(503,{ok:false,error:"event_store_unconfigured"});
 const now=Date.now();
 const key=crypto.createHash('sha256').update([event.headers && (event.headers['x-nf-client-connection-ip']||event.headers['x-forwarded-for'])||'',href,eventType].join('|')).digest('hex');
 if (lastSeen.has(key) && now-lastSeen.get(key)<2500) return json(202,{ok:true,duplicate:true});
 lastSeen.set(key,now);
 if (lastSeen.size>2000) for(const [k,v] of lastSeen) {if(now-v>5000 || lastSeen.size>2000) lastSeen.delete(k);if(lastSeen.size<=2000)break;}
 const ts=new Date(now).toISOString();
 const row={page:'/socialnetwork',section_key:'social-'+platform,event_type:eventType,title:'social-'+platform+':'+crypto.createHash('sha256').update(href).digest('hex').slice(0,32),description:'IGDC Social main first-party action (provider interaction unverified)',href,watch_time_sec:0,event_ts:ts,event_id:'social-main-'+crypto.randomUUID(),created_at:ts,payload:{source:'igdc_social_main',provider:platform,signal:eventType,providerReactionVerified:false}};
 try {
  const res=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/igdc_social_events',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=minimal'},body:JSON.stringify([row]),signal:AbortSignal.timeout(3500)});
  if (!res.ok) return json(503,{ok:false,error:'event_store_rejected'});
  return json(202,{ok:true,recorded:eventType});
 } catch (_) {return json(503,{ok:false,error:'event_store_unavailable'});}
};
