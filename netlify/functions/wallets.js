import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

export const handler = async () => {
  const env = process.env;

  // 1️⃣ LBank 잔액 조회
  let balanceData = { balance: 0, assets: [] };
  try {
    const res = await fetch(`https://api.lbank.info/v2/user_info.do?uid=${env.LBANK_UID}`, {
      headers: { "Authorization": `Bearer ${env.LBANK_API_KEY}` }
    });
    const json = await res.json();
    balanceData = {
      balance: json.data?.asset?.USDT || 0,
      assets: json.data?.asset || {}
    };
  } catch (e) {
    console.error("LBank fetch error:", e);
  }

  // 2️⃣ Supabase 도네이션 수치
  let donationStats = { total: 0, supporters: 0 };
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
    const { data, error } = await supabase
      .from("donations")
      .select("amount", { count: "exact" });
    if (data) {
      const total = data.reduce((sum, d) => sum + (d.amount || 0), 0);
      donationStats = { total, supporters: data.length };
    }
  } catch (e) {
    console.error("Supabase fetch error:", e);
  }

  // 3️⃣ 통합 결과 반환
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      wallet: balanceData,
      donation: donationStats,
      updated: new Date().toISOString()
    })
  };
};
