/**
 * maru-search.js — v1.0 (OPENAI-LIVE, PRODUCTION-SAFE)
 * MARU Engine unified endpoint for Netlify Functions
 *
 * Modes:
 *  - Recommend: /.netlify/functions/maru-search?domain=media&lang=ko&limit=12
 *  - Search   : /.netlify/functions/maru-search?q=keyword&lang=ko&limit=24
 *
 * Always returns:
 * {
 *   meta: {...},
 *   items: []
 * }
 *
 * Env:
 *  - MARU_USE_OPENAI=true|false   (default: false)
 *  - OPENAI_API_KEY=sk-...
 *  - MARU_OPENAI_MODEL=gpt-4o-mini (optional)
 *  - MARU_OPENAI_TIMEOUT_MS=12000  (optional)
 *
 * Data:
 *  - ./data/snapshot.internal.v1.json  (fallback / bootstrap)
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

const USE_OPENAI = String(process.env.MARU_USE_OPENAI || "false").toLowerCase() === "true";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.MARU_OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Math.max(2000, parseInt(process.env.MARU_OPENAI_TIMEOUT_MS || "12000", 10) || 12000);

// ---------- helpers ----------
function nowISO() {
  return new Date().toISOString();
}

function safeInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function safeText(s, maxLen) {
  if (typeof s !== "string") return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function safeUrl(u) {
  if (typeof u !== "string") return "";
  const t = u.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return "";
  if (t.startsWith("/") || t.startsWith("./") || t.startsWith("../")) return t;
  try {
    const url = new URL(t);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch (_) {}
  return "";
}

function uniqueStrings(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = safeText(String(v), 40);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeItem(item) {
  const o = item || {};
  const tags = uniqueStrings(o.tags);
  return {
    id: o.id ? String(o.id) : null,
    title: safeText(o.title || "", 120),
    summary: safeText(o.summary || "", 240),
    url: safeUrl(o.url || ""),
    thumb: safeUrl(o.thumb || ""),
    type: safeText(o.type || "", 40),
    platform: safeText(o.platform || "", 40),
    license: safeText(o.license || "", 40),
    tags,
    lang: safeText(o.lang || "all", 8) || "all",
    active: o.active !== false,
    score: Number.isFinite(o.score) ? o.score : 0
  };
}

function safeLoadSnapshot() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { items: [] };
  } catch (_) {
    return { items: [] };
  }
}

function scoreItem(item, query) {
  if (!query) return 0;
  const q = query.toLowerCase();
  let score = 0;

  const title = (item.title || "").toLowerCase();
  const summary = (item.summary || "").toLowerCase();

  if (title.includes(q)) score += 6;
  if (summary.includes(q)) score += 3;

  if (Array.isArray(item.tags)) {
    for (const t of item.tags) {
      const tt = String(t).toLowerCase();
      if (tt.includes(q)) score += 2;
    }
  }
  return score;
}

function extractJsonFromText(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  try {
    return JSON.parse(s);
  } catch (_) {}

  const match = s.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

async function openaiJson(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.6,
        messages: [
    {
        role: "system",
        content: MARU_SYSTEM_PROMPT
    },
    { role: "user", content: prompt }

        ]
      }),
      signal: controller.signal
    });

    const txt = await res.text();
    if (!res.ok) {
      return { ok: false, error: `OpenAI HTTP ${res.status}`, raw: txt };
    }

    const parsed = JSON.parse(txt);
    const content = parsed?.choices?.[0]?.message?.content || "";
    const jsonCandidate = extractJsonFromText(content);
    return { ok: true, json: jsonCandidate, raw: content };
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? "OpenAI timeout" : (e?.message || String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store"
  };
}

// ---------- handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const params = event.queryStringParameters || {};
  const domain = safeText(params.domain || "", 40) || null;
  const query = safeText(params.q || "", 120) || null;
  const lang = safeText(params.lang || "", 8) || "all";
  const limit = safeInt(params.limit, query ? 24 : 12, 1, 60);
  const debug = String(params.debug || "0") === "1";

  const snapshot = safeLoadSnapshot();
  // Support BOTH snapshot.items (legacy) and snapshot.sections[].items (new)
  const flatFromSections = (snap) => {
    try {
      if (!snap || !Array.isArray(snap.sections)) return [];
      const out = [];
      for (const sec of snap.sections) {
        const sid = (sec && (sec.id || sec.sectionId) || '').toString();
        const arr = Array.isArray(sec?.items) ? sec.items : (Array.isArray(sec?.cards) ? sec.cards : []);
        for (const it of arr) {
          if (!it) continue;
          // annotate section id for routing/debug
          if (!it.sectionId && sid) it.sectionId = sid;
          out.push(it);
        }
      }
      return out;
    } catch (_) { return []; }
  };

  const baseItems = (Array.isArray(snapshot.items) ? snapshot.items : []).concat(flatFromSections(snapshot));


  let normalized = baseItems.map(normalizeItem).filter((i) => i.active !== false);

  if (lang && lang !== "all") {
    normalized = normalized.filter((i) => !i.lang || i.lang === "all" || i.lang === lang);
  }

  // ---------- SEARCH MODE ----------
  if (query) {
    const scored = normalized
      .map((i) => ({ ...i, score: scoreItem(i, query) }))
      .filter((i) => i.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (USE_OPENAI && OPENAI_KEY && scored.length < Math.min(8, limit)) {
      const prompt =
        `Task: Provide up to ${limit} external resources relevant to the query.\n` +
        `Query: "${query}"\n` +
        `Language: ${lang}\n` +
        `Constraints:\n` +
        `- Prefer CC0/public-domain or official/free resource pages.\n` +
        `- Provide direct page URLs (not file downloads).\n` +
        `- If unsure, omit the item.\n` +
        `Return: JSON array only.`;

      const ai = await openaiJson(prompt);

      if (ai.ok && Array.isArray(ai.json)) {
        const aiItems = ai.json.map(normalizeItem).filter((i) => i.url);
        const seen = new Set(scored.map((i) => i.url));
        const merged = [...scored];
        for (const it of aiItems) {
          if (!it.url || seen.has(it.url)) continue;
          seen.add(it.url);
          merged.push(it);
          if (merged.length >= limit) break;
        }

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            meta: {
              mode: "search",
              query,
              domain: domain || null,
              count: merged.length,
              engine: "maru",
              ai: true,
              model: OPENAI_MODEL,
              updated: nowISO(),
              ...(debug ? { debug: { localCount: scored.length, aiOk: ai.ok, aiError: ai.error || null } } : {})
            },
            items: merged
          })
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          meta: {
            mode: "search",
            query,
            domain: domain || null,
            count: scored.length,
            engine: "maru",
            ai: false,
            updated: nowISO(),
            ...(debug ? { debug: { localCount: scored.length, aiOk: false, aiError: ai.error || "AI parse failed" } } : {})
          },
          items: scored
        })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        meta: {
          mode: "search",
          query,
          domain: domain || null,
          count: scored.length,
          engine: "maru",
          ai: false,
          updated: nowISO()
        },
        items: scored
      })
    };
  }

  // ---------- RECOMMEND MODE ----------
  let recommended = normalized;
  if (domain) {
    // 1) Exact section match (preferred): snapshot.sections[].id === domain (or domain variants)
    const d = String(domain).toLowerCase();
    const variants = new Set([
      d,
      d.replace(/_/g, "-"),
      d.replace(/-/g, "_"),
      d.replace(/^homeproducts$/i, "home-1"),
      d.replace(/^homeproducts$/i, "home_1")
    ]);

    let secItems = [];
    if (snapshot && Array.isArray(snapshot.sections)) {
      for (const sec of snapshot.sections) {
        const sid = String((sec && (sec.id || sec.sectionId) || "")).toLowerCase();
        if (!sid) continue;
        if (variants.has(sid)) {
          const arr = Array.isArray(sec.items) ? sec.items : (Array.isArray(sec.cards) ? sec.cards : []);
          secItems = arr;
          break;
        }
      }
    }

    if (secItems.length) {
      recommended = secItems.map(normalizeItem).filter((i) => i.url);
    } else {
      // 2) Fallback: type/tags match in flattened items
      recommended = normalized.filter((i) =>
        (i.sectionId && variants.has(String(i.sectionId).toLowerCase())) ||
        (i.type && variants.has(String(i.type).toLowerCase())) ||
        (Array.isArray(i.tags) && i.tags.some(t => variants.has(String(t).toLowerCase())))
      );
    }
  }

  if (USE_OPENAI && OPENAI_KEY) {
    const prompt =
      `Task: Recommend up to ${limit} resources for the domain "${domain || "general"}" for a content hub.\n` +
      `Language: ${lang}\n` +
      `Constraints:\n` +
      `- Prefer CC0/public-domain/free-to-use media libraries (videos, images, audio) and official resource hubs.\n` +
      `- Provide direct page URLs (not downloads), and avoid copyrighted content.\n` +
      `- For products, recommend legitimate external marketplaces or official product pages (we only link out).\n` +
      `Return: JSON array only.`;

    const ai = await openaiJson(prompt);

    if (ai.ok && Array.isArray(ai.json)) {
      const aiItems = ai.json.map(normalizeItem).filter((i) => i.url);
      const merged = [];
      const seen = new Set();

      for (const it of aiItems) {
        if (!it.url || seen.has(it.url)) continue;
        seen.add(it.url);
        merged.push(it);
        if (merged.length >= limit) break;
      }
      for (const it of recommended) {
        if (!it.url || seen.has(it.url)) continue;
        seen.add(it.url);
        merged.push(it);
        if (merged.length >= limit) break;
      }

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          meta: {
            mode: "recommend",
            domain: domain || "all",
            count: merged.length,
            engine: "maru",
            ai: true,
            model: OPENAI_MODEL,
            updated: nowISO(),
            ...(debug ? { debug: { aiOk: ai.ok, aiError: ai.error || null, snapshotCount: recommended.length } } : {})
          },
          items: merged
        })
      };
    }

    const snapOut = recommended.slice(0, limit);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        meta: {
          mode: "recommend",
          domain: domain || "all",
          count: snapOut.length,
          engine: "maru",
          ai: false,
          updated: nowISO(),
          ...(debug ? { debug: { aiOk: false, aiError: ai.error || "AI parse failed", snapshotCount: recommended.length } } : {})
        },
        items: snapOut
      })
    };
  }

  recommended = recommended.slice(0, limit);
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      meta: {
        mode: "recommend",
        domain: domain || "all",
        count: recommended.length,
        engine: "maru",
        ai: false,
        updated: nowISO()
      },
      items: recommended
    })
  };
};