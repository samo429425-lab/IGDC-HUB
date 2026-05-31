/**
 * trustFilter.core.v1.js
 * --------------------------------------------------
 * Maru Platform – Core Screening Filter Engine
 * Role: Final gate for snapshot generation
 * Policy: fail-closed (deny by default)
 * --------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ===== Load Trust Lists =====
const ALLOW_LIST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/trust.allowlist.json'), 'utf-8')
);

const BLOCK_LIST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/trust.blocklist.json'), 'utf-8')
);

// ===== Core Config =====
const REQUIRED_FIELDS = [
  'title',
  'url',
  'source',
  'country',
  'currency'
];

// ===== Utility =====
function normalize(str) {
  return String(str || '').toLowerCase().trim();
}

function containsAny(target, keywords = []) {
  const t = normalize(target);
  return keywords.some(k => t.includes(normalize(k)));
}

// ===== Core Filter =====
function trustFilter(item, context = {}) {
  try {
    // ---- 1. Basic Schema Validation ----
    for (const key of REQUIRED_FIELDS) {
      if (!item[key]) return false;
    }

    // ---- 2. Blocklist Hard Reject ----
    if (
      containsAny(item.title, BLOCK_LIST.keywords) ||
      containsAny(item.source, BLOCK_LIST.sources) ||
      containsAny(item.url, BLOCK_LIST.domains)
    ) {
      return false;
    }

    // ---- 3. Allowlist / Trust Check ----
    const trustedSource =
      ALLOW_LIST.sources.includes(item.source) ||
      ALLOW_LIST.domains.some(d => item.url.includes(d));

    if (!trustedSource) return false;

    // ---- 4. Commerce Reality Check ----
    if (!item.url.startsWith('http')) return false;
    if (item.fake === true) return false;
    if (item.scam === true) return false;

    // ---- 5. Country / Region Gate ----
    if (context.country) {
      if (normalize(item.country) !== normalize(context.country)) {
        return false;
      }
    }

    // ---- 6. Currency Sanity ----
    if (item.currency.length > 4) return false;

    // ---- PASS ----
    return true;

  } catch (e) {
    // Fail-closed
    return false;
  }
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
  filterBatch
};
