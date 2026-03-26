// feed-media.js (FULL REPLACEMENT - AUTOMAP COMPATIBLE)
// 목적:
// 1) mediahub-automap.v3.js가 기대하는 응답 형식 { key, items } 유지
// 2) media-trending은 snapshot.sections 의 movie/drama 등에서 조합 생성
// 3) 나머지 섹션은 snapshot.sections[key].slots 를 그대로 items 로 변환
// 4) feed 없애지 않고 현재 구조에서 바로 복구

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const KEY_ALIAS = {
  trending_now: 'media-trending',
  latest_movie: 'media-movie',
  latest_drama: 'media-drama',

  'media-trending': 'media-trending',
  'media-movie': 'media-movie',
  'media-drama': 'media-drama',
  'media-thriller': 'media-thriller',
  'media-romance': 'media-romance',
  'media-variety': 'media-variety',
  'media-documentary': 'media-documentary',
  'media-animation': 'media-animation',
  'media-music': 'media-music',
  'media-shorts': 'media-shorts'
};

const TRENDING_SOURCES = [
  'media-movie',
  'media-drama',
  'media-thriller',
  'media-romance',
  'media-variety',
  'media-documentary',
  'media-animation',
  'media-music',
  'media-shorts'
];

function corsHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function score(slot) {
  const m = slot?.metrics || {};
  const view = Number(m.view) || 0;
  const like = Number(m.like) || 0;
  const rec = Number(m.recommend) || 0;
  const click = Number(m.click) || 0;
  return view + like * 2 + rec * 3 + click;
}

function slotsToItems(slots, limit) {
  const src = Array.isArray(slots) ? slots : [];
  const out = [];
  const n = Math.min(limit, src.length);

  for (let i = 0; i < n; i++) {
    const s = src[i] || {};
    out.push({
      title: s.title || '',
      thumbnail: s.thumb || '',
      url: s.url || s.video || '',
      video: s.video || '',
      provider: s.provider || '',
      _id: s.contentId || s.slotId || i
    });
  }

  while (out.length < limit) {
    out.push({
      title: '',
      thumbnail: '',
      url: '',
      video: '',
      provider: '',
      _id: out.length
    });
  }

  return out;
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
  return await r.json();
}

async function loadSnapshot(event) {
  const proto = event?.headers?.['x-forwarded-proto'] || 'https';
  const host = event?.headers?.host || event?.headers?.Host;

  const urls = [];
  if (host) urls.push(`${proto}://${host}/data/media.snapshot.json`);
  urls.push('/data/media.snapshot.json');

  let lastErr = null;
  for (const url of urls) {
    try {
      const json = await fetchJson(url);
      if (json) return json;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('MEDIA_SNAPSHOT_LOAD_FAILED');
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    const qs = event.queryStringParameters || {};
    const rawKey = String(qs.key || qs.section || 'media-trending').trim();
    const key = KEY_ALIAS[rawKey] || rawKey;

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(qs.limit || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT)
    );

    const snapshot = await loadSnapshot(event);
    const sections = snapshot?.sections || snapshot?.by_page_section || {};

    let items = [];

    if (key === 'media-trending') {
      const pooled = [];

      for (const k of TRENDING_SOURCES) {
        const sec = sections[k];
        const slots = Array.isArray(sec?.slots) ? sec.slots : [];
        for (const s of slots) {
          if (!s) continue;
          pooled.push(s);
        }
      }

      const filtered = pooled.filter((s) => {
        return !!(s && (s.title || s.thumb || s.video || s.url));
      });

      filtered.sort((a, b) => score(b) - score(a));
      items = slotsToItems(filtered, limit);
    } else {
      const sec = sections[key];
      const slots = Array.isArray(sec?.slots) ? sec.slots : [];
      const filtered = slots.filter((s) => !!(s && (s.title || s.thumb || s.video || s.url)));
      items = slotsToItems(filtered, limit);
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ key, items })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'MEDIA_FEED_FAIL', message: e.message || 'unknown' })
    };
  }
};
