"use strict";

/**
 * Keeps the committed visual sample card in every unoccupied slot while an
 * approved Canonical product replaces only its exact section/slot. Sample
 * cards are made non-clickable and non-revenue-bearing before publication.
 */

const VERSION = "sample-slot-overlay-v1.0.0-exact-slot-safe-placeholder";

function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
function text(value) { return value == null ? "" : String(value).trim(); }
function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function list(value) { return Array.isArray(value) ? value : (isObject(value) && Array.isArray(value.slots) ? value.slots : []); }
function setList(container, key, rows) {
  if (Array.isArray(container[key])) container[key] = rows;
  else if (isObject(container[key]) && Array.isArray(container[key].slots)) container[key].slots = rows;
  else container[key] = rows;
}
function canonicalRealCard(card) {
  const publication = card && card.canonicalPublication;
  const placement = card && card.placement;
  return !!(publication && publication.status === "published" && publication.releaseId && publication.candidateId && placement && placement.section && Number.isInteger(Number(placement.slot)));
}
function sampleFlag(card) {
  const type = text(card && card.type).toLowerCase();
  const origin = text(card && card.audit && card.audit.origin).toLowerCase();
  return !!(card && (card.sample === true || card.placeholder === true || card.isSample === true || type === "placeholder" || type === "sample" || origin === "placeholder_seed"));
}
function isSampleCard(card) { return !!card && !canonicalRealCard(card) && sampleFlag(card); }
function slotOf(card, fallback) {
  const values = [card && card.placement && card.placement.slot, card && card.slot, card && card.slotId, card && card.bind && card.bind.slot];
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return fallback;
}
function safeSample(card, section, slot) {
  const output = clone(card || {});
  output.type = "placeholder";
  output.sample = true;
  output.placeholder = true;
  output.isSample = true;
  output.realProduct = false;
  output.section = section;
  output.psom_key = section;
  output.slot = slot;
  output.slotId = slot;
  output.bind = Object.assign({}, isObject(output.bind) ? output.bind : {}, { section, slot });
  output.url = "#";
  output.link = "#";
  output.cta = output.cta || "";
  output.monetization = { enabled: false, model: { type: "sample" }, revenue: { estimated: 0, confirmed: 0, currency: "USD" }, settlement: { status: "not_applicable" } };
  output.directSale = { enabled: false, orderable: false };
  output.commerce = { mode: "sample_only", orderable: false };
  for (const key of ["externalProductUrl","officialProductUrl","affiliateOutboundUrl","externalOutboundUrl","outboundRoute","affiliate","revenueDestination","blockchainPayment","canonicalPublication","ipSlot","marketScope","productMapping","commerceCandidatePublication"]) delete output[key];
  return output;
}
function safeSampleCard(card) {
  if (!isSampleCard(card)) return false;
  if (text(card.url) !== "#" || text(card.link) !== "#") return false;
  if (card.externalProductUrl || card.affiliateOutboundUrl || card.externalOutboundUrl || card.outboundRoute || card.affiliate || card.canonicalPublication) return false;
  return !!(card.monetization && card.monetization.enabled === false && card.realProduct === false);
}
function overlayList(templateRows, realCards, section, capacityInput) {
  const originals = Array.isArray(templateRows) ? templateRows : [];
  const capacity = Math.max(1, Number(capacityInput) || originals.length || 100);
  const rows = [];
  for (let index = 0; index < capacity; index += 1) {
    const base = originals[index] || { id: "sample-" + section + "-" + String(index + 1).padStart(3, "0"), title: "Loading…", thumb: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" };
    rows.push(safeSample(base, section, index + 1));
  }
  const occupied = new Set();
  for (const card of Array.isArray(realCards) ? realCards : []) {
    if (!canonicalRealCard(card)) continue;
    const slot = slotOf(card, 0);
    if (!slot || slot > capacity || occupied.has(slot)) continue;
    occupied.add(slot);
    rows[slot - 1] = clone(card);
  }
  return rows;
}
function overlaySections(templateSections, realBySection) {
  const sections = clone(templateSections || {});
  for (const key of Object.keys(sections)) {
    const base = list(sections[key]);
    const real = realBySection instanceof Map ? (realBySection.get(key) || []) : (realBySection && realBySection[key] || []);
    setList(sections, key, overlayList(base, real, key, base.length || 100));
  }
  return sections;
}
function counts(rows) {
  let real = 0, sample = 0;
  for (const card of Array.isArray(rows) ? rows : []) {
    if (canonicalRealCard(card)) real += 1;
    else if (isSampleCard(card)) sample += 1;
  }
  return { real, sample, total: real + sample };
}

module.exports = { VERSION, clone, list, setList, canonicalRealCard, isSampleCard, safeSampleCard, safeSample, overlayList, overlaySections, slotOf, counts };
