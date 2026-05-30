/**
 * trustFilter.core.v1.js
 * --------------------------------------------------
 * Maru Platform – Core Screening Filter Engine
 * Role: Final gate for snapshot generation
 * Policy: block known-dangerous inputs, but do not require allowlist membership by default.
 * --------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ===== Load Trust Lists =====
function readJsonSafe(filePath, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

const ALLOW_LIST = readJsonSafe(
  path.join(__dirname, '../data/trust.allowlist.json'),
  { domains: [], sources: [] }
);

const BLOCK_LIST = readJsonSafe(
  path.join(__dirname, '../data/trust.blocklist.json'),
  { domains: [], tlds: [], patterns: [], categories: [], keywords: [], sources: [] }
);

// ===== Core Config =====
// Only title/url are universal across commerce, media, social, network and tour snapshots.
// source/country/currency are checked when present, but are not hard-required by default.
const REQUIRED_FIELDS = [
  'title',
  'url'
];

// ===== Utility =====
function arr(v) {
  return Array.isArray(v) ? v : [];
}

function normalize(str) {
  return String(str == null ? '' : str).toLowerCase().trim();
}

function containsAny(target, keywords) {
  const t = normalize(target);
  return arr(keywords).some(k => t.includes(normalize(k)));
}

function safeUrl(url) {
  try { return new URL(String(url || '')); } catch (e) { return null; }
}

function hostnameOf(url) {
  const u = safeUrl(url);
  return u ? normalize(u.hostname).replace(/^www\./, '') : '';
}

function tldOf(hostname) {
  const parts = normalize(hostname).split('.').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function domainMatch(hostname, domains) {
  const host = normalize(hostname).replace(/^www\./, '');
  if (!host) return false;
  return arr(domains).some(d => {
    const dom = normalize(d).replace(/^www\./, '');
    return !!dom && (host === dom || host.endsWith('.' + dom));
  });
}

function patternMatch(text, patterns) {
  const body = String(text || '');
  const lowBody = normalize(body);
  return arr(patterns).some(p => {
    if (!p) return false;
    try { return new RegExp(String(p), 'i').test(body); }
    catch (e) { return lowBody.includes(normalize(p)); }
  });
}

function combinedText(item) {
  return [
    item && item.title,
    item && item.name,
    item && item.summary,
    item && item.description,
    item && item.source,
    item && item.url,
    Array.isArray(item && item.tags) ? item.tags.join(' ') : ''
  ].filter(Boolean).join(' ');
}

function isTrusted(item, host) {
  const source = normalize(item && item.source);
  return (
    domainMatch(host, ALLOW_LIST.domains) ||
    (!!source && arr(ALLOW_LIST.sources).some(s => source === normalize(s)))
  );
}

// ===== Core Evaluation =====
function evaluateTrust(item, context = {}) {
  const reasons = [];

  if (!item || typeof item !== 'object') {
    return { ok: false, trusted: false, score: 0, reasons: ['ITEM_INVALID'] };
  }

  for (const key of REQUIRED_FIELDS) {
    if (!item[key]) {
      return { ok: false, trusted: false, score: 0, reasons: ['REQUIRED_FIELD_MISSING:' + key] };
    }
  }

  const url = String(item.url || '').trim();
  const parsedUrl = safeUrl(url);
  if (!parsedUrl || !/^https?:$/.test(parsedUrl.protocol)) {
    return { ok: false, trusted: false, score: 0, reasons: ['URL_INVALID'] };
  }

  const host = hostnameOf(url);
  const tld = tldOf(host);
  const text = combinedText(item);
  const trusted = isTrusted(item, host);
  let score = trusted ? 20 : 0;

  // ---- Blocklist Hard Reject ----
  if (domainMatch(host, BLOCK_LIST.domains)) {
    reasons.push('BLOCKLIST_DOMAIN');
  }

  if (tld && arr(BLOCK_LIST.tlds).map(normalize).includes(tld)) {
    reasons.push('BLOCKLIST_TLD');
  }

  if (containsAny(item.source, BLOCK_LIST.sources)) {
    reasons.push('BLOCKLIST_SOURCE');
  }

  if (patternMatch(text, BLOCK_LIST.patterns) || containsAny(text, BLOCK_LIST.keywords)) {
    reasons.push('BLOCKLIST_PATTERN');
  }

  if (reasons.length) {
    return { ok: false, trusted, score: -100, reasons };
  }

  // ---- Commerce Reality Check ----
  if (item.fake === true) return { ok: false, trusted, score: -100, reasons: ['ITEM_FAKE'] };
  if (item.scam === true) return { ok: false, trusted, score: -100, reasons: ['ITEM_SCAM'] };

  // ---- Country / Region Gate ----
  // IP country is normally a ranking/supply signal. Only hard-filter when explicitly requested.
  if (context.country && context.strictCountry === true) {
    if (item.country && normalize(item.country) !== normalize(context.country)) {
      return { ok: false, trusted, score, reasons: ['COUNTRY_MISMATCH'] };
    }
  }

  // ---- Currency Sanity ----
  if (item.currency && String(item.currency).length > 4) {
    return { ok: false, trusted, score, reasons: ['CURRENCY_INVALID'] };
  }

  // ---- Optional strict trust mode ----
  if (context.requireTrusted === true && !trusted) {
    return { ok: false, trusted, score, reasons: ['NOT_ALLOWLISTED'] };
  }

  // ---- PASS ----
  return { ok: true, trusted, score, reasons: trusted ? ['ALLOWLIST_DOMAIN'] : [] };
}

// ===== Core Filter =====
function trustFilter(item, context = {}) {
  return evaluateTrust(item, context).ok;
}

// ===== Batch Helper =====
function filterBatch(items = [], context = {}) {
  const passed = [];
  const dropped = [];

  for (const item of items) {
    if (trustFilter(item, context)) {
      passed.push(item);
    } else {
      dropped.push(item);
    }
  }

  return { passed, dropped };
}

// ===== Export =====
module.exports = {
  trustFilter,
  filterBatch,
  evaluateTrust
};
