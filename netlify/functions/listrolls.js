// netlify_functions/listRoles.js
const { resolveUser } = require("./lib/global-slot-console-auth");
// GET /.netlify/functions/listRoles  (via /api/listRoles if _redirects maps /api/* -> /.netlify/functions/:splat)
//
// 기능:
//  - Auth0 Management API를 통해 롤 목록을 조회
//  - OWNER 롤 id 확인용
//
// 필요 ENV:
//  - AUTH0_DOMAIN              (예: your-tenant.eu.auth0.com)
//  - AUTH0_M2M_CLIENT_ID
//  - AUTH0_M2M_CLIENT_SECRET
//  - AUTH0_MGMT_AUDIENCE (옵션, 없으면 https://${DOMAIN}/api/v2/ 기본값)
//  - AUTH0_ROLES_CLAIM   (옵션, 예: https://os.auth/roles)

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 1) 호출자 롤 검사: 기존 OWNER 권한은 그대로 두고, Auth0 서명된 세션만 인정
    let actor;
    try {
      actor = await resolveUser(event);
    } catch (authErr) {
      return {
        statusCode: authErr.statusCode || 401,
        body: JSON.stringify({ error: authErr.code || "member_token_invalid" }),
      };
    }
    if (!Array.isArray(actor.roles) || !actor.roles.includes("owner")) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "OWNER role required" }),
      };
    }

    // 2) M2M 토큰 발급
    const token = await getManagementToken();

    // 3) 롤 목록 조회
    const domain = process.env.AUTH0_DOMAIN;
    const url = `https://${domain}/api/v2/roles?per_page=50`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        statusCode: res.status,
        body: JSON.stringify({
          error: "Failed to fetch roles",
          detail: text,
        }),
      };
    }

    const roles = await res.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        roles,
        ts: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "listRoles error", detail: String(err) }),
    };
  }
};

// ───────────────── 헬퍼들 ─────────────────

async function getManagementToken() {
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_M2M_CLIENT_ID;
  const clientSecret = process.env.AUTH0_M2M_CLIENT_SECRET;
  const audience =
    process.env.AUTH0_MGMT_AUDIENCE || `https://${domain}/api/v2/`;

  if (!domain || !clientId || !clientSecret) {
    throw new Error("Missing AUTH0_* env for Management token");
  }

  const url = `https://${domain}/oauth/token`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Failed to get management token: " + text);
  }

  const data = await res.json();
  return data.access_token;
}
