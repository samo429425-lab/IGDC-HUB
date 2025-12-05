// /netlify/functions/ai-diagnose.js
// Admin 패널 호환 진단 엔드포인트
// - 비밀값 미노출
// - summary / summaryText 모두 제공(패널 호환성)
exports.handler = async () => {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasSupabaseUrl = !!process.env.SUPABASE_URL;
  const hasSupabaseAnon = !!process.env.SUPABASE_ANON_KEY;

  const items = [
    hasOpenAI ? "OPENAI_API_KEY OK" : "OPENAI_API_KEY MISSING",
    hasSupabaseUrl ? "SUPABASE_URL OK" : "SUPABASE_URL MISSING",
    hasSupabaseAnon ? "SUPABASE_ANON_KEY OK" : "SUPABASE_ANON_KEY MISSING",
  ];

  const ok = hasOpenAI && hasSupabaseUrl && hasSupabaseAnon;

  const payload = {
    endpoint: "/api/ai-diagnose",
    ok,
    status: ok ? "정상 작동 중" : "설정 필요",
    summary: items,                                 // array
    summaryText: items.join(" | "),                 // 패널 요약 문자열
    env: {
      OPENAI_API_KEY: hasOpenAI ? "✔ loaded (hidden)" : "✖ missing",
      SUPABASE_URL: hasSupabaseUrl ? "✔ loaded (hidden)" : "✖ missing",
      SUPABASE_ANON_KEY: hasSupabaseAnon ? "✔ loaded (hidden)" : "✖ missing",
      NODE_VERSION: process.version
    },
    ts: new Date().toISOString()
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload, null, 2)
  };
};
