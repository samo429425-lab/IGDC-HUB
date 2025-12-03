// netlify_functions/assignOwner.js
// POST /.netlify/functions/assignOwner  (via /api/assignOwner)
//
// 기능:
//  - 호출한 사람이 OWNER 롤인지 확인
//  - BODY로 받은 userId 에 OWNER 롤(role_id)을 부여
//
// 필요 ENV:
//  - AUTH0_DOMAIN
//  - AUTH0_M2M_CLIENT_ID
//  - AUTH0_M2M_CLIENT_SECRET
//  - AUTH0_MGMT_AUDIENCE  (옵션)
//  - AUTH0_ROLES_CLAIM    (옵션)
//  - AUTH0_OWNER_ROLE_ID  (필수: OWNER role_id)
//
// BODY 예시:
//   { "userId": "auth0|1234567890", "roleId": "rol_ABCDEF" }
//   roleId 생략 시 AUTH0_OWNER_ROLE_ID 사용

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 1) 호출자 검사: OWNER만 허용
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!isOwner(authHeader)) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "OWNER role required" }),
      };
    }

    // 2) 요청 바디 파싱
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const userId = body.userId || body.user_id;
    let roleId = body.roleId || body.role_id || process.env.AUTH0_OWNER_ROLE_ID;

    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "userId is required" }),
      };
    }
    if (!roleId) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Missing roleId. Set AUTH0_OWNER_ROLE_ID or pass roleId in body.",
        }),
      };
    }

    // 3) M2M 토큰 발급
    const token = await getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;
    const url = `https://${domain}/api/v2/roles/${encodeURIComponent(
      roleId
    )}/users`;

    // 4) Auth0 Management API 호출 (유저에게 롤 부여)
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        users: [userId],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        statusCode: res.status,
        body: JSON.stringify({
          error: "Failed to assign role",
          detail: text,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: true,
        userId,
        roleId,
        ts: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "assignOwner error",
        detail: String(err),
      }),
    };
  }
};

// ───────────────── 헬퍼들 ─────────────────

function getRolesClaimKey() {
  const envKey = process.env.AUTH0_ROLES_CLAIM;
  if (envKey) return envKey;
  return "https://os.auth/roles";
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

function decodeJwtPayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("Invalid JWT");
  const payload = parts[1];
  const padded = padBase64(payload.replace(/-/g, "+").replace(/_/g, "/"));
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json);
}

function padBase64(str) {
  const pad = str.length % 4;
  if (pad === 2) return str + "==";
  if (pad === 3) return str + "=";
  if (pad === 1) return str + "===";
  return str;
}

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
