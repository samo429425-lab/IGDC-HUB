export function runMediaFeed(snapshot) {

  const sections = snapshot?.sections || {};
  const LIMIT = 12;

  // === 소스 섹션 (여기서만 가져옴)
  const SOURCES = [
    'media-latest-movie',
    'media-latest-drama',
    'media-popular-movie',
    'media-popular-drama'
  ];

  const pool = [];

  // === 1. 소스에서 슬롯 수집
  for (const key of SOURCES) {
    const sec = sections[key];
    const slots = Array.isArray(sec?.slots) ? sec.slots : [];

    for (const s of slots) {
      if (
        s &&
        (
          (s.title && String(s.title).trim()) ||
          (s.video && s.video !== '#') ||
          (s.url && s.url !== '#') ||
          (s.thumb && s.thumb !== '#')
        )
      ) {
        pool.push(s);
      }
    }
  }

  // === 2. 중복 제거 (contentId 기준)
  const seen = new Set();
  const unique = [];

  for (const s of pool) {
    const id = s.contentId || s.video || s.url || s.slotId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(s);
  }

  // === 3. 상위 LIMIT 자르기
  const final = unique.slice(0, LIMIT);

  // === 4. items 형태로 변환
  const items = final.map((s, i) => ({
    _id: s.contentId || s.video || s.url || `media_${i}`,
    title: s.title || '',
    thumbnail: (s.thumb && s.thumb !== '#') ? s.thumb : '',
    videoId: s.video || '',
    url: s.url || '',
    meta: {
      provider: s.provider || 'media'
    }
  }));

  // === 5. 결과 반환 (오직 첫 섹션만)
  return {
    'media-trending': items
  };
}