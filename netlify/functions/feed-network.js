/**
 * feed-network.js (v2) - NETLIFY FUNCTION
 *
 * 목표(네트워크 허브 우측 전용):
 * - Search-Bank snapshot에서 network.right-network-100 후보를 최대한 찾아 items[] 구성
 * - 실패 시 networkhub-snapshot.json fallback
 * - 최종 실패 시에도 "빈 배열 금지": 안전 더미 1..limit 반환
 *
 * Endpoint:
 *   /.netlify/functions/feed-network?limit=100&channel=
 * Response:
 *   { status:"ok", source:"search-bank|networkhub-snapshot|dummy", items:[...] }
 *
 * items[] 최소 필드:
 *   { id, title, url, thumb }
 */

"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_PAGE = "network";
const TARGET_PSOM_KEY = "right-network-100"; // routeKey: network.right-network-100

function tryReadJSON(rel){
  const tries = [
    path.join(__dirname, rel),
    path.join(__dirname, "..", rel),
    path.join(__dirname, "..", "..", rel),
    path.join(__dirname, "..", "..", "..", rel),
  ];
  for (const p of tries){
    try{
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
    }catch(_){}
  }
  return null;
}

function pick(obj, keys){
  for (const k of keys){
    const v = obj && obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function safeDummySvg(n){
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#eef2f7"/>
          <stop offset="1" stop-color="#dbe4f0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="420" height="420" rx="24" fill="url(#g)"/>
      <text x="210" y="210" text-anchor="middle" dominant-baseline="central"
            font-family="system-ui, -apple-system, Segoe UI, Roboto"
            font-size="88" font-weight="800" fill="#4a6fa5">${n}</text>
      <text x="210" y="290" text-anchor="middle"
            font-family="system-ui, -apple-system, Segoe UI, Roboto"
            font-size="26" font-weight="600" fill="#7a8da8">Loading</text>
    </svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function normalize(it){
  if (!it || typeof it !== "object") return null;

  // url candidates (top-level + common nested)
  const url =
    pick(it, ["url","link","href","path"]) ||
    pick(it?.detail, ["url","link","href","path"]) ||
    pick(it?.media, ["url","link","href","path"]) ||
    pick(it?.extension, ["url","link","href","path"]);

  // thumb candidates (top-level + common nested)
  const thumb =
    pick(it, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.media, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl","url"]) ||
    pick(it?.media?.preview, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl","url"]) ||
    pick(it?.preview, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl","url"]) ||
    pick(it?.extension, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl","url"]);

  if (!url || !thumb) return null;

  return {
    id: it.id || it._id || it.trackId || null,
    title: pick(it, ["title","name","label","caption"]) || "",
    url,
    thumb
  };
}

function channelPass(it, channel){
  if (!channel) return true;
  const ch =
    (it && (it.channel || it.platform || it.source?.platform || it.source)) || "";
  if (!ch) return true;
  return String(ch).toLowerCase() === String(channel).toLowerCase();
}

function bindPass(it){
  const b = it && it.bind;
  if (!b || typeof b !== "object") return false;
  const page = String(b.page || "").toLowerCase();
  if (page && page !== TARGET_PAGE) return false;

  const keyCand = [
    b.psom_key, b.psomKey, b.section, b.slot, b.route, b.routeKey
  ].map(x=> String(x || "").toLowerCase());

  const ok =
    keyCand.includes(TARGET_PSOM_KEY) ||
    keyCand.includes(`${TARGET_PAGE}.${TARGET_PSOM_KEY}`) ||
    keyCand.includes(`right-network-100`) ||
    keyCand.includes(`network.right-network-100`);

  return ok;
}

function extractFromSearchBank(bank, channel){
  const out = [];

  // --- 0) index.by_page_section route ---
  const routeKey = `${TARGET_PAGE}.${TARGET_PSOM_KEY}`;
  const idList = bank?.index?.by_page_section?.[routeKey];
  if (Array.isArray(idList) && idList.length){
    const map = new Map();
    if (Array.isArray(bank?.items)){
      for (const it of bank.items) if (it && it.id) map.set(it.id, it);
    }
    for (const id of idList){
      const it = map.get(id);
      if (!it) continue;
      if (!channelPass(it, channel)) continue;
      const n = normalize(it);
      if (n) out.push(n);
    }
    return out;
  }

  // --- 1) scan pools ---
  const pools = [];
  if (Array.isArray(bank?.items)) pools.push(bank.items);
  if (Array.isArray(bank?.network?.items)) pools.push(bank.network.items);
  if (Array.isArray(bank?.data?.items)) pools.push(bank.data.items);

  const sec = bank?.pages?.network?.sections?.[TARGET_PSOM_KEY];
  if (Array.isArray(sec)) pools.push(sec);

  // 1-a) bind 우선
  for (const arr of pools){
    for (const it of arr){
      if (!it) continue;
      if (!bindPass(it)) continue;
      if (!channelPass(it, channel)) continue;
      const n = normalize(it);
      if (n) out.push(n);
    }
  }
  if (out.length) return out;

  // 1-b) bind 없으면 전체 스캔 (채널만 optional)
  for (const arr of pools){
    for (const it of arr){
      if (!it) continue;
      if (!channelPass(it, channel)) continue;
      const n = normalize(it);
      if (n) out.push(n);
    }
  }

  return out;
}

function makeDummyItems(limit){
  const items = [];
  for (let i=1; i<=limit; i++){
    items.push({
      id: `dummy-${i}`,
      title: `Loading ${i}`,
      url: "#",
      thumb: safeDummySvg(i)
    });
  }
  return items;
}

exports.handler = async function(event){
  try{
    const q = event.queryStringParameters || {};
    const limit = Math.max(1, Math.min(1000, parseInt(q.limit || "100", 10) || 100));
    const channel = (q.channel || "").trim(); // optional

    // 1) search-bank 우선
    const searchBank =
      tryReadJSON("data/search-bank.snapshot.json") ||
      tryReadJSON("search-bank.snapshot.json") ||
      {};

    let items = extractFromSearchBank(searchBank, channel)
      .slice(0, limit);

    let source = "search-bank";

    // 2) fallback: networkhub snapshot
    if (!items.length){
      const nh =
        tryReadJSON("data/networkhub-snapshot.json") ||
        tryReadJSON("networkhub-snapshot.json") ||
        {};

      const raw = Array.isArray(nh.items) ? nh.items : [];
      items = raw.map(normalize).filter(Boolean).slice(0, limit);
      source = "networkhub-snapshot";
    }

    // 3) 마지막: dummy (빈 배열 금지)
    if (!items.length){
      items = makeDummyItems(Math.min(100, limit));
      source = "dummy";
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        status: "ok",
        source,
        count: items.length,
        items
      })
    };
  }catch(e){
    // 에러여도 빈 배열 금지
    const items = makeDummyItems(50);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        status: "ok",
        source: "dummy",
        count: items.length,
        error: String(e && e.message ? e.message : e),
        items
      })
    };
  }
};
