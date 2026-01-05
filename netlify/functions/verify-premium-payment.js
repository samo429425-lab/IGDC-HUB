import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

/**
 * Premium Membership Pricing (SERVER CANONICAL)
 * Base: USD 3.00
 * KRW converted for Korea users (display & validation)
 */
const PREMIUM_PRICE_USD = 3.0;
const USD_TO_KRW = 1350; // initial fixed rate (can be moved to DB later)
const PREMIUM_PRICE_KRW = Math.round(PREMIUM_PRICE_USD * USD_TO_KRW);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { user_id, order_id, amount, currency } = JSON.parse(event.body);

    if (!user_id || !order_id || !amount || !currency) {
      return response(400, '결제 데이터 누락');
    }

    // Canonical price validation
    if (currency === 'KRW' && amount !== PREMIUM_PRICE_KRW) {
      return response(400, '결제 금액 불일치(KRW)');
    }

    if (currency === 'USD' && amount !== PREMIUM_PRICE_USD) {
      return response(400, '결제 금액 불일치(USD)');
    }

    // Store payment record
    await supabase.from('payments').insert({
      user_id,
      order_id,
      amount,
      currency,
      type: 'premium',
      base_usd: PREMIUM_PRICE_USD
    });

    // Apply Auth0 role
    await applyAuth0Role(user_id, 'member_premium');

    return response(200, '프리미엄 회원 승급 완료');
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
