'use strict';

/**
 * maru-search-display-engine.js
 * ------------------------------------------------------------
 * MARU Search Display Engine
 *
 * Role
 * - Decides how search result categories should be displayed for search.js.
 * - Keeps Maru Search light: no external calls, no provider expansion, no storage writes.
 * - Receives a query + already supplied items and returns a displayPolicy contract.
 * - search.js remains the UI executor: it hides/shows/reorders categories using this policy.
 */

const VERSION = 'maru-search-display-engine-v1.4.2-real-data-only-contract';
const ENGINE_NAME = 'maru-search-display-engine';

const BASE_GROUP_ORDER = [
  'authority','local_tour','knowledge','site','news','tour','blog','social','shopping','book','cafe',
  'image','video','media','public_data','academic','sports','finance','community','webtoon','web'
];

const BASE_TABS = [
  'all','map','knowledge','site','news','tour','blog','sns','shopping','book','cafe','image','video',
  'public_data','academic','sports','finance','community','webtoon'
];

const DEFAULT_PREVIEW_LIMITS = {
  authority:3, local_tour:5, knowledge:5, site:5, news:5, tour:5, blog:5, social:5,
  shopping:5, book:4, cafe:5, image:5, video:5, media:5, public_data:2, academic:4,
  sports:4, finance:4, community:5, webtoon:4, web:18
};

const DEFAULT_MODULE_CAPS = {
  authority:8, local_tour:15, knowledge:12, site:15, news:15, tour:15, blog:15, social:15,
  shopping:15, book:15, cafe:15, image:15, video:15, media:15, public_data:8, academic:15,
  sports:15, finance:15, community:15, webtoon:15, web:30
};

function s(v){ return String(v == null ? '' : v); }
function low(v){ return s(v).trim().toLowerCase(); }
function compact(v){ return s(v).replace(/\s+/g, ' ').trim(); }
function truthy(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const x = low(v);
  return !!x && !['0','false','no','off','disable','disabled','null','undefined'].includes(x);
}
function clampInt(v, d, min, max){
  const n = parseInt(v, 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : d));
}
function unique(arr){ return Array.from(new Set((Array.isArray(arr) ? arr : []).filter(Boolean))); }
function firstNonEmpty(){
  for(let i=0; i<arguments.length; i++){
    const x = compact(arguments[i]);
    if(x) return x;
  }
  return '';
}
function domainOf(url){ try{ return new URL(s(url)).hostname.replace(/^www\./, ''); }catch(e){ return ''; } }

function stripHtml(v){
  return compact(s(v)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>'));
}
function isRealImageUrl(v){
  const x = s(v).trim();
  if(!/^https?:\/\//i.test(x) && !x.startsWith('/')) return false;
  const lowUrl = x.toLowerCase();
  if(/favicon|apple-touch-icon|sprite|spacer|blank|pixel|tracking|captcha|qr|noimage|no-image|logo|brandmark|logotype|symbol|emblem|\/ci[\/_-]|\/bi[\/_-]|banner|placard|adserver|doubleclick|advertisement|promo-banner|popup/.test(lowUrl)) return false;
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(lowUrl) || /ytimg\.com|img\.youtube\.com|search\.pstatic\.net|kakaocdn|cloudfront|twimg|fbcdn|instagram|googleusercontent|gstatic/i.test(lowUrl);
}
function pickObject(){
  for(let i=0; i<arguments.length; i++){
    const v = arguments[i];
    if(v && typeof v === 'object' && !Array.isArray(v)) return v;
  }
  return {};
}
function compactTextFromAny(v){
  if(v == null) return '';
  if(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return stripHtml(v);
  if(Array.isArray(v)) return v.map(compactTextFromAny).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if(typeof v === 'object'){
    return compactTextFromAny([v.summary, v.snippet, v.description, v.contentSnippet, v.excerpt, v.abstract, v.text, v.content, v.caption]);
  }
  return '';
}
function naturalSummary(item, query){
  item = item && typeof item === 'object' ? item : {};
  const payload = pickObject(item.payload);
  const data = pickObject(item.data);
  const displayCard = pickObject(item.displayCard, item.card, item.presentation);
  const candidates = [
    displayCard.summary, displayCard.body, displayCard.description,
    item.displaySummary, item.summary, item.snippet, item.description, item.contentSnippet,
    item.excerpt, item.abstract, item.text, item.content, item.metaDescription, item.ogDescription,
    payload.summary, payload.snippet, payload.description, payload.contentSnippet, payload.excerpt, payload.abstract, payload.text, payload.content, payload.metaDescription, payload.ogDescription,
    data.summary, data.snippet, data.description, data.contentSnippet, data.excerpt, data.abstract, data.text, data.content, data.metaDescription, data.ogDescription
  ];
  for(const v of candidates){
    const clean = compactTextFromAny(v);
    if(clean && clean.length >= 12) return clean.slice(0, 360);
  }
  return '';
}
function fallbackDisplaySummary(item, query, group){
  // Real-data-only policy: do not manufacture explanatory/search-instruction text.
  // Search cards may show a blank body when the provider did not supply a real snippet,
  // description, content text, or OG description.
  return '';
}
function collectDisplayImages(item){
  item = item && typeof item === 'object' ? item : {};
  const payload = pickObject(item.payload);
  const data = pickObject(item.data);
  const media = pickObject(item.media);
  const preview = pickObject(media.preview);
  const displayCard = pickObject(item.displayCard, item.card, item.presentation);
  const raw = []
    .concat(displayCard.thumbnail ? [displayCard.thumbnail] : [])
    .concat(displayCard.image ? [displayCard.image] : [])
    .concat(displayCard.originalImage ? [displayCard.originalImage] : [])
    .concat(displayCard.fullImage ? [displayCard.fullImage] : [])
    .concat(Array.isArray(displayCard.imageSet) ? displayCard.imageSet : [])
    .concat(item.originalImage ? [item.originalImage] : [])
    .concat(item.fullImage ? [item.fullImage] : [])
    .concat(item.imageOriginal ? [item.imageOriginal] : [])
    .concat(item.viewerImage ? [item.viewerImage] : [])
    .concat(item.openImageUrl ? [item.openImageUrl] : [])
    .concat(item.contentUrl ? [item.contentUrl] : [])
    .concat(item.cardImage ? [item.cardImage] : [])
    .concat(item.thumbnail ? [item.thumbnail] : [])
    .concat(item.thumb ? [item.thumb] : [])
    .concat(item.image ? [item.image] : [])
    .concat(item.imageUrl ? [item.imageUrl] : [])
    .concat(item.og_image ? [item.og_image] : [])
    .concat(item.ogImage ? [item.ogImage] : [])
    .concat(payload.originalImage ? [payload.originalImage] : [])
    .concat(payload.fullImage ? [payload.fullImage] : [])
    .concat(payload.imageOriginal ? [payload.imageOriginal] : [])
    .concat(payload.viewerImage ? [payload.viewerImage] : [])
    .concat(payload.openImageUrl ? [payload.openImageUrl] : [])
    .concat(payload.contentUrl ? [payload.contentUrl] : [])
    .concat(payload.cardImage ? [payload.cardImage] : [])
    .concat(payload.thumbnail ? [payload.thumbnail] : [])
    .concat(payload.thumb ? [payload.thumb] : [])
    .concat(payload.image ? [payload.image] : [])
    .concat(payload.imageUrl ? [payload.imageUrl] : [])
    .concat(payload.image_url ? [payload.image_url] : [])
    .concat(payload.og_image ? [payload.og_image] : [])
    .concat(payload.ogImage ? [payload.ogImage] : [])
    .concat(data.originalImage ? [data.originalImage] : [])
    .concat(data.fullImage ? [data.fullImage] : [])
    .concat(data.imageOriginal ? [data.imageOriginal] : [])
    .concat(data.openImageUrl ? [data.openImageUrl] : [])
    .concat(data.contentUrl ? [data.contentUrl] : [])
    .concat(data.cardImage ? [data.cardImage] : [])
    .concat(data.thumbnail ? [data.thumbnail] : [])
    .concat(data.thumb ? [data.thumb] : [])
    .concat(data.image ? [data.image] : [])
    .concat(data.imageUrl ? [data.imageUrl] : [])
    .concat(data.image_url ? [data.image_url] : [])
    .concat(preview.original ? [preview.original] : [])
    .concat(preview.poster ? [preview.poster] : [])
    .concat(preview.thumbnail ? [preview.thumbnail] : [])
    .concat(preview.image ? [preview.image] : [])
    .concat(Array.isArray(item.imageSet) ? item.imageSet : [])
    .concat(Array.isArray(payload.imageSet) ? payload.imageSet : [])
    .concat(Array.isArray(data.imageSet) ? data.imageSet : []);
  const out = [];
  const seen = new Set();
  for(const v of raw){
    const img = s(v).trim();
    if(!img || !isRealImageUrl(img)) continue;
    const key = img.split('#')[0].toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if(out.length >= 4) break;
  }
  return out;
}
function extractYoutubeId(v){
  const x = s(v).trim();
  if(!x) return '';
  if(/^[A-Za-z0-9_-]{11}$/.test(x)) return x;
  const m = x.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/i);
  return m ? m[1] : '';
}
function youtubeThumb(item){
  item = item && typeof item === 'object' ? item : {};
  const id = extractYoutubeId(firstNonEmpty(item.videoId, item.url, item.link, item.href, item.videoUrl, item.watchUrl, item.embedUrl));
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}
function cardTypeForGroup(group, item){
  const g = normalizeGroup(groupOfItem(item) || group);
  if(g === 'local_tour') return 'map';
  if(g === 'tour') return 'article-media';
  if(g === 'image') return 'image';
  if(g === 'video' || g === 'media') return 'video';
  if(g === 'shopping') return 'shopping';
  if(g === 'book' || g === 'webtoon') return 'article';
  if(g === 'news' || g === 'blog' || g === 'cafe' || g === 'community' || g === 'social') return 'article-media';
  if(g === 'authority' || g === 'public_data' || g === 'site' || g === 'knowledge' || g === 'wiki' || g === 'academic') return 'article';
  return 'web';
}
function decorateDisplayItem(item, ctx, index){
  item = item && typeof item === 'object' ? item : {};
  ctx = ctx || {};
  const q = firstNonEmpty(ctx.q, ctx.query);
  const group = normalizeGroup(groupOfItem(item));
  let images = collectDisplayImages(item);
  const yt = youtubeThumb(item);
  if(yt && !images.length) images = [yt];
  const summary = naturalSummary(item, q);
  const cardType = cardTypeForGroup(group, item);
  const mapLike = cardType === 'map';
  const copy = Object.assign({}, item, {
    displayGroup: group,
    displayGroupLabel: ({
      authority:'주요 정보', public_data:'공공자료', local_tour:'지도/지역', knowledge:'지식/위키', wiki:'지식/위키', tour:'관광', site:'사이트', book:'도서',
      blog:'블로그', cafe:'카페', shopping:'쇼핑', news:'뉴스', image:'이미지', video:'영상', media:'미디어', social:'소셜',
      academic:'학술', community:'커뮤니티', sports:'스포츠', finance:'증권', webtoon:'웹툰', web:'웹'
    })[group] || '웹',
    displaySummary: summary,
    summary: firstNonEmpty(item.summary, item.snippet, item.description, summary),
    description: firstNonEmpty(item.description, item.summary, item.snippet, summary),
    snippet: firstNonEmpty(item.snippet, item.summary, item.description, summary),
    // Only sanitized direct content images may enter search-card media fields.
    // Do not preserve upstream thumbnails when they are merely provider/search URLs
    // such as google.com/search, map pages, logos, banners, or placards.
    thumbnail: images[0] || '',
    thumb: images[0] || '',
    image: images[0] || '',
    imageUrl: images[0] || '',
    originalImage: images[0] || '',
    fullImage: images[0] || '',
    imageOriginal: images[0] || '',
    viewerImage: images[0] || '',
    openImageUrl: images[0] || '',
    contentUrl: images[0] || '',
    cardImage: images[0] || '',
    imageSet: images,
    displayCard: Object.assign({}, pickObject(item.displayCard), {
      engine: ENGINE_NAME,
      version: VERSION,
      cardType,
      group,
      title: firstNonEmpty(item.title, item.name, q),
      url: firstNonEmpty(item.url, item.link, item.href),
      source: firstNonEmpty(item.source, item.provider, domainOf(firstNonEmpty(item.url, item.link, item.href))),
      summary,
      body: summary,
      description: summary,
      snippet: summary,
      lineClamp: mapLike ? 2 : 3,
      bodyLines: mapLike ? 2 : 3,
      thumbnail: images[0] || '',
      image: images[0] || '',
      imageUrl: images[0] || '',
      originalImage: images[0] || '',
      fullImage: images[0] || '',
      imageSet: images,
      hasThumbnail: !!images.length,
      showThumbnail: !!images.length,
      showMapPreview: mapLike,
      showVideoPreview: cardType === 'video',
      showBody: true,
      bodySource: naturalSummary(item, q) ? 'provider' : 'display-engine-fallback',
      thumbnailPolicy: 'actual-content-image-only; no-logo-no-favicon-no-banner-no-placard-no-search-url',
      displayMode: mapLike ? 'map-plus-list-card' : (images.length ? 'text-plus-thumbnail-card' : 'text-summary-card')
    })
  });
  if(mapLike){
    copy.__maruAllowMapPreview = true;
    copy.mapQuery = firstNonEmpty(item.mapQuery, item.address, item.title, q);
    copy.placeInfo = Object.assign({}, pickObject(item.placeInfo), {
      name: firstNonEmpty(item.placeInfo && item.placeInfo.name, item.title, q),
      address: firstNonEmpty(item.placeInfo && item.placeInfo.address, item.address, ''),
      mapQuery: firstNonEmpty(item.mapQuery, item.address, item.title, q)
    });
    copy.displayCard = Object.assign({}, copy.displayCard, {
      showMapPreview: true,
      mapQuery: copy.mapQuery,
      mapPreview: {
        enabled: true,
        query: copy.mapQuery,
        name: copy.placeInfo.name || copy.mapQuery,
        address: copy.placeInfo.address || ''
      }
    });
  }
  if(cardType === 'video' && images[0]){
    const media = Object.assign({}, pickObject(item.media));
    media.type = 'video';
    media.preview = Object.assign({}, pickObject(media.preview), { image: images[0], thumbnail: images[0] });
    copy.media = media;
  }
  copy.displayIndex = Number.isFinite(Number(index)) ? Number(index) : undefined;
  return copy;
}
function decorateItems(items, ctx){
  return (Array.isArray(items) ? items : []).map((item, idx) => decorateDisplayItem(item, ctx || {}, idx));
}

function normalizeGroup(group){
  const raw = low(group);
  const map = {
    official:'authority', official_authority:'authority', gov:'authority', government:'authority', authority:'authority',
    public:'public_data', opendata:'public_data', open_data:'public_data', public_data:'public_data',
    map:'local_tour', local:'local_tour', map_local:'local_tour', map_local_tour:'local_tour', local_map:'local_tour', region:'local_tour', place:'local_tour', tour:'tour', travel:'tour', tourism:'tour', attraction:'tour', landmark:'tour', local_tour:'local_tour',
    knowledge_wiki:'knowledge', encyclopedia:'knowledge', wikipedia:'knowledge', knowledge:'knowledge', wiki:'knowledge',
    scholar:'academic', paper:'academic', research:'academic', academic:'academic',
    company_web:'site', corporate_homepage:'site', business_site:'site', official_site:'site', homepage:'site', website:'site', site:'site', company:'site', corporate:'site', business:'site',
    image_gallery:'image', photo:'image', image:'image',
    video_vlog:'video', youtube:'video', video:'video', media:'media',
    blog_review:'blog', blog:'blog', cafe:'cafe', forum:'community', community:'community',
    sns:'social', social:'social', community_sns:'social',
    shopping_product:'shopping', commerce:'shopping', product:'shopping', shopping:'shopping',
    stock:'finance', finance:'finance', sports:'sports', webtoon:'webtoon', book:'book', general_web:'web', web:'web'
  };
  return map[raw] || raw || 'web';
}

function itemText(item){
  item = item && typeof item === 'object' ? item : {};
  const source = item.source && typeof item.source === 'object'
    ? firstNonEmpty(item.source.name, item.source.provider, item.source.platform, item.source.id)
    : item.source;
  return [
    item.title, item.name, item.label, item.summary, item.snippet, item.description, item.content,
    item.url, item.link, item.href, item.type, item.category, item.searchCategory, item.displayGroup,
    item.displayGroupLabel, item.provider, source, item.mediaType, item.section,
    Array.isArray(item.tags) ? item.tags.join(' ') : ''
  ].map(compact).filter(Boolean).join(' ');
}

function groupOfItem(item){
  item = item && typeof item === 'object' ? item : {};
  const explicit = normalizeGroup(firstNonEmpty(item.displayGroup, item.group, item.searchCategory));
  if(explicit && explicit !== 'web') return explicit;

  const type = low(firstNonEmpty(item.type, item.category, item.mediaType, item.searchCategory));
  const source = low(firstNonEmpty(item.source, item.provider, item.channel));
  const url = firstNonEmpty(item.url, item.link, item.href);
  const host = low(domainOf(url));
  const text = low(itemText(item));

  if(/\.go\.kr$|\.gov$|\.or\.kr$|\.edu$|\.ac\.kr$/.test(host) || /공식|정부|기관|authority/.test(text)) return 'authority';
  if(type === 'public_data' || /공공데이터|데이터포털|open data/.test(text) || host.includes('data.go.kr')) return 'public_data';
  if(type === 'map' || type === 'local' || /지도|주소|위치|근처|맛집|관광|여행|호텔|숙박|landmark|tour|travel|place/.test(text)) return 'local_tour';
  if(type === 'academic' || /학술|논문|연구|journal|paper|thesis|scholar/.test(text) || host.includes('scholar.google')) return 'academic';
  if(type === 'wiki' || /위키|wiki/.test(text)) return 'wiki';
  if(type === 'knowledge' || /지식|백과|사전|knowledge|encyclopedia/.test(text)) return 'knowledge';
  if(type === 'site' || /홈페이지|공식사이트|기업|회사|business|company|corporate/.test(text)) return 'site';
  if(type === 'book' || /도서|책|isbn|book/.test(text)) return 'book';
  if(type === 'news' || source.includes('news') || /뉴스|속보|breaking|press/.test(text)) return 'news';
  if(type === 'blog' || host.includes('blog.') || /블로그|blog/.test(text)) return 'blog';
  if(type === 'cafe' || host.includes('cafe.') || /카페/.test(text)) return 'cafe';
  if(type === 'shopping' || /쇼핑|상품|구매|가격|최저가|product|shopping|commerce/.test(text)) return 'shopping';
  if(type === 'sports' || /스포츠|축구|야구|농구|배구|sports|score/.test(text)) return 'sports';
  if(type === 'finance' || /금융|증권|주식|환율|코스피|나스닥|finance|stock|market|coin|crypto/.test(text)) return 'finance';
  if(type === 'webtoon' || /웹툰|만화|comic|manga/.test(text)) return 'webtoon';
  if(type === 'image' || /이미지|사진|photo|image/.test(text)) return 'image';
  if(type === 'video' || source.includes('youtube') || host.includes('youtube.com') || host.includes('youtu.be') || /영상|유튜브|동영상|broadcast|video/.test(text)) return 'video';
  if(type === 'sns' || type === 'social' || /인스타그램|instagram|facebook|tiktok|twitter|x\.com|sns|social/.test(text) || host.includes('instagram.') || host.includes('tiktok.') || host.includes('twitter.') || host.includes('x.com')) return 'social';
  if(type === 'community' || /커뮤니티|게시판|forum|community/.test(text)) return 'community';
  return 'web';
}

function countGroups(items){
  const counts = Object.create(null);
  const list = Array.isArray(items) ? items.slice(0, 800) : [];
  for(const item of list){
    const g = groupOfItem(item);
    counts[g] = (counts[g] || 0) + 1;
  }
  return counts;
}

function hasCount(counts, group){ return (counts && Number(counts[group] || 0) > 0); }
function anyCount(counts, groups){ return groups.some(g => hasCount(counts, g)); }

function inferIntent(q, counts, rawType){
  const text = low(q);
  const type = normalizeGroup(rawType || 'all');
  const shortNameLike = compact(q).split(/\s+/).filter(Boolean).length <= 2 && compact(q).length <= 18;

  if(type && type !== 'all' && type !== 'web') return { intent:type, confidence:0.88, reason:'explicit-type' };
  if(/맛집|근처|주소|지도|위치|가는길|여행|관광|숙박|호텔|병원|약국|학교|교회|카페|restaurant|near me|map|address|travel|tour|hotel/.test(text)) return { intent:'local', confidence:0.92, reason:'local-query-token' };
  if(/가격|구매|최저가|할인|비교|추천|판매|쇼핑|상품|노트북|핸드폰|폰|buy|price|deal|shopping|product/.test(text)) return { intent:'shopping', confidence:0.9, reason:'shopping-query-token' };
  if(/주가|환율|코스피|코스닥|나스닥|증권|금리|비트코인|코인|시세|finance|stock|market|exchange rate|crypto/.test(text)) return { intent:'finance', confidence:0.9, reason:'finance-query-token' };
  if(/사건|사고|논란|이슈|속보|전쟁|선거|발표|오늘|최신|뉴스|breaking|issue|war|election|latest/.test(text)) return { intent:'issue', confidence:0.88, reason:'issue-query-token' };
  if(/가수|배우|연예인|아이돌|드라마|영화|방송|인스타|유튜브|팬카페|celebrity|actor|singer|idol|instagram|youtube/.test(text)) return { intent:'celebrity', confidence:0.9, reason:'celebrity-query-token' };
  if(/논문|학술|연구|보고서|리포트|저널|학회|paper|research|journal|thesis|citation/.test(text)) return { intent:'academic', confidence:0.9, reason:'academic-query-token' };
  if(/도서|책|작가|저자|소설|시집|book|author|novel/.test(text)) return { intent:'book', confidence:0.86, reason:'book-query-token' };
  if(/축구|야구|농구|배구|스포츠|경기|선수|score|sports|football|baseball|basketball/.test(text)) return { intent:'sports', confidence:0.88, reason:'sports-query-token' };
  if(/뜻|의미|정의|역사|위키|무엇|누구|방법|설명|what is|who is|meaning|definition|history/.test(text)) return { intent:'knowledge', confidence:0.82, reason:'knowledge-query-token' };

  if(shortNameLike && anyCount(counts, ['video','image','social','news','blog']) && !anyCount(counts, ['local_tour','shopping','finance'])){
    return { intent:'celebrity_or_person', confidence:0.68, reason:'short-name-media-mix' };
  }
  if(hasCount(counts, 'news') && (hasCount(counts, 'social') || hasCount(counts, 'blog')) && !hasCount(counts, 'local_tour')){
    return { intent:'issue', confidence:0.62, reason:'news-social-result-mix' };
  }
  return { intent:'general', confidence:0.55, reason:'default-general' };
}

function policyForIntent(intentInfo, counts){
  const intent = intentInfo.intent || 'general';
  const profiles = {
    local: ['authority','local_tour','blog','image','video','news','site','web'],
    shopping: ['shopping','image','video','blog','site','news','web'],
    finance: ['finance','news','authority','site','blog','video','web'],
    issue: ['news','social','blog','video','image','wiki','authority','web'],
    celebrity: ['news','video','social','image','blog','cafe','wiki','site','web'],
    celebrity_or_person: ['news','video','social','image','blog','cafe','wiki','site','web'],
    academic: ['academic','knowledge','wiki','site','book','news','web'],
    book: ['book','knowledge','wiki','blog','shopping','news','web'],
    sports: ['sports','news','video','social','image','blog','web'],
    knowledge: ['authority','knowledge','wiki','site','academic','video','image','web'],
    general: ['authority','knowledge','wiki','site','news','blog','image','video','social','local_tour','shopping','public_data','academic','web']
  };
  const preferred = profiles[intent] || profiles.general;
  const presentPreferred = preferred.filter(g => g === 'web' || hasCount(counts, g));
  const fallbackPresent = BASE_GROUP_ORDER.filter(g => hasCount(counts, g) && !presentPreferred.includes(g));

  // Keep the board focused, but never delete data: search.js will demote hidden
  // groups into ordinary web continuation instead of dropping them.
  const maxGroups = intent === 'general' ? 12 : 8;
  const visibleGroups = unique(presentPreferred.concat(fallbackPresent.slice(0, Math.max(0, maxGroups - presentPreferred.length)), ['web'])).slice(0, maxGroups);
  if(!visibleGroups.includes('web')) visibleGroups.push('web');

  const hiddenGroups = BASE_GROUP_ORDER.filter(g => g !== 'web' && !visibleGroups.includes(g));
  const groupOrder = unique(visibleGroups.concat(BASE_GROUP_ORDER));

  const visibleTabsMap = {
    local: ['all','map','tour','blog','image','video','news','site'],
    shopping: ['all','shopping','image','video','blog','site','news'],
    finance: ['all','finance','news','site','blog','video'],
    issue: ['all','news','sns','blog','video','image','wiki','site'],
    celebrity: ['all','news','video','sns','image','blog','cafe','wiki','site'],
    celebrity_or_person: ['all','news','video','sns','image','blog','cafe','wiki','site'],
    academic: ['all','academic','knowledge','wiki','site','book','news'],
    book: ['all','book','knowledge','wiki','blog','shopping','news'],
    sports: ['all','sports','news','video','sns','image','blog'],
    knowledge: ['all','knowledge','wiki','site','academic','video','image'],
    general: BASE_TABS
  };
  const visibleTabs = visibleTabsMap[intent] || visibleTabsMap.general;
  const hiddenTabs = BASE_TABS.filter(t => !visibleTabs.includes(t));

  const previewLimitByGroup = Object.assign({}, DEFAULT_PREVIEW_LIMITS);
  const moduleCapByGroup = Object.assign({}, DEFAULT_MODULE_CAPS);
  if(intent === 'issue') Object.assign(previewLimitByGroup, { news:6, social:5, blog:5, video:5, image:4, wiki:2, authority:2 });
  if(intent === 'celebrity' || intent === 'celebrity_or_person') Object.assign(previewLimitByGroup, { news:5, video:6, social:5, image:6, blog:5, cafe:4, wiki:2, local_tour:1 });
  if(intent === 'local') Object.assign(previewLimitByGroup, { local_tour:4, blog:5, image:5, video:4, news:3 });
  if(intent === 'shopping') Object.assign(previewLimitByGroup, { shopping:6, image:6, video:5, blog:5, site:4 });
  if(intent === 'finance') Object.assign(previewLimitByGroup, { finance:6, news:5, authority:3, site:4 });
  if(intent === 'academic') Object.assign(previewLimitByGroup, { academic:6, knowledge:4, wiki:3, site:4, book:4 });

  return { visibleGroups, hiddenGroups, groupOrder, visibleTabs, hiddenTabs, previewLimitByGroup, moduleCapByGroup };
}

function buildDisplayPolicy(input){
  input = input || {};
  const q = firstNonEmpty(input.q, input.query);
  const rawType = firstNonEmpty(input.type, input.searchType, input.tab, input.category, input.vertical, input.raw && (input.raw.type || input.raw.tab || input.raw.category));
  const items = []
    .concat(Array.isArray(input.items) ? input.items : [])
    .concat(Array.isArray(input.results) ? input.results : [])
    .concat(Array.isArray(input.pageItems) ? input.pageItems : []);
  const counts = countGroups(items);
  const intentInfo = inferIntent(q, counts, rawType);
  const p = policyForIntent(intentInfo, counts);

  return {
    status:'ok',
    engine:ENGINE_NAME,
    version:VERSION,
    mode:'query-intent-category-display-policy',
    query:q,
    intent:intentInfo.intent,
    confidence:intentInfo.confidence,
    reason:intentInfo.reason,
    visibleGroups:p.visibleGroups,
    hiddenGroups:p.hiddenGroups,
    groupOrder:p.groupOrder,
    categoryOrder:p.groupOrder,
    previewLimitByGroup:p.previewLimitByGroup,
    moduleCapByGroup:p.moduleCapByGroup,
    visibleTabs:p.visibleTabs,
    hiddenTabs:p.hiddenTabs,
    groupCounts:counts,
    cardContract:{ enabled:true, bodyLines:3, thumbnailPolicy:'natural-content-image-only; reject-logo-banner-placard; do-not-promote-poster-field', mapPolicy:'show-map-preview-for-local-tour', executor:'search.js' },
    execution:'search-js-applies-policy; maru-search-attaches-display-card-contract',
    externalCall:false,
    storageWrite:false
  };
}

function ok(body){
  return {
    statusCode:200,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Headers':'content-type, authorization',
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
    },
    body:JSON.stringify(body)
  };
}
function parseBody(event){
  try{
    const raw = event && event.body;
    if(!raw) return {};
    const text = event && event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : s(raw);
    return JSON.parse(text || '{}');
  }catch(e){ return {}; }
}
async function runEngine(event, params){
  const qs = event && event.queryStringParameters || {};
  const body = params || parseBody(event || {});
  return buildDisplayPolicy(Object.assign({}, qs, body));
}
async function handler(event){
  if(event && event.httpMethod === 'OPTIONS') return ok({ status:'ok', engine:ENGINE_NAME, version:VERSION });
  return ok(await runEngine(event || {}, null));
}

module.exports = {
  version:VERSION,
  engine:ENGINE_NAME,
  buildDisplayPolicy,
  runEngine,
  handler,
  groupOfItem,
  inferIntent,
  decorateDisplayItem,
  decorateItems
};
exports.version = VERSION;
exports.engine = ENGINE_NAME;
exports.buildDisplayPolicy = buildDisplayPolicy;
exports.runEngine = runEngine;
exports.handler = handler;
exports.decorateDisplayItem = decorateDisplayItem;
exports.decorateItems = decorateItems;
