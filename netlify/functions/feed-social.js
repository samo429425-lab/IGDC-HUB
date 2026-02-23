// feed-social.prod.js (SOCIAL FEED - PRODUCTION, Distribution-style pass-through)
// 역할: social.snapshot.json의 구조(완성본)를 그대로 중계한다.
// 원칙: 가공/생성/슬라이스 금지. snapshot이 없으면 빈 구조로 반환.
// 지원:
//  - GET /api/feed-social?key=<sectionId>  => { items: [...] }
//  - GET /api/feed-social                => { sections: { ... } }
//  - OPTIONS preflight

'use strict';

const fs = require('fs');
const path = require('path');

const SNAPSHOT_NAME = 'social.snapshot.json';

function corsHeaders(){
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function ok(obj){
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(obj) };
}

function err(statusCode, code, extra){
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(Object.assign({ error: code }, extra || {}))
  };
}

function readJsonIfExists(p){
  try{
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  }catch(_){
    return null;
  }
}

function fsCandidatePaths(){
  const cwd = process.cwd();
  const dir = __dirname || cwd;
  return [
    path.join(cwd, 'data', SNAPSHOT_NAME),
    path.join(cwd, 'netlify', 'functions', 'data', SNAPSHOT_NAME),
    path.join(dir, 'data', SNAPSHOT_NAME),
    path.join(dir, '..', 'data', SNAPSHOT_NAME),
    path.join(dir, '..', '..', 'data', SNAPSHOT_NAME),
    path.join(dir, 'functions', 'data', SNAPSHOT_NAME)
  ];
}

function guessSiteBaseUrl(){
  return process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '';
}

async function fetchSnapshotOverHttp(){
  const base = guessSiteBaseUrl();
  const urls = [];
  if(base) urls.push(`${String(base).replace(/\/$/, '')}/data/${SNAPSHOT_NAME}`);
  urls.push(`/data/${SNAPSHOT_NAME}`);

  for(const url of urls){
    try{
      const res = await fetch(url, { cache: 'no-store' });
      if(!res.ok) continue;
      return await res.json();
    }catch(_){
      // ignore
    }
  }
  return null;
}

async function loadSnapshot(){
  for(const p of fsCandidatePaths()){
    const json = readJsonIfExists(p);
    if(json) return json;
  }
  return await fetchSnapshotOverHttp();
}

function extractSections(snapshot){
  return (snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections) ||
         (snapshot && snapshot.sections) ||
         null;
}

exports.handler = async function(event){
  // Preflight
  if(event && event.httpMethod === 'OPTIONS'){
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try{
    const qs = (event && event.queryStringParameters) || {};
    const key = String(qs.key || qs.section || '').trim();

    const snapshot = await loadSnapshot();
    if(!snapshot){
      // 운영형: snapshot이 없으면 UI가 죽지 않게 empty 반환
      if(key) return ok({ items: [] });
      return ok({ sections: {} });
    }

    const sections = extractSections(snapshot);
    if(!sections){
      if(key) return ok({ items: [] });
      return ok({ sections: {} });
    }

    if(key){
      const items = sections[key];
      if(!Array.isArray(items) || items.length === 0) return ok({ items: [] });
      return ok({ items });
    }

    return ok({ sections });

  }catch(e){
    return err(500, 'FEED_SOCIAL_FAILED', { detail: String(e && (e.stack || e.message) || e) });
  }
};
