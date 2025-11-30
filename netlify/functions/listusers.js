// netlify/functions/listusers.js
//
// GET /.netlify/functions/listusers
// (또는 _redirects 에서 /api/* -> /.netlify/functions/:splat 이면 /api/listusers 로 호출 가능)
//
// 기능:
//  - Auth0 Management API를 통해 최근 가입 사용자 목록을 조회
//  - admin 회원 전용 모달(member-admin-modal.js)에서 사용할 수 있도록
//    단순화된 회원 리스트를 반환합니다.
//
// 필요 ENV:
//  - AUTH0_DOMAIN              (예: example-tenant.eu.auth0.com)
//  - AUTH0_M2M_CLIENT_ID
//  - AUTH0_M2M_CLIENT_SECRET
//  - AUTH0_MGMT_AUDIENCE (옵션, 없으면 https://${DOMAIN}/api/v2/ 기본값)
//  - AUTH0_ROLES_CLAIM   (옵션, 예: https://os.auth/roles)
//
// 권한:
//  - Authorization: Bearer <JWT> 헤더에서 OWNER 롤이 있는 토큰만 허용합니다.
//    (listroles.js, assignowner.js 와 동일한 패턴)

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Method Not Allowed",
      };
    }

    // 1) 호출자 권한 검사 (OWNER 만 허용)
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!isOwner(authHeader)) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "OWNER role required" }),
      };
    }

    // 2) Management API 토큰 발급
    const token = await getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;
    if (!domain) {
      throw new Error("AUTH0_DOMAIN is not set");
    }
    const base = `https://${domain}/api/v2`;

    // 3) 사용자 목록 조회
    //    필요에 따라 per_page 값은 조정 가능 (기본 100명)
    const url = `${base}/users?per_page=100&page=0&sort=created_at:-1`;

    const usersRes = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!usersRes.ok) {
      const t = await usersRes.text();
      throw new Error("Failed to list users: " + t);
    }

    const rawUsers = await usersRes.json();
    const users = Array.isArray(rawUsers) ? rawUsers : [];

    // 4) admin 모달이 기대하는 형태로 단순화
    const simplified = users.map((u) => {
      const id = u.user_id || u.sub || u.id || "";
      const email = u.email || "";
      const name = u.name || u.nickname || "";
      const status = u.blocked ? "blocked" : "active";

      // roles 는 기본 비워두고, 필요 시 /api/v2/users/{id}/roles 로
      // 별도 로직 추가 가능
      const roles = [];

      return {
        user_id: id,
        email,
        name,
        status,
        roles,
        created_at: u.created_at,
      };
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ users: simplified }),
    };
  } catch (err) {
    console.error("listusers error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "listusers error", detail: String(err) }),
    };
  }
};

// ───────────────── 헬퍼들 ─────────────────

function getRolesClaimKey() {
  const envKey = process.env.AUTH0_ROLES_CLAIM;
  if (envKey) return envKey;
  // 기본값: OS0 / Auth0 커스텀 클레임 키 후보들
  return "https://os.auth/roles";
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Invalid JWT");
  const payload = parts[1];
  const padded = payload.padEnd(payload.length + (4 - (payload.length % 4)) % 4, "=");
  const json = Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
  return JSON.parse(json);
}

function isOwner(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const payload = decodeJwtPayload(token);
    const claimKey = getRolesClaimKey();
    const roles =
      payload[claimKey] ||
      payload["https://os0.app/roles"] ||
      payload["roles"] ||
      [];
    if (!Array.isArray(roles)) return false;
    return roles.includes("OWNER") || roles.includes("Owner");
  } catch (e) {
    return false;
  }
}

async function getManagementToken() {
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_M2M_CLIENT_ID;
  const clientSecret = process.env.AUTH0_M2M_CLIENT_SECRET;
  const audienceEnv = process.env.AUTH0_MGMT_AUDIENCE;

  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      "Missing AUTH0_DOMAIN / AUTH0_M2M_CLIENT_ID / AUTH0_M2M_CLIENT_SECRET"
    );
  }

  const audience = audienceEnv || `https://${domain}/api/v2/`;

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
