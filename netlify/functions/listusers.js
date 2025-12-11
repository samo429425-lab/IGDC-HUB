// /.netlify/functions/listUsers.js
import fetch from "node-fetch";

export async function handler(event, context) {
  try {
    const DOMAIN = process.env.AUTH0_DOMAIN;
    const CLIENT_ID = process.env.AUTH0_M2M_CLIENT_ID;
    const CLIENT_SECRET = process.env.AUTH0_M2M_CLIENT_SECRET;
    const AUDIENCE = `https://${DOMAIN}/api/v2/`;

    // 1) M2M 토큰 발급
    const tokenRes = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        audience: AUDIENCE,
        grant_type: "client_credentials"
      })
    });

    if (!tokenRes.ok) {
      const e = await tokenRes.text();
      return { statusCode: 500, body: `Auth0 token error: ${e}` };
    }

    const { access_token } = await tokenRes.json();

    // 2) 사용자 목록 가져오기
    const usersRes = await fetch(`https://${DOMAIN}/api/v2/users`, {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    if (!usersRes.ok) {
      const e = await usersRes.text();
      return { statusCode: usersRes.status, body: `Users fetch error: ${e}` };
    }

    const rawUsers = await usersRes.json();

    // 3) 필요한 필드만 추출
    const trimmed = rawUsers.map(u => ({
      user_id: u.user_id || "",
      name: u.name || "",
      email: u.email || "",
      roles: [],       // 실제 역할은 아래에서 또 불러옴
      blocked: !!u.blocked
    }));

    // 4) 각 사용자 역할 가져오기
    for (let user of trimmed) {
      const rolesRes = await fetch(
        `https://${DOMAIN}/api/v2/users/${encodeURIComponent(user.user_id)}/roles`,
        {
          headers: { Authorization: `Bearer ${access_token}` }
        }
      );

      if (rolesRes.ok) {
        const roles = await rolesRes.json();
        user.roles = roles.map(r => r.name);
      } else {
        user.roles = [];
      }
    }

    // 최종 반환
    return {
      statusCode: 200,
      body: JSON.stringify({ users: trimmed })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `Internal error: ${err.message}`
    };
  }
}
