'use strict';

/*
 * Media Hub OTT delivery resolver — stage 6 hardened.
 *
 * Direct delivery is accepted only through an enabled HTTPS allowlisted profile.
 * Broker delivery is server-to-server and must return an expiring HTTPS URL on
 * the same approved delivery profile. No raw member identifier is sent onward.
 */
const crypto = require('crypto');
const { allowedByProfile, allowedUrl, secureDeliveryUrl, text } = require('./media-catalog-policy');

const BROKER_TIMEOUT_MS = 8000;

function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function envUrl(name) {
  const raw = text(process.env[name], 4096);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch (_) { return ''; }
}

async function fetchCompat(url, init) {
  if (typeof fetch === 'function') return fetch(url, init);
  // node-fetch v2 is already a declared dependency of the current baseline.
  const fallback = require('node-fetch');
  return fallback(url, init);
}

function viewerKey(memberId) {
  return crypto.createHash('sha256').update(text(memberId, 600)).digest('hex').slice(0, 40);
}

function futureIso(value) {
  const parsed = Date.parse(text(value, 80));
  return Number.isFinite(parsed) && parsed > Date.now() + 5000 ? new Date(parsed).toISOString() : '';
}

async function resolveBroker(profile, delivery, validation, member) {
  const endpointName = text(profile && profile.brokerUrlEnv, 120);
  const tokenName = text(profile && profile.brokerTokenEnv, 120);
  const endpoint = endpointName ? envUrl(endpointName) : '';
  const token = tokenName ? text(process.env[tokenName], 4096) : '';
  if (!endpoint || !token) throw fail(409, 'delivery_broker_not_configured', 'The configured streaming delivery broker is not available.');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetchCompat(endpoint, {
      method: 'POST',
      signal: controller && controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({
        contentId: validation.contentId,
        assetKey: delivery.assetKey,
        format: delivery.format,
        viewerKey: viewerKey(member.memberId)
      })
    });
  } catch (_) {
    throw fail(502, 'delivery_broker_unavailable', 'The streaming delivery broker is unavailable.');
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const raw = await response.text().catch(() => '');
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch (_) { payload = null; }
  if (!response.ok || !payload) throw fail(502, 'delivery_broker_failed', 'The streaming delivery broker did not return a playback URL.');

  const url = secureDeliveryUrl(profile, payload.url || payload.streamUrl || payload.manifestUrl);
  const expiresAt = futureIso(payload.expiresAt || payload.expiry || payload.expires);
  if (!url || !allowedByProfile(profile, url)) throw fail(502, 'delivery_broker_url_rejected', 'The broker returned a delivery URL outside the approved profile.');
  if (!expiresAt) throw fail(502, 'delivery_broker_expiry_missing', 'The broker must return an expiring playback URL.');
  return { url, expiresAt };
}

async function resolveDelivery(validation, member) {
  const delivery = validation && validation.delivery && validation.delivery.delivery;
  const profile = delivery && delivery.profileConfig;
  if (!validation || !validation.ok || !delivery || !profile) throw fail(409, 'content_not_ready', 'Content delivery is not ready.');
  if (delivery.mode === 'broker') return resolveBroker(profile, delivery, validation, member);
  const url = secureDeliveryUrl(profile, delivery.url);
  if (!url || !allowedByProfile(profile, url)) throw fail(409, 'content_not_ready', 'Content delivery is not ready.');
  return { url, expiresAt: null };
}

module.exports = { resolveDelivery, fail };
