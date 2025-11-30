
// /.netlify/functions/qa-proxy
// Minimal Supabase proxy for Q&A retrieval and logging user questions.
// Requires SUPABASE_URL, SUPABASE_ANON_KEY as environment variables.
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

async function sbFetch(path, init={}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = Object.assign({
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  }, init.headers || {});
  const res = await fetch(url, Object.assign({}, init, { headers }));
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase error ${res.status}: ${txt}`);
  }
  return res.json();
}

exports.handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return { statusCode: 503, body: "Supabase env missing" };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } };
    }
    if (event.httpMethod === "GET") {
      // Fetch latest FAQs
      const faqs = await sbFetch("faqs?select=question,answer,updated_at&order=updated_at.desc&limit=20");
      return { statusCode: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ faqs }) };
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { question, meta } = body;
      if (!question) return { statusCode: 400, body: "Missing question" };
      // Insert question to a "questions" table (requires RLS insert permission for anon)
      const saved = await sbFetch("questions", { method: "POST", body: JSON.stringify([{ question, meta: meta || null }]) });
      return { statusCode: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true, saved }) };
    }
    return { statusCode: 405, body: "Method not allowed" };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
