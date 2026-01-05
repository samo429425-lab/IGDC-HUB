import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { user_id } = JSON.parse(event.body);

    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, address')
      .eq('user_id', user_id)
      .single();

    if (!profile?.phone || !profile?.address) {
      return response(400, '조건 미충족');
    }

    await applyAuth0Role(user_id, 'member_standard');
    return response(200, '스탠다드 승급 완료');
  } catch (e) {
    return response(500, e.message);
  }
}

async function applyAuth0Role(userId, role) {
  const token = await getAuth0Token();

  await fetch(`${process.env.AUTH0_DOMAIN}/api/v2/users/${userId}/roles`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ roles: [role] })
  });
}

async function getAuth0Token() {
  const r = await fetch(`${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.AUTH0_M2M_CLIENT_ID,
      client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
      audience: `${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials'
    })
  });
  return (await r.json()).access_token;
}

const response = (code, msg) => ({
  statusCode: code,
  body: JSON.stringify({ message: msg })
});
