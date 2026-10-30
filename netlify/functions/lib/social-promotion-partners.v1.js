"use strict";
/* IGDC Social contract-only promotion overlay; never a discovery seed or eligibility bypass. */
const Store = require("./social-candidate-store.v1");
const TABLE = "social_promotion_partners";
const SECTIONS = new Set(["social-youtube", "social-instagram", "social-tiktok", "social-facebook", "social-reddit"]);
const HOSTS = {
  "social-youtube": ["youtube.com", "youtu.be"], "social-instagram": ["instagram.com"],
  "social-tiktok": ["tiktok.com"], "social-facebook": ["facebook.com"],
  "social-reddit": ["reddit.com"]
};
const text = Store.text;
function validUrl(raw, section) {
  try {
    const url = new URL(text(raw));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const host = url.hostname.toLowerCase();
    if (section && !(HOSTS[section] || []).some(x => host === x || host.endsWith("." + x))) return "";
    if (["localhost", "127.0.0.1"].includes(host)) return "";
    return url.toString();
  } catch (_) { return ""; }
}
function key(value) {
  try {
    const u = new URL(text(value));
    if (!validUrl(u.toString())) return "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|igshid$|si$|ref$|feature$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "").toLowerCase() + (u.search || "");
  } catch (_) { return ""; }
}
function active(p, at) {
  const today = (at || new Date()).toISOString().slice(0,10);
  return p && p.cooperation_status === "active" && p.priority_enabled === true &&
    !!p.verified_at && !!p.verified_by && !!p.contract_proof_reference &&
    !!p.signed_from && p.signed_from <= today && (!p.signed_until || p.signed_until >= today) &&
    SECTIONS.has(p.section_key) && !!validUrl(p.channel_url, p.section_key);
}
async function list() {
  return Store.supabase(Store.rest(TABLE,"select=*&order=updated_at.desc&limit=500"), { method: "GET" });
}
async function verified() {
  const listRows = await Store.supabase(Store.rest(TABLE,
    "select=*&cooperation_status=eq.active&priority_enabled=eq.true&verified_at=not.is.null&order=updated_at.desc&limit=500"), {method:"GET"});
  return (Array.isArray(listRows) ? listRows : []).filter(p => active(p));
}
function possibleChannels(row) {
  const raw = row && row.raw && typeof row.raw === "object" ? row.raw : {};
  const ev = row && row.evidence && typeof row.evidence === "object" ? row.evidence : {};
  return [row && row.channel_url, raw.channelUrl, raw.channel_url, raw.creatorProfileUrl,
    ev.channelUrl, ev.channel_url, ev.creatorProfileUrl].map(key).filter(Boolean);
}
function decorate(rows, partners) {
  const verifiedMap = new Map();
  (partners || []).filter(p => active(p)).forEach(p => verifiedMap.set(p.section_key + "|" + key(p.channel_url), p));
  let matched = 0;
  const enriched = (Array.isArray(rows) ? rows : []).map(row => {
    if (!Store.isPublishEligibleContentRow(row)) return row;
    const section = text(row && (row.section_key || row.sectionKey));
    const partner = possibleChannels(row).map(x => verifiedMap.get(section + "|" + x)).find(Boolean);
    if (!partner) return row;
    matched++;
    // Ranking overlay is in memory only. DB scores, contracts, approvals and original provider design remain unchanged.
    return Object.assign({}, row, {rotation_score: Number(row.rotation_score || 0) + 12000,
      __igdcVerifiedPartnerPriority: true});
  });
  return { rows: enriched, matched, activePartners: verifiedMap.size };
}
async function apply(rows) {
  try { return Object.assign({ configured: true }, decorate(rows, await verified())); }
  catch (error) {
    // Fail open: a missing migration/temporary partner DB outage must NEVER break Social publishing.
    return {rows: rows || [], matched: 0, activePartners: 0, configured:false,
      warning: text(error.code || error.message || "partner_storage_unavailable").slice(0, 160)};
  }
}
/* Publish-time ordering. Only approved verified candidates can move ahead of
 * organic content, and only in the five managed SNS rows. Reserved rightPanel
 * and social-maru are never read or modified. */
function prioritizeSnapshotSlots(snapshot, rows) {
  const sections = snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections;
  if (!sections || typeof sections !== "object") return {prioritized:0, inserted:0, displaced:0};
  const allowed = new Set((snapshot.meta && snapshot.meta.appliedSections) || []);
  const stats = {prioritized:0, inserted:0, displaced:0, bySection:{}};
  for (const sectionKey of SECTIONS) {
    if (!allowed.has(sectionKey) || !Array.isArray(sections[sectionKey])) continue;
    const source = sections[sectionKey];
    const capacity = source.length;
    if (!capacity) continue;
    const candidates = (rows || []).filter(r =>
      r && r.__igdcVerifiedPartnerPriority === true &&
      text(r.section_key || r.sectionKey) === sectionKey &&
      Store.isPublishEligibleContentRow(r));
    candidates.sort((a,b) => Store.rowScore(b) - Store.rowScore(a));
    const leaders=[], ids=new Set();
    let inserted=0;
    for (const row of candidates) {
      const id = text(row.id);
      if (!id || ids.has(id) || leaders.length>=capacity) continue;
      const existing = source.find(slot => Store.slotCandidateId(slot) === id && slot.type === "external_social");
      const mapped = existing || Store.publicSocialSlot(row, leaders.length+1, {});
      if (!mapped || mapped.type!=="external_social") continue;
      leaders.push(mapped);ids.add(id);
      if (!existing) inserted++;
    }
    if (!leaders.length) continue;
    const remaining = source.filter(slot => !ids.has(Store.slotCandidateId(slot)));
    const tailCount = Math.max(0,capacity-leaders.length);
    const displaced = Math.max(0,remaining.slice(tailCount).filter(x=>x && x.type==="external_social").length);
    sections[sectionKey] = leaders.concat(remaining.slice(0,tailCount));
    stats.prioritized += leaders.length;
    stats.inserted += inserted;
    stats.displaced += displaced;
    stats.bySection[sectionKey]={prioritySlots:leaders.length,inserted,displaced};
  }
  if(stats.prioritized) {
    snapshot.meta = Object.assign({},snapshot.meta, {verifiedPartnerPriority:{
      policy:"verified_signed_active_contract_and_publish_eligible_content_only",...stats}});
  }
  return stats;
}
module.exports = {TABLE,SECTIONS,HOSTS,validUrl,key,active,list,verified,decorate,apply,prioritizeSnapshotSlots};
