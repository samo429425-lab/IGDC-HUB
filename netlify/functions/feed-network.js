/**
 * netlify/functions/feed-network.js
 * Network Hub feed broker (Search-Bank -> Network Right Panel)
 *
 * - Reads /data/search-bank.snapshot.json from the deployed site (same origin)
 * - Filters ONLY one channel (default: "web") to avoid cross-page mixing
 * - Returns normalized items for the Network right rail
 *
 * Query:
 *   ?limit=100        (default 100, max 200)
 *   ?channel=web      (default "web")
 */

function clampInt(v, d, min, max){
  const n = Number.parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return d;
  return Math.max(min, Math.min(max, n));
}

function json(res, status, body){
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function originFromEnv(){
  // Netlify runtime provides one of these
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  ).replace(/\/+$/, "");
}

function normalizeItem(it){
  if (!it || typeof it !== "object") return null;

  const url = it.url || it.link || it.href;
  if (!url) return null;

  return {
    id: it.id || null,
    channel: it.channel || null,
    section: it.section || null,
    title: it.title || it.name || "",
    summary: it.summary || it.desc || "",
    url,
    thumbnail: it.thumbnail || it.image || it.icon || "",
    source: (it.source && it.source.name) ? it.source.name : (it.source || null),
    published_at: it.published_at || null,
    ingested_at: it.ingested_at || null,
    tags: Array.isArray(it.tags) ? it.tags : []
  };
}

exports.handler = async (event) => {
  try{
    const q = event.queryStringParameters || {};
    const limit = clampInt(q.limit, 100, 1, 200);
    const channel = String(q.channel || "web").trim();

    const origin = originFromEnv();
    if (!origin){
      return json(null, 500, { status:"error", error:"Missing site origin env (URL/DEPLOY_PRIME_URL)." });
    }

    const bankUrl = `${origin}/data/search-bank.snapshot.json`;

    const r = await fetch(bankUrl, { headers: { "accept": "application/json" } });
    if (!r.ok){
      return json(null, 502, { status:"error", error:`Failed to fetch search-bank snapshot (${r.status})`, bankUrl });
    }

    const snap = await r.json();
    const all = Array.isArray(snap?.items) ? snap.items : [];
    const filtered = [];
    for (const it of all){
      if (!it || typeof it !== "object") continue;
      if (channel && it.channel !== channel) continue;
      const n = normalizeItem(it);
      if (n) filtered.push(n);
      if (filtered.length >= limit) break;
    }

    return json(null, 200, {
      status: "ok",
      page: "network",
      channel,
      count: filtered.length,
      generated: new Date().toISOString(),
      items: filtered
    });

  }catch(e){
    return json(null, 500, { status:"error", error: String(e && e.message ? e.message : e) });
  }
};
