'use strict';

/*
 * netlify/functions/maru-searchbank-sync.js
 * ------------------------------------------------------------
 * MARU SearchBank Sync — safe GET/POST contract + admin guarded write path
 *
 * Contract
 * - Browser wrapper may call this endpoint with GET query parameters.
 * - GET/health/probe/status must never write and must return safe JSON.
 * - Graph mutation and snapshot triggering are admin-guarded only.
 * - Existing graph file layout and sync payload shape are preserved.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = 'maru-searchbank-sync-v1.1.0-safe-get-post-admin-guard';
const GRAPH_ROOT = path.join(process.cwd(), 'data', 'searchbank');
const MAX_PAYLOAD_BYTES = 100000;

const GRAPH_MAP = {
  media: 'media/media.graph.json',
  commerce: 'commerce/commerce.graph.json',
  knowledge: 'knowledge/knowledge.graph.json',
  region: 'region/region.graph.json',
  insight: 'global-insight/global-insight.graph.json'
};

const TYPE_ALIAS = {
  media: 'media',
  commerce: 'commerce',
  knowledge: 'knowledge',
  region: 'region',
  insight: 'insight',
  'global-insight': 'insight',
  globalInsight: 'insight',
  sns: 'media',
  social: 'media',
  tour: 'knowledge'
};

function nowIso(){
  return new Date().toISOString();
}

function s(v){
  return String(v == null ? '' : v);
}

function low(v){
  return s(v).trim().toLowerCase();
}

function truthy(v){
  const x = low(v);
  return x === '1' || x === 'true' || x === 'yes' || x === 'on';
}

function firstNonEmpty(){
  for(let i = 0; i < arguments.length; i += 1){
    const v = arguments[i];
    if(v == null) continue;
    const text = s(v).trim();
    if(text) return text;
  }
  return '';
}

function jsonResponse(statusCode, payload){
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-sanmaru-admin-token, x-maru-admin-token'
    },
    body: JSON.stringify(payload || {})
  };
}

function safeClone(obj){
  try{
    return JSON.parse(JSON.stringify(obj || {}));
  }catch(e){
    return {};
  }
}

function requestHeaders(event){
  return (event && event.headers) || {};
}

function requestMethod(event){
  return s(event && event.httpMethod || 'GET').toUpperCase();
}

function envFirst(){
  for(let i = 0; i < arguments.length; i += 1){
    const key = arguments[i];
    const val = key && process && process.env ? process.env[key] : '';
    if(s(val).trim()) return s(val).trim();
  }
  return '';
}

function expectedAdminToken(){
  return envFirst(
    'SEARCHBANK_SYNC_ADMIN_TOKEN',
    'MARU_SYNC_ADMIN_TOKEN',
    'SANMARU_ADMIN_TOKEN',
    'MARU_ADMIN_TOKEN',
    'ADMIN_TOKEN'
  );
}

function requestToken(event, params){
  const h = requestHeaders(event);
  const auth = firstNonEmpty(h.authorization, h.Authorization);
  const bearer = /^Bearer\s+(.+)$/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  return firstNonEmpty(
    params && (params.adminToken || params.token || params.sanmaruAdminToken || params.maruAdminToken),
    h['x-sanmaru-admin-token'],
    h['X-Sanmaru-Admin-Token'],
    h['x-maru-admin-token'],
    h['X-Maru-Admin-Token'],
    bearer
  );
}

function isAdminRequest(event, params){
  const expected = expectedAdminToken();
  if(!expected) return false;
  const got = s(requestToken(event, params || {})).trim();
  if(!got) return false;
  try{
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }catch(e){
    return false;
  }
}

function mergeQuery(event){
  return Object.assign({}, (event && event.queryStringParameters) || {});
}

function parseBody(event){
  const raw = s(event && event.body || '');
  if(!raw.trim()) return { ok: true, payload: {}, bytes: 0 };
  const bytes = Buffer.byteLength(raw, 'utf8');
  if(bytes > MAX_PAYLOAD_BYTES){
    return { ok: false, code: 'payload_too_large', statusCode: 413, bytes };
  }
  try{
    return { ok: true, payload: JSON.parse(raw), bytes };
  }catch(e){
    return { ok: false, code: 'invalid_json', statusCode: 400, bytes };
  }
}

function mergedPayload(event){
  const method = requestMethod(event);
  const query = mergeQuery(event);
  if(method === 'GET'){
    return { ok: true, payload: query, source: 'query', bytes: Buffer.byteLength(JSON.stringify(query), 'utf8') };
  }
  const body = parseBody(event);
  if(!body.ok) return body;
  return {
    ok: true,
    payload: Object.assign({}, query, body.payload || {}),
    source: 'body',
    bytes: body.bytes
  };
}

function actionOf(payload){
  return low(payload && (payload.action || payload.fn || payload.cmd || payload.mode));
}

function isFastReadAction(action, payload){
  return ['health', 'probe', 'ping', 'status', 'fast-probe', 'fast_probe', 'readiness'].includes(action)
    || truthy(payload && (payload.health || payload.probe || payload.fastProbe || payload.noWrite));
}

function canonicalType(rawType){
  const raw = firstNonEmpty(rawType, 'knowledge');
  return TYPE_ALIAS[raw] || raw;
}

function graphFile(type){
  return path.join(GRAPH_ROOT, GRAPH_MAP[type]);
}

function emptyGraph(type){
  return {
    meta: {
      graphType: type,
      version: 1,
      updatedAt: nowIso()
    },
    items: [],
    nodes: [],
    edges: []
  };
}

function normalizeGraph(type, data){
  const graph = data && typeof data === 'object' ? data : emptyGraph(type);
  if(!graph.meta){
    graph.meta = {
      graphType: type,
      version: 1,
      updatedAt: nowIso()
    };
  }
  graph.meta.graphType = graph.meta.graphType || type;
  graph.meta.version = graph.meta.version || 1;
  graph.meta.updatedAt = graph.meta.updatedAt || nowIso();
  if(!Array.isArray(graph.items)) graph.items = [];
  if(!Array.isArray(graph.nodes)) graph.nodes = [];
  if(!Array.isArray(graph.edges)) graph.edges = [];
  return graph;
}

function loadGraph(type){
  const file = graphFile(type);
  if(!fs.existsSync(file)) return emptyGraph(type);
  try{
    const raw = fs.readFileSync(file, 'utf8');
    if(!raw || raw.trim() === '') return emptyGraph(type);
    return normalizeGraph(type, JSON.parse(raw));
  }catch(e){
    return emptyGraph(type);
  }
}

function saveGraph(type, graph){
  try{
    const file = graphFile(type);
    const dir = path.dirname(file);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = normalizeGraph(type, graph);
    data.meta.graphType = type;
    data.meta.version = data.meta.version || 1;
    data.meta.updatedAt = nowIso();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return { ok: true, path: file };
  }catch(e){
    return { ok: false, error: s(e && e.message || e) };
  }
}

function hashEntity(entity){
  return Buffer.from(JSON.stringify(entity || {})).toString('base64').slice(0, 24);
}

function ensureNode(graph, node){
  if(!node || !node.id) return;
  const exists = graph.nodes.find(n => n && n.id === node.id);
  if(!exists) graph.nodes.push(node);
}

function dedup(graph, entity){
  const id = entity.id || hashEntity(entity);
  const exists = graph.items.find(i => i && i.id === id);
  if(exists) return false;
  entity.id = id;
  graph.items.push(entity);
  ensureNode(graph, {
    id,
    type: entity.type || 'entity',
    label: entity.title || entity.name || id
  });
  return id;
}

function addEdge(graph, from, to, type){
  if(!from || !to || !type) return;
  const exists = graph.edges.find(e => e && e.from === from && e.to === to && e.type === type);
  if(!exists) graph.edges.push({ from, to, type });
}

function buildRelations(graph, entityId, entity){
  if(entity.region) addEdge(graph, entity.region, entityId, 'region-contains');
  if(entity.topic) addEdge(graph, entity.topic, entityId, 'topic-link');
  if(Array.isArray(entity.tags)){
    entity.tags.slice(0, 20).forEach(tag => addEdge(graph, s(tag), entityId, 'tag-link'));
  }
}

async function triggerSnapshot(){
  try{
    const snapshot = require('./snapshot-engine');
    if(snapshot && typeof snapshot.run === 'function'){
      await snapshot.run();
      return { ok: true, method: 'run' };
    }
    if(snapshot && typeof snapshot.runEngine === 'function'){
      await snapshot.runEngine();
      return { ok: true, method: 'runEngine' };
    }
    return { ok: true, skipped: true, reason: 'snapshot_runner_not_exported' };
  }catch(e){
    return { ok: false, error: s(e && e.message || e) };
  }
}

function graphSummary(type, graph){
  return {
    graph: type,
    items: Array.isArray(graph.items) ? graph.items.length : 0,
    nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
    edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
    updatedAt: graph.meta && graph.meta.updatedAt || null
  };
}

function healthPayload(event, payload){
  const summaries = {};
  Object.keys(GRAPH_MAP).forEach(type => {
    const file = graphFile(type);
    summaries[type] = {
      exists: fs.existsSync(file),
      path: path.relative(process.cwd(), file)
    };
  });
  return {
    ok: true,
    status: 'ok',
    engine: 'maru-searchbank-sync',
    version: VERSION,
    mode: 'safe-health',
    noWrite: true,
    admin: isAdminRequest(event, payload),
    graphRoot: path.relative(process.cwd(), GRAPH_ROOT) || GRAPH_ROOT,
    graphs: summaries,
    generatedAt: nowIso()
  };
}

function safeNoWritePayload(reason, event, payload, extra){
  const type = canonicalType(payload && payload.type);
  return Object.assign({
    ok: false,
    status: 'blocked',
    engine: 'maru-searchbank-sync',
    version: VERSION,
    synced: false,
    writeAllowed: false,
    noWrite: true,
    reason: reason || 'admin_token_required',
    graph: GRAPH_MAP[type] ? type : null,
    items: [],
    generatedAt: nowIso()
  }, extra || {});
}

async function syncPayload(event, payload){
  const method = requestMethod(event);
  const type = canonicalType(payload.type);

  if(!GRAPH_MAP[type]){
    return {
      ok: false,
      status: 'error',
      engine: 'maru-searchbank-sync',
      version: VERSION,
      code: 'unknown_graph_type',
      message: 'Unknown graph type',
      acceptedTypes: Object.keys(GRAPH_MAP),
      receivedType: payload.type || null,
      generatedAt: nowIso()
    };
  }

  if(!isAdminRequest(event, payload)){
    return safeNoWritePayload('admin_token_required_for_graph_write', event, payload, {
      method,
      acceptedReadOnly: true
    });
  }

  const entity = safeClone(payload);
  delete entity.adminToken;
  delete entity.token;
  delete entity.sanmaruAdminToken;
  delete entity.maruAdminToken;
  delete entity.action;
  delete entity.fn;
  delete entity.cmd;
  delete entity.mode;

  if(Object.keys(entity).length === 0){
    return safeNoWritePayload('empty_sync_payload', event, payload, { admin: true, graph: type });
  }

  const graph = loadGraph(type);
  const before = graphSummary(type, graph);
  const entityId = dedup(graph, entity);
  let save = { ok: true, skipped: true, reason: 'duplicate_entity' };
  let snapshot = { ok: true, skipped: true, reason: 'duplicate_entity' };

  if(entityId){
    buildRelations(graph, entityId, entity);
    save = saveGraph(type, graph);
    if(save.ok){
      snapshot = await triggerSnapshot();
    }
  }

  const after = graphSummary(type, graph);
  return {
    ok: !!save.ok,
    status: save.ok ? 'synced' : 'warn',
    engine: 'maru-searchbank-sync',
    version: VERSION,
    graph: type,
    id: entityId || entity.id || null,
    inserted: !!entityId,
    duplicate: !entityId,
    writeAllowed: true,
    noWrite: false,
    save,
    snapshot,
    before,
    after,
    generatedAt: nowIso()
  };
}

exports.handler = async function handler(event = {}){
  if(requestMethod(event) === 'OPTIONS') return jsonResponse(204, {});

  const parsed = mergedPayload(event);
  if(!parsed.ok){
    return jsonResponse(200, {
      ok: false,
      status: 'error',
      engine: 'maru-searchbank-sync',
      version: VERSION,
      code: parsed.code,
      noWrite: true,
      generatedAt: nowIso()
    });
  }

  const payload = parsed.payload || {};
  const action = actionOf(payload);

  try{
    if(isFastReadAction(action, payload)){
      return jsonResponse(200, healthPayload(event, payload));
    }

    if(action === 'read' || action === 'graph' || action === 'summary'){
      const type = canonicalType(payload.type);
      if(!GRAPH_MAP[type]){
        return jsonResponse(200, safeNoWritePayload('unknown_graph_type', event, payload, { acceptedTypes: Object.keys(GRAPH_MAP) }));
      }
      const graph = loadGraph(type);
      return jsonResponse(200, {
        ok: true,
        status: 'ok',
        engine: 'maru-searchbank-sync',
        version: VERSION,
        noWrite: true,
        graph: graphSummary(type, graph),
        generatedAt: nowIso()
      });
    }

    return jsonResponse(200, await syncPayload(event, payload));
  }catch(e){
    return jsonResponse(200, {
      ok: false,
      status: 'warn',
      engine: 'maru-searchbank-sync',
      version: VERSION,
      code: 'safe_handler_error',
      error: s(e && e.message || e),
      noWrite: true,
      items: [],
      generatedAt: nowIso()
    });
  }
};
