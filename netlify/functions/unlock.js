// netlify/functions/unlock.js
// env: AUTH0_DOMAIN=dev-zzc5mej3f2hgg6gw.us.auth0.com
//      AUTH0_CLIENT_ID=<YOUR_M2M_CLIENT_ID>
//      AUTH0_CLIENT_SECRET=<YOUR_M2M_CLIENT_SECRET>

export async function handler(event) {
  try {
    const email = (JSON.parse(event.body || "{}").email || "samo429425@gmail.com").trim();
    const DOMAIN = process.env.AUTH0_DOMAIN; // e.g., dev-zzc5mej3f2hgg6gw.us.auth0.com

    // 1) M2M token
    const tokenResp = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: process.env.AUTH0_CLIENT_ID,
        client_secret: process.env.AUTH0_CLIENT_SECRET,
        audience: `https://${DOMAIN}/api/v2/`,
      }),
    }).then(r => r.json());

    if (!tokenResp.access_token) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "m2m_token_failed", detail: tokenResp }),
      };
    }
    const headers = { Authorization: `Bearer ${tokenResp.access_token}` };

    // 2) email -> user_id
    const users = await fetch(
      `https://${DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
      { headers }
    ).then(r => r.json());

    const user = (users || []).find(u => (u.identities || []).some(i => i.provider === "google-oauth2")) || users?.[0];
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: "user_not_found" }) };
    }

    const uid = encodeURIComponent(user.user_id);
    const base = `https://${DOMAIN}/api/v2/users/${uid}`;

    // 3) force-reset MFA/passkeys
    const delAuth = await fetch(`${base}/authentication-methods`, { method: "DELETE", headers });
    // 4) revoke all sessions
    const delSess = await fetch(`${base}/sessions`, { method: "DELETE", headers });

    if (!delAuth.ok) {
      return { statusCode: 500, body: JSON.stringify({ step: "authentication-methods", status: delAuth.status }) };
    }
    if (!delSess.ok) {
      return { statusCode: 500, body: JSON.stringify({ step: "sessions", status: delSess.status }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, user_id: user.user_id }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
}
