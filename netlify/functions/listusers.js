// /.netlify/functions/listusers.js
// IGDC Admin: Auth0 사용자 목록 + 역할 조회 (M2M 권한 기반)
// 파일 전체 통짜 교체용 최종 버전

import fetch from "node-fetch";

// only OWNER 계정만 조회 허용
function isOwner(event) {
  try {
    const claims = event.clientContext && event.clientContext.user;
    if (!claims) return false;
    return Array.isArray(claims.app_metadata?.roles) &&
           claims.app_metadata.roles.includes("owner");
  } catch (e) {
    return false;
  }
}

export async function handler(event, context) {
  try {
    // 1) OWNER 검사
    if (!isOwner(event)) {
      return {
        statusCode: 403,
        body: "Forbidden: OWNER 권한 필요"
      };
    }

    // 2) Auth0 관리 토큰(M2M) 발급
    const DOMAIN = process.env.AUTH0_DOMAIN;
    const CLIENT_ID = process.env.AUTH0_M2M_CLIENT_ID;
    const CLIENT_SECRET = process.env.AUTH0_M2M_CLIENT_SECRET;
    const AUDIENCE = `https://${DOMAIN}/api/v2/`;

    const tokenRes = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        audience: AUDIENCE,
        grant_type: "client_credentials"
      }),
    });

    if (!tokenRes.ok) {
      return {
        statusCode: 500,
        body: "Auth0 M2M Token Error: " + (await tokenRes.text())
      };
    }

    const { access_token } = await tokenRes.json();

    // 3) 사용자 목록 조회
    const usersRes = await fetch(`https://${DOMAIN}/api/v2/users`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (!usersRes.ok) {
      return {
        statusCode: usersRes.status,
        body: "User list fetch error: " + (await usersRes.text())
      };
    }

    const raw = await usersRes.json();

    // 4) 필요한 필드만 뽑기 (Admin UI 요구 형식)
    const trimmed = raw.map(u => ({
      user_id: u.user_id || "",
      name: u.name || "",
      email: u.email || "",
      blocked: !!u.blocked,
      roles: []   // 아래에서 채움
    }));

    // 5) 각 사용자 역할 조회
    for (let u of trimmed) {
      const rolesRes = await fetch(
        `https://${DOMAIN}/api/v2/users/${encodeURIComponent(u.user_id)}/roles`,
        {
          headers: { Authorization: `Bearer ${access_token}` }
        }
      );

      if (rolesRes.ok) {
        const roleData = await rolesRes.json();
        u.roles = roleData.map(r => r.name);
      } else {
        u.roles = [];
      }
    }

    // 6) 최종 반환
    return {
      statusCode: 200,
      body: JSON.stringify({ users: trimmed })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: "Internal Error: " + err.message
    };
  }
}
