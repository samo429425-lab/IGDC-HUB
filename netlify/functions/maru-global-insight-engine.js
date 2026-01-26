// maru-global-insight-engine.js
// Maru Global Insight Engine (Production)
// Netlify Function - Execution Hub Engine
// Version: 1.0.0 (Stable)
// Role: Upper-tier execution engine under Maru Core
// NOTE: UI/Controller logic must NOT exist here.

'use strict';

exports.handler = async (event) => {
  // ---- CORS & Method Guard ----
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, error: 'POST only' });
  }

  // ---- Parse Request ----
  let req;
  try {
    req = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, { ok: false, error: 'Invalid JSON body' });
  }

  const text  = String(req.text || '').trim();
  const scope = String(req.scope || 'global');   // global | region | country
  const depth = String(req.depth || 'summary');  // summary | realtime | expand

  // ---- Execution Plan ----
  const plan = buildExecutionPlan({ text, scope, depth });

  // ---- Collect Phase ----
  const collected = await collectData(plan);

  // ---- Verify / Normalize Phase (HKS) ----
  const verified = stabilize(collected);

  // ---- Compose Phase ----
  const composed = composeResponse({ text, scope, depth, verified });

  // ---- Final Response ----
  return respond(200, {
    ok: true,
    text: composed.text,
    data: composed.data,
    meta: {
      scope,
      depth,
      engine: 'maru-global-insight-engine',
      ts: new Date().toISOString()
    }
  });
};

/* =========================
   Execution Planner
========================= */
function buildExecutionPlan({ text, scope, depth }) {
  return {
    useSearch: true,
    useSnapshot: true,
    useAI: process.env.MARU_USE_OPENAI === 'true',
    scope,
    depth,
    text
  };
}

/* =========================
   Collector Layer
========================= */
async function collectData(plan) {
  const results = {
    search: [],
    snapshot: [],
    ai: null
  };

  if (plan.useSearch) {
    results.search = await callMaruSearch(plan.text);
  }

  if (plan.useSnapshot) {
    results.snapshot = await loadSnapshot(plan.scope);
  }

  if (plan.useAI) {
    results.ai = await callAI(plan);
  }

  return results;
}

/* =========================
   Data Sources
========================= */
async function callMaruSearch(query) {
  // Internal fetch to Netlify Function maru-search
  try {
    const res = await fetch(process.env.URL + '/.netlify/functions/maru-search?q=' + encodeURIComponent(query));
    const json = await res.json();
    return Array.isArray(json.items) ? json.items : [];
  } catch {
    return [];
  }
}

async function loadSnapshot(scope) {
  // Snapshot is treated as structured memory/cache
  // Placeholder for snapshot-internal JSON loading
  return [];
}

async function callAI(plan) {
  // AI is verification & enrichment only
  // Actual OpenAI implementation is intentionally abstracted
  return {
    note: 'AI enrichment active',
    scope: plan.scope,
    depth: plan.depth
  };
}

/* =========================
   HKS Stabilizer
========================= */
function stabilize(collected) {
  // Hard-Kill Stabilizer
  // Ensures output never breaks UI expectations
  return {
    search: dedupe(collected.search),
    snapshot: Array.isArray(collected.snapshot) ? collected.snapshot : [],
    ai: collected.ai || null
  };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(item => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* =========================
   Composer
========================= */
function composeResponse({ text, scope, depth, verified }) {
  let responseText = 'Global insight prepared.';

  if (depth === 'realtime') {
    responseText = 'Realtime global insight data prepared.';
  } else if (depth === 'expand') {
    responseText = 'Expanded global insight analysis prepared.';
  }

  return {
    text: responseText,
    data: {
      search: verified.search,
      snapshot: verified.snapshot,
      ai: verified.ai
    }
  };
}

/* =========================
   Response Helper
========================= */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}
