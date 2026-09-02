'use strict';

/**
 * Donation country-access policy mirror.
 *
 * Purpose:
 * - Edge Function: detect the request IP country.
 * - This normal Netlify Function: evaluate that country against the same
 *   MARU_DONATION_BLOCK_COUNTRIES source used by SearchBank.
 * - Keep a small deployment safety floor for countries that must never fail open
 *   if Edge environment propagation is unavailable.
 */

const fs = require('fs');
const path = require('path');

const SAFETY_FLOOR = new Set(['CN', 'IR', 'SY', 'CU', 'KP']);

function text(value){
  return value == null ? '' : String(value).trim();
}

function countryCode(value){
  const code = text(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function parseCountryList(value){
  if (Array.isArray(value)) return value.map(countryCode).filter(Boolean);
  return text(value).split(/[|,\s]+/).map(countryCode).filter(Boolean);
}

function parseChannels(value){
  if (Array.isArray(value)) return value.map((v)=>text(v).toLowerCase()).filter(Boolean);
  return text(value).split(/[|,\s]+/).map((v)=>v.toLowerCase()).filter(Boolean);
}

function readCountryPolicy(){
  const candidates = [
    path.join(__dirname, 'data', 'country-policy.json'),
    path.join(process.cwd(), 'netlify', 'functions', 'data', 'country-policy.json')
  ];
  for (const file of candidates){
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
  }
  return {};
}

function countryPolicyEntry(table, country){
  if (!table || !country) return null;
  const markets = table.markets && typeof table.markets === 'object' ? table.markets : table;
  return markets[country] || markets[country.toLowerCase()] || markets[country.toUpperCase()] || null;
}

function evaluate(country){
  const configured = new Set(parseCountryList(process.env.MARU_DONATION_BLOCK_COUNTRIES || ''));
  const policy = readCountryPolicy();
  const entry = countryPolicyEntry(policy, country);

  let restricted = configured.has(country) || SAFETY_FLOOR.has(country);
  let policyRestricted = false;

  if (entry && typeof entry === 'object') {
    const channels = parseChannels(entry.blockChannels || entry.blockedChannels || '');
    policyRestricted = entry.donation === false || entry.noDonation === true || channels.includes('donation');
    if (policyRestricted) restricted = true;
  }

  return {
    restricted,
    configured: configured.has(country),
    safetyFloor: SAFETY_FLOOR.has(country),
    countryPolicy: policyRestricted
  };
}

exports.handler = async function(event){
  const country = countryCode(event && event.queryStringParameters && event.queryStringParameters.country);
  if (!country) {
    return {
      statusCode: 400,
      headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'private, no-store, max-age=0' },
      body: JSON.stringify({ ok:false, error:'country_required' })
    };
  }

  const result = evaluate(country);
  return {
    statusCode: 200,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'private, no-store, max-age=0',
      'x-content-type-options':'nosniff'
    },
    body: JSON.stringify({
      ok:true,
      country,
      restricted:result.restricted,
      source:'donation-country-policy-v1'
    })
  };
};

exports._test = { countryCode, parseCountryList, evaluate };
