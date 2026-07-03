'use strict';

/*
 * Owner-only, read-only diagnostic for the isolated Global Slot management DB.
 * It never returns a database key, token, or table-row data.
 */
const { resolveUser, capability } = require('./lib/global-slot-console-auth');
const sb = require('./lib/global-slot-console-supabase');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': process.env.URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
    },
    body: statusCode === 204 ? '' : JSON.stringify(body)
  };
}

function decodeJwtPayload(value) {
  try {
    const parts = String(value || '').split('.');
    if (parts.length !== 3) return null;
    let body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (body.length % 4) body += '=';
    return JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function describeKey(value) {
  const key = String(value || '').trim();
  if (!key) return { configured: false, kind: 'missing', role: null };
  if (key.indexOf('sb_secret_') === 0) return { configured: true, kind: 'secret', role: 'secret' };
  if (key.indexOf('sb_publishable_') === 0) return { configured: true, kind: 'publishable', role: 'anon' };
  const payload = decodeJwtPayload(key);
  if (payload) return { configured: true, kind: 'legacy_jwt', role: String(payload.role || 'unknown') };
  return { configured: true, kind: 'unknown', role: null };
}

function dbHost(url) {
  try { return new URL(String(url || '')).host || 'invalid-url'; } catch (_) { return 'invalid-url'; }
}

function classify(error, key) {
  const message = String(error && error.message || '관리 DB 요청 실패');
  const statusCode = Number(error && error.statusCode) || 502;
  const lowered = message.toLowerCase();
  if (lowered.indexOf('permission denied for table') >= 0 || lowered.indexOf('42501') >= 0) {
    if (key.kind === 'publishable' || key.role === 'anon' || key.role === 'authenticated') {
      return {
        code: 'public_key_used',
        summary: 'Netlify 서버가 공개용 anon/publishable 키로 관리 DB에 접속하고 있습니다. GSLOT_SUPABASE_SECRET_KEY에는 같은 관리 DB 프로젝트의 secret 또는 legacy service_role 키가 필요합니다.'
      };
    }
    if (key.kind === 'secret' || key.role === 'service_role') {
      return {
        code: 'service_role_table_grant_missing',
        summary: '서버 키 형식은 secret/service_role이지만 gslot_hubs 테이블 권한이 거부되었습니다. 해당 Supabase 프로젝트에서 service_role의 테이블 권한 또는 DB 역할 설정을 확인해야 합니다.'
      };
    }
    return {
      code: 'table_permission_denied',
      summary: 'gslot_hubs 테이블은 존재하지만 현재 Netlify 서버 자격으로 읽을 수 없습니다. URL·키 프로젝트 조합 또는 서비스 역할 테이블 권한을 확인해야 합니다.'
    };
  }
  if (statusCode === 401 || lowered.indexOf('invalid api key') >= 0 || lowered.indexOf('jwt') >= 0) {
    return { code: 'key_invalid', summary: 'GSLOT_SUPABASE_SECRET_KEY가 현재 GSLOT_SUPABASE_URL의 프로젝트 키가 아니거나 만료·폐기된 키입니다.' };
  }
  if (statusCode === 404 || lowered.indexOf('does not exist') >= 0 || lowered.indexOf('schema cache') >= 0) {
    return { code: 'table_missing', summary: '연결된 관리 DB에 gslot_hubs 테이블이 없거나 PostgREST 스키마 캐시에서 아직 보이지 않습니다. 관리 DB 스키마 적용 상태를 확인해야 합니다.' };
  }
  return { code: 'connection_failed', summary: '관리 DB 연결 또는 권한 확인에 실패했습니다. 아래 안전 진단의 HTTP 상태와 메시지를 기준으로 원인을 확인합니다.' };
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return json(204, {});
    if (String(event.httpMethod || 'GET').toUpperCase() !== 'GET') return json(405, { ok: false, error: 'GET 요청만 허용됩니다.' });

    const actor = await resolveUser(event);
    const caps = capability(actor);
    if (!caps.owner) return json(403, { ok: false, error: '관리 DB 진단은 owner 권한에서만 실행됩니다.' });

    let cfg;
    try {
      cfg = sb.config();
    } catch (error) {
      return json(200, {
        ok: true,
        probe: { ok: false, table: 'gslot_hubs', statusCode: Number(error.statusCode) || 503, message: String(error.message || '') },
        database: { urlConfigured: false, host: null, key: { configured: false, kind: 'missing', role: null } },
        diagnosis: { code: 'config_missing', summary: 'Netlify의 GSLOT_SUPABASE_URL 또는 GSLOT_SUPABASE_SECRET_KEY가 Production 환경에 설정되지 않았습니다.' }
      });
    }

    const key = describeKey(cfg.serviceKey);
    try {
      const rows = await sb.select('gslot_hubs', 'select=hub_key&limit=1');
      return json(200, {
        ok: true,
        probe: { ok: true, table: 'gslot_hubs', rowCountAtMostOne: Array.isArray(rows) ? rows.length : 0 },
        database: { urlConfigured: true, host: dbHost(cfg.url), key },
        diagnosis: { code: 'ok', summary: '관리 DB 연결과 gslot_hubs 읽기 권한이 정상입니다.' }
      });
    } catch (error) {
      return json(200, {
        ok: true,
        probe: { ok: false, table: 'gslot_hubs', statusCode: Number(error && error.statusCode) || 502, message: String(error && error.message || '관리 DB 요청 실패') },
        database: { urlConfigured: true, host: dbHost(cfg.url), key },
        diagnosis: classify(error, key)
      });
    }
  } catch (error) {
    return json(Number(error && error.statusCode) || 500, { ok: false, error: String(error && error.message || '진단 실행 오류') });
  }
};
