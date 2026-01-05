import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { application_id } = JSON.parse(event.body);

    const { data: app } = await supabase
      .from('commerce_applications')
      .select('*')
      .eq('id', application_id)
      .single();

    if (!app || app.status !== 'pending') {
      return response(400, '처리 불가 상태');
    }

    const approved = true;

    if (!approved) {
      await supabase
        .from('commerce_applications')
        .update({ status: 'rejected' })
        .eq('id', application_id);
      return response(200, '반려 처리');
    }

    await supabase
      .from('commerce_applications')
      .update({ status: 'approved' })
      .eq('id', application_id);

    await applyAuth0Role(app.user_id, 'commerce_manager');
    return response(200, '커머스 매니저 승인 완료');
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
