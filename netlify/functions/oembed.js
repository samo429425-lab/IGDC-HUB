
// /.netlify/functions/oembed
// Detect provider from URL and call appropriate oEmbed endpoint.
// IG/FB require tokens; others are public.
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

function pickProvider(u){
  try{
    const url = new URL(u);
    const h = url.hostname.replace(/^www\./,'');
    if(/instagram\.com|instagr\.am/i.test(h)) return 'instagram';
    if(/facebook\.com|fb\.watch/i.test(h)) return 'facebook';
    if(/youtube\.com|youtu\.be/i.test(h)) return 'youtube';
    if(/vimeo\.com/i.test(h)) return 'vimeo';
    if(/tiktok\.com/i.test(h)) return 'tiktok';
    if(/twitter\.com|x\.com/i.test(h)) return 'twitter';
    if(/open\.spotify\.com/i.test(h)) return 'spotify';
    if(/soundcloud\.com/i.test(h)) return 'soundcloud';
    return null;
  }catch{ return null; }
}

async function fetchOEmbed(provider, url){
  const tokenIG = process.env.IG_OEMBED_TOKEN || process.env.META_APP_TOKEN || "";
  const tokenFB = process.env.FB_OEMBED_TOKEN || process.env.META_APP_TOKEN || "";
  switch(provider){
    case 'instagram': {
      if(!tokenIG) return { status:503, body:"Instagram oEmbed token missing"};
      const api = new URL("https://graph.facebook.com/v17.0/instagram_oembed");
      api.searchParams.set("url", url);
      api.searchParams.set("omitscript","true");
      api.searchParams.set("access_token", tokenIG);
      return fetch(api.toString());
    }
    case 'facebook': {
      if(!tokenFB) return { status:503, body:"Facebook oEmbed token missing"};
      const api = new URL("https://graph.facebook.com/v17.0/oembed_page");
      api.searchParams.set("url", url);
      api.searchParams.set("omitscript","true");
      api.searchParams.set("access_token", tokenFB);
      return fetch(api.toString());
    }
    case 'youtube': {
      const api = new URL("https://www.youtube.com/oembed");
      api.searchParams.set("url", url);
      api.searchParams.set("format","json");
      return fetch(api.toString());
    }
    case 'vimeo': {
      const api = new URL("https://vimeo.com/api/oembed.json");
      api.searchParams.set("url", url);
      return fetch(api.toString());
    }
    case 'tiktok': {
      const api = new URL("https://www.tiktok.com/oembed");
      api.searchParams.set("url", url);
      return fetch(api.toString());
    }
    case 'twitter': {
      const api = new URL("https://publish.twitter.com/oembed");
      api.searchParams.set("url", url);
      return fetch(api.toString());
    }
    case 'spotify': {
      const api = new URL("https://open.spotify.com/oembed");
      api.searchParams.set("url", url);
      return fetch(api.toString());
    }
    case 'soundcloud': {
      const api = new URL("https://soundcloud.com/oembed");
      api.searchParams.set("format", "json");
      api.searchParams.set("url", url);
      return fetch(api.toString());
    }
    default:
      return { status:501, body:"Provider not supported" };
  }
}

exports.handler = async (event) => {
  try {
    const url = (event.queryStringParameters && event.queryStringParameters.url) || "";
    if (!url) return { statusCode: 400, body: "Missing url" };
    const p = pickProvider(url);
    if (!p) return { statusCode: 415, body: "Unsupported URL" };
    const res = await fetchOEmbed(p, url);
    if (!res || res.status && res.body) {
      return { statusCode: res.status || 500, body: res.body || "Error" };
    }
    if (!res.ok) {
      const txt = await res.text();
      return { statusCode: res.status, body: txt };
    }
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ html: data.html || "", provider: p })
    };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
