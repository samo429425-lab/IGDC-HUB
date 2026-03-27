// ===== MEDIA FEED ENGINE (FINAL - SNAPSHOT MATCHED) =====

function toArr(v){
  return Array.isArray(v) ? v : [];
}

function normalizeItem(item, ctx={}){
  if(!item) return null;

  return {
    title: item.title || '',
    thumbnail: item.thumbnail || item.thumb || '',
    url: item.url || '',
    provider: item.provider || '',
    weight: item.weight || 0,
    timestamp: item.timestamp || 0,
    section: ctx.section || '',
    page: ctx.page || ''
  };
}

// ===== 핵심: media_1 생성 (REAL SNAPSHOT STRUCTURE 대응) =====
function buildMediaFeed(snap){

  // 🔴 실제 구조 (확인됨)
  const sections = snap?.sections || {};

  // 🔴 실제 키
  const SOURCE_KEYS = ["media-movie","media-drama","media-thriller","media-romance"];

  let pool = [];

  SOURCE_KEYS.forEach(key => {
    const arr = toArr(sections[key]?.slots);
    arr.forEach(item=>{
      pool.push({
        ...item,
        __source:key
      });
    });
  });

  // 🔴 정규화
  pool = pool
    .map(x => normalizeItem(x, { section:"media_1", page:"media" }))
    .filter(x => x && (x.title || x.thumbnail || x.url));

  // 🔴 중복 제거 (url 기준)
  const dedup = new Map();
  pool.forEach(item=>{
    if(item.url && !dedup.has(item.url)){
      dedup.set(item.url,item);
    }
  });

  // 🔴 정렬 (weight → 최신)
  const result = Array.from(dedup.values())
    .sort((a,b)=>{
      const w = (b.weight||0)-(a.weight||0);
      if(w!==0) return w;

      return (b.timestamp||0)-(a.timestamp||0);
    })
    .slice(0,20);

  return result;
}

// ===== media sections 생성 =====
function buildMediaSections(snap){

  const sections = snap?.sections || {};

  // 🔴 1차: feed (정식)
  let items = buildMediaFeed(snap);

  // 🔴 2차: feed 실패 시 fallback (샘플)
  if(!items || items.length === 0){

    const SOURCE_KEYS = ["media-movie","media-drama","media-thriller","media-romance"];

    let pool = [];

    SOURCE_KEYS.forEach(key=>{
      const arr = Array.isArray(sections[key])
        ? sections[key]
        : (sections[key]?.slots || []);

      pool = pool.concat(arr);
    });

    items = pool.slice(0,20);
  }

  return [{
    id:"media-trending",
    items
  }];
}

// ===== 라우팅 =====
function buildSectionsForPageQuery(pageQuery, snap){
  const p = String(pageQuery || "").toLowerCase();

  if (p === "media") return buildMediaSections(snap);

  return null;
}

// ===== MAIN =====
exports.handler = async function(event){

  const pageQuery = event.queryStringParameters?.page || "";

  const snap = globalThis.__SNAPSHOT__ || {};

  const sections = pageQuery
    ? (buildSectionsForPageQuery(pageQuery, snap) || [])
    : [];

  return {
    statusCode:200,
    body: JSON.stringify({
      ok:true,
      sections
    })
  };
};
