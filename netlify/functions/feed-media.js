
// IGDC Media Feed (Production Stable)

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const KEY_ALIAS = {
  "trending_now": "media-trending",
  "latest_movie": "media-movie",
  "latest_drama": "media-drama",

  "media-trending": "media-trending",
  "media-movie": "media-movie",
  "media-drama": "media-drama",
  "media-thriller": "media-thriller",
  "media-romance": "media-romance",
  "media-variety": "media-variety",
  "media-documentary": "media-documentary",
  "media-animation": "media-animation",
  "media-music": "media-music",
  "media-shorts": "media-shorts"
};

const TRENDING_SOURCES = [
  "media-movie",
  "media-drama",
  "media-thriller",
  "media-romance",
  "media-variety",
  "media-documentary",
  "media-animation",
  "media-music",
  "media-shorts"
];

exports.handler = async (event) => {

  const qs = event.queryStringParameters || {};
  const rawKey = (qs.key || qs.section || "media-trending").trim();
  const key = KEY_ALIAS[rawKey] || rawKey;

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(qs.limit || DEFAULT_LIMIT))
  );

  const snapshot = await loadSnapshot(event);

  const sections =
    snapshot?.sections ||
    snapshot?.by_page_section ||
    {};

  let items = [];

  if (key === "media-trending") {

    const pooled = [];

    for (const k of TRENDING_SOURCES) {

      const sec = sections[k];
      const slots = sec?.slots || [];

      for (const s of slots) pooled.push(s);

    }

    pooled.sort((a,b)=>score(b)-score(a));

    items = slotsToItems(pooled, limit);

  } else {

    const sec = sections[key];
    const slots = sec?.slots || [];

    items = slotsToItems(slots, limit);

  }

  return {
    statusCode:200,
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({key,items})
  };

};

function score(slot){

  const m = slot?.metrics || {};

  const view = Number(m.view)||0;
  const like = Number(m.like)||0;
  const rec  = Number(m.recommend)||0;
  const click= Number(m.click)||0;

  return view + like*2 + rec*3 + click;

}

function slotsToItems(slots,limit){

  const out=[];

  const n = Math.min(limit,slots.length);

  for(let i=0;i<n;i++){

    const s=slots[i];

    out.push({
      title:s?.title||"",
      thumbnail:s?.thumb||"",
      url:s?.url||s?.video||"",
      video:s?.video||"",
      provider:s?.provider||"",
      _id:s?.contentId||i
    });

  }

  while(out.length<limit){

    out.push({
      title:"",
      thumbnail:"",
      url:"",
      video:"",
      provider:"",
      _id:out.length
    });

  }

  return out;

}

async function loadSnapshot(event){

  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;

  const url = proto + "://" + host + "/data/media.snapshot.json";

  const r = await fetch(url);

  return await r.json();

}