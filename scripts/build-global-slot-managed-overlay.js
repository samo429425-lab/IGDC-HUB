'use strict';

/*
 * Build-time publisher for Netlify.
 * Reads only approved/pinned assignments from Supabase and writes a small,
 * public-safe overlay. If DB is not configured or unavailable, it writes an
 * empty disabled overlay so the original SearchBank snapshot is preserved.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTS = [
  path.join(ROOT, 'data', 'search-bank.managed.overlay.json'),
  path.join(ROOT, 'netlify', 'functions', 'data', 'search-bank.managed.overlay.json')
];
function text(v){ return String(v == null ? '' : v).trim(); }
function write(value){ for (const target of OUTS) { fs.mkdirSync(path.dirname(target), { recursive:true }); fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n'); } }
function safeUrl(v){ try { const u = new URL(text(v)); return u.protocol === 'https:' ? u.toString() : ''; } catch (_) { return ''; } }
function baseOverlay(reason){ return { version:'gslot-managed-overlay-v1', enabled:false, generatedAt:new Date().toISOString(), reason, global:{ additions:[], patches:[], suppressions:[] }, scopedAssignments:[] }; }
function asItem(row){
  const candidate = Array.isArray(row.candidate) ? row.candidate[0] : row.candidate;
  const media = Array.isArray(row.media) ? row.media[0] : row.media;
  if (!candidate || !candidate.id || !candidate.title || !safeUrl(candidate.official_url)) return null;
  // Media cards are publication metadata only. They require explicit rights
  // clearance and a metadata/delivery approval; no stream URL is emitted.
  if (row.hub_key === 'media' && (!media || media.rights_status !== 'cleared' || !['approved_metadata','approved_for_delivery'].includes(media.workflow_status))) return null;
  const source = candidate.source_payload && typeof candidate.source_payload === 'object' ? candidate.source_payload : {};
  const item = Object.assign({}, source, {
    id: candidate.id,
    title: candidate.title,
    summary: candidate.description || source.summary || '',
    url: safeUrl(candidate.official_url),
    link: safeUrl(candidate.official_url),
    thumbnail: safeUrl(candidate.thumbnail_url) || source.thumbnail || source.thumb || source.image || '',
    thumb: safeUrl(candidate.thumbnail_url) || source.thumb || source.thumbnail || source.image || '',
    page: row.hub_key,
    channel: row.hub_key,
    type: source.type || (row.hub_key === 'media' ? 'video' : candidate.kind || 'content'),
    mediaType: source.mediaType || (row.hub_key === 'media' ? 'video' : undefined),
    officialSource: true,
    realContent: true,
    psom_key: row.slot_key,
    category: row.slot_key,
    priority: Number(row.priority || 0) + (row.manual_pinned ? 1000000 : 0),
    snapshotEligible: true,
    frontSupplyAllowed: true,
    searchBankEligible: true,
    riskLevel: 'low',
    mediaRegistry: row.hub_key === 'media' ? { rightsCleared:true, deliveryMode: media && media.delivery_mode || 'not_set', streamExposed:false } : undefined,
    managedSlot: {
      assignmentId: row.id,
      hub: row.hub_key,
      country: row.country_code,
      region: row.region_code || null,
      slotKey: row.slot_key,
      pinned: row.manual_pinned === true,
      source: 'global-slot-console'
    }
  });
  return item;
}
async function supabase(url, key, pathName){
  const r = await fetch(url.replace(/\/+$/, '') + '/rest/v1/' + pathName, { headers:{ apikey:key, Authorization:'Bearer '+key } });
  const raw = await r.text(); let data=null; try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = raw; }
  if(!r.ok) throw new Error((data && data.message) || raw || ('HTTP '+r.status));
  return data;
}
(async function main(){
  const url = text(process.env.GSLOT_SUPABASE_URL);
  const key = text(process.env.GSLOT_SUPABASE_SECRET_KEY || process.env.GSLOT_SUPABASE_SERVICE_ROLE_KEY || process.env.GSLOT_SUPABASE_SERVICE_KEY);
  if(!url || !key){ write(baseOverlay('supabase_not_configured')); console.log('[gslot] DB not configured; wrote disabled overlay.'); return; }
  try {
    const query = 'gslot_slot_assignments?select=id,candidate_id,hub_key,country_code,region_code,slot_key,priority,state,publication_status,manual_pinned,candidate:gslot_candidates(id,kind,title,official_url,thumbnail_url,description,status,source_payload,source_ref),media:gslot_media_profiles(candidate_id,workflow_status,rights_status,rights_basis,delivery_mode)&state=in.(approved,pinned)&publication_status=eq.ready&order=priority.desc';
    const rows = await supabase(url, key, query);
    const additions=[]; const scoped=[]; const suppressions=[];
    for(const row of Array.isArray(rows)?rows:[]){
      const candidate = Array.isArray(row.candidate)?row.candidate[0]:row.candidate;
      if(!candidate) continue;
      if(candidate.status === 'suppressed' && candidate.source_ref && row.country_code === 'GLOBAL') { suppressions.push(candidate.source_ref); continue; }
      const item = asItem(row); if(!item) continue;
      if(row.country_code === 'GLOBAL') additions.push(item); else scoped.push({ assignmentId:row.id, country:row.country_code, region:row.region_code||null, item });
    }
    const overlay = { version:'gslot-managed-overlay-v1', enabled:true, generatedAt:new Date().toISOString(), source:'supabase-approved-assignments', global:{ additions, patches:[], suppressions:[...new Set(suppressions)] }, scopedAssignments:scoped };
    write(overlay);
    console.log('[gslot] wrote overlay', { global:additions.length, scoped:scoped.length, suppressions:overlay.global.suppressions.length });
  } catch (error) {
    write(baseOverlay('supabase_fetch_failed:' + String(error && error.message || error).slice(0, 220)));
    console.warn('[gslot] Supabase overlay build failed. Original SearchBank is preserved:', error.message);
  }
})();
