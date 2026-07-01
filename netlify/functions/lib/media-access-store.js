'use strict';

/*
 * Durable entitlement/order storage for Media Hub OTT stages 7–10.
 *
 * Storage is deliberately opt-in. A missing environment configuration never
 * grants paid access and never falls back to client-side entitlement storage.
 */
const crypto = require('crypto');
const { clean, enabled, safeId } = require('./media-access-policy');

const MAX_ROWS = 100;
const ENTITLEMENT_STATES = new Set(['active', 'expired', 'revoked', 'refunded', 'cancelled', 'pending']);
const ORDER_STATES = new Set(['payment_not_started', 'payment_pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired']);

function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function tableName(value) {
  const name = clean(value);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : '';
}
function storageConfig() {
  if (!enabled(process.env.MEDIA_ACCESS_STORAGE_ENABLED)) return null;
  const url = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
  const entitlementsTable = tableName(process.env.MEDIA_ACCESS_ENTITLEMENTS_TABLE);
  const ordersTable = tableName(process.env.MEDIA_ACCESS_ORDERS_TABLE);
  const eventsTable = tableName(process.env.MEDIA_ACCESS_EVENTS_TABLE);
  if (!url || !key || !entitlementsTable || !ordersTable || !eventsTable) return null;
  return { url, key, entitlementsTable, ordersTable, eventsTable };
}
async function fetchCompat(url, init) {
  if (typeof fetch === 'function') return fetch(url, init);
  return require('node-fetch')(url, init);
}
function memberHash(memberId) {
  return crypto.createHash('sha256').update(clean(memberId)).digest('hex').slice(0, 48);
}
function stableId(parts) {
  return crypto.createHash('sha256').update(parts.map((entry) => clean(entry)).join('|')).digest('hex').slice(0, 56);
}
function randomId(prefix) {
  const unique = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(20).toString('hex');
  return String(prefix || 'ma') + '_' + unique.replace(/-/g, '');
}
function iso(value) {
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
}
function bool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }

async function supabaseRequest(config, target, init) {
  let response;
  try {
    response = await fetchCompat(config.url + '/rest/v1/' + target, {
      method: init && init.method || 'GET',
      headers: Object.assign({
        'Content-Type': 'application/json',
        apikey: config.key,
        Authorization: 'Bearer ' + config.key
      }, init && init.headers || {}),
      body: init && init.body
    });
  } catch (_) {
    throw fail(502, 'media_access_storage_unavailable', 'Media access storage is unavailable.');
  }
  const raw = await response.text().catch(() => '');
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch (_) { payload = null; }
  if (!response.ok) throw fail(502, 'media_access_storage_failed', 'Media access storage is unavailable.');
  return payload;
}

function rowToEntitlement(row) {
  if (!row || typeof row !== 'object') return null;
  const id = safeId(row.id || row.entitlement_id, 160);
  const productId = safeId(row.product_id || row.productId, 120);
  const scopeType = clean(row.scope_type || row.scopeType).toLowerCase();
  const scopeId = clean(row.scope_id || row.scopeId);
  const status = clean(row.status).toLowerCase();
  if (!id || !productId || !['content', 'series', 'catalog'].includes(scopeType) || !scopeId || !ENTITLEMENT_STATES.has(status)) return null;
  return {
    id,
    productId,
    scopeType,
    scopeId,
    status,
    validFrom: iso(row.valid_from || row.validFrom) || null,
    validUntil: iso(row.valid_until || row.validUntil) || null,
    source: clean(row.source).slice(0, 80) || null,
    orderId: safeId(row.order_id || row.orderId, 180) || null,
    updatedAt: iso(row.updated_at || row.updatedAt) || null
  };
}
function rowToOrder(row) {
  if (!row || typeof row !== 'object') return null;
  const id = safeId(row.id || row.order_id, 180);
  const productId = safeId(row.product_id || row.productId, 120);
  const currency = clean(row.currency).toUpperCase();
  const amountMinor = Number(row.amount_minor != null ? row.amount_minor : row.amountMinor);
  const status = clean(row.status).toLowerCase();
  if (!id || !productId || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !ORDER_STATES.has(status)) return null;
  return {
    id,
    productId,
    currency,
    amountMinor,
    status,
    provider: clean(row.provider).slice(0, 80) || null,
    idempotencyKey: safeId(row.idempotency_key || row.idempotencyKey, 180) || null,
    expiresAt: iso(row.expires_at || row.expiresAt) || null,
    createdAt: iso(row.created_at || row.createdAt) || null,
    updatedAt: iso(row.updated_at || row.updatedAt) || null
  };
}
function entitlementActive(entitlement, at) {
  if (!entitlement || entitlement.status !== 'active') return false;
  const now = Number(at) || Date.now();
  if (entitlement.validFrom && Date.parse(entitlement.validFrom) > now) return false;
  if (entitlement.validUntil && Date.parse(entitlement.validUntil) <= now) return false;
  return true;
}

async function listEntitlements(config, member, limit) {
  if (!config) return [];
  const cap = Math.max(1, Math.min(Number(limit) || MAX_ROWS, MAX_ROWS));
  const scope = memberHash(member.memberId);
  const target = encodeURIComponent(config.entitlementsTable) + '?select=id,product_id,scope_type,scope_id,status,valid_from,valid_until,source,order_id,updated_at&member_hash=eq.' + encodeURIComponent(scope) + '&order=updated_at.desc&limit=' + cap;
  const rows = await supabaseRequest(config, target, { method: 'GET' });
  return (Array.isArray(rows) ? rows : []).map(rowToEntitlement).filter(Boolean);
}
async function listOrders(config, member, limit) {
  if (!config) return [];
  const cap = Math.max(1, Math.min(Number(limit) || MAX_ROWS, MAX_ROWS));
  const scope = memberHash(member.memberId);
  const target = encodeURIComponent(config.ordersTable) + '?select=id,product_id,currency,amount_minor,status,provider,idempotency_key,expires_at,created_at,updated_at&member_hash=eq.' + encodeURIComponent(scope) + '&order=updated_at.desc&limit=' + cap;
  const rows = await supabaseRequest(config, target, { method: 'GET' });
  return (Array.isArray(rows) ? rows : []).map(rowToOrder).filter(Boolean);
}
async function findOrderByIdempotency(config, member, idempotencyKey) {
  const scope = memberHash(member.memberId);
  const key = safeId(idempotencyKey, 180);
  if (!config || !key) return null;
  const target = encodeURIComponent(config.ordersTable) + '?select=id,product_id,currency,amount_minor,status,provider,idempotency_key,expires_at,created_at,updated_at&member_hash=eq.' + encodeURIComponent(scope) + '&idempotency_key=eq.' + encodeURIComponent(key) + '&limit=1';
  const rows = await supabaseRequest(config, target, { method: 'GET' });
  return Array.isArray(rows) && rows.length ? rowToOrder(rows[0]) : null;
}
async function createPendingOrder(config, member, input) {
  if (!config) throw fail(503, 'media_access_storage_not_configured', 'Media access storage is not configured.');
  const productId = safeId(input && input.productId, 120);
  const idempotencyKey = safeId(input && input.idempotencyKey, 180);
  const currency = clean(input && input.currency).toUpperCase();
  const amountMinor = Number(input && input.amountMinor);
  if (!productId || !idempotencyKey || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw fail(400, 'invalid_order_request', 'The access order request is invalid.');
  }
  const existing = await findOrderByIdempotency(config, member, idempotencyKey);
  if (existing) return { order: existing, created: false };
  const now = new Date();
  const expiry = new Date(now.getTime() + (Math.max(5, Math.min(Number(input.ttlMinutes) || 30, 120)) * 60 * 1000)).toISOString();
  const record = {
    id: randomId('ma_order'),
    member_hash: memberHash(member.memberId),
    product_id: productId,
    currency,
    amount_minor: amountMinor,
    status: 'payment_not_started',
    provider: 'pg_pending_approval',
    idempotency_key: idempotencyKey,
    access_scope_type: clean(input.scopeType).toLowerCase(),
    access_scope_id: clean(input.scopeId),
    terms_version: clean(input.termsVersion).slice(0, 80) || null,
    expires_at: expiry,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  const target = encodeURIComponent(config.ordersTable);
  const rows = await supabaseRequest(config, target, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([record])
  });
  return { order: Array.isArray(rows) && rows.length ? rowToOrder(rows[0]) : rowToOrder(record), created: true };
}
async function writeEntitlement(config, memberHashValue, input) {
  if (!config) throw fail(503, 'media_access_storage_not_configured', 'Media access storage is not configured.');
  const memberScope = clean(memberHashValue);
  if (!/^[a-f0-9]{32,64}$/i.test(memberScope)) throw fail(400, 'invalid_member_scope', 'The member scope is invalid.');
  const productId = safeId(input && input.productId, 120);
  const scopeType = clean(input && input.scopeType).toLowerCase();
  const scopeId = clean(input && input.scopeId);
  const status = clean(input && input.status || 'active').toLowerCase();
  if (!productId || !['content', 'series', 'catalog'].includes(scopeType) || !scopeId || !ENTITLEMENT_STATES.has(status)) {
    throw fail(400, 'invalid_entitlement', 'The entitlement request is invalid.');
  }
  const now = new Date().toISOString();
  const record = {
    id: stableId([memberScope, productId, scopeType, scopeId, input && input.orderId || 'manual']),
    member_hash: memberScope,
    product_id: productId,
    scope_type: scopeType,
    scope_id: scopeId,
    status,
    valid_from: iso(input && input.validFrom) || now,
    valid_until: iso(input && input.validUntil) || null,
    source: clean(input && input.source || 'operator').slice(0, 80),
    order_id: safeId(input && input.orderId, 180) || null,
    updated_at: now
  };
  const target = encodeURIComponent(config.entitlementsTable) + '?on_conflict=id';
  const rows = await supabaseRequest(config, target, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([record])
  });
  return Array.isArray(rows) && rows.length ? rowToEntitlement(rows[0]) : rowToEntitlement(record);
}
async function updateOrderStatus(config, orderId, status, providerReference) {
  if (!config) throw fail(503, 'media_access_storage_not_configured', 'Media access storage is not configured.');
  const id = safeId(orderId, 180);
  const next = clean(status).toLowerCase();
  if (!id || !ORDER_STATES.has(next)) throw fail(400, 'invalid_order_update', 'The order update is invalid.');
  const target = encodeURIComponent(config.ordersTable) + '?id=eq.' + encodeURIComponent(id);
  const record = { status: next, provider_reference: clean(providerReference).slice(0, 240) || null, updated_at: new Date().toISOString() };
  const rows = await supabaseRequest(config, target, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(record)
  });
  return Array.isArray(rows) && rows.length ? rowToOrder(rows[0]) : null;
}
async function appendEvent(config, input) {
  if (!config) return null;
  const eventType = safeId(input && input.type, 100);
  if (!eventType) return null;
  const record = {
    id: randomId('ma_evt'),
    member_hash: clean(input && input.memberHash).match(/^[a-f0-9]{32,64}$/i) ? clean(input.memberHash) : null,
    order_id: safeId(input && input.orderId, 180) || null,
    entitlement_id: safeId(input && input.entitlementId, 180) || null,
    event_type: eventType,
    source: clean(input && input.source || 'system').slice(0, 80),
    detail_code: clean(input && input.detailCode).slice(0, 120) || null,
    created_at: new Date().toISOString()
  };
  try {
    const target = encodeURIComponent(config.eventsTable);
    await supabaseRequest(config, target, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([record]) });
  } catch (_) {
    // Event observability must never change a payment/entitlement decision.
  }
  return record.id;
}

module.exports = {
  appendEvent,
  createPendingOrder,
  entitlementActive,
  fail,
  listEntitlements,
  listOrders,
  memberHash,
  randomId,
  storageConfig,
  updateOrderStatus,
  writeEntitlement
};
