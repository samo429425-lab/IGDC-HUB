'use strict';

/*
 * Global Slot Console authorization adapter.
 * Reuses the existing member-admin server verifier so browser role labels are
 * never trusted. The member-admin function verifies Auth0/JWKS and resolves
 * server-side roles before this console grants any access.
 */

const memberAdmin = require('../member-admin');

const LEVEL = {
  guest: 0,
  member: 1,
  commerce_manager: 5,
  site_manager: 12,
  coordinator_director: 13,
  site_manager_director: 14,
  director: 15,
  admin: 20,
  super_admin: 25,
  owner: 30
};

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s.]+/g, '_');
}

function roleLevel(role) {
  const normalized = normalizeRole(role);
  if (Object.prototype.hasOwnProperty.call(LEVEL, normalized)) return LEVEL[normalized];
  if (normalized.indexOf('site_manager_') === 0) return 12;
  return 0;
}

function topRole(roles) {
  const values = [...new Set((roles || []).map(normalizeRole).filter(Boolean))];
  return values.sort((a, b) => roleLevel(b) - roleLevel(a))[0] || 'guest';
}

function jsonFromMemberAdmin(result) {
  let body = {};
  try { body = JSON.parse(result && result.body || '{}'); } catch (_) {}
  return { result, body };
}

async function resolveUser(event) {
  const proxyEvent = {
    httpMethod: 'GET',
    headers: event && event.headers || {},
    queryStringParameters: { action: 'me' },
    body: null
  };
  const { result, body } = jsonFromMemberAdmin(await memberAdmin.handler(proxyEvent));
  if (!result || Number(result.statusCode) !== 200 || !body.ok || !body.me) {
    const error = new Error(body.error || '관리자 로그인이 필요합니다.');
    error.statusCode = Number(result && result.statusCode) || 401;
    throw error;
  }
  const roles = Array.isArray(body.me.roles) ? body.me.roles : [];
  const role = topRole(roles);
  return {
    sub: String(body.me.user_id || ''),
    email: String(body.me.email || ''),
    name: String(body.me.name || body.me.email || ''),
    roles,
    role,
    level: roleLevel(role)
  };
}

function capability(user) {
  const level = Number(user && user.level) || 0;
  return {
    read: level >= 20,
    edit: level >= 20,
    approve: level >= 20,
    policy: level >= 25,
    owner: level >= 30,
    role: user && user.role || 'guest'
  };
}

function requireCapability(user, name) {
  const caps = capability(user);
  if (!caps[name]) {
    const error = new Error(name === 'read' ? '관리자 권한이 필요합니다.' : '현재 권한으로는 이 관리 작업을 수행할 수 없습니다.');
    error.statusCode = 403;
    throw error;
  }
  return caps;
}

module.exports = { resolveUser, capability, requireCapability };
