'use strict';

/**
 * feed-social.js — SOCIAL FEED (A-Standard, v4 aligned with socialnetwork.html keys)
 * 목적: socialnetwork.html / socialnetwork-automap.v3.js 가 기대하는 data.grid.sections 표준 출력
 * 소스: /data/social.snapshot.json 우선, 없으면 /data/search-bank.snapshot.json
 *
 * ✅ IMPORTANT: section ids must match socialnetwork.html [data-psom-key] values.
 */

const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(process.cwd(), 'data');
const SNAPSHOT_PATH = path.join(DATA_ROOT, 'social.snapshot.json');
const BANK_PATH = path.join(DATA_ROOT, 'search-bank.snapshot.json');

// socialnetwork.html에 실제로 존재하는 data-psom-key들 (정본)
const DEFAULT_SECTIONS = [
  'social-youtube',
  'social-tiktok',
  'social-instagram',
  'social-facebook',
  'social-twitter',
  'social-threads',
  'social-telegram',
  'social-discord',
  'social-community',
  'socialnetwork'
];

function safeReadJSON(p){
  try { return JSON.parse(fs.readFileSync(p,'utf-8')); }
  catch(e){ return null; }
}

function pick(obj, keys){
  for(const k of keys){
    const v = obj && obj[k];
    if(typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function normalizeCard(item, section, idx){
  const title = pick(item, ['title','name','label','caption','text']) || 'Item';
  const url   = pick(item, ['url','href','link','path','detailUrl','productUrl','checkoutUrl']) || '#';
  const thumb = pick(item, ['thumb','image','img','thumbnail','thumbnailUrl','cover','poster','thumbnail_url']) ||
                pick(item, ['thumbnail']) ||
                (item && item.media && item.media.preview && (item.media.preview.poster || '')) ||
                '';
  const srcObj = (item && typeof item.source === 'object') ? item.source : null;
  const source = srcObj ? (pick(srcObj, ['platform','name']) || null) : (pick(item, ['source','provider','site','platform']) || null);

  return {
    id: item.id || `${section}-${idx+1}`,
    section,
    title,
    url,
    thumb,
    source,
    type: item.type || item.mediaType || 'thumbnail',
    lang: item.lang || null,
    priority: item.priority ?? (idx+1),
    payload: item.payload || item.extension || null
  };
}

function buildGridFromSnapshot(snapshot, lang){
  const sectionsObj = snapshot?.pages?.social?.sections || {};
  return DEFAULT_SECTIONS.map((sid) => {
    const arr = Array.isArray(sectionsObj[sid]) ? sectionsObj[sid] : [];
    const items = arr.map((it,i)=>normalizeCard(it,sid,i))
      .filter(c => !lang || !c.lang || String(c.lang).toLowerCase() === String(lang).toLowerCase());
    return { id: sid, items };
  });
}

function buildGridFromBank(bank, lang){
  const items = Array.isArray(bank?.items) ? bank.items : [];

  // bank는 기본적으로 social-1..9 섹션 구조였으므로, 여기서는 'channel=social'만 추출해서
  // 화면 섹션들에 균등 분배(플랫폼 키가 없으면 어차피 비어있게 됨)
  const socialItems = items.filter(it => String(it?.channel || '').toLowerCase() === 'social');

  const pool = socialItems.length ? socialItems : [];
  return DEFAULT_SECTIONS.map((sid) => {
    // NOTE: bank 기반 fallback은 최소화 (추정 혼합 방지). pool이 없으면 빈 배열.
    const out = pool.slice(0, 24).map((it,i)=>normalizeCard(it,sid,i))
      .filter(c => !lang || !c.lang || String(c.lang).toLowerCase() === String(lang).toLowerCase());
    return { id: sid, items: out };
  });
}

function jsonResponse(statusCode, obj){
  return {
    statusCode,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Headers':'content-type'
    },
    body: JSON.stringify(obj)
  };
}

exports.handler = async function(event){
  try{
    const qs = (event && event.queryStringParameters) || {};
    const pageRaw = String(qs.page || qs.p || 'social').trim().toLowerCase();
    const lang = qs.lang ? String(qs.lang).trim().toLowerCase() : null;

    // socialnetwork-automap.v3.js는 page=socialnetwork로 호출함 → 내부 page는 social로 통일
    const page = (pageRaw === 'socialnetwork' || pageRaw === 'social-network') ? 'social' : pageRaw;

    const snap = safeReadJSON(SNAPSHOT_PATH);
    const bank = safeReadJSON(BANK_PATH);

    let sections = DEFAULT_SECTIONS.map(id => ({ id, items: [] }));
    let mode = 'empty';

    if(page === 'social' && snap){
      sections = buildGridFromSnapshot(snap, lang);
      mode = 'snapshot';
    } else if(page === 'social' && bank){
      sections = buildGridFromBank(bank, lang);
      mode = 'bank';
    }

    const count = sections.reduce((a,s)=>a+(s.items? s.items.length:0), 0);

    return jsonResponse(200, {
      status:'ok',
      page,
      lang: lang || null,
      mode,
      generated_at: new Date().toISOString(),
      grid: { sections },
      count,
      debug: {
        expected_section_ids: DEFAULT_SECTIONS,
        snapshot_found: !!snap,
        bank_found: !!bank
      }
    });
  }catch(e){
    return jsonResponse(200, {
      status:'error',
      page:'social',
      message:'feed-social failed',
      detail: String(e && e.message || e)
    });
  }
};
