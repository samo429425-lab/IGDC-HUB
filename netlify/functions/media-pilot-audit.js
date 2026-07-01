'use strict';

/*
 * Administrative rights-and-delivery audit for the OTT pilot catalog.
 * The endpoint reports readiness only to the existing owner/admin role set and
 * deliberately redacts full evidence and stream URLs from its response.
 */
const {
  isSeriesItem,
  listItems,
  readCatalog,
  readDeliveryProfiles,
  safeAuditItem,
  safeAuditSeries,
  text,
  validatePilotItem,
  validatePilotSeries
} = require('./lib/media-catalog-policy');
const { authenticateMember } = require('./lib/media-member-auth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body || {})
  };
}

function adminMember(member) {
  const roles = Array.isArray(member && member.roles) ? member.roles.map((value) => text(value, 80).toLowerCase()) : [];
  return roles.some((role) => ['owner', 'admin', 'administrator', 'site_admin', 'super_admin'].includes(role));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const member = await authenticateMember(event);
    if (!adminMember(member)) return json(403, { ok: false, error: 'admin_role_required' });

    const catalog = readCatalog();
    const profiles = readDeliveryProfiles();
    const items = listItems(catalog).map((item) => isSeriesItem(item)
      ? safeAuditSeries(validatePilotSeries(item, profiles), profiles)
      : safeAuditItem(validatePilotItem(item, profiles)));
    const ready = items.filter((item) => item.ready).length;
    return json(200, {
      ok: true,
      version: 'media.pilot.audit.v1',
      catalogVersion: text(catalog.version, 80),
      catalogUpdatedAt: text(catalog.updatedAt, 80) || null,
      deliveryProfileVersion: text(profiles.version, 80),
      summary: { total: items.length, ready, blocked: items.length - ready },
      profiles: Object.keys(profiles.profiles || {}).sort().map((id) => {
        const profile = profiles.profiles[id] || {};
        return {
          id,
          enabled: profile.enabled === true,
          mode: text(profile.mode, 40),
          formats: Array.isArray(profile.formats) ? profile.formats.map((value) => text(value, 24)) : [],
          allowedHostCount: Array.isArray(profile.allowedHosts) ? profile.allowedHosts.length : 0
        };
      }),
      items
    });
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: error.code || 'media_pilot_audit_failed',
      message: text(error.message || 'Unable to audit the media pilot catalog.', 360)
    });
  }
};
