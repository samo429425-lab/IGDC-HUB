// netlify/functions/selfcheck.js
// Minimal ENV & health check for Admin panel. No secrets are exposed.
exports.handler = async () => {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasSupabaseUrl = !!process.env.SUPABASE_URL;
  const hasSupabaseAnon = !!process.env.SUPABASE_ANON_KEY;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(
      {
        endpoint: "/api/selfcheck",
        ok: hasOpenAI && hasSupabaseUrl && hasSupabaseAnon,
        env: {
          OPENAI_API_KEY: hasOpenAI ? "✔ loaded (hidden)" : "✖ missing",
          SUPABASE_URL: hasSupabaseUrl ? "✔ loaded (hidden)" : "✖ missing",
          SUPABASE_ANON_KEY: hasSupabaseAnon ? "✔ loaded (hidden)" : "✖ missing"
        },
        ts: new Date().toISOString()
      },
      null,
      2
    )
  };
};
