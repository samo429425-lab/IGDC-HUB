/**
 * netlify/functions/feed-network.js (v3)
 * Network Hub feed broker (Search-Bank -> Network Right Panel)
 *
 * 목표
 * - /data/search-bank.snapshot.json 에서 네트워크허브 우측패널용 아이템을 뽑아 "thumb-link" 슬롯에 꽂히는 형태로 전달
 * - CORS/OPTIONS 지원
 * - Netlify 런타임에서 URL env가 없을 때도 동작(상대경로 fetch fallback)
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

function corsHeaders(){
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(status, body){
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify(body) };
}

function originFromEnv(){
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  ).replace(/\/+$/, "");
}

async function fetchJson(url){
  try{
    const r = await fetch(url, { headers: { "accept": "application/json" }, cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  }catch{
    return null;
  }
}

function normalizeForRightPanel(it){
  if (!it || typeof it !== "object") return null;

  const link = it.url || it.link || it.href || "";
  const thumb = it.thumb || it.thumbnail || it.image || it.icon || "";
  if (!link || !thumb) return null;

  return {
    id: it.id || it.trackId || it._id || null,
    title: it.title || it.name || "",
    link,
    thumb,
    // keep extra for future
    channel: it.channel || null,
    section: it.section || null,
    tags: Array.isArray(it.tags) ? it.tags : []
  };
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS"){
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  try{
    const q = event.queryStringParameters || {};
    const limit = clampInt(q.limit, 100, 1, 200);
    const channel = String(q.channel || "web").trim();

    // 1) try absolute URL based on env, 2) fallback relative
    const origin = originFromEnv();
    const urls = [];
    if (origin) urls.push(`${origin}/data/search-bank.snapshot.json`);
    urls.push(`/data/search-bank.snapshot.json`);

    let bankSnap = null;
    let usedUrl = null;
    for (const u of urls){
      bankSnap = await fetchJson(u);
      if (bankSnap){
        usedUrl = u;
        break;
      }
    }

    if (!bankSnap){
      return json(502, {
        status: "error",
        error: "Failed to fetch search-bank.snapshot.json (absolute+relative both failed).",
        tried: urls
      });
    }

    const all = Array.isArray(bankSnap?.items) ? bankSnap.items : [];
    const out = [];
    for (const it of all){
      if (!it || typeof it !== "object") continue;
      if (channel && it.channel !== channel) continue;
      const n = normalizeForRightPanel(it);
      if (n) out.push(n);
      if (out.length >= limit) break;
    }

    return json(200, {
      status: "ok",
      page: "network",
      key: "right-network-100",
      channel,
      count: out.length,
      generated: new Date().toISOString(),
      source: usedUrl,
      items: out
    });

  }catch(e){
    return json(500, { status:"error", error: String(e && e.message ? e.message : e) });
  }
};
