"use strict";

/**
 * Public Snapshot Sanitizer v1
 *
 * Thin publication-boundary guard. It removes payout destination details from
 * browser-downloadable Snapshot JSON while preserving routing, monetization,
 * ledger references, automatic-remittance flags and all server-side sources.
 *
 * This module does not read or modify payment configuration, payout vaults,
 * settlement ledgers or provider callbacks.
 */

const VERSION = "public-snapshot-sanitizer-v1.0.0";

const DROP_KEYS = new Set([
  "accountno",
  "accountnumber",
  "domesticaccount",
  "foreignaccount",
  "bankaccount",
  "bankaccounts",
  "banking",
  "swift",
  "swiftcode",
  "iban",
  "bic",
  "routingnumber",
  "sortcode",
  "businessno",
  "bizno",
  "businessregistrationno",
  "taxid"
]);

function normalizedKey(key) {
  return String(key == null ? "" : key).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function privateDescriptor(source) {
  const safe = { status: "private", source: "server_only" };
  if (isObject(source)) {
    if (source.currency != null) safe.currency = source.currency;
    if (Array.isArray(source.currencies)) safe.currencies = source.currencies.slice();
    if (source.bankCountry != null) safe.bankCountry = source.bankCountry;
    if (source.bank_country != null) safe.bankCountry = source.bank_country;
  }
  return safe;
}

function sanitizeRevenueDestination(value) {
  if (!isObject(value)) return sanitizeAny(value, "");
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const nk = normalizedKey(key);
    if (nk === "bank" || nk === "banking" || nk === "bankaccount" || nk === "bankaccounts") {
      out[key] = privateDescriptor(child);
      continue;
    }
    if (nk === "wallet" || nk === "payoutwallet" || nk === "settlementwallet") {
      out[key] = privateDescriptor(child);
      continue;
    }
    if (DROP_KEYS.has(nk)) continue;
    const cleaned = sanitizeAny(child, key);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  out.destinationDetails = "server_only";
  return out;
}

function sanitizePlatformProfile(value) {
  if (!isObject(value)) return sanitizeAny(value, "");
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const nk = normalizedKey(key);
    if (nk === "banking" || nk === "bank" || DROP_KEYS.has(nk)) continue;
    if (nk === "settlement" && isObject(child)) {
      const settlement = sanitizeAny(child, key);
      if (isObject(settlement)) {
        delete settlement.primary_wallet;
        delete settlement.primaryWallet;
        settlement.destinationDetails = "server_only";
      }
      out[key] = settlement;
      continue;
    }
    const cleaned = sanitizeAny(child, key);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  out.publicProfile = true;
  return out;
}

function sanitizePayoutProfile(value) {
  if (!isObject(value)) return sanitizeAny(value, "");
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const nk = normalizedKey(key);
    if (nk === "bank" || nk === "banking" || nk === "bankaccount" || nk === "bankaccounts" ||
        nk === "wallet" || nk === "payoutwallet" || DROP_KEYS.has(nk)) {
      continue;
    }
    const cleaned = sanitizeAny(child, key);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  out.destinationDetails = "server_only";
  return out;
}

function sanitizeAny(value, key) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeAny(entry, "")).filter((entry) => entry !== undefined);
  if (!isObject(value)) return value;

  const nk = normalizedKey(key);
  if (nk === "revenuedestination") return sanitizeRevenueDestination(value);
  if (nk === "platformprofile") return sanitizePlatformProfile(value);
  if (nk === "payoutprofile") return sanitizePayoutProfile(value);

  const out = {};
  for (const [childKey, child] of Object.entries(value)) {
    const childNk = normalizedKey(childKey);
    if (DROP_KEYS.has(childNk)) continue;
    if (childNk === "revenuedestination") {
      out[childKey] = sanitizeRevenueDestination(child);
      continue;
    }
    if (childNk === "platformprofile") {
      out[childKey] = sanitizePlatformProfile(child);
      continue;
    }
    if (childNk === "payoutprofile") {
      out[childKey] = sanitizePayoutProfile(child);
      continue;
    }
    const cleaned = sanitizeAny(child, childKey);
    if (cleaned !== undefined) out[childKey] = cleaned;
  }
  return out;
}

function sanitizeDocument(document) {
  return sanitizeAny(document, "");
}

module.exports = {
  VERSION,
  sanitizeDocument,
  sanitizeRevenueDestination,
  sanitizePlatformProfile,
  sanitizePayoutProfile
};
