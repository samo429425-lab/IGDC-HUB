"use strict";

/**
 * Supplemental influencer registry follows the *verified, stored* Social front.
 * Content discovery never depends on the registry. This file must not be used
 * as a search seed, gate, or publication prerequisite.
 *
 * Important: a scoped Social release must never remove entries belonging to
 * another country/region. Pruning is global-only, verified-release-only, and
 * fail-closed per section if an active author cannot be resolved or a DB read
 * is truncated. Excluded/blocked moderation rows are retained for audit.
 */
const Store = require("./social-candidate-store.v1");
const ChannelLink = require("./social-channel-link.v1");
const VERSION = "social-influencer-front-sync-v1.0.0";
const MAX_PER_SECTION = 1000;
const WRITE_CHUNK = 40;
const SECTIONS = Store.Policy.SECTION_KEYS;
const BLOCKED = new Set(["blocked", "permanent_blocked", "search_excluded", "rejected"]);
const t = Store.text;
const obj = Store.plain;
const val = (row, a, b) => t(row && (row[a] || row[b]));

function normalizedUrl(value) {
  try {
    const u = new URL(t(value));
    if (u.protocol !== "https:") return "";
    u.hash = "";
    const profileId = /\/profile\.php$/i.test(u.pathname) ? u.searchParams.get("id") : "";
    u.search = "";
    return u.origin.toLowerCase() + u.pathname.replace(/\/+$/, "") +
      (profileId ? "?id=" + encodeURIComponent(profileId) : "");
  } catch (_) { return ""; }
}
function isGlobal(route) {
  return ["global", "global_fallback"].includes(t(route && route.scopeMode).toLowerCase()) &&
    !t(route && route.countryCode) && !t(route && (route.worldRegion || route.regionId));
}
function scope(route) {
  return isGlobal(route) ? "GLOBAL" : (t(route && route.countryCode).toUpperCase() || (t(route && (route.worldRegion || route.regionId)) ? "REGION:" + t(route && (route.worldRegion || route.regionId)) : "NON_GLOBAL"));
}
function frontSlots(snapshot, section) {
  const social = obj(obj(snapshot.pages).social);
  const values = obj(social.sections)[section];
  return (Array.isArray(values) ? values : []).filter((slot) =>
    t(slot.type) === "external_social" && t(obj(slot.audit).origin) === "social_candidates"
  );
}
function urlForCreator(slot, row, section) {
  const platform = section.replace(/^social-/, "");
  const social = obj(slot.social), raw = obj(row && row.raw), evidence = obj(row && row.evidence);
  // Prioritize verified profile fields, never turn a video URL into a profile.
  const candidates = [social.channelUrl, raw.channelUrl, raw.channel_url,
    evidence.channelUrl, row && row.channel_url];
  for (const value of candidates) {
    if (!t(value)) continue;
    const resolved = ChannelLink.resolve(value, {platform});
    if (resolved.ok && t(resolved.channelUrl)) return resolved.channelUrl;
  }
  // A TikTok permalink /@user/video/123 already contains the author identity.
  // ChannelLink can convert it without network requests.
  const contentUrl = t(slot.url || slot.sourceUrl || (row && row.source_url));
  if (contentUrl) {
    const resolved = ChannelLink.resolve(contentUrl, {platform});
    if (resolved.ok && t(resolved.channelUrl)) return resolved.channelUrl;
  }
  return "";
}
function existingChannel(row) {
  const raw = obj(row.raw), evidence = obj(row.evidence);
  return normalizedUrl(raw.channelUrl || evidence.channelUrl || row.source_url);
}
function assetClass(row) {
  return Store.assetClassOf(row);
}
function creatorName(slot, row) {
  return t(slot.creatorName || (row && row.creator_name) || slot.creator || (row && row.creator_handle) || slot.creatorHandle);
}
function sectionStatus(rows, snapshot) {
  const rowsById = new Map(rows.filter((r) => assetClass(r) === "latest_content").map((r) => [t(r.id), r]));
  const active = new Map(), unresolved = {};
  for (const section of SECTIONS) {
    unresolved[section] = 0;
    for (const slot of frontSlots(snapshot, section)) {
      const id = t(slot.contentId || slot.candidateId || slot.id || obj(slot.audit).candidate_id);
      const row = rowsById.get(id);
      const url = urlForCreator(slot, row, section);
      const identity = normalizedUrl(url);
      if (!identity) { unresolved[section]++; continue; }
      const key = section + "|" + identity;
      const entry = active.get(key) || {section, url, identity, name: "", handle: "", contentIds: [], row: null, slot: null};
      entry.contentIds.push(id);
      const name = creatorName(slot, row);
      if (name && !entry.name) entry.name = name;
      if (!entry.handle) entry.handle = t(slot.creatorHandle || (row && row.creator_handle));
      if (!entry.row && row) entry.row = row;
      if (!entry.slot) entry.slot = slot;
      active.set(key, entry);
    }
  }
  return {active, unresolved};
}
function entryFromPrevious(row) {
  return {section:t(row.section_key), identity:existingChannel(row)};
}
function legacyUnscoped(row) {
  const raw = obj(row.raw);
  const countries = raw.countryScopes || raw.country_scopes || [];
  return !(Array.isArray(countries) && countries.length);
}
function scopesFor(row) {
  const state = obj(obj(row && row.raw).frontRegistrySync);
  const scopes = Object.assign({}, obj(state.activeScopes));
  // Backward-compatible single-scope metadata from earlier patch revisions.
  if (!Object.keys(scopes).length && state.managed === true && t(state.scope)) {
    scopes[t(state.scope)] = {ids:Array.isArray(state.linkedFrontContentIds) ? state.linkedFrontContentIds : []};
  }
  return scopes;
}
function buildCandidate(entry, old, releaseId, scopeKey, store) {
  const linked = [...new Set(entry.contentIds.filter(Boolean))];
  const name = entry.name || t(old && (old.creator_name || old.title)) ||
    t(ChannelLink.resolve(entry.url, {platform:entry.section.replace(/^social-/, "")}).suggestedTitle) || "SNS creator";
  const rawPrevious = obj(old && old.raw);
  const activeScopes = scopesFor(old);
  const previousIds = obj(activeScopes[scopeKey]).ids;
  const sameIds = Array.isArray(previousIds) &&
    previousIds.length === linked.length && previousIds.every((id) => linked.includes(id));
  // Avoid hundreds of redundant DB writes when an unchanged release is applied.
  if (old && sameIds && obj(rawPrevious.frontRegistrySync).managed === true) return null;
  activeScopes[scopeKey] = {ids:linked.slice(0,100),count:linked.length,releaseId};
  const detail = {
    managed: true,
    source: "verified_stored_social_front",
    active: true,
    scope: scopeKey,
    releaseId,
    activeScopes,
    linkedFrontContentIds: linked.slice(0, 100),
    linkedFrontCount: linked.length,
    syncedAt: store.nowIso()
  };
  if (old) {
    return Object.assign({}, old, {
      creator_name: t(old.creator_name) || name,
      creator_handle: t(old.creator_handle) || entry.handle,
      title: t(old.title) || name,
      raw: Object.assign({}, rawPrevious, {
        assetClass: "influencer_registry", channelUrl: entry.url,
        frontRegistrySync: detail
      }),
      updated_by: "social-front-influencer-sync",
      updated_at: store.nowIso()
    });
  }
  // Registration is supplemental; it does not imply verification or promotion.
  return store.normalizeCandidate({
    assetClass: "influencer_registry", sectionKey: entry.section,
    platform: entry.section.replace(/^social-/, ""),
    title: name, creatorName: name, creatorHandle: entry.handle,
    sourceUrl: entry.url, channelUrl: entry.url,
    channelAsset: true, latestContentAsset: false,
    publicAccess: true, loginRequired: false, accessStatus: "public",
    candidateOnly: true, reviewStatus: "pending",
    verificationStatus: "web_verification_required",
    thumbnailUrl: t(entry.row && entry.row.raw && entry.row.raw.channelThumbnailUrl),
    countryScopes: obj(entry.row && entry.row.raw).countryScopes || [],
    languageScopes: obj(entry.row && entry.row.raw).languageScopes || [],
    frontRegistrySync: detail
  }, {memberId:"social-front-influencer-sync"});
}
async function reconcile(options) {
  const o = options || {};
  const store = o.store || Store;
  const snapshot = o.snapshot;
  const route = o.route || {};
  const releaseId = t(o.releaseId);
  if (!snapshot || !obj(obj(snapshot.pages).social).sections || !releaseId || !o.verifiedStoredRelease) {
    return {ok:false, version:VERSION, reason:"verified_stored_front_required", created:0, updated:0, deleted:0};
  }
  const expectedHash = t(o.snapshotHash);
  if (expectedHash && store.sha256(snapshot) !== expectedHash) {
    return {ok:false, version:VERSION, reason:"release_snapshot_hash_mismatch", created:0, updated:0, deleted:0};
  }
  const rows = await store.selectCandidatesBySections("select=*&order=updated_at.desc&limit="+MAX_PER_SECTION, MAX_PER_SECTION);
  if (!Array.isArray(rows)) throw new Error("influencer_sync_candidate_read_invalid");
  const sc = scope(route);
  const {active, unresolved} = sectionStatus(rows, snapshot);
  const existing = rows.filter((r) => assetClass(r) === "influencer_registry");
  const byKey = new Map();
  for (const old of existing) {
    const {section, identity} = entryFromPrevious(old);
    if (!identity) continue;
    const key = section + "|" + identity;
    // Prefer non-excluded records and otherwise preserve the first existing ID.
    const previous = byKey.get(key);
    if (!previous || BLOCKED.has(t(previous.review_status)) && !BLOCKED.has(t(old.review_status))) byKey.set(key, old);
  }
  const inserts = [], updates = [], missing = [], blocked = [];
  for (const [key, entry] of active) {
    const old = byKey.get(key);
    if (old && BLOCKED.has(t(old.review_status))) { blocked.push(key); continue; }
    const created = buildCandidate(entry, old, releaseId, sc, store);
    if (old && created === null) continue; // already linked to identical front posts
    if (!created || !t(created.id)) { missing.push(key); continue; }
    if (old) updates.push(created); else inserts.push(created);
  }
  // Scoped publications only remove their own scope references. A creator
  // shared by Korea/Japan, for example, remains until both fronts remove them.
  const prunableSections = SECTIONS.filter((s) =>
    unresolved[s] === 0 && rows.filter((r) => t(r.section_key) === s).length < MAX_PER_SECTION
  );
  const deletes = [], scopeRemovals = [];
  for (const old of existing) {
    const section = t(old.section_key);
    if (!prunableSections.includes(section) || BLOCKED.has(t(old.review_status))) continue;
    const identity = existingChannel(old);
    if (!identity) continue;
    const key = section + "|" + identity;
    if (active.has(key) && byKey.get(key) === old) continue;
    const raw = obj(old.raw), oldSync = obj(raw.frontRegistrySync);
    // Existing untracked registry rows are only pruned from a fully resolved,
    // explicitly global front. A country-specific front cannot erase them.
    if (oldSync.managed !== true) {
      if (isGlobal(route) && legacyUnscoped(old)) deletes.push(t(old.id));
      continue;
    }
    const activeScopes = scopesFor(old);
    if (activeScopes[sc]) delete activeScopes[sc];
    // Preserve identities still visible in other countries/regions.
    if (Object.keys(activeScopes).length) {
      if (Object.keys(scopesFor(old)).length !== Object.keys(activeScopes).length) {
        scopeRemovals.push(Object.assign({}, old, {
          raw: Object.assign({}, raw, {frontRegistrySync:Object.assign({}, oldSync, {
            scope:sc, activeScopes, active:true, syncedAt:store.nowIso()
          })}),
          updated_at:store.nowIso(), updated_by:"social-front-influencer-sync"
        }));
      }
    } else if (Object.keys(scopesFor(old)).length || isGlobal(route)) {
      deletes.push(t(old.id));
    }
  }
  // If a newly discovered channel could not be persisted, absolutely no
  // cleanup is allowed; an incomplete update must never erase older creators.
  if (missing.length) {
    return {ok:false, version:VERSION, reason:"creator_identity_normalization_failed",
      missing:missing.length, created:0, updated:0, deleted:0};
  }
  // Never prune if registration wasn't persisted completely.
  const writes = inserts.concat(updates,scopeRemovals);
  for (let start=0; start < writes.length; start += WRITE_CHUNK) {
    const list = writes.slice(start,start+WRITE_CHUNK);
    const persisted = await store.upsertCandidates(list);
    if (!Array.isArray(persisted) || persisted.length !== list.length) {
      throw new Error("influencer_sync_upsert_readback_count_mismatch");
    }
  }
  // A limited, partial, or failed read cannot trigger deletion.
  for (let start=0; start < deletes.length; start += WRITE_CHUNK) {
    const list = deletes.slice(start,start+WRITE_CHUNK);
    const removed = await store.deleteCandidates(list);
    if (!Array.isArray(removed) || removed.length !== list.length) {
      throw new Error("influencer_sync_delete_readback_count_mismatch");
    }
  }
  return {
    ok:true, version:VERSION, releaseId, scope:sc,
    activeCreators:active.size, created:inserts.length, updated:updates.length + scopeRemovals.length,
    deleted:deletes.length, blocked:blocked.length, unresolved,
    deletionProtectedSections:SECTIONS.filter((s)=>!prunableSections.includes(s)),
    missing:missing.length
  };
}
module.exports = {VERSION, reconcile, sectionStatus, normalizedUrl, isGlobal};
