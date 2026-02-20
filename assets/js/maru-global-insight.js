/* =========================================================
 * MARU Global Insight JS — Orchestrator (Addon-first)
 * - Receives requests from MaruAddon
 * - Calls engines (maru-global-insight + search-bank)
 * - Normalizes + distributes return payload back to addon
 * ========================================================= */
(function(){
  'use strict';
  if (window.MaruGlobalInsight) return;

  const CONFIG = {
    version: 'vNext-orchestrator-1',
    endpoints: {
      insight: '/.netlify/functions/maru-global-insight-engine',
      bank: '/.netlify/functions/search-bank-engine'
},

    limits: {
      bank: 30,
      insight: 20
    },
    timeouts: {
      ms: 12000
    }
  };

  function s(x){ return x==null? '' : String(x); }
  function nowISO(){ return new Date().toISOString(); }

  function withTimeout(promise, ms){
    let t;
    const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('TIMEOUT')), ms); });
    return Promise.race([promise, to]).finally(() => clearTimeout(t));
  }

  async function fetchJSON(url, opts){
    try{
      const r = await withTimeout(fetch(url, { cache:'no-store', ...opts }), CONFIG.timeouts.ms);
      if(!r.ok) throw new Error('HTTP_'+r.status);
      return await r.json();
    }catch(_){
      return null;
    }
  }

  function qs(obj){
    const p = new URLSearchParams();
    Object.entries(obj||{}).forEach(([k,v]) => {
      if(v==null || v==='') return;
      p.set(k, String(v));
    });
    return p.toString();
  }

  function pickTextSummary(query, bankRes, insightRes){
    // Prefer insight engine if it provides something meaningful
    const ir = insightRes && (insightRes.data || insightRes);
    const msg = s(insightRes?.message || insightRes?.summary || insightRes?.text || ir?.summary || '');
    if(msg.trim()) return msg.trim();

    const items = Array.isArray(bankRes?.items) ? bankRes.items : [];
    if(items.length){
      const top = items.slice(0,5).map(it => s(it.title||'').trim()).filter(Boolean);
      if(top.length) return `“${query}” 관련 상위 결과: ${top.join(' · ')}`;
    }
    return `“${query}” 관련 인사이트를 취합 중입니다.`;
  }

  function normalizeVideos(bankRes){
    const items = Array.isArray(bankRes?.items) ? bankRes.items : [];
    const vids = items.filter(it => (it.type||'') === 'video' || (it.media && (it.media.kind==='video' || it.media.type==='video')));
    return vids.slice(0,4).map(it => ({
      title: it.title,
      url: it.url,
      thumbnail: it.thumbnail,
      source: it.source,
      published_at: it.published_at
    }));
  }

  function normalizeIssues(insightRes){
    const d = insightRes?.data;
    if(d && Array.isArray(d.issues)) return d.issues;
    if(Array.isArray(insightRes?.issues)) return insightRes.issues;
    return null;
  }

  async function callInsight(q, mode){
    const url = CONFIG.endpoints.insight + '?' + qs({ q, mode: mode||'search', limit: CONFIG.limits.insight });
    return await fetchJSON(url);
  }

  async function callBank(q, limit){
    const url = CONFIG.endpoints.bank + '?' + qs({ q, limit: limit || CONFIG.limits.bank });
    return await fetchJSON(url);
  }

  async function dispatch(payload){
    const query = s(payload?.q || payload?.query || '').trim();
    if(!query) return { status:'fail', message:'EMPTY_QUERY' };

    // addon payload mapping
    const scope = s(payload?.scope || 'global');
    const target = payload?.target == null ? null : s(payload.target);
    const intent = s(payload?.intent || 'summary');

    // mode mapping (engine supports mode passthrough)
    let mode = 'search';
    if(intent === 'realtime' || payload?.mode === 'realtime-global') mode = 'realtime';

    const [insightRes, bankRes] = await Promise.all([
      callInsight(query, mode),
      callBank(query, CONFIG.limits.bank)
    ]);

    const headline = pickTextSummary(query, bankRes, insightRes);

    return {
      status: 'ok',
      engine: 'maru-global-insight-js',
      version: CONFIG.version,
      timestamp: nowISO(),
      query,
      context: { scope, target, intent, mode },
      text: headline,
      data: {
        issues: normalizeIssues(insightRes),
        videos: normalizeVideos(bankRes),
        bank: bankRes || null,
        insight: insightRes || null
      }
    };
  }

  window.MaruGlobalInsight = {
    version: CONFIG.version,
    dispatch
  };
})();
