/**
 * Public Media trending order (read-only, shared by MediaHub and its admin preview).
 * Input is the *published* media snapshot, never the unapproved candidate queue.
 * No publishing/approval side effects.
 */
export const SOURCES = Object.freeze(['media-movie','media-drama','media-variety','media-music']);
const LIMIT=50;
const txt=v=>String(v==null?'':v).trim();
const numeric=(o,keys)=>{for(const k of keys){const v=Number(o&&o[k]);if(Number.isFinite(v))return v;}return 0;};
export function itemsOf(section){
  if(Array.isArray(section))return section;
  if(section&&Array.isArray(section.items))return section.items;
  if(section&&Array.isArray(section.slots))return section.slots.map(s=>Object.assign({},s||{}, {
    title:s&&s.title||'',thumbnail:s&&(s.thumbnail||s.thumb)||'',
    url:s&&(s.url||s.video||s.link)||'',video:s&&s.video||'',provider:s&&s.provider||''
  }));
  return [];
}
export function sectionMapOf(snapshot){
  const out={};if(!snapshot)return out;
  const aliases={trending_now:'media-trending',latest_movie:'media-movie',latest_drama:'media-drama',section_3:'media-variety',section_6:'media-music'};
  const key=k=>aliases[k]||k;
  if(Array.isArray(snapshot.sections))snapshot.sections.forEach(s=>{if(s)out[key(s.key||'')]=s;});
  else if(snapshot.sections&&typeof snapshot.sections==='object')Object.keys(snapshot.sections).forEach(k=>{out[key(k)]=snapshot.sections[k];});
  return out;
}
const rawThumb=i=>txt(i&&(i.thumbnail||i.thumb||i.image||i.imageUrl||i.thumbnailUrl));
const source=i=>txt(i&&(i.video||i.streamUrl||i.mediaUrl||i.playbackUrl||i.sourceUrl||i.embedUrl||i.url||i.link));
const validThumb=u=>{const s=txt(u).toLowerCase();return !!s&&!/(?:media-sample-card\.png|placeholder|placehold\.co|placehold\.it)/.test(s)&&(/^(https:\/\/|\/[^/]|data:image\/(?:jpeg|png|webp);base64,)/.test(s));};
const idOf=i=>txt(i&&(i.contentId||i.id||i._id||i.videoId||i.slug||source(i)));
const blocked=i=>/(?:failed|unplayable|unavailable|blocked|broken|invalid|error|denied|forbidden)/.test(txt(i&&(i.playbackStatus||i.sourceStatus||i.playabilityStatus)).toLowerCase());
const pending=i=>i&&(i.thumbnailReady===false||i.thumbReady===false||i.frontThumbnailReady===false||/(?:pending|generating|processing|queued|recovering|capture|creating)/.test(txt(i.thumbnailStatus||i.thumbStatus||i.imageStatus).toLowerCase()));
function eligible(i){
  if(!i||!txt(i.title||i.name||i.text)||!source(i)||!idOf(i)||blocked(i)||pending(i)||!validThumb(rawThumb(i)))return false;
  const title=txt(i.title||i.name),cid=txt(i.contentId||i.id),provider=txt(i.provider&&typeof i.provider==='object'?i.provider.name:i.provider);
  return !(/\bmedia-sample-card\.png\b/.test(rawThumb(i))||(/^sample(?:\s+\d+)?$/i.test(title)&&(/^media-[a-z0-9-]+:\d+$/i.test(cid)||/^seed$/i.test(provider))));
}
function isMusicBroadcast(i){
  const tags=[i.title,i.name,i.genre,i.subgenre,i.category,i.programTitle,i.description,i.summary].concat(Array.isArray(i.tags)?i.tags:[]).join(' ').toLowerCase();
  return /(?:music\s*(?:show|competition|contest|audition|program|programme)|singing\s*(?:contest|competition|show)|audition|talent\s*show|music\s*festival|가왕|가요제|음악\s*방송|음악\s*경연|오디션|트로트\s*(?:경연|대회)|경연\s*프로그램|歌唱比赛|选秀节目|歌唱比賽|音楽番組)/i.test(tags);
}
function score(i,now){
  let th=700;
  if(i.thumbnailVerified===true||i.thumbVerified===true||i.thumbnailReady===true||i.frontThumbnailReady===true)th+=220;
  const st=txt(i.thumbnailStatus||i.thumbStatus||i.imageStatus).toLowerCase();
  if(/(?:verified|ready|approved|valid|ok)/.test(st))th+=140;
  if(/(?:failed|invalid|broken|blocked|error)/.test(st))th-=900;
  else if(/(?:slow|timeout|pending|processing|queued)/.test(st))th-=70;
  const w=numeric(i,['thumbnailWidth','thumbWidth','imageWidth']),h=numeric(i,['thumbnailHeight','thumbHeight','imageHeight']);
  if(w>=640&&h>=360)th+=100;else if(w>=320&&h>=180)th+=50;
  let play=300;
  if(i.playbackReady===true||i.frontPlaybackReady===true||i.sourceReady===true||i.playable===true)play+=180;
  const latency=numeric(i,['playbackLatencyMs','probeLatencyMs','latencyMs','loadLatencyMs']);
  if(latency>0){if(latency<=1200)play+=120;else if(latency<=2500)play+=60;else if(latency>5000)play-=70;}
  const ps=txt(i.playbackStatus||i.sourceStatus||i.playabilityStatus).toLowerCase();
  if(/(?:ready|verified|approved|playable|ok)/.test(ps))play+=100;
  else if(/(?:slow|timeout|pending|processing|queued)/.test(ps))play-=45;
  const date=Date.parse(i.publishedAt||i.releaseDate||i.createdAt||i.updatedAt||i.date||'');
  const days=Number.isFinite(date)?Math.max(0,(now-date)/86400000):3650;
  const recency=Number.isFinite(date)?Math.max(0,160-days*3):0;
  const views=numeric(i,['views','viewCount']);const pop=numeric(i,['popularity','score','rankingScore','qualityScore']);
  const rating=numeric(i,['rating','voteAverage']);const metrics=i.metrics&&typeof i.metrics==='object'?i.metrics:{};
  const interaction=Number(metrics.watchTime||0)+Number(metrics.like||0)+Number(metrics.recommend||0);
  const engagement=Math.min(220,Math.log10(Math.max(1,views))*28)+Math.min(160,pop*2)+Math.min(90,rating*9)+Math.min(90,Math.log10(Math.max(1,interaction))*18);
  const interest=numeric(i,['rankingScore','trendScore','hotScore','popularity','score']);
  return th+play+recency+engagement+Math.max(0,interest)*5+Math.max(0,1-days/90)*200;
}
export function rankMediaTrending(snapshotOrMap, now=Math.floor(Date.now()/86400000)*86400000){
  const sections=snapshotOrMap&&snapshotOrMap.sections?sectionMapOf(snapshotOrMap):snapshotOrMap||{};
  const seen=new Set(),rows=[];
  for(const sectionKey of SOURCES){
    for(const item of itemsOf(sections[sectionKey])){
      if(!eligible(item)||(sectionKey==='media-music'&&!isMusicBroadcast(item)))continue;
      const id=idOf(item);
      if(seen.has(id))continue;
      seen.add(id);rows.push({item,sectionKey,score:score(item,now),id});
    }
  }
  rows.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  return rows.slice(0,LIMIT);
}
